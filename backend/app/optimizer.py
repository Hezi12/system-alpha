"""
Optimization Engine with Multi-Processing
Leverages all M1 CPU cores
"""
import numpy as np
from typing import Dict, List, Any, Tuple
from itertools import product
from multiprocessing import Pool, cpu_count
from app.backtest import BacktestEngine
from app.indicators import IndicatorBank
from app.models import Strategy, StrategyCondition, BacktestResult, OptimizationResult


def _run_single_backtest(args: Tuple) -> Tuple[Dict[str, Any], BacktestResult]:
    """Run single backtest (worker function)"""
    data, indicator_bank_state, strategy_dict, param_combination = args

    # Rebuild indicator bank with full state
    indicator_bank = IndicatorBank(data)
    indicator_bank.indicators = indicator_bank_state['indicators']
    indicator_bank.timeframes = indicator_bank_state['timeframes']
    indicator_bank._close_times_cache = indicator_bank_state['close_times_cache']
    
    # Rebuild strategy with params
    strategy = Strategy(**strategy_dict)
    
    # Apply param combination (parse keys like "entry_0_threshold")
    for full_param_name, param_value in param_combination.items():
        # Parse: "entry_0_threshold" -> side="entry", idx=0, param_name="threshold"
        parts = full_param_name.split('_', 2)  # Split max 3 parts
        if len(parts) < 3:
            continue
            
        side = parts[0]  # "entry" or "exit"
        try:
            condition_idx = int(parts[1])  # 0, 1, 2...
        except ValueError:
            continue
        param_name = parts[2]  # "threshold", "period", etc.
        
        # Apply to correct condition
        if side == 'entry' and condition_idx < len(strategy.entryConditions):
            strategy.entryConditions[condition_idx].params[param_name] = param_value
        elif side == 'exit' and condition_idx < len(strategy.exitConditions):
            strategy.exitConditions[condition_idx].params[param_name] = param_value
    
    # Run backtest
    engine = BacktestEngine(data, indicator_bank)
    result = engine.run(strategy)
    
    # Convert param_combination numpy types to Python native types for JSON serialization
    clean_params = {k: float(v) if isinstance(v, (np.integer, np.floating)) else v 
                    for k, v in param_combination.items()}
    
    return (clean_params, result)


class Optimizer:
    """High-Performance Optimizer"""
    
    def __init__(self, data: Dict[str, np.ndarray], indicator_bank: IndicatorBank, strategy: Strategy):
        self.data = data
        self.indicator_bank = indicator_bank
        self.strategy = strategy
        # Use 6 cores for better performance (still leaves headroom for system)
        self.num_cores = min(6, cpu_count())
        
    def optimize(self, optimization_ranges: Dict[str, Dict[str, Any]], 
                 progress_callback=None) -> List[OptimizationResult]:
        """Run optimization"""
        import time
        
        # Generate all combinations
        param_names = list(optimization_ranges.keys())
        param_values = []
        
        for param_name in param_names:
            range_config = optimization_ranges[param_name]
            min_val = range_config['min']
            max_val = range_config['max']
            step = range_config['step']
            
            values = np.arange(min_val, max_val + step, step)
            param_values.append(values)
        
        # Cartesian product
        combinations = list(product(*param_values))
        total_combinations = len(combinations)
        
        print(f"🚀 Optimizing {total_combinations} combinations using {self.num_cores} cores...")
        
        # Prepare combinations as dicts (convert numpy types to Python native types)
        param_combinations = [
            {k: float(v) if isinstance(v, (np.integer, np.floating)) else v 
             for k, v in zip(param_names, combo)}
            for combo in combinations
        ]
        
        # Prepare args for workers (full indicator bank state)
        strategy_dict = self.strategy.model_dump()
        indicator_bank_state = {
            'indicators': self.indicator_bank.indicators,
            'timeframes': self.indicator_bank.timeframes,
            'close_times_cache': self.indicator_bank._close_times_cache,
        }

        args_list = [
            (self.data, indicator_bank_state, strategy_dict, combo)
            for combo in param_combinations
        ]
        
        # Run parallel with progress tracking
        results = []
        start_time = time.time()
        
        with Pool(processes=self.num_cores) as pool:
            for i, (params, result) in enumerate(pool.imap(_run_single_backtest, args_list)):
                results.append(OptimizationResult(params=params, result=result))
                
                # Progress update every 10% or every 100 combinations
                if (i + 1) % max(1, total_combinations // 10) == 0 or (i + 1) % 100 == 0:
                    elapsed = time.time() - start_time
                    rate = (i + 1) / elapsed  # combinations per second
                    remaining = (total_combinations - (i + 1)) / rate if rate > 0 else 0
                    
                    print(f"📊 Progress: {i+1}/{total_combinations} ({(i+1)/total_combinations*100:.1f}%) | "
                          f"Elapsed: {elapsed:.1f}s | Remaining: {remaining:.1f}s | "
                          f"Rate: {rate:.1f} comb/s")
                
                # Progress callback
                if progress_callback:
                    progress_callback(i + 1, total_combinations)
        
        # Sort by total profit (descending)
        results.sort(key=lambda x: x.result.totalProfit, reverse=True)
        
        elapsed_total = time.time() - start_time
        print(f"✅ Optimization complete! Best profit: ${results[0].result.totalProfit:.2f} | Total time: {elapsed_total:.1f}s")
        
        return results

