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
    """Modell 2: absolute Qualität, fairer Wert, Kaufkurs, Urteil."""

    def _row(self, q, fv, price=100.0, mos=0.10, flags=(), prev=None, zone=False):
        r = {"q_score": q, "price_score": 6.0, "price": price, "currency": "USD", "coverage": 1.0,
             "flags": list(flags), "trend": "Aufwärtstrend", "dist_sma200": 0.05, "in_buy_zone": zone,
             "buy_zones": [], "earnings_in_days": 3, "q_components": {"Wachstum": 6.0},
             "valuation": {"fair_value": fv, "buy_price": fv * (1 - mos) if fv else None}}
        return scoring.assess(r, prev)

    def test_verdict_matrix(self):
        self.assertEqual(self._row(8.0, 130)["verdict_code"], "kandidat")          # Kurs 100 <= Kaufkurs 117
        self.assertEqual(self._row(8.0, 105)["verdict_code"], "beobachten")        # unter fairem Wert
        self.assertEqual(self._row(8.0, 80)["verdict_code"], "beobachten_teuer")   # zu teuer
        self.assertIn("Kaufkurs", self._row(8.0, 80)["verdict"])
        self.assertEqual(self._row(6.0, 150, mos=0.2)["verdict_code"], "beobachten")
        self.assertEqual(self._row(6.0, 95)["verdict_code"], "neutral")
        self.assertEqual(self._row(6.0, 70)["verdict_code"], "meiden_teuer")
        self.assertEqual(self._row(3.0, 200, mos=0.3)["verdict_code"], "meiden")   # Value-Falle möglich
        self.assertEqual(self._row(3.0, 80)["verdict_code"], "meiden_schwach")
        self.assertEqual(self._row(None, 130)["verdict_code"], "nab")

    def test_buy_price_hysteresis(self):
        # Kaufkurs 99 (fv 110, 10 %): Kurs 100 knapp darüber -> nur als bisheriger Kandidat noch Kandidat
        self.assertEqual(self._row(8.0, 110)["verdict_code"], "beobachten")
        self.assertEqual(self._row(8.0, 110, prev="kandidat")["verdict_code"], "kandidat")

    def test_earnings_soon(self):
        a = self._row(8.0, 130, flags=["zahlen_in_kuerze"], zone=True)
        self.assertEqual(a["ampeln"]["Einstieg"], "gelb")
        self.assertIn("Zahlen in 3 Tagen", a["verdict"])
        self.assertEqual(a["ampeln"]["Daten"], "gruen")

    def test_total_score(self):
        self.assertAlmostEqual(scoring.total_score(8.0, 6.0, {}), 7.1)
        self.assertEqual(scoring.total_score(3.0, 10.0, {}), 4.5)        # schwache Qualität gedeckelt
        self.assertAlmostEqual(scoring.total_score(8.0, None, {}), 6.4)  # Bewertung unbekannt -> neutral
        self.assertIsNone(scoring.total_score(None, 8.0, {}))

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
    def test_dcf_and_roll_forward(self):
        v0 = valuation.dcf(5.0, 0.10, 0.09)
        flows = valuation.cash_flows(5.0, 0.10)
        self.assertAlmostEqual(flows[0], 5.5)
        self.assertAlmostEqual(flows[5], flows[4] * (1 + 0.10 + (0.03 - 0.10) / 5))   # Ausblenden ab Jahr 6
        v1 = valuation.dcf(5.0, 0.10, 0.09, at_year=1)
        self.assertAlmostEqual(v1, (v0 - 5.5 / 1.09) * 1.09)   # Wert in 1 Jahr nach Auszahlung

    def test_fair_value_company(self):
        r = {"price": 100.0, "fcf_yield": 0.05, "rev_cagr": 0.08, "rev_growth": 0.08, "pe_fwd": 18.0, "eps_fwd": 5.0,
             "pe_hist_med5": 20.0, "flags": []}
        v = valuation.fair_value(r, 8.0, 18.0)
        self.assertEqual(len(v["methods"]), 2)
        self.assertAlmostEqual(v["methods"][1]["value"], 100 / 18 * 20, places=1)
        self.assertAlmostEqual(v["buy_price"], v["fair_value"] * 0.9, places=1)          # Qualität 8 -> 10 %
        self.assertAlmostEqual(valuation.fair_value(r, 5.0, 18.0)["mos_required"], 0.30)  # schwache Qualität
        # Investitionsphase: FCF ttm ~0, Owner Earnings hoch -> Owner Earnings zählt
        r2 = dict(r, fcf_yield=0.005, owner_ps_trading=4.0)
        self.assertIn("Owner Earnings", valuation.fair_value(r2, 8.0, 18.0)["methods"][0]["detail"])

    def test_fair_value_bank(self):
        r = {"price": 50.0, "is_financial": True, "roe_med5": 0.15, "pb": 1.0, "pe_fwd": 9.0, "eps_fwd": 5.5,
             "flags": []}
        v = valuation.fair_value(r, 7.0, 10.0)
        jpb = (0.15 - 0.03) / (0.10 - 0.03)
        self.assertAlmostEqual(v["methods"][0]["value"], 50.0 * jpb, places=1)

    def test_not_valued(self):
        self.assertIsNone(valuation.fair_value({"price": 10, "flags": ["zyklik_spitzengewinn"]}, 6, 15)["fair_value"])
        self.assertIsNone(valuation.fair_value({"price": 10, "flags": [], "fcf_yield": -0.1}, 6, 15)["fair_value"])


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
