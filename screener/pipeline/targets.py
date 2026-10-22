"""Modell-Bewertung: faire Wertspanne heute, Szenarien (Bear/Base/Bull) und Kurspfad 1/2/3 Jahre.

Methode: Multiplikator auf Forward-EPS [BERECHNET aus SCHÄTZUNGEN].
  - EPS_fwd: Konsens-EPS nächstes Geschäftsjahr (Yahoo) – eine Schätzung, kein Ist-Wert
  - faires KGV (Base): Mittel aus eigenem Forward-KGV und Sektor-Median, Neubewertung max. +/-25 %
    (niedrige KGVs sind oft verdient -> keine volle Mean-Reversion)
  - Szenarien unterscheiden sich in operativen Annahmen (EPS-Wachstum) und im Multiplikator:
      Bear: Wachstum -10 Pp., KGV x0,8   Base: Konsenswachstum   Bull: Wachstum +5 Pp., KGV x1,15
  - Wachstum gedeckelt auf [-15 %, +25 %] p.a., abnehmend (100 % / 80 % / 60 %)
Nur für profitable Unternehmen mit Forward-EPS; bei Zyklikern im möglichen Spitzengewinn, REITs
(KGV nicht anwendbar) und ohne aktuellen Referenzkurs wird kein Modellwert ausgegeben.
Ausdrücklich ein Modell, keine Prognose; ersetzt keine DCF-Einzelanalyse.
"""
from __future__ import annotations

SCENARIOS = {
    "bear": {"g_shift": -0.10, "pe_mult": 0.80},
    "base": {"g_shift": 0.0, "pe_mult": 1.00},
    "bull": {"g_shift": 0.05, "pe_mult": 1.15},
}
HORIZON = 3


def _path(eps0: float, g: float, pe: float) -> list[float]:
    out, eps = [], eps0
    for damp in (1.0, 0.8, 0.6):
        eps *= 1 + g * damp
        out.append(eps * pe)
    return out


def _v(x):
    """NaN (aus pandas) wie fehlend behandeln."""
    return None if x is None or x != x else x


def model_targets(m: dict, sector_median_pe: float | None) -> dict | None:
    eps_fwd, pe_fwd, price = _v(m.get("eps_fwd")), _v(m.get("pe_fwd")), _v(m.get("price"))
    sector_median_pe = _v(sector_median_pe)
    flags = m.get("flags") or []
    if not (eps_fwd and eps_fwd > 0 and pe_fwd and price):
        return None
    if {"zyklik_spitzengewinn", "kurs_veraltet"} & set(flags):
        return None
    g = _v(m.get("eps_growth_fwd"))
    if g is None:
        g = _v(m.get("earn_growth"))
    if g is None:
        return None
    base_pe = pe_fwd if sector_median_pe is None else 0.5 * pe_fwd + 0.5 * sector_median_pe
    fair_pe = max(pe_fwd * 0.75, min(pe_fwd * 1.25, base_pe))
    # EPS_fwd ist in Bilanzwährung; Kurs/KGV rechnet sauber in Handelswährung zurück
    eps_trading = price / pe_fwd
    div = _v(m.get("div_yield")) or 0.0

    out = {"fair_pe": round(fair_pe, 1), "growth": round(max(-0.15, min(0.25, g)), 3), "div_yield": div,
           "scenarios": {}}
    for name, sc in SCENARIOS.items():
        gs = max(-0.15, min(0.25, g + sc["g_shift"]))
        pe = fair_pe * sc["pe_mult"]
        fv_today = eps_trading * pe
        path = _path(eps_trading, gs, pe)
        end = path[-1]
        # Gesamtrendite: Kurs am Horizontende + Dividenden (konstant zum heutigen Kurs, ohne Wiederanlage)
        total = (end + HORIZON * div * price) / price - 1
        out["scenarios"][name] = {
            "growth": round(gs, 3), "pe": round(pe, 1), "fair_value": round(fv_today, 2),
            "end_price": round(end, 2), "total_return": round(total, 3),
            "cagr": round((1 + total) ** (1 / HORIZON) - 1, 3) if total > -1 else None,
        }
        if name == "base":
            for i, t in enumerate(path, 1):
                out[f"y{i}"] = round(t, 2)
                out[f"y{i}_upside"] = round(t / price - 1, 3)
    fv = out["scenarios"]["base"]["fair_value"]
    out["fair_value"] = fv
    out["fair_range"] = [out["scenarios"]["bear"]["fair_value"], out["scenarios"]["bull"]["fair_value"]]
    out["margin_of_safety"] = round((fv - price) / fv, 3)   # (fairer Wert - Kurs) / fairer Wert
    out["potential"] = round(fv / price - 1, 3)             # fairer Wert / Kurs - 1
    return out


# --- Reverse-DCF: Welches FCF-Wachstum ist im heutigen Unternehmenswert eingepreist? ---
DCF_RATE = 0.09       # Kapitalkosten-Annahme [SCHÄTZUNG], einheitlich für Vergleichbarkeit
DCF_TERMINAL = 0.025  # langfristiges Wachstum nach Jahr 10 [SCHÄTZUNG]
DCF_YEARS = 10


def _dcf_value(fcf: float, g: float, r: float = DCF_RATE, gt: float = DCF_TERMINAL, n: int = DCF_YEARS) -> float:
    v, cf = 0.0, fcf
    for t in range(1, n + 1):
        cf *= 1 + g
        v += cf / (1 + r) ** t
    return v + cf * (1 + gt) / (r - gt) / (1 + r) ** n


def implied_growth(fcf: float | None, ev: float | None) -> float | None:
    """Jährliches FCF-Wachstum (Jahre 1-10), das den heutigen Unternehmenswert (EV) rechtfertigt.
    Nur für positiven FCF und positiven EV; Ergebnis per Bisektion, Bereich -30 % … +60 %."""
    fcf, ev = _v(fcf), _v(ev)
    if not fcf or fcf <= 0 or not ev or ev <= 0:
        return None
    lo, hi = -0.30, 0.60
    if _dcf_value(fcf, hi) < ev:
        return None  # selbst 60 % p.a. reichen nicht -> nicht sinnvoll interpretierbar
    if _dcf_value(fcf, lo) > ev:
        return lo
    for _ in range(60):
        mid = (lo + hi) / 2
        if _dcf_value(fcf, mid) > ev:
            hi = mid
        else:
            lo = mid
    return round((lo + hi) / 2, 4)
