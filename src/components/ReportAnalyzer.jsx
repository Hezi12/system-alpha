import React, { useState, useMemo, useRef, useCallback } from 'react';
import { Upload, FileText, ChevronLeft, BarChart2, TrendingUp, ArrowUp, ArrowDown, Activity, Download, Search, Filter, X, Table, Plus, PieChart, Layers, Trash2, Layout, Check, ChevronDown, Calendar } from 'lucide-react';

const COLORS = {
  bg: '#000000',
  card: '#09090b',
  border: '#18181b',
  textMain: '#fafafa',
  textMuted: '#71717a',
  blue: '#3b82f6',
  green: '#22c55e',
  red: '#ef4444',
  amber: '#f59e0b',
  chart: ['#3b82f6', '#64748b', '#0ea5e9', '#f59e0b', '#10b981', '#6366f1']
};

const PortfolioAnalyzer = ({ onBack }) => {
  const [strategies, setStrategies] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('PORTFOLIO'); // 'PORTFOLIO' or 'INDIVIDUAL'
  const [activeChart, setActiveChart] = useState('EQUITY'); // 'EQUITY' or 'DRAWDOWN'
  const [isCalendarOpen, setIsCalendarOpen] = useState(true);

  const parseCurrency = (val) => {
    if (typeof val === 'number') return val;
    if (!val) return 0;
    let str = String(val).replace(/[$,]/g, '');
    if (str.includes('(') && str.includes(')')) {
      str = '-' + str.replace(/[()]/g, '');
    }
    return parseFloat(str) || 0;
  };

  const parseDate = (dateStr) => {
    if (!dateStr) return 0;
    const date = new Date(dateStr);
    return date.getTime();
  };

  const handleFileUpload = async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    setLoading(true);
    
    const newStrategies = [];

    for (const file of files) {
      const text = await file.text();
      const lines = text.split(/\r?\n/).filter(l => l.trim());
      if (lines.length < 2) continue;

      const sep = lines[0].includes('\t') ? '\t' : ',';
      const headers = lines[0].split(sep).map(h => h.trim().replace(/^"|"$/g, ''));
      
      const findCol = (hNames) => {
        for (const name of hNames) {
          const idx = headers.findIndex(h => h.toLowerCase() === name.toLowerCase());
          if (idx !== -1) return idx;
        }
        return -1;
      };

      const idx = {
        profit: findCol(['Profit']),
        entryTime: findCol(['Entry time', 'EntryTime']),
        exitTime: findCol(['Exit time', 'ExitTime']),
        marketPos: findCol(['Market pos.', 'MarketPos', 'Market pos']),
        strategy: findCol(['Strategy']),
        tradeNum: findCol(['Trade number', 'TradeNumber']),
        entryPrice: findCol(['Entry price', 'EntryPrice']),
        exitPrice: findCol(['Exit price', 'ExitPrice']),
      };

      const trades = [];
      for (let i = 1; i < lines.length; i++) {
        const vals = lines[i].split(sep).map(v => v.trim().replace(/^"|"$/g, ''));
        if (vals.length < headers.length) continue;

        const profit = parseCurrency(vals[idx.profit]);
        const entryTime = parseDate(vals[idx.entryTime]);
        const exitTime = parseDate(vals[idx.exitTime]);

        trades.push({
          tradeNum: vals[idx.tradeNum],
          strategy: vals[idx.strategy] || file.name.replace('.csv', ''),
          marketPos: vals[idx.marketPos],
          entryTime,
          exitTime,
          entryPrice: vals[idx.entryPrice],
          exitPrice: vals[idx.exitPrice],
          profit
        });
      }

      trades.sort((a, b) => a.exitTime - b.exitTime);

      newStrategies.push({
        id: Math.random().toString(36).substr(2, 9),
        name: trades[0]?.strategy || file.name.replace('.csv', ''),
        fileName: file.name,
        trades,
        active: true,
        multiplier: 1
      });
    }

    setStrategies(prev => [...prev, ...newStrategies]);
    setLoading(false);
  };

  const toggleStrategy = (id) => {
    setStrategies(prev => prev.map(s => 
      s.id === id ? { ...s, active: !s.active } : s
    ));
  };

  const updateMultiplier = (id, val) => {
    const num = parseFloat(val) || 0;
    setStrategies(prev => prev.map(s => 
      s.id === id ? { ...s, multiplier: Math.max(0, num) } : s
    ));
  };

  const individualStats = useMemo(() => {
    return strategies.map(s => {
      let cumProfit = 0;
      let grossProfit = 0;
      let grossLoss = 0;
      let peak = 0;
      let maxDD = 0;
      let wins = 0;
      let lastPeakTime = s.trades[0]?.exitTime || 0;
      let maxRecoveryTime = 0;
      
      const curve = [];
      const drawdownCurve = [];
      
      s.trades.forEach(t => {
        const p = t.profit * s.multiplier;
        cumProfit += p;
        if (p > 0) {
          wins++;
          grossProfit += p;
        } else {
          grossLoss += Math.abs(p);
        }
        
        if (cumProfit >= peak) {
          const recoveryTime = t.exitTime - lastPeakTime;
          if (recoveryTime > maxRecoveryTime) maxRecoveryTime = recoveryTime;
          peak = cumProfit;
          lastPeakTime = t.exitTime;
        }

        const dd = peak - cumProfit;
        if (dd > maxDD) maxDD = dd;
        
        curve.push({ time: t.exitTime, value: cumProfit });
        drawdownCurve.push({ time: t.exitTime, value: -dd });
      });

      const firstTime = s.trades[0]?.entryTime || s.trades[0]?.exitTime || 0;
      const lastTime = s.trades[s.trades.length - 1]?.exitTime || 0;
      const totalDays = Math.max(1, (lastTime - firstTime) / (1000 * 60 * 60 * 24));
      const monthlyAvg = (cumProfit / totalDays) * 30.44;

      return {
        ...s,
        stats: {
          netProfit: cumProfit,
          trades: s.trades.length,
          winRate: s.trades.length > 0 ? (wins / s.trades.length * 100) : 0,
          profitFactor: grossLoss > 0 ? (grossProfit / grossLoss) : (grossProfit > 0 ? 100 : 0),
          maxDD,
          monthlyAvg,
          maxRecoveryTime: maxRecoveryTime / (1000 * 60 * 60 * 24)
        },
        equityCurve: curve,
        drawdownCurve
      };
    });
  }, [strategies]);

  const portfolioStats = useMemo(() => {
    if (strategies.length === 0) return null;

    const activeStrats = individualStats.filter(s => s.active);
    if (activeStrats.length === 0) return { netProfit: 0, totalTrades: 0, winRate: 0, profitFactor: 0, maxDD: 0, equityCurve: [], drawdownCurve: [], monthlyAvg: 0, maxRecoveryTime: 0, strategyCount: 0 };

    const allTrades = activeStrats.flatMap(s => 
      s.trades.map(t => ({ ...t, adjustedProfit: t.profit * s.multiplier }))
    ).sort((a, b) => a.exitTime - b.exitTime);

    // Aggregate by exit time: portfolio equity at each moment = sum of all P&L at that time
    const byTime = {};
    allTrades.forEach(t => {
      const key = t.exitTime;
      if (!byTime[key]) byTime[key] = { time: key, profit: 0 };
      byTime[key].profit += t.adjustedProfit;
    });
    const timePoints = Object.values(byTime).sort((a, b) => a.time - b.time);

    let totalWins = 0;
    let grossProfit = 0;
    let grossLoss = 0;
    allTrades.forEach(t => {
      if (t.adjustedProfit > 0) {
        totalWins++;
        grossProfit += t.adjustedProfit;
      } else {
        grossLoss += Math.abs(t.adjustedProfit);
      }
    });

    let cumProfit = 0;
    let peak = 0;
    let maxDD = 0;
    let lastPeakTime = timePoints[0]?.time || 0;
    let maxRecoveryTime = 0;

    const equityCurve = [];
    const drawdownCurve = [];

    timePoints.forEach(pt => {
      cumProfit += pt.profit;

      if (cumProfit >= peak) {
        const recoveryTime = pt.time - lastPeakTime;
        if (recoveryTime > maxRecoveryTime) maxRecoveryTime = recoveryTime;
        peak = cumProfit;
        lastPeakTime = pt.time;
      }

      const dd = peak - cumProfit;
      if (dd > maxDD) maxDD = dd;

      equityCurve.push({ time: pt.time, value: cumProfit });
      drawdownCurve.push({ time: pt.time, value: -dd });
    });

    const firstTime = allTrades[0].entryTime || allTrades[0].exitTime;
    const lastTime = allTrades[allTrades.length - 1].exitTime;
    const totalDays = Math.max(1, (lastTime - firstTime) / (1000 * 60 * 60 * 24));
    const monthlyAvg = (cumProfit / totalDays) * 30.44;

    return {
      netProfit: cumProfit,
      totalTrades: allTrades.length,
      winRate: (totalWins / allTrades.length * 100),
      profitFactor: grossLoss > 0 ? (grossProfit / grossLoss) : (grossProfit > 0 ? 100 : 0),
      maxDD,
      monthlyAvg,
      maxRecoveryTime: maxRecoveryTime / (1000 * 60 * 60 * 24), // in days
      equityCurve,
      drawdownCurve,
      strategyCount: activeStrats.length
    };
  }, [individualStats]);

  const monthlyPerformance = useMemo(() => {
    if (strategies.length === 0) return {};
    const activeStrats = individualStats.filter(s => s.active);
    const allTrades = activeStrats.flatMap(s => 
      s.trades.map(t => ({ ...t, adjustedProfit: t.profit * s.multiplier }))
    );

    const perf = {};
    allTrades.forEach(t => {
      const d = new Date(t.exitTime);
      const year = d.getFullYear();
      const month = d.getMonth();

      if (!perf[year]) perf[year] = {};
      if (!perf[year][month]) perf[year][month] = { profit: 0, trades: 0 };

      perf[year][month].profit += t.adjustedProfit;
      perf[year][month].trades += 1;
    });

    return perf;
  }, [individualStats]);

  const removeStrategy = (id) => {
    setStrategies(prev => prev.filter(s => s.id !== id));
  };

  return (
    <div className="flex-1 flex flex-col bg-black overflow-hidden animate-in fade-in duration-500">
      {/* Header */}
      <div className="h-14 border-b border-zinc-800 flex items-center justify-between px-6 bg-black/50 backdrop-blur-md sticky top-0 z-30">
        <div className="flex items-center gap-4">
          <button 
            onClick={onBack}
            className="p-2 hover:bg-zinc-900 rounded-full text-zinc-500 hover:text-zinc-200 transition-all"
          >
            <ChevronLeft size={20} />
          </button>
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-blue-500/10 rounded-lg">
              <Layers className="text-blue-500" size={18} />
            </div>
            <h2 className="text-sm font-bold tracking-tight text-zinc-100 uppercase">Portfolio <span className="text-blue-500">Strategy Manager</span></h2>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex bg-zinc-900/50 p-1 rounded-lg border border-zinc-800">
            <button 
              onClick={() => setActiveTab('PORTFOLIO')}
              className={`px-4 py-1 text-[10px] font-bold rounded-md transition-all ${activeTab === 'PORTFOLIO' ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
            >
              PORTFOLIO VIEW
            </button>
            <button 
              onClick={() => setActiveTab('INDIVIDUAL')}
              className={`px-4 py-1 text-[10px] font-bold rounded-md transition-all ${activeTab === 'INDIVIDUAL' ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
            >
              STRATEGIES ({strategies.length})
            </button>
          </div>

          <div className="relative group">
            <input 
              type="file" 
              accept=".csv" 
              multiple 
              onChange={handleFileUpload} 
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" 
            />
            <button className="flex items-center gap-2 px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-bold rounded-full transition-all shadow-lg shadow-blue-900/20">
              <Plus size={14} />
              Add Strategies
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-8 space-y-8">
        {strategies.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center">
            <div className="w-24 h-24 rounded-full bg-zinc-900/50 border border-zinc-800 flex items-center justify-center opacity-30">
              <Layers size={40} className="text-zinc-700" />
            </div>
          </div>
        ) : (
          <div className="space-y-8 max-w-7xl mx-auto">
            {/* Strategy Exposure Panel */}
            <div className="bg-zinc-950/50 border border-zinc-900 rounded-2xl p-6 space-y-4 shadow-xl">
              <div className="flex items-center justify-between border-b border-zinc-900 pb-4">
                <h3 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-2">
                  <Activity size={12} className="text-blue-500" />
                  Strategy Exposure & Weighting
                </h3>
              </div>
              
              <div className="flex flex-wrap gap-2">
                {strategies.map((s, i) => (
                  <div 
                    key={s.id} 
                    className={`flex items-center gap-3 p-1.5 pl-2.5 rounded-lg border transition-all duration-200 ${s.active ? 'bg-zinc-900/40 border-zinc-800' : 'bg-black border-zinc-900/50 opacity-40'}`}
                  >
                    <button 
                      onClick={() => toggleStrategy(s.id)}
                      className={`w-4 h-4 rounded border transition-all flex items-center justify-center ${s.active ? 'bg-blue-600 border-blue-500 text-white' : 'bg-transparent border-zinc-700 text-transparent'}`}
                    >
                      <Check size={10} strokeWidth={4} />
                    </button>
                    
                    <span className={`text-[10px] font-medium tracking-wide ${s.active ? 'text-zinc-200' : 'text-zinc-600'}`}>
                      {s.name}
                    </span>

                    <div className="flex items-center bg-zinc-950 border border-zinc-800 rounded-md overflow-hidden h-6 ml-1">
                      <input 
                        type="number"
                        min="0"
                        step="1"
                        value={s.multiplier}
                        onChange={(e) => updateMultiplier(s.id, e.target.value)}
                        className="w-8 bg-transparent text-center text-[10px] font-mono text-zinc-400 outline-none hover:text-white focus:text-blue-400 transition-colors"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {activeTab === 'PORTFOLIO' ? (
              <>
                {/* Combined Stats */}
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
                  <StatCard 
                    label="Net Profit" 
                    value={`$${portfolioStats.netProfit.toLocaleString(undefined, {maximumFractionDigits: 0})}`}
                    icon={<TrendingUp size={16} />}
                    color={portfolioStats.netProfit >= 0 ? 'text-green-500' : 'text-red-500'}
                    subValue="Total Gain"
                  />
                  <StatCard 
                    label="Monthly Avg" 
                    value={`$${portfolioStats.monthlyAvg.toLocaleString(undefined, {maximumFractionDigits: 0})}`}
                    icon={<BarChart2 size={16} />}
                    color="text-blue-400"
                    subValue="Avg/Month"
                  />
                  <StatCard 
                    label="Profit Factor" 
                    value={portfolioStats.profitFactor.toFixed(2)}
                    icon={<Activity size={16} />}
                    color="text-zinc-300"
                    subValue="Risk/Reward"
                  />
                  <StatCard 
                    label="Max DD" 
                    value={`$${portfolioStats.maxDD.toLocaleString(undefined, {maximumFractionDigits: 0})}`}
                    icon={<ArrowDown size={16} />}
                    color="text-red-500"
                    subValue="Max Drawdown"
                  />
                  <StatCard 
                    label="Recovery" 
                    value={`${portfolioStats.maxRecoveryTime.toFixed(0)}d`}
                    icon={<TrendingUp size={16} className="rotate-90" />}
                    color="text-amber-500"
                    subValue="DD Duration"
                  />
                  <StatCard 
                    label="Win Rate" 
                    value={`${portfolioStats.winRate.toFixed(1)}%`}
                    icon={<PieChart size={16} />}
                    color="text-zinc-300"
                    subValue={`${portfolioStats.totalTrades} Trades`}
                  />
                  <StatCard 
                    label="Active" 
                    value={portfolioStats.strategyCount}
                    icon={<Layers size={16} />}
                    color="text-blue-500"
                    subValue={`of ${strategies.length}`}
                  />
                </div>

                {/* Combined Portfolio Chart Section */}
                <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-6 space-y-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-6">
                      <div className="flex items-center gap-3">
                        <div className={`w-1 h-4 ${activeChart === 'EQUITY' ? 'bg-blue-500' : 'bg-red-500'} rounded-full transition-colors`}></div>
                        <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-400">
                          {activeChart === 'EQUITY' ? 'Combined Equity Curve' : 'Portfolio Drawdown Evolution'}
                        </h3>
                      </div>
                      
                      {/* Chart Mode Tabs */}
                      <div className="flex bg-black border border-zinc-900 p-0.5 rounded-lg">
                        <button 
                          onClick={() => setActiveChart('EQUITY')}
                          className={`px-3 py-1 text-[9px] font-bold rounded-md transition-all ${activeChart === 'EQUITY' ? 'bg-zinc-800 text-white shadow-lg' : 'text-zinc-600 hover:text-zinc-400'}`}
                        >
                          EQUITY
                        </button>
                        <button 
                          onClick={() => setActiveChart('DRAWDOWN')}
                          className={`px-3 py-1 text-[9px] font-bold rounded-md transition-all ${activeChart === 'DRAWDOWN' ? 'bg-zinc-800 text-white shadow-lg' : 'text-zinc-600 hover:text-zinc-400'}`}
                        >
                          DRAWDOWN
                        </button>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2 max-w-[50%]">
                      {individualStats.map((s, i) => s.active && (
                        <div key={s.id} className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full" style={{backgroundColor: COLORS.chart[i % COLORS.chart.length]}}></div>
                          <span className="text-[9px] text-zinc-500 uppercase">{s.name} (x{s.multiplier})</span>
                        </div>
                      ))}
                      <div className="flex items-center gap-2 border-l border-zinc-800 pl-4">
                        <div className={`w-3 h-0.5 ${activeChart === 'EQUITY' ? 'bg-white' : 'bg-red-500'}`}></div>
                        <span className={`text-[9px] uppercase font-bold ${activeChart === 'EQUITY' ? 'text-white' : 'text-red-500'}`}>Total Portfolio</span>
                      </div>
                    </div>
                  </div>
                  
                  <div className="h-80 w-full relative">
                    <PortfolioChart 
                      strategies={individualStats.filter(s => s.active)} 
                      combined={activeChart === 'EQUITY' ? portfolioStats.equityCurve : portfolioStats.drawdownCurve} 
                      mode={activeChart}
                      maxDD={portfolioStats.maxDD}
                      equityCurve={portfolioStats.equityCurve}
                    />
                  </div>
                </div>

                {/* Strategy Comparison Table */}
                <div className="bg-zinc-950/50 border border-zinc-900 rounded-xl overflow-hidden shadow-2xl">
                  <div className="px-6 py-4 border-b border-zinc-900">
                    <h3 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Weighting Analysis</h3>
                  </div>
                  <table className="w-full text-right text-[11px]">
                    <thead>
                      <tr className="text-zinc-500 uppercase font-bold border-b border-zinc-900">
                        <th className="px-6 py-3">Strategy Name</th>
                        <th className="px-6 py-3 text-center">Weight</th>
                        <th className="px-6 py-3">Net Profit</th>
                        <th className="px-6 py-3">Max Drawdown</th>
                        <th className="px-6 py-3">Contribution %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {individualStats.map((s, i) => (
                        <tr key={s.id} className={`border-b border-zinc-900/50 transition-colors ${s.active ? 'hover:bg-zinc-900/30' : 'opacity-30'}`}>
                          <td className="px-6 py-4 flex items-center gap-3">
                            <div className="w-2 h-2 rounded-full" style={{backgroundColor: COLORS.chart[i % COLORS.chart.length]}}></div>
                            <span className={`font-bold ${s.active ? 'text-zinc-200' : 'text-zinc-600'}`}>{s.name}</span>
                          </td>
                          <td className="px-6 py-4 text-center font-mono text-blue-400">x{s.multiplier}</td>
                          <td className={`px-6 py-4 font-mono ${s.stats.netProfit >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                            ${s.stats.netProfit.toLocaleString()}
                          </td>
                          <td className="px-6 py-4 font-mono text-red-500">${s.stats.maxDD.toLocaleString()}</td>
                          <td className="px-6 py-4 font-mono text-zinc-500">
                            {portfolioStats.netProfit !== 0 ? ((s.stats.netProfit / portfolioStats.netProfit) * 100).toFixed(1) : 0}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Monthly Performance Calendar */}
                <div className="bg-zinc-950 border border-zinc-900 rounded-2xl overflow-hidden shadow-2xl transition-all duration-300">
                  <button 
                    onClick={() => setIsCalendarOpen(!isCalendarOpen)}
                    className="w-full px-6 py-4 flex items-center justify-between hover:bg-zinc-900/50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <Calendar size={18} className="text-blue-500" />
                      <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-100">Monthly Performance Calendar</h3>
                    </div>
                    <ChevronDown size={18} className={`text-zinc-500 transition-transform duration-300 ${isCalendarOpen ? 'rotate-180' : ''}`} />
                  </button>

                  <div className={`overflow-x-auto transition-all duration-300 ${isCalendarOpen ? 'max-h-[1000px] border-t border-zinc-900' : 'max-h-0'}`}>
                    <table className="w-full text-right text-[11px] border-collapse">
                      <thead>
                        <tr className="text-zinc-500 uppercase font-bold bg-zinc-900/20">
                          <th className="px-6 py-4 text-left border-b border-zinc-900">Year</th>
                          {['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'].map(m => (
                            <th key={m} className="px-4 py-4 border-b border-zinc-900">{m}</th>
                          ))}
                          <th className="px-6 py-4 border-b border-zinc-900 bg-zinc-900/40">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.keys(monthlyPerformance).sort((a, b) => b - a).map(year => {
                          const months = monthlyPerformance[year];
                          let yearTotal = 0;
                          return (
                            <tr key={year} className="border-b border-zinc-900/50 hover:bg-zinc-900/30 transition-colors">
                              <td className="px-6 py-4 font-bold text-zinc-100 bg-zinc-900/10 text-left">{year}</td>
                              {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(m => {
                                const data = months[m];
                                if (data) yearTotal += data.profit;
                                return (
                                  <td key={m} className="px-4 py-4">
                                    {data ? (
                                      <div className="space-y-0.5">
                                        <div className={`font-mono font-bold ${data.profit >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                                          ${data.profit.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                        </div>
                                        <div className="text-[9px] text-zinc-600 font-mono">({data.trades})</div>
                                      </div>
                                    ) : (
                                      <span className="text-zinc-800">—</span>
                                    )}
                                  </td>
                                );
                              })}
                              <td className={`px-6 py-4 font-mono font-bold bg-zinc-900/40 ${yearTotal >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                                ${yearTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 max-w-7xl mx-auto">
                {individualStats.map((s, i) => (
                  <div key={s.id} className={`bg-zinc-950 border border-zinc-900 rounded-2xl p-6 space-y-6 relative group transition-all ${!s.active && 'opacity-40 grayscale'}`}>
                    <button 
                      onClick={() => removeStrategy(s.id)}
                      className="absolute top-4 right-4 p-2 text-zinc-700 hover:text-red-500 transition-all opacity-0 group-hover:opacity-100"
                    >
                      <Trash2 size={16} />
                    </button>
                    
                    <div className="flex items-center gap-4">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center border transition-all ${s.active ? 'bg-zinc-900 border-zinc-800 text-blue-500' : 'bg-black border-zinc-900 text-zinc-700'}`}>
                        <Activity size={20} />
                      </div>
                      <div>
                        <h3 className="text-sm font-bold text-zinc-100">{s.name}</h3>
                        <p className="text-[10px] text-zinc-600 font-mono">{s.fileName} {s.multiplier !== 1 && `(Multiplier: x${s.multiplier})`}</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div className="space-y-1">
                        <div className="text-[9px] text-zinc-600 uppercase font-bold tracking-wider">Net Profit</div>
                        <div className={`text-sm font-mono font-bold ${s.stats.netProfit >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                          ${s.stats.netProfit.toLocaleString(undefined, {maximumFractionDigits: 0})}
                        </div>
                      </div>
                      <div className="space-y-1">
                        <div className="text-[9px] text-zinc-600 uppercase font-bold tracking-wider">Monthly Avg</div>
                        <div className="text-sm font-mono font-bold text-blue-400">${s.stats.monthlyAvg.toLocaleString(undefined, {maximumFractionDigits: 0})}</div>
                      </div>
                      <div className="space-y-1">
                        <div className="text-[9px] text-zinc-600 uppercase font-bold tracking-wider">Max DD</div>
                        <div className="text-sm font-mono font-bold text-red-500">${s.stats.maxDD.toLocaleString(undefined, {maximumFractionDigits: 0})}</div>
                      </div>
                      <div className="space-y-1">
                        <div className="text-[9px] text-zinc-600 uppercase font-bold tracking-wider">Recovery</div>
                        <div className="text-sm font-mono font-bold text-amber-500">{s.stats.maxRecoveryTime.toFixed(0)}d</div>
                      </div>
                    </div>

                    <div className="h-24 w-full opacity-50">
                      <PortfolioChart strategies={[s]} combined={s.equityCurve} mode="EQUITY" hideLegend />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

const PortfolioChart = ({ strategies, combined, mode, hideLegend, maxDD: maxDDProp, equityCurve }) => {
  const containerRef = useRef(null);
  const zoomBarRef = useRef(null);
  const [tooltip, setTooltip] = useState(null);
  const [zoomStart, setZoomStart] = useState(0);
  const [zoomEnd, setZoomEnd] = useState(1);
  const [dragState, setDragState] = useState(null); // { type: 'pan'|'left'|'right', startX, startZoomStart, startZoomEnd }

  if (!combined || combined.length === 0) return null;

  const width = 1000;
  const height = 280;
  const padding = { top: 20, right: 20, bottom: 20, left: 20 };
  const chartHeight = height - padding.top - padding.bottom;
  const chartWidth = width - padding.left - padding.right;
  const zoomBarHeight = 32;
  const n = combined.length;
  const iStart = Math.floor(zoomStart * (n - 1));
  const iEnd = Math.ceil(zoomEnd * (n - 1));
  const visibleCount = Math.max(1, iEnd - iStart);
  const visibleData = combined.slice(iStart, iEnd + 1);

  let minVal = mode === 'DRAWDOWN' ? -1 : 0;
  let maxVal = mode === 'DRAWDOWN' ? 0 : 1;
  
  strategies.forEach(s => {
    const curve = mode === 'EQUITY' ? s.equityCurve : s.drawdownCurve;
    curve.forEach(p => {
      if (p.value < minVal) minVal = p.value;
      if (p.value > maxVal) maxVal = p.value;
    });
  });
  
  combined.forEach(p => {
    if (p.value < minVal) minVal = p.value;
    if (p.value > maxVal) maxVal = p.value;
  });

  const range = maxVal - minVal || 1;
  const scaleY = (val) => padding.top + chartHeight - ((val - minVal) / range) * chartHeight;
  const scaleXVisible = (i) => padding.left + ((i - iStart) / (visibleCount - 1 || 1)) * chartWidth;

  const handleMouseMove = useCallback((e) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * width;
    const relX = (x - padding.left) / chartWidth;
    const rawIndex = iStart + relX * visibleCount;
    const index = Math.round(Math.max(0, Math.min(n - 1, rawIndex)));
    const point = combined[index];
    if (point) {
      setTooltip({
        index,
        value: point.value,
        time: point.time,
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
      });
    }
  }, [combined, iStart, visibleCount, n, width, chartWidth]);

  const handleMouseLeave = useCallback(() => setTooltip(null), []);

  const handleZoomBarMouseDown = useCallback((e) => {
    if (!zoomBarRef.current) return;
    e.preventDefault();
    const rect = zoomBarRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const w = zoomEnd - zoomStart;
    if (x < zoomStart + 0.05) setDragState({ type: 'left', startX: x, startZoomStart: zoomStart, startZoomEnd: zoomEnd });
    else if (x > zoomEnd - 0.05) setDragState({ type: 'right', startX: x, startZoomStart: zoomStart, startZoomEnd: zoomEnd });
    else setDragState({ type: 'pan', startX: x, startZoomStart: zoomStart, startZoomEnd: zoomEnd });
  }, [zoomStart, zoomEnd]);

  React.useEffect(() => {
    if (!dragState) return;
    const onMove = (e) => {
      if (!zoomBarRef.current) return;
      const rect = zoomBarRef.current.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const delta = x - dragState.startX;
      if (dragState.type === 'pan') {
        const w = dragState.startZoomEnd - dragState.startZoomStart;
        let newStart = dragState.startZoomStart + delta;
        newStart = Math.max(0, Math.min(1 - w, newStart));
        setZoomStart(newStart);
        setZoomEnd(newStart + w);
      } else if (dragState.type === 'left') {
        let newStart = Math.max(0, Math.min(dragState.startZoomEnd - 0.02, dragState.startZoomStart + delta));
        setZoomStart(newStart);
        setZoomEnd(dragState.startZoomEnd);
      } else {
        let newEnd = Math.min(1, Math.max(dragState.startZoomStart + 0.02, dragState.startZoomEnd + delta));
        setZoomStart(dragState.startZoomStart);
        setZoomEnd(newEnd);
      }
    };
    const onUp = () => setDragState(null);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [dragState]);

  const formatDate = (ts) => {
    const d = new Date(ts);
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  };

  const combinedPoints = visibleData.map((p, i) => `${scaleXVisible(iStart + i)},${scaleY(p.value)}`);
  const areaPoints = mode === 'DRAWDOWN' 
    ? `${scaleXVisible(iStart)},${scaleY(0)} ${combinedPoints.join(' ')} ${scaleXVisible(iEnd)},${scaleY(0)}`
    : '';

  const zoomBarW = 1000;
  const zoomBarScaleX = (i) => (i / (n - 1 || 1)) * (zoomBarW - 4);
  const zoomBarMin = combined.reduce((a, p) => Math.min(a, p.value), 0);
  const zoomBarMax = combined.reduce((a, p) => Math.max(a, p.value), 0);
  const zoomBarRange = zoomBarMax - zoomBarMin || 1;
  const zoomBarScaleY = (val) => zoomBarHeight - 4 - ((val - zoomBarMin) / zoomBarRange) * (zoomBarHeight - 8);
  const zoomBarLine = combined.map((p, i) => `${zoomBarScaleX(i)},${zoomBarScaleY(p.value)}`).join(' ');

  return (
    <div className="flex flex-col h-full w-full" ref={containerRef} onMouseMove={hideLegend ? undefined : handleMouseMove} onMouseLeave={hideLegend ? undefined : handleMouseLeave}>
      <div className="flex-1 min-h-0 relative">
        <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="block">
          <defs>
            <linearGradient id="drawdownGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ef4444" stopOpacity="0.3" />
              <stop offset="100%" stopColor="#ef4444" stopOpacity="0" />
            </linearGradient>
          </defs>

          <line x1={padding.left} y1={scaleY(0)} x2={width - padding.right} y2={scaleY(0)} stroke="#18181b" strokeWidth="1" strokeDasharray="4 4" />
          
          {strategies.length > 1 && strategies.map((s, idx) => {
            const curve = mode === 'EQUITY' ? s.equityCurve : s.drawdownCurve;
            const visibleCurve = curve.slice(iStart, iEnd + 1);
            const points = visibleCurve.map((p, i) => `${scaleXVisible(iStart + i)},${scaleY(p.value)}`).join(' ');
            return (
              <polyline key={s.id} fill="none" stroke={COLORS.chart[idx % COLORS.chart.length]} strokeWidth="1.5" strokeOpacity={mode === 'EQUITY' ? '0.4' : '0.2'} points={points} />
            );
          })}

          {mode === 'DRAWDOWN' && <polygon points={areaPoints} fill="url(#drawdownGradient)" />}

          <polyline fill="none" stroke={mode === 'EQUITY' ? '#ffffff' : '#ef4444'} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" points={combinedPoints.join(' ')} className="drop-shadow-lg" />

          {mode === 'DRAWDOWN' && maxDDProp != null && maxDDProp > 0 && (
            <g>
              <line x1={padding.left} y1={scaleY(-maxDDProp)} x2={width - padding.right} y2={scaleY(-maxDDProp)} stroke="#f87171" strokeWidth="1.5" strokeDasharray="4 4" strokeOpacity="0.9" />
              <text x={padding.left + 4} y={scaleY(-maxDDProp) - 6} textAnchor="start" fill="#f87171" fontSize="11" fontFamily="monospace" fontWeight="bold">Max DD ${maxDDProp.toLocaleString(undefined, { maximumFractionDigits: 0 })}</text>
            </g>
          )}
        </svg>

        {tooltip && !hideLegend && (
          <div 
            className="absolute pointer-events-none z-20 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 shadow-xl text-left min-w-[140px]"
            style={{ left: Math.min(tooltip.x + 12, containerRef.current ? containerRef.current.offsetWidth - 160 : tooltip.x + 12), top: Math.max(8, tooltip.y - 60) }}
          >
            <div className="text-[10px] text-zinc-500 uppercase font-bold mb-1">{formatDate(tooltip.time)}</div>
            {mode === 'EQUITY' ? (
              <div className={`font-mono font-bold ${tooltip.value >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                ${tooltip.value.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </div>
            ) : (
              <>
                <div className="font-mono font-bold text-red-500">Drawdown ${Math.abs(tooltip.value).toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
                {equityCurve?.[tooltip.index] != null && (
                  <div className="text-[10px] text-zinc-500 mt-1">Equity ${equityCurve[tooltip.index].value.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
                )}
              </>
            )}
            <div className="text-[9px] text-zinc-600 mt-0.5">Trade #{tooltip.index + 1}</div>
          </div>
        )}
      </div>

      {!hideLegend && (
      <div className="flex items-center gap-2 px-1 py-2 border-t border-zinc-900">
        <div 
          ref={zoomBarRef}
          className="flex-1 h-8 rounded-lg bg-zinc-950 border border-zinc-800 cursor-pointer relative overflow-hidden select-none"
          onMouseDown={handleZoomBarMouseDown}
        >
          <svg width="100%" height="100%" viewBox={`0 0 ${zoomBarW} ${zoomBarHeight}`} preserveAspectRatio="none" className="block">
            <polyline fill="none" stroke={mode === 'EQUITY' ? '#3f3f46' : '#7f1d1d'} strokeWidth="1.5" points={zoomBarLine} />
          </svg>
          <div 
            className="absolute top-1 bottom-1 rounded border border-blue-500/50 bg-blue-500/10 pointer-events-none"
            style={{ left: `${zoomStart * 100}%`, width: `${(zoomEnd - zoomStart) * 100}%` }}
          />
        </div>
        <button 
          type="button"
          onClick={() => { setZoomStart(0); setZoomEnd(1); }}
          className="shrink-0 px-2 py-1 text-[9px] font-bold uppercase text-zinc-500 hover:text-zinc-300 border border-zinc-800 rounded transition-colors"
        >
          Reset
        </button>
      </div>
      )}
    </div>
  );
};

const StatCard = ({ label, value, icon, color, subValue }) => (
  <div className="bg-zinc-950 border border-zinc-900 p-3 rounded-xl space-y-1.5 relative overflow-hidden group hover:border-zinc-700 transition-all duration-300 min-w-[120px]">
    <div className="absolute -right-1 -top-1 opacity-5 group-hover:opacity-10 transition-opacity">
      {React.cloneElement(icon, { size: 40 })}
    </div>
    <div className="flex items-center gap-1.5 text-zinc-500">
      {React.cloneElement(icon, { size: 12 })}
      <span className="text-[9px] font-bold uppercase tracking-wider whitespace-nowrap">{label}</span>
    </div>
    <div className="space-y-0.5 relative z-10">
      <div className={`text-lg font-mono font-bold tracking-tighter ${color} leading-none`}>{value}</div>
      <div className="text-[8px] text-zinc-600 font-medium uppercase tracking-tight whitespace-nowrap">{subValue}</div>
    </div>
  </div>
);

export default PortfolioAnalyzer;
