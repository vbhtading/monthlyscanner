"use client";

import React, { useState, useMemo } from "react";
import {
  Play, RefreshCw, Download, Search, X, Target, Clock, CheckCircle2, XCircle, BarChart3
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { format } from "date-fns";

import { NSE_UNIVERSE } from "@/lib/symbols";
import type { MonthlyAnalysis } from "@/lib/supertrend-analyzer";
import { formatINR, formatNumber, formatPercent, runWithConcurrency } from "@/lib/utils";

type ScanResult = MonthlyAnalysis & { scannedAt: string };

const CONCURRENCY = 4; // Lower for very large universe + heavy monthly history

export default function MonthlyFreshBuyScanner() {
  const [isScanning, setIsScanning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [results, setResults] = useState<ScanResult[]>([]);
  const [lastScan, setLastScan] = useState<Date | null>(null);

  const [searchTerm, setSearchTerm] = useState("");
  const [onlyFreshBuy, setOnlyFreshBuy] = useState(true);
  const [onlyAboveST, setOnlyAboveST] = useState(false);
  const [sortConfig, setSortConfig] = useState<{ key: string; dir: "asc" | "desc" }>({
    key: "isFreshBuy",
    dir: "desc",
  });
  const [selectedStock, setSelectedStock] = useState<ScanResult | null>(null);

  const universeSize = NSE_UNIVERSE.length;

  const freshBuys = useMemo(() => results.filter(r => r.isFreshBuy), [results]);
  const aboveSTCount = useMemo(() => results.filter(r => r.priceAboveSupertrend), [results]);

  const filteredResults = useMemo(() => {
    let data = [...results];

    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      data = data.filter(r =>
        r.symbol.toLowerCase().includes(q) || r.name.toLowerCase().includes(q)
      );
    }
    if (onlyFreshBuy) data = data.filter(r => r.isFreshBuy);
    if (onlyAboveST) data = data.filter(r => r.priceAboveSupertrend);

    data.sort((a, b) => {
      let valA: any, valB: any;
      switch (sortConfig.key) {
        case "isFreshBuy": valA = a.isFreshBuy ? 1 : 0; valB = b.isFreshBuy ? 1 : 0; break;
        case "volRatio": valA = a.volRatio; valB = b.volRatio; break;
        case "ltp": valA = a.ltp; valB = b.ltp; break;
        case "change1mPct": valA = a.change1mPct; valB = b.change1mPct; break;
        case "symbol": valA = a.symbol; valB = b.symbol; break;
        default: valA = (a as any)[sortConfig.key]; valB = (b as any)[sortConfig.key];
      }
      if (valA == null) valA = -999999;
      if (valB == null) valB = -999999;
      return valA < valB ? (sortConfig.dir === "asc" ? -1 : 1) : (valA > valB ? (sortConfig.dir === "asc" ? 1 : -1) : 0);
    });
    return data;
  }, [results, searchTerm, onlyFreshBuy, onlyAboveST, sortConfig]);

  async function analyzeOne(symbol: string): Promise<ScanResult | null> {
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol }),
      });
      if (!res.ok) {
        console.warn(`Failed: ${symbol}`);
        return null;
      }
      const data: MonthlyAnalysis = await res.json();
      return { ...data, scannedAt: new Date().toISOString() };
    } catch (e) {
      console.error("Error for", symbol, e);
      return null;
    }
  }

  const startScan = async () => {
    if (isScanning) return;
    setIsScanning(true);
    setResults([]);
    setSearchTerm("");
    setProgress({ done: 0, total: universeSize });

    const symbols = NSE_UNIVERSE.map(s => s.symbol);
    const newResults: ScanResult[] = [];
    let doneCount = 0;

    const worker = async (sym: string) => {
      const result = await analyzeOne(sym);
      doneCount++;
      setProgress({ done: doneCount, total: universeSize });
      if (result) {
        newResults.push(result);
        setResults(prev => {
          const merged = [...prev, result];
          return Array.from(new Map(merged.map(r => [r.symbol, r])).values());
        });
      }
    };

    try {
      await runWithConcurrency(symbols, CONCURRENCY, worker);
      setLastScan(new Date());

      const buyCount = newResults.filter(r => r.isFreshBuy).length;
      if (buyCount > 0) {
        toast.success(`${buyCount} FRESH BUY signals found`, {
          description: "Monthly close > prev month high + price above Supertrend(9,2)",
        });
      } else {
        toast.info("Scan complete — no fresh monthly buy signals right now.");
      }
    } catch {
      toast.error("Scan error");
    } finally {
      setIsScanning(false);
      setProgress({ done: 0, total: 0 });
    }
  };

  const resetAll = () => {
    setResults([]);
    setLastScan(null);
    setProgress({ done: 0, total: 0 });
    setSearchTerm("");
    setOnlyFreshBuy(true);
    setOnlyAboveST(false);
    toast("Reset");
  };

  const toggleSort = (key: string) => {
    setSortConfig(curr => ({
      key,
      dir: curr.key === key && curr.dir === "desc" ? "asc" : "desc",
    }));
  };

  const exportCSV = () => {
    if (filteredResults.length === 0) return toast.error("Nothing to export");
    const headers = ["Symbol","Name","LTP","1M_Change%","Latest_Close","Prev_Month_High","Breakout","Supertrend","Above_ST","Trend","Vol_Ratio","Fresh_Buy"];
    const rows = filteredResults.map(r => [
      r.symbol, `"${r.name.replace(/"/g,'""')}"` , r.ltp, r.change1mPct, r.latestClose, r.prevMonthHigh,
      r.closeAbovePrevHigh ? "YES" : "NO", r.supertrend, r.priceAboveSupertrend ? "YES" : "NO",
      r.trend, r.volRatio, r.isFreshBuy ? "FRESH_BUY" : ""
    ]);
    const csv = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `freshbuy_monthly_${format(new Date(), "yyyy-MM-dd_HHmm")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${filteredResults.length} rows`);
  };

  const openDetail = (stock: ScanResult) => setSelectedStock(stock);

  const chartData = useMemo(() => {
    if (!selectedStock?.chartData?.length) return [];
    return selectedStock.chartData.map(c => ({
      ...c,
      label: c.date.slice(0, 7),
    }));
  }, [selectedStock]);

  return (
    <div className="min-h-screen bg-[#0a0f1a] text-zinc-200">
      {/* Top Bar */}
      <div className="border-b border-white/10 bg-[#0a0f1a]/95 backdrop-blur-lg sticky top-0 z-50">
        <div className="max-w-[1480px] mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-emerald-500/10 flex items-center justify-center">
                <Target className="w-5 h-5 text-emerald-400" />
              </div>
              <div>
                <div className="font-semibold tracking-tighter text-2xl">FreshBuy</div>
                <div className="text-[10px] text-emerald-400/70 -mt-1">NSE • MONTHLY SUPERTREND 9,2</div>
              </div>
            </div>
            <div className="ml-3 px-3 py-1 rounded-full bg-white/5 text-xs font-medium border border-white/10">
              Data via Yahoo Finance
            </div>
          </div>

          <div className="flex items-center gap-4 text-sm">
            <div className="flex items-center gap-2 text-zinc-400">
              <Clock className="w-4 h-4" />
              {lastScan ? `Last scan: ${format(lastScan, "HH:mm")}` : "Ready"}
            </div>
            <button onClick={resetAll} className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-white/5 border border-white/10 text-xs">
              <RefreshCw className="w-3.5 h-3.5" /> RESET
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-[1480px] mx-auto px-6 pt-8 pb-24">
        {/* Hero */}
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-8">
          <div>
            <div className="uppercase tracking-[3px] text-emerald-400 text-xs font-semibold mb-1">MONTHLY TIMEFRAME • FRESH BREAKOUTS</div>
            <h1 className="text-6xl font-semibold tracking-tighter">Monthly Fresh Buy Scanner</h1>
            <p className="mt-3 max-w-3xl text-lg text-zinc-400">
              Scans <span className="font-semibold text-emerald-400">{universeSize} NSE stocks</span> on <span className="font-semibold">monthly candles</span>.
              A stock qualifies as <span className="font-semibold text-white">FRESH BUY</span> only when:
            </p>
            <ul className="mt-2 text-sm text-zinc-300 space-y-1">
              <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-400" /> Current month close &gt; Previous month high (e.g. June close &gt; May high)</li>
              <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-400" /> Current price is above Supertrend (9, 2)</li>
            </ul>
          </div>

          <div className="flex flex-col items-end gap-2">
            <button
              onClick={startScan}
              disabled={isScanning}
              className="flex items-center justify-center gap-3 px-8 h-14 rounded-2xl bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700 disabled:bg-zinc-700 disabled:text-zinc-400 transition-all text-lg font-semibold shadow-lg shadow-emerald-950/50"
            >
              {isScanning ? <>SCANNING… <RefreshCw className="w-5 h-5 animate-spin" /></> : <> <Play className="w-5 h-5" /> SCAN ALL STOCKS </>}
            </button>
            <div className="text-[11px] text-zinc-500 text-right">~2–4 minutes for full universe • {CONCURRENCY} concurrent</div>
          </div>
        </div>

        {/* Info */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 mb-6">
          <div className="lg:col-span-7 card p-5">
            <div className="flex flex-col sm:flex-row sm:items-center gap-4">
              <div>
                <div className="text-sm text-zinc-400 mb-1">UNIVERSE • MONTHLY (9,2) + VOLUME</div>
                <div className="text-3xl font-semibold tracking-tight">{universeSize} <span className="text-base font-normal text-zinc-400">NSE stocks</span></div>
                <div className="text-emerald-400/80 text-xs mt-0.5">Nifty 100/200 + Small &amp; Midcap focus</div>
              </div>
              <div className="text-sm text-zinc-400 max-w-[380px]">
                Volume analysis included: latest monthly volume vs prior 12-month average. High volume on breakout adds strength.
              </div>
            </div>
          </div>
          <div className="lg:col-span-5 card p-5 border-emerald-500/30">
            <div className="text-xs uppercase tracking-widest text-emerald-400 mb-2">EXAMPLE (as you described)</div>
            <div className="text-sm">May high = ₹100. If June monthly close &gt; 100 <span className="text-emerald-400">and</span> price &gt; Supertrend(9,2) → <span className="font-semibold text-emerald-400">FRESH BUY</span></div>
          </div>
        </div>

        {/* Progress */}
        <AnimatePresence>
          {isScanning && progress.total > 0 && (
            <div className="mb-6 card p-4">
              <div className="flex items-center justify-between mb-2 text-sm">
                <div>SCANNING • <span className="font-mono text-emerald-400">{progress.done} / {progress.total}</span></div>
              </div>
              <div className="progress"><div className="progress-bar bg-emerald-500" style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }} /></div>
              <div className="text-[11px] text-zinc-500 mt-1.5">Fetching 9 years monthly data + ATR(9) + Supertrend(9,2) + volume ratios per stock</div>
            </div>
          )}
        </AnimatePresence>

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="card p-5">
            <div className="text-xs uppercase tracking-widest text-zinc-400">SCANNED</div>
            <div className="text-5xl font-semibold tabular-nums mt-2">{results.length}</div>
            <div className="text-emerald-400 text-sm mt-1">of {universeSize}</div>
          </div>
          <div className="card p-5 border-emerald-500/30">
            <div className="text-xs uppercase tracking-widest text-emerald-400">FRESH BUY SIGNALS</div>
            <div className="text-5xl font-semibold tabular-nums mt-2 text-emerald-400">{freshBuys.length}</div>
            <div className="text-sm mt-1 text-emerald-300/80">Breakout + Above Supertrend(9,2)</div>
          </div>
          <div className="card p-5 border-sky-500/30">
            <div className="text-xs uppercase tracking-widest text-sky-400">PRICE &gt; SUPERTREND</div>
            <div className="text-5xl font-semibold tabular-nums mt-2 text-sky-400">{aboveSTCount.length}</div>
            <div className="text-sm mt-1 text-sky-300/80">Uptrend filter only</div>
          </div>
          <div className="card p-5 flex flex-col justify-between">
            <div>
              <div className="text-xs uppercase tracking-widest text-zinc-400">LAST UPDATED</div>
              <div className="text-2xl font-semibold mt-1">{lastScan ? format(lastScan, "dd MMM • HH:mm") : "—"}</div>
            </div>
            <button onClick={exportCSV} disabled={filteredResults.length === 0} className="mt-4 self-start flex items-center gap-2 text-xs px-4 h-9 rounded-xl border border-white/10 hover:bg-white/5 disabled:opacity-40">
              <Download className="w-3.5 h-3.5" /> EXPORT CSV
            </button>
          </div>
        </div>

        {/* Table */}
        <div className="card p-2">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 px-4 pt-4 pb-3">
            <div className="font-semibold flex items-center gap-3">
              RESULTS <span className="text-emerald-400 text-sm font-normal">({filteredResults.length} shown)</span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-3 text-zinc-400" />
                <input value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="Search symbol or name..." className="pl-9 w-64 h-9 rounded-xl text-sm border border-white/10 focus:border-emerald-500/60" />
              </div>

              <button onClick={() => setOnlyFreshBuy(!onlyFreshBuy)} className={`h-9 px-4 rounded-xl text-xs font-medium border flex items-center gap-1.5 ${onlyFreshBuy ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" : "border-white/10 hover:bg-white/5"}`}>
                <Target className="w-3.5 h-3.5" /> ONLY FRESH BUYS
              </button>
              <button onClick={() => setOnlyAboveST(!onlyAboveST)} className={`h-9 px-4 rounded-xl text-xs font-medium border ${onlyAboveST ? "bg-sky-500/10 text-sky-400 border-sky-500/30" : "border-white/10 hover:bg-white/5"}`}>
                ONLY ABOVE SUPERTREND
              </button>

              <button onClick={() => { setSearchTerm(""); setOnlyFreshBuy(true); setOnlyAboveST(false); }} className="h-9 px-3 text-xs border border-white/10 rounded-xl hover:bg-white/5">CLEAR</button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="data-table w-full text-sm">
              <thead>
                <tr className="table-header text-xs">
                  <th className="text-left pl-5 py-3 cursor-pointer" onClick={() => toggleSort("symbol")}>SYMBOL</th>
                  <th className="text-left py-3 cursor-pointer" onClick={() => toggleSort("name")}>NAME</th>
                  <th className="text-right py-3 cursor-pointer" onClick={() => toggleSort("ltp")}>LTP (₹)</th>
                  <th className="text-right py-3 cursor-pointer" onClick={() => toggleSort("change1mPct")}>1M CHG</th>
                  <th className="text-right py-3 cursor-pointer" onClick={() => toggleSort("volRatio")}>VOL RATIO</th>
                  <th className="text-center py-3">BREAKOUT</th>
                  <th className="text-center py-3">SUPERTREND</th>
                  <th className="text-center py-3">TREND</th>
                  <th className="text-center py-3 cursor-pointer" onClick={() => toggleSort("isFreshBuy")}>SIGNAL</th>
                  <th className="w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 text-sm font-medium">
                {filteredResults.length === 0 && (
                  <tr><td colSpan={10} className="py-16 text-center text-zinc-400">{results.length === 0 ? "Click SCAN ALL STOCKS above." : "No matches for current filters."}</td></tr>
                )}
                {filteredResults.map(row => {
                  const isBuy = row.isFreshBuy;
                  const breakout = row.closeAbovePrevHigh;
                  const above = row.priceAboveSupertrend;
                  return (
                    <tr key={row.symbol} className="group">
                      <td className="pl-5 py-3 font-mono text-emerald-300 font-semibold tracking-tight">{row.symbol}</td>
                      <td className="py-3 text-zinc-300 pr-4 max-w-[260px] truncate">{row.name}</td>
                      <td className="text-right py-3 tabular-nums font-medium">{formatINR(row.ltp)}</td>
                      <td className={`text-right py-3 tabular-nums font-medium ${row.change1mPct >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{formatPercent(row.change1mPct)}</td>
                      <td className="text-right py-3 tabular-nums">
                        <span className={row.volRatio >= 1.5 ? "text-amber-400 font-semibold" : "text-zinc-400"}>{row.volRatio}×</span>
                      </td>
                      <td className="text-center py-3">
                        {breakout ? <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"><CheckCircle2 className="w-3 h-3" /> CLOSE &gt; HIGH</span> : <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-medium bg-zinc-500/10 text-zinc-400 border border-zinc-500/30"><XCircle className="w-3 h-3" /> NO</span>}
                      </td>
                      <td className="text-center py-3 font-mono tabular-nums text-xs">
                        <div className="flex flex-col items-center"><span className="text-zinc-400">₹{row.supertrend}</span><span className="text-[10px] text-zinc-500">ATR {row.atr}</span></div>
                      </td>
                      <td className="text-center py-3">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-medium border ${row.trend === "up" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" : "bg-rose-500/10 text-rose-400 border-rose-500/30"}`}>{row.trend.toUpperCase()}</span>
                      </td>
                      <td className="text-center py-3">{isBuy ? <span className="badge badge-green text-xs px-3 py-0.5 font-semibold tracking-wide">FRESH BUY</span> : above ? <span className="badge badge-amber text-xs px-2.5">ABOVE ST</span> : <span className="badge badge-gray text-xs">—</span>}</td>
                      <td className="pr-4"><button onClick={() => openDetail(row)} className="opacity-60 group-hover:opacity-100 text-xs px-3 py-1 border border-white/10 rounded-lg hover:bg-white/5">DETAILS</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {results.length > 0 && (
            <div className="px-4 py-3 text-xs text-zinc-400 flex justify-between items-center border-t border-white/10">
              Monthly data • Supertrend(9, 2) • Vol ratio = latest month vol ÷ 12m avg (excl latest) • Breakout = latest close &gt; prior month high
              <div>{results.length} analyzed • {freshBuys.length} fresh buys</div>
            </div>
          )}
        </div>

        <div className="mt-8 text-center text-xs text-zinc-500">Not investment advice. Monthly signals are infrequent. Combine with fundamentals and risk management.</div>
      </div>

      {/* Detail Modal */}
      <AnimatePresence>
        {selectedStock && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 p-4" onClick={() => setSelectedStock(null)}>
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 20 }}
              onClick={e => e.stopPropagation()}
              className="modal w-full max-w-[1100px] bg-[#0f1629] border border-white/10 rounded-3xl overflow-hidden"
            >
              <div className="px-7 pt-6 pb-4 flex items-start justify-between border-b border-white/10 bg-black/20">
                <div>
                  <div className="flex items-center gap-3 flex-wrap">
                    <div className="font-mono text-4xl font-semibold tracking-[-2.2px]">{selectedStock.symbol}</div>
                    {selectedStock.isFreshBuy && <span className="badge badge-green mt-1 px-3">FRESH BUY</span>}
                    {selectedStock.trend === "up" && <span className="badge badge-amber mt-1 px-3">UPTREND</span>}
                  </div>
                  <div className="text-zinc-400 text-lg mt-0.5">{selectedStock.name}</div>
                </div>
                <button onClick={() => setSelectedStock(null)} className="p-2 -mr-2 text-zinc-400 hover:text-white"><X className="w-5 h-5" /></button>
              </div>

              <div className="p-7 space-y-8">
                {/* Conditions */}
                <div>
                  <div className="uppercase text-xs tracking-[1px] text-emerald-400 mb-3">FRESH BUY CONDITIONS (MONTHLY)</div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className={`rounded-2xl border p-4 ${selectedStock.closeAbovePrevHigh ? "border-emerald-500/40 bg-emerald-950/10" : "border-white/10 bg-black/20"}`}>
                      <div className="flex items-center gap-2 text-sm font-medium">
                        {selectedStock.closeAbovePrevHigh ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <XCircle className="w-4 h-4 text-zinc-500" />}
                        1. Close &gt; Previous Month High
                      </div>
                      <div className="mt-3 text-2xl tabular-nums font-semibold">{formatINR(selectedStock.latestClose)} <span className="text-sm font-normal text-zinc-400">latest close</span></div>
                      <div className="mt-1 text-sm text-zinc-400">Previous month high: <span className="font-medium text-white">{formatINR(selectedStock.prevMonthHigh)}</span></div>
                    </div>

                    <div className={`rounded-2xl border p-4 ${selectedStock.priceAboveSupertrend ? "border-emerald-500/40 bg-emerald-950/10" : "border-white/10 bg-black/20"}`}>
                      <div className="flex items-center gap-2 text-sm font-medium">
                        {selectedStock.priceAboveSupertrend ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <XCircle className="w-4 h-4 text-zinc-500" />}
                        2. Price &gt; Supertrend (9, 2)
                      </div>
                      <div className="mt-3 text-2xl tabular-nums font-semibold">{formatINR(selectedStock.ltp)} <span className="text-sm font-normal text-zinc-400">current price</span></div>
                      <div className="mt-1 text-sm text-zinc-400">Supertrend: <span className="font-medium text-white">₹{selectedStock.supertrend}</span> • ATR(9): {selectedStock.atr}</div>
                    </div>
                  </div>
                </div>

                {/* Metrics */}
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                  {[
                    { label: "Last Traded Price", val: formatINR(selectedStock.ltp) },
                    { label: "1-Month Change", val: formatPercent(selectedStock.change1mPct), positive: selectedStock.change1mPct >= 0 },
                    { label: "Supertrend (9,2)", val: `₹${selectedStock.supertrend}` },
                    { label: "Latest Month Volume", val: formatNumber(selectedStock.latestVolume) },
                    { label: "Vol Ratio (vs 12m)", val: `${selectedStock.volRatio}×`, highlight: selectedStock.volRatio >= 1.6 },
                  ].map((m, i) => (
                    <div key={i} className="rounded-2xl bg-black/30 border border-white/10 p-4">
                      <div className="text-[10px] tracking-widest text-zinc-400">{m.label}</div>
                      <div className={`mt-2 text-3xl font-semibold tabular-nums ${m.positive === false ? "text-rose-400" : m.highlight ? "text-amber-400" : ""}`}>{m.val}</div>
                    </div>
                  ))}
                </div>

                {/* Volume Analysis */}
                <div>
                  <div className="uppercase text-xs text-amber-400 tracking-[1px] mb-3 px-1 flex items-center gap-2"><BarChart3 className="w-3.5 h-3.5" /> MONTHLY VOLUME ANALYSIS (LAST 12 MONTHS)</div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                    {selectedStock.last12Months.slice(0, 8).map((m, idx) => (
                      <div key={idx} className="rounded-xl border border-white/10 bg-black/20 p-3 text-sm">
                        <div className="flex justify-between"><div className="font-medium">{format(new Date(m.date), "MMM yyyy")}</div><div className={m.volRatio >= 1.6 ? "text-amber-400 font-semibold" : "text-zinc-400"}>{m.volRatio}×</div></div>
                        <div className="mt-1 tabular-nums text-lg">{formatINR(m.close)}</div>
                        <div className="text-xs text-zinc-500">Vol: {formatNumber(m.volume)}</div>
                      </div>
                    ))}
                  </div>
                  <div className="text-[11px] text-zinc-500 mt-2">12m avg volume: {formatNumber(selectedStock.avgVolume12m)} • Latest: {formatNumber(selectedStock.latestVolume)}</div>
                </div>

                {/* Chart */}
                {chartData.length > 5 && (
                  <div>
                    <div className="text-sm font-medium mb-3 px-1">MONTHLY PRICE + SUPERTREND (9,2) — LAST {chartData.length} MONTHS</div>
                    <div className="chart-container p-4 border border-white/10 rounded-2xl h-[360px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={chartData}>
                          <CartesianGrid strokeDasharray="2 2" stroke="#1f2937" />
                          <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#64748b" }} />
                          <YAxis yAxisId="price" orientation="left" tick={{ fontSize: 10, fill: "#64748b" }} tickFormatter={v => "₹" + v} />
                          <Tooltip contentStyle={{ background: "#111827", border: "1px solid #334155", borderRadius: "8px" }} />
                          <Line yAxisId="price" type="natural" dataKey="close" stroke="#34d399" strokeWidth={2.5} dot={false} name="Monthly Close" />
                          <Line yAxisId="price" type="natural" dataKey="supertrend" stroke="#f59e0b" strokeWidth={2} strokeDasharray="4 2" dot={false} connectNulls name="Supertrend (9,2)" />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="text-[10px] text-center text-zinc-500 mt-2">Green = monthly close. Orange dashed = Supertrend line. Fresh Buy requires both the latest close breaking the prior high AND price above the line.</div>
                  </div>
                )}

                {/* Interpretation */}
                <div className="text-sm leading-relaxed text-zinc-300 border-l-4 border-emerald-500/40 pl-4">
                  {selectedStock.isFreshBuy ? (
                    <>This is a <span className="font-semibold text-emerald-400">FRESH BUY</span> on the monthly chart. The latest month closed above the entire previous month’s high, and price is trading above the Supertrend(9,2) uptrend line. Volume ratio of {selectedStock.volRatio}× {selectedStock.volRatio >= 1.5 ? "adds extra conviction." : "is moderate."}</>
                  ) : selectedStock.closeAbovePrevHigh ? (
                    <>Breakout condition satisfied (close above prior high), but price is not yet confirmed above Supertrend. The trend filter is not green yet.</>
                  ) : selectedStock.priceAboveSupertrend ? (
                    <>Price is in an uptrend (above Supertrend), but has not yet produced a monthly close above the previous month’s high. Watching for a decisive breakout candle.</>
                  ) : (
                    <>No fresh buy signal. Price is below Supertrend and/or has not cleared the prior monthly high on a closing basis.</>
                  )}
                </div>
              </div>

              <div className="border-t border-white/10 bg-black/30 px-7 py-3.5 flex justify-end">
                <button onClick={() => setSelectedStock(null)} className="px-6 py-2 rounded-xl text-sm font-medium border border-white/10 hover:bg-white/5">CLOSE</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
