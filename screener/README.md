# AlexInvest Equity Screener

Täglich aktualisierter Aktienscreener für S&P 500, DAX und rund 85 globale Qualitätswerte. Jede Aktie bekommt ein Rating von 1 bis 10, Buy-Zonen und Modell-Kursziele für 1, 2 und 3 Jahre. Der Betrieb kostet nichts: Die Daten erzeugt GitHub Actions, die Seite liegt auf GitHub Pages.

## Ablauf

```
GitHub Actions (Mo–Fr 22:17 UTC)
  └─ screener/pipeline  (Python)
       universe.py   S&P 500 + DAX live von Wikipedia, Weltliste aus config/universe.json
       fetch.py      Kurse (5 Jahre), Fundamentaldaten, Revisionen, Termine von Yahoo Finance
       metrics.py    Kennzahlen selbst berechnen, gegen Yahoo prüfen, Unplausibles verwerfen
       technicals.py SMA, RSI, ATR, Unterstützungen -> Buy-Zonen
       scoring.py    Rating 1–10, getrennte Ampeln und Urteil nach den Projekt-Regeln „Aktienanalyse“
       targets.py    faire Wertspanne, Sicherheitsmarge, Bear/Base/Bull, Kurspfad 1/2/3 Jahre
       sec.py        US-Abschlüsse gegen SEC EDGAR 10-K prüfen (rollierend)
       history.py    Mehrjahres-Historie (SEC bis 10 J., sonst Yahoo): ROIC, Margen, Cash Conversion, Verwässerung
       tracking.py   Erfolgskontrolle: wöchentliche Kohorten vs. Universum, S&P 500, DAX
       digest.py     Wochen-Digest (freitags) als Kommentar im Issue „📬 Screener-Digest“ -> E-Mail über GitHub
       guard.py      Verlustprüfung: Erfolgskontrolle/Score-Historie dürfen beim Überschreiben nicht verloren gehen
  └─ Datenstand  -> Branch `screener-data` (ein einziger Commit, wird überschrieben)
  └─ Backup      -> Branch `screener-backup` (wöchentlich, mit Historie: Erfolgskontrolle, Score-Verläufe)
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

## Absicherung

- **Verlustprüfung**: Vor dem Überschreiben des Datenstands wird geprüft, dass keine Kohorte der Erfolgskontrolle und keine Score-Historie verloren geht. Sonst bricht der Lauf ab, der alte Stand bleibt erhalten und GitHub meldet den Fehler per Mail.
- **Backup**: Freitags werden die unersetzlichen Dateien in den Branch `screener-backup` gesichert, mit voller Historie. Fehlen sie im Datenstand, werden sie beim nächsten Lauf automatisch von dort wiederhergestellt.
- **Datenqualitäts-Wächter**: Fällt die Abdeckung einer wichtigen Kennzahl gegenüber dem Vortag auf unter 75 %, etwa weil Yahoo ein Feld geändert hat, kommt ein Kommentar im Issue „⚠️ Screener-Alarm“ und damit eine Mail.
- **Tests**: Jeder Pull Request auf `screener/**` lässt die Unit-Tests laufen (Workflow „Screener-Tests“).

## Wochen-Digest und Watchlist

Jeden Freitag nach dem Datenlauf erscheint ein Kommentar im Issue **„📬 Screener-Digest“**. Er enthält neue und weggefallene Kandidaten, neue Buy-Zonen, die Watchlist und Quartalstermine. GitHub verschickt dazu eine E-Mail an alle, die das Issue abonniert haben. Manuell auslösen lässt er sich über *Actions → Screener → Run workflow → digest = true*.

Die Watchlist für Digest und alle Geräte steht in `config/watchlist.json` und lässt sich direkt aus dem Screener übernehmen: *Watchlist → „Für den Wochen-Digest übernehmen“*.

## Universum anpassen

In `config/universe.json` unter `global` Einträge der Form `["SYMBOL", "Name", "Region"]` ergänzen. Verwende das Yahoo-Symbol der Heimatbörse, zum Beispiel `ASML.AS` statt des ADR `ASML`.

## Einrichtung (einmalig)

1. In den Repo-Einstellungen unter **Pages** die Quelle **GitHub Actions** wählen.
2. Unter **Actions** den Workflow **Screener** auswählen und mit **Run workflow** einmal manuell starten.
3. Optional: das Secret `SEC_USER_AGENT` anlegen, zum Beispiel `Vorname Nachname email@domain`. Die SEC bittet um einen Kontakt im User-Agent.
