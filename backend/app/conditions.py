"""
Condition Handlers for Backtest Engine
Each handler takes (data, indicator_bank, condition, length) and returns np.ndarray of bools.
"""
import numpy as np
import pandas as pd
from datetime import datetime
from typing import Dict, Any, Callable
from app.models import StrategyCondition
from app import TICK_SIZE, FOMC_DATES


# ---------------------------------------------------------------------------
# RSI Conditions
# ---------------------------------------------------------------------------

def rsi_below(data, indicator_bank, condition, length):
    params = condition.params
    tf = condition.timeframe or "DEF"
    period = params.get('period', 14)
    threshold = params.get('threshold', 30)
    rsi = indicator_bank.get_mtf(f'rsi_{period}', tf)
    return rsi < threshold


def rsi_above(data, indicator_bank, condition, length):
    params = condition.params
    tf = condition.timeframe or "DEF"
    period = params.get('period', 14)
    threshold = params.get('threshold', 70)
    rsi = indicator_bank.get_mtf(f'rsi_{period}', tf)
    return rsi > threshold


def rsi_crosses_above(data, indicator_bank, condition, length):
    params = condition.params
    tf = condition.timeframe or "DEF"
    period = params.get('period', 14)
    threshold_value = params.get('threshold', params.get('value', 30))
    if isinstance(threshold_value, str) and ';' in threshold_value:
        threshold = float(threshold_value.split(';')[0])
    else:
        threshold = float(threshold_value) if threshold_value else 30
    rsi = indicator_bank.get_mtf(f'rsi_{period}', tf)
    result = np.zeros(len(rsi), dtype=bool)
    result[1:] = (rsi[:-1] < threshold) & (rsi[1:] >= threshold)
    return result


# Alias
rsi_cross_above = rsi_crosses_above


def rsi_crosses_below(data, indicator_bank, condition, length):
    params = condition.params
    tf = condition.timeframe or "DEF"
    period = params.get('period', 14)
    threshold_value = params.get('threshold', params.get('value', 70))
    if isinstance(threshold_value, str) and ';' in threshold_value:
        threshold = float(threshold_value.split(';')[0])
    else:
        threshold = float(threshold_value) if threshold_value else 70
    rsi = indicator_bank.get_mtf(f'rsi_{period}', tf)
    result = np.zeros(len(rsi), dtype=bool)
    result[1:] = (rsi[:-1] > threshold) & (rsi[1:] <= threshold)
    return result


# Alias
rsi_cross_below = rsi_crosses_below


def rsi_in_range(data, indicator_bank, condition, length):
    params = condition.params
    tf = condition.timeframe or "DEF"
    period = params.get('period', 14)
    min_val = params.get('min', 1)
    max_val = params.get('max', 84)
    rsi = indicator_bank.get_mtf(f'rsi_{period}', tf)
    return (rsi >= min_val) & (rsi <= max_val)


def rsi_exit_below(data, indicator_bank, condition, length):
    params = condition.params
    tf = condition.timeframe or "DEF"
    period = params.get('period', 14)
    level = params.get('level', 18)
    rsi = indicator_bank.get_mtf(f'rsi_{period}', tf)
    return rsi < level


# ---------------------------------------------------------------------------
# MACD Conditions
# ---------------------------------------------------------------------------

def macd_cross_above(data, indicator_bank, condition, length):
    params = condition.params
    tf = condition.timeframe or "DEF"
    fast = params.get('fast', 12)
    slow = params.get('slow', 26)
    signal_period = params.get('signal', 9)
    macd = indicator_bank.get_mtf(f'macd_{fast}_{slow}_{signal_period}', tf)
    signal_line = indicator_bank.get_mtf(f'macd_signal_{fast}_{slow}_{signal_period}', tf)
    cross = (macd[:-1] <= signal_line[:-1]) & (macd[1:] > signal_line[1:])
    return np.concatenate([[False], cross])


# Alias
macd_cross_above_signal = macd_cross_above


