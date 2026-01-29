import React, { useState, useMemo } from 'react';
import { Upload, FileText, ChevronLeft, BarChart2, TrendingUp, ArrowUp, ArrowDown, Activity, Download, Search, Filter, X, Table } from 'lucide-react';
import * as XLSX from 'xlsx';

const COLORS = {
  bg: '#000000',
  card: '#09090b',
  border: '#18181b',
  textMain: '#fafafa',
  textMuted: '#71717a',
  blue: '#3b82f6',
  green: '#22c55e',
  red: '#ef4444',
  amber: '#f59e0b'
};

const ReportAnalyzer = ({ onBack }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setLoading(true);
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const bstr = evt.target.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const jsonData = XLSX.utils.sheet_to_json(ws, { defval: "" });
        
        setData(jsonData);
      } catch (error) {
        console.error("Error reading file:", error);
        alert("שגיאה בקריאת הקובץ. וודא שזהו קובץ Excel או CSV תקין.");
      } finally {
        setLoading(false);
      }
    };
    reader.readAsBinaryString(file);
  };

  const stats = useMemo(() => {
    if (!data || data.length === 0) return null;

    let totalNetProfit = 0;
    let totalTrades = 0;
    let winningTrades = 0;
    let totalMaxDD = 0;
    let profitFactorSum = 0;
    let count = 0;

    data.forEach(row => {
      // NinjaTrader Grid column names can vary, we try common ones
      const netProfit = parseFloat(row['Net profit'] || row['Net Profit'] || 0);
      const trades = parseInt(row['Total trades'] || row['Total Trades'] || 0);
      const winPct = parseFloat(String(row['Percent profitable'] || row['Win %'] || "0").replace('%', ''));
      const pf = parseFloat(row['Profit factor'] || row['Profit Factor'] || 0);
      const dd = parseFloat(row['Max. drawdown'] || row['Max DD'] || 0);

      if (!isNaN(netProfit)) totalNetProfit += netProfit;
      if (!isNaN(trades)) totalTrades += trades;
      if (!isNaN(winPct)) winningTrades += (trades * winPct / 100);
      if (!isNaN(dd)) totalMaxDD = Math.min(totalMaxDD, dd); // DD is usually negative in reports
      if (!isNaN(pf) && pf > 0) {
        profitFactorSum += pf;
        count++;
      }
    });

    return {
      netProfit: totalNetProfit,
      trades: totalTrades,
      winRate: totalTrades > 0 ? (winningTrades / totalTrades * 100) : 0,
      profitFactor: count > 0 ? (profitFactorSum / count) : 0,
      maxDD: totalMaxDD,
      rowCount: data.length
    };
  }, [data]);

  const filteredData = useMemo(() => {
    if (!data) return [];
    if (!searchTerm) return data;
    
    return data.filter(row => 
      Object.values(row).some(val => 
        String(val).toLowerCase().includes(searchTerm.toLowerCase())
      )
    );
  }, [data, searchTerm]);

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
              <FileText className="text-blue-500" size={18} />
            </div>
            <h2 className="text-sm font-bold tracking-tight text-zinc-100 uppercase">NinjaTrader <span className="text-blue-500">Grid Analyzer</span></h2>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {data && (
            <div className="relative">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500" size={14} />
              <input 
                type="text"
                placeholder="חפש בתוצאות..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="bg-zinc-900/50 border border-zinc-800 text-xs rounded-full pr-9 pl-4 py-1.5 focus:border-blue-500/50 outline-none w-64 transition-all text-right"
              />
            </div>
          )}
          <div className="relative group">
            <input 
              type="file" 
              accept=".xlsx,.xls,.csv" 
              onChange={handleFileUpload} 
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" 
            />
            <button className="flex items-center gap-2 px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-bold rounded-full transition-all shadow-lg shadow-blue-900/20">
              <Upload size={14} />
              {data ? 'החלף קובץ' : 'טען דוח Grid'}
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-8 space-y-8">
        {!data ? (
          <div className="h-full flex flex-col items-center justify-center space-y-6 opacity-60">
            <div className="w-24 h-24 rounded-full bg-zinc-900/50 border border-zinc-800 flex items-center justify-center animate-pulse">
              <Table size={40} className="text-zinc-700" />
            </div>
            <div className="text-center space-y-2">
              <h3 className="text-zinc-300 font-medium">אין נתונים להצגה</h3>
              <p className="text-zinc-500 text-xs max-w-xs leading-relaxed">
                העלה קובץ Excel או CSV שיוצא מה-Strategy Analyzer של NinjaTrader (Grid View) כדי לראות ניתוח מעמיק.
              </p>
            </div>
          </div>
        ) : (
          <>
            {/* Stats Overview */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
              <StatCard 
                label="Total Net Profit" 
                value={`$${stats.netProfit.toLocaleString(undefined, {maximumFractionDigits: 0})}`}
                icon={<TrendingUp size={16} />}
                color={stats.netProfit >= 0 ? 'text-green-500' : 'text-red-500'}
                subValue={`${stats.rowCount} iterations analysed`}
              />
              <StatCard 
                label="Profit Factor" 
                value={stats.profitFactor.toFixed(2)}
                icon={<Activity size={16} />}
                color="text-blue-400"
                subValue="Average across all"
              />
              <StatCard 
                label="Win Rate" 
                value={`${stats.winRate.toFixed(1)}%`}
                icon={<BarChart2 size={16} />}
                color={stats.winRate >= 50 ? 'text-green-500' : 'text-zinc-400'}
                subValue="Weighted average"
              />
              <StatCard 
                label="Max Drawdown" 
                value={`$${Math.abs(stats.maxDD).toLocaleString(undefined, {maximumFractionDigits: 0})}`}
                icon={<ArrowDown size={16} />}
                color="text-red-500"
                subValue="Peak to valley"
              />
              <StatCard 
                label="Total Trades" 
                value={stats.trades.toLocaleString()}
                icon={<FileText size={16} />}
                color="text-zinc-300"
                subValue="Execution count"
              />
            </div>

            {/* Table Section */}
            <div className="bg-zinc-950/50 border border-zinc-900 rounded-xl overflow-hidden shadow-2xl">
              <div className="px-6 py-4 border-b border-zinc-900 flex items-center justify-between">
                <h3 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-2">
                  <Table size={12} />
                  Detailed Iterations ({filteredData.length})
                </h3>
                <div className="flex gap-2">
                  <button className="p-1.5 hover:bg-zinc-900 rounded text-zinc-500 hover:text-zinc-300 transition-all">
                    <Filter size={14} />
                  </button>
                  <button className="p-1.5 hover:bg-zinc-900 rounded text-zinc-500 hover:text-zinc-300 transition-all">
                    <Download size={14} />
                  </button>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-right text-[11px] border-collapse">
                  <thead>
                    <tr className="bg-zinc-900/20 text-zinc-500 uppercase tracking-wider font-bold border-b border-zinc-900">
                      {Object.keys(data[0]).map((key, i) => (
                        <th key={i} className="px-4 py-3 font-semibold">{key}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredData.slice(0, 100).map((row, i) => (
                      <tr key={i} className="border-b border-zinc-900/50 hover:bg-blue-500/5 transition-colors group">
                        {Object.values(row).map((val, j) => {
                          const isProfit = String(val).startsWith('$') || !isNaN(parseFloat(val)) && j === 1; // Simplistic check
                          return (
                            <td key={j} className={`px-4 py-2.5 font-mono ${typeof val === 'number' ? 'text-zinc-300' : 'text-zinc-500 group-hover:text-zinc-300'}`}>
                              {val}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filteredData.length > 100 && (
                  <div className="p-4 text-center text-zinc-600 text-[10px] uppercase tracking-widest border-t border-zinc-900">
                    Showing first 100 results out of {filteredData.length}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
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

export default ReportAnalyzer;
