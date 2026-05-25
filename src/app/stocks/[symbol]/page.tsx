'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useAuth } from '@/context/AuthContext';
import Header from '@/components/Header';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';

interface StockItem {
  symbol: string;
  name: string;
  index: string;
  price: number;
  change: number;
  changePercent: number;
  peRatio: number | null;
  rsi: number | null;
  ema200: number | null;
  score: number;
  signal: string;
  updatedAt: string;
  wkn: string | null;
  isin: string | null;
  country: string | null;
  sector: string | null;
  marketCap: number | null;
  dividendYield: number | null;
  eps: number | null;
  yearPerformance: number | null;
  website: string | null;
  analystTargetLow: number | null;
  analystTargetHigh: number | null;
  analystTargetMean: number | null;
  analystTargetMedian: number | null;
  analystRecommendation: string | null;
  analystCount: number | null;
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

interface PriceHistory {
  date: string;
  close: number;
}

interface SignalHistoryItem {
  id: string;
  symbol: string;
  signal: string;
  score: number;
  date: string;
}

export default function StockDetailPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const params = useParams();
  const symbol = params.symbol as string;

  const [stock, setStock] = useState<StockItem | null>(null);
  const [isWatchlisted, setIsWatchlisted] = useState(false);
  const [signalHistory, setSignalHistory] = useState<SignalHistoryItem[]>([]);
  const [historicalPrices, setHistoricalPrices] = useState<PriceHistory[]>([]);
  const [news, setNews] = useState<any[]>([]);
  const [pageLoading, setPageLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [period, setPeriod] = useState<string>('1y');

  // Chart interactivity states
  const [hoveredPoint, setHoveredPoint] = useState<PriceHistory | null>(null);
  const [tooltipX, setTooltipX] = useState(0);
  const [tooltipY, setTooltipY] = useState(0);
  const svgRef = useRef<SVGSVGElement>(null);

  const fetchStockDetails = async (activePeriod = period) => {
    try {
      setPageLoading(true);
      const res = await fetch(`/api/stocks/${symbol}?period=${activePeriod}`);
      if (!res.ok) {
        throw new Error('Stock not found');
      }
      const data = await res.json();
      setStock(data.stock);
      setIsWatchlisted(data.isWatchlisted);
      setSignalHistory(data.signalHistory);
      setHistoricalPrices(data.historicalPrices);
      setNews(data.news || []);
    } catch (err) {
      console.error(err);
      router.push('/dashboard');
    } finally {
      setPageLoading(false);
    }
  };

  useEffect(() => {
    if (!loading && user && symbol) {
      fetchStockDetails(period);
    }
  }, [user, loading, symbol, period]);

  const handleToggleWatchlist = async () => {
    if (!stock) return;

    const method = isWatchlisted ? 'DELETE' : 'POST';
    try {
      const res = await fetch('/api/watchlist', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: stock.symbol })
      });
      if (res.ok) {
        setIsWatchlisted(!isWatchlisted);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleSyncSingle = async () => {
    if (!stock) return;
    setSyncing(true);
    try {
      const res = await fetch(`/api/stocks/${stock.symbol}`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.stock) {
          setStock(data.stock);
          // Refetch to update history & news
          const detailRes = await fetch(`/api/stocks/${symbol}?period=${period}`);
          const detailData = await detailRes.json();
          setSignalHistory(detailData.signalHistory);
          setHistoricalPrices(detailData.historicalPrices);
          setNews(detailData.news || []);
        }
      } else {
        alert('Aktualisierung fehlgeschlagen.');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSyncing(false);
    }
  };

  // Custom SVG Chart Mathematics
  const chartWidth = 700;
  const chartHeight = 320;
  const paddingX = 45;
  const paddingY = 30;

  const chartData = useMemo(() => {
    if (historicalPrices.length === 0) return null;

    // Filter and find Min/Max close prices
    const closes = historicalPrices.map(p => p.close);
    const minPrice = Math.min(...closes) * 0.98; // Add 2% padding
    const maxPrice = Math.max(...closes) * 1.02; // Add 2% padding
    const priceDiff = maxPrice - minPrice;

    // Map prices to SVG Coordinates
    const points = historicalPrices.map((p, index) => {
      const x = paddingX + (index / (historicalPrices.length - 1)) * (chartWidth - paddingX * 2);
      const y = chartHeight - paddingY - ((p.close - minPrice) / priceDiff) * (chartHeight - paddingY * 2);
      return { x, y, raw: p };
    });

    // Generate SVG path strings
    let pathD = '';
    let areaD = '';

    if (points.length > 0) {
      pathD = `M ${points[0].x} ${points[0].y} ` + points.slice(1).map(p => `L ${p.x} ${p.y}`).join(' ');
      areaD = `${pathD} L ${points[points.length - 1].x} ${chartHeight - paddingY} L ${points[0].x} ${chartHeight - paddingY} Z`;
    }

    return { points, pathD, areaD, minPrice, maxPrice };
  }, [historicalPrices]);

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement, MouseEvent>) => {
    if (!chartData || !svgRef.current) return;

    const rect = svgRef.current.getBoundingClientRect();
    const mouseX = ((e.clientX - rect.left) / rect.width) * chartWidth;

    // Find closest point by X coordinate
    let closestPoint = chartData.points[0];
    let minDistance = Math.abs(closestPoint.x - mouseX);

    for (let i = 1; i < chartData.points.length; i++) {
      const distance = Math.abs(chartData.points[i].x - mouseX);
      if (distance < minDistance) {
        closestPoint = chartData.points[i];
        minDistance = distance;
      }
    }

    // Set Tooltip positions
    setHoveredPoint(closestPoint.raw);
    setTooltipX(closestPoint.x);
    setTooltipY(closestPoint.y - 15);
  };

