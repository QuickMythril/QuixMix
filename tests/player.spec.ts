import { expect, test, type Locator, type Page } from '@playwright/test';

const mediaSelector = 'video[aria-label="Current track media"]';

async function waitForMedia(page: Page, extension: '.mp3' | '.mp4') {
  await expect.poll(async () => page.locator(mediaSelector).evaluate((media: HTMLMediaElement) => ({
    src: media.currentSrc,
    duration: media.duration,
    readyState: media.readyState,
  }))).toMatchObject({
    src: expect.stringContaining(extension),
    duration: expect.any(Number),
  });
  await expect.poll(() => page.locator(mediaSelector).evaluate(
    (media: HTMLMediaElement) => Number.isFinite(media.duration) && media.duration > 17,
  )).toBe(true);
}

async function seekWithControl(seek: Locator, seconds: number) {
  await seek.fill(String(seconds));
}

async function mediaTime(page: Page) {
  return page.locator(mediaSelector).evaluate((media: HTMLMediaElement) => media.currentTime);
}

type TestPlaylist = {
  kind: 'qortium-music-playlist';
  schemaVersion: 1;
  title: string;
  tracks: Array<{
    id: string;
    title: string;
    artist: string;
    defaultVersion: 'audio' | 'video';
    switchPolicy: 'aligned' | 'restart';
    versions: Record<string, { resource: { service: 'AUDIO' | 'VIDEO'; name: string; identifier: string } }>;
  }>;
};

async function openBridgePlaylist(
  page: Page,
  playlist: TestPlaylist,
  mediaUrls: Record<string, string>,
  mediaDelayMs = 0,
) {
  await page.addInitScript(({ value, urls, delayMs }) => {
    const testWindow = window as typeof window & {
      __qdnMediaRequests?: string[];
      qdnRequest?: (request: Record<string, unknown>) => Promise<unknown>;
    };
    testWindow.__qdnMediaRequests = [];
    testWindow.qdnRequest =
      async (request) => {
        const action = String(request.action ?? '');
        if (action === 'SHOW_ACTIONS') return ['FETCH_QDN_RESOURCE', 'GET_QDN_RESOURCE_STATUS', 'GET_QDN_RESOURCE_URL'];
        if (action === 'WHICH_UI') return 'QORTIUM_HOME';
        if (action === 'GET_QDN_RESOURCE_STATUS') return { status: 'READY' };
        if (action === 'FETCH_QDN_RESOURCE') return btoa(JSON.stringify(value));
        if (action === 'GET_QDN_RESOURCE_URL') {
          testWindow.__qdnMediaRequests?.push(String(request.identifier ?? ''));
          if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
          return urls[String(request.identifier ?? '')] ?? '/demo/missing.mp3';
        }
        throw new Error(`Unexpected test bridge action: ${action}`);
      };
  }, { value: playlist, urls: mediaUrls, delayMs: mediaDelayMs });
  await page.reload();
  await page.getByText('Open a QDN playlist', { exact: true }).click();
  await page.getByLabel('Publisher name').fill('TestPublisher');
  await page.getByLabel('Playlist identifier').fill('test-playlist');
  await page.getByRole('button', { name: 'Open playlist', exact: true }).click();
  await expect(page.getByRole('heading', { name: playlist.tracks[0].title, exact: true })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'First light', exact: true })).toBeVisible();
});

test('the demo plays and seeking updates the top commentary and bottom lyrics', async ({ page }) => {
  await waitForMedia(page, '.mp4');
  const media = page.locator(mediaSelector);

  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await expect.poll(() => mediaTime(page)).toBeGreaterThan(0.15);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();

  await seekWithControl(page.getByRole('slider', { name: 'Seek' }), 7);
  await expect(page.getByTestId('commentary-overlay')).toContainText(
    'Seek backward or pause. Both text layers follow the media position.',
  );
  await expect(page.getByTestId('lyrics-overlay')).toContainText('A quiet place to start again');

  const positions = await Promise.all([
    page.getByTestId('commentary-overlay').boundingBox(),
    page.getByTestId('lyrics-overlay').boundingBox(),
  ]);
  expect(positions[0]).not.toBeNull();
  expect(positions[1]).not.toBeNull();
  expect(positions[0]!.y).toBeLessThan(positions[1]!.y);
  await expect(media).toHaveAttribute('src', /first-light\.mp4$/);
});

test('aligned Audio and Video switches preserve position and Audio only selects MP3', async ({ page }) => {
  await waitForMedia(page, '.mp4');
  await seekWithControl(page.getByRole('slider', { name: 'Seek' }), 9);

  await page.getByRole('button', { name: 'Audio', exact: true }).click();
  await waitForMedia(page, '.mp3');
  await expect.poll(() => mediaTime(page)).toBeGreaterThan(8.5);
  await expect.poll(() => mediaTime(page)).toBeLessThan(9.5);

  await page.getByRole('button', { name: 'Video', exact: true }).click();
  await waitForMedia(page, '.mp4');
  await expect.poll(() => mediaTime(page)).toBeGreaterThan(8.5);
  await expect.poll(() => mediaTime(page)).toBeLessThan(9.5);

  await page.getByLabel('Audio only').check();
  await waitForMedia(page, '.mp3');
  await expect(page.getByRole('button', { name: 'Video', exact: true })).toBeDisabled();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('music.audioOnly'))).toBe('true');
  await expect.poll(() => mediaTime(page)).toBeGreaterThan(8.5);
});

