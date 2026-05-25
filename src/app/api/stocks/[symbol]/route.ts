import dns from 'dns';
dns.setDefaultResultOrder('ipv4first');

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import prisma from '@/services/db';
import { verifyToken } from '@/services/auth';
import { syncStockSignal } from '@/services/yahooFinance';
import YahooFinanceClass from 'yahoo-finance2';

const yahooFinance = new (YahooFinanceClass as any)();

// Helper to check authentication
async function getSessionUser() {
  const cookieStore = await cookies();
  const token = cookieStore.get('token')?.value;
  if (!token) return null;
  return verifyToken(token);
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ symbol: string }> }
) {
  try {
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 });
    }

    const { symbol } = await params;
    const cleanSymbol = decodeURIComponent(symbol).toUpperCase();
    
    const { searchParams } = new URL(req.url);
    const period = searchParams.get('period') || '1y';

    // 1. Get stock details from database
    let stock = await prisma.stock.findUnique({
      where: { symbol: cleanSymbol }
    });

    if (!stock) {
      return NextResponse.json({ error: 'Aktie nicht gefunden' }, { status: 404 });
    }

    // Auto-sync if price is 0, or EMA200/AI assessment is missing (due to new database schema)
    if (stock.price === 0 || stock.ema200 === null || !stock.aiAssessment) {
      try {
        console.log(`Auto-syncing stock ${cleanSymbol} to calculate EMA200 and generate AI assessment...`);
        await syncStockSignal(cleanSymbol);
        stock = await prisma.stock.findUnique({
          where: { symbol: cleanSymbol }
        }) || stock;
      } catch (syncErr) {
        console.warn(`Failed to auto-sync stock ${cleanSymbol}:`, syncErr);
      }
    }

    // 2. Check if stock is in user's watchlist
    const watchlistEntry = await prisma.watchlistItem.findUnique({
      where: {
        userId_symbol: {
          userId: user.id,
          symbol: cleanSymbol
        }
      }
    });

    // 3. Get signal history from database
    const signalHistory = await prisma.signalHistory.findMany({
      where: { symbol: cleanSymbol },
      orderBy: { date: 'desc' },
      take: 20
    });

    // 4. Get historical prices based on selected period
    let historicalPrices: { date: string; close: number }[] = [];
    try {
      const today = new Date();
      let startDate = new Date();
      let interval = '1d';
      let useChart = false;

      switch (period) {
        case '1d':
          startDate.setDate(today.getDate() - 7); // Go back 7 days to cover weekends
          interval = '15m';
          useChart = true;
          break;
        case '1w':
          startDate.setDate(today.getDate() - 7);
          interval = '30m';
          useChart = true;
          break;
        case '1m':
          startDate.setDate(today.getDate() - 30);
          interval = '1d';
          break;
        case '1y':
          startDate.setFullYear(today.getFullYear() - 1);
          interval = '1d';
          break;
        case '5y':
          startDate.setFullYear(today.getFullYear() - 5);
          interval = '1wk';
          break;
        case '10y':
          startDate.setFullYear(today.getFullYear() - 10);
          interval = '1mo';
          break;
        default:
          startDate.setFullYear(today.getFullYear() - 1);
          interval = '1d';
      }

      if (useChart) {
        const chartData = await yahooFinance.chart(cleanSymbol, {
          period1: startDate,
          interval: interval as any
        });

        if (chartData && chartData.quotes && chartData.quotes.length > 0) {
          if (period === '1d') {
            // Filter only the last available trading day to avoid empty charts on weekends
            const lastQuote = chartData.quotes[chartData.quotes.length - 1];
            if (lastQuote && lastQuote.date) {
              const lastDateStr = new Date(lastQuote.date).toDateString();
              const filteredQuotes = chartData.quotes.filter((q: any) => q.date && new Date(q.date).toDateString() === lastDateStr);
              
              historicalPrices = filteredQuotes.map((q: any) => ({
                date: new Date(q.date).toISOString(),
                close: q.close as number
              })).filter((h: any) => typeof h.close === 'number' && !isNaN(h.close));
            }
          } else {
            historicalPrices = chartData.quotes.map((q: any) => ({
              date: new Date(q.date).toISOString(),
              close: q.close as number
            })).filter((h: any) => typeof h.close === 'number' && !isNaN(h.close));
          }
        }
      } else {
        const history = (await yahooFinance.historical(cleanSymbol, {
          period1: startDate,
          period2: today,
          interval: interval as any
        })) as any[];

        historicalPrices = history
          .map((h: any) => ({
            date: new Date(h.date).toISOString().split('T')[0],
            close: h.close as number
          }))
          .filter((h: any) => typeof h.close === 'number' && !isNaN(h.close));
      }
    } catch (error) {
      console.error(`Failed to fetch history for ${cleanSymbol}:`, error);
    }

    // 5. Fetch 5 latest news articles
    let news: any[] = [];
    try {
      const searchResult = await yahooFinance.search(cleanSymbol, { newsCount: 5 });
      news = searchResult.news || [];
    } catch (err) {
      console.error(`Failed to fetch news for ${cleanSymbol}:`, err);
    }

    return NextResponse.json({
      stock,
      isWatchlisted: !!watchlistEntry,
      signalHistory,
      historicalPrices,
      news
    });
  } catch (error) {
    console.error('Get stock details error:', error);
    return NextResponse.json(
      { error: 'Ein interner Fehler ist aufgetreten' },
      { status: 500 }
    );
  }
}

// POST triggers a sync of a single stock's signal
export async function POST(
  req: Request,
  { params }: { params: Promise<{ symbol: string }> }
) {
  const { symbol } = await params;
  try {
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 });
    }

    const cleanSymbol = decodeURIComponent(symbol).toUpperCase();

    // Trigger calculation
    await syncStockSignal(cleanSymbol);

    // Fetch updated stock
    const updatedStock = await prisma.stock.findUnique({
      where: { symbol: cleanSymbol }
    });

    return NextResponse.json({
      success: true,
      stock: updatedStock
    });
  } catch (error: any) {
    console.error(`Manual sync failed for ${symbol}:`, error);
    return NextResponse.json(
      { error: `Aktualisierung fehlgeschlagen: ${error.message}` },
      { status: 500 }
    );
  }
}
