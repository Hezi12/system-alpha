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
    /// E1 - שינוי יומי % + MACD Cross
    /// תואם לאסטרטגיה E1 ב-SYSTEM ALPHA
    /// תנאי שינוי יומי: השינוי מהסגירה של היום הקודם בטווח min%-max%
    /// </summary>
    public class E1 : Strategy
    {
        #region Indicators
        private MACD macdIndicator;
        private PriorDayOHLC priorDayOHLC;
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
        [Display(Name = "Enable", Order = 1, GroupName = "2. Daily Change %")]
        public bool EnableDailyChangeFilter { get; set; } = true;

        [NinjaScriptProperty]
        [Range(-100, 100)]
        [Display(Name = "Min %", Order = 2, GroupName = "2. Daily Change %")]
        public double DailyChangeMinPercent { get; set; } = -2.1;

        [NinjaScriptProperty]
        [Range(-100, 100)]
        [Display(Name = "Max %", Order = 3, GroupName = "2. Daily Change %")]
        public double DailyChangeMaxPercent { get; set; } = 10.0;

        [NinjaScriptProperty]
        [Display(Name = "Enable", Order = 1, GroupName = "3. MACD Cross (Entry)")]
        public bool EnableMACDCrossEntry { get; set; } = true;

        [NinjaScriptProperty]
        [Display(Name = "Enable", Order = 1, GroupName = "4. MACD Cross (Exit)")]
        public bool EnableMACDCrossExit { get; set; } = true;

        [NinjaScriptProperty]
        [Display(Name = "Enable", Order = 1, GroupName = "5. Risk")]
        public bool EnableStopLoss { get; set; } = true;

        [NinjaScriptProperty]
        [Range(1, 2000)]
        [Display(Name = "Stop Loss (Ticks)", Order = 2, GroupName = "5. Risk")]
        public int SLTicks { get; set; } = 80;

        [NinjaScriptProperty]
        [Display(Name = "Enable TP", Order = 3, GroupName = "5. Risk")]
        public bool EnableTakeProfit { get; set; } = true;

        [NinjaScriptProperty]
        [Range(1, 5000)]
        [Display(Name = "Take Profit (Ticks)", Order = 4, GroupName = "5. Risk")]
        public int TPTicks { get; set; } = 160;
        #endregion

        protected override void OnStateChange()
        {
            if (State == State.SetDefaults)
            {
                Description = "E1 - שינוי יומי % + MACD Cross (SYSTEM ALPHA)";
                Name = "E1";
                Calculate = Calculate.OnBarClose;
                IsExitOnSessionCloseStrategy = false;
                DefaultQuantity = 1;
                EntryHandling = EntryHandling.AllEntries;
                EntriesPerDirection = 1;
            }
            else if (State == State.DataLoaded)
            {
                macdIndicator = MACD(12, 26, 9);
                priorDayOHLC = PriorDayOHLC();
                if (EnableStopLoss) SetStopLoss(CalculationMode.Ticks, SLTicks);
                if (EnableTakeProfit) SetProfitTarget(CalculationMode.Ticks, TPTicks);
                AddChartIndicator(macdIndicator);
            }
        }

        protected override void OnBarUpdate()
        {
            if (CurrentBar < 35) return;
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

        private bool IsDailyChangeInRange()
        {
            if (!EnableDailyChangeFilter) return true;
            // PriorDayOHLC: PriorClose = סגירת היום הקודם
            double priorClose = priorDayOHLC.PriorClose[0];
            if (priorClose <= 0) return true; // אין נתונים – לא מסננים
            double changePercent = (Close[0] - priorClose) / priorClose * 100.0;
            return changePercent >= DailyChangeMinPercent && changePercent <= DailyChangeMaxPercent;
        }

        private bool IsMACDCrossAboveSignal()
        {
            if (!EnableMACDCrossEntry) return true;
            if (CurrentBar < 2) return false;
            return macdIndicator.Diff[1] <= 0 && macdIndicator.Diff[0] > 0;
        }

        private void ProcessLongEntry()
        {
            if (Position.MarketPosition != MarketPosition.Flat) return;
            if (!IsWithinEntryTimeWindow()) return;
            if (!IsDailyChangeInRange()) return;
            if (!IsMACDCrossAboveSignal()) return;

            EnterLong("E1_Long_Entry");
        }

        private void ProcessLongExit()
        {
            if (Position.MarketPosition != MarketPosition.Long) return;

            if (EnableMACDCrossExit && CurrentBar >= 2 && macdIndicator.Diff[1] >= 0 && macdIndicator.Diff[0] < 0)
            {
                ExitLong("E1_Long_Exit", "E1_Long_Entry");
            }
        }
    }
}
