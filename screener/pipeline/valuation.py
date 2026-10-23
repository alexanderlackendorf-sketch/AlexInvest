"""Fairer Wert je Aktie, Kaufkurs und Preis-Score [BERECHNET aus SCHÄTZUNGEN].

Unternehmen (zwei unabhängige Methoden, Mittelwert):
  1. DCF auf die Ertragskraft je Aktie
     Basis = max(FCF letzte 12 M., Owner Earnings letztes GJ) minus Aktienvergütung
       Owner Earnings = operativer Cashflow - min(Investitionen, Abschreibungen): Investitionen über den
       Abschreibungen sind Wachstum (z.B. KI-Rechenzentren), kein Erhalt.
       Belegte Zykliker: normalisiert = Median-Marge 5 J. × aktueller Umsatz je Aktie.
     Wachstum Jahre 1-5 = ½ Umsatz-CAGR 5 J. + ½ aktuelles Umsatzwachstum, begrenzt -3 … +20 %,
     Jahre 6-10 linear auf 3 %, danach 2,5 % ewig.
     Diskontsatz 8,5 % + Zuschläge (Verschuldung > 3x EBITDA +1 %, instabile Marge/Verlustjahre +1 %,
     Volatilität > 40 % +0,5 %).
  2. Multiplikator: Konsens-EPS nächstes GJ (Zykliker: normalisiertes EPS) × faires KGV
     (eigenes Median-KGV 5 J., sonst Gruppen-Median; begrenzt auf 10-30).
Banken/Versicherer: gerechtfertigtes KBV = (ROE - 3 %) / (10 % - 3 %), begrenzt 0,5-3, × Buchwert je Aktie;
  dazu Konsens-EPS × faires KGV (7-16).
REITs: Dividendenmodell (grob, niedrige Belastbarkeit).

Kaufkurs = fairer Wert × (1 - Sicherheitsmarge); die Marge hängt von der Qualität ab
(>= 7,5: 10 %, >= 6: 20 %, sonst 30 %; +10 % bei niedriger Belastbarkeit).
"""
from __future__ import annotations

from .quality import scale

R_BASE, R_FIN, R_REIT = 0.085, 0.10, 0.085
G_TERMINAL, G_FADE_TO = 0.025, 0.03
G_MIN, G_MAX = -0.03, 0.20
PE_MIN, PE_MAX = 10.0, 30.0
PRICE_PTS = [(-0.50, 0), (-0.25, 2), (0.0, 4.5), (0.15, 6), (0.30, 7.5), (0.50, 9), (0.75, 10)]
NEUTRAL_P = 4.5


def _v(x):
    return None if x is None or x != x else x


def growth_rate(r: dict) -> float | None:
    """Basisfall: tatsächliches Umsatzwachstum (Mittel aus 5-Jahres-CAGR und aktuellem Wachstum), ohne
    pauschalen Abschlag. Die Vorsicht steckt im Auslaufen auf 3 % ab Jahr 6 und im Bear-Szenario."""
    hist, now = _v(r.get("rev_cagr")), _v(r.get("rev_growth"))
    vals = [x for x in (hist, now) if x is not None]
    if not vals:
        return None
    return max(G_MIN, min(G_MAX, sum(vals) / len(vals)))


def discount_rate(r: dict) -> tuple[float, list[str]]:
    rate, why = R_BASE, []
    nd = _v(r.get("net_debt_ebitda"))
    if nd is not None and nd > 3:
        rate += 0.01
        why.append("Verschuldung > 3x EBITDA +1 %")
    if (_v(r.get("op_margin_std")) or 0) > 0.05 or (_v(r.get("loss_years5")) or 0) >= 2:
        rate += 0.01
        why.append("schwankende Marge/Verlustjahre +1 %")
    if (_v(r.get("vol_1y")) or 0) > 0.40:
        rate += 0.005
        why.append("Volatilität > 40 % +0,5 %")
    return rate, why


