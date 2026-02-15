import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Upload, Activity, ChevronLeft, ChevronRight, BarChart2, Clock, Calendar, Filter, FileCheck, Play, TrendingUp, Hash, DollarSign, X, Table, ArrowUp, ArrowDown, CalendarRange, ArrowDownRight, Download, ChevronDown, Plus, Minus, ZoomIn, BarChart3, Save, FolderOpen, Trash2, ToggleLeft, ToggleRight, Power, PowerOff, Eye, EyeOff, Sparkles, RotateCcw, LayoutDashboard, FileText } from 'lucide-react';
import { CONDITIONS, CATEGORIES, getConditionById } from './conditions';
import * as Indicators from './indicators';
import { uploadCSV, runBacktest as apiRunBacktest, runOptimization as apiRunOptimization, getBackendStatus, getLoadedData } from './api';
import {
    createChart, CrosshairMode, LineStyle,
    CandlestickSeries, LineSeries, HistogramSeries,
    createSeriesMarkers
} from 'lightweight-charts';
import ReportAnalyzer from './components/ReportAnalyzer';
import DetailedReport from './components/DetailedReport';
import { COLORS, FOMC_DATES, TICK_SIZE } from './constants';
import { formatDateUTC, parseParamValue, parseOptimizationRange, generateOptimizationValues, parsePriceCSV, parsePriceCSVAsync } from './utils';

// --- מנוע עיבוד נתונים ---
// Aggregation rules (תואם לנינג'ה טריידר):
// - Open = Open של הנר הראשון בטווח
// - Close = Close של הנר האחרון בטווח
// - High = Max(High) של כל הנרות בטווח
// - Low = Min(Low) של כל הנרות בטווח
// - Volume = Sum(Volume) של כל הנרות בטווח
// - Time alignment: בדקות "Close Time" (כמו NinjaTrader), נר 5 דקות מסומן לפי *זמן הסגירה*.
//   דוגמה: נר שמוצג כ-08:35 בנוי מהדקות 08:31–08:35.
//   (כלומר קיבוץ לפי דקות 01–05, 06–10, 11–15, ... והוא נקרא על שם סוף הבלוק)
const processData = (rawData, timeframe) => {
  if (!rawData || rawData.length === 0) return [];
  if (timeframe === 1) return rawData; // אין צורך באגרגציה

  const aggregated = [];
  // Map<bucketCloseTimeSeconds, bucket>
  const bucketMap = new Map();

  rawData.forEach((item) => {
    const itemTime = item.time * 1000; // Convert to milliseconds
    const date = new Date(itemTime);
    
    // Calculate bucket start time (תואם לנינג'ה טריידר)
    // החישוב נשאר אותו דבר (בלוקים מתחילים ב-:01, :06, :11 וכו')
    // אבל עכשיו אנחנו מציגים את הנר לפי *זמן הסגירה* (כמו NinjaTrader): :05, :10, :15...
    const totalMinutes = date.getUTCHours() * 60 + date.getUTCMinutes();
    
    // Calculate which bucket this bar belongs to
    // Formula: floor((minutes - 1) / timeframe) * timeframe + 1
    // This ensures bars start at :01, :06, :11, :16, etc. (after previous bar closes)
    // Handle edge case: if minutes is 0, start at 1
    const bucketStartMinutes = totalMinutes === 0 ? 1 : Math.floor((totalMinutes - 1) / timeframe) * timeframe + 1;

    // Bucket close time (שם הנר) = start + (timeframe - 1)
    // לדוגמה: start=08:31, TF=5 => close=08:35
    const bucketCloseMinutesRaw = bucketStartMinutes + (timeframe - 1);
    const closeDayOffset = bucketCloseMinutesRaw >= 1440 ? 1 : 0;
    const bucketCloseMinutes = bucketCloseMinutesRaw % 1440;
    const closeHours = Math.floor(bucketCloseMinutes / 60);
    const closeMins = bucketCloseMinutes % 60;

    const bucketCloseTimestamp = Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate() + closeDayOffset,
      closeHours,
      closeMins,
      0,
      0
    );

    const bucketCloseTime = bucketCloseTimestamp / 1000; // seconds (Ninja-style close time label)

    // Get or create bucket
    if (!bucketMap.has(bucketCloseTime)) {
      // First bar in this bucket - initialize with this bar's values
      bucketMap.set(bucketCloseTime, {
        // IMPORTANT: We store bar time as CLOSE time (like NinjaTrader)
        time: bucketCloseTime,
        open: item.open,  // Open of first bar
        high: item.high,  // Will be updated with max
        low: item.low,    // Will be updated with min
        close: item.close, // Will be updated with last bar's close
        volume: item.volume
      });
    } else {
      // Update existing bucket
      const bucket = bucketMap.get(bucketCloseTime);
      bucket.high = Math.max(bucket.high, item.high);
      bucket.low = Math.min(bucket.low, item.low);
      bucket.close = item.close; // Close of last bar in bucket
      bucket.volume += item.volume;
    }
  });

  // Convert map to sorted array
  const sortedBuckets = Array.from(bucketMap.values()).sort((a, b) => a.time - b.time);
  
  return sortedBuckets;
};

// --- אגרגציה יומית (Daily Aggregation) ---
// תואם לנינג'ה טריידר: Closes[1][0] = daily close of current day (even if day not closed yet)
const aggregateToDaily = (data, upToIndex = null) => {
  if (!data || data.length === 0) return [];
  
  const dailyMap = new Map(); // Map<dateString, dailyBar>
  const endIndex = upToIndex !== null ? Math.min(upToIndex + 1, data.length) : data.length;
  
  for (let i = 0; i < endIndex; i++) {
    const item = data[i];
    const itemTime = item.time * 1000; // Convert to milliseconds
    const date = new Date(itemTime);
    // Use date string as key (YYYY-MM-DD)
    const dateStr = formatDateUTC(date);
    
    if (!dailyMap.has(dateStr)) {
      // First bar of the day - initialize with this bar's values
      dailyMap.set(dateStr, {
        date: dateStr,
        time: new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()).getTime() / 1000, // Start of day timestamp
        open: item.open,
        high: item.high,
        low: item.low,
        close: item.close, // Will be updated as we process more bars
        volume: item.volume
      });
    } else {
      // Update existing daily bar
      const dailyBar = dailyMap.get(dateStr);
      dailyBar.high = Math.max(dailyBar.high, item.high);
      dailyBar.low = Math.min(dailyBar.low, item.low);
      dailyBar.close = item.close; // Close of last bar processed so far (תואם לנינג'ה טריידר)
      dailyBar.volume += item.volume;
    }
  }
  
  // Convert map to sorted array
  return Array.from(dailyMap.values()).sort((a, b) => a.time - b.time);
};

// --- פונקציות אופטימיזציה ---
const findOptimizationParams = (entryConditions, exitConditions) => {
  const optimizationParams = [];
  
  // Check entry conditions
  entryConditions.forEach((condition, condIdx) => {
    if (!condition.id) return;
    const cond = getConditionById(condition.id);
    if (!cond?.params) return;
    cond.params.forEach((param) => {
      const value = condition.params?.[param.name];
      if (typeof value === 'string') {
        const range = parseOptimizationRange(value);
        if (range) {
          optimizationParams.push({
            conditionIndex: condIdx,
            isEntry: true,
            paramName: param.name,
            range,
            values: generateOptimizationValues(range)
          });
        }
      }
    });
  });
  
  // Check exit conditions
  exitConditions.forEach((condition, condIdx) => {
    if (!condition.id) return;
    const cond = getConditionById(condition.id);
    if (!cond?.params) return;
    cond.params.forEach((param) => {
      const value = condition.params?.[param.name];
      if (typeof value === 'string') {
        const range = parseOptimizationRange(value);
        if (range) {
          optimizationParams.push({
            conditionIndex: condIdx,
            isEntry: false,
            paramName: param.name,
            range,
            values: generateOptimizationValues(range)
          });
        }
      }
    });
  });
  
  return optimizationParams;
};

const runOptimization = async (data, entryConditions, exitConditions, optimizationParams, onProgress) => {
  // Prepare optimization ranges for backend
  const optimizationRanges = {};
  
  optimizationParams.forEach(opt => {
    const key = `${opt.isEntry ? 'entry' : 'exit'}_${opt.conditionIndex}_${opt.paramName}`;
    const min = Math.min(...opt.values);
    const max = Math.max(...opt.values);
    const step = opt.values.length > 1 ? opt.values[1] - opt.values[0] : 1;
    
    optimizationRanges[key] = {
      min,
      max,
      step
    };
  });

  // Prepare strategy for backend
  const strategy = {
    entryConditions: (entryConditions || []).map(c => ({
      id: c.id,
      params: c.params || {},
      enabled: c.enabled !== false,
      timeframe: c.timeframe || null
    })),
    exitConditions: (exitConditions || []).map(c => ({
      id: c.id,
      params: c.params || {},
      enabled: c.enabled !== false,
      timeframe: c.timeframe || null
    }))
  };

  try {
    // Call backend API (no need to send data, backend already has it)
    const response = await apiRunOptimization(data, strategy, optimizationRanges, onProgress);
    
    // Convert backend results to frontend format
    const results = response.results.map(r => {
      // Build param display string
      const paramDisplay = Object.entries(r.params).map(([key, value]) => {
        // Parse key: entry_0_period or exit_1_threshold
        const [side, idx, paramName] = key.split('_');
        const isEntry = side === 'entry';
        const conditionIndex = parseInt(idx);
        const cond = isEntry ? entryConditions[conditionIndex] : exitConditions[conditionIndex];
        const condDef = getConditionById(cond?.id);
        return `${condDef?.name || cond?.id || 'Unknown'} ${paramName}=${value}`;
      }).join(', ');

      return {
        params: paramDisplay,
        paramValues: r.params,
        stats: {
          totalPnL: r.result.totalProfit,
          totalTrades: r.result.totalTrades,
          winningTrades: r.result.winningTrades,
          losingTrades: r.result.losingTrades,
          winRate: r.result.winRate,
          profitFactor: r.result.profitFactor,
          maxDrawdown: r.result.maxDrawdown,
          sharpeRatio: r.result.sharpeRatio,
          avgWin: r.result.averageWin,
          avgLoss: r.result.averageLoss,
          largestWin: r.result.largestWin,
          largestLoss: r.result.largestLoss
        },
        trades: r.result.trades || [] // Backend returns individual trades even for optimization
      };
    });

    return results;
  } catch (error) {
    console.error('❌ Optimization failed:', error);
    throw error;
  }
};

// --- זיהוי אינדיקטורים נדרשים לפי תנאים ---
const getRequiredIndicators = (entryConditions = [], exitConditions = []) => {
  const allConditions = [...(entryConditions || []), ...(exitConditions || [])];
  
  // Return only conditions that should be displayed and are actually indicators
  return allConditions.filter(condition => {
    if (!condition.id || condition.visible === false) return false;
    
    const id = condition.id;
    // Check if it's an indicator category
    return (
      id.startsWith('rsi_') || 
      id.startsWith('macd_') || 
      id.startsWith('stoch_') || 
      id.includes('sma') || 
      id.includes('ema') || 
      id.startsWith('price_touch_') || 
      id.startsWith('bb_') || 
      id.startsWith('volume_') || 
      id.startsWith('adx_') ||
      id.startsWith('cci_') ||
      id.startsWith('willr_') ||
      id.startsWith('atr_')
    );
  });
};

// --- חישוב סטטיסטיקות ---
const calculateStats = (trades) => {
    let totalPnL = 0;
    let grossProfit = 0;
    let grossLoss = 0;
    let peakEquity = 0;
    let currentEquity = 0;
    let maxDrawdown = 0;
    let winningTrades = 0;
    
    trades.forEach(trade => {
        totalPnL += trade.pnl;
        currentEquity += trade.pnl;

        if (trade.pnl > 0) {
            grossProfit += trade.pnl;
            winningTrades++;
        } else {
            grossLoss += Math.abs(trade.pnl);
        }

        if (currentEquity > peakEquity) {
            peakEquity = currentEquity;
        }
        const drawdown = peakEquity - currentEquity;
        if (drawdown > maxDrawdown) {
            maxDrawdown = drawdown;
        }
    });

    const totalTrades = trades.length;
    const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? 100 : 0);

    return {
        totalTrades,
        totalPnL,
        winRate,
        profitFactor,
        maxDrawdown
    };
};

