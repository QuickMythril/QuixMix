import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { contentHash } from './contentHash';
import type { FolderPlan } from './folderPlan';
import type { ResourceRef } from './model';
import type { JournalEntry } from './qdn';

const qdnMocks = vi.hoisted(() => ({
  pendingPublications: vi.fn<() => JournalEntry[]>(),
  resolvePublication: vi.fn(),
}));
const requestMock = vi.hoisted(() => vi.fn());

vi.mock('./qdn', () => qdnMocks);
vi.mock('./qdnRequest', () => ({ qdnRequest: requestMock }));

import { publicationKey, recoverFolder, reuseReferences, waitForSubmissionCapacity } from './publishResume';

const ADDRESS = 'QPublisherAddress';
const NAME = 'PublisherName';
const PUBLIC_KEY = '1'.repeat(44);
type Request = Record<string, unknown> & { action: string };

async function makePlan(text = 'same bytes'): Promise<FolderPlan> {
  const file = new File([text], 'song.mp3', { type: 'audio/mpeg' });
  const hash = await contentHash(await file.arrayBuffer());
  const ref: ResourceRef = { service: 'AUDIO', name: NAME, identifier: `quixmix-${hash.slice(0, 56)}` };
  return {
    identifier: 'quixmix-album-test',
    files: [{ ref, file, path: file.name, hash }],
    playlist: {
      kind: 'qortium-music-playlist',
      schemaVersion: 1,
      title: 'Recovery test',
      tracks: [{
        id: 'track-1', title: 'Song', artist: 'Artist', defaultVersion: 'audio', switchPolicy: 'restart',
        versions: { audio: { resource: ref } },
      }],
    },
  };
}

function listed(ref: ResourceRef, latestSignature: string, size = 1) {
  return { ...ref, latestSignature, size };
}

