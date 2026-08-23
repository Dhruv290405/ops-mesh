'use client';

import { ReactNode } from 'react';

export function Card({
  title,
  action,
  children,
  className = '',
  bodyClass = ''
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClass?: string;
}) {
  return (
    <div className={`card ${className}`}>
      {title && (
        <div className="card__head">
          <span className="card__title">{title}</span>
          {action}
        </div>
      )}
      <div className={`card__body ${bodyClass}`}>{children}</div>
    </div>
  );
}

export function StatCard({
  label,
  value,
  sub,
  icon
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="stat">
      <span className="stat__label">
        {icon && <span className="stat__icon">{icon}</span>}
        {label}
      </span>
      <span className="stat__value">{value}</span>
      {sub && <span className="stat__sub">{sub}</span>}
    </div>
  );
}

export function Badge({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <span className={`badge ${className}`}>{children}</span>;
}

export function Dot({ className = '' }: { className?: string }) {
  return <span className={`dot ${className}`} />;
}

export function Spinner() {
  return <div className="spinner" />;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function ErrorState({ error }: { error: string }) {
  return (
    <div className="error-box">
      <strong>Error:</strong> {error}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  action
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Bar({ value, max = 100 }: { value: number; max?: number }) {
  const pct = max <= 0 ? 0 : Math.min(100, Math.round((value / max) * 100));
  return (
    <div className="bar">
      <div className="bar__fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const cls =
    status === 'RESOLVED' || status === 'HEALTHY' || status === 'RUNNING' || status === 'UP'
      ? 'badge--ok'
      : status === 'ESCALATED' || status === 'DOWN' || status === 'FAILED' || status === 'OFFLINE'
        ? 'badge--danger'
        : status === 'ACKNOWLEDGED' || status === 'INVESTIGATING' || status === 'DEGRADED' || status === 'WARN'
          ? 'badge--warn'
          : 'badge--muted';
  return <Badge className={cls}>{status}</Badge>;
}

export function SeverityBadge({ severity }: { severity: string }) {
  return <Badge className={'' + (severity.startsWith('SEV-1') ? 'badge--sev1' : severity.startsWith('SEV-2') ? 'badge--sev2' : severity.startsWith('SEV-3') ? 'badge--sev3' : 'badge--sev4')}>{severity}</Badge>;
}
