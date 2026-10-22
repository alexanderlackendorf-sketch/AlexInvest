"""Chart-Kennzahlen und Buy-Zonen, ausschließlich aus echten Tagesschlusskursen berechnet."""
from __future__ import annotations

import numpy as np
import pandas as pd


def rsi(close: pd.Series, n: int = 14) -> float | None:
    if len(close) <= n:
        return None
    d = close.diff()
    up = d.clip(lower=0).ewm(alpha=1 / n, adjust=False).mean()
    dn = (-d.clip(upper=0)).ewm(alpha=1 / n, adjust=False).mean()
    rs = up.iloc[-1] / dn.iloc[-1] if dn.iloc[-1] > 0 else np.inf
    return float(100 - 100 / (1 + rs))


def atr(df: pd.DataFrame, n: int = 14) -> float | None:
    if len(df) <= n:
        return None
    prev = df["Close"].shift()
    tr = pd.concat([df["High"] - df["Low"], (df["High"] - prev).abs(), (df["Low"] - prev).abs()], axis=1).max(axis=1)
    return float(tr.ewm(alpha=1 / n, adjust=False).mean().iloc[-1])


def pivot_lows(low: pd.Series, window: int = 10) -> list[float]:
    """Lokale Tiefs (Minimum innerhalb +/- window Tagen)."""
    roll = low.rolling(2 * window + 1, center=True).min()
    return [float(v) for v in low[(low == roll)].dropna().values]


def cluster_levels(levels: list[float], tol: float = 0.02) -> list[tuple[float, int]]:
    """Fasst nahe beieinander liegende Niveaus zusammen -> (Niveau, Anzahl Berührungen)."""
    out: list[list[float]] = []
    for lv in sorted(levels):
        if out and lv <= out[-1][0] * (1 + tol):
            out[-1].append(lv)
        else:
            out.append([lv])
    return [(float(np.mean(c)), len(c)) for c in out]


def _ret(close: pd.Series, days: int, skip: int = 0) -> float | None:
    if len(close) <= days:
        return None
    end = close.iloc[-1 - skip]
    return float(end / close.iloc[-1 - days] - 1)


def compute(df: pd.DataFrame) -> dict:
    close = df["Close"]
    last = float(close.iloc[-1])
    sma50 = float(close.rolling(50).mean().iloc[-1]) if len(close) >= 50 else None
    sma200s = close.rolling(200).mean()
    sma200 = float(sma200s.iloc[-1]) if len(close) >= 200 else None
    sma200_slope = (float(sma200s.iloc[-1] / sma200s.iloc[-21] - 1)
                    if len(close) >= 221 else None)
    y = close.iloc[-252:]
    hi52, lo52 = float(df["High"].iloc[-252:].max()), float(df["Low"].iloc[-252:].min())
    a = atr(df)

    t = {
        "last_close": last,
        "last_date": close.index[-1].strftime("%Y-%m-%d"),
        "sma50": sma50, "sma200": sma200, "sma200_slope_1m": sma200_slope,
        "dist_sma200": (last / sma200 - 1) if sma200 else None,
        "rsi14": rsi(close),
        "atr14": a,
        "high52": hi52, "low52": lo52,
        "drawdown": last / hi52 - 1,
        "ret_1m": _ret(close, 21), "ret_3m": _ret(close, 63), "ret_6m": _ret(close, 126),
        "ret_12m": _ret(close, 252),
        "mom_12_1": _ret(close, 252, skip=21),
        "vol_1y": float(np.log(y).diff().std() * np.sqrt(252)) if len(y) > 60 else None,
    }
    t["trend"] = _trend_label(last, sma50, sma200, sma200_slope)
    t["buy_zones"] = buy_zones(df, last, sma50, sma200, a)
    z1 = t["buy_zones"][0] if t["buy_zones"] else None
    t["in_buy_zone"] = bool(z1 and z1["low"] <= last <= z1["high"])
    return t


def _trend_label(last, sma50, sma200, slope) -> str:
    if sma200 is None or sma50 is None:
        return "n/a"
    if last > sma50 > sma200 and (slope or 0) > 0:
        return "Aufwärtstrend"
    if last < sma50 < sma200 and (slope or 0) < 0:
        return "Abwärtstrend"
    if last > sma200:
        return "über SMA200"
    return "unter SMA200"


def buy_zones(df: pd.DataFrame, last: float, sma50, sma200, a: float | None) -> list[dict]:
    """Buy-Zonen aus Unterstützungen (Pivot-Tiefs der letzten 12 Monate) und gleitenden Durchschnitten.

    Zone 1 = nächste relevante Unterstützung unterhalb/am aktuellen Kurs (max. 20 % entfernt).
    Zone 2 = nächste deutlich tiefere Unterstützung (starke Kaufzone).
    Breite jeweils +/- 0,5 ATR.
    """
    if a is None or a <= 0:
        return []
    window = df.iloc[-252:]
    cands = [(lv, n, f"Unterstützung ({n}x getestet)") for lv, n in cluster_levels(pivot_lows(window["Low"]))]
    if sma200:
        cands.append((sma200, 2, "SMA200"))
    if sma50:
        cands.append((sma50, 1, "SMA50"))
    # nur Niveaus unter (oder knapp über) dem Kurs, nicht tiefer als 35 %
    cands = [c for c in cands if last * 0.65 <= c[0] <= last + 0.5 * a]
    cands.sort(key=lambda c: -c[0])
    zones: list[dict] = []
    for lv, n, label in cands:
        if not zones:
            if lv < last * 0.80:
                continue  # zu weit weg für Zone 1 -> wird ggf. Zone 2
            zones.append({"level": lv, "label": label, "kind": "Buy-Zone 1"})
        elif lv < zones[-1]["level"] - 1.5 * a and (n >= 2 or label == "SMA200"):
            zones.append({"level": lv, "label": label, "kind": "Buy-Zone 2 (stark)"})
            break
    if not zones and cands:
        lv, n, label = cands[0]
        zones.append({"level": lv, "label": label, "kind": "Buy-Zone 2 (stark)"})
    for z in zones:
        z["low"] = z["level"] - 0.5 * a
        z["high"] = z["level"] + 0.5 * a
    return zones
