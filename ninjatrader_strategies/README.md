# NinjaTrader Strategies – השוואה ל-SYSTEM ALPHA

תיקייה זו מכילה קוד אסטרטגיות NinjaTrader המקבילות לאסטרטגיות ב-SYSTEM ALPHA.

**מעקב כיסוי ספרייה:** ראה [LIBRARY_COVERAGE.md](LIBRARY_COVERAGE.md)

---

## E1 – שינוי יומי % + MACD Cross

אסטרטגיה עם תנאי שינוי יומי: מסננת ימים שבהם השינוי מהסגירה של היום הקודם חורג מהטווח.

- **כניסה:** טווח זמן 08:30–13:40 + שינוי יומי בטווח (ברירת מחדל -2.1% עד 10%) + MACD חוצה מעל Signal
- **יציאה:** MACD חוצה מתחת ל-Signal + Stop Loss 80 טיקים + Take Profit 160 טיקים

### התקנה
העתק `E1.cs` ל-`Documents\NinjaTrader 8\bin\Custom\Strategies\Build\` וקמפל. דורש PriorDayOHLC מובנה.

---

## D1 – MACD בלבד (בדיקת פער)

אסטרטגיה מינימלית לאיתור פער MACD בין NinjaTrader ל-SYSTEM ALPHA.

- **כניסה:** טווח זמן 08:30–13:40 + MACD חוצה מעל Signal
- **יציאה:** Stop Loss 80 טיקים, Take Profit 160 טיקים

### התקנה
העתק `D1.cs` ל-`Documents\NinjaTrader 8\bin\Custom\Strategies\Build\` וקמפל.

---

## C1 – MACD Cross + EMA + ATR + Volume (כיסוי ספרייה)

תנאים חדשים: macd_cross_above/below_signal, price_above_ema, atr_in_range, volume_above_avg, candle_body_min_ticks, session_close_exit.

### התקנה
העתק `C1.cs` ל-`Documents\NinjaTrader 8\bin\Custom\Strategies\Build\` וקמפל.

---

## B1 – RSI Oversold + ADX + Volume Spike + Pullback

אסטרטגיית Long שמשלבת מספר תנאים מספריית התנאים.

### התקנה ב-NinjaTrader
1. העתק את `B1.cs` לתיקיית `Documents\NinjaTrader 8\bin\Custom\Strategies\Build\`
2. פתח NinjaScript Editor (Ctrl+Shift+N) → Compile (F5)
3. הוסף את האסטרטגיה לתרשים

### תנאי כניסה (כולם חייבים להתקיים)
| # | תנאי | SYSTEM ALPHA | NinjaTrader |
|---|------|--------------|-------------|
| 1 | טווח זמן | 08:30–13:40 | EntryStartTime=830, EntryEndTime=1340 |
| 2 | RSI מתחת | period=14, threshold=30 | RSI(14) < 30 |
| 3 | ADX בטווח | period=14, min=18, max=55 | 18 ≤ ADX(14) ≤ 55 |
| 4 | נר ירוק | close > open | Close[0] > Open[0] |
| 5 | פריצת נפח | period=16, multiplier=1.6 | Volume[0] ≥ avg(Vol[1..16]) × 1.6 |
| 6 | מינימום נרות אדומים | minCount=2, lookback=6 | לפחות 2 נרות אדומים ב־6 האחרונים |
| 7 | טווח נר | minTicks=15, maxTicks=250 | 15 ≤ (High-Low)/TickSize ≤ 250 |

### תנאי יציאה
| תנאי | פרמטרים |
|------|----------|
| RSI מעל | threshold=68 |
| Stop Loss | 60 טיקים |
| Take Profit | 120 טיקים |

### השוואה
- **Primary Timeframe**: 1 דקה (כמו תרשים 1m בנינג'ה)
- **Session**: RTH (לתאימות – ודא minutes >= 510)
- **נתונים**: אותה סדרת CSV / אותו instrument
