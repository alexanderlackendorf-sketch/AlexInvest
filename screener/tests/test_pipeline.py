"""End-to-End-Test der Pipeline mit synthetischen Daten (kein Netzwerk).

Die synthetischen Werte dienen nur dem Test der Logik und werden nie veröffentlicht.
Aufruf (aus dem Repo-Root): python -m unittest discover -s screener/tests -t .
"""
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import numpy as np
import pandas as pd

import datetime as dt

from screener.pipeline import (digest, guard, history, metrics, quality, run, scoring, sec, technicals, targets,
                               tracking, valuation)

SECTORS = ["Technology", "Healthcare", "Financial Services", "Industrials", "Energy"]


def fake_prices(seed, n=520, start=100.0, drift=0.0004):
    rng = np.random.default_rng(seed)
    close = start * np.exp(np.cumsum(rng.normal(drift, 0.015, n)))
    idx = pd.bdate_range(end="2026-10-21", periods=n)
    hi = close * (1 + rng.uniform(0, 0.01, n))
    lo = close * (1 - rng.uniform(0, 0.01, n))
    return pd.DataFrame({"Open": close, "High": hi, "Low": lo, "Close": close, "Volume": 1e6}, index=idx)


def fake_info(i, price):
    rng = np.random.default_rng(1000 + i)
    eps = float(rng.uniform(-1, 8))
    fin = SECTORS[i % 5] == "Financial Services"
    shares = 1e9
    return {
        "longName": f"Test {i}", "sector": SECTORS[i % 5], "currency": "USD", "financialCurrency": "USD",
        "currentPrice": price, "marketCap": price * shares, "sharesOutstanding": shares,
        "trailingEps": eps, "forwardEps": eps * float(rng.uniform(0.9, 1.3)) if eps > 0 else None,
        "trailingPE": price / eps if eps > 0 else None, "bookValue": float(rng.uniform(5, 60)),
        "totalRevenue": 2e10, "ebitda": None if fin else float(rng.uniform(1e9, 6e9)),
        "freeCashflow": float(rng.uniform(-1e9, 4e9)), "totalDebt": 5e9, "totalCash": 2e9,
        "revenueGrowth": float(rng.uniform(-0.1, 0.3)), "earningsGrowth": float(rng.uniform(-0.3, 0.5)),
        "returnOnEquity": float(rng.uniform(-0.1, 0.4)), "returnOnAssets": float(rng.uniform(0, 0.1)),
        "grossMargins": float(rng.uniform(0.2, 0.8)), "operatingMargins": float(rng.uniform(-0.05, 0.4)),
        "profitMargins": 0.1, "dividendRate": 1.0, "numberOfAnalystOpinions": 12,
        "targetMeanPrice": price * float(rng.uniform(0.9, 1.4)), "recommendationMean": float(rng.uniform(1.5, 3.5)),
    }


class PipelineTest(unittest.TestCase):
    def test_end_to_end(self):
        n = 60
        uni = [{"symbol": f"T{i}", "name": f"T{i}", "indices": ["S&P 500"], "region": "USA"} for i in range(n)]
        uni.append({"symbol": "BAD", "name": "kaputt", "indices": ["DAX"], "region": "Deutschland"})
        prices = {f"T{i}": fake_prices(i, drift=0.001 * ((i % 7) - 3)) for i in range(n)}
        infos = {f"T{i}": fake_info(i, float(prices[f"T{i}"]["Close"].iloc[-1])) for i in range(n)}

        with tempfile.TemporaryDirectory() as tmp, \
                mock.patch.object(run.universe, "load_universe", return_value=(uni, [])), \
                mock.patch.object(run.fetch, "fetch_prices", return_value=prices), \
                mock.patch.object(run.fetch, "fetch_info", side_effect=lambda s: infos.get(s)), \
                mock.patch.object(run.fetch, "fetch_fx_to_eur", return_value={"EUR": 1.0, "USD": 0.9}):
            run.main(["--state", tmp, "--skip-sec", "--workers", "1"])
            data = json.loads((Path(tmp) / "public" / "screener.json").read_text())
            # Wächter: fehlende Werte (NaN) dürfen nicht als vorhanden zählen
            cov = data["meta"]["metric_coverage"]
            self.assertLess(cov["pe_ttm"], 1.0)        # Verlustbringer haben kein KGV
            self.assertEqual(cov["roic_med5"], 0.0)    # ohne Historie kein ROIC
            self.assertEqual(data["meta"]["failed"], ["BAD"])
            rows = data["rows"]
            self.assertEqual(len(rows), n)
            scores = [r["score"] for r in rows if r["score"] is not None]
            self.assertGreater(len(scores), n * 0.8)
            self.assertTrue(all(1 <= s <= 10 for s in scores))
            self.assertTrue((Path(tmp) / "public" / "px" / "T0.json").exists())
            # Verlustbringer haben kein KGV und keine Modell-Kursziele
            for r in rows:
                if r["loss_making"]:
                    self.assertIsNone(r["pe_ttm"])
                    self.assertIsNone(r["targets"])
            # Zweiter Lauf: Historie wächst nicht doppelt am selben Tag
            run.main(["--state", tmp, "--skip-sec", "--workers", "1"])
            hist = json.loads((Path(tmp) / "history.json").read_text())
            self.assertEqual(len(hist["T0"]), 1)


