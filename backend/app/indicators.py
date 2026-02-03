"""
Technical Indicators - NinjaTrader Compatible
Optimized with NumPy for M1 Performance
"""
import numpy as np
from numba import jit
from typing import Dict, Any, List


class IndicatorBank:
    """Pre-computed Indicator Bank with Multi-Timeframe Support"""
    
    def __init__(self, data: Dict[str, np.ndarray]):
        self.primary_data = data
        self.close = data['close']
        self.high = data['high']
        self.low = data['low']
        self.open = data['open']
        self.volume = data['volume']
        self.time = data['time']
        self.length = len(self.close)
        
        # Storage for aggregated data and indicators
        self.timeframes: Dict[str, Dict[str, np.ndarray]] = {"DEF": data}
        self.indicators: Dict[str, Any] = {}
        # Cache of close-times per timeframe (for lookahead-free alignment)
        self._close_times_cache: Dict[str, np.ndarray] = {}

    def _infer_step_seconds(self, times: np.ndarray, default_step: int) -> int:
        """Infer typical bar step (seconds) from a times array."""
        if times is None or len(times) < 2:
            return int(default_step)
        diffs = np.diff(times.astype(np.int64))
        diffs = diffs[diffs > 0]
        if len(diffs) == 0:
            return int(default_step)
        # Median is robust to session gaps
        step = int(np.median(diffs))
        return step if step > 0 else int(default_step)

    def _get_close_times(self, tf: str) -> np.ndarray:
        """Return close-times array for a timeframe (no lookahead).

        We treat `time` as bar *start* time (NinjaTrader style). Close time is
        the next bar start time; for the last bar we add an inferred/default step.
        """
        tf_key = tf or "DEF"
        if tf_key in self._close_times_cache:
            return self._close_times_cache[tf_key]

        if tf_key == "DEF":
            times = self.time.astype(np.int64)
            default_step = self._infer_step_seconds(times, 60)
        else:
            times = self.timeframes[tf_key]['time'].astype(np.int64)
            try:
                default_step = int(tf_key) * 60
            except Exception:
                default_step = self._infer_step_seconds(times, 60)

        if len(times) == 0:
            close_times = np.array([], dtype=np.int64)
        else:
            close_times = np.empty_like(times)
            close_times[:-1] = times[1:]
            close_times[-1] = times[-1] + self._infer_step_seconds(times, default_step)

        self._close_times_cache[tf_key] = close_times
        return close_times
        
    def _aggregate_data(self, timeframe_mins: int) -> Dict[str, np.ndarray]:
        """Aggregate primary data to a specific timeframe"""
        if timeframe_mins == 1:
            return self.primary_data
            
        import pandas as pd
        df = pd.DataFrame({
            'time': self.time,
            'open': self.open,
            'high': self.high,
            'low': self.low,
            'close': self.close,
            'volume': self.volume
        })
        
        df['dt'] = pd.to_datetime(df['time'], unit='s')
        df.set_index('dt', inplace=True)
        
        # NinjaTrader-style aggregation (starts at :01)
        resampled = df.resample(f'{timeframe_mins}min', label='left', closed='left', origin='start_day').agg({
            'open': 'first',
            'high': 'max',
            'low': 'min',
            'close': 'last',
            'volume': 'sum',
            'time': 'first'
        }).dropna()
        
        return {
            'time': resampled['time'].values.astype(np.int64),
            'open': resampled['open'].values.astype(float),
            'high': resampled['high'].values.astype(float),
            'low': resampled['low'].values.astype(float),
            'close': resampled['close'].values.astype(float),
            'volume': resampled['volume'].values.astype(float)
        }

    def build_smart(self, strategy):
        """Build only indicators needed for the strategy with MTF support"""
        print("🎯 Analyzing strategy to build required indicators (MTF)...")
        
        required_indicators = [] # List of tuples: (indicator_key, timeframe)
        
        # Helper to process conditions
        def process_conds(conditions):
            for cond in (conditions or []):
                if cond.get('enabled', True):
                    tf = cond.get('timeframe') or "DEF"
                    if tf not in self.timeframes and tf != "DEF":
                        print(f"📦 Aggregating data for {tf}m timeframe...")
                        self.timeframes[tf] = self._aggregate_data(int(tf))
                    
                    cond_id = cond.get('id', '')
                    params = cond.get('params', {})
                    indicator_keys = self._get_indicators_for_condition(cond_id, params)
                    for key in indicator_keys:
                        required_indicators.append((key, tf))
        
        process_conds(strategy.get('entryConditions', []))
        process_conds(strategy.get('exitConditions', []))
        
        # Build required indicators
        for key, tf in required_indicators:
            full_key = f"{key}_{tf}"
            if full_key not in self.indicators:
                self._build_single_indicator_mtf(key, tf)
        
        print(f"✅ Built {len(self.indicators)} MTF indicators!")
        return self

    def _get_indicators_for_condition(self, cond_id: str, params: dict) -> set:
        """Map condition ID to required indicators"""
        indicators = set()
        
        # RSI conditions
        if 'rsi' in cond_id:
            period = params.get('period', 14)
            indicators.add(f'rsi_{period}')
        
        # MACD conditions
        elif 'macd' in cond_id:
            fast = params.get('fast', 12)
            slow = params.get('slow', 26)
            signal = params.get('signal', 9)
            indicators.add(f'macd_{fast}_{slow}_{signal}')
            indicators.add(f'macd_signal_{fast}_{slow}_{signal}')
            indicators.add(f'macd_hist_{fast}_{slow}_{signal}')
        
        # SMA conditions
        elif 'sma' in cond_id:
            if 'short' in cond_id and 'long' in cond_id:
                short_period = params.get('shortPeriod', 49)
                long_period = params.get('longPeriod', 98)
                indicators.add(f'sma_{short_period}')
                indicators.add(f'sma_{long_period}')
            else:
                period = params.get('period', 20)
                indicators.add(f'sma_{period}')
        
        # EMA conditions
        elif 'ema' in cond_id:
            period = params.get('period', 20)
            indicators.add(f'ema_{period}')
        
        # Bollinger Bands
        elif 'bb' in cond_id or 'bollinger' in cond_id:
            period = params.get('period', 20)
            indicators.add(f'bb_upper_{period}')
            indicators.add(f'bb_middle_{period}')
            indicators.add(f'bb_lower_{period}')
        
        # Stochastic
        elif 'stoch' in cond_id:
            k_period = params.get('kPeriod', 14)
            d_period = params.get('dPeriod', 3)
            indicators.add(f'stoch_k_{k_period}_{d_period}')
            indicators.add(f'stoch_d_{k_period}_{d_period}')
        
        # ATR
        elif 'atr' in cond_id:
            # Support both 'period' and 'atrPeriod' parameter names
            period = params.get('period') if 'period' in params else params.get('atrPeriod', 14)
            indicators.add(f'atr_{period}')
        
        # ADX
        elif 'adx' in cond_id:
            period = params.get('period', 14)
            indicators.add(f'adx_{period}')
        
        # CCI
        elif 'cci' in cond_id:
            period = params.get('period', 14)
            indicators.add(f'cci_{period}')
        
        # Williams %R
        elif 'williams' in cond_id:
            period = params.get('period', 14)
            indicators.add(f'williams_r_{period}')
        
        # Volume
        elif 'volume' in cond_id:
            if 'spike' in cond_id or 'profile' in cond_id:
                period = params.get('period', params.get('lookback', 20))
            else:
                period = params.get('period', 20)
            indicators.add(f'vol_avg_{period}')
        
        return indicators

    def _build_single_indicator_mtf(self, key: str, tf: str):
        """Build a single indicator for a specific timeframe"""
        data = self.timeframes.get(tf, self.primary_data)
        close = data['close']
        high = data['high']
        low = data['low']
        volume = data['volume']
        
        full_key = f"{key}_{tf}"
        parts = key.split('_')
        indicator_type = parts[0]
        
        try:
            if indicator_type == 'sma' and len(parts) == 2:
                self.indicators[full_key] = calculate_sma(close, int(parts[1]))
            elif indicator_type == 'ema' and len(parts) == 2:
                self.indicators[full_key] = calculate_ema(close, int(parts[1]))
            elif indicator_type == 'rsi' and len(parts) == 2:
                self.indicators[full_key] = calculate_rsi(close, int(parts[1]))
            elif indicator_type == 'macd':
                f, s, sig = int(parts[-3]), int(parts[-2]), int(parts[-1])
                macd, signal, hist = calculate_macd(close, f, s, sig)
                self.indicators[f"macd_{f}_{s}_{sig}_{tf}"] = macd
                self.indicators[f"macd_signal_{f}_{s}_{sig}_{tf}"] = signal
                self.indicators[f"macd_hist_{f}_{s}_{sig}_{tf}"] = hist
            elif indicator_type == 'bb':
                period = int(parts[-1])
                u, m, l = calculate_bollinger_bands(close, period, 2.0)
                self.indicators[f"bb_upper_{period}_{tf}"] = u
                self.indicators[f"bb_middle_{period}_{tf}"] = m
                self.indicators[f"bb_lower_{period}_{tf}"] = l
            elif indicator_type == 'stoch':
                k_p, d_p = int(parts[2]), int(parts[3])
                k, d = calculate_stochastic(high, low, close, k_p, d_p)
                self.indicators[f"stoch_k_{k_p}_{d_p}_{tf}"] = k
                self.indicators[f"stoch_d_{k_p}_{d_p}_{tf}"] = d
            elif indicator_type == 'atr' and len(parts) == 2:
                self.indicators[full_key] = calculate_atr(high, low, close, int(parts[1]))
            elif indicator_type == 'vol' and parts[1] == 'avg':
                # Volume average: SMA (include current bar) - matches frontend & NinjaTrader standard Volume SMA
                self.indicators[full_key] = _sma_core(volume.astype(np.float64), int(parts[2]))
            elif indicator_type == 'adx' and len(parts) == 2:
                self.indicators[full_key] = calculate_adx(high, low, close, int(parts[1]))
            elif indicator_type == 'cci' and len(parts) == 2:
                self.indicators[full_key] = calculate_cci(high, low, close, int(parts[1]))
            elif indicator_type == 'williams' and parts[1] == 'r':
                self.indicators[full_key] = calculate_williams_r(high, low, close, int(parts[2]))
        except Exception as e:
            print(f"❌ Error building MTF indicator {full_key}: {e}")

    def get_mtf(self, key: str, tf: str) -> np.ndarray:
        """Get indicator for specific timeframe and align it to primary data"""
        full_key = f"{key}_{tf}"
        if full_key not in self.indicators:
            return None
            
        indicator_values = self.indicators[full_key]
        if tf == "DEF" or tf is None:
            return indicator_values
            
        # Align MTF indicator back to primary timeframe WITHOUT lookahead:
        # use last *closed* MTF bar as of each primary bar close.
        primary_close = self._get_close_times("DEF")
        mtf_close = self._get_close_times(tf)

        indices = np.searchsorted(mtf_close, primary_close, side='right') - 1
        valid_mask = indices >= 0
        aligned = np.full(len(primary_close), np.nan)
        aligned[valid_mask] = indicator_values[indices[valid_mask]]
        return aligned

    def get(self, key: str) -> np.ndarray:
        """Compatibility method for existing code"""
        return self.get_mtf(key, "DEF")


