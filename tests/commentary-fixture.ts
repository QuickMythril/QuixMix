import type { Page } from '@playwright/test';
import { demoPlaylist } from '../src/demo';

export async function installCommentaryBridge(page: Page, delay = 0) {
  await page.addInitScript(({ playlist, delay }) => {
    const w = window as typeof window & { qdnRequest?: (r: any) => Promise<any>; textRequests: string[]; playlistRequests: number };
    const encode = (value: string) => btoa(String.fromCharCode(...new TextEncoder().encode(value)));
    w.textRequests = []; w.playlistRequests = 0;
    const files: Record<string,string> = {audio:'first-light.mp3',video:'first-light.mp4',cover:'cover.svg'};
    w.qdnRequest = async r => {
      if (r.action === 'SHOW_ACTIONS') return ['FETCH_QDN_RESOURCE','GET_QDN_RESOURCE_STATUS','GET_QDN_RESOURCE_URL'];
      if (r.action === 'WHICH_UI') return 'QORTIUM_HOME';
      if (r.action === 'GET_QDN_RESOURCE_STATUS') return {status:'READY'};
      if (r.action === 'GET_QDN_RESOURCE_URL') return `/demo/${files[r.identifier]}`;
      if (r.action === 'FETCH_QDN_RESOURCE') {
        if (r.service === 'PLAYLIST') {
          w.playlistRequests++;
          if (delay) await new Promise(resolve => setTimeout(resolve, delay));
          return encode(JSON.stringify(playlist));
        }
        w.textRequests.push(r.identifier);
        return encode(await (await fetch(`/demo/${r.identifier}.vtt`)).text());
      }
      throw new Error(`Unexpected action: ${r.action}`);
    };
  }, {playlist:demoPlaylist,delay});
}
export const commentaryRoute = '/#/playlist/Owner/test-list?commentary=true';
