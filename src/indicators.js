// --- חישוב אינדיקטורים טכניים ---

// SMA - Simple Moving Average
export const calculateSMA = (data, period) => {
  const sma = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      sma.push(null);
    } else {
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) {
        sum += data[j].close;
      }
      sma.push(sum / period);
    }
  }
  return sma;
};

// EMA - Exponential Moving Average (תואם לנינג'ה טריידר)
export const calculateEMA = (data, period) => {
  const ema = [];
  const multiplier = 2 / (period + 1);
  
  if (data.length < period) {
    return data.map(() => null);
  }
  
  // Fill nulls for first period-1 values
  for (let i = 0; i < period - 1; i++) {
    ema[i] = null;
  }
  
  // First EMA value is SMA of first period values
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += data[i].close;
  }
  ema[period - 1] = sum / period;
  
  // Calculate EMA for rest using: EMA = (Close - Previous EMA) * Multiplier + Previous EMA
  for (let i = period; i < data.length; i++) {
    ema[i] = (data[i].close - ema[i - 1]) * multiplier + ema[i - 1];
  }
  
  return ema;
};

// RSI - Relative Strength Index (תואם לנינג'ה טריידר)
export const calculateRSI = (data, period = 14) => {
  const rsi = [];
  
  if (data.length < period + 1) {
    return data.map(() => null);
  }
  
  // Calculate price changes
  const changes = [];
  for (let i = 1; i < data.length; i++) {
    changes.push(data[i].close - data[i - 1].close);
  }
  
  // Calculate initial average gain/loss (SMA of first period changes)
  let sumGain = 0;
  let sumLoss = 0;
  for (let i = 0; i < period; i++) {
    if (changes[i] > 0) {
      sumGain += changes[i];
    } else {
      sumLoss += Math.abs(changes[i]);
    }
  }
  
  let avgGain = sumGain / period;
  let avgLoss = sumLoss / period;
  
  // Fill nulls for first period values
  for (let i = 0; i < period; i++) {
    rsi[i] = null;
  }
  
  // First RSI value at index period
  if (avgLoss === 0) {
    rsi[period] = 100;
  } else {
    const rs = avgGain / avgLoss;
    rsi[period] = 100 - (100 / (1 + rs));
  }
  
  // Calculate RSI for rest using Wilder's smoothing (תואם לנינג'ה טריידר)
  for (let i = period + 1; i < data.length; i++) {
    // changes[i-1] corresponds to the change from data[i-1] to data[i]
    const change = changes[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;
    
    // Wilder's smoothing: (previous_avg * (period - 1) + current_value) / period
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    
    if (avgLoss === 0) {
      rsi[i] = 100;
    } else {
      const rs = avgGain / avgLoss;
      rsi[i] = 100 - (100 / (1 + rs));
    }
  }
  
  return rsi;
};

// MACD - תואם לנינג'ה טריידר
// Signal Line = EMA של קו ה-MACD בלבד מערכים תקינים (ללא מילוי 0 שעיוות את החישוב)
export const calculateMACD = (data, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) => {
  const fastEMA = calculateEMA(data, fastPeriod);
  const slowEMA = calculateEMA(data, slowPeriod);
  
  // MACD Line = Fast EMA - Slow EMA
  const macdLine = [];
  for (let i = 0; i < data.length; i++) {
    if (fastEMA[i] !== null && slowEMA[i] !== null) {
      macdLine[i] = fastEMA[i] - slowEMA[i];
    } else {
      macdLine[i] = null;
    }
  }
  
  // Signal Line = EMA of MACD Line (רק מערכים תקינים - כמו NinjaTrader)
  // ה-EMA מתחיל רק כשקו MACD תקין (אחרי slowPeriod-1)
  const signalLine = new Array(data.length).fill(null);
  const firstValidMacdIdx = slowPeriod - 1;
  if (firstValidMacdIdx + signalPeriod <= data.length) {
    const macdValid = macdLine.slice(firstValidMacdIdx).map(v => v);
    const macdData = macdValid.map((v, i) => ({ close: v, time: data[firstValidMacdIdx + i].time }));
    const signalValid = calculateEMA(macdData, signalPeriod);
    for (let i = 0; i < signalValid.length; i++) {
      signalLine[firstValidMacdIdx + i] = signalValid[i];
    }
  }
  
  // Histogram = MACD Line - Signal Line
  const histogram = [];
  for (let i = 0; i < data.length; i++) {
    if (macdLine[i] !== null && signalLine[i] !== null) {
      histogram[i] = macdLine[i] - signalLine[i];
    } else {
      histogram[i] = null;
    }
  }
  
  return {
    macd: macdLine,
    signal: signalLine,
    histogram: histogram
  };
};

// Bollinger Bands - תואם לנינג'ה טריידר
export const calculateBollingerBands = (data, period = 20, stdDev = 2) => {
  const sma = calculateSMA(data, period);
  const upper = [];
  const lower = [];
  const middle = sma;
  
  // Calculate standard deviation for each period
  for (let i = period - 1; i < data.length; i++) {
    let sumSquaredDiff = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const diff = data[j].close - sma[i];
      sumSquaredDiff += diff * diff;
    }
    // Population standard deviation (תואם לנינג'ה טריידר)
    const variance = sumSquaredDiff / period;
    const stdDeviation = Math.sqrt(variance);
    
    upper[i] = sma[i] + (stdDeviation * stdDev);
    lower[i] = sma[i] - (stdDeviation * stdDev);
  }
  
  // Fill nulls
  for (let i = 0; i < period - 1; i++) {
    upper[i] = null;
    lower[i] = null;
  }
  
  return { upper, middle, lower };
};

