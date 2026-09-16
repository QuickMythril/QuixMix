import { expect, test, type Locator, type Page } from '@playwright/test';

type AppearanceState = {
  theme: string | undefined;
  preference: string | undefined;
  accent: string | undefined;
  colorScheme: string;
};

async function appearance(page: Page): Promise<AppearanceState> {
  return page.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    preference: document.documentElement.dataset.themePreference,
    accent: document.documentElement.dataset.accent,
    colorScheme: document.documentElement.style.colorScheme,
  }));
}

async function openApp(page: Page, path = '/') {
  await page.goto(path);
  await expect(page.getByRole('heading', { name: 'First light', exact: true })).toBeVisible();
}

async function installHomeBridge(page: Page, accent = 'green', context = 'home') {
  await page.addInitScript(({ initialAccent, initialContext }) => {
    const host = window as typeof window & {
      _qdnAccent?: string;
      _qdnContext?: string;
      qdnRequest?: (request: Record<string, unknown>) => Promise<unknown>;
    };
    host._qdnAccent = initialAccent;
    host._qdnContext = initialContext;
    host.qdnRequest = async (request) => {
      if (request.action === 'SHOW_ACTIONS') return [];
      if (request.action === 'WHICH_UI') return 'QORTIUM_HOME';
      throw new Error(`Appearance test rejected bridge action: ${String(request.action)}`);
    };
  }, { initialAccent: accent, initialContext: context });
}

async function dispatchDisplayMessage(page: Page, data: Record<string, unknown>) {
  await page.evaluate((message) => window.postMessage(message, window.location.origin), data);
}

test('System follows prefers-color-scheme and updates while the page is open', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await openApp(page);
  await expect.poll(() => appearance(page)).toEqual({
    theme: 'light', preference: 'system', accent: 'neutral', colorScheme: 'light',
  });

  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(() => appearance(page)).toMatchObject({ theme: 'dark', preference: 'system', colorScheme: 'dark' });

  await page.emulateMedia({ colorScheme: 'light' });
  await expect.poll(() => appearance(page)).toMatchObject({ theme: 'light', preference: 'system', colorScheme: 'light' });
});

test('manual Light and Dark choices persist and override OS and Home theme changes', async ({ page }) => {
  await installHomeBridge(page);
  await page.emulateMedia({ colorScheme: 'dark' });
  await openApp(page);

  const picker = page.getByLabel('Theme');
  await picker.selectOption('light');
  await expect.poll(() => appearance(page)).toMatchObject({ theme: 'light', preference: 'light' });
  await expect.poll(() => page.evaluate(() => localStorage.getItem('music.theme'))).toBe('light');
  await page.reload();
  await expect.poll(() => appearance(page)).toMatchObject({ theme: 'light', preference: 'light' });

  await page.emulateMedia({ colorScheme: 'light' });
  await dispatchDisplayMessage(page, { action: 'DISPLAY_SETTINGS_CHANGED', theme: 'dark', qdnTheme: 'dark' });
  await expect.poll(() => appearance(page)).toMatchObject({ theme: 'light', preference: 'light' });

  await picker.selectOption('dark');
  await expect.poll(() => appearance(page)).toMatchObject({ theme: 'dark', preference: 'dark' });
  await expect.poll(() => page.evaluate(() => localStorage.getItem('music.theme'))).toBe('dark');
  await page.reload();
  await page.emulateMedia({ colorScheme: 'light' });
  await dispatchDisplayMessage(page, { action: 'DISPLAY_SETTINGS_CHANGED', theme: 'light', qdnTheme: 'light' });
  await expect.poll(() => appearance(page)).toMatchObject({ theme: 'dark', preference: 'dark' });
});

test('Home supplies named accents at startup and through both display messages', async ({ page }) => {
  await installHomeBridge(page, 'green');
  await openApp(page);
  await expect.poll(() => appearance(page)).toMatchObject({ accent: 'green' });

  await openApp(page, '/?accent=blue');
  await expect.poll(() => appearance(page)).toMatchObject({ accent: 'blue' });

  await dispatchDisplayMessage(page, { action: 'ACCENT_CHANGED', qdnAccent: 'purple' });
  await expect.poll(() => appearance(page)).toMatchObject({ accent: 'purple' });

  await dispatchDisplayMessage(page, { action: 'DISPLAY_SETTINGS_CHANGED', accent: 'orange' });
  await expect.poll(() => appearance(page)).toMatchObject({ accent: 'orange' });

  await dispatchDisplayMessage(page, { action: 'ACCENT_CHANGED', qdnAccent: 'not-a-real-accent' });
  await expect.poll(() => appearance(page)).toMatchObject({ accent: 'orange' });
});

test('Core gateway display defaults do not color the standalone app', async ({ page }) => {
  await installHomeBridge(page, 'green', 'gateway');
  await openApp(page, '/?accent=blue');
  await expect.poll(() => appearance(page)).toMatchObject({ accent: 'neutral' });

  await dispatchDisplayMessage(page, { action: 'ACCENT_CHANGED', qdnAccent: 'purple' });
  await expect.poll(() => appearance(page)).toMatchObject({ accent: 'neutral' });
});

function rgbChannels(value: string): [number, number, number] {
  const channels = value.match(/[\d.]+/g)?.slice(0, 3).map(Number);
  if (!channels || channels.length !== 3) throw new Error(`Expected an RGB color, received ${value}`);
  return channels as [number, number, number];
}

