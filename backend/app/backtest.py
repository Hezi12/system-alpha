"""
Vectorized Backtest Engine
Ultra-fast backtesting with NumPy
"""
import numpy as np
from datetime import datetime
from typing import Dict, List, Any, Set
import pandas as pd
from app.indicators import IndicatorBank
from app.models import BacktestResult, Strategy, StrategyCondition

# FOMC dates
FOMC_DATES: Set[str] = {
    '2018-01-31', '2018-03-21', '2018-05-02', '2018-06-13',
    '2018-08-01', '2018-09-26', '2018-11-08', '2018-12-19',
    '2019-01-30', '2019-03-20', '2019-05-01',
    '2019-06-19', '2019-07-31', '2019-09-18',
    '2019-10-30', '2019-12-11',
    '2020-01-29', '2020-03-18', '2020-04-29',
    '2020-06-10', '2020-07-29', '2020-09-16',
    '2020-11-05', '2020-12-16',
    '2021-01-27', '2021-03-17', '2021-04-28',
    '2021-06-16', '2021-07-28', '2021-09-22',
    '2021-11-03', '2021-12-15',
    '2022-01-26', '2022-03-16', '2022-05-04',
    '2022-06-15', '2022-07-27', '2022-09-21',
    '2022-11-02', '2022-12-14',
    '2023-02-01', '2023-03-22', '2023-05-03',
    '2023-06-14', '2023-07-26', '2023-09-20',
    '2023-11-01', '2023-12-13',
    '2024-01-31', '2024-03-20', '2024-05-01',
    '2024-06-12', '2024-07-31', '2024-09-18',
    '2024-11-07', '2024-12-18',
    '2025-01-29', '2025-03-19', '2025-04-30',
    '2025-06-18', '2025-07-30', '2025-09-17',
    '2025-11-06', '2025-12-17'
}


