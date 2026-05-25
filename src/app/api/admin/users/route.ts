import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import prisma from '@/services/db';
import { verifyToken, hashPassword } from '@/services/auth';

// Helper to check if current user is admin
async function isAdmin() {
  const cookieStore = await cookies();
  const token = cookieStore.get('token')?.value;
  if (!token) return false;
  const session = verifyToken(token);
  if (!session || session.role !== 'ADMIN') return false;
  return true;
}

export async function GET() {
  try {
    if (!(await isAdmin())) {
      return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 403 });
    }

    const users = await prisma.user.findMany({
      select: {
        id: true,
        username: true,
        role: true,
        mustChangePassword: true,
        createdAt: true
      },
      orderBy: { createdAt: 'desc' }
    });

    return NextResponse.json({ users });
  } catch (error) {
    console.error('Admin get users error:', error);
    return NextResponse.json(
      { error: 'Ein interner Fehler ist aufgetreten' },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    if (!(await isAdmin())) {
      return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 403 });
    }

    const { username, password } = await req.json();

    if (!username || !password) {
      return NextResponse.json(
        { error: 'Username und Passwort sind erforderlich' },
        { status: 400 }
      );
    }

    if (username.length < 3) {
      return NextResponse.json(
        { error: 'Der Username muss mindestens 3 Zeichen lang sein' },
        { status: 400 }
      );
    }

    if (password.length < 6) {
      return NextResponse.json(
        { error: 'Das Passwort muss mindestens 6 Zeichen lang sein' },
        { status: 400 }
      );
    }

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { username }
    });

    if (existingUser) {
      return NextResponse.json(
        { error: 'Dieser Username ist bereits vergeben' },
        { status: 400 }
      );
    }

    // Create user
    const passwordHash = hashPassword(password);
    const user = await prisma.user.create({
      data: {
        username,
        passwordHash,
        role: 'USER',
        mustChangePassword: true
      },
      select: {
        id: true,
        username: true,
        role: true,
        mustChangePassword: true
      }
    });

    return NextResponse.json({ success: true, user });
  } catch (error) {
    console.error('Admin create user error:', error);
    return NextResponse.json(
      { error: 'Ein interner Fehler ist aufgetreten' },
      { status: 500 }
    );
  }
}
