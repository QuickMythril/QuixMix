import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Playlist, ResourceRef } from './model';

vi.mock('./qdnRequest', () => ({
  hasHomeBridge: vi.fn(() => true),
  qdnRequest: vi.fn(),
}));

import {
  getPublishContext,
  listOwnPlaylists,
  publishPlaylist,
  qdnClient,
  ReadinessTimeoutError,
  submitPlaylist,
  pendingPublications,
  resolvePublication,
  uploadResource,
} from './qdn';
import { hasHomeBridge, qdnRequest } from './qdnRequest';

const requestMock = vi.mocked(qdnRequest);
const hasHomeBridgeMock = vi.mocked(hasHomeBridge);

const ALL_PUBLISH_ACTIONS = [
  'GET_SELECTED_ACCOUNT',
  'GET_ACCOUNT_NAMES',
  'PUBLISH_QDN_RESOURCE',
  'STAGE_QDN_PUBLISH_SOURCE',
  'SELECT_QDN_PUBLISH_SOURCE',
];
const ADDRESS = 'QAddress1';
const NAME = 'ArtistName';
const audioRef: ResourceRef = { service: 'AUDIO', name: NAME, identifier: 'first-light' };
const lyricsRef: ResourceRef = { service: 'FILE', name: NAME, identifier: 'first-light-lyrics' };

type Request = Record<string, unknown> & { action: string };

function contextResponse(request: Request, address = ADDRESS) {
  if (request.action === 'SHOW_ACTIONS') return ALL_PUBLISH_ACTIONS;
  if (request.action === 'GET_SELECTED_ACCOUNT') return { address };
  if (request.action === 'GET_ACCOUNT_NAMES') return [{ name: NAME }];
  return undefined;
}

