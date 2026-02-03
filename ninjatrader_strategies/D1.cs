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
    /// D1 - MACD בלבד (בדיקת פער)
    /// אסטרטגיה מינימלית: טווח זמן + MACD חוצה מעל Signal + SL + TP
    /// להשוואה עם SYSTEM ALPHA לאיתור מקור הפער
    /// </summary>
    public class D1 : Strategy
    {
        #region Indicators
        private MACD macdIndicator;
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
        [Display(Name = "Enable", Order = 1, GroupName = "3. Risk")]
        public bool EnableStopLoss { get; set; } = true;

        [NinjaScriptProperty]
        [Range(1, 2000)]
        [Display(Name = "Stop Loss (Ticks)", Order = 2, GroupName = "3. Risk")]
        public int SLTicks { get; set; } = 80;

        [NinjaScriptProperty]
        [Display(Name = "Enable TP", Order = 3, GroupName = "3. Risk")]
        public bool EnableTakeProfit { get; set; } = true;

        [NinjaScriptProperty]
        [Range(1, 5000)]
        [Display(Name = "Take Profit (Ticks)", Order = 4, GroupName = "3. Risk")]
        public int TPTicks { get; set; } = 160;
        #endregion

        protected override void OnStateChange()
        {
            if (State == State.SetDefaults)
            {
                Description = "D1 - MACD בלבד (בדיקת פער NinjaTrader vs SYSTEM ALPHA)";
                Name = "D1";
                Calculate = Calculate.OnBarClose;
                IsExitOnSessionCloseStrategy = false;
                DefaultQuantity = 1;
                EntryHandling = EntryHandling.AllEntries;
                EntriesPerDirection = 1;
            }
            else if (State == State.DataLoaded)
            {
                macdIndicator = MACD(12, 26, 9);
                if (EnableStopLoss) SetStopLoss(CalculationMode.Ticks, SLTicks);
                if (EnableTakeProfit) SetProfitTarget(CalculationMode.Ticks, TPTicks);
                AddChartIndicator(macdIndicator);
            }
        }

        protected override void OnBarUpdate()
        {
            if (CurrentBar < 35) return; // MACD needs ~26+9 bars
            if (BarsInProgress != 0) return;

            ProcessLongEntry();
        }

        private bool IsWithinEntryTimeWindow()
        {
            if (!EnableTimeFilter) return true;
            int timeOfDay = Time[0].Hour * 100 + Time[0].Minute;
            return timeOfDay >= EntryStartTime && timeOfDay <= EntryEndTime;
        }

        private bool IsMACDCrossAboveSignal()
        {
            if (!EnableMACDCrossEntry) return true;
            // MACD cross above Signal = Histogram (Diff) crosses above 0. Default [0] returns Macd line, not Diff!
            if (CurrentBar < 2) return false;
            return macdIndicator.Diff[1] <= 0 && macdIndicator.Diff[0] > 0;
        }

        private void ProcessLongEntry()
        {
            if (Position.MarketPosition != MarketPosition.Flat) return;
            if (!IsWithinEntryTimeWindow()) return;
            if (!IsMACDCrossAboveSignal()) return;

            EnterLong("D1_Long_Entry");
        }
    }
}