def macd_cross_below(data, indicator_bank, condition, length):
    params = condition.params
    tf = condition.timeframe or "DEF"
    fast = params.get('fast', 12)
    slow = params.get('slow', 26)
    signal_period = params.get('signal', 9)
    macd = indicator_bank.get_mtf(f'macd_{fast}_{slow}_{signal_period}', tf)
    signal_line = indicator_bank.get_mtf(f'macd_signal_{fast}_{slow}_{signal_period}', tf)
    cross = (macd[:-1] >= signal_line[:-1]) & (macd[1:] < signal_line[1:])
    return np.concatenate([[False], cross])


# Alias
macd_cross_below_signal = macd_cross_below


# ---------------------------------------------------------------------------
# MA Conditions
# ---------------------------------------------------------------------------

def price_above_sma(data, indicator_bank, condition, length):
    params = condition.params
    tf = condition.timeframe or "DEF"
    period = params.get('period', 20)
    sma = indicator_bank.get_mtf(f'sma_{period}', tf)
    return data['close'] > sma


def price_below_sma(data, indicator_bank, condition, length):
    params = condition.params
    tf = condition.timeframe or "DEF"
    period = params.get('period', 20)
    sma = indicator_bank.get_mtf(f'sma_{period}', tf)
    return data['close'] < sma


def price_above_ema(data, indicator_bank, condition, length):
    params = condition.params
    tf = condition.timeframe or "DEF"
    period = params.get('period', 20)
    ema = indicator_bank.get_mtf(f'ema_{period}', tf)
    return data['close'] > ema


def price_below_ema(data, indicator_bank, condition, length):
    params = condition.params
    tf = condition.timeframe or "DEF"
    period = params.get('period', 20)
    ema = indicator_bank.get_mtf(f'ema_{period}', tf)
    return data['close'] < ema


def price_below_ema_multiple(data, indicator_bank, condition, length):
    params = condition.params
    tf = condition.timeframe or "DEF"
    close = data['close']
    period = params.get('period', 10)
    required_bars = params.get('requiredBars', 15)
    ema = indicator_bank.get_mtf(f'ema_{period}', tf)
    if length < required_bars:
        return np.zeros(length, dtype=bool)
    result = np.zeros(length, dtype=bool)
    for i in range(required_bars - 1, length):
        all_below = True
        for j in range(required_bars):
            if close[i - j] >= ema[i - j]:
                all_below = False
                break
        result[i] = all_below
    return result


def price_below_sma_multiple(data, indicator_bank, condition, length):
    params = condition.params
    tf = condition.timeframe or "DEF"
    close = data['close']
    period = params.get('period', 9)
    required_bars = params.get('requiredBars', 14)
    sma = indicator_bank.get_mtf(f'sma_{period}', tf)
    if length < required_bars:
        return np.zeros(length, dtype=bool)
    result = np.zeros(length, dtype=bool)
    for i in range(required_bars - 1, length):
        all_below = True
        for j in range(required_bars):
            if close[i - j] >= sma[i - j]:
                all_below = False
                break
        result[i] = all_below
    return result


def sma_short_above_long_lookback(data, indicator_bank, condition, length):
    params = condition.params
    tf = condition.timeframe or "DEF"
    short_period = params.get('shortPeriod', 49)
    long_period = params.get('longPeriod', 98)
    lookback = params.get('lookback', 190)
    short_sma = indicator_bank.get_mtf(f'sma_{short_period}', tf)
    long_sma = indicator_bank.get_mtf(f'sma_{long_period}', tf)
    if length < lookback:
        return np.zeros(length, dtype=bool)
    result = np.zeros(length, dtype=bool)
    for i in range(lookback - 1, length):
        found_above = False
        for j in range(lookback):
            if short_sma[i - j] >= long_sma[i - j]:
                found_above = True
                break
        result[i] = found_above
    return result


# ---------------------------------------------------------------------------
# Bollinger Band Conditions
# ---------------------------------------------------------------------------

def price_below_bb_lower(data, indicator_bank, condition, length):
    params = condition.params
    tf = condition.timeframe or "DEF"
    period = params.get('period', 20)
    lower = indicator_bank.get_mtf(f'bb_lower_{period}', tf)
    return data['close'] < lower


