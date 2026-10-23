"""Gegenprüfung US-Fundamentaldaten gegen die offiziellen SEC-EDGAR-XBRL-Daten (10-K).

Jede Firma wird höchstens 1x pro Woche neu geprüft (rollierend),
um die SEC-Fair-Access-Regeln (max. 10 Requests/s) deutlich zu unterschreiten.
"""
from __future__ import annotations

import datetime as dt
import logging
import os
import time

import requests

from . import fetch, history

log = logging.getLogger(__name__)

# Die SEC verlangt "Name E-Mail" im User-Agent, sonst 403. Eigene Adresse über das Secret SEC_USER_AGENT setzen.
UA = {"User-Agent": os.environ.get("SEC_USER_AGENT") or "AlexInvest Screener alexinvest-screener@users.noreply.github.com",
      "Accept-Encoding": "gzip, deflate"}
REVENUE_CONCEPTS = [
    "RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet",
    "RevenueFromContractWithCustomerIncludingAssessedTax",
]
TOLERANCE = 0.05
CACHE_VERSION = 5  # 4: 10-Jahres-Historie, 5: zusätzlich Abschreibungen
SPLIT_FACTORS = (2, 3, 4, 5, 8, 10, 15, 20, 1 / 2, 1 / 3, 1 / 4, 1 / 5, 1 / 8, 1 / 10, 1 / 15, 1 / 20)


def split_factor(sec_eps, y_eps) -> float | None:
    """Erkennt, ob Yahoo das EPS rückwirkend split-bereinigt hat (Verhältnis = typischer Split-Faktor)."""
    if not sec_eps or not y_eps or (sec_eps > 0) != (y_eps > 0):
        return None
    ratio = sec_eps / y_eps
    return next((f for f in SPLIT_FACTORS if abs(ratio / f - 1) < 0.03), None)  # bei Logikänderung erhöhen -> alte Prüfergebnisse werden neu erzeugt


def _get(url: str, timeout: int = 60) -> requests.Response:
    r = requests.get(url, headers=UA, timeout=timeout)
    if r.status_code != 200:
        # Antworttext hilft bei der Diagnose (z.B. "Undeclared Automated Tool" vs. IP-Sperre)
        snippet = " ".join(r.text.split())[:160]
        raise requests.HTTPError(f"HTTP {r.status_code} {url.split('/')[2]}: {snippet}")
    return r


def ticker_cik_map() -> dict[str, int]:
    r = _get("https://www.sec.gov/files/company_tickers.json", timeout=30)
    return {v["ticker"].upper().replace(".", "-"): int(v["cik_str"]) for v in r.json().values()}


def latest_annual(facts: dict, concepts: list[str], unit: str, prefer_max: bool = False) -> dict | None:
    """Jüngster 10-K-Jahreswert über alle angegebenen Konzepte.
    prefer_max: bei gleichem Stichtag den größten Wert nehmen (Umsatz: Gesamtumsatz statt Teilposition)."""
    best = None
    gaap = facts.get("facts", {}).get("us-gaap", {})
    for c in concepts:
        for rec in gaap.get(c, {}).get("units", {}).get(unit, []):
            if not str(rec.get("form", "")).startswith("10-K") or "start" not in rec:
                continue
            days = (dt.date.fromisoformat(rec["end"]) - dt.date.fromisoformat(rec["start"])).days
            if not 340 <= days <= 380:
                continue
            tie = (lambda r: r["val"]) if prefer_max else (lambda r: r.get("filed", ""))
            if best is None or (rec["end"], tie(rec)) > (best["end"], tie(best)):
                best = {**rec, "concept": c}
    return best


def company_facts(cik: int) -> dict:
    return _get(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik:010d}.json").json()


def _yahoo_value(stmt, rows: list[str], end: str):
    if stmt is None or stmt.empty:
        return None
    target = dt.date.fromisoformat(end)
    for col in stmt.columns:
        if abs((col.date() - target).days) <= 20:
            for row in rows:
                if row in stmt.index:
                    v = stmt.at[row, col]
                    if v == v:  # nicht NaN
                        return float(v)
    return None


def _cmp(sec_val, y_val):
    if sec_val is None or y_val is None or sec_val == 0:
        return None
    return abs(y_val - sec_val) / abs(sec_val)