# ==================== INDICATOR FUNCTIONS ====================

@jit(nopython=True)
def _sma_core(values: np.ndarray, period: int) -> np.ndarray:
    """SMA Core (Numba optimized)"""
    n = len(values)
    result = np.full(n, np.nan)
    
    for i in range(period - 1, n):
        result[i] = np.mean(values[i - period + 1:i + 1])
    
    return result


def calculate_sma(values: np.ndarray, period: int) -> np.ndarray:
    """Simple Moving Average"""
    if len(values) < period:
        return np.full(len(values), np.nan)
    return _sma_core(values, period)


@jit(nopython=True)
def _volume_avg_excluding_current_core(volume: np.ndarray, period: int) -> np.ndarray:
    """Volume Average excluding current bar (NinjaTrader style)
    
    For index i (current bar), calculates average of period bars before i (excluding i).
    Matches NinjaTrader: averageVolume = sum(Volume[1] to Volume[period]) / period
    where Volume[0] = current bar, Volume[1] = 1 bar ago, ..., Volume[period] = period bars ago.
    
    In our 0-indexed array: volume[i] = current, volume[i-1] = 1 bar ago, volume[i-period] = period bars ago.
    So Volume[1] to Volume[period] = volume[i-1] down to volume[i-period] = volume[i-period:i] (period bars).
    """
    n = len(volume)
    result = np.full(n, np.nan)
    
    # Start from index period (need at least period bars before current)
    for i in range(period, n):
        # Calculate average of volume[i-period] to volume[i-1] (period bars before i, excluding i)
        result[i] = np.mean(volume[i - period:i])
    
    return result