test('manual Next bypasses Repeat One', async ({ page }) => {
  await waitForMedia(page, '.mp4');
  await page.getByLabel('Repeat').selectOption('one');
  await page.getByRole('button', { name: 'Next track' }).click();

  await expect(page.getByRole('heading', { name: 'Quiet morning', exact: true })).toBeVisible();
  await waitForMedia(page, '.mp3');
});

test('Audio only clears loading when an in-flight video leaves no eligible track', async ({ page }) => {
  const playlist: TestPlaylist = {
    kind: 'qortium-music-playlist',
    schemaVersion: 1,
    title: 'Delayed video',
    tracks: [{
      id: 'only-video',
      title: 'Only delayed video',
      artist: 'Test',
      defaultVersion: 'video',
      switchPolicy: 'restart',
      versions: {
        video: { resource: { service: 'VIDEO', name: 'TestPublisher', identifier: 'slow-video' } },
      },
    }],
  };
  await openBridgePlaylist(page, playlist, { 'slow-video': '/demo/first-light.mp4' }, 3_000);
  await expect(page.locator('.loading-badge')).toBeVisible();

  await page.getByLabel('Audio only').check();
  await expect(page.getByRole('heading', { name: 'Nothing to play', exact: true })).toBeVisible();
  await expect(page.getByText('No audio versions in this playlist. Turn off Audio only to play video.')).toBeVisible();
  await expect(page.locator('.loading-badge')).toHaveCount(0);
  await page.waitForTimeout(3_100);
  await expect(page.locator('.loading-badge')).toHaveCount(0);
  await expect.poll(() => page.locator(mediaSelector).evaluate((media: HTMLMediaElement) => media.currentSrc)).toBe('');

  await page.getByLabel('Audio only').uncheck();
  await expect(page.getByRole('heading', { name: 'Only delayed video', exact: true })).toBeVisible();
  await waitForMedia(page, '.mp4');
});