def price_above_bb_upper(data, indicator_bank, condition, length):
    params = condition.params
    tf = condition.timeframe or "DEF"
    period = params.get('period', 20)
    upper = indicator_bank.get_mtf(f'bb_upper_{period}', tf)
    return data['close'] > upper


# ---------------------------------------------------------------------------
# Price Action Conditions
# ---------------------------------------------------------------------------

def _align_to_primary(indicator_bank, tf, tf_result, length):
    """Helper to align higher-timeframe results back to primary timeframe."""
    primary_close = indicator_bank._get_close_times("DEF")
    tf_close_times = indicator_bank._get_close_times(tf)
    indices = np.searchsorted(tf_close_times, primary_close, side='right') - 1
    valid_mask = indices >= 0
    aligned = np.full(length, False)
    aligned[valid_mask] = tf_result[indices[valid_mask]]
    return aligned


def _ensure_tf_data(indicator_bank, tf):
    """Helper to ensure aggregated timeframe data exists."""
    tf_mins = int(tf)
    if tf not in indicator_bank.timeframes:
        indicator_bank.timeframes[tf] = indicator_bank._aggregate_data(tf_mins)
    return indicator_bank.timeframes[tf]


def candle_body_min_ticks(data, indicator_bank, condition, length):
    params = condition.params
    tf = condition.timeframe or "DEF"
    min_ticks = params.get('minTicks', 34)

    if tf == "DEF" or tf is None:
        body_ticks = np.abs(data['close'] - data['open']) / TICK_SIZE
        return body_ticks >= min_ticks
    else:
        tf_data = _ensure_tf_data(indicator_bank, tf)
        tf_close = tf_data['close']
        tf_open = tf_data['open']
        tf_body_ticks = np.abs(tf_close - tf_open) / TICK_SIZE
        tf_result = tf_body_ticks >= min_ticks
        return _align_to_primary(indicator_bank, tf, tf_result, length)


def bar_range_ticks_range(data, indicator_bank, condition, length):
    params = condition.params
    tf = condition.timeframe or "DEF"
    min_ticks = params.get('minTicks', 12)
    max_ticks = params.get('maxTicks', 300)

    if tf == "DEF" or tf is None:
        range_ticks = (data['high'] - data['low']) / TICK_SIZE
        return (range_ticks >= min_ticks) & (range_ticks <= max_ticks)
    else:
        tf_data = _ensure_tf_data(indicator_bank, tf)
        tf_high = tf_data['high']
        tf_low = tf_data['low']
        tf_range_ticks = (tf_high - tf_low) / TICK_SIZE
        tf_result = (tf_range_ticks >= min_ticks) & (tf_range_ticks <= max_ticks)
        return _align_to_primary(indicator_bank, tf, tf_result, length)


def bar_range_ticks(data, indicator_bank, condition, length):
    """Compatibility alias for bar_range_ticks_range (no MTF support)."""
    params = condition.params
    min_ticks = params.get('minTicks', 12)
    max_ticks = params.get('maxTicks', 300)
    range_ticks = (data['high'] - data['low']) / TICK_SIZE
    return (range_ticks >= min_ticks) & (range_ticks <= max_ticks)


def min_red_candles(data, indicator_bank, condition, length):
    params = condition.params
    tf = condition.timeframe or "DEF"
    min_count = params.get('minCount', 1)
    lookback = params.get('lookback', 10)

    if tf == "DEF" or tf is None:
        close = data['close']
        open_ = data['open']
        if length < lookback:
            return np.zeros(length, dtype=bool)
        result = np.zeros(length, dtype=bool)
        for i in range(lookback - 1, length):
            red_count = np.sum(close[i-lookback+1:i+1] < open_[i-lookback+1:i+1])
            result[i] = red_count >= min_count
        return result
    else:
        tf_data = _ensure_tf_data(indicator_bank, tf)
        tf_close = tf_data['close']
        tf_open = tf_data['open']
        tf_length = len(tf_close)

        if tf_length < lookback:
            return np.zeros(length, dtype=bool)

        tf_result = np.zeros(tf_length, dtype=bool)
        for i in range(lookback - 1, tf_length):
            red_count = np.sum(tf_close[i-lookback+1:i+1] < tf_open[i-lookback+1:i+1])
            tf_result[i] = red_count >= min_count

        return _align_to_primary(indicator_bank, tf, tf_result, length)


