import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { useT } from '../lib/i18n';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

const variantClass: Record<Variant, string> = {
  primary: 'bg-accent text-accent-contrast hover:opacity-90',
  secondary: 'border border-border bg-surface2 text-text hover:bg-surface',
  ghost: 'text-muted hover:bg-surface2 hover:text-text',
  danger: 'bg-danger text-white hover:opacity-90',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' }) {
  const sizing = size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-2 text-sm';
  return (
    <button
      type="button"
      {...rest}
      className={`inline-flex items-center justify-center gap-1.5 rounded-token font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${sizing} ${variantClass[variant]} ${className}`}
    />
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function Card({ title, children, actions, className = '' }: {
  title?: ReactNode; children: ReactNode; actions?: ReactNode; className?: string;
}) {
  return (
    <section className={`panel p-4 ${className}`}>
      {(title || actions) && (
        <header className="mb-3 flex items-center justify-between gap-2">
          {title && <h2 className="text-sm font-semibold">{title}</h2>}
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}

export type BadgeTone = 'ok' | 'warn' | 'danger' | 'muted' | 'accent';
const toneClass: Record<BadgeTone, string> = {
  ok: 'bg-ok/15 text-ok',
  warn: 'bg-warn/15 text-warn',
  danger: 'bg-danger/15 text-danger',
  muted: 'bg-surface2 text-muted',
  accent: 'bg-accent/15 text-accent',
};

export function Badge({ tone = 'muted', children }: { tone?: BadgeTone; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ${toneClass[tone]}`}>{children}</span>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-token border border-dashed border-border p-6 text-center text-sm text-muted">{children}</p>;
}

export function ComingSoonBadge() {
  const t = useT();
  return <Badge tone="muted">{t('common.coming_soon')}</Badge>;
}

export function PageTitle({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions}
    </div>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <p role="alert" className="text-sm text-danger">{children}</p>;
}

export function Spinner({ label }: { label?: string }) {
  const t = useT();
  return <p className="p-6 text-center text-sm text-muted">{label ?? t('common.loading')}</p>;
}
