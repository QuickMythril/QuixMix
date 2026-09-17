import { test, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, copyFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

let root: string;
const srt = (text: string) => `1\n00:00:00,000 --> 00:00:15,000\n${text}\n`;
test.beforeEach(async () => { root = await mkdtemp(path.join(os.tmpdir(), 'quixmix-folder-')); });
test.afterEach(async () => { await rm(root, { recursive: true, force: true }); });
async function albumFiles() {
  await copyFile('public/demo/first-light.mp3', path.join(root, '02 - Artist - Early.mp3'));
  await copyFile('public/demo/first-light.mp4', path.join(root, '02 - Artist - Early.mp4'));
  await writeFile(path.join(root, '02 - Artist - Early.audio.en.srt'), srt('Audio version lyrics'));
  await writeFile(path.join(root, '02 - Artist - Early.video.en.srt'), srt('Video version lyrics'));
  await copyFile('public/demo/first-light.mp3', path.join(root, '10 - Artist - Later.mp3'));
  await writeFile(path.join(root, 'notes.txt'), 'Not playlist media');
}
async function choose(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'Create playlist', exact: true }).click();
  await page.getByLabel('Choose album folder', { exact: true }).setInputFiles(root);
  await expect(page.getByRole('button', { name: 'Preview album', exact: true })).toBeVisible();
}
test('folder import sorts tracks, previews separate SRT versions and keeps the review when returning', async ({ page }) => {
  await albumFiles(); await page.goto('/'); await choose(page);
  await expect(page.locator('.folder-track-title strong')).toHaveText(['Early', 'Later']);
  await expect(page.locator('.advanced-editor')).not.toHaveAttribute('open');
  await page.getByRole('button', { name: 'Preview album', exact: true }).click();
  await expect(page.getByTestId('lyrics-overlay')).toContainText('Video version lyrics');
  await page.getByLabel('Audio only', { exact: true }).check();
  await expect(page.getByTestId('lyrics-overlay')).toContainText('Audio version lyrics');
  await page.getByRole('button', { name: 'Create playlist', exact: true }).click();
  await expect(page.locator('.folder-track-title strong')).toHaveText(['Early', 'Later']);
});
test('an invalid replacement folder preserves the current import', async ({ page }) => {
  await albumFiles(); await page.goto('/'); await choose(page);
  const invalid = path.join(root, 'invalid'); await mkdir(invalid); await writeFile(path.join(invalid, 'readme.txt'), 'No music');
  await page.getByLabel('Choose album folder', { exact: true }).setInputFiles(invalid);
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.locator('.folder-track-title strong')).toHaveText(['Early', 'Later']);
});
test('guided publishing resumes after reload and submits every file without waiting for confirmation', async ({ page }) => {
  await albumFiles();
  await page.addInitScript(() => {
    const w = window as any;
    const actions = ['GET_SELECTED_ACCOUNT', 'GET_ACCOUNT_NAMES', 'PUBLISH_QDN_RESOURCE', 'STAGE_QDN_PUBLISH_SOURCE', 'SELECT_QDN_PUBLISH_SOURCE'];
    w.published = JSON.parse(sessionStorage.getItem('test.published') || '[]'); w.staged = []; let rejected = sessionStorage.getItem('test.rejected') === 'true'; w.readyChecks = 0;
    w.qdnRequest = async (r: any) => {
      if (r.action === 'SHOW_ACTIONS') return actions;
      if (r.action === 'GET_SELECTED_ACCOUNT') return { address: 'QFolder' };
      if (r.action === 'GET_ACCOUNT_NAMES') return [{ name: 'FolderOwner' }];
      if (r.action === 'STAGE_QDN_PUBLISH_SOURCE') { w.staged.push(r.fileName); return { sourceToken: `token-${w.staged.length}` }; }
      if (r.action === 'PUBLISH_QDN_RESOURCE') {
        if (w.published.length === 1 && !rejected) { rejected = true; sessionStorage.setItem('test.rejected', 'true'); return { accepted: false, error: 'Test rejection' }; }
        const sig = `sig-${r.identifier}`; w.published.push({ service: r.service, identifier: r.identifier }); sessionStorage.setItem('test.published', JSON.stringify(w.published)); return { accepted: true, transactionSignature: sig };
      }
      if (r.action === 'SEARCH_QDN_RESOURCES' || r.action === 'LIST_QDN_RESOURCES') return [];
      if (r.action === 'FETCH_NODE_API') { if (r.path.startsWith('/addresses/publickey')) return {ok:true,data:'1'.repeat(44)}; if (r.path.startsWith('/transactions/unconfirmed')) return {ok:true,data:[]}; const sig = r.path.split('/').pop(); return {ok:true,data:{signature:sig,name:'FolderOwner',identifier:sig.slice(4)}}; }
      if (r.action === 'GET_QDN_RESOURCE_STATUS') { w.readyChecks++; return { status: 'DOWNLOADING' }; }
      throw Error(`Unexpected bridge action ${r.action}`);
    };
  });
  await page.goto('/'); await choose(page);
  await page.getByRole('button', {name:'Connect Home account'}).click();
  await page.getByRole('button', {name:'Publish album',exact:true}).click();
  await expect(page.getByRole('alert')).toHaveText('Test rejection');
  await page.reload(); await choose(page);
  await page.getByRole('button', {name:'Connect Home account'}).click();
  await page.getByRole('button', {name:'Publish album',exact:true}).click();
  await expect(page.getByRole('button', {name:'Submitted',exact:true})).toBeVisible();
  expect(await page.evaluate(() => (window as any).readyChecks)).toBe(0);
  const published = await page.evaluate(() => (window as any).published);
  expect(published.map((p: any) => p.service)).toEqual(['AUDIO', 'VIDEO', 'FILE', 'FILE', 'PLAYLIST']);
  expect(new Set(published.map((p: any) => p.identifier)).size).toBe(published.length);
});