class MetricsTest(unittest.TestCase):
    def test_inconsistent_pe_is_dropped(self):
        info = {"currency": "USD", "financialCurrency": "USD", "currentPrice": 100, "trailingEps": 5, "trailingPE": 40}
        m, flags = metrics.derive(info, 100, {"EUR": 1, "USD": 0.9})
        self.assertIsNone(m["pe_ttm"])
        self.assertIn("kgv_inkonsistent", flags)

    def test_pence_and_currency_conversion(self):
        info = {"currency": "GBp", "financialCurrency": "USD", "currentPrice": 2500, "trailingEps": 2.5,
                "sharesOutstanding": 1e9}
        m, flags = metrics.derive(info, 2500, {"EUR": 1, "USD": 0.9, "GBP": 1.15, "GBp": 0.0115})
        self.assertAlmostEqual(m["price"], 25.0)
        # 25 GBP = 25*1.15/0.9 USD = 31.94 USD -> KGV 12.78
        self.assertAlmostEqual(m["pe_ttm"], 25 * 1.15 / 0.9 / 2.5, places=4)
        self.assertIn("waehrung_umgerechnet", flags)

    def test_yahoo_unconverted_mixed_currency(self):
        # Shell-Fall: Yahoo teilt GBP-Kurs durch USD-EPS ohne Umrechnung -> trotzdem bestätigt, eigener Wert gilt
        info = {"currency": "GBp", "financialCurrency": "USD", "currentPrice": 3966, "trailingEps": 3.38,
                "trailingPE": 11.7337, "sharesOutstanding": 5.688e9}
        fx = {"EUR": 1, "USD": 0.8928, "GBP": 1.1937, "GBp": 0.011937}
        m, flags = metrics.derive(info, 3966, fx)
        self.assertAlmostEqual(m["pe_ttm"], 39.66 * 1.1937 / 0.8928 / 3.38, places=3)
        self.assertNotIn("kgv_inkonsistent", flags)

    def test_missing_stays_missing(self):
        m, _ = metrics.derive({"currency": "EUR", "currentPrice": 10}, 10, {"EUR": 1})
        for k in ("pe_ttm", "pe_fwd", "ev_ebitda", "roe", "analyst_upside", "div_yield"):
            self.assertIsNone(m[k], k)


