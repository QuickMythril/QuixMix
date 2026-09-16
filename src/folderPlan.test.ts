import { describe, it, expect } from 'vitest';
import { planFolder, forPublisher } from './folderPlan';
import type { ImportedAlbum, ImportAsset } from './folderImport';
const asset = (name: string, text = ''): ImportAsset => ({ path: name, file: new File([text], name) });
const captions = '1\n00:02:36,861 --> 00:02:40,000\nAlready timed text\n';
function album(): ImportedAlbum {
  const lyrics = asset('song.en.srt', captions);
  return { title: 'Album', warnings: [], ignored: [], tracks: [{ id: 'one', number: 1, title: 'Song', artist: '', switchPolicy: 'restart', audio: asset('song.mp3'), video: asset('song.mp4'), audioLyrics: lyrics, videoLyrics: lyrics }] };
}
describe('folder plans', () => {
  it('deduplicates shared text, preserves timing and generates independent publication identities', async () => {
    const plan = await planFolder(album());
    expect(plan.files).toHaveLength(3);
    expect(plan.files[2].file.name).toBe('song.en.vtt');
    expect(await plan.files[2].file.text()).toContain('00:02:36.861 --> 00:02:40.000');
    expect(plan.playlist.tracks[0].artist).toBe('Unknown artist');
    expect(plan.playlist.tracks[0].versions.audio?.lyrics).toEqual(plan.playlist.tracks[0].versions.video?.lyrics);
    expect(plan.playlist.tracks[0].versions.video?.timelineOffsetMs).toBeUndefined();
    expect((await planFolder(album())).identifier).not.toBe(plan.identifier);
  });
  it('retargets every reference without mutating the local preview plan', async () => {
    const plan = await planFolder(album());
    const target = forPublisher(plan, 'Publisher', 'New title');
    expect(target.playlist.title).toBe('New title');
    expect(target.files.every(item => item.ref.name === 'Publisher')).toBe(true);
    expect(target.playlist.tracks[0].versions.video?.lyrics?.name).toBe('Publisher');
    expect(plan.playlist.tracks[0].versions.video?.lyrics?.name).toBe('LocalFolder');
  });
  it('rejects folders with no tracks before replacing the current import', async () => {
    await expect(planFolder({title:'Empty',tracks:[],warnings:[],ignored:[]})).rejects.toThrow(/No audio or video/);
  });
});