def min_green_candles(data, indicator_bank, condition, length):
    params = condition.params
    tf = condition.timeframe or "DEF"
    min_count = params.get('minCount', 6)
    lookback = params.get('lookback', 17)

    if tf == "DEF" or tf is None:
        close = data['close']
        open_ = data['open']
        if length < lookback:
            return np.zeros(length, dtype=bool)
        result = np.zeros(length, dtype=bool)
        for i in range(lookback - 1, length):
            green_count = np.sum(close[i-lookback+1:i+1] > open_[i-lookback+1:i+1])
            result[i] = green_count >= min_count
        return result
    else:
        tf_data = _ensure_tf_data(indicator_bank, tf)
        tf_close = tf_data['close']
        tf_open = tf_data['open']
        tf_length = len(tf_close)

        if tf_length < lookback:
            return np.zeros(length, dtype=bool)

        tf_result = np.zeros(tf_length, dtype=bool)
        for i in range(lookback - 1, tf_length):
            green_count = np.sum(tf_close[i-lookback+1:i+1] > tf_open[i-lookback+1:i+1])
            tf_result[i] = green_count >= min_count

        return _align_to_primary(indicator_bank, tf, tf_result, length)


def green_red_reversal_exit(data, indicator_bank, condition, length):
    params = condition.params
    min_green_ticks = params.get('minGreenTicks', 30)
    red_larger_percent = params.get('redLargerPercent', 550)
    close = data['close']
    open_ = data['open']
    if length < 2:
        return np.zeros(length, dtype=bool)
    result = np.zeros(length, dtype=bool)
    for i in range(1, length):
        # Previous bar must be green
        prev_green = close[i-1] > open_[i-1]
        if not prev_green:
            continue
        # Current bar must be red
        curr_red = close[i] < open_[i]
        if not curr_red:
            continue
        # Check green candle size
        green_ticks = (close[i-1] - open_[i-1]) / TICK_SIZE
        if green_ticks < min_green_ticks:
            continue
        # Check red candle is X% larger
        red_ticks = (open_[i] - close[i]) / TICK_SIZE
        red_percent = (red_ticks / green_ticks) * 100.0
        if red_percent >= red_larger_percent:
            result[i] = True
    return result


def big_reverse_candle_exit(data, indicator_bank, condition, length):
    params = condition.params
    min_ticks = params.get('minTicks', 90)
    close = data['close']
    open_ = data['open']
    result = np.zeros(length, dtype=bool)
    for i in range(1, length):
        if close[i] < open_[i]:  # Red candle
            body_ticks = (open_[i] - close[i]) / TICK_SIZE
            if body_ticks >= min_ticks:
                result[i] = True
    return result


def green_candle(data, indicator_bank, condition, length):
    tf = condition.timeframe or "DEF"

    if tf == "DEF" or tf is None:
        return data['close'] > data['open']
    else:
        tf_data = _ensure_tf_data(indicator_bank, tf)
        tf_close = tf_data['close']
        tf_open = tf_data['open']
        tf_result = tf_close > tf_open
        return _align_to_primary(indicator_bank, tf, tf_result, length)


# ---------------------------------------------------------------------------
# Stochastic Conditions
# ---------------------------------------------------------------------------

def stoch_below(data, indicator_bank, condition, length):
    params = condition.params
    tf = condition.timeframe or "DEF"
    k_period = params.get('k_period', 14)
    d_period = params.get('d_period', 3)
    threshold = params.get('threshold', 20)
    k = indicator_bank.get_mtf(f'stoch_k_{k_period}_{d_period}', tf)
    return k < threshold


def stoch_above(data, indicator_bank, condition, length):
    params = condition.params
    tf = condition.timeframe or "DEF"
    k_period = params.get('k_period', 14)
    d_period = params.get('d_period', 3)
    threshold = params.get('threshold', 80)
    k = indicator_bank.get_mtf(f'stoch_k_{k_period}_{d_period}', tf)
    return k > threshold


