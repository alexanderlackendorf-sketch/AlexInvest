'use client';

import React, { useState, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import Header from '@/components/Header';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

interface StockItem {
  symbol: string;
  name: string;
  index: string;
  price: number;
  change: number;
  changePercent: number;
  peRatio: number | null;
  rsi: number | null;
  score: number;
  signal: string;
  reason: string;
  sector: string | null;
  yearPerformance: number | null;
  revenueGrowthScore: number | null;
  earningsGrowthScore: number | null;
  ebitdaMarginScore: number | null;
  website: string | null;
}

function CompanyLogo({ name, symbol, website, large = false }: { name: string; symbol: string; website: string | null; large?: boolean }) {
  const [imgSrc, setImgSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (website) {
      try {
        const hostname = new URL(website).hostname;
        const domain = hostname.replace(/^www\./, '');
        setImgSrc(`https://logo.clearbit.com/${domain}`);
        setError(false);
      } catch (e) {
        setError(true);
      }
    } else {
      setError(true);
    }
  }, [website]);

  const firstLetter = name ? name.charAt(0) : symbol.charAt(0);

  const colors = [
    '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', 
    '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#06b6d4'
  ];
  const charCodeSum = firstLetter.charCodeAt(0) || 0;
  const bgColor = colors[charCodeSum % colors.length];

  if (error || !imgSrc) {
    return (
      <div 
        className={large ? 'company-logo-fallback-large' : 'company-logo-fallback'} 
        style={{ backgroundColor: bgColor, color: '#ffffff' }}
      >
        {firstLetter}
      </div>
    );
  }

  return (
    <img
      src={imgSrc}
      alt={`${name} Logo`}
      className={large ? 'company-logo-large' : 'company-logo'}
      onError={() => {
        if (website && !imgSrc.includes('google.com')) {
          try {
            const hostname = new URL(website).hostname;
            const domain = hostname.replace(/^www\./, '');
            setImgSrc(`https://www.google.com/s2/favicons?sz=64&domain=${domain}`);
          } catch (e) {
            setError(true);
          }
        } else {
          setError(true);
        }
      }}
    />
  );
}

