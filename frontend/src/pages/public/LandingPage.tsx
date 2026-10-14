import { useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { PublicShell, PrimaryButton, TimelineMock, usePub, ZyvoraLogo } from '../../public/PublicUI';
import { useAuthStore } from '../../store/auth';
import { usePrefsStore } from '../../store/prefs';

type Status = 'available' | 'partial' | 'soon';

const STUDIOS: { key: 'studio_2d' | 'studio_3d' | 'studio_char' | 'studio_anim' | 'studio_cine' | 'studio_ai'; tile: string; status: Status }[] = [
  { key: 'studio_2d', tile: '2D', status: 'soon' },
  { key: 'studio_3d', tile: '3D', status: 'available' },
  { key: 'studio_char', tile: 'CH', status: 'soon' },
  { key: 'studio_anim', tile: 'AN', status: 'soon' },
  { key: 'studio_cine', tile: 'CI', status: 'soon' },
  { key: 'studio_ai', tile: 'AI', status: 'partial' },
];

/** Hero intro: plays /intro.mp4 if the file is provided; otherwise shows the animated gradient. */
function IntroFrame() {
  const t = usePub();
  const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const [videoFailed, setVideoFailed] = useState(false);
  const [skipped, setSkipped] = useState(false);
  const showVideo = !videoFailed && !skipped;
  return (
    <div className="relative mx-auto w-full max-w-4xl overflow-hidden rounded-2xl border border-zv-border bg-zv-panel shadow-[0_32px_80px_-32px_rgba(77,163,255,.35)]">
      <div className="relative aspect-video w-full">
        {showVideo && (
          <video
            className="absolute inset-0 h-full w-full object-cover"
            src="/intro.mp4"
            muted
            playsInline
            loop
            autoPlay={!reduce}
            preload="metadata"
            aria-label={t.headline}
            onError={() => setVideoFailed(true)}
          />
        )}
        {!showVideo && (
          <div className="absolute inset-0 zv-glow">
            <div className="flex h-full items-center justify-center p-6 sm:p-10">
              <div className="w-full max-w-2xl">
                <TimelineMock caption={t.preview_caption} />
              </div>
            </div>
          </div>
        )}
      </div>
      {showVideo && (
        <button type="button" onClick={() => setSkipped(true)}
          className="zv-focus absolute bottom-3 right-3 rounded-lg border border-zv-border bg-zv-bg/80 px-3 py-1.5 text-xs font-medium text-zv-text backdrop-blur-sm hover:border-zv-primary">
          {t.intro_skip}
        </button>
      )}
      {skipped && !videoFailed && (
        <button type="button" onClick={() => setSkipped(false)}
          className="zv-focus absolute bottom-3 right-3 rounded-lg border border-zv-border bg-zv-bg/80 px-3 py-1.5 text-xs font-medium text-zv-text hover:border-zv-primary">
          {t.intro_show}
        </button>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: Status }) {
  const t = usePub();
  const map: Record<Status, { text: string; cls: string }> = {
    available: { text: t.status_available, cls: 'border-zv-ok/40 bg-zv-ok/10 text-zv-ok' },
    partial: { text: t.status_partial, cls: 'border-zv-primary/40 bg-zv-primary/10 text-zv-primary' },
    soon: { text: t.status_soon, cls: 'border-zv-border bg-zv-bg text-zv-muted' },
  };
  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${map[status].cls}`}>{map[status].text}</span>;
}

export function LandingPage(): ReactElement {
  const t = usePub();
  const user = useAuthStore((s) => s.user);
  const lang = usePrefsStore((s) => s.lang);
  const ctaTarget = user ? '/app/dashboard' : '/register';
  return (
    <PublicShell title={t.tagline}>
      {/* Hero */}
      <section className="mx-auto w-full max-w-6xl px-4 pb-14 pt-10 text-center sm:px-8 sm:pt-16" lang={lang}>
        <div className="zv-anim-rise mx-auto flex justify-center">
          <ZyvoraLogo />
        </div>
        <p className="zv-anim-rise mt-6 text-xs font-medium uppercase tracking-[0.2em] text-zv-primary">{t.tagline}</p>
        <h1 className="zv-anim-rise mx-auto mt-4 max-w-3xl font-display text-4xl font-bold leading-[1.1] tracking-tight text-zv-text sm:text-5xl lg:text-6xl">
          {t.headline}
        </h1>
        <p className="zv-anim-rise mx-auto mt-5 max-w-2xl text-base leading-relaxed text-zv-muted sm:text-lg">{t.subline}</p>
        <div className="zv-anim-rise mx-auto mt-8 flex max-w-md flex-col items-stretch justify-center gap-3 sm:max-w-none sm:flex-row sm:items-center">
          <Link to={ctaTarget} className="zv-focus rounded-xl sm:min-w-[200px]">
            <PrimaryButton type="button">{t.cta_start}</PrimaryButton>
          </Link>
          <Link to="/login" className="zv-focus inline-flex items-center justify-center rounded-xl border border-zv-border px-5 py-3 text-[15px] font-semibold text-zv-text transition-colors duration-150 hover:border-zv-primary hover:text-zv-primary sm:min-w-[160px]">
            {t.cta_login}
          </Link>
        </div>
        <div className="mt-12">
          <IntroFrame />
        </div>
      </section>

      {/* Studios */}
      <section className="mx-auto w-full max-w-6xl px-4 pb-16 sm:px-8" aria-labelledby="studios-title">
        <div className="mx-auto mb-8 max-w-2xl text-center">
          <h2 id="studios-title" className="font-display text-2xl font-bold tracking-tight text-zv-text sm:text-3xl">{t.studios_title}</h2>
          <p className="mt-3 text-sm text-zv-muted sm:text-base">{t.studios_sub}</p>
        </div>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {STUDIOS.map((s) => (
            <li key={s.key} className="group rounded-2xl border border-zv-border bg-zv-panel p-5 transition-[border-color,transform] duration-200 hover:-translate-y-0.5 hover:border-zv-primary/60">
              <div className="flex items-start justify-between gap-3">
                <span className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-zv-primary/30 to-zv-accent/40 font-display text-sm font-bold text-zv-text" aria-hidden="true">{s.tile}</span>
                <StatusBadge status={s.status} />
              </div>
              <h3 className="mt-4 font-display text-lg font-semibold text-zv-text">{t[s.key]}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-zv-muted">{t[`${s.key}_desc` as const]}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* Final call to action */}
      <section className="mx-auto w-full max-w-4xl px-4 pb-16 sm:px-8">
        <div className="relative overflow-hidden rounded-2xl border border-zv-border bg-zv-panel p-8 text-center sm:p-12">
          <div aria-hidden="true" className="absolute inset-0 zv-glow opacity-70" />
          <div className="relative">
            <h2 className="font-display text-2xl font-bold tracking-tight text-zv-text sm:text-3xl">{t.final_title}</h2>
            <p className="mx-auto mt-3 max-w-xl text-sm text-zv-muted sm:text-base">{t.final_sub}</p>
            <div className="mx-auto mt-6 max-w-xs">
              <Link to={ctaTarget} className="zv-focus block rounded-xl"><PrimaryButton type="button">{t.cta_start}</PrimaryButton></Link>
            </div>
          </div>
        </div>
      </section>
    </PublicShell>
  );
}
