# כיסוי ספריית התנאים – מעקב שיטתי

מטרה: לבדוק את כל התנאים בספרייה מול NinjaTrader. כל אסטרטגיה חדשה משתמשת בתנאים שעדיין לא נבדקו.

## תנאים שנבדקו ✓

| קטגוריה | תנאי | אסטרטגיה |
|---------|------|----------|
| TIME | time_range | B1, C1, E1 |
| RSI | rsi_below, rsi_above | B1 |
| ADX | adx_range | B1 |
| ATR | atr_in_range | C1 |
| MACD | macd_cross_above_signal, macd_cross_below_signal | C1, E1 |
| MA | price_above_ema | C1 |
| PRICE | green_candle, min_red_candles, bar_range_ticks_range | B1 |
| PRICE | candle_body_min_ticks | C1 |
| PRICE | market_change_percent_range | E1 |
| VOLUME | volume_spike | B1 |
| VOLUME | volume_above_avg | C1 |
| STOP | stop_loss_ticks, take_profit_ticks | B1, C1, E1 |

## תנאים שעוד לא נבדקו מול NinjaTrader

| קטגוריה | תנאים |
|---------|-------|
| RSI | rsi_cross_above, rsi_cross_below, rsi_in_range |
| ADX | adx_above, adx_below |
| MA | price_below_sma, price_below_ema, sma_cross_above, sma_cross_below |
| BB | price_above_bb_upper, price_below_bb_lower |
| VOLUME | volume_profile_ratio |
| PRICE | min_green_candles, higher_high, lower_low |
| TIME | time (exact) |
| STOP | trailing_stop_ticks, session_close_exit |

## אסטרטגיות

| אסטרטגיה | תנאים | סטטוס |
|----------|-------|-------|
| B1 | time_range, rsi_below/above, adx_range, green_candle, volume_spike, min_red_candles, bar_range_ticks_range, SL, TP | ✓ נבדק - תוצאות תואמות |
| C1 | time_range, macd_cross_above/below_signal, price_above_ema, atr_in_range, volume_above_avg, candle_body_min_ticks, SL, TP | ✓ נוצר - תוצאות קרובות (פער MACD ידוע) |
| D1 | time_range, macd_cross_above/below (histogram), SL, TP | ✓ נוצר - ראה תחקיר D1 |
| E1 | time_range, market_change_percent_range, macd_cross_above/below_signal, SL, TP | ✓ נוצר |
