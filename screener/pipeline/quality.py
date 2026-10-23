"""Unternehmensqualität 0-10 auf einer ABSOLUTEN Skala (keine erzwungene Verteilung).

Jede Komponente wird über feste, offengelegte Stützpunkte (lineare Interpolation) auf 0-10 abgebildet.
Ausnahme: Die Margenhöhe wird innerhalb der Vergleichsgruppe gemessen, weil sie vom Geschäftsmodell
abhängt (Software ~30 %, Handel ~5 % sind beide "normal").

Komponenten (Unternehmen / Bank-ähnliche Finanzwerte):
  Rentabilität   ROIC Median 5 J. (Kapitalkosten ~8-9 %)        / ROE Median 5 J.
  Margen         operative Marge, Perzentil in der Vergleichsgruppe / -
  Stabilität     Margen-Schwankung um den Trend, Verlustjahre     / ROE-Schwankung, Verlustjahre
  Gewinnqualität operativer Cashflow / Gewinn (5 J.)              / -
  Bilanz         Nettoverschuldung / EBITDA                       / -
  Wachstum       Umsatz-CAGR 5 J.                                 / Umsatz-CAGR 5 J.
  Zu-/Abschläge  Verwässerung durch neue Aktien, Rückkäufe, steigender/fallender Margen-Trend
"""
from __future__ import annotations


def scale(v, points):
    """Stückweise lineare Abbildung; points = [(x, score), ...] aufsteigend nach x."""
    if v is None or v != v:
        return None
    if v <= points[0][0]:
        return float(points[0][1])
    for (x0, y0), (x1, y1) in zip(points, points[1:]):
        if v <= x1:
            return y0 + (y1 - y0) * (v - x0) / (x1 - x0)
    return float(points[-1][1])


ROIC_PTS = [(0.02, 0), (0.06, 2.5), (0.09, 4.5), (0.12, 6), (0.18, 8), (0.30, 10)]
ROE_FIN_PTS = [(0.04, 0), (0.07, 2.5), (0.10, 5), (0.13, 7), (0.17, 8.5), (0.22, 10)]
ROE_FALLBACK_PTS = [(0.04, 0), (0.08, 3), (0.12, 5), (0.18, 6.5), (0.25, 7)]   # verzerrbar -> max. 7
STAB_PTS = [(0.01, 10), (0.03, 8), (0.05, 6), (0.08, 3.5), (0.12, 1), (0.18, 0)]
ROE_STAB_PTS = [(0.01, 10), (0.025, 8), (0.04, 6), (0.07, 3), (0.12, 0)]
OCF_PTS = [(0.5, 0), (0.7, 3), (0.9, 6), (1.05, 8.5), (1.2, 10)]
LEV_PTS = [(-1.0, 10), (0.0, 9.5), (1.0, 8), (2.0, 6), (3.0, 4), (4.0, 2), (5.0, 0)]
GROWTH_PTS = [(-0.05, 0), (0.0, 3), (0.04, 5), (0.08, 6.5), (0.12, 8), (0.20, 9.5), (0.30, 10)]

WEIGHTS = {"Rentabilität": 0.30, "Margen": 0.15, "Stabilität": 0.15, "Gewinnqualität": 0.10,
           "Bilanz": 0.15, "Wachstum": 0.15}
WEIGHTS_FIN = {"Rentabilität": 0.45, "Stabilität": 0.30, "Wachstum": 0.25}
MIN_COMPONENTS = 3
MIN_COMPONENTS_FIN = 2   # Banken/Versicherer haben weniger anwendbare Komponenten


def _v(x):
    return None if x is None or x != x else x


