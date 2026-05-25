import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import prisma from '@/services/db';
import { verifyToken } from '@/services/auth';

// Helper to check authentication
async function getSessionUser() {
  const cookieStore = await cookies();
  const token = cookieStore.get('token')?.value;
  if (!token) return null;
  return verifyToken(token);
}

export async function POST(req: Request) {
  try {
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 });
    }

    const { symbol } = await req.json();
    if (!symbol) {
      return NextResponse.json({ error: 'Symbol erforderlich' }, { status: 400 });
    }

    const cleanSymbol = symbol.toUpperCase();

    // Verify stock exists in our DB
    const stock = await prisma.stock.findUnique({
      where: { symbol: cleanSymbol }
    });

    if (!stock) {
      return NextResponse.json({ error: 'Aktie wird nicht unterstützt' }, { status: 404 });
    }

    // Add to watchlist
    await prisma.watchlistItem.upsert({
      where: {
        userId_symbol: {
          userId: user.id,
          symbol: cleanSymbol
        }
      },
      create: {
        userId: user.id,
        symbol: cleanSymbol,
        name: stock.name
      },
      update: {} // No-op if already exists
    });

    return NextResponse.json({ success: true, isWatchlisted: true });
  } catch (error) {
    console.error('Add to watchlist error:', error);
    return NextResponse.json(
      { error: 'Ein interner Fehler ist aufgetreten' },
      { status: 500 }
    );
  }
}

export async function DELETE(req: Request) {
  try {
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 });
    }

    const { symbol } = await req.json();
    if (!symbol) {
      return NextResponse.json({ error: 'Symbol erforderlich' }, { status: 400 });
    }

    const cleanSymbol = symbol.toUpperCase();

    // Remove from watchlist
    await prisma.watchlistItem.delete({
      where: {
        userId_symbol: {
          userId: user.id,
          symbol: cleanSymbol
        }
      }
    });

    return NextResponse.json({ success: true, isWatchlisted: false });
  } catch (error) {
    console.error('Remove from watchlist error:', error);
    return NextResponse.json(
      { error: 'Ein interner Fehler ist aufgetreten' },
      { status: 500 }
    );
  }
}
