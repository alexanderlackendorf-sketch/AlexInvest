"""Mehrjahres-Historie (Abschnitt 7 der Analyse-Anweisungen: 3-5+ Geschäftsjahre).

Quellen:
  - US: SEC EDGAR companyfacts (10-K, bis 10 Jahre) [IST]
  - Übrige: Yahoo-Jahresabschlüsse (meist 4 Jahre) [IST, Quelle Yahoo]
Daraus abgeleitet [BERECHNET]: ROIC, Margen-Stabilität, Cash Conversion, Verwässerung,
5-Jahres-Wachstum, historisches KGV. Fehlt eine Größe, bleibt sie leer (keine Annahmen),
mit einer Ausnahme: Ohne berichtete Steuerquote wird für den ROIC kein Wert gebildet.
"""
from __future__ import annotations

import datetime as dt
import logging
import statistics as st
import time

import pandas as pd

from . import fetch

log = logging.getLogger(__name__)
HIST_VERSION = 2  # 2: zusätzlich Abschreibungen (für Ertragskraft vor Wachstumsinvestitionen)
MAX_YEARS = 10

# --- SEC: Konzepte je Größe (erstes vorhandenes gewinnt, Umsatz: größter Wert je Stichtag) ---
SEC_DURATION = {
    "revenue": (["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet",
                 "RevenueFromContractWithCustomerIncludingAssessedTax"], "USD", "max"),
    "op_income": (["OperatingIncomeLoss"], "USD", "first"),
    "net_income": (["NetIncomeLoss", "ProfitLoss"], "USD", "first"),
    "eps": (["EarningsPerShareDiluted"], "USD/shares", "first"),
    "shares": (["WeightedAverageNumberOfDilutedSharesOutstanding"], "shares", "first"),
    "ocf": (["NetCashProvidedByUsedInOperatingActivities",
             "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"], "USD", "first"),
    "capex": (["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets"], "USD", "first"),
    "sbc": (["ShareBasedCompensation", "AllocatedShareBasedCompensationExpense"], "USD", "first"),
    "pretax": (["IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest",
                "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments"],
               "USD", "first"),
    "tax": (["IncomeTaxExpenseBenefit"], "USD", "first"),
    "da": (["DepreciationDepletionAndAmortization", "DepreciationAndAmortization",
            "DepreciationAmortizationAndAccretionNet", "Depreciation"], "USD", "first"),
}
SEC_INSTANT = {
    "equity": ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"],
    "debt": ["LongTermDebt", "LongTermDebtNoncurrent"],
    "debt_current": ["LongTermDebtCurrent", "DebtCurrent"],
    "cash": ["CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents"],
}


def _annual_records(gaap: dict, concept: str, unit: str) -> dict[str, float]:
    """end -> Wert (10-K, ~1 Jahr Dauer, jüngste Einreichung gewinnt bei Restatements)."""
    best: dict[str, tuple[str, float]] = {}
    for rec in gaap.get(concept, {}).get("units", {}).get(unit, []):
        if not str(rec.get("form", "")).startswith("10-K") or "start" not in rec:
            continue
        days = (dt.date.fromisoformat(rec["end"]) - dt.date.fromisoformat(rec["start"])).days
        if not 340 <= days <= 380:
            continue
        filed = rec.get("filed", "")
        if rec["end"] not in best or filed > best[rec["end"]][0]:
            best[rec["end"]] = (filed, float(rec["val"]))
    return {k: v for k, (_, v) in best.items()}


def _instant_records(gaap: dict, concept: str) -> dict[str, float]:
    best: dict[str, tuple[str, float]] = {}
    for rec in gaap.get(concept, {}).get("units", {}).get("USD", []):
        if not str(rec.get("form", "")).startswith("10-K") or "start" in rec:
            continue
        filed = rec.get("filed", "")
        if rec["end"] not in best or filed > best[rec["end"]][0]:
            best[rec["end"]] = (filed, float(rec["val"]))
    return {k: v for k, (_, v) in best.items()}


SPLIT_FACTORS = (2, 3, 4, 5, 8, 10, 15, 20, 25, 30, 40, 50, 1 / 2, 1 / 3, 1 / 4, 1 / 5, 1 / 8, 1 / 10, 1 / 20, 1 / 25)