def components(r: dict, margin_pct: float | None) -> dict[str, float | None]:
    fin = bool(r.get("is_financial"))
    loss_years = _v(r.get("loss_years5")) if (_v(r.get("hist_years")) or 0) >= 3 else None
    c: dict[str, float | None] = {}
    if fin:
        roe = _v(r.get("roe_med5"))
        if roe is None and _v(r.get("roe")) is not None:
            roe = _v(r["roe"]) * 0.9   # nur ein Jahr belegt -> leicht vorsichtiger
        c["Rentabilität"] = scale(roe, ROE_FIN_PTS)
        st = scale(_v(r.get("roe_std5")), ROE_STAB_PTS)
        if st is not None and loss_years:
            st = max(0.0, st - 2.0 * loss_years)
        c["Stabilität"] = st
    else:
        roic = _v(r.get("roic_med5"))
        if roic is None and _v(r.get("roic_ttm_est")) is not None:
            roic = _v(r["roic_ttm_est"]) * 0.9   # nur ein Jahr und geschätzte Steuerquote -> vorsichtiger
        rent = scale(roic, ROIC_PTS) if roic is not None else scale(_v(r.get("roe")), ROE_FALLBACK_PTS)
        rx = scale(_v(r.get("roic_ex_gw_med5")), ROIC_PTS)
        if rent is not None and rx is not None and _v(r.get("roic_med5")) is not None:
            rent = (rent + rx) / 2   # Mittel aus ROIC mit und ohne Goodwill
        c["Rentabilität"] = rent
        c["Margen"] = None if margin_pct is None else margin_pct * 10
        st = scale(_v(r.get("op_margin_std")), STAB_PTS)
        if st is not None and loss_years:
            st = max(0.0, st - 1.5 * loss_years)
        c["Stabilität"] = st
        c["Gewinnqualität"] = scale(_v(r.get("ocf_conversion")), OCF_PTS)
        nd = _v(r.get("net_debt_ebitda"))
        c["Bilanz"] = scale(nd, LEV_PTS)
    g = _v(r.get("rev_cagr"))
    if g is None and _v(r.get("rev_growth")) is not None:
        g = _v(r["rev_growth"]) * 0.7   # nur Quartal gegen Vorjahr -> gedämpft
    c["Wachstum"] = scale(g, GROWTH_PTS)
    return c


def adjustments(r: dict) -> list[tuple[str, float]]:
    adj = []
    sh = _v(r.get("share_cagr"))
    if sh is not None:
        if sh > 0.04:
            adj.append(("Verwässerung > 4 % p.a.", -1.5))
        elif sh > 0.02:
            adj.append(("Verwässerung > 2 % p.a.", -0.7))
        elif sh < -0.02:
            adj.append(("Aktienrückkäufe > 2 % p.a.", +0.3))
    tr = _v(r.get("op_margin_trend"))
    if tr is not None and not r.get("is_financial"):
        if tr > 0.02:
            adj.append(("Marge steigt > 2 Pp. p.a.", +0.5))
        elif tr < -0.02:
            adj.append(("Marge fällt > 2 Pp. p.a.", -0.7))
    if r.get("loss_making"):
        adj.append(("aktuell Verlust", -1.0))
    return adj


def quality(r: dict, margin_pct: float | None) -> dict:
    """Ergebnis: {"score": 0-10 oder None, "components": {...}, "adjustments": [...]}"""
    comp = components(r, margin_pct)
    weights = WEIGHTS_FIN if r.get("is_financial") else WEIGHTS
    avail = {k: v for k, v in comp.items() if v is not None and k in weights}
    adj = adjustments(r)
    if len(avail) < (MIN_COMPONENTS_FIN if r.get("is_financial") else MIN_COMPONENTS):
        return {"score": None, "components": comp, "adjustments": adj}
    w = sum(weights[k] for k in avail)
    base = sum(weights[k] * v for k, v in avail.items()) / w
    score = max(0.0, min(10.0, base + sum(a for _, a in adj)))
    return {"score": round(score, 1), "components": {k: (round(v, 1) if v is not None else None) for k, v in comp.items()},
            "adjustments": adj}
