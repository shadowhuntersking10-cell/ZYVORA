import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactElement } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../../lib/api';
import { fill } from '../../public/copy';
import {
  AuthCard, Banner, Checkbox, Field, PasswordInput, PasswordRules, PrimaryButton, PublicShell,
  SecondaryLink, SplitAuth, TextInput, usePub,
} from '../../public/PublicUI';
import { isValidEmail, isValidPassword } from '../../public/password';
import { useAuthStore, type User } from '../../store/auth';
import type { PubDict } from '../../public/copy';

/* ------------------------------------------------------------------ helpers */

type Pending = { email: string };

/** Turns an API error into a translated, user-facing message. Server text is never shown raw. */
function authErrorMessage(e: unknown, t: PubDict, context: 'login' | 'register' | 'token' | 'generic'): string {
  if (!(e instanceof ApiError)) return t.err_network;
  if (e.status === 0 || e.status >= 500) return t.err_generic;
  if (e.status === 409 && context === 'register') return t.err_email_taken;
  if (e.status === 401) return t.err_bad_credentials;
  if (e.status === 403) {
    if (/not verified/i.test(e.message)) return t.err_unverified;
    if (/blocked/i.test(e.message)) return t.err_blocked;
  }
  if (e.status === 400 && context === 'token') return t.err_reset_invalid;
  return t.err_generic;
}

/** Only in-app paths may be used as a post-login destination (prevents open redirects). */
function safeNext(from: unknown): string {
  return typeof from === 'string' && from.startsWith('/app/') && !from.startsWith('//') ? from : '/app/dashboard';
}

export async function loginRequest(email: string, password: string, remember: boolean): Promise<User> {
  const res = await api<{ access_token: string; user: User }>('/api/auth/login', {
    method: 'POST', body: { email, password, remember }, auth: false,
  });
  useAuthStore.getState().setSession(res.access_token, res.user);
  return res.user;
}

/* ------------------------------------------------------------------ register */

