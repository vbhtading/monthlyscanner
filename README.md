# FreshBuy — NSE Monthly Supertrend Fresh Buy Scanner

Professional Next.js scanner for NSE India stocks on **monthly timeframe**.

## Fresh Buy Signal (exactly as requested)

A stock shows a **FRESH BUY** only when **both** conditions are true:

1. **Monthly Breakout**: Current (latest) month close > Previous month high  
   Example: If May high was ₹100, June close must be higher than 100.

2. **Trend Confirmation**: Current price (LTP) is above Supertrend calculated with period=9, multiplier=2 on monthly candles.

## Volume Analysis Included

- Latest month volume vs 12-month average
- Volume ratio (high volume on a breakout month = stronger signal)
- 12-month volume table in the detail view

## Features

- Scans 250+ NSE stocks (Nifty + Smallcap focus)
- Live progress during scan
- Powerful filters (Only Fresh Buys / Only Above Supertrend)
- Detailed modal with:
  - Clear breakout + Supertrend status cards
  - Monthly volume breakdown
  - Price + Supertrend overlay chart (last 18 months)
- CSV export
- Stable webpack dev server (avoids Turbopack crashes on Windows)

## Run

```bash
cd nse-monthly-supertrend-scanner
npm run dev
```

Then click the big green **SCAN ALL STOCKS** button.

Full scan of 250+ stocks takes roughly 2–4 minutes (4 concurrent requests, heavy 9-year monthly history per stock).

## Data

- Yahoo Finance monthly (1mo) interval
- Supertrend (9, 2) with Wilder's ATR
- Current price prefers live quote for accuracy
- In-memory cache (6 min)

## Disclaimer

This is **not** financial advice. Monthly signals are infrequent but can be high-conviction when they appear. Always do your own research.
