"""Bewertung Modell 3: erwartete Rendite, Reverse-DCF, fairer Wert mit Unsicherheitsstufe [BERECHNET aus SCHÄTZUNGEN].

Leitfrage eines Profi-Investors: "Welche Rendite bekomme ich zum heutigen Kurs?"
Grundlage sind ausschließlich geprüfte Jahresabschlüsse und Umsatzdaten – keine Analysten-EPS-Prognosen
(Yahoo mischt bereinigte Prognosen mit GAAP-Ist-Gewinnen), kein Beta, kein Ziel-KGV.

Ertragskraft je Aktie (cf0)
  Owner Earnings = operativer Cashflow - min(Investitionen, Abschreibungen) - Aktienvergütung,
  normalisiert: 5-Jahres-Median-Marge × Umsatz je Aktie (liegt das letzte Jahr darüber: Ø beider Werte,
  bei strukturell steigender Marge das letzte Jahr; belegte Zykliker: immer Median).
  Banken/Versicherer: ROE (Median 5 J.) × Buchwert je Aktie. REITs: Dividende je Aktie.
Wachstum: Umsatz-CAGR (niedrigerer Wert aus 5 und bis 10 J.) und aktuelles Umsatzwachstum, der niedrigere
  der beiden zählt doppelt, gedeckelt durch die Gegenwart: höchstens der höhere Wert aus aktuellem
  Umsatzwachstum und erwartetem Gewinnwachstum (Prognosen nur als Deckel nach unten, nie als Basis),
  begrenzt -3 … +15 %; gilt 5 Jahre, läuft dann je nach Wettbewerbsvorteil (Qualität >= 8: bis Jahr 15,
  >= 6,5: bis Jahr 10, sonst ab Jahr 3 bis Jahr 7) linear auf 3 % aus, danach 3 % ewig.
Reinvestition (Werttreiber-Formel, McKinsey "Valuation"): Wachstum kostet Kapital.
  Ausschüttbar = Ertragskraft × (1 - Wachstum / ROIC), ROIC Median 5 J. mit Goodwill (begrenzt 6-40 %).
Markt zweifelt: Liegt das eingepreiste Wachstum (Reverse-DCF) mehr als 8 Pp. unter der Modellannahme,
  wird die Wettbewerbsvorteils-Periode um eine Stufe verkürzt und die Unsicherheit steigt um eine Stufe.

1. Erwartete Rendite = interner Zinsfuß (IRR), bei dem der Barwert dieser Zahlungen dem Kurs entspricht.
2. Reverse-DCF: Welches Wachstum (J. 1-5) preist der Kurs bei 9 % Eigenkapitalkosten ein?
3. Fairer Wert = 75 % DCF zu Eigenkapitalkosten (nach Unsicherheit 8/9/10/11 %, Banken mind. 10 %,
   REITs 8,5 %) + 25 % eigene Bewertungshistorie (Ertragskraft / Median-Owner-Earnings-Rendite 5 J.,
   höchstens das 1,5-Fache der heutigen Bewertung: alte Hype-Bewertungen werden nicht fortgeschrieben).
   Unsicherheit gering/mittel/hoch/sehr hoch (Morningstar-Logik) -> nötige Sicherheitsmarge 15/25/35/50 %.
Kaufkurs = Kurs, bei dem die erwartete Rendite die Hürde erreicht: Hürde = Eigenkapitalkosten + 2 Pp.
  (das Risiko steckt schon in den Eigenkapitalkosten; kein zweiter Aufschlag nach Qualität).
  Liegt der Kaufkurs mehr als 50 % unter dem Kurs, gilt er als "außer Reichweite".
Szenarien: Bär = Schrumpfung (Wachstum höchstens -2 %, Ertragskraft -25 %, kurze Vorteils-Periode),
  Bulle = Wachstum +3 Pp., Ertragskraft +10 %.
"""
from __future__ import annotations

from .quality import scale