function utf8Base64(text: string) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeBase64Bytes(value: string) {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function playlistWithDependencies(): Playlist {
  return {
    kind: 'qortium-music-playlist',
    schemaVersion: 1,
    title: 'Dependency test',
    tracks: [
      {
        id: 'track-1',
        title: 'First Light',
        artist: 'Example Artist',
        defaultVersion: 'audio',
        switchPolicy: 'restart',
        versions: {
          audio: { resource: audioRef, lyrics: { ...lyricsRef, service: 'FILE', format: 'vtt' } },
          video: {
            resource: { service: 'VIDEO', name: NAME, identifier: 'first-light-video' },
            commentary: { service: 'FILE', name: NAME, identifier: 'video-notes', format: 'vtt' },
          },
        },
        cover: { service: 'IMAGE', name: NAME, identifier: 'first-light-cover' },
        lyrics: { ...lyricsRef, service: 'FILE', format: 'vtt' },
        commentary: { service: 'FILE', name: NAME, identifier: 'first-light-notes', format: 'vtt' },
      },
    ],
  };
}

beforeEach(() => {
  requestMock.mockReset();
  hasHomeBridgeMock.mockReset().mockReturnValue(true);
  vi.stubGlobal('window', { location: { href: 'https://home.example/apps/music/' } });
  vi.stubGlobal('localStorage', {
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Home account and capability contracts', () => {
  it('uses GET_SELECTED_ACCOUNT and GET_ACCOUNT_NAMES with the selected address', async () => {
    requestMock.mockImplementation(async (request) => {
      const response = contextResponse(request as Request);
      if (response !== undefined) return response;
      throw new Error(`Unexpected action ${request.action}`);
    });

    await expect(getPublishContext()).resolves.toEqual({ address: ADDRESS, names: [NAME] });

    expect(requestMock).toHaveBeenNthCalledWith(1, { action: 'SHOW_ACTIONS', signal: expect.any(AbortSignal) });
    expect(requestMock).toHaveBeenNthCalledWith(2, {
      action: 'GET_SELECTED_ACCOUNT',
      signal: expect.any(AbortSignal),
    });
    expect(requestMock).toHaveBeenNthCalledWith(3, {
      action: 'GET_ACCOUNT_NAMES',
      address: ADDRESS,
      maxBytes: 256 * 1024,
      signal: expect.any(AbortSignal),
    });
  });

  it.each([
    ['an invalid capability response', { invalid: true }, /invalid capabilities/i],
    [
      'a missing write capability',
      ALL_PUBLISH_ACTIONS.filter((action) => action !== 'PUBLISH_QDN_RESOURCE'),
      /does not support PUBLISH_QDN_RESOURCE/i,
    ],
  ])('fails closed for %s', async (_label, capabilities, expected) => {
    requestMock.mockResolvedValueOnce(capabilities);

    await expect(getPublishContext()).rejects.toThrow(expected);
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it('fails before capability discovery outside Qortium Home', async () => {
    hasHomeBridgeMock.mockReturnValue(false);

    await expect(getPublishContext()).rejects.toThrow(/requires Qortium Home/i);
    expect(requestMock).not.toHaveBeenCalled();
  });
});

describe('source staging and publication', () => {
  it('stages exact bytes and MIME type, then publishes only the returned source token', async () => {
    const calls: Request[] = [];
    const bytes = new Uint8Array([0, 1, 127, 128, 255]);
    const file = new File([bytes], 'lyrics.vtt', { type: 'text/vtt' });

    requestMock.mockImplementation(async (raw) => {
      const request = raw as Request;
      calls.push(request);
      const context = contextResponse(request);
      if (context !== undefined) return context;
      if (request.action === 'STAGE_QDN_PUBLISH_SOURCE') return { sourceToken: 'source-123' };
      if (request.action === 'PUBLISH_QDN_RESOURCE') {
        return { accepted: true, transactionSignature: 'signature-123' };
      }
      if (request.action === 'LIST_QDN_RESOURCES') return [{ ...lyricsRef, latestSignature: 'signature-123' }];
      if (request.action === 'GET_QDN_RESOURCE_STATUS') return { status: 'READY' };
      throw new Error(`Unexpected action ${request.action}`);
    });

    await expect(uploadResource('FILE', NAME, lyricsRef.identifier, ADDRESS, file)).resolves.toEqual(lyricsRef);

    const staged = calls.find((request) => request.action === 'STAGE_QDN_PUBLISH_SOURCE');
    expect(staged).toMatchObject({
      action: 'STAGE_QDN_PUBLISH_SOURCE',
      fileName: 'lyrics.vtt',
      mimeType: 'text/vtt',
    });
    expect(decodeBase64Bytes(staged?.bytesBase64 as string)).toEqual(bytes);
    expect(calls.find((request) => request.action === 'PUBLISH_QDN_RESOURCE')).toEqual({
      action: 'PUBLISH_QDN_RESOURCE',
      identifier: lyricsRef.identifier,
      name: NAME,
      service: 'FILE',
      sourceToken: 'source-123',
    });
  });

  it('rechecks the selected account after staging and rejects an account change before publish', async () => {
    let accountReads = 0;
    requestMock.mockImplementation(async (raw) => {
      const request = raw as Request;
      if (request.action === 'SHOW_ACTIONS') return ALL_PUBLISH_ACTIONS;
      if (request.action === 'GET_SELECTED_ACCOUNT') {
        accountReads += 1;
        return { address: accountReads === 1 ? ADDRESS : 'QDifferentAddress' };
      }
      if (request.action === 'GET_ACCOUNT_NAMES') return [{ name: NAME }];
      if (request.action === 'STAGE_QDN_PUBLISH_SOURCE') return { sourceToken: 'staged-source' };
      throw new Error(`Unexpected action ${request.action}`);
    });

    await expect(
      uploadResource('FILE', NAME, 'account-change', ADDRESS, new File(['WEBVTT\n\n'], 'notes.vtt')),
    ).rejects.toThrow(/selected account changed/i);

    expect(requestMock.mock.calls.some(([request]) => request.action === 'STAGE_QDN_PUBLISH_SOURCE')).toBe(true);
    expect(requestMock.mock.calls.some(([request]) => request.action === 'PUBLISH_QDN_RESOURCE')).toBe(false);
  });

  it('rejects a publisher name the selected account does not own before selecting a file', async () => {
    requestMock.mockImplementation(async (raw) => {
      const request = raw as Request;
      if (request.action === 'SHOW_ACTIONS') return ALL_PUBLISH_ACTIONS;
      if (request.action === 'GET_SELECTED_ACCOUNT') return { address: ADDRESS };
      if (request.action === 'GET_ACCOUNT_NAMES') return [{ name: 'AnotherOwnedName' }];
      throw new Error(`Unexpected action ${request.action}`);
    });

    await expect(uploadResource('AUDIO', NAME, 'not-owned', ADDRESS)).rejects.toThrow(/does not own/i);
    expect(requestMock.mock.calls.some(([request]) =>
      request.action === 'SELECT_QDN_PUBLISH_SOURCE' || request.action === 'STAGE_QDN_PUBLISH_SOURCE',
    )).toBe(false);
  });

  it('treats picker cancellation as terminal and never publishes', async () => {
    requestMock.mockImplementation(async (raw) => {
      const request = raw as Request;
      const context = contextResponse(request);
      if (context !== undefined) return context;
      if (request.action === 'SELECT_QDN_PUBLISH_SOURCE') return { canceled: true };
      throw new Error(`Unexpected action ${request.action}`);
    });

    await expect(uploadResource('AUDIO', NAME, 'cancelled-audio', ADDRESS)).rejects.toThrow(/cancelled/i);
    expect(requestMock.mock.calls.some(([request]) => request.action === 'SELECT_QDN_PUBLISH_SOURCE')).toBe(true);
    expect(requestMock.mock.calls.some(([request]) => request.action === 'PUBLISH_QDN_RESOURCE')).toBe(false);
  });
});

describe('resource reads', () => {
  it('requires READY before requesting the advertised Home streaming URL', async () => {
    const actions: string[] = [];
    requestMock.mockImplementation(async (raw) => {
      const request = raw as Request;
      actions.push(request.action);
      if (request.action === 'GET_QDN_RESOURCE_STATUS') return { status: 'READY' };
      if (request.action === 'SHOW_ACTIONS') return ['GET_QDN_RESOURCE_STREAM_URL'];
      if (request.action === 'GET_QDN_RESOURCE_STREAM_URL') {
        return { url: 'qortium-home-resource://stream/AUDIO/ArtistName/first-light' };
      }
      throw new Error(`Unexpected action ${request.action}`);
    });

    await expect(qdnClient.mediaUrl(audioRef)).resolves.toBe(
      'qortium-home-resource://stream/AUDIO/ArtistName/first-light',
    );
    expect(actions).toEqual([
      'GET_QDN_RESOURCE_STATUS',
      'SHOW_ACTIONS',
      'GET_QDN_RESOURCE_STREAM_URL',
    ]);
  });

  it('does not synthesize a localhost media URL when Home URL delivery is unavailable', async () => {
    hasHomeBridgeMock.mockReturnValue(true);
    requestMock.mockImplementation(async (raw) => {
      const request = raw as Request;
      if (request.action === 'GET_QDN_RESOURCE_STATUS') return { status: 'READY' };
      if (request.action === 'SHOW_ACTIONS') return ['GET_QDN_RESOURCE_URL'];
      if (request.action === 'GET_QDN_RESOURCE_URL') throw new Error('GET_QDN_RESOURCE_URL is unavailable');
      throw new Error(`Unexpected action ${request.action}`);
    });

    await expect(qdnClient.mediaUrl(audioRef)).rejects.toThrow(/unavailable/i);
    expect(requestMock.mock.calls.some(([request]) =>
      Object.values(request).some((value) => typeof value === 'string' && value.includes('127.0.0.1')),
    )).toBe(false);
  });

  it('decodes bounded UTF-8 base64 text and sends the encoded response bound', async () => {
    const expected = 'WEBVTT\n\n00:00.000 --> 00:01.000\nHéllo 世界';
    requestMock.mockImplementation(async (raw) => {
      const request = raw as Request;
      if (request.action === 'GET_QDN_RESOURCE_STATUS') return { status: 'READY' };
      if (request.action === 'FETCH_QDN_RESOURCE') {
        expect(request).toMatchObject({
          encoding: 'base64',
          maxBytes: Math.ceil((1024 * 1024) / 3) * 4 + 4,
        });
        return utf8Base64(expected);
      }
      throw new Error(`Unexpected action ${request.action}`);
    });

    await expect(qdnClient.text(lyricsRef)).resolves.toBe(expected);
  });

  it.each([
    ['invalid base64', '%%%not-base64%%%', /invalid base64/i],
    ['an oversized encoded response', 'A'.repeat(Math.ceil((1024 * 1024) / 3) * 4 + 5), /bounded base64/i],
  ])('rejects %s', async (_label, body, expected) => {
    requestMock.mockImplementation(async (raw) => {
      const request = raw as Request;
      if (request.action === 'GET_QDN_RESOURCE_STATUS') return { status: 'READY' };
      if (request.action === 'FETCH_QDN_RESOURCE') return body;
      throw new Error(`Unexpected action ${request.action}`);
    });

    await expect(qdnClient.text(lyricsRef)).rejects.toThrow(expected);
  });
});

describe('accepted publication recovery', () => {
  it('journals an accepted response without a signature and blocks a repeat publication', async () => {
    const identifier = 'accepted-without-signature';
    let stageCalls = 0;
    let publishCalls = 0;
    requestMock.mockImplementation(async (raw) => {
      const request = raw as Request;
      const context = contextResponse(request);
      if (context !== undefined) return context;
      if (request.action === 'STAGE_QDN_PUBLISH_SOURCE') {
        stageCalls += 1;
        return { sourceToken: 'unsigned-accepted-source' };
      }
      if (request.action === 'PUBLISH_QDN_RESOURCE') {
        publishCalls += 1;
        return { accepted: true };
      }
      throw new Error(`Unexpected action ${request.action}`);
    });

    await expect(
      uploadResource('FILE', NAME, identifier, ADDRESS, new File(['first'], 'first.txt')),
    ).rejects.toBeInstanceOf(ReadinessTimeoutError);
    await expect(
      uploadResource('FILE', NAME, identifier, ADDRESS, new File(['retry'], 'retry.txt')),
    ).rejects.toThrow(/previous publication has an unresolved outcome/i);

    expect(stageCalls).toBe(1);
    expect(publishCalls).toBe(1);
  });

  it('journals an unknown publish outcome and blocks a repeat publication', async () => {
    const identifier = 'unknown-publish-outcome';
    let stageCalls = 0;
    let publishCalls = 0;
    requestMock.mockImplementation(async (raw) => {
      const request = raw as Request;
      const context = contextResponse(request);
      if (context !== undefined) return context;
      if (request.action === 'STAGE_QDN_PUBLISH_SOURCE') {
        stageCalls += 1;
        return { sourceToken: 'unknown-outcome-source' };
      }
      if (request.action === 'PUBLISH_QDN_RESOURCE') {
        publishCalls += 1;
        return { accepted: false, outcome: 'unknown' };
      }
      throw new Error(`Unexpected action ${request.action}`);
    });

    await expect(
      uploadResource('FILE', NAME, identifier, ADDRESS, new File(['first'], 'first.txt')),
    ).rejects.toThrow(/publication outcome is unknown/i);
    await expect(
      uploadResource('FILE', NAME, identifier, ADDRESS, new File(['retry'], 'retry.txt')),
    ).rejects.toThrow(/previous publication has an unresolved outcome/i);

    expect(stageCalls).toBe(1);
    expect(publishCalls).toBe(1);
  });

  it('does not treat an older READY version as success and retries readiness without republishing', async () => {
    vi.useFakeTimers();
    const ref: ResourceRef = { service: 'FILE', name: NAME, identifier: 'pending-signature-test' };
    let advertisedSignature = 'older-signature';
    let statusCalls = 0;
    let stageCalls = 0;
    let publishCalls = 0;
    const file = new File(['first'], 'first.txt');

    requestMock.mockImplementation(async (raw) => {
      const request = raw as Request;
      const context = contextResponse(request);
      if (context !== undefined) return context;
      if (request.action === 'STAGE_QDN_PUBLISH_SOURCE') {
        stageCalls += 1;
        return { sourceToken: 'pending-source' };
      }
      if (request.action === 'PUBLISH_QDN_RESOURCE') {
        publishCalls += 1;
        return { accepted: true, transactionSignature: 'new-signature' };
      }
      if (request.action === 'LIST_QDN_RESOURCES') return [{ ...ref, latestSignature: advertisedSignature }];
      if (request.action === 'GET_QDN_RESOURCE_STATUS') {
        statusCalls += 1;
        return { status: 'READY' };
      }
      throw new Error(`Unexpected action ${request.action}`);
    });

    const first = uploadResource('FILE', NAME, ref.identifier, ADDRESS, file);
    const firstResult = expect(first).rejects.toBeInstanceOf(ReadinessTimeoutError);
    await vi.advanceTimersByTimeAsync(61_000);
    await firstResult;

    expect(statusCalls).toBe(0);
    expect(stageCalls).toBe(1);
    expect(publishCalls).toBe(1);

    advertisedSignature = 'new-signature';
    await expect(
      uploadResource('FILE', NAME, ref.identifier, ADDRESS, new File(['replacement'], 'replacement.txt')),
    ).rejects.toMatchObject({ ref, recovered: true });

    expect(statusCalls).toBe(1);
    expect(stageCalls).toBe(1);
    expect(publishCalls).toBe(1);
  });
});

describe('playlist dependency gate', () => {
  it('confirms every unique referenced resource before staging the manifest', async () => {
    const playlist = playlistWithDependencies();
    const actions: Request[] = [];
    const dependencies = new Set([
      JSON.stringify(['AUDIO', NAME, 'first-light']),
      JSON.stringify(['VIDEO', NAME, 'first-light-video']),
      JSON.stringify(['IMAGE', NAME, 'first-light-cover']),
      JSON.stringify(['FILE', NAME, 'first-light-lyrics']),
      JSON.stringify(['FILE', NAME, 'first-light-notes']),
      JSON.stringify(['FILE', NAME, 'video-notes']),
    ]);

    requestMock.mockImplementation(async (raw) => {
      const request = raw as Request;
      actions.push(request);
      const context = contextResponse(request);
      if (context !== undefined) return context;
      if (request.action === 'GET_QDN_RESOURCE_STATUS') return { status: 'READY' };
      if (request.action === 'STAGE_QDN_PUBLISH_SOURCE') {
        const manifest = JSON.parse(new TextDecoder().decode(decodeBase64Bytes(request.bytesBase64 as string)));
        expect(manifest).toEqual(playlist);
        return { sourceToken: 'playlist-source' };
      }
      if (request.action === 'PUBLISH_QDN_RESOURCE') {
        return { accepted: true, transactionSignature: 'playlist-signature' };
      }
      if (request.action === 'LIST_QDN_RESOURCES') {
        return [{ service: 'PLAYLIST', name: NAME, identifier: 'dependency-playlist', latestSignature: 'playlist-signature' }];
      }
      throw new Error(`Unexpected action ${request.action}`);
    });

    await expect(publishPlaylist(playlist, NAME, 'dependency-playlist', ADDRESS)).resolves.toMatchObject({
      accepted: true,
      ready: true,
    });

    const stageIndex = actions.findIndex((request) => request.action === 'STAGE_QDN_PUBLISH_SOURCE');
    const dependencyChecks = actions
      .slice(0, stageIndex)
      .filter((request) => request.action === 'GET_QDN_RESOURCE_STATUS')
      .map((request) => JSON.stringify([request.service, request.name, request.identifier]));

    expect(new Set(dependencyChecks)).toEqual(dependencies);
    expect(dependencyChecks).toHaveLength(dependencies.size);
  });
});

it('does not resubmit when the publication response is lost', async () => {
  let publishes=0;
  requestMock.mockImplementation(async raw=>{
    const request=raw as Request;
    const context=contextResponse(request);if(context!==undefined)return context;
    if(request.action==='STAGE_QDN_PUBLISH_SOURCE')return {sourceToken:'lost-response-source'};
    if(request.action==='PUBLISH_QDN_RESOURCE'){publishes++;throw new Error('transport disconnected');}
    throw new Error(`Unexpected action ${request.action}`);
  });
  const file=new File(['text'],'lost.vtt');
  await expect(uploadResource('FILE',NAME,'lost-response-test',ADDRESS,file)).rejects.toThrow('transport disconnected');
  await expect(uploadResource('FILE',NAME,'lost-response-test',ADDRESS,file)).rejects.toThrow('unresolved outcome');
  expect(publishes).toBe(1);
});

describe('folder media upload handoff', () => {
  it('stages media larger than 1 MiB without reopening a picker', async () => {
    const ref = { service: 'AUDIO', name: NAME, identifier: 'folder-audio' };
    requestMock.mockImplementation(async request => {
      const context = contextResponse(request as Request); if (context !== undefined) return context;
      if (request.action === 'STAGE_QDN_PUBLISH_SOURCE') return { sourceToken: 'folder-staged' };
      if (request.action === 'PUBLISH_QDN_RESOURCE') return { accepted: true, transactionSignature: 'folder-sig' };
      if (request.action === 'LIST_QDN_RESOURCES') return [{ ...ref, latestSignature: 'folder-sig' }];
      if (request.action === 'GET_QDN_RESOURCE_STATUS') return { status: 'READY' };
      throw Error(`Unexpected ${request.action}`);
    });
    await expect(uploadResource('AUDIO', NAME, ref.identifier, ADDRESS, new File([new Uint8Array(2*1024*1024)], 'song.mp3', {type:'audio/mpeg'}))).resolves.toEqual(ref);
    expect(requestMock.mock.calls.some(([r]) => r.action === 'SELECT_QDN_PUBLISH_SOURCE')).toBe(false);
  });
  it('rejects a mismatching native selection before publishing a large video', async () => {
    requestMock.mockImplementation(async request => {
      const context = contextResponse(request as Request); if (context !== undefined) return context;
      if (request.action === 'SELECT_QDN_PUBLISH_SOURCE') return {sourceToken:'wrong',fileName:'other.mp4',size:30*1024*1024};
      throw Error(`Unexpected ${request.action}`);
    });
    await expect(uploadResource('VIDEO', NAME, 'large-video', ADDRESS, new File([new Uint8Array(30*1024*1024)], 'song.mp4'))).rejects.toThrow(/matching file/);
    expect(requestMock.mock.calls.some(([r]) => r.action === 'PUBLISH_QDN_RESOURCE')).toBe(false);
    expect(requestMock.mock.calls.some(([r]) => r.action === 'STAGE_QDN_PUBLISH_SOURCE')).toBe(false);
  });
});

describe('submission queue safety', () => {
  function mockPublish(result: unknown) {
    requestMock.mockImplementation(async raw => {
      const request = raw as Request;
      const context = contextResponse(request); if (context !== undefined) return context;
      if (request.action === 'STAGE_QDN_PUBLISH_SOURCE') return {sourceToken:'queue-source'};
      if (request.action === 'PUBLISH_QDN_RESOURCE') return result;
      throw new Error(`Unexpected action ${request.action}`);
    });
  }
  it('returns on acceptance without checking confirmation or READY', async () => {
    mockPublish({accepted:true,transactionSignature:'queue-sig',immutable:{contentHash:'expected'}});
    await expect(uploadResource('AUDIO',NAME,'queue-submitted',ADDRESS,new File(['sound'],'sound.mp3'),{waitForReady:false,expectedHash:'expected'})).resolves.toMatchObject({identifier:'queue-submitted'});
    expect(requestMock.mock.calls.some(([r])=>r.action==='GET_QDN_RESOURCE_STATUS'||r.action==='LIST_QDN_RESOURCES')).toBe(false);
    expect(localStorage.setItem).toHaveBeenLastCalledWith('music.pending-publications.v1',expect.stringContaining('queue-sig'));
  });
  it('fails before publication if the recovery journal cannot persist', async () => {
    mockPublish({accepted:true,transactionSignature:'must-not-submit'});
    vi.mocked(localStorage.setItem).mockImplementation(()=>{throw new Error('Quota exceeded');});
    await expect(uploadResource('AUDIO',NAME,'queue-no-storage',ADDRESS,new File(['sound'],'sound.mp3'),{waitForReady:false,expectedHash:'expected'})).rejects.toThrow(/recovery could not be saved/);
    expect(requestMock.mock.calls.some(([r])=>r.action==='PUBLISH_QDN_RESOURCE')).toBe(false);
  });
  it('retains a mismatching immutable hash and refuses to advance', async () => {
    mockPublish({accepted:true,transactionSignature:'mismatch-sig',immutable:{contentHash:'different'}});
    await expect(uploadResource('AUDIO',NAME,'queue-mismatch',ADDRESS,new File(['sound'],'sound.mp3'),{waitForReady:false,expectedHash:'expected'})).rejects.toThrow(/bytes that differ/);
    expect(localStorage.setItem).toHaveBeenLastCalledWith('music.pending-publications.v1',expect.stringContaining('mismatch-sig'));
  });
  it('preserves Home error details while preventing automatic retry of unknown submission', async () => {
    mockPublish(undefined);
    const base = requestMock.getMockImplementation()!;
    requestMock.mockImplementation(async r=>{if(r.action==='PUBLISH_QDN_RESOURCE')throw new Error('Home source expired');return base(r);});
    const args = ['AUDIO',NAME,'queue-home-error',ADDRESS,new File(['sound'],'sound.mp3'),{waitForReady:false,expectedHash:'expected'}] as const;
    await expect(uploadResource(...args)).rejects.toThrow(/Home source expired/);
    await expect(uploadResource(...args)).rejects.toThrow(/unresolved outcome/);
    expect(requestMock.mock.calls.filter(([r])=>r.action==='PUBLISH_QDN_RESOURCE')).toHaveLength(1);
  });
});


it('keeps malformed acceptance responses unresolved instead of resubmitting', async () => {
  let submits=0;
  requestMock.mockImplementation(async r=>{
    const context=contextResponse(r as Request);if(context!==undefined)return context;
    if(r.action==='STAGE_QDN_PUBLISH_SOURCE')return {sourceToken:'malformed'};
    if(r.action==='PUBLISH_QDN_RESOURCE'){submits++;return {transactionSignature:'maybe-submitted'};}
    throw Error(`Unexpected ${r.action}`);
  });
  const args=['AUDIO',NAME,'malformed-acceptance',ADDRESS,new File(['sound'],'sound.mp3'),{waitForReady:false,expectedHash:'expected'}] as const;
  await expect(uploadResource(...args)).rejects.toThrow(/Invalid publication response/);
  await expect(uploadResource(...args)).rejects.toThrow(/unresolved outcome/);
  expect(submits).toBe(1);
});

it('reuses an unchanged manifest on QDN even without a saved receipt', async () => {
  const playlist=playlistWithDependencies();
  const {parsePlaylist}=await import('./schema');
  const {contentHash}=await import('./contentHash');
  const text=JSON.stringify(parsePlaylist(playlist));
  const hash=await contentHash(new TextEncoder().encode(text).buffer);
  const identifier='quixmix-list-existing-manifest';
  requestMock.mockImplementation(async r=>{
    const context=contextResponse(r as Request);if(context!==undefined)return context;
    if(r.action==='LIST_QDN_RESOURCES')return [{service:'PLAYLIST',name:NAME,identifier,latestSignature:'existing-manifest-sig'}];
    if(r.action==='FETCH_QDN_RESOURCE')return utf8Base64(text);
    if(r.action==='FETCH_NODE_API')return {ok:true,data:{signature:'existing-manifest-sig',name:NAME,identifier}};
    throw Error(`Unexpected ${r.action}`);
  });
  await expect(submitPlaylist(playlist,NAME,identifier,ADDRESS,hash)).resolves.toMatchObject({service:'PLAYLIST',identifier});
  expect(requestMock.mock.calls.some(([r])=>r.action==='PUBLISH_QDN_RESOURCE')).toBe(false);
});


it('preserves selected-byte evidence when Home recovers a pending signature', async () => {
  const ref:ResourceRef={service:'AUDIO',name:NAME,identifier:'quixmix-pending-hash-evidence'};
  requestMock.mockImplementation(async r=>{
    const context=contextResponse(r as Request);if(context!==undefined)return context;
    if(r.action==='STAGE_QDN_PUBLISH_SOURCE')return {sourceToken:'evidence'};
    if(r.action==='PUBLISH_QDN_RESOURCE')throw Error('lost response');
    throw Error(`Unexpected ${r.action}`);
  });
  await expect(uploadResource('AUDIO',NAME,ref.identifier,ADDRESS,new File(['bytes'],'song.mp3'),{waitForReady:false,expectedHash:'selected-hash'})).rejects.toThrow(/lost response/);
  resolvePublication(ref,'recovered-signature',ADDRESS);
  expect(pendingPublications().find(e=>e.ref.identifier===ref.identifier)).toMatchObject({signature:'recovered-signature',expectedHash:'selected-hash'});
  expect(localStorage.setItem).toHaveBeenLastCalledWith('music.pending-publications.v1',expect.stringContaining('selected-hash'));
});

describe('own playlist library', () => {
  const LIBRARY_ACTIONS = ['GET_SELECTED_ACCOUNT', 'GET_ACCOUNT_NAMES', 'SEARCH_QDN_RESOURCES', 'FETCH_QDN_RESOURCE'];
  const playlistJson = (title: string, tracks = 1) => JSON.stringify({ ...playlistWithDependencies(), title, tracks: Array.from({ length: tracks }, (_, i) => ({ ...playlistWithDependencies().tracks[0], id: `t${i}` })) });

  it('is unavailable without the bridge or its read actions, without prompting', async () => {
    hasHomeBridgeMock.mockReturnValue(false);
    expect(await listOwnPlaylists()).toBeNull();
    hasHomeBridgeMock.mockReturnValue(true);
    requestMock.mockImplementation(async (request) => { if (request.action === 'SHOW_ACTIONS') return ['GET_SELECTED_ACCOUNT']; throw new Error(`unexpected ${request.action}`); });
    expect(await listOwnPlaylists()).toBeNull();
    expect(requestMock.mock.calls.map(([r]) => r.action)).toEqual(['SHOW_ACTIONS']);
  });

  it('lists the selected account\'s playlists newest first with titles read from the JSON', async () => {
    const calls: Request[] = [];
    requestMock.mockImplementation(async (request) => {
      calls.push(request as Request);
      if (request.action === 'SHOW_ACTIONS') return LIBRARY_ACTIONS;
      if (request.action === 'GET_SELECTED_ACCOUNT') return { address: ADDRESS };
      if (request.action === 'GET_ACCOUNT_NAMES') return [{ name: NAME }, { name: 'SecondName' }];
      if (request.action === 'SEARCH_QDN_RESOURCES') return [
        { name: NAME, service: 'PLAYLIST', identifier: 'quixmix-list-b', created: 2, metadata: { title: 'Titled in metadata' } },
        { name: 'SecondName', service: 'PLAYLIST', identifier: 'quixmix-list-a', created: 1 },
        { name: 'Stranger', service: 'PLAYLIST', identifier: 'not-mine', created: 3 },
        { name: NAME, service: 'PLAYLIST', identifier: 'broken', created: 0 },
      ];
      if (request.action === 'FETCH_QDN_RESOURCE') {
        if (request.identifier === 'quixmix-list-b') return utf8Base64(playlistJson('Album B', 2));
        if (request.identifier === 'quixmix-list-a') return utf8Base64(playlistJson('Album A'));
        throw new Error('not available');
      }
      throw new Error(`unexpected ${request.action}`);
    });
    const library = await listOwnPlaylists();
    expect(library).toMatchObject({ address: ADDRESS, names: [NAME, 'SecondName'] });
    expect(library!.entries.map(e => [e.ref.name, e.ref.identifier, e.title, e.tracks])).toEqual([
      [NAME, 'quixmix-list-b', 'Album B', 2],
      ['SecondName', 'quixmix-list-a', 'Album A', 1],
      [NAME, 'broken', 'broken', undefined],
    ]);
    const search = calls.find(c => c.action === 'SEARCH_QDN_RESOURCES')!;
    expect(search).toMatchObject({ service: 'PLAYLIST', names: [NAME, 'SecondName'], exactMatchNames: true, includeMetadata: true, reverse: true });
    expect(calls.filter(c => c.action === 'FETCH_QDN_RESOURCE').every(c => c.service === 'PLAYLIST' && c.encoding === 'base64')).toBe(true);
  });

  it('reports a name-less account as an empty library', async () => {
    requestMock.mockImplementation(async (request) => {
      if (request.action === 'SHOW_ACTIONS') return LIBRARY_ACTIONS;
      if (request.action === 'GET_SELECTED_ACCOUNT') return { address: ADDRESS };
      if (request.action === 'GET_ACCOUNT_NAMES') return [];
      throw new Error(`unexpected ${request.action}`);
    });
    expect(await listOwnPlaylists()).toEqual({ address: ADDRESS, names: [], entries: [] });
  });
});