// Stochastic Oscillator - תואם לנינג'ה טריידר
export const calculateStochastic = (data, kPeriod = 14, dPeriod = 3, smoothPeriod = 3) => {
  const rawK = [];
  const k = [];
  const d = [];
  
  if (data.length < kPeriod) {
    return { k: data.map(() => null), d: data.map(() => null) };
  }
  
  // שלב 1: חישוב %K גולמי (Raw %K)
  for (let i = kPeriod - 1; i < data.length; i++) {
    let highest = -Infinity;
    let lowest = Infinity;
    
    // מציאת High ו-Low הגבוהים/נמוכים ביותר בתקופה
    for (let j = i - kPeriod + 1; j <= i; j++) {
      if (data[j].high > highest) highest = data[j].high;
      if (data[j].low < lowest) lowest = data[j].low;
    }
    
    const currentClose = data[i].close;
    if (highest === lowest) {
      rawK[i] = 50; // אם אין תנודה, מחזירים 50
    } else {
      rawK[i] = ((currentClose - lowest) / (highest - lowest)) * 100;
    }
  }
  
  // Fill nulls for rawK
  for (let i = 0; i < kPeriod - 1; i++) {
    rawK[i] = null;
  }
  
  // שלב 2: Smoothing של %K (SMA של rawK - תואם לנינג'ה טריידר)
  if (smoothPeriod > 1) {
    // Fill nulls for first kPeriod - 1 + smoothPeriod - 1 values
    for (let i = 0; i < kPeriod - 1 + smoothPeriod - 1; i++) {
      k[i] = null;
    }
    
    // Calculate smoothed K (SMA of rawK)
    for (let i = kPeriod - 1 + smoothPeriod - 1; i < data.length; i++) {
      let sum = 0;
      for (let j = i - smoothPeriod + 1; j <= i; j++) {
        sum += rawK[j];
      }
      k[i] = sum / smoothPeriod;
    }
  } else {
    // ללא smoothing - משתמש ב-rawK ישירות
    for (let i = 0; i < data.length; i++) {
      k[i] = rawK[i] !== undefined ? rawK[i] : null;
    }
  }
  
  // שלב 3: חישוב %D (SMA של %K המחולח)
  const kStartIndex = smoothPeriod > 1 ? kPeriod - 1 + smoothPeriod - 1 : kPeriod - 1;
  const dStartIndex = kStartIndex + dPeriod - 1;
  
  // Fill nulls for D
  for (let i = 0; i < dStartIndex; i++) {
    d[i] = null;
  }
  
  // Calculate D (SMA of smoothed K)
  for (let i = dStartIndex; i < data.length; i++) {
    let sum = 0;
    let count = 0;
    for (let j = i - dPeriod + 1; j <= i; j++) {
      if (k[j] !== null) {
        sum += k[j];
        count++;
      }
    }
    d[i] = count > 0 ? sum / count : null;
  }
  
  return { k, d };
};

