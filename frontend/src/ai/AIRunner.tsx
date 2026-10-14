import { useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { Button, ErrorText } from '../components/ui';
import { useT } from '../lib/i18n';
import { useAuthStore, type User } from '../store/auth';

/** Window event fired after any AI job starts or changes, so job lists can refresh. */
export const JOBS_CHANGED = 'zyvora:jobs-changed';

export interface AIJob {
  id: string;
  provider: string;
  task: string;
  status: 'running' | 'succeeded' | 'failed' | 'not_connected';
  cost_credits: number;
  charged_credits: number;
  error: string | null;
  result: Record<string, unknown>;
  created_at: string;
}

interface Estimate {
  cost_credits: number;
  balance: number;
  sufficient_balance: boolean;
  within_monthly_limit: boolean;
  provider_connected: boolean;
}

/**
 * Shows the cost BEFORE any expensive generation and requires explicit confirmation.
 * The job runs on the backend; if the provider key is missing the backend says "provider not connected".
 */
export function AIRunner({
  provider,
  task,
  units = 1,
  prompt,
  disabled,
  onJob,
  runLabel,
}: {
  provider: string;
  task: string;
  units?: number;
  prompt: string;
  disabled?: boolean;
  onJob?: (job: AIJob) => void;
  runLabel?: string;
}) {
  const t = useT();
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setEstimate(null);
    setConfirmed(false);
    api<Estimate>('/api/ai/estimate', { method: 'POST', body: { provider, task, units } })
      .then((e) => alive && setEstimate(e))
      .catch((e: unknown) => alive && setError(e instanceof ApiError ? e.message : t('common.error')));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, task, units]);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const job = await api<AIJob>('/api/ai/run', {
        method: 'POST',
        body: { provider, task, units, prompt, confirmed: true },
      });
      onJob?.(job);
      window.dispatchEvent(new Event(JOBS_CHANGED));
      void api<User>('/api/auth/me').then((u) => useAuthStore.getState().setUser(u)).catch(() => undefined);
      setConfirmed(false);
    } catch (e) {
      if (e instanceof ApiError && e.status === 503) {
        setError(t('ai.not_connected'));
      } else if (e instanceof ApiError && e.status === 402) {
        setError(e.message || t('ai.insufficient'));
      } else {
        setError(e instanceof ApiError ? e.message : t('common.error'));
      }
    } finally {
      setBusy(false);
    }
  };

  const canRun = !!estimate && estimate.provider_connected && confirmed && prompt.trim().length > 0 && !busy && !disabled;

  return (
    <div className="space-y-2 rounded-token border border-border bg-bg p-3 text-sm">
      {estimate ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          <span>{t('ai.estimate')}: <b className="text-text">{estimate.cost_credits} cr</b></span>
          <span>{t('top.credits')}: {estimate.balance}</span>
          {!estimate.provider_connected && <span className="text-warn">{t('ai.not_connected')}</span>}
          {!estimate.sufficient_balance && <span className="text-danger">{t('ai.insufficient')}</span>}
        </div>
      ) : (
        <p className="text-xs text-muted">{t('common.loading')}</p>
      )}
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)}
          disabled={!estimate?.provider_connected} />
        {t('ai.confirm_cost')}
      </label>
      <Button variant="primary" size="sm" disabled={!canRun} onClick={run}>
        {busy ? t('common.loading') : runLabel ?? t('ai.run')}
      </Button>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}
