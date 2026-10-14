import { useState, type FormEvent, type ReactElement } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../../lib/api';
import { useT } from '../../lib/i18n';
import { Button, ErrorText, Field } from '../../components/ui';
import { useAuthStore, type User } from '../../store/auth';

function AuthLayout({ title, children }: { title: string; children: React.ReactNode }) {
  const t = useT();
  return (
    <div className="grid min-h-full place-items-center bg-bg p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <span className="mx-auto grid h-10 w-10 place-items-center rounded-token bg-accent text-base font-bold text-accent-contrast">Z</span>
          <h1 className="mt-3 text-lg font-semibold">{title}</h1>
          <p className="mt-1 text-xs text-muted">{t('auth.tagline')}</p>
        </div>
        <div className="panel space-y-4 p-5">{children}</div>
      </div>
    </div>
  );
}

function errorMessage(e: unknown, fallback: string): string {
  if (e instanceof ApiError) return e.message;
  return fallback;
}

export function LoginPage(): ReactElement {
  const t = useT();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ access_token: string; user: User }>('/api/auth/login', {
        method: 'POST', body: { email, password }, auth: false,
      });
      useAuthStore.getState().setSession(res.access_token, res.user);
      navigate('/app/dashboard');
    } catch (err) {
      setError(errorMessage(err, t('common.error')));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout title={t('auth.login')}>
      <form onSubmit={submit} className="space-y-3" noValidate>
        <Field label={t('auth.email')}>
          <input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label={t('auth.password')}>
          <input className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <ErrorText>{error}</ErrorText>
        <Button type="submit" variant="primary" className="w-full" disabled={busy}>{t('auth.submit_login')}</Button>
      </form>
      <div className="flex justify-between text-xs">
        <Link className="text-accent hover:underline" to="/forgot-password">{t('auth.forgot')}</Link>
        <Link className="text-accent hover:underline" to="/register">{t('auth.no_account')}</Link>
      </div>
    </AuthLayout>
  );
}

export function RegisterPage(): ReactElement {
  const t = useT();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const reg = await api<{ verification_required: boolean }>('/api/auth/register', {
        method: 'POST', body: { name, email, password }, auth: false,
      });
      if (reg.verification_required) {
        setInfo(t('auth.verify_required'));
        return;
      }
      const res = await api<{ access_token: string; user: User }>('/api/auth/login', {
        method: 'POST', body: { email, password }, auth: false,
      });
      useAuthStore.getState().setSession(res.access_token, res.user);
      navigate('/app/dashboard');
    } catch (err) {
      setError(errorMessage(err, t('common.error')));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout title={t('auth.register')}>
      <form onSubmit={submit} className="space-y-3" noValidate>
        <Field label={t('auth.name')} >
          <input className="input" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t('auth.email')}>
          <input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label={t('auth.password')} hint="10+ characters, letters and digits.">
          <input className="input" type="password" autoComplete="new-password" required minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <ErrorText>{error}</ErrorText>
        {info && <p className="text-sm text-muted">{info}</p>}
        <Button type="submit" variant="primary" className="w-full" disabled={busy}>{t('auth.submit_register')}</Button>
      </form>
      <p className="text-center text-xs"><Link className="text-accent hover:underline" to="/login">{t('auth.have_account')}</Link></p>
    </AuthLayout>
  );
}

export function VerifyEmailPage(): ReactElement {
  const t = useT();
  const [params] = useSearchParams();
  const [state, setState] = useState<'idle' | 'ok' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const token = params.get('token') ?? '';
  const verify = async () => {
    try {
      await api('/api/auth/verify-email', { method: 'POST', body: { token }, auth: false });
      setState('ok');
    } catch (e) {
      setError(errorMessage(e, t('common.error')));
      setState('error');
    }
  };
  return (
    <AuthLayout title={t('auth.verify_title')}>
      {state === 'idle' && <Button variant="primary" onClick={verify} disabled={!token} className="w-full">{t('common.confirm')}</Button>}
      {state === 'ok' && <p className="text-sm text-ok">✓ {t('common.working')}</p>}
      <ErrorText>{error}</ErrorText>
      <Link className="block text-center text-xs text-accent hover:underline" to="/login">{t('auth.login')}</Link>
    </AuthLayout>
  );
}

export function ForgotPasswordPage(): ReactElement {
  const t = useT();
  const [email, setEmail] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const res = await api<{ email_delivery: 'sent' | 'not_connected' }>('/api/auth/forgot', {
        method: 'POST', body: { email }, auth: false,
      });
      setDone(res.email_delivery === 'sent' ? t('auth.reset_sent') : t('auth.email_not_connected'));
    } catch (err) {
      setError(errorMessage(err, t('common.error')));
    }
  };
  return (
    <AuthLayout title={t('auth.reset_title')}>
      {done ? <p className="text-sm text-muted">{done}</p> : (
        <form onSubmit={submit} className="space-y-3">
          <Field label={t('auth.email')}>
            <input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <ErrorText>{error}</ErrorText>
          <Button type="submit" variant="primary" className="w-full">{t('common.confirm')}</Button>
        </form>
      )}
      <Link className="block text-center text-xs text-accent hover:underline" to="/login">{t('auth.login')}</Link>
    </AuthLayout>
  );
}

export function ResetPasswordPage(): ReactElement {
  const t = useT();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const token = params.get('token') ?? '';
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await api('/api/auth/reset-password', { method: 'POST', body: { token, password }, auth: false });
      navigate('/login');
    } catch (err) {
      setError(errorMessage(err, t('common.error')));
    }
  };
  return (
    <AuthLayout title={t('auth.reset_title')}>
      <form onSubmit={submit} className="space-y-3">
        <Field label={t('settings.new_password')}>
          <input className="input" type="password" minLength={10} required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <ErrorText>{error}</ErrorText>
        <Button type="submit" variant="primary" className="w-full" disabled={!token}>{t('common.confirm')}</Button>
      </form>
    </AuthLayout>
  );
}
