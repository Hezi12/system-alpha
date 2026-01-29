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

  const parseCurrency = (val) => {
    if (typeof val === 'number') return val;
    if (!val) return 0;
    let str = String(val).replace(/[$,]/g, '');
    if (str.includes('(') && str.includes(')')) {
      str = '-' + str.replace(/[()]/g, '');
    }
    return parseFloat(str) || 0;
  };

  const excelDateToJS = (serial) => {
    if (typeof serial !== 'number') return String(serial);
    const utc_days  = Math.floor(serial - 25569);
    const utc_value = utc_days * 86400;
    const date_info = new Date(utc_value * 1000);

    const fractional_day = serial - Math.floor(serial) + 0.0000001;
    let total_seconds = Math.floor(86400 * fractional_day);

    const seconds = total_seconds % 60;
    total_seconds -= seconds;

    const hours = Math.floor(total_seconds / (60 * 60));
    const minutes = Math.floor(total_seconds / 60) % 60;

    return new Date(date_info.getFullYear(), date_info.getMonth(), date_info.getDate(), hours, minutes, seconds).toLocaleString('he-IL', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setLoading(true);
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const bstr = evt.target.result;
        const wb = XLSX.read(bstr, { type: 'binary', cellDates: false });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const rawJson = XLSX.utils.sheet_to_json(ws, { defval: "" });
        
        // נרמול הנתונים לפי התמונה של המשתמש
        const normalizedData = rawJson.map(row => {
          const entryTime = row['Entry time'] || row['Entry Time'] || "";
          const exitTime = row['Exit time'] || row['Exit Time'] || "";
          const profit = parseCurrency(row['Profit'] || 0);
          
          return {
            ...row,
            'Entry time': typeof entryTime === 'number' ? excelDateToJS(entryTime) : entryTime,
            'Exit time': typeof exitTime === 'number' ? excelDateToJS(exitTime) : exitTime,
            'Profit': profit,
            'Market pos.': row['Market pos.'] || row['Market Pos.'] || "",
            'Cumulative': parseCurrency(row['Cum. net profit'] || row['Cumulative Profit'] || 0)
          };
        });

        setData(normalizedData);
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
    let winningTrades = 0;
    let totalTrades = data.length;
    let grossProfit = 0;
    let grossLoss = 0;
    let maxDD = 0;
    let peak = 0;
    let currentEquity = 0;

    data.forEach(row => {
      const p = row['Profit'];
      totalNetProfit += p;
      if (p > 0) {
        winningTrades++;
        grossProfit += p;
      } else {
        grossLoss += Math.abs(p);
      }

      currentEquity += p;
      if (currentEquity > peak) peak = currentEquity;
      const dd = peak - currentEquity;
      if (dd > maxDD) maxDD = dd;
    });

    return {
      netProfit: totalNetProfit,
      trades: totalTrades,
      winRate: (winningTrades / totalTrades * 100),
      profitFactor: grossLoss > 0 ? (grossProfit / grossLoss) : (grossProfit > 0 ? 100 : 0),
      maxDD: maxDD,
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
                      <th className="px-4 py-3 font-semibold">Trade #</th>
                      <th className="px-4 py-3 font-semibold">Strategy</th>
                      <th className="px-4 py-3 font-semibold text-center">Pos</th>
                      <th className="px-4 py-3 font-semibold">Entry Time</th>
                      <th className="px-4 py-3 font-semibold">Exit Time</th>
                      <th className="px-4 py-3 font-semibold">Entry Price</th>
                      <th className="px-4 py-3 font-semibold">Exit Price</th>
                      <th className="px-4 py-3 font-semibold text-left">Profit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredData.slice(0, 500).map((row, i) => {
                      const p = row['Profit'];
                      const isLong = (row['Market pos.'] || "").toLowerCase().includes('long');
                      return (
                        <tr key={i} className="border-b border-zinc-900/50 hover:bg-blue-500/5 transition-colors group">
                          <td className="px-4 py-2.5 font-mono text-zinc-500">{row['Trade number'] || i + 1}</td>
                          <td className="px-4 py-2.5 font-medium text-zinc-300">{row['Strategy']}</td>
                          <td className="px-4 py-2.5 text-center">
                            <span className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase ${isLong ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'}`}>
                              {row['Market pos.']}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 font-mono text-zinc-400">{row['Entry time']}</td>
                          <td className="px-4 py-2.5 font-mono text-zinc-400">{row['Exit time']}</td>
                          <td className="px-4 py-2.5 font-mono text-zinc-300">{row['Entry price']}</td>
                          <td className="px-4 py-2.5 font-mono text-zinc-300">{row['Exit price']}</td>
                          <td className={`px-4 py-2.5 font-mono font-bold text-left ${p >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                            {p >= 0 ? `$${p.toLocaleString()}` : `-$${Math.abs(p).toLocaleString()}`}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {filteredData.length > 500 && (
                  <div className="p-4 text-center text-zinc-600 text-[10px] uppercase tracking-widest border-t border-zinc-900">
                    Showing first 500 results out of {filteredData.length}
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
