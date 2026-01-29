/**
 * API Client for SYSTEM_ALPHA Backend
 */

const API_BASE_URL = 'http://localhost:4000';

/**
 * Upload CSV file
 */
export async function uploadCSV(file) {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(`${API_BASE_URL}/upload-csv`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || 'Failed to upload CSV');
  }

  return await response.json();
}

/**
 * Run backtest
 */
export async function runBacktest(data, strategy) {
  const response = await fetch(`${API_BASE_URL}/backtest`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      strategy,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || 'Backtest failed');
  }

  return await response.json();
}

/**
 * Run optimization
 */
export async function runOptimization(data, strategy, optimizationRanges, onProgress) {
  const response = await fetch(`${API_BASE_URL}/optimize`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      strategy,
      optimizationRanges,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || 'Optimization failed');
  }

  return await response.json();
}

/**
 * Get backend status
 */
export async function getBackendStatus() {
  const response = await fetch(`${API_BASE_URL}/status`);

  if (!response.ok) {
    throw new Error('Failed to get backend status');
  }

  return await response.json();
}

/**
 * Get loaded data from backend
 */
export async function getLoadedData() {
  const response = await fetch(`${API_BASE_URL}/get-data`);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || 'Failed to get data');
  }

  return await response.json();
}