function luminance(value: string) {
  const channels = rgbChannels(value).map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrast(foreground: string, background: string) {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

async function renderedColors(locator: Locator) {
  return locator.evaluate((element) => {
    const foreground = getComputedStyle(element).color;
    let current: Element | null = element;
    let background = 'rgba(0, 0, 0, 0)';
    while (current) {
      background = getComputedStyle(current).backgroundColor;
      if (!background.endsWith(', 0)') && background !== 'transparent') break;
      current = current.parentElement;
    }
    return { foreground, background };
  });
}

test('main and editor surfaces have readable light and dark palettes', async ({ page }) => {
  await openApp(page);

  for (const theme of ['light', 'dark']) {
    await page.getByLabel('Theme').selectOption(theme);
    await expect.poll(() => appearance(page)).toMatchObject({ theme });

    const mainColors = await renderedColors(page.locator('.intro'));
    expect(contrast(mainColors.foreground, mainColors.background), `${theme} main contrast`).toBeGreaterThanOrEqual(4.5);
    if (theme === 'light') expect(luminance(mainColors.background), 'light main background').toBeGreaterThan(0.7);
    else expect(luminance(mainColors.background), 'dark main background').toBeLessThan(0.15);

    await page.getByRole('button', { name: 'Create playlist' }).click();
    const editorCard = page.locator('.editor-card').first();
    await expect(editorCard).toBeVisible();
    const cardColors = await renderedColors(editorCard);
    const inputColors = await renderedColors(editorCard.locator('input').first());
    expect(contrast(cardColors.foreground, cardColors.background), `${theme} editor card contrast`).toBeGreaterThanOrEqual(4.5);
    expect(contrast(inputColors.foreground, inputColors.background), `${theme} editor input contrast`).toBeGreaterThanOrEqual(4.5);
    if (theme === 'light') expect(luminance(cardColors.background), 'light editor background').toBeGreaterThan(0.7);
    else expect(luminance(cardColors.background), 'dark editor background').toBeLessThan(0.15);
    await page.getByRole('button', { name: 'Listen' }).click();
  }
});

async function platformFonts(page: Page, selector: string) {
  const session = await page.context().newCDPSession(page);
  await session.send('DOM.enable');
  await session.send('CSS.enable');
  const { root } = await session.send('DOM.getDocument');
  const { nodeId } = await session.send('DOM.querySelector', { nodeId: root.nodeId, selector });
  expect(nodeId, `DOM node for ${selector}`).not.toBe(0);
  const result = await session.send('CSS.getPlatformFontsForNode', { nodeId });
  await session.detach();
  return result.fonts as Array<{ familyName: string; glyphCount: number }>;
}

test('Lexend Variable is loaded and renders cue and editor text', async ({ page }) => {
  await openApp(page);
  await page.getByRole('slider', { name: 'Seek' }).fill('7');
  await expect(page.getByTestId('commentary-overlay')).toBeVisible();

  const loadedFaces = await page.evaluate(async () => {
    await document.fonts.ready;
    return Array.from(document.fonts).map((face) => ({ family: face.family, status: face.status }));
  });
  expect(loadedFaces).toContainEqual({ family: 'Lexend Variable', status: 'loaded' });
  await expect(page.getByTestId('commentary-overlay')).toHaveCSS('font-family', /Lexend Variable/);
  const cueFonts = await platformFonts(page, '[data-testid="commentary-overlay"] p');
  expect(cueFonts.some((font) => /Lexend/i.test(font.familyName) && font.glyphCount > 0)).toBe(true);

  await page.getByRole('button', { name: 'Create playlist' }).click();
  await expect(page.locator('.editor-heading h2')).toHaveCSS('font-family', /Lexend Variable/);
  const editorFonts = await platformFonts(page, '.editor-heading h2');
  expect(editorFonts.some((font) => /Lexend/i.test(font.familyName) && font.glyphCount > 0)).toBe(true);
});

test('mobile header, theme picker, and editor stay within the viewport in both themes', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openApp(page);

  for (const theme of ['light', 'dark']) {
    await page.getByLabel('Theme').selectOption(theme);
    await page.getByRole('button', { name: 'Create playlist' }).click();
    await expect(page.locator('.editor-shell')).toBeVisible();

    const layout = await page.evaluate(() => {
      const selectors = ['.app-header', '.app-header nav', '.theme-picker', '.theme-picker select', '.editor-shell'];
      return {
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        boxes: selectors.map((selector) => {
          const rect = document.querySelector(selector)!.getBoundingClientRect();
          return { selector, left: rect.left, right: rect.right, width: rect.width };
        }),
      };
    });
    expect(layout.scrollWidth, `${theme} document width`).toBeLessThanOrEqual(layout.clientWidth);
    for (const box of layout.boxes) {
      expect(box.left, `${theme} ${box.selector} left edge`).toBeGreaterThanOrEqual(0);
      expect(box.right, `${theme} ${box.selector} right edge`).toBeLessThanOrEqual(layout.clientWidth);
      expect(box.width, `${theme} ${box.selector} width`).toBeGreaterThan(0);
    }
    await page.getByRole('button', { name: 'Listen' }).click();
  }
});