def calculate_volume_average_excluding_current(volume: np.ndarray, period: int) -> np.ndarray:
    """Volume Average excluding current bar (NinjaTrader compatible)
    
    This is used for Volume Spike conditions where we compare current volume
    to average of previous bars only (not including current bar in the average).
    """
    if len(volume) < period + 1:
        return np.full(len(volume), np.nan)
    return _volume_avg_excluding_current_core(volume, period)


def calculate_ema(values: np.ndarray, period: int) -> np.ndarray:
    """Exponential Moving Average"""
    ema = np.full(len(values), np.nan)
    if len(values) < period:
        return ema
        
    multiplier = 2 / (period + 1)
    
    # First EMA = SMA
    ema[period - 1] = np.mean(values[:period])
    
    # Subsequent EMAs
    for i in range(period, len(values)):
        ema[i] = (values[i] - ema[i - 1]) * multiplier + ema[i - 1]
    
    return ema


@jit(nopython=True)
def _rsi_core(values: np.ndarray, period: int) -> np.ndarray:
    """RSI Core (Numba optimized)"""
    n = len(values)
    rsi = np.full(n, np.nan)
    
    # Calculate price changes
    deltas = np.diff(values)
    
    # Separate gains and losses
    gains = np.where(deltas > 0, deltas, 0.0)
    losses = np.where(deltas < 0, -deltas, 0.0)
    
    # Initial averages
    avg_gain = np.mean(gains[:period])
    avg_loss = np.mean(losses[:period])
    
    if avg_loss == 0:
        rsi[period] = 100.0
    else:
        rs = avg_gain / avg_loss
        rsi[period] = 100.0 - (100.0 / (1.0 + rs))
    
    # Smooth subsequent values
    for i in range(period + 1, n):
        avg_gain = (avg_gain * (period - 1) + gains[i - 1]) / period
        avg_loss = (avg_loss * (period - 1) + losses[i - 1]) / period
        
        if avg_loss == 0:
            rsi[i] = 100.0
        else:
            rs = avg_gain / avg_loss
            rsi[i] = 100.0 - (100.0 / (1.0 + rs))
    
    return rsi


