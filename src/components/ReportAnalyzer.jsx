import React, { useState, useMemo } from 'react';
import { Upload, FileText, ChevronLeft, BarChart2, TrendingUp, ArrowUp, ArrowDown, Activity, Download, Search, Filter, X, Table, Plus, PieChart, Layers, Trash2, Layout } from 'lucide-react';

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
  chart: ['#3b82f6', '#a855f7', '#ec4899', '#f97316', '#10b981', '#06b6d4']
};

const PortfolioAnalyzer = ({ onBack }) => {
  const [strategies, setStrategies] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('PORTFOLIO'); // 'PORTFOLIO' or 'INDIVIDUAL'

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
      
      const curve = s.trades.map(t => {
        const p = t.profit * s.multiplier;
        cumProfit += p;
        if (p > 0) {
          wins++;
          grossProfit += p;
        } else {
          grossLoss += Math.abs(p);
        }
        if (cumProfit > peak) peak = cumProfit;
        const dd = peak - cumProfit;
        if (dd > maxDD) maxDD = dd;
        return { time: t.exitTime, value: cumProfit };
      });

      return {
        ...s,
        stats: {
          netProfit: cumProfit,
          trades: s.trades.length,
          winRate: s.trades.length > 0 ? (wins / s.trades.length * 100) : 0,
          profitFactor: grossLoss > 0 ? (grossProfit / grossLoss) : (grossProfit > 0 ? 100 : 0),
          maxDD
        },
        equityCurve: curve
      };
    });
  }, [strategies]);

  const portfolioStats = useMemo(() => {
    if (strategies.length === 0) return null;

    const activeStrats = individualStats.filter(s => s.active);
    if (activeStrats.length === 0) return { netProfit: 0, totalTrades: 0, winRate: 0, profitFactor: 0, maxDD: 0, equityCurve: [], strategyCount: 0 };

    const allTrades = activeStrats.flatMap(s => 
      s.trades.map(t => ({ ...t, adjustedProfit: t.profit * s.multiplier }))
    ).sort((a, b) => a.exitTime - b.exitTime);
    
    let cumProfit = 0;
    let peak = 0;
    let maxDD = 0;
    let totalWins = 0;
    let grossProfit = 0;
    let grossLoss = 0;

    const equityCurve = allTrades.map(t => {
      cumProfit += t.adjustedProfit;
      if (t.adjustedProfit > 0) {
        totalWins++;
        grossProfit += t.adjustedProfit;
      } else {
        grossLoss += Math.abs(t.adjustedProfit);
      }
      if (cumProfit > peak) peak = cumProfit;
      const dd = peak - cumProfit;
      if (dd > maxDD) maxDD = dd;
      return { time: t.exitTime, value: cumProfit };
    });

    return {
      netProfit: cumProfit,
      totalTrades: allTrades.length,
      winRate: (totalWins / allTrades.length * 100),
      profitFactor: grossLoss > 0 ? (grossProfit / grossLoss) : (grossProfit > 0 ? 100 : 0),
      maxDD,
      equityCurve,
      strategyCount: activeStrats.length
    };
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
            <div className="p-1.5 bg-purple-500/10 rounded-lg">
              <Layers className="text-purple-500" size={18} />
            </div>
            <h2 className="text-sm font-bold tracking-tight text-zinc-100 uppercase">Portfolio <span className="text-purple-500">Strategy Manager</span></h2>
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
            <button className="flex items-center gap-2 px-4 py-1.5 bg-purple-600 hover:bg-purple-500 text-white text-[11px] font-bold rounded-full transition-all shadow-lg shadow-purple-900/20">
              <Plus size={14} />
              Add Strategies
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-8 space-y-8">
        {strategies.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center space-y-6">
            <div className="w-24 h-24 rounded-full bg-zinc-900/50 border border-zinc-800 flex items-center justify-center">
              <Layers size={40} className="text-zinc-700" />
            </div>
            <div className="text-center space-y-2">
              <h3 className="text-zinc-300 font-medium">המערכת מוכנה לניתוח התיק שלך</h3>
              <p className="text-zinc-500 text-xs max-w-xs leading-relaxed">
                העלה מספר קבצי CSV של NinjaTrader כדי לראות איך האסטרטגיות שלך עובדות יחד, מה ה-Drawdown המשולב ואיך הן מחפות אחת על השנייה.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-8 max-w-7xl mx-auto">
            {/* Strategy Exposure Panel */}
            <div className="bg-zinc-950/50 border border-zinc-900 rounded-2xl p-6 space-y-4 shadow-xl">
              <div className="flex items-center justify-between border-b border-zinc-900 pb-4">
                <h3 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-2">
                  <Activity size={12} className="text-purple-500" />
                  Strategy Exposure & Weighting
                </h3>
                <span className="text-[10px] text-zinc-600 font-mono italic">Adjust multipliers to see portfolio impact</span>
              </div>
              
              <div className="flex flex-wrap gap-3">
                {strategies.map((s, i) => (
                  <div 
                    key={s.id} 
                    className={`flex items-center gap-3 p-2 pl-3 rounded-xl border transition-all duration-300 ${s.active ? 'bg-zinc-900/50 border-zinc-800' : 'bg-black border-zinc-900 opacity-40'}`}
                  >
                    <button 
                      onClick={() => toggleStrategy(s.id)}
                      className={`w-5 h-5 rounded-md flex items-center justify-center transition-all ${s.active ? 'bg-purple-600 text-white' : 'bg-zinc-800 text-zinc-600'}`}
                    >
                      {s.active && <X size={12} className="rotate-45" />}
                    </button>
                    
                    <span className={`text-[11px] font-bold tracking-tight ${s.active ? 'text-zinc-200' : 'text-zinc-600'}`}>
                      {s.name}
                    </span>

                    <div className="flex items-center bg-black border border-zinc-800 rounded-lg overflow-hidden h-7">
                      <input 
                        type="number"
                        min="0"
                        step="1"
                        value={s.multiplier}
                        onChange={(e) => updateMultiplier(s.id, e.target.value)}
                        className="w-10 bg-transparent text-center text-[11px] font-mono text-purple-400 outline-none"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {activeTab === 'PORTFOLIO' ? (
              <>
                {/* Combined Stats */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
                  <StatCard 
                    label="Portfolio Net Profit" 
                    value={`$${portfolioStats.netProfit.toLocaleString(undefined, {maximumFractionDigits: 0})}`}
                    icon={<TrendingUp size={16} />}
                    color={portfolioStats.netProfit >= 0 ? 'text-green-500' : 'text-red-500'}
                    subValue="Adjusted by multipliers"
                  />
                  <StatCard 
                    label="Portfolio PF" 
                    value={portfolioStats.profitFactor.toFixed(2)}
                    icon={<Activity size={16} />}
                    color="text-purple-400"
                    subValue="Overall risk/reward"
                  />
                  <StatCard 
                    label="Aggregate Win Rate" 
                    value={`${portfolioStats.winRate.toFixed(1)}%`}
                    icon={<PieChart size={16} />}
                    color="text-zinc-300"
                    subValue={`${portfolioStats.totalTrades} total trades`}
                  />
                  <StatCard 
                    label="Portfolio Max DD" 
                    value={`$${portfolioStats.maxDD.toLocaleString(undefined, {maximumFractionDigits: 0})}`}
                    icon={<ArrowDown size={16} />}
                    color="text-red-500"
                    subValue="Combined equity dip"
                  />
                  <StatCard 
                    label="Active Strategies" 
                    value={portfolioStats.strategyCount}
                    icon={<Layers size={16} />}
                    color="text-purple-500"
                    subValue={`${strategies.length} total loaded`}
                  />
                </div>

                {/* Combined Equity Curve */}
                <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-6 space-y-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-1 h-4 bg-purple-500 rounded-full"></div>
                      <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-400">Combined Equity Curve</h3>
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2 max-w-[60%]">
                      {individualStats.map((s, i) => s.active && (
                        <div key={s.id} className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full" style={{backgroundColor: COLORS.chart[i % COLORS.chart.length]}}></div>
                          <span className="text-[9px] text-zinc-500 uppercase">{s.name} (x{s.multiplier})</span>
                        </div>
                      ))}
                      <div className="flex items-center gap-2 border-l border-zinc-800 pl-4">
                        <div className="w-3 h-0.5 bg-white"></div>
                        <span className="text-[9px] text-white uppercase font-bold">Total Portfolio</span>
                      </div>
                    </div>
                  </div>
                  
                  <div className="h-80 w-full">
                    <EquityChart strategies={individualStats.filter(s => s.active)} combined={portfolioStats.equityCurve} />
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
                          <td className="px-6 py-4 text-center font-mono text-purple-400">x{s.multiplier}</td>
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
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center border transition-all ${s.active ? 'bg-zinc-900 border-zinc-800 text-purple-500' : 'bg-black border-zinc-900 text-zinc-700'}`}>
                        <Activity size={20} />
                      </div>
                      <div>
                        <h3 className="text-sm font-bold text-zinc-100">{s.name}</h3>
                        <p className="text-[10px] text-zinc-600 font-mono">{s.fileName} {s.multiplier !== 1 && `(Multiplier: x${s.multiplier})`}</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-4">
                      <div className="space-y-1">
                        <div className="text-[9px] text-zinc-600 uppercase font-bold tracking-wider">Net Profit</div>
                        <div className={`text-base font-mono font-bold ${s.stats.netProfit >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                          ${s.stats.netProfit.toLocaleString(undefined, {maximumFractionDigits: 0})}
                        </div>
                      </div>
                      <div className="space-y-1">
                        <div className="text-[9px] text-zinc-600 uppercase font-bold tracking-wider">Profit Factor</div>
                        <div className="text-base font-mono font-bold text-zinc-300">{s.stats.profitFactor.toFixed(2)}</div>
                      </div>
                      <div className="space-y-1">
                        <div className="text-[9px] text-zinc-600 uppercase font-bold tracking-wider">Max DD</div>
                        <div className="text-base font-mono font-bold text-red-500">${s.stats.maxDD.toLocaleString(undefined, {maximumFractionDigits: 0})}</div>
                      </div>
                    </div>

                    <div className="h-24 w-full opacity-50">
                      <EquityChart strategies={[s]} combined={s.equityCurve} hideLegend />
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

const EquityChart = ({ strategies, combined, hideLegend }) => {
  if (!combined || combined.length === 0) return null;

  // Simple SVG Line Chart implementation
  const width = 1000;
  const height = 300;
  const padding = 20;

  // Find min/max values for scaling
  let minVal = 0;
  let maxVal = 0;
  
  // Also include individual strategy curves in scaling
  strategies.forEach(s => {
    s.equityCurve.forEach(p => {
      if (p.value < minVal) minVal = p.value;
      if (p.value > maxVal) maxVal = p.value;
    });
  });
  
  combined.forEach(p => {
    if (p.value < minVal) minVal = p.value;
    if (p.value > maxVal) maxVal = p.value;
  });

  const range = maxVal - minVal || 1;
  const scaleY = (val) => height - padding - ((val - minVal) / range) * (height - 2 * padding);
  const scaleX = (i, total) => padding + (i / (total - 1)) * (width - 2 * padding);

  return (
    <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="overflow-visible">
      {/* Grid Lines */}
      <line x1={padding} y1={scaleY(0)} x2={width-padding} y2={scaleY(0)} stroke="#18181b" strokeWidth="1" strokeDasharray="4 4" />
      
      {/* Individual Strategy Curves */}
      {strategies.length > 1 && strategies.map((s, idx) => {
        const points = s.equityCurve.map((p, i) => `${scaleX(i, s.equityCurve.length)},${scaleY(p.value)}`).join(' ');
        return (
          <polyline
            key={s.id}
            fill="none"
            stroke={COLORS.chart[idx % COLORS.chart.length]}
            strokeWidth="1.5"
            strokeOpacity="0.4"
            points={points}
          />
        );
      })}

      {/* Combined Portfolio Curve */}
      <polyline
        fill="none"
        stroke="#ffffff"
        strokeWidth="2.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        points={combined.map((p, i) => `${scaleX(i, combined.length)},${scaleY(p.value)}`).join(' ')}
        className="drop-shadow-lg"
      />
    </svg>
  );
};

const StatCard = ({ label, value, icon, color, subValue }) => (
  <div className="bg-zinc-950 border border-zinc-900 p-5 rounded-xl space-y-3 relative overflow-hidden group hover:border-zinc-700 transition-all duration-300">
    <div className="absolute -right-2 -top-2 opacity-5 group-hover:opacity-10 transition-opacity">
      {React.cloneElement(icon, { size: 64 })}
    </div>
    <div className="flex items-center gap-2 text-zinc-500">
      {icon}
      <span className="text-[10px] font-bold uppercase tracking-wider">{label}</span>
    </div>
    <div className="space-y-1">
      <div className={`text-2xl font-mono font-bold tracking-tighter ${color}`}>{value}</div>
      <div className="text-[9px] text-zinc-600 font-medium uppercase tracking-wide">{subValue}</div>
    </div>
  </div>
);

export default PortfolioAnalyzer;
