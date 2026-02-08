# סקריפטים (אופציונלי)

סקריפטים אלה משמשים **לבדיקות והשוואות** במהלך פיתוח. אין חובה להריץ אותם כדי שהאפליקציה תעבוד.

## סקריפטי השוואה

| קובץ | תיאור | שימוש |
|------|--------|-------|
| `compare_strategy_2023.mjs` | השוואת אסטרטגיה (RSI + time_range) בין Primary=5 ל-Primary=1 + RSI על 5m | `node scripts/compare_strategy_2023.mjs <csv> [--rth] [--limit N]` |
| `compare_rsi_modes.mjs` | השוואת מצבי RSI שונים (Primary=5 vs Primary=1+MTF) | `node scripts/compare_rsi_modes.mjs <csv> [--limit N]` |

## סקריפטי הרצת אסטרטגיות

| קובץ | תיאור | שימוש |
|------|--------|-------|
| `run_c1_backtest_2023.mjs` | הרצת אסטרטגיית C1 (ווריאנטים: FULL, REDUCED, MACD, D1, E1) דרך ה-Backend API | `node scripts/run_c1_backtest_2023.mjs <csv> [--reduced] [--macd] [--d1] [--e1] [--match-image] [--no-rth]` |
| `run_strategy_rsi_time_adx_2023.mjs` | הרצת אסטרטגיה עם RSI, זמן ו-ADX | `node scripts/run_strategy_rsi_time_adx_2023.mjs <csv>` |
| `run_strategy_from_screenshot_2023.mjs` | הרצת אסטרטגיה לפי הגדרות מתמונה/צילום מסך | `node scripts/run_strategy_from_screenshot_2023.mjs <csv>` |

## כלי עזר

| קובץ | תיאור | שימוש |
|------|--------|-------|
| `export_macd_values.py` | ייצוא ערכי MACD ל-debug (Python) | `python scripts/export_macd_values.py` |

## דרישות

- **Node.js** (ESM) לסקריפטי `.mjs`
- **Python 3** + dependencies מ-`backend/requirements.txt` לסקריפט Python
- נתוני CSV בפורמט עם עמודות `datetime`/`time`, `open`, `high`, `low`, `close`, `volume`
- עבור `run_c1_backtest_2023.mjs`: Backend חייב לרוץ (`./start.sh`)