// --- בדיקת תנאים ---
const checkCondition = (conditionId, data, index, indicators, params = {}, indicatorCache = {}, timeframe = null, rawData = [], primaryTimeframe = 1) => {
  if (!conditionId || index < 0 || index >= data.length) return false;
  if (typeof conditionId !== 'string') return false;
  
  const candle = data[index];
  const prevCandle = index > 0 ? data[index - 1] : null;

  // בחירת מסגרת הזמן הנכונה לעבודה
  const activeTF = timeframe === 'DEF' || !timeframe ? primaryTimeframe : parseInt(timeframe);
  
  // פונקציית עזר לקבלת נתוני אינדיקטור (מה-Cache או חישוב מחדש)
  const getInd = (type, calcFn) => {
    // 1. ניסיון לקחת מאינדיקטורים מוכנים מראש (MTF)
    if (activeTF !== primaryTimeframe && indicators[`tf_${activeTF}`]) {
      const val = indicators[`tf_${activeTF}`][type];
      if (val) return val;
    }
    if (activeTF === primaryTimeframe) {
      const val = indicators[type];
      if (val) return val;
    }

    // 2. חישוב דינמי אם לא נמצא במוכנים
    const cacheKey = `dyn_${type}_${activeTF}`;
    if (indicatorCache[cacheKey]) return indicatorCache[cacheKey];

    let result;
    if (activeTF === primaryTimeframe) {
      result = calcFn(data);
    } else {
      const tfData = processData(rawData, activeTF);
      const tfValues = calcFn(tfData);
      result = alignIndicatorToPrimary(data, primaryTimeframe, tfData, activeTF, tfValues);
    }
    
    indicatorCache[cacheKey] = result;
    return result;
  };
  
  // Time-based conditions
  if (conditionId.startsWith('time')) {
    // Use current candle time from data (stored as UTC timestamp)
    const date = new Date(candle.time * 1000);
    // Extract time from the data itself (UTC), not from local machine
    // Note: Market hours are in EST/EDT, but data is stored in UTC
    // For time comparisons, we use UTC time directly (assuming data represents market time in UTC)
    const hours = date.getUTCHours();
    const minutes = date.getUTCMinutes();
    const currentTime = hours * 100 + minutes; // Format: HHMM (e.g., 840, 1500)
    
    if (conditionId === 'time') {
      const time = parseParamValue(params.time, 840);
      return currentTime === time;
    }
    if (conditionId === 'time_market_open') return currentTime === 830; // 8:30
    if (conditionId === 'time_market_close') return currentTime === 1600; // 16:00
    if (conditionId === 'time_range') {
      const startTime = parseParamValue(params.startTime, 830);
      const endTime = parseParamValue(params.endTime, 1340);
      return currentTime >= startTime && currentTime <= endTime;
    }
    if (conditionId === 'minutes_before_session_close') {
      // Check if next candle has 60+ minute gap (session close) - block entry on last candle before gap
      if (index >= data.length - 1) return false; // Last candle, no next candle - block entry
      
      const nextCandle = data[index + 1];
      const currentCandleTime = candle.time * 1000; // Convert to milliseconds
      const nextCandleTime = nextCandle.time * 1000;
      const timeDiffMinutes = (nextCandleTime - currentCandleTime) / (1000 * 60);
      
      // If gap is 60+ minutes, this is session close - block entry (this is the last candle before gap)
      if (timeDiffMinutes >= 60) {
        return false; // Session close detected, block entry
      }
      
      // No gap detected, allow entry
      return true;
    }
  }
  
  // FOMC Hours condition (separate from time_ conditions)
  if (conditionId === 'fomc_hours') {
    // Use current candle time from data (stored as UTC timestamp)
    const date = new Date(candle.time * 1000);
    const hours = date.getUTCHours();
    const minutes = date.getUTCMinutes();
    const currentTime = hours * 100 + minutes; // Format: HHMM (e.g., 840, 1500)
    
    // Check if current date is FOMC date and time is within FOMC hours - block entry
    const dateStr = date.toISOString().split('T')[0]; // Format: YYYY-MM-DD
    const isFomcDate = FOMC_DATES.has(dateStr);
    
    if (!isFomcDate) {
      return true; // Not FOMC date, allow entry
    }
    
    // It's FOMC date, check if within FOMC hours
    const startTime = parseParamValue(params.startTime, 830);
    const endTime = parseParamValue(params.endTime, 1115);
    const isWithinFomcHours = currentTime >= startTime && currentTime <= endTime;
    
    // If within FOMC hours, block entry (return false)
    return !isWithinFomcHours;
  }
  
  // RSI conditions
  if (conditionId.startsWith('rsi_')) {
    const period = parseParamValue(params.period, 14);
    const rsi = getInd('rsi', (d) => Indicators.calculateRSI(d, period));
    if (!rsi || rsi[index] === null || (prevCandle && rsi[index - 1] === null)) return false;
    
    if (conditionId === 'rsi_above') {
      const threshold = parseParamValue(params.threshold, params.value, 70);
      return rsi[index] > threshold;
    }
    if (conditionId === 'rsi_below') {
      const threshold = parseParamValue(params.threshold, params.value, 30);
      return rsi[index] < threshold;
    }
    if (conditionId === 'rsi_cross_above') {
      const value = parseParamValue(params.value, 50);
      return prevCandle && rsi[index - 1] <= value && rsi[index] > value;
    }
    if (conditionId === 'rsi_cross_below') {
      const value = parseParamValue(params.value, 50);
      return prevCandle && rsi[index - 1] >= value && rsi[index] < value;
    }
    if (conditionId === 'rsi_oversold') {
      const value = parseParamValue(params.value, 30);
      return prevCandle && rsi[index - 1] <= value && rsi[index] > value;
    }
    if (conditionId === 'rsi_overbought') {
      const value = parseParamValue(params.value, 70);
      return prevCandle && rsi[index - 1] >= value && rsi[index] < value;
    }
    if (conditionId === 'rsi_in_range') {
      // RSI בתוך טווח [min, max]
      // הערה: משתמשים ב-parseParamValue כדי לתמוך גם ב-string של אופטימיזציה (min;max;step),
      // במקרה כזה ברירת המחדל תחול.
      let minVal = parseParamValue(params.min, 1);
      let maxVal = parseParamValue(params.max, 84);
      if (minVal > maxVal) {
        const tmp = minVal;
        minVal = maxVal;
        maxVal = tmp;
      }
      return rsi[index] >= minVal && rsi[index] <= maxVal;
    }
    if (conditionId === 'rsi_divergence_bullish') return false; // TODO: implement
    if (conditionId === 'rsi_divergence_bearish') return false; // TODO: implement
  }
  
  // MACD conditions
  if (conditionId.startsWith('macd_')) {
    const macd = getInd('macd', (d) => Indicators.calculateMACD(d, 12, 26, 9));
    if (!macd || !macd.macd || macd.macd[index] === null || (prevCandle && macd.macd[index - 1] === null)) return false;
    
    if (conditionId === 'macd_cross_above_signal') return prevCandle && macd.macd[index - 1] <= macd.signal[index - 1] && macd.macd[index] > macd.signal[index];
    if (conditionId === 'macd_cross_below_signal') return prevCandle && macd.macd[index - 1] >= macd.signal[index - 1] && macd.macd[index] < macd.signal[index];
    if (conditionId === 'macd_above') {
      const value = parseParamValue(params.value, 0);
      return macd.macd[index] > value;
    }
    if (conditionId === 'macd_below') {
      const value = parseParamValue(params.value, 0);
      return macd.macd[index] < value;
    }
    if (conditionId === 'macd_cross_above') {
      const value = parseParamValue(params.value, 0);
      return prevCandle && macd.macd[index - 1] <= value && macd.macd[index] > value;
    }
    if (conditionId === 'macd_cross_below') {
      const value = parseParamValue(params.value, 0);
      return prevCandle && macd.macd[index - 1] >= value && macd.macd[index] < value;
    }
    if (conditionId === 'macd_histogram_positive') return macd.histogram[index] > 0;
    if (conditionId === 'macd_histogram_negative') return macd.histogram[index] < 0;
  }
  
  // Moving Average conditions
  if (conditionId.startsWith('price_') || conditionId.startsWith('sma_') || conditionId.startsWith('ema_') || conditionId === 'daily_price_above_sma') {
    // Daily SMA condition - uses daily aggregated data (תואם לנינג'ה טריידר)
    if (conditionId === 'daily_price_above_sma') {
      const period = parseParamValue(params.period, 145);
      const cacheKey = `daily_sma_${period}`;
      
      // Aggregate data to daily bars up to current index (תואם לנינג'ה טריידר)
      // We need to recalculate daily data for each index to get current day's close correctly
      const dailyData = aggregateToDaily(data, index);
      
      if (dailyData.length < period) {
        return false; // Not enough daily bars
      }
      
      // Calculate SMA on daily data (uses close prices)
      const dailySMA = Indicators.calculateSMA(dailyData, period);
      
      // Find which daily bar corresponds to current candle
      const currentDate = new Date(candle.time * 1000);
      const currentDateStr = formatDateUTC(currentDate);
      
      // Find the daily bar index for current date (תואם לנינג'ה טריידר: Closes[1][0] = daily close of current day)
      const dailyBarIndex = dailyData.findIndex(d => d.date === currentDateStr);
      
      if (dailyBarIndex === -1 || dailySMA[dailyBarIndex] === null) {
        return false;
      }
      
      // Check if daily close is above daily SMA (תואם לנינג'ה טריידר: Closes[1][0] > dailySmaFilter[0])
      // Note: In NinjaTrader, this checks the daily close of the current day (even if day not closed yet)
      const dailyClose = dailyData[dailyBarIndex].close;
      const dailySMAValue = dailySMA[dailyBarIndex];
      
      return dailyClose > dailySMAValue;
    }
    
    // SMA conditions
    if (conditionId === 'price_above_sma' || conditionId === 'price_below_sma' || conditionId === 'price_cross_above_sma' || conditionId === 'price_cross_below_sma') {
      const period = parseParamValue(params.period, 20);
      const sma = getInd(`sma${period}`, (d) => Indicators.calculateSMA(d, period));
      if (!sma || sma[index] === null) return false;
      
      if (conditionId === 'price_above_sma') return candle.close > sma[index];
      if (conditionId === 'price_below_sma') return candle.close < sma[index];
      if (conditionId === 'price_cross_above_sma') return prevCandle && sma[index - 1] !== null && prevCandle.close <= sma[index - 1] && candle.close > sma[index];
      if (conditionId === 'price_cross_below_sma') return prevCandle && sma[index - 1] !== null && prevCandle.close >= sma[index - 1] && candle.close < sma[index];
    }
    
    // EMA conditions
    if (conditionId === 'price_above_ema' || conditionId === 'price_below_ema') {
      const period = parseParamValue(params.period, 20);
      const ema = getInd(`ema${period}`, (d) => Indicators.calculateEMA(d, period));
      if (!ema || ema[index] === null) return false;
      
      if (conditionId === 'price_above_ema') return candle.close > ema[index];
      if (conditionId === 'price_below_ema') return candle.close < ema[index];
    }
    
    // SMA cross conditions
    if (conditionId === 'sma_cross_above' || conditionId === 'sma_cross_below') {
      const period1 = parseParamValue(params.period1, 20);
      const period2 = parseParamValue(params.period2, 50);
      const sma1 = getInd(`sma${period1}`, (d) => Indicators.calculateSMA(d, period1));
      const sma2 = getInd(`sma${period2}`, (d) => Indicators.calculateSMA(d, period2));
      if (!sma1 || !sma2 || sma1[index] === null || sma2[index] === null || (prevCandle && (sma1[index - 1] === null || sma2[index - 1] === null))) return false;
      
    if (conditionId === 'sma_cross_above') return sma1[index - 1] <= sma2[index - 1] && sma1[index] > sma2[index];
    if (conditionId === 'sma_cross_below') return sma1[index - 1] >= sma2[index - 1] && sma1[index] < sma2[index];
  }

    // EMA cross conditions
    if (conditionId === 'ema_cross_above' || conditionId === 'ema_cross_below') {
      const period1 = parseParamValue(params.period1, 20);
      const period2 = parseParamValue(params.period2, 50);
      const ema1 = getInd(`ema${period1}`, (d) => Indicators.calculateEMA(d, period1));
      const ema2 = getInd(`ema${period2}`, (d) => Indicators.calculateEMA(d, period2));
      if (!ema1 || !ema2 || ema1[index] === null || ema2[index] === null || (prevCandle && (ema1[index - 1] === null || ema2[index - 1] === null))) return false;
      
      if (conditionId === 'ema_cross_above') return ema1[index - 1] <= ema2[index - 1] && ema1[index] > ema2[index];
      if (conditionId === 'ema_cross_below') return ema1[index - 1] >= ema2[index - 1] && ema1[index] < ema2[index];
    }
  }
  
  // Bollinger Bands conditions
  if (
    conditionId.startsWith('price_touch_') ||
    conditionId.startsWith('bb_') ||
    conditionId.startsWith('price_bounce_') ||
    conditionId === 'price_above_bb_upper' ||
    conditionId === 'price_below_bb_lower'
  ) {
    const period = parseParamValue(params.period, 20);
    const stdDev = parseParamValue(params.stdDev, 2);

    // BB מחזיר אובייקט {upper, middle, lower}, ולכן לא משתמשים ב-getInd (שמיושר למערכים).
    // כדי לשמור על אותו היגיון MTF ללא Lookahead, אם timeframe שונה מה-primary:
    // מחשבים BB על ה-HTF ומעריכים את התנאי על הבר ה-HTF האחרון שנסגר.
    const bbCacheKey = `bb_${period}_${stdDev}_${activeTF}`;
    let bb = indicatorCache[bbCacheKey];

    let bbCandle = candle;
    let bbPrevCandle = prevCandle;

    if (activeTF !== primaryTimeframe) {
      if (!rawData || rawData.length === 0) return false;
      const tfDataKey = `tfData_${activeTF}`;
      if (!indicatorCache[tfDataKey]) indicatorCache[tfDataKey] = processData(rawData, activeTF);
      const tfData = indicatorCache[tfDataKey];
      const tfIndex = getLastClosedSecondaryIndex(data, index, primaryTimeframe, tfData, activeTF, indicatorCache);
      if (tfIndex === -1) return false;

      if (!bb) {
        bb = Indicators.calculateBollingerBands(tfData, period, stdDev);
        indicatorCache[bbCacheKey] = bb;
      }

      bbCandle = tfData[tfIndex];
      bbPrevCandle = tfIndex > 0 ? tfData[tfIndex - 1] : null;

      if (!bb || !bb.upper || bb.upper[tfIndex] === null) return false;

      if (conditionId === 'price_touch_lower_bb') return bbCandle.low <= bb.lower[tfIndex];
      if (conditionId === 'price_touch_upper_bb') return bbCandle.high >= bb.upper[tfIndex];
      if (conditionId === 'price_bounce_lower_bb') return bbPrevCandle && bbCandle.low <= bb.lower[tfIndex] && bbCandle.close > bbPrevCandle.close;
      if (conditionId === 'price_bounce_upper_bb') return bbPrevCandle && bbCandle.high >= bb.upper[tfIndex] && bbCandle.close < bbPrevCandle.close;
      if (conditionId === 'price_above_bb_upper') return bbCandle.close > bb.upper[tfIndex];
      if (conditionId === 'price_below_bb_lower') return bbCandle.close < bb.lower[tfIndex];
      if (conditionId === 'bb_squeeze') {
        if (tfIndex < 1 || bb.upper[tfIndex - 1] === null || bb.lower[tfIndex - 1] === null) return false;
        const currentWidth = bb.upper[tfIndex] - bb.lower[tfIndex];
        const prevWidth = bb.upper[tfIndex - 1] - bb.lower[tfIndex - 1];
        return currentWidth < prevWidth * 0.9;
      }
      if (conditionId === 'bb_expansion') {
        if (tfIndex < 1 || bb.upper[tfIndex - 1] === null || bb.lower[tfIndex - 1] === null) return false;
        const currentWidth = bb.upper[tfIndex] - bb.lower[tfIndex];
        const prevWidth = bb.upper[tfIndex - 1] - bb.lower[tfIndex - 1];
        return currentWidth > prevWidth * 1.1;
      }

      return false;
    }

    // Primary timeframe
    if (!bb) {
      bb = Indicators.calculateBollingerBands(data, period, stdDev);
      indicatorCache[bbCacheKey] = bb;
    }
    if (!bb || !bb.upper || bb.upper[index] === null) return false;

    if (conditionId === 'price_touch_lower_bb') return bbCandle.low <= bb.lower[index];
    if (conditionId === 'price_touch_upper_bb') return bbCandle.high >= bb.upper[index];
    if (conditionId === 'price_bounce_lower_bb') return bbPrevCandle && bbCandle.low <= bb.lower[index] && bbCandle.close > bbPrevCandle.close;
    if (conditionId === 'price_bounce_upper_bb') return bbPrevCandle && bbCandle.high >= bb.upper[index] && bbCandle.close < bbPrevCandle.close;
    if (conditionId === 'price_above_bb_upper') return bbCandle.close > bb.upper[index];
    if (conditionId === 'price_below_bb_lower') return bbCandle.close < bb.lower[index];
    if (conditionId === 'bb_squeeze') {
      if (index < 1 || bb.upper[index - 1] === null || bb.lower[index - 1] === null) return false;
      const currentWidth = bb.upper[index] - bb.lower[index];
      const prevWidth = bb.upper[index - 1] - bb.lower[index - 1];
      return currentWidth < prevWidth * 0.9;
    }
    if (conditionId === 'bb_expansion') {
      if (index < 1 || bb.upper[index - 1] === null || bb.lower[index - 1] === null) return false;
      const currentWidth = bb.upper[index] - bb.lower[index];
      const prevWidth = bb.upper[index - 1] - bb.lower[index - 1];
      return currentWidth > prevWidth * 1.1;
    }
  }
  
  // Stochastic conditions
  if (conditionId.startsWith('stoch_')) {
    const stoch = indicators.stoch || Indicators.calculateStochastic(data, 14, 3, 3);
    if (!stoch || !stoch.k || stoch.k[index] === null || (prevCandle && stoch.k[index - 1] === null)) return false;
    
    if (conditionId === 'stoch_below') {
      const value = parseParamValue(params.value, 20);
      return stoch.k[index] < value;
    }
    if (conditionId === 'stoch_above') {
      const value = parseParamValue(params.value, 80);
      return stoch.k[index] > value;
    }
    if (conditionId === 'stoch_cross_above') {
      const value = parseParamValue(params.value, 20);
      return prevCandle && stoch.k[index - 1] <= value && stoch.k[index] > value;
    }
    if (conditionId === 'stoch_cross_below') {
      const value = parseParamValue(params.value, 80);
      return prevCandle && stoch.k[index - 1] >= value && stoch.k[index] < value;
    }
    if (conditionId === 'stoch_cross_above_signal') return prevCandle && stoch.d && stoch.d[index - 1] !== null && stoch.d[index] !== null && stoch.k[index - 1] <= stoch.d[index - 1] && stoch.k[index] > stoch.d[index];
    if (conditionId === 'stoch_cross_below_signal') return prevCandle && stoch.d && stoch.d[index - 1] !== null && stoch.d[index] !== null && stoch.k[index - 1] >= stoch.d[index - 1] && stoch.k[index] < stoch.d[index];
  }
  
  // Volume conditions
  if (conditionId.startsWith('volume_')) {
    // תמיכה ב-timeframe: אם זה HTF, בודקים על הבר האחרון שנסגר ב-HTF (ללא Lookahead)
    let volData = data;
    let volIndex = index;
    let volCandle = candle;
    let volPrevCandle = prevCandle;
    if (activeTF !== primaryTimeframe) {
      if (!rawData || rawData.length === 0) return false;
      const tfDataKey = `tfData_${activeTF}`;
      if (!indicatorCache[tfDataKey]) indicatorCache[tfDataKey] = processData(rawData, activeTF);
      volData = indicatorCache[tfDataKey];
      volIndex = getLastClosedSecondaryIndex(data, index, primaryTimeframe, volData, activeTF, indicatorCache);
      if (volIndex === -1) return false;
      volCandle = volData[volIndex];
      volPrevCandle = volIndex > 0 ? volData[volIndex - 1] : null;
    }

    if (conditionId === 'volume_above_avg_multiplier') {
      // Special handling: calculate average from previous bars only (not including current bar)
      // This matches NinjaTrader behavior: for (int i = 1; i <= BodySizeLookbackBars; i++)
      const period = parseParamValue(params.period, 10);
      const multiplier = parseParamValue(params.multiplier, 2.0);
      
      if (volIndex < period) return false;
      
      let totalVolume = 0;
      let validBars = 0;
      
      // Calculate average from bars 1 to period (not including current bar at index 0)
      for (let i = 1; i <= period && (volIndex - i) >= 0; i++) {
        const p = volData[volIndex - i];
        totalVolume += p.volume || 0;
        validBars++;
      }
      
      if (validBars === 0) return false;
      
      const averageVolume = totalVolume / validBars;
      const minRequiredVolume = averageVolume * multiplier;
      
      return volCandle.volume > minRequiredVolume;
    }
    
    if (conditionId === 'volume_above_avg' || conditionId === 'volume_spike' || conditionId === 'volume_profile_ratio' || conditionId === 'volume_price_confirmation') {
      const period = parseParamValue(params.period || params.lookback, 20);
      
      // NinjaTrader Compatibility: Calculate average volume using PREVIOUS bars only (not including current bar)
      if (volIndex < period) return false;
      
      let totalVolume = 0;
      for (let i = 1; i <= period; i++) {
        totalVolume += volData[volIndex - i].volume || 0;
      }
      const volumeAvg = totalVolume / period;
      
      if (conditionId === 'volume_above_avg') return volCandle.volume > volumeAvg;
      if (conditionId === 'volume_spike') {
        const multiplier = parseParamValue(params.multiplier, 2);
        return volCandle.volume >= volumeAvg * multiplier;
      }
      if (conditionId === 'volume_profile_ratio') {
        const multiplier = parseParamValue(params.minRatio, 0.7);
        return volCandle.volume >= volumeAvg * multiplier;
      }
      if (conditionId === 'volume_price_confirmation') return volCandle.close > (volPrevCandle?.close || 0) && volCandle.volume > volumeAvg;
    }
    if (conditionId === 'volume_decreasing') return volPrevCandle && volCandle.volume < volPrevCandle.volume;
  }
  
  // ATR conditions
  if (conditionId.startsWith('atr_') || conditionId === 'price_range_above_atr') {
    const period = parseParamValue(params.period, 14);
    const atr = getInd(`atr_${period}`, (d) => Indicators.calculateATR(d, period));
    if (!atr || atr[index] === null) return false;
    
    if (conditionId === 'atr_expansion') {
      if (index < 1 || atr[index - 1] === null) return false;
      return atr[index] > atr[index - 1] * 1.1;
    }
    if (conditionId === 'atr_contraction') {
      if (index < 1 || atr[index - 1] === null) return false;
      return atr[index] < atr[index - 1] * 0.9;
    }
    if (conditionId === 'atr_in_range') {
      let minVal = parseParamValue(params.min, 12);
      let maxVal = parseParamValue(params.max, 55);
      if (minVal > maxVal) {
        const tmp = minVal;
        minVal = maxVal;
        maxVal = tmp;
      }
      return atr[index] >= minVal && atr[index] <= maxVal;
    }
    if (conditionId === 'price_range_above_atr') {
      const range = candle.high - candle.low;
      // Compare current bar's range to PREVIOUS bar's ATR (כמו שהיה בקוד המקורי)
      if (index < 1 || atr[index - 1] === null) return false;
      return range > atr[index - 1];
    }
  }
  
  // ADX conditions
  if (conditionId.startsWith('adx_')) {
    const period = parseParamValue(params.period, 14);
    // תמיכה ב-MTF כמו שאר האינדיקטורים:
    // אם המשתמש בחר timeframe=5m למשל, מחשבים ADX על 5m ואז מיישרים ל-primary בלי lookahead.
    const adx = getInd(`adx_${period}`, (d) => Indicators.calculateADX(d, period));
    if (!adx || adx[index] === null) return false;
    
    if (conditionId === 'adx_above') {
      const threshold = parseParamValue((params.threshold ?? params.value), 25);
      return adx[index] > threshold;
    }
    if (conditionId === 'adx_below') {
      const threshold = parseParamValue((params.threshold ?? params.value), 20);
      return adx[index] < threshold;
    }
    if (conditionId === 'adx_rising') {
      if (index < 1 || adx[index - 1] === null) return false;
      return adx[index] > adx[index - 1];
    }
    if (conditionId === 'adx_falling') {
      if (index < 1 || adx[index - 1] === null) return false;
      return adx[index] < adx[index - 1];
    }
    if (conditionId === 'adx_range') {
      const min = parseParamValue(params.min, 16);
      const max = parseParamValue(params.max, 56);
      return adx[index] >= min && adx[index] <= max;
    }
    return false;
  }
  
  // Price Action conditions
  if (conditionId === 'green_candle') {
    // תמיכה ב-timeframe: אם זה HTF, בודקים על הבר האחרון שנסגר ב-HTF (ללא Lookahead)
    if (activeTF !== primaryTimeframe) {
      if (!rawData || rawData.length === 0) return false;
      const tfDataKey = `tfData_${activeTF}`;
      if (!indicatorCache[tfDataKey]) indicatorCache[tfDataKey] = processData(rawData, activeTF);
      const tfData = indicatorCache[tfDataKey];
      const tfIndex = getLastClosedSecondaryIndex(data, index, primaryTimeframe, tfData, activeTF, indicatorCache);
      if (tfIndex === -1) return false;
      return tfData[tfIndex].close > tfData[tfIndex].open;
    }
    return candle.close > candle.open;
  }

  if (conditionId === 'red_candle') {
    if (activeTF !== primaryTimeframe) {
      if (!rawData || rawData.length === 0) return false;
      const tfDataKey = `tfData_${activeTF}`;
      if (!indicatorCache[tfDataKey]) indicatorCache[tfDataKey] = processData(rawData, activeTF);
      const tfData = indicatorCache[tfDataKey];
      const tfIndex = getLastClosedSecondaryIndex(data, index, primaryTimeframe, tfData, activeTF, indicatorCache);
      if (tfIndex === -1) return false;
      return tfData[tfIndex].close < tfData[tfIndex].open;
    }
    return candle.close < candle.open;
  }

  if (conditionId === 'higher_high') {
    if (activeTF !== primaryTimeframe) {
      if (!rawData || rawData.length === 0) return false;
      const tfDataKey = `tfData_${activeTF}`;
      if (!indicatorCache[tfDataKey]) indicatorCache[tfDataKey] = processData(rawData, activeTF);
      const tfData = indicatorCache[tfDataKey];
      const tfIndex = getLastClosedSecondaryIndex(data, index, primaryTimeframe, tfData, activeTF, indicatorCache);
      if (tfIndex <= 0) return false;
      return tfData[tfIndex].high > tfData[tfIndex - 1].high;
    }
    if (index < 1) return false;
    return candle.high > data[index - 1].high;
  }

  if (conditionId === 'lower_low') {
    if (activeTF !== primaryTimeframe) {
      if (!rawData || rawData.length === 0) return false;
      const tfDataKey = `tfData_${activeTF}`;
      if (!indicatorCache[tfDataKey]) indicatorCache[tfDataKey] = processData(rawData, activeTF);
      const tfData = indicatorCache[tfDataKey];
      const tfIndex = getLastClosedSecondaryIndex(data, index, primaryTimeframe, tfData, activeTF, indicatorCache);
      if (tfIndex <= 0) return false;
      return tfData[tfIndex].low < tfData[tfIndex - 1].low;
    }
    if (index < 1) return false;
    return candle.low < data[index - 1].low;
  }
  
  if (conditionId === 'candle_body_min_ticks') {
    const minTicks = parseParamValue(params.minTicks, 34);
    // NinjaTrader Compatibility: Tick size 0.25 for NQ. Body SIZE = |Close-Open| (גם נר אדום)
    const bodyTicks = (o, c) => Math.abs(c - o) / 0.25;
    if (activeTF !== primaryTimeframe) {
      if (!rawData || rawData.length === 0) return false;
      const tfDataKey = `tfData_${activeTF}`;
      if (!indicatorCache[tfDataKey]) indicatorCache[tfDataKey] = processData(rawData, activeTF);
      const tfData = indicatorCache[tfDataKey];
      const tfIndex = getLastClosedSecondaryIndex(data, index, primaryTimeframe, tfData, activeTF, indicatorCache);
      if (tfIndex === -1) return false;
      const c = tfData[tfIndex];
      return bodyTicks(c.open, c.close) >= minTicks;
    }
    return bodyTicks(candle.open, candle.close) >= minTicks;
  }

  if (conditionId === 'min_red_candles') {
    const minCount = parseParamValue(params.minCount, 1);
    const lookback = parseParamValue(params.lookback, 10);
    
    // בחירת מסגרת הזמן הנכונה
    const activeTF = timeframe === 'DEF' || !timeframe ? primaryTimeframe : parseInt(timeframe);
    // אם זה timeframe אחר, משתמשים רק בבר ה-HTF האחרון שנסגר (ללא Lookahead)
    if (activeTF !== primaryTimeframe) {
      if (!rawData || rawData.length === 0) return false;
      const activeData = processData(rawData, activeTF);
      const activeIndex = getLastClosedSecondaryIndex(data, index, primaryTimeframe, activeData, activeTF, indicatorCache);
      if (activeIndex === -1 || activeIndex < lookback - 1) return false;

      let redCount = 0;
      for (let i = 0; i < lookback; i++) {
        const idx = activeIndex - i;
        if (idx >= 0 && activeData[idx].close < activeData[idx].open) redCount++;
      }
      return redCount >= minCount;
    }
    
    // Timeframe ראשי
    if (index < lookback - 1) return false;
    let redCount = 0;
    for (let i = 0; i < lookback; i++) {
      const idx = index - i;
      if (data[idx].close < data[idx].open) redCount++;
    }
    return redCount >= minCount;
  }

  if (conditionId === 'min_green_candles') {
    const minCount = parseParamValue(params.minCount, 6);
    const lookback = parseParamValue(params.lookback, 17);
    
    // בחירת מסגרת הזמן הנכונה
    const activeTF = timeframe === 'DEF' || !timeframe ? primaryTimeframe : parseInt(timeframe);
    // אם זה timeframe אחר, משתמשים רק בבר ה-HTF האחרון שנסגר (ללא Lookahead)
    if (activeTF !== primaryTimeframe) {
      if (!rawData || rawData.length === 0) return false;
      const activeData = processData(rawData, activeTF);
      const activeIndex = getLastClosedSecondaryIndex(data, index, primaryTimeframe, activeData, activeTF, indicatorCache);
      if (activeIndex === -1 || activeIndex < lookback - 1) return false;

      let greenCount = 0;
      for (let i = 0; i < lookback; i++) {
        const idx = activeIndex - i;
        if (idx >= 0 && activeData[idx].close > activeData[idx].open) greenCount++;
      }
      return greenCount >= minCount;
    }
    
    // Timeframe ראשי
    if (index < lookback - 1) return false;
    let greenCount = 0;
    for (let i = 0; i < lookback; i++) {
      const idx = index - i;
      if (data[idx].close > data[idx].open) greenCount++;
    }
    return greenCount >= minCount;
  }

  if (conditionId === 'bar_range_ticks') {
    const minTicks = parseParamValue(params.minTicks, 12);
    if (activeTF !== primaryTimeframe) {
      if (!rawData || rawData.length === 0) return false;
      const tfDataKey = `tfData_${activeTF}`;
      if (!indicatorCache[tfDataKey]) indicatorCache[tfDataKey] = processData(rawData, activeTF);
      const tfData = indicatorCache[tfDataKey];
      const tfIndex = getLastClosedSecondaryIndex(data, index, primaryTimeframe, tfData, activeTF, indicatorCache);
      if (tfIndex === -1) return false;
      const c = tfData[tfIndex];
      const rangeTicks = (c.high - c.low) / 0.25;
      return rangeTicks >= minTicks;
    }
    const rangeTicks = (candle.high - candle.low) / 0.25;
    return rangeTicks >= minTicks;
  }

  if (conditionId === 'bar_range_ticks_range') {
    const minTicks = parseParamValue(params.minTicks, 12);
    const maxTicks = parseParamValue(params.maxTicks, 300);
    if (activeTF !== primaryTimeframe) {
      if (!rawData || rawData.length === 0) return false;
      const tfDataKey = `tfData_${activeTF}`;
      if (!indicatorCache[tfDataKey]) indicatorCache[tfDataKey] = processData(rawData, activeTF);
      const tfData = indicatorCache[tfDataKey];
      const tfIndex = getLastClosedSecondaryIndex(data, index, primaryTimeframe, tfData, activeTF, indicatorCache);
      if (tfIndex === -1) return false;
      const c = tfData[tfIndex];
      const rangeTicks = (c.high - c.low) / 0.25;
      return rangeTicks >= minTicks && rangeTicks <= maxTicks;
    }
    const rangeTicks = (candle.high - candle.low) / 0.25;
    return rangeTicks >= minTicks && rangeTicks <= maxTicks;
  }

  if (conditionId === 'market_change_percent_range') {
    const minPercent = parseParamValue(params.minPercent, -2.1);
    const maxPercent = parseParamValue(params.maxPercent, 10);
    // Cache: חישוב פעם אחת לכל הנתונים (מניעת O(n²) – aggregateToDaily לכל בר)
    const cacheKey = 'market_change_prior_closes';
    if (!indicatorCache[cacheKey]) {
      const dailyData = aggregateToDaily(data);
      const priorByDate = {};
      for (let i = 1; i < dailyData.length; i++) {
        priorByDate[dailyData[i].date] = dailyData[i - 1].close;
      }
      indicatorCache[cacheKey] = priorByDate;
    }
    const priorByDate = indicatorCache[cacheKey];
    const date = new Date(candle.time * 1000);
    const currentDateStr = formatDateUTC(date);
    const priorClose = priorByDate[currentDateStr];
    if (priorClose == null || priorClose <= 0) return true; // אין יום קודם – לא מסננים
    const dailyChangePercent = (candle.close - priorClose) / priorClose * 100.0;
    return dailyChangePercent >= minPercent && dailyChangePercent <= maxPercent;
  }

  if (conditionId === 'candle_body_size_above_avg') {
    const lookback = parseParamValue(params.lookback, 10);
    const multiplier = parseParamValue(params.multiplier, 1.7);
    
    if (index < lookback) return false;
    
    const currentBodySize = Math.abs(candle.close - candle.open);
    let totalBodySize = 0;
    let validBars = 0;
    
    for (let i = 1; i <= lookback && (index - i) >= 0; i++) {
      const prevCandle = data[index - i];
      const bodySize = Math.abs(prevCandle.close - prevCandle.open);
      totalBodySize += bodySize;
      validBars++;
    }
    
    if (validBars === 0) return false;
    
    const averageBodySize = totalBodySize / validBars;
    const minRequiredBodySize = averageBodySize * multiplier;
    
    return currentBodySize >= minRequiredBodySize;
  }
  
  if (conditionId === 'close_position_in_range') {
    const closePositionPercent = parseParamValue(params.closePositionPercent, 0.35);
    const candleRange = candle.high - candle.low;
    if (candleRange <= 0) return false;
    
    const closePositionFromLow = candle.close - candle.low;
    const closePositionPercentActual = closePositionFromLow / candleRange;
    const minClosePosition = 1.0 - closePositionPercent;
    
    return closePositionPercentActual >= minClosePosition;
  }
  
  // CCI conditions
  if (conditionId.startsWith('cci_')) {
    // CCI calculation would need to be added to indicators.js
    // For now, return false
    return false;
  }
  
  // Williams %R conditions
  if (conditionId.startsWith('willr_')) {
    // Williams %R calculation would need to be added to indicators.js
    // For now, return false
    return false;
  }
  
  // Session close exit - exit if next candle has 60+ minute gap
  if (conditionId === 'session_close_exit') {
    if (index >= data.length - 1) return true; // Last candle, exit
    const nextCandle = data[index + 1];
    const currentCandleTime = candle.time * 1000;
    const nextCandleTime = nextCandle.time * 1000;
    const timeDiffMinutes = (nextCandleTime - currentCandleTime) / (1000 * 60);
    // If gap is 60+ minutes, this is session close - exit
    return timeDiffMinutes >= 60;
  }
  
  return false;
};

