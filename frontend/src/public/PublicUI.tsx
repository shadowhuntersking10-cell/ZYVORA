import { useEffect, useId, useState, type ChangeEvent, type InputHTMLAttributes, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { usePrefsStore, type Lang } from '../store/prefs';
import { publicCopy, type PubDict } from './copy';
import { checkPassword, passwordStrength } from './password';

/** Copy for the current language. */
export function usePub(): PubDict {
  const lang = usePrefsStore((s) => s.lang);
  return publicCopy[lang];
}

export function useDocumentTitle(title: string): void {
  useEffect(() => {
    document.title = `${title} · ZYVORA`;
  }, [title]);
}

/** The ZYVORA mark: a blue-violet Z inside an orbit ring, plus the wordmark. */
export function ZyvoraLogo({ compact = false }: { compact?: boolean }) {
  const gid = useId().replace(/:/g, '');
  return (
    <span className="inline-flex items-center gap-2.5" aria-label="ZYVORA">
      <svg viewBox="0 0 64 64" width={compact ? 28 : 40} height={compact ? 28 : 40} aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id={`zg-${gid}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#4DA3FF" />
            <stop offset="1" stopColor="#8B6BFF" />
          </linearGradient>
        </defs>
        <ellipse cx="32" cy="32" rx="30" ry="11" transform="rotate(-18 32 32)" fill="none"
          stroke={`url(#zg-${gid})`} strokeWidth="2.5" opacity="0.9" />
        <path d="M14 12 H50 V21 L28 45 H50 V54 H14 V45 L36 21 H14 Z" fill={`url(#zg-${gid})`} />
      </svg>
      {!compact && (
        <span className="font-display text-lg font-bold tracking-[0.18em] bg-gradient-to-r from-zv-primary to-zv-accent bg-clip-text text-transparent">
          ZYVORA
        </span>
      )}
    </span>
  );
}

export function LangSwitch() {
  const lang = usePrefsStore((s) => s.lang);
  const setLang = usePrefsStore((s) => s.setLang);
  const t = usePub();
  const options: { id: Lang; label: string; full: string }[] = [
    { id: 'uz', label: 'UZ', full: 'O‘zbek' },
    { id: 'en', label: 'EN', full: 'English' },
    { id: 'ru', label: 'RU', full: 'Русский' },
  ];
  return (
    <div role="group" aria-label="Language" className="inline-flex rounded-xl border border-zv-border bg-zv-panel p-0.5 text-xs font-medium">
      {options.map((o) => (
        <button key={o.id} type="button" aria-pressed={lang === o.id} title={o.full}
          onClick={() => setLang(o.id)}
          className={`zv-focus rounded-lg px-2.5 py-1.5 transition-colors duration-150 ${lang === o.id ? 'bg-zv-primary text-zv-bg' : 'text-zv-muted hover:text-zv-text'}`}>
          {o.label}
        </button>
      ))}
      <span className="sr-only">{t.tagline}</span>
    </div>
  );
}

/** Full-screen dark background: animated blue-violet glow + faint grid. Pure CSS, no images. */
function Background() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 overflow-hidden bg-zv-bg">
      <div className="zv-anim-drift absolute -inset-[15%] zv-glow" />
      <div className="absolute inset-0 zv-grid opacity-70" />
    </div>
  );
}

export function PublicShell({ children, title, footer = true }: { children: ReactNode; title: string; footer?: boolean }) {
  const t = usePub();
  useDocumentTitle(title);
  return (
    <div className="relative flex min-h-full flex-col bg-zv-bg text-zv-text font-sans">
      <Background />
      <header className="relative z-10 flex items-center justify-between gap-3 px-4 py-4 sm:px-8">
        <Link to="/" className="zv-focus rounded-lg" aria-label={t.back_home}>
          <ZyvoraLogo />
        </Link>
        <div className="flex items-center gap-2 sm:gap-3">
          <LangSwitch />
        </div>
      </header>
      <main className="relative z-10 flex flex-1 flex-col">{children}</main>
      {footer && <PublicFooter />}
    </div>
  );
}

export function PublicFooter() {
  const t = usePub();
  return (
    <footer className="relative z-10 border-t border-zv-border/60 px-4 py-6 text-xs text-zv-muted sm:px-8">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
        <span>© {new Date().getFullYear()} ZYVORA. {t.footer_rights}</span>
        <nav className="flex items-center gap-4" aria-label="Legal">
          <Link className="zv-focus rounded hover:text-zv-text" to="/terms">{t.footer_terms}</Link>
          <Link className="zv-focus rounded hover:text-zv-text" to="/privacy">{t.footer_privacy}</Link>
        </nav>
      </div>
    </footer>
  );
}

/** Centered card used by every auth page. Max width 440px, 16px radius, 1px border. */
export function AuthCard({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <div className="zv-anim-rise w-full max-w-[440px] rounded-2xl border border-zv-border bg-zv-panel p-6 shadow-[0_24px_64px_-24px_rgba(0,0,0,.6)] sm:p-8">
      <h1 className="font-display text-2xl font-bold tracking-tight text-zv-text">{title}</h1>
      {sub && <p className="mt-2 text-sm leading-relaxed text-zv-muted">{sub}</p>}
      <div className="mt-6">{children}</div>
    </div>
  );
}

const inputBase =
  'zv-focus w-full rounded-xl border bg-zv-bg px-3.5 py-2.5 text-[15px] text-zv-text placeholder:text-zv-muted/60 transition-[border-color,box-shadow] duration-150 focus:border-zv-primary focus:shadow-glow-focus';

export function Field({ id, label, error, children, hint }: {
  id: string; label: string; error?: string | null; children: ReactNode; hint?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-zv-text">{label}</label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-xs text-zv-danger" role="alert">{error}</p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-zv-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export function TextInput({ id, error, className = '', ...rest }: InputHTMLAttributes<HTMLInputElement> & { id: string; error?: string | null }) {
  return (
    <input
      id={id}
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? `${id}-error` : undefined}
      className={`${inputBase} ${error ? 'border-zv-danger' : 'border-zv-border'} ${className}`}
      {...rest}
    />
  );
}

export function PasswordInput({ id, label, value, onChange, onBlur, error, autoComplete, showStrength = false, hint }: {
  id: string; label: string; value: string;
  onChange: (v: string) => void; onBlur?: () => void;
  error?: string | null; autoComplete: 'current-password' | 'new-password';
  showStrength?: boolean; hint?: string;
}) {
  const t = usePub();
  const [visible, setVisible] = useState(false);
  return (
    <Field id={id} label={label} error={error} hint={hint}>
      <div className="relative">
        <TextInput id={id} type={visible ? 'text' : 'password'} value={value} autoComplete={autoComplete}
          required minLength={8} error={error} className="pr-12"
          onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)} onBlur={onBlur} />
        <button type="button" onClick={() => setVisible((v) => !v)} aria-pressed={visible}
          aria-label={visible ? t.hide_password : t.show_password} title={visible ? t.hide_password : t.show_password}
          className="zv-focus absolute right-1.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg text-zv-muted transition-colors duration-150 hover:text-zv-text">
          <EyeIcon open={visible} />
        </button>
      </div>
      {showStrength && <StrengthMeter value={passwordStrength(value)} />}
    </Field>
  );
}

