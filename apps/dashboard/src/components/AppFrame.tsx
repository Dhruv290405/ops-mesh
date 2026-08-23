'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { Spinner } from './ui';
import { fetchMe } from '../lib/api';

export default function AppFrame({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<{ email: string; role: string } | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchMe()
      .then((u) => {
        if (!cancelled) setUser({ email: u.email, role: u.role });
      })
      .catch(() => {
        if (!cancelled) router.replace('/login');
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (checking) {
    return (
      <div className="app-shell">
        <Sidebar />
        <div className="main">
          <Spinner />
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <Sidebar />
      <div className="main">
        <Topbar user={user} />
        <div className="content">{children}</div>
      </div>
    </div>
  );
}
