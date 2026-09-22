import { test, expect } from '@playwright/test';
import { installCommentaryBridge, commentaryRoute } from './commentary-fixture';

for (const option of ['', '?commentary=false', '?commentary=TRUE', '?commentary=true&commentary=false']) {
  test(`commentary stays hidden without an unambiguous opt-in: ${option || 'plain'}`, async ({page}, testInfo) => {
    await installCommentaryBridge(page);
    await page.goto('/#/playlist/Owner/test-list'+option);
    await expect(page.locator('.share-link code')).toBeVisible();
    await expect(page.locator('.transcripts').getByRole('heading', {name:/Lyrics/})).toBeVisible();
    await expect.poll(()=>page.locator('video').evaluate(v=>(v as HTMLVideoElement).duration)).toBeGreaterThan(0);
    await expect(page.getByRole('checkbox',{name:'Commentary',exact:true})).toHaveCount(0);
    await expect(page.getByTestId('commentary-overlay')).toHaveCount(0);
    await expect(page.locator('.transcripts').getByRole('heading',{name:/Commentary/})).toHaveCount(0);
    expect(await page.evaluate(()=>(window as any).textRequests)).not.toContain('commentary');
    if (!option) await page.screenshot({path:testInfo.outputPath('default.png'),fullPage:true});
  });
}

test('opted-in links enable commentary, preserve copy links and allow unchecking', async ({page,context},testInfo)=>{
  await context.grantPermissions(['clipboard-read','clipboard-write']);
  await installCommentaryBridge(page);
  await page.goto(commentaryRoute);
  const toggle=page.getByRole('checkbox',{name:'Commentary',exact:true});
  await expect(toggle).toBeChecked();
  await expect(page.getByTestId('commentary-overlay')).toBeVisible();
  await expect(page.locator('.transcripts').getByRole('heading',{name:/Commentary/})).toBeVisible();
  await page.getByRole('button',{name:'Copy link',exact:true}).click();
  expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe('qdn://APP/QuixMix/QuixMix#/playlist/Owner/test-list?commentary=true');
  await page.screenshot({path:testInfo.outputPath('opt-in.png'),fullPage:true});
  await toggle.uncheck();
  await expect(page.getByTestId('commentary-overlay')).toHaveCount(0);
  await expect(page.locator('.transcripts').getByRole('heading',{name:/Commentary/})).toHaveCount(0);
  await page.evaluate(()=>window.dispatchEvent(new HashChangeEvent('hashchange')));
  await expect(toggle).not.toBeChecked();
  await page.getByRole('button',{name:'Load demo'}).click();
  await expect(toggle).toHaveCount(0);
});

test('changing only commentary keeps media and playlist playback intact',async({page})=>{
  await installCommentaryBridge(page);
  await page.goto('/#/playlist/Owner/test-list');
  await expect(page.locator('.share-link')).toBeVisible();
  await expect.poll(()=>page.locator('video').evaluate(v=>(v as HTMLVideoElement).readyState)).toBeGreaterThan(2);
  await page.getByRole('button',{name:'Play',exact:true}).click();
  await expect(page.getByRole('button',{name:'Pause',exact:true})).toBeVisible();
  await page.evaluate(()=>{const v=document.querySelector('video')!;v.currentTime=5;v.dataset.mounted='yes';(window as any).sourceLoads=0;v.addEventListener('loadstart',()=>{(window as any).sourceLoads++;});});
  await page.evaluate(()=>{location.hash='#/playlist/Owner/test-list?commentary=true';});
  await expect(page.getByRole('checkbox',{name:'Commentary',exact:true})).toBeChecked();
  await expect(page.getByTestId('commentary-overlay')).toBeVisible();
  await page.evaluate(()=>{location.hash='#/playlist/Owner/test-list';});
  await expect(page.getByRole('checkbox',{name:'Commentary',exact:true})).toHaveCount(0);
  await expect(page.locator('video[data-mounted="yes"]')).toHaveCount(1);
  await expect(page.getByRole('button',{name:'Pause',exact:true})).toBeVisible();
  expect(await page.locator('video').evaluate(v=>(v as HTMLVideoElement).currentTime)).toBeGreaterThanOrEqual(5);
  expect(await page.evaluate(()=>(window as any).sourceLoads)).toBe(0);
  expect(await page.evaluate(()=>(window as any).playlistRequests)).toBe(1);
});

test('an option change while the playlist loads wins without a second playlist fetch',async({page})=>{
  await installCommentaryBridge(page,800);
  await page.goto(commentaryRoute);
  await expect.poll(()=>page.evaluate(()=>(window as any).playlistRequests)).toBe(1);
  await page.evaluate(()=>{location.hash='#/playlist/Owner/test-list';});
  await expect(page.locator('.share-link code')).toHaveText('qdn://APP/QuixMix/QuixMix#/playlist/Owner/test-list');
  await expect(page.getByRole('checkbox',{name:'Commentary',exact:true})).toHaveCount(0);
  expect(await page.evaluate(()=>(window as any).playlistRequests)).toBe(1);
});