export function RegisterPage(): ReactElement {
  const t = usePub();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [terms, setTerms] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitted, setSubmitted] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const errors = useMemo(() => ({
    name: name.trim().length === 0 ? t.err_name : null,
    email: isValidEmail(email) ? null : t.err_email,
    password: isValidPassword(password) ? null : t.err_password,
    confirm: confirm.length > 0 && confirm === password ? null : t.err_confirm,
    terms: terms ? null : t.err_terms,
  }), [name, email, password, confirm, terms, t]);

  const hasErrors = Object.values(errors).some(Boolean);
  const show = (field: keyof typeof errors) => (touched[field] || submitted) ? errors[field] : null;
  const touch = (field: string) => setTouched((s) => ({ ...s, [field]: true }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    setServerError(null);
    if (hasErrors || busy) return;
    setBusy(true);
    try {
      const reg = await api<{ verification_required: boolean; email_delivery: 'sent' | 'not_connected' }>(
        '/api/auth/register', { method: 'POST', body: { name: name.trim(), email: email.trim(), password }, auth: false },
      );
      if (reg.verification_required) {
        // Never send the user back to the form after success.
        navigate('/check-email', { replace: true, state: { email: email.trim(), delivery: reg.email_delivery } as Pending & { delivery: string } });
        return;
      }
      await loginRequest(email.trim(), password, true);
      navigate('/app/dashboard', { replace: true });
    } catch (err) {
      setServerError(authErrorMessage(err, t, 'register'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <PublicShell title={t.register_title} footer={false}>
      <SplitAuth>
        <AuthCard title={t.register_title} sub={t.register_sub}>
          <form onSubmit={submit} noValidate className="space-y-4" aria-label={t.register_title}>
            <Field id="reg-name" label={t.f_name} error={show('name')}>
              <TextInput id="reg-name" name="name" autoComplete="name" required maxLength={120} value={name}
                error={show('name')} onChange={(e) => setName(e.target.value)} onBlur={() => touch('name')} />
            </Field>
            <Field id="reg-email" label={t.f_email} error={show('email')}>
              <TextInput id="reg-email" name="email" type="email" autoComplete="email" inputMode="email" required
                value={email} error={show('email')} onChange={(e) => setEmail(e.target.value)} onBlur={() => touch('email')} />
            </Field>
            <PasswordInput id="reg-password" label={t.f_password} value={password} autoComplete="new-password"
              error={show('password')} showStrength
              onChange={setPassword} onBlur={() => touch('password')} />
            <PasswordRules value={password} />
            <PasswordInput id="reg-confirm" label={t.f_confirm} value={confirm} autoComplete="new-password"
              error={show('confirm')} onChange={setConfirm} onBlur={() => touch('confirm')} />
            <Checkbox id="reg-terms" checked={terms} onChange={setTerms} error={submitted ? errors.terms : null}>
              {t.f_terms}
            </Checkbox>
            {serverError && <Banner>{serverError}{serverError === t.err_email_taken && (
              <> <Link className="zv-focus underline" to="/login">{t.login_link}</Link> · <Link className="zv-focus underline" to="/forgot-password">{t.forgot_link}</Link></>
            )}</Banner>}
            <PrimaryButton loading={busy} disabled={hasErrors}>{t.submit_register}</PrimaryButton>
          </form>
          <p className="mt-6 text-center text-sm text-zv-muted">
            {t.have_account}{' '}
            <Link className="zv-focus rounded font-medium text-zv-primary hover:underline" to="/login">{t.login_link}</Link>
          </p>
        </AuthCard>
      </SplitAuth>
    </PublicShell>
  );
}

/* ------------------------------------------------------------------ login */

export function LoginPage(): ReactElement {
  const t = usePub();
  const navigate = useNavigate();
  const location = useLocation();
  const user = useAuthStore((s) => s.user);
  const ready = useAuthStore((s) => s.ready);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unverified, setUnverified] = useState(false);
  const [busy, setBusy] = useState(false);
  const from = (location.state as { from?: string } | null)?.from;

  if (ready && user) return <Navigate to={safeNext(from)} replace />;

  const canSubmit = isValidEmail(email) && password.length > 0;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit || busy) return;
    setBusy(true);
    setError(null);
    setUnverified(false);
    try {
      await loginRequest(email.trim(), password, remember);
      navigate(safeNext(from), { replace: true });
    } catch (err) {
      const msg = authErrorMessage(err, t, 'login');
      setError(msg);
      setUnverified(msg === t.err_unverified);
    } finally {
      setBusy(false);
    }
  };

  return (
    <PublicShell title={t.login_title} footer={false}>
      <SplitAuth>
        <AuthCard title={t.login_title} sub={t.login_sub}>
          <form onSubmit={submit} noValidate className="space-y-4" aria-label={t.login_title}>
            <Field id="login-email" label={t.f_email}>
              <TextInput id="login-email" name="email" type="email" autoComplete="email" inputMode="email" required
                value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <PasswordInput id="login-password" label={t.f_password} value={password} autoComplete="current-password"
              onChange={setPassword} />
            <div className="flex items-center justify-between gap-3">
              <Checkbox id="login-remember" checked={remember} onChange={setRemember}>{t.f_remember}</Checkbox>
              <Link to="/forgot-password" className="zv-focus shrink-0 rounded text-sm font-medium text-zv-primary hover:underline">
                {t.forgot_link}
              </Link>
            </div>
            {error && (
              <Banner>
                {error}
                {unverified && (
                  <> <Link className="zv-focus underline" to="/check-email" state={{ email: email.trim() }}>{t.err_unverified_link}</Link></>
                )}
              </Banner>
            )}
            <PrimaryButton loading={busy} disabled={!canSubmit}>{t.submit_login}</PrimaryButton>
          </form>
          <p className="mt-6 text-center text-sm text-zv-muted">
            {t.no_account}{' '}
            <Link className="zv-focus rounded font-medium text-zv-primary hover:underline" to="/register">{t.create_link}</Link>
          </p>
        </AuthCard>
      </SplitAuth>
    </PublicShell>
  );
}

/* ------------------------------------------------------------------ check email */

const COOLDOWN_SECONDS = 60;

