'use client';

import { usePathname, useRouter } from 'next/navigation';
import { Icon } from './Icons';

export const NAV = [
  { href: '/dashboard', label: 'Overview', icon: 'overview' },
  { href: '/incidents', label: 'Incidents', icon: 'incidents' },
  { href: '/services', label: 'Services', icon: 'services' },
  { href: '/events', label: 'Events', icon: 'events' },
  { href: '/queues', label: 'Queues & Workers', icon: 'queues' },
  { href: '/system', label: 'System Health', icon: 'system' },
  { href: '/settings', label: 'Settings', icon: 'settings' }
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="sidebar">
      <div className="sidebar__brand">
        <span className="sidebar__logo">OM</span>
        <span>OpsMesh</span>
      </div>
      <nav className="sidebar__nav">
        {NAV.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + '/');
          return (
            <a
              key={item.href}
              href={item.href}
              className={`nav-item ${active ? 'active' : ''}`}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
            </a>
          );
        })}
      </nav>
      <div className="sidebar__foot">OpsMesh · v1.0.0<br />Event-driven ops platform</div>
    </aside>
  );
}
