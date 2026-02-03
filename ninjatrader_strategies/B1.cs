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
    /// B1 - RSI Oversold + ADX + Volume Spike + Pullback
    /// תואם לאסטרטגיה B1 ב-SYSTEM ALPHA
    /// </summary>
    public class B1 : Strategy
    {
        #region Technical Indicators
        private RSI rsiIndicator;
        private ADX adxIndicator;
        #endregion

        #region Parameters
        [NinjaScriptProperty]
        [Display(Name = "Enable Time Filter", Order = 1, GroupName = "1. Time")]
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
        [Range(1, 100)]
        [Display(Name = "RSI Period", Order = 1, GroupName = "2. RSI")]
        public int RSIPeriod { get; set; } = 14;

        [NinjaScriptProperty]
        [Range(0, 100)]
        [Display(Name = "RSI Entry (below)", Order = 2, GroupName = "2. RSI")]
        public double RSIEntryLevel { get; set; } = 30.0;

        [NinjaScriptProperty]
        [Range(0, 100)]
        [Display(Name = "RSI Exit (above)", Order = 3, GroupName = "2. RSI")]
        public double RSIExitLevel { get; set; } = 68.0;

        [NinjaScriptProperty]
        [Range(1, 100)]
        [Display(Name = "ADX Period", Order = 1, GroupName = "3. ADX")]
        public int ADXPeriod { get; set; } = 14;

        [NinjaScriptProperty]
        [Range(0, 100)]
        [Display(Name = "ADX Min", Order = 2, GroupName = "3. ADX")]
        public double ADXMin { get; set; } = 18.0;

        [NinjaScriptProperty]
        [Range(0, 100)]
        [Display(Name = "ADX Max", Order = 3, GroupName = "3. ADX")]
        public double ADXMax { get; set; } = 55.0;

        [NinjaScriptProperty]
        [Range(1, 100)]
        [Display(Name = "Volume Period", Order = 1, GroupName = "4. Volume Spike")]
        public int VolumeSpikePeriod { get; set; } = 16;

        [NinjaScriptProperty]
        [Range(1.0, 10.0)]
        [Display(Name = "Volume Multiplier", Order = 2, GroupName = "4. Volume Spike")]
        public double VolumeSpikeMultiplier { get; set; } = 1.6;

        [NinjaScriptProperty]
        [Range(1, 50)]
        [Display(Name = "Min Red Candles", Order = 1, GroupName = "5. Pullback")]
        public int MinRedCandles { get; set; } = 2;

        [NinjaScriptProperty]
        [Range(1, 50)]
        [Display(Name = "Lookback", Order = 2, GroupName = "5. Pullback")]
        public int RedCandlesLookback { get; set; } = 6;

        [NinjaScriptProperty]
        [Range(1, 1000)]
        [Display(Name = "Bar Range Min (Ticks)", Order = 1, GroupName = "6. Bar Range")]
        public int BarRangeMinTicks { get; set; } = 15;

        [NinjaScriptProperty]
        [Range(1, 10000)]
        [Display(Name = "Bar Range Max (Ticks)", Order = 2, GroupName = "6. Bar Range")]
        public int BarRangeMaxTicks { get; set; } = 250;

        [NinjaScriptProperty]
        [Range(1, 2000)]
        [Display(Name = "Stop Loss (Ticks)", Order = 1, GroupName = "7. Risk")]
        public int SLTicks { get; set; } = 60;

        [NinjaScriptProperty]
        [Range(1, 5000)]
        [Display(Name = "Take Profit (Ticks)", Order = 2, GroupName = "7. Risk")]
        public int TPTicks { get; set; } = 120;
        #endregion

        protected override void OnStateChange()
        {
            if (State == State.SetDefaults)
            {
                Description = "B1 - RSI Oversold + ADX + Volume Spike + Pullback (SYSTEM ALPHA)";
                Name = "B1";
                Calculate = Calculate.OnBarClose;
                IsExitOnSessionCloseStrategy = false;
                DefaultQuantity = 1;
                EntryHandling = EntryHandling.AllEntries;
                EntriesPerDirection = 1;
            }
            else if (State == State.DataLoaded)
            {
                rsiIndicator = RSI(RSIPeriod, 1);  // 1 = RSI Type.Wilder
                adxIndicator = ADX(ADXPeriod);
                SetStopLoss(CalculationMode.Ticks, SLTicks);
                SetProfitTarget(CalculationMode.Ticks, TPTicks);
                AddChartIndicator(rsiIndicator);
                AddChartIndicator(adxIndicator);
            }
        }

        protected override void OnBarUpdate()
        {
            if (CurrentBar < Math.Max(RSIPeriod, ADXPeriod) + RedCandlesLookback) return;
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
            // 1. RSI below level (oversold)
            if (rsiIndicator[0] >= RSIEntryLevel) return false;

            // 2. ADX in range (trend strength)
            double adxVal = adxIndicator[0];
            if (adxVal < Math.Min(ADXMin, ADXMax) || adxVal > Math.Max(ADXMin, ADXMax)) return false;

            // 3. Green candle
            if (Close[0] <= Open[0]) return false;

            // 4. Volume spike - avg of previous bars only (excludes current), like NinjaTrader/SYSTEM_ALPHA
            double volumeSum = 0;
            for (int i = 1; i <= VolumeSpikePeriod; i++)
                volumeSum += Volume[i];
            double volumeAvg = volumeSum / VolumeSpikePeriod;
            if (Volume[0] < volumeAvg * VolumeSpikeMultiplier) return false;

            // 5. Min red candles in lookback (pullback)
            int redCount = 0;
            for (int i = 0; i < RedCandlesLookback; i++)
            {
                if (Close[i] < Open[i]) redCount++;
            }
            if (redCount < MinRedCandles) return false;

            // 6. Bar range in ticks
            double tickSize = Instrument.MasterInstrument.TickSize;
            double rangeTicks = (High[0] - Low[0]) / tickSize;
            if (rangeTicks < BarRangeMinTicks || rangeTicks > BarRangeMaxTicks) return false;

            return true;
        }

        private void ProcessLongEntry()
        {
            if (Position.MarketPosition != MarketPosition.Flat) return;
            if (!IsWithinEntryTimeWindow()) return;
            if (!IsEntrySignalTriggered()) return;

            EnterLong("B1_Long_Entry");
        }

        private void ProcessLongExit()
        {
            if (Position.MarketPosition != MarketPosition.Long) return;
            if (rsiIndicator[0] > RSIExitLevel)
            {
                ExitLong("B1_Long_Exit", "B1_Long_Entry");
            }
        }
    }
}