def split_factor_between(old_shares, new_shares, tol: float = 0.06):
    if not old_shares or not new_shares:
        return None
    ratio = new_shares / old_shares
    return next((f for f in SPLIT_FACTORS if abs(ratio / f - 1) < tol), None)


def adjust_for_recent_split(years: list[dict], shares_now, eps_ttm=None) -> float | None:
    """Split NACH dem letzten Jahresbericht: aktuelle Aktienzahl (gehandelte Gattung) vs. verwässerte
    Aktienzahl des letzten Berichtsjahres. Bestätigung über das EPS: letztes Jahres-EPS / aktuelles EPS
    muss grob zum Faktor passen (Gewinnänderung seither erlaubt: 0,6- bis 1,6-fach)."""
    if not years or not eps_ttm or eps_ttm <= 0:
        return None
    # 12 % Toleranz: seit dem Bericht können Rückkäufe/Ausgaben dazugekommen sein (Split-Faktoren liegen
    # mindestens Faktor 2 auseinander, eine Verwechslung ist damit ausgeschlossen)
    f = split_factor_between(years[-1].get("shares"), shares_now, tol=0.12)
    eps_fy = years[-1].get("eps")
    # Nur normale Splits: ein scheinbarer Reverse-Split ist bei großen Werten fast immer eine
    # Mehrfach-Gattung (z.B. Alphabet A/C), deren Teil-Aktienzahl kleiner ist als die Gesamtzahl
    if f is None or f < 2 or not eps_fy or eps_fy <= 0 or not 0.6 * f <= eps_fy / eps_ttm <= 1.6 * f:
        return None
    for y in years:
        if y.get("shares"):
            y["shares"] *= f
        if y.get("eps") is not None:
            y["eps"] /= f
        y["split_adjusted"] = True
    return f


def fix_share_units(years: list[dict]) -> list[dict]:
    """Aktienzahl gegen Nettogewinn / EPS prüfen. Manche Filer melden die Aktienzahl in Tausend oder
    Millionen (z.B. McDonald's: 716,4 statt 716 Mio.). Passt eine Skalierung, wird sie übernommen."""
    for y in years:
        sh, ni, eps = y.get("shares"), y.get("net_income"), y.get("eps")
        if not sh or not ni or not eps or abs(eps) < 1e-9:
            continue
        implied = ni / eps
        if implied <= 0 or 0.5 < sh / implied < 2:
            continue
        for f in (1e3, 1e6):
            if 0.5 < sh * f / implied < 2:
                y["shares"] = sh * f
                y["shares_unit_fixed"] = True
                break
    return years


def split_adjust(years: list[dict]) -> list[dict]:
    """Ältere Jahresberichte enthalten EPS/Aktienzahl vor späteren Splits. Springt die verwässerte
    Aktienzahl zwischen zwei Jahren genau um einen Split-Faktor, werden alle früheren Jahre angepasst."""
    for i in range(len(years) - 1, 0, -1):
        f = split_factor_between(years[i - 1].get("shares"), years[i].get("shares"))
        if f is None:
            continue
        for y in years[:i]:
            if y.get("shares"):
                y["shares"] *= f
            if y.get("eps") is not None:
                y["eps"] /= f
            y["split_adjusted"] = True
    return years


def extract_sec(facts: dict) -> list[dict]:
    gaap = facts.get("facts", {}).get("us-gaap", {})
    series: dict[str, dict[str, float]] = {}
    for key, (concepts, unit, mode) in SEC_DURATION.items():
        merged: dict[str, float] = {}
        for c in concepts:
            for end, v in _annual_records(gaap, c, unit).items():
                if mode == "max":
                    merged[end] = max(merged.get(end, v), v)
                else:
                    merged.setdefault(end, v)
        series[key] = merged
    ends = sorted(set(series["revenue"]) | set(series["net_income"]))[-MAX_YEARS:]
    for key, concepts in SEC_INSTANT.items():
        merged = {}
        for c in concepts:
            for end, v in _instant_records(gaap, c).items():
                merged.setdefault(end, v)
        series[key] = merged
    years = []
    for e in ends:
        y = {"fy_end": e}
        for key in list(SEC_DURATION) + list(SEC_INSTANT):
            y[key] = series[key].get(e)
        if y.get("debt") is not None or y.get("debt_current") is not None:
            y["debt"] = (y.get("debt") or 0) + (y.get("debt_current") or 0)
        y.pop("debt_current", None)
        years.append(y)
    return split_adjust(fix_share_units(years))


