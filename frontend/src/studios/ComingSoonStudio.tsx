import { ComingSoonBadge } from '../components/ui';
import { useT } from '../lib/i18n';

/** Shown for studios that are planned but not built. Disabled on purpose, never a fake editor. */
export function ComingSoonCenter({ title }: { title: string }) {
  const t = useT();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <ComingSoonBadge />
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="max-w-md text-sm text-muted">{t('studio.coming_desc')}</p>
    </div>
  );
}
