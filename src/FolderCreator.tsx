import { useRef, useState } from 'react';
import type { InputHTMLAttributes } from 'react';
import type { Playlist, ResourceClient } from './model';
import { importFolder, type ImportedAlbum } from './folderImport';
import { forPublisher, planFolder, previewFolder, type FolderPlan } from './folderPlan';
import { getPublishContext, publishPlaylist, uploadResource, STAGED_FILE_MAX_BYTES } from './qdn';
import { hasHomeBridge } from './qdnRequest';
import './editor.css';
import './folder.css';

const folderInput = { webkitdirectory: '', directory: '' } as InputHTMLAttributes<HTMLInputElement>;
const message = (e: unknown) => e instanceof Error ? e.message : String(e);
const size = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
export function FolderCreator({ onPreview, onPublished }: {
  onPreview: (playlist: Playlist, client: ResourceClient, cleanup: () => void) => void;
  onPublished: (playlist: Playlist) => void;
}) {
  const [album, setAlbum] = useState<ImportedAlbum | null>(null);
  const [plan, setPlan] = useState<FolderPlan | null>(null);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [context, setContext] = useState<Awaited<ReturnType<typeof getPublishContext>> | null>(null);
  const [name, setName] = useState(''), [progress, setProgress] = useState(''), [done, setDone] = useState(0);
  const [published, setPublished] = useState(false);
  const completed = useRef(new Set<string>()), paused = useRef(false), frozen = useRef<FolderPlan | null>(null);
  async function choose(files: File[]) {
    if (!files.length || busy) return;
    setBusy(true); setError('');
    try {
      const imported = await importFolder(files);
      const nextPlan = await planFolder(imported);
      setAlbum(imported); setPlan(nextPlan); setTitle(imported.title); setPublished(false);
      completed.current.clear(); frozen.current = null; setDone(0); setProgress('');
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  async function connect() {
    setBusy(true); setError('');
    try { const next = await getPublishContext(); if (!next.names.length) throw new Error('Select a Home account with a registered name first.'); setContext(next); setName(next.names[0]); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  async function publish() {
    if (!plan || !context || !name || busy) return;
    setBusy(true); setError(''); paused.current = false;
    try {
      const target = frozen.current ?? forPublisher(plan, name, title);
      frozen.current = target;
      for (const item of target.files) {
        if (completed.current.has(item.ref.identifier)) continue;
        if (paused.current) { setProgress('Paused. Your completed uploads are kept for this session.'); return; }
        setProgress(`${completed.current.size + 1} of ${target.files.length}: ${item.path}${item.file.size > STAGED_FILE_MAX_BYTES ? ' — select this file in Home’s picker' : ''}`);
        try { await uploadResource(item.ref.service, name, item.ref.identifier, context.address, item.file); }
        catch (e) { if (!(e && typeof e === 'object' && 'recovered' in e && e.recovered === true)) throw e; }
        completed.current.add(item.ref.identifier); setDone(completed.current.size);
      }
      if (paused.current) { setProgress('Files uploaded. Resume to publish the playlist.'); return; }
      setProgress('All files are ready. Publishing your playlist…');
      const result = await publishPlaylist(target.playlist, name, target.identifier, context.address) as { ready?: boolean };
      if (!result.ready) throw new Error('The playlist was accepted and is awaiting confirmation. Resume to check it; do not start a new upload.');
      setPublished(true); setProgress(`Published: PLAYLIST/${name}/${target.identifier}`);
    } catch (e) {
      if (e && typeof e === 'object' && 'recovered' in e && e.recovered === true && completed.current.size === plan.files.length) {
        setPublished(true); setProgress(`Published: PLAYLIST/${name}/${plan.identifier}`);
      } else setError(message(e));
    } finally { setBusy(false); }
  }
  function preview() {
    if (!plan) return;
    const local = previewFolder(plan);
    onPreview({ ...plan.playlist, title: title.trim() || plan.playlist.title }, local.client, local.cleanup);
  }
  return <section className="folder-creator" aria-label="Build a playlist from a folder">
    <div className="editor-heading"><span className="eyebrow">CREATE A PLAYLIST</span><h2>Start with an album folder</h2><p>Choose your files. QuixMix pairs the songs, videos, covers and subtitles for you.</p></div>
    <div className="editor-card folder-start">
      <label className="folder-picker">{album ? 'Choose another folder' : 'Choose album folder'}<input aria-label="Choose album folder" type="file" {...folderInput} multiple disabled={busy} onChange={e => { void choose(Array.from(e.target.files ?? [])); e.target.value = ''; }}/></label>
      <p className="hint">Files stay on your device until you choose Publish. Select one album folder, not your entire music library.</p>
      <details><summary>How files are matched</summary><p>Use matching names such as <code>01 - Artist - Song.mp3</code>, <code>.mp4</code>, <code>.jpg</code> and <code>.srt</code>. Leading numbers set the order. For different edits, use <code>.audio.en.srt</code> and <code>.video.en.srt</code>. Commentary uses <code>.commentary.srt</code> or <code>.commentary.vtt</code>.</p><p>A <code>quixmix-import.json</code> file can specify exact pairings for existing folders. Subtitle timestamps stay unchanged; SRT is converted to WebVTT for playback. Switching versions restarts the song unless the import map declares matching edits.</p></details>
    </div>
    {album && plan && <>
      <div className="editor-card"><label>Album title<input value={title} disabled={busy || !!frozen.current} onChange={e => setTitle(e.target.value)}/></label><p>{album.tracks.length} tracks · {plan.files.length} files · {size(plan.files.reduce((sum, item) => sum + item.file.size, 0))}</p>
        <div className="folder-actions"><button className="primary" disabled={busy} onClick={preview}>Preview album</button><span className="hint">Listen and check the pairings before publishing.</span></div>
      </div>
      <ol className="folder-track-list">{album.tracks.map(track => <li key={track.id}><details><summary><span className="folder-number">{String(track.number).padStart(2, '0')}</span><span className="folder-track-title"><strong>{track.title}</strong><small>{track.artist}</small></span><span className="folder-badges">{track.audio && 'Audio '}{track.video && 'Video '}{track.cover && 'Cover '}{(track.audioLyrics || track.videoLyrics) && 'Lyrics'}</span></summary><dl>{(['audio', 'video', 'cover', 'audioLyrics', 'videoLyrics', 'audioCommentary', 'videoCommentary'] as const).map(role => track[role] && <div key={role}><dt>{{audio:'Audio',video:'Video',cover:'Cover',audioLyrics:'Audio lyrics',videoLyrics:'Video lyrics',audioCommentary:'Audio commentary',videoCommentary:'Video commentary'}[role]}</dt><dd>{track[role]!.path}</dd></div>)}</dl></details></li>)}</ol>
      {!!album.warnings.length && <div className="notice">{album.warnings.map((warning, i) => <p key={i}>{warning}</p>)}</div>}
      {!!album.ignored.length && <details className="open-playlist"><summary>{album.ignored.length} files left out</summary><ul>{album.ignored.slice(0, 100).map(path => <li key={path}>{path}</li>)}</ul>{album.ignored.length > 100 && <p>Showing the first 100.</p>}</details>}
      <div className="editor-card folder-publish"><h3>Publish your album</h3><p>QuixMix uploads each selected file, waits for it to be readable, then publishes the playlist. Home asks you to approve publication.</p>
        {!hasHomeBridge() ? <p className="hint">Open QuixMix in Home to publish. You can import and preview here.</p> : !context ? <button disabled={busy} onClick={() => void connect()}>Connect Home account</button> : <>
          <label>Publish under<select value={name} disabled={busy || !!frozen.current} onChange={e => setName(e.target.value)}>{context.names.map(n => <option key={n}>{n}</option>)}</select></label>
          <p className="hint">Files over 25 MiB currently use Home’s picker. Keep this page open while uploading; pause stops after the current file.</p>
          <div className="folder-actions"><button className="primary" disabled={busy || published} onClick={() => void publish()}>{published ? 'Published' : frozen.current ? 'Resume publishing' : 'Publish album'}</button>{busy && <button onClick={() => { paused.current = true; setProgress('Pausing after the current file…'); }}>Pause after this file</button>}{published && <button onClick={() => frozen.current && onPublished(frozen.current.playlist)}>Play published album</button>}</div>
          {!!frozen.current && <progress max={plan.files.length} value={done} aria-label="Files published"/>}
        </>}
        {progress && <p role="status" className="folder-progress">{progress}</p>}
      </div>
    </>}
    {busy && !progress && <p role="status">Preparing…</p>}
    {error && <p role="alert" className="notice">{error}</p>}
  </section>;
}