function EyeIcon({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
      {!open && <path d="M4 4l16 16" />}
    </svg>
  );
}

/** Four-step meter. Colors: danger for weak, primary and accent for strong. */
export function StrengthMeter({ value }: { value: 0 | 1 | 2 | 3 | 4 }) {
  const t = usePub();
  const labels = [t.strength_0, t.strength_1, t.strength_2, t.strength_3, t.strength_4];
  const color = value <= 1 ? 'bg-zv-danger' : value === 2 ? 'bg-zv-accent/70' : 'bg-gradient-to-r from-zv-primary to-zv-accent';
  return (
    <div className="space-y-1.5 pt-1" aria-live="polite">
      <div className="flex gap-1.5" role="meter" aria-label={t.strength_label} aria-valuemin={0} aria-valuemax={4} aria-valuenow={value}
        aria-valuetext={labels[value]}>
        {[1, 2, 3, 4].map((step) => (
          <span key={step} className={`h-1.5 flex-1 rounded-full transition-colors duration-200 ${value >= step ? color : 'bg-zv-border'}`} />
        ))}
      </div>
      <p className="text-xs text-zv-muted">{t.strength_label}: <span className="text-zv-text">{labels[value]}</span></p>
    </div>
  );
}

/** Live rules list. Each rule turns from muted to primary when met. */
export function PasswordRules({ value }: { value: string }) {
  const t = usePub();
  const c = checkPassword(value);
  const items: [boolean, string][] = [[c.length, t.rule_len], [c.caseMix, t.rule_case], [c.digit, t.rule_digit]];
  return (
    <div className="rounded-xl border border-zv-border bg-zv-bg/60 p-3">
      <p className="mb-2 text-xs font-medium text-zv-muted">{t.rules_title}</p>
      <ul className="space-y-1.5 text-xs">
        {items.map(([ok, text]) => (
          <li key={text} className={`flex items-center gap-2 transition-colors duration-150 ${ok ? 'text-zv-primary' : 'text-zv-muted'}`}>
            <span aria-hidden="true" className={`grid h-4 w-4 place-items-center rounded-full border text-[10px] ${ok ? 'border-zv-primary bg-zv-primary/20' : 'border-zv-border'}`}>{ok ? '✓' : ''}</span>
            {text}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Checkbox({ id, checked, onChange, children, error }: {
  id: string; checked: boolean; onChange: (v: boolean) => void; children: ReactNode; error?: string | null;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="flex cursor-pointer items-start gap-2.5 text-sm text-zv-muted">
        <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)}
          aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-error` : undefined}
          className="zv-focus mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-[#4DA3FF]" />
        <span>{children}</span>
      </label>
      {error && <p id={`${id}-error`} role="alert" className="text-xs text-zv-danger">{error}</p>}
    </div>
  );
}

export function PrimaryButton({ loading = false, disabled, children, type = 'submit', onClick, className = '' }: {
  loading?: boolean; disabled?: boolean; children: ReactNode; type?: 'submit' | 'button'; onClick?: () => void; className?: string;
}) {
  return (
    <button type={type} onClick={onClick} disabled={disabled || loading} aria-busy={loading || undefined}
      className={`zv-focus inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-zv-primary to-zv-accent px-4 py-3 text-[15px] font-semibold text-zv-bg shadow-glow transition duration-200 hover:brightness-110 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none ${className}`}>
      {loading && <span aria-hidden="true" className="zv-anim-spin h-4 w-4 rounded-full border-2 border-zv-bg/30 border-t-zv-bg" />}
      {children}
    </button>
  );
}

export function SecondaryLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="zv-focus inline-flex w-full items-center justify-center rounded-xl border border-zv-border px-4 py-3 text-[15px] font-medium text-zv-text transition-colors duration-150 hover:border-zv-primary hover:text-zv-primary">
      {children}
    </Link>
  );
}

export function Banner({ tone = 'error', children }: { tone?: 'error' | 'info' | 'success'; children: ReactNode }) {
  const style = tone === 'error'
    ? 'border-zv-danger/50 bg-zv-danger/10 text-zv-danger'
    : tone === 'success'
      ? 'border-zv-ok/40 bg-zv-ok/10 text-zv-ok'
      : 'border-zv-primary/40 bg-zv-primary/10 text-zv-primary';
  return <div role={tone === 'error' ? 'alert' : 'status'} className={`zv-anim-rise rounded-xl border px-3.5 py-2.5 text-sm ${style}`}>{children}</div>;
}

/** Decorative split-screen brand panel (desktop only). */
export function BrandPanel() {
  const t = usePub();
  return (
    <aside className="relative hidden flex-1 flex-col justify-center overflow-hidden px-10 py-12 lg:flex xl:px-16" aria-label="ZYVORA">
      <div className="absolute inset-y-0 left-0 w-3 opacity-40" aria-hidden="true"
        style={{ background: 'repeating-linear-gradient(to bottom, transparent 0 14px, rgba(154,164,199,.25) 14px 22px)' }} />
      <div className="absolute inset-y-0 right-0 w-3 opacity-40" aria-hidden="true"
        style={{ background: 'repeating-linear-gradient(to bottom, transparent 0 14px, rgba(154,164,199,.25) 14px 22px)' }} />
      <div className="relative max-w-xl space-y-8">
        <ZyvoraLogo />
        <h2 className="font-display text-4xl font-bold leading-tight tracking-tight text-zv-text xl:text-5xl">{t.headline}</h2>
        <ul className="space-y-3">
          {t.features.map((f) => (
            <li key={f} className="flex items-start gap-3 text-[15px] text-zv-muted">
              <span aria-hidden="true" className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-gradient-to-r from-zv-primary to-zv-accent" />
              {f}
            </li>
          ))}
        </ul>
        <TimelineMock caption={t.preview_caption} />
      </div>
    </aside>
  );
}

/** CSS-only illustration of a timeline. It is an illustration, not a product screenshot. */
export function TimelineMock({ caption }: { caption: string }) {
  const tracks: { name: string; keys: number[] }[] = [
    { name: 'Camera', keys: [12, 44, 78] },
    { name: 'Character', keys: [8, 30, 60, 88] },
    { name: 'Light', keys: [24, 70] },
  ];
  return (
    <figure className="space-y-2" role="img" aria-label={caption}>
      <div className="relative overflow-hidden rounded-2xl border border-zv-border bg-zv-bg/80 p-3">
        <div className="mb-2 h-4 border-b border-zv-border/70" aria-hidden="true"
          style={{ backgroundImage: 'repeating-linear-gradient(90deg, rgba(154,164,199,.35) 0 1px, transparent 1px 10%)' }} />
        <div className="space-y-2.5">
          {tracks.map((tr) => (
            <div key={tr.name} className="flex items-center gap-3">
              <span className="w-20 shrink-0 text-[11px] text-zv-muted">{tr.name}</span>
              <div className="relative h-6 flex-1 rounded-md bg-zv-panel/80">
                {tr.keys.map((k) => (
                  <span key={k} aria-hidden="true" className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[2px] bg-gradient-to-br from-zv-primary to-zv-accent" style={{ left: `${k}%` }} />
                ))}
              </div>
            </div>
          ))}
        </div>
        <span aria-hidden="true" className="zv-anim-playhead absolute bottom-2 top-2 w-px bg-zv-primary shadow-[0_0_12px_#4DA3FF]" />
      </div>
      <figcaption className="text-[11px] text-zv-muted/80">{caption}</figcaption>
    </figure>
  );
}

/** Split layout used by Register and Login: brand panel (55%) + form (45%). */
export function SplitAuth({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      <div className="flex flex-1 lg:basis-[55%]"><BrandPanel /></div>
      <div className="flex flex-1 items-center justify-center px-4 py-8 sm:px-8 lg:basis-[45%] lg:py-12">
        {children}
      </div>
    </div>
  );
}
