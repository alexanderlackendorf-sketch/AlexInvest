'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/context/AuthContext';
import Header from '@/components/Header';
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
  updatedAt: string;
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

export default function DashboardPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [stocks, setStocks] = useState<StockItem[]>([]);
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [stocksLoading, setStocksLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  // KI Market Analysis states
  interface MarketAnalysisItem {
    sentiment: string;
    riskScore: number;
    topFactors: string;
    summary: string;
    vixValue: number | null;
    updatedAt: string;
  }
  const [marketAnalysis, setMarketAnalysis] = useState<MarketAnalysisItem | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(true);
  const [syncingAnalysis, setSyncingAnalysis] = useState(false);

  const fetchMarketAnalysis = async () => {
    try {
      setAnalysisLoading(true);
      const res = await fetch('/api/market-analysis');
      const data = await res.json();
      if (res.ok && data.analysis) {
        setMarketAnalysis(data.analysis);
      }
    } catch (err) {
      console.error('Failed to fetch market analysis:', err);
    } finally {
      setAnalysisLoading(false);
    }
  };

  const handleSyncAnalysis = async () => {
    setSyncingAnalysis(true);
    try {
      const res = await fetch('/api/market-analysis', { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.analysis) {
        setMarketAnalysis(data.analysis);
        alert('KI-Marktanalyse erfolgreich aktualisiert.');
      } else {
        alert('Fehler beim Aktualisieren der KI-Marktanalyse.');
      }
    } catch (err) {
      console.error(err);
      alert('Verbindungsfehler beim Aktualisieren.');
    } finally {
      setSyncingAnalysis(false);
    }
  };

  const factors: string[] = useMemo(() => {
    if (!marketAnalysis?.topFactors) return [];
    try {
      return JSON.parse(marketAnalysis.topFactors);
    } catch (e) {
      return [];
    }
  }, [marketAnalysis]);

  // Filters & Search
  const [search, setSearch] = useState('');
  const [selectedIndex, setSelectedIndex] = useState<string>('ALL'); // 'ALL', 'DAX', 'SP500'
  const [selectedSignal, setSelectedSignal] = useState<string>('ALL'); // 'ALL', 'BUY', 'HOLD', 'SELL'
  const [selectedSector, setSelectedSector] = useState<string>('ALL');
  const [sortField, setSortField] = useState<string>('symbol');
  const [sortAsc, setSortAsc] = useState<boolean>(true);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 20;

  const sectors = useMemo(() => {
    // Count sector occurrences
    const sectorCounts: Record<string, number> = {};
    stocks.forEach(s => {
      if (s.sector) {
        sectorCounts[s.sector] = (sectorCounts[s.sector] ?? 0) + 1;
      }
    });
    // Sort by frequency descending and take top 10
    const sorted = Object.entries(sectorCounts)
      .sort((a, b) => b[1] - a[1])
      .map(entry => entry[0]);
    const topSectors = sorted.slice(0, 10);
    return ['ALL', ...topSectors].sort();
  }, [stocks]);

  useEffect(() => {
    setCurrentPage(1);
  }, [search, selectedIndex, selectedSignal, selectedSector, sortField, sortAsc]);

  const fetchData = async () => {
    try {
      setStocksLoading(true);
      // Fetch watchlist first
      const wlRes = await fetch('/api/stocks?watchlist=true');
      const wlData = await wlRes.json();
      if (wlRes.ok && wlData.stocks) {
        setWatchlist(wlData.stocks.map((s: StockItem) => s.symbol));
      }

      // Fetch all stocks
      const res = await fetch('/api/stocks');
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
      fetchData();
      fetchMarketAnalysis();
    }
  }, [user, loading]);

  const handleSyncAll = async () => {
    setSyncing(true);
    try {
      const res = await fetch('/api/stocks', { method: 'POST' });
      if (res.ok) {
        alert('Synchronisierung gestartet. Die Berechnungen laufen im Hintergrund. Bitte laden Sie die Seite gleich neu.');
        // Briefly wait and refetch
        setTimeout(fetchData, 3000);
      } else {
        alert('Fehler beim Starten der Synchronisierung.');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSyncing(false);
    }
  };

  const handleToggleWatchlist = async (e: React.MouseEvent, symbol: string) => {
    e.preventDefault();
    e.stopPropagation();

    const isAdded = watchlist.includes(symbol);
    const method = isAdded ? 'DELETE' : 'POST';

    try {
      const res = await fetch('/api/watchlist', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol })
      });

      if (res.ok) {
        if (isAdded) {
          setWatchlist(watchlist.filter(s => s !== symbol));
        } else {
          setWatchlist([...watchlist, symbol]);
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(true);
    }
  };

  if (loading || !user) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', backgroundColor: 'var(--bg-main)' }}>
        <div style={{ width: '30px', height: '30px', border: '3px solid var(--border-color)', borderTopColor: 'var(--primary)', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
      </div>
    );
  }

  // Calculate Indices changes
  const daxComponents = stocks.filter(s => s.index === 'DAX' && s.price > 0);
  const daxChange = daxComponents.length 
    ? daxComponents.reduce((acc, s) => acc + s.changePercent, 0) / daxComponents.length
    : 0;

  const spComponents = stocks.filter(s => s.index === 'SP500' && s.price > 0);
  const spChange = spComponents.length 
    ? spComponents.reduce((acc, s) => acc + s.changePercent, 0) / spComponents.length
    : 0;

  // Filter stocks
  const filteredStocks = stocks.filter(s => {
    const matchesSearch = s.symbol.toLowerCase().includes(search.toLowerCase()) || 
                          s.name.toLowerCase().includes(search.toLowerCase());
    const matchesIndex = selectedIndex === 'ALL' || s.index === selectedIndex;
    const matchesSignal = selectedSignal === 'ALL' || s.signal === selectedSignal;
    const matchesSector = selectedSector === 'ALL' || s.sector === selectedSector;
    return matchesSearch && matchesIndex && matchesSignal && matchesSector;
  });

  // Sort stocks
  const sortedStocks = [...filteredStocks].sort((a, b) => {
    let valA: any = a[sortField as keyof StockItem];
    let valB: any = b[sortField as keyof StockItem];

    // Handle null values for P/E
    if (valA === null) valA = sortAsc ? 999999 : -999999;
    if (valB === null) valB = sortAsc ? 999999 : -999999;

    if (valA < valB) return sortAsc ? -1 : 1;
    if (valA > valB) return sortAsc ? 1 : -1;
    return 0;
  });

  const totalItems = sortedStocks.length;
  const totalPages = Math.ceil(totalItems / itemsPerPage);
  const paginatedStocks = sortedStocks.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  return (
    <>
      <Header />
      <main className="container" style={{ padding: '2rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '1.75rem' }}>
        
        {/* Indices Status widgets */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: '1.5rem'
        }}>
          {/* DAX Widget */}
          <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderLeft: `4px solid ${daxChange >= 0 ? 'var(--buy-green)' : 'var(--sell-red)'}` }}>
            <div>
              <span style={{ fontSize: '0.675rem', fontWeight: 700, color: 'var(--text-secondary)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>DEUTSCHLAND 40</span>
              <h3 style={{ fontSize: '1.5rem', fontWeight: 800, marginTop: '0.25rem', color: 'var(--text-primary)' }}>DAX INDEX</h3>
            </div>
            <div style={{ textAlign: 'right' }}>
              <span className={`badge ${daxChange >= 0 ? 'badge-buy' : 'badge-sell'}`} style={{ fontSize: '0.8125rem', padding: '0.4rem 0.8rem', fontWeight: 800 }}>
                {daxChange >= 0 ? '▲' : '▼'} {daxChange.toFixed(2)}%
              </span>
              <div style={{ fontSize: '0.675rem', color: 'var(--text-secondary)', marginTop: '0.4rem' }}>Durchschnitt Komponenten</div>
            </div>
          </div>

          {/* S&P 500 Widget */}
          <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderLeft: `4px solid ${spChange >= 0 ? 'var(--buy-green)' : 'var(--sell-red)'}` }}>
            <div>
              <span style={{ fontSize: '0.675rem', fontWeight: 700, color: 'var(--text-secondary)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>USA 500</span>
              <h3 style={{ fontSize: '1.5rem', fontWeight: 800, marginTop: '0.25rem', color: 'var(--text-primary)' }}>S&P 500 INDEX</h3>
            </div>
            <div style={{ textAlign: 'right' }}>
              <span className={`badge ${spChange >= 0 ? 'badge-buy' : 'badge-sell'}`} style={{ fontSize: '0.8125rem', padding: '0.4rem 0.8rem', fontWeight: 800 }}>
                {spChange >= 0 ? '▲' : '▼'} {spChange.toFixed(2)}%
              </span>
              <div style={{ fontSize: '0.675rem', color: 'var(--text-secondary)', marginTop: '0.4rem' }}>Durchschnitt Komponenten</div>
            </div>
          </div>
        </div>

        {/* Global Market AI Analysis Card */}
        {analysisLoading ? (
          <div className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem', gap: '0.75rem' }}>
            <div style={{ width: '20px', height: '20px', border: '2px solid var(--border-color)', borderTopColor: 'var(--primary)', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
            <span style={{ fontSize: '0.775rem', color: 'var(--text-secondary)' }}>Lade globale KI-Marktanalyse...</span>
          </div>
        ) : marketAnalysis ? (
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', borderLeft: '4px solid var(--primary)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '1.1rem' }}>🤖</span>
                <h3 style={{ fontSize: '0.9rem', fontWeight: 800, color: 'var(--text-primary)', margin: 0, letterSpacing: '0.02em', textTransform: 'uppercase' }}>
                  Globale KI-Marktanalyse & Politische Risiken
                </h3>
                <span className={`badge ${
                  marketAnalysis.riskScore <= 35 ? 'badge-buy' : marketAnalysis.riskScore <= 65 ? 'badge-hold' : 'badge-sell'
                }`} style={{ fontSize: '0.675rem', fontWeight: 700, padding: '0.2rem 0.5rem' }}>
                  {marketAnalysis.sentiment}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <span style={{ fontSize: '0.675rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                  Aktualisiert: {new Date(marketAnalysis.updatedAt).toLocaleString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' })}
                </span>
                {user.role === 'ADMIN' && (
                  <button
                    onClick={handleSyncAnalysis}
                    className="btn btn-secondary"
                    style={{ fontSize: '0.675rem', padding: '0.25rem 0.6rem', height: '24px', fontWeight: 700 }}
                    disabled={syncingAnalysis}
                  >
                    {syncingAnalysis ? 'Aktualisiere...' : 'Sync KI'}
                  </button>
                )}
              </div>
            </div>

            <div style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '1.5rem',
            }}>
              {/* Left Column: Stats & Gauge */}
              <div style={{ flex: '1 1 300px', display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                {/* Risk Score Gauge */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                    <span style={{ fontSize: '0.675rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Crash- & Korrekturrisiko
                    </span>
                    <span style={{
                      fontSize: '0.775rem',
                      fontWeight: 800,
                      color: marketAnalysis.riskScore <= 35 ? 'var(--buy-green)' : marketAnalysis.riskScore <= 65 ? 'var(--hold-amber)' : 'var(--sell-red)'
                    }}>
                      {marketAnalysis.riskScore}%
                    </span>
                  </div>
                  {/* Progress track */}
                  <div style={{ width: '100%', height: '6px', backgroundColor: 'var(--border-color)', borderRadius: '3px', overflow: 'hidden' }}>
                    <div style={{
                      width: `${marketAnalysis.riskScore}%`,
                      height: '100%',
                      backgroundColor: marketAnalysis.riskScore <= 35 ? 'var(--buy-green)' : marketAnalysis.riskScore <= 65 ? 'var(--hold-amber)' : 'var(--sell-red)',
                      transition: 'width 0.5s ease-in-out'
                    }} />
                  </div>
                </div>

                {/* VIX Level & Info */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0.75rem', backgroundColor: 'rgba(148, 163, 184, 0.03)', borderRadius: '4px', border: '1px solid var(--border-color)' }}>
                  <span style={{ fontSize: '0.725rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                    CBOE Volatilitätsindex (VIX)
                  </span>
                  <span style={{
                    fontSize: '0.775rem',
                    fontWeight: 700,
                    color: marketAnalysis.vixValue !== null && marketAnalysis.vixValue > 20 ? 'var(--sell-red)' : 'var(--text-primary)',
                    fontFamily: 'var(--font-mono)'
                  }}>
                    {marketAnalysis.vixValue !== null ? marketAnalysis.vixValue.toFixed(2) : 'N/A'}
                  </span>
                </div>

                {/* Top Factors */}
                <div>
                  <span style={{ display: 'block', fontSize: '0.675rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.4rem' }}>
                    Primäre Markttreiber
                  </span>
                  <ul style={{ paddingLeft: '1.1rem', margin: 0, fontSize: '0.725rem', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                    {factors.map((factor, index) => (
                      <li key={index} style={{ listStyleType: 'square' }}>{factor}</li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* Right Column: AI Summary */}
              <div style={{ 
                flex: '2 1 400px', 
                display: 'flex', 
                flexDirection: 'column', 
                justifyContent: 'center',
                borderLeft: '1px solid var(--border-color)',
                paddingLeft: '1.5rem'
              }}>
                <span style={{ display: 'block', fontSize: '0.675rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.4rem' }}>
                  Analysten-Einschätzung
                </span>
                <p style={{
                  fontSize: '0.775rem',
                  lineHeight: '1.6',
                  color: 'var(--text-primary)',
                  textAlign: 'justify',
                  margin: 0
                }}>
                  {marketAnalysis.summary}
                </p>
              </div>
            </div>
          </div>
        ) : null}

        {/* Filters and Controls */}
        <div className="card" style={{ display: 'flex', flexWrap: 'wrap', gap: '1.25rem', justifyContent: 'space-between', alignItems: 'center' }}>
          
          {/* Left: Buttons for Filters */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.25rem', alignItems: 'center' }}>
            {/* Index Filter (Pill-Style) */}
            <div style={{ display: 'flex', backgroundColor: 'rgba(30, 41, 59, 0.4)', padding: '3px', borderRadius: '20px', border: '1px solid var(--border-color)' }}>
              {['ALL', 'DAX', 'SP500'].map(idx => (
                <button
                  key={idx}
                  onClick={() => setSelectedIndex(idx)}
                  style={{
                    backgroundColor: selectedIndex === idx ? 'var(--primary)' : 'transparent',
                    color: selectedIndex === idx ? '#040810' : 'var(--text-secondary)',
                    border: 'none',
                    padding: '0.4rem 1rem',
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    borderRadius: '16px',
                    cursor: 'pointer',
                    transition: 'var(--transition-smooth)'
                  }}
                >
                  {idx === 'ALL' ? 'Alle Indizes' : idx}
                </button>
              ))}
            </div>

            {/* Signal Filter (Pill-Style) */}
            <div style={{ display: 'flex', backgroundColor: 'rgba(30, 41, 59, 0.4)', padding: '3px', borderRadius: '20px', border: '1px solid var(--border-color)' }}>
              {['ALL', 'BUY', 'HOLD', 'SELL'].map(sig => (
                <button
                  key={sig}
                  onClick={() => setSelectedSignal(sig)}
                  style={{
                    backgroundColor: selectedSignal === sig 
                      ? (sig === 'BUY' ? 'var(--buy-green)' : sig === 'SELL' ? 'var(--sell-red)' : sig === 'HOLD' ? 'var(--hold-amber)' : 'var(--text-secondary)') 
                      : 'transparent',
                    color: selectedSignal === sig 
                      ? (sig === 'SELL' ? '#ffffff' : '#040810') 
                      : 'var(--text-secondary)',
                    border: 'none',
                    padding: '0.4rem 1rem',
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    borderRadius: '16px',
                    cursor: 'pointer',
                    transition: 'var(--transition-smooth)'
                  }}
                >
                  {sig === 'ALL' ? 'Alle Signale' : sig}
                </button>
              ))}
            </div>

            {/* Sector Filter */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Branche:</span>
              <select
                value={selectedSector}
                onChange={e => setSelectedSector(e.target.value)}
                className="form-input"
                style={{
                  padding: '0.4rem 2rem 0.4rem 0.75rem',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  color: 'var(--text-primary)',
                  backgroundColor: 'rgba(15, 23, 42, 0.6)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer',
                  width: 'auto',
                  maxWidth: '200px'
                }}
              >
                <option value="ALL">Alle Branchen</option>
                {sectors.filter(s => s !== 'ALL').map(sect => (
                  <option key={sect} value={sect}>{sect}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Search Field + Sync */}
          <div style={{ display: 'flex', gap: '1rem', width: '100%', maxWidth: '440px' }}>
            <div style={{ position: 'relative', width: '100%' }}>
              <input
                type="text"
                placeholder="Aktie suchen (Name oder Ticker)..."
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
            {user.role === 'ADMIN' && (
              <button
                onClick={handleSyncAll}
                className="btn btn-primary"
                style={{ whiteSpace: 'nowrap', fontWeight: 700, fontSize: '0.75rem', padding: '0.4rem 1rem' }}
                disabled={syncing}
              >
                {syncing ? 'Syncing...' : 'Sync All'}
              </button>
            )}
          </div>
        </div>

        {/* Main Stocks Table */}
        {stocksLoading ? (
          <div className="card" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '5rem' }}>
            <div style={{ width: '30px', height: '30px', border: '3px solid var(--border-color)', borderTopColor: 'var(--primary)', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
          </div>
        ) : sortedStocks.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: '4rem', color: 'var(--text-secondary)' }}>
            Keine Aktien für die gewählten Filter gefunden.
          </div>
        ) : (
          <>
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: '45px', paddingLeft: '1.25rem', textAlign: 'center' }}>WL</th>
                    <th onClick={() => handleSort('symbol')} style={{ cursor: 'pointer' }}>
                      Ticker {sortField === 'symbol' ? (sortAsc ? '▲' : '▼') : ''}
                    </th>
                    <th onClick={() => handleSort('name')} style={{ cursor: 'pointer' }}>
                      Name {sortField === 'name' ? (sortAsc ? '▲' : '▼') : ''}
                    </th>
                    <th onClick={() => handleSort('index')} style={{ cursor: 'pointer' }}>
                      Index {sortField === 'index' ? (sortAsc ? '▲' : '▼') : ''}
                    </th>
                    <th onClick={() => handleSort('sector')} style={{ cursor: 'pointer' }}>
                      Branche {sortField === 'sector' ? (sortAsc ? '▲' : '▼') : ''}
                    </th>
                    <th onClick={() => handleSort('price')} style={{ cursor: 'pointer', textAlign: 'right' }}>
                      Kurs {sortField === 'price' ? (sortAsc ? '▲' : '▼') : ''}
                    </th>
                    <th onClick={() => handleSort('peRatio')} style={{ cursor: 'pointer', textAlign: 'right' }}>
                      KGV {sortField === 'peRatio' ? (sortAsc ? '▲' : '▼') : ''}
                    </th>
                    <th onClick={() => handleSort('changePercent')} style={{ cursor: 'pointer', textAlign: 'right' }}>
                      Tägl. % {sortField === 'changePercent' ? (sortAsc ? '▲' : '▼') : ''}
                    </th>
                    <th onClick={() => handleSort('yearPerformance')} style={{ cursor: 'pointer', textAlign: 'right' }}>
                      Perf. (1J) {sortField === 'yearPerformance' ? (sortAsc ? '▲' : '▼') : ''}
                    </th>
                    <th onClick={() => handleSort('revenueGrowthScore')} style={{ cursor: 'pointer', textAlign: 'center' }}>
                      Umsatz {sortField === 'revenueGrowthScore' ? (sortAsc ? '▲' : '▼') : ''}
                    </th>
                    <th onClick={() => handleSort('earningsGrowthScore')} style={{ cursor: 'pointer', textAlign: 'center' }}>
                      Ergebnis {sortField === 'earningsGrowthScore' ? (sortAsc ? '▲' : '▼') : ''}
                    </th>
                    <th onClick={() => handleSort('ebitdaMarginScore')} style={{ cursor: 'pointer', textAlign: 'center' }}>
                      EBITDA-M. {sortField === 'ebitdaMarginScore' ? (sortAsc ? '▲' : '▼') : ''}
                    </th>
                    <th onClick={() => handleSort('score')} style={{ cursor: 'pointer', textAlign: 'center' }}>
                      Score {sortField === 'score' ? (sortAsc ? '▲' : '▼') : ''}
                    </th>
                    <th onClick={() => handleSort('signal')} style={{ cursor: 'pointer', textAlign: 'center' }}>
                      Signal {sortField === 'signal' ? (sortAsc ? '▲' : '▼') : ''}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedStocks.map(stock => {
                    const isAdded = watchlist.includes(stock.symbol);
                    
                    // Helper to render growth bars
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
                          onClick={(e) => handleToggleWatchlist(e, stock.symbol)} 
                          style={{ paddingLeft: '1.25rem', fontSize: '1.1rem', userSelect: 'none', textAlign: 'center', color: isAdded ? '#fbbf24' : 'var(--text-muted)' }}
                        >
                          {isAdded ? '★' : '☆'}
                        </td>
                        <td style={{ fontWeight: 700, color: 'var(--primary)' }}>
                          {stock.symbol}
                        </td>
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

            {/* Pagination Controls */}
            {!stocksLoading && sortedStocks.length > 0 && (
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginTop: '0.5rem',
                padding: '0.75rem 1.25rem',
                backgroundColor: 'rgba(11, 17, 32, 0.6)',
                backdropFilter: 'blur(12px)',
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-md)',
                flexWrap: 'wrap',
                gap: '1rem'
              }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                  Zeige <strong>{Math.min(totalItems, (currentPage - 1) * itemsPerPage + 1)}</strong> bis{' '}
                  <strong>{Math.min(totalItems, currentPage * itemsPerPage)}</strong> von{' '}
                  <strong>{totalItems}</strong> Aktien
                </span>
                
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <button
                    onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                    disabled={currentPage === 1}
                    className="btn btn-secondary"
                    style={{ padding: '0.4rem 0.8rem', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.25rem', borderRadius: '4px' }}
                  >
                    ◀ Zurück
                  </button>
                  
                  <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-primary)', padding: '0 0.75rem' }}>
                    Seite {currentPage} von {totalPages || 1}
                  </div>
                  
                  <button
                    onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                    disabled={currentPage === totalPages || totalPages === 0}
                    className="btn btn-secondary"
                    style={{ padding: '0.4rem 0.8rem', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.25rem', borderRadius: '4px' }}
                  >
                    Weiter ▶
                  </button>
                </div>
              </div>
            )}
          </>
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
