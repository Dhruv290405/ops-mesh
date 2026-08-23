'use client';

import { usePathname, useRouter } from 'next/navigation';
import { Icon } from './Icons';
import { useSocket } from '../lib/socket';
import { NAV } from './Sidebar';

export function Topbar({ user }: { user: { email: string; role: string } | null }) {
  const pathname = usePathname();
  const router = useRouter();
  const { connected } = useSocket();

  const nav = NAV.find((n) => pathname === n.href || pathname.startsWith(n.href + '/'));
  let title = nav?.label ?? 'OpsMesh';
  if (pathname.startsWith('/incidents/')) title = 'Incident Details';
  else if (pathname.startsWith('/services/')) title = 'Service Details';

  const logout = async () => {
    try {
      await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/api/v1/auth/logout`, {
        method: 'POST',
        credentials: 'include'
      });
    } catch {
      /* ignore */
    }
    router.push('/login');
  };

  const initials = user?.email ? user.email.slice(0, 2).toUpperCase() : '··';

  return (
    <header className="topbar">
      <div className="topbar__title">{title}</div>
      <div className="topbar__right">
        <span className={`conn ${connected ? '' : 'off'}`} title={connected ? 'Realtime connected' : 'Realtime disconnected'}>
          <span className="dot" /> {connected ? 'Live' : 'Offline'}
        </span>
        {user && (
          <div className="topbar__user">
            <span className="avatar">{initials}</span>
            <div style={{ lineHeight: 1.1 }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{user.email}</div>
              <div className="faint" style={{ fontSize: 11 }}>{user.role}</div>
            </div>
            <button className="btn btn--ghost btn--sm" onClick={logout} title="Log out">
              <Icon name="logout" />
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
