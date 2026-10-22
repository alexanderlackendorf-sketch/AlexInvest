# AlexInvest Equity Screener

Täglich aktualisierter Aktienscreener für S&P 500, DAX und rund 85 globale Qualitätswerte. Jede Aktie bekommt ein Rating von 1 bis 10, Buy-Zonen und Modell-Kursziele für 1, 2 und 3 Jahre. Der Betrieb kostet nichts: Die Daten erzeugt GitHub Actions, die Seite liegt auf GitHub Pages.

## Ablauf

```
GitHub Actions (Mo–Fr 22:17 UTC)
  └─ screener/pipeline  (Python)
       universe.py   S&P 500 + DAX live von Wikipedia, Weltliste aus config/universe.json
       fetch.py      Kurse (2 Jahre) + Fundamentaldaten von Yahoo Finance
       metrics.py    Kennzahlen selbst berechnen, gegen Yahoo prüfen, Unplausibles verwerfen
       technicals.py SMA, RSI, ATR, Unterstützungen -> Buy-Zonen
       scoring.py    branchenrelatives Rating 1–10 (5 Säulen)
       targets.py    Modell-Kursziele 1/2/3 Jahre
       sec.py        US-Abschlüsse gegen SEC EDGAR 10-K prüfen (rollierend)
  └─ Datenstand  -> Branch `screener-data` (ein einziger Commit, wird überschrieben)
  └─ Website     -> GitHub Pages (screener/web + Daten)
```

## Grundsätze für die Daten

- Kein Wert wird geschätzt oder aufgefüllt. Fehlt etwas, steht dort „—“, und das Gewicht der Kennzahl entfällt.
- Verhältniszahlen (KGV, KBV, EV/EBITDA) werden selbst berechnet, mit angeglichener Währung, und mit Yahoo abgeglichen. Widersprechen sich die Werte, wird die Kennzahl verworfen und markiert.
- Bei US-Werten werden Nettogewinn und EPS gegen den 10-K-Bericht bei der SEC geprüft. Toleranz: 5 %. Der Umsatz wird nur zur Information verglichen.
- Fällt ein Abruf aus, werden Fundamentaldaten bis 10 Tage weiterverwendet und sichtbar markiert.
- Werden weniger als 50 % der Aktien verarbeitet, gilt der Lauf als fehlgeschlagen. Die Seite zeigt dann weiter den letzten guten Stand.

## Lokal

```bash
pip install -r screener/requirements.txt
python -m unittest discover -s screener/tests -t .                 # Tests (ohne Netz)
python -m screener.pipeline.run --state state --limit 30 --sec-max 5  # Probelauf
mkdir -p site && cp -r screener/web/. site/ && cp -r state/public site/data
python -m http.server -d site 8000
```

## Universum anpassen

In `config/universe.json` unter `global` Einträge der Form `["SYMBOL", "Name", "Region"]` ergänzen. Verwende das Yahoo-Symbol der Heimatbörse, zum Beispiel `ASML.AS` statt des ADR `ASML`.

## Einrichtung (einmalig)

1. In den Repo-Einstellungen unter **Pages** die Quelle **GitHub Actions** wählen.
2. Unter **Actions** den Workflow **Screener** auswählen und mit **Run workflow** einmal manuell starten.
3. Optional: das Secret `SEC_USER_AGENT` anlegen, zum Beispiel `Vorname Nachname email@domain`. Die SEC bittet um einen Kontakt im User-Agent.
