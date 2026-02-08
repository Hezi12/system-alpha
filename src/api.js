/**
 * API Client for SYSTEM_ALPHA Backend
 */
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

/** Default request timeout in milliseconds */
const REQUEST_TIMEOUT_MS = 30000;

/**
 * Helper: create an AbortSignal that times out after the given ms.
 */
function createTimeoutSignal(ms = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, clear: () => clearTimeout(id) };
}

/**
 * Helper: safely parse a JSON response, falling back to raw text on failure.
 */
async function safeJsonParse(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { detail: text };
  }
}

/**
 * Upload CSV file
 */
export async function uploadCSV(file) {
  const { signal, clear } = createTimeoutSignal();
  try {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch(`${API_BASE_URL}/upload-csv`, {
      method: 'POST',
      body: formData,
      signal,
    });

    if (!response.ok) {
      const error = await safeJsonParse(response);
      throw new Error(error.detail || 'Failed to upload CSV');
    }

    return await safeJsonParse(response);
  } finally {
    clear();
  }
}

/**
 * Run backtest
 */
export async function runBacktest(data, strategy) {
  const { signal, clear } = createTimeoutSignal();
  try {
    const response = await fetch(`${API_BASE_URL}/backtest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        strategy,
      }),
      signal,
    });

    if (!response.ok) {
      const error = await safeJsonParse(response);
      throw new Error(error.detail || 'Backtest failed');
    }

    return await safeJsonParse(response);
  } finally {
    clear();
  }
}

/**
 * Run optimization (longer timeout - optimizations can take minutes)
 */
export async function runOptimization(data, strategy, optimizationRanges) {
  const { signal, clear } = createTimeoutSignal(5 * 60 * 1000);
  try {
    const response = await fetch(`${API_BASE_URL}/optimize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        strategy,
        optimizationRanges,
      }),
      signal,
    });

    if (!response.ok) {
      const error = await safeJsonParse(response);
      throw new Error(error.detail || 'Optimization failed');
    }

    return await safeJsonParse(response);
  } finally {
    clear();
  }
}

/**
 * Get backend status
 */
export async function getBackendStatus() {
  const { signal, clear } = createTimeoutSignal();
  try {
    const response = await fetch(`${API_BASE_URL}/status`, { signal });

    if (!response.ok) {
      throw new Error('Failed to get backend status');
    }

    return await safeJsonParse(response);
  } finally {
    clear();
  }
}

/**
 * Get loaded data from backend
 */
export async function getLoadedData() {
  const { signal, clear } = createTimeoutSignal();
  try {
    const response = await fetch(`${API_BASE_URL}/get-data`, { signal });

    if (!response.ok) {
      const error = await safeJsonParse(response);
      throw new Error(error.detail || 'Failed to get data');
    }

    return await safeJsonParse(response);
  } finally {
    clear();
  }
}
