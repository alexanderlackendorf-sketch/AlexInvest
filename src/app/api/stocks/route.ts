import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import prisma from '@/services/db';
import { verifyToken } from '@/services/auth';
import { syncAllStocks, syncStockSignal } from '@/services/yahooFinance';

// Helper to check authentication
async function getSessionUser() {
  const cookieStore = await cookies();
  const token = cookieStore.get('token')?.value;
  if (!token) return null;
  return verifyToken(token);
}

export async function GET(req: Request) {
  try {
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const watchlistOnly = searchParams.get('watchlist') === 'true';
    const indexParam = searchParams.get('index'); // 'DAX' or 'SP500'
    const searchQuery = searchParams.get('search')?.toUpperCase();

    // Query builder
    const whereClause: any = {};

    if (indexParam === 'DAX' || indexParam === 'SP500') {
      whereClause.index = indexParam;
    }

    if (searchQuery) {
      whereClause.OR = [
        { symbol: { contains: searchQuery } },
        { name: { contains: searchQuery } }
      ];
    }

    if (watchlistOnly) {
      const watchlistItems = await prisma.watchlistItem.findMany({
        where: { userId: user.id },
        select: { symbol: true }
      });
      const symbols = watchlistItems.map(item => item.symbol);
      let stocks = await prisma.stock.findMany({
        where: { symbol: { in: symbols } }
      });

      const cacheMaxAgeMs = 2 * 60 * 1000;
      const now = Date.now();
      const outdatedSymbols = stocks
        .filter(s => s.price === 0 || s.ema200 === null || (now - new Date(s.updatedAt).getTime()) > cacheMaxAgeMs)
        .map(s => s.symbol);

      if (outdatedSymbols.length > 0) {
        console.log(`Auto-syncing ${outdatedSymbols.length} outdated watchlist stocks:`, outdatedSymbols);
        // Run sync in parallel (limited to first 15 to avoid API rate limits)
        await Promise.all(outdatedSymbols.slice(0, 15).map(symbol =>
          syncStockSignal(symbol).catch(err => console.warn(`Failed to auto-sync watchlist stock ${symbol}:`, err))
        ));
        // Refetch updated stocks
        stocks = await prisma.stock.findMany({
          where: { symbol: { in: symbols } }
        });
      }

      // Sort alphabetically by symbol
      stocks.sort((a, b) => a.symbol.localeCompare(b.symbol));

      return NextResponse.json({ stocks });
    }

    const stocks = await prisma.stock.findMany({
      where: whereClause,
      orderBy: { symbol: 'asc' }
    });

    return NextResponse.json({ stocks });
  } catch (error) {
    console.error('Fetch stocks error:', error);
    return NextResponse.json(
      { error: 'Ein interner Fehler ist aufgetreten' },
      { status: 500 }
    );
  }
}

// POST endpoint triggers a synchronization of all stocks
export async function POST() {
  try {
    const user = await getSessionUser();
    if (!user || user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 403 });
    }

    // Run sync in the background
    syncAllStocks().catch(err => {
      console.error('Background sync failed:', err);
    });

    return NextResponse.json({
      success: true,
      message: 'Daten-Synchronisierung im Hintergrund gestartet.'
    });
  } catch (error) {
    console.error('Trigger sync error:', error);
    return NextResponse.json(
      { error: 'Ein interner Fehler ist aufgetreten' },
      { status: 500 }
    );
  }
}