class RulesTest(unittest.TestCase):
    """Modell 3: Rating, Deckel, Urteil über erwartete Rendite und Kaufkurs."""

    def _row(self, q, er, hurdle=0.10, price=100.0, buy=None, flags=(), prev=None, zone=False, unc="mittel"):
        if buy is None:
            buy = price * (1.1 if er is not None and er >= hurdle else 0.9)
        r = {"q_score": q, "price_score": 6.0, "price": price, "currency": "USD", "coverage": 1.0,
             "flags": list(flags), "trend": "Aufwärtstrend", "dist_sma200": 0.05, "in_buy_zone": zone,
             "buy_zones": [], "earnings_in_days": 3, "q_components": {"Wachstum": 6.0},
             "valuation": {"er": er, "hurdle": hurdle, "buy_price": buy if er is not None else None,
                           "fair_value": 120.0 if er is not None else None, "uncertainty": unc}}
        return scoring.assess(r, prev)

    def test_verdict_matrix(self):
        self.assertEqual(self._row(8.0, 0.12)["verdict_code"], "kandidat")
        self.assertEqual(self._row(8.0, 0.09)["verdict_code"], "beobachten")          # nahe an der Hürde
        self.assertEqual(self._row(8.0, 0.06)["verdict_code"], "beobachten_teuer")
        self.assertIn("Kaufkurs", self._row(8.0, 0.06)["verdict"])
        self.assertEqual(self._row(8.0, 0.12, flags=["bilanz_warnsignal"])["verdict_code"], "beobachten")
        self.assertEqual(self._row(8.0, 0.12, unc="sehr hoch")["verdict_code"], "beobachten")
        self.assertEqual(self._row(6.0, 0.14, hurdle=0.12)["verdict_code"], "beobachten")
        self.assertEqual(self._row(6.0, 0.09, hurdle=0.12)["verdict_code"], "neutral")
        self.assertEqual(self._row(6.0, 0.05, hurdle=0.12)["verdict_code"], "meiden_teuer")
        self.assertEqual(self._row(3.0, 0.20, hurdle=0.14)["verdict_code"], "meiden")   # Value-Falle möglich
        self.assertEqual(self._row(3.0, 0.05, hurdle=0.14)["verdict_code"], "meiden_schwach")
        self.assertEqual(self._row(None, 0.12)["verdict_code"], "nab")
        self.assertEqual(self._row(8.0, None)["verdict_code"], "beobachten")

    def test_buy_price_hysteresis(self):
        # Kaufkurs 99: Kurs 100 knapp darüber -> nur als bisheriger Kandidat noch Kandidat
        self.assertEqual(self._row(8.0, 0.095, buy=99.0)["verdict_code"], "beobachten")
        self.assertEqual(self._row(8.0, 0.095, buy=99.0, prev="kandidat")["verdict_code"], "kandidat")

    def test_earnings_soon(self):
        a = self._row(8.0, 0.12, flags=["zahlen_in_kuerze"], zone=True)
        self.assertEqual(a["ampeln"]["Einstieg"], "gelb")
        self.assertIn("Zahlen in 3 Tagen", a["verdict"])
        self.assertEqual(a["ampeln"]["Daten"], "gruen")

    def test_total_score(self):
        sc, caps = scoring.total_score(8.0, 7.0, 6.0, 6.0, {"er": 0.10}, False)
        self.assertAlmostEqual(sc, 7.1)                                        # 40/35/15/10
        self.assertEqual(caps, [])
        sc, caps = scoring.total_score(3.0, 10.0, 10.0, 10.0, {"er": 0.20}, False)
        self.assertEqual(sc, 4.0)
        self.assertIn("Qualität < 4", caps)
        self.assertEqual(scoring.total_score(9.0, 10.0, 10.0, 10.0, {"er": 0.20}, True)[0], 4.0)   # Warnsignal
        self.assertEqual(scoring.total_score(9.0, 9.0, 9.0, 9.0, {"er": 0.06}, False)[0], 6.0)     # Rendite < 8 %
        self.assertEqual(scoring.total_score(9.0, None, 9.0, 9.0, {}, False)[0], 6.0)              # keine Bewertung
        self.assertIsNone(scoring.total_score(None, 8.0, 5.0, 5.0, {}, False)[0])

    def test_red_flags(self):
        self.assertEqual(scoring.red_flags({"altman_z2": 0.5, "net_debt_ebitda": 1.0}), [])   # Altman allein reicht nicht
        self.assertTrue(scoring.red_flags({"altman_z2": 0.5, "net_debt_ebitda": 4.0}))
        self.assertEqual(scoring.red_flags({"beneish_m": -1.0, "accruals": 0.0}), [])         # Beneish allein reicht nicht
        self.assertTrue(scoring.red_flags({"beneish_m": -1.0, "accruals": 0.07}))
        self.assertTrue(scoring.red_flags({"accruals": 0.12}))
        self.assertEqual(scoring.red_flags({"accruals": 0.12, "is_financial": True}), [])

    def test_lenses(self):
        v = {"er": 0.12, "hurdle": 0.10, "fair_value": 150.0, "mos_required": 0.25, "uncertainty": "mittel"}
        l = scoring.lenses(v, 100.0, 8.0, 0.8, 0.7)
        self.assertEqual([x["ampel"] for x in l.values()], ["gruen", "gruen", "gruen"])
        l = scoring.lenses(dict(v, fair_value=110.0, er=0.08), 100.0, 3.0, 0.5, 0.2)
        self.assertEqual([x["ampel"] for x in l.values()], ["rot", "gelb", "gelb"])

    def test_quality_absolute_scale(self):
        great = {"roic_med5": 0.30, "op_margin_std": 0.01, "ocf_conversion": 1.2, "net_debt_ebitda": -0.5,
                 "rev_cagr": 0.15, "hist_years": 10, "loss_years5": 0}
        self.assertGreaterEqual(quality.quality(great, 0.9)["score"], 9.0)
        weak = {"roic_med5": 0.03, "op_margin_std": 0.12, "ocf_conversion": 0.6, "net_debt_ebitda": 4.5,
                "rev_cagr": -0.03, "hist_years": 10, "loss_years5": 2}
        self.assertLess(quality.quality(weak, 0.2)["score"], 2.0)
        uber = {"roic_med5": 0.106, "op_margin_std": 0.037, "op_margin_trend": 0.077, "ocf_conversion": 1.6,
                "net_debt_ebitda": 1.25, "rev_cagr": 0.31, "share_cagr": 0.028, "hist_years": 9, "loss_years5": 2}
        self.assertTrue(5.0 <= quality.quality(uber, 0.57)["score"] <= 7.5)

    def test_bank_like_classification(self):
        self.assertTrue(metrics.is_bank_like("Financial Services", "Banks - Diversified", 0))
        self.assertTrue(metrics.is_bank_like("Financial Services", "Insurance - Life", None))
        self.assertFalse(metrics.is_bank_like("Financial Services", "Credit Services", 3e10))      # Visa
        self.assertFalse(metrics.is_bank_like("Financial Services", "Financial Data & Stock Exchanges", 5e9))
        self.assertFalse(metrics.is_bank_like("Technology", "Software", None))

    def test_cyclical_peak_flag(self):
        self.assertTrue(scoring.is_cyclical("Technology", "Semiconductors"))
        self.assertFalse(scoring.is_cyclical("Technology", "Software - Infrastructure"))

    def test_split_detection(self):
        self.assertEqual(sec.split_factor(7.36, 14.72), 0.5)
        self.assertEqual(sec.split_factor(3.58, 0.895), 4)
        self.assertIsNone(sec.split_factor(4.91, 4.21905))


