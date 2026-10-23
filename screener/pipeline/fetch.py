"""Rohdaten von Yahoo Finance (über yfinance). Keine Berechnungen, nur Abruf + Retry."""
from __future__ import annotations

import datetime as dt
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
    "regularMarketTime", "exchange", "fullExchangeName", "exchangeTimezoneName",
    "longBusinessSummary", "fullTimeEmployees", "city", "industryDisp", "sectorDisp",
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


def _extras(t) -> dict:
    """Gewinnrevisionen und nächster Termin. Fehler hier dürfen den Abruf nicht scheitern lassen."""
    out: dict = {}
    try:
        tr = t.eps_trend
        if tr is not None and not tr.empty:
            for period in ("+1y", "0y"):
                if period in tr.index:
                    row = tr.loc[period]
                    out["eps_trend"] = {"period": period, "current": _f(row.get("current")),
                                        "d30": _f(row.get("30daysAgo")), "d90": _f(row.get("90daysAgo"))}
                    break
    except Exception:  # noqa: BLE001
        pass
    try:
        rv = t.eps_revisions
        if rv is not None and not rv.empty:
            period = out.get("eps_trend", {}).get("period", "+1y")
            if period in rv.index:
                row = rv.loc[period]
                out["eps_rev"] = {"up30": _f(row.get("upLast30days")), "down30": _f(row.get("downLast30days"))}
    except Exception:  # noqa: BLE001
        pass
    try:
        out["news"] = _news(t.news)
    except Exception:  # noqa: BLE001
        pass
    try:
        cal = t.calendar
        dates = cal.get("Earnings Date") if isinstance(cal, dict) else None
        if dates:
            out["earnings_date"] = min(d for d in dates).isoformat()
    except Exception:  # noqa: BLE001
        pass
    return out


def _news(items, n: int = 6) -> list[dict]:
    """Schlagzeilen (Titel, Quelle, Datum, Link). yfinance liefert je nach Version zwei Formate."""
    out = []
    for it in items or []:
        c = it.get("content") if isinstance(it.get("content"), dict) else it
        title = c.get("title")
        link = (c.get("canonicalUrl") or {}).get("url") or (c.get("clickThroughUrl") or {}).get("url") or c.get("link")
        pub = (c.get("provider") or {}).get("displayName") or c.get("publisher")
        when = c.get("pubDate") or c.get("displayTime")
        if not when and c.get("providerPublishTime"):
            when = dt.datetime.fromtimestamp(c["providerPublishTime"], dt.timezone.utc).isoformat()
        if title and link:
            out.append({"title": title[:200], "link": link, "publisher": pub, "date": (when or "")[:10]})
        if len(out) >= n:
            break
    return out


def _f(x):
    try:
        v = float(x)
        return v if v == v else None
    except (TypeError, ValueError):
        return None


def fetch_info(symbol: str) -> dict | None:
    def go():
        t = yf.Ticker(symbol)
        info = t.info
        if not info or ("regularMarketPrice" not in info and "currentPrice" not in info):
            raise ValueError("leere Antwort")
        out = {k: info.get(k) for k in INFO_FIELDS}
        out.update(_extras(t))
        return out
    return _retry(go, f"info {symbol}")


def fetch_statements(symbol: str) -> dict | None:
    """Jahresabschlüsse von Yahoo: GuV, Cashflow, Bilanz (meist 4 Jahre)."""
    def go():
        t = yf.Ticker(symbol)
        out = {"is": t.income_stmt, "cf": t.cashflow, "bs": t.balance_sheet}
        if all(v is None or v.empty for v in out.values()):
            raise ValueError("keine Abschlüsse")
        return out
    return _retry(go, f"Abschlüsse {symbol}", tries=2)


def fetch_prices(symbols: list[str], period: str = "2y", chunk: int = 80, min_rows: int = 21) -> dict[str, pd.DataFrame]:
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
            if len(sub) >= min_rows:
                out[s] = sub[["Open", "High", "Low", "Close", "Volume"]].copy()
        time.sleep(1)
    # Einzelne Aussetzer im Sammelabruf: fehlende Symbole einmal einzeln nachladen
    missing = [s for s in symbols if s not in out]
    if missing and len(missing) <= 50 and chunk > 1:
        out.update(fetch_prices(missing, period=period, chunk=1, min_rows=min_rows))
    return out


def fetch_fx_to_eur(currencies: set[str]) -> dict[str, float]:
    """Kurs 1 Einheit Währung -> EUR (letzter Schlusskurs). GBp wird als GBP/100 behandelt."""
    rates = {"EUR": 1.0}
    need = {("GBP" if c == "GBp" else c) for c in currencies if c} - {"EUR"}
    pairs = {c: f"{c}EUR=X" for c in need}
    px = fetch_prices(list(pairs.values()), period="1mo", min_rows=1)
    for c, p in pairs.items():
        if p in px:
            rates[c] = float(px[p]["Close"].iloc[-1])
    if "GBP" in rates:
        rates["GBp"] = rates["GBP"] / 100
    return rates


def fetch_income_annual(symbol: str) -> pd.DataFrame | None:
    """Jahres-GuV (Zeilen = Positionen, Spalten = Geschäftsjahresende)."""
    return _retry(lambda: yf.Ticker(symbol).income_stmt, f"GuV {symbol}")
