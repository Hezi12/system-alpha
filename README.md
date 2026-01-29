# SYSTEM ALPHA

מערכת מסחר אלגוריתמית – Backtest ואופטימיזציה לאסטרטגיות.

---

## הרצה

```bash
./start.sh    # הפעלת המערכת (Backend + Vite + Electron)
./stop.sh     # עצירת המערכת
```

**דרישות:** Python 3 עם venv בתיקיית `backend`, Node.js מותקן. לפני הפעלה ראשונה:

```bash
cd backend && python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt && cd ..
npm install
```

---

## ארכיטקטורה

| רכיב | טכנולוגיה | פורט |
|------|-----------|------|
| Backend | Python (FastAPI, NumPy, Numba) | 4000 |
| Frontend | React + Vite | 5173 |
| Desktop | Electron | — |

**תכונות:** העלאת CSV, בקטסט, אופטימיזציה, גרפים (LightweightCharts), אסטרטגיות שמורות.

---

## מבנה הפרויקט

```
.
├── backend/           # Python Backend (FastAPI)
│   ├── app/           # קוד: main, models, backtest, indicators, optimizer
│   └── requirements.txt
├── docs/              # תיעוד (סקירת מערכת, תחקירים)
├── electron/          # Electron – חלון האפליקציה
├── scripts/           # סקריפטי בדיקה/השוואה (אופציונלי)
├── src/                # React Frontend
│   ├── App.jsx        # מרכיב ראשי (גרפים, אסטרטגיה, תוצאות)
│   ├── api.js         # קריאות ל-Backend
│   ├── conditions.js  # הגדרות תנאי כניסה/יציאה
│   └── indicators.js  # חישובי אינדיקטורים (צד לקוח)
├── index.html
├── package.json
├── vite.config.js
├── start.sh / stop.sh
└── README.md
```

---

## פיתוח

- **Backend:** http://localhost:4000  
- **Vite:** http://localhost:5173  
- **Electron:** פותח חלון וטוען את האתר.

שינויים בקוד מתעדכנים אוטומטית (Hot Reload).

---

## משתני סביבה (אופציונלי)

העתק `.env.example` ל-`.env` ועדכן אם נדרש:

- `VITE_GEMINI_API_KEY` – לשימוש בתכונות AI (אופציונלי).

---

## תיעוד נוסף

- [docs/README.md](docs/README.md) – רשימת מסמכי תיעוד (סקירת מערכת, תחקיר RTH).
- [docs/SYSTEM_OVERVIEW.md](docs/SYSTEM_OVERVIEW.md) – סקירת מערכת מלאה למפתחים.

---

## בנייה (Build)

```bash
npm run build          # בניית Frontend ל-dist/
npm run electron:build # בניית אפליקציית Electron (DMG/NSIS/AppImage)
```
