# סקריפטים (אופציונלי)

סקריפטים אלה משמשים **לבדיקות והשוואות** במהלך פיתוח. אין חובה להריץ אותם כדי שהאפליקציה תעבוד.

| קובץ | תיאור |
|------|--------|
| `compare_strategy_2023.mjs` | השוואת אסטרטגיה (RSI + time_range) בין Primary=5 ל-Primary=1 + RSI על 5m. שימוש: `node scripts/compare_strategy_2023.mjs <קובץ-csv> [--rth] [--limit N]` |
| `compare_rsi_modes.mjs` | השוואת מצבי RSI שונים. |
| `run_strategy_rsi_time_adx_2023.mjs` | הרצת אסטרטגיה עם RSI, זמן ו-ADX. |
| `run_strategy_from_screenshot_2023.mjs` | הרצת אסטרטגיה לפי הגדרות מתמונה/צילום מסך. |

**דרישות:** Node.js (ESM). נתוני CSV בפורמט עם עמודות datetime/time, open, high, low, close, volume.
