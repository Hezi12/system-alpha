# SYSTEM ALPHA – סקירת מערכת מלאה

מסמך זה מסכם את כל קבצי הפרויקט, הארכיטקטורה, זרימת הנתונים והתנהגות המערכת – לצורך שליטה מלאה והמשך פיתוח.

---

## 1. מהי המערכת

**SYSTEM ALPHA** היא מערכת **בקטסט ואופטימיזציה** לאסטרטגיות מסחר.  
המשתמש טוען נתוני OHLCV (CSV), מגדיר אסטרטגיה מתנאי כניסה/יציאה (RSI, MACD, ADX, נפח, זמן וכו'), מריץ בקטסט או אופטימיזציה, ומקבל סטטיסטיקות ותוצאות.

- **Backend**: Python (FastAPI) – חישובי אינדיקטורים, בקטסט ואופטימיזציה (וקטורי עם NumPy/Numba).
- **Frontend**: React + Vite – UI, גרפים (LightweightCharts), ניהול אסטרטגיות.
- **Electron**: עטיפה לאפליקציית דסקטופ (חלון אפליקציה).

---

## 2. מבנה תיקיות וקבצים

```
SYSTEM_ALPHA/
├── backend/                    # שרת Python
│   ├── app/
│   │   ├── __init__.py         # ריק, רק זיהוי חבילה
│   │   ├── main.py             # FastAPI: endpoints, טעינת CSV, בקטסט, אופטימיזציה
│   │   ├── models.py           # Pydantic: Strategy, BacktestRequest, BacktestResult, OptimizationResult
│   │   ├── indicators.py       # IndicatorBank, אינדיקטורים (RSI, MACD, SMA, EMA, ATR, ADX, ...) + MTF
│   │   ├── backtest.py         # BacktestEngine: בדיקת תנאים וקטורית, סימולציית עסקאות, סטטיסטיקות
│   │   └── optimizer.py        # Optimizer: שילוב פרמטרים, Pool (multiprocessing), מיון לפי רווח
│   └── requirements.txt        # fastapi, uvicorn, pandas, numpy, ta, numba, python-dateutil
├── src/                        # Frontend React
│   ├── main.jsx                # נקודת כניסה – ReactDOM.render(<App />)
│   ├── App.jsx                 # קומפוננטה ראשית ענקית: גרפים, אסטרטגיה, בקטסט, אופטימיזציה, דוחות
│   ├── api.js                  # לקוח API: uploadCSV, runBacktest, runOptimization, getBackendStatus, getLoadedData
│   ├── conditions.js           # CONDITIONS (RSI, ADX, ATR, MACD, MA, BB, Volume, Price, Time, Stop), getConditionById
│   ├── indicators.js           # חישובי אינדיקטורים בצד לקוח (SMA, EMA, RSI, MACD, Bollinger, Stochastic, ATR, ADX)
│   └── index.css               # Tailwind + עיצוב בסיסי
├── electron/
│   └── main.cjs                # תהליך ראשי של Electron: חלון, תפריט, טעינת localhost:5173 או dist
├── scripts/                    # סקריפטי Node לבדיקות/השוואות
│   ├── compare_rsi_modes.mjs
│   ├── compare_strategy_2023.mjs
│   ├── run_strategy_from_screenshot_2023.mjs
│   └── run_strategy_rsi_time_adx_2023.mjs
├── docs/
│   ├── INVESTIGATION_RTH_0831_DISCREPANCY.md   # תחקיר: RTH 08:31 vs NinjaTrader
│   └── SYSTEM_OVERVIEW.md                      # המסמך הזה
├── index.html                  # HTML ראשי, RTL, <div id="root">
├── vite.config.js              # Vite + React, base './', port 5173
├── tailwind.config.js          # Tailwind content paths
├── postcss.config.js           # tailwindcss, autoprefixer
├── package.json                # React, Vite, Electron, lucide-react, @google/generative-ai
├── start.sh                    # הפעלה: Backend (4000), Vite (5173), Electron
├── stop.sh                     # עצירת כל התהליכים
└── .gitignore                  # node_modules, dist, venv, .env, logs, csv, data
```

---

## 3. Backend (Python) – פירוט

### 3.1 `main.py`
- **FastAPI** עם CORS פתוח.
- **אחסון**: `data_store` – מילון גלובלי; מפתח `'data'` מכיל `{ time, open, high, low, close, volume }` כ־numpy arrays.
- **Startup**: טעינת CSV ברירת מחדל מ־`../../NQ2018.csv` (אם קיים) – נרמול עמודות, המרת זמן ל־Unix, שמירה ב־`data_store['data']`.
- **Endpoints**:
  - `GET /` – health.
  - `POST /upload-csv` – העלאת CSV, נרמול עמודות, המרת זמן, שמירה; מחזיר bars + elapsed.
  - `POST /backtest` – מקבל `BacktestRequest(strategy)`; בונה `IndicatorBank` + `build_smart(strategy)`; מריץ `BacktestEngine.run(strategy)`; מחזיר `BacktestResult`.
  - `POST /optimize` – מקבל `OptimizationRequest(strategy, optimizationRanges)`; בונה IndicatorBank; מריץ `Optimizer.optimize(optimizationRanges)`; מחזיר success + total_combinations + results (50 הראשונים).
  - `GET /status` – data_loaded, bars.
  - `GET /get-data` – מחזיר את הנתונים הטעונים כרשימת אובייקטים (לפרונט).

### 3.2 `models.py`
- **OHLCVData** – time, open, high, low, close, volume.
- **StrategyCondition** – id, params (dict), enabled, timeframe (אופציונלי).
- **Strategy** – entryConditions, exitConditions.
- **BacktestRequest** – strategy.
- **OptimizationRequest** – strategy, optimizationRanges (dict של טווחים: min, max, step).
- **BacktestResult** – totalTrades, winningTrades, losingTrades, winRate, totalProfit, maxDrawdown, profitFactor, sharpeRatio, averageWin/Loss, largestWin/Loss, trades (רשימת עסקאות).
- **OptimizationResult** – params (dict), result (BacktestResult).

### 3.3 `indicators.py`
- **IndicatorBank**:
  - מקבל `data` (dict של arrays).
  - `timeframes`: DEF = נתונים ראשיים; שאר מפתחים (למשל "5", "15") = נתונים מאוגרגים לדקות המתאימות.
  - `_aggregate_data(timeframe_mins)` – אגרגציה ל־OHLCV לפי דקות (Pandas resample, סגנון NinjaTrader).
  - `_get_close_times(tf)` – זמני סגירת בר (ללא lookahead) לשימוש ביישור MTF.
  - `build_smart(strategy)` – מנתח entry/exit conditions, מזהה אילו אינדיקטורים נדרשים ולאיזה timeframe; בונה רק אותם (`_build_single_indicator_mtf`).
  - `get_mtf(key, tf)` – מחזיר מערך מאוזן ל־primary (אינדקס לפי last closed bar של ה־TF הגבוה).
- **אינדיקטורים**: SMA, EMA, RSI (Wilder), MACD (EMA-based), Bollinger, Stochastic (%K/%D), ATR, ADX, CCI, Williams %R, Volume Average (ללא הבר הנוכחי – תואם NinjaTrader).
- פונקציות ליבה עם `@jit(nopython=True)` (Numba) where useful.

### 3.4 `backtest.py`
- **FOMC_DATES** – set של תאריכי FOMC (לסינון שעות FOMC אם נדרש).
- **BacktestEngine**:
  - `run(strategy)` – מחשב `entry_signals` ו־`exit_signals` (AND של כל התנאים הפעילים), מריץ `_simulate_trades`, מחזיר `_calculate_statistics`.
  - `_check_conditions(conditions)` – AND על כל condition.
  - `_check_single_condition(condition)` – מזהים לפי `condition.id` ומחזירים מערך בוליאני. תמיכה ב־**Multi-Timeframe** (timeframe מתוך condition; יישור ל־primary ללא lookahead).
  - תנאים נתמכים (דוגמאות): rsi_below/above, rsi_crosses_above/below, rsi_in_range, macd_cross_above/below, price_above/below_sma/ema, price_below_ema_multiple, sma_short_above_long_lookback, Bollinger, candle_body_min_ticks, bar_range_ticks_range, min_red_candles, min_green_candles, green_red_reversal_exit, big_reverse_candle_exit, stoch_*, adx_range, atr_*, market_change_percent_range, time, time_range, green_candle, volume_above_avg, volume_spike, volume_profile_ratio, volume_spike_exit, fomc_hours, וכו'.
  - `_simulate_trades` – לולאה: כניסה על entry_signal, יציאה על exit_signal; עסקאות פתוחות בסוף נסגרות ב־Session End.
  - `_calculate_statistics` – win rate, profit factor, max drawdown, Sharpe, ממוצעי רווח/הפסד, largest win/loss, ורשימת trades.

### 3.5 `optimizer.py`
- **Optimizer**: מקבל data, IndicatorBank, strategy.
- **optimize(optimizationRanges)** – בונה את כל צירופי הפרמטרים (product); לכל צירוף קורא ל־`_run_single_backtest` (worker).
- **Worker**: מקבל (data, indicator_bank_dict, strategy_dict, param_combination); מעדכן params בתנאים (פירוק מפתחות כמו `entry_0_threshold`); מריץ BacktestEngine; מחזיר (params, BacktestResult).
- **Pool (multiprocessing)** – מספר cores (עד 6); מיון תוצאות לפי totalProfit; החזרת רשימת OptimizationResult.

---

## 4. Frontend (React) – פירוט

### 4.1 `api.js`
- Base URL: `http://localhost:4000`.
- `uploadCSV(file)` – POST form-data.
- `runBacktest(data, strategy)` – POST JSON { strategy }.
- `runOptimization(data, strategy, optimizationRanges, onProgress)` – POST JSON; אין streaming progress אמיתי מהשרת (הפרונט רק שולח).
- `getBackendStatus()`, `getLoadedData()` – GET.

### 4.2 `conditions.js`
- **CONDITIONS** – אובייקט לפי קטגוריות: RSI, ADX, ATR, MACD, MA, BB, VOLUME, PRICE, TIME, STOP. כל פריט: id, name, category, params (מערך עם name, type, default, min, max, step).
- **getConditionsByCategory**, **getAllConditions**, **getConditionById**, **CATEGORIES**.

### 4.3 `indicators.js`
- חישובי אינדיקטורים בצד לקוח (להצגה/בקטסט מקומי אם יש): calculateSMA, calculateEMA, calculateRSI, calculateMACD, calculateBollingerBands, calculateStochastic, calculateATR, calculateVolumeAverage, calculateADX. תואם NinjaTrader (למשל Wilder smoothing ל־RSI).

### 4.4 `App.jsx` (מבנה כללי)
- **עיצוב**: COLORS (bg, grid, text, up/down, tradeLine, entry/exit), FOMC_DATES.
- **עיבוד נתונים**:
  - `processData(rawData, timeframe)` – אגרגציה לדקות (בקבוצות :01,:06,...; זמן בר = close time).
  - `aggregateToDaily(data, upToIndex)` – אגרגציה יומית.
- **אופטימיזציה**: parseOptimizationRange (מחרוזת "min;max;step"), generateOptimizationValues, findOptimizationParams מתוך תנאים, runOptimization (מכין optimizationRanges + strategy וקורא ל־api).
- **אינדיקטורים/בקטסט מקומי**: getRequiredIndicators, checkCondition (לוגיקה מקבילה ל־backend לכל condition id), computeCloseTimes, getLastClosedSecondaryIndex, alignIndicatorToPrimary, calculateAllIndicators, runBacktest (לולאה על bars, כניסה/יציאה).
- **עזרים**: generateTradeLinesData, parseNinjaCSV, calculateStats.
- **קומפוננטות**: DetailedReport (טבלאות תוצאות, עסקאות, לחיצה על trade).
- **App()**:
  - State: rawData, filteredRawData, processedData, secondaryProcessedData, config (selectedYears, primaryTimeframe, secondaryTimeframe, showSecondaryChart, sessionType, showSidebar, activeTab), strategyConfig (entry/exit conditions), results, optimizationResults, savedStrategies, chart refs, וכו'.
  - טעינת נתונים אוטומטית מ־getLoadedData כש־chart ready.
  - טעינת אסטרטגיות שמורות מ־localStorage (כולל A01 Volume Spike כברירת מחדל).
  - LightweightCharts – גרף ראשי + משני, candlestick, volume, trade lines, אינדיקטורים.
  - טאבים: DATA (העלאת CSV, שנים, RTH, timeframe), STRATEGY (תנאי כניסה/יציאה, timeframe לכל תנאי, אופטימיזציה), תוצאות ודוח מפורט.
- **בקטסט**: יכול לרוץ ב־Backend (api.runBacktest) או מקומית (runBacktest עם הנתונים המסוננים). סינון RTH ב־App.jsx – לפי תחקיר: `minutes >= 511` (08:31) חותך את נר 08:30; ההמלצה הייתה 510 כדי להתיישר עם NinjaTrader.

---

## 5. Electron

- **main.cjs**: יוצר חלון (1800x1200), רקע שחור, titleBarStyle hiddenInset ב־macOS. טוען ב־dev את `http://localhost:5173`, ב־production את `dist/index.html`. תפריט: System Alpha, Edit, View, Window, Help. דגלים ל־memory (max-old-space-size 8192) ו־background throttling. מניעת ניווט החוצה; DevTools ב־dev.

---

## 6. סקריפטים (scripts/)

- **compare_strategy_2023.mjs** – משווה אסטרטגיה (RSI + time_range) בין Primary=5 ל־Primary=1 + RSI על 5m; פרסור CSV, הרצת לוגיקת תנאים; אופציות --rth, --limit.
- שאר הסקריפטים – השוואות RSI/ADX/זמן ואסטרטגיות לפי צילום מסך; משתמשים באותה פילוסופיה של פרסור CSV והרצת תנאים.

---

## 7. תחקיר RTH (08:31)

- **מסמך**: `docs/INVESTIGATION_RTH_0831_DISCREPANCY.md`.
- **ממצא**: בנינג'ה טריידר הכניסה ב־08:31 נובעת מסיגנל OnBarClose על **נר 08:30**. ב־SYSTEM_ALPHA פילטר RTH היה `minutes >= 511` (08:31), ולכן נר 08:30 נחתך ולא השתתף בבקטסט – ולכן כניסה ב־08:31 חסרה.
- **המלצה**: לשנות ל־`minutes >= 510` (כולל 08:30). המיקום: ב־App.jsx באזור סינון ה־filtered לפי sessionType === 'RTH'.

---

## 8. תלויות עיקריות

| שכבה        | טכנולוגיות |
|-------------|------------|
| Backend     | FastAPI, Uvicorn, Pandas, NumPy, Numba, ta |
| Frontend    | React 18, Vite, Tailwind, Lucide React, LightweightCharts (CDN), Google Generative AI |
| Desktop     | Electron 27 |
| הפעלה       | Bash (start.sh / stop.sh) |

---

## 9. זרימת נתונים (תמצית)

1. **טעינת נתונים**: העלאת CSV ל־Backend או טעינה אוטומטית מ־NQ2018.csv → `data_store['data']`.
2. **פרונט**: getLoadedData() → rawData; סינון שנים + RTH → filteredRawData; processData(..., primaryTimeframe) → processedData.
3. **בקטסט (Backend)**: BacktestRequest(strategy) → IndicatorBank.build_smart → BacktestEngine.run → BacktestResult (כולל trades).
4. **אופטימיזציה**: OptimizationRequest(strategy, optimizationRanges) → Optimizer.optimize → רשימת OptimizationResult ממוינת לפי totalProfit; החזרת 50 ראשונים.
5. **גרפים**: processedData → LightweightCharts candlestick + volume; תוצאות בקטסט → קווי כניסה/יציאה (generateTradeLinesData).

---

## 10. שליטה מלאה – רשימת קבצים קריטיים

| קובץ | תפקיד |
|------|--------|
| `backend/app/main.py` | כל ה־API וטעינת הנתונים |
| `backend/app/models.py` | מודלים של אסטרטגיה ובקטסט |
| `backend/app/indicators.py` | כל האינדיקטורים ו־MTF |
| `backend/app/backtest.py` | לוגיקת כל תנאי וסימולציית עסקאות |
| `backend/app/optimizer.py` | צירופי פרמטרים והרצה מקבילית |
| `src/App.jsx` | כל ה־UI, סינון, בקטסט מקומי, גרפים, אסטרטגיות |
| `src/api.js` | קריאות ל־Backend |
| `src/conditions.js` | הגדרת כל התנאים לסטרטגיה |
| `electron/main.cjs` | חלון האפליקציה והתפריט |
| `start.sh` / `stop.sh` | הפעלה ועצירה |

עם המסמך הזה יש לך מפת דרכים מלאה של כל קובץ והתנהגות המערכת. לשלב הבא אפשר למקד: תיקון RTH ל־510, פיצול App.jsx לקומפוננטות, הוספת streaming ל־optimization progress, או כל שינוי אחר שתרצה.
