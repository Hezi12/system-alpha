import fs from 'fs';
import path from 'path';

/**
 * בדיקת שקילות בין:
 * 1) Primary Timeframe = 5 (RSI על 5 כי זה הראשי)
 * 2) Primary Timeframe = 1 + תנאי RSI עם timeframe=5
 *
 * חשוב: זה מחקה את הלוגיקה של המערכת ב-Frontend:
 * - נרות 5 דקות בנויים מדקות 01–05, 06–10, ...
 * - זמן הנר (`time`) הוא זמן הסגירה (כמו NinjaTrader) => 08:35
 * - כניסה/יציאה מתבצעים ב-open של הבר הבא (OnBarClose style)
 * - יישור MTF ללא Lookahead: משתמשים רק ב-5m האחרון שנסגר עד סגירת הבר הראשי
 */

function parseArgs(argv) {
  const args = { file: null, limit: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!args.file && !a.startsWith('--')) args.file = a;
    if (a === '--limit') {
      const v = argv[i + 1];
      args.limit = v ? parseInt(v, 10) : null;
      i++;
    }
  }
  if (!args.file) {
    throw new Error('שימוש: node scripts/compare_rsi_modes.mjs <path-to-csv> [--limit N]');
  }
  return args;
}

function parseCsvToBars(csvText, limit = null) {
  const lines = csvText.split(/\r?\n/);
  if (lines.length < 2) return [];

  const header = lines[0].toLowerCase().split(',').map(s => s.trim());
  const idx = {
    dt: header.findIndex(c => c.includes('datetime') || c === 'time' || c.includes('date')),
    open: header.findIndex(c => c.includes('open')),
    high: header.findIndex(c => c.includes('high')),
    low: header.findIndex(c => c.includes('low')),
    close: header.findIndex(c => c.includes('close')),
    vol: header.findIndex(c => c.includes('vol')),
  };

  if (idx.dt < 0 || idx.open < 0 || idx.high < 0 || idx.low < 0 || idx.close < 0) {
    throw new Error(`CSV חסר עמודות חובה. כותרות: ${header.join(', ')}`);
  }

  const bars = [];
  for (let i = 1; i < lines.length; i++) {
    if (limit && bars.length >= limit) break;
    const line = lines[i].trim();
    if (!line) continue;
    const cols = line.split(',');
    if (cols.length < 5) continue;

    const dtStr = cols[idx.dt];
    // פורמט כמו: "2023-01-02 17:01:00" (UTC כמו במערכת)
    const [datePart, timePart] = (dtStr || '').split(' ');
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
      volume: idx.vol >= 0 ? parseFloat(cols[idx.vol]) : 0,
    };
    if (!Number.isFinite(bar.open) || !Number.isFinite(bar.high) || !Number.isFinite(bar.low) || !Number.isFinite(bar.close)) continue;
    bars.push(bar);
  }

  bars.sort((a, b) => a.time - b.time);
  return bars;
}

// === העתקה נאמנה של הלוגיקה מ-App.jsx (אגרגציה עם Close Time Label) ===
function processData(rawData, timeframe) {
  if (!rawData || rawData.length === 0) return [];
  if (timeframe === 1) return rawData;

  const bucketMap = new Map(); // Map<bucketCloseTimeSeconds, bucket>

  rawData.forEach((item) => {
    const date = new Date(item.time * 1000);
    const totalMinutes = date.getUTCHours() * 60 + date.getUTCMinutes();

    const bucketStartMinutes = totalMinutes === 0 ? 1 : Math.floor((totalMinutes - 1) / timeframe) * timeframe + 1;

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
    const bucketCloseTime = bucketCloseTimestamp / 1000;

    if (!bucketMap.has(bucketCloseTime)) {
      bucketMap.set(bucketCloseTime, {
        time: bucketCloseTime,
        open: item.open,
        high: item.high,
        low: item.low,
        close: item.close,
        volume: item.volume,
      });
    } else {
      const bucket = bucketMap.get(bucketCloseTime);
      bucket.high = Math.max(bucket.high, item.high);
      bucket.low = Math.min(bucket.low, item.low);
      bucket.close = item.close;
      bucket.volume += item.volume;
    }
  });

  return Array.from(bucketMap.values()).sort((a, b) => a.time - b.time);
}

function computeCloseTimes(data) {
  const n = data?.length || 0;
  const closeTimes = new Array(n);
  for (let i = 0; i < n; i++) {
    const t = data[i]?.time;
    closeTimes[i] = typeof t === 'number' ? t : null;
  }
  return closeTimes;
}

function alignIndicatorToPrimary(primaryData, secondaryData, secondaryValues) {
  if (!primaryData?.length) return [];
  if (!secondaryValues || secondaryValues.length === 0) return primaryData.map(() => null);
  if (!secondaryData?.length) return primaryData.map(() => null);

  const primaryCloseTimes = computeCloseTimes(primaryData);
  const secondaryCloseTimes = computeCloseTimes(secondaryData);

  const aligned = new Array(primaryData.length).fill(null);
  let secondaryIdx = -1;

  for (let i = 0; i < primaryData.length; i++) {
    const targetCloseTime = primaryCloseTimes[i];
    if (typeof targetCloseTime !== 'number') {
      aligned[i] = null;
      continue;
    }

    while (
      secondaryIdx + 1 < secondaryCloseTimes.length &&
      typeof secondaryCloseTimes[secondaryIdx + 1] === 'number' &&
      secondaryCloseTimes[secondaryIdx + 1] <= targetCloseTime
    ) {
      secondaryIdx++;
    }

    aligned[i] = secondaryIdx >= 0 ? secondaryValues[secondaryIdx] : null;
  }

  return aligned;
}