class ValuationModelTest(unittest.TestCase):
    """Modell 3: erwartete Rendite (IRR) mit Reinvestition, Reverse-DCF, fairer Wert mit Unsicherheit."""

    def test_path_and_roll_forward(self):
        flows, _ = valuation._path(5.0, 0.10, 0.25, cap=10)
        self.assertAlmostEqual(flows[0], 5.0 * 1.10 * (1 - 0.10 / 0.25))   # Wachstum kostet Reinvestition
        v0 = valuation.value(5.0, 0.10, 0.25, 0.09)
        v1 = valuation.value(5.0, 0.10, 0.25, 0.09, at_year=1)
        self.assertAlmostEqual(v1, (v0 - flows[0] / 1.09) * 1.09)
        self.assertGreater(valuation.value(5.0, 0.10, 0.25, 0.09, cap=15), v0)   # längerer Vorteil = mehr Wert

    def test_irr_and_reverse_dcf_invert_value(self):
        price = valuation.value(4.0, 0.08, 0.30, 0.11)
        self.assertAlmostEqual(valuation.irr(price, 4.0, 0.08, 0.30), 0.11, places=4)
        price = valuation.value(4.0, 0.07, 0.30, valuation.COE)
        self.assertAlmostEqual(valuation.implied_growth(price, 4.0, 0.30), 0.07, places=4)
        self.assertIsNone(valuation.implied_growth(price, 4.0, 0.08))   # ROIC < Kapitalkosten

    def test_normalization(self):
        base = {"price": 100.0, "rev_ps_trading": 50.0, "owner_margin_med5": 0.15, "sbc_ps_trading": 0.5}
        cf, _ = valuation.base_cash_flow(dict(base, owner_margin_last=0.05), False)
        self.assertAlmostEqual(cf, 0.15 * 50 - 0.5)                      # Einbruchjahr -> Median
        cf, _ = valuation.base_cash_flow(dict(base, owner_margin_last=0.25, op_margin_trend=0.03), False)
        self.assertAlmostEqual(cf, 0.25 * 50 - 0.5)                      # Marge steigt strukturell
        cf, _ = valuation.base_cash_flow(dict(base, owner_margin_last=0.25), False)
        self.assertAlmostEqual(cf, 0.20 * 50 - 0.5)
        cf, _ = valuation.base_cash_flow(dict(base, owner_margin_last=0.25), True)
        self.assertAlmostEqual(cf, 0.15 * 50 - 0.5)                      # Zykliker: immer Median

    def test_growth(self):
        r = {"rev_cagr": 0.20, "rev_cagr_long": 0.08, "rev_growth": 0.05}
        self.assertAlmostEqual(valuation.growth_rate(r), (2 * 0.08 + 0.05) / 3)   # Corona-Basiseffekt raus
        self.assertFalse(valuation.growth_conflict(r))
        self.assertTrue(valuation.growth_conflict({"rev_cagr": 0.25, "rev_growth": 0.02}))
        self.assertEqual(valuation.growth_rate({"rev_cagr": 0.40}), valuation.G_MAX)

    def test_roic_for(self):
        self.assertAlmostEqual(valuation.roic_for({"roic_med5": 0.10, "roic_ex_gw_med5": 0.30})[0], 0.20)
        self.assertAlmostEqual(valuation.roic_for({"roic_med5": 0.10, "roic_ex_gw_med5": 0.30, "roic_last": 0.30})[0], 0.25)
        self.assertEqual(valuation.roic_for({"ic_negative_profitable": True})[0], valuation.ROIC_MAX)
        self.assertEqual(valuation.roic_for({})[0], valuation.ROIC_DEFAULT)

    def _company(self, **kw):
        r = {"price": 100.0, "rev_ps_trading": 40.0, "owner_margin_med5": 0.15, "owner_margin_last": 0.15,
             "sbc_ps_trading": 0.0, "rev_cagr": 0.08, "rev_growth": 0.08, "roic_med5": 0.25, "hist_years": 10,
             "op_margin_std": 0.02, "owner_yield_hist_med": 0.05, "owner_yield_hist_n": 5, "flags": []}
        r.update(kw)
        return r

    def test_fair_value_company(self):
        r = self._company()
        v = valuation.fair_value(r, 8.0)
        self.assertEqual([m["name"] for m in v["methods"]], ["DCF zu Eigenkapitalkosten", "Eigene Bewertungshistorie"])
        self.assertAlmostEqual(v["methods"][1]["value"], 6.0 / 0.05)
        self.assertEqual(v["uncertainty"], "gering")
        self.assertAlmostEqual(v["coe"], 0.08)
        self.assertAlmostEqual(v["hurdle"], 0.10)                                   # 8 % + 2 Pp.
        self.assertAlmostEqual(v["buy_price"], valuation.value(6.0, 0.08, 0.25, 0.10, cap=15), places=1)
        self.assertAlmostEqual(valuation.irr(v["buy_price"], 6.0, 0.08, 0.25, 15), 0.10, places=3)
        self.assertAlmostEqual(v["hist_ratio"], 0.06 / 0.05)
        self.assertAlmostEqual(valuation.fair_value(r, 5.0)["hurdle"], 0.12)        # schwache Qualität +4 Pp.
        shaky = valuation.fair_value(self._company(op_margin_std=0.12, loss_years5=2, hist_years=4), 8.0)
        self.assertIn(shaky["uncertainty"], ("hoch", "sehr hoch"))
        self.assertGreater(shaky["coe"], v["coe"])

    def test_fair_value_bank(self):
        r = {"price": 50.0, "is_financial": True, "roe_med5": 0.15, "pb": 1.0, "rev_cagr": 0.05, "rev_growth": 0.05,
             "hist_years": 10, "flags": []}
        v = valuation.fair_value(r, 7.0)
        self.assertGreaterEqual(v["coe"], 0.10)
        self.assertAlmostEqual(v["cf0"], 0.15 * 50.0)
        self.assertEqual(len(v["methods"]), 1)

    def test_not_valued(self):
        self.assertIsNone(valuation.fair_value({"price": 10, "flags": ["zyklik_spitzengewinn"]}, 6)["er"])
        self.assertIsNone(valuation.fair_value({"price": 10, "flags": [], "fcf_yield": -0.1, "rev_cagr": 0.05}, 6)["er"])
        self.assertIsNone(valuation.fair_value(self._company(price=10.0), 8.0)["er"])   # +1000 % -> Datenfehler


