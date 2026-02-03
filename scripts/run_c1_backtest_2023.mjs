#!/usr/bin/env node
/**
 * הרצת בקטסט אסטרטגיה C1 על NQ_2023.csv
 * פילטר: RTH (08:31-15:00), גרף דקה
 * שימוש: node scripts/run_c1_backtest_2023.mjs [path/to/NQ_2023.csv]
 */

import fs from 'fs';
import path from 'path';

const API_BASE = 'http://localhost:4000';
const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const useReduced = process.argv.includes('--reduced');
const useMatchImage = process.argv.includes('--match-image');
const useMacd = process.argv.includes('--macd');
const useD1 = process.argv.includes('--d1');
const useE1 = process.argv.includes('--e1');
const noRth = process.argv.includes('--no-rth');
const CSV_PATH = args[0] || path.join(process.cwd(), 'NQ_2023.csv');

// C1 Full Strategy
const C1_FULL = {
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

// C1 Reduced: רק Time, Price Above EMA, ATR Range, Risk. MACD/Volume/Candle מושבתים
const C1_REDUCED = {
  entryConditions: [
    { id: 'time_range', params: { startTime: 830, endTime: 1340 }, enabled: true, visible: true, timeframe: null },
    { id: 'macd_cross_above_signal', params: {}, enabled: false, visible: true, timeframe: null },
    { id: 'price_above_ema', params: { period: 20 }, enabled: true, visible: true, timeframe: null },
    { id: 'atr_in_range', params: { period: 30, min: 12, max: 55 }, enabled: true, visible: true, timeframe: null },
    { id: 'volume_above_avg', params: { period: 20 }, enabled: false, visible: true, timeframe: null },
    { id: 'candle_body_min_ticks', params: { minTicks: 20 }, enabled: false, visible: true, timeframe: null }
  ],
  exitConditions: [
    { id: 'macd_cross_below_signal', params: {}, enabled: false, visible: true, timeframe: null },
    { id: 'stop_loss_ticks', params: { ticks: 80 }, enabled: true, visible: true },
    { id: 'take_profit_ticks', params: { ticks: 160 }, enabled: true, visible: true }
  ]
};

// C1 עם MACD: Time, MACD Cross Entry, EMA, ATR, Volume. Exit: רק SL, TP (ללא MACD exit - כמו בתמונה)
const C1_WITH_MACD = {
  entryConditions: [
    { id: 'time_range', params: { startTime: 830, endTime: 1340 }, enabled: true, visible: true, timeframe: null },
    { id: 'macd_cross_above_signal', params: {}, enabled: true, visible: true, timeframe: null },
    { id: 'price_above_ema', params: { period: 20 }, enabled: true, visible: true, timeframe: null },
    { id: 'atr_in_range', params: { period: 30, min: 12, max: 55 }, enabled: true, visible: true, timeframe: null },
    { id: 'volume_above_avg', params: { period: 20 }, enabled: true, visible: true, timeframe: null },
    { id: 'candle_body_min_ticks', params: { minTicks: 20 }, enabled: false, visible: true, timeframe: null }
  ],
  exitConditions: [
    { id: 'macd_cross_below_signal', params: {}, enabled: false, visible: true, timeframe: null },
    { id: 'stop_loss_ticks', params: { ticks: 80 }, enabled: true, visible: true },
    { id: 'take_profit_ticks', params: { ticks: 160 }, enabled: true, visible: true }
  ]
};

// D1 - MACD בלבד (בדיקת פער): Time + MACD Cross + SL + TP
const D1_STRATEGY = {
  entryConditions: [
    { id: 'time_range', params: { startTime: 830, endTime: 1340 }, enabled: true, visible: true, timeframe: null },
    { id: 'macd_cross_above_signal', params: {}, enabled: true, visible: true, timeframe: null }
  ],
  exitConditions: [
    { id: 'stop_loss_ticks', params: { ticks: 80 }, enabled: true, visible: true },
    { id: 'take_profit_ticks', params: { ticks: 160 }, enabled: true, visible: true }
  ]
};

// E1 - שינוי יומי % + MACD Cross
const E1_STRATEGY = {
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

// C1 תואם תמונה: Time 830-1340, EMA 20, ATR 30/12/55, Volume 20 ON. MACD, Candle Body OFF. Exit: רק SL 80, TP 160
const C1_MATCH_IMAGE = {
  entryConditions: [
    { id: 'time_range', params: { startTime: 830, endTime: 1340 }, enabled: true, visible: true, timeframe: null },
    { id: 'macd_cross_above_signal', params: {}, enabled: false, visible: true, timeframe: null },
    { id: 'price_above_ema', params: { period: 20 }, enabled: true, visible: true, timeframe: null },
    { id: 'atr_in_range', params: { period: 30, min: 12, max: 55 }, enabled: true, visible: true, timeframe: null },
    { id: 'volume_above_avg', params: { period: 20 }, enabled: true, visible: true, timeframe: null },
    { id: 'candle_body_min_ticks', params: { minTicks: 20 }, enabled: false, visible: true, timeframe: null }
  ],
  exitConditions: [
    { id: 'macd_cross_below_signal', params: {}, enabled: false, visible: true, timeframe: null },
    { id: 'stop_loss_ticks', params: { ticks: 80 }, enabled: true, visible: true },
    { id: 'take_profit_ticks', params: { ticks: 160 }, enabled: true, visible: true }
  ]
};

const C1_STRATEGY = useE1 ? E1_STRATEGY : (useD1 ? D1_STRATEGY : (useMacd ? C1_WITH_MACD : (useMatchImage ? C1_MATCH_IMAGE : (useReduced ? C1_REDUCED : C1_FULL))));

function parseCsvToBars(csvText) {
  const lines = csvText.split(/\r?\n/);
  if (lines.length < 2) return [];
  const header = lines[0].toLowerCase().split(',').map(s => s.trim());
  const idx = {
    dt: header.findIndex(c => c.includes('datetime') || c === 'time'),
    open: header.findIndex(c => c.includes('open')),
    high: header.findIndex(c => c.includes('high')),
    low: header.findIndex(c => c.includes('low')),
    close: header.findIndex(c => c.includes('close')),
    vol: header.findIndex(c => c.includes('vol')),
  };
  if (idx.dt < 0 || idx.open < 0) throw new Error('CSV חסר עמודות חובה');
  const bars = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = line.split(',');
    const dtStr = cols[idx.dt] || '';
    const [datePart, timePart] = dtStr.split(' ');
    if (!datePart || !timePart) continue;
    const [y, m, d] = datePart.split('-').map(Number);
    const [hh, mm, ss = '0'] = timePart.split(':');
    const utcMs = Date.UTC(y, (m || 1) - 1, d || 1, parseInt(hh, 10) || 0, parseInt(mm, 10) || 0, parseInt(ss, 10) || 0);
    if (!Number.isFinite(utcMs)) continue;
    const bar = {
      time: Math.floor(utcMs / 1000),
      open: parseFloat(cols[idx.open]),
      high: parseFloat(cols[idx.high]),
      low: parseFloat(cols[idx.low]),
      close: parseFloat(cols[idx.close]),
      volume: idx.vol >= 0 ? parseFloat(cols[idx.vol]) || 0 : 0
    };
    if (!Number.isFinite(bar.open)) continue;
    bars.push(bar);
  }
  bars.sort((a, b) => a.time - b.time);
  return bars;
}

function filterYearOnly(bars, year = 2023) {
  return bars.filter(b => new Date(b.time * 1000).getUTCFullYear() === year);
}

function filterRthAndYear(bars, year = 2023, skipRth = false) {
  let f = bars.filter(b => new Date(b.time * 1000).getUTCFullYear() === year);
  if (skipRth) return f;
  // RTH: 08:31-15:00 (minutes 511-900) - כמו ה-UI
  f = f.filter(d => {
    const date = new Date(d.time * 1000);
    const minutes = date.getUTCHours() * 60 + date.getUTCMinutes();
    return minutes >= 511 && minutes <= 900;
  });
  // Early close days - כמו ה-UI
  const dataByDate = new Map();
  f.forEach(d => {
    const date = new Date(d.time * 1000);
    const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
    if (!dataByDate.has(key)) dataByDate.set(key, []);
    dataByDate.get(key).push(d);
  });
  const validDates = new Set();
  const earlyCloseDates = new Set();
  dataByDate.forEach((dayData, key) => {
    const hasAfterNoon = dayData.some(d => {
      const m = new Date(d.time * 1000).getUTCHours() * 60 + new Date(d.time * 1000).getUTCMinutes();
      return m > 720;
    });
    if (!hasAfterNoon) return;
    validDates.add(key);
    const hasAfter1300 = dayData.some(d => {
      const m = new Date(d.time * 1000).getUTCHours() * 60 + new Date(d.time * 1000).getUTCMinutes();
      return m > 780;
    });
    if (!hasAfter1300) earlyCloseDates.add(key);
  });
  return f.filter(d => {
    const date = new Date(d.time * 1000);
    const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
    if (!validDates.has(key)) return false;
    if (earlyCloseDates.has(key)) {
      const minutes = date.getUTCHours() * 60 + date.getUTCMinutes();
      return minutes <= 720;
    }
    return true;
  });
}

function barsToCsv(bars) {
  const header = 'datetime,open,high,low,close,volume';
  const rows = bars.map(b => {
    const d = new Date(b.time * 1000);
    const dt = d.toISOString().replace('T', ' ').slice(0, 19);
    return `${dt},${b.open},${b.high},${b.low},${b.close},${b.volume}`;
  });
  return [header, ...rows].join('\n');
}

async function main() {
  console.log('📂 טוען:', CSV_PATH);
  const csv = fs.readFileSync(CSV_PATH, 'utf8');
  let bars = parseCsvToBars(csv);
  bars = filterRthAndYear(bars, 2023, noRth);
  console.log(`📊 אחרי פילטר ${noRth ? '2023 בלבד (ללא RTH)' : 'RTH + 2023'}: ${bars.length} bars`);

  const filteredCsv = barsToCsv(bars);
  const formData = new FormData();
  formData.append('file', new Blob([filteredCsv], { type: 'text/csv' }), 'NQ_2023_RTH.csv');

  console.log('⬆️  מעלה ל-Backend...');
  const uploadRes = await fetch(`${API_BASE}/upload-csv`, {
    method: 'POST',
    body: formData
  });
  if (!uploadRes.ok) {
    const err = await uploadRes.text();
    throw new Error(`Upload failed: ${err}`);
  }
  const uploadData = await uploadRes.json();
  console.log('✅', uploadData.message);

  console.log('🔄 מריץ בקטסט...');
  const btRes = await fetch(`${API_BASE}/backtest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ strategy: C1_STRATEGY })
  });
  if (!btRes.ok) {
    const err = await btRes.text();
    throw new Error(`Backtest failed: ${err}`);
  }
  const result = await btRes.json();

  // Backend מחזיר profit ב-POINTS (הפרש מחירים). NQ: 1 point = $20
  const TICK_VALUE = 20;
  const totalDollars = result.totalProfit * TICK_VALUE;
  const maxDDDollars = result.maxDrawdown * TICK_VALUE;
  const avgWinDollars = result.averageWin * TICK_VALUE;
  const avgLossDollars = result.averageLoss * TICK_VALUE;

  const mode = useE1 ? 'E1 שינוי יומי % + MACD' : (useD1 ? 'D1 MACD בלבד' : (useMacd ? 'C1 + MACD Cross' : (useMatchImage ? 'C1 תואם תמונה (Time,EMA,ATR,Volume)' : (useReduced ? 'C1 מוקטן (ללא MACD/Volume/Candle)' : 'C1 מלא'))));
  const session = noRth ? 'רגיל (ללא RTH)' : 'RTH';
  console.log(`\n========== תוצאות בקטסט ${mode} – NQ 2023 ${session} (דקה) ==========\n`);
  console.log('עסקאות:', result.totalTrades);
  console.log('מנצחות:', result.winningTrades, '| מפסידות:', result.losingTrades);
  console.log('Win Rate:', result.winRate.toFixed(1) + '%');
  console.log('רווח כולל: $' + totalDollars.toFixed(2));
  console.log('Profit Factor:', result.profitFactor.toFixed(2));
  console.log('Max Drawdown: $' + maxDDDollars.toFixed(2));
  console.log('Sharpe Ratio:', result.sharpeRatio.toFixed(2));
  console.log('ממוצע רווח: $' + avgWinDollars.toFixed(2), '| ממוצע הפסד: $' + avgLossDollars.toFixed(2));
  if (result.trades && result.trades.length > 0) {
    console.log('\n--- 10 עסקאות ראשונות ---');
    result.trades.slice(0, 10).forEach((t, i) => {
      const entryDt = new Date(t.entry_time * 1000).toISOString().slice(0, 16);
      const exitDt = new Date(t.exit_time * 1000).toISOString().slice(0, 16);
      const p = (t.profit * TICK_VALUE).toFixed(0);
      console.log(`${i + 1}. Entry ${entryDt} @ ${t.entry_price.toFixed(2)} → Exit ${exitDt} @ ${t.exit_price.toFixed(2)} | PnL: $${p}`);
    });
  }
}

main().catch(err => {
  console.error('❌ שגיאה:', err.message);
  if (err.message.includes('fetch') || err.message.includes('ECONNREFUSED')) {
    console.error('\n💡 ודא שהמערכת רצה: ./start.sh');
  }
  process.exit(1);
});
