export async function contentHash(bytes: ArrayBuffer): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('File verification needs a secure browser context. Open QuixMix inside Home or on localhost.');
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
export async function hashFile(file: File) { return contentHash(await file.arrayBuffer()); }