// --- עזר לסנכרון אינדיקטורים/תנאים בין Timeframes (ללא Lookahead) ---
// העיקרון: על primary bar בזמן i מותר להשתמש רק בערך של ה-secondary bar האחרון ש*נסגר*
// עד סגירת ה-primary bar (כמו NinjaTrader: HTF מתעדכן רק בסגירת הבר שלו).
const computeCloseTimes = (data, timeframeMinutes) => {
  const n = data?.length || 0;
  const closeTimes = new Array(n);

  for (let i = 0; i < n; i++) {
    const t = data[i]?.time;
    // IMPORTANT:
    // In our system (and like NinjaTrader for Close-time bars), `time` is already the bar CLOSE time.
    // So the close time of bar i is simply data[i].time.
    closeTimes[i] = typeof t === 'number' ? t : null;
  }

  return closeTimes;
};

const getLastClosedSecondaryIndex = (primaryData, primaryIndex, primaryTF, secondaryData, secondaryTF, cache = null) => {
  if (!primaryData?.length || !secondaryData?.length) return -1;
  if (primaryIndex < 0 || primaryIndex >= primaryData.length) return -1;

  const getCachedCloseTimes = (prefix, data, tf) => {
    if (!cache) return computeCloseTimes(data, tf);
    const firstTime = data?.[0]?.time ?? 'x';
    const lastTime = data?.[data.length - 1]?.time ?? 'y';
    const key = `close_${prefix}_${tf}_${data.length}_${firstTime}_${lastTime}`;
    if (!cache[key]) cache[key] = computeCloseTimes(data, tf);
    return cache[key];
  };

  const primaryCloseTimes = getCachedCloseTimes('primary', primaryData, primaryTF);
  const secondaryCloseTimes = getCachedCloseTimes('secondary', secondaryData, secondaryTF);
  const targetCloseTime = primaryCloseTimes[primaryIndex];

  // מצא את ה-secondary האחרון שנסגר עד targetCloseTime
  // (לינארי זה מספיק כאן כי משתמשים בזה נקודתית בתנאים ספורים)
  let idx = -1;
  for (let j = 0; j < secondaryCloseTimes.length; j++) {
    if (secondaryCloseTimes[j] <= targetCloseTime) idx = j;
    else break;
  }
  return idx;
};

const alignIndicatorToPrimary = (primaryData, primaryTF, secondaryData, secondaryTF, secondaryValues) => {
  if (!primaryData?.length) return [];
  if (!secondaryValues || secondaryValues.length === 0) return primaryData.map(() => null);
  if (!secondaryData?.length) return primaryData.map(() => null);

  const primaryCloseTimes = computeCloseTimes(primaryData, primaryTF);
  const secondaryCloseTimes = computeCloseTimes(secondaryData, secondaryTF);

  const aligned = new Array(primaryData.length).fill(null);
  let secondaryIdx = -1;

  for (let i = 0; i < primaryData.length; i++) {
    const targetCloseTime = primaryCloseTimes[i];

    while (
      secondaryIdx + 1 < secondaryCloseTimes.length &&
      secondaryCloseTimes[secondaryIdx + 1] <= targetCloseTime
    ) {
      secondaryIdx++;
    }

    aligned[i] = secondaryIdx >= 0 ? secondaryValues[secondaryIdx] : null;
  }

  return aligned;
};

// --- חישוב כל האינדיקטורים ---
const calculateAllIndicators = (data, rawData = [], strategyConfig = null, primaryTimeframe = 1) => {
  const indicators = {};
  
  if (!strategyConfig) return indicators;

  const allConditions = [
    ...(strategyConfig.entryConditions || []),
    ...(strategyConfig.exitConditions || [])
  ];

  allConditions.forEach(condition => {
    if (!condition.id) return;
    
    const tf = parseInt(condition.timeframe) || primaryTimeframe;
    const tfKey = tf === primaryTimeframe ? 'DEF' : `tf_${tf}`;
    const id = condition.id;
    const params = condition.params || {};

    if (!indicators[tfKey]) {
      indicators[tfKey] = {};
    }

    const currentData = tf === primaryTimeframe ? data : processData(rawData, tf);

    // RSI
    if (id.startsWith('rsi_')) {
      const period = params.period || 14;
      const key = `rsi_${period}`;
      if (!indicators[tfKey][key]) {
        const values = Indicators.calculateRSI(currentData, period);
        indicators[tfKey][key] = tf === primaryTimeframe ? values : alignIndicatorToPrimary(data, primaryTimeframe, currentData, tf, values);
      }
    }

    // MACD
    if (id.startsWith('macd_')) {
      const fast = params.fast || 12;
      const slow = params.slow || 26;
      const signal = params.signal || 9;
      const key = `macd_${fast}_${slow}_${signal}`;
      if (!indicators[tfKey][key]) {
        const values = Indicators.calculateMACD(currentData, fast, slow, signal);
        indicators[tfKey][key] = {
          macd: tf === primaryTimeframe ? values.macd : alignIndicatorToPrimary(data, primaryTimeframe, currentData, tf, values.macd),
          signal: tf === primaryTimeframe ? values.signal : alignIndicatorToPrimary(data, primaryTimeframe, currentData, tf, values.signal),
          histogram: tf === primaryTimeframe ? values.histogram : alignIndicatorToPrimary(data, primaryTimeframe, currentData, tf, values.histogram),
        };
      }
    }

    // SMA
    if (id.includes('sma')) {
      const period = params.period || (id.includes('sma20') ? 20 : (id.includes('sma50') ? 50 : 20));
      const key = `sma_${period}`;
      if (!indicators[tfKey][key]) {
        const values = Indicators.calculateSMA(currentData, period);
        indicators[tfKey][key] = tf === primaryTimeframe ? values : alignIndicatorToPrimary(data, primaryTimeframe, currentData, tf, values);
      }
    }

    // EMA
    if (id.includes('ema')) {
      const period = params.period || (id.includes('ema20') ? 20 : (id.includes('ema50') ? 50 : 20));
      const key = `ema_${period}`;
      if (!indicators[tfKey][key]) {
        const values = Indicators.calculateEMA(currentData, period);
        indicators[tfKey][key] = tf === primaryTimeframe ? values : alignIndicatorToPrimary(data, primaryTimeframe, currentData, tf, values);
      }
    }

    // BB
    if (id.startsWith('price_touch_') || id.startsWith('bb_')) {
      const period = params.period || 20;
      const stdDev = params.stdDev || 2;
      const key = `bb_${period}_${stdDev}`;
      if (!indicators[tfKey][key]) {
        const values = Indicators.calculateBollingerBands(currentData, period, stdDev);
        indicators[tfKey][key] = {
          upper: tf === primaryTimeframe ? values.upper : alignIndicatorToPrimary(data, primaryTimeframe, currentData, tf, values.upper),
          middle: tf === primaryTimeframe ? values.middle : alignIndicatorToPrimary(data, primaryTimeframe, currentData, tf, values.middle),
          lower: tf === primaryTimeframe ? values.lower : alignIndicatorToPrimary(data, primaryTimeframe, currentData, tf, values.lower),
        };
      }
    }

    // Stochastic
    if (id.startsWith('stoch_')) {
      const k = params.kPeriod || 14;
      const d = params.dPeriod || 3;
      const key = `stoch_${k}_${d}`;
      if (!indicators[tfKey][key]) {
        const values = Indicators.calculateStochastic(currentData, k, d, 3);
        indicators[tfKey][key] = {
          k: tf === primaryTimeframe ? values.k : alignIndicatorToPrimary(data, primaryTimeframe, currentData, tf, values.k),
          d: tf === primaryTimeframe ? values.d : alignIndicatorToPrimary(data, primaryTimeframe, currentData, tf, values.d),
        };
      }
    }

    // Volume Avg
    if (id.startsWith('volume_')) {
      const period = params.period || 20;
      const key = `vol_avg_${period}`;
      if (!indicators[tfKey][key]) {
        const values = Indicators.calculateVolumeAverage(currentData, period);
        indicators[tfKey][key] = tf === primaryTimeframe ? values : alignIndicatorToPrimary(data, primaryTimeframe, currentData, tf, values);
      }
    }

    // ADX
    if (id.startsWith('adx_')) {
      const period = params.period || 14;
      const key = `adx_${period}`;
      if (!indicators[tfKey][key]) {
        const values = Indicators.calculateADX(currentData, period);
        indicators[tfKey][key] = tf === primaryTimeframe ? values : alignIndicatorToPrimary(data, primaryTimeframe, currentData, tf, values);
      }
    }
  });

  // Compatibility for older code (flatten primary TF)
  if (indicators.DEF) {
    Object.assign(indicators, indicators.DEF);
  }

  return indicators;
};

// --- מנוע ה-Backtest ---
const runBacktest = (data, entryConditions, exitConditions, rawData = [], strategyConfig = null, primaryTimeframe = 1) => {
  const trades = [];
  let currentTrade = null;
  
  // חישוב אינדיקטורים - תומך ב-Multi-Timeframe
  const indicators = calculateAllIndicators(data, rawData, strategyConfig, primaryTimeframe);
  
  // Cache לנתוני Timeframes שונים ואינדיקטורים דינמיים
  const tfDataCache = { [primaryTimeframe]: data };
  const backtestIndicatorCache = {};
  
  const getMTFIndicator = (tf, calcFn, cacheKey) => {
    const fullCacheKey = `tf_${tf}_${cacheKey}`;
    if (backtestIndicatorCache[fullCacheKey]) return backtestIndicatorCache[fullCacheKey];
    
    // אם זה ה-Timeframe הראשי, משתמשים בנתונים הקיימים
    if (tf === primaryTimeframe || !tf || tf === 'DEF') {
      const result = calcFn(data);
      backtestIndicatorCache[fullCacheKey] = result;
      return result;
    }
    
    // אם זה Timeframe אחר, מעבדים נתונים ומסנכרנים
    if (!tfDataCache[tf]) {
      tfDataCache[tf] = processData(rawData, tf);
    }
    
    const secondaryData = tfDataCache[tf];
    const secondaryValues = calcFn(secondaryData);
    const aligned = alignIndicatorToPrimary(data, primaryTimeframe, secondaryData, tf, secondaryValues);
    
    backtestIndicatorCache[fullCacheKey] = aligned;
    return aligned;
  };

  // Helper function to calculate ATR
  const getATR = (period, tf = null) => {
    return getMTFIndicator(tf || primaryTimeframe, (d) => Indicators.calculateATR(d, period), `atr_${period}`);
  };
  
  // Helper function to calculate initial stop loss
  const calculateInitialStopLoss = (entryIndex, entryPrice, exitConditions) => {
    const stopCondition = exitConditions.find(c => c.id === 'stop_loss_lowest_low_atr' && c.enabled !== false);
    if (!stopCondition) return null;
    
    const lookback = stopCondition.params?.lookback || 2;
    const atrPeriod = stopCondition.params?.atrPeriod || 14;
    const atrMultiplier = stopCondition.params?.atrMultiplier || 1.5;
    
    // Find session start by looking for gap of 60+ minutes
    let sessionStartIndex = 0;
    const entryDate = new Date(data[entryIndex].time * 1000).toDateString();
    
    // Look backwards to find session start (gap of 60+ minutes indicates session boundary)
    for (let i = entryIndex - 1; i >= 0 && i >= entryIndex - 500; i--) {
      if (i === 0) {
        sessionStartIndex = 0;
        break;
      }
      
      const currentTime = data[i].time * 1000;
      const prevTime = data[i - 1].time * 1000;
      const timeDiffMinutes = (currentTime - prevTime) / (1000 * 60);
      
      // If gap is 60+ minutes, this is session boundary
      if (timeDiffMinutes >= 60) {
        sessionStartIndex = i;
        break;
      }
      
      // Also check if we crossed to previous day
      const currentDate = new Date(currentTime).toDateString();
      if (currentDate !== entryDate) {
        sessionStartIndex = i + 1;
        break;
      }
    }
    
    // Calculate effective lookback (min of requested lookback and bars from session start)
    const barsFromSessionStart = entryIndex - sessionStartIndex;
    const effectiveLookback = Math.min(lookback, barsFromSessionStart);
    
    if (effectiveLookback === 0) return null;
    
    // Find lowest low in effective lookback bars (only from current session)
    let lowestLow = Infinity;
    const startIdx = Math.max(sessionStartIndex, entryIndex - effectiveLookback);
    for (let j = startIdx; j < entryIndex; j++) {
      if (data[j].low < lowestLow) {
        lowestLow = data[j].low;
      }
    }
    
    if (lowestLow === Infinity) return null;
    
    const atr = getATR(atrPeriod);
    if (!atr || atr[entryIndex] === null) return null;
    
    let stopPrice = lowestLow - (atr[entryIndex] * atrMultiplier);
    
    // Apply stop limits
    const limitsCondition = exitConditions.find(c => c.id === 'stop_loss_limits' && c.enabled !== false);
    if (limitsCondition) {
      const minTicks = limitsCondition.params?.minTicks || 50;
      const maxTicks = limitsCondition.params?.maxTicks || 130;
      const emergencyTicks = limitsCondition.params?.emergencyTicks || 10;
      const tickSize = 0.25; // NQ tick size
      
      // If stop is above entry, use emergency stop
      if (stopPrice >= entryPrice) {
        stopPrice = entryPrice - (emergencyTicks * tickSize);
      } else {
        const stopDistance = entryPrice - stopPrice;
        const stopDistanceTicks = stopDistance / tickSize;
        
        if (stopDistanceTicks > maxTicks) {
          stopPrice = entryPrice - (maxTicks * tickSize);
        } else if (limitsCondition.params?.enableMinStopLoss && stopDistanceTicks < minTicks) {
          stopPrice = entryPrice - (minTicks * tickSize);
        }
      }
    }
    
    return stopPrice;
  };
  
  // Helper function to update trailing stop
  const updateTrailingStop = (currentTrade, candle, exitConditions, currentIndex) => {
    // 1) Trailing Stop לפי טיקים (כמו בתפריט CONDITIONS: trailing_stop_ticks)
    const ticksCondition = exitConditions.find(c => c.id === 'trailing_stop_ticks' && c.enabled !== false);
    if (ticksCondition) {
      const triggerTicks = ticksCondition.params?.triggerTicks ?? 100;
      const distanceTicks = ticksCondition.params?.distanceTicks ?? 80;
      const tickSize = 0.25;

      const triggerPrice = currentTrade.entryPrice + (triggerTicks * tickSize);
      if (currentTrade.maxHigh >= triggerPrice) {
        const newStopPrice = currentTrade.maxHigh - (distanceTicks * tickSize);
        if (currentTrade.currentStopPrice === 0 || newStopPrice > currentTrade.currentStopPrice) {
          return newStopPrice;
        }
      }

      return currentTrade.currentStopPrice || 0;
    }

    // 2) Trailing Stop לפי ATR (תמיכה לאחור בקונפיג ישן)
    const triggerCondition = exitConditions.find(c => c.id === 'trailing_stop_trigger' && c.enabled !== false);
    const distanceCondition = exitConditions.find(c => c.id === 'trailing_stop_distance' && c.enabled !== false);
    
    if (!triggerCondition || !distanceCondition) return currentTrade.currentStopPrice || 0;
    
    const atrPeriod = triggerCondition.params?.atrPeriod || 14;
    const triggerMultiplier = triggerCondition.params?.triggerATRMultiplier || 3.6;
    const distanceMultiplier = distanceCondition.params?.distanceATRMultiplier || 3.1;
    
    const atr = getATR(atrPeriod);
    // Use ATR from entry index for consistency (like NinjaTrader)
    const atrValue = atr && atr[currentTrade.entryIndex] !== null ? atr[currentTrade.entryIndex] : null;
    if (!atrValue) return currentTrade.currentStopPrice || 0;
    
    const triggerPrice = currentTrade.entryPrice + (atrValue * triggerMultiplier);
    
    // Check if trailing stop should be activated
    if (currentTrade.maxHigh >= triggerPrice) {
      // Calculate new trailing stop
      const newStopPrice = currentTrade.maxHigh - (atrValue * distanceMultiplier);
      
      // Only move stop up, never down (or set initial trailing stop)
      if (currentTrade.currentStopPrice === 0 || newStopPrice > currentTrade.currentStopPrice) {
        return newStopPrice;
      }
    }
    
    return currentTrade.currentStopPrice || 0;
  };

  for (let i = 1; i < data.length; i++) {
    const candle = data[i];
    const prevCandle = data[i - 1];
    const nextCandle = i < data.length - 1 ? data[i + 1] : candle;

    // 1. בדיקת יציאה בתוך הנר (Intrabar) - אם אנחנו בעסקה
    if (currentTrade && i >= currentTrade.entryIndex) {
      // Update maximum favorable excursion (highest price reached)
      if (candle.high > currentTrade.maxHigh) {
        currentTrade.maxHigh = candle.high;
      }
      // Update maximum adverse excursion (lowest price reached)
      if (candle.low < currentTrade.minLow) {
        currentTrade.minLow = candle.low;
      }
      
      // Update trailing stop
      const newStopPrice = updateTrailingStop(currentTrade, candle, exitConditions, i);
      if (newStopPrice > 0) {
        if (currentTrade.currentStopPrice === 0 || newStopPrice > currentTrade.currentStopPrice) {
          currentTrade.currentStopPrice = newStopPrice;
          currentTrade.trailingStopActive = true;
        }
      }
      
      const tickSize = 0.25;
      const slTicksCond = exitConditions.find(c => c.id === 'stop_loss_ticks' && c.enabled !== false);
      const tpTicksCond = exitConditions.find(c => c.id === 'take_profit_ticks' && c.enabled !== false);
      const atrExitCond = exitConditions.find(c => c.id === 'atr_exit_down' && c.enabled !== false);
      
      let intrabarExitPrice = null;
      let exitReason = '';

      // בדיקת Stop Loss רגיל (Ticks/Trailing) - intrabar
      const slTicksPrice = slTicksCond ? currentTrade.entryPrice - (slTicksCond.params?.ticks * tickSize) : 0;
      const effectiveSL = Math.max(slTicksPrice, currentTrade.currentStopPrice || 0);
      if (effectiveSL > 0 && candle.low <= effectiveSL) {
          // NinjaTrader-style gap handling:
          // אם נר נפתח מתחת לסטופ (Gap down דרך הסטופ), היציאה תהיה ב-open (המחיר הזמין הראשון),
          // ולא במחיר הסטופ (שזה אופטימי מדי).
          const isGapThroughStop = candle.open <= effectiveSL;
          intrabarExitPrice = isGapThroughStop ? candle.open : effectiveSL;
          const baseReason = (currentTrade.trailingStopActive && effectiveSL === currentTrade.currentStopPrice) ? 'Trailing Stop' : 'Stop Loss';
          exitReason = isGapThroughStop ? `${baseReason} (Gap)` : baseReason;
      }
      
      // בדיקת טייק פרופיט (רק אם לא יצאנו ב-Stop)
      // NinjaTrader-style: נדרש טיק אחד לפחות מעל היעד - high > tpPrice
      // Gap up: פתיחה מעל TP → מילאנו ב-open (רווח מלא, לא מוגבל ל-TP – כמו SL בגאפ)
      if (!intrabarExitPrice && tpTicksCond) {
          const tpPrice = currentTrade.entryPrice + (tpTicksCond.params?.ticks * tickSize);
          if (candle.high > tpPrice) {
              const isGapThroughTP = candle.open >= tpPrice;
              intrabarExitPrice = isGapThroughTP ? candle.open : tpPrice;
              exitReason = isGapThroughTP ? 'Take Profit (Gap)' : 'Take Profit';
          }
      }

      if (intrabarExitPrice !== null) {
        const exitPrice = intrabarExitPrice;
        const points = exitPrice - currentTrade.entryPrice;
        const pnl = points * 20;
        const exitTime = Math.max(candle.time, currentTrade.entryTime);

        trades.push({
          ...currentTrade,
          id: trades.length + 1,
          exitTime: exitTime,
          exitPrice: exitPrice,
          exitIndex: i,
          points: points,
          pnl: pnl,
          mae: (currentTrade.entryPrice - currentTrade.minLow) * 20,
          mfe: (currentTrade.maxHigh - currentTrade.entryPrice) * 20,
          etd: pnl < 0 ? Math.abs(pnl) : 0,
          bars: i - currentTrade.entryIndex + 1,
          exitReason: exitReason
        });
        
        currentTrade = null;
        // לא עושים continue, כדי לאפשר בדיקת כניסה חדשה באותו נר!
      }
    }

    // 2. בדיקת יציאה לפי תנאים רגילים (סגירת נר)
    if (currentTrade && exitConditions && exitConditions.length > 0) {
      // בדיקת ATR Exit Down (כמו NinjaTrader: בודק Close בסגירת הבר)
      const atrExitCond = exitConditions.find(c => c.id === 'atr_exit_down' && c.enabled !== false);
      if (atrExitCond && i >= currentTrade.entryIndex) {
        const atrPeriod = atrExitCond.params?.period || 14;
        const atrMultiplier = atrExitCond.params?.multiplier || 1.0;
        const atr = getATR(atrPeriod);
        
        // Use current ATR (like NinjaTrader: atrExit[0])
        const currentATR = atr && atr[i] !== null && atr[i] !== undefined ? atr[i] : null;
        if (currentATR) {
          // מחיר יציאה = entryPrice - (multiplier * ATR) - כמו NinjaTrader
          const atrExitPrice = currentTrade.entryPrice - (atrMultiplier * currentATR);
          
          // כמו NinjaTrader: Close[0] <= stopLossPrice (בודק Close בסגירת הבר)
          if (candle.close <= atrExitPrice) {
            const points = candle.close - currentTrade.entryPrice;
            const pnl = points * 20;
            
            trades.push({
              ...currentTrade,
              id: trades.length + 1,
              exitTime: candle.time,
              exitPrice: candle.close,
              exitIndex: i,
              points: points,
              pnl: pnl,
              mae: (currentTrade.entryPrice - currentTrade.minLow) * 20,
              mfe: (currentTrade.maxHigh - currentTrade.entryPrice) * 20,
              etd: pnl < 0 ? Math.abs(pnl) : 0,
              bars: i - currentTrade.entryIndex + 1,
              exitReason: 'ATR Exit'
            });
            
            currentTrade = null;
          }
        }
      }
      
      // בדיקת ATR Exit Up (Take Profit - הפוך מ-ATR Exit Down)
      if (currentTrade) {
        const atrExitUpCond = exitConditions.find(c => c.id === 'atr_exit_up' && c.enabled !== false);
        if (atrExitUpCond && i >= currentTrade.entryIndex) {
          const atrPeriod = atrExitUpCond.params?.period || 14;
          const atrMultiplier = atrExitUpCond.params?.multiplier || 1.0;
          const atr = getATR(atrPeriod);
          
          // Use current ATR (like NinjaTrader)
          const currentATR = atr && atr[i] !== null && atr[i] !== undefined ? atr[i] : null;
          if (currentATR) {
            // מחיר יציאה = entryPrice + (multiplier * ATR) - הפוך מ-ATR Exit Down
            const atrExitUpPrice = currentTrade.entryPrice + (atrMultiplier * currentATR);
            
            // בודק Close >= takeProfitPrice (הפוך מ-ATR Exit Down)
            if (candle.close >= atrExitUpPrice) {
              const points = candle.close - currentTrade.entryPrice;
              const pnl = points * 20;
              
              trades.push({
                ...currentTrade,
                id: trades.length + 1,
                exitTime: candle.time,
                exitPrice: candle.close,
                exitIndex: i,
                points: points,
                pnl: pnl,
                mae: (currentTrade.entryPrice - currentTrade.minLow) * 20,
                mfe: (currentTrade.maxHigh - currentTrade.entryPrice) * 20,
                etd: pnl < 0 ? Math.abs(pnl) : 0,
                bars: i - currentTrade.entryIndex + 1,
                exitReason: 'ATR Take Profit'
              });
              
              currentTrade = null;
            }
          }
        }
      }
      
      const nonStopConditions = exitConditions.filter(c => {
        const stopConditions = [
          'stop_loss_lowest_low_atr',
          'trailing_stop_trigger',
          'trailing_stop_distance',
          'trailing_stop_ticks',
          'stop_loss_limits',
          'stop_loss_ticks',
          'take_profit_ticks',
          'atr_exit_down',
          'atr_exit_up'
        ];
        return !stopConditions.includes(c.id);
      });
      
      let triggeringCondition = null;
      const shouldExit = nonStopConditions.length > 0 && nonStopConditions.some(condition => {
        if (!condition.id || condition.enabled === false) return false;
        const isTriggered = checkCondition(condition.id, data, i, indicators, condition.params || {}, backtestIndicatorCache, condition.timeframe, rawData, primaryTimeframe);
        if (isTriggered) {
          triggeringCondition = condition;
          return true;
        }
        return false;
      });
      
      if (shouldExit && currentTrade) {
        const isSessionCloseExit = triggeringCondition?.id === 'session_close_exit';
        const exitPrice = isSessionCloseExit ? candle.close : nextCandle.open;
        const exitTime = isSessionCloseExit ? candle.time : nextCandle.time;
        const exitIndex = isSessionCloseExit ? i : i + 1;
        
        const points = exitPrice - currentTrade.entryPrice;
        const pnl = points * 20;

        // Get condition name for exit reason
        const conditionInfo = triggeringCondition ? getConditionById(triggeringCondition.id) : null;
        const exitReason = conditionInfo ? conditionInfo.name : (triggeringCondition?.id || 'Condition');
        
        trades.push({
          ...currentTrade,
          id: trades.length + 1,
          exitTime: exitTime,
          exitPrice: exitPrice,
          exitIndex: exitIndex,
          points: points,
          pnl: pnl,
          mae: (currentTrade.entryPrice - currentTrade.minLow) * 20,
          mfe: (currentTrade.maxHigh - currentTrade.entryPrice) * 20,
          etd: pnl < 0 ? Math.abs(pnl) : 0,
          bars: exitIndex - currentTrade.entryIndex + 1,
          exitReason: exitReason
        });
        
        currentTrade = null;
      }
    }

    // 3. בדיקת כניסה חדשה (גם אם בדיוק יצאנו מעסקה באותו נר!)
    if (!currentTrade && entryConditions && entryConditions.length > 0) {
      // בדיקה אם הנר הבא הוא תחילת סשן חדש (פער של 60+ דקות)
      const currentCandleTime = candle.time * 1000; // Convert to milliseconds
      const nextCandleTime = nextCandle.time * 1000;
      const timeDiffMinutes = (nextCandleTime - currentCandleTime) / (1000 * 60);
      const isNewSessionStart = timeDiffMinutes >= 60;
      
      // אם הנר הבא הוא תחילת סשן חדש - לא נאפשר כניסה
      if (!isNewSessionStart) {
        const shouldEnter = entryConditions.every(condition => {
          if (!condition.id) return false;
          if (condition.enabled === false) return true;
          return checkCondition(condition.id, data, i, indicators, condition.params || {}, backtestIndicatorCache, condition.timeframe, rawData, primaryTimeframe);
        });
        
        if (shouldEnter) {
          const entryPrice = nextCandle.open;
          const initialStopPrice = calculateInitialStopLoss(i + 1, entryPrice, exitConditions);
          
          currentTrade = {
            entryTime: nextCandle.time,
            entryPrice: entryPrice, 
            entryIndex: i + 1,
            type: 'LONG',
            dateStr: new Date(nextCandle.time * 1000).toLocaleDateString('en-GB', { timeZone: 'UTC' }),
            maxHigh: nextCandle.high,
            minLow: nextCandle.low,
            currentStopPrice: initialStopPrice || 0,
            trailingStopActive: false
          };
        }
      }
    }
  }

  return {
      trades,
      stats: calculateStats(trades)
  };
};