class ForensicsTest(unittest.TestCase):
    Y0 = {"revenue": 100.0, "net_income": 8.0, "ocf": 9.0, "assets": 100.0, "debt": 30.0, "assets_cur": 40.0,
          "liab_cur": 30.0, "gross_profit": 40.0, "shares": 10.0, "receivables": 10.0, "ppe": 30.0, "da": 5.0,
          "sga": 20.0, "retained": 30.0, "op_income": 12.0, "equity": 40.0}

    def test_piotroski_all_improving(self):
        y1 = dict(self.Y0, revenue=120.0, net_income=12.0, ocf=14.0, debt=25.0, assets_cur=50.0, gross_profit=50.0,
                  shares=9.8, receivables=11.0)
        f, n, _ = history.piotroski(y1, self.Y0)
        self.assertEqual((f, n), (9, 9))
        f, _, _ = history.piotroski(dict(self.Y0, net_income=-5.0, ocf=-1.0, shares=11.0, debt=40.0), self.Y0)
        self.assertLessEqual(f, 2)

    def test_altman_and_beneish(self):
        z = history.altman_z2(self.Y0)
        self.assertAlmostEqual(z, 6.56 * 0.10 + 3.26 * 0.30 + 6.72 * 0.12 + 1.05 * (40 / 60))
        m = history.beneish_m(self.Y0, self.Y0)        # unverändert: alle Indizes 1
        self.assertAlmostEqual(m, -4.84 + 0.92 + 0.528 + 0.404 + 0.892 + 0.115 - 0.172 + 4.679 * (-0.01) - 0.327)
        self.assertIsNone(history.beneish_m({"revenue": 1.0}, self.Y0))

    def test_forensics_in_derive(self):
        ys = [dict(self.Y0, fy_end=f"20{20 + i}-12-31", capex=4.0) for i in range(4)]
        d = history.derive(ys)
        self.assertAlmostEqual(d["gross_prof"], 0.40)
        self.assertAlmostEqual(d["accruals"], (8.0 - 9.0) / 100.0)
        self.assertIsNotNone(d["f_score"])