def cash_flows(cf0: float, g: float, years: int = 10) -> list[float]:
    out, cf = [], cf0
    for t in range(1, years + 1):
        gt = g if t <= 5 else g + (G_FADE_TO - g) * (t - 5) / 5
        cf *= 1 + gt
        out.append(cf)
    return out


def dcf(cf0: float, g: float, r: float, at_year: int = 0) -> float:
    """Wert je Aktie heute (at_year=0) bzw. in n Jahren (Barwert der dann noch ausstehenden Zahlungen)."""
    flows = cash_flows(cf0, g)
    tv = flows[-1] * (1 + G_TERMINAL) / (r - G_TERMINAL)
    v0 = sum(c / (1 + r) ** t for t, c in enumerate(flows, 1)) + tv / (1 + r) ** len(flows)
    if at_year == 0:
        return v0
    paid = sum(c / (1 + r) ** t for t, c in enumerate(flows[:at_year], 1))
    return (v0 - paid) * (1 + r) ** at_year


def base_cash_flow(r: dict, cyclical: bool) -> tuple[float | None, str]:
    price = _v(r.get("price"))
    rev_ps = _v(r.get("rev_ps_trading"))
    sbc_ps = _v(r.get("sbc_ps_trading")) or 0.0
    if cyclical and _v(r.get("owner_margin_med5")) is not None and rev_ps:
        return r["owner_margin_med5"] * rev_ps - sbc_ps, "normalisiert: Median-Marge 5 J. × Umsatz je Aktie − Aktienvergütung"
    ttm = _v(r.get("fcf_yield")) * price if (_v(r.get("fcf_yield")) is not None and price) else None
    own = _v(r.get("owner_ps_trading"))
    cands = [x for x in (ttm, own) if x is not None]
    if not cands:
        return None, ""
    base = max(cands) - sbc_ps
    src = "Owner Earnings letztes GJ" if own is not None and own >= (ttm or -1e18) else "FCF letzte 12 Monate"
    return base, f"{src} − Aktienvergütung"


