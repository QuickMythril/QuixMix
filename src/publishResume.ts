import { contentHash } from './contentHash';
import type { FolderPlan, PlannedFile } from './folderPlan';
import type { ResourceRef } from './model';
import { pendingPublications, resolvePublication, type JournalEntry } from './qdn';
import { qdnRequest } from './qdnRequest';

export const publicationKey = (ref: ResourceRef) => JSON.stringify([ref.service, ref.name, ref.identifier]);
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
type Listed = ResourceRef & { latestSignature: string };
export interface Recovery { matches: Map<string, ResourceRef>; unresolved: JournalEntry[] }

async function read(payload: Parameters<typeof qdnRequest>[0]) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([qdnRequest(payload), new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Recovery check timed out. No new files were published.')), 30_000);
  })]); } finally { clearTimeout(timer); }
}
async function listing(name: string): Promise<Listed[]> {
  const all: Listed[] = [];
  for (let offset = 0; ; offset += 100) {
    const page = await read({action:'SEARCH_QDN_RESOURCES',name,exactMatchNames:true,query:'quixmix-',mode:'ALL',limit:100,offset});
    if (!Array.isArray(page)) throw new Error('Home returned an invalid recovery listing.');
    for (const row of page) {
      if (record(row) && row.name === name && typeof row.identifier === 'string' && row.identifier.startsWith('quixmix-') &&
          ['AUDIO','VIDEO','IMAGE','FILE','PLAYLIST'].includes(String(row.service)) && typeof row.latestSignature === 'string') all.push({service:row.service as ResourceRef['service'],name,identifier:row.identifier,latestSignature:row.latestSignature});
    }
    if (page.length < 100) return all;
    if (offset >= 9900) throw new Error('Too many resources to check safely in one recovery pass.');
  }
}
async function remoteHash(ref: ResourceRef, maxBytes: number): Promise<string | undefined> {
  const value = await read({action:'GET_QDN_RESOURCE_URL',...ref});
  const url = typeof value === 'string' ? value : record(value) ? value.url ?? value.resourceUrl ?? value.href : undefined;
  if (typeof url !== 'string' || !['https:','http:','qortium-home-resource:','blob:'].includes(new URL(url).protocol)) throw new Error('Home returned an invalid verification URL.');
  const response = await fetch(url, {signal:AbortSignal.timeout(60_000)});
  if (!response.ok || !response.body) throw new Error(`Could not read ${ref.service}/${ref.identifier} for recovery. Try again when it is available.`);
  // Resource listing sizes describe compressed data, not the bytes the listener receives.
  if (Number(response.headers.get('content-length')) > maxBytes) { await response.body.cancel(); return undefined; }
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      length += part.value.length;
      if (length > maxBytes) { await reader.cancel(); return undefined; }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return contentHash(bytes.buffer);
}
async function knownOnNode(entry: JournalEntry) {
  if (!entry.signature) return false;
  const result = await read({action:'FETCH_NODE_API',path:`/transactions/signature/${encodeURIComponent(entry.signature)}`,maxBytes:256*1024});
  if (!record(result)) throw new Error('Invalid transaction lookup response.');
  if (result.ok !== true) {
    if (result.status === 404 || (record(result.data) && result.data.error === 311)) return false;
    throw new Error('The node could not verify the saved transaction. Retry recovery before publishing.');
  }
  return record(result.data) && result.data.signature === entry.signature && result.data.name === entry.ref.name && result.data.identifier === entry.ref.identifier;
}