def verify_company(symbol: str, cik: int) -> dict:
    facts = company_facts(cik)
    rev = latest_annual(facts, REVENUE_CONCEPTS, "USD", prefer_max=True)
    ni = latest_annual(facts, ["NetIncomeLoss"], "USD")
    eps = latest_annual(facts, ["EarningsPerShareDiluted"], "USD/shares")
    anchor = ni or rev
    res = {"checked": dt.date.today().isoformat(), "cik": cik, "status": "keine_10k_daten", "v": CACHE_VERSION}
    try:
        res["history"] = history.extract_sec(facts)
    except Exception as e:  # noqa: BLE001
        log.warning("SEC-Historie %s: %s", symbol, e)
    if anchor is None:
        return res
    stmt = fetch.fetch_income_annual(symbol)
    end = anchor["end"]
    rows = {
        "revenue": (rev, ["Total Revenue", "Operating Revenue"]),
        "net_income": (ni, ["Net Income", "Net Income Common Stockholders"]),
        "eps_diluted": (eps, ["Diluted EPS"]),
    }
    devs = []
    for key, (rec, yrows) in rows.items():
        sec_val = rec["val"] if rec and rec["end"] == end else None
        y_val = _yahoo_value(stmt, yrows, end)
        d = _cmp(sec_val, y_val)
        res[key] = {"sec": sec_val, "yahoo": y_val, "dev": d}
        # Umsatz ist je nach Branche unterschiedlich definiert (z.B. vor/nach Verbrauchsteuern, Zinserträge
        # bei Banken) -> nur informativ. Nettogewinn und EPS sind eindeutig und entscheiden über den Status.
        if d is not None and key != "revenue":
            devs.append(d)
    res.update({
        "fy_end": end,
        "filed": anchor.get("filed"),
        "accn": anchor.get("accn"),
        "url": f"https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK={cik}&type=10-K",
    })
    ni_dev = res["net_income"]["dev"]
    sf = split_factor(res["eps_diluted"]["sec"], res["eps_diluted"]["yahoo"])
    if not devs:
        res["status"] = "kein_abgleich"
    elif max(devs) <= TOLERANCE:
        res["status"] = "bestaetigt"
    elif sf and ni_dev is not None and ni_dev <= TOLERANCE:
        # Gewinn identisch, EPS nur um Split-Faktor verschoben -> Daten konsistent
        res["status"] = "bestaetigt_split"
        res["split_factor"] = sf
    else:
        res["status"] = "abweichung"
    return res


def refresh(universe: list[dict], cache: dict, max_checks: int = 600) -> tuple[dict, list[str]]:
    """Aktualisiert den SEC-Cache rollierend. Liefert (cache, Warnungen)."""
    errors: list[str] = []
    # US-Notierungen haben bei Yahoo kein Börsensuffix (20-F-Filer liefern keine 10-K-Daten -> Status bleibt offen)
    us = [u for u in universe if "." not in u["symbol"]]
    if not us:
        return cache, errors
    try:
        cmap = ticker_cik_map()
    except Exception as e:  # noqa: BLE001
        log.warning("SEC Tickerliste nicht abrufbar: %s", e)
        errors.append(f"SEC-Tickerliste nicht abrufbar: {e}")
        cmap = {}
    today = dt.date.today()

    def age(sym):
        c = cache.get(sym)
        if not c or c.get("v") != CACHE_VERSION:
            return 10_000
        return (today - dt.date.fromisoformat(c["checked"])).days

    todo = sorted((u for u in us if age(u["symbol"]) >= 7), key=lambda u: -age(u["symbol"]))[:max_checks]
    for u in todo:
        cik = u.get("cik") or cmap.get(u["symbol"])
        if not cik:
            continue
        try:
            cache[u["symbol"]] = verify_company(u["symbol"], int(cik))
        except Exception as e:  # noqa: BLE001
            log.warning("SEC-Prüfung %s fehlgeschlagen: %s", u["symbol"], e)
            errors.append(f"{u['symbol']}: {e}")
        time.sleep(0.25)
    if errors:
        ua_set = "gesetzt" if os.environ.get("SEC_USER_AGENT") else "NICHT gesetzt"
        errors = [f"SEC-Abgleich: {len(errors)} Fehler (Secret SEC_USER_AGENT {ua_set}), z.B. {errors[0]}"
                  + (f" | {errors[1]}" if len(errors) > 1 else "")]
    return cache, errors
