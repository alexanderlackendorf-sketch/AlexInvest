'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';

export default function LoginPage() {
  const { user, login, refreshUser } = useAuth();
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  
  // Password change states (if forced)
  const [mustReset, setMustReset] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (user) {
      if (user.mustChangePassword) {
        setMustReset(true);
        // Pre-fill current password with the password they just logged in with
        setCurrentPassword(password);
      } else {
        router.push('/dashboard');
      }
    }
  }, [user, router]);

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) {
      setError('Bitte füllen Sie alle Felder aus');
      return;
    }

    setError('');
    setLoading(true);

    const res = await login(username, password);
    setLoading(false);

    if (!res.success) {
      setError(res.error || 'Login fehlgeschlagen');
    }
  };

  const handleResetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPassword || !newPassword || !confirmPassword) {
      setError('Bitte füllen Sie alle Felder aus');
      return;
    }

    if (newPassword.length < 6) {
      setError('Das neue Passwort muss mindestens 6 Zeichen lang sein');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('Die neuen Passwörter stimmen nicht überein');
      return;
    }

    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword })
      });
      const data = await res.json();

      if (res.ok) {
        // Success: refresh user session state and go to dashboard
        await refreshUser();
        router.push('/dashboard');
      } else {
        setError(data.error || 'Passwortänderung fehlgeschlagen');
      }
    } catch (err) {
      console.error(err);
      setError('Verbindungsfehler beim Passwort-Ändern');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      backgroundColor: '#04060d',
      padding: '1.5rem',
      position: 'relative',
      overflow: 'hidden'
    }}>
      {/* Background visual graphics */}
      <div style={{
        position: 'absolute',
        top: '20%',
        left: '20%',
        width: '400px',
        height: '400px',
        background: 'radial-gradient(circle, rgba(6,182,212,0.12) 0%, transparent 70%)',
        borderRadius: '50%',
        filter: 'blur(40px)',
        zIndex: 0
      }} />
      <div style={{
        position: 'absolute',
        bottom: '20%',
        right: '20%',
        width: '400px',
        height: '400px',
        background: 'radial-gradient(circle, rgba(30,58,138,0.15) 0%, transparent 70%)',
        borderRadius: '50%',
        filter: 'blur(40px)',
        zIndex: 0
      }} />

      <div className="card" style={{
        maxWidth: '440px',
        width: '100%',
        padding: '3rem 2.5rem',
        borderRadius: 'var(--radius-lg)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        boxShadow: '0 20px 50px rgba(0,0,0,0.8), 0 0 40px rgba(6, 182, 212, 0.03)',
        zIndex: 1,
        background: 'rgba(11, 17, 32, 0.75)'
      }}>
        {/* Logo / Title */}
        <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.625rem',
            color: 'var(--primary)',
            marginBottom: '0.75rem'
          }}>
            <svg
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ filter: 'drop-shadow(0 0 10px rgba(6, 182, 212, 0.4))' }}
            >
              <line x1="18" y1="20" x2="18" y2="10" />
              <line x1="12" y1="20" x2="12" y2="4" />
              <line x1="6" y1="20" x2="6" y2="14" />
              <path d="M2 18h20" />
            </svg>
            <span style={{ fontSize: '2.25rem', fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>Alex Invest</span>
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem', letterSpacing: '0.01em', fontWeight: 500 }}>
            {mustReset 
              ? 'PASSWORT-AKTIVIERUNG ERFORDERLICH' 
              : 'STOCK ANALYSIS FOR PROFESSIONALS (DAX & S&P 500)'}
          </p>
        </div>

        {/* Error Box */}
        {error && (
          <div style={{
            backgroundColor: 'var(--sell-red-bg)',
            border: '1px solid var(--sell-red-border)',
            color: '#f87171',
            padding: '0.75rem 1rem',
            borderRadius: 'var(--radius-sm)',
            fontSize: '0.8125rem',
            marginBottom: '1.5rem',
            fontWeight: 500,
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem'
          }}>
            <span>⚠️</span>
            <span>{error}</span>
          </div>
        )}

        {/* Login Form */}
        {!mustReset ? (
          <form onSubmit={handleLoginSubmit}>
            <div className="form-group">
              <label className="form-label">Benutzername</label>
              <input
                type="text"
                className="form-input"
                placeholder="z.B. admin"
                value={username}
                onChange={e => setUsername(e.target.value)}
                disabled={loading}
                autoFocus
                style={{
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: 'rgba(5, 7, 16, 0.7)'
                }}
              />
            </div>

            <div className="form-group" style={{ marginBottom: '2.25rem' }}>
              <label className="form-label">Passwort</label>
              <input
                type="password"
                className="form-input"
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                disabled={loading}
                style={{
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: 'rgba(5, 7, 16, 0.7)'
                }}
              />
            </div>

            <button
              type="submit"
              className="btn btn-primary"
              style={{ width: '100%', padding: '0.75rem', fontWeight: '700', fontSize: '0.875rem' }}
              disabled={loading}
            >
              {loading ? 'Anmelden...' : 'Sicher anmelden'}
            </button>
          </form>
        ) : (
          /* Forced Password Change Form */
          <form onSubmit={handleResetSubmit}>
            <div style={{
              backgroundColor: 'rgba(6, 182, 212, 0.08)',
              border: '1px solid rgba(6, 182, 212, 0.2)',
              color: 'var(--text-primary)',
              padding: '0.85rem 1rem',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.75rem',
              lineHeight: 1.45,
              marginBottom: '1.5rem'
            }}>
              💡 Ihr Account wurde temporär eingerichtet oder zurückgesetzt. Bitte legen Sie ein persönliches Passwort fest, um fortzufahren.
            </div>

            <div className="form-group">
              <label className="form-label">Aktuelles Passwort</label>
              <input
                type="password"
                className="form-input"
                value={currentPassword}
                onChange={e => setCurrentPassword(e.target.value)}
                disabled={loading}
                style={{
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: 'rgba(5, 7, 16, 0.7)'
                }}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Neues Passwort</label>
              <input
                type="password"
                className="form-input"
                placeholder="Mindestens 6 Zeichen"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                disabled={loading}
                style={{
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: 'rgba(5, 7, 16, 0.7)'
                }}
              />
            </div>

            <div className="form-group" style={{ marginBottom: '2.25rem' }}>
              <label className="form-label">Neues Passwort bestätigen</label>
              <input
                type="password"
                className="form-input"
                placeholder="Mindestens 6 Zeichen"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                disabled={loading}
                style={{
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: 'rgba(5, 7, 16, 0.7)'
                }}
              />
            </div>

            <button
              type="submit"
              className="btn btn-primary"
              style={{ width: '100%', padding: '0.75rem', fontWeight: '700', fontSize: '0.875rem' }}
              disabled={loading}
            >
              {loading ? 'Speichern...' : 'Passwort speichern & weiter'}
            </button>
          </form>
        )}

        {/* Small warning disclaimer below form */}
        <div style={{
          marginTop: '2rem',
          textAlign: 'center',
          fontSize: '0.65rem',
          color: 'var(--text-secondary)',
          lineHeight: '1.4',
          borderTop: '1px solid rgba(255,255,255,0.05)',
          paddingTop: '1.25rem'
        }}>
          Ausschließlich für autorisierte Profianleger. Datenverbindungen sind SSL-verschlüsselt. Kein Angebot oder Empfehlung zum Erwerb von Finanzprodukten.
        </div>
      </div>
    </div>
  );
}
