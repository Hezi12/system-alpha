"""
Vectorized Backtest Engine
Ultra-fast backtesting with NumPy
"""
import numpy as np
from datetime import datetime
from typing import Dict, List, Any
import pandas as pd
from app import FOMC_DATES, TICK_SIZE
from app.indicators import IndicatorBank
from app.models import BacktestResult, Strategy, StrategyCondition
from app.conditions import CONDITION_HANDLERS


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
        
        # Simulate trades (with intrabar SL/TP)
        trades = self._simulate_trades(entry_signals, exit_signals, strategy)
        
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
        """Check single condition with MTF support - dispatches to condition handlers"""
        handler = CONDITION_HANDLERS.get(condition.id)
        if handler:
            return handler(self.data, self.indicator_bank, condition, self.length)
        return np.zeros(self.length, dtype=bool)

    def _simulate_trades(self, entry_signals: np.ndarray, exit_signals: np.ndarray, strategy: Strategy) -> List[Dict[str, Any]]:
        """Simulate trades with intrabar SL/TP (NinjaTrader-style)"""
        trades = []
        in_trade = False
        entry_price = 0.0
        entry_idx = 0
        close = self.data['close']
        open_ = self.data['open']
        high = self.data['high']
        low = self.data['low']
        time_arr = self.data['time']

        # Extract SL/TP from exit conditions
        sl_ticks = None
        tp_ticks = None
        for c in (strategy.exitConditions or []):
            if not getattr(c, 'enabled', True):
                continue
            if c.id == 'stop_loss_ticks':
                sl_ticks = (c.params or {}).get('ticks')
            elif c.id == 'take_profit_ticks':
                tp_ticks = (c.params or {}).get('ticks')

        for i in range(len(close)):
            # 1. Intrabar SL/TP check (when in trade)
            if in_trade and i >= entry_idx:
                intrabar_exit = None
                exit_reason = ''
                if sl_ticks is not None:
                    sl_price = entry_price - (sl_ticks * TICK_SIZE)
                    if low[i] <= sl_price:
                        # Gap through: exit at open
                        intrabar_exit = open_[i] if open_[i] <= sl_price else sl_price
                        exit_reason = 'Stop Loss (Gap)' if open_[i] <= sl_price else 'Stop Loss'
                if intrabar_exit is None and tp_ticks is not None:
                    tp_price = entry_price + (tp_ticks * TICK_SIZE)
                    if high[i] > tp_price:  # NinjaTrader: needs tick above
                        # Gap up: פתיחה מעל TP → מילאנו ב-open (רווח מלא, לא מוגבל ל-TP)
                        intrabar_exit = open_[i] if open_[i] >= tp_price else tp_price
                        exit_reason = 'Take Profit (Gap)' if open_[i] >= tp_price else 'Take Profit'
                if intrabar_exit is not None:
                    profit = intrabar_exit - entry_price
                    trades.append({
                        'entry_idx': entry_idx, 'exit_idx': i,
                        'entry_price': entry_price, 'exit_price': intrabar_exit,
                        'profit': profit,
                        'entry_time': int(time_arr[entry_idx]), 'exit_time': int(time_arr[i]),
                        'exit_reason': exit_reason
                    })
                    in_trade = False
                    # Allow new entry on same bar
                    if not entry_signals[i]:
                        continue

            # 2. Exit on signal (bar close)
            if in_trade and exit_signals[i]:
                exit_price = close[i]
                profit = exit_price - entry_price
                trades.append({
                    'entry_idx': entry_idx, 'exit_idx': i,
                    'entry_price': entry_price, 'exit_price': exit_price,
                    'profit': profit,
                    'entry_time': int(time_arr[entry_idx]), 'exit_time': int(time_arr[i]),
                    'exit_reason': 'Signal'
                })
                in_trade = False

            # 3. Entry (OnBarClose: signal at bar i close -> execute at next bar open)
            if not in_trade and entry_signals[i] and i + 1 < len(close):
                in_trade = True
                entry_idx = i + 1
                entry_price = open_[i + 1]

        if in_trade:
            exit_price = close[-1]
            profit = exit_price - entry_price
            trades.append({
                'entry_idx': entry_idx, 'exit_idx': len(close) - 1,
                'entry_price': entry_price, 'exit_price': exit_price,
                'profit': profit,
                'entry_time': int(time_arr[entry_idx]), 'exit_time': int(time_arr[-1]),
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
