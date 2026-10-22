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

from screener.pipeline import history, metrics, run, scoring, sec, technicals, targets, tracking

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
    """Regeln aus dem Projekt "Aktienanalyse": rote Ampeln werden nicht kompensiert."""

    def _row(self, q, b, w=6.0, score=9.0, cov=1.0, flags=(), zone=False):
        return {"pillars": {"Qualität": q, "Bewertung": b, "Wachstum": w}, "score": score, "coverage": cov,
                "flags": list(flags), "trend": "Aufwärtstrend", "dist_sma200": 0.05, "in_buy_zone": zone,
                "buy_zones": []}

    def test_verdicts(self):
        self.assertEqual(scoring.assess(self._row(8, 7))["verdict_code"], "kandidat")
        self.assertEqual(scoring.assess(self._row(8, 7, w=2))["verdict_code"], "beobachten")
        self.assertEqual(scoring.assess(self._row(5, 5, score=4))["verdict_code"], "neutral")
        self.assertEqual(scoring.assess(self._row(8, 2))["verdict_code"], "beobachten_teuer")
        self.assertEqual(scoring.assess(self._row(5, 2))["verdict_code"], "meiden_teuer")
        self.assertEqual(scoring.assess(self._row(2, 9))["verdict_code"], "meiden_schwach")
        self.assertEqual(scoring.assess(self._row(8, 7, cov=0.4))["verdict_code"], "nab")
        self.assertEqual(scoring.assess(self._row(8, 7, flags=["sec_abweichung"]))["verdict_code"], "nab")
        # Zykliker im möglichen Spitzengewinn ist nie "Kandidat"
        self.assertEqual(scoring.assess(self._row(8, 7, flags=["zyklik_spitzengewinn"]))["verdict_code"], "beobachten")

    def test_score_caps(self):
        df = pd.DataFrame({
            "sector": ["Technology"] * 12, "industry": ["Software"] * 12,
            "is_financial": [False] * 12, "is_reit": [False] * 12, "loss_making": [False] * 12,
            "not_applicable": [[] for _ in range(12)],
            "pe_fwd": [10 + i for i in range(12)], "pe_ttm": [12 + i for i in range(12)],
            "ev_ebitda": [8 + i for i in range(12)], "fcf_yield": [0.08 - i * 0.005 for i in range(12)],
            "peg": [0.8 + i * 0.1 for i in range(12)], "pb": [2.0] * 12, "roa": [0.05] * 12,
            # Aktie 0: billigste, aber schlechteste Qualität
            "roe": [0.01] + [0.2 + i * 0.01 for i in range(11)], "op_margin": [0.0] + [0.2] * 11,
            "gross_margin": [0.1] + [0.5] * 11, "fcf_margin": [0.0] + [0.15] * 11,
            "net_debt_ebitda": [5.0] + [1.0] * 11, "rev_growth": [0.3] + [0.05] * 11,
            "earn_growth": [0.3] + [0.05] * 11, "eps_growth_fwd": [0.3] + [0.05] * 11,
            "mom_12_1": [0.1] * 12, "ret_3m": [0.0] * 12, "dist_sma200": [0.0] * 12,
            "analyst_upside": [0.1] * 12, "analyst_rec": [2.0] * 12,
        }, index=[f"S{i}" for i in range(12)])
        res = scoring.score(df)
        self.assertEqual(scoring.ampel(res.at["S0", "p_Qualität"]), "rot")
        self.assertLessEqual(res.at["S0", "score"], 4.0)
        self.assertEqual(res.at["S0", "score_cap"], "Qualität rot")

    def test_cyclical_peak_flag(self):
        self.assertTrue(scoring.is_cyclical("Technology", "Semiconductors"))
        self.assertFalse(scoring.is_cyclical("Technology", "Software - Infrastructure"))

    def test_split_detection(self):
        self.assertEqual(sec.split_factor(7.36, 14.72), 0.5)
        self.assertEqual(sec.split_factor(3.58, 0.895), 4)
        self.assertIsNone(sec.split_factor(4.91, 4.21905))


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