/** A recovery pass is read-only on chain. Reuse requires byte proof, never filenames or compressed sizes. */
export async function recoverFolder(plan: FolderPlan, address: string, progress: (text: string) => void): Promise<Recovery> {
  const name = plan.files[0]?.ref.name;
  if (!name) throw new Error('No files selected.');
  const matches = new Map<string, ResourceRef>();
  const entries = pendingPublications().filter(e => e.address === address && e.ref.name === name && e.ref.identifier.startsWith('quixmix-'));
  progress('Checking saved receipts and previously published files…');
  const listed = await listing(name);
  const verified = new Set<string>();
  const conflicts = new Set<string>();
  const byFingerprint = new Map<string, ResourceRef>();
  for (const entry of entries) {
    const current = listed.find(row => publicationKey(row) === publicationKey(entry.ref));
    if (current && entry.signature && current.latestSignature !== entry.signature) {
      // Do not replace evidence for an in-flight or superseded write with another version.
      conflicts.add(publicationKey(entry.ref)); continue;
    }
    if (entry.contentHash && entry.signature && (current?.latestSignature === entry.signature || (!current && await knownOnNode(entry)))) {
      verified.add(publicationKey(entry.ref));
      byFingerprint.set(`${entry.ref.service}:${entry.contentHash}`, entry.ref);
    }
  }
  for (const row of listed) {
    if (verified.has(publicationKey(row)) || conflicts.has(publicationKey(row))) continue;
    if (row.service === 'PLAYLIST' && !entries.some(e => publicationKey(e.ref) === publicationKey(row))) continue;
    const candidates = plan.files.filter(item => item.ref.service === row.service);
    if (!candidates.length && row.service !== 'PLAYLIST') continue;
    progress(`Verifying published bytes: ${row.service}/${row.identifier}`);
    const hash = await remoteHash(row, row.service === 'PLAYLIST' ? 1024*1024 : Math.max(...candidates.map(item => item.file.size)));
    // Pin the byte comparison to the same version even if another publisher updates during fetch.
    const after = await read({action:'LIST_QDN_RESOURCES',service:row.service,name,identifier:row.identifier,exactMatchNames:true,limit:20,offset:0});
    if (!Array.isArray(after) || !after.some(v => record(v) && v.name === name && v.identifier === row.identifier && v.latestSignature === row.latestSignature)) throw new Error('A published file changed during verification. Run recovery again.');
    if (hash) {
      const prior=entries.find(e => publicationKey(e.ref) === publicationKey(row));
      if (prior?.expectedHash && prior.expectedHash !== hash) continue;
      // Unrelated old content need not occupy a receipt for this upload plan.
      if (!prior && row.service !== 'PLAYLIST' && !candidates.some(item => item.hash === hash)) continue;
      const ref:ResourceRef = {service:row.service,name:row.name,identifier:row.identifier};
      resolvePublication(ref, row.latestSignature, address, hash);
      verified.add(publicationKey(row));
      byFingerprint.set(`${row.service}:${hash}`, ref);
    }
  }
  for (const item of plan.files) {
    const ref = byFingerprint.get(`${item.ref.service}:${item.hash}`);
    if (ref) matches.set(publicationKey(item.ref), ref);
  }
  // A lost legacy response has no fingerprint: do not bypass it with a new content identifier.
  const unresolved = entries.filter(e => !verified.has(publicationKey(e.ref)));
  if (unresolved.length) {
    const actions = await read({action:'SHOW_ACTIONS'});
    if (Array.isArray(actions) && actions.includes('GET_PENDING_TRANSACTIONS')) {
      const pending = await read({action:'GET_PENDING_TRANSACTIONS'});
      if (!record(pending) || !Array.isArray(pending.entries)) throw new Error('Invalid Home pending transaction response.');
      for (const entry of unresolved) {
        const found = pending.entries.find(v => record(v) && record(v.target) && v.target.kind === 'resource' && v.target.name === entry.ref.name && v.target.service === entry.ref.service && v.target.identifier === entry.ref.identifier);
        if (!entry.signature && record(found) && typeof found.signature === 'string') {
          entry.signature = found.signature;
          // Journal signatures alone cannot prove which bytes an interrupted native picker submitted.
          resolvePublication(entry.ref, found.signature, address, entry.contentHash);
        }
      }
    }
  }
  return {matches, unresolved};
}

export function reuseReferences(plan: FolderPlan, matches: Map<string, ResourceRef>): FolderPlan {
  const playlist = structuredClone(plan.playlist);
  const replace = <T extends ResourceRef>(ref: T): T => ({...ref,...matches.get(publicationKey(ref))});
  for (const track of playlist.tracks) {
    if (track.cover) track.cover = replace(track.cover);
    if (track.lyrics) track.lyrics = replace(track.lyrics);
    if (track.commentary) track.commentary = replace(track.commentary);
    for (const version of Object.values(track.versions)) {
      version.resource = replace(version.resource);
      if (version.lyrics) version.lyrics = replace(version.lyrics);
      if (version.commentary) version.commentary = replace(version.commentary);
    }
  }
  return {...plan, playlist, files:plan.files.map((item: PlannedFile) => ({...item,ref:replace(item.ref)}))};
}

/** Keep headroom below Core's default 25 pending transactions per account. */
export async function waitForSubmissionCapacity(address: string, progress: (text: string) => void, paused: () => boolean): Promise<boolean> {
  if (paused()) return false;
  const owner = await read({action:'FETCH_NODE_API',path:`/addresses/publickey/${encodeURIComponent(address)}`,maxBytes:1024});
  if (!record(owner) || owner.ok !== true || typeof owner.data !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{32,48}$/.test(owner.data)) throw new Error('Could not check the publishing account public key. Resume when the node is available.');
  const started = Date.now();
  while (!paused()) {
    const result = await read({action:'FETCH_NODE_API',path:`/transactions/unconfirmed?creator=${encodeURIComponent(owner.data)}&limit=20`,maxBytes:1024*1024});
    if (!record(result) || result.ok !== true || !Array.isArray(result.data)) throw new Error('Could not check pending transaction capacity. Resume when the node is available.');
    if (paused()) return false;
    if (result.data.length < 20) return true;
    progress('20 or more account transactions are pending. Waiting for room before submitting the next file…');
    if (Date.now() - started >= 300_000) throw new Error('The account still has 20 or more pending transactions. Saved receipts are safe; resume once some have confirmed.');
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  return false;
}