COE, COE_FIN, COE_REIT = 0.09, 0.10, 0.085   # Eigenkapitalkosten: langfristige Aktienmarktrendite ~9 % [SCHÄTZUNG]
# Eigenkapitalkosten nach Unsicherheit (Morningstar-Praxis: ~7,5-10,5 %) statt Beta
COE_BY_LEVEL = {"gering": 0.08, "mittel": 0.09, "hoch": 0.10, "sehr hoch": 0.11}
G_TERMINAL, G_FADE_TO = 0.03, 0.03   # langfristig ~ nominales Wirtschaftswachstum abzüglich Sicherheitsabschlag
G_MIN, G_MAX = -0.03, 0.15
G_MAX_FIN, G_MAX_REIT = 0.08, 0.04
ROIC_MIN, ROIC_MAX = 0.06, 0.40
ROIC_DEFAULT = 0.10   # ohne belegten ROIC [SCHÄTZUNG]
YEARS = 15
# Wettbewerbsvorteils-Periode (Morningstar: Moat bestimmt, wie lange Überrenditen anhalten):
# Jahr, bis zu dem das Wachstum auf das langfristige Niveau ausgelaufen ist
CAP_WIDE, CAP_NARROW, CAP_NONE = 15, 10, 7
ER_PTS = [(0.02, 0), (0.05, 2), (0.08, 4), (0.10, 5.5), (0.12, 7), (0.15, 8.5), (0.20, 10)]
HIST_PTS = [(0.5, 0), (0.7, 2), (0.85, 3.5), (1.0, 5), (1.2, 6.5), (1.5, 8.5), (2.0, 10)]
MOS = {"gering": 0.15, "mittel": 0.25, "hoch": 0.35, "sehr hoch": 0.50}
LEVELS = ["gering", "mittel", "hoch", "sehr hoch"]
MAX_UPSIDE = 3.0   # darüber fast immer Datenfehler (Währung, Aktiengattung, Abspaltung)
EXTREME_UPSIDE = 1.5   # darüber: Markt sieht einen Bruch -> Unsicherheit "sehr hoch"
HIST_YIELD_MIN = 0.035   # eigene Bewertungshistorie höchstens ~28x Ertragskraft (Bewertungsblasen nicht fortschreiben)
HIST_RATIO_MAX = 1.5     # Rückkehr höchstens zur 1,5-fachen heutigen Bewertung
W_HIST = 0.25            # Gewicht der eigenen Bewertungshistorie im fairen Wert (Rest: DCF)
DOUBT_GAP = 0.08         # Modellwachstum mehr als 8 Pp. über dem eingepreisten Wachstum -> Markt zweifelt
HURDLE_PREMIUM = 0.02
OUT_OF_REACH = 0.5       # Kaufkurs < 50 % des Kurses -> "außer Reichweite"
BEAR = {"g_max": -0.02, "dg": -0.04, "cf": 0.75}
BULL = {"dg": 0.03, "cf": 1.10}


def _v(x):
    return None if x is None or x != x else x


def _clip(x, lo, hi):
    return max(lo, min(hi, x))


# --- Wachstum ---
def hist_growth(r: dict) -> float | None:
    hist, long = _v(r.get("rev_cagr")), _v(r.get("rev_cagr_long"))
    if hist is not None and long is not None:
        return min(hist, long)   # Corona-Basiseffekt im 5-Jahres-Fenster ausblenden
    return hist if hist is not None else long


def present_growth(r: dict) -> float | None:
    """Höherer Wert aus aktuellem Umsatzwachstum und erwartetem Gewinnwachstum (ohne unplausible Prognosen)."""
    now = _v(r.get("rev_growth"))
    fwd = _v(r.get("eps_growth_fwd"))
    if fwd is not None and ("eps_wachstum_unplausibel" in (r.get("flags") or []) or abs(fwd) > 0.5):
        fwd = None
    vals = [x for x in (now, fwd) if x is not None]
    return max(vals) if vals else None


def growth_rate(r: dict, g_max: float = G_MAX) -> float | None:
    hist, now = hist_growth(r), _v(r.get("rev_growth"))
    if hist is not None and now is not None:
        # Der niedrigere Wert zählt doppelt: bremst das Wachstum ab, dominiert die Gegenwart
        g = (2 * min(hist, now) + max(hist, now)) / 3
    else:
        g = hist if hist is not None else (now * 0.7 if now is not None else None)
    cap = present_growth(r)
    if g is not None and cap is not None:
        g = min(g, cap)   # Wendepunkt: die Vergangenheit darf die Gegenwart nicht überstimmen
    return None if g is None else _clip(g, G_MIN, g_max)


