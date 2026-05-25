import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import prisma from '@/services/db';
import { verifyToken } from '@/services/auth';

// Helper to check if current user is admin and get their session
async function getAdminSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get('token')?.value;
  if (!token) return null;
  const session = verifyToken(token);
  if (!session || session.role !== 'ADMIN') return null;
  return session;
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const adminSession = await getAdminSession();
    if (!adminSession) {
      return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 403 });
    }

    const { id } = await params;

    if (!id) {
      return NextResponse.json({ error: 'User-ID erforderlich' }, { status: 400 });
    }

    // Prevent self-deletion
    if (adminSession.id === id) {
      return NextResponse.json(
        { error: 'Sie können Ihr eigenes Admin-Konto nicht löschen' },
        { status: 400 }
      );
    }

    // Delete user (cascade will handle watchlists)
    await prisma.user.delete({
      where: { id }
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Admin delete user error:', error);
    return NextResponse.json(
      { error: 'Ein interner Fehler ist aufgetreten' },
      { status: 500 }
    );
  }
}
