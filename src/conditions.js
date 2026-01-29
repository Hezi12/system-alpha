// --- תנאי כניסה ויציאה לאסטרטגיות מסחר (גרסה נקייה ומסודרת) ---

export const CONDITIONS = {
  // === RSI ===
  RSI: [
    { id: 'rsi_above', name: 'RSI מעל', category: 'RSI', params: [{ name: 'period', type: 'number', default: 14, min: 1, max: 100 }, { name: 'threshold', type: 'number', default: 70, min: 0, max: 100 }] },
    { id: 'rsi_below', name: 'RSI מתחת', category: 'RSI', params: [{ name: 'period', type: 'number', default: 14, min: 1, max: 100 }, { name: 'threshold', type: 'number', default: 30, min: 0, max: 100 }] },
    { id: 'rsi_cross_above', name: 'RSI חוצה מעל', category: 'RSI', params: [{ name: 'period', type: 'number', default: 14, min: 1, max: 100 }, { name: 'value', type: 'number', default: 50, min: 0, max: 100 }] },
    { id: 'rsi_cross_below', name: 'RSI חוצה מתחת', category: 'RSI', params: [{ name: 'period', type: 'number', default: 14, min: 1, max: 100 }, { name: 'value', type: 'number', default: 50, min: 0, max: 100 }] },
    { id: 'rsi_in_range', name: 'RSI בטווח', category: 'RSI', params: [{ name: 'period', type: 'number', default: 14, min: 1, max: 100 }, { name: 'min', type: 'number', default: 1, min: 0, max: 100 }, { name: 'max', type: 'number', default: 84, min: 0, max: 100 }] },
  ],

  // === ADX ===
  ADX: [
    { id: 'adx_above', name: 'ADX מעל', category: 'ADX', params: [{ name: 'period', type: 'number', default: 14, min: 1, max: 100 }, { name: 'threshold', type: 'number', default: 25, min: 0, max: 100 }] },
    { id: 'adx_below', name: 'ADX מתחת', category: 'ADX', params: [{ name: 'period', type: 'number', default: 14, min: 1, max: 100 }, { name: 'threshold', type: 'number', default: 20, min: 0, max: 100 }] },
    { id: 'adx_range', name: 'ADX בטווח', category: 'ADX', params: [{ name: 'period', type: 'number', default: 14, min: 1, max: 100 }, { name: 'min', type: 'number', default: 16, min: 0, max: 100 }, { name: 'max', type: 'number', default: 56, min: 0, max: 100 }] },
  ],

  // === ATR ===
  ATR: [
    { id: 'atr_in_range', name: 'ATR בטווח', category: 'ATR', params: [{ name: 'period', type: 'number', default: 30, min: 2, max: 50 }, { name: 'min', type: 'number', default: 12, min: 0.1, max: 100 }, { name: 'max', type: 'number', default: 55, min: 0.1, max: 200 }] },
  ],

  // === MACD ===
  MACD: [
    { id: 'macd_above', name: 'MACD מעל', category: 'MACD', params: [{ name: 'value', type: 'number', default: 0, min: -1000, max: 1000 }] },
    { id: 'macd_below', name: 'MACD מתחת', category: 'MACD', params: [{ name: 'value', type: 'number', default: 0, min: -1000, max: 1000 }] },
    { id: 'macd_cross_above_signal', name: 'MACD חוצה מעל Signal', category: 'MACD' },
    { id: 'macd_cross_below_signal', name: 'MACD חוצה מתחת ל-Signal', category: 'MACD' },
  ],

  // === Moving Averages ===
  MA: [
    { id: 'price_above_sma', name: 'מחיר מעל SMA', category: 'MA', params: [{ name: 'period', type: 'number', default: 20, min: 1, max: 500 }] },
    { id: 'price_below_sma', name: 'מחיר מתחת ל-SMA', category: 'MA', params: [{ name: 'period', type: 'number', default: 20, min: 1, max: 500 }] },
    { id: 'price_above_ema', name: 'מחיר מעל EMA', category: 'MA', params: [{ name: 'period', type: 'number', default: 20, min: 1, max: 500 }] },
    { id: 'price_below_ema', name: 'מחיר מתחת ל-EMA', category: 'MA', params: [{ name: 'period', type: 'number', default: 20, min: 1, max: 500 }] },
    { id: 'price_cross_above_sma', name: 'מחיר חוצה מעל SMA', category: 'MA', params: [{ name: 'period', type: 'number', default: 20, min: 1, max: 500 }] },
    { id: 'price_cross_below_sma', name: 'מחיר חוצה מתחת ל-SMA', category: 'MA', params: [{ name: 'period', type: 'number', default: 20, min: 1, max: 500 }] },
    { id: 'sma_cross_above', name: 'SMA חוצה מעל SMA', category: 'MA', params: [{ name: 'period1', type: 'number', default: 20, min: 1, max: 500 }, { name: 'period2', type: 'number', default: 50, min: 1, max: 500 }] },
    { id: 'sma_cross_below', name: 'SMA חוצה מתחת ל-SMA', category: 'MA', params: [{ name: 'period1', type: 'number', default: 20, min: 1, max: 500 }, { name: 'period2', type: 'number', default: 50, min: 1, max: 500 }] },
  ],

  // === Bollinger Bands ===
  BB: [
    { id: 'price_above_bb_upper', name: 'מחיר מעל פס עליון', category: 'BB', params: [{ name: 'period', type: 'number', default: 20, min: 1, max: 200 }, { name: 'stdDev', type: 'number', default: 2, min: 0.1, max: 5, step: 0.1 }] },
    { id: 'price_below_bb_lower', name: 'מחיר מתחת לפס תחתון', category: 'BB', params: [{ name: 'period', type: 'number', default: 20, min: 1, max: 200 }, { name: 'stdDev', type: 'number', default: 2, min: 0.1, max: 5, step: 0.1 }] },
  ],

  // === Volume ===
  VOLUME: [
    { id: 'volume_above_avg', name: 'נפח מעל ממוצע', category: 'VOLUME', params: [{ name: 'period', type: 'number', default: 20, min: 1, max: 200 }] },
    { id: 'volume_spike', name: 'פריצת נפח (Spike)', category: 'VOLUME', params: [{ name: 'period', type: 'number', default: 16, min: 1, max: 200 }, { name: 'multiplier', type: 'number', default: 1.6, min: 1, max: 10, step: 0.1 }] },
    { id: 'volume_profile_ratio', name: 'יחס פרופיל נפח', category: 'VOLUME', params: [{ name: 'lookback', type: 'number', default: 25, min: 1, max: 200 }, { name: 'minRatio', type: 'number', default: 0.7, min: 0.1, max: 10, step: 0.1 }] },
  ],

  // === Price Action ===
  PRICE: [
    { id: 'green_candle', name: 'נר ירוק', category: 'PRICE' },
    { id: 'red_candle', name: 'נר אדום', category: 'PRICE' },
    { id: 'higher_high', name: 'Higher High', category: 'PRICE' },
    { id: 'lower_low', name: 'Lower Low', category: 'PRICE' },
    { id: 'min_red_candles', name: 'מינימום נרות אדומים', category: 'PRICE', params: [{ name: 'minCount', type: 'number', default: 1, min: 1, max: 100 }, { name: 'lookback', type: 'number', default: 10, min: 1, max: 100 }] },
    { id: 'min_green_candles', name: 'מינימום נרות ירוקים', category: 'PRICE', params: [{ name: 'minCount', type: 'number', default: 6, min: 1, max: 100 }, { name: 'lookback', type: 'number', default: 17, min: 1, max: 100 }] },
    { id: 'bar_range_ticks', name: 'טווח נר', category: 'PRICE', params: [{ name: 'minTicks', type: 'number', default: 12, min: 1, max: 10000 }] },
    { id: 'bar_range_ticks_range', name: 'טווח נר בטווח', category: 'PRICE', params: [{ name: 'minTicks', type: 'number', default: 12, min: 1, max: 10000 }, { name: 'maxTicks', type: 'number', default: 300, min: 1, max: 10000 }] },
    { id: 'candle_body_min_ticks', name: 'גוף נר מינימלי', category: 'PRICE', params: [{ name: 'minTicks', type: 'number', default: 34, min: 1, max: 1000 }] },
    { id: 'market_change_percent_range', name: 'שינוי יומי %', category: 'PRICE', params: [{ name: 'minPercent', type: 'number', default: -2.1, min: -100, max: 100, step: 0.1 }, { name: 'maxPercent', type: 'number', default: 10, min: -100, max: 100, step: 0.1 }] },
  ],

  // === Time ===
  TIME: [
    { id: 'time', name: 'זמן', category: 'TIME', params: [{ name: 'time', type: 'number', default: 840, min: 0, max: 2359 }] },
    { id: 'time_range', name: 'טווח זמן', category: 'TIME', params: [{ name: 'startTime', type: 'number', default: 830, min: 0, max: 2359 }, { name: 'endTime', type: 'number', default: 1340, min: 0, max: 2359 }] },
  ],

  // === Stop Loss & Take Profit ===
  STOP: [
    { id: 'stop_loss_ticks', name: 'סטופ לוס (טיקים)', category: 'STOP', params: [{ name: 'ticks', type: 'number', default: 80, min: 1, max: 2000 }] },
    { id: 'take_profit_ticks', name: 'טייק פרופיט (טיקים)', category: 'STOP', params: [{ name: 'ticks', type: 'number', default: 160, min: 1, max: 5000 }] },
    { id: 'trailing_stop_ticks', name: 'Trailing Stop (טיקים)', category: 'STOP', params: [{ name: 'triggerTicks', type: 'number', default: 100, min: 1, max: 1000 }, { name: 'distanceTicks', type: 'number', default: 80, min: 1, max: 1000 }] },
    { id: 'session_close_exit', name: 'יציאה בסגירת סשן', category: 'STOP' },
  ],
};

// פונקציה לקבלת כל התנאים לפי קטגוריה
export const getConditionsByCategory = (category) => {
  return CONDITIONS[category] || [];
};

// פונקציה לקבלת כל התנאים
export const getAllConditions = () => {
  return Object.values(CONDITIONS).flat();
};

// פונקציה למציאת תנאי לפי ID
export const getConditionById = (id) => {
  const allConditions = Object.values(CONDITIONS).flat();
  return allConditions.find(c => c.id === id);
};

// רשימת כל הקטגוריות
export const CATEGORIES = Object.keys(CONDITIONS);
