import { useEffect, useRef, useState } from 'react';
import type { ResourceRef } from './model';
import { listOwnPlaylists, type Library } from './qdn';
import { hasHomeBridge } from './qdnRequest';

const when = (entry: { updated?: number; created?: number }) => {
  const at = entry.updated ?? entry.created;
  return at ? new Date(at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '';
};

/** The selected Home account's published playlists, shown by default in Listen. */
export function PlaylistLibrary({ current, refreshKey, onOpen }: {
  current: ResourceRef | null;
  refreshKey: number;
  onOpen: (ref: ResourceRef) => void;
}) {
  const [library, setLibrary] = useState<Library | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'unavailable'>('idle');
  const [error, setError] = useState('');
  const pending = useRef<AbortController | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!hasHomeBridge()) { setState('unavailable'); return; }
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setState('loading'); setError('');
    listOwnPlaylists(controller.signal).then(next => {
      if (controller.signal.aborted) return;
      setLibrary(next); setState(next ? 'ready' : 'unavailable');
    }, e => {
      if (controller.signal.aborted) return;
      setError(e instanceof Error ? e.message : 'Could not list your playlists.'); setState('ready');
    });
    return () => controller.abort();
  }, [refreshKey, tick]);
  if (state === 'unavailable') return null;
  const key = (ref: ResourceRef) => `${ref.name}/${ref.identifier}`;
  return <section className="library" aria-label="Your playlists">
    <div className="section-heading"><span className="eyebrow">YOUR PLAYLISTS</span>
      <div className="library-heading"><h2>{library?.names.length ? `Published by ${library.names.join(', ')}` : 'Published by your account'}</h2><button className="subtle-button" disabled={state === 'loading'} onClick={() => setTick(t => t + 1)}>{state === 'loading' ? 'Refreshing…' : 'Refresh'}</button></div></div>
    {error && <p role="alert" className="notice">{error}</p>}
    {state === 'loading' && !library && <p className="hint" role="status">Looking up your playlists…</p>}
    {library && !library.names.length && <p className="hint">The selected account has no registered name yet. Register a name in Home to publish playlists.</p>}
    {library && library.names.length > 0 && !library.entries.length && !error && state === 'ready' && <p className="hint">No playlists published yet. Choose Create playlist to build one from an album folder.</p>}
    {library && library.entries.length > 0 && <ul className="library-list">{library.entries.map(entry => {
      const active = !!current && key(current) === key(entry.ref);
      return <li key={key(entry.ref)}><button className={active ? 'library-item selected' : 'library-item'} aria-current={active ? 'true' : undefined} onClick={() => onOpen(entry.ref)}>
        <span className="library-title">{entry.title}</span>
        <span className="library-meta">{entry.ref.name}{entry.tracks !== undefined && ` · ${entry.tracks} ${entry.tracks === 1 ? 'track' : 'tracks'}`}{when(entry) && ` · ${when(entry)}`}</span>
      </button></li>;
    })}</ul>}
  </section>;
}