def fair_value(r: dict, q_score: float | None, peer_pe: float | None) -> dict | None:
    price = _v(r.get("price"))
    if not price or "kurs_veraltet" in (r.get("flags") or []):
        return None
    flags = set(r.get("flags") or [])
    cyclical = "zyklik_normalisiert" in flags
    if "zyklik_spitzengewinn" in flags:
        return {"fair_value": None, "reason": "Möglicher zyklischer Spitzengewinn ohne Mehrjahresdaten – nicht bewertbar."}
    methods, notes = [], []
    g = growth_rate(r)

    if r.get("is_reit"):
        dps = (_v(r.get("div_yield")) or 0) * price
        if dps > 0:
            gr = max(0.0, min(0.04, 0.5 * (_v(r.get("rev_cagr")) or 0)))
            methods.append({"name": "Dividendenmodell (REIT)", "value": dps * (1 + gr) / (R_REIT - gr),
                            "detail": f"Dividende {dps:.2f} × (1 + {gr:.1%}) / ({R_REIT:.1%} − {gr:.1%})"})
        rate = R_REIT
    elif r.get("is_financial"):
        rate = R_FIN
        roe = _v(r.get("roe_med5")) or _v(r.get("roe"))
        pb = _v(r.get("pb"))
        if roe is not None and pb and pb > 0:
            jpb = max(0.5, min(3.0, (roe - 0.03) / (rate - 0.03)))
            bvps = price / pb
            methods.append({"name": "Gerechtfertigtes KBV", "value": bvps * jpb,
                            "detail": f"Buchwert {bvps:.2f} × KBV {jpb:.2f} (ROE {roe:.1%}, Kapitalkosten {rate:.0%})"})
        pe_f, eps_f = _v(r.get("pe_fwd")), _v(r.get("eps_fwd"))
        if pe_f and eps_f and eps_f > 0:
            fpe = max(7.0, min(16.0, _v(r.get("pe_hist_med5")) or peer_pe or 11.0))
            methods.append({"name": "Gewinn × faires KGV", "value": price / pe_f * fpe,
                            "detail": f"Konsens-EPS {price / pe_f:.2f} × KGV {fpe:.1f}"})
    else:
        rate, why = discount_rate(r)
        notes += why
        cf0, src = base_cash_flow(r, cyclical)
        if cf0 and cf0 > 0 and g is not None:
            methods.append({"name": "DCF Ertragskraft", "value": dcf(cf0, g, rate), "cf0": cf0,
                            "detail": f"{src}: {cf0:.2f} je Aktie, Wachstum {g:.1%} (J. 1–5), Diskont {rate:.1%}"})
        eps = _v(r.get("eps_norm_trading")) if cyclical else (
            price / r["pe_fwd"] if _v(r.get("pe_fwd")) and _v(r.get("eps_fwd")) and r["eps_fwd"] > 0 else None)
        hist_pe = _v(r.get("pe_hist_med5"))
        fpe = hist_pe if hist_pe else peer_pe
        if eps and eps > 0 and fpe:
            fpe = max(PE_MIN, min(PE_MAX, fpe))
            methods.append({"name": "Gewinn × faires KGV", "value": eps * fpe, "eps": eps, "pe": fpe,
                            "detail": f"{'normalisiertes' if cyclical else 'Konsens-'}EPS {eps:.2f} × KGV {fpe:.1f} "
                                      f"({'eigener 5J-Median' if hist_pe else 'Gruppen-Median'}, begrenzt 10–30)"})

    methods = [m for m in methods if m["value"] and m["value"] > 0]
    if not methods:
        return {"fair_value": None, "reason": "Keine belastbare Ertragsbasis (Verlust, negativer Cashflow oder fehlende Daten)."}
    vals = [m["value"] for m in methods]
    fv = sum(vals) / len(vals)
    if len(vals) >= 2:
        spread = max(vals) / min(vals)
        conf = "hoch" if spread <= 1.3 else "mittel" if spread <= 1.8 else "niedrig"
    else:
        conf = "niedrig" if r.get("is_reit") else "mittel"
    mos = 0.10 if (q_score or 0) >= 7.5 else 0.20 if (q_score or 0) >= 6 else 0.30
    if conf == "niedrig":
        mos += 0.10
    upside = fv / price - 1
    p_score = scale(upside, PRICE_PTS)
    if conf == "niedrig":
        p_score = NEUTRAL_P + (p_score - NEUTRAL_P) * 0.5

    # Szenarien und Wert in 1/2/3 Jahren (Annahme: Kurs nähert sich dem fairen Wert an)
    def variant(dg, dr, dpe):
        out = []
        for m in methods:
            if m["name"] == "DCF Ertragskraft":
                out.append(dcf(m["cf0"], max(G_MIN, min(G_MAX, (g or 0) + dg)), rate + dr))
            elif "pe" in m:
                out.append(m["eps"] * m["pe"] * dpe)
            else:
                out.append(m["value"] * dpe)
        return sum(out) / len(out)

    def at_year(n):
        out = []
        for m in methods:
            if m["name"] == "DCF Ertragskraft":
                out.append(dcf(m["cf0"], g, rate, at_year=n))
            else:
                out.append(m["value"] * (1 + max(0.0, g or 0.0)) ** n)
        return sum(out) / len(out)

    div = _v(r.get("div_yield")) or 0.0
    y3 = at_year(3)
    total3 = (y3 + 3 * div * price) / price - 1
    return {
        "fair_value": round(fv, 2), "confidence": conf, "methods": [
            {"name": m["name"], "value": round(m["value"], 2), "detail": m["detail"]} for m in methods],
        "growth": round(g, 3) if g is not None else None, "discount": round(rate, 3), "discount_notes": notes,
        "mos_required": round(mos, 2), "buy_price": round(fv * (1 - mos), 2),
        "upside": round(upside, 3), "price_score": round(p_score, 1),
        "range": [round(variant(-0.04, 0.01, 0.85), 2), round(variant(0.03, -0.005, 1.10), 2)],
        "y1": round(at_year(1), 2), "y2": round(at_year(2), 2), "y3": round(y3, 2),
        "cagr3": round((1 + total3) ** (1 / 3) - 1, 3) if total3 > -1 else None,
    }