// RSI (כמו indicators.js - Wilder)
function calculateRSI(data, period = 14) {
  if (!data || data.length < period + 1) return data.map(() => null);

  const rsi = new Array(data.length).fill(null);
  const changes = [];
  for (let i = 1; i < data.length; i++) changes.push(data[i].close - data[i - 1].close);

  let sumGain = 0;
  let sumLoss = 0;
  for (let i = 0; i < period; i++) {
    if (changes[i] > 0) sumGain += changes[i];
    else sumLoss += Math.abs(changes[i]);
  }

  let avgGain = sumGain / period;
  let avgLoss = sumLoss / period;

  // first RSI at index = period
  if (avgLoss === 0) rsi[period] = 100;
  else {
    const rs = avgGain / avgLoss;
    rsi[period] = 100 - (100 / (1 + rs));
  }

  for (let i = period + 1; i < data.length; i++) {
    const change = changes[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    if (avgLoss === 0) rsi[i] = 100;
    else {
      const rs = avgGain / avgLoss;
      rsi[i] = 100 - (100 / (1 + rs));
    }
  }
  return rsi;
}

function backtestRsiOnly(data, rsiSeries, entryAbove = 70, exitBelow = 30) {
  const trades = [];
  let inTrade = false;
  let entry = null;

  for (let i = 0; i < data.length - 1; i++) {
    const rsi = rsiSeries[i];
    if (rsi === null || rsi === undefined) continue;

    const next = data[i + 1];

    if (!inTrade) {
      if (rsi > entryAbove) {
        inTrade = true;
        entry = {
          entryTime: next.time,
          entryPrice: next.open,
          entryIndex: i + 1,
        };
      }
    } else {
      if (rsi < exitBelow) {
        const exitTime = next.time;
        const exitPrice = next.open;
        trades.push({
          ...entry,
          exitTime,
          exitPrice,
          exitIndex: i + 1,
        });
        inTrade = false;
        entry = null;
      }
    }
  }

  return trades;
}

function summarizeTrades(trades) {
  const tickValue = 20;
  const out = trades.map(t => ({
    entryTime: t.entryTime,
    entryPrice: t.entryPrice,
    exitTime: t.exitTime,
    exitPrice: t.exitPrice,
    pnl: (t.exitPrice - t.entryPrice) * tickValue,
  }));
  const totalPnL = out.reduce((s, t) => s + t.pnl, 0);
  return { totalTrades: out.length, totalPnL, trades: out };
}

function sameTrades(a, b) {
  if (a.length !== b.length) return { ok: false, reason: `כמות עסקאות שונה: ${a.length} מול ${b.length}` };
  for (let i = 0; i < a.length; i++) {
    const A = a[i], B = b[i];
    const keys = ['entryTime', 'exitTime', 'entryPrice', 'exitPrice'];
    for (const k of keys) {
      if (A[k] !== B[k]) {
        return { ok: false, reason: `סטייה בעסקה #${i + 1} בשדה ${k}: ${A[k]} מול ${B[k]}` };
      }
    }
  }
  return { ok: true };
}

const { file, limit } = parseArgs(process.argv);
const abs = path.isAbsolute(file) ? file : path.join(process.cwd(), file);
const csv = fs.readFileSync(abs, 'utf8');
const raw = parseCsvToBars(csv, limit);

if (raw.length < 200) {
  throw new Error(`מעט מדי שורות אחרי פרסור (${raw.length}). נסה בלי limit או עם limit גדול יותר.`);
}

// מצב 1: Primary = 5
const data5 = processData(raw, 5);
const rsi5 = calculateRSI(data5, 14);
const tradesMode1 = backtestRsiOnly(data5, rsi5, 70, 30);
const sum1 = summarizeTrades(tradesMode1);

// מצב 2: Primary = 1, RSI timeframe = 5
const data1 = raw;
const tf5 = processData(raw, 5);
const tf5rsi = calculateRSI(tf5, 14);
const alignedRsiTo1m = alignIndicatorToPrimary(data1, tf5, tf5rsi);
const tradesMode2 = backtestRsiOnly(data1, alignedRsiTo1m, 70, 30);
const sum2 = summarizeTrades(tradesMode2);

console.log('=== השוואת מצבים (RSI>70 כניסה, RSI<30 יציאה, TF=5) ===');
console.log(`קלט דקות: ${raw.length} | נרות 5ד: ${data5.length}`);
console.log(`מצב 1 (Primary=5): trades=${sum1.totalTrades}, totalPnL=${sum1.totalPnL.toFixed(2)}`);
console.log(`מצב 2 (Primary=1, RSI TF=5): trades=${sum2.totalTrades}, totalPnL=${sum2.totalPnL.toFixed(2)}`);

const cmp = sameTrades(sum1.trades, sum2.trades);
if (cmp.ok) {
  console.log('✅ זהה: רשימת העסקאות (זמנים ומחירים) זהה בין שני המצבים.');
} else {
  console.log('❌ לא זהה:', cmp.reason);
  console.log('דוגמה מצב 1:', sum1.trades[0]);
  console.log('דוגמה מצב 2:', sum2.trades[0]);
}

