"""Modell-Kursziele 1/2/3 Jahre.

Kursziel_n = EPS_fwd * Π(1 + g_k) * fairesKGV
  - EPS_fwd: Konsens-EPS nächstes Geschäftsjahr (Yahoo)
  - g: erwartetes EPS-Wachstum, gedeckelt auf [-10 %, +25 %], abnehmend (100 % / 80 % / 60 %)
  - faires KGV: Mittel aus eigenem Forward-KGV und Sektor-Median, Neubewertung aber max. +/-25 %
    (niedrige KGVs sind oft verdient -> keine volle Mean-Reversion)
Nur für profitable Unternehmen mit Forward-EPS. Ausdrücklich ein Modell, keine Prognose.
"""
from __future__ import annotations


def model_targets(m: dict, sector_median_pe: float | None) -> dict | None:
    eps_fwd, pe_fwd, price = m.get("eps_fwd"), m.get("pe_fwd"), m.get("price")
    if not (eps_fwd and eps_fwd > 0 and pe_fwd and price):
        return None
    g = m.get("eps_growth_fwd")
    if g is None:
        g = m.get("earn_growth")
    if g is None:
        return None
    g = max(-0.10, min(0.25, g))
    base_pe = pe_fwd if sector_median_pe is None else 0.5 * pe_fwd + 0.5 * sector_median_pe
    fair_pe = max(pe_fwd * 0.75, min(pe_fwd * 1.25, base_pe))
    # EPS_fwd ist in Bilanzwährung; Verhältnis Kurs/KGV rechnet sauber in Handelswährung zurück
    eps_trading = price / pe_fwd
    out = {"fair_pe": round(fair_pe, 1), "growth": round(g, 3)}
    eps = eps_trading
    for year, damp in zip((1, 2, 3), (1.0, 0.8, 0.6)):
        eps *= 1 + g * damp
        t = eps * fair_pe
        out[f"y{year}"] = round(t, 2)
        out[f"y{year}_upside"] = round(t / price - 1, 3)
    return out
