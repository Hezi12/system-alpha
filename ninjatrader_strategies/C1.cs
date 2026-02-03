#region Using declarations
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.ComponentModel.DataAnnotations;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Input;
using System.Windows.Media;
using System.Xml.Serialization;
using NinjaTrader.Cbi;
using NinjaTrader.Gui;
using NinjaTrader.Gui.Chart;
using NinjaTrader.Gui.SuperDom;
using NinjaTrader.Gui.Tools;
using NinjaTrader.Data;
using NinjaTrader.NinjaScript;
using NinjaTrader.Core.FloatingPoint;
using NinjaTrader.NinjaScript.Indicators;
using NinjaTrader.NinjaScript.DrawingTools;
#endregion

namespace NinjaTrader.NinjaScript.Strategies.Build
{
    /// <summary>
    /// C1 - MACD Cross + EMA + ATR + Volume
    /// תואם לאסטרטגיה C1 ב-SYSTEM ALPHA - כיסוי ספרייה (תנאים חדשים)
    /// </summary>
    public class C1 : Strategy
    {
        #region Indicators
        private MACD macdIndicator;
        private EMA emaIndicator;
        private ATR atrIndicator;
        #endregion

        #region Parameters
        [NinjaScriptProperty]
        [Display(Name = "Enable", Order = 1, GroupName = "1. Time")]
        public bool EnableTimeFilter { get; set; } = true;

        [NinjaScriptProperty]
        [Range(0, 2359)]
        [Display(Name = "Start (HHmm)", Order = 2, GroupName = "1. Time")]
        public int EntryStartTime { get; set; } = 830;

        [NinjaScriptProperty]
        [Range(0, 2359)]
        [Display(Name = "End (HHmm)", Order = 3, GroupName = "1. Time")]
        public int EntryEndTime { get; set; } = 1340;

        [NinjaScriptProperty]
        [Display(Name = "Enable", Order = 1, GroupName = "2. MACD Cross (Entry)")]
        public bool EnableMACDCrossEntry { get; set; } = true;

        [NinjaScriptProperty]
        [Display(Name = "Enable", Order = 1, GroupName = "3. Price Above EMA")]
        public bool EnablePriceAboveEMA { get; set; } = true;

        [NinjaScriptProperty]
        [Range(1, 100)]
        [Display(Name = "EMA Period", Order = 2, GroupName = "3. Price Above EMA")]
        public int EMAPeriod { get; set; } = 20;

        [NinjaScriptProperty]
        [Display(Name = "Enable", Order = 1, GroupName = "4. ATR Range")]
        public bool EnableATRRange { get; set; } = true;

        [NinjaScriptProperty]
        [Range(1, 100)]
        [Display(Name = "ATR Period", Order = 2, GroupName = "4. ATR Range")]
        public int ATRPeriod { get; set; } = 30;

        [NinjaScriptProperty]
        [Range(0.1, 200)]
        [Display(Name = "ATR Min", Order = 3, GroupName = "4. ATR Range")]
        public double ATRMin { get; set; } = 12.0;

        [NinjaScriptProperty]
        [Range(0.1, 200)]
        [Display(Name = "ATR Max", Order = 4, GroupName = "4. ATR Range")]
        public double ATRMax { get; set; } = 55.0;

        [NinjaScriptProperty]
        [Display(Name = "Enable", Order = 1, GroupName = "5. Volume Above Avg")]
        public bool EnableVolumeAboveAvg { get; set; } = true;

        [NinjaScriptProperty]
        [Range(1, 200)]
        [Display(Name = "Volume Period", Order = 2, GroupName = "5. Volume Above Avg")]
        public int VolumePeriod { get; set; } = 20;

        [NinjaScriptProperty]
        [Display(Name = "Enable", Order = 1, GroupName = "6. Candle Body Min Ticks")]
        public bool EnableCandleBodyMinTicks { get; set; } = true;

        [NinjaScriptProperty]
        [Range(1, 1000)]
        [Display(Name = "Min Body Ticks", Order = 2, GroupName = "6. Candle Body Min Ticks")]
        public int MinBodyTicks { get; set; } = 20;

        [NinjaScriptProperty]
        [Display(Name = "Enable", Order = 1, GroupName = "7. MACD Cross (Exit)")]
        public bool EnableMACDCrossExit { get; set; } = true;

        [NinjaScriptProperty]
        [Display(Name = "Enable", Order = 1, GroupName = "8. Risk")]
        public bool EnableStopLoss { get; set; } = true;