export function CheckEmailPage(): ReactElement {
  const t = usePub();
  const location = useLocation();
  const state = (location.state ?? {}) as { email?: string; delivery?: string };
  const email = state.email ?? '';
  const [cooldown, setCooldown] = useState(email ? COOLDOWN_SECONDS : 0);
  const [notice, setNotice] = useState<{ tone: 'info' | 'success'; text: string } | null>(
    state.delivery === 'not_connected' ? { tone: 'info', text: t.resend_not_connected } : null,
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  const resend = async () => {
    if (!email || cooldown > 0 || busy) return;
    setBusy(true);
    try {
      const res = await api<{ email_delivery: 'sent' | 'not_connected' }>('/api/auth/resend-verification', {
        method: 'POST', body: { email }, auth: false,
      });
      setNotice(res.email_delivery === 'sent'
        ? { tone: 'success', text: t.resend_sent }
        : { tone: 'info', text: t.resend_not_connected });
    } catch {
      setNotice({ tone: 'info', text: t.err_network });
    } finally {
      setBusy(false);
      setCooldown(COOLDOWN_SECONDS);
    }
  };

  return (
    <PublicShell title={t.check_title} footer={false}>
      <div className="flex flex-1 items-center justify-center px-4 py-10">
        <AuthCard title={t.check_title} sub={email ? fill(t.check_sub, { email }) : t.check_sub_none}>
          <div className="mb-6 flex justify-center">
            <span className="zv-anim-pop grid h-16 w-16 place-items-center rounded-2xl border border-zv-border bg-zv-bg text-zv-primary" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
                <rect x="3" y="5" width="18" height="14" rx="2" />
                <path d="M3.5 6.5 12 13l8.5-6.5" />
              </svg>
            </span>
          </div>
          {notice && <div className="mb-4"><Banner tone={notice.tone}>{notice.text}</Banner></div>}
          <div className="space-y-3">
            {email && (
              <PrimaryButton type="button" onClick={resend} loading={busy} disabled={cooldown > 0}>
                {cooldown > 0 ? fill(t.resend_in, { s: cooldown }) : t.resend}
              </PrimaryButton>
            )}
            <SecondaryLink to={email ? '/register' : '/login'}>{email ? t.change_email : t.login_link}</SecondaryLink>
          </div>
        </AuthCard>
      </div>
    </PublicShell>
  );
}

/* ------------------------------------------------------------------ verify email */

// Module-level cache: React StrictMode runs effects twice; the one-time token must be consumed once.
const verifyCalls = new Map<string, Promise<void>>();

export function VerifyEmailPage(): ReactElement {
  const t = usePub();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') ?? '';
  const [state, setState] = useState<'checking' | 'ok' | 'fail'>(token ? 'checking' : 'fail');

  useEffect(() => {
    if (!token) return;
    let call = verifyCalls.get(token);
    if (!call) {
      call = api('/api/auth/verify-email', { method: 'POST', body: { token }, auth: false }).then(() => undefined);
      verifyCalls.set(token, call);
    }
    let alive = true;
    call.then(() => alive && setState('ok')).catch(() => alive && setState('fail'));
    return () => {
      alive = false;
    };
  }, [token]);

  return (
    <PublicShell title={t.verify_title} footer={false}>
      <div className="flex flex-1 items-center justify-center px-4 py-10">
        <AuthCard title={state === 'ok' ? t.verify_ok_title : state === 'fail' ? t.verify_fail_title : t.verify_title}
          sub={state === 'ok' ? t.verify_ok_sub : state === 'fail' ? t.verify_fail_sub : t.verify_sub}>
          <div className="flex justify-center py-2" aria-live="polite">
            {state === 'checking' && <span className="zv-anim-spin h-10 w-10 rounded-full border-[3px] border-zv-border border-t-zv-primary" aria-label={t.verifying} />}
            {state === 'ok' && (
              <svg viewBox="0 0 64 64" width="72" height="72" aria-hidden="true" className="zv-anim-pop">
                <circle cx="32" cy="32" r="30" fill="none" stroke="#4DA3FF" strokeWidth="2" opacity=".4" />
                <path d="M19 33 L28 42 L46 23" fill="none" stroke="url(#vg)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" className="zv-anim-draw" />
                <defs>
                  <linearGradient id="vg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#4DA3FF" /><stop offset="1" stopColor="#8B6BFF" /></linearGradient>
                </defs>
              </svg>
            )}
            {state === 'fail' && <Banner>{t.err_verify_invalid}</Banner>}
          </div>
          <div className="mt-6 space-y-3">
            {state === 'ok' && <PrimaryButton type="button" onClick={() => navigate('/app/dashboard')}>{t.to_dashboard}</PrimaryButton>}
            {state === 'fail' && <SecondaryLink to="/login">{t.login_link}</SecondaryLink>}
          </div>
        </AuthCard>
      </div>
    </PublicShell>
  );
}

/* ------------------------------------------------------------------ forgot password */

export function ForgotPasswordPage(): ReactElement {
  const t = usePub();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<'sent' | 'not_connected' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!isValidEmail(email) || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ email_delivery: 'sent' | 'not_connected' }>('/api/auth/forgot', {
        method: 'POST', body: { email: email.trim() }, auth: false,
      });
      setDone(res.email_delivery);
    } catch (err) {
      setError(authErrorMessage(err, t, 'generic'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <PublicShell title={t.forgot_title} footer={false}>
      <div className="flex flex-1 items-center justify-center px-4 py-10">
        {done ? (
          <AuthCard title={t.forgot_done_title} sub={t.forgot_done_sub}>
            {done === 'not_connected' && <Banner tone="info">{t.forgot_not_connected}</Banner>}
            <div className="mt-6"><SecondaryLink to="/login">{t.login_link}</SecondaryLink></div>
          </AuthCard>
        ) : (
          <AuthCard title={t.forgot_title} sub={t.forgot_sub}>
            <form onSubmit={submit} noValidate className="space-y-4" aria-label={t.forgot_title}>
              <Field id="forgot-email" label={t.f_email} error={email && !isValidEmail(email) ? t.err_email : null}>
                <TextInput id="forgot-email" name="email" type="email" autoComplete="email" inputMode="email" required
                  value={email} error={email && !isValidEmail(email) ? t.err_email : null}
                  onChange={(e) => setEmail(e.target.value)} />
              </Field>
              {error && <Banner>{error}</Banner>}
              <PrimaryButton loading={busy} disabled={!isValidEmail(email)}>{t.forgot_submit}</PrimaryButton>
            </form>
            <p className="mt-6 text-center text-sm">
              <Link className="zv-focus rounded font-medium text-zv-primary hover:underline" to="/login">{t.login_link}</Link>
            </p>
          </AuthCard>
        )}
      </div>
    </PublicShell>
  );
}

/* ------------------------------------------------------------------ reset password */

export function ResetPasswordPage(): ReactElement {
  const t = usePub();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<'form' | 'done' | 'fail'>(token ? 'form' : 'fail');
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);

  const pwError = touched && !isValidPassword(password) ? t.err_password : null;
  const confirmError = touched && confirm !== password ? t.err_confirm : null;
  const canSubmit = isValidPassword(password) && confirm === password && !!token;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!canSubmit || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      await api('/api/auth/reset-password', { method: 'POST', body: { token, password }, auth: false });
      setState('done');
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) setState('fail');
      else setError(authErrorMessage(err, t, 'generic'));
    } finally {
      setBusy(false);
      submitting.current = false;
    }
  };

  if (state === 'done') {
    return (
      <PublicShell title={t.reset_done_title} footer={false}>
        <div className="flex flex-1 items-center justify-center px-4 py-10">
          <AuthCard title={t.reset_done_title} sub={t.reset_done_sub}>
            <PrimaryButton type="button" onClick={() => navigate('/login')}>{t.login_link}</PrimaryButton>
          </AuthCard>
        </div>
      </PublicShell>
    );
  }
  if (state === 'fail') {
    return (
      <PublicShell title={t.reset_fail_title} footer={false}>
        <div className="flex flex-1 items-center justify-center px-4 py-10">
          <AuthCard title={t.reset_fail_title} sub={t.reset_fail_sub}>
            <Banner>{t.err_reset_invalid}</Banner>
            <div className="mt-6"><SecondaryLink to="/forgot-password">{t.request_new}</SecondaryLink></div>
          </AuthCard>
        </div>
      </PublicShell>
    );
  }
  return (
    <PublicShell title={t.reset_title} footer={false}>
      <div className="flex flex-1 items-center justify-center px-4 py-10">
        <AuthCard title={t.reset_title} sub={t.reset_sub}>
          <form onSubmit={submit} noValidate className="space-y-4" aria-label={t.reset_title}>
            <PasswordInput id="reset-password" label={t.new_password} value={password} autoComplete="new-password"
              error={pwError} showStrength onChange={setPassword} />
            <PasswordRules value={password} />
            <PasswordInput id="reset-confirm" label={t.f_confirm} value={confirm} autoComplete="new-password"
              error={confirmError} onChange={setConfirm} />
            {error && <Banner>{error}</Banner>}
            <PrimaryButton loading={busy} disabled={!canSubmit}>{t.reset_submit}</PrimaryButton>
          </form>
        </AuthCard>
      </div>
    </PublicShell>
  );
}

/* ------------------------------------------------------------------ legal placeholders */

export function LegalPage({ kind }: { kind: 'terms' | 'privacy' }): ReactElement {
  const t = usePub();
  const title = kind === 'terms' ? t.terms_title : t.privacy_title;
  return (
    <PublicShell title={title}>
      <div className="mx-auto w-full max-w-2xl px-4 py-12">
        <h1 className="font-display text-3xl font-bold">{title}</h1>
        <p className="mt-4 text-sm leading-relaxed text-zv-muted">{t.legal_pending}</p>
        <Link to="/" className="zv-focus mt-8 inline-block rounded text-sm font-medium text-zv-primary hover:underline">{t.back_home}</Link>
      </div>
    </PublicShell>
  );
}

