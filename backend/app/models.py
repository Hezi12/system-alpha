"""
Data Models for SYSTEM_ALPHA Backend
"""
from typing import List, Dict, Any, Optional
from pydantic import BaseModel


class OHLCVData(BaseModel):
    """OHLCV Candle Data"""
    time: int
    open: float
    high: float
    low: float
    close: float
    volume: float


class StrategyCondition(BaseModel):
    """Strategy Condition"""
    id: str
    params: Dict[str, Any] = {}
    enabled: bool = True
    timeframe: Optional[str] = None


class Strategy(BaseModel):
    """Trading Strategy"""
    entryConditions: List[StrategyCondition]
    exitConditions: List[StrategyCondition]


class BacktestRequest(BaseModel):
    """Backtest Request"""
    strategy: Strategy


class OptimizationRequest(BaseModel):
    """Optimization Request"""
    strategy: Strategy
    optimizationRanges: Dict[str, Dict[str, Any]]


class BacktestResult(BaseModel):
    """Backtest Result"""
    totalTrades: int
    winningTrades: int
    losingTrades: int
    winRate: float
    totalProfit: float
    maxDrawdown: float
    profitFactor: float
    sharpeRatio: float
    averageWin: float
    averageLoss: float
    largestWin: float
    largestLoss: float
    trades: List[Dict[str, Any]] = []  # List of trade details


class OptimizationResult(BaseModel):
    """Optimization Result"""
    params: Dict[str, Any]
    result: BacktestResult


