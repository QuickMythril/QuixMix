import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import type {
  MediaKind,
  MediaVersion,
  Playlist,
  ResourceRef,
  ResourceService,
  TextRef,
  Track,
} from './model';
import { parsePlaylist, parseVtt } from './schema';
import { getPublishContext, publishPlaylist, uploadResource } from './qdn';
import './editor.css';

const DRAFT_KEY = 'qortium-music:playlist-editor-draft:v1';
const MAX_MANIFEST_BYTES = 1024 * 1024;

type PublishContext = Awaited<ReturnType<typeof getPublishContext>>;
type WorkState = { state: 'working' | 'success' | 'error'; message: string };

export interface PlaylistEditorProps {
  playlist: Playlist;
  onLoad: (playlist: Playlist) => void;
}

function clonePlaylist(playlist: Playlist): Playlist {
  return JSON.parse(JSON.stringify(playlist)) as Playlist;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function resourceFromReadinessError(error: unknown, service: ResourceService): ResourceRef | null {
  if (!error || typeof error !== 'object' || !('ref' in error)) return null;
  const ref = (error as { ref?: unknown }).ref;
  if (!ref || typeof ref !== 'object') return null;
  const candidate = ref as Partial<ResourceRef>;
  if (
    candidate.service !== service ||
    typeof candidate.name !== 'string' ||
    typeof candidate.identifier !== 'string'
  ) return null;
  return { service, name: candidate.name, identifier: candidate.identifier };
}

function optionalNumber(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function makeId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `track-${crypto.randomUUID()}`;
  }
  return `track-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function blankResource(service: ResourceService, name = ''): ResourceRef {
  return { service, name, identifier: '' };
}

function blankText(name = ''): TextRef {
  return { service: 'FILE', name, identifier: '', format: 'vtt' };
}

function blankVersion(kind: MediaKind, name = ''): MediaVersion {
  return { resource: blankResource(kind === 'audio' ? 'AUDIO' : 'VIDEO', name) };
}

function blankTrack(index: number, name = ''): Track {
  return {
    id: makeId(),
    title: `Track ${index + 1}`,
    artist: '',
    defaultVersion: 'audio',
    switchPolicy: 'restart',
    versions: { audio: blankVersion('audio', name) },
  };
}

function looksLikeEditablePlaylist(value: unknown): value is Playlist {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<Playlist>;
  const isResource = (resource: unknown, service: ResourceService): resource is ResourceRef => {
    if (!resource || typeof resource !== 'object') return false;
    const item = resource as Partial<ResourceRef>;
    return (
      item.service === service &&
      typeof item.name === 'string' &&
      typeof item.identifier === 'string' &&
      (item.path === undefined || typeof item.path === 'string')
    );
  };
  const isText = (text: unknown): text is TextRef => {
    if (!isResource(text, 'FILE')) return false;
    const item = text as Partial<TextRef>;
    return (
      item.format === 'vtt' &&
      (item.language === undefined || typeof item.language === 'string') &&
      (item.offsetMs === undefined || typeof item.offsetMs === 'number')
    );
  };
  const isVersion = (version: unknown, kind: MediaKind): version is MediaVersion => {
    if (!version || typeof version !== 'object') return false;
    const item = version as Partial<MediaVersion>;
    return (
      isResource(item.resource, kind === 'audio' ? 'AUDIO' : 'VIDEO') &&
      (item.timelineOffsetMs === undefined || typeof item.timelineOffsetMs === 'number') &&
      (item.lyrics === undefined || item.lyrics === null || isText(item.lyrics)) &&
      (item.commentary === undefined || item.commentary === null || isText(item.commentary))
    );
  };
  return (
    candidate.kind === 'qortium-music-playlist' &&
    candidate.schemaVersion === 1 &&
    typeof candidate.title === 'string' &&
    Array.isArray(candidate.tracks) &&
    candidate.tracks.every(
      (track) =>
        track &&
        typeof track === 'object' &&
        typeof track.id === 'string' &&
        typeof track.title === 'string' &&
        typeof track.artist === 'string' &&
        (track.defaultVersion === 'audio' || track.defaultVersion === 'video') &&
        (track.switchPolicy === 'aligned' || track.switchPolicy === 'restart') &&
        track.versions &&
        typeof track.versions === 'object' &&
        (track.versions.audio === undefined || isVersion(track.versions.audio, 'audio')) &&
        (track.versions.video === undefined || isVersion(track.versions.video, 'video')) &&
        (track.cover === undefined || isResource(track.cover, 'IMAGE')) &&
        (track.lyrics === undefined || isText(track.lyrics)) &&
        (track.commentary === undefined || isText(track.commentary)),
    )
  );
}

function readDraft(): Playlist | null {
  try {
    const stored = localStorage.getItem(DRAFT_KEY);
    if (!stored) return null;
    const parsed: unknown = JSON.parse(stored);
    return looksLikeEditablePlaylist(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

interface ResourceFieldsProps {
  legend: string;
  resource: ResourceRef;
  allowPath?: boolean;
  onChange: (resource: ResourceRef) => void;
  upload?: {
    label: string;
    state?: WorkState;
    onChoose: () => void;
    disabled?: boolean;
  };
}

function ResourceFields({ legend, resource, allowPath, onChange, upload }: ResourceFieldsProps) {
  function update(patch: Partial<ResourceRef>) {
    const next = { ...resource, ...patch };
    if (!allowPath || !next.path?.trim()) delete next.path;
    onChange(next);
  }

  return (
    <fieldset className="editor-resource">
      <legend>{legend}</legend>
      <div className="editor-fields editor-fields--resource">
        <label>
          <span>Service</span>
          <input value={resource.service} readOnly aria-readonly="true" />
        </label>
        <label>
          <span>Publisher name</span>
          <input
            value={resource.name}
            onChange={(event) => update({ name: event.target.value })}
            placeholder="Registered QDN name"
          />
        </label>
        <label>
          <span>Identifier</span>
          <input
            value={resource.identifier}
            onChange={(event) => update({ identifier: event.target.value })}
            placeholder="song-or-file-identifier"
          />
        </label>
        {allowPath ? (
          <label>
            <span>Relative file path (optional)</span>
            <input
              value={resource.path ?? ''}
              onChange={(event) => update({ path: event.target.value })}
              placeholder="album/song.mp3"
            />
          </label>
        ) : null}
      </div>
      {upload ? (
        <div className="editor-upload-row">
          <button
            type="button"
            className="editor-button editor-button--quiet"
            onClick={upload.onChoose}
            disabled={upload.disabled || upload.state?.state === 'working'}
          >
            {upload.state?.state === 'working' ? 'Uploading…' : upload.label}
          </button>
          {upload.state ? (
            <span className={`editor-inline-status editor-inline-status--${upload.state.state}`} role="status">
              {upload.state.message}
            </span>
          ) : null}
        </div>
      ) : null}
    </fieldset>
  );
}

interface TextFieldsProps {
  label: string;
  value: TextRef;
  onChange: (value: TextRef) => void;
  upload?: {
    state?: WorkState;
    onFile: (file: File) => void;
    disabled?: boolean;
  };
}

function TextFields({ label, value, onChange, upload }: TextFieldsProps) {
  function update(patch: Partial<TextRef>) {
    onChange({ ...value, ...patch, service: 'FILE', format: 'vtt' });
  }

  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) upload?.onFile(file);
    event.target.value = '';
  }

  return (
    <fieldset className="editor-resource editor-resource--text">
      <legend>{label}</legend>
      <div className="editor-fields editor-fields--resource">
        <label>
          <span>Publisher name</span>
          <input value={value.name} onChange={(event) => update({ name: event.target.value })} />
        </label>
        <label>
          <span>FILE identifier</span>
          <input
            value={value.identifier}
            onChange={(event) => update({ identifier: event.target.value })}
            placeholder="track-lyrics-en"
          />
        </label>
        <label>
          <span>Language (optional)</span>
          <input
            value={value.language ?? ''}
            onChange={(event) => update({ language: event.target.value || undefined })}
            placeholder="en"
          />
        </label>
        <label>
          <span>Text offset (ms)</span>
          <input
            type="number"
            step="1"
            value={value.offsetMs ?? ''}
            onChange={(event) => update({ offsetMs: optionalNumber(event.target.value) })}
            placeholder="0"
          />
        </label>
      </div>
      <p className="editor-help">Plain WebVTT cues and line breaks are supported. Cue settings, STYLE/REGION blocks, and markup are rejected before upload.</p>
      {upload ? (
        <div className="editor-upload-row">
          <label className="editor-file-button">
            <span>{upload.state?.state === 'working' ? 'Uploading…' : 'Upload local WebVTT'}</span>
            <input
              type="file"
              accept=".vtt,text/vtt,text/plain"
              onChange={chooseFile}
              disabled={upload.disabled || upload.state?.state === 'working'}
            />
          </label>
          {upload.state ? (
            <span className={`editor-inline-status editor-inline-status--${upload.state.state}`} role="status">
              {upload.state.message}
            </span>
          ) : null}
        </div>
      ) : null}
    </fieldset>
  );
}

interface OverrideFieldsProps {
  label: string;
  value: TextRef | null | undefined;
  inherited: TextRef | undefined;
  name: string;
  onChange: (value: TextRef | null | undefined) => void;
  upload?: TextFieldsProps['upload'];
}

function OverrideFields({ label, value, inherited, name, onChange, upload }: OverrideFieldsProps) {
  const mode = value === null ? 'disabled' : value ? 'custom' : 'inherit';
  return (
    <div className="editor-override">
      <label>
        <span>{label}</span>
        <select
          value={mode}
          onChange={(event) => {
            if (event.target.value === 'disabled') onChange(null);
            else if (event.target.value === 'custom') onChange(blankText(name));
            else onChange(undefined);
          }}
        >
          <option value="inherit">Inherit track setting</option>
          <option value="custom">Use another WebVTT</option>
          <option value="disabled">Disable for this version</option>
        </select>
      </label>
      {mode === 'inherit' ? (
        <p className="editor-help">{inherited ? `Uses ${inherited.name}/${inherited.identifier}.` : 'No track-level text is set.'}</p>
      ) : null}
      {value && mode === 'custom' ? (
        <TextFields label={`${label} override`} value={value} onChange={onChange} upload={upload} />
      ) : null}
    </div>
  );
}

export function PlaylistEditor({ playlist, onLoad }: PlaylistEditorProps) {
  const initialRef = useRef<{ draft: Playlist; recovered: boolean } | null>(null);
  if (!initialRef.current) {
    const stored = readDraft();
    initialRef.current = { draft: clonePlaylist(stored ?? playlist), recovered: Boolean(stored) };
  }

  const [draft, setDraft] = useState<Playlist>(initialRef.current.draft);
  const [recovered, setRecovered] = useState(initialRef.current.recovered);
  const [validationError, setValidationError] = useState('');
  const [jsonInput, setJsonInput] = useState(() => JSON.stringify(initialRef.current?.draft ?? playlist, null, 2));
  const [context, setContext] = useState<PublishContext | null>(null);
  const [contextChecked, setContextChecked] = useState(false);
  const [selectedName, setSelectedName] = useState('');
  const [playlistIdentifier, setPlaylistIdentifier] = useState('qortium-music-playlist');
  const [work, setWork] = useState<Record<string, WorkState>>({});
  const uploadsPending = Object.entries(work).some(
    ([key, value]) => key !== 'playlist' && value.state === 'working',
  );

  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      // Private browsing or a full quota should not make the editor unusable.
    }
  }, [draft]);

  useEffect(() => {
    let active = true;
    getPublishContext()
      .then((nextContext) => {
        if (!active) return;
        setContext(nextContext);
        setSelectedName((current) => current || nextContext.names[0] || '');
      })
      .catch(() => {
        if (active) setContext(null);
      })
      .finally(() => {
        if (active) setContextChecked(true);
      });
    return () => {
      active = false;
    };
  }, []);

  function updateTrack(index: number, next: Track) {
    setDraft((current) => ({
      ...current,
      tracks: current.tracks.map((track, trackIndex) => (trackIndex === index ? next : track)),
    }));
    setValidationError('');
  }

  function patchTrack(index: number, patch: (track: Track) => Track) {
    setDraft((current) => ({
      ...current,
      tracks: current.tracks.map((track, trackIndex) => (trackIndex === index ? patch(track) : track)),
    }));
    setValidationError('');
  }

  function patchTrackById(id: string, patch: (track: Track) => Track) {
    setDraft((current) => ({
      ...current,
      tracks: current.tracks.map((track) => (track.id === id ? patch(track) : track)),
    }));
    setValidationError('');
  }

  function updateVersion(
    trackIndex: number,
    kind: MediaKind,
    change: MediaVersion | undefined | ((current: MediaVersion | undefined) => MediaVersion | undefined),
  ) {
    patchTrack(trackIndex, (track) => {
      const next = typeof change === 'function' ? change(track.versions[kind]) : change;
      const versions = { ...track.versions, [kind]: next };
      if (!next) delete versions[kind];
      const remaining = (['audio', 'video'] as const).filter((candidate) => versions[candidate]);
      return {
        ...track,
        versions,
        defaultVersion: remaining.includes(track.defaultVersion) ? track.defaultVersion : remaining[0] ?? track.defaultVersion,
      };
    });
  }

  function updateVersionByTrackId(
    trackId: string,
    kind: MediaKind,
    change: (current: MediaVersion | undefined) => MediaVersion | undefined,
  ) {
    patchTrackById(trackId, (track) => {
      const next = change(track.versions[kind]);
      const versions = { ...track.versions, [kind]: next };
      if (!next) delete versions[kind];
      return { ...track, versions };
    });
  }

  function toggleVersion(trackIndex: number, kind: MediaKind, enabled: boolean) {
    const track = draft.tracks[trackIndex];
    updateVersion(trackIndex, kind, enabled ? blankVersion(kind, selectedName) : undefined);
  }

  function moveTrack(index: number, direction: -1 | 1) {
    const destination = index + direction;
    if (destination < 0 || destination >= draft.tracks.length) return;
    setDraft((current) => {
      const tracks = [...current.tracks];
      [tracks[index], tracks[destination]] = [tracks[destination], tracks[index]];
      return { ...current, tracks };
    });
  }

  function removeTrack(index: number) {
    setDraft((current) => ({ ...current, tracks: current.tracks.filter((_, trackIndex) => trackIndex !== index) }));
  }

  function validateDraft(): Playlist | null {
    try {
      const valid = parsePlaylist(draft);
      setValidationError('');
      return valid;
    } catch (error) {
      setValidationError(errorMessage(error));
      return null;
    }
  }

  function loadDraftIntoPlayer() {
    const valid = validateDraft();
    if (valid) onLoad(valid);
  }

  function importJson(source: string) {
    try {
      const valid = parsePlaylist(JSON.parse(source) as unknown);
      setDraft(clonePlaylist(valid));
      setJsonInput(JSON.stringify(valid, null, 2));
      setValidationError('');
      setRecovered(false);
      onLoad(valid);
    } catch (error) {
      setValidationError(`Import failed: ${errorMessage(error)}`);
    }
  }

  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    try {
      if (file && file.size > MAX_MANIFEST_BYTES) {
        throw new Error(`playlist must be at most ${MAX_MANIFEST_BYTES} UTF-8 bytes`);
      }
      if (file) importJson(await file.text());
    } catch (error) {
      setValidationError(`Import failed: ${errorMessage(error)}`);
    }
    event.target.value = '';
  }

  function exportJson() {
    const valid = validateDraft();
    if (!valid) return;
    const blob = new Blob([`${JSON.stringify(valid, null, 2)}\n`], { type: 'application/json' });
    const href = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = href;
    link.download = `${valid.title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'playlist'}.json`;
    link.click();
    URL.revokeObjectURL(href);
  }

  function setWorkState(key: string, state: WorkState) {
    setWork((current) => ({ ...current, [key]: state }));
  }

  async function upload(
    key: string,
    service: ResourceService,
    identifier: string,
    onSuccess: (resource: ResourceRef) => void,
    file?: File,
    targetTrackId?: string,
  ) {
    if (!context || !selectedName) return;
    if (!identifier.trim()) {
      setWorkState(key, { state: 'error', message: 'Enter an identifier first.' });
      return;
    }
    if (targetTrackId && draft.tracks.filter((track) => track.id === targetTrackId).length !== 1) {
      setWorkState(key, { state: 'error', message: 'Give this track a unique entry ID before uploading.' });
      return;
    }
    if (new TextEncoder().encode(identifier).length > 64) {
      setWorkState(key, { state: 'error', message: 'Identifier exceeds 64 UTF-8 bytes.' });
      return;
    }
    setWorkState(key, { state: 'working', message: 'Waiting for Home approval and QDN confirmation…' });
    try {
      if (service === 'FILE' && file) parseVtt(await file.text());
      const resource = await uploadResource(service, selectedName, identifier, context.address, file);
      onSuccess(resource);
      setWorkState(key, { state: 'success', message: 'Upload accepted. The resource reference is saved in this draft.' });
    } catch (error) {
      const accepted = resourceFromReadinessError(error, service);
      if (accepted) onSuccess(accepted);
      setWorkState(key, { state: 'error', message: `Draft preserved. ${errorMessage(error)}` });
    }
  }

  async function publish() {
    if (!context || !selectedName) return;
    if (uploadsPending) {
      setWorkState('playlist', { state: 'error', message: 'Wait for the current resource upload to finish.' });
      return;
    }
    const valid = validateDraft();
    if (!valid) return;
    if (!playlistIdentifier.trim()) {
      setWorkState('playlist', { state: 'error', message: 'Enter a playlist identifier.' });
      return;
    }
    if (new TextEncoder().encode(playlistIdentifier).length > 64) {
      setWorkState('playlist', { state: 'error', message: 'Identifier exceeds 64 UTF-8 bytes.' });
      return;
    }
    setWorkState('playlist', { state: 'working', message: 'Waiting for Home approval and QDN confirmation…' });
    try {
      const result = await publishPlaylist(valid, selectedName, playlistIdentifier, context.address);
      const ready = !result || typeof result !== 'object' || !('ready' in result) || result.ready !== false;
      setWorkState('playlist', ready
        ? { state: 'success', message: 'Playlist publish was accepted and confirmed readable.' }
        : { state: 'error', message: 'Playlist publish was accepted but is not confirmed readable yet. The draft is preserved.' });
    } catch (error) {
      setWorkState('playlist', { state: 'error', message: `Draft preserved. ${errorMessage(error)}` });
    }
  }

  const defaultUpload = (
    key: string,
    resource: ResourceRef,
    onSuccess: (resource: ResourceRef) => void,
    targetTrackId: string,
  ) =>
    context
      ? {
          label: `Choose and upload ${resource.service}`,
          state: work[key],
          disabled: uploadsPending && work[key]?.state !== 'working',
          onChoose: () => void upload(key, resource.service, resource.identifier, onSuccess, undefined, targetTrackId),
        }
      : undefined;

  const textUpload = (
    key: string,
    value: TextRef,
    onSuccess: (value: TextRef) => void,
    targetTrackId: string,
  ) =>
    context
      ? {
          state: work[key],
          disabled: uploadsPending && work[key]?.state !== 'working',
          onFile: (file: File) =>
            void upload(
              key,
              'FILE',
              value.identifier,
              (resource) => onSuccess({ ...value, ...resource, service: 'FILE', format: 'vtt' }),
              file,
              targetTrackId,
            ),
        }
      : undefined;

  return (
    <section className="editor-shell" aria-labelledby="playlist-editor-title">
      <header className="editor-heading">
        <div>
          <p className="editor-eyebrow">Playlist authoring</p>
          <h2 id="playlist-editor-title">Build a QDN playlist</h2>
          <p>Edit existing QDN references, pair audio and video, and attach independent WebVTT text.</p>
        </div>
        <div className="editor-actions">
          <button type="button" className="editor-button editor-button--primary" onClick={loadDraftIntoPlayer}>
            Validate and load
          </button>
          <button type="button" className="editor-button" onClick={exportJson}>
            Export JSON
          </button>
        </div>
      </header>

      {recovered ? (
        <div className="editor-notice editor-notice--info" role="status">
          <span>A saved browser draft was restored.</span>
          <button
            type="button"
            className="editor-link-button"
            disabled={uploadsPending}
            onClick={() => {
              setDraft(clonePlaylist(playlist));
              setRecovered(false);
              setValidationError('');
            }}
          >
            Discard it and use the loaded playlist
          </button>
        </div>
      ) : null}
      {validationError ? <div className="editor-notice editor-notice--error" role="alert">{validationError}</div> : null}

      <section className="editor-card editor-playlist-meta">
        <label>
          <span>Playlist title</span>
          <input
            value={draft.title}
            onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
            placeholder="My playlist"
          />
        </label>
        <p className="editor-help">Changes are kept as a local browser draft, including incomplete forms and failed uploads.</p>
      </section>

      <div className="editor-track-list">
        {draft.tracks.map((track, trackIndex) => {
          const versionKinds = (['audio', 'video'] as const).filter((kind) => track.versions[kind]);
          return (
            <article className="editor-card editor-track" key={track.id || `track-${trackIndex}`}>
              <header className="editor-track-heading">
                <div>
                  <span className="editor-track-number">Track {trackIndex + 1}</span>
                  <h3>{track.title.trim() || 'Untitled track'}</h3>
                </div>
                <div className="editor-order-controls" aria-label={`Reorder ${track.title || `track ${trackIndex + 1}`}`}>
                  <button type="button" onClick={() => moveTrack(trackIndex, -1)} disabled={uploadsPending || trackIndex === 0} aria-label="Move track up">↑</button>
                  <button type="button" onClick={() => moveTrack(trackIndex, 1)} disabled={uploadsPending || trackIndex === draft.tracks.length - 1} aria-label="Move track down">↓</button>
                  <button type="button" className="editor-danger" onClick={() => removeTrack(trackIndex)} disabled={uploadsPending}>Remove</button>
                </div>
              </header>

              <div className="editor-fields editor-fields--track">
                <label>
                  <span>Title</span>
                  <input value={track.title} onChange={(event) => updateTrack(trackIndex, { ...track, title: event.target.value })} />
                </label>
                <label>
                  <span>Artist</span>
                  <input value={track.artist} onChange={(event) => updateTrack(trackIndex, { ...track, artist: event.target.value })} />
                </label>
                <label>
                  <span>Default version</span>
                  <select
                    value={track.defaultVersion}
                    onChange={(event) => updateTrack(trackIndex, { ...track, defaultVersion: event.target.value as MediaKind })}
                  >
                    {versionKinds.map((kind) => <option value={kind} key={kind}>{kind === 'audio' ? 'Audio' : 'Video'}</option>)}
                  </select>
                </label>
                <label>
                  <span>Switch policy</span>
                  <select
                    value={track.switchPolicy}
                    onChange={(event) => updateTrack(trackIndex, { ...track, switchPolicy: event.target.value as Track['switchPolicy'] })}
                  >
                    <option value="restart">Restart when switching</option>
                    <option value="aligned">Keep shared timeline position</option>
                  </select>
                </label>
              </div>
              <p className="editor-help">
                Use restart unless both recordings share the same edit. Timeline offsets align an intro or other constant shift.
              </p>

              <fieldset className="editor-version-toggle">
                <legend>Available versions</legend>
                {(['audio', 'video'] as const).map((kind) => {
                  const enabled = Boolean(track.versions[kind]);
                  return (
                    <label key={kind}>
                      <input
                        type="checkbox"
                        checked={enabled}
                        disabled={uploadsPending || (enabled && versionKinds.length === 1)}
                        onChange={(event) => toggleVersion(trackIndex, kind, event.target.checked)}
                      />
                      <span>{kind === 'audio' ? 'Audio' : 'Video'}</span>
                    </label>
                  );
                })}
              </fieldset>

              {(['audio', 'video'] as const).map((kind) => {
                const version = track.versions[kind];
                if (!version) return null;
                const mediaKey = `${track.id}:${kind}`;
                return (
                  <details className="editor-details" key={kind} open={versionKinds.length === 1}>
                    <summary>{kind === 'audio' ? 'Audio version' : 'Video version'}</summary>
                    <div className="editor-details-body">
                      <ResourceFields
                        legend={`${kind === 'audio' ? 'AUDIO' : 'VIDEO'} resource`}
                        resource={version.resource}
                        allowPath
                        onChange={(resource) => updateVersion(trackIndex, kind, { ...version, resource })}
                        upload={defaultUpload(mediaKey, version.resource, (resource) =>
                          updateVersionByTrackId(track.id, kind, (current) => current ? { ...current, resource } : current), track.id)}
                      />
                      <label className="editor-short-field">
                        <span>Timeline offset (ms)</span>
                        <input
                          type="number"
                          step="1"
                          value={version.timelineOffsetMs ?? ''}
                          onChange={(event) => updateVersion(trackIndex, kind, {
                            ...version,
                            timelineOffsetMs: optionalNumber(event.target.value),
                          })}
                          placeholder="0"
                        />
                      </label>
                      <div className="editor-override-grid">
                        <OverrideFields
                          label="Lyrics for this version"
                          value={version.lyrics}
                          inherited={track.lyrics}
                          name={selectedName}
                          onChange={(lyrics) => updateVersion(trackIndex, kind, { ...version, lyrics })}
                          upload={version.lyrics ? textUpload(`${mediaKey}:lyrics`, version.lyrics, (lyrics) =>
                            updateVersionByTrackId(track.id, kind, (current) => current ? { ...current, lyrics } : current), track.id) : undefined}
                        />
                        <OverrideFields
                          label="Commentary for this version"
                          value={version.commentary}
                          inherited={track.commentary}
                          name={selectedName}
                          onChange={(commentary) => updateVersion(trackIndex, kind, { ...version, commentary })}
                          upload={version.commentary ? textUpload(`${mediaKey}:commentary`, version.commentary, (commentary) =>
                            updateVersionByTrackId(track.id, kind, (current) => current ? { ...current, commentary } : current), track.id) : undefined}
                        />
                      </div>
                    </div>
                  </details>
                );
              })}

              <details className="editor-details">
                <summary>Cover and track-level timed text</summary>
                <div className="editor-details-body">
                  <div className="editor-optional-heading">
                    <div>
                      <h4>Audio cover</h4>
                      <p>Optional static IMAGE shown during audio playback.</p>
                    </div>
                    <button
                      type="button"
                      className="editor-button editor-button--quiet"
                      disabled={uploadsPending}
                      onClick={() => updateTrack(trackIndex, {
                        ...track,
                        cover: track.cover ? undefined : blankResource('IMAGE', selectedName),
                      })}
                    >
                      {track.cover ? 'Remove cover' : 'Add cover'}
                    </button>
                  </div>
                  {track.cover ? (
                    <ResourceFields
                      legend="IMAGE resource"
                      resource={track.cover}
                      onChange={(cover) => updateTrack(trackIndex, { ...track, cover })}
                      upload={defaultUpload(`${track.id}:cover`, track.cover, (cover) =>
                        patchTrackById(track.id, (current) => ({ ...current, cover })), track.id)}
                    />
                  ) : null}

                  <div className="editor-text-grid">
                    <section>
                      <div className="editor-optional-heading">
                        <div><h4>Lyrics</h4><p>Track default; versions can override or disable it.</p></div>
                        <button
                          type="button"
                          className="editor-button editor-button--quiet"
                          disabled={uploadsPending}
                          onClick={() => updateTrack(trackIndex, { ...track, lyrics: track.lyrics ? undefined : blankText(selectedName) })}
                        >
                          {track.lyrics ? 'Remove' : 'Add lyrics'}
                        </button>
                      </div>
                      {track.lyrics ? (
                        <TextFields
                          label="Lyrics WebVTT"
                          value={track.lyrics}
                          onChange={(lyrics) => updateTrack(trackIndex, { ...track, lyrics })}
                          upload={textUpload(`${track.id}:lyrics`, track.lyrics, (lyrics) =>
                            patchTrackById(track.id, (current) => ({ ...current, lyrics })), track.id)}
                        />
                      ) : null}
                    </section>
                    <section>
                      <div className="editor-optional-heading">
                        <div><h4>Commentary</h4><p>Independent timed notes shown above the media.</p></div>
                        <button
                          type="button"
                          className="editor-button editor-button--quiet"
                          disabled={uploadsPending}
                          onClick={() => updateTrack(trackIndex, { ...track, commentary: track.commentary ? undefined : blankText(selectedName) })}
                        >
                          {track.commentary ? 'Remove' : 'Add commentary'}
                        </button>
                      </div>
                      {track.commentary ? (
                        <TextFields
                          label="Commentary WebVTT"
                          value={track.commentary}
                          onChange={(commentary) => updateTrack(trackIndex, { ...track, commentary })}
                          upload={textUpload(`${track.id}:commentary`, track.commentary, (commentary) =>
                            patchTrackById(track.id, (current) => ({ ...current, commentary })), track.id)}
                        />
                      ) : null}
                    </section>
                  </div>
                </div>
              </details>

              <details className="editor-details editor-details--compact">
                <summary>Advanced identity</summary>
                <div className="editor-details-body">
                  <label>
                    <span>Track entry ID</span>
                    <input value={track.id} disabled={uploadsPending} onChange={(event) => updateTrack(trackIndex, { ...track, id: event.target.value })} />
                  </label>
                  <p className="editor-help">This identifies the playlist entry, so the same recording can appear more than once.</p>
                </div>
              </details>
            </article>
          );
        })}
      </div>

      <button
        type="button"
        className="editor-add-track"
        disabled={uploadsPending}
        onClick={() => setDraft((current) => ({
          ...current,
          tracks: [...current.tracks, blankTrack(current.tracks.length, selectedName)],
        }))}
      >
        <span aria-hidden="true">＋</span> Add track
      </button>

      <details className="editor-card editor-json">
        <summary>Import or inspect JSON</summary>
        <div className="editor-details-body">
          <p className="editor-help">Import validates the complete manifest before replacing the editor or active playlist.</p>
          <textarea value={jsonInput} onChange={(event) => setJsonInput(event.target.value)} spellCheck={false} aria-label="Playlist JSON" />
          <div className="editor-actions">
            <button type="button" className="editor-button editor-button--primary" disabled={uploadsPending} onClick={() => importJson(jsonInput)}>Import JSON</button>
            <button type="button" className="editor-button" onClick={() => setJsonInput(JSON.stringify(draft, null, 2))}>Copy editor into JSON</button>
            <label className="editor-file-button">
              <span>Choose JSON file</span>
              <input type="file" accept=".json,application/json" disabled={uploadsPending} onChange={(event) => void importFile(event)} />
            </label>
          </div>
        </div>
      </details>

      {context ? (
        <section className="editor-card editor-publish" aria-labelledby="editor-publish-title">
          <div className="editor-section-heading">
            <div>
              <p className="editor-eyebrow">Qortium Home</p>
              <h3 id="editor-publish-title">Upload and publish</h3>
              <p>Uploads above and the final PLAYLIST use the selected owned name. Home will request approval for each write.</p>
            </div>
          </div>
          <div className="editor-fields editor-fields--publish">
            <label>
              <span>Owned QDN name</span>
              <select value={selectedName} onChange={(event) => setSelectedName(event.target.value)}>
                {context.names.map((name) => <option value={name} key={name}>{name}</option>)}
              </select>
            </label>
            <label>
              <span>PLAYLIST identifier</span>
              <input value={playlistIdentifier} onChange={(event) => setPlaylistIdentifier(event.target.value)} />
            </label>
          </div>
          {!context.names.length ? (
            <div className="editor-notice editor-notice--error">The selected account does not own a QDN name, so it cannot publish this playlist.</div>
          ) : null}
          <div className="editor-publish-row">
            <button
              type="button"
              className="editor-button editor-button--primary"
              onClick={() => void publish()}
              disabled={!selectedName || uploadsPending || work.playlist?.state === 'working'}
            >
              {work.playlist?.state === 'working' ? 'Publishing…' : 'Publish PLAYLIST'}
            </button>
            {work.playlist ? (
              <span className={`editor-inline-status editor-inline-status--${work.playlist.state}`} role="status">
                {work.playlist.message}
              </span>
            ) : null}
          </div>
          <p className="editor-help">Publish each missing media, cover, and text resource first. Successful uploads remain in the draft if a later step is cancelled or fails.</p>
        </section>
      ) : contextChecked ? (
        <p className="editor-home-note">Resource upload and publication controls are available when this app runs inside Qortium Home.</p>
      ) : null}
    </section>
  );
}
