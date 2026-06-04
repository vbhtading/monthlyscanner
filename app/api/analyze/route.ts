import { NextRequest, NextResponse } from "next/server";
import YahooFinance from "yahoo-finance2";
import { analyzeMonthlySupertrend, MonthlyCandle } from "@/lib/supertrend-analyzer";
import { toYahooSymbol } from "@/lib/symbols";

const yahoo = new YahooFinance();

// Cache longer for monthly (data updates once per month mostly)
const cache = new Map<string, { data: any; ts: number }();
const CACHE_TTL_MS = 1000 * 60 * 6; // 6 minutes

interface AnalyzeRequest {
  symbol: string;
}

export async function POST(req: NextRequest) {
  try {
    const body: AnalyzeRequest = await req.json();
    const rawSymbol = (body.symbol || "").toUpperCase().trim();
    if (!rawSymbol) {
      return NextResponse.json({ error: "Symbol is required" }, { status: 400 });
    }

    const ySymbol = toYahooSymbol(rawSymbol);

    const cached = cache.get(ySymbol);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      return NextResponse.json(cached.data);
    }

    // Fetch daily data (last ~5 years) then aggregate to monthly candles with CORRECT high/low
    // (interval=1mo from yahoo-finance2 often returns bogus high/low that do not reflect the actual max/min of the month)
    const end = new Date();
    const start = new Date();
    start.setFullYear(start.getFullYear() - 5);

    const daily = await yahoo.historical(ySymbol, {
      period1: start,
      period2: end,
      interval: "1d",
    });

    if (!daily || daily.length === 0) {
      return NextResponse.json({ error: `No data for ${rawSymbol}` }, { status: 404 });
    }

    // Aggregate daily into monthly bars: high = max high in month, close = last close of month, etc.
    const byMonth: Record<string, any[]> = {};
    for (const d of daily) {
      if (d.close == null || d.high == null || d.low == null) continue;
      const dt = new Date(d.date);
      const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
      if (!byMonth[key]) byMonth[key] = [];
      byMonth[key].push(d);
    }

    const monthKeys = Object.keys(byMonth).sort();
    const candles: MonthlyCandle[] = monthKeys.map(key => {
      const days = byMonth[key].sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());
      const first = days[0];
      const last = days[days.length - 1];
      const highs = days.map((d: any) => Number(d.high));
      const lows = days.map((d: any) => Number(d.low));
      const volumes = days.map((d: any) => Number(d.volume || 0));
      return {
        date: last.date.toISOString().slice(0, 10),
        timestamp: new Date(last.date).getTime(),
        open: Number(first.open || first.close),
        high: Math.max(...highs),
        low: Math.min(...lows),
        close: Number(last.close),
        volume: volumes.reduce((a, b) => a + b, 0),
      };
    }).sort((a, b) => a.timestamp - b.timestamp);

    if (candles.length < 18) {
      return NextResponse.json(
        { error: `Only ${candles.length} months history for ${rawSymbol}` },
        { status: 422 }
      );
    }

    // Fresh quote for current LTP + proper company name
    let ltp = candles[candles.length - 1].close;
    let displayName = rawSymbol;

    try {
      const quote = await yahoo.quote(ySymbol);
      if (quote?.regularMarketPrice) ltp = quote.regularMarketPrice;
      if (quote?.shortName) displayName = quote.shortName;
    } catch {
      // fallback ok
    }

    const result = analyzeMonthlySupertrend(
      rawSymbol.replace(".NS", ""),
      displayName,
      ltp,
      candles,
      { atrPeriod: 9, multiplier: 2, minMonths: 20, volAvgMonths: 12 }
    );

    cache.set(ySymbol, { data: result, ts: Date.now() });

    return NextResponse.json(result);
  } catch (err: any) {
    console.error("Analyze error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to analyze" },
      { status: 500 }
    );
  }
}
