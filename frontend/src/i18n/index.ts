import { computed, ref, type ComputedRef, type Ref } from 'vue';
import en from './locales/en.json';
import id from './locales/id.json';

export type LocaleCode = 'id' | 'en';

type Dict = typeof id;
type MessageTree = Dict | string;

const catalogs: Record<LocaleCode, Dict> = { id, en };

const STORAGE_KEY = 'bonpos.locale';

function detectInitialLocale(): LocaleCode {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'id' || stored === 'en') {
    return stored;
  }
  return navigator.language.toLowerCase().startsWith('en') ? 'en' : 'id';
}

export const locale: Ref<LocaleCode> = ref(detectInitialLocale());

function lookup(tree: MessageTree, path: string): string | undefined {
  const parts = path.split('.');
  let cur: unknown = tree;
  for (const part of parts) {
    if (!cur || typeof cur !== 'object') {
      return undefined;
    }
    cur = (cur as Record<string, unknown>)[part];
  }
  return typeof cur === 'string' ? cur : undefined;
}

export type TParams = Record<string, string | number>;

/** Translate by dotted key; falls back to English then the key itself. */
export function t(key: string, params?: TParams): string {
  const primary = lookup(catalogs[locale.value], key);
  const fallback = locale.value === 'en' ? undefined : lookup(catalogs.en, key);
  let text = primary ?? fallback ?? key;
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      text = text.replaceAll(`{${name}}`, String(value));
    }
  }
  return text;
}

export function setLocale(next: LocaleCode): void {
  locale.value = next;
  localStorage.setItem(STORAGE_KEY, next);
}

export function useI18n(): {
  locale: Ref<LocaleCode>;
  t: typeof t;
  setLocale: typeof setLocale;
  /** Reactive wrapper for template bindings that need a ComputedRef. */
  tm: (key: string, params?: TParams) => ComputedRef<string>;
} {
  return {
    locale,
    t,
    setLocale,
    tm: (key, params) => computed(() => t(key, params)),
  };
}
