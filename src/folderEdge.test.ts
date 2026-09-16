import { it, expect } from 'vitest';
import { importFolder } from './folderImport';
function f(name: string, content = '') { const file = new File([content], name.split('/').at(-1)!); Object.defineProperty(file, 'webkitRelativePath', { value: `Album/${name}` }); return file; }
it('does not silently overwrite canonically equivalent paths', async () => {
  await expect(importFolder([f('01 - Artist - Café.mp3'), f('01 - Artist - Cafe\u0301.mp3')])).rejects.toThrow(/duplicate|ambiguous|same|collid/i);
});
it('handles a single plain File without stripping its filename as a directory', async () => {
  const album = await importFolder([new File([''], '01 - Artist - Song.mp3')]);
  expect(album.tracks).toHaveLength(1);
});
it('audio and video suffixes without a language still target only their version', async () => {
  const album = await importFolder([f('01 - Artist - Song.mp3'), f('01 - Artist - Song.mp4'), f('01 - Artist - Song.audio.srt'), f('01 - Artist - Song.video.srt')]);
  expect(album.tracks[0].audioLyrics?.path).toBe('01 - Artist - Song.audio.srt');
  expect(album.tracks[0].videoLyrics?.path).toBe('01 - Artist - Song.video.srt');
});