def stoch_cross_above(data, indicator_bank, condition, length):
    params = condition.params
    tf = condition.timeframe or "DEF"
    k_period = params.get('kPeriod', 14)
    d_period = params.get('dPeriod', 3)
    k = indicator_bank.get_mtf(f'stoch_k_{k_period}_{d_period}', tf)
    d = indicator_bank.get_mtf(f'stoch_d_{k_period}_{d_period}', tf)
    return (k[:-1] <= d[:-1]) & (k[1:] > d[1:])


def stoch_cross_below(data, indicator_bank, condition, length):
    params = condition.params
    tf = condition.timeframe or "DEF"
    k_period = params.get('kPeriod', 14)
    d_period = params.get('dPeriod', 3)
    k = indicator_bank.get_mtf(f'stoch_k_{k_period}_{d_period}', tf)
    d = indicator_bank.get_mtf(f'stoch_d_{k_period}_{d_period}', tf)
    return (k[:-1] >= d[:-1]) & (k[1:] < d[1:])


# ---------------------------------------------------------------------------
# ADX Conditions
# ---------------------------------------------------------------------------

def adx_range(data, indicator_bank, condition, length):
    params = condition.params
    tf = condition.timeframe or "DEF"
    period = params.get('period', 14)
    min_val = params.get('min', 16)
    max_val = params.get('max', 56)
    adx = indicator_bank.get_mtf(f'adx_{period}', tf)
    return (adx >= min_val) & (adx <= max_val)


# Compatibility alias
adx_in_range = adx_range


def adx_exit_range(data, indicator_bank, condition, length):
    params = condition.params
    tf = condition.timeframe or "DEF"
    period = params.get('period', 6)
    min_val = params.get('min', 12)
    max_val = params.get('max', 93)
    adx = indicator_bank.get_mtf(f'adx_{period}', tf)
    return (adx < min_val) | (adx > max_val)


# ---------------------------------------------------------------------------
# ATR Conditions
# ---------------------------------------------------------------------------

def atr_in_range(data, indicator_bank, condition, length):
    params = condition.params
    tf = condition.timeframe or "DEF"
    period = params.get('period', 30)
    min_val = params.get('min', 12)
    max_val = params.get('max', 55)
    atr = indicator_bank.get_mtf(f'atr_{period}', tf)
    return (atr >= min_val) & (atr <= max_val)


def atr_exit_range(data, indicator_bank, condition, length):
    params = condition.params
    tf = condition.timeframe or "DEF"
    period = params.get('period', 8)
    min_val = params.get('min', 14)
    max_val = params.get('max', 86)
    atr = indicator_bank.get_mtf(f'atr_{period}', tf)
    return (atr < min_val) | (atr > max_val)


# ---------------------------------------------------------------------------
# Market Conditions
# ---------------------------------------------------------------------------

def market_change_percent_range(data, indicator_bank, condition, length):
    params = condition.params
    close = data['close']
    min_percent = params.get('minPercent', -2.1)
    max_percent = params.get('maxPercent', 10)

    result = np.ones(length, dtype=bool)
    time_arr = data['time']
    dt = pd.to_datetime(time_arr, unit='s')
    dates = dt.date

    # Find the last close of each day
    df = pd.DataFrame({'date': dates, 'close': close})
    daily_last_close = df.groupby('date')['close'].last()
    prior_day_closes = daily_last_close.shift(1)

    # Map prior day closes back to the original index
    mapped_prior_closes = pd.Series(dates).map(prior_day_closes).values

    # Calculate change percent
    valid_mask = ~np.isnan(mapped_prior_closes)
    change_percent = np.zeros(length)
    change_percent[valid_mask] = ((close[valid_mask] - mapped_prior_closes[valid_mask]) / mapped_prior_closes[valid_mask]) * 100.0

    result[valid_mask] = (change_percent[valid_mask] >= min_percent) & (change_percent[valid_mask] <= max_percent)
    # For the first day, we return True (no filter)
    result[~valid_mask] = True

    return result


