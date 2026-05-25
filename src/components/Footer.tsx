'use client';

import React from 'react';

export default function Footer() {
  return (
    <footer className="footer">
      <div className="container footer-container">
        <div className="footer-grid">
          <div className="footer-col-left">
            <div className="footer-logo">Alex Invest</div>
            <p style={{ color: 'var(--text-muted)', lineHeight: '1.45', fontSize: '0.675rem' }}>
              Professionelles Aktienanalyse-Portal für den DAX und S&P 500. Echtzeit-Berechnungen, quantitative Scores und algorithmische Signale für anspruchsvolle Investoren.
            </p>
          </div>

          <div className="disclaimer-box">
            <div className="disclaimer-title">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ color: '#d97706' }}>
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              Wichtiger Risikohinweis &amp; Haftungsausschluss
            </div>
            <p className="disclaimer-text" style={{ fontSize: '0.65rem', color: 'var(--text-secondary)' }}>
              Die auf dieser Webseite bereitgestellten Inhalte, Analysen, Scores, Kennzahlen, Grafiken und algorithmischen Kaufs- oder Verkaufssignale dienen ausschließlich der allgemeinen Information und Weiterbildung. Sie stellen ausdrücklich keine Anlageberatung, Steuerberatung, Rechtsberatung, Finanzberatung oder Empfehlung zum Kauf oder Verkauf von Finanzinstrumenten (wie Aktien, ETFs, Derivaten oder sonstigen Wertpapieren) dar.
              <br /><br />
              Investitionen an den Finanzmärkten unterliegen unvorhersehbaren Schwankungen und bergen erhebliche Risiken, einschließlich des Risikos eines teilweisen oder vollständigen Verlusts des eingesetzten Kapitals (Totalverlust). Ergebnisse und Wertentwicklungen aus der Vergangenheit lassen keine verlässlichen Rückschlüsse auf zukünftige Kursverläufe oder Gewinne zu. Der Betreiber dieser Plattform übernimmt keinerlei Haftung für die Aktualität, Richtigkeit, Vollständigkeit oder Angemessenheit der bereitgestellten Daten oder für finanzielle Entscheidungen, Verluste oder Schäden, die aus der Nutzung der hier dargestellten Informationen resultieren.
            </p>
          </div>

          <div className="footer-col-right">
            <div style={{ fontWeight: '700', color: 'var(--text-primary)', marginBottom: '0.4rem', fontSize: '0.7rem' }}>Regulatorischer Hinweis</div>
            <p style={{ color: 'var(--text-muted)', lineHeight: '1.45', fontSize: '0.675rem', textAlign: 'right' }}>
              Dieses Tool ist kein Ersatz für eine individuelle und professionelle Anlageberatung. Bitte konsultieren Sie vor jeder Investitionsentscheidung einen zugelassenen Finanzberater.
            </p>
          </div>
        </div>

        <div className="footer-copyright">
          © {new Date().getFullYear()} Alex Invest. Alle Rechte vorbehalten. | Version 2.5.0 (Enterprise Pro Edition)
        </div>
      </div>
    </footer>
  );
}
