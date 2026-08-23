export function relativeTime(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const s = Math.round(diff / 1000);
  if (s < 0) return 'in ' + formatDuration(-s);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.round(h / 24);
  return `${days}d ago`;
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export function formatDateTime(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function shortId(id?: string | null): string {
  if (!id) return '—';
  return id.length > 10 ? id.slice(0, 8) : id;
}

export function severityClass(sev: string): string {
  if (sev === 'SEV-1' || sev === 'CRITICAL') return 'badge--sev1';
  if (sev === 'SEV-2' || sev === 'HIGH') return 'badge--sev2';
  if (sev === 'SEV-3' || sev === 'MEDIUM') return 'badge--sev3';
  return 'badge--sev4';
}

export function statusClass(status: string): string {
  switch (status) {
    case 'HEALTHY':
    case 'RESOLVED':
    case 'OPEN':
      return 'badge--ok';
    case 'DEGRADED':
    case 'ACKNOWLEDGED':
    case 'INVESTIGATING':
      return 'badge--warn';
    case 'DOWN':
    case 'ESCALATED':
      return 'badge--danger';
    default:
      return 'badge--muted';
  }
}

export function statusDot(status: string): string {
  switch (status) {
    case 'HEALTHY':
    case 'UP':
    case 'RUNNING':
    case 'RESOLVED':
      return 'dot--ok';
    case 'DEGRADED':
    case 'WARN':
      return 'dot--warn';
    case 'DOWN':
    case 'OFFLINE':
    case 'FAILED':
      return 'dot--danger';
    default:
      return 'dot--unknown';
  }
}

export function fmtNum(n: number): string {
  return new Intl.NumberFormat().format(n);
}