def growth_conflict(r: dict) -> bool:
    hist, now = hist_growth(r), _v(r.get("rev_growth"))
    return hist is not None and now is not None and abs(hist - now) > 0.15


# --- Zahlungsreihe, Barwert, IRR ---
def cap_for(q_score) -> int:
    q = q_score or 0
    return CAP_WIDE if q >= 8 else CAP_NARROW if q >= 6.5 else CAP_NONE


def shorter_cap(cap: int) -> int:
    return CAP_NARROW if cap == CAP_WIDE else CAP_NONE


def _path(cf0: float, g: float, roic: float | None, cap: int = CAP_NARROW) -> tuple[list[float], float]:
    """Ausschüttbare Zahlungen Jahre 1-15 und Zahlung im Jahr 16 (Basis der ewigen Rente).
    Wachstum g bis Jahr 5 (bei CAP_NONE bis Jahr 3), danach linear bis zum Jahr `cap` auf 3 %."""
    flows, e = [], cf0
    hold = 5 if cap > 7 else 3
    for t in range(1, YEARS + 1):
        gt = g if t <= hold else G_FADE_TO if t >= cap else g + (G_FADE_TO - g) * (t - hold) / (cap - hold)
        e *= 1 + gt
        rein = 0.0 if roic is None else _clip(max(gt, 0.0) / roic, 0.0, 0.9)
        flows.append(e * (1 - rein))
    e11 = e * (1 + G_TERMINAL)
    rein = 0.0 if roic is None else _clip(G_TERMINAL / roic, 0.0, 0.9)
    return flows, e11 * (1 - rein)


def value(cf0: float, g: float, roic: float | None, rate: float, at_year: int = 0, cap: int = CAP_NARROW) -> float:
    """Barwert je Aktie; at_year=n: Wert in n Jahren (Zahlungen ab Jahr n+1)."""
    flows, cf11 = _path(cf0, g, roic, cap)
    pv = sum(cf / (1 + rate) ** (t - at_year) for t, cf in enumerate(flows, 1) if t > at_year)
    return pv + cf11 / (rate - G_TERMINAL) / (1 + rate) ** (YEARS - at_year)


def irr(price: float, cf0: float, g: float, roic: float | None, cap: int = CAP_NARROW) -> float:
    lo, hi = G_TERMINAL + 0.005, 0.60
    if value(cf0, g, roic, lo, cap=cap) <= price:
        return lo
    if value(cf0, g, roic, hi, cap=cap) >= price:
        return hi
    for _ in range(60):
        mid = (lo + hi) / 2
        if value(cf0, g, roic, mid, cap=cap) > price:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def implied_growth(price: float, cf0: float, roic: float | None, rate: float = COE, cap: int = CAP_NARROW) -> float | None:
    """Reverse-DCF: Wachstum J. 1-5, das der Kurs bei `rate` einpreist. Bei ROIC <= Kapitalkosten schafft
    Wachstum keinen Wert – dann ist die Frage nicht sinnvoll beantwortbar."""
    if roic is not None and roic <= rate + 0.01:
        return None
    lo, hi = -0.10, 0.40
    if value(cf0, lo, roic, rate, cap=cap) >= price:
        return lo
    if value(cf0, hi, roic, rate, cap=cap) <= price:
        return hi
    for _ in range(60):
        mid = (lo + hi) / 2
        if value(cf0, mid, roic, rate, cap=cap) < price:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


# --- Ertragskraft ---
def base_cash_flow(r: dict, cyclical: bool) -> tuple[float | None, str]:
    price = _v(r.get("price"))
    rev_ps = _v(r.get("rev_ps_trading"))
    sbc_ps = _v(r.get("sbc_ps_trading")) or 0.0
    med, last = _v(r.get("owner_margin_med5")), _v(r.get("owner_margin_last"))
    if rev_ps and med is not None:
        # Normalisiert über den 5-Jahres-Median: Einmalzahlungen im operativen Cashflow (Steuernachzahlungen,
        # Kaufpreis-Nachzahlungen wie Coca-Colas Fairlife 2025) verzerren ein einzelnes Jahr stark
        med10 = _v(r.get("owner_margin_med10"))
        if cyclical and med10 is not None and med10 < med:
            m, how = med10, "Median-Marge 10 J. (Zykliker, ganzer Zyklus)"
        elif cyclical or last is None or last <= med:
            m, how = med, "Median-Marge 5 J." + (" (Zykliker)" if cyclical else "")
        elif (_v(r.get("op_margin_trend")) or 0) > 0.01:
            m, how = last, "Marge letztes GJ (steigt strukturell)"
        else:
            m, how = (last + med) / 2, "Ø Marge letztes GJ und 5J-Median"
        return m * rev_ps - sbc_ps, f"Owner Earnings ({how} {m:.1%} × Umsatz je Aktie) − Aktienvergütung"
    own = _v(r.get("owner_ps_trading"))
    if own is not None:
        return own - sbc_ps, "Owner Earnings letztes GJ − Aktienvergütung"
    fy = _v(r.get("fcf_yield"))
    if fy is not None and price:
        return fy * price, "FCF letzte 12 Monate (Yahoo, ohne Mehrjahresdaten)"
    return None, ""


