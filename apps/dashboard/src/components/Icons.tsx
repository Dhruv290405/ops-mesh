'use client';

import { ReactNode } from 'react';

const S = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

export function Icon({ name }: { name: string }) {
  const paths: Record<string, ReactNode> = {
    overview: <><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></>,
    incidents: <><path d="M12 3 2.5 19.5h19L12 3Z" /><path d="M12 10v4" /><circle cx="12" cy="17" r="0.6" fill="currentColor" /></>,
    services: <><rect x="3" y="4" width="18" height="6" rx="1.5" /><rect x="3" y="14" width="18" height="6" rx="1.5" /><circle cx="7" cy="7" r="1" fill="currentColor" /><circle cx="7" cy="17" r="1" fill="currentColor" /></>,
    events: <><path d="M3 12h4l2.5-7 5 14 2.5-7H21" /></>,
    queues: <><rect x="3" y="3" width="6" height="18" rx="1" /><rect x="10.5" y="3" width="6" height="12" rx="1" /><rect x="18" y="3" width="3" height="8" rx="1" /></>,
    system: <><path d="M3 12h4l2-5 4 10 2-5h6" /><path d="M20.5 7.5a4 4 0 0 0-7 1" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" /></>,
    logout: <><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" /><path d="M10 17l5-5-5-5M15 12H3" /></>,
    bolt: <><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" /></>,
    user: <><circle cx="12" cy="8" r="3.5" /><path d="M5 20a7 7 0 0 1 14 0" /></>,
    bell: <><path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z" /><path d="M10 20a2 2 0 0 0 4 0" /></>
  };
  return (
    <svg {...S} className="nav-item__icon">
      {paths[name] ?? paths.overview}
    </svg>
  );
}
