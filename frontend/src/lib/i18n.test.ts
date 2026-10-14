import { describe, expect, it } from 'vitest';
import { dictionaries, translate } from './i18n';

describe('i18n', () => {
  it('falls back to English for a missing key and to the key name for unknown keys', () => {
    expect(translate('uz', 'nav.admin')).toBe(dictionaries.uz['nav.admin']);
    expect(translate('ru', 'does.not.exist')).toBe('does.not.exist');
  });

  it('returns translated strings for each language', () => {
    expect(translate('en', 'top.undo')).toBe('Undo');
    expect(translate('ru', 'top.undo')).not.toBe('Undo');
    expect(translate('uz', 'top.undo')).not.toBe('Undo');
  });

  it('keeps Uzbek and Russian coverage of the shared app keys', () => {
    const keys = Object.keys(dictionaries.en).filter((k) => !k.startsWith('admin.'));
    const missingUz = keys.filter((k) => !(k in dictionaries.uz));
    const missingRu = keys.filter((k) => !(k in dictionaries.ru));
    expect(missingUz).toEqual([]);
    expect(missingRu).toEqual([]);
  });
});