def roic_for(r: dict) -> tuple[float, str]:
    """Rendite auf neu investiertes Kapital: ROIC Median 5 J. mit Goodwill (Wachstum über Zukäufe kostet
    Goodwill; der ROIC ohne Goodwill unterschätzt den Kapitalbedarf); liegt das letzte Jahr höher, zählt es
    zur Hälfte."""
    med, last = _v(r.get("roic_med5")), _v(r.get("roic_last"))
    if med is not None:
        base, src = med, "ROIC Median 5 J. (mit Goodwill)"
        if last is not None and last > base:
            base, src = (base + last) / 2, src + ", letztes Jahr höher"
        return _clip(base, ROIC_MIN, ROIC_MAX), src
    if r.get("ic_negative_profitable"):
        return ROIC_MAX, "ROIC sehr hoch (Gewinn auf negativem Kapital)"
    if _v(r.get("roic_ttm_est")) is not None:
        return _clip(r["roic_ttm_est"] * 0.9, ROIC_MIN, ROIC_MAX), "ROIC 12 M. (geschätzt)"
    return ROIC_DEFAULT, "ROIC unbekannt – Annahme 10 %"


def hurdle_for(coe: float) -> float:
    """Mindestrendite für einen Kauf = Eigenkapitalkosten (enthalten schon das Risiko) + 2 Pp."""
    return coe + HURDLE_PREMIUM


def _level(pts: int) -> str:
    return LEVELS[0 if pts == 0 else 1 if pts <= 2 else 2 if pts <= 4 else 3]


def _base_uncertainty(r: dict, cyclical: bool, flags: set) -> list[tuple[int, str]]:
    """Unsicherheitsquellen, die vor der Bewertung feststehen (bestimmen die Eigenkapitalkosten)."""
    out = []
    if r.get("is_reit"):
        out.append((1, "REIT: Bewertung über die Dividende grob"))
    elif r.get("is_financial"):
        out.append((1, "Bank/Versicherer: Bilanzrisiken von außen kaum prüfbar"))
    std = _v(r.get("op_margin_std")) or 0
    if std > 0.10:
        out.append((2, "Marge stark schwankend"))
    elif std > 0.05:
        out.append((1, "Marge schwankend"))
    if (_v(r.get("loss_years5")) or 0) >= 1:
        out.append((1, "Verlustjahr(e) in 5 J."))
    if cyclical:
        out.append((1, "zyklisches Geschäft"))
    if (_v(r.get("hist_years")) or 0) < 5:
        out.append((1, "weniger als 5 Jahre Historie"))
    if growth_conflict(r):
        out.append((1, "Wachstum: Vergangenheit und Gegenwart widersprechen sich"))
    if (_v(r.get("net_debt_ebitda")) or 0) > 3:
        out.append((1, "hohe Verschuldung"))
    if "historie_je_aktie_unplausibel" in flags:
        out.append((1, "Je-Aktie-Werte der Historie unplausibel – Rückfall auf 12-Monats-Daten"))
    return out