# --- Yahoo-Jahresabschlüsse (Nicht-US) ---
Y_ROWS = {
    "revenue": ("is", ["Total Revenue", "Operating Revenue"]),
    "op_income": ("is", ["Operating Income", "Total Operating Income As Reported"]),
    "net_income": ("is", ["Net Income", "Net Income Common Stockholders"]),
    "eps": ("is", ["Diluted EPS"]),
    "shares": ("is", ["Diluted Average Shares"]),
    "pretax": ("is", ["Pretax Income"]),
    "tax": ("is", ["Tax Provision"]),
    "ocf": ("cf", ["Operating Cash Flow"]),
    "capex": ("cf", ["Capital Expenditure"]),
    "da": ("cf", ["Depreciation And Amortization", "Depreciation Amortization Depletion"]),
    "sbc": ("cf", ["Stock Based Compensation"]),
    "equity": ("bs", ["Stockholders Equity", "Common Stock Equity"]),
    "debt": ("bs", ["Total Debt"]),
    "cash": ("bs", ["Cash And Cash Equivalents", "Cash Cash Equivalents And Short Term Investments"]),
}


def extract_yahoo(stmts: dict[str, pd.DataFrame]) -> list[dict]:
    cols = set()
    for df in stmts.values():
        if df is not None and not df.empty:
            cols |= set(df.columns)
    years = []
    for c in sorted(cols)[-MAX_YEARS:]:
        y = {"fy_end": c.date().isoformat()}
        for key, (which, rows) in Y_ROWS.items():
            df = stmts.get(which)
            v = None
            if df is not None and c in df.columns:
                for r in rows:
                    if r in df.index and pd.notna(df.at[r, c]):
                        v = float(df.at[r, c])
                        break
            y[key] = v
        if y["capex"] is not None:
            y["capex"] = abs(y["capex"])  # Yahoo: negativ (Mittelabfluss), SEC: positiv
        if y["revenue"] is not None or y["net_income"] is not None:
            years.append(y)
    return split_adjust(fix_share_units(years))


def refresh_yahoo(universe: list[dict], cache: dict, max_checks: int = 200) -> dict:
    """Historie für Nicht-US-Werte (Yahoo), max. 1x pro Woche je Aktie."""
    today = dt.date.today()

    def age(sym):
        c = cache.get(sym)
        if not c or c.get("v") != HIST_VERSION:
            return 10_000
        return (today - dt.date.fromisoformat(c["checked"])).days

    todo = sorted((u for u in universe if "." in u["symbol"] and age(u["symbol"]) >= 7),
                  key=lambda u: -age(u["symbol"]))[:max_checks]
    for u in todo:
        stmts = fetch.fetch_statements(u["symbol"])
        if stmts:
            cache[u["symbol"]] = {"v": HIST_VERSION, "checked": today.isoformat(), "source": "Yahoo-Jahresabschlüsse",
                                  "years": extract_yahoo(stmts)}
        time.sleep(0.3)
    return cache


# --- Kennzahlen aus der Historie ---
def _cagr(a, b, k):
    if a is None or b is None or a <= 0 or b <= 0 or k <= 0:
        return None
    return (b / a) ** (1 / k) - 1


def _price_at(close: pd.Series | None, date: str):
    if close is None or close.empty:
        return None
    s = close.loc[:pd.Timestamp(date)]
    if s.empty or (pd.Timestamp(date) - s.index[-1]).days > 10:
        return None
    return float(s.iloc[-1])