class PackageFourTest(unittest.TestCase):
    """Branchenvergleich, Hysterese, Zahlen-Warnung, normalisierte Zykliker, Digest."""

    def test_peer_override(self):
        # Yahoo führt Uber als Software; Vergleich muss mit Plattformen erfolgen
        self.assertEqual(scoring.peer_group("Technology", "Software - Application", "UBER"), "Plattformen & Marktplätze")
        self.assertEqual(scoring.peer_group("Technology", "Software - Application", "ADBE"), "Software & IT-Dienste")

    def test_peer_groups(self):
        self.assertEqual(scoring.peer_group("Technology", "Semiconductors"), "Halbleiter")
        self.assertEqual(scoring.peer_group("Technology", "Software - Infrastructure"), "Software & IT-Dienste")
        self.assertEqual(scoring.peer_group("Technology", "Consumer Electronics"), "Hardware & Elektronik")
        self.assertEqual(scoring.peer_group("Utilities", None), "Utilities")

    def test_pct_uses_finest_group_with_enough_values(self):
        vals = pd.Series([float(i) for i in range(20)])
        group = pd.Series(["A"] * 10 + ["B"] * 10)
        sector = pd.Series(["S"] * 20)
        p = scoring._pct(vals, [(group, 8), (sector, 10)], True)
        self.assertAlmostEqual(p.iloc[9], 1.0)    # bestes in Gruppe A
        self.assertAlmostEqual(p.iloc[10], 0.1)   # schlechtestes in Gruppe B
        p2 = scoring._pct(vals, [(group, 11), (sector, 10)], True)   # Gruppen zu klein -> Sektor
        self.assertAlmostEqual(p2.iloc[9], 0.5)

    def test_cyclical_normalized_target(self):
        m = {"price": 100.0, "eps_norm_trading": 5.0, "pe_hist_med5": 15.0, "rev_cagr": 0.20,
             "flags": ["zyklik_normalisiert"], "eps_fwd": 20.0, "pe_fwd": 5.0}
        t = targets.model_targets(m, 12.0)
        self.assertAlmostEqual(t["fair_value"], 75.0)   # 5 x 15, nicht 20 x KGV
        self.assertEqual(t["growth"], 0.08)              # Wachstum gedeckelt
        self.assertLess(t["margin_of_safety"], 0)

    def test_digest(self):
        rows = [{"symbol": "A", "name": "Alpha", "score": 9.0, "verdict_code": "kandidat", "verdict": "Kandidat",
                 "ampeln": {}, "in_buy_zone": True, "earnings_in_days": 2, "earnings_date": "2026-10-24",
                 "roic_med5": 0.2, "pe_fwd": 15.0},
                {"symbol": "B", "name": "Beta", "score": 6.0, "verdict_code": "beobachten", "verdict": "Beobachten",
                 "ampeln": {}, "in_buy_zone": False, "earnings_in_days": None}]
        data = {"rows": rows, "meta": {"generated_at": "2026-10-23T22:30:00", "rated": 2, "price_date_max": "2026-10-23",
                                       "tracking": {"since": "2026-10-22", "horizons": {}}}}
        md, st = digest.build(data, {}, ["B"], "https://x/", "owner", dt.date(2026, 10, 23))
        self.assertIn("@owner", md)
        self.assertIn("erster Digest", md)
        self.assertIn("[**A**](https://x/#A)", md)
        self.assertEqual(st["verdicts"], {"A": "kandidat", "B": "beobachten"})
        rows[0]["verdict_code"], rows[0]["verdict"] = "beobachten", "Beobachten"
        md2, _ = digest.build(data, st, ["B"], "https://x/", None, dt.date(2026, 10, 30))
        self.assertIn("Nicht mehr im Kaufbereich (1)", md2)


class SafetyTest(unittest.TestCase):
    """Verlustschutz des Datenstands und Datenqualitäts-Wächter."""

    def _write(self, d, files):
        d.mkdir(parents=True, exist_ok=True)
        for k, v in files.items():
            (d / k).write_text(json.dumps(v))

    def test_guard(self):
        with tempfile.TemporaryDirectory() as tmp:
            old, new = Path(tmp) / "old", Path(tmp) / "new"
            base = {"tracking.json": {"snapshots": {"2026-10-22": {}, "2026-10-29": {}}},
                    "history.json": {f"S{i}": [["d", 5.0]] * 10 for i in range(100)},
                    "verdicts.json": {f"S{i}": "beobachten" for i in range(100)}}
            self._write(old, base)
            self._write(new, base)
            self.assertEqual(guard.check(old, new), [])
            self._write(new, {"tracking.json": {"snapshots": {"2026-10-29": {}}}})
            self.assertTrue(any("Kohorte" in p for p in guard.check(old, new)))
            self._write(new, {"tracking.json": base["tracking.json"], "history.json": {"S1": [["d", 5.0]]}})
            self.assertTrue(any("history.json" in p for p in guard.check(old, new)))
            # leerer Altstand (erster Lauf) -> keine Beanstandung
            self.assertEqual(guard.check(Path(tmp) / "leer", new), [])

    def test_quality_alarms(self):
        v = {"coverage_version": run.COVERAGE_VERSION}
        prev = {**v, "metric_coverage": {"pe_ttm": 0.9, "rev_eps_90d": 0.95, "roic_med5": 0.2}, "rows": 620, "rated": 615}
        ok = {**v, "metric_coverage": {"pe_ttm": 0.88, "rev_eps_90d": 0.94, "roic_med5": 0.05}, "rows": 618, "rated": 612}
        self.assertEqual(run.quality_alarms(prev, ok), [])   # roic unter 30 % Basis -> nicht überwacht
        bad = {**v, "metric_coverage": {"pe_ttm": 0.88, "rev_eps_90d": 0.10}, "rows": 500, "rated": 490}
        alarms = run.quality_alarms(prev, bad)
        self.assertEqual(len(alarms), 3)
        self.assertIn("rev_eps_90d", alarms[0])
        self.assertIn("⚠️", run.alarm_markdown(alarms, {"generated_at": "2026-10-23T22:30:00"}))
        # alte Messung (andere Version) -> kein Kennzahlen-Vergleich
        self.assertEqual(run.quality_alarms({**prev, "coverage_version": 1}, {**bad, "rows": 620, "rated": 615}), [])


