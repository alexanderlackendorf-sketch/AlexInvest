"""Kennzahlen aus Rohdaten ableiten und plausibilisieren.

Grundsatz: Kein Wert wird geschätzt oder aufgefüllt. Unplausible Werte werden auf None gesetzt
und als Flag dokumentiert. Verhältniszahlen werden selbst aus Kurs und Bilanzdaten berechnet
(gleiche Währung erzwungen) und gegen Yahoos eigene Kennzahl gegengeprüft.
"""
from __future__ import annotations

import datetime as dt
import math

FINANCIAL_SECTORS = {"Financial Services", "Financials"}
REIT_SECTORS = {"Real Estate"}
# Kennzahlen, die für die Branche wirtschaftlich ungeeignet sind -> [NICHT ANWENDBAR] statt "fehlt"
NA_FINANCIAL = ["ev_ebitda", "fcf_yield", "fcf_margin", "net_debt_ebitda", "gross_margin",
                "roic_med5", "cash_conversion", "implied_growth", "fcf_margin_avg5"]
NA_REIT = ["pe_ttm", "pe_fwd", "peg", "eps_growth_fwd", "earn_growth",
           "eps_cagr", "pe_vs_hist"]  # Immobilien: FFO/AFFO statt Gewinn


def _num(x):
    if x is None:
        return None
    try:
        f = float(x)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def _div(a, b):
    return a / b if a is not None and b not in (None, 0) else None


def _rel_dev(a, b):
    if a is None or b is None or b == 0:
        return None
    return abs(a - b) / abs(b)


