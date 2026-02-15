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
    /// F1 - MACD Cross Above Signal + Volume Above Average + Stop Loss + Trailing Stop
    /// תואם לאסטרטגיה F1 ב-SYSTEM ALPHA
    /// Entry: MACD חוצה מעל Signal + נפח מעל ממוצע (period 20)
    /// Exit: Stop Loss 80 ticks + Trailing Stop (trigger 100 ticks, distance 80 ticks)
    /// </summary>
    public class F1 : Strategy
    {
        #region Indicators
        private MACD macdIndicator;
        #endregion

        #region Internal State
        private double entryPrice;
        private double maxHighSinceEntry;
        private double currentTrailingStop;
        private bool trailingStopActivated;
        #endregion

        #region Parameters
        [NinjaScriptProperty]
        [Display(Name = "Enable", Order = 1, GroupName = "1. MACD Cross (Entry)")]
        public bool EnableMACDCrossEntry { get; set; } = true;

        [NinjaScriptProperty]
        [Display(Name = "Enable", Order = 1, GroupName = "2. Volume Above Avg")]
        public bool EnableVolumeAboveAvg { get; set; } = true;

        [NinjaScriptProperty]
        [Range(1, 200)]
        [Display(Name = "Volume Period", Order = 2, GroupName = "2. Volume Above Avg")]
        public int VolumePeriod { get; set; } = 20;

        [NinjaScriptProperty]
        [Display(Name = "Enable", Order = 1, GroupName = "3. Stop Loss")]
        public bool EnableStopLoss { get; set; } = true;

        [NinjaScriptProperty]
        [Range(1, 5000)]
        [Display(Name = "Stop Loss (Ticks)", Order = 2, GroupName = "3. Stop Loss")]
        public int SLTicks { get; set; } = 80;

        [NinjaScriptProperty]
        [Display(Name = "Enable", Order = 1, GroupName = "4. Trailing Stop")]
        public bool EnableTrailingStop { get; set; } = true;

        [NinjaScriptProperty]
        [Range(1, 5000)]
        [Display(Name = "Trigger (Ticks)", Order = 2, GroupName = "4. Trailing Stop")]
        public int TrailingTriggerTicks { get; set; } = 100;

        [NinjaScriptProperty]
        [Range(1, 5000)]
        [Display(Name = "Distance (Ticks)", Order = 3, GroupName = "4. Trailing Stop")]
        public int TrailingDistanceTicks { get; set; } = 80;
        #endregion

        protected override void OnStateChange()
        {
            if (State == State.SetDefaults)
            {
                Description = "F1 - MACD + Volume + SL + Trailing Stop (SYSTEM ALPHA)";
                Name = "F1";
                Calculate = Calculate.OnBarClose;
                IsExitOnSessionCloseStrategy = false;
                DefaultQuantity = 1;
                EntryHandling = EntryHandling.AllEntries;
                EntriesPerDirection = 1;
            }
            else if (State == State.DataLoaded)
            {
                macdIndicator = MACD(12, 26, 9);
                AddChartIndicator(macdIndicator);

                // NinjaTrader built-in Stop Loss (intrabar execution)
                if (EnableStopLoss)
                    SetStopLoss(CalculationMode.Ticks, SLTicks);

                // Reset trailing state
                ResetTrailingState();
            }
        }

        protected override void OnBarUpdate()
        {
            if (CurrentBar < 35) return; // MACD needs ~26+9 bars, plus volume lookback
            if (BarsInProgress != 0) return;

            if (Position.MarketPosition == MarketPosition.Long)
            {
                ProcessTrailingStop();
            }
            else
            {
                ProcessLongEntry();
            }
        }

        private bool IsMACDCrossAboveSignal()
        {
            if (!EnableMACDCrossEntry) return true;
            if (CurrentBar < 2) return false;
            // MACD cross above Signal = Diff (histogram) crosses above 0
            // Diff[1] <= 0 (previous bar: MACD <= Signal)
            // Diff[0] > 0  (current bar: MACD > Signal)
            return macdIndicator.Diff[1] <= 0 && macdIndicator.Diff[0] > 0;
        }

        private bool IsVolumeAboveAverage()
        {
            if (!EnableVolumeAboveAvg) return true;
            if (CurrentBar < VolumePeriod + 1) return false;

            // Calculate average volume using PREVIOUS bars only (not including current bar)
            // This matches SYSTEM_ALPHA: for (let i = 1; i <= period; i++) totalVolume += volData[volIndex - i].volume
            double volSum = 0;
            for (int i = 1; i <= VolumePeriod; i++)
                volSum += Volume[i];
            double volAvg = volSum / VolumePeriod;

            return Volume[0] > volAvg;
        }

        private void ProcessLongEntry()
        {
            if (Position.MarketPosition != MarketPosition.Flat) return;
            if (!IsMACDCrossAboveSignal()) return;
            if (!IsVolumeAboveAverage()) return;

            EnterLong("F1_Long_Entry");
        }

        private void ProcessTrailingStop()
        {
            if (!EnableTrailingStop) return;
            if (Position.MarketPosition != MarketPosition.Long) return;

            // On first bar after entry, initialize tracking
            if (entryPrice == 0)
            {
                entryPrice = Position.AveragePrice;
                maxHighSinceEntry = High[0];
                currentTrailingStop = 0;
                trailingStopActivated = false;
            }

            // Track maximum high since entry
            if (High[0] > maxHighSinceEntry)
                maxHighSinceEntry = High[0];

            double tickSize = Instrument.MasterInstrument.TickSize;
            double triggerPrice = entryPrice + (TrailingTriggerTicks * tickSize);

            // Check if trailing stop should be activated/updated
            if (maxHighSinceEntry >= triggerPrice)
            {
                double newStopPrice = maxHighSinceEntry - (TrailingDistanceTicks * tickSize);

                // Only move stop up, never down (or set initial)
                if (currentTrailingStop == 0 || newStopPrice > currentTrailingStop)
                {
                    currentTrailingStop = newStopPrice;
                    trailingStopActivated = true;
                }
            }

            // Exit if price hits trailing stop
            // Note: The built-in SetStopLoss handles the fixed SL intrabar.
            // The trailing stop here works OnBarClose - it checks Low[0] vs trailing level.
            // SYSTEM_ALPHA checks intrabar (candle.low <= stopPrice), same logic.
            if (trailingStopActivated && currentTrailingStop > 0 && Low[0] <= currentTrailingStop)
            {
                ExitLong("F1_Trailing_Stop", "F1_Long_Entry");
                ResetTrailingState();
            }
        }

        protected override void OnPositionUpdate(Cbi.Position position, double averagePrice, int quantity, Cbi.MarketPosition marketPosition)
        {
            // Reset trailing state when position closes (including SL hits)
            if (marketPosition == MarketPosition.Flat)
            {
                ResetTrailingState();
            }
        }

        private void ResetTrailingState()
        {
            entryPrice = 0;
            maxHighSinceEntry = 0;
            currentTrailingStop = 0;
            trailingStopActivated = false;
        }
    }
}