def daily_change_percent(data, indicator_bank, condition, length):
    """Compatibility -- same logic as market_change_percent_range."""
    compat = StrategyCondition(id='market_change_percent_range', params=condition.params, timeframe=condition.timeframe)
    return market_change_percent_range(data, indicator_bank, compat, length)


# ---------------------------------------------------------------------------
# Time Conditions (Always use primary data time)
# ---------------------------------------------------------------------------

def time_condition(data, indicator_bank, condition, length):
    params = condition.params
    target_time = params.get('time', 930)
    time_arr = data['time']
    dt = pd.to_datetime(time_arr, unit='s')
    hhmm = dt.hour * 100 + dt.minute
    return hhmm == target_time


def time_range(data, indicator_bank, condition, length):
    params = condition.params
    start = params.get('startTime', params.get('start', 830))
    end = params.get('endTime', params.get('end', 1457))
    time_arr = data['time']
    dt = pd.to_datetime(time_arr, unit='s')
    hhmm = dt.hour * 100 + dt.minute
    return (hhmm >= start) & (hhmm <= end)


def minutes_before_session_close(data, indicator_bank, condition, length):
    # This is complex - would need session data
    # For now, return all True (no filtering)
    return np.ones(length, dtype=bool)


# ---------------------------------------------------------------------------
# Volume Conditions
# ---------------------------------------------------------------------------

def volume_above_avg(data, indicator_bank, condition, length):
    params = condition.params
    tf = condition.timeframe or "DEF"
    period = params.get('period', 20)
    vol_avg = indicator_bank.get_mtf(f'vol_avg_{period}', tf)
    return data['volume'] > vol_avg


def volume_spike(data, indicator_bank, condition, length):
    params = condition.params
    tf = condition.timeframe or "DEF"
    period = params.get('period', 16)
    multiplier = params.get('multiplier', 1.6)
    vol_avg = indicator_bank.get_mtf(f'vol_avg_{period}', tf)
    valid = ~np.isnan(vol_avg)
    volume_spike_result = valid & (data['volume'] >= (vol_avg * multiplier))
    return volume_spike_result


def volume_profile_ratio(data, indicator_bank, condition, length):
    params = condition.params
    tf = condition.timeframe or "DEF"
    volume = data['volume']
    lookback = params.get('lookback', 25)
    min_ratio = params.get('minRatio', 0.7)

    if tf == "DEF" or tf is None:
        if length < lookback:
            return np.zeros(length, dtype=bool)
        result = np.zeros(length, dtype=bool)
        for i in range(lookback, length):
            avg_vol = np.mean(volume[i-lookback:i])
            if avg_vol > 0:
                ratio = volume[i] / avg_vol
                result[i] = ratio >= min_ratio
        return result
    else:
        tf_data = _ensure_tf_data(indicator_bank, tf)
        tf_volume = tf_data['volume']
        tf_length = len(tf_volume)

        if tf_length < lookback:
            return np.zeros(length, dtype=bool)

        tf_result = np.zeros(tf_length, dtype=bool)
        for i in range(lookback, tf_length):
            avg_vol = np.mean(tf_volume[i-lookback:i])
            if avg_vol > 0:
                ratio = tf_volume[i] / avg_vol
                tf_result[i] = ratio >= min_ratio

        return _align_to_primary(indicator_bank, tf, tf_result, length)


def volume_spike_exit(data, indicator_bank, condition, length):
    params = condition.params
    volume = data['volume']
    close = data['close']
    open_ = data['open']
    lookback = params.get('lookback', 1)
    multiplier = params.get('multiplier', 1.4)
    min_body_ticks = params.get('minBodyTicks', 200)
    if length < lookback + 1:
        return np.zeros(length, dtype=bool)
    result = np.zeros(length, dtype=bool)
    for i in range(lookback, length):
        avg_vol = np.mean(volume[i-lookback:i])
        if avg_vol > 0 and volume[i] >= (avg_vol * multiplier):
            body_ticks = np.abs(close[i] - open_[i]) / TICK_SIZE
            red_candle = close[i] < open_[i]
            if body_ticks >= min_body_ticks and red_candle:
                result[i] = True
    return result