test('an interrupted legacy upload blocks publication until explicitly checked', async ({ page }) => {
  await albumFiles();
  await page.setViewportSize({width:390,height:844});
  await page.addInitScript(() => {
    const w=window as any;
    const ref={service:'VIDEO',name:'FolderOwner',identifier:'quixmix-legacy-second-file'};
    localStorage.setItem('music.pending-publications.v1',JSON.stringify({[JSON.stringify([ref.service,ref.name,ref.identifier])]:{ref,address:'QFolder'}}));
    w.stages=0;
    w.qdnRequest=async(r:any)=>{
      if(r.action==='SHOW_ACTIONS')return ['GET_SELECTED_ACCOUNT','GET_ACCOUNT_NAMES','PUBLISH_QDN_RESOURCE','STAGE_QDN_PUBLISH_SOURCE','SELECT_QDN_PUBLISH_SOURCE','GET_PENDING_TRANSACTIONS'];
      if(r.action==='GET_SELECTED_ACCOUNT')return {address:'QFolder'};
      if(r.action==='GET_ACCOUNT_NAMES')return [{name:'FolderOwner'}];
      if(r.action==='SEARCH_QDN_RESOURCES')return [];
      if(r.action==='GET_PENDING_TRANSACTIONS')return {entries:[]};
      if(r.action==='FETCH_NODE_API')return {ok:true,data:r.path.startsWith('/addresses/')?'1'.repeat(44):[]};
      if(r.action==='STAGE_QDN_PUBLISH_SOURCE'){w.stages++;throw Error('Stopped before staging');}
      throw Error('Unexpected '+r.action);
    };
  });
  await page.goto('/');await choose(page);
  await page.getByRole('button',{name:'Connect Home account'}).click();
  await page.getByRole('button',{name:'Publish album',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Interrupted publication recovery'})).toBeVisible();
  expect(await page.evaluate(()=>(window as any).stages)).toBe(0);
  const clear=page.getByRole('button',{name:'Clear checked failed attempts'});
  await expect(clear).toBeDisabled();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.getByRole('checkbox',{name:/I checked Home/}).check();await clear.click();
  await page.getByRole('button',{name:'Resume publishing',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('Stopped before staging');
  expect(await page.evaluate(()=>(window as any).stages)).toBe(1);
});