test('a stale play rejection cannot cancel playback intent for a new source', async ({ page }) => {
  await page.addInitScript(() => {
    const originalPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function playWithDelayedVideoRejection() {
      const source = this.currentSrc || this.getAttribute('src') || '';
      if (source.endsWith('.mp4')) {
        return new Promise((_, reject) => {
          setTimeout(() => reject(new DOMException('old source was replaced', 'AbortError')), 500);
        });
      }
      return originalPlay.call(this);
    };
  });
  await page.reload();
  await waitForMedia(page, '.mp4');

  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Audio', exact: true }).click();
  await waitForMedia(page, '.mp3');
  await page.waitForTimeout(600);

  await expect(page.getByText(/Playback needs a tap|Tap Play to continue/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await expect.poll(() => mediaTime(page)).toBeGreaterThan(0.1);
});

test('a failure at the end does not wrap completed tracks when Repeat is off', async ({ page }) => {
  const audioTrack = (id: string, title: string, identifier: string) => ({
    id,
    title,
    artist: 'Test',
    defaultVersion: 'audio' as const,
    switchPolicy: 'restart' as const,
    versions: {
      audio: { resource: { service: 'AUDIO' as const, name: 'TestPublisher', identifier } },
    },
  });
  const playlist: TestPlaylist = {
    kind: 'qortium-music-playlist',
    schemaVersion: 1,
    title: 'Failure order',
    tracks: [
      audioTrack('first', 'First completed', 'good-one'),
      audioTrack('second', 'Second completed', 'good-two'),
      audioTrack('third', 'Third unavailable', 'bad-three'),
    ],
  };
  await openBridgePlaylist(page, playlist, {
    'good-one': '/demo/first-light.mp3',
    'good-two': '/demo/first-light.mp3',
    'bad-three': '/demo/missing.mp3',
  });
  await waitForMedia(page, '.mp3');

  await page.getByRole('button', { name: 'Next track' }).click();
  await expect(page.getByRole('heading', { name: 'Second completed', exact: true })).toBeVisible();
  await waitForMedia(page, '.mp3');
  await page.getByRole('button', { name: 'Next track' }).click();
  await expect(page.getByRole('heading', { name: 'Third unavailable', exact: true })).toBeVisible();
  await expect(page.getByText('No remaining tracks are available.')).toBeVisible();
  await page.waitForTimeout(300);
  await expect(page.getByRole('heading', { name: 'Third unavailable', exact: true })).toBeVisible();
});

test('prefetch warms only the ordered next version after current metadata', async ({ page }) => {
  const audioTrack = (id: string, title: string) => ({
    id,
    title,
    artist: 'Test',
    defaultVersion: 'audio' as const,
    switchPolicy: 'restart' as const,
    versions: {
      audio: { resource: { service: 'AUDIO' as const, name: 'TestPublisher', identifier: id } },
    },
  });
  const playlist: TestPlaylist = {
    kind: 'qortium-music-playlist',
    schemaVersion: 1,
    title: 'Prefetch order',
    tracks: [audioTrack('prefetch-one', 'Prefetch one'), audioTrack('prefetch-two', 'Prefetch two'), audioTrack('prefetch-three', 'Prefetch three')],
  };
  await openBridgePlaylist(page, playlist, {
    'prefetch-one': '/demo/first-light.mp3',
    'prefetch-two': '/demo/first-light.mp3',
    'prefetch-three': '/demo/first-light.mp3',
  }, 1_200);

  await expect.poll(() => page.evaluate(() => (
    window as typeof window & { __qdnMediaRequests?: string[] }
  ).__qdnMediaRequests ?? [])).toEqual(['prefetch-one']);
  await waitForMedia(page, '.mp3');
  await expect.poll(() => page.evaluate(() => (
    window as typeof window & { __qdnMediaRequests?: string[] }
  ).__qdnMediaRequests ?? [])).toEqual(['prefetch-one', 'prefetch-two']);
  await page.waitForTimeout(1_400);
  expect(await page.evaluate(() => (
    window as typeof window & { __qdnMediaRequests?: string[] }
  ).__qdnMediaRequests ?? [])).toEqual(['prefetch-one', 'prefetch-two']);
});

test.describe('persisted Audio only', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('starts on MP3 without requesting MP4 and disables video-only queue entries', async ({ page }) => {
    const requests: string[] = [];
    page.on('request', (request) => requests.push(request.url()));
    await page.addInitScript(() => localStorage.setItem('music.audioOnly', 'true'));
    await page.reload();

    await waitForMedia(page, '.mp3');
    await expect(page.getByLabel('Audio only')).toBeChecked();
    await expect(page.getByRole('button', { name: 'Play Moving colors' })).toBeDisabled();
    await expect(page.getByText('Skipped · Audio only')).toBeVisible();
    expect(requests.filter((url) => /\.mp4(?:$|[?#])/.test(url))).toEqual([]);
  });
});

test.describe('mobile player', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('has no horizontal overflow and keeps both overlays in fullscreen fallback', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(Element.prototype, 'requestFullscreen', {
        configurable: true,
        value: () => Promise.reject(new Error('fullscreen unavailable in test host')),
      });
    });
    await page.reload();
    await waitForMedia(page, '.mp4');
    await seekWithControl(page.getByRole('slider', { name: 'Seek' }), 7);

    await expect.poll(() => page.evaluate(() => ({
      innerWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }))).toEqual({ innerWidth: 390, scrollWidth: 390 });

    await page.getByRole('button', { name: 'Fullscreen', exact: true }).click();
    const stage = page.locator('.player-stage');
    await expect(stage).toHaveClass(/immersive/);
    await expect(page.getByText('Expanded view — this host does not allow fullscreen.')).toBeVisible();
    await expect(page.getByTestId('commentary-overlay')).toBeVisible();
    await expect(page.getByTestId('lyrics-overlay')).toBeVisible();

    const boxes = await Promise.all([
      stage.boundingBox(),
      page.getByTestId('commentary-overlay').boundingBox(),
      page.getByTestId('lyrics-overlay').boundingBox(),
      page.locator('.stage-controls').boundingBox(),
    ]);
    const [stageBox, commentaryBox, lyricsBox, controlsBox] = boxes;
    expect(stageBox).not.toBeNull();
    expect(commentaryBox).not.toBeNull();
    expect(lyricsBox).not.toBeNull();
    expect(controlsBox).not.toBeNull();
    expect(commentaryBox!.y).toBeGreaterThanOrEqual(stageBox!.y);
    expect(commentaryBox!.y + commentaryBox!.height).toBeLessThan(lyricsBox!.y);
    expect(lyricsBox!.y + lyricsBox!.height).toBeLessThanOrEqual(controlsBox!.y + 1);
    expect(stageBox!.x).toBeGreaterThanOrEqual(0);
    expect(stageBox!.x + stageBox!.width).toBeLessThanOrEqual(390);
  });
});

test('the ended event advances to the next track and keeps playback intent', async ({ page }) => {
  await waitForMedia(page, '.mp4');
  await page.locator(mediaSelector).evaluate((media: HTMLMediaElement) => {
    media.currentTime = Math.max(0, media.duration - 0.35);
  });
  await page.getByRole('button', { name: 'Play', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Quiet morning', exact: true })).toBeVisible({ timeout: 10_000 });
  await waitForMedia(page, '.mp3');
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
});

test('malformed JSON import leaves the active demo intact and reports an error', async ({ page }) => {
  await page.getByRole('button', { name: 'Create playlist' }).click();
  await page.getByText('Import or inspect JSON').click();
  await page.getByLabel('Playlist JSON').fill('{ broken');
  await page.getByRole('button', { name: 'Import JSON' }).click();
  await expect(page.getByText(/Import failed:/)).toBeVisible();

  await page.getByRole('button', { name: 'Listen', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'First light', exact: true })).toBeVisible();
});