beforeEach(() => {
  qdnMocks.pendingPublications.mockReset().mockReturnValue([]);
  qdnMocks.resolvePublication.mockReset();
  requestMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('publish recovery', () => {
  it('reuses an unchanged saved receipt without waiting for resource readiness', async () => {
    const plan = await makePlan();
    const item = plan.files[0];
    qdnMocks.pendingPublications.mockReturnValue([
      { ref: item.ref, signature: 'saved-signature', address: ADDRESS, contentHash: item.hash },
    ]);
    requestMock.mockImplementation(async (raw: Request) => {
      expect(raw.action).toBe('SEARCH_QDN_RESOURCES');
      return [listed(item.ref, 'saved-signature')];
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const recovered = await recoverFolder(plan, ADDRESS, vi.fn());

    expect(recovered.matches.get(publicationKey(item.ref))).toEqual(item.ref);
    expect(recovered.unresolved).toEqual([]);
    expect(requestMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(qdnMocks.resolvePublication).not.toHaveBeenCalled();
  });

  it('reuses legacy publication bytes even when its compressed listing size differs', async () => {
    const plan = await makePlan('published bytes');
    const item = plan.files[0];
    const legacyRef: ResourceRef = { ...item.ref, identifier: 'quixmix-legacy-sequential-id' };
    requestMock.mockImplementation(async (raw: Request) => {
      if (raw.action === 'SEARCH_QDN_RESOURCES') return [listed(legacyRef, 'legacy-signature', 2)];
      if (raw.action === 'GET_QDN_RESOURCE_URL') return 'https://example.test/legacy-audio';
      if (raw.action === 'LIST_QDN_RESOURCES') return [listed(legacyRef, 'legacy-signature', 2)];
      throw new Error(`Unexpected action ${raw.action}`);
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('published bytes')));

    const recovered = await recoverFolder(plan, ADDRESS, vi.fn());

    expect(recovered.matches.get(publicationKey(item.ref))).toEqual(legacyRef);
    expect(qdnMocks.resolvePublication).toHaveBeenCalledWith(legacyRef, 'legacy-signature', ADDRESS, item.hash);
  });

  it('does not reuse a legacy publication whose downloaded bytes changed', async () => {
    const plan = await makePlan('first version');
    const item = plan.files[0];
    const legacyRef: ResourceRef = { ...item.ref, identifier: 'quixmix-legacy-file' };
    requestMock.mockImplementation(async (raw: Request) => {
      if (raw.action === 'SEARCH_QDN_RESOURCES') return [listed(legacyRef, 'legacy-signature')];
      if (raw.action === 'GET_QDN_RESOURCE_URL') return 'https://example.test/changed-audio';
      if (raw.action === 'LIST_QDN_RESOURCES') return [listed(legacyRef, 'legacy-signature')];
      throw new Error(`Unexpected action ${raw.action}`);
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('other version')));

    const recovered = await recoverFolder(plan, ADDRESS, vi.fn());

    expect(recovered.matches).toHaveLength(0);
    expect(qdnMocks.resolvePublication).not.toHaveBeenCalled();
  });

  it('does not reuse saved receipts from another account or publisher name', async () => {
    const plan = await makePlan();
    const item = plan.files[0];
    qdnMocks.pendingPublications.mockReturnValue([
      { ref: item.ref, signature: 'wrong-account', address: 'QOtherAddress', contentHash: item.hash },
      { ref: { ...item.ref, name: 'OtherPublisher' }, signature: 'wrong-name', address: ADDRESS, contentHash: item.hash },
    ]);
    requestMock.mockResolvedValue([]);

    const recovered = await recoverFolder(plan, ADDRESS, vi.fn());

    expect(recovered.matches).toHaveLength(0);
    expect(recovered.unresolved).toEqual([]);
  });

  it('keeps a lost legacy response unresolved instead of trusting its content-shaped identifier', async () => {
    const plan = await makePlan();
    const item = plan.files[0];
    const unknown: JournalEntry = { ref: item.ref, address: ADDRESS };
    qdnMocks.pendingPublications.mockReturnValue([unknown]);
    requestMock.mockImplementation(async (raw: Request) => {
      if (raw.action === 'SEARCH_QDN_RESOURCES') return [];
      if (raw.action === 'SHOW_ACTIONS') return [];
      throw new Error(`Unexpected action ${raw.action}`);
    });

    const recovered = await recoverFolder(plan, ADDRESS, vi.fn());

    expect(recovered.matches).toHaveLength(0);
    expect(recovered.unresolved).toEqual([unknown]);
    expect(qdnMocks.resolvePublication).not.toHaveBeenCalled();
  });

  it('returns an unknown playlist publication for explicit checked clearing', async () => {
    const plan = await makePlan();
    const unknown: JournalEntry = {
      ref: { service: 'PLAYLIST', name: NAME, identifier: 'quixmix-list-lost-response' },
      address: ADDRESS,
      expectedHash: 'manifest-hash',
    };
    qdnMocks.pendingPublications.mockReturnValue([unknown]);
    requestMock.mockImplementation(async (raw: Request) => {
      if (raw.action === 'SEARCH_QDN_RESOURCES') return [];
      if (raw.action === 'SHOW_ACTIONS') return [];
      throw new Error(`Unexpected action ${raw.action}`);
    });

    const recovered = await recoverFolder(plan, ADDRESS, vi.fn());

    expect(recovered.unresolved).toEqual([unknown]);
    expect(qdnMocks.resolvePublication).not.toHaveBeenCalled();
  });

  it('preserves an unknown receipt when the listed bytes differ from its expected hash', async () => {
    const plan = await makePlan('first version');
    const item = plan.files[0];
    const unknown: JournalEntry = { ref: item.ref, address: ADDRESS, expectedHash: item.hash };
    qdnMocks.pendingPublications.mockReturnValue([unknown]);
    requestMock.mockImplementation(async (raw: Request) => {
      if (raw.action === 'SEARCH_QDN_RESOURCES') return [listed(item.ref, 'older-current-signature')];
      if (raw.action === 'GET_QDN_RESOURCE_URL') return 'https://example.test/wrong-current-bytes';
      if (raw.action === 'LIST_QDN_RESOURCES') return [listed(item.ref, 'older-current-signature')];
      if (raw.action === 'SHOW_ACTIONS') return [];
      throw new Error(`Unexpected action ${raw.action}`);
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('other version')));

    const recovered = await recoverFolder(plan, ADDRESS, vi.fn());

    expect(recovered.matches).toHaveLength(0);
    expect(recovered.unresolved).toEqual([unknown]);
    expect(qdnMocks.resolvePublication).not.toHaveBeenCalled();
  });

  it('preserves a saved receipt when the currently listed version has another signature', async () => {
    const plan = await makePlan();
    const item = plan.files[0];
    const saved: JournalEntry = {
      ref: item.ref,
      signature: 'saved-pending-signature',
      address: ADDRESS,
      contentHash: item.hash,
    };
    qdnMocks.pendingPublications.mockReturnValue([saved]);
    requestMock.mockImplementation(async (raw: Request) => {
      if (raw.action === 'SEARCH_QDN_RESOURCES') return [listed(item.ref, 'different-current-signature')];
      if (raw.action === 'SHOW_ACTIONS') return [];
      throw new Error(`Unexpected action ${raw.action}`);
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const recovered = await recoverFolder(plan, ADDRESS, vi.fn());

    expect(recovered.matches).toHaveLength(0);
    expect(recovered.unresolved).toEqual([saved]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(qdnMocks.resolvePublication).not.toHaveBeenCalled();
  });

  it('fails closed when a legacy resource changes version while its bytes are hashed', async () => {
    const plan = await makePlan('published bytes');
    const legacyRef: ResourceRef = { ...plan.files[0].ref, identifier: 'quixmix-legacy-race' };
    requestMock.mockImplementation(async (raw: Request) => {
      if (raw.action === 'SEARCH_QDN_RESOURCES') return [listed(legacyRef, 'before-hash')];
      if (raw.action === 'GET_QDN_RESOURCE_URL') return 'https://example.test/racing-audio';
      if (raw.action === 'LIST_QDN_RESOURCES') return [listed(legacyRef, 'after-hash')];
      throw new Error(`Unexpected action ${raw.action}`);
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('published bytes')));

    await expect(recoverFolder(plan, ADDRESS, vi.fn())).rejects.toThrow(/changed during verification/i);
    expect(qdnMocks.resolvePublication).not.toHaveBeenCalled();
  });
});

describe('reused references', () => {
  it('retargets both the upload list and nested playlist references without mutating the plan', async () => {
    const plan = await makePlan();
    const original = plan.files[0].ref;
    const recovered: ResourceRef = { ...original, identifier: 'quixmix-legacy-sequential-id' };

    const reused = reuseReferences(plan, new Map([[publicationKey(original), recovered]]));

    expect(reused.files[0].ref).toEqual(recovered);
    expect(reused.playlist.tracks[0].versions.audio?.resource).toEqual(recovered);
    expect(plan.files[0].ref).toEqual(original);
    expect(plan.playlist.tracks[0].versions.audio?.resource).toEqual(original);
  });
});

describe('submission capacity', () => {
  it('continues immediately with fewer than 20 unconfirmed account transactions', async () => {
    requestMock.mockImplementation(async (raw: Request) => {
      if (raw.path === `/addresses/publickey/${ADDRESS}`) return { ok: true, data: PUBLIC_KEY };
      if (raw.path === `/transactions/unconfirmed?creator=${PUBLIC_KEY}&limit=20`) {
        return { ok: true, data: Array.from({ length: 19 }, (_, id) => ({ id })) };
      }
      throw new Error(`Unexpected path ${String(raw.path)}`);
    });
    const progress = vi.fn();

    await expect(waitForSubmissionCapacity(ADDRESS, progress, () => false)).resolves.toBe(true);

    expect(requestMock).toHaveBeenCalledTimes(2);
    expect(requestMock).toHaveBeenNthCalledWith(1, expect.objectContaining({
      action: 'FETCH_NODE_API',
      path: `/addresses/publickey/${ADDRESS}`,
    }));
    expect(requestMock).toHaveBeenNthCalledWith(2, expect.objectContaining({
      action: 'FETCH_NODE_API',
      path: `/transactions/unconfirmed?creator=${PUBLIC_KEY}&limit=20`,
    }));
    expect(progress).not.toHaveBeenCalled();
  });

  it('waits at 20 unconfirmed transactions and continues after capacity is released', async () => {
    vi.useFakeTimers();
    let capacityReads = 0;
    requestMock.mockImplementation(async (raw: Request) => {
      if (raw.path === `/addresses/publickey/${ADDRESS}`) return { ok: true, data: PUBLIC_KEY };
      if (raw.path === `/transactions/unconfirmed?creator=${PUBLIC_KEY}&limit=20`) {
        capacityReads += 1;
        const length = capacityReads === 1 ? 20 : 19;
        return { ok: true, data: Array.from({ length }, (_, id) => ({ id })) };
      }
      throw new Error(`Unexpected path ${String(raw.path)}`);
    });
    const progress = vi.fn();

    const capacity = waitForSubmissionCapacity(ADDRESS, progress, () => false);
    await vi.advanceTimersByTimeAsync(5000);

    await expect(capacity).resolves.toBe(true);
    expect(requestMock).toHaveBeenCalledTimes(3);
    expect(progress).toHaveBeenCalledWith(expect.stringMatching(/20 or more.*pending/i));
  });

  it('stops when paused while the pending-transaction read is in flight', async () => {
    let paused = false;
    let release!: (value: unknown) => void;
    requestMock.mockImplementation(async (raw: Request) => {
      if (raw.path === `/addresses/publickey/${ADDRESS}`) return { ok: true, data: PUBLIC_KEY };
      if (raw.path === `/transactions/unconfirmed?creator=${PUBLIC_KEY}&limit=20`) {
        return new Promise(resolve => { release = resolve; });
      }
      throw new Error(`Unexpected path ${String(raw.path)}`);
    });

    const capacity = waitForSubmissionCapacity(ADDRESS, vi.fn(), () => paused);
    await vi.waitFor(() => expect(requestMock).toHaveBeenCalledTimes(2));
    paused = true;
    release({ ok: true, data: [] });

    await expect(capacity).resolves.toBe(false);
    expect(requestMock).toHaveBeenCalledTimes(2);
  });

  it('returns a paused result without reading the node', async () => {
    await expect(waitForSubmissionCapacity(ADDRESS, vi.fn(), () => true)).resolves.toBe(false);
    expect(requestMock).not.toHaveBeenCalled();
  });
});
