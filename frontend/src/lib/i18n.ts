/** Minimal UI-language runtime (DECISIONS §16 i18n 政策).
 *
 * A plain `t()` importable from anywhere — including pure label maps outside
 * React — with `useT()` re-rendering subscribed components on switch. No
 * context (label maps in format.ts / SidePanel / relations are called from
 * non-component code), no third-party i18n dependency.
 *
 * Rules:
 * - zh dict is the source of truth; en must implement the same key set
 *   (a missing en key is a compile error, enforced by dict.en's type).
 * - Only chrome strings are keyed. User content (titles, summaries, tags,
 *   evidence, details_md) and API enums/error codes pass through untouched.
 * - First init (synchronous, before first render): stored rm.lang →
 *   browser language probe (zh if it starts with "zh") → "en". Subsequent
 *   choice is persisted in rm.lang. Playwright pins locale zh-CN so the
 *   zh-selector E2E suite always sees Chinese.
 */

import { useSyncExternalStore } from "react";
import { zh } from "./dict.zh";
import { en } from "./dict.en";

export type Lang = "zh" | "en";

const DICTS: Record<Lang, Record<string, string>> = { zh, en };
const LANG_KEY = "rm.lang";

function detectInitialLang(): Lang {
  try {
    const stored = localStorage.getItem(LANG_KEY);
    if (stored === "zh" || stored === "en") return stored;
  } catch {
    /* ignore */
  }
  try {
    return typeof navigator !== "undefined" && navigator.language?.toLowerCase().startsWith("zh")
      ? "zh"
      : "en";
  } catch {
    return "en";
  }
}

let current: Lang = detectInitialLang();
const subscribers = new Set<() => void>();

function syncDocumentLang(): void {
  try {
    document.documentElement.lang = current === "zh" ? "zh-CN" : "en";
  } catch {
    /* not in a browser (unit tests) */
  }
}
syncDocumentLang();

export function getLang(): Lang {
  return current;
}

export function setLang(l: Lang): void {
  if (l === current) return;
  current = l;
  try {
    localStorage.setItem(LANG_KEY, l);
  } catch {
    /* ignore */
  }
  syncDocumentLang();
  for (const fn of subscribers) fn();
}

function subscribe(fn: () => void): () => void {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

/** Translate `key`; missing keys fall back to zh, then to the key itself. */
export function t(key: string, params?: Record<string, string | number>): string {
  let out = DICTS[current][key] ?? DICTS.zh[key] ?? key;
  if (params) {
    out = out.replace(/\{(\w+)\}/g, (m, k: string) =>
      k in params ? String(params[k]) : m,
    );
  }
  return out;
}

/** React binding: subscribes the component to language changes so a switch
 *  re-renders immediately, without reloading the page. */
export function useT(): typeof t {
  useSyncExternalStore(subscribe, getLang);
  return t;
}
