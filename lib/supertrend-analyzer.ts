import { format } from "date-fns";

export interface MonthlyCandle {
  date: string;       // YYYY-MM-DD
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MonthlyVolumeStats {
  date: string;
  close: number;
  high: number;
  volume: number;
  volRatio: number;
}

export interface MonthlyAnalysis {
  symbol: string;
  name: string;
  ltp: number;
  change1mPct: number;

  // Core breakout condition
  latestClose: number;
  prevMonthHigh: number;
  closeAbovePrevHigh: boolean;

  // Supertrend 9,2
  supertrend: number;
  atr: number;
  trend: "up" | "down";
  priceAboveSupertrend: boolean;

  // Volume analysis
  latestVolume: number;
  avgVolume12m: number;
  volRatio: number; // latest / 12m avg

  // Fresh Buy signal
  isFreshBuy: boolean; // closeAbovePrevHigh && priceAboveSupertrend

  // Extra context
  recentCandles: MonthlyCandle[];
  last12Months: MonthlyVolumeStats[];
  chartData: Array<{
    date: string;
    close: number;
    supertrend: number | null;
    volume: number;
  }>;

  lastUpdated: string;
  monthsAnalyzed: number;
}

export interface AnalyzeOptions {
  atrPeriod?: number;      // 9
  multiplier?: number;     // 2
  minMonths?: number;      // 20 recommended
  volAvgMonths?: number;   // 12
}

function mean(arr: number[]): number {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function pct(n: number): number {
  return Number(n.toFixed(2));
}

function trueRange(c: MonthlyCandle, prevClose: number): number {
  return Math.max(
    c.high - c.low,
    Math.abs(c.high - prevClose),
    Math.abs(c.low - prevClose)
  );
}

function calculateATR(candles: MonthlyCandle[], period: number): number[] {
  const n = candles.length;
  const atr: number[] = new Array(n).fill(0);

  if (n === 0) return atr;

  let sumTR = 0;

  for (let i = 0; i < n; i++) {
    const tr = i === 0
      ? (candles[i].high - candles[i].low)
      : trueRange(candles[i], candles[i - 1].close);

    if (i < period) {
      sumTR += tr;
      atr[i] = sumTR / (i + 1);
    } else {
      // Wilder's / RMA smoothing
      atr[i] = (atr[i - 1] * (period - 1) + tr) / period;
    }
  }
  return atr;
}

function calculateSupertrendSeries(
  candles: MonthlyCandle[],
  atrPeriod: number,
  multiplier: number
): { supertrend: number[]; trend: ("up" | "down" | null)[]; atr: number[] } {
  const n = candles.length;
  const atr = calculateATR(candles, atrPeriod);

  const supertrend: number[] = new Array(n).fill(NaN);
  const trend: ("up" | "down" | null)[] = new Array(n).fill(null);

  if (n <= atrPeriod) {
    return { supertrend, trend, atr };
  }

  let finalUpper = 0;
  let finalLower = 0;
  let prevSuper = 0;

  for (let i = atrPeriod; i < n; i++) {
    const c = candles[i];
    const currAtr = atr[i];
    const hl2 = (c.high + c.low) / 2;

    const basicUpper = hl2 + multiplier * currAtr;
    const basicLower = hl2 - multiplier * currAtr;

    if (i === atrPeriod) {
      if (c.close <= basicUpper) {
        finalUpper = basicUpper;
        finalLower = basicLower;
        supertrend[i] = basicUpper;
        trend[i] = "down";
      } else {
        finalUpper = basicUpper;
        finalLower = basicLower;
        supertrend[i] = basicLower;
        trend[i] = "up";
      }
      prevSuper = supertrend[i];
      continue;
    }

    const prevClose = candles[i - 1].close;

    const wasUsingUpper = prevSuper === finalUpper || (prevSuper > 0 && prevClose <= prevSuper);

    let newFinalUpper: number;
    let newFinalLower: number;

    if (wasUsingUpper) {
      newFinalUpper = Math.min(basicUpper, finalUpper);
      newFinalLower = basicLower;
    } else {
      newFinalUpper = basicUpper;
      newFinalLower = Math.max(basicLower, finalLower);
    }

    let st: number;
    let t: "up" | "down";

    if (prevSuper === finalUpper) {
      if (c.close > newFinalUpper) {
        st = newFinalLower;
        t = "up";
      } else {
        st = newFinalUpper;
        t = "down";
      }
    } else {
      if (c.close < newFinalLower) {
        st = newFinalUpper;
        t = "down";
      } else {
        st = newFinalLower;
        t = "up";
      }
    }

    supertrend[i] = Number(st.toFixed(2));
    trend[i] = t;
    finalUpper = newFinalUpper;
    finalLower = newFinalLower;
    prevSuper = st;
  }

  return { supertrend, trend, atr };
}

export function analyzeMonthlySupertrend(
  symbol: string,
  name: string,
  ltp: number,
  candles: MonthlyCandle[],
  options: AnalyzeOptions = {}
): MonthlyAnalysis {
  const {
    atrPeriod = 9,
    multiplier = 2,
    minMonths = 20,
    volAvgMonths = 12,
  } = options;

  if (!candles || candles.length < minMonths) {
    return emptyAnalysis(symbol, name, ltp, `Need ≥${minMonths} months of data`);
  }

  const latest = candles[candles.length - 1];
  const prev = candles[candles.length - 2];

  const latestClose = latest.close;
  const prevMonthHigh = prev.high;

  const closeAbovePrevHigh = latestClose > prevMonthHigh;

  const { supertrend: stSeries, trend: trendSeries, atr: atrSeries } =
    calculateSupertrendSeries(candles, atrPeriod, multiplier);

  const latestST = stSeries[candles.length - 1];
  const latestTrend = trendSeries[candles.length - 1] ?? "up";
  const latestAtr = atrSeries[candles.length - 1] ?? 0;

  if (!latestST || isNaN(latestST)) {
    return emptyAnalysis(symbol, name, ltp, "Insufficient data for Supertrend(9,2)");
  }

  const priceForComparison = (ltp && ltp > 0) ? ltp : latestClose;
  const priceAboveSupertrend = priceForComparison > latestST;

  // Volume analysis (12-month baseline excluding latest)
  const volSeries = candles.map(c => c.volume);
  let baseline = volSeries.slice(-volAvgMonths - 1, -1);
  if (baseline.length < 6) baseline = volSeries.slice(-volAvgMonths);
  const avgVolume12m = baseline.length > 0 ? mean(baseline) : mean(volSeries.slice(0, -1)) || 1;

  const latestVolume = latest.volume || 0;
  const volRatio = avgVolume12m > 0 ? Number((latestVolume / avgVolume12m).toFixed(2)) : 0;

  const change1mPct = pct(((latestClose - prev.close) / prev.close) * 100);

  const isFreshBuy = closeAbovePrevHigh && priceAboveSupertrend;

  // Last 12 months for table (newest first)
  const last12 = candles.slice(-12);
  const last12Months: MonthlyVolumeStats[] = last12.map(c => {
    const ratio = avgVolume12m > 0 ? Number((c.volume / avgVolume12m).toFixed(2)) : 0;
    return {
      date: c.date,
      close: pct(c.close),
      high: pct(c.high),
      volume: Math.round(c.volume),
      volRatio: ratio,
    };
  }).reverse();

  // Chart data (last 18 months) + supertrend line
  const { supertrend: fullST } = calculateSupertrendSeries(candles, atrPeriod, multiplier);
  const chartWindow = candles.slice(-18);
  const chartData = chartWindow.map((c, idx) => {
    const gIdx = candles.length - chartWindow.length + idx;
    const stVal = fullST[gIdx];
    return {
      date: c.date,
      close: pct(c.close),
      supertrend: stVal && !isNaN(stVal) ? Number(stVal.toFixed(2)) : null,
      volume: Math.round(c.volume),
    };
  });

  return {
    symbol,
    name,
    ltp: Number(priceForComparison.toFixed(2)),
    change1mPct,

    latestClose: pct(latestClose),
    prevMonthHigh: pct(prevMonthHigh),
    closeAbovePrevHigh,

    supertrend: Number(latestST.toFixed(2)),
    atr: Number(latestAtr.toFixed(2)),
    trend: latestTrend,
    priceAboveSupertrend,

    latestVolume: Math.round(latestVolume),
    avgVolume12m: Math.round(avgVolume12m),
    volRatio,

    isFreshBuy,

    recentCandles: candles.slice(-24),
    last12Months,
    chartData,

    lastUpdated: new Date().toISOString(),
    monthsAnalyzed: candles.length,
  };
}

function emptyAnalysis(symbol: string, name: string, ltp: number, reason: string): MonthlyAnalysis {
  return {
    symbol,
    name,
    ltp: Number((ltp || 0).toFixed(2)),
    change1mPct: 0,
    latestClose: 0,
    prevMonthHigh: 0,
    closeAbovePrevHigh: false,
    supertrend: 0,
    atr: 0,
    trend: "up",
    priceAboveSupertrend: false,
    latestVolume: 0,
    avgVolume12m: 0,
    volRatio: 0,
    isFreshBuy: false,
    recentCandles: [],
    last12Months: [],
    chartData: [],
    lastUpdated: new Date().toISOString(),
    monthsAnalyzed: 0,
  };
}

export function formatMonth(iso: string): string {
  try {
    return format(new Date(iso), "MMM yyyy");
  } catch {
    return iso;
  }
}
