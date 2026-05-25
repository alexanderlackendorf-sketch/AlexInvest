'use client';

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import Link from 'next/link';

export default function LandingPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  // Automatic redirect is removed so the landing page is always visible to visitors.
  // Instead, the CTA buttons adapt dynamically to the user's login state.

  if (loading) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        backgroundColor: 'var(--bg-main)',
        flexDirection: 'column',
        gap: '1rem'
      }}>
        <div style={{
          width: '40px',
          height: '40px',
          border: '3px solid var(--border-color)',
          borderTopColor: 'var(--primary)',
          borderRadius: '50%',
          animation: 'spin 1s linear infinite'
        }} />
        <span style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Lade Anwendung...</span>
        <style jsx global>{`
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  return (
    <div style={{
      backgroundColor: '#04060d', // Locked to dark premium for landing page
      color: '#f8fafc',
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      position: 'relative',
      overflowX: 'hidden',
      fontFamily: 'var(--font-inter)'
    }}>
      {/* Background Glows */}
      <div style={{
        position: 'absolute',
        top: '-10%',
        left: '20%',
        width: '600px',
        height: '600px',
        background: 'radial-gradient(circle, rgba(6,182,212,0.08) 0%, transparent 70%)',
        borderRadius: '50%',
        filter: 'blur(60px)',
        zIndex: 0,
        pointerEvents: 'none'
      }} />
      <div style={{
        position: 'absolute',
        bottom: '20%',
        right: '-10%',
        width: '500px',
        height: '500px',
        background: 'radial-gradient(circle, rgba(99,102,241,0.05) 0%, transparent 70%)',
        borderRadius: '50%',
        filter: 'blur(60px)',
        zIndex: 0,
        pointerEvents: 'none'
      }} />

      {/* Navigation Header */}
      <header style={{
        borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
        backgroundColor: 'rgba(11, 17, 32, 0.5)',
        backdropFilter: 'blur(12px)',
        position: 'sticky',
        top: 0,
        zIndex: 100,
        transition: 'var(--transition-smooth)'
      }}>
        <div className="container" style={{
          height: '60px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1.25rem', fontWeight: 800 }}>
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--primary)"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ filter: 'drop-shadow(0 0 6px var(--primary-glow))' }}
            >
              <line x1="18" y1="20" x2="18" y2="10" />
              <line x1="12" y1="20" x2="12" y2="4" />
              <line x1="6" y1="20" x2="6" y2="14" />
              <path d="M2 18h20" />
            </svg>
            <span style={{ color: '#ffffff', letterSpacing: '-0.02em' }}>Alex Invest</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
            <a href="#features" style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#94a3b8', transition: 'color 0.2s' }} onMouseEnter={e => e.currentTarget.style.color = '#ffffff'} onMouseLeave={e => e.currentTarget.style.color = '#94a3b8'}>
              Funktionen
            </a>
            <a href="#disclaimer" style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#94a3b8', transition: 'color 0.2s' }} onMouseEnter={e => e.currentTarget.style.color = '#ffffff'} onMouseLeave={e => e.currentTarget.style.color = '#94a3b8'}>
              Risikohinweis
            </a>
            {user ? (
              <Link href="/dashboard" className="btn btn-primary" style={{ fontWeight: 700, fontSize: '0.75rem', padding: '0.45rem 1rem' }}>
                Zum Terminal
              </Link>
            ) : (
              <Link href="/login" className="btn btn-primary" style={{ fontWeight: 700, fontSize: '0.75rem', padding: '0.45rem 1rem' }}>
                Terminal Login
              </Link>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', zIndex: 1 }}>
        
        {/* Hero Section */}
        <section style={{ padding: '6rem 0 4rem 0', textAlign: 'center', position: 'relative' }}>
          <div className="container" style={{ maxWidth: '800px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.5rem' }}>
            <span style={{
              fontSize: '0.7rem',
              fontWeight: 800,
              color: 'var(--primary)',
              letterSpacing: '0.15em',
              textTransform: 'uppercase',
              backgroundColor: 'rgba(6, 182, 212, 0.08)',
              padding: '0.35rem 0.85rem',
              borderRadius: '20px',
              border: '1px solid rgba(6, 182, 212, 0.2)'
            }}>
              Beta-Terminal für professionelle Anleger
            </span>
            <h1 style={{
              fontSize: '3rem',
              fontWeight: 900,
              color: '#ffffff',
              lineHeight: '1.15',
              letterSpacing: '-0.02em',
              margin: '0.5rem 0'
            }}>
              Das quantitative Analyse-Terminal für anspruchsvolle Investoren.
            </h1>
            <p style={{
              fontSize: '1.05rem',
              color: '#94a3b8',
              lineHeight: '1.6',
              maxWidth: '680px',
              margin: '0 auto 1.5rem auto'
            }}>
              Erhalten Sie algorithmische Handelssignale, fortlaufende technische Trends und KI-gestützte geopolitische Risikoanalysen für DAX- und S&P 500-Wertpapiere.
            </p>
            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
              {user ? (
                <Link href="/dashboard" className="btn btn-primary" style={{ padding: '0.75rem 1.75rem', fontSize: '0.875rem', fontWeight: 700, borderRadius: '4px', boxShadow: '0 0 15px rgba(6, 182, 212, 0.25)' }}>
                  Zum Terminal
                </Link>
              ) : (
                <Link href="/login" className="btn btn-primary" style={{ padding: '0.75rem 1.75rem', fontSize: '0.875rem', fontWeight: 700, borderRadius: '4px', boxShadow: '0 0 15px rgba(6, 182, 212, 0.25)' }}>
                  Terminal betreten
                </Link>
              )}
              <a href="#features" className="btn btn-secondary" style={{ padding: '0.75rem 1.75rem', fontSize: '0.875rem', fontWeight: 700, borderRadius: '4px', border: '1px solid rgba(255,255,255,0.08)', color: '#ffffff' }} onMouseEnter={e => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.03)'} onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}>
                Mehr erfahren
              </a>
            </div>
          </div>
        </section>

        {/* Terminal Visual Mockup */}
        <section style={{ padding: '0 0 6rem 0' }}>
          <div className="container" style={{ maxWidth: '1000px' }}>
            <div style={{
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: '8px',
              boxShadow: '0 25px 60px rgba(0,0,0,0.8), 0 0 40px rgba(6,182,212,0.03)',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column'
            }}>
              {/* Terminal Mock Window Header */}
              <div style={{
                height: '36px',
                backgroundColor: 'rgba(15, 23, 42, 0.8)',
                borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
                display: 'flex',
                alignItems: 'center',
                padding: '0 1rem',
                justifyContent: 'space-between'
              }}>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <div style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: '#ef4444' }} />
                  <div style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: '#f59e0b' }} />
                  <div style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: '#10b981' }} />
                </div>
                <span style={{ fontSize: '0.675rem', color: '#64748b', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
                  ALEX_INVEST_TERMINAL v1.4.0
                </span>
                <div style={{ width: '42px' }} />
              </div>

              {/* Terminal Mock Content */}
              <div style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem', opacity: 0.85 }}>
                {/* Mock global market summary */}
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '0.75rem 1rem',
                  backgroundColor: 'rgba(6, 182, 212, 0.04)',
                  border: '1px solid rgba(6, 182, 212, 0.15)',
                  borderRadius: '4px',
                  flexWrap: 'wrap',
                  gap: '1rem'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span>🤖</span>
                    <span style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Globale Marktanalyse:</span>
                    <span className="badge badge-buy" style={{ fontSize: '0.625rem' }}>Optimistische Konsolidierung</span>
                  </div>
                  <div style={{ display: 'flex', gap: '1.5rem', fontSize: '0.75rem', fontFamily: 'var(--font-mono)' }}>
                    <span>Crash-Risiko: <strong style={{ color: 'var(--buy-green)' }}>32%</strong></span>
                    <span>VIX Level: <strong style={{ color: '#ffffff' }}>16.67</strong></span>
                  </div>
                </div>

                {/* Mock table */}
                <div className="table-container" style={{ border: '1px solid rgba(255,255,255,0.05)', backgroundColor: 'transparent' }}>
                  <table className="table" style={{ opacity: 0.9 }}>
                    <thead>
                      <tr>
                        <th style={{ paddingLeft: '1rem' }}>Ticker</th>
                        <th>Name</th>
                        <th style={{ textAlign: 'right' }}>Kurs</th>
                        <th style={{ textAlign: 'right' }}>KGV</th>
                        <th style={{ textAlign: 'right' }}>EMA (200)</th>
                        <th style={{ textAlign: 'center' }}>Pro Score</th>
                        <th style={{ textAlign: 'center' }}>Signal</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td style={{ fontWeight: 700, color: 'var(--primary)', paddingLeft: '1rem' }}>AAPL</td>
                        <td>Apple Inc.</td>
                        <td style={{ textAlign: 'right', fontWeight: 700 }}>308.82 $</td>
                        <td style={{ textAlign: 'right' }}>28.4</td>
                        <td style={{ textAlign: 'right' }}>255.39 $</td>
                        <td style={{ textAlign: 'center', fontWeight: 800, color: 'var(--hold-amber)' }}>64</td>
                        <td style={{ textAlign: 'center' }}><span className="badge badge-hold" style={{ minWidth: '60px' }}>Hold</span></td>
                      </tr>
                      <tr>
                        <td style={{ fontWeight: 700, color: 'var(--primary)', paddingLeft: '1rem' }}>NVDA</td>
                        <td>NVIDIA Corporation</td>
                        <td style={{ textAlign: 'right', fontWeight: 700 }}>127.40 $</td>
                        <td style={{ textAlign: 'right' }}>64.2</td>
                        <td style={{ textAlign: 'right' }}>98.15 $</td>
                        <td style={{ textAlign: 'center', fontWeight: 800, color: 'var(--buy-green)' }}>80</td>
                        <td style={{ textAlign: 'center' }}><span className="badge badge-buy" style={{ minWidth: '60px' }}>Buy</span></td>
                      </tr>
                      <tr>
                        <td style={{ fontWeight: 700, color: 'var(--primary)', paddingLeft: '1rem' }}>SAP.DE</td>
                        <td>SAP SE</td>
                        <td style={{ textAlign: 'right', fontWeight: 700 }}>172.90 $</td>
                        <td style={{ textAlign: 'right' }}>32.1</td>
                        <td style={{ textAlign: 'right' }}>144.50 $</td>
                        <td style={{ textAlign: 'center', fontWeight: 800, color: 'var(--buy-green)' }}>76</td>
                        <td style={{ textAlign: 'center' }}><span className="badge badge-buy" style={{ minWidth: '60px' }}>Buy</span></td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Feature Section */}
        <section id="features" style={{ padding: '6rem 0', backgroundColor: '#070a14', borderTop: '1px solid rgba(255, 255, 255, 0.03)', borderBottom: '1px solid rgba(255, 255, 255, 0.03)' }}>
          <div className="container">
            <div style={{ textAlign: 'center', marginBottom: '4rem' }}>
              <span style={{ fontSize: '0.725rem', fontWeight: 700, color: 'var(--primary)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Features</span>
              <h2 style={{ fontSize: '2rem', fontWeight: 800, color: '#ffffff', marginTop: '0.5rem' }}>Fortgeschrittene Analysewerkzeuge</h2>
              <p style={{ color: '#94a3b8', fontSize: '0.875rem', marginTop: '0.5rem' }}>Was Alex Invest von gewöhnlichen Portalen unterscheidet</p>
            </div>

            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
              gap: '2rem'
            }}>
              {/* Feature 1 */}
              <div style={{
                backgroundColor: 'rgba(11, 17, 32, 0.4)',
                border: '1px solid rgba(255,255,255,0.05)',
                borderRadius: '6px',
                padding: '2rem 1.5rem',
                transition: 'var(--transition-smooth)'
              }} onMouseEnter={e => e.currentTarget.style.borderColor = 'rgba(6,182,212,0.2)'} onMouseLeave={e => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.05)'}>
                <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>📊</div>
                <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#ffffff', marginBottom: '0.5rem' }}>Quantitativer Pro Score</h3>
                <p style={{ fontSize: '0.8125rem', color: '#94a3b8', lineHeight: '1.6' }}>
                  Unser proprietäres Bewertungssystem analysiert 5 Faktoren zu gleichen Teilen (RSI, SMA50, EMA200, KGV, Margen). Jede Aktie erhält ein klares Signal (BUY/HOLD/SELL) basierend auf 100 Punkten.
                </p>
              </div>

              {/* Feature 2 */}
              <div style={{
                backgroundColor: 'rgba(11, 17, 32, 0.4)',
                border: '1px solid rgba(255,255,255,0.05)',
                borderRadius: '6px',
                padding: '2rem 1.5rem',
                transition: 'var(--transition-smooth)'
              }} onMouseEnter={e => e.currentTarget.style.borderColor = 'rgba(6,182,212,0.2)'} onMouseLeave={e => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.05)'}>
                <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>🤖</div>
                <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#ffffff', marginBottom: '0.5rem' }}>KI-Geopolitik-Risikoberichte</h3>
                <p style={{ fontSize: '0.8125rem', color: '#94a3b8', lineHeight: '1.6' }}>
                  Google Gemini synthetisiert Unternehmensdaten und aktuelle Nachrichten in Echtzeit. Gefahren wie Handelszölle, geopolitische Spannungen und Notenbankpolitik fließen direkt in die Risikoanalyse ein.
                </p>
              </div>

              {/* Feature 3 */}
              <div style={{
                backgroundColor: 'rgba(11, 17, 32, 0.4)',
                border: '1px solid rgba(255,255,255,0.05)',
                borderRadius: '6px',
                padding: '2rem 1.5rem',
                transition: 'var(--transition-smooth)'
              }} onMouseEnter={e => e.currentTarget.style.borderColor = 'rgba(6,182,212,0.2)'} onMouseLeave={e => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.05)'}>
                <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>📈</div>
                <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#ffffff', marginBottom: '0.5rem' }}>High-Density Terminal</h3>
                <p style={{ fontSize: '0.8125rem', color: '#94a3b8', lineHeight: '1.6' }}>
                  Kompakte Datenanordnung, monospacierte Tabellenausrichtung für Zahlenwerte, dynamische SVG-Verlaufscharts und ein nativer Theme-Switcher (Hell/Dunkel) sorgen für eine effiziente Analyseumgebung.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Closing CTA */}
        <section style={{ padding: '6rem 0', textAlign: 'center' }}>
          <div className="container" style={{ maxWidth: '600px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.25rem' }}>
            <h2 style={{ fontSize: '2rem', fontWeight: 800, color: '#ffffff' }}>Bereit für professionelle Analysen?</h2>
            <p style={{ color: '#94a3b8', fontSize: '0.875rem', lineHeight: '1.5' }}>
              Melden Sie sich jetzt an, um das quantitative Terminal in vollem Umfang zu nutzen und eigene Watchlists zu führen.
            </p>
            {user ? (
              <Link href="/dashboard" className="btn btn-primary" style={{ padding: '0.65rem 1.5rem', fontSize: '0.8125rem', fontWeight: 700, borderRadius: '4px', marginTop: '0.5rem' }}>
                Zum Terminal
              </Link>
            ) : (
              <Link href="/login" className="btn btn-primary" style={{ padding: '0.65rem 1.5rem', fontSize: '0.8125rem', fontWeight: 700, borderRadius: '4px', marginTop: '0.5rem' }}>
                Terminal betreten
              </Link>
            )}
          </div>
        </section>

      </main>

      {/* Footer & Disclaimer Section */}
      <footer id="disclaimer" style={{
        backgroundColor: '#070a14',
        borderTop: '1px solid rgba(255,255,255,0.05)',
        padding: '3rem 1.5rem 1.5rem 1.5rem',
        fontSize: '0.725rem',
        color: '#94a3b8',
        zIndex: 1
      }}>
        <div className="container" style={{ maxWidth: '1000px', display: 'flex', flexDirection: 'column', gap: '2rem' }}>
          
          {/* Disclaimer box */}
          <div className="disclaimer-box" style={{ borderColor: 'rgba(255,255,255,0.05)', backgroundColor: 'rgba(255,255,255,0.01)' }}>
            <div className="disclaimer-title" style={{ color: '#ffffff' }}>
              ⚠️ Risikohinweis und gesetzlicher Disclaimer
            </div>
            <p className="disclaimer-text" style={{ color: '#64748b', lineHeight: '1.5', textAlign: 'justify' }}>
              Die bereitgestellten Analysen, Pro Scores, Handelssignale (BUY, HOLD, SELL) und KI-Berichte auf Alex Invest dienen ausschließlich Informationszwecken und stellen keine Finanz-, Anlage-, Rechts- oder Steuerberatung dar. Sie sind keine Aufforderung, Empfehlung oder Angebot zum Kauf oder Verkauf von Wertpapieren, Derivaten oder sonstigen Finanzprodukten. Die Nutzung der Daten erfolgt auf eigenes Risiko des Nutzers. Die Wertentwicklung in der Vergangenheit ist kein verlässlicher Indikator für zukünftige Ergebnisse. Der Handel mit Aktien und Derivaten birgt erhebliche Verlustrisiken, bis hin zum Totalverlust des eingesetzten Kapitals. Alex Invest übernimmt keine Haftung für direkte oder indirekte Schäden, die aus der Nutzung der angebotenen Inhalte oder der Systemberechnungen entstehen.
            </p>
          </div>

          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '1rem',
            borderTop: '1px solid rgba(255,255,255,0.03)',
            paddingTop: '1.5rem',
            color: '#475569'
          }}>
            <span>© {new Date().getFullYear()} Alex Invest. Alle Rechte vorbehalten.</span>
            <div style={{ display: 'flex', gap: '1rem' }}>
              <span>Closed Beta</span>
              <span>•</span>
              <span>Ausschließlich für autorisierte Investoren</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
