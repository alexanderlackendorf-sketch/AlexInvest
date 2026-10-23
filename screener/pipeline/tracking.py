"""Erfolgskontrolle: Funktioniert das Rating? (Forward-Tracking statt geschöntem Backtest)

Einmal pro Kalenderwoche wird festgehalten, welche Aktien in welcher Gruppe waren
(Kandidaten, oberstes/unterstes Score-Zehntel, ganzes Universum). Später wird die Rendite
dieser Kohorten gemessen: Einstieg zum Schlusskurs des nächsten Handelstags (kein Vorgriff),
gleichgewichtet, in Handelswährung, ohne Dividenden und Kosten.
Kein historischer Backtest, weil freie Daten weder frühere Indexzusammensetzungen (Survivorship-Bias)
noch frühere Analystenschätzungen enthalten. Aussagekräftig wird das erst nach mehreren Monaten.
"""
from __future__ import annotations

import datetime as dt
import statistics as st

import pandas as pd

HORIZONS = {"1M": 21, "3M": 63, "6M": 126, "12M": 252}
GROUPS = ["kandidat", "top_decile", "universe", "bottom_decile"]
BENCHMARKS = {"^GSPC": "S&P 500", "^GDAXI": "DAX"}


def snapshot(state: dict, today: dt.date, rows: list[dict], model_version: int = 1) -> dict:
    """Legt höchstens eine Kohorte pro ISO-Kalenderwoche an."""
    snaps = state.setdefault("snapshots", {})
    week = today.isocalendar()[:2]
    if any(dt.date.fromisoformat(d[:10]).isocalendar()[:2] == week and g.get("model", 1) == model_version
           for d, g in snaps.items()):
        return state
    # Neues Modell in derselben Woche: Schlüssel eindeutig halten, alte Kohorte bleibt erhalten
    key = today.isoformat()
    if key in snaps:
        key = f"{key}#m{model_version}"
    rated = sorted((r for r in rows if r.get("score") is not None and r["score"] == r["score"]),
                   key=lambda r: -r["score"])
    n10 = max(len(rated) // 10, 1)
    snaps[key] = {
        "model": model_version,
        "kandidat": [r["symbol"] for r in rated if r.get("verdict_code") == "kandidat"],
        "top_decile": [r["symbol"] for r in rated[:n10]],
        "bottom_decile": [r["symbol"] for r in rated[-n10:]],
        "universe": [r["symbol"] for r in rated],
    }
    return state


def _ret(close: pd.Series | None, start: dt.date, days: int | None):
    """Rendite ab Schluss des ersten Handelstags NACH `start` über `days` Handelstage (None = bis heute)."""
    if close is None or close.empty:
        return None, False
    after = close.loc[close.index > pd.Timestamp(start)]
    if after.empty:
        return None, False
    entry = float(after.iloc[0])
    if days is None:
        return float(after.iloc[-1]) / entry - 1, True
    if len(after) <= days:
        return None, False
    return float(after.iloc[days]) / entry - 1, True


def evaluate(state: dict, closes: dict[str, pd.Series], model_version: int = 1) -> dict:
    # Nur Kohorten des aktuellen Bewertungsmodells auswerten (ältere bleiben gespeichert, werden aber
    # nicht mit dem neuen Modell vermischt)
    snaps = {d: g for d, g in state.get("snapshots", {}).items() if g.get("model", 1) == model_version}
    out = {"since": min(snaps) if snaps else None, "cohorts": len(snaps), "horizons": {}, "running": {},
           "model": model_version}
    for hname, days in list(HORIZONS.items()) + [("seit Start", None)]:
        per_group: dict[str, list[float]] = {g: [] for g in GROUPS + list(BENCHMARKS.values())}
        n_done, pairs = 0, []
        for d, groups in snaps.items():
            start = dt.date.fromisoformat(d[:10])
            cohort: dict[str, float] = {}
            for g in GROUPS:
                rets = [r for r, ok in (_ret(closes.get(s), start, days) for s in groups.get(g, [])) if ok]
                if len(rets) >= max(3, len(groups.get(g, [])) // 2):
                    cohort[g] = st.mean(rets)
            for sym, name in BENCHMARKS.items():
                r, ok = _ret(closes.get(sym), start, days)
                if ok:
                    cohort[name] = r
            if "universe" not in cohort:
                continue  # Horizont für diese Kohorte noch nicht erreicht
            n_done += 1
            for g, v in cohort.items():
                per_group[g].append(v)
            if "kandidat" in cohort:
                pairs.append((cohort["kandidat"], cohort["universe"]))
        res = {"cohorts": n_done}
        for g, vals in per_group.items():
            res[g] = st.mean(vals) if vals else None
        # Trefferquote: Anteil der Kohorten, in denen die Kandidaten das Universum schlagen
        res["hit_rate"] = sum(1 for a, b in pairs if a > b) / len(pairs) if pairs else None
        if res["top_decile"] is not None and res["bottom_decile"] is not None:
            res["spread"] = res["top_decile"] - res["bottom_decile"]
        out["horizons" if days else "running"][hname] = res
    return out
