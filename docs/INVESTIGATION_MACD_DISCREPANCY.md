# תחקיר: פער MACD – NinjaTrader (310 עסקאות) vs SYSTEM ALPHA (227 עסקאות)

## סיכום מנהלים

באסטרטגיה C1 עם תנאי כניסה "MACD חוצה מעל Signal", NinjaTrader מניב **310 עסקאות** בעוד ש-SYSTEM ALPHA מניב **~227 עסקאות**. הרווח הכספי דומה (~$9,000–$10,000). הפער נחקר – זהו מסמך תחקיר בלבד, ללא שינויים בקוד.

---

## 1. Wilder's Smoothing vs EMA – ממצאים

### NinjaTrader MACD – קוד מקור (מפורום NinjaTrader)

מקור: [Smooth MACD line - NinjaTrader Support Forum](https://forum.ninjatrader.com/forum/ninjatrader-7/indicator-development-aa/23815-smooth-macd-line)

```csharp
// Bar 0 - initialization
fastEma.Set(Input[0]);
slowEma.Set(Input[0]);
Value.Set(0);
Avg.Set(0);
Diff.Set(0);

// Bar 1+ - calculation
fastEma.Set((2.0 / (1 + Fast)) * Input[0] + (1 - (2.0 / (1 + Fast))) * fastEma[1]);
slowEma.Set((2.0 / (1 + Slow)) * Input[0] + (1 - (2.0 / (1 + Slow))) * slowEma[1]);
double macd = fastEma[0] - slowEma[0];
double macdAvg = (2.0 / (1 + Smooth)) * macd + (1 - (2.0 / (1 + Smooth))) * Avg[1];
```

**מסקנה:** NinjaTrader משתמש ב-**EMA סטנדרטי** עם `2/(period+1)`, **לא** ב-Wilder's smoothing (`1/period`).

### Wilder's vs EMA – נוסחאות

| סוג | נוסחה | דוגמה (period=9) |
|-----|------|------------------|
| **EMA** | multiplier = 2/(period+1) | 2/10 = 0.2 |
| **Wilder's** | multiplier = 1/period | 1/9 ≈ 0.111 |

Wilder's מניב קו Signal **איטי יותר** (פחות רגיש). Wilder's 9 ≈ EMA 17 בערך.

### האם Wilder מסביר את הפער?

- אם NinjaTrader משתמש ב-Wilder ו-SYSTEM ALPHA ב-EMA → NinjaTrader יהיה **איטי יותר** → **פחות** חציות → פחות עסקאות.
- בפועל: NinjaTrader **יותר** עסקאות (310) מאשר המערכת (227).

לכן **לא סביר** שההבדל נובע מ-Wilder's, אלא אם יש שילוב עם גורמים אחרים.

**הערה:** הקוד שמצאנו הוא מ-NinjaTrader 7. ב-NinjaTrader 8 ייתכן שינוי – יש לבדוק את קוד ה-MACD ב-NT8.

---

## 2. אתחול EMA – הבדל פוטנציאלי

### NinjaTrader (Bar 0)
- `fastEma` ו-`slowEma` מאותחלים ב-`Input[0]` (מחיר הסגירה הראשון)
- MACD ו-Signal מוגדרים ל-0 בבר הראשון
- מכתב 1 והלאה: נוסחת EMA רקורסיבית

### גישה סטנדרטית (SMA כזרע)
- EMA מתחיל רק אחרי `period` ברים
- הזרע: SMA של `period` הערכים הראשונים
- עד אז: null / NaN

**השפעה:** אופן האתחול משפיע על ה־MACD וה-Signal בברים הראשונים (למשל 26–35). אם יש הבדל, הוא בעיקר בתחילת הנתונים ולאו דווקא במהלך הטווח.

---

## 3. אפשרויות נוספות לפער

### 3.1 סוג Smooth ב-NinjaTrader 8
- ב-NT8 ייתכן פרמטר `SmoothType` / `AverageType`
- TradingView תומך ב-RMA (Wilder's) כאופציה ל-MACD
- יש לבדוק אם ל-MACD של NT8 יש בחירת סוג מחושב (EMA / SMA / Wilder וכו')

### 3.2 Calculate.OnBarClose vs OnEachTick
- OnBarClose: חישוב וסיגנל רק בסגירת בר
- OnEachTick: חישוב בכל טיק – עלול ליצור סיגנלים שונים
- יש לוודא שהאסטרטגיה רצה ב-OnBarClose אם זה מה שאנחנו מדמים

### 3.3 גישה לאינדקסים (Histogram / Diff)
- ב-NinjaTrader: `MACD[0]`, `Avg[0]`, `Diff[0]` (Histogram)
- חציית "מעל Signal" שקולה ל-`Diff` שעובר מ-0- ל-0+
- יש לוודא שאנחנו משתמשים באותו אינדקס ובאותו רגע (למשל סגירת הבר)

### 3.4 נתונים ו-Timeframe
- הבדל בזמני ברים (דקה 1, סגירה לפי דקה וכו')
- אופן אגרגציה (למשל Open/High/Low/Close) – בדרך כלל Close
- מקור הנתונים (feed, broker, ארכיון) – יכול ליצור הבדלים קטנים שמצטברים

---

## 4. המלצות להמשך

1. **בדיקת קוד MACD ב-NinjaTrader 8**  
   לוודא שאין פרמטר SmoothType/AverageType שמשנה את החישוב.

2. **בדיקת אתחול EMA**  
   להשוות במפורש את ערכי MACD ו-Signal בברים 0–40 בין NinjaTrader ל-SYSTEM ALPHA על אותו קובץ נתונים.

3. **בדיקת פרמטר Calculate**  
   לוודא שהאסטרטגיה מוגדרת ל-OnBarClose אם זה המודל שאנחנו רוצים.

4. **ניסוי עם Wilder's לקו ה-Signal**  
   להוסיף אופציה ל-Wilder's smoothing ולהשוות:
   - אם עם Wilder's מתקבל מספר עסקאות דומה ל-NinjaTrader – ייתכן ש-NT משתמש ב-Wilder's
   - אם לא – לחפש גורם אחר (אתחול, timing, נתונים).

---

## 5. מקורות

- [Smooth MACD line - NinjaTrader Forum](https://forum.ninjatrader.com/forum/ninjatrader-7/indicator-development-aa/23815-smooth-macd-line) – קוד MACD של NinjaTrader
- [NinjaTrader: What is the MACD Indicator?](https://ninjatrader.com/futures/blogs/what-is-the-macd-indicator/)
- [Investopedia: MACD Calculation](https://www.investopedia.com/ask/answers/122414/what-moving-average-convergence-divergence-macd-formula-and-how-it-calculated.asp)
- [Tulip Indicators: Wilder's Smoothing](https://tulipindicators.org/wilders)
- [TradingView: MACD with RMA option](https://www.tradingview.com/scripts/macd/)