def derive(years: list[dict], close: pd.Series | None = None, same_currency: bool = True) -> dict:
    """Abgeleitete Kennzahlen [BERECHNET] + kompakte Jahrestabelle für die Oberfläche."""
    ys = fix_share_units([dict(y) for y in years if y.get("revenue") or y.get("net_income")])
    out: dict = {"hist_years": len(ys)}
    if len(ys) < 3:
        out["hist_table"] = []
        return out
    last5 = ys[-5:]
    k = len(last5) - 1

    def g(y, key):
        v = y.get(key)
        return None if v is None or v != v else v

    out["rev_cagr"] = _cagr(g(last5[0], "revenue"), g(last5[-1], "revenue"), k)
    out["eps_cagr"] = _cagr(g(last5[0], "eps"), g(last5[-1], "eps"), k)
    out["share_cagr"] = _cagr(g(last5[0], "shares"), g(last5[-1], "shares"), k)

    table = []
    margins, fcf_m, roics, fcfs, nis, sbc_r = [], [], [], [], [], []
    ocfs5, nis5, roes, own_m = [], [], [], []
    for y in ys:
        rev, op, ni = g(y, "revenue"), g(y, "op_income"), g(y, "net_income")
        fcf = g(y, "ocf") - g(y, "capex") if g(y, "ocf") is not None and g(y, "capex") is not None else None
        tax_rate = None
        if g(y, "tax") is not None and g(y, "pretax") and g(y, "pretax") > 0:
            tax_rate = min(max(g(y, "tax") / g(y, "pretax"), 0.0), 0.4)
        ic = None
        if g(y, "equity") is not None and g(y, "debt") is not None and g(y, "cash") is not None:
            ic = g(y, "equity") + g(y, "debt") - g(y, "cash")
        roic = op * (1 - tax_rate) / ic if (op is not None and tax_rate is not None and ic and ic > 0) else None
        if roic is not None and not -1 < roic < 2:
            roic = None
        om = op / rev if (op is not None and rev and rev > 0) else None
        # Ertragskraft vor Wachstumsinvestitionen ("Owner Earnings"): Investitionen über den Abschreibungen
        # gelten als Wachstum, nicht als Erhalt -> operativer Cashflow minus min(Investitionen, Abschreibungen)
        own = None
        if g(y, "ocf") is not None and g(y, "capex") is not None:
            maint = min(g(y, "capex"), g(y, "da")) if g(y, "da") is not None else g(y, "capex")
            own = g(y, "ocf") - maint
        eq = g(y, "equity")
        roe = ni / eq if (ni is not None and eq and eq > 0) else None
        if roe is not None and not -1 < roe < 1.5:
            roe = None
        row = {"fy_end": y["fy_end"], "revenue": rev, "op_margin": om, "eps": g(y, "eps"), "fcf": fcf,
               "owner_fcf": own, "roic": roic, "roe": roe, "shares": g(y, "shares"), "net_income": ni}
        table.append(row)
        if y in last5:
            if om is not None:
                margins.append(om)
            if fcf is not None and rev and rev > 0:
                fcf_m.append(fcf / rev)
            if roic is not None:
                roics.append(roic)
            if fcf is not None and ni is not None:
                fcfs.append(fcf)
                nis.append(ni)
            if g(y, "sbc") is not None and rev and rev > 0:
                sbc_r.append(g(y, "sbc") / rev)
            if g(y, "ocf") is not None and ni is not None:
                ocfs5.append(g(y, "ocf"))
                nis5.append(ni)
            if roe is not None:
                roes.append(roe)
            if own is not None and rev and rev > 0:
                own_m.append(own / rev)

    out["op_margin_avg5"] = st.mean(margins) if len(margins) >= 3 else None
    # Stabilität = Schwankung UM DEN TREND (Residuen einer linearen Regression), nicht die reine
    # Standardabweichung: eine stetig steigende Marge ist kein Risiko, ein Auf und Ab schon.
    out["op_margin_trend"] = out["op_margin_std"] = None
    if len(margins) >= 3:
        # Krisenjahre (z.B. Kreuzfahrt 2021: -394 %) begrenzen, damit sie Trend und Stabilität nicht dominieren
        mw = [min(max(m, -0.5), 0.6) for m in margins]
        xs = list(range(len(mw)))
        xm, ym = st.mean(xs), st.mean(mw)
        slope = sum((x - xm) * (y - ym) for x, y in zip(xs, mw)) / sum((x - xm) ** 2 for x in xs)
        resid = [y - (ym + slope * (x - xm)) for x, y in zip(xs, mw)]
        out["op_margin_trend"] = slope
        out["op_margin_std"] = (sum(e * e for e in resid) / len(resid)) ** 0.5
    out["fcf_margin_avg5"] = st.mean(fcf_m) if len(fcf_m) >= 3 else None
    out["fcf_pos_share"] = sum(1 for x in fcf_m if x > 0) / len(fcf_m) if len(fcf_m) >= 3 else None
    out["roic_med5"] = st.median(roics) if len(roics) >= 3 else None
    out["roic_last"] = table[-1]["roic"]
    out["cash_conversion"] = (sum(fcfs) / sum(nis) if len(fcfs) >= 3 and sum(nis) > 0 else None)
    if out["cash_conversion"] is not None and not -3 < out["cash_conversion"] < 5:
        out["cash_conversion"] = None
    out["sbc_rev"] = st.mean(sbc_r) if len(sbc_r) >= 2 else None
    # Gewinnqualität: operativer Cashflow / Nettogewinn über 5 J. (unabhängig von Investitionsphasen)
    out["ocf_conversion"] = sum(ocfs5) / sum(nis5) if len(ocfs5) >= 3 and sum(nis5) > 0 else None
    if out["ocf_conversion"] is not None and not 0 < out["ocf_conversion"] < 6:
        out["ocf_conversion"] = None
    out["roe_med5"] = st.median(roes) if len(roes) >= 3 else None
    out["roe_std5"] = st.pstdev(roes) if len(roes) >= 3 else None
    out["owner_margin_med5"] = st.median(own_m) if len(own_m) >= 3 else None
    out["owner_margin_last"] = own_m[-1] if own_m else None
    # Werte je Aktie im letzten Geschäftsjahr (Berichtswährung der Historie) für die Bewertung
    last = table[-1]
    sh_last = g(ys[-1], "shares")
    out["rev_ps_last"] = last["revenue"] / sh_last if last["revenue"] and sh_last else None
    out["owner_ps_last"] = last["owner_fcf"] / sh_last if last["owner_fcf"] is not None and sh_last else None
    out["sbc_ps_last"] = g(ys[-1], "sbc") / sh_last if g(ys[-1], "sbc") is not None and sh_last else None
    # Nachgewiesene Zyklik: stärkster Umsatzrückgang gegenüber Vorjahr in der verfügbaren Historie (bis 10 J.)
    revs = [g(y, "revenue") for y in ys]
    chg = [b / a - 1 for a, b in zip(revs, revs[1:]) if a and b and a > 0]
    out["max_rev_drop"] = min(chg) if chg else None
    # Normalisierter Gewinn je Aktie (für Zykliker): aktueller Umsatz × Median-Nettomarge 5 J. / Aktienzahl.
    # Normalisiert wird die Marge, nicht das Gewinnniveau – sonst würde echtes Wachstum bestraft.
    nm = [g(y, "net_income") / g(y, "revenue") for y in last5
          if g(y, "net_income") is not None and g(y, "revenue") and g(y, "revenue") > 0]
    rev_l, sh_l = g(last5[-1], "revenue"), g(last5[-1], "shares")
    # Median statt Mittelwert: einzelne Abschreibungsjahre sollen die "normale" Marge nicht dominieren
    out["net_margin_avg5"] = st.median(nm) if len(nm) >= 3 else None
    out["eps_norm5"] = (rev_l * out["net_margin_avg5"] / sh_l
                        if out["net_margin_avg5"] and out["net_margin_avg5"] > 0 and rev_l and sh_l else None)
    out["loss_years5"] = sum(1 for y in last5 if (g(y, "net_income") or 0) < 0)

    # Historisches KGV: Kurs am Geschäftsjahresende / verwässertes EPS dieses Jahres
    pes = []
    if same_currency and close is not None:
        for y in last5:
            eps, p = g(y, "eps"), _price_at(close, y["fy_end"])
            if eps and eps > 0 and p:
                pe = p / eps
                if 0 < pe < 300:
                    pes.append(pe)
    out["pe_hist_med5"] = st.median(pes) if len(pes) >= 3 else None
    out["hist_table"] = table[-MAX_YEARS:]
    return out
