import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import prisma from '@/services/db';
import { verifyToken } from '@/services/auth';
import { syncGlobalMarketAnalysis } from '@/services/yahooFinance';

// Helper to check authentication
async function getSessionUser() {
  const cookieStore = await cookies();
  const token = cookieStore.get('token')?.value;
  if (!token) return null;
  return verifyToken(token);
}

export async function GET() {
  try {
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 });
    }

    // 1. Fetch analysis from database
    let analysis = await prisma.marketAnalysis.findFirst();

    // 2. If no analysis exists, run sync on demand
    if (!analysis) {
      console.log('No global market analysis found. Generating initial analysis...');
      await syncGlobalMarketAnalysis();
      analysis = await prisma.marketAnalysis.findFirst();
    }

    return NextResponse.json({ analysis });
  } catch (error) {
    console.error('Fetch global market analysis error:', error);
    return NextResponse.json(
      { error: 'Ein interner Fehler ist aufgetreten' },
      { status: 500 }
    );
  }
}

export async function POST() {
  try {
    const user = await getSessionUser();
    if (!user || user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 403 });
    }

    // Trigger sync
    await syncGlobalMarketAnalysis();

    const updatedAnalysis = await prisma.marketAnalysis.findFirst();

    return NextResponse.json({
      success: true,
      analysis: updatedAnalysis
    });
  } catch (error: any) {
    console.error('Manual sync of global market analysis failed:', error);
    return NextResponse.json(
      { error: `Aktualisierung fehlgeschlagen: ${error.message}` },
      { status: 500 }
    );
  }
}