class HistoryTest(unittest.TestCase):
    def _years(self):
        ys = []
        for i, yr in enumerate(range(2019, 2026)):
            ys.append({"fy_end": f"{yr}-12-31", "revenue": 100.0 * 1.1 ** i, "op_income": 20.0 * 1.1 ** i,
                       "net_income": 15.0 * 1.1 ** i, "eps": 1.5 * 1.1 ** i, "shares": 10.0, "ocf": 18.0 * 1.1 ** i,
                       "capex": 3.0 * 1.1 ** i, "sbc": 1.0, "pretax": 20.0 * 1.1 ** i, "tax": 4.0 * 1.1 ** i,
                       "equity": 80.0, "debt": 30.0, "cash": 10.0})
        return ys

    def test_derive(self):
        h = history.derive(self._years())
        self.assertAlmostEqual(h["rev_cagr"], 0.10, places=6)
        self.assertAlmostEqual(h["eps_cagr"], 0.10, places=6)
        self.assertAlmostEqual(h["share_cagr"], 0.0, places=6)
        self.assertAlmostEqual(h["op_margin_avg5"], 0.20, places=6)
        self.assertAlmostEqual(h["op_margin_std"], 0.0, places=6)
        self.assertAlmostEqual(h["cash_conversion"], 1.0, places=6)   # (18-3)/15
        # ROIC letztes Jahr: 20*1.1^6 * (1-0.2) / (80+30-10)
        self.assertAlmostEqual(h["roic_last"], 20 * 1.1 ** 6 * 0.8 / 100, places=6)
        self.assertEqual(len(h["hist_table"]), 7)

    def test_margin_normalized_eps(self):
        h = history.derive(self._years())
        # konstante Nettomarge 15 % -> normalisiertes EPS = letzter Umsatz x 15 % / Aktien = aktuelles EPS
        self.assertAlmostEqual(h["eps_norm5"], 100 * 1.1 ** 6 * 0.15 / 10, places=6)
        ys = self._years()
        ys[-1]["net_income"] *= 3   # Spitzenjahr: Marge 45 %
        self.assertLess(history.derive(ys)["eps_norm5"], ys[-1]["net_income"] / ys[-1]["shares"])

    def test_max_rev_drop(self):
        ys = self._years()
        self.assertGreater(history.derive(ys)["max_rev_drop"], 0)
        ys[3]["revenue"] = ys[2]["revenue"] * 0.6
        self.assertAlmostEqual(history.derive(ys)["max_rev_drop"], -0.4, places=6)

    def test_rising_margin_is_not_instability(self):
        ys = self._years()
        for i, y in enumerate(ys):   # Marge steigt stetig von -20 % auf +13 % (Uber-Muster)
            y["op_income"] = y["revenue"] * (-0.20 + 0.055 * i)
        h = history.derive(ys)
        self.assertAlmostEqual(h["op_margin_std"], 0.0, places=9)   # kein Auf und Ab um den Trend
        self.assertAlmostEqual(h["op_margin_trend"], 0.055, places=9)
        ys[-2]["op_income"] = ys[-2]["revenue"] * -0.10              # echter Rückschlag
        self.assertGreater(history.derive(ys)["op_margin_std"], 0.02)
        ys[-5]["op_income"] = ys[-5]["revenue"] * -3.9               # Krisenjahr wird auf -50 % begrenzt
        self.assertLess(history.derive(ys)["op_margin_trend"], 0.25)

    def test_missing_tax_gives_no_roic(self):
        ys = self._years()
        for y in ys:
            y["tax"] = None
        self.assertIsNone(history.derive(ys)["roic_med5"])

    def test_split_adjust(self):
        ys = [{"fy_end": "2022-01-31", "eps": 10.0, "shares": 100.0}, {"fy_end": "2023-01-31", "eps": 12.0, "shares": 100.0},
              {"fy_end": "2024-01-31", "eps": 1.3, "shares": 1000.0}]
        history.split_adjust(ys)
        self.assertAlmostEqual(ys[0]["eps"], 1.0)
        self.assertAlmostEqual(ys[1]["shares"], 1000.0)

    def test_split_after_last_report(self):
        ys = [{"fy_end": f"{y}-12-31", "eps": 200.0, "shares": 33.0} for y in (2023, 2024, 2025)]
        self.assertEqual(history.adjust_for_recent_split(ys, 33.0 * 23, eps_ttm=9.0), 25)   # Booking 25:1 + Rückkäufe
        self.assertAlmostEqual(ys[0]["eps"], 8.0)
        self.assertIsNone(history.adjust_for_recent_split([{"shares": 100.0, "eps": 1.0}], 97.0, 1.0))  # Rückkauf
        # Aktienzahl verdoppelt (zweite Gattung), EPS aber unverändert -> kein Split
        self.assertIsNone(history.adjust_for_recent_split([{"shares": 153.0, "eps": 10.0}], 306.0, 9.5))
        # Alphabet: gehandelte Gattung = halbe Gesamtzahl, EPS-Verhältnis zufällig ~0,5 -> kein Split
        self.assertIsNone(history.adjust_for_recent_split([{"shares": 12.2e9, "eps": 10.8}], 5.8e9, 19.9))

    def test_hist_pe(self):
        idx = pd.bdate_range("2019-01-01", "2026-06-30")
        close = pd.Series(30.0, index=idx)
        h = history.derive(self._years(), close)
        self.assertIsNotNone(h["pe_hist_med5"])
        self.assertIsNone(history.derive(self._years(), close, same_currency=False)["pe_hist_med5"])


