import { useEffect, useLayoutEffect, useState } from 'react';

export type ThemePreference = 'system' | 'light' | 'dark';
export const THEME_KEY = 'music.theme';
const accents = ['neutral', 'clay', 'green', 'blue', 'orange', 'purple', 'red', 'teal', 'cyan', 'pink', 'yellow'] as const;
type Accent = typeof accents[number];
type DisplayWindow = Window & {
  _qdnContext?: unknown;
  _qdnAccent?: unknown;
  qdnAccent?: unknown;
  _qdnTheme?: unknown;
  qdnTheme?: unknown;
  qdnRequest?: unknown;
};

export function normalizePreference(value: unknown): ThemePreference {
  return value === 'light' || value === 'dark' ? value : 'system';
}
export function normalizeAccent(value: unknown): Accent | null {
  if (typeof value !== 'string') return null;
  const name = value.trim().toLowerCase();
  return accents.includes(name as Accent) ? name as Accent : null;
}
export function storedPreference(): ThemePreference {
  try { return normalizePreference(localStorage.getItem(THEME_KEY)); } catch { return 'system'; }
}
function acceptsHostAccent(): boolean {
  const host = window as DisplayWindow;
  // Core also injects display defaults and a read-only bridge on gateways. Those
  // defaults must not turn a standalone gateway into a Home-colored experience.
  return typeof host.qdnRequest === 'function' && host._qdnContext !== 'gateway' && host._qdnContext !== 'domainMap';
}
function acceptsHostTheme(): boolean {
  const host = window as DisplayWindow;
  return typeof host.qdnRequest === 'function' && host._qdnContext !== 'gateway' && host._qdnContext !== 'domainMap';
}
function hostTheme(): 'light' | 'dark' | null {
  if (!acceptsHostTheme()) return null;
  const query = new URLSearchParams(window.location.search);
  const value = query.get('theme') ?? query.get('qdnTheme') ?? (window as DisplayWindow)._qdnTheme ?? (window as DisplayWindow).qdnTheme;
  return value === 'light' || value === 'dark' ? value : null;
}
export function initialAccent(): Accent {
  if (!acceptsHostAccent()) return 'neutral';
  const host = window as DisplayWindow;
  const query = new URLSearchParams(window.location.search);
  return normalizeAccent(query.get('accent') ?? query.get('qdnAccent'))
    ?? normalizeAccent(host._qdnAccent ?? host.qdnAccent) ?? 'neutral';
}
function initialSystemDark(): boolean {
  const theme = hostTheme();
  return theme ? theme === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
}
function apply(preference: ThemePreference, darkSystem: boolean, accent: Accent) {
  const theme = preference === 'system' ? (darkSystem ? 'dark' : 'light') : preference;
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.themePreference = preference;
  document.documentElement.dataset.accent = accent;
  document.documentElement.style.colorScheme = theme;
}
export function initializeAppearance() {
  apply(storedPreference(), initialSystemDark(), initialAccent());
}
export function useAppearance() {
  const [preference, setPreferenceState] = useState(storedPreference);
  const [systemDark, setSystemDark] = useState(initialSystemDark);
  const [accent, setAccent] = useState(initialAccent);
  useLayoutEffect(() => apply(preference, systemDark, accent), [preference, systemDark, accent]);
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    let hostThemeActive = hostTheme() !== null;
    const update = () => { if (!hostThemeActive) setSystemDark(media.matches); };
    const storage = (event: StorageEvent) => { if (event.key === THEME_KEY || event.key === null) setPreferenceState(storedPreference()); };
    const message = (event: MessageEvent) => {
      if (!acceptsHostAccent() || (event.source && event.source !== window && event.source !== window.parent)) return;
      const value: unknown = event.data;
      if (!value || typeof value !== 'object') return;
      const data = value as Record<string, unknown>;
      if ('requestedHandler' in data && data.requestedHandler !== 'UI') return;
      if (data.action !== 'ACCENT_CHANGED' && data.action !== 'THEME_CHANGED' && data.action !== 'DISPLAY_SETTINGS_CHANGED') return;
      if (data.action === 'THEME_CHANGED' || data.action === 'DISPLAY_SETTINGS_CHANGED') {
        const theme = data.theme ?? data.qdnTheme;
        if (acceptsHostTheme() && (theme === 'light' || theme === 'dark')) {
          hostThemeActive = true;
          setSystemDark(theme === 'dark');
        }
      }
      if (data.action === 'ACCENT_CHANGED' || data.action === 'DISPLAY_SETTINGS_CHANGED') {
        const next = normalizeAccent(data.accent ?? data.qdnAccent);
        if (next) setAccent(next);
      }
    };
    update();
    media.addEventListener('change', update);
    window.addEventListener('storage', storage);
    window.addEventListener('message', message);
    return () => {
      media.removeEventListener('change', update);
      window.removeEventListener('storage', storage);
      window.removeEventListener('message', message);
    };
  }, []);
  const setPreference = (value: ThemePreference) => {
    setPreferenceState(value);
    try { localStorage.setItem(THEME_KEY, value); } catch { /* Still works for this visit. */ }
  };
  return { preference, setPreference };
}