def fair_value(r: dict, q_score: float | None) -> dict | None:
    price = _v(r.get("price"))
    if not price or "kurs_veraltet" in (r.get("flags") or []):
        return None
    flags = set(r.get("flags") or [])
    cyclical = "zyklik_normalisiert" in flags or bool(r.get("cyclical_evidenced"))
    if "zyklik_spitzengewinn" in flags:
        return {"fair_value": None, "er": None,
                "reason": "Möglicher zyklischer Spitzengewinn ohne Mehrjahresdaten – nicht bewertbar."}
    unc = _base_uncertainty(r, cyclical, flags)
    pre_level = _level(sum(p for p, _ in unc))
    hist_yield = None

    if r.get("is_reit"):
        cf0 = (_v(r.get("div_yield")) or 0) * price
        src = "Dividende je Aktie (REIT)"
        g = growth_rate(r, G_MAX_REIT)
        g = None if g is None else _clip(0.5 * g, 0.0, G_MAX_REIT)
        roic, roic_src, coe = None, "Ausschüttung vollständig (REIT)", COE_REIT
    elif r.get("is_financial"):
        roe = _v(r.get("roe_med5"))
        if roe is None and _v(r.get("roe")) is not None:
            roe = r["roe"] * 0.9
        pb = _v(r.get("pb"))
        cf0 = roe * price / pb if (roe is not None and pb and pb > 0) else None
        src = f"Eigenkapitalrendite {roe:.1%} × Buchwert je Aktie" if cf0 else ""
        g = growth_rate(r, G_MAX_FIN)
        roic, roic_src = (_clip(roe, ROIC_MIN, ROIC_MAX) if roe else None), "ROE Median 5 J."
        coe = max(COE_FIN, COE_BY_LEVEL[pre_level])
    else:
        cf0, src = base_cash_flow(r, cyclical)
        g = growth_rate(r)
        roic, roic_src = roic_for(r)
        coe = COE_BY_LEVEL[pre_level]
        if roic_src.startswith("ROIC unbekannt"):
            unc.append((1, "ROIC unbekannt – Annahme statt Beleg"))
        hy = _v(r.get("owner_yield_hist_med"))
        if hy is not None and hy > 0.005 and (_v(r.get("owner_yield_hist_n")) or 0) >= 3:
            hist_yield = hy
    if not cf0 or cf0 <= 0 or g is None:
        return {"fair_value": None, "er": None,
                "reason": "Keine belastbare Ertragsbasis (Verlust, negativer Cashflow oder fehlende Daten)."}

    cap = cap_for(q_score)
    # Markt zweifelt: eingepreistes Wachstum weit unter der Modellannahme -> kürzere Vorteils-Periode
    ig0 = implied_growth(price, cf0, roic, coe, cap)
    doubt = ig0 is not None and g - ig0 > DOUBT_GAP
    if doubt:
        unc.append((2, f"Markt zweifelt: Kurs preist {ig0:+.1%} Wachstum ein, Modell rechnet mit {g:+.1%} – "
                       "Wettbewerbsvorteil kürzer angesetzt"))
        cap = shorter_cap(cap)
    er = irr(price, cf0, g, roic, cap)
    methods = [{"name": "DCF zu Eigenkapitalkosten", "value": value(cf0, g, roic, coe, cap=cap),
                "detail": f"{src}: {cf0:.2f} je Aktie, Wachstum {g:.1%} bis Jahr {5 if cap > 7 else 3}, "
                          f"Auslaufen auf 3 % bis Jahr {cap} (Qualität), Reinvestition über "
                          f"{roic_src}{f' {roic:.0%}' if roic else ''}, Eigenkapitalkosten {coe:.0%} "
                          f"(Unsicherheit {pre_level})"}]
    if hist_yield is not None:
        hy = _clip(hist_yield, max(HIST_YIELD_MIN, cf0 / price / HIST_RATIO_MAX), 0.15)
        methods.append({"name": "Eigene Bewertungshistorie", "value": cf0 / hy,
                        "detail": f"Ertragskraft {cf0:.2f} / Median-Owner-Earnings-Rendite 5 J. {hist_yield:.1%}"
                                  + (f" (begrenzt auf {hy:.1%}: höchstens 28x bzw. 1,5-fache heutige Bewertung)"
                                     if hy != hist_yield else "")})
    vals = [m["value"] for m in methods]
    fv = vals[0] if len(vals) == 1 else (1 - W_HIST) * vals[0] + W_HIST * vals[1]
    upside = fv / price - 1
    if methods[0]["value"] / price - 1 > MAX_UPSIDE or er >= 0.40:
        return {"fair_value": None, "er": None,
                "reason": f"Rechnerischer Wert {upside:+.0%} über Kurs bzw. erwartete Rendite ≥ 40 % – bei "
                          "Großunternehmen fast immer Datenfehler (Währung, Aktiengattung, Abspaltung) oder "
                          "Sondersituation; nicht bewertet."}

    # --- Unsicherheit nach der Bewertung: Methodenstreuung und Widerspruch zum Markt ---
    if len(vals) == 2:
        spread = max(vals) / min(vals)
        if spread > 2:
            unc.append((2, "Methoden liegen über Faktor 2 auseinander"))
        elif spread > 1.5:
            unc.append((1, "Methoden liegen über Faktor 1,5 auseinander"))
    if upside > EXTREME_UPSIDE:
        unc.append((5, "Rechenwert mehr als 150 % über Kurs – der Markt sieht einen Bruch (Disruption, Patente, "
                       "Preiskampf?) oder die Daten sind fehlerhaft; ohne Einzelanalyse nicht verwertbar"))
    elif upside > 0.6:
        unc.append((1, "Kurs weit unter Rechenwert – Markt preist ein Risiko ein (Disruption, Klagen, Zyklus?)"))
    level = _level(sum(p for p, _ in unc))
    mos = MOS[level]
    hurdle = hurdle_for(max(coe, COE_BY_LEVEL[level]) if not r.get("is_reit") else coe)
    buy = value(cf0, g, roic, hurdle, cap=cap)

    er_score = scale(er, ER_PTS)
    if level == "sehr hoch":
        er_score = 5 + (er_score - 5) * 0.5
    hist_ratio = (cf0 / price) / hist_yield if hist_yield else None
    hist_ratio_used = None if hist_ratio is None else min(hist_ratio, HIST_RATIO_MAX)
    ig = ig0

    def scen(gg, dm, c):
        gg = _clip(gg, G_MIN, G_MAX)
        return {"er": round(irr(price, cf0 * dm, gg, roic, c), 3),
                "value": round(value(cf0 * dm, gg, roic, coe, cap=c), 2), "growth": round(gg, 3)}

    flows, _ = _path(cf0, g, roic, cap)
    # Fairer Wert in n Jahren: heutiger fairer Wert (beide Methoden) fortgeschrieben mit dem DCF-Pfad
    y = [fv * value(cf0, g, roic, coe, at_year=n, cap=cap) / methods[0]["value"] for n in (1, 2, 3)]
    # Kurs in n Jahren, wenn die Bewertung bleibt (Markt verlangt weiter dieselbe Rendite, keine Neubewertung)
    keep = [value(cf0, g, roic, er, at_year=n, cap=cap) for n in (1, 2, 3)]
    total3 = (y[2] + sum(flows[:3])) / price - 1
    return {
        "er": round(er, 4), "hurdle": round(hurdle, 3), "buy_price": round(buy, 2),
        "fair_value": round(fv, 2), "upside": round(upside, 3), "discount": round(1 - price / fv, 3),
        "mos_required": mos, "uncertainty": level, "uncertainty_why": [t for _, t in unc],
        "methods": [{"name": m["name"], "value": round(m["value"], 2), "detail": m["detail"]} for m in methods],
        "cf0": round(cf0, 4), "cf0_src": src, "growth": round(g, 3), "growth_hist": hist_growth(r),
        "roic": round(roic, 3) if roic else None, "roic_src": roic_src,
        "coe": round(coe, 3), "cap_year": cap, "implied_growth": None if ig is None else round(ig, 3),
        "er_score": round(er_score, 1), "hist_ratio": None if hist_ratio is None else round(hist_ratio, 2),
        "hist_score": None if hist_ratio_used is None else round(scale(hist_ratio_used, HIST_PTS), 1),
        "owner_yield": round(cf0 / price, 4), "market_doubt": doubt,
        "buy_out_of_reach": bool(buy < OUT_OF_REACH * price),
        "scenarios": {"bear": scen(min(g + BEAR["dg"], BEAR["g_max"]), BEAR["cf"], CAP_NONE),
                      "bull": scen(g + BULL["dg"], BULL["cf"], cap)},
        "y1": round(y[0], 2), "y2": round(y[1], 2), "y3": round(y[2], 2),
        "keep": [round(x, 2) for x in keep], "dist3": round(sum(flows[:3]), 2),
        "cagr3": round((1 + total3) ** (1 / 3) - 1, 3) if total3 > -1 else None,
    }
