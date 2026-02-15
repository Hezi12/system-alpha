/**
 * SYSTEM_ALPHA - Shared Utilities
 */

/**
 * Format a Date object to YYYY-MM-DD string using UTC
 */
export const formatDateUTC = (date) =>
  `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;

/**
 * Parse a param value that may be a number or optimization range string (e.g. "10;50;5")
 */
export const parseParamValue = (value, defaultValue) => {
  if (value === undefined || value === null || value === '') return defaultValue;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    if (value.includes(';')) return defaultValue;
    const parsed = parseFloat(value);
    return isNaN(parsed) ? defaultValue : parsed;
  }
  return defaultValue;
};

/**
 * Parse an optimization range string "min;max;step" into an object
 */
export const parseOptimizationRange = (value) => {
  if (typeof value !== 'string') return null;
  const parts = value.split(';').map(p => p.trim());
  if (parts.length !== 3) return null;
  const min = parseFloat(parts[0]);
  const max = parseFloat(parts[1]);
  const step = parseFloat(parts[2]);
  if (isNaN(min) || isNaN(max) || isNaN(step) || step <= 0 || min > max) return null;
  return { min, max, step };
};

/**
 * Generate array of values from an optimization range
 */
export const generateOptimizationValues = (range) => {
  const values = [];
  for (let val = range.min; val <= range.max; val += range.step) {
    values.push(Math.round(val * 100) / 100);
  }
  return values;
};

/**
 * Parse a single CSV row into a data point
 */
const parseCSVRow = (cols, colMap) => {
  const dateStr = cols[colMap.date];
  if (!dateStr) return null;
  const [datePart, timePart] = dateStr.split(' ');
  if (!datePart || !timePart) return null;
  const [year, month, day] = datePart.split('-').map(Number);
  const [hour, minute, second = 0] = timePart.split(':').map(Number);
  const utcDate = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (isNaN(utcDate.getTime())) return null;
  return {
    time: utcDate.getTime() / 1000,
    open: parseFloat(cols[colMap.open]),
    high: parseFloat(cols[colMap.high]),
    low: parseFloat(cols[colMap.low]),
    close: parseFloat(cols[colMap.close]),
    volume: colMap.volume !== -1 ? parseFloat(cols[colMap.volume]) : 0,
    year: utcDate.getUTCFullYear()
  };
};

/**
 * Build column map from CSV header
 */
const buildColMap = (headerLine) => {
  const headerRow = headerLine.toLowerCase().split(',');
  return {
    date: headerRow.findIndex(c => c.includes('date') || c.includes('time') || c.includes('datetime')),
    open: headerRow.findIndex(c => c.includes('open')),
    high: headerRow.findIndex(c => c.includes('high')),
    low: headerRow.findIndex(c => c.includes('low')),
    close: headerRow.findIndex(c => c.includes('close')),
    volume: headerRow.findIndex(c => c.includes('vol'))
  };
};

/**
 * Parse CSV text (NinjaTrader format) into array of { time, open, high, low, close, volume }
 * Returns { data, years } where years is a sorted array of unique years found
 * Synchronous version for small files
 */
export const parsePriceCSV = (text) => {
  const rows = text.split('\n');
  const colMap = buildColMap(rows[0]);
  const parsedData = [];
  const years = new Set();
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i].trim();
    if (!row) continue;
    const cols = row.split(',');
    if (cols.length < 5) continue;
    try {
      const point = parseCSVRow(cols, colMap);
      if (point) {
        years.add(point.year);
        delete point.year;
        parsedData.push(point);
      }
    } catch (err) { continue; }
  }
  parsedData.sort((a, b) => a.time - b.time);
  return { data: parsedData, years: Array.from(years).sort() };
};

/**
 * Async CSV parser - processes in chunks to prevent UI freeze on large files.
 * onProgress(parsed, total) is called periodically with progress info.
 * Returns { data, years } like parsePriceCSV.
 */
export const parsePriceCSVAsync = (text, onProgress = null) => {
  return new Promise((resolve) => {
    const rows = text.split('\n');
    const totalRows = rows.length - 1; // minus header
    const colMap = buildColMap(rows[0]);
    const parsedData = [];
    const years = new Set();
    const CHUNK_SIZE = 50000; // rows per chunk
    let currentIndex = 1;

    const processChunk = () => {
      const end = Math.min(currentIndex + CHUNK_SIZE, rows.length);
      for (let i = currentIndex; i < end; i++) {
        const row = rows[i].trim();
        if (!row) continue;
        const cols = row.split(',');
        if (cols.length < 5) continue;
        try {
          const point = parseCSVRow(cols, colMap);
          if (point) {
            years.add(point.year);
            delete point.year;
            parsedData.push(point);
          }
        } catch (err) { continue; }
      }
      currentIndex = end;

      if (onProgress) {
        onProgress(parsedData.length, totalRows);
      }

      if (currentIndex < rows.length) {
        // Yield to browser for UI updates
        setTimeout(processChunk, 0);
      } else {
        // Done - sort and resolve
        parsedData.sort((a, b) => a.time - b.time);
        resolve({ data: parsedData, years: Array.from(years).sort() });
      }
    };

    processChunk();
  });
};