// ATR - Average True Range
export const calculateATR = (data, period = 14) => {
  const tr = [];
  const atr = [];
  
  // Calculate True Range
  for (let i = 1; i < data.length; i++) {
    const highLow = data[i].high - data[i].low;
    const highClose = Math.abs(data[i].high - data[i - 1].close);
    const lowClose = Math.abs(data[i].low - data[i - 1].close);
    tr[i] = Math.max(highLow, highClose, lowClose);
  }
  
  // First ATR is average of first period TRs
  let sum = 0;
  for (let i = 1; i <= period && i < data.length; i++) {
    sum += tr[i];
  }
  if (data.length > period) {
    atr[period] = sum / period;
  }
  
  // Calculate ATR using Wilder's smoothing
  for (let i = period + 1; i < data.length; i++) {
    atr[i] = (atr[i - 1] * (period - 1) + tr[i]) / period;
  }
  
  // Fill nulls
  for (let i = 0; i <= period; i++) {
    atr[i] = null;
  }
  atr[0] = null;
  
  return atr;
};

// Volume Average
export const calculateVolumeAverage = (data, period = 20) => {
  const avg = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      avg[i] = null;
    } else {
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) {
        sum += data[j].volume || 0;
      }
      avg[i] = sum / period;
    }
  }
  return avg;
};

// ADX - Average Directional Index
export const calculateADX = (data, period = 14) => {
  const adx = [];
  const plusDI = [];
  const minusDI = [];
  
  // Calculate +DM and -DM (Directional Movement)
  const plusDM = [];
  const minusDM = [];
  const tr = [];
  
  for (let i = 1; i < data.length; i++) {
    const highDiff = data[i].high - data[i - 1].high;
    const lowDiff = data[i - 1].low - data[i].low;
    
    if (highDiff > lowDiff && highDiff > 0) {
      plusDM[i] = highDiff;
    } else {
      plusDM[i] = 0;
    }
    
    if (lowDiff > highDiff && lowDiff > 0) {
      minusDM[i] = lowDiff;
    } else {
      minusDM[i] = 0;
    }
    
    // True Range
    const highLow = data[i].high - data[i].low;
    const highClose = Math.abs(data[i].high - data[i - 1].close);
    const lowClose = Math.abs(data[i].low - data[i - 1].close);
    tr[i] = Math.max(highLow, highClose, lowClose);
  }
  
  // Calculate smoothed +DI and -DI using Wilder's smoothing
  let plusDISum = 0;
  let minusDISum = 0;
  let trSum = 0;
  
  // Initialize first period
  for (let i = 1; i <= period && i < data.length; i++) {
    plusDISum += plusDM[i];
    minusDISum += minusDM[i];
    trSum += tr[i];
  }
  
  // First +DI and -DI values
  if (data.length > period && trSum > 0) {
    plusDI[period] = 100 * (plusDISum / trSum);
    minusDI[period] = 100 * (minusDISum / trSum);
  }
  
  // Calculate smoothed +DI and -DI
  for (let i = period + 1; i < data.length; i++) {
    plusDISum = plusDISum - (plusDISum / period) + plusDM[i];
    minusDISum = minusDISum - (minusDISum / period) + minusDM[i];
    trSum = trSum - (trSum / period) + tr[i];
    
    if (trSum > 0) {
      plusDI[i] = 100 * (plusDISum / trSum);
      minusDI[i] = 100 * (minusDISum / trSum);
    } else {
      plusDI[i] = null;
      minusDI[i] = null;
    }
  }
  
  // Calculate DX (Directional Index)
  const dx = [];
  for (let i = period; i < data.length; i++) {
    if (plusDI[i] !== null && minusDI[i] !== null) {
      const diSum = plusDI[i] + minusDI[i];
      if (diSum > 0) {
        const diDiff = Math.abs(plusDI[i] - minusDI[i]);
        dx[i] = 100 * (diDiff / diSum);
      } else {
        dx[i] = 0;
      }
    } else {
      dx[i] = null;
    }
  }
  
  // Calculate ADX using Wilder's smoothing of DX
  let dxSum = 0;
  let dxCount = 0;
  
  // First ADX is average of first period DX values
  for (let i = period; i < period + period && i < data.length; i++) {
    if (dx[i] !== null) {
      dxSum += dx[i];
      dxCount++;
    }
  }
  
  if (dxCount > 0 && data.length > period + period - 1) {
    adx[period + period - 1] = dxSum / dxCount;
  }
  
  // Calculate ADX using Wilder's smoothing
  for (let i = period + period; i < data.length; i++) {
    if (dx[i] !== null && adx[i - 1] !== null && adx[i - 1] !== undefined) {
      adx[i] = (adx[i - 1] * (period - 1) + dx[i]) / period;
    } else {
      adx[i] = null;
    }
  }
  
  // Fill nulls for initial bars
  for (let i = 0; i < period + period - 1; i++) {
    adx[i] = null;
  }
  
  return adx;
};

