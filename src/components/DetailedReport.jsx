import React, { useState, useMemo } from 'react';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { Activity, X, DollarSign, TrendingUp, Hash, ArrowDownRight, CalendarRange, ArrowUp, ArrowDown, BarChart3, Table, Download, Upload, FileCheck, Sparkles } from 'lucide-react';
import { COLORS } from '../constants';

const parseNinjaCSV = (csvText) => {
    const lines = csvText.split('\n');
    if (lines.length < 2) return [];

    const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
    const entryTimeIdx = headers.indexOf('Entry time');
    const exitTimeIdx = headers.indexOf('Exit time');
    const entryPriceIdx = headers.indexOf('Entry price');
    const exitPriceIdx = headers.indexOf('Exit price');
    const profitIdx = headers.indexOf('Profit');
    const sideIdx = headers.indexOf('Market pos.');
    const maeIdx = headers.indexOf('MAE');
    const mfeIdx = headers.indexOf('MFE');
    const etdIdx = headers.indexOf('ETD');
    const barsIdx = headers.indexOf('Bars');

    if (entryTimeIdx === -1 || profitIdx === -1) return [];

    const trades = [];
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const cols = line.split(',').map(c => c.trim().replace(/"/g, ''));
        if (cols.length <= Math.max(entryTimeIdx, profitIdx)) continue;

        const entryTimeStr = cols[entryTimeIdx];
        const exitTimeStr = cols[exitTimeIdx];
        const entryPrice = parseFloat(cols[entryPriceIdx]);
        const exitPrice = parseFloat(cols[exitPriceIdx]);
        const side = cols[sideIdx];
        const profitRaw = cols[profitIdx];

        let profitStr = profitRaw.replace(/[$,]/g, '');
        if (profitStr.startsWith('(') && profitStr.endsWith(')')) {
            profitStr = '-' + profitStr.substring(1, profitStr.length - 1);
        }

        const profit = parseFloat(profitStr);
        if (isNaN(profit)) continue;

        const dateMatch = entryTimeStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
        if (dateMatch) {
            const [_, m, d, y] = dateMatch;
            const dateKey = `${d.padStart(2, '0')}/${m.padStart(2, '0')}/${y}`;

            const parseMoney = (val) => {
                if (!val) return 0;
                let s = val.replace(/[$,]/g, '');
                if (s.startsWith('(') && s.endsWith(')')) s = '-' + s.substring(1, s.length - 1);
                return parseFloat(s) || 0;
            };

            trades.push({
                dateKey,
                profit,
                entryTime: entryTimeStr,
                exitTime: exitTimeStr,
                entryPrice,
                exitPrice,
                side,
                mae: parseMoney(cols[maeIdx]),
                mfe: parseMoney(cols[mfeIdx]),
                etd: parseMoney(cols[etdIdx]),
                bars: parseInt(cols[barsIdx]) || 0
            });
        }
    }
    return trades;
};

const DetailedReport = ({ results, strategyConfig, onClose, onTradeClick }) => {
    const [reportTab, setReportTab] = useState('PERFORMANCE');
    const [ninjaTrades, setNinjaTrades] = useState([]);
    const [isUploadingNinja, setIsUploadingNinja] = useState(false);
    const [aiAnalysis, setAiAnalysis] = useState('');
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [sortColumn, setSortColumn] = useState('id'); // Column to sort by
    const [sortDirection, setSortDirection] = useState('asc'); // 'asc', 'desc', or 'none'
    const [periodView, setPeriodView] = useState('Trades'); // 'Trades', 'Daily', 'Weekly', 'Monthly', 'Yearly', 'Half-hour of day', 'Hour of day', 'Day of week'

    if (!results) return null;
    const { stats, trades } = results;

    const discrepancies = useMemo(() => {
        if (ninjaTrades.length === 0) return [];

        const systemDaily = new Map();
        trades.forEach(t => {
            const date = new Date(t.entryTime * 1000);
            const key = date.toLocaleDateString('en-GB', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'UTC' });
            systemDaily.set(key, (systemDaily.get(key) || 0) + t.pnl);
        });

        const ninjaDaily = new Map();
        ninjaTrades.forEach(t => {
            ninjaDaily.set(t.dateKey, (ninjaDaily.get(t.dateKey) || 0) + t.profit);
        });

        const allDates = new Set([...systemDaily.keys(), ...ninjaDaily.keys()]);
        const diffs = [];

        allDates.forEach(date => {
            const systemVal = systemDaily.get(date) || 0;
            const ninjaVal = ninjaDaily.get(date) || 0;
            const diff = Math.abs(systemVal - ninjaVal);

            if (diff > 0.1) { // 10 cents tolerance
                diffs.push({
                    date,
                    systemPnL: systemVal,
                    ninjaPnL: ninjaVal,
                    diff: systemVal - ninjaVal
                });
            }
        });

        return diffs.sort((a, b) => {
            const [d1, m1, y1] = a.date.split('/');
            const [d2, m2, y2] = b.date.split('/');
            return new Date(`${y1}-${m1}-${d1}`).getTime() - new Date(`${y2}-${m2}-${d2}`).getTime();
        });
    }, [trades, ninjaTrades]);

    const analyzeWithAI = async () => {
        if (discrepancies.length === 0) return;
        setIsAnalyzing(true);
        try {
            const genAI = new GoogleGenerativeAI(import.meta.env.VITE_GEMINI_API_KEY);
            const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

            // 1. Gather relevant indicator source code
            // We'll read the indicators.js file content (already read in previous step)
            // But since I'm in the tool, I'll just hardcode some or better, use the known categories
            const indicatorsLogic = `
                Technical Indicators Source Code:
                calculateEMA: EMA = (Close - Previous EMA) * Multiplier + Previous EMA (Wilder's Smoothing where applicable)
                calculateRSI: Wilder's smoothing used. Initial avg gain/loss is SMA.
                calculateVolumeAverage: Simple Moving Average of volume over period.
                ... (Full logic provided in prompt)
            `;

            // 2. Gather micro-data for the first few discrepancies
            const dataToAnalyze = discrepancies.slice(0, 3).map(d => {
                const [day, month, year] = d.date.split('/');
                const daySystem = trades.filter(t => {
                    const date = new Date(t.entryTime * 1000);
                    return date.toLocaleDateString('en-GB', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'UTC' }) === d.date;
                });
                const dayNinja = ninjaTrades.filter(t => t.dateKey === d.date);

                // Get raw bars for this day to see the "why"
                // Since rawData is not directly accessible here easily without passing it,
                // we'll use the trades info which already has prices/times.
                // In a real scenario, we'd want to pass a slice of bars around the trade time.

                return {
                    date: d.date,
                    diff: d.diff,
                    systemTrades: daySystem.map(t => ({
                        id: t.id,
                        time: new Date(t.entryTime * 1000).toISOString(),
                        entry: t.entryPrice,
                        exit: t.exitPrice,
                        pnl: t.pnl,
                        bars: t.bars
                    })),
                    ninjaTrades: dayNinja.map(t => ({
                        time: t.entryTime,
                        entry: t.entryPrice,
                        exit: t.exitPrice,
                        pnl: t.profit,
                        bars: t.bars
                    }))
                };
            });

            const prompt = `
                You are a senior algorithmic trading developer and data scientist specializing in backtest reconciliation between custom systems and NinjaTrader 8.

                MISSION:
                Identify the EXACT logical or data reason for discrepancies between our System and NinjaTrader.

                STRATEGY CONFIGURATION:
                - Entry: ${JSON.stringify(strategyConfig.entryConditions)}
                - Exit: ${JSON.stringify(strategyConfig.exitConditions)}

                TECHNICAL LOGIC (Source Code Reference):
                - All indicators (SMA, EMA, RSI, Volume Avg) use standard formulas.
                - EMA and RSI use Wilder's smoothing (EMA: multiplier = 2/(n+1)).
                - Volume Average is a simple SMA of volume.
                - Bar Alignment: Bars are aggregated. For a 5m timeframe, a bar labeled 08:00 represents 08:00:00 to 08:04:59.

                DISCREPANCY DATA (Sample Days):
                ${JSON.stringify(dataToAnalyze)}

                ANALYSIS REQUIREMENTS:
                1. PATTERN RECOGNITION: Do discrepancies happen at specific times (e.g., session open)?
                2. CALCULATION HYPOTHESIS: Compare P&L and prices. Is it a missing trade or a price difference?
                3. SPECIFIC FINDINGS: For each day provided, give a technical reason.

                OUTPUT:
                Provide a professional, concise analysis in HEBREW.
                Focus on: "למה זה קורה" (Why) and "איך לתקן" (How to fix).
                Avoid generic answers like "check timezones". Be specific about the values shown.
            `;

            const result = await model.generateContent(prompt);
            setAiAnalysis(result.response.text());
        } catch (error) {
            console.error("AI Analysis failed", error);
            setAiAnalysis("שגיאה בניתוח הנתונים. וודא שה-API Key תקין ושיש חיבור אינטרנט.");
        } finally {
            setIsAnalyzing(false);
        }
    };

    const periodStr = useMemo(() => {
        if (trades.length === 0) return 'N/A';
        const start = new Date(trades[0].entryTime * 1000).toLocaleDateString('en-GB', { timeZone: 'UTC' });
        const end = new Date(trades[trades.length - 1].exitTime * 1000).toLocaleDateString('en-GB', { timeZone: 'UTC' });
        return `${start} - ${end}`;
    }, [trades]);

    const handleSort = (column) => {
        if (sortColumn === column) {
            // Cycle through: asc -> desc -> none (default)
            if (sortDirection === 'asc') {
                setSortDirection('desc');
            } else if (sortDirection === 'desc') {
                setSortDirection('none');
                setSortColumn('id');
            }
        } else {
            setSortColumn(column);
            setSortDirection('asc');
        }
    };

    // Calculate cumulative profit for each trade (based on original order)
    const tradesWithCumProfit = useMemo(() => {
        let cumProfit = 0;
        return trades.map(trade => {
            cumProfit += trade.pnl;
            return {
                ...trade,
                cumProfit: cumProfit
            };
        });
    }, [trades]);

    const sortedTrades = useMemo(() => {
        const sorted = [...tradesWithCumProfit];

        if (sortDirection === 'none') {
            return sorted.sort((a, b) => a.id - b.id);
        }

        return sorted.sort((a, b) => {
            let aVal, bVal;

            switch (sortColumn) {
                case 'id':
                    aVal = a.id;
                    bVal = b.id;
                    break;
                case 'date':
                    aVal = a.entryTime;
                    bVal = b.entryTime;
                    break;
                case 'pnl':
                    aVal = a.pnl;
                    bVal = b.pnl;
                    break;
                case 'cumProfit':
                    aVal = a.cumProfit;
                    bVal = b.cumProfit;
                    break;
                case 'mae':
                    aVal = a.mae || 0;
                    bVal = b.mae || 0;
                    break;
                case 'mfe':
                    aVal = a.mfe || 0;
                    bVal = b.mfe || 0;
                    break;
                case 'etd':
                    aVal = a.etd || 0;
                    bVal = b.etd || 0;
                    break;
                case 'bars':
                    aVal = a.bars || 0;
                    bVal = b.bars || 0;
                    break;
                default:
                    aVal = a.id;
                    bVal = b.id;
            }

            if (sortDirection === 'asc') {
                return aVal > bVal ? 1 : aVal < bVal ? -1 : 0;
            } else {
                return aVal < bVal ? 1 : aVal > bVal ? -1 : 0;
            }
        });
    }, [tradesWithCumProfit, sortColumn, sortDirection]);

    const getSortIcon = (column) => {
        if (sortColumn !== column) return null;
        if (sortDirection === 'asc') return <ArrowUp size={10} className="text-blue-400" />;
        if (sortDirection === 'desc') return <ArrowDown size={10} className="text-blue-400" />;
        return null;
    };

    // Group trades by period
    const groupedTrades = useMemo(() => {
        if (periodView === 'Trades') return null;

        const groups = new Map();

        trades.forEach(trade => {
            const entryDate = new Date(trade.entryTime * 1000);
            let key = '';
            let sortKey = '';

            switch (periodView) {
                case 'Daily':
                    key = entryDate.toLocaleDateString('en-GB', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'UTC' });
                    sortKey = entryDate.toISOString().split('T')[0];
                    break;
                case 'Weekly':
                    // Get week start (Monday = 0)
                    const weekStart = new Date(entryDate);
                    const day = entryDate.getUTCDay();
                    const diff = entryDate.getUTCDate() - day + (day === 0 ? -6 : 1); // Adjust to Monday
                    weekStart.setUTCDate(diff);
                    weekStart.setUTCHours(0, 0, 0, 0);
                    key = `Week ${weekStart.toLocaleDateString('en-GB', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'UTC' })}`;
                    sortKey = weekStart.toISOString().split('T')[0];
                    break;
                case 'Monthly':
                    const monthYear = entryDate.toLocaleDateString('en-GB', { year: 'numeric', month: '2-digit', timeZone: 'UTC' });
                    key = monthYear;
                    sortKey = `${entryDate.getUTCFullYear()}-${String(entryDate.getUTCMonth() + 1).padStart(2, '0')}`;
                    break;
                case 'Yearly':
                    key = entryDate.getUTCFullYear().toString();
                    sortKey = key;
                    break;
                case 'Half-hour of day':
                    const hours = entryDate.getUTCHours();
                    const minutes = entryDate.getUTCMinutes();
                    const halfHourSlot = Math.floor(minutes / 30);
                    const timeStr = `${String(hours).padStart(2, '0')}:${halfHourSlot === 0 ? '00' : '30'}`;
                    key = timeStr;
                    sortKey = `${String(hours).padStart(2, '0')}:${String(halfHourSlot * 30).padStart(2, '0')}`;
                    break;
                case 'Hour of day':
                    const hour = entryDate.getUTCHours();
                    key = `${String(hour).padStart(2, '0')}:00`;
                    sortKey = `${String(hour).padStart(2, '0')}:00`;
                    break;
                case 'Day of week':
                    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
                    key = days[entryDate.getUTCDay()];
                    sortKey = String(entryDate.getUTCDay()).padStart(2, '0');
                    break;
                default:
                    key = 'Unknown';
                    sortKey = '999';
            }

            if (!groups.has(key)) {
                groups.set(key, {
                    period: key,
                    sortKey: sortKey,
                    trades: [],
                    totalPnL: 0,
                    grossProfit: 0,
                    grossLoss: 0,
                    winningTrades: 0,
                    totalTrades: 0,
                    avgPnL: 0,
                    winRate: 0
                });
            }

            const group = groups.get(key);
            group.trades.push(trade);
            group.totalPnL += trade.pnl;
            group.totalTrades += 1;

            if (trade.pnl > 0) {
                group.grossProfit += trade.pnl;
                group.winningTrades += 1;
            } else {
                group.grossLoss += Math.abs(trade.pnl);
            }
        });

        // Calculate averages
        Array.from(groups.values()).forEach(group => {
            group.avgPnL = group.totalTrades > 0 ? group.totalPnL / group.totalTrades : 0;
            group.winRate = group.totalTrades > 0 ? (group.winningTrades / group.totalTrades) * 100 : 0;
        });

        return Array.from(groups.values()).sort((a, b) => {
            // Sort by sortKey for proper chronological order
            return a.sortKey.localeCompare(b.sortKey);
        });
    }, [trades, periodView]);

    const handleExport = () => {
        let cumProfit = 0;
        const csvContent = [
            ["ID", "Type", "Entry", "Entry Price", "Exit", "Exit Price", "Reason", "P&L ($)", "Cum. Net Profit ($)", "MAE ($)", "MFE ($)", "ETD ($)", "Bars"],
            ...trades.map(t => {
                cumProfit += t.pnl;
                return [
                    t.id,
                    "LONG",
                    new Date(t.entryTime * 1000).toLocaleString('en-GB', {day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit', timeZone: 'UTC'}),
                    t.entryPrice.toFixed(2),
                    new Date(t.exitTime * 1000).toLocaleString('en-GB', {day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit', timeZone: 'UTC'}),
                    t.exitPrice.toFixed(2),
                    t.exitReason || 'Condition',
                    t.pnl.toFixed(2),
                    cumProfit.toFixed(2),
                    (t.mae || 0).toFixed(2),
                    (t.mfe || 0).toFixed(2),
                    (t.etd || 0).toFixed(2),
                    (t.bars || 0)
                ];
            })
        ].map(e => e.join(",")).join("\n");

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        const url = URL.createObjectURL(blob);
        link.setAttribute("href", url);
        link.setAttribute("download", "trades_export.csv");
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const KPI = ({ label, value, colorClass = "text-zinc-200", icon: Icon }) => (
        <div className="bg-zinc-900/80 border border-zinc-800 p-3 rounded-lg flex flex-col justify-center transition-all hover:border-zinc-700">
            <div className="flex items-center gap-1.5 mb-1.5">
                <Icon size={12} className="text-zinc-500" />
                <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-wider">{label}</span>
            </div>
            <div className={`text-sm font-mono font-bold ${colorClass}`}>
                {value}
            </div>
        </div>
    );

    return (
        <div className="absolute inset-0 z-50 bg-black/95 backdrop-blur-md flex flex-col overflow-hidden animate-in fade-in duration-200">
            {/* Header */}
            <div className="h-14 border-b border-zinc-800 flex items-center justify-between px-6 bg-zinc-950 select-none">
                <div className="flex items-center gap-3">
                    <Activity className="text-blue-500" size={18} />
                    <h2 className="text-xs font-bold tracking-widest text-zinc-100">PERFORMANCE REPORT</h2>
                </div>
                <div className="flex items-center gap-2">
                    <button onClick={onClose} className="p-1.5 hover:bg-zinc-800 rounded-full text-zinc-400 hover:text-white transition-all">
                        <X size={18} />
                    </button>
                </div>
            </div>

            {/* Tab Switcher */}
            <div className="flex border-b border-zinc-800 bg-zinc-950/50 px-6">
                {[
                    { id: 'PERFORMANCE', label: '\u05D1\u05D9\u05E6\u05D5\u05E2\u05D9\u05DD' },
                    { id: 'NINJA', label: '\u05D4\u05E9\u05D5\u05D5\u05D0\u05EA NinjaTrader' }
                ].map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setReportTab(tab.id)}
                        className={`py-3 px-4 text-[10px] font-bold tracking-wider transition-colors relative ${reportTab === tab.id ? 'text-blue-400' : 'text-zinc-500 hover:text-zinc-300'}`}
                    >
                        {tab.label}
                        {reportTab === tab.id && (
                            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]"></div>
                        )}
                    </button>
                ))}
            </div>

            {reportTab === 'PERFORMANCE' && (
                <div className="flex-1 overflow-y-auto p-6">
                    <div className="max-w-6xl mx-auto space-y-6">

                        {/* KPI Bar */}
                        <div className="grid grid-cols-6 gap-4">
                            <KPI
                                label="Net Profit"
                                icon={DollarSign}
                                value={`$${stats.totalPnL.toLocaleString(undefined, {minimumFractionDigits: 2})}`}
                                colorClass={stats.totalPnL >= 0 ? 'text-green-500' : 'text-red-500'}
                            />
                            <KPI
                                label="Profit Factor"
                                icon={TrendingUp}
                                value={stats.profitFactor.toFixed(2)}
                                colorClass="text-blue-400"
                            />
                            <KPI
                                label="Win Rate"
                                icon={Activity}
                                value={`${stats.winRate.toFixed(1)}%`}
                                colorClass={stats.winRate > 50 ? 'text-green-500' : 'text-zinc-300'}
                            />
                            <KPI
                                label="Trades"
                                icon={Hash}
                                value={stats.totalTrades}
                            />
                            <KPI
                                label="Max Drawdown"
                                icon={ArrowDownRight}
                                value={`-$${stats.maxDrawdown.toLocaleString(undefined, {minimumFractionDigits: 2})}`}
                                colorClass="text-red-500"
                            />
                            <KPI
                                label="Period"
                                icon={CalendarRange}
                                value={periodStr}
                                colorClass="text-zinc-400 text-[10px] truncate"
                            />
                        </div>

                        {/* Period Selector */}
                        <div className="flex items-center gap-4 py-2">
                            <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Period</label>
                            <select
                                value={periodView}
                                onChange={(e) => setPeriodView(e.target.value)}
                                className="bg-zinc-900 border border-zinc-700 text-white text-xs px-4 py-2 rounded focus:border-blue-500 outline-none font-medium"
                            >
                                <option value="Trades">Trades</option>
                                <option value="Daily">Daily</option>
                                <option value="Weekly">Weekly</option>
                                <option value="Monthly">Monthly</option>
                                <option value="Yearly">Yearly</option>
                                <option value="Half-hour of day">Half-hour of day</option>
                                <option value="Hour of day">Hour of day</option>
                                <option value="Day of week">Day of week</option>
                            </select>
                        </div>

                        {/* Period Summary Table */}
                        {periodView !== 'Trades' && groupedTrades && (
                            <div className="border border-zinc-800 rounded-lg overflow-hidden bg-zinc-900/50">
                                <div className="px-6 py-3 border-b border-zinc-800 flex items-center gap-3 bg-zinc-900/80">
                                    <BarChart3 size={14} className="text-zinc-500" />
                                    <h3 className="text-[10px] font-bold text-zinc-300 uppercase tracking-wider">Period Summary</h3>
                                </div>
                                <div className="overflow-x-auto max-h-[40vh]">
                                    <table className="w-full text-left text-xs font-mono">
                                        <thead className="bg-zinc-900 text-zinc-500 sticky top-0 z-10">
                                            <tr>
                                                <th className="px-6 py-3 font-medium text-[10px] uppercase tracking-wider">Period</th>
                                                <th className="px-6 py-3 font-medium text-right text-[10px] uppercase tracking-wider">Trades</th>
                                                <th className="px-6 py-3 font-medium text-right text-[10px] uppercase tracking-wider">Win Rate</th>
                                                <th className="px-6 py-3 font-medium text-right text-[10px] uppercase tracking-wider">Gross Profit</th>
                                                <th className="px-6 py-3 font-medium text-right text-[10px] uppercase tracking-wider">Gross Loss</th>
                                                <th className="px-6 py-3 font-medium text-right text-[10px] uppercase tracking-wider">Net P&L</th>
                                                <th className="px-6 py-3 font-medium text-right text-[10px] uppercase tracking-wider">Avg P&L</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-zinc-800/50">
                                            {groupedTrades.map((group, idx) => (
                                                <tr key={idx} className="hover:bg-zinc-800/60 transition-colors">
                                                    <td className="px-6 py-3 text-zinc-300">{group.period}</td>
                                                    <td className="px-6 py-3 text-right text-zinc-400">{group.totalTrades}</td>
                                                    <td className={`px-6 py-3 text-right font-medium ${group.winRate >= 50 ? 'text-green-500' : 'text-zinc-400'}`}>
                                                        {group.winRate.toFixed(1)}%
                                                    </td>
                                                    <td className="px-6 py-3 text-right text-green-500">
                                                        ${group.grossProfit.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                                                    </td>
                                                    <td className="px-6 py-3 text-right text-red-500">
                                                        ${group.grossLoss.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                                                    </td>
                                                    <td className={`px-6 py-3 text-right font-bold ${group.totalPnL >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                                                        {group.totalPnL >= 0 ? '+' : ''}${group.totalPnL.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                                                    </td>
                                                    <td className={`px-6 py-3 text-right ${group.avgPnL >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                                                        {group.avgPnL >= 0 ? '+' : ''}${group.avgPnL.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}

                        {/* Trade List */}
                        <div className="border border-zinc-800 rounded-lg overflow-hidden bg-zinc-900/50">
                            <div className="px-6 py-3 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/80">
                                <div className="flex items-center gap-3">
                                    <Table size={14} className="text-zinc-500" />
                                    <h3 className="text-[10px] font-bold text-zinc-300 uppercase tracking-wider">
                                        {periodView === 'Trades' ? 'Trade Log' : 'All Trades'}
                                    </h3>
                                </div>
                                <button
                                    onClick={handleExport}
                                    className="flex items-center gap-2 px-3 py-1.5 rounded hover:bg-zinc-800 text-zinc-500 hover:text-white text-[9px] font-medium border border-transparent hover:border-zinc-700 transition-all"
                                >
                                    <Download size={12} />
                                    EXPORT CSV
                                </button>
                            </div>
                            <div className="overflow-x-auto max-h-[60vh] custom-scrollbar">
                                <table className="w-full text-left text-xs font-mono border-separate border-spacing-0">
                                    <thead className="bg-zinc-900 text-zinc-500 sticky top-0 z-10">
                                        <tr>
                                            <th className="pl-6 pr-2 py-3 font-medium cursor-pointer hover:text-blue-400 select-none flex items-center gap-1 text-[10px] uppercase tracking-wider"
                                                onClick={() => handleSort('id')}
                                            >
                                                # {getSortIcon('id')}
                                            </th>
                                            <th className="px-2 py-3 font-medium text-[10px] uppercase tracking-wider w-10">Type</th>
                                            <th className="px-2 py-3 font-medium cursor-pointer hover:text-blue-400 select-none text-[10px] uppercase tracking-wider"
                                                onClick={() => handleSort('date')}
                                            >
                                                Entry {getSortIcon('date')}
                                            </th>
                                            <th className="px-2 py-3 font-medium text-[10px] uppercase tracking-wider text-right">Entry Price</th>
                                            <th className="px-2 py-3 font-medium text-[10px] uppercase tracking-wider">Exit</th>
                                            <th className="px-2 py-3 font-medium text-[10px] uppercase tracking-wider text-right">Exit Price</th>
                                            <th className="px-2 py-3 font-medium text-[10px] uppercase tracking-wider min-w-[110px]">Exit Reason</th>
                                            <th className="px-2 py-3 font-medium cursor-pointer hover:text-blue-400 select-none text-right text-[10px] uppercase tracking-wider"
                                                onClick={() => handleSort('pnl')}
                                            >
                                                P&L ($) {getSortIcon('pnl')}
                                            </th>
                                            <th className="px-2 py-3 font-medium cursor-pointer hover:text-blue-400 select-none text-right text-[10px] uppercase tracking-wider"
                                                onClick={() => handleSort('cumProfit')}
                                            >
                                                Cum. Net ($) {getSortIcon('cumProfit')}
                                            </th>
                                            <th className="px-2 py-3 font-medium cursor-pointer hover:text-blue-400 select-none text-right text-[10px] uppercase tracking-wider"
                                                onClick={() => handleSort('mae')}
                                            >
                                                MAE ($) {getSortIcon('mae')}
                                            </th>
                                            <th className="px-2 py-3 font-medium cursor-pointer hover:text-blue-400 select-none text-right text-[10px] uppercase tracking-wider"
                                                onClick={() => handleSort('mfe')}
                                            >
                                                MFE ($) {getSortIcon('mfe')}
                                            </th>
                                            <th className="px-2 py-3 font-medium cursor-pointer hover:text-blue-400 select-none text-right text-[10px] uppercase tracking-wider"
                                                onClick={() => handleSort('etd')}
                                            >
                                                ETD ($) {getSortIcon('etd')}
                                            </th>
                                            <th className="pl-2 pr-6 py-3 font-medium cursor-pointer hover:text-blue-400 select-none text-right text-[10px] uppercase tracking-wider"
                                                onClick={() => handleSort('bars')}
                                            >
                                                Bars {getSortIcon('bars')}
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-zinc-800/50">
                                        {sortedTrades.map((trade) => {
                                            const entryDate = new Date(trade.entryTime * 1000);
                                            const exitDate = new Date(trade.exitTime * 1000);
                                            const isWin = trade.pnl > 0;

                                            return (
                                                <tr key={trade.id} onClick={() => onTradeClick(trade)} className="hover:bg-zinc-800/60 transition-colors cursor-pointer group">
                                                    <td className="pl-6 pr-2 py-2.5 text-zinc-500 group-hover:text-blue-400 transition-colors">{trade.id}</td>
                                                    <td className="px-2 py-2.5 text-center"><span className="text-[9px] text-blue-400 font-bold">L</span></td>
                                                    <td className="px-2 py-2.5 text-zinc-500 leading-tight">
                                                        <div className="flex flex-col">
                                                            <span className="text-zinc-400 font-medium text-[10px]">{entryDate.toLocaleDateString('en-GB', {day:'2-digit', month:'2-digit', year:'numeric', timeZone: 'UTC'})}</span>
                                                            <span className="text-[11px] text-zinc-600 font-mono">{entryDate.toLocaleTimeString('en-GB', {hour:'2-digit', minute:'2-digit', timeZone: 'UTC'})}</span>
                                                        </div>
                                                    </td>
                                                    <td className="px-2 py-2.5 text-zinc-300 font-mono text-right">{trade.entryPrice.toFixed(2)}</td>
                                                    <td className="px-2 py-2.5 text-zinc-500 leading-tight">
                                                        <div className="flex flex-col">
                                                            <span className="text-zinc-400 font-medium text-[10px]">{exitDate.toLocaleDateString('en-GB', {day:'2-digit', month:'2-digit', year:'numeric', timeZone: 'UTC'})}</span>
                                                            <span className="text-[11px] text-zinc-600 font-mono">{exitDate.toLocaleTimeString('en-GB', {hour:'2-digit', minute:'2-digit', timeZone: 'UTC'})}</span>
                                                        </div>
                                                    </td>
                                                    <td className="px-2 py-2.5 text-zinc-300 font-mono text-right">{trade.exitPrice.toFixed(2)}</td>
                                                    <td className="px-2 py-2.5 min-w-[110px]">
                                                        <span className={`text-[9px] px-2 py-0.5 rounded-md border whitespace-nowrap inline-block font-medium ${
                                                            trade.exitReason === 'Stop Loss' ? 'bg-red-500/10 text-red-400 border-red-500/20' :
                                                            trade.exitReason === 'Take Profit' ? 'bg-green-500/10 text-green-400 border-green-500/20' :
                                                            trade.exitReason === 'Trailing Stop' ? 'bg-orange-500/10 text-orange-400 border-orange-500/20' :
                                                            'bg-zinc-800 text-zinc-400 border border-zinc-700'
                                                        }`}>
                                                            {trade.exitReason || 'Condition'}
                                                        </span>
                                                    </td>
                                                    <td className={`px-2 py-2.5 text-right font-bold ${isWin ? 'text-green-500' : 'text-red-500'}`}>
                                                        {isWin ? '+' : ''}{trade.pnl.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                                                    </td>
                                                    <td className={`px-2 py-2.5 text-right font-bold ${trade.cumProfit >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                                                        {trade.cumProfit >= 0 ? '+' : ''}{trade.cumProfit.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                                                    </td>
                                                    <td className="px-2 py-2.5 text-right text-red-500">
                                                        ${(trade.mae || 0).toFixed(2)}
                                                    </td>
                                                    <td className="px-2 py-2.5 text-right text-green-500">
                                                        ${(trade.mfe || 0).toFixed(2)}
                                                    </td>
                                                    <td className="px-2 py-2.5 text-right text-red-500">
                                                        ${(trade.etd || 0).toFixed(2)}
                                                    </td>
                                                    <td className="pl-2 pr-6 py-2.5 text-right text-zinc-400">
                                                        {trade.bars || 0}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {reportTab === 'NINJA' && (
                <div className="flex-1 overflow-y-auto p-6 dir-rtl">
                    <div className="max-w-6xl mx-auto space-y-4">
                        {/* Minimalist Upload Area */}
                        <div className="bg-zinc-900/40 border border-zinc-800/60 rounded-lg p-3 flex items-center justify-between transition-all">
                            <div className="flex items-center gap-3">
                                <div className="w-8 h-8 bg-blue-500/10 rounded-lg flex items-center justify-center text-blue-400 border border-blue-500/20">
                                    <Upload size={14} />
                                </div>
                                <div className="text-right">
                                    <h3 className="text-[11px] font-bold text-zinc-200">{'\u05D4\u05E9\u05D5\u05D5\u05D0\u05EA NinjaTrader'}</h3>
                                    <p className="text-[9px] text-zinc-500 uppercase tracking-tight">Upload CSV to compare trades</p>
                                </div>
                            </div>

                                <div className="flex items-center gap-3">
                                    {ninjaTrades.length > 0 && (
                                        <div className="flex items-center gap-1.5 text-green-400 text-[10px] font-medium bg-green-400/5 px-2 py-0.5 rounded border border-green-400/10">
                                            <FileCheck size={10} />
                                            <span>{ninjaTrades.length} {'\u05E2\u05E1\u05E7\u05D0\u05D5\u05EA'}</span>
                                        </div>
                                    )}
                                    {discrepancies.length > 0 && (
                                        <button
                                            onClick={analyzeWithAI}
                                            disabled={isAnalyzing}
                                            className={`flex items-center gap-2 px-3 py-1 rounded text-[10px] font-bold transition-all ${isAnalyzing ? 'bg-zinc-800 text-zinc-500' : 'bg-blue-500/10 text-blue-400 border border-blue-500/20 hover:bg-blue-500/20'}`}
                                        >
                                            <Sparkles size={12} />
                                            {isAnalyzing ? '\u05DE\u05E0\u05EA\u05D7...' : '\u05E0\u05D9\u05EA\u05D5\u05D7 \u05D7\u05E8\u05D9\u05D2\u05D5\u05EA AI'}
                                        </button>
                                    )}
                                    <div className="relative">
                                    <input
                                        type="file"
                                        accept=".csv"
                                        onChange={(e) => {
                                            const file = e.target.files[0];
                                            if (!file) return;
                                            setIsUploadingNinja(true);
                                            const reader = new FileReader();
                                            reader.onload = (event) => {
                                                try {
                                                    const parsed = parseNinjaCSV(event.target.result);
                                                    setNinjaTrades(parsed);
                                                } catch (err) {
                                                    console.error("Failed to parse Ninja CSV", err);
                                                } finally {
                                                    setIsUploadingNinja(false);
                                                }
                                            };
                                            reader.readAsText(file);
                                        }}
                                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                                    />
                                    <button className="px-3 py-1 bg-zinc-100 hover:bg-white text-black text-[10px] font-bold rounded transition-all">
                                        {isUploadingNinja ? '\u05DE\u05E2\u05D1\u05D3...' : '\u05D1\u05D7\u05E8 \u05E7\u05D5\u05D1\u05E5'}
                                    </button>
                                </div>
                            </div>
                        </div>

                        {aiAnalysis && (
                            <div className="bg-blue-500/[0.03] border border-blue-500/10 rounded-lg p-4 space-y-3 animate-in fade-in slide-in-from-top-2 duration-300">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <Sparkles size={14} className="text-blue-400" />
                                        <h4 className="text-[11px] font-bold text-blue-400 uppercase tracking-wider">{'\u05E0\u05D9\u05EA\u05D5\u05D7 AI \u05D7\u05DB\u05DD'}</h4>
                                    </div>
                                    <button onClick={() => setAiAnalysis('')} className="text-zinc-600 hover:text-zinc-400 transition-colors">
                                        <X size={12} />
                                    </button>
                                </div>
                                <div className="text-[11px] text-zinc-300 leading-relaxed whitespace-pre-wrap font-sans">
                                    {aiAnalysis}
                                </div>
                            </div>
                        )}

                        {ninjaTrades.length > 0 && (
                            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                                {discrepancies.length === 0 ? (
                                    <div className="bg-green-500/5 border border-green-500/10 rounded-lg p-10 text-center space-y-2">
                                        <div className="w-10 h-10 bg-green-500/10 rounded-full flex items-center justify-center text-green-500 mx-auto">
                                            <FileCheck size={20} />
                                        </div>
                                        <p className="text-sm font-medium text-green-400">{'\u05D4\u05EA\u05D0\u05DE\u05D4 \u05DE\u05DC\u05D0\u05D4!'}</p>
                                        <p className="text-[11px] text-zinc-500">{'\u05DC\u05D0 \u05E0\u05DE\u05E6\u05D0\u05D5 \u05D7\u05E8\u05D9\u05D2\u05D5\u05EA \u05D1\u05D9\u05DF \u05D4\u05DE\u05E2\u05E8\u05DB\u05D5\u05EA.'}</p>
                                    </div>
                                ) : (
                                    discrepancies.map((dayDiff, idx) => {
                                        const daySystemTrades = trades.filter(t => {
                                            const date = new Date(t.entryTime * 1000);
                                            return date.toLocaleDateString('en-GB', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'UTC' }) === dayDiff.date;
                                        });
                                        const dayNinjaTrades = ninjaTrades.filter(t => t.dateKey === dayDiff.date);

                                        // Interleave trades for comparison
                                        const maxTrades = Math.max(daySystemTrades.length, dayNinjaTrades.length);
                                        const comparisonRows = [];
                                        for (let i = 0; i < maxTrades; i++) {
                                            comparisonRows.push({
                                                system: daySystemTrades[i] || null,
                                                ninja: dayNinjaTrades[i] || null
                                            });
                                        }

                                        return (
                                            <div key={idx} className="border border-zinc-800/60 rounded-lg overflow-hidden bg-zinc-950/40">
                                                {/* Day Header */}
                                                <div className="px-4 py-2 bg-zinc-900/40 border-b border-zinc-800/60 flex items-center justify-between">
                                                    <div className="flex items-center gap-3">
                                                        <span className="text-[11px] font-bold text-zinc-200 font-mono">{dayDiff.date}</span>
                                                        <div className="h-4 w-[1px] bg-zinc-800"></div>
                                                        <span className="text-[10px] text-zinc-500 font-medium">{'\u05D4\u05E4\u05E8\u05E9 \u05D9\u05D5\u05DE\u05D9: '}</span>
                                                        <span className="text-[11px] font-mono font-bold text-red-400">
                                                            ${Math.abs(dayDiff.diff).toLocaleString(undefined, {minimumFractionDigits: 2})}
                                                        </span>
                                                    </div>
                                                </div>

                                                <div className="overflow-x-auto">
                                                    <table className="w-full text-right text-[10px] font-mono border-separate border-spacing-0">
                                                        <thead className="bg-zinc-900/50 text-zinc-500 border-b border-zinc-800/40">
                                                            <tr>
                                                                <th className="px-4 py-2 font-bold uppercase text-right w-16">{'\u05DE\u05E7\u05D5\u05E8'}</th>
                                                                <th className="px-2 py-2 font-bold uppercase text-right w-10">{'\u05E1\u05D5\u05D2'}</th>
                                                                <th className="px-2 py-2 font-bold uppercase text-right">{'\u05DB\u05E0\u05D9\u05E1\u05D4'}</th>
                                                                <th className="px-2 py-2 font-bold uppercase text-right">{'\u05DE\u05D7\u05D9\u05E8'}</th>
                                                                <th className="px-2 py-2 font-bold uppercase text-right">{'\u05D9\u05E6\u05D9\u05D0\u05D4'}</th>
                                                                <th className="px-2 py-2 font-bold uppercase text-right">{'\u05DE\u05D7\u05D9\u05E8'}</th>
                                                                <th className="px-2 py-2 font-bold uppercase text-right">P&L ($)</th>
                                                                <th className="px-2 py-2 font-bold uppercase text-right">MAE ($)</th>
                                                                <th className="px-2 py-2 font-bold uppercase text-right">MFE ($)</th>
                                                                <th className="px-2 py-2 font-bold uppercase text-right">ETD ($)</th>
                                                                <th className="px-4 py-2 font-bold uppercase text-right">Bars</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody className="divide-y divide-zinc-800/20">
                                                            {comparisonRows.map((pair, pIdx) => (
                                                                <React.Fragment key={pIdx}>
                                                                    {/* System Row */}
                                                                    {pair.system && (
                                                                        <tr className="hover:bg-blue-500/[0.03] transition-colors">
                                                                            <td className="px-4 py-2 text-blue-400/80 font-bold">SYSTEM</td>
                                                                            <td className="px-2 py-2"><span className="text-[9px] text-blue-400 font-bold">L</span></td>
                                                                            <td className="px-2 py-2 text-zinc-400">
                                                                                {new Date(pair.system.entryTime * 1000).toLocaleTimeString('en-GB', {hour:'2-digit', minute:'2-digit', timeZone: 'UTC'})}
                                                                            </td>
                                                                            <td className="px-2 py-2 text-zinc-300">{pair.system.entryPrice.toFixed(2)}</td>
                                                                            <td className="px-2 py-2 text-zinc-400">
                                                                                {new Date(pair.system.exitTime * 1000).toLocaleTimeString('en-GB', {hour:'2-digit', minute:'2-digit', timeZone: 'UTC'})}
                                                                            </td>
                                                                            <td className="px-2 py-2 text-zinc-300">{pair.system.exitPrice.toFixed(2)}</td>
                                                                            <td className={`px-2 py-2 font-bold ${pair.system.pnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                                                                                {pair.system.pnl.toFixed(2)}
                                                                            </td>
                                                                            <td className="px-2 py-2 text-red-500/70">{pair.system.mae?.toFixed(2) || '0.00'}</td>
                                                                            <td className="px-2 py-2 text-green-500/70">{pair.system.mfe?.toFixed(2) || '0.00'}</td>
                                                                            <td className="px-2 py-2 text-red-500/70">{pair.system.etd?.toFixed(2) || '0.00'}</td>
                                                                            <td className="px-4 py-2 text-zinc-500">{pair.system.bars || 0}</td>
                                                                        </tr>
                                                                    )}
                                                                    {/* Ninja Row */}
                                                                    {pair.ninja && (
                                                                        <tr className="bg-orange-500/[0.02] hover:bg-orange-500/[0.04] transition-colors">
                                                                            <td className="px-4 py-2 text-orange-400/80 font-bold">NINJA</td>
                                                                            <td className="px-2 py-2"><span className="text-[9px] text-orange-400 font-bold">{pair.ninja.side === 'Long' ? 'L' : 'S'}</span></td>
                                                                            <td className="px-2 py-2 text-zinc-500">
                                                                                {pair.ninja.entryTime.split(' ').slice(1, 2).join('')}
                                                                            </td>
                                                                            <td className="px-2 py-2 text-zinc-400">{pair.ninja.entryPrice.toFixed(2)}</td>
                                                                            <td className="px-2 py-2 text-zinc-500">
                                                                                {pair.ninja.exitTime.split(' ').slice(1, 2).join('')}
                                                                            </td>
                                                                            <td className="px-2 py-2 text-zinc-400">{pair.ninja.exitPrice.toFixed(2)}</td>
                                                                            <td className={`px-2 py-2 font-bold ${pair.ninja.profit >= 0 ? 'text-green-500/80' : 'text-red-500/80'}`}>
                                                                                {pair.ninja.profit.toFixed(2)}
                                                                            </td>
                                                                            <td className="px-2 py-2 text-red-500/50">{pair.ninja.mae.toFixed(2)}</td>
                                                                            <td className="px-2 py-2 text-green-500/50">{pair.ninja.mfe.toFixed(2)}</td>
                                                                            <td className="px-2 py-2 text-red-500/50">{pair.ninja.etd.toFixed(2)}</td>
                                                                            <td className="px-4 py-2 text-zinc-600">{pair.ninja.bars}</td>
                                                                        </tr>
                                                                    )}
                                                                    {/* Spacer between pairs */}
                                                                    <tr className="h-1 bg-zinc-900/20"><td colSpan="11"></td></tr>
                                                                </React.Fragment>
                                                            ))}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            </div>
                                        );
                                    })
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default DetailedReport;
