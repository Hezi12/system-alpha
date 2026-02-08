"""
SYSTEM_ALPHA Backend Server
FastAPI + NumPy + Multiprocessing
"""
import os
from contextlib import asynccontextmanager

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

# Global storage (in production, use Redis/DB)
data_store: Dict[str, Any] = {}

# CORS origins (restrict in production via CORS_ORIGINS env var)
CORS_ORIGINS = os.environ.get(
    "CORS_ORIGINS",
    "http://localhost:5173,http://localhost:4000,http://127.0.0.1:5173"
).split(",")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application startup/shutdown lifecycle"""
    await _load_default_data()
    yield


# Initialize FastAPI
app = FastAPI(title="SYSTEM_ALPHA Backend", version="1.0.0", lifespan=lifespan)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _parse_csv_to_numpy(df: pd.DataFrame) -> Dict[str, np.ndarray]:
    """Parse a DataFrame into numpy arrays for the backtest engine"""
    df.columns = df.columns.str.lower().str.strip()
    if 'datetime' in df.columns:
        df.rename(columns={'datetime': 'time'}, inplace=True)

    required_cols = ['time', 'open', 'high', 'low', 'close', 'volume']
    missing = [c for c in required_cols if c not in df.columns]
    if missing:
        raise ValueError(f"CSV must contain: {required_cols} (missing: {missing}, found: {list(df.columns)})")

    if df['time'].dtype == 'object':
        df['time'] = pd.to_datetime(df['time']).astype(np.int64) // 10**9
    else:
        df['time'] = df['time'].astype(np.int64)

    return {
        'time': df['time'].values,
        'open': df['open'].values.astype(float),
        'high': df['high'].values.astype(float),
        'low': df['low'].values.astype(float),
        'close': df['close'].values.astype(float),
        'volume': df['volume'].values.astype(float),
    }


async def _load_default_data():
    """Load default CSV file on startup"""
    default_csv_path = os.path.join(os.path.dirname(__file__), '../../NQ2018.csv')

    if os.path.exists(default_csv_path):
        print(f"🚀 Loading default data from {default_csv_path}...")
        try:
            df = pd.read_csv(default_csv_path)
            data_store['data'] = _parse_csv_to_numpy(df)
            print(f"✅ Loaded {len(data_store['data']['close'])} bars from default CSV")
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

        contents = await file.read()
        df = pd.read_csv(StringIO(contents.decode('utf-8')))
        data = _parse_csv_to_numpy(df)
        data_store['data'] = data

        elapsed = time.time() - start_time

        return {
            "success": True,
            "bars": len(data['close']),
            "elapsed_seconds": round(elapsed, 2),
            "message": f"✅ Loaded {len(data['close'])} bars in {elapsed:.2f}s (indicators will be built on-demand)"
        }

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
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

    # Vectorized conversion (much faster than row-by-row loop)
    n = len(data['time'])
    times = data['time'].astype(int).tolist()
    opens = data['open'].tolist()
    highs = data['high'].tolist()
    lows = data['low'].tolist()
    closes = data['close'].tolist()
    volumes = data['volume'].tolist()

    result = [
        {'time': times[i], 'open': opens[i], 'high': highs[i],
         'low': lows[i], 'close': closes[i], 'volume': volumes[i]}
        for i in range(n)
    ]

    return {
        "success": True,
        "bars": n,
        "data": result
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=4000)