  const handleMouseLeave = () => {
    setHoveredPoint(null);
  };

  if (loading || pageLoading || !stock) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', backgroundColor: 'var(--bg-main)' }}>
        <div style={{ width: '30px', height: '30px', border: '3px solid var(--border-color)', borderTopColor: 'var(--primary)', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
      </div>
    );
  }

  // Determine signal colors for score gauge
  const getScoreColor = (score: number) => {
    if (score >= 65) return 'var(--buy-green)';
    if (score < 40) return 'var(--sell-red)';
    return 'var(--hold-amber)';
  };

  return (
    <>
      <Header />
      <main className="container" style={{ padding: '2rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '1.75rem' }}>
        
        {/* Breadcrumb back navigation */}
        <div style={{ fontSize: '0.8125rem' }}>
          <Link href="/dashboard" style={{ color: 'var(--primary)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
            <span>◀</span> Zurück zum Dashboard
          </Link>
        </div>

        {/* Stock Title Bar */}
        <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
            <CompanyLogo name={stock.name} symbol={stock.symbol} website={stock.website} large={true} />
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                <h1 style={{ fontSize: '2rem', fontWeight: 800, color: '#ffffff', letterSpacing: '-0.02em' }}>{stock.symbol}</h1>
                <span style={{ fontSize: '0.675rem', fontWeight: 700, padding: '0.2rem 0.5rem', backgroundColor: 'rgba(30,41,59,0.3)', border: '1px solid var(--border-color)', borderRadius: '3px', color: 'var(--text-secondary)' }}>
                  {stock.index}
                </span>
                <button 
                  onClick={handleToggleWatchlist} 
                  className="btn btn-secondary" 
                  style={{ 
                    padding: '0.35rem 0.75rem', 
                    fontSize: '0.75rem', 
                    borderRadius: '4px',
                    color: isWatchlisted ? '#fbbf24' : '#ffffff',
                    borderColor: isWatchlisted ? 'rgba(251,191,36,0.3)' : 'var(--border-color)',
                    backgroundColor: isWatchlisted ? 'rgba(251,191,36,0.05)' : 'rgba(30,41,59,0.3)'
                  }}
                >
                  {isWatchlisted ? '★ Beobachtet' : '☆ Beobachten'}
                </button>
              </div>
              <h2 style={{ fontSize: '1.125rem', fontWeight: 500, color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                {stock.name}
              </h2>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', marginTop: '0.75rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                <span>WKN: <strong style={{ color: 'var(--text-primary)' }}>{stock.wkn || 'N/A'}</strong></span>
                <span>•</span>
                <span>ISIN: <strong style={{ color: 'var(--text-primary)' }}>{stock.isin || 'N/A'}</strong></span>
                <span>•</span>
                <span>Land: <strong style={{ color: 'var(--text-primary)' }}>{stock.country || 'N/A'}</strong></span>
                {stock.sector && (
                  <>
                    <span>•</span>
                    <span>Branche: <strong style={{ color: 'var(--text-primary)' }}>{stock.sector}</strong></span>
                  </>
                )}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '2rem', textAlign: 'right', flexWrap: 'wrap' }}>
            <div>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Letzter Kurs</span>
              <div className="live-pulse" style={{ 
                fontSize: '2.25rem', 
                fontWeight: 800, 
                marginTop: '0.25rem', 
                color: '#ffffff',
                backgroundColor: 'rgba(255,255,255,0.02)',
                padding: '0.25rem 0.75rem',
                borderRadius: '6px',
                border: '1px solid rgba(255,255,255,0.03)'
              }}>
                {stock.price > 0 ? `${stock.price.toFixed(2)} $` : '-'}
              </div>
            </div>
            <div>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Tägl. Änderung</span>
              <div style={{ 
                fontSize: '1.5rem', 
                fontWeight: 700, 
                marginTop: '0.4rem',
                color: stock.change >= 0 ? 'var(--buy-green)' : 'var(--sell-red)' 
              }}>
                {stock.price > 0 ? `${stock.change >= 0 ? '+' : ''}${stock.changePercent.toFixed(2)}%` : '-'}
              </div>
            </div>
            <button 
              onClick={handleSyncSingle} 
              className="btn btn-primary" 
              style={{ height: 'fit-content', padding: '0.6rem 1.2rem', fontWeight: 700, fontSize: '0.8125rem' }}
              disabled={syncing}
            >
              {syncing ? 'Aktualisiere...' : 'Kurs synchronisieren'}
            </button>
          </div>
        </div>

        {/* Layout Grid */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr minmax(320px, 400px)',
          gap: '1.75rem',
          alignItems: 'start'
        }}>
          
          {/* Left Side: Chart */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.75rem' }}>
            
            {/* Chart Card */}
            <div className="card" style={{ padding: '1.75rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
                <div>
                  <h3 style={{ fontSize: '1.125rem', fontWeight: 800, color: '#ffffff' }}>Kursverlauf</h3>
                  {hoveredPoint && (
                    <span style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--primary)', marginTop: '0.25rem', display: 'inline-block' }}>
                      {period === '1d' || period === '1w' 
                        ? new Date(hoveredPoint.date).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
                        : new Date(hoveredPoint.date).toLocaleDateString('de-DE')} : {hoveredPoint.close.toFixed(2)} $
                    </span>
                  )}
                </div>

                {/* Period Selector Tabs */}
                <div style={{ display: 'flex', gap: '3px', backgroundColor: 'rgba(30, 41, 59, 0.4)', padding: '3px', borderRadius: '16px', border: '1px solid var(--border-color)' }}>
                  {[
                    { label: '1T', value: '1d' },
                    { label: '1W', value: '1w' },
                    { label: '1M', value: '1m' },
                    { label: '1J', value: '1y' },
                    { label: '5J', value: '5y' },
                    { label: '10J', value: '10y' }
                  ].map(tab => (
                    <button
                      key={tab.value}
                      onClick={() => setPeriod(tab.value)}
                      style={{
                        backgroundColor: period === tab.value ? 'var(--primary)' : 'transparent',
                        color: period === tab.value ? '#040810' : 'var(--text-secondary)',
                        border: 'none',
                        padding: '0.35rem 0.75rem',
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        borderRadius: '12px',
                        cursor: 'pointer',
                        transition: 'var(--transition-smooth)'
                      }}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>

              {chartData ? (
                <div style={{ position: 'relative', width: '100%', overflow: 'hidden' }}>
                  <svg 
                    ref={svgRef}
                    viewBox={`0 0 ${chartWidth} ${chartHeight}`} 
                    width="100%" 
                    height="auto"
                    onMouseMove={handleMouseMove}
                    onMouseLeave={handleMouseLeave}
                    style={{ overflow: 'visible', cursor: 'crosshair' }}
                  >
                    {/* Gradients */}
                    <defs>
                      <linearGradient id="chartGlow" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.18" />
                        <stop offset="100%" stopColor="var(--primary)" stopOpacity="0.0" />
                      </linearGradient>
                    </defs>

                    {/* Horizontal Grid lines */}
                    {[0, 0.25, 0.5, 0.75, 1].map((ratio, i) => {
                      const y = paddingY + ratio * (chartHeight - paddingY * 2);
                      const price = chartData.maxPrice - ratio * (chartData.maxPrice - chartData.minPrice);
                      return (
                        <g key={i}>
                          <line 
                            x1={paddingX} 
                            y1={y} 
                            x2={chartWidth - paddingX} 
                            y2={y} 
                            stroke="var(--border-color)" 
                            strokeOpacity="0.4"
                            strokeDasharray="4"
                          />
                          <text 
                            x={paddingX - 8} 
                            y={y + 3} 
                            fill="var(--text-secondary)" 
                            fontSize="9" 
                            textAnchor="end"
                          >
                            {price.toFixed(0)}
                          </text>
                        </g>
                      );
                    })}

                    {/* Filled Area */}
                    <path d={chartData.areaD} fill="url(#chartGlow)" />

                    {/* Line Path */}
                    <path 
                      d={chartData.pathD} 
                      fill="none" 
                      stroke="var(--primary)" 
                      strokeWidth="2.5" 
                      strokeLinecap="round"
                    />

                    {/* X-axis time labels */}
                    {chartData.points.map((pt, idx) => {
                      // Show a label every Nth point to avoid clutter (approx every 80 px)
                      const show = (idx === 0) || (idx === chartData.points.length - 1) || (pt.x % 90 < 2);
                      if (!show) return null;
                      const date = new Date(pt.raw.date);
                      const label = period === '1d' || period === '1w'
                        ? date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
                        : date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
                      return (
                        <text
                          key={idx}
                          x={pt.x}
                          y={chartHeight - paddingY + 14}
                          fill="var(--text-secondary)"
                          fontSize="9"
                          textAnchor="middle"
                        >
                          {label}
                        </text>
                      );
                    })}

                    {/* Hover indicator dot */}
                    {hoveredPoint && (
                      <circle 
                        cx={tooltipX} 
                        cy={tooltipY + 15} 
                        r="5" 
                        fill="#ffffff" 
                        stroke="var(--primary)" 
                        strokeWidth="3"
                        style={{ filter: 'drop-shadow(0 0 5px rgba(6,182,212,0.6))' }}
                      />
                    )}
                  </svg>
                </div>
              ) : (
                <div style={{ height: `${chartHeight}px`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)' }}>
                  Keine Kursdaten verfügbar. Bitte aktualisieren Sie den Kurs.
                </div>
              )}
            </div>

            {/* Experten-Kursziele & Analystenschätzungen */}
            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', borderLeft: '4px solid var(--primary)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ fontSize: '1.1rem' }}>🎯</span>
                  <h3 style={{ fontSize: '0.9rem', fontWeight: 800, color: 'var(--text-primary)', margin: 0, letterSpacing: '0.02em', textTransform: 'uppercase' }}>
                    Experten-Kursziele & Empfehlungen
                  </h3>
                </div>
                {stock.analystCount && stock.analystCount > 0 ? (
                  <span style={{ fontSize: '0.675rem', color: 'var(--text-secondary)', backgroundColor: 'rgba(255,255,255,0.05)', padding: '0.2rem 0.5rem', borderRadius: '4px' }}>
                    Basierend auf {stock.analystCount} Analysten
                  </span>
                ) : null}
              </div>

              {stock.analystTargetMean && stock.analystTargetMean > 0 ? (() => {
                const isEur = stock.index === 'DAX' || stock.symbol.endsWith('.DE');
                const sign = isEur ? '€' : '$';
                
                const low = stock.analystTargetLow || 0;
                const high = stock.analystTargetHigh || 0;
                const mean = stock.analystTargetMean || 0;
                const median = stock.analystTargetMedian || 0;
                const current = stock.price || 0;
                
                // Calculate Upside/Downside
                const potentialPercent = ((mean - current) / current) * 100;
                const isUpside = potentialPercent >= 0;
                
                // Position percentages on range bar (clamped 0-100)
                let currentPercent = 50;
                let meanPercent = 50;
                if (high > low) {
                  currentPercent = Math.min(100, Math.max(0, ((current - low) / (high - low)) * 100));
                  meanPercent = Math.min(100, Math.max(0, ((mean - low) / (high - low)) * 100));
                }

                // Map recommendations
                const recRaw = stock.analystRecommendation?.toLowerCase() || '';
                let recText = 'Halten';
                let recColor = 'var(--warning)';
                if (['strong_buy', 'strong buy', 'buy', 'outperform'].some(k => recRaw.includes(k))) {
                  recText = 'Kauf-Empfehlung';
                  recColor = 'var(--buy-green)';
                } else if (['sell', 'strong_sell', 'underperform', 'under-perform'].some(k => recRaw.includes(k))) {
                  recText = 'Verkaufs-Empfehlung';
                  recColor = 'var(--sell-red)';
                }

                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                    {/* Header metrics */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '1rem' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                        <span style={{ fontSize: '0.675rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Mittleres Kursziel</span>
                        <span style={{ fontSize: '1.5rem', fontWeight: 800, color: '#ffffff' }}>
                          {mean.toFixed(2)} {sign}
                        </span>
                      </div>
                      
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                        <span style={{ fontSize: '0.675rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Potenzial (Konsens)</span>
                        <span style={{ fontSize: '1.5rem', fontWeight: 800, color: isUpside ? 'var(--buy-green)' : 'var(--sell-red)' }}>
                          {isUpside ? '+' : ''}{potentialPercent.toFixed(2)}%
                        </span>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                        <span style={{ fontSize: '0.675rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Analysten-Konsensus</span>
                        <span style={{ fontSize: '1.1rem', fontWeight: 800, color: recColor, display: 'flex', alignItems: 'center', gap: '0.25rem', marginTop: '0.25rem' }}>
                          <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: recColor, display: 'inline-block' }}></span>
                          {recText}
                        </span>
                      </div>
                    </div>

                    {/* Range Visualizer bar */}
                    <div style={{ padding: '0.75rem 0.5rem', backgroundColor: 'rgba(255,255,255,0.01)', border: '1px solid rgba(255,255,255,0.03)', borderRadius: '8px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.675rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
                        <span>Niedrigst: {low.toFixed(2)} {sign}</span>
                        <span>Höchst: {high.toFixed(2)} {sign}</span>
                      </div>

                      <div style={{ position: 'relative', height: '8px', backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: '99px', margin: '1.25rem 0' }}>
                        {/* Mean target line */}
                        <div style={{
                          position: 'absolute',
                          top: 0,
                          bottom: 0,
                          left: `${meanPercent}%`,
                          width: '2px',
                          backgroundColor: 'var(--primary)',
                          zIndex: 1
                        }}>
                          <div style={{
                            position: 'absolute',
                            top: '-15px',
                            left: '50%',
                            transform: 'translateX(-50%)',
                            fontSize: '0.6rem',
                            color: 'var(--primary)',
                            fontWeight: 700,
                            whiteSpace: 'nowrap'
                          }}>Ziel</div>
                        </div>

                        {/* Current price indicator dot */}
                        <div style={{
                          position: 'absolute',
                          top: '50%',
                          left: `${currentPercent}%`,
                          transform: 'translate(-50%, -50%)',
                          width: '14px',
                          height: '14px',
                          borderRadius: '50%',
                          backgroundColor: '#ffffff',
                          border: '3px solid var(--primary)',
                          boxShadow: '0 0 8px rgba(6,182,212,0.8)',
                          zIndex: 2
                        }}>
                          <div style={{
                            position: 'absolute',
                            bottom: '-18px',
                            left: '50%',
                            transform: 'translateX(-50%)',
                            fontSize: '0.6rem',
                            color: '#ffffff',
                            fontWeight: 700,
                            whiteSpace: 'nowrap'
                          }}>Kurs</div>
                        </div>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.675rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                        <span>Median-Ziel: {median.toFixed(2)} {sign}</span>
                        <span>Aktueller Kurs: {current.toFixed(2)} {sign}</span>
                      </div>
                    </div>
                  </div>
                );
              })() : (
                <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.8rem', border: '1px dashed var(--border-color)', borderRadius: '6px' }}>
                  Für dieses Wertpapier liegen aktuell keine Analystenschätzungen vor. Bitte synchronisieren Sie den Kurs, um aktuelle Daten zu laden.
                </div>
              )}
            </div>

          </div>

          {/* Right Side: Score, Key Metrics and Signal History */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.75rem' }}>
            
            {/* Score & Signal Widget */}
            <div className="card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '2rem 1.5rem', textAlign: 'center' }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Algorithmisches Signal
              </span>
              
              <div style={{ 
                margin: '1.25rem 0',
                display: 'flex', 
                flexDirection: 'column', 
                alignItems: 'center' 
              }}>
                <span style={{
                  fontSize: '2.75rem',
                  fontWeight: 900,
                  color: getScoreColor(stock.score),
                  lineHeight: 1,
                  textShadow: `0 0 15px ${getScoreColor(stock.score)}33`
                }}>
                  {stock.price > 0 ? stock.signal : '-'}
                </span>
                
                <span style={{
                  fontSize: '0.8125rem',
                  color: '#ffffff',
                  marginTop: '0.5rem',
                  fontWeight: 600
                }}>
                  Pro Score: {stock.price > 0 ? `${stock.score} / 100` : '-'}
                </span>
              </div>

              {/* Gauge Bar */}
              {stock.price > 0 && (
                <div style={{ 
                  width: '100%', 
                  height: '8px', 
                  backgroundColor: 'var(--border-color)', 
                  borderRadius: '99px',
                  overflow: 'hidden',
                  position: 'relative'
                }}>
                  <div style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    height: '100%',
                    width: `${stock.score}%`,
                    backgroundColor: getScoreColor(stock.score),
                    transition: 'var(--transition-smooth)'
                  }} />
                </div>
              )}
            </div>

            {/* Key Metrics Grid */}
            <div className="card">
              <h3 style={{ fontSize: '0.9rem', fontWeight: 800, marginBottom: '1.25rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-primary)' }}>Kennzahlen im Fokus</h3>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                <div className="financial-metric-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>Marktkapitalisierung</span>
                  <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
                    {stock.marketCap ? (
                      stock.marketCap >= 1e12 
                        ? `${(stock.marketCap / 1e12).toFixed(2)} Bio. $` 
                        : stock.marketCap >= 1e9 
                          ? `${(stock.marketCap / 1e9).toFixed(2)} Mrd. $`
                          : `${(stock.marketCap / 1e6).toFixed(2)} Mio. $`
                    ) : '-'}
                  </span>
                </div>
                <div className="financial-metric-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>Dividendenrendite</span>
                  <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
                    {stock.dividendYield !== null ? `${(stock.dividendYield * 100).toFixed(2)}%` : '-'}
                  </span>
                </div>
                <div className="financial-metric-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>Gewinn pro Aktie (EPS)</span>
                  <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
                    {stock.eps !== null ? `${stock.eps.toFixed(2)} $` : '-'}
                  </span>
                </div>
                <div className="financial-metric-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>KGV</span>
                  <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{stock.peRatio !== null ? stock.peRatio.toFixed(1) : '-'}</span>
                </div>
                <div className="financial-metric-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>RSI (14)</span>
                  <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{stock.rsi !== null ? stock.rsi.toFixed(1) : '-'}</span>
                </div>
                <div className="financial-metric-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>EMA (200 Tage)</span>
                  <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{stock.ema200 !== null && stock.ema200 !== undefined ? `${stock.ema200.toFixed(2)} $` : '-'}</span>
                </div>
                <div className="financial-metric-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>Letztes Update</span>
                  <span style={{ fontWeight: 600, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                    {new Date(stock.updatedAt).toLocaleDateString('de-DE', {
                      day: '2-digit',
                      month: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </span>
                </div>
              </div>
            </div>

            {/* Signal History */}
            <div className="card">
              <h3 style={{ fontSize: '0.9rem', fontWeight: 800, marginBottom: '1.25rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-primary)' }}>Signalhistorie</h3>
              
              {signalHistory.length === 0 ? (
                <div style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem', textAlign: 'center', padding: '1rem 0' }}>
                  Keine vergangenen Signale aufgezeichnet.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {signalHistory.map(hist => (
                    <div 
                      key={hist.id} 
                      style={{ 
                        display: 'flex', 
                        justifyContent: 'space-between', 
                        alignItems: 'center',
                        fontSize: '0.8125rem',
                        borderBottom: '1px solid rgba(255,255,255,0.03)',
                        paddingBottom: '0.5rem'
                      }}
                    >
                      <span style={{ color: 'var(--text-secondary)' }}>
                        {new Date(hist.date).toLocaleDateString('de-DE', {
                          day: '2-digit',
                          month: '2-digit',
                          year: '2-digit'
                        })}
                      </span>
                      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                        <span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>Score: {hist.score}</span>
                        <span className={`badge badge-${hist.signal.toLowerCase()}`} style={{ fontSize: '0.625rem', padding: '0.15rem 0.4rem', minWidth: '55px', textAlign: 'center' }}>
                          {hist.signal}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* News Feed Card */}
            <div className="card">
              <h3 style={{ fontSize: '0.9rem', fontWeight: 800, marginBottom: '1.25rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-primary)' }}>Nachrichten</h3>
              
              {news.length === 0 ? (
                <div style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem', textAlign: 'center', padding: '1.25rem 0' }}>
                  Keine aktuellen Nachrichten gefunden.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  {news.map((item, idx) => (
                    <div 
                      key={item.uuid || idx} 
                      style={{ 
                        display: 'flex', 
                        flexDirection: 'column', 
                        gap: '0.35rem',
                        borderBottom: idx < news.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none',
                        paddingBottom: idx < news.length - 1 ? '0.75rem' : '0'
                      }}
                    >
                      <a 
                        href={item.link} 
                        target="_blank" 
                        rel="noopener noreferrer" 
                        style={{ 
                          fontSize: '0.8125rem', 
                          fontWeight: 600, 
                          color: 'var(--primary)', 
                          textDecoration: 'none',
                          lineHeight: 1.45
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.textDecoration = 'underline'}
                        onMouseLeave={(e) => e.currentTarget.style.textDecoration = 'none'}
                      >
                        {item.title}
                      </a>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.6875rem', color: 'var(--text-muted)' }}>
                        <span>{item.publisher}</span>
                        <span>
                          {new Date(item.providerPublishTime).toLocaleDateString('de-DE', {
                            day: '2-digit',
                            month: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>

        </div>

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
