'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '../../components/Icons';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // If already authenticated, skip the login screen.
  useEffect(() => {
    fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/api/v1/auth/me`, {
      credentials: 'include'
    })
      .then((r) => {
        if (r.ok) router.replace('/dashboard');
      })
      .catch(() => {});
  }, [router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password })
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        setError(j?.error?.message || 'Login failed');
        return;
      }
      router.replace('/dashboard');
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="sidebar__brand" style={{ border: 'none', padding: 0, marginBottom: 14, height: 'auto' }}>
          <span className="sidebar__logo">OM</span>
          <span style={{ fontSize: 18 }}>OpsMesh</span>
        </div>
        <h1>Sign in</h1>
        <p className="muted" style={{ marginTop: 0, marginBottom: 18, fontSize: 13 }}>
          Incident command center for SRE & DevOps teams.
        </p>
        {error && <div className="error-box">{error}</div>}
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="field">
            <label>Email</label>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@opsmesh.io" required autoComplete="username" />
          </div>
          <div className="field">
            <label>Password</label>
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required autoComplete="current-password" />
          </div>
          <button className="btn btn--primary" type="submit" disabled={loading || !email || !password}>
            <Icon name="bolt" /> {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <p className="faint" style={{ fontSize: 11.5, marginTop: 16 }}>
          Demo: admin@opsmesh.io / ChangeMe123! (alice, bob, carol, viewer also available)
        </p>
      </div>
    </div>
  );
}
