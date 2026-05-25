'use client';

import React, { useState, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import Header from '@/components/Header';
import { useRouter } from 'next/navigation';

interface UserItem {
  id: string;
  username: string;
  role: string;
  mustChangePassword: boolean;
  createdAt: string;
}

export default function AdminPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [usersList, setUsersList] = useState<UserItem[]>([]);
  const [listLoading, setListLoading] = useState(true);

  // Form states
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [formError, setFormError] = useState('');
  const [formSuccess, setFormSuccess] = useState('');
  const [formLoading, setFormLoading] = useState(false);

  const fetchUsers = async () => {
    try {
      setListLoading(true);
      const res = await fetch('/api/admin/users');
      const data = await res.json();
      if (res.ok && data.users) {
        setUsersList(data.users);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setListLoading(false);
    }
  };

  useEffect(() => {
    if (!loading) {
      if (!user || user.role !== 'ADMIN') {
        router.push('/dashboard');
      } else {
        fetchUsers();
      }
    }
  }, [user, loading, router]);

  const handleCreateUserSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setFormSuccess('');

    if (!newUsername || !newPassword) {
      setFormError('Bitte alle Felder ausfüllen.');
      return;
    }

    setFormLoading(true);

    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: newUsername, password: newPassword })
      });
      const data = await res.json();

      if (res.ok && data.success) {
        setFormSuccess(`Benutzer "${data.user.username}" erfolgreich erstellt.`);
        setNewUsername('');
        setNewPassword('');
        fetchUsers(); // Refresh list
      } else {
        setFormError(data.error || 'Erstellung fehlgeschlagen.');
      }
    } catch (err) {
      console.error(err);
      setFormError('Verbindungsfehler beim Erstellen.');
    } finally {
      setFormLoading(false);
    }
  };

  const handleDeleteUser = async (targetId: string, targetName: string) => {
    if (!confirm(`Möchten Sie den Benutzer "${targetName}" wirklich löschen?`)) {
      return;
    }

    try {
      const res = await fetch(`/api/admin/users/${targetId}`, {
        method: 'DELETE'
      });
      const data = await res.json();

      if (res.ok && data.success) {
        fetchUsers(); // Refresh list
      } else {
        alert(data.error || 'Fehler beim Löschen.');
      }
    } catch (err) {
      console.error(err);
      alert('Verbindungsfehler beim Löschen.');
    }
  };

  if (loading || !user || user.role !== 'ADMIN') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', backgroundColor: 'var(--bg-main)' }}>
        <div style={{ width: '30px', height: '30px', border: '3px solid var(--border-color)', borderTopColor: 'var(--primary)', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
      </div>
    );
  }

  // Calculate statistics
  const totalUsers = usersList.length;
  const pendingUsers = usersList.filter(u => u.mustChangePassword).length;
  const activeUsers = totalUsers - pendingUsers;

  return (
    <>
      <Header />
      <main className="container" style={{ padding: '2rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '1.75rem' }}>
        {/* Intro */}
        <div>
          <h2 style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '0.5rem' }}>
            Benutzerverwaltung
          </h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            Erstellen Sie neue Konten und verwalten Sie die Passworteinstellungen Ihrer Benutzer.
          </p>
        </div>

        {/* Grid Stats */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '1.5rem'
        }}>
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Benutzer Gesamt</span>
            <span style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--primary)' }}>{listLoading ? '...' : totalUsers}</span>
          </div>
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Aktivierte Benutzer</span>
            <span style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--buy-green)' }}>{listLoading ? '...' : activeUsers}</span>
          </div>
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Ausstehende Aktivierung</span>
            <span style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--hold-amber)' }}>{listLoading ? '...' : pendingUsers}</span>
          </div>
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr minmax(300px, 380px)',
          gap: '2rem',
          alignItems: 'start'
        }}>
          {/* Left: User List */}
          <div>
            <h3 style={{ fontSize: '1.125rem', fontWeight: 800, marginBottom: '1rem', color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Registrierte Benutzer
            </h3>
            {listLoading ? (
              <div className="card" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '3rem' }}>
                <div style={{ width: '24px', height: '24px', border: '2px solid var(--border-color)', borderTopColor: 'var(--primary)', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
              </div>
            ) : usersList.length === 0 ? (
              <div className="card" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>
                Keine Benutzer vorhanden
              </div>
            ) : (
              <div className="table-container">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Username</th>
                      <th>Rolle</th>
                      <th>Status</th>
                      <th>Erstellt am</th>
                      <th style={{ textAlign: 'right' }}>Aktionen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usersList.map(u => (
                      <tr key={u.id}>
                        <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{u.username}</td>
                        <td>
                          <span style={{
                            fontSize: '0.75rem',
                            fontWeight: 700,
                            color: u.role === 'ADMIN' ? 'var(--primary)' : 'var(--text-secondary)',
                            letterSpacing: '0.03em'
                          }}>
                            {u.role}
                          </span>
                        </td>
                        <td>
                          {u.mustChangePassword ? (
                            <span className="badge badge-hold">Ausstehend</span>
                          ) : (
                            <span className="badge badge-buy">Aktiv</span>
                          )}
                        </td>
                        <td style={{ color: 'var(--text-secondary)' }}>
                          {new Date(u.createdAt).toLocaleDateString('de-DE', {
                            day: '2-digit',
                            month: '2-digit',
                            year: 'numeric'
                          })}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <button
                            onClick={() => handleDeleteUser(u.id, u.username)}
                            className="btn btn-danger"
                            style={{ padding: '0.35rem 0.75rem', fontSize: '0.75rem', borderRadius: '4px' }}
                            disabled={u.id === user.id} // Cannot delete self
                          >
                            Löschen
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Right: Create User Form */}
          <div className="card" style={{ border: '1px solid var(--border-color)' }}>
            <h3 style={{ fontSize: '1.125rem', fontWeight: 800, marginBottom: '1.25rem', color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Neuen Benutzer anlegen
            </h3>
            
            {formError && (
              <div style={{
                backgroundColor: 'var(--sell-red-bg)',
                border: '1px solid var(--sell-red-border)',
                color: '#f87171',
                padding: '0.75rem 1rem',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.8125rem',
                marginBottom: '1.25rem',
                fontWeight: 500
              }}>
                ⚠️ {formError}
              </div>
            )}

            {formSuccess && (
              <div style={{
                backgroundColor: 'var(--buy-green-bg)',
                border: '1px solid var(--buy-green-border)',
                color: '#34d399',
                padding: '0.75rem 1rem',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.8125rem',
                marginBottom: '1.25rem',
                fontWeight: 500
              }}>
                ✅ {formSuccess}
              </div>
            )}

            <form onSubmit={handleCreateUserSubmit}>
              <div className="form-group">
                <label className="form-label">Username</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="z.B. alex"
                  value={newUsername}
                  onChange={e => setNewUsername(e.target.value)}
                  disabled={formLoading}
                  style={{
                    border: '1px solid rgba(255,255,255,0.1)',
                    backgroundColor: 'rgba(5, 7, 16, 0.7)'
                  }}
                />
              </div>

              <div className="form-group" style={{ marginBottom: '1.75rem' }}>
                <label className="form-label">Temporäres Passwort</label>
                <input
                  type="password"
                  className="form-input"
                  placeholder="Min. 6 Zeichen"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  disabled={formLoading}
                  style={{
                    border: '1px solid rgba(255,255,255,0.1)',
                    backgroundColor: 'rgba(5, 7, 16, 0.7)'
                  }}
                />
              </div>

              <button
                type="submit"
                className="btn btn-primary"
                style={{ width: '100%', padding: '0.75rem', fontWeight: 700 }}
                disabled={formLoading}
              >
                {formLoading ? 'Erstelle...' : 'Benutzer erstellen'}
              </button>
            </form>
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