        [NinjaScriptProperty]
        [Range(1, 2000)]
        [Display(Name = "Stop Loss (Ticks)", Order = 2, GroupName = "8. Risk")]
        public int SLTicks { get; set; } = 80;

        [NinjaScriptProperty]
        [Display(Name = "Enable TP", Order = 3, GroupName = "8. Risk")]
        public bool EnableTakeProfit { get; set; } = true;

        [NinjaScriptProperty]
        [Range(1, 5000)]
        [Display(Name = "Take Profit (Ticks)", Order = 4, GroupName = "8. Risk")]
        public int TPTicks { get; set; } = 160;
        #endregion

        protected override void OnStateChange()
        {
            if (State == State.SetDefaults)
            {
                Description = "C1 - MACD Cross + EMA + ATR + Volume (SYSTEM ALPHA Library)";
                Name = "C1";
                Calculate = Calculate.OnBarClose;
                IsExitOnSessionCloseStrategy = false;
                DefaultQuantity = 1;
                EntryHandling = EntryHandling.AllEntries;
                EntriesPerDirection = 1;
            }
            else if (State == State.DataLoaded)
            {
                macdIndicator = MACD(12, 26, 9);
                emaIndicator = EMA(EMAPeriod);
                atrIndicator = ATR(ATRPeriod);
                if (EnableStopLoss) SetStopLoss(CalculationMode.Ticks, SLTicks);
                if (EnableTakeProfit) SetProfitTarget(CalculationMode.Ticks, TPTicks);
                AddChartIndicator(macdIndicator);
                AddChartIndicator(emaIndicator);
                AddChartIndicator(atrIndicator);
            }
        }

        protected override void OnBarUpdate()
        {
            if (CurrentBar < Math.Max(26, Math.Max(EMAPeriod, ATRPeriod)) + VolumePeriod) return;
            if (BarsInProgress != 0) return;

            ProcessLongEntry();
            ProcessLongExit();
        }

        private bool IsWithinEntryTimeWindow()
        {
            if (!EnableTimeFilter) return true;
            int timeOfDay = Time[0].Hour * 100 + Time[0].Minute;
            return timeOfDay >= EntryStartTime && timeOfDay <= EntryEndTime;
        }

        private bool IsEntrySignalTriggered()
        {
            // 1. MACD crosses above Signal = Histogram (Diff) crosses above 0. [0] is Macd line, use .Diff
            if (EnableMACDCrossEntry && (macdIndicator.Diff[1] > 0 || macdIndicator.Diff[0] <= 0)) return false;

            // 2. Price above EMA
            if (EnablePriceAboveEMA && Close[0] <= emaIndicator[0]) return false;

            // 3. ATR in range
            if (EnableATRRange)
            {
                double atrVal = atrIndicator[0];
                double atrLo = Math.Min(ATRMin, ATRMax);
                double atrHi = Math.Max(ATRMin, ATRMax);
                if (atrVal < atrLo || atrVal > atrHi) return false;
            }

            // 4. Volume above average (previous bars only, exclude current)
            if (EnableVolumeAboveAvg)
            {
                double volSum = 0;
                for (int i = 1; i <= VolumePeriod; i++)
                    volSum += Volume[i];
                double volAvg = volSum / VolumePeriod;
                if (Volume[0] <= volAvg) return false;
            }

            // 5. Candle body min ticks
            if (EnableCandleBodyMinTicks)
            {
                double tickSize = Instrument.MasterInstrument.TickSize;
                double bodyTicks = Math.Abs(Close[0] - Open[0]) / tickSize;
                if (bodyTicks < MinBodyTicks) return false;
            }

            return true;
        }

        private void ProcessLongEntry()
        {
            if (Position.MarketPosition != MarketPosition.Flat) return;
            if (!IsWithinEntryTimeWindow()) return;
            if (!IsEntrySignalTriggered()) return;

            EnterLong("C1_Long_Entry");
        }

        private void ProcessLongExit()
        {
            if (Position.MarketPosition != MarketPosition.Long) return;

            // MACD crosses below Signal = Histogram (Diff) crosses below 0. Use .Diff
            if (EnableMACDCrossExit && CurrentBar >= 2 && macdIndicator.Diff[1] >= 0 && macdIndicator.Diff[0] < 0)
            {
                ExitLong("C1_Long_Exit", "C1_Long_Entry");
            }
        }
    }
}
