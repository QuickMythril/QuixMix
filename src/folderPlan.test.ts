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
  it('deduplicates shared text, preserves timing and generates stable content identities', async () => {
    const plan = await planFolder(album());
    const repeated = await planFolder(album());
    expect(plan.files).toHaveLength(3);
    expect(plan.files[2].file.name).toBe('song.en.vtt');
    expect(await plan.files[2].file.text()).toContain('00:02:36.861 --> 00:02:40.000');
    expect(plan.playlist.tracks[0].artist).toBe('Unknown artist');
    expect(plan.playlist.tracks[0].versions.audio?.lyrics).toEqual(plan.playlist.tracks[0].versions.video?.lyrics);
    expect(plan.playlist.tracks[0].versions.video?.timelineOffsetMs).toBeUndefined();
    expect(repeated.identifier).toBe(plan.identifier);
    expect(repeated.files.map(item => item.ref)).toEqual(plan.files.map(item => item.ref));
  });
  it('changes a file content identity when its bytes change', async () => {
    const original = album();
    const changed = album();
    changed.tracks[0].audio = asset('song.mp3', 'changed audio bytes');
    const first = await planFolder(original);
    const second = await planFolder(changed);
    const firstAudio = first.files.find(item => item.ref.service === 'AUDIO');
    const secondAudio = second.files.find(item => item.ref.service === 'AUDIO');
    expect(secondAudio?.ref.identifier).not.toBe(firstAudio?.ref.identifier);
  });
  it('keeps identical bytes in different services as distinct planned resources', async () => {
    const plan = await planFolder(album());
    const media = plan.files.filter(item => item.path === 'song.mp3' || item.path === 'song.mp4');
    expect(media).toHaveLength(2);
    expect(new Set(media.map(item => item.ref.service))).toEqual(new Set(['AUDIO', 'VIDEO']));
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