def calculate_rsi(values: np.ndarray, period: int = 14) -> np.ndarray:
    """Relative Strength Index"""
    if len(values) < period + 1:
        return np.full(len(values), np.nan)
    return _rsi_core(values, period)


def calculate_macd(values: np.ndarray, fast: int = 12, slow: int = 26, signal: int = 9):
    """MACD - תואם NinjaTrader. קו ה-Signal = EMA של קו MACD בלבד מערכים תקינים"""
    ema_fast = calculate_ema(values, fast)
    ema_slow = calculate_ema(values, slow)
    
    macd = ema_fast - ema_slow
    
    # Signal = EMA of MACD line - רק מערכים תקינים (מ slow-1 והלאה)
    first_valid = slow - 1
    signal_aligned = np.full(len(macd), np.nan)
    if first_valid + signal <= len(macd):
        macd_slice = macd[first_valid:].astype(np.float64)
        signal_slice = calculate_ema(macd_slice, signal)
        # signal_slice has first valid at index signal-1
        signal_aligned[first_valid:] = signal_slice
    
    histogram = macd - signal_aligned
    
    return macd, signal_aligned, histogram


def calculate_bollinger_bands(values: np.ndarray, period: int = 20, std_dev: float = 2.0):
    """Bollinger Bands"""
    middle = calculate_sma(values, period)
    
    # Calculate rolling std
    std = np.full(len(values), np.nan)
    if len(values) >= period:
        for i in range(period - 1, len(values)):
            std[i] = np.std(values[i - period + 1:i + 1])
    
    upper = middle + (std * std_dev)
    lower = middle - (std * std_dev)
    
    return upper, middle, lower