class ValuationTest(unittest.TestCase):
    def test_implied_growth_roundtrip(self):
        ev = targets._dcf_value(100.0, 0.07)
        self.assertAlmostEqual(targets.implied_growth(100.0, ev), 0.07, places=3)
        self.assertIsNone(targets.implied_growth(-5.0, 1000.0))
        self.assertIsNone(targets.implied_growth(float("nan"), 1000.0))


class TrackingTest(unittest.TestCase):
    def test_snapshot_and_evaluate(self):
        rows = [{"symbol": f"S{i}", "score": float(10 - i % 10), "verdict_code": "kandidat" if i < 5 else "meiden"}
                for i in range(40)]
        state = tracking.snapshot({}, dt.date(2026, 1, 5), rows)
        state = tracking.snapshot(state, dt.date(2026, 1, 7), rows)   # gleiche Woche -> keine zweite Kohorte
        self.assertEqual(len(state["snapshots"]), 1)
        idx = pd.bdate_range("2026-01-01", periods=300)
        closes = {}
        for i in range(40):
            drift = 0.002 if i < 5 else 0.0
            closes[f"S{i}"] = pd.Series([100 * (1 + drift) ** k for k in range(300)], index=idx)
        closes["^GSPC"] = pd.Series(100.0, index=idx)
        ev = tracking.evaluate(state, closes)
        h = ev["horizons"]["1M"]
        self.assertEqual(h["cohorts"], 1)
        self.assertGreater(h["kandidat"], h["universe"])
        self.assertEqual(h["hit_rate"], 1.0)
        self.assertAlmostEqual(h["S&P 500"], 0.0)


class TechnicalsTest(unittest.TestCase):
    def test_buy_zone_below_price(self):
        df = fake_prices(3, drift=0.001)
        t = technicals.compute(df)
        for z in t["buy_zones"]:
            self.assertLess(z["low"], t["last_close"] * 1.05)
        self.assertTrue(0 <= t["rsi14"] <= 100)


class TargetsTest(unittest.TestCase):
    def test_targets(self):
        t = targets.model_targets({"eps_fwd": 5, "pe_fwd": 20, "price": 100, "eps_growth_fwd": 0.10}, 20)
        self.assertAlmostEqual(t["y1"], 5 * 1.1 * 20, places=2)
        self.assertAlmostEqual(t["fair_value"], 100.0)
        self.assertLess(t["scenarios"]["bear"]["end_price"], t["scenarios"]["base"]["end_price"])
        self.assertLess(t["scenarios"]["base"]["end_price"], t["scenarios"]["bull"]["end_price"])
        self.assertIsNone(targets.model_targets({"eps_fwd": 5, "pe_fwd": float("nan"), "price": 20, "eps_growth_fwd": 0.1}, 15))
        self.assertIsNone(targets.model_targets({"eps_fwd": 5, "pe_fwd": 4, "price": 20, "eps_growth_fwd": 0.5,
                                                 "flags": ["zyklik_spitzengewinn"]}, 15))
        self.assertIsNone(targets.model_targets({"eps_fwd": -1, "pe_fwd": None, "price": 10}, 15))


if __name__ == "__main__":
    unittest.main()