class BacktestEngine:
    """High-Performance Backtest Engine with Multi-Timeframe Support"""
    
    def __init__(self, data: Dict[str, np.ndarray], indicator_bank: IndicatorBank):
        self.data = data
        self.indicator_bank = indicator_bank
        self.length = len(data['close'])
        
    def run(self, strategy: Strategy) -> BacktestResult:
        """Run backtest"""
        # Check conditions vectorized
        entry_signals = self._check_conditions(strategy.entryConditions)
        exit_signals = self._check_conditions(strategy.exitConditions)
        
        # Simulate trades
        trades = self._simulate_trades(entry_signals, exit_signals)
        
        # Calculate statistics
        return self._calculate_statistics(trades)
    
    def _check_conditions(self, conditions: List[StrategyCondition]) -> np.ndarray:
        """Check all conditions (vectorized)"""
        if not conditions:
            return np.zeros(self.length, dtype=bool)
        
        # All conditions must be True (AND logic)
        result = np.ones(self.length, dtype=bool)
        
        for condition in conditions:
            if not condition.enabled:
                continue
            
            condition_result = self._check_single_condition(condition)
            result = result & condition_result
        
        return result
    
    def _check_single_condition(self, condition: StrategyCondition) -> np.ndarray:
        """Check single condition with MTF support"""
        cond_id = condition.id
        params = condition.params
        tf = condition.timeframe or "DEF"
        
        # Base data (always primary timeframe for OHLCV comparisons unless explicitly changed)
        close = self.data['close']
        high = self.data['high']
        low = self.data['low']
        volume = self.data['volume']
        
        # RSI Conditions
        if cond_id == 'rsi_below':
            period = params.get('period', 14)
            threshold = params.get('threshold', 30)
            rsi = self.indicator_bank.get_mtf(f'rsi_{period}', tf)
            return rsi < threshold
        
        elif cond_id == 'rsi_above':
            period = params.get('period', 14)
            threshold = params.get('threshold', 70)
            rsi = self.indicator_bank.get_mtf(f'rsi_{period}', tf)
            return rsi > threshold
        
        elif cond_id == 'rsi_crosses_above' or cond_id == 'rsi_cross_above':
            period = params.get('period', 14)
            threshold_value = params.get('threshold', params.get('value', 30))
            if isinstance(threshold_value, str) and ';' in threshold_value:
                threshold = float(threshold_value.split(';')[0])
            else:
                threshold = float(threshold_value) if threshold_value else 30
            rsi = self.indicator_bank.get_mtf(f'rsi_{period}', tf)
            result = np.zeros(len(rsi), dtype=bool)
            result[1:] = (rsi[:-1] < threshold) & (rsi[1:] >= threshold)
            return result
        
        elif cond_id == 'rsi_crosses_below' or cond_id == 'rsi_cross_below':
            period = params.get('period', 14)
            threshold_value = params.get('threshold', params.get('value', 70))
            if isinstance(threshold_value, str) and ';' in threshold_value:
                threshold = float(threshold_value.split(';')[0])
            else:
                threshold = float(threshold_value) if threshold_value else 70
            rsi = self.indicator_bank.get_mtf(f'rsi_{period}', tf)
            result = np.zeros(len(rsi), dtype=bool)
            result[1:] = (rsi[:-1] > threshold) & (rsi[1:] <= threshold)
            return result
        
        elif cond_id == 'rsi_in_range':
            period = params.get('period', 14)
            min_val = params.get('min', 1)
            max_val = params.get('max', 84)
            rsi = self.indicator_bank.get_mtf(f'rsi_{period}', tf)
            return (rsi >= min_val) & (rsi <= max_val)
        
        elif cond_id == 'rsi_exit_below':
            period = params.get('period', 14)
            level = params.get('level', 18)
            rsi = self.indicator_bank.get_mtf(f'rsi_{period}', tf)
            return rsi < level
        
        # MACD Conditions
        elif cond_id == 'macd_cross_above':
            fast = params.get('fast', 12)
            slow = params.get('slow', 26)
            signal_period = params.get('signal', 9)
            macd = self.indicator_bank.get_mtf(f'macd_{fast}_{slow}_{signal_period}', tf)
            signal_line = self.indicator_bank.get_mtf(f'macd_signal_{fast}_{slow}_{signal_period}', tf)
            return (macd[:-1] <= signal_line[:-1]) & (macd[1:] > signal_line[1:])
        
        elif cond_id == 'macd_cross_below':
            fast = params.get('fast', 12)
            slow = params.get('slow', 26)
            signal_period = params.get('signal', 9)
            macd = self.indicator_bank.get_mtf(f'macd_{fast}_{slow}_{signal_period}', tf)
            signal_line = self.indicator_bank.get_mtf(f'macd_signal_{fast}_{slow}_{signal_period}', tf)
            return (macd[:-1] >= signal_line[:-1]) & (macd[1:] < signal_line[1:])
        
        # MA Conditions
        elif cond_id == 'price_above_sma':
            period = params.get('period', 20)
            sma = self.indicator_bank.get_mtf(f'sma_{period}', tf)
            return close > sma
        
        elif cond_id == 'price_below_sma':
            period = params.get('period', 20)
            sma = self.indicator_bank.get_mtf(f'sma_{period}', tf)
            return close < sma
        
        elif cond_id == 'price_above_ema':
            period = params.get('period', 20)
            ema = self.indicator_bank.get_mtf(f'ema_{period}', tf)
            return close > ema
        
        elif cond_id == 'price_below_ema':
            period = params.get('period', 20)
            ema = self.indicator_bank.get_mtf(f'ema_{period}', tf)
            return close < ema
        
        elif cond_id == 'price_below_ema_multiple':
            period = params.get('period', 10)
            required_bars = params.get('requiredBars', 15)
            ema = self.indicator_bank.get_mtf(f'ema_{period}', tf)
            if self.length < required_bars:
                return np.zeros(self.length, dtype=bool)
            result = np.zeros(self.length, dtype=bool)
            for i in range(required_bars - 1, self.length):
                all_below = True
                for j in range(required_bars):
                    if close[i - j] >= ema[i - j]:
                        all_below = False
                        break
                result[i] = all_below
            return result
        
        elif cond_id == 'price_below_sma_multiple':
            period = params.get('period', 9)
            required_bars = params.get('requiredBars', 14)
            sma = self.indicator_bank.get_mtf(f'sma_{period}', tf)
            if self.length < required_bars:
                return np.zeros(self.length, dtype=bool)
            result = np.zeros(self.length, dtype=bool)
            for i in range(required_bars - 1, self.length):
                all_below = True
                for j in range(required_bars):
                    if close[i - j] >= sma[i - j]:
                        all_below = False
                        break
                result[i] = all_below
            return result
        
        elif cond_id == 'sma_short_above_long_lookback':
            short_period = params.get('shortPeriod', 49)
            long_period = params.get('longPeriod', 98)
            lookback = params.get('lookback', 190)
            short_sma = self.indicator_bank.get_mtf(f'sma_{short_period}', tf)
            long_sma = self.indicator_bank.get_mtf(f'sma_{long_period}', tf)
            if self.length < lookback:
                return np.zeros(self.length, dtype=bool)
            result = np.zeros(self.length, dtype=bool)
            for i in range(lookback - 1, self.length):
                found_above = False
                for j in range(lookback):
                    if short_sma[i - j] >= long_sma[i - j]:
                        found_above = True
                        break
                result[i] = found_above
            return result
        
        # Bollinger Bands
        elif cond_id == 'price_below_bb_lower':
            period = params.get('period', 20)
            lower = self.indicator_bank.get_mtf(f'bb_lower_{period}', tf)
            return close < lower
        
        elif cond_id == 'price_above_bb_upper':
            period = params.get('period', 20)
            upper = self.indicator_bank.get_mtf(f'bb_upper_{period}', tf)
            return close > upper
        
        # Price Action Conditions
        elif cond_id == 'candle_body_min_ticks':
            min_ticks = params.get('minTicks', 34)
            tick_size = 0.25
            
            # תמיכה ב-Multi-Timeframe
            if tf == "DEF" or tf is None:
                # Timeframe ראשי
                body_ticks = np.abs(close - self.data['open']) / tick_size
                return body_ticks >= min_ticks
            else:
                # Timeframe אחר - צריך לאגרגט נתונים
                tf_mins = int(tf)
                if tf not in self.indicator_bank.timeframes:
                    self.indicator_bank.timeframes[tf] = self.indicator_bank._aggregate_data(tf_mins)
                
                tf_data = self.indicator_bank.timeframes[tf]
                tf_close = tf_data['close']
                tf_open = tf_data['open']
                
                # חישוב על ה-timeframe הגבוה
                tf_body_ticks = np.abs(tf_close - tf_open) / tick_size
                tf_result = tf_body_ticks >= min_ticks
                
                # יישור חזרה ל-timeframe הראשי
                primary_close = self.indicator_bank._get_close_times("DEF")
                tf_close_times = self.indicator_bank._get_close_times(tf)
                indices = np.searchsorted(tf_close_times, primary_close, side='right') - 1
                valid_mask = indices >= 0
                aligned = np.full(self.length, False)
                aligned[valid_mask] = tf_result[indices[valid_mask]]
                return aligned
        
        elif cond_id == 'bar_range_ticks_range':
            min_ticks = params.get('minTicks', 12)
            max_ticks = params.get('maxTicks', 300)
            tick_size = 0.25
            
            # תמיכה ב-Multi-Timeframe
            if tf == "DEF" or tf is None:
                # Timeframe ראשי
                range_ticks = (high - low) / tick_size
                return (range_ticks >= min_ticks) & (range_ticks <= max_ticks)
            else:
                # Timeframe אחר - צריך לאגרגט נתונים
                tf_mins = int(tf)
                if tf not in self.indicator_bank.timeframes:
                    self.indicator_bank.timeframes[tf] = self.indicator_bank._aggregate_data(tf_mins)
                
                tf_data = self.indicator_bank.timeframes[tf]
                tf_high = tf_data['high']
                tf_low = tf_data['low']
                tf_length = len(tf_high)
                
                # חישוב על ה-timeframe הגבוה
                tf_range_ticks = (tf_high - tf_low) / tick_size
                tf_result = (tf_range_ticks >= min_ticks) & (tf_range_ticks <= max_ticks)
                
                # יישור חזרה ל-timeframe הראשי
                primary_close = self.indicator_bank._get_close_times("DEF")
                tf_close_times = self.indicator_bank._get_close_times(tf)
                indices = np.searchsorted(tf_close_times, primary_close, side='right') - 1
                valid_mask = indices >= 0
                aligned = np.full(self.length, False)
                aligned[valid_mask] = tf_result[indices[valid_mask]]
                return aligned

        elif cond_id == 'bar_range_ticks': # Compatibility
            min_ticks = params.get('minTicks', 12)
            max_ticks = params.get('maxTicks', 300)
            tick_size = 0.25
            range_ticks = (high - low) / tick_size
            return (range_ticks >= min_ticks) & (range_ticks <= max_ticks)

        elif cond_id == 'min_red_candles':
            min_count = params.get('minCount', 1)
            lookback = params.get('lookback', 10)
            
            # תמיכה ב-Multi-Timeframe
            if tf == "DEF" or tf is None:
                # Timeframe ראשי
                if self.length < lookback:
                    return np.zeros(self.length, dtype=bool)
                result = np.zeros(self.length, dtype=bool)
                for i in range(lookback - 1, self.length):
                    red_count = np.sum(close[i-lookback+1:i+1] < self.data['open'][i-lookback+1:i+1])
                    result[i] = red_count >= min_count
                return result
            else:
                # Timeframe אחר - צריך לאגרגט נתונים
                tf_mins = int(tf)
                if tf not in self.indicator_bank.timeframes:
                    self.indicator_bank.timeframes[tf] = self.indicator_bank._aggregate_data(tf_mins)
                
                tf_data = self.indicator_bank.timeframes[tf]
                tf_close = tf_data['close']
                tf_open = tf_data['open']
                tf_times = tf_data['time']
                tf_length = len(tf_close)
                
                if tf_length < lookback:
                    return np.zeros(self.length, dtype=bool)
                
                # חישוב על ה-timeframe הגבוה - לכל נר של 5 דקות, כמה נרות אדומים יש ב-lookback האחרון
                tf_result = np.zeros(tf_length, dtype=bool)
                for i in range(lookback - 1, tf_length):
                    red_count = np.sum(tf_close[i-lookback+1:i+1] < tf_open[i-lookback+1:i+1])
                    tf_result[i] = red_count >= min_count
                
                # יישור חזרה ל-timeframe הראשי
                # NinjaTrader-style (no lookahead): use last CLOSED HTF bar as of each primary bar close
                primary_close = self.indicator_bank._get_close_times("DEF")
                tf_close_times = self.indicator_bank._get_close_times(tf)
                indices = np.searchsorted(tf_close_times, primary_close, side='right') - 1
                valid_mask = indices >= 0
                result = np.zeros(self.length, dtype=bool)
                result[valid_mask] = tf_result[indices[valid_mask]]
                return result
        
        elif cond_id == 'min_green_candles':
            min_count = params.get('minCount', 6)
            lookback = params.get('lookback', 17)
            
            # תמיכה ב-Multi-Timeframe
            if tf == "DEF" or tf is None:
                # Timeframe ראשי
                if self.length < lookback:
                    return np.zeros(self.length, dtype=bool)
                result = np.zeros(self.length, dtype=bool)
                for i in range(lookback - 1, self.length):
                    green_count = np.sum(close[i-lookback+1:i+1] > self.data['open'][i-lookback+1:i+1])
                    result[i] = green_count >= min_count
                return result
            else:
                # Timeframe אחר - צריך לאגרגט נתונים
                tf_mins = int(tf)
                if tf not in self.indicator_bank.timeframes:
                    self.indicator_bank.timeframes[tf] = self.indicator_bank._aggregate_data(tf_mins)
                
                tf_data = self.indicator_bank.timeframes[tf]
                tf_close = tf_data['close']
                tf_open = tf_data['open']
                tf_times = tf_data['time']
                tf_length = len(tf_close)
                
                if tf_length < lookback:
                    return np.zeros(self.length, dtype=bool)
                
                # חישוב על ה-timeframe הגבוה - לכל נר של 5 דקות, כמה נרות ירוקים יש ב-lookback האחרון
                tf_result = np.zeros(tf_length, dtype=bool)
                for i in range(lookback - 1, tf_length):
                    green_count = np.sum(tf_close[i-lookback+1:i+1] > tf_open[i-lookback+1:i+1])
                    tf_result[i] = green_count >= min_count
                
                # יישור חזרה ל-timeframe הראשי
                # NinjaTrader-style (no lookahead): use last CLOSED HTF bar as of each primary bar close
                primary_close = self.indicator_bank._get_close_times("DEF")
                tf_close_times = self.indicator_bank._get_close_times(tf)
                indices = np.searchsorted(tf_close_times, primary_close, side='right') - 1
                valid_mask = indices >= 0
                result = np.zeros(self.length, dtype=bool)
                result[valid_mask] = tf_result[indices[valid_mask]]
                return result
        
        elif cond_id == 'green_red_reversal_exit':
            min_green_ticks = params.get('minGreenTicks', 30)
            red_larger_percent = params.get('redLargerPercent', 550)
            tick_size = 0.25
            if self.length < 2:
                return np.zeros(self.length, dtype=bool)
            result = np.zeros(self.length, dtype=bool)
            for i in range(1, self.length):
                # Previous bar must be green
                prev_green = close[i-1] > self.data['open'][i-1]
                if not prev_green:
                    continue
                # Current bar must be red
                curr_red = close[i] < self.data['open'][i]
                if not curr_red:
                    continue
                # Check green candle size
                green_ticks = (close[i-1] - self.data['open'][i-1]) / tick_size
                if green_ticks < min_green_ticks:
                    continue
                # Check red candle is X% larger
                red_ticks = (self.data['open'][i] - close[i]) / tick_size
                red_percent = (red_ticks / green_ticks) * 100.0
                if red_percent >= red_larger_percent:
                    result[i] = True
            return result
        
        elif cond_id == 'big_reverse_candle_exit':
            min_ticks = params.get('minTicks', 90)
            max_bars = params.get('maxBars', 2)
            tick_size = 0.25
            # This condition needs trade context, so we'll check if current bar is red and large
            result = np.zeros(self.length, dtype=bool)
            for i in range(1, self.length):
                if close[i] < self.data['open'][i]:  # Red candle
                    body_ticks = (self.data['open'][i] - close[i]) / tick_size
                    if body_ticks >= min_ticks:
                        result[i] = True
            return result
        
        # Stochastic
        elif cond_id == 'stoch_below':
            k_period = params.get('k_period', 14)
            d_period = params.get('d_period', 3)
            threshold = params.get('threshold', 20)
            k = self.indicator_bank.get_mtf(f'stoch_k_{k_period}_{d_period}', tf)
            return k < threshold
            
        elif cond_id == 'stoch_above':
            k_period = params.get('k_period', 14)
            d_period = params.get('d_period', 3)
            threshold = params.get('threshold', 80)
            k = self.indicator_bank.get_mtf(f'stoch_k_{k_period}_{d_period}', tf)
            return k > threshold

        elif cond_id == 'stoch_cross_above':
            k_period = params.get('kPeriod', 14)
            d_period = params.get('dPeriod', 3)
            k = self.indicator_bank.get_mtf(f'stoch_k_{k_period}_{d_period}', tf)
            d = self.indicator_bank.get_mtf(f'stoch_d_{k_period}_{d_period}', tf)
            return (k[:-1] <= d[:-1]) & (k[1:] > d[1:])

        elif cond_id == 'stoch_cross_below':
            k_period = params.get('kPeriod', 14)
            d_period = params.get('dPeriod', 3)
            k = self.indicator_bank.get_mtf(f'stoch_k_{k_period}_{d_period}', tf)
            d = self.indicator_bank.get_mtf(f'stoch_d_{k_period}_{d_period}', tf)
            return (k[:-1] >= d[:-1]) & (k[1:] < d[1:])
            
        # ADX Conditions
        elif cond_id == 'adx_range':
            period = params.get('period', 14)
            min_val = params.get('min', 16)
            max_val = params.get('max', 56)
            adx = self.indicator_bank.get_mtf(f'adx_{period}', tf)
            return (adx >= min_val) & (adx <= max_val)
        
        elif cond_id == 'adx_in_range': # Compatibility
            period = params.get('period', 14)
            min_val = params.get('min', 16)
            max_val = params.get('max', 56)
            adx = self.indicator_bank.get_mtf(f'adx_{period}', tf)
            return (adx >= min_val) & (adx <= max_val)
        
        elif cond_id == 'adx_exit_range':
            period = params.get('period', 6)
            min_val = params.get('min', 12)
            max_val = params.get('max', 93)
            adx = self.indicator_bank.get_mtf(f'adx_{period}', tf)
            return (adx < min_val) | (adx > max_val)
        
        # ATR Conditions
        elif cond_id == 'atr_in_range':
            period = params.get('period', 30)
            min_val = params.get('min', 12)
            max_val = params.get('max', 55)
            atr = self.indicator_bank.get_mtf(f'atr_{period}', tf)
            return (atr >= min_val) & (atr <= max_val)
        
        elif cond_id == 'atr_exit_range':
            period = params.get('period', 8)
            min_val = params.get('min', 14)
            max_val = params.get('max', 86)
            atr = self.indicator_bank.get_mtf(f'atr_{period}', tf)
            return (atr < min_val) | (atr > max_val)
        
        # Market Conditions
        elif cond_id == 'market_change_percent_range':
            min_percent = params.get('minPercent', -2.1)
            max_percent = params.get('maxPercent', 10)
            
            result = np.ones(self.length, dtype=bool)
            time_arr = self.data['time']
            dt = pd.to_datetime(time_arr, unit='s')
            dates = dt.date
            
            # Find the last close of each day
            df = pd.DataFrame({'date': dates, 'close': close})
            daily_last_close = df.groupby('date')['close'].last()
            prior_day_closes = daily_last_close.shift(1)
            
            # Map prior day closes back to the original index
            mapped_prior_closes = dates.map(prior_day_closes)
            
            # Calculate change percent
            # Handle the first day where prior_day_close is NaN
            valid_mask = ~np.isnan(mapped_prior_closes)
            change_percent = np.zeros(self.length)
            change_percent[valid_mask] = ((close[valid_mask] - mapped_prior_closes[valid_mask]) / mapped_prior_closes[valid_mask]) * 100.0
            
            result[valid_mask] = (change_percent[valid_mask] >= min_percent) & (change_percent[valid_mask] <= max_percent)
            # For the first day, we return True (no filter)
            result[~valid_mask] = True
            
            return result
            
        elif cond_id == 'daily_change_percent':  # Compatibility – same logic as market_change_percent_range
            compat = StrategyCondition(id='market_change_percent_range', params=params, timeframe=condition.timeframe)
            return self._check_single_condition(compat)
        
        # Time Conditions (Always use primary data time)
        elif cond_id == 'time':
            target_time = params.get('time', 930)
            time_arr = self.data['time']
            dt = pd.to_datetime(time_arr, unit='s')
            hhmm = dt.hour * 100 + dt.minute
            return hhmm == target_time

        elif cond_id == 'time_range':
            start = params.get('startTime', params.get('start', 830))
            end = params.get('endTime', params.get('end', 1457))
            time_arr = self.data['time']
            dt = pd.to_datetime(time_arr, unit='s')
            hhmm = dt.hour * 100 + dt.minute
            return (hhmm >= start) & (hhmm <= end)
        
        elif cond_id == 'minutes_before_session_close':
            minutes = params.get('minutes', 1)
            # This is complex - would need session data
            # For now, return all True (no filtering)
            return np.ones(self.length, dtype=bool)

        # Price Action Conditions
        elif cond_id == 'green_candle':
            # תמיכה ב-Multi-Timeframe
            if tf == "DEF" or tf is None:
                # Timeframe ראשי
                return close > self.data['open']
            else:
                # Timeframe אחר - צריך לאגרגט נתונים
                tf_mins = int(tf)
                if tf not in self.indicator_bank.timeframes:
                    self.indicator_bank.timeframes[tf] = self.indicator_bank._aggregate_data(tf_mins)
                
                tf_data = self.indicator_bank.timeframes[tf]
                tf_close = tf_data['close']
                tf_open = tf_data['open']
                
                # חישוב על ה-timeframe הגבוה
                tf_result = tf_close > tf_open
                
                # יישור חזרה ל-timeframe הראשי
                primary_close = self.indicator_bank._get_close_times("DEF")
                tf_close_times = self.indicator_bank._get_close_times(tf)
                indices = np.searchsorted(tf_close_times, primary_close, side='right') - 1
                valid_mask = indices >= 0
                aligned = np.full(self.length, False)
                aligned[valid_mask] = tf_result[indices[valid_mask]]
                return aligned
        
        # Volume Conditions
        elif cond_id == 'volume_above_avg':
            period = params.get('period', 20)
            vol_avg = self.indicator_bank.get_mtf(f'vol_avg_{period}', tf)
            return volume > vol_avg
        
        elif cond_id == 'volume_spike':
            # Simple volume spike - only checks volume, nothing else
            period = params.get('period', 16)
            multiplier = params.get('multiplier', 1.6)
            # Get volume average (excluding current bar)
            vol_avg = self.indicator_bank.get_mtf(f'vol_avg_{period}', tf)
            # Handle NaN: if vol_avg is NaN, condition is False
            # Check volume spike: Volume[0] >= averageVolume * multiplier
            valid = ~np.isnan(vol_avg)
            volume_spike = valid & (volume >= (vol_avg * multiplier))
            return volume_spike
        
        elif cond_id == 'volume_profile_ratio':
            lookback = params.get('lookback', 25)
            min_ratio = params.get('minRatio', 0.7)
            
            # תמיכה ב-Multi-Timeframe
            if tf == "DEF" or tf is None:
                # Timeframe ראשי
                if self.length < lookback:
                    return np.zeros(self.length, dtype=bool)
                result = np.zeros(self.length, dtype=bool)
                for i in range(lookback, self.length):
                    avg_vol = np.mean(volume[i-lookback:i])
                    if avg_vol > 0:
                        ratio = volume[i] / avg_vol
                        result[i] = ratio >= min_ratio
                return result
            else:
                # Timeframe אחר - צריך לאגרגט נתונים
                tf_mins = int(tf)
                if tf not in self.indicator_bank.timeframes:
                    self.indicator_bank.timeframes[tf] = self.indicator_bank._aggregate_data(tf_mins)
                
                tf_data = self.indicator_bank.timeframes[tf]
                tf_volume = tf_data['volume']
                tf_length = len(tf_volume)
                
                if tf_length < lookback:
                    return np.zeros(self.length, dtype=bool)
                
                # חישוב על ה-timeframe הגבוה
                tf_result = np.zeros(tf_length, dtype=bool)
                for i in range(lookback, tf_length):
                    avg_vol = np.mean(tf_volume[i-lookback:i])
                    if avg_vol > 0:
                        ratio = tf_volume[i] / avg_vol
                        tf_result[i] = ratio >= min_ratio
                
                # יישור חזרה ל-timeframe הראשי
                primary_close = self.indicator_bank._get_close_times("DEF")
                tf_close_times = self.indicator_bank._get_close_times(tf)
                indices = np.searchsorted(tf_close_times, primary_close, side='right') - 1
                valid_mask = indices >= 0
                aligned = np.full(self.length, False)
                aligned[valid_mask] = tf_result[indices[valid_mask]]
                return aligned
        
        elif cond_id == 'volume_spike_exit':
            lookback = params.get('lookback', 1)
            multiplier = params.get('multiplier', 1.4)
            min_body_ticks = params.get('minBodyTicks', 200)
            if self.length < lookback + 1:
                return np.zeros(self.length, dtype=bool)
            result = np.zeros(self.length, dtype=bool)
            tick_size = 0.25
            for i in range(lookback, self.length):
                avg_vol = np.mean(volume[i-lookback:i])
                if avg_vol > 0 and volume[i] >= (avg_vol * multiplier):
                    body_ticks = np.abs(close[i] - self.data['open'][i]) / tick_size
                    red_candle = close[i] < self.data['open'][i]
                    if body_ticks >= min_body_ticks and red_candle:
                        result[i] = True
            return result

        # FOMC Hours
        elif cond_id == 'fomc_hours':
            start_time = params.get('startTime', 845)
            end_time = params.get('endTime', 1335)
            time_array = self.data['time']
            result = np.ones(self.length, dtype=bool)
            for i in range(self.length):
                dt = datetime.fromtimestamp(time_array[i])
                date_str = dt.strftime('%Y-%m-%d')
                if date_str not in FOMC_DATES:
                    result[i] = True
                    continue
                current_time = dt.hour * 100 + dt.minute
                is_within_fomc_hours = start_time <= current_time <= end_time
                result[i] = not is_within_fomc_hours
            return result
        
        # Quick Profit Exit
        elif cond_id == 'quick_profit_with_reversal':
            max_bars = params.get('maxBars', 1)
            profit_ticks = params.get('profitTicks', 140)
            require_reversal = params.get('requireReversal', True)
            reversal_min_ticks = params.get('reversalMinTicks', 90)
            tick_size = 0.25
            # This needs trade context - will be handled in exit logic
            # For now return False (condition will be checked during trade simulation)
            return np.zeros(self.length, dtype=bool)

        return np.zeros(self.length, dtype=bool)

    def _simulate_trades(self, entry_signals: np.ndarray, exit_signals: np.ndarray) -> List[Dict[str, Any]]:
        """Simulate trades"""
        trades = []
        in_trade = False
        entry_price = 0
        entry_idx = 0
        close = self.data['close']
        
        for i in range(len(close)):
            if not in_trade and entry_signals[i]:
                in_trade = True
                entry_price = close[i]
                entry_idx = i
            elif in_trade and exit_signals[i]:
                exit_price = close[i]
                profit = exit_price - entry_price
                trades.append({
                    'entry_idx': entry_idx,
                    'exit_idx': i,
                    'entry_price': entry_price,
                    'exit_price': exit_price,
                    'profit': profit,
                    'entry_time': int(self.data['time'][entry_idx]),
                    'exit_time': int(self.data['time'][i]),
                    'exit_reason': 'Signal'
                })
                in_trade = False
        
        if in_trade:
            exit_price = close[-1]
            profit = exit_price - entry_price
            trades.append({
                'entry_idx': entry_idx,
                'exit_idx': len(close) - 1,
                'entry_price': entry_price,
                'exit_price': exit_price,
                'profit': profit,
                'entry_time': int(self.data['time'][entry_idx]),
                'exit_time': int(self.data['time'][-1]),
                'exit_reason': 'Session End'
            })
        return trades

    def _calculate_statistics(self, trades: List[Dict[str, Any]]) -> BacktestResult:
        """Calculate statistics"""
        if not trades:
            return BacktestResult(
                totalTrades=0, winningTrades=0, losingTrades=0, winRate=0.0,
                totalProfit=0.0, maxDrawdown=0.0, profitFactor=0.0, sharpeRatio=0.0,
                averageWin=0.0, averageLoss=0.0, largestWin=0.0, largestLoss=0.0,
                trades=[]
            )
        
        profits = np.array([t['profit'] for t in trades])
        total_trades = len(trades)
        winning_trades = np.sum(profits > 0)
        losing_trades = np.sum(profits < 0)
        win_rate = (winning_trades / total_trades * 100) if total_trades > 0 else 0.0
        total_profit = np.sum(profits)
        gross_profit = np.sum(profits[profits > 0])
        gross_loss = abs(np.sum(profits[profits < 0]))
        profit_factor = (gross_profit / gross_loss) if gross_loss > 0 else 0.0
        
        cumulative = np.cumsum(profits)
        running_max = np.maximum.accumulate(cumulative)
        drawdown = running_max - cumulative
        max_drawdown = np.max(drawdown) if len(drawdown) > 0 else 0.0
        
        if len(profits) > 1:
            mean_return = np.mean(profits)
            std_return = np.std(profits)
            sharpe_ratio = (mean_return / std_return * np.sqrt(252)) if std_return > 0 else 0.0
        else:
            sharpe_ratio = 0.0
            
        wins = profits[profits > 0]
        losses = profits[profits < 0]
        average_win = np.mean(wins) if len(wins) > 0 else 0.0
        average_loss = np.mean(losses) if len(losses) > 0 else 0.0
        largest_win = np.max(wins) if len(wins) > 0 else 0.0
        largest_loss = np.min(losses) if len(losses) > 0 else 0.0
        
        return BacktestResult(
            totalTrades=int(total_trades),
            winningTrades=int(winning_trades),
            losingTrades=int(losing_trades),
            winRate=float(win_rate),
            totalProfit=float(total_profit),
            maxDrawdown=float(max_drawdown),
            profitFactor=float(profit_factor),
            sharpeRatio=float(sharpe_ratio),
            averageWin=float(average_win),
            averageLoss=float(average_loss),
            largestWin=float(largest_win),
            largestLoss=float(largest_loss),
            trades=trades  # Include full trade list
        )