def calculate_stochastic(high: np.ndarray, low: np.ndarray, close: np.ndarray, 
                         k_period: int = 14, d_period: int = 3):
    """Stochastic Oscillator"""
    n = len(close)
    k = np.full(n, np.nan)
    
    if n >= k_period:
        for i in range(k_period - 1, n):
            highest_high = np.max(high[i - k_period + 1:i + 1])
            lowest_low = np.min(low[i - k_period + 1:i + 1])
            
            if highest_high - lowest_low == 0:
                k[i] = 50.0
            else:
                k[i] = 100.0 * (close[i] - lowest_low) / (highest_high - lowest_low)
    
    # %D is SMA of %K
    d = calculate_sma(k, d_period)
    
    return k, d


@jit(nopython=True)
def _atr_core(high: np.ndarray, low: np.ndarray, close: np.ndarray, period: int) -> np.ndarray:
    """ATR Core (Numba optimized)"""
    n = len(close)
    tr = np.full(n, np.nan)
    atr = np.full(n, np.nan)
    
    # True Range
    for i in range(1, n):
        hl = high[i] - low[i]
        hc = abs(high[i] - close[i - 1])
        lc = abs(low[i] - close[i - 1])
        tr[i] = max(hl, hc, lc)
    
    # First ATR = average TR
    atr[period] = np.mean(tr[1:period + 1])
    
    # Smooth ATR
    for i in range(period + 1, n):
        atr[i] = (atr[i - 1] * (period - 1) + tr[i]) / period
    
    return atr


def calculate_atr(high: np.ndarray, low: np.ndarray, close: np.ndarray, period: int = 14) -> np.ndarray:
    """Average True Range"""
    if len(close) < period + 1:
        return np.full(len(close), np.nan)
    return _atr_core(high, low, close, period)


def calculate_adx(high: np.ndarray, low: np.ndarray, close: np.ndarray, period: int = 14) -> np.ndarray:
    """Average Directional Index"""
    n = len(close)
    if n < period * 2:
        return np.full(n, np.nan)
        
    # Calculate +DM and -DM
    plus_dm = np.zeros(n)
    minus_dm = np.zeros(n)
    
    for i in range(1, n):
        up_move = high[i] - high[i - 1]
        down_move = low[i - 1] - low[i]
        
        if up_move > down_move and up_move > 0:
            plus_dm[i] = up_move
        if down_move > up_move and down_move > 0:
            minus_dm[i] = down_move
    
    # ATR
    atr = calculate_atr(high, low, close, period)
    
    # Smooth DMs
    plus_di = np.full(n, np.nan)
    minus_di = np.full(n, np.nan)
    
    for i in range(period, n):
        if atr[i] > 0:
            # Wilder's smoothing for DI is basically a smoothed average
            # Simplified version for vector performance
            plus_di[i] = 100 * np.mean(plus_dm[i - period + 1:i + 1]) / atr[i]
            minus_di[i] = 100 * np.mean(minus_dm[i - period + 1:i + 1]) / atr[i]
    
    # DX
    dx = np.full(n, np.nan)
    for i in range(period, n):
        if not np.isnan(plus_di[i]) and not np.isnan(minus_di[i]):
            di_sum = plus_di[i] + minus_di[i]
            if di_sum > 0:
                dx[i] = 100 * abs(plus_di[i] - minus_di[i]) / di_sum
    
    # ADX is SMA of DX
    adx = calculate_sma(dx, period)
    
    return adx


def calculate_cci(high: np.ndarray, low: np.ndarray, close: np.ndarray, period: int = 14) -> np.ndarray:
    """Commodity Channel Index"""
    n = len(close)
    typical_price = (high + low + close) / 3.0
    cci = np.full(n, np.nan)
    
    if n >= period:
        for i in range(period - 1, n):
            tp_slice = typical_price[i - period + 1:i + 1]
            sma = np.mean(tp_slice)
            mean_deviation = np.mean(np.abs(tp_slice - sma))
            
            if mean_deviation > 0:
                cci[i] = (typical_price[i] - sma) / (0.015 * mean_deviation)
    
    return cci


def calculate_williams_r(high: np.ndarray, low: np.ndarray, close: np.ndarray, period: int = 14) -> np.ndarray:
    """Williams %R"""
    n = len(close)
    williams = np.full(n, np.nan)
    
    if n >= period:
        for i in range(period - 1, n):
            highest_high = np.max(high[i - period + 1:i + 1])
            lowest_low = np.min(low[i - period + 1:i + 1])
            
            if highest_high - lowest_low > 0:
                williams[i] = -100.0 * (highest_high - close[i]) / (highest_high - lowest_low)
    
    return williams
