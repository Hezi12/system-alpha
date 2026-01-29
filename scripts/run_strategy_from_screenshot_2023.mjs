import fs from 'fs';
import path from 'path';

/**
 * אסטרטגיה לפי התמונה האחרונה:
 * ENTRY (AND):
 * - rsi_above (period=14, threshold=70) timeframe=1m
 * - time_range (startTime=845, endTime=1340) timeframe=DEF
 * - rsi_in_range (period=14, min=30, max=50) timeframe=5m
 * EXIT (AND):
 * - rsi_below (period=14, threshold=30) timeframe=1m
 *
 * רץ על 2023, עם פילטר RTH כמו ב-UI (כולל early close days).
 * חיקוי לוגיקת הבקטסט ב-App.jsx: בדיקת תנאים על בר i וביצוע ב-open של הבר הבא.
 */

function parseArgs(argv) {
  const args = { file: null, rth: true, limit: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!args.file && !a.startsWith('--')) args.file = a;
    if (a === '--no-rth') args.rth = false;
    if (a === '--limit') {
      const v = argv[i + 1];
      args.limit = v ? parseInt(v, 10) : null;
      i++;
    }
  }
  if (!args.file) throw new Error('שימוש: node scripts/run_strategy_from_screenshot_2023.mjs <csv> [--no-rth] [--limit N]');
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

function filterYear(bars, year = 2023) {
  return bars.filter(b => new Date(b.time * 1000).getUTCFullYear() === year);
}

// פילטר RTH כמו ב-UI (כולל early close days)
function filterRthLikeUi(bars) {
  const rthFiltered = bars.filter(d => {
    const date = new Date(d.time * 1000);
    const minutes = date.getUTCHours() * 60 + date.getUTCMinutes();
    return minutes >= 511 && minutes <= 900; // 08:31 - 15:00
  });

  const dataByDate = new Map();
  rthFiltered.forEach(d => {
    const date = new Date(d.time * 1000);
    const dateKey = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
    if (!dataByDate.has(dateKey)) dataByDate.set(dateKey, []);
    dataByDate.get(dateKey).push(d);
  });

  const validDates = new Set();
  const earlyCloseDates = new Set();
  dataByDate.forEach((dayData, dateKey) => {
    const hasTradingAfterNoon = dayData.some(d => {
      const date = new Date(d.time * 1000);
      const minutes = date.getUTCHours() * 60 + date.getUTCMinutes();
      return minutes > 720; // אחרי 12:00
    });
    if (!hasTradingAfterNoon) return;

    const hasTradingAfter1300 = dayData.some(d => {
      const date = new Date(d.time * 1000);
      const minutes = date.getUTCHours() * 60 + date.getUTCMinutes();
      return minutes > 780; // אחרי 13:00
    });

    validDates.add(dateKey);
    if (!hasTradingAfter1300) earlyCloseDates.add(dateKey);
  });

  return rthFiltered.filter(d => {
    const date = new Date(d.time * 1000);
    const dateKey = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
    if (!validDates.has(dateKey)) return false;
    if (earlyCloseDates.has(dateKey)) {
      const minutes = date.getUTCHours() * 60 + date.getUTCMinutes();
      return minutes <= 720; // עד 12:00 כולל
    }
    return true;
  });
}

// === processData (Close Time label) ===
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
  for (let i = 0; i < n; i++) closeTimes[i] = typeof data[i]?.time === 'number' ? data[i].time : null;
  return closeTimes;
}

function alignToPrimary(primaryData, secondaryData, secondaryValues) {
  if (!primaryData?.length) return [];
  if (!secondaryValues || secondaryValues.length === 0) return primaryData.map(() => null);
  if (!secondaryData?.length) return primaryData.map(() => null);

  const primaryCloseTimes = computeCloseTimes(primaryData);
  const secondaryCloseTimes = computeCloseTimes(secondaryData);

  const aligned = new Array(primaryData.length).fill(null);
  let secondaryIdx = -1;
  for (let i = 0; i < primaryData.length; i++) {
    const target = primaryCloseTimes[i];
    if (typeof target !== 'number') continue;
    while (
      secondaryIdx + 1 < secondaryCloseTimes.length &&
      typeof secondaryCloseTimes[secondaryIdx + 1] === 'number' &&
      secondaryCloseTimes[secondaryIdx + 1] <= target
    ) {
      secondaryIdx++;
    }
    aligned[i] = secondaryIdx >= 0 ? secondaryValues[secondaryIdx] : null;
  }
  return aligned;
}

// RSI (Wilder)
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

  rsi[period] = avgLoss === 0 ? 100 : (100 - (100 / (1 + (avgGain / avgLoss))));

  for (let i = period + 1; i < data.length; i++) {
    const change = changes[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    rsi[i] = avgLoss === 0 ? 100 : (100 - (100 / (1 + (avgGain / avgLoss))));
  }
  return rsi;
}

function hhmmUtcFromTimeSec(t) {
  const d = new Date(t * 1000);
  return d.getUTCHours() * 100 + d.getUTCMinutes();
}

