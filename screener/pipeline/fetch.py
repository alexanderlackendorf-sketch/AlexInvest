"""Rohdaten von Yahoo Finance (über yfinance). Keine Berechnungen, nur Abruf + Retry."""
from __future__ import annotations

import logging
import time

import pandas as pd

log = logging.getLogger(__name__)

try:
    import yfinance as yf
except ImportError:  # in Tests nicht nötig
    yf = None

INFO_FIELDS = [
    "longName", "shortName", "sector", "industry", "country", "currency", "financialCurrency", "quoteType",
    "currentPrice", "regularMarketPrice", "marketCap", "sharesOutstanding", "impliedSharesOutstanding",
    "trailingEps", "forwardEps", "trailingPE", "forwardPE", "priceToBook", "bookValue",
    "enterpriseToEbitda", "totalRevenue", "ebitda", "freeCashflow", "operatingCashflow",
    "totalDebt", "totalCash", "revenueGrowth", "earningsGrowth", "earningsQuarterlyGrowth",
    "returnOnEquity", "returnOnAssets", "grossMargins", "operatingMargins", "profitMargins",
    "dividendRate", "payoutRatio", "beta",
    "targetMeanPrice", "targetMedianPrice", "targetHighPrice", "targetLowPrice",
    "numberOfAnalystOpinions", "recommendationMean", "recommendationKey", "website",
]


def _retry(fn, what: str, tries: int = 4):
    delay = 2.0
    for i in range(tries):
        try:
            return fn()
        except Exception as e:  # noqa: BLE001
            if i == tries - 1:
                log.warning("%s endgültig fehlgeschlagen: %s", what, e)
                return None
            time.sleep(delay)
            delay *= 2


def fetch_info(symbol: str) -> dict | None:
    def go():
        info = yf.Ticker(symbol).info
        if not info or ("regularMarketPrice" not in info and "currentPrice" not in info):
            raise ValueError("leere Antwort")
        return {k: info.get(k) for k in INFO_FIELDS}
    return _retry(go, f"info {symbol}")


def fetch_prices(symbols: list[str], period: str = "2y", chunk: int = 80) -> dict[str, pd.DataFrame]:
    """Tagesdaten (dividenden-/splitbereinigt). Rückgabe: Symbol -> DataFrame[Open,High,Low,Close,Volume]."""
    out: dict[str, pd.DataFrame] = {}
    for i in range(0, len(symbols), chunk):
        part = symbols[i:i + chunk]
        df = _retry(lambda: yf.download(part, period=period, interval="1d", group_by="ticker",
                                        auto_adjust=True, threads=True, progress=False),
                    f"Kurse {part[0]}..")
        if df is None or df.empty:
            continue
        for s in part:
            try:
                sub = df[s] if isinstance(df.columns, pd.MultiIndex) else df
            except KeyError:
                continue
            sub = sub.dropna(subset=["Close"])
            if len(sub) > 20:
                out[s] = sub[["Open", "High", "Low", "Close", "Volume"]].copy()
        time.sleep(1)
    return out


def fetch_fx_to_eur(currencies: set[str]) -> dict[str, float]:
    """Kurs 1 Einheit Währung -> EUR (letzter Schlusskurs). GBp wird als GBP/100 behandelt."""
    rates = {"EUR": 1.0}
    need = {("GBP" if c == "GBp" else c) for c in currencies if c} - {"EUR"}
    pairs = {c: f"{c}EUR=X" for c in need}
    px = fetch_prices(list(pairs.values()), period="5d")
    for c, p in pairs.items():
        if p in px:
            rates[c] = float(px[p]["Close"].iloc[-1])
    if "GBP" in rates:
        rates["GBp"] = rates["GBP"] / 100
    return rates


def fetch_income_annual(symbol: str) -> pd.DataFrame | None:
    """Jahres-GuV (Zeilen = Positionen, Spalten = Geschäftsjahresende)."""
    return _retry(lambda: yf.Ticker(symbol).income_stmt, f"GuV {symbol}")