// --- יצירת קווי עסקה (עם נתקים) ---
const generateTradeLinesData = (trades, allCandles) => {
    const lineData = [];
    let candleIdx = 0;

    trades.forEach((trade) => {
        lineData.push({ time: trade.entryTime, value: trade.entryPrice });
        lineData.push({ time: trade.exitTime, value: trade.exitPrice });

        // קידום האינדקס עד אחרי היציאה
        while (candleIdx < allCandles.length && allCandles[candleIdx].time <= trade.exitTime) {
            candleIdx++;
        }
        
        // יצירת נתק (Gap) באמצעות NaN
        if (candleIdx < allCandles.length) {
             const nextCandleTime = allCandles[candleIdx].time;
             lineData.push({ time: nextCandleTime, value: NaN });
        }
    });

    const uniqueMap = new Map();
    lineData.forEach(p => {
        if (!uniqueMap.has(p.time) || !isNaN(p.value)) {
            uniqueMap.set(p.time, p);
        }
    });

    return Array.from(uniqueMap.values()).sort((a,b) => a.time - b.time);
};


// --- האפליקציה הראשית ---
export default function App() {
  const chartContainerRef = useRef(null);
  const secondaryChartContainerRef = useRef(null);
  const chartInstance = useRef(null);
  const secondaryChartInstance = useRef(null);
  const candleSeriesRef = useRef(null);
  const candleSeriesMarkersRef = useRef(null);
  const secondaryCandleSeriesRef = useRef(null);
  const executionSeriesRef = useRef(null);
  const volumeSeriesRef = useRef(null);
  const secondaryVolumeSeriesRef = useRef(null);
  const tradeLineSeriesRef = useRef(null);
  const indicatorSeriesRef = useRef({}); // אחסון series של אינדיקטורים
  const sidebarScrollRef = useRef(null); // Ref לפאנל הצידי לגלילה אוטומטית
  const importInputRef = useRef(null);
  
  const [rawData, setRawData] = useState([]);
  // הנתונים אחרי פילטרים (שנים / RTH / early close). חובה כדי ש-MTF (למשל RSI 5m על Primary=1)
  // יחושב על אותו סט נתונים כמו הגרף והבקטסט הראשי, אחרת מתקבלות תוצאות שונות בין מצב 1 למצב 2.
  const [filteredRawData, setFilteredRawData] = useState([]);
  const [processedData, setProcessedData] = useState([]);
  const [secondaryProcessedData, setSecondaryProcessedData] = useState([]);
  const [availableYears, setAvailableYears] = useState([]);
  const [datasetYears, setDatasetYears] = useState([]); // Years available as CSV files on server
  const [loadedDatasetYears, setLoadedDatasetYears] = useState([]); // Years currently loaded
  const [loadingYear, setLoadingYear] = useState(null); // Year currently being fetched
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [isDataLoaded, setIsDataLoaded] = useState(false);
  const [indicatorBank, setIndicatorBank] = useState(null); // Global indicator bank

  // Strategy State
  const [strategyConfig, setStrategyConfig] = useState({
    entryConditions: [{ id: 'time', params: { time: 840 }, timeframe: null, visible: true }],
    exitConditions: [{ id: 'time', params: { time: 1450 }, timeframe: null, visible: true }],
  });
  const [results, setResults] = useState(null);
  const [showReport, setShowReport] = useState(false);
  const [optimizationResults, setOptimizationResults] = useState(null);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [isRunningBacktest, setIsRunningBacktest] = useState(false);
  const [optimizationProgress, setOptimizationProgress] = useState({ current: 0, total: 0 });
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [crosshairData, setCrosshairData] = useState(null);
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const [isClickZoomMode, setIsClickZoomMode] = useState(false);
  const originalVisibleRangeRef = useRef(null);
  
  // Saved Strategies State
  const [savedStrategies, setSavedStrategies] = useState([]);
  const [selectedStrategyId, setSelectedStrategyId] = useState(null);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [strategyName, setStrategyName] = useState('');
  const [currentPage, setCurrentPage] = useState('MAIN'); // 'MAIN' or 'REPORTS'

  const [config, setConfig] = useState({
    selectedYears: [],
    primaryTimeframe: 1,
    secondaryTimeframe: 5,
    showSecondaryChart: false,
    sessionType: 'RTH',
    showSidebar: true,
    activeTab: 'DATA' 
  });

  // טעינת דאטה אוטומטית מ-Backend בהפעלה
  useEffect(() => {
    const loadAutoData = async () => {
      try {
        const status = await getBackendStatus();
        if (status.data_loaded && status.bars > 0) {
          setLoading(true);
          
          const response = await getLoadedData();
          const data = response.data;
          
          setRawData(data);
          setIsDataLoaded(true);
          
          setConfig(prev => ({ ...prev, activeTab: 'STRATEGY' }));
          setLoading(false);
        }
      } catch (error) {
        console.error('❌ Failed to load auto data:', error);
        setLoading(false);
      }
    };
    
    // Run after chart is ready
    if (candleSeriesRef.current) {
      loadAutoData();
    }
  }, []);

  // טעינת אסטרטגיות שמורות
  useEffect(() => {
    const d1Strategy = {
      id: 'd1_macd_only_test',
      name: 'D1 - MACD בלבד (בדיקת פער)',
      entryConditions: [
        { id: 'time_range', params: { startTime: 830, endTime: 1340 }, enabled: true, visible: true, timeframe: null },
        { id: 'macd_cross_above_signal', params: {}, enabled: true, visible: true, timeframe: null }
      ],
      exitConditions: [
        { id: 'stop_loss_ticks', params: { ticks: 80 }, enabled: true, visible: true },
        { id: 'take_profit_ticks', params: { ticks: 160 }, enabled: true, visible: true }
      ]
    };

    const c1Strategy = {
      id: 'c1_macd_ema_atr_volume',
      name: 'C1 - MACD Cross + EMA + ATR + Volume (כיסוי ספרייה)',
      entryConditions: [
        { id: 'time_range', params: { startTime: 830, endTime: 1340 }, enabled: true, visible: true, timeframe: null },
        { id: 'macd_cross_above_signal', params: {}, enabled: true, visible: true, timeframe: null },
        { id: 'price_above_ema', params: { period: 20 }, enabled: true, visible: true, timeframe: null },
        { id: 'atr_in_range', params: { period: 30, min: 12, max: 55 }, enabled: true, visible: true, timeframe: null },
        { id: 'volume_above_avg', params: { period: 20 }, enabled: true, visible: true, timeframe: null },
        { id: 'candle_body_min_ticks', params: { minTicks: 20 }, enabled: true, visible: true, timeframe: null }
      ],
      exitConditions: [
        { id: 'macd_cross_below_signal', params: {}, enabled: true, visible: true, timeframe: null },
        { id: 'stop_loss_ticks', params: { ticks: 80 }, enabled: true, visible: true },
        { id: 'take_profit_ticks', params: { ticks: 160 }, enabled: true, visible: true }
      ]
    };

    const b1Strategy = {
      id: 'b1_multi_filter_long',
      name: 'B1 - RSI Oversold + ADX + Volume Spike + Pullback',
      entryConditions: [
        { id: 'time_range', params: { startTime: 830, endTime: 1340 }, enabled: true, visible: true, timeframe: null },
        { id: 'rsi_below', params: { period: 14, threshold: 30 }, enabled: true, visible: true, timeframe: null },
        { id: 'adx_range', params: { period: 14, min: 18, max: 55 }, enabled: true, visible: true, timeframe: null },
        { id: 'green_candle', params: {}, enabled: true, visible: true, timeframe: null },
        { id: 'volume_spike', params: { period: 16, multiplier: 1.6 }, enabled: true, visible: true, timeframe: null },
        { id: 'min_red_candles', params: { minCount: 2, lookback: 6 }, enabled: true, visible: true, timeframe: null },
        { id: 'bar_range_ticks_range', params: { minTicks: 15, maxTicks: 250 }, enabled: true, visible: true, timeframe: null }
      ],
      exitConditions: [
        { id: 'rsi_above', params: { period: 14, threshold: 68 }, enabled: true, visible: true, timeframe: null },
        { id: 'stop_loss_ticks', params: { ticks: 60 }, enabled: true, visible: true },
        { id: 'take_profit_ticks', params: { ticks: 120 }, enabled: true, visible: true }
      ]
    };

    const e1Strategy = {
      id: 'e1_daily_change_macd',
      name: 'E1 - שינוי יומי % + MACD Cross',
      entryConditions: [
        { id: 'time_range', params: { startTime: 830, endTime: 1340 }, enabled: true, visible: true, timeframe: null },
        { id: 'market_change_percent_range', params: { minPercent: -2.1, maxPercent: 10 }, enabled: true, visible: true, timeframe: null },
        { id: 'macd_cross_above_signal', params: {}, enabled: true, visible: true, timeframe: null }
      ],
      exitConditions: [
        { id: 'macd_cross_below_signal', params: {}, enabled: true, visible: true, timeframe: null },
        { id: 'stop_loss_ticks', params: { ticks: 80 }, enabled: true, visible: true },
        { id: 'take_profit_ticks', params: { ticks: 160 }, enabled: true, visible: true }
      ]
    };

    const f1Strategy = {
      id: 'f1_macd_volume_trailing',
      name: 'F1 - MACD + Volume + Trailing Stop',
      entryConditions: [
        { id: 'macd_cross_above_signal', params: {}, enabled: true, visible: true, timeframe: null },
        { id: 'volume_above_avg', params: { period: 20 }, enabled: true, visible: true, timeframe: null }
      ],
      exitConditions: [
        { id: 'stop_loss_ticks', params: { ticks: 80 }, enabled: true, visible: true },
        { id: 'trailing_stop_ticks', params: { triggerTicks: 100, distanceTicks: 80 }, enabled: true, visible: true }
      ]
    };

    const a01Strategy = {
      id: 'a01_volume_spike',
      name: 'A01 - Volume Spike Long',
      entryConditions: [
        { id: 'green_candle', params: {}, enabled: true, visible: true },
        { id: 'candle_body_min_ticks', params: { minTicks: 34 }, enabled: true, visible: true },
        { id: 'volume_spike', params: { period: 16, multiplier: 1.6 }, enabled: true, visible: true },
        // פילטרים על Primary Timeframe (כבויים כברירת מחדל)
        { id: 'adx_range', params: { period: 14, min: 16, max: 56 }, enabled: false, visible: false, timeframe: null },
        { id: 'market_change_percent_range', params: { minPercent: -2.1, maxPercent: 10.0 }, enabled: false, visible: false, timeframe: null },
        { id: 'min_red_candles', params: { minCount: 1, lookback: 10 }, enabled: false, visible: false, timeframe: null },
        { id: 'volume_profile_ratio', params: { lookback: 25, minRatio: 0.7 }, enabled: false, visible: false, timeframe: null },
        { id: 'bar_range_ticks_range', params: { minTicks: 12, maxTicks: 300 }, enabled: false, visible: false, timeframe: null },
        // פילטרים על 5 דקות (כבויים כברירת מחדל)
        { id: 'atr_in_range', params: { period: 30, min: 12, max: 55 }, enabled: false, visible: false, timeframe: '5' },
        { id: 'adx_range', params: { period: 22, min: 1, max: 33 }, enabled: false, visible: false, timeframe: '5' },
        { id: 'rsi_in_range', params: { period: 14, min: 1, max: 84 }, enabled: false, visible: false, timeframe: '5' },
        { id: 'min_green_candles', params: { minCount: 6, lookback: 17 }, enabled: false, visible: false, timeframe: '5' },
        // פילטרים על 15 דקות (כבויים כברירת מחדל)
        { id: 'rsi_in_range', params: { period: 20, min: 25, max: 74 }, enabled: false, visible: false, timeframe: '15' },
        { id: 'atr_in_range', params: { period: 14, min: 19, max: 94 }, enabled: false, visible: false, timeframe: '15' },
        { id: 'adx_range', params: { period: 10, min: 11, max: 71 }, enabled: false, visible: false, timeframe: '15' }
      ],
      exitConditions: [
        { id: 'stop_loss_ticks', params: { ticks: 60 }, enabled: true, visible: true },
        { id: 'session_close_exit', params: {}, enabled: true, visible: true }
      ]
    };

    const saved = localStorage.getItem('systemAlpha_savedStrategies');
    if (saved) {
      const strategies = JSON.parse(saved);
      // הוספת אסטרטגיות ברירת מחדל רק אם הן לא קיימות כבר
      if (!strategies.find(s => s.id === 'd1_macd_only_test')) {
        strategies.unshift(d1Strategy);
      }
      if (!strategies.find(s => s.id === 'c1_macd_ema_atr_volume')) {
        strategies.unshift(c1Strategy);
      }
      if (!strategies.find(s => s.id === 'b1_multi_filter_long')) {
        strategies.unshift(b1Strategy);
      }
      if (!strategies.find(s => s.id === 'a01_volume_spike')) {
        strategies.unshift(a01Strategy);
      }
      if (!strategies.find(s => s.id === 'e1_daily_change_macd')) {
        strategies.unshift(e1Strategy);
      }
      if (!strategies.find(s => s.id === 'f1_macd_volume_trailing')) {
        strategies.unshift(f1Strategy);
      }
      setSavedStrategies(strategies);
    } else {
      setSavedStrategies([d1Strategy, c1Strategy, b1Strategy, e1Strategy, a01Strategy, f1Strategy]);
    }

    // Discover available yearly CSV files and auto-load 2023
    const discoverAndLoad = async () => {
      const possibleYears = [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025];
      const found = [];
      await Promise.all(possibleYears.map(async (yr) => {
        try {
          const res = await fetch(`./data/NQ_${yr}.csv`, { method: 'HEAD' });
          if (res.ok) found.push(yr);
        } catch (e) { /* not available */ }
      }));
      found.sort();
      setDatasetYears(found);
      if (found.length === 0) return;

      // Auto-load 2023 (or latest available)
      const defaultYear = found.includes(2023) ? 2023 : found[found.length - 1];
      try {
        setLoading(true);
        setLoadingMessage(`טוען נתונים ${defaultYear}...`);
        const response = await fetch(`./data/NQ_${defaultYear}.csv`);
        if (response.ok) {
          const text = await response.text();
          const { data, years } = parsePriceCSV(text);
          if (data.length > 0) {
            setAvailableYears(years);
            setConfig(prev => ({ ...prev, selectedYears: years }));
            setRawData(data);
            setLoadedDatasetYears([defaultYear]);
            setIsDataLoaded(true);
          }
        }
      } catch (e) {
        // Failed to load default year
      } finally {
        setLoading(false);
        setLoadingMessage('');
      }
    };
    discoverAndLoad();
  }, []);

  // פונקציות שמירה/טעינה/מחיקה של אסטרטגיות
  const saveStrategy = () => {
    if (!strategyName.trim()) {
      alert('אנא הזן שם לאסטרטגיה');
      return;
    }
    
    const strategy = {
      id: Date.now().toString(),
      name: strategyName.trim(),
      entryConditions: strategyConfig.entryConditions || [],
      exitConditions: strategyConfig.exitConditions || [],
      createdAt: new Date().toISOString()
    };
    
    const updated = [...savedStrategies, strategy];
    setSavedStrategies(updated);
    localStorage.setItem('systemAlpha_savedStrategies', JSON.stringify(updated));
    setShowSaveDialog(false);
    setStrategyName('');
  };

  const loadStrategy = (strategy) => {
    setStrategyConfig({
      entryConditions: strategy.entryConditions || [],
      exitConditions: strategy.exitConditions || []
    });
    setSelectedStrategyId(strategy.id);
    setShowSaveDialog(false);
  };

  const quickSaveStrategy = () => {
    if (!selectedStrategyId) return;
    
    const updated = savedStrategies.map(s => {
      if (s.id === selectedStrategyId) {
        return {
          ...s,
          entryConditions: strategyConfig.entryConditions || [],
          exitConditions: strategyConfig.exitConditions || [],
          updatedAt: new Date().toISOString()
        };
      }
      return s;
    });
    
    setSavedStrategies(updated);
    localStorage.setItem('systemAlpha_savedStrategies', JSON.stringify(updated));
    // הצגת אינדיקציה קצרה לשמירה יכולה להיות נחמדה, אבל המשתמש ביקש אייקון בלבד
  };

  const resetStrategy = () => {
    setStrategyConfig({
      entryConditions: [{ id: 'time', params: { time: 840 }, timeframe: null, visible: true }],
      exitConditions: [{ id: 'time', params: { time: 1450 }, timeframe: null, visible: true }],
    });
    setSelectedStrategyId(null);
    setResults(null);
  };

  const deleteStrategy = (id) => {
    if (!confirm('האם אתה בטוח שברצונך למחוק את האסטרטגיה?')) return;

    const updated = savedStrategies.filter(s => s.id !== id);
    setSavedStrategies(updated);
    localStorage.setItem('systemAlpha_savedStrategies', JSON.stringify(updated));
  };

  const exportStrategies = () => {
    if (savedStrategies.length === 0) {
      alert('אין אסטרטגיות לייצוא');
      return;
    }
    const exportData = {
      version: 1,
      exportedAt: new Date().toISOString(),
      strategies: savedStrategies
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const date = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `system_alpha_strategies_${date}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importStrategies = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target.result);
        const incoming = parsed.strategies || parsed;
        if (!Array.isArray(incoming) || incoming.length === 0) {
          alert('הקובץ לא מכיל אסטרטגיות תקינות');
          return;
        }
        const existingIds = new Set(savedStrategies.map(s => s.id));
        const newStrategies = incoming.filter(s => !existingIds.has(s.id));
        const updated = [...savedStrategies, ...newStrategies];
        setSavedStrategies(updated);
        localStorage.setItem('systemAlpha_savedStrategies', JSON.stringify(updated));
        alert(`יובאו ${newStrategies.length} אסטרטגיות חדשות (${incoming.length - newStrategies.length} כבר קיימות)`);
      } catch (err) {
        alert('שגיאה בקריאת הקובץ: ' + err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const toggleDatasetYear = async (year) => {
    const isLoaded = loadedDatasetYears.includes(year);
    if (isLoaded) {
      // Remove this year's data
      if (loadedDatasetYears.length <= 1) return; // Don't allow removing last year
      const newLoaded = loadedDatasetYears.filter(y => y !== year);
      setLoadedDatasetYears(newLoaded);
      // Rebuild rawData from remaining loaded years
      setLoading(true);
      setLoadingMessage('מעדכן נתונים...');
      try {
        const allData = [];
        const allYears = new Set();
        for (const yr of newLoaded) {
          const res = await fetch(`./data/NQ_${yr}.csv`);
          if (res.ok) {
            const text = await res.text();
            const { data, years } = parsePriceCSV(text);
            allData.push(...data);
            years.forEach(y => allYears.add(y));
          }
        }
        allData.sort((a, b) => a.time - b.time);
        const yearsArr = Array.from(allYears).sort();
        setRawData(allData);
        setAvailableYears(yearsArr);
        setConfig(prev => ({ ...prev, selectedYears: yearsArr }));
      } finally {
        setLoading(false);
        setLoadingMessage('');
      }
    } else {
      // Load and add this year's data
      setLoadingYear(year);
      try {
        const res = await fetch(`./data/NQ_${year}.csv`);
        if (!res.ok) return;
        const text = await res.text();
        const { data, years } = parsePriceCSV(text);
        if (data.length > 0) {
          const newLoaded = [...loadedDatasetYears, year].sort();
          setLoadedDatasetYears(newLoaded);
          const merged = [...rawData, ...data].sort((a, b) => a.time - b.time);
          const mergedYears = new Set([...availableYears, ...years]);
          const yearsArr = Array.from(mergedYears).sort();
          setRawData(merged);
          setAvailableYears(yearsArr);
          setConfig(prev => ({ ...prev, selectedYears: yearsArr }));
          setIsDataLoaded(true);
        }
      } finally {
        setLoadingYear(null);
      }
    }
  };

  const toggleAllConditions = (enabled, type = 'all') => {
    if (type === 'entry') {
      setStrategyConfig(prev => ({
        ...prev,
        entryConditions: (prev.entryConditions || []).map(c => ({ ...c, enabled }))
      }));
    } else if (type === 'exit') {
      setStrategyConfig(prev => ({
        ...prev,
        exitConditions: (prev.exitConditions || []).map(c => ({ ...c, enabled }))
      }));
    } else {
      setStrategyConfig(prev => ({
        ...prev,
        entryConditions: (prev.entryConditions || []).map(c => ({ ...c, enabled })),
        exitConditions: (prev.exitConditions || []).map(c => ({ ...c, enabled }))
      }));
    }
  };

  // אתחול גרף
  useEffect(() => {
    if (!chartContainerRef.current || !secondaryChartContainerRef.current) return;

    if (chartInstance.current) {
        chartInstance.current.remove();
        chartInstance.current = null;
    }
    if (secondaryChartInstance.current) {
        secondaryChartInstance.current.remove();
        secondaryChartInstance.current = null;
    }

    const chartOptions = {
      layout: {
        background: { type: 'solid', color: COLORS.bg },
        textColor: COLORS.text,
        fontFamily: 'Inter, system-ui, sans-serif',
      },
      grid: {
        vertLines: { color: COLORS.grid },
        horzLines: { color: COLORS.grid },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { 
          color: 'rgba(255, 255, 255, 0.2)', 
          width: 1, 
          style: LineStyle.Dash,
          labelVisible: true,
        },
        horzLine: { 
          color: 'rgba(255, 255, 255, 0.2)', 
          width: 1, 
          style: LineStyle.Dash,
          labelVisible: true,
        },
      },
      timeScale: {
        borderColor: '#27272a',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 10,
        barSpacing: 8,
        minBarSpacing: 1,
        fixLeftEdge: false,
        fixRightEdge: false,
      },
      rightPriceScale: {
        borderColor: '#27272a',
        autoScale: true,
        entireTextOnly: true,
        alignLabels: true,
      },
      handleScale: {
        axisPressedMouseMove: {
          time: true,
          price: true,
        },
      },
      localization: {
        dateFormat: 'dd/MM/yyyy', 
      },
    };

    // Primary Chart
    const chart = createChart(chartContainerRef.current, {
      ...chartOptions,
      width: chartContainerRef.current.clientWidth,
      height: chartContainerRef.current.clientHeight,
      rightPriceScale: {
        ...chartOptions.rightPriceScale,
        scaleMargins: { top: 0.1, bottom: 0.2 },
      },
    });

    // Secondary Chart
    const secondaryChart = createChart(secondaryChartContainerRef.current, {
      ...chartOptions,
      width: secondaryChartContainerRef.current.clientWidth,
      height: secondaryChartContainerRef.current.clientHeight,
      rightPriceScale: {
        ...chartOptions.rightPriceScale,
        scaleMargins: { top: 0.1, bottom: 0.2 },
      },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: COLORS.up,
      downColor: COLORS.down,
      borderVisible: false,
      wickUpColor: COLORS.up,
      wickDownColor: COLORS.down,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const secondaryCandleSeries = secondaryChart.addSeries(CandlestickSeries, {
      upColor: COLORS.up,
      downColor: COLORS.down,
      borderVisible: false,
      wickUpColor: COLORS.up,
      wickDownColor: COLORS.down,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const executionSeries = chart.addSeries(LineSeries, {
        color: '#ffffff',
        lineWidth: 4,
        lineStyle: LineStyle.Solid,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
    });

    const tradeLineSeries = chart.addSeries(LineSeries, {
        color: 'rgba(255, 255, 255, 0.4)',
        lineWidth: 1,
        lineStyle: LineStyle.Solid,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false
    });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      color: '#26a69a',
      priceFormat: { type: 'volume' },
      priceScaleId: '', 
      lastValueVisible: false,
      priceLineVisible: false,
    });

    const secondaryVolumeSeries = secondaryChart.addSeries(HistogramSeries, {
      color: '#26a69a',
      priceFormat: { type: 'volume' },
      priceScaleId: '', 
      lastValueVisible: false,
      priceLineVisible: false,
    });

    // Charts are initialized here, but synchronization is moved to a separate useEffect for safety
    
    chartInstance.current = chart;
    secondaryChartInstance.current = secondaryChart;
    candleSeriesRef.current = candleSeries;
    candleSeriesMarkersRef.current = createSeriesMarkers(candleSeries);
    secondaryCandleSeriesRef.current = secondaryCandleSeries;
    executionSeriesRef.current = executionSeries;
    volumeSeriesRef.current = volumeSeries;
    secondaryVolumeSeriesRef.current = secondaryVolumeSeries;
    tradeLineSeriesRef.current = tradeLineSeries;
    indicatorSeriesRef.current = {};

    const handleResize = () => {
        if (chartContainerRef.current && chartInstance.current) {
            chartInstance.current.applyOptions({ 
                width: chartContainerRef.current.clientWidth,
                height: chartContainerRef.current.clientHeight
            });
        }
        if (secondaryChartContainerRef.current && secondaryChartInstance.current) {
            secondaryChartInstance.current.applyOptions({ 
                width: secondaryChartContainerRef.current.clientWidth,
                height: secondaryChartContainerRef.current.clientHeight
            });
        }
    };

    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      if (chartInstance.current) {
        chartInstance.current.remove();
        chartInstance.current = null;
      }
      if (secondaryChartInstance.current) {
        secondaryChartInstance.current.remove();
        secondaryChartInstance.current = null;
      }
    };
  }, []);

  // סנכרון בין הגרפים
  useEffect(() => {
    if (!chartInstance.current || !secondaryChartInstance.current || processedData.length === 0 || secondaryProcessedData.length === 0) return;
    if (!config.showSecondaryChart) return;

    const chart1 = chartInstance.current;
    const chart2 = secondaryChartInstance.current;
    let isSyncing = false;

    const handleSync = (targetChart, range) => {
      if (isSyncing || !range || !range.from || !range.to) return;
      isSyncing = true;
      try {
        targetChart.timeScale().setVisibleRange(range);
      } catch (e) {
        // Different timeframes may not have exact matching time points - ignore
      }
      requestAnimationFrame(() => { isSyncing = false; });
    };

    const onChart1Change = (range) => handleSync(chart2, range);
    const onChart2Change = (range) => handleSync(chart1, range);

    chart1.timeScale().subscribeVisibleTimeRangeChange(onChart1Change);
    chart2.timeScale().subscribeVisibleTimeRangeChange(onChart2Change);

    // Initial sync: fit both charts to show same time range
    requestAnimationFrame(() => {
      const range = chart1.timeScale().getVisibleRange();
      if (range) handleSync(chart2, range);
    });

    return () => {
      try {
        chart1.timeScale().unsubscribeVisibleTimeRangeChange(onChart1Change);
        chart2.timeScale().unsubscribeVisibleTimeRangeChange(onChart2Change);
      } catch (e) { /* chart may already be removed */ }
    };
  }, [processedData, secondaryProcessedData, config.showSecondaryChart]);

  // Crosshair move event handler
  useEffect(() => {
    if (!chartInstance.current || !processedData.length) return;

    const handleCrosshairMove = (param) => {
      if (!param.point || !param.time) {
        setCrosshairData(null);
        try {
          if (param.source === 'primary' && secondaryChartInstance.current) {
            secondaryChartInstance.current.setCrosshairPosition(null, null, null);
          } else if (param.source === 'secondary' && chartInstance.current) {
            chartInstance.current.setCrosshairPosition(null, null, null);
          }
        } catch (e) {}
        return;
      }

      // Synchronize crosshair vertically
      try {
        if (param.source === 'primary' && secondaryChartInstance.current && secondaryCandleSeriesRef.current) {
          secondaryChartInstance.current.setCrosshairPosition(0, param.time, secondaryCandleSeriesRef.current);
        } else if (param.source === 'secondary' && chartInstance.current && candleSeriesRef.current) {
          chartInstance.current.setCrosshairPosition(0, param.time, candleSeriesRef.current);
        }
      } catch (e) {}

      const container = param.source === 'primary' ? chartContainerRef.current : secondaryChartContainerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      setMousePosition({
        x: param.point.x + rect.left,
        y: param.point.y + rect.top
      });

      // מציאת הנתונים לפי זמן
      const time = param.time;
      const activeData = param.source === 'primary' ? processedData : secondaryProcessedData;
      const candleData = activeData.find(d => d.time === time);
      
      if (!candleData) {
        setCrosshairData(null);
        return;
      }

      // חישוב אינדיקטורים אם יש (תומך ב-Multi-Timeframe)
      let indicatorValues = {};
      if (Object.keys(indicatorSeriesRef.current).length > 0) {
        const indicators = calculateAllIndicators(processedData, rawData, strategyConfig, config.primaryTimeframe);
        // מוצאים את הזמן בגרף הראשי
        const mainIndex = processedData.findIndex(d => d.time === time || (d.time <= time && d.time + (config.primaryTimeframe * 60) > time));
        
        if (mainIndex !== -1) {
          // עזר לקבלת ערך אינדיקטור (ראשי או MTF)
          const getVal = (type) => {
            const tf = (strategyConfig.entryConditions || []).find(c => c.id && c.id.startsWith(type) && c.enabled !== false)?.timeframe || 'DEF';
            const indObj = tf === 'DEF' || !indicators[`tf_${tf}`] ? indicators : indicators[`tf_${tf}`];
            return indObj[type];
          };

          const rsi = getVal('rsi');
          if (rsi && rsi[mainIndex] !== null) indicatorValues.rsi = rsi[mainIndex].toFixed(2);
          
          const macd = getVal('macd');
          if (macd) {
            if (macd.macd[mainIndex] !== null) indicatorValues.macd = macd.macd[mainIndex].toFixed(4);
            if (macd.signal[mainIndex] !== null) indicatorValues.macdSignal = macd.signal[mainIndex].toFixed(4);
          }

          const stoch = getVal('stoch');
          if (stoch) {
            if (stoch.k[mainIndex] !== null) indicatorValues.stochK = stoch.k[mainIndex].toFixed(2);
            if (stoch.d[mainIndex] !== null) indicatorValues.stochD = stoch.d[mainIndex].toFixed(2);
          }

          const sma20 = getVal('sma20');
          if (sma20 && sma20[mainIndex] !== null) indicatorValues.sma20 = sma20[mainIndex].toFixed(2);
          
          const sma50 = getVal('sma50');
          if (sma50 && sma50[mainIndex] !== null) indicatorValues.sma50 = sma50[mainIndex].toFixed(2);
          
          const ema20 = getVal('ema20');
          if (ema20 && ema20[mainIndex] !== null) indicatorValues.ema20 = ema20[mainIndex].toFixed(2);
          
          const ema50 = getVal('ema50');
          if (ema50 && ema50[mainIndex] !== null) indicatorValues.ema50 = ema50[mainIndex].toFixed(2);
        }
      }

      setCrosshairData({
        time: candleData.time,
        open: candleData.open,
        high: candleData.high,
        low: candleData.low,
        close: candleData.close,
        volume: candleData.volume,
        indicators: indicatorValues
      });
    };

    const handleMouseLeave = () => {
      setCrosshairData(null);
    };

    const chart = chartInstance.current;
    const secondaryChart = secondaryChartInstance.current;
    
    chart.subscribeCrosshairMove((p) => handleCrosshairMove({ ...p, source: 'primary' }));
    if (secondaryChart) {
      secondaryChart.subscribeCrosshairMove((p) => handleCrosshairMove({ ...p, source: 'secondary' }));
    }
    
    const container = chartContainerRef.current;
    const secondaryContainer = secondaryChartContainerRef.current;
    
    if (container) {
      container.addEventListener('mouseleave', handleMouseLeave);
    }
    if (secondaryContainer) {
      secondaryContainer.addEventListener('mouseleave', handleMouseLeave);
    }

    return () => {
      if (chart) {
        chart.unsubscribeCrosshairMove(handleCrosshairMove);
      }
      if (secondaryChart) {
        secondaryChart.unsubscribeCrosshairMove(handleCrosshairMove);
      }
      if (container) {
        container.removeEventListener('mouseleave', handleMouseLeave);
      }
      if (secondaryContainer) {
        secondaryContainer.removeEventListener('mouseleave', handleMouseLeave);
      }
    };
  }, [processedData, isClickZoomMode]);

  // עדכון נתונים
  useEffect(() => {
    if (!chartInstance.current || rawData.length === 0) return;

    let filtered = rawData.filter(d => {
        const date = new Date(d.time * 1000);
        return config.selectedYears.includes(date.getUTCFullYear());
    });

    if (config.sessionType === 'RTH') {
        // קודם מסננים לפי שעות RTH
        let rthFiltered = filtered.filter(d => {
            const date = new Date(d.time * 1000);
            const minutes = date.getUTCHours() * 60 + date.getUTCMinutes();
            return minutes >= 511 && minutes <= 900; // 08:31 - 15:00
        });
        
        // קבוצת נתונים לפי יום (תאריך)
        const dataByDate = new Map();
        rthFiltered.forEach(d => {
            const date = new Date(d.time * 1000);
            const dateKey = formatDateUTC(date);
            if (!dataByDate.has(dateKey)) {
                dataByDate.set(dateKey, []);
            }
            dataByDate.get(dateKey).push(d);
        });
        
        // מסננים ימים שאין בהם מסחר אחרי 12:00 (early close days)
        // ואם יש מסחר אחרי 12:00 אבל אין אחרי 13:00, סגירה ב-12:00
        const validDates = new Set();
        const earlyCloseDates = new Set(); // ימים שסגירה ב-12:00
        dataByDate.forEach((dayData, dateKey) => {
            // בודקים אם יש מסחר אחרי 12:00 (720 דקות)
            const hasTradingAfterNoon = dayData.some(d => {
                const date = new Date(d.time * 1000);
                const minutes = date.getUTCHours() * 60 + date.getUTCMinutes();
                return minutes > 720; // אחרי 12:00
            });
            
            if (!hasTradingAfterNoon) {
                // אין מסחר אחרי 12:00 - מוחקים את כל היום
                return;
            }
            
            // יש מסחר אחרי 12:00 - בודקים אם יש גם אחרי 13:00
            const hasTradingAfter1300 = dayData.some(d => {
                const date = new Date(d.time * 1000);
                const minutes = date.getUTCHours() * 60 + date.getUTCMinutes();
                return minutes > 780; // אחרי 13:00
            });
            
            validDates.add(dateKey);
            
            // אם אין מסחר אחרי 13:00, זה יום עם סגירה מוקדמת ב-12:00
            if (!hasTradingAfter1300) {
                earlyCloseDates.add(dateKey);
            }
        });
        
        // מסננים רק ימים תקינים, ואם יום עם סגירה מוקדמת - רק עד 12:00
        filtered = rthFiltered.filter(d => {
            const date = new Date(d.time * 1000);
            const dateKey = formatDateUTC(date);
            
            // אם היום לא תקין, מוחקים
            if (!validDates.has(dateKey)) {
                return false;
            }
            
            // אם זה יום עם סגירה מוקדמת, מסננים רק עד 12:00
            if (earlyCloseDates.has(dateKey)) {
                const minutes = date.getUTCHours() * 60 + date.getUTCMinutes();
                return minutes <= 720; // עד 12:00 כולל
            }
            
            // יום רגיל - כל הנתונים עד 15:00
            return true;
        });
    }

    // שמירה של rawData אחרי הפילטרים כדי שכל חישובי MTF יתבצעו על אותו מקור
    setFilteredRawData(filtered);

    const processedPrimary = processData(filtered, config.primaryTimeframe);
    const processedSecondary = processData(filtered, config.secondaryTimeframe);
    
    setProcessedData(processedPrimary);
    setSecondaryProcessedData(processedSecondary);
    
    // Build indicator bank once for primary data (like NinjaTrader)
    // Defer to next frame so chart renders first, preventing UI freeze on large datasets
    if (processedPrimary.length > 0) {
      setTimeout(() => {
        const bank = buildIndicatorBank(processedPrimary);
        setIndicatorBank(bank);
      }, 100);
    }

    if (candleSeriesRef.current) {
      candleSeriesRef.current.setData(processedPrimary);
      candleSeriesRef.current.priceScale().applyOptions({
        scaleMargins: { top: 0.1, bottom: 0.2 },
      });
    }
    
    if (secondaryCandleSeriesRef.current) {
      secondaryCandleSeriesRef.current.setData(processedSecondary);
      secondaryCandleSeriesRef.current.priceScale().applyOptions({
        scaleMargins: { top: 0.1, bottom: 0.2 },
      });
    }

    if (volumeSeriesRef.current) {
        const volumeData = processedPrimary.map(d => ({
            time: d.time,
            value: d.volume,
            color: d.close >= d.open ? COLORS.volumeUp : COLORS.volumeDown,
        }));
        volumeSeriesRef.current.setData(volumeData);
        volumeSeriesRef.current.priceScale().applyOptions({
          scaleMargins: { top: 0.8, bottom: 0 },
        });
    }

    if (secondaryVolumeSeriesRef.current) {
        const volumeData = processedSecondary.map(d => ({
            time: d.time,
            value: d.volume,
            color: d.close >= d.open ? COLORS.volumeUp : COLORS.volumeDown,
        }));
        secondaryVolumeSeriesRef.current.setData(volumeData);
        secondaryVolumeSeriesRef.current.priceScale().applyOptions({
          scaleMargins: { top: 0.8, bottom: 0 },
        });
    }

    // Auto-fit both charts when data changes (timeframe/session switch)
    // Double rAF ensures layout is settled before fitting
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (chartInstance.current) {
          chartInstance.current.timeScale().fitContent();
        }
        if (config.showSecondaryChart && secondaryChartInstance.current) {
          secondaryChartInstance.current.timeScale().fitContent();
        }
      });
    });

    if (candleSeriesRef.current) candleSeriesMarkersRef.current.setMarkers([]);
    if (executionSeriesRef.current) executionSeriesRef.current.setData([]);
    if (tradeLineSeriesRef.current) tradeLineSeriesRef.current.setData([]);
    
    // ניקוי אינדיקטורים כשמשנים נתונים
    if (chartInstance.current) {
      Object.values(indicatorSeriesRef.current).forEach(series => {
        try {
          if (Array.isArray(series)) {
            series.forEach(s => s && chartInstance.current.removeSeries(s));
          } else if (series) {
            chartInstance.current.removeSeries(series);
          }
        } catch (e) {
          console.warn('Failed to remove series during data reset:', e);
        }
      });
    }
    indicatorSeriesRef.current = {};
    
    // החזרת Volume וגרף המחיר למיקום המקורי
    if (volumeSeriesRef.current) {
      volumeSeriesRef.current.priceScale().applyOptions({
        scaleMargins: { top: 0.9, bottom: 0 },
      });
    }
    
    if (candleSeriesRef.current) {
      candleSeriesRef.current.priceScale().applyOptions({
        scaleMargins: { top: 0.1, bottom: 0.2 },
      });
    }
    
    // Reset box zoom original range when data changes
    originalVisibleRangeRef.current = null;
    
    setResults(null);

  }, [rawData, config]);

  // רספונסיביות - resize charts when layout changes
  useEffect(() => {
      // Multiple timeouts to handle CSS transition (300ms)
      const resizeCharts = () => {
          if (chartInstance.current && chartContainerRef.current) {
              chartInstance.current.applyOptions({
                  width: chartContainerRef.current.clientWidth,
                  height: chartContainerRef.current.clientHeight
              });
          }
          if (config.showSecondaryChart && secondaryChartInstance.current && secondaryChartContainerRef.current) {
              const w = secondaryChartContainerRef.current.clientWidth;
              const h = secondaryChartContainerRef.current.clientHeight;
              if (w > 0 && h > 0) {
                secondaryChartInstance.current.applyOptions({ width: w, height: h });
                secondaryChartInstance.current.timeScale().fitContent();
              }
          }
      };
      // Run at multiple points during the CSS transition
      const t1 = setTimeout(resizeCharts, 50);
      const t2 = setTimeout(resizeCharts, 320);
      const t3 = setTimeout(resizeCharts, 600);
      return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [config.showSidebar, config.showSecondaryChart]);

  const handleFileUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    setLoading(true);
    const fileSizeMB = (file.size / (1024 * 1024)).toFixed(0);
    setLoadingMessage(`קורא קובץ (${fileSizeMB}MB)...`);

    try {
      // Upload to backend in parallel with local parsing
      const uploadPromise = uploadCSV(file).catch(err => {
        console.warn('Backend upload failed (will retry on backtest):', err);
        return null;
      });

      // Read the file locally for display
      const text = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = () => reject(new Error('שגיאה בקריאת הקובץ'));
        reader.readAsText(file);
      });

      setLoadingMessage('מעבד נתונים...');

      // Use async parser for large files (>5MB), sync for small
      let data, years;
      if (file.size > 5 * 1024 * 1024) {
        const result = await parsePriceCSVAsync(text, (parsed, total) => {
          const pct = Math.round((parsed / total) * 100);
          setLoadingMessage(`מעבד נתונים... ${parsed.toLocaleString()} שורות (${pct}%)`);
        });
        data = result.data;
        years = result.years;
      } else {
        const result = parsePriceCSV(text);
        data = result.data;
        years = result.years;
      }

      setLoadingMessage(`נטען בהצלחה: ${data.length.toLocaleString()} נרות`);
      setAvailableYears(years);
      setConfig(prev => ({ ...prev, selectedYears: years.filter(y => y !== 2025) }));
      setRawData(data);
      setIsDataLoaded(true);

      // Wait for backend upload to finish
      await uploadPromise;

      setLoading(false);
      setLoadingMessage('');
    } catch (error) {
      console.error('❌ Upload failed:', error);
      alert(`שגיאה בהעלאת הקובץ: ${error.message}`);
      setLoading(false);
      setLoadingMessage('');
    }
  };

  const toggleYear = (year) => {
    setConfig(prev => {
      const newYears = prev.selectedYears.includes(year)
        ? prev.selectedYears.filter(y => y !== year)
        : [...prev.selectedYears, year].sort();
      return { ...prev, selectedYears: newYears };
    });
  };

  // Build comprehensive indicator bank (like NinjaTrader)
  const buildIndicatorBank = (data) => {
    const startTime = performance.now();
    
    const bank = {
      rsi: {},
      sma: {},
      ema: {},
      bb: {},
      macd: null,
      stoch: null,
      volumeAvg: {},
      atr: {}
    };
    
    // Common RSI periods
    [7, 9, 14, 21, 25, 30].forEach(period => {
      bank.rsi[period] = Indicators.calculateRSI(data, period);
    });
    
    // Common SMA periods
    [5, 10, 20, 30, 50, 100, 200].forEach(period => {
      bank.sma[period] = Indicators.calculateSMA(data, period);
    });
    
    // Common EMA periods
    [5, 10, 20, 30, 50, 100, 200].forEach(period => {
      bank.ema[period] = Indicators.calculateEMA(data, period);
    });
    
    // Common Bollinger Bands configurations
    [
      { period: 20, stdDev: 1.5 },
      { period: 20, stdDev: 2 },
      { period: 20, stdDev: 2.5 },
      { period: 20, stdDev: 3 }
    ].forEach(config => {
      const key = `${config.period}_${config.stdDev}`;
      bank.bb[key] = Indicators.calculateBollingerBands(data, config.period, config.stdDev);
    });
    
    // MACD (fixed params)
    bank.macd = Indicators.calculateMACD(data, 12, 26, 9);
    
    // Stochastic (fixed params)
    bank.stoch = Indicators.calculateStochastic(data, 14, 3, 3);
    
    // Common Volume Average periods
    [10, 20, 50].forEach(period => {
      bank.volumeAvg[period] = Indicators.calculateVolumeAverage(data, period);
    });
    
    // Common ATR periods
    [7, 14, 21].forEach(period => {
      bank.atr[period] = Indicators.calculateATR(data, period);
    });
    
    return bank;
  };

  // פונקציה להצגת אינדיקטורים על הגרף
  const displayIndicators = (data, requiredIndicators, mtfIndicators = null, strategyConfig = null) => {
    if (!chartInstance.current || !data.length) return;
    
    // ניקוי אינדיקטורים קודמים
    if (chartInstance.current) {
      Object.values(indicatorSeriesRef.current).forEach(series => {
        try {
          if (Array.isArray(series)) {
            series.forEach(s => s && chartInstance.current.removeSeries(s));
          } else if (series) {
            chartInstance.current.removeSeries(series);
          }
        } catch (e) {
          console.warn('Failed to remove indicator series:', e);
        }
      });
    }
    indicatorSeriesRef.current = {};
    
    // חישוב אינדיקטורים או שימוש במוכנים
    const indicators = mtfIndicators || calculateAllIndicators(data, [], strategyConfig);


    // סיווג אינדיקטורים (בחלון נפרד או על גרף המחיר)
    const overlayIndicators = requiredIndicators.filter(c => 
      c.id.includes('sma') || c.id.includes('ema') || 
      c.id.startsWith('price_touch_') || c.id.startsWith('bb_')
    );
    
    const paneIndicators = requiredIndicators.filter(c => 
      c.id.startsWith('rsi_') || c.id.startsWith('macd_') || c.id.startsWith('stoch_') ||
      c.id.startsWith('adx_') || c.id.startsWith('cci_') || c.id.startsWith('willr_') ||
      c.id.startsWith('atr_') || c.id.startsWith('volume_')
    );
    
    const indicatorCount = paneIndicators.length;
    
    // חישוב גובה לכל אינדיקטור
    const indicatorHeight = 0.2 / Math.max(indicatorCount, 1);
    let currentBottom = 0.05;
    const totalIndicatorHeight = indicatorCount * indicatorHeight;
    const priceChartBottom = indicatorCount > 0 
      ? currentBottom + totalIndicatorHeight + 0.15 
      : 0.2;
    
    // עדכון גרף המחיר הראשי
    if (candleSeriesRef.current) {
      candleSeriesRef.current.priceScale().applyOptions({
        scaleMargins: { top: 0.1, bottom: priceChartBottom },
      });
    }
    
    // הזזת Volume
    if (volumeSeriesRef.current) {
      const volumeTop = indicatorCount > 0 ? 1 - currentBottom - totalIndicatorHeight - 0.1 : 0.9;
      const volumeBottom = indicatorCount > 0 ? currentBottom + totalIndicatorHeight + 0.02 : 0;
      volumeSeriesRef.current.priceScale().applyOptions({
        scaleMargins: { top: volumeTop, bottom: volumeBottom },
      });
    }

    const palette = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4'];
    let paletteIdx = 0;

    const getValues = (condition) => {
      const tf = condition.timeframe || 'DEF';
      const tfKey = tf === 'DEF' ? 'DEF' : `tf_${tf}`;
      const params = condition.params || {};
      const id = condition.id;
      
      let key = '';
      if (id.startsWith('rsi_')) key = `rsi_${params.period || 14}`;
      else if (id.startsWith('macd_')) key = `macd_${params.fast || 12}_${params.slow || 26}_${params.signal || 9}`;
      else if (id.startsWith('stoch_')) key = `stoch_${params.kPeriod || 14}_${params.dPeriod || 3}`;
      else if (id.includes('sma')) key = `sma_${params.period || (id.includes('sma20') ? 20 : (id.includes('sma50') ? 50 : 20))}`;
      else if (id.includes('ema')) key = `ema_${params.period || (id.includes('ema20') ? 20 : (id.includes('ema50') ? 50 : 20))}`;
      else if (id.startsWith('price_touch_') || id.startsWith('bb_')) key = `bb_${params.period || 20}_${params.stdDev || 2}`;
      else if (id.startsWith('volume_')) key = `vol_avg_${params.period || 20}`;
      else if (id.startsWith('adx_')) key = `adx_${params.period || 14}`;
      else if (id.startsWith('cci_')) key = `cci_${params.period || 14}`;
      else if (id.startsWith('willr_')) key = `willr_${params.period || 14}`;
      else if (id.startsWith('atr_')) key = `atr_${params.period || 14}`;

      if (indicators[tfKey] && indicators[tfKey][key]) return { values: indicators[tfKey][key], key, tf };
      return null;
    };

    paneIndicators.forEach((cond, idx) => {
      const dataObj = getValues(cond);
      if (!dataObj) return;
      const { values, tf } = dataObj;
      const paneTop = 1 - currentBottom - indicatorHeight;
      const title = `${cond.id.split('_')[0].toUpperCase()} (${tf === 'DEF' ? 'D' : tf + 'm'})`;
      
      if (cond.id.startsWith('rsi_')) {
        const series = chartInstance.current.addSeries(LineSeries, { color: '#9d4edd', lineWidth: 1, priceScaleId: `pane_${idx}`, title, priceLineVisible: false, lastValueVisible: false });
        series.priceScale().applyOptions({ scaleMargins: { top: paneTop, bottom: currentBottom }, autoScale: false, minimumValue: 0, maximumValue: 100 });
        series.setData(data.map((d, i) => ({ time: d.time, value: values[i] })).filter(d => d.value !== null));
        series.createPriceLine({ price: 30, color: '#3f3f46', lineWidth: 1, lineStyle: LineStyle.Dashed });
        series.createPriceLine({ price: 70, color: '#3f3f46', lineWidth: 1, lineStyle: LineStyle.Dashed });
        indicatorSeriesRef.current[`cond_${idx}`] = series;
      } else if (cond.id.startsWith('macd_')) {
        const macd = chartInstance.current.addSeries(LineSeries, { color: '#3b82f6', lineWidth: 1, priceScaleId: `pane_${idx}`, title, priceLineVisible: false, lastValueVisible: false });
        const signal = chartInstance.current.addSeries(LineSeries, { color: '#ef4444', lineWidth: 1, priceScaleId: `pane_${idx}`, priceLineVisible: false, lastValueVisible: false });
        macd.priceScale().applyOptions({ scaleMargins: { top: paneTop, bottom: currentBottom }, autoScale: true });
        macd.setData(data.map((d, i) => ({ time: d.time, value: values.macd[i] })).filter(d => d.value !== null));
        signal.setData(data.map((d, i) => ({ time: d.time, value: values.signal[i] })).filter(d => d.value !== null));
        indicatorSeriesRef.current[`cond_${idx}`] = [macd, signal];
      } else if (cond.id.startsWith('stoch_')) {
        const k = chartInstance.current.addSeries(LineSeries, { color: '#06b6d4', lineWidth: 1, priceScaleId: `pane_${idx}`, title: title + ' %K', priceLineVisible: false, lastValueVisible: false });
        const d = chartInstance.current.addSeries(LineSeries, { color: '#f97316', lineWidth: 1, priceScaleId: `pane_${idx}`, title: title + ' %D', priceLineVisible: false, lastValueVisible: false });
        k.priceScale().applyOptions({ scaleMargins: { top: paneTop, bottom: currentBottom }, autoScale: false, minimumValue: 0, maximumValue: 100 });
        k.setData(data.map((d, i) => ({ time: d.time, value: values.k[i] })).filter(d => d.value !== null));
        d.setData(data.map((d, i) => ({ time: d.time, value: values.d[i] })).filter(d => d.value !== null));
        k.createPriceLine({ price: 20, color: '#3f3f46', lineWidth: 1, lineStyle: LineStyle.Dashed });
        k.createPriceLine({ price: 80, color: '#3f3f46', lineWidth: 1, lineStyle: LineStyle.Dashed });
        indicatorSeriesRef.current[`cond_${idx}`] = [k, d];
      } else {
        const color = palette[paletteIdx % palette.length];
        paletteIdx++;
        const series = chartInstance.current.addSeries(LineSeries, { color, lineWidth: 1, priceScaleId: `pane_${idx}`, title, priceLineVisible: false, lastValueVisible: false });
        series.priceScale().applyOptions({ scaleMargins: { top: paneTop, bottom: currentBottom }, autoScale: true });
        series.setData(data.map((d, i) => ({ time: d.time, value: values[i] })).filter(d => d.value !== null));
        indicatorSeriesRef.current[`cond_${idx}`] = series;
      }
      currentBottom += indicatorHeight;
    });

    overlayIndicators.forEach((cond, idx) => {
      const dataObj = getValues(cond);
      if (!dataObj) return;
      const { values, key } = dataObj;
      const color = palette[paletteIdx % palette.length];
      paletteIdx++;
      
      if (cond.id.startsWith('bb_') || cond.id.startsWith('price_touch_')) {
        const u = chartInstance.current.addSeries(LineSeries, { color, lineWidth: 1, lineStyle: LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false });
        const m = chartInstance.current.addSeries(LineSeries, { color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
        const l = chartInstance.current.addSeries(LineSeries, { color, lineWidth: 1, lineStyle: LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false });
        u.setData(data.map((d, i) => ({ time: d.time, value: values.upper[i] })).filter(d => d.value !== null));
        m.setData(data.map((d, i) => ({ time: d.time, value: values.middle[i] })).filter(d => d.value !== null));
        l.setData(data.map((d, i) => ({ time: d.time, value: values.lower[i] })).filter(d => d.value !== null));
        indicatorSeriesRef.current[`cond_overlay_${idx}`] = [u, m, l];
      } else {
        const s = chartInstance.current.addSeries(LineSeries, { color, lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false, title: key.toUpperCase() });
        s.setData(data.map((d, i) => ({ time: d.time, value: values[i] })).filter(d => d.value !== null));
        indicatorSeriesRef.current[`cond_overlay_${idx}`] = s;
      }
    });
  };

  // --- ניהול נראות אינדיקטורים ---
  // אפקט זה דואג לעדכן את האינדיקטורים על הגרף בכל פעם שהאסטרטגיה משתנה (כולל לחיצה על העין)
  useEffect(() => {
    if (!processedData.length || !chartInstance.current) return;

    // זיהוי אינדיקטורים שצריכים להיות מוצגים (visible=true וגם הם מסוג אינדיקטור)
    const required = getRequiredIndicators(
      strategyConfig.entryConditions,
      strategyConfig.exitConditions
    );

    // חישוב האינדיקטורים הנדרשים (כולל תמיכה ב-MTF)
    const mtfSource = (filteredRawData && filteredRawData.length) ? filteredRawData : rawData;
    const indicators = calculateAllIndicators(
      processedData, 
      mtfSource, 
      strategyConfig, 
      config.primaryTimeframe
    );

    // עדכון התצוגה על הגרף
    displayIndicators(processedData, required, indicators, strategyConfig);
    
  }, [strategyConfig, processedData, rawData, config.primaryTimeframe]);

  const handleRunStrategy = async () => {
    if (!processedData.length) return;
    
    setIsRunningBacktest(true);
    
    // בדיקה אם יש פרמטרים לאופטימיזציה
    const optimizationParams = findOptimizationParams(
      strategyConfig.entryConditions || [],
      strategyConfig.exitConditions || []
    );
    
    let finalResults = null;

    if (optimizationParams.length > 0) {
      // הרצת אופטימיזציה
      setIsOptimizing(true);
      setOptimizationProgress({ current: 0, total: 0 });
      setOptimizationResults(null);
      
      try {
        const optResults = await runOptimization(
          processedData,
          strategyConfig.entryConditions || [],
          strategyConfig.exitConditions || [],
          optimizationParams,
          (current, total) => setOptimizationProgress({ current, total })
        );
        
        setOptimizationResults(optResults);
        // הצגת התוצאה הטובה ביותר
        if (optResults.length > 0) {
          const bestResult = {
            trades: optResults[0].trades,
            stats: optResults[0].stats
          };
          finalResults = bestResult;
          setResults(bestResult);
          
          // גלילה אוטומטית למעלה כדי להציג את התוצאות
          setTimeout(() => {
            if (sidebarScrollRef.current) {
              sidebarScrollRef.current.scrollTop = 0;
            }
          }, 100);
          
          // הצגת markers וקווים בולטים
          const markers = [];
          const executionData = [];
          
          bestResult.trades.forEach(t => {
            // מוצאים את האינדקס של הנר כדי לצייר קו שמתחיל קצת לפניו
            const candleIdx = processedData.findIndex(d => d.time === t.entryTime);
            const prevTime = candleIdx > 0 ? processedData[candleIdx - 1].time : t.entryTime - (config.primaryTimeframe * 60);

            // Entry - קו עבה
            executionData.push({ time: prevTime, value: t.entryPrice, color: COLORS.entry });
            executionData.push({ time: t.entryTime, value: t.entryPrice, color: COLORS.entry });
            executionData.push({ time: t.entryTime, value: NaN }); // נתק כדי שלא יתחבר לקו הבא

            markers.push({ 
              time: t.entryTime, 
              position: 'belowBar', 
              color: COLORS.entry, 
              shape: 'arrowUp', 
              text: `${t.entryPrice.toFixed(2)}`,
              size: 1
            });

            // Exit - קו עבה
            const exitIdx = processedData.findIndex(d => d.time === t.exitTime);
            const prevExitTime = exitIdx > 0 ? processedData[exitIdx - 1].time : t.exitTime - (config.primaryTimeframe * 60);

            executionData.push({ time: prevExitTime, value: t.exitPrice, color: COLORS.exit });
            executionData.push({ time: t.exitTime, value: t.exitPrice, color: COLORS.exit });
            executionData.push({ time: t.exitTime, value: NaN });

            markers.push({ 
              time: t.exitTime, 
              position: 'aboveBar', 
              color: COLORS.exit, 
              shape: 'arrowDown', 
              text: `${t.exitPrice.toFixed(2)}`,
              size: 1
            });
          });

          if (candleSeriesRef.current) candleSeriesMarkersRef.current.setMarkers(markers);
          if (executionSeriesRef.current) {
              executionSeriesRef.current.setData(executionData);
          }
        }
      } catch (error) {
        console.error('Optimization error:', error);
      } finally {
        setIsOptimizing(false);
        setIsRunningBacktest(false);
      }
    } else {
      // הרצה רגילה - הוספת delay קצר כדי להציג את ה-spinner
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const mtfSource = (filteredRawData && filteredRawData.length) ? filteredRawData : rawData;
      const indicators = calculateAllIndicators(processedData, mtfSource, strategyConfig, config.primaryTimeframe);
      const testResults = runBacktest(
        processedData, 
        strategyConfig.entryConditions || [],
        strategyConfig.exitConditions || [],
        mtfSource,
        strategyConfig,
        config.primaryTimeframe
      );
      finalResults = testResults;
      setResults(testResults);
      setOptimizationResults(null);
      setIsRunningBacktest(false);
      
      // גלילה אוטומטית למעלה כדי להציג את התוצאות
      setTimeout(() => {
        if (sidebarScrollRef.current) {
          sidebarScrollRef.current.scrollTop = 0;
        }
      }, 100);
      
      const markers = [];
      const executionData = [];

      testResults.trades.forEach(t => {
          // מציאת זמן הנר הקודם לצורך ציור קו ברוחב הנר
          const candleIdx = processedData.findIndex(d => d.time === t.entryTime);
          const prevTime = candleIdx > 0 ? processedData[candleIdx - 1].time : t.entryTime - (config.primaryTimeframe * 60);

          // Entry
          executionData.push({ time: prevTime, value: t.entryPrice });
          executionData.push({ time: t.entryTime, value: t.entryPrice });
          executionData.push({ time: t.entryTime, value: NaN });

          markers.push({ 
              time: t.entryTime, 
              position: 'belowBar', 
              color: COLORS.entry, 
              shape: 'arrowUp', 
              text: `${t.entryPrice.toFixed(2)}`,
              size: 1
          });

          // Exit
          const exitIdx = processedData.findIndex(d => d.time === t.exitTime);
          const prevExitTime = exitIdx > 0 ? processedData[exitIdx - 1].time : t.exitTime - (config.primaryTimeframe * 60);

          executionData.push({ time: prevExitTime, value: t.exitPrice });
          executionData.push({ time: t.exitTime, value: t.exitPrice });
          executionData.push({ time: t.exitTime, value: NaN });

          markers.push({ 
              time: t.exitTime, 
              position: 'aboveBar', 
              color: COLORS.exit, 
              shape: 'arrowDown', 
              text: `${t.exitPrice.toFixed(2)}`,
              size: 1
          });
      });

      if (candleSeriesRef.current) candleSeriesMarkersRef.current.setMarkers(markers);
      if (executionSeriesRef.current) executionSeriesRef.current.setData(executionData);
    }
    
    // הצגת קווי עסקאות דקים
    if (finalResults && tradeLineSeriesRef.current) {
        const lineData = generateTradeLinesData(finalResults.trades, processedData);
        tradeLineSeriesRef.current.setData(lineData);
    }
  };

  const handleZoomToTrade = (trade) => {
      if (!chartInstance.current) return;
      setShowReport(false);

      // הסרת קווי עסקאות - מציגים רק חצים
      if (tradeLineSeriesRef.current) {
          tradeLineSeriesRef.current.setData([]);
      }

      if (candleSeriesRef.current) {
           const markers = [
              { time: trade.entryTime, position: 'belowBar', color: COLORS.entry, shape: 'arrowUp', text: `${trade.entryPrice.toFixed(2)}`, size: 2 },
              { time: trade.exitTime, position: 'aboveBar', color: COLORS.exit, shape: 'arrowDown', text: `${trade.exitPrice.toFixed(2)}`, size: 2 }
          ];
          candleSeriesMarkersRef.current.setMarkers(markers);
          
          if (executionSeriesRef.current) {
              const entryIdx = processedData.findIndex(d => d.time === trade.entryTime);
              const prevEntryTime = entryIdx > 0 ? processedData[entryIdx - 1].time : trade.entryTime - (config.primaryTimeframe * 60);
              
              const exitIdx = processedData.findIndex(d => d.time === trade.exitTime);
              const prevExitTime = exitIdx > 0 ? processedData[exitIdx - 1].time : trade.exitTime - (config.primaryTimeframe * 60);

              executionSeriesRef.current.setData([
                  { time: prevEntryTime, value: trade.entryPrice },
                  { time: trade.entryTime, value: trade.entryPrice },
                  { time: trade.entryTime, value: NaN },
                  { time: prevExitTime, value: trade.exitPrice },
                  { time: trade.exitTime, value: trade.exitPrice }
              ]);
          }
      }

      const buffer = Math.max(1800, (trade.exitTime - trade.entryTime) * 2); 
      chartInstance.current.timeScale().setVisibleRange({
          from: trade.entryTime - buffer,
          to: trade.exitTime + buffer
      });
  };

  // Zoom functions
  const handleZoomIn = () => {
    if (!chartInstance.current || !processedData.length) return;
    const timeScale = chartInstance.current.timeScale();
    const visibleRange = timeScale.getVisibleRange();
    if (!visibleRange) return;
    
    const range = visibleRange.to - visibleRange.from;
    const center = (visibleRange.from + visibleRange.to) / 2;
    const newRange = range * 0.7; // Zoom in by 30%
    
    timeScale.setVisibleRange({
      from: center - newRange / 2,
      to: center + newRange / 2
    });
  };

  const handleZoomOut = () => {
    if (!chartInstance.current || !processedData.length) return;
    const timeScale = chartInstance.current.timeScale();
    const visibleRange = timeScale.getVisibleRange();
    if (!visibleRange) return;

    const range = visibleRange.to - visibleRange.from;
    const dataStart = processedData[0].time;
    const dataEnd = processedData[processedData.length - 1].time;
    const maxRange = dataEnd - dataStart;

    // If already showing all data, fit content instead
    if (range >= maxRange * 0.95) {
      timeScale.fitContent();
      return;
    }

    const center = (visibleRange.from + visibleRange.to) / 2;
    const newRange = range * 1.5; // Zoom out by 50%

    const from = Math.max(dataStart, center - newRange / 2);
    const to = Math.min(dataEnd + (maxRange * 0.05), center + newRange / 2);

    timeScale.setVisibleRange({ from, to });
  };

  const handlePanLeft = () => {
    if (!chartInstance.current || !processedData.length) return;
    const timeScale = chartInstance.current.timeScale();
    const visibleRange = timeScale.getVisibleRange();
    if (!visibleRange) return;
    
    const range = visibleRange.to - visibleRange.from;
    const shift = range * 0.3; // Move 30% of visible range to the left
    
    const dataStart = processedData[0].time;
    const newFrom = Math.max(dataStart, visibleRange.from - shift);
    const newTo = newFrom + range;
    
    // Ensure we don't go beyond data end
    const dataEnd = processedData[processedData.length - 1].time;
    if (newTo > dataEnd) {
      timeScale.setVisibleRange({
        from: Math.max(dataStart, dataEnd - range),
        to: dataEnd
      });
    } else {
      timeScale.setVisibleRange({ from: newFrom, to: newTo });
    }
  };

  const handlePanRight = () => {
    if (!chartInstance.current || !processedData.length) return;
    const timeScale = chartInstance.current.timeScale();
    const visibleRange = timeScale.getVisibleRange();
    if (!visibleRange) return;
    
    const range = visibleRange.to - visibleRange.from;
    const shift = range * 0.3; // Move 30% of visible range to the right
    
    const dataEnd = processedData[processedData.length - 1].time;
    const newTo = Math.min(dataEnd, visibleRange.to + shift);
    const newFrom = newTo - range;
    
    // Ensure we don't go beyond data start
    const dataStart = processedData[0].time;
    if (newFrom < dataStart) {
      timeScale.setVisibleRange({
        from: dataStart,
        to: Math.min(dataEnd, dataStart + range)
      });
    } else {
      timeScale.setVisibleRange({ from: newFrom, to: newTo });
    }
  };

  const handleToggleClickZoom = () => {
    if (isClickZoomMode) {
      // If already active, reset to original view
      if (originalVisibleRangeRef.current && chartInstance.current) {
        const timeScale = chartInstance.current.timeScale();
        timeScale.setVisibleRange(originalVisibleRangeRef.current);
        originalVisibleRangeRef.current = null;
      }
      setIsClickZoomMode(false);
    } else {
      // Save current visible range before entering click zoom mode
      if (chartInstance.current) {
        const timeScale = chartInstance.current.timeScale();
        const currentRange = timeScale.getVisibleRange();
        if (currentRange) {
          originalVisibleRangeRef.current = { ...currentRange };
        }
      }
      setIsClickZoomMode(true);
    }
  };

  // Click zoom handler - zoom to 20 candles around clicked point
  useEffect(() => {
    if (!isClickZoomMode || !chartContainerRef.current || !chartInstance.current || !processedData.length) {
      return;
    }

    const container = chartContainerRef.current;
    const timeScale = chartInstance.current.timeScale();
    const candlesToShow = 20; // Number of candles to show around the clicked point

    const handleClick = (e) => {
      // Only handle click if it's a left mouse button click (not crosshair move)
      if (e.button !== undefined && e.button !== 0) return;
      
      e.preventDefault();
      e.stopPropagation();
      
      const rect = container.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      
      // Get current visible range
      const visibleRange = timeScale.getVisibleRange();
      if (!visibleRange) return;
      
      // Save original range if not already saved
      if (!originalVisibleRangeRef.current) {
        originalVisibleRangeRef.current = { ...visibleRange };
      }
      
      // Convert click position to time
      const chartWidth = container.clientWidth;
      const clickRatio = Math.max(0, Math.min(1, clickX / chartWidth));
      const currentRange = visibleRange.to - visibleRange.from;
      const clickedTime = visibleRange.from + (clickRatio * currentRange);
      
      // Find the closest candle to the clicked time
      let closestCandle = null;
      let minDistance = Infinity;
      
      processedData.forEach((candle, index) => {
        const distance = Math.abs(candle.time - clickedTime);
        if (distance < minDistance) {
          minDistance = distance;
          closestCandle = { candle, index };
        }
      });
      
      if (closestCandle) {
        const centerIndex = closestCandle.index;
        const startIndex = Math.max(0, centerIndex - Math.floor(candlesToShow / 2));
        const endIndex = Math.min(processedData.length - 1, startIndex + candlesToShow - 1);
        
        const timeFrom = processedData[startIndex].time;
        const timeTo = processedData[endIndex].time;
        
        // Add small buffer for better visibility
        const buffer = (timeTo - timeFrom) * 0.1;
        
        timeScale.setVisibleRange({
          from: timeFrom - buffer,
          to: timeTo + buffer
        });
      }
    };

    container.addEventListener('click', handleClick, { capture: true });

    return () => {
      container.removeEventListener('click', handleClick, { capture: true });
    };
  }, [isClickZoomMode, processedData]);

  return (
    <div className="flex h-screen w-full bg-black text-zinc-300 font-sans overflow-hidden dir-rtl">
      
      {showReport && <DetailedReport results={results} strategyConfig={strategyConfig} onClose={() => setShowReport(false)} onTradeClick={handleZoomToTrade} />}

      <div className={`flex flex-col border-l border-zinc-700/50 bg-black transition-all duration-300 ${config.showSidebar && currentPage === 'MAIN' ? 'w-72' : 'w-0'} overflow-hidden relative z-20`}>
        <div className="h-12 border-b border-zinc-800 flex items-center px-4 justify-between bg-black select-none shrink-0">
          <div className="flex items-center gap-2 cursor-pointer" onClick={() => setCurrentPage('MAIN')}>
            <Activity className="text-blue-500" size={16} />
            <h1 className="text-xs font-bold tracking-widest text-zinc-100">SYSTEM <span className="text-blue-500">ALPHA</span></h1>
          </div>
          <div className="flex items-center gap-2">
            <button 
              onClick={() => setCurrentPage('REPORTS')}
              className={`p-1.5 rounded transition-all ${currentPage === 'REPORTS' ? 'text-blue-400 bg-blue-500/10' : 'text-zinc-500 hover:text-zinc-300'}`}
              title="ניתוח דוחות Grid"
            >
              <FileText size={14} />
            </button>
            <button 
              onClick={() => setCurrentPage('MAIN')}
              className={`p-1.5 rounded transition-all ${currentPage === 'MAIN' ? 'text-blue-400 bg-blue-500/10' : 'text-zinc-500 hover:text-zinc-300'}`}
              title="מסך ראשי"
            >
              <LayoutDashboard size={14} />
            </button>
          </div>
        </div>
        
        <div className="flex border-b border-zinc-800 bg-zinc-950/50">
            {['DATA', 'STRATEGY'].map(tab => (
                <button 
                    key={tab}
                    onClick={() => setConfig(p => ({...p, activeTab: tab}))}
                    className={`flex-1 py-2 text-[10px] font-bold tracking-wider transition-colors ${config.activeTab === tab ? 'text-blue-400 border-b-2 border-blue-500 bg-blue-500/5' : 'text-zinc-600 hover:text-zinc-400'}`}
                >
                    {tab}
                </button>
            ))}
        </div>

        <div ref={sidebarScrollRef} className="flex-1 overflow-y-auto p-4 space-y-6 pb-20">
          {config.activeTab === 'DATA' && (
              <>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">DATA SOURCE</label>
                    <div className="relative group">
                        <input type="file" accept=".csv" onChange={handleFileUpload} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" />
                        <div className={`flex items-center justify-center p-3 border border-dashed rounded-lg transition-colors ${isDataLoaded ? 'border-green-500/30 bg-green-500/5' : 'border-zinc-700 hover:border-blue-500 hover:text-blue-400'}`}>
                            {isDataLoaded ? (
                                <div className="flex items-center gap-2 text-green-500">
                                    <FileCheck size={14} />
                                    <span className="text-xs font-mono">{rawData.length.toLocaleString()} bars</span>
                                </div>
                            ) : (
                                <div className="flex items-center gap-2 text-zinc-500">
                                    <Upload size={14} />
                                    <span className="text-xs">Import CSV</span>
                                </div>
                            )}
                        </div>
                    </div>
                  </div>

                  {datasetYears.length > 0 && (
                    <div className="space-y-2">
                      <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider flex items-center justify-between">
                        <span>LOAD YEARS</span>
                        {loadedDatasetYears.length > 0 && (
                          <span className="text-blue-500 font-mono">{loadedDatasetYears.join(', ')}</span>
                        )}
                      </label>
                      <div className="flex flex-wrap gap-1.5">
                        {datasetYears.map(yr => {
                          const isLoaded = loadedDatasetYears.includes(yr);
                          const isLoading = loadingYear === yr;
                          return (
                            <button
                              key={yr}
                              onClick={() => toggleDatasetYear(yr)}
                              disabled={isLoading || (isLoaded && loadedDatasetYears.length <= 1)}
                              className={`px-2.5 py-1 text-[10px] rounded border transition-all font-mono ${
                                isLoading
                                  ? 'border-amber-500/30 bg-amber-500/10 text-amber-400 animate-pulse'
                                  : isLoaded
                                    ? 'bg-blue-500/10 border-blue-500/30 text-blue-400'
                                    : 'bg-transparent border-zinc-800 text-zinc-600 hover:border-zinc-600 hover:text-zinc-400'
                              } ${isLoaded && loadedDatasetYears.length <= 1 ? 'opacity-50 cursor-not-allowed' : ''}`}
                            >
                              {isLoading ? '...' : yr}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div className="space-y-4">
                    <div className="space-y-2">
                      <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider flex items-center justify-between">
                        <span>PRIMARY TIMEFRAME</span>
                        <span className="text-blue-500 font-mono">{config.primaryTimeframe}m</span>
                      </label>
                      <div className="grid grid-cols-5 gap-1">
                          {[1, 5, 15, 30, 60].map(tf => (
                          <button
                              key={tf}
                              onClick={() => setConfig(prev => ({ ...prev, primaryTimeframe: tf }))}
                              className={`py-1 text-[10px] rounded transition-all font-mono ${config.primaryTimeframe === tf ? 'bg-blue-500/10 text-blue-400 border border-blue-500/30' : 'bg-zinc-900/50 text-zinc-600 hover:text-zinc-400 hover:bg-zinc-900 border border-zinc-800'}`}
                          >
                              {tf}m
                          </button>
                          ))}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span>SECONDARY TIMEFRAME</span>
                          <button
                            onClick={() => setConfig(prev => ({ ...prev, showSecondaryChart: !prev.showSecondaryChart }))}
                            className={`p-1 rounded transition-all ${
                              config.showSecondaryChart 
                                ? 'text-blue-400 bg-blue-500/10' 
                                : 'text-zinc-600 hover:text-zinc-400 bg-zinc-900/50'
                            }`}
                            title={config.showSecondaryChart ? "הסתר גרף משני" : "הצג גרף משני"}
                          >
                            <BarChart3 size={10} />
                          </button>
                        </div>
                        <span className={`${config.showSecondaryChart ? 'text-zinc-400' : 'text-zinc-700'} font-mono`}>{config.secondaryTimeframe}m</span>
                      </label>
                      <div className={`grid grid-cols-5 gap-1 transition-all duration-300 ${config.showSecondaryChart ? 'opacity-100' : 'opacity-30 pointer-events-none'}`}>
                          {[1, 5, 15, 30, 60].map(tf => (
                          <button
                              key={tf}
                              onClick={() => setConfig(prev => ({ ...prev, secondaryTimeframe: tf }))}
                              className={`py-1 text-[10px] rounded transition-all font-mono ${config.secondaryTimeframe === tf ? 'bg-zinc-800 text-white border border-zinc-700' : 'bg-zinc-900/50 text-zinc-600 hover:text-zinc-400 hover:bg-zinc-900 border border-zinc-800'}`}
                          >
                              {tf}m
                          </button>
                          ))}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">SESSION</label>
                    <div className="flex bg-zinc-900/50 p-0.5 rounded border border-zinc-800">
                        {['FULL', 'RTH'].map(type => (
                        <button
                            key={type}
                            onClick={() => setConfig(prev => ({ ...prev, sessionType: type }))}
                            className={`flex-1 py-1 text-[10px] rounded transition-all font-medium ${config.sessionType === type ? 'bg-zinc-800 text-white shadow-sm' : 'text-zinc-600 hover:text-zinc-400'}`}
                        >
                            {type === 'FULL' ? '24H' : 'RTH'}
                        </button>
                        ))}
                    </div>
                  </div>

                  {availableYears.length > 0 && (
                    <div className="space-y-2">
                        <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">YEARS</label>
                        <div className="flex flex-wrap gap-1.5">
                            {availableYears.map(y => (
                            <button
                                key={y}
                                onClick={() => toggleYear(y)}
                                className={`px-2 py-0.5 text-[10px] rounded border transition-all font-mono ${config.selectedYears.includes(y) ? 'bg-blue-500/10 border-blue-500/30 text-blue-400' : 'bg-transparent border-zinc-800 text-zinc-600 hover:border-zinc-700'}`}
                            >
                                {y}
                            </button>
                            ))}
                        </div>
                    </div>
                  )}
              </>
          )}

          {config.activeTab === 'STRATEGY' && (
              <>
                <div className="space-y-3">
                    {/* Saved Strategies */}
                    {/* Saved Strategies - Minimalist Dropdown */}
                    <div className="space-y-1.5 pb-2 border-b border-zinc-800/50">
                        {/* Row 1: Dropdown */}
                        <div className="relative group/select">
                            <select
                                onChange={(e) => {
                                    const selected = savedStrategies.find(s => s.id === e.target.value);
                                    if (selected) loadStrategy(selected);
                                }}
                                value={selectedStrategyId || ""}
                                className="w-full bg-zinc-900/80 border border-zinc-800 text-zinc-200 text-[11px] px-3 py-2 rounded-md focus:border-blue-500/50 outline-none appearance-none cursor-pointer hover:bg-zinc-800 transition-all text-right pr-3 pl-8"
                            >
                                <option value="" disabled={!!selectedStrategyId}>📁 {selectedStrategyId ? 'אסטרטגיה טעונה' : 'בחר אסטרטגיה...'}</option>
                                {savedStrategies.map(strategy => (
                                    <option key={strategy.id} value={strategy.id}>
                                        {strategy.name}
                                    </option>
                                ))}
                            </select>
                            <div className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-zinc-500">
                                <ChevronDown size={14} />
                            </div>
                        </div>

                        {/* Row 2: Action buttons */}
                        <div className="flex items-center gap-1.5">
                            <button
                                onClick={() => setShowSaveDialog(true)}
                                className="p-2 text-zinc-500 hover:text-blue-400 bg-zinc-900/50 hover:bg-zinc-800 border border-zinc-800 rounded-md transition-all group/saveas"
                                title="שמור כאסטרטגיה חדשה"
                            >
                                <Plus size={14} className="group-hover/saveas:scale-110 transition-transform" />
                            </button>

                            {selectedStrategyId && (
                                <button
                                    onClick={quickSaveStrategy}
                                    className="p-2 text-zinc-500 hover:text-blue-400 bg-zinc-900/50 hover:bg-zinc-800 border border-zinc-800 rounded-md transition-all group/save"
                                    title="שמור שינויים באסטרטגיה"
                                >
                                    <Save size={14} className="group-hover/save:scale-110 transition-transform" />
                                </button>
                            )}

                            {selectedStrategyId && (
                                <button
                                    onClick={() => deleteStrategy(selectedStrategyId)}
                                    className="p-2 text-zinc-500 hover:text-red-400 bg-zinc-900/50 hover:bg-zinc-800 border border-zinc-800 rounded-md transition-all group/delete"
                                    title="מחק אסטרטגיה"
                                >
                                    <Trash2 size={14} className="group-hover/delete:scale-110 transition-transform" />
                                </button>
                            )}

                            <div className="w-px h-5 bg-zinc-800 mx-0.5" />

                            <button
                                onClick={exportStrategies}
                                className="p-2 text-zinc-500 hover:text-emerald-400 bg-zinc-900/50 hover:bg-zinc-800 border border-zinc-800 rounded-md transition-all group/export"
                                title="ייצוא אסטרטגיות"
                            >
                                <Download size={14} className="group-hover/export:scale-110 transition-transform" />
                            </button>

                            <button
                                onClick={() => importInputRef.current?.click()}
                                className="p-2 text-zinc-500 hover:text-amber-400 bg-zinc-900/50 hover:bg-zinc-800 border border-zinc-800 rounded-md transition-all group/import"
                                title="ייבוא אסטרטגיות"
                            >
                                <Upload size={14} className="group-hover/import:scale-110 transition-transform" />
                            </button>
                            <input type="file" accept=".json" ref={importInputRef} onChange={importStrategies} className="hidden" />

                            <div className="w-px h-5 bg-zinc-800 mx-0.5" />

                            <button
                                onClick={resetStrategy}
                                className="p-2 text-zinc-500 hover:text-zinc-200 bg-zinc-900/50 hover:bg-zinc-800 border border-zinc-800 rounded-md transition-all group/reset"
                                title="חזור לברירת מחדל / סגור אסטרטגיה"
                            >
                                <RotateCcw size={14} className="group-hover/reset:rotate-[-45deg] transition-transform" />
                            </button>
                        </div>

                        {showSaveDialog && (
                            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
                                <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 w-80">
                                    <div className="flex items-center justify-between mb-3">
                                        <h3 className="text-xs font-bold text-zinc-200">שמור אסטרטגיה</h3>
                                        <button
                                            onClick={() => {
                                                setShowSaveDialog(false);
                                                setStrategyName('');
                                            }}
                                            className="text-zinc-500 hover:text-white transition-colors"
                                        >
                                            <X size={16} />
                                        </button>
                                    </div>
                                    <input
                                        type="text"
                                        value={strategyName}
                                        onChange={(e) => setStrategyName(e.target.value)}
                                        onKeyPress={(e) => e.key === 'Enter' && saveStrategy()}
                                        placeholder="שם האסטרטגיה"
                                        className="w-full bg-black border border-zinc-800 text-white text-xs px-3 py-2 rounded focus:border-blue-500 outline-none mb-3"
                                        autoFocus
                                    />
                                    <div className="flex gap-2">
                                        <button
                                            onClick={saveStrategy}
                                            className="flex-1 bg-blue-500 hover:bg-blue-600 text-white text-xs py-2 rounded transition-colors"
                                        >
                                            שמור
                                        </button>
                                        <button
                                            onClick={() => {
                                                setShowSaveDialog(false);
                                                setStrategyName('');
                                            }}
                                            className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-white text-xs py-2 rounded transition-colors"
                                        >
                                            ביטול
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Results - מופיע בחלק העליון */}
                    {results && (
                        <div className="space-y-3 pt-2 pb-3 border-b border-zinc-800 animate-in fade-in slide-in-from-top-2">
                            <div className="bg-zinc-900 border border-zinc-800 p-3 rounded flex flex-col items-center justify-center">
                                <span className="text-[9px] text-zinc-500 uppercase font-bold tracking-wider mb-1">Net Profit</span>
                                <span className={`text-lg font-mono font-bold ${results.stats.totalPnL >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                                    ${results.stats.totalPnL.toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 0})}
                                </span>
                            </div>

                            <div className="grid grid-cols-2 gap-2">
                                <div className="bg-zinc-900 border border-zinc-800 p-2 rounded flex flex-col items-center">
                                    <span className="text-[9px] text-zinc-500 uppercase mb-0.5">PF</span>
                                    <span className="text-xs font-mono font-bold text-blue-400">{results.stats.profitFactor.toFixed(2)}</span>
                                </div>
                                <div className="bg-zinc-900 border border-zinc-800 p-2 rounded flex flex-col items-center">
                                    <span className="text-[9px] text-zinc-500 uppercase mb-0.5">Max DD</span>
                                    <span className="text-xs font-mono font-bold text-red-500">-${results.stats.maxDrawdown.toLocaleString(undefined, {maximumFractionDigits: 0})}</span>
                                </div>
                                <div className="bg-zinc-900 border border-zinc-800 p-2 rounded flex flex-col items-center">
                                    <span className="text-[9px] text-zinc-500 uppercase mb-0.5">Win Rate</span>
                                    <span className={`text-xs font-mono font-bold ${results.stats.winRate >= 50 ? 'text-green-500' : 'text-zinc-500'}`}>
                                        {results.stats.winRate.toFixed(1)}%
                                    </span>
                                </div>
                                <div className="bg-zinc-900 border border-zinc-800 p-2 rounded flex flex-col items-center">
                                    <span className="text-[9px] text-zinc-500 uppercase mb-0.5">Trades</span>
                                    <span className="text-xs font-mono font-bold text-zinc-300">{results.stats.totalTrades}</span>
                                </div>
                            </div>
                            
                            <button 
                                onClick={() => setShowReport(true)}
                                className="w-full py-2 border border-zinc-800 hover:border-zinc-600 bg-zinc-900/30 hover:bg-zinc-900 rounded text-[10px] text-zinc-400 hover:text-white transition-all flex items-center justify-center gap-2 font-medium tracking-wide"
                            >
                                <Table size={12} /> DETAILED REPORT
                            </button>
                        </div>
                    )}

                    {/* Entry Conditions */}
                    <div>
                        <div className="mb-1.5 flex items-center justify-between">
                            <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Entry</span>
                            <div className="flex items-center gap-1">
                                <button
                                    onClick={() => {
                                        const allEnabled = (strategyConfig.entryConditions || []).every(c => c.enabled !== false);
                                        toggleAllConditions(!allEnabled, 'entry');
                                    }}
                                    className="text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors p-0.5"
                                    title={(strategyConfig.entryConditions || []).every(c => c.enabled !== false) ? 'נטרל הכל' : 'הפעל הכל'}
                                >
                                    {(strategyConfig.entryConditions || []).every(c => c.enabled !== false) ? <PowerOff size={12} /> : <Power size={12} />}
                                </button>
                                <button
                                    onClick={() => {
                                        setStrategyConfig(p => ({
                                            ...p,
                                            entryConditions: [...(p.entryConditions || []), { id: '', params: {}, visible: true }]
                                        }));
                                    }}
                                    className="text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors"
                                >
                                    <Plus size={12} />
                                </button>
                            </div>
                        </div>
                        <div className="space-y-2">
                            {(strategyConfig.entryConditions || []).map((condition, idx) => (
                                <div key={idx} className="space-y-1.5">
                                    <div className="flex items-center gap-1.5">
                                        <button
                                            onClick={() => {
                                                const newConditions = [...(strategyConfig.entryConditions || [])];
                                                newConditions[idx] = { ...newConditions[idx], enabled: !(newConditions[idx].enabled !== false) };
                                                setStrategyConfig(p => ({ ...p, entryConditions: newConditions }));
                                            }}
                                            className={`p-1 transition-colors ${condition.enabled !== false ? 'text-green-500 hover:text-green-400' : 'text-zinc-600 hover:text-zinc-500'}`}
                                            title={condition.enabled !== false ? 'מופעל' : 'מושבת'}
                                        >
                                            {condition.enabled !== false ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
                                        </button>

                                        <button
                                            onClick={() => {
                                                const newConditions = [...(strategyConfig.entryConditions || [])];
                                                newConditions[idx] = { ...newConditions[idx], visible: !(newConditions[idx].visible !== false) };
                                                setStrategyConfig(p => ({ ...p, entryConditions: newConditions }));
                                            }}
                                            className={`p-1 transition-colors ${condition.visible !== false ? 'text-blue-400 hover:text-blue-300' : 'text-zinc-600 hover:text-zinc-500'}`}
                                            title={condition.visible !== false ? 'מוצג בגרף' : 'מוסתר מהגרף'}
                                        >
                                            {condition.visible !== false ? <Eye size={14} /> : <EyeOff size={14} />}
                                        </button>
                                        
                                        <select
                                            value={condition.timeframe || ''}
                                            onChange={(e) => {
                                                const newConditions = [...(strategyConfig.entryConditions || [])];
                                                newConditions[idx] = { ...newConditions[idx], timeframe: e.target.value || null };
                                                setStrategyConfig(p => ({ ...p, entryConditions: newConditions }));
                                            }}
                                            className="bg-zinc-900 border border-zinc-800 text-[9px] text-zinc-400 px-1 py-0.5 rounded focus:border-zinc-700 outline-none w-14 appearance-none text-center hover:text-zinc-200 transition-colors"
                                        >
                                            <option value="">DEF</option>
                                            <option value="1">1m</option>
                                            <option value="5">5m</option>
                                            <option value="15">15m</option>
                                            <option value="30">30m</option>
                                            <option value="60">60m</option>
                                        </select>

                                        <select
                                            value={condition.id || ''}
                                            onChange={(e) => {
                                                const cond = getConditionById(e.target.value);
                                                const defaultParams = {};
                                                if (cond?.params) {
                                                    cond.params.forEach(p => {
                                                        defaultParams[p.name] = p.default;
                                                    });
                                                }
                                                const newConditions = [...(strategyConfig.entryConditions || [])];
                                                newConditions[idx] = { id: e.target.value || '', params: defaultParams, enabled: newConditions[idx].enabled !== false, visible: true };
                                                setStrategyConfig(p => ({ ...p, entryConditions: newConditions }));
                                            }}
                                            className="flex-1 bg-black border border-zinc-800 text-white text-xs px-2 py-1.5 rounded focus:border-zinc-700 outline-none"
                                        >
                                            <option value="">--</option>
                                            {CATEGORIES.map(category => {
                                                const categoryConditions = CONDITIONS[category] || [];
                                                if (categoryConditions.length === 0) return null;
                                                return (
                                                    <optgroup key={category} label={category}>
                                                        {categoryConditions.map(cond => (
                                    <option key={cond.id} value={cond.id}>
                                                                {cond.name}
                                    </option>
                                ))}
                                                    </optgroup>
                                                );
                                            })}
                            </select>
                                        {(strategyConfig.entryConditions || []).length > 1 && (
                                            <button
                                                onClick={() => {
                                                    const newConditions = (strategyConfig.entryConditions || []).filter((_, i) => i !== idx);
                                                    setStrategyConfig(p => ({ ...p, entryConditions: newConditions }));
                                                }}
                                                className="text-zinc-500 hover:text-red-400 transition-colors p-1"
                                            >
                                                <X size={14} />
                                            </button>
                                        )}
                                    </div>
                                    {condition.id && (() => {
                                        const cond = getConditionById(condition.id);
                                        if (cond?.params && cond.params.length > 0) {
                                            return (
                                                <div className="ml-0 space-y-1.5">
                                                    {cond.params.map(param => (
                                                        <div key={param.name} className="flex items-center gap-2">
                                                            <label className="text-[10px] text-zinc-500 w-12">{param.name}</label>
                                                            <input
                                                                type="text"
                                                                value={condition.params?.[param.name] ?? param.default}
                                                                onChange={(e) => {
                                                                    let value = e.target.value;
                                                                    // בדיקה אם זה פורמט אופטימיזציה
                                                                    const optRange = parseOptimizationRange(value);
                                                                    if (optRange || value === '' || !isNaN(parseFloat(value))) {
                                                                        const newConditions = [...(strategyConfig.entryConditions || [])];
                                                                        newConditions[idx] = {
                                                                            ...newConditions[idx],
                                                                            params: { ...newConditions[idx].params, [param.name]: value }
                                                                        };
                                                                        setStrategyConfig(p => ({ ...p, entryConditions: newConditions }));
                                                                    }
                                                                }}
                                                                placeholder={param.name === 'time' ? '840 או 500;1500;100' : `${param.default} או ${param.min};${param.max};${param.step || 1}`}
                                                                className="flex-1 bg-black border border-zinc-800 text-white text-xs px-2 py-1 rounded focus:border-zinc-700 outline-none"
                                                            />
                                                        </div>
                                                    ))}
                                                </div>
                                            );
                                        }
                                        return null;
                                    })()}
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Exit Conditions */}
                    <div>
                        <div className="mb-1.5 flex items-center justify-between">
                            <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Exit</span>
                            <div className="flex items-center gap-1">
                                <button
                                    onClick={() => {
                                        const allEnabled = (strategyConfig.exitConditions || []).every(c => c.enabled !== false);
                                        toggleAllConditions(!allEnabled, 'exit');
                                    }}
                                    className="text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors p-0.5"
                                    title={(strategyConfig.exitConditions || []).every(c => c.enabled !== false) ? 'נטרל הכל' : 'הפעל הכל'}
                                >
                                    {(strategyConfig.exitConditions || []).every(c => c.enabled !== false) ? <PowerOff size={12} /> : <Power size={12} />}
                                </button>
                                <button
                                    onClick={() => {
                                        setStrategyConfig(p => ({
                                            ...p,
                                            exitConditions: [...(p.exitConditions || []), { id: '', params: {}, visible: true }]
                                        }));
                                    }}
                                    className="text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors"
                                >
                                    <Plus size={12} />
                                </button>
                            </div>
                        </div>
                        <div className="space-y-2">
                            {(strategyConfig.exitConditions || []).map((condition, idx) => (
                                <div key={idx} className="space-y-1.5">
                                    <div className="flex items-center gap-1.5">
                                        <button
                                            onClick={() => {
                                                const newConditions = [...(strategyConfig.exitConditions || [])];
                                                newConditions[idx] = { ...newConditions[idx], enabled: !(newConditions[idx].enabled !== false) };
                                                setStrategyConfig(p => ({ ...p, exitConditions: newConditions }));
                                            }}
                                            className={`p-1 transition-colors ${condition.enabled !== false ? 'text-green-500 hover:text-green-400' : 'text-zinc-600 hover:text-zinc-500'}`}
                                            title={condition.enabled !== false ? 'מופעל' : 'מושבת'}
                                        >
                                            {condition.enabled !== false ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
                                        </button>

                                        <button
                                            onClick={() => {
                                                const newConditions = [...(strategyConfig.exitConditions || [])];
                                                newConditions[idx] = { ...newConditions[idx], visible: !(newConditions[idx].visible !== false) };
                                                setStrategyConfig(p => ({ ...p, exitConditions: newConditions }));
                                            }}
                                            className={`p-1 transition-colors ${condition.visible !== false ? 'text-blue-400 hover:text-blue-300' : 'text-zinc-600 hover:text-zinc-500'}`}
                                            title={condition.visible !== false ? 'מוצג בגרף' : 'מוסתר מהגרף'}
                                        >
                                            {condition.visible !== false ? <Eye size={14} /> : <EyeOff size={14} />}
                                        </button>

                                        <select
                                            value={condition.timeframe || ''}
                                            onChange={(e) => {
                                                const newConditions = [...(strategyConfig.exitConditions || [])];
                                                newConditions[idx] = { ...newConditions[idx], timeframe: e.target.value || null };
                                                setStrategyConfig(p => ({ ...p, exitConditions: newConditions }));
                                            }}
                                            className="bg-zinc-900 border border-zinc-800 text-[9px] text-zinc-400 px-1 py-0.5 rounded focus:border-zinc-700 outline-none w-14 appearance-none text-center hover:text-zinc-200 transition-colors"
                                        >
                                            <option value="">DEF</option>
                                            <option value="1">1m</option>
                                            <option value="5">5m</option>
                                            <option value="15">15m</option>
                                            <option value="30">30m</option>
                                            <option value="60">60m</option>
                                        </select>

                            <select
                                            value={condition.id || ''}
                                            onChange={(e) => {
                                                const cond = getConditionById(e.target.value);
                                                const defaultParams = {};
                                                if (cond?.params) {
                                                    cond.params.forEach(p => {
                                                        defaultParams[p.name] = p.default;
                                                    });
                                                }
                                                const newConditions = [...(strategyConfig.exitConditions || [])];
                                                newConditions[idx] = { id: e.target.value || '', params: defaultParams, enabled: newConditions[idx].enabled !== false, visible: true };
                                                setStrategyConfig(p => ({ ...p, exitConditions: newConditions }));
                                            }}
                                            className="flex-1 bg-black border border-zinc-800 text-white text-xs px-2 py-1.5 rounded focus:border-zinc-700 outline-none"
                                        >
                                            <option value="">--</option>
                                            {CATEGORIES.map(category => {
                                                const categoryConditions = CONDITIONS[category] || [];
                                                if (categoryConditions.length === 0) return null;
                                                return (
                                                    <optgroup key={category} label={category}>
                                                        {categoryConditions.map(cond => (
                                    <option key={cond.id} value={cond.id}>
                                                                {cond.name}
                                    </option>
                                ))}
                                                    </optgroup>
                                                );
                                            })}
                            </select>
                                        {(strategyConfig.exitConditions || []).length > 1 && (
                                            <button
                                                onClick={() => {
                                                    const newConditions = (strategyConfig.exitConditions || []).filter((_, i) => i !== idx);
                                                    setStrategyConfig(p => ({ ...p, exitConditions: newConditions }));
                                                }}
                                                className="text-zinc-500 hover:text-red-400 transition-colors p-1"
                                            >
                                                <X size={14} />
                                            </button>
                                        )}
                                    </div>
                                    {condition.id && (() => {
                                        const cond = getConditionById(condition.id);
                                        if (cond?.params && cond.params.length > 0) {
                                            return (
                                                <div className="ml-0 space-y-1.5">
                                                    {cond.params.map(param => (
                                                        <div key={param.name} className="flex items-center gap-2">
                                                            <label className="text-[10px] text-zinc-500 w-12">{param.name}</label>
                                                            <input
                                                                type="text"
                                                                value={condition.params?.[param.name] ?? param.default}
                                                                onChange={(e) => {
                                                                    let value = e.target.value;
                                                                    // בדיקה אם זה פורמט אופטימיזציה
                                                                    const optRange = parseOptimizationRange(value);
                                                                    if (optRange || value === '' || !isNaN(parseFloat(value))) {
                                                                        const newConditions = [...(strategyConfig.exitConditions || [])];
                                                                        newConditions[idx] = {
                                                                            ...newConditions[idx],
                                                                            params: { ...newConditions[idx].params, [param.name]: value }
                                                                        };
                                                                        setStrategyConfig(p => ({ ...p, exitConditions: newConditions }));
                                                                    }
                                                                }}
                                                                placeholder={param.name === 'time' ? '840 או 500;1500;100' : `${param.default} או ${param.min};${param.max};${param.step || 1}`}
                                                                className="flex-1 bg-black border border-zinc-800 text-white text-xs px-2 py-1 rounded focus:border-zinc-700 outline-none"
                                                            />
                                                        </div>
                                                    ))}
                                                </div>
                                            );
                                        }
                                        return null;
                                    })()}
                                </div>
                            ))}
                        </div>
                    </div>


                    {optimizationResults && optimizationResults.length > 0 && (
                        <div className="mt-3 space-y-2 border-t border-zinc-800 pt-3">
                            <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Top Results</div>
                            <div className="max-h-64 overflow-y-auto space-y-1">
                                {optimizationResults.slice(0, 10).map((result, idx) => (
                                    <div 
                                        key={idx}
                                        onClick={() => {
                                            setResults({
                                                trades: result.trades,
                                                stats: result.stats
                                            });
                                        }}
                                        className="p-2 bg-zinc-900/50 border border-zinc-800 rounded cursor-pointer hover:border-zinc-700 transition-colors"
                                    >
                                        <div className="text-[9px] text-zinc-400 mb-1">{result.params}</div>
                                        <div className="flex items-center justify-between">
                                            <span className="text-[10px] text-zinc-500">Net:</span>
                                            <span className={`text-xs font-mono ${result.stats.totalPnL >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                                                ${result.stats.totalPnL.toFixed(0)}
                                            </span>
                                        </div>
                                        <div className="flex items-center justify-between mt-0.5">
                                            <span className="text-[10px] text-zinc-500">Trades:</span>
                                            <span className="text-xs font-mono text-zinc-300">{result.stats.totalTrades}</span>
                                        </div>
                                        <div className="flex items-center justify-between mt-0.5">
                                            <span className="text-[10px] text-zinc-500">WR:</span>
                                            <span className="text-xs font-mono text-zinc-300">{result.stats.winRate.toFixed(1)}%</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                </div>
              </>
          )}
        </div>
        
        {/* Fixed Footer - Run Button רק בטאב STRATEGY */}
        {config.activeTab === 'STRATEGY' && (
          <div className="sticky bottom-0 left-0 right-0 z-30 border-t border-zinc-800 bg-black/95 backdrop-blur-sm">
            <div className="flex items-center justify-between px-4 py-2.5">
              <div className="text-[9px] text-zinc-700 font-mono tracking-wider select-none">
                V6.0 STABLE
              </div>
              
              <button 
                onClick={handleRunStrategy}
                disabled={!isDataLoaded || isRunningBacktest}
                className={`flex items-center gap-2 px-6 py-2 rounded-md text-xs font-medium transition-all ${
                  isDataLoaded && !isRunningBacktest 
                    ? 'bg-zinc-800 hover:bg-zinc-700 text-white border border-zinc-700' 
                    : 'bg-zinc-900 text-zinc-600 cursor-not-allowed border border-zinc-800'
                }`}
              >
                {isRunningBacktest ? (
                  <>
                    <div className="w-4 h-4 border-2 border-zinc-600 border-t-blue-400 rounded-full animate-spin" />
                    <span>{isOptimizing ? `Optimizing ${optimizationProgress.current}/${optimizationProgress.total}` : 'Running...'}</span>
                  </>
                ) : (
                  <>
                    <Play size={14} className={isDataLoaded ? 'text-white' : 'text-zinc-600'} />
                    <span>Run</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}
        
        {/* Footer רגיל לטאב DATA */}
        {config.activeTab === 'DATA' && (
          <div className="p-3 border-t border-zinc-900 text-[9px] text-zinc-700 text-center font-mono tracking-wider select-none bg-black">
            V6.0 STABLE
          </div>
        )}
      </div>

      <div className="flex-1 flex flex-col relative h-full">
        {currentPage === 'MAIN' ? (
          <>
            <div className="h-12 border-b border-zinc-900 bg-black flex items-center justify-between px-4 z-10 select-none">
               <div className="flex items-center gap-4">
                  <span className="text-xs font-bold text-zinc-200 tracking-wider">NQ FUTURES</span>
                  <span className="text-[10px] font-mono px-2 py-0.5 bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded">
                    {config.primaryTimeframe}M
                  </span>
                  <span className="text-[10px] font-mono px-2 py-0.5 bg-zinc-900 text-zinc-500 border border-zinc-800 rounded">
                    {config.sessionType}
                  </span>
               </div>
               
               <div className="flex items-center gap-2">
                  {/* Zoom Controls */}
                  <div className="flex items-center gap-1 border-r border-zinc-800 pr-2 mr-2">
                    <button
                      onClick={handleZoomOut}
                      disabled={!isDataLoaded}
                      className="p-1.5 rounded hover:bg-zinc-900 text-zinc-500 hover:text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                      title="Zoom Out"
                    >
                      <Minus size={14} />
                    </button>
                    <button
                      onClick={handleZoomIn}
                      disabled={!isDataLoaded}
                      className="p-1.5 rounded hover:bg-zinc-900 text-zinc-500 hover:text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                      title="Zoom In"
                    >
                      <Plus size={14} />
                    </button>
                    <button
                      onClick={handlePanLeft}
                      disabled={!isDataLoaded}
                      className="p-1.5 rounded hover:bg-zinc-900 text-zinc-500 hover:text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                      title="Pan Left"
                    >
                      <ChevronLeft size={14} />
                    </button>
                    <button
                      onClick={handlePanRight}
                      disabled={!isDataLoaded}
                      className="p-1.5 rounded hover:bg-zinc-900 text-zinc-500 hover:text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                      title="Pan Right"
                    >
                      <ChevronRight size={14} />
                    </button>
                    <button
                      onClick={() => {
                        if (chartInstance.current) chartInstance.current.timeScale().fitContent();
                        if (secondaryChartInstance.current) secondaryChartInstance.current.timeScale().fitContent();
                      }}
                      disabled={!isDataLoaded}
                      className="p-1.5 rounded hover:bg-zinc-900 text-zinc-500 hover:text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                      title="Reset Zoom"
                    >
                      <RotateCcw size={14} />
                    </button>
                    <button
                      onClick={handleToggleClickZoom}
                      disabled={!isDataLoaded}
                      className={`p-1.5 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
                        isClickZoomMode
                          ? 'bg-blue-500/20 text-blue-400 hover:bg-blue-500/30'
                          : 'hover:bg-zinc-900 text-zinc-500 hover:text-white'
                      }`}
                      title="Click to Zoom"
                    >
                      <ZoomIn size={14} />
                    </button>
                  </div>
                  
                  <button 
                    onClick={() => setConfig(prev => ({ ...prev, showSidebar: !prev.showSidebar }))}
                    className="p-1.5 rounded hover:bg-zinc-900 text-zinc-500 hover:text-white transition-colors"
                  >
                    {config.showSidebar ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
                  </button>
               </div>
            </div>

            <div className="flex-1 relative w-full h-full overflow-hidden flex flex-col">
               <div className={`${config.showSecondaryChart ? 'flex-[2]' : 'flex-1'} relative transition-all duration-300`}>
                 <div 
                   ref={chartContainerRef} 
                   className={`absolute inset-0 w-full h-full ${isClickZoomMode ? 'cursor-pointer' : ''}`}
                 />
                 <div className="absolute top-2 left-2 z-10 px-2 py-0.5 bg-black/50 backdrop-blur-sm border border-zinc-800 rounded text-[10px] text-blue-400 font-mono">
                   PRIMARY: {config.primaryTimeframe}m
                 </div>
               </div>

               <div className={`flex flex-col transition-all duration-300 overflow-hidden ${config.showSecondaryChart ? 'flex-1 border-t border-zinc-800' : 'h-0 opacity-0'}`}>
                 <div className="flex-1 relative">
                   <div 
                     ref={secondaryChartContainerRef} 
                     className="absolute inset-0 w-full h-full"
                   />
                   <div className="absolute top-2 left-2 z-10 px-2 py-0.5 bg-black/50 backdrop-blur-sm border border-zinc-800 rounded text-[10px] text-zinc-400 font-mono">
                     SECONDARY: {config.secondaryTimeframe}m
                   </div>
                 </div>
               </div>
               
               {/* Data Box Tooltip */}
               {crosshairData && (
                 <div 
                   className="absolute z-50 bg-zinc-900/95 border border-zinc-700 rounded-lg p-3 shadow-xl pointer-events-none"
                   style={{
                     left: `${mousePosition.x + 15}px`,
                     top: `${mousePosition.y - 10}px`,
                     transform: mousePosition.x > window.innerWidth - 250 ? 'translateX(-100%)' : 'none'
                   }}
                 >
                   <div className="space-y-2 min-w-[200px]">
                     {/* Time */}
                     <div className="border-b border-zinc-800 pb-1.5">
                       <div className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider mb-0.5">Time</div>
                       <div className="text-xs font-mono text-zinc-200">
                         {new Date(crosshairData.time * 1000).toLocaleString('en-GB', {
                           day: '2-digit',
                           month: '2-digit',
                           year: 'numeric',
                           hour: '2-digit',
                           minute: '2-digit',
                           timeZone: 'UTC'
                         })}
                       </div>
                     </div>

                     {/* OHLC */}
                     <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                       <div>
                         <div className="text-[9px] text-zinc-500 uppercase mb-0.5">Open</div>
                         <div className="text-zinc-300">{crosshairData.open.toFixed(2)}</div>
                       </div>
                       <div>
                         <div className="text-[9px] text-zinc-500 uppercase mb-0.5">High</div>
                         <div className="text-green-500">{crosshairData.high.toFixed(2)}</div>
                       </div>
                       <div>
                         <div className="text-[9px] text-zinc-500 uppercase mb-0.5">Low</div>
                         <div className="text-red-500">{crosshairData.low.toFixed(2)}</div>
                       </div>
                       <div>
                         <div className="text-[9px] text-zinc-500 uppercase mb-0.5">Close</div>
                         <div className={`${crosshairData.close >= crosshairData.open ? 'text-green-500' : 'text-red-500'}`}>
                           {crosshairData.close.toFixed(2)}
                         </div>
                       </div>
                     </div>

                     {/* Volume */}
                     <div className="border-t border-zinc-800 pt-1.5">
                       <div className="text-[9px] text-zinc-500 uppercase mb-0.5">Volume</div>
                       <div className="text-xs font-mono text-zinc-300">
                         {crosshairData.volume.toLocaleString()}
                       </div>
                     </div>

                     {/* Indicators */}
                     {Object.keys(crosshairData.indicators).length > 0 && (
                       <div className="border-t border-zinc-800 pt-1.5 space-y-1">
                         <div className="text-[9px] text-zinc-500 uppercase font-bold tracking-wider mb-1">Indicators</div>
                         {crosshairData.indicators.rsi && (
                           <div className="flex justify-between text-xs">
                             <span className="text-zinc-400">RSI</span>
                             <span className="font-mono text-zinc-200">{crosshairData.indicators.rsi}</span>
                           </div>
                         )}
                         {crosshairData.indicators.macd !== undefined && (
                           <div className="flex justify-between text-xs">
                             <span className="text-zinc-400">MACD</span>
                             <span className="font-mono text-zinc-200">{crosshairData.indicators.macd}</span>
                           </div>
                         )}
                         {crosshairData.indicators.macdSignal !== undefined && (
                           <div className="flex justify-between text-xs">
                             <span className="text-zinc-400">Signal</span>
                             <span className="font-mono text-zinc-200">{crosshairData.indicators.macdSignal}</span>
                           </div>
                         )}
                         {crosshairData.indicators.stochK !== undefined && (
                           <div className="flex justify-between text-xs">
                             <span className="text-zinc-400">Stoch K</span>
                             <span className="font-mono text-zinc-200">{crosshairData.indicators.stochK}</span>
                           </div>
                         )}
                         {crosshairData.indicators.stochD !== undefined && (
                           <div className="flex justify-between text-xs">
                             <span className="text-zinc-400">Stoch D</span>
                             <span className="font-mono text-zinc-200">{crosshairData.indicators.stochD}</span>
                           </div>
                         )}
                         {crosshairData.indicators.sma20 !== undefined && (
                           <div className="flex justify-between text-xs">
                             <span className="text-zinc-400">SMA(20)</span>
                             <span className="font-mono text-zinc-200">{crosshairData.indicators.sma20}</span>
                           </div>
                         )}
                         {crosshairData.indicators.sma50 !== undefined && (
                           <div className="flex justify-between text-xs">
                             <span className="text-zinc-400">SMA(50)</span>
                             <span className="font-mono text-zinc-200">{crosshairData.indicators.sma50}</span>
                           </div>
                         )}
                         {crosshairData.indicators.ema20 !== undefined && (
                           <div className="flex justify-between text-xs">
                             <span className="text-zinc-400">EMA(20)</span>
                             <span className="font-mono text-zinc-200">{crosshairData.indicators.ema20}</span>
                           </div>
                         )}
                         {crosshairData.indicators.ema50 !== undefined && (
                           <div className="flex justify-between text-xs">
                             <span className="text-zinc-400">EMA(50)</span>
                             <span className="font-mono text-zinc-200">{crosshairData.indicators.ema50}</span>
                           </div>
                         )}
                       </div>
                     )}
                   </div>
                 </div>
               )}
               
               {!isDataLoaded && !loading && (
                 <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none z-20 opacity-20">
                   <div className="w-12 h-12 bg-zinc-900 rounded-full flex items-center justify-center border border-zinc-800">
                      <BarChart2 className="text-zinc-700" size={24} />
                   </div>
                 </div>
               )}

               {loading && (
                 <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-30 backdrop-blur-sm">
                    <div className="flex flex-col items-center gap-3">
                       <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                       <span className="text-[10px] font-mono text-blue-500 tracking-wider animate-pulse">
                         {loadingMessage || 'PROCESSING...'}
                       </span>
                    </div>
                 </div>
               )}
            </div>
          </>
        ) : (
          <ReportAnalyzer onBack={() => setCurrentPage('MAIN')} />
        )}
      </div>
    </div>
  );
}