def derive(info: dict, last_close: float | None, fx_to_eur: dict[str, float]) -> tuple[dict, list[str]]:
    """Liefert (Kennzahlen, Flags). Alle Geldwerte in Handelswährung, außer *_eur."""
    flags: list[str] = []
    m: dict = {}

    cur = info.get("currency")
    fin_cur = info.get("financialCurrency") or cur
    price = _num(info.get("currentPrice")) or _num(info.get("regularMarketPrice")) or last_close
    if cur == "GBp":  # Londoner Kurse in Pence -> Pfund
        price = price / 100 if price else None
        cur = "GBP"
    if price is None or price <= 0:
        return {}, ["kein_kurs"]

    # Kurs in Bilanzwährung umrechnen, falls nötig
    if fin_cur == cur:
        fx = 1.0
    elif cur in fx_to_eur and fin_cur in fx_to_eur:
        fx = fx_to_eur[cur] / fx_to_eur[fin_cur]
        flags.append("waehrung_umgerechnet")
    else:
        fx = None
        flags.append("waehrung_unbekannt")
    price_fin = price * fx if fx else None

    shares = _num(info.get("sharesOutstanding")) or _num(info.get("impliedSharesOutstanding"))
    mcap = price * shares if shares else None
    y_mcap = _num(info.get("marketCap"))
    if mcap and y_mcap:
        d = _rel_dev(mcap, y_mcap)
        # Mehrere Aktiengattungen (z.B. GOOGL/GOOG) erklären Abweichungen -> Yahoo-Gesamtwert bevorzugen
        if d is not None and d > 0.15:
            flags.append("mktcap_abweichung")
            mcap = y_mcap if 0.2 < y_mcap / mcap < 5 else None
    mcap = mcap or y_mcap
    mcap_fin = mcap * fx if (mcap and fx) else None

    eps_ttm = _num(info.get("trailingEps"))
    eps_fwd = _num(info.get("forwardEps"))

    mixed = fx is not None and fx != 1.0

    def checked_ratio(name, ours, yahoo_key, tol=0.15, raw=None):
        """Abgleich mit Yahoos Kennzahl. Bei Währungsmix rechnet Yahoo OHNE Umrechnung
        (z.B. Kurs in GBP / EPS in USD). Dann wird gegen die unumgerechnete Variante `raw`
        geprüft: Stimmt sie, sind die Rohdaten bestätigt und unser umgerechneter Wert gilt."""
        y = _num(info.get(yahoo_key)) if yahoo_key else None
        if ours is None:
            return None
        cmp = raw if mixed else ours
        if mixed and raw is None:
            return ours
        if y is not None and y > 0 and cmp and cmp > 0 and _rel_dev(cmp, y) > tol:
            # Unsere Berechnung und Yahoo widersprechen sich -> nicht verwenden
            flags.append(f"{name}_inkonsistent")
            return None
        return ours

    pe_ttm = _div(price_fin, eps_ttm) if eps_ttm and eps_ttm > 0 else None
    pe_fwd = _div(price_fin, eps_fwd) if eps_fwd and eps_fwd > 0 else None
    m["pe_ttm"] = checked_ratio("kgv", pe_ttm, "trailingPE", raw=_div(price, eps_ttm))
    m["pe_fwd"] = checked_ratio("kgv_fwd", pe_fwd, "forwardPE", tol=0.25, raw=_div(price, eps_fwd))
    if m["pe_ttm"] and m["pe_ttm"] > 1000:
        m["pe_ttm"] = None
    if m["pe_fwd"] and m["pe_fwd"] > 1000:
        m["pe_fwd"] = None
    m["eps_ttm"] = eps_ttm
    m["eps_fwd"] = eps_fwd
    m["loss_making"] = eps_ttm is not None and eps_ttm <= 0
    m["eps_growth_fwd"] = (eps_fwd / eps_ttm - 1) if (eps_fwd and eps_ttm and eps_ttm > 0) else None
    if m["eps_growth_fwd"] is not None and not -0.9 < m["eps_growth_fwd"] < 5:
        flags.append("eps_wachstum_unplausibel")
        m["eps_growth_fwd"] = None
    m["peg"] = (m["pe_fwd"] / (m["eps_growth_fwd"] * 100)
                if m["pe_fwd"] and m["eps_growth_fwd"] and m["eps_growth_fwd"] > 0.01 else None)

    bvps = _num(info.get("bookValue"))
    m["pb"] = checked_ratio("kbv", _div(price_fin, bvps) if bvps and bvps > 0 else None, "priceToBook", tol=0.25,
                            raw=_div(price, bvps))

    revenue = _num(info.get("totalRevenue"))
    ebitda = _num(info.get("ebitda"))
    fcf = _num(info.get("freeCashflow"))
    debt = _num(info.get("totalDebt"))
    cash = _num(info.get("totalCash"))
    is_fin = info.get("sector") in FINANCIAL_SECTORS
    m["is_financial"] = is_fin

    ev = mcap_fin + (debt or 0) - (cash or 0) if mcap_fin and debt is not None and cash is not None else None
    m["ev_ebitda"] = None
    if not is_fin and ev and ebitda and ebitda > 0:
        ev_raw = mcap + debt - cash if mcap else None
        m["ev_ebitda"] = checked_ratio("ev_ebitda", ev / ebitda, "enterpriseToEbitda", tol=0.25,
                                       raw=_div(ev_raw, ebitda))
        if m["ev_ebitda"] and m["ev_ebitda"] > 200:
            m["ev_ebitda"] = None
    m["ev_fin"] = ev if not is_fin else None
    m["fcf_fin"] = fcf
    m["fcf_yield"] = _div(fcf, mcap_fin) if not is_fin else None
    m["fcf_margin"] = _div(fcf, revenue) if (not is_fin and revenue and revenue > 0) else None
    m["net_debt_ebitda"] = ((debt - cash) / ebitda
                            if (not is_fin and debt is not None and cash is not None and ebitda and ebitda > 0) else None)

    for k_out, k_in, lo, hi in [
        ("roe", "returnOnEquity", -2, 3), ("roa", "returnOnAssets", -1, 1),
        ("gross_margin", "grossMargins", -1, 1), ("op_margin", "operatingMargins", -5, 1),
        ("net_margin", "profitMargins", -5, 1), ("rev_growth", "revenueGrowth", -1, 10),
        ("earn_growth", "earningsGrowth", -10, 50), ("payout", "payoutRatio", 0, 10), ("beta", "beta", -3, 5),
    ]:
        v = _num(info.get(k_in))
        if v is not None and not lo <= v <= hi:
            flags.append(f"{k_out}_unplausibel")
            v = None
        m[k_out] = v
    if is_fin or (m.get("gross_margin") == 0):
        m["gross_margin"] = None  # bei Banken/Versicherern nicht aussagekräftig

    div_rate = _num(info.get("dividendRate"))
    m["div_yield"] = _div(div_rate, price) if div_rate else 0.0 if div_rate == 0 else None
    if m["div_yield"] and m["div_yield"] > 0.25:
        flags.append("dividende_unplausibel")
        m["div_yield"] = None

    # Gewinnrevisionen: Veränderung der Konsens-EPS-Schätzung und Saldo der Anpassungen [BERECHNET aus SCHÄTZUNGEN]
    tr = info.get("eps_trend") or {}
    cur_e, e90, e30 = _num(tr.get("current")), _num(tr.get("d90")), _num(tr.get("d30"))
    m["rev_eps_90d"] = (cur_e / e90 - 1) if (cur_e is not None and e90 and e90 > 0 and cur_e > 0) else None
    m["rev_eps_30d"] = (cur_e / e30 - 1) if (cur_e is not None and e30 and e30 > 0 and cur_e > 0) else None
    for k in ("rev_eps_90d", "rev_eps_30d"):
        if m[k] is not None and not -0.8 < m[k] < 2:
            flags.append("revision_unplausibel")
            m[k] = None
    rv = info.get("eps_rev") or {}
    up, dn = _num(rv.get("up30")), _num(rv.get("down30"))
    n_an_rev = int(_num(info.get("numberOfAnalystOpinions")) or 0)
    m["rev_up30"], m["rev_down30"] = up, dn
    # Saldo Anhebungen minus Senkungen (30 Tage) je Analyst: +1 = alle heben an, -1 = alle senken
    m["rev_breadth"] = ((up - dn) / max(n_an_rev, up + dn)
                        if up is not None and dn is not None and n_an_rev >= 3 else None)
    m["eps_trend_period"] = tr.get("period")
    m["earnings_date"] = info.get("earnings_date")

    # Analysten (Kursziele in Handelswährung)
    n_an = int(_num(info.get("numberOfAnalystOpinions")) or 0)
    tmean = _num(info.get("targetMeanPrice"))
    if info.get("currency") == "GBp" and tmean:
        tmean /= 100
    m["analyst_count"] = n_an
    m["analyst_target"] = tmean if n_an >= 3 else None
    m["analyst_upside"] = (tmean / price - 1) if (tmean and n_an >= 3) else None
    if m["analyst_upside"] is not None and not -0.8 < m["analyst_upside"] < 3:
        flags.append("kursziel_unplausibel")
        m["analyst_upside"] = m["analyst_target"] = None
    rec = _num(info.get("recommendationMean"))
    m["analyst_rec"] = rec if (rec and n_an >= 3 and 1 <= rec <= 5) else None
    m["analyst_rec_key"] = info.get("recommendationKey") if n_an >= 3 else None

    # Nicht anwendbare Kennzahlen entfernen (Banken/Versicherer: EBITDA/FCF; REITs: KGV auf Basis Gewinn)
    na = []
    if is_fin:
        na += NA_FINANCIAL
    if info.get("sector") in REIT_SECTORS:
        na += NA_REIT
        m["loss_making"] = False  # Bilanzgewinn ist bei REITs durch Abschreibungen verzerrt
    for k in na:
        m[k] = None
    m["not_applicable"] = na
    m["is_reit"] = info.get("sector") in REIT_SECTORS

    ts = _num(info.get("regularMarketTime"))
    m["price_time"] = (dt.datetime.fromtimestamp(ts, dt.timezone.utc).isoformat(timespec="minutes")
                       if ts and ts > 1e9 else None)
    m["exchange"] = info.get("fullExchangeName") or info.get("exchange")
    m["price"] = price
    m["currency"] = cur
    m["financial_currency"] = fin_cur
    m["market_cap"] = mcap
    m["market_cap_eur"] = mcap * fx_to_eur[cur] if (mcap and cur in fx_to_eur) else None
    m["price_eur"] = price * fx_to_eur[cur] if cur in fx_to_eur else None
    return m, flags
