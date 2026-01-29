"""
SYSTEM_ALPHA Backend Server
FastAPI + NumPy + Multiprocessing
"""
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from typing import Dict, Any
import numpy as np
import pandas as pd
import time
from io import StringIO

from app.models import (
    BacktestRequest, OptimizationRequest, 
    BacktestResult, OptimizationResult
)
from app.indicators import IndicatorBank
from app.backtest import BacktestEngine
from app.optimizer import Optimizer

# Initialize FastAPI
app = FastAPI(title="SYSTEM_ALPHA Backend", version="1.0.0")

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global storage (in production, use Redis/DB)
data_store: Dict[str, Any] = {}

# Auto-load default CSV on startup
@app.on_event("startup")
async def load_default_data():
    """Load default CSV file on startup"""
    import os
    
    default_csv_path = os.path.join(os.path.dirname(__file__), '../../NQ2018.csv')
    
    if os.path.exists(default_csv_path):
        print(f"🚀 Loading default data from {default_csv_path}...")
        try:
            df = pd.read_csv(default_csv_path)
            
            # Normalize column names
            df.columns = df.columns.str.lower().str.strip()
            if 'datetime' in df.columns:
                df.rename(columns={'datetime': 'time'}, inplace=True)
            
            # Parse time column
            if df['time'].dtype == 'object':
                df['time'] = pd.to_datetime(df['time']).astype(np.int64) // 10**9
            else:
                df['time'] = df['time'].astype(np.int64)
            
            # Convert to numpy arrays
            data = {
                'time': df['time'].values,
                'open': df['open'].values.astype(float),
                'high': df['high'].values.astype(float),
                'low': df['low'].values.astype(float),
                'close': df['close'].values.astype(float),
                'volume': df['volume'].values.astype(float)
            }
            
            data_store['data'] = data
            print(f"✅ Loaded {len(data['close'])} bars from default CSV")
        except Exception as e:
            print(f"❌ Failed to load default CSV: {e}")
    else:
        print(f"⚠️ Default CSV not found at {default_csv_path}")


@app.get("/")
def read_root():
    """Health check"""
    return {
        "status": "online",
        "service": "SYSTEM_ALPHA Backend",
        "version": "1.0.0"
    }


@app.post("/upload-csv")
async def upload_csv(file: UploadFile = File(...)):
    """Upload CSV and build indicator bank"""
    try:
        start_time = time.time()
        
        # Read CSV
        contents = await file.read()
        df = pd.read_csv(StringIO(contents.decode('utf-8')))
        
        # Normalize column names (handle 'datetime' or 'time')
        df.columns = df.columns.str.lower().str.strip()
        if 'datetime' in df.columns:
            df.rename(columns={'datetime': 'time'}, inplace=True)
        
        # Validate columns
        required_cols = ['time', 'open', 'high', 'low', 'close', 'volume']
        if not all(col in df.columns for col in required_cols):
            raise HTTPException(status_code=400, detail=f"CSV must contain: {required_cols} (found: {list(df.columns)})")
        
        # Parse time column (handle both Unix timestamp and datetime strings)
        if df['time'].dtype == 'object':
            # It's a string, parse as datetime
            df['time'] = pd.to_datetime(df['time']).astype(np.int64) // 10**9
        else:
            # Already numeric, assume Unix timestamp in seconds
            df['time'] = df['time'].astype(np.int64)
        
        # Convert to numpy arrays
        data = {
            'time': df['time'].values,
            'open': df['open'].values.astype(float),
            'high': df['high'].values.astype(float),
            'low': df['low'].values.astype(float),
            'close': df['close'].values.astype(float),
            'volume': df['volume'].values.astype(float)
        }
        
        # Store data (we'll build indicators on-demand during backtest/optimization)
        data_store['data'] = data
        
        elapsed = time.time() - start_time
        
        return {
            "success": True,
            "bars": len(data['close']),
            "elapsed_seconds": round(elapsed, 2),
            "message": f"✅ Loaded {len(data['close'])} bars in {elapsed:.2f}s (indicators will be built on-demand)"
        }
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/backtest", response_model=BacktestResult)
def run_backtest(request: BacktestRequest):
    """Run single backtest"""
    try:
        start_time = time.time()
        
        # Check if data is loaded
        if 'data' not in data_store:
            raise HTTPException(status_code=400, detail="No data loaded. Upload CSV first.")
        
        # Get data
        data = data_store['data']
        
        # Build indicator bank on-demand (smart - only what's needed)
        indicator_bank = IndicatorBank(data)
        indicator_bank.build_smart(request.strategy.model_dump())
        
        # Run backtest
        engine = BacktestEngine(data, indicator_bank)
        result = engine.run(request.strategy)
        
        elapsed = time.time() - start_time
        print(f"⚡ Backtest completed in {elapsed:.3f}s")
        
        return result
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/optimize")
def run_optimization(request: OptimizationRequest):
    """Run optimization"""
    try:
        start_time = time.time()
        
        # Check if data is loaded
        if 'data' not in data_store:
            raise HTTPException(status_code=400, detail="No data loaded. Upload CSV first.")
        
        # Get data
        data = data_store['data']
        
        # Build indicator bank on-demand (smart - only what's needed)
        print("🏗️ Building indicator bank for optimization...")
        strategy_dict = request.strategy.model_dump()
        print(f"🔍 DEBUG - Strategy received: {strategy_dict}")
        indicator_bank = IndicatorBank(data)
        indicator_bank.build_smart(strategy_dict)
        
        # Run optimizer
        optimizer = Optimizer(data, indicator_bank, request.strategy)
        results = optimizer.optimize(request.optimizationRanges)
        
        elapsed = time.time() - start_time
        
        print(f"✅ Optimization completed in {elapsed:.2f}s")
        
        # Return top 50 results
        return {
            "success": True,
            "total_combinations": len(results),
            "elapsed_seconds": round(elapsed, 2),
            "results": [r.model_dump() for r in results[:50]]
        }
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/status")
def get_status():
    """Get backend status"""
    return {
        "data_loaded": 'data' in data_store,
        "bars": len(data_store['data']['close']) if 'data' in data_store else 0
    }


@app.get("/get-data")
def get_data():
    """Get loaded data for frontend"""
    if 'data' not in data_store:
        raise HTTPException(status_code=400, detail="No data loaded")
    
    data = data_store['data']
    
    # Convert numpy arrays to list for JSON serialization
    result = []
    for i in range(len(data['time'])):
        result.append({
            'time': int(data['time'][i]),
            'open': float(data['open'][i]),
            'high': float(data['high'][i]),
            'low': float(data['low'][i]),
            'close': float(data['close'][i]),
            'volume': float(data['volume'][i])
        })
    
    return {
        "success": True,
        "bars": len(result),
        "data": result
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=4000)

