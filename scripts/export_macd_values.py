#!/usr/bin/env python3
"""
מייצא ערכי MACD של SYSTEM ALPHA לברים ספציפיים – להשוואה עם NinjaTrader.
שימוש: python scripts/export_macd_values.py NQ_2023.csv

ספק את הפלט יחד עם ערכי NinjaTrader כדי לאתר את הפער.
"""
import sys
import pandas as pd
import numpy as np
from pathlib import Path

# Add backend to path
sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))
from app.indicators import calculate_ema, calculate_macd


def main():
    csv_path = sys.argv[1] if len(sys.argv) > 1 else "NQ_2023.csv"
    df = pd.read_csv(csv_path)
    df.columns = df.columns.str.lower().str.strip()
    if "datetime" in df.columns:
        df.rename(columns={"datetime": "time"}, inplace=True)
    df["time"] = pd.to_datetime(df["time"])
    df = df[df["time"].dt.year == 2023].reset_index(drop=True)

    close = df["close"].values.astype(np.float64)
    macd_line, signal_line, histogram = calculate_macd(close, 12, 26, 9)

    print("=== SYSTEM ALPHA – ערכי MACD ל-2023-01-03 08:35–08:45 ===\n")
    print("datetime           | Macd        | Avg(Signal) | Diff(Hist) | Cross>0?")
    print("-" * 70)

    for i in range(len(df)):
        t = df["time"].iloc[i]
        if t.day == 3 and t.month == 1 and t.hour == 8 and 35 <= t.minute <= 45:
            m = macd_line[i] if not np.isnan(macd_line[i]) else float("nan")
            s = signal_line[i] if not np.isnan(signal_line[i]) else float("nan")
            h = histogram[i] if not np.isnan(histogram[i]) else float("nan")
            cross = ""
            if i >= 1 and not np.isnan(histogram[i - 1]) and not np.isnan(histogram[i]):
                if histogram[i - 1] <= 0 and histogram[i] > 0:
                    cross = " <-- CROSS ABOVE"
            ts = t.strftime("%Y-%m-%d %H:%M")
            print(f"{ts} | {m:11.4f} | {s:11.4f} | {h:10.4f} |{cross}")

    print("\n=== הערות ===")
    print("Cross>0 = Histogram (Diff) חוצה מעל 0 = MACD חוצה מעל Signal")
    print("שלח ערכים מקבילים מ-NinjaTrader להשוואה")


if __name__ == "__main__":
    main()