export default function WatchlistPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [stocks, setStocks] = useState<StockItem[]>([]);
  const [stocksLoading, setStocksLoading] = useState(true);
  const [search, setSearch] = useState('');

  const fetchWatchlist = async () => {
    try {
      setStocksLoading(true);
      const res = await fetch('/api/stocks?watchlist=true');
      const data = await res.json();
      if (res.ok && data.stocks) {
        setStocks(data.stocks);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setStocksLoading(false);
    }
  };

  useEffect(() => {
    if (!loading && user) {
      fetchWatchlist();
    }
  }, [user, loading]);

  const handleRemoveFromWatchlist = async (e: React.MouseEvent, symbol: string) => {
    e.preventDefault();
    e.stopPropagation();

    try {
      const res = await fetch('/api/watchlist', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol })
      });

      if (res.ok) {
        // Remove locally immediately
        setStocks(stocks.filter(s => s.symbol !== symbol));
      }
    } catch (err) {
      console.error(err);
    }
  };

  if (loading || !user) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', backgroundColor: 'var(--bg-main)' }}>
        <div style={{ width: '30px', height: '30px', border: '3px solid var(--border-color)', borderTopColor: 'var(--primary)', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
      </div>
    );
  }

  // Filtered watchlist items
  const filteredStocks = stocks.filter(s =>
    s.symbol.toLowerCase().includes(search.toLowerCase()) || 
    s.name.toLowerCase().includes(search.toLowerCase())
  );

  // Performance calculations
  const totalItems = stocks.length;
  const greenSignals = stocks.filter(s => s.signal === 'BUY').length;
  const averageChange = totalItems 
    ? stocks.reduce((acc, s) => acc + s.changePercent, 0) / totalItems
    : 0;

  return (
    <>
      <Header />
      <main className="container" style={{ padding: '2rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '1.75rem' }}>
        {/* Intro */}
        <div>
          <h2 style={{ fontSize: '1.75rem', fontWeight: 800, color: '#ffffff', marginBottom: '0.5rem' }}>
            Meine Watchlist
          </h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            Verfolgen Sie Ihre favorisierten Werte und deren aktuelle Signale im Echtzeit-Überblick.
          </p>
        </div>

        {/* Stats widgets */}
        {totalItems > 0 && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: '1.5rem'
          }}>
            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Beobachtete Werte</span>
              <span style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--primary)' }}>{totalItems}</span>
            </div>
            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Ø Performance heute</span>
              <span style={{ fontSize: '2rem', fontWeight: 800, color: averageChange >= 0 ? 'var(--buy-green)' : 'var(--sell-red)' }}>
                {averageChange >= 0 ? '+' : ''}{averageChange.toFixed(2)}%
              </span>
            </div>
            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Kauf-Signale (BUY)</span>
              <span style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--buy-green)' }}>{greenSignals}</span>
            </div>
          </div>
        )}

        {/* Search */}
        <div className="card" style={{ padding: '1.25rem', display: 'flex', alignItems: 'center' }}>
          <div style={{ position: 'relative', width: '100%', maxWidth: '400px' }}>
            <input
              type="text"
              placeholder="Watchlist filtern..."
              className="form-input"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{
                paddingLeft: '2.25rem',
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.8125rem'
              }}
            />
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              style={{
                position: 'absolute',
                left: '0.75rem',
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--text-secondary)'
              }}
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </div>
        </div>

        {/* List */}
        {stocksLoading ? (
          <div className="card" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '5rem' }}>
            <div style={{ width: '30px', height: '30px', border: '3px solid var(--border-color)', borderTopColor: 'var(--primary)', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
          </div>
        ) : stocks.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: '4rem', color: 'var(--text-secondary)' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: '1rem', color: '#fbbf24' }}>★</div>
            <h3 style={{ color: '#ffffff', fontSize: '1.25rem', fontWeight: 700 }}>Ihre Watchlist ist leer</h3>
            <p style={{ marginTop: '0.5rem', marginBottom: '1.5rem', fontSize: '0.875rem' }}>
              Fügen Sie Werte über das Dashboard hinzu, um sie hier gesammelt zu beobachten.
            </p>
            <Link href="/dashboard" className="btn btn-primary" style={{ fontWeight: 700 }}>
              Zum Dashboard
            </Link>
          </div>
        ) : filteredStocks.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: '4rem', color: 'var(--text-secondary)' }}>
            Keine passenden Werte in Ihrer Watchlist gefunden.
          </div>
        ) : (
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: '45px', paddingLeft: '1.25rem', textAlign: 'center' }}>WL</th>
                  <th>Ticker</th>
                  <th>Name</th>
                  <th>Index</th>
                  <th>Branche</th>
                  <th style={{ textAlign: 'right' }}>Kurs</th>
                  <th style={{ textAlign: 'right' }}>KGV</th>
                  <th style={{ textAlign: 'right' }}>Tägl. %</th>
                  <th style={{ textAlign: 'right' }}>Perf. (1J)</th>
                  <th style={{ textAlign: 'center' }}>Umsatz</th>
                  <th style={{ textAlign: 'center' }}>Ergebnis</th>
                  <th style={{ textAlign: 'center' }}>EBITDA-M.</th>
                  <th style={{ textAlign: 'center' }}>Score</th>
                  <th style={{ textAlign: 'center' }}>Signal</th>
                </tr>
              </thead>
              <tbody>
                {filteredStocks.map(stock => {
                  const renderGrowthBars = (score: number | null) => {
                    if (score === null || score === undefined) return <span style={{ color: 'var(--text-muted)' }}>-</span>;
                    const numBars = Math.min(10, Math.max(1, score));
                    
                    let barColor = 'var(--hold-amber)';
                    if (score >= 7) barColor = 'var(--buy-green)';
                    else if (score <= 3) barColor = 'var(--sell-red)';

                    return (
                      <div style={{ display: 'flex', gap: '2px', alignItems: 'center', justifyContent: 'center' }}>
                        {Array.from({ length: 10 }).map((_, i) => {
                          const active = i < numBars;
                          return (
                            <div
                              key={i}
                              style={{
                                width: '3px',
                                height: '9px',
                                borderRadius: '1px',
                                backgroundColor: active ? barColor : 'var(--border-color)'
                              }}
                            />
                          );
                        })}
                      </div>
                    );
                  };

                  return (
                    <tr 
                      key={stock.symbol}
                      onClick={() => router.push(`/stocks/${stock.symbol}`)}
                      style={{ cursor: 'pointer' }}
                    >
                      <td 
                        onClick={(e) => handleRemoveFromWatchlist(e, stock.symbol)} 
                        style={{ paddingLeft: '1.25rem', fontSize: '1.1rem', userSelect: 'none', textAlign: 'center', color: '#fbbf24' }}
                      >
                        ★
                      </td>
                      <td style={{ fontWeight: 700, color: 'var(--primary)' }}>{stock.symbol}</td>
                      <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                        <div className="logo-container">
                          <CompanyLogo name={stock.name} symbol={stock.symbol} website={stock.website} />
                          <span>{stock.name}</span>
                        </div>
                      </td>
                      <td>
                        <span style={{ fontSize: '0.675rem', fontWeight: 700, color: 'var(--text-secondary)', padding: '0.15rem 0.4rem', border: '1px solid var(--border-color)', borderRadius: '3px', backgroundColor: 'rgba(148, 163, 184, 0.1)' }}>
                          {stock.index}
                        </span>
                      </td>
                      <td style={{ color: 'var(--text-secondary)' }}>
                        {stock.sector || '-'}
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--text-primary)' }}>
                        {stock.price > 0 ? `${stock.price.toFixed(2)} $` : '-'}
                      </td>
                      <td style={{ textAlign: 'right', color: 'var(--text-secondary)' }}>
                        {stock.peRatio !== null ? stock.peRatio.toFixed(1) : '-'}
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 600, color: stock.change >= 0 ? 'var(--buy-green)' : 'var(--sell-red)' }}>
                        {stock.price > 0 ? `${stock.change >= 0 ? '+' : ''}${stock.changePercent.toFixed(2)}%` : '-'}
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 600, color: stock.yearPerformance !== null ? (stock.yearPerformance >= 0 ? 'var(--buy-green)' : 'var(--sell-red)') : 'inherit' }}>
                        {stock.yearPerformance !== null ? `${stock.yearPerformance >= 0 ? '+' : ''}${stock.yearPerformance.toFixed(1)}%` : '-'}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        {stock.price > 0 ? renderGrowthBars(stock.revenueGrowthScore) : '-'}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        {stock.price > 0 ? renderGrowthBars(stock.earningsGrowthScore) : '-'}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        {stock.price > 0 ? renderGrowthBars(stock.ebitdaMarginScore) : '-'}
                      </td>
                      <td style={{ textAlign: 'center', fontWeight: 800, color: 'var(--text-primary)' }}>
                        {stock.price > 0 ? (
                          <span style={{
                            color: stock.score >= 70 ? 'var(--buy-green)' : stock.score <= 35 ? 'var(--sell-red)' : 'var(--hold-amber)',
                            textShadow: stock.score >= 70 ? '0 0 8px rgba(16,185,129,0.3)' : 'none'
                          }}>
                            {stock.score}
                          </span>
                        ) : '-'}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        {stock.price > 0 ? (
                          <span className={`badge badge-${stock.signal.toLowerCase()}`} style={{ minWidth: '75px' }}>
                            {stock.signal === 'BUY' ? 'Buy' : stock.signal === 'SELL' ? 'Sell' : 'Hold'}
                          </span>
                        ) : (
                          <span className="badge badge-hold" style={{ minWidth: '75px', opacity: 0.4 }}>
                            No Data
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>
      
      <style jsx global>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </>
  );
}