# ---------------------------------------------------------------------------
# FOMC Conditions
# ---------------------------------------------------------------------------

def fomc_hours(data, indicator_bank, condition, length):
    # FOMC_DATES imported at module level from app
    params = condition.params
    start_time = params.get('startTime', 845)
    end_time = params.get('endTime', 1335)
    time_array = data['time']
    result = np.ones(length, dtype=bool)
    for i in range(length):
        dt = datetime.fromtimestamp(time_array[i])
        date_str = dt.strftime('%Y-%m-%d')
        if date_str not in FOMC_DATES:
            result[i] = True
            continue
        current_time = dt.hour * 100 + dt.minute
        is_within_fomc_hours = start_time <= current_time <= end_time
        result[i] = not is_within_fomc_hours
    return result


# ---------------------------------------------------------------------------
# Other
# ---------------------------------------------------------------------------

def quick_profit_with_reversal(data, indicator_bank, condition, length):
    # This needs trade context - will be handled in exit logic
    # For now return False (condition will be checked during trade simulation)
    return np.zeros(length, dtype=bool)


# ---------------------------------------------------------------------------
# CONDITION_HANDLERS dispatch dict
# ---------------------------------------------------------------------------

CONDITION_HANDLERS: Dict[str, Callable] = {
    # RSI
    'rsi_below': rsi_below,
    'rsi_above': rsi_above,
    'rsi_crosses_above': rsi_crosses_above,
    'rsi_cross_above': rsi_cross_above,
    'rsi_crosses_below': rsi_crosses_below,
    'rsi_cross_below': rsi_cross_below,
    'rsi_in_range': rsi_in_range,
    'rsi_exit_below': rsi_exit_below,
    # MACD
    'macd_cross_above': macd_cross_above,
    'macd_cross_above_signal': macd_cross_above_signal,
    'macd_cross_below': macd_cross_below,
    'macd_cross_below_signal': macd_cross_below_signal,
    # MA
    'price_above_sma': price_above_sma,
    'price_below_sma': price_below_sma,
    'price_above_ema': price_above_ema,
    'price_below_ema': price_below_ema,
    'price_below_ema_multiple': price_below_ema_multiple,
    'price_below_sma_multiple': price_below_sma_multiple,
    'sma_short_above_long_lookback': sma_short_above_long_lookback,
    # Bollinger
    'price_below_bb_lower': price_below_bb_lower,
    'price_above_bb_upper': price_above_bb_upper,
    # Price Action
    'candle_body_min_ticks': candle_body_min_ticks,
    'bar_range_ticks_range': bar_range_ticks_range,
    'bar_range_ticks': bar_range_ticks,
    'min_red_candles': min_red_candles,
    'min_green_candles': min_green_candles,
    'green_red_reversal_exit': green_red_reversal_exit,
    'big_reverse_candle_exit': big_reverse_candle_exit,
    'green_candle': green_candle,
    # Stochastic
    'stoch_below': stoch_below,
    'stoch_above': stoch_above,
    'stoch_cross_above': stoch_cross_above,
    'stoch_cross_below': stoch_cross_below,
    # ADX
    'adx_range': adx_range,
    'adx_in_range': adx_in_range,
    'adx_exit_range': adx_exit_range,
    # ATR
    'atr_in_range': atr_in_range,
    'atr_exit_range': atr_exit_range,
    # Market
    'market_change_percent_range': market_change_percent_range,
    'daily_change_percent': daily_change_percent,
    # Time
    'time': time_condition,
    'time_range': time_range,
    'minutes_before_session_close': minutes_before_session_close,
    # Volume
    'volume_above_avg': volume_above_avg,
    'volume_spike': volume_spike,
    'volume_profile_ratio': volume_profile_ratio,
    'volume_spike_exit': volume_spike_exit,
    # FOMC
    'fomc_hours': fomc_hours,
    # Other
    'quick_profit_with_reversal': quick_profit_with_reversal,
}