function fmtDateTimeUtc(t) {
  const d = new Date(t * 1000);
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = d.getUTCFullYear();
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${yyyy} ${hh}:${mi}`;
}

function runBacktest(primaryData, entryOkFn, exitOkFn) {
  const trades = [];
  let currentTrade = null;

  for (let i = 1; i < primaryData.length; i++) {
    const candle = primaryData[i];
    const nextCandle = i < primaryData.length - 1 ? primaryData[i + 1] : candle;

    // Exit (non-stop): if triggered on bar i -> execute on next open
    if (currentTrade && exitOkFn(i)) {
      trades.push({
        entryTime: currentTrade.entryTime,
        entryPrice: currentTrade.entryPrice,
        exitTime: nextCandle.time,
        exitPrice: nextCandle.open,
      });
      currentTrade = null;
    }

    // Entry
    if (!currentTrade) {
      // session boundary check (gap >= 60 minutes)
      const timeDiffMinutes = (nextCandle.time - candle.time) / 60;
      const isNewSessionStart = timeDiffMinutes >= 60;
      if (isNewSessionStart) continue;

      if (entryOkFn(i)) {
        currentTrade = { entryTime: nextCandle.time, entryPrice: nextCandle.open };
      }
    }
  }

  return trades;
}

function stats(trades) {
  const tickValue = 20;
  const pnls = trades.map(t => (t.exitPrice - t.entryPrice) * tickValue);
  const totalPnL = pnls.reduce((s, x) => s + x, 0);
  const wins = pnls.filter(x => x > 0);
  const losses = pnls.filter(x => x < 0);
  const winRate = pnls.length ? (wins.length / pnls.length) * 100 : 0;
  const grossProfit = wins.reduce((s, x) => s + x, 0);
  const grossLoss = losses.reduce((s, x) => s + Math.abs(x), 0);
  const profitFactor = grossLoss > 0 ? (grossProfit / grossLoss) : (grossProfit > 0 ? 100 : 0);

  let equity = 0, peak = 0, maxDD = 0;
  for (const p of pnls) {
    equity += p;
    if (equity > peak) peak = equity;
    const dd = peak - equity;
    if (dd > maxDD) maxDD = dd;
  }

  return { totalTrades: pnls.length, totalPnL, winRate, profitFactor, maxDrawdown: maxDD };
}

function formatMoney(x) {
  const s = Math.abs(x).toFixed(2);
  return `${x < 0 ? '-' : ''}$${s}`;
}

const { file, rth, limit } = parseArgs(process.argv);
const abs = path.isAbsolute(file) ? file : path.join(process.cwd(), file);
const csv = fs.readFileSync(abs, 'utf8');

let raw = parseCsvToBars(csv, limit);
raw = filterYear(raw, 2023);
if (rth) raw = filterRthLikeUi(raw);

if (raw.length < 5000) throw new Error(`מעט מדי נתונים אחרי פילטרים: ${raw.length}`);

// === בניית סדרות RSI לפי דרישות האסטרטגיה ===
// Primary = 1m (כמו בתמונה)
const primary = raw;

// RSI 1m
const rsi1 = calculateRSI(primary, 14);

// RSI 5m מיושר ל-1m (ללא lookahead)
const tf5 = processData(raw, 5);
const rsi5 = calculateRSI(tf5, 14);
const rsi5Aligned = alignToPrimary(primary, tf5, rsi5);

// תנאי האסטרטגיה
const entryOk = (i) => {
  // RSI מעל 70 (1m)
  if (rsi1[i] === null || rsi1[i] === undefined) return false;
  if (!(rsi1[i] > 70)) return false;

  // טווח זמן 08:45 - 13:40 (DEF => על ה-Primary)
  const hhmm = hhmmUtcFromTimeSec(primary[i].time);
  if (!(hhmm >= 845 && hhmm <= 1340)) return false;

  // RSI בטווח 30-50 (5m)
  const v = rsi5Aligned[i];
  if (v === null || v === undefined) return false;
  return v >= 30 && v <= 50;
};

const exitOk = (i) => {
  // RSI מתחת 30 (1m)
  if (rsi1[i] === null || rsi1[i] === undefined) return false;
  return rsi1[i] < 30;
};

const trades = runBacktest(primary, entryOk, exitOk);
const s = stats(trades);

console.log('=== אסטרטגיה מהתמונה | Year 2023 ===');
console.log(`filterRTH=${rth ? 'ON' : 'OFF'} | bars(1m)=${primary.length} | bars(5m)=${tf5.length}`);
console.log('');
console.log(`- trades: ${s.totalTrades}`);
console.log(`- totalPnL: ${formatMoney(s.totalPnL)}`);
console.log(`- winRate: ${s.winRate.toFixed(1)}%`);
console.log(`- profitFactor: ${s.profitFactor.toFixed(2)}`);
console.log(`- maxDrawdown: ${formatMoney(s.maxDrawdown)}`);

if (trades.length) {
  console.log('');
  console.log('First 5 trades (UTC):');
  trades.slice(0, 5).forEach((t, idx) => {
    console.log(
      `#${idx + 1} entry ${fmtDateTimeUtc(t.entryTime)} @ ${t.entryPrice.toFixed(2)} | exit ${fmtDateTimeUtc(t.exitTime)} @ ${t.exitPrice.toFixed(2)}`
    );
  });
}

