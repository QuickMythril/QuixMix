import { useEffect, useRef, useState } from 'react';
import { useAppearance, type ThemePreference } from './appearance';
import { demoClient, demoPlaylist } from './demo';
import { Player } from './Player';
import { FolderCreator } from './FolderCreator';
import { PlaylistEditor } from './PlaylistEditor';
import { PlaylistLibrary } from './PlaylistLibrary';
import { loadPlaylist, qdnClient } from './qdn';
import { hasHomeBridge } from './qdnRequest';
import { parsePlaylistRoute, playlistHash, playlistLink } from './links';
import { LocalPreview } from './LocalPreview';
import type { ResourceClient, ResourceRef, Playlist } from './model';
function setRoute(hash: string) {
  if (typeof window === 'undefined' || window.location.hash === hash) return;
  try { history.replaceState(null, '', `${window.location.pathname}${window.location.search}${hash}`); } catch { /* Some hosts refuse history writes; the playlist still opens. */ }
}
export function App() {
  const { preference, setPreference } = useAppearance();
  const [playlist,setPlaylist]=useState<Playlist>(demoPlaylist), [demo,setDemo]=useState(true);
  const [view,setView]=useState<'listen'|'edit'>('listen'), [revision,setRevision]=useState(0);
  const [name,setName]=useState(''), [identifier,setIdentifier]=useState(''), [error,setError]=useState(''), [loading,setLoading]=useState(false);
  const [current,setCurrent]=useState<ResourceRef|null>(null), [libraryKey,setLibraryKey]=useState(0), [copied,setCopied]=useState(false);
  const pending=useRef<AbortController|null>(null);
  const [localClient,setLocalClient]=useState<ResourceClient|null>(null);
  const localCleanup=useRef<(()=>void)|null>(null);
  const apply=(next:Playlist,isDemo=false,ref:ResourceRef|null=null)=>{pending.current?.abort();setLoading(false);setError('');localCleanup.current?.();localCleanup.current=null;setLocalClient(null);setPlaylist(next);setDemo(isDemo);setCurrent(ref);setCopied(false);setRoute(ref?playlistHash(ref):'');setRevision(r=>r+1);setView('listen');};
  const open=async(openName=name,openIdentifier=identifier)=>{pending.current?.abort();const controller=new AbortController();pending.current=controller;setLoading(true);setError('');const ref:ResourceRef={service:'PLAYLIST',name:openName.trim(),identifier:openIdentifier.trim()||'default'};try{const next=await loadPlaylist(ref.name,ref.identifier,controller.signal);if(!controller.signal.aborted)apply(next,false,ref);}catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Could not open playlist.');}finally{if(pending.current===controller)setLoading(false);}};
  const openRef=(ref:ResourceRef)=>{setName(ref.name);setIdentifier(ref.identifier);void open(ref.name,ref.identifier);};
  // Direct links: #/playlist/<name>/<identifier>, on load and whenever the address changes.
  useEffect(()=>{const follow=()=>{const route=parsePlaylistRoute(window.location.hash);if(route&&!(current&&current.name===route.name&&current.identifier===route.identifier))openRef({service:'PLAYLIST',...route});};follow();window.addEventListener('hashchange',follow);return()=>window.removeEventListener('hashchange',follow);// eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);
  const link=current?playlistLink(current,window.location,hasHomeBridge()):'';
  const copyLink=async()=>{try{await navigator.clipboard.writeText(link);setCopied(true);}catch{setCopied(false);setError('Copy is not available here. Select the link text and copy it.');}};
  return <div className="app-shell">
    <header className="app-header"><a className="brand" href="#" onClick={e=>{e.preventDefault();setView('listen');}}><span className="brand-icon">♪</span><span>QuixMix<small>ON QORTIUM</small></span></a><nav aria-label="Main navigation"><button className={view==='listen'?'selected':''} onClick={()=>setView('listen')}>Listen</button><button className={view==='edit'?'selected':''} onClick={()=>setView('edit')}>Create playlist</button></nav><label className="theme-picker"><span>Theme</span><select aria-label="Theme" value={preference} onChange={event=>setPreference(event.target.value as ThemePreference)}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label></header>
    <main>
      <div hidden={view!=='listen'}><section className="intro"><div><span className="eyebrow">YOUR MUSIC, IN CONTEXT</span><h1>{playlist.title}</h1><p>{demo?'Try the self-contained demo, or open a playlist from QDN.':'A playlist of sound, moving pictures, and the stories behind them.'}</p>{current&&<p className="share-link"><span>Link</span><code>{link}</code><button type="button" className="subtle-button" onClick={()=>void copyLink()}>{copied?'Copied':'Copy link'}</button></p>}</div><button className="subtle-button" onClick={()=>apply(demoPlaylist,true)}>Load demo</button></section>
      <PlaylistLibrary current={current} refreshKey={libraryKey} onOpen={openRef}/>
      <details className="open-playlist"><summary>Open a QDN playlist</summary><form onSubmit={e=>{e.preventDefault();void open();}}><label>Publisher name<input required value={name} onChange={e=>setName(e.target.value)} placeholder="QDN name"/></label><label>Playlist identifier<input value={identifier} onChange={e=>setIdentifier(e.target.value)} placeholder="default"/></label><button className="primary" disabled={loading}>{loading?'Loading…':'Open playlist'}</button>{loading&&<button type="button" onClick={()=>{pending.current?.abort();setLoading(false);}}>Cancel</button>}</form>{error&&<p role="alert" className="notice">{error}</p>}</details>
      <LocalPreview onPreview={(p,c,cleanup)=>{apply(p);localCleanup.current=cleanup;setLocalClient(c);}}/></div>
      <div hidden={view!=='listen'}><Player key={revision} playlist={playlist} client={localClient??(demo?demoClient:qdnClient)}/></div>
      <div hidden={view!=='edit'}><FolderCreator onPreview={(p,c,cleanup)=>{apply(p);localCleanup.current=cleanup;setLocalClient(c);}} onPublished={p=>{setLibraryKey(k=>k+1);apply(p);}}/>
      <details className="advanced-editor"><summary>Advanced: edit QDN references manually</summary>{view==='edit'&&<PlaylistEditor playlist={playlist} onLoad={p=>apply(p)}/>}</details></div>
    </main>
    <footer><span>QuixMix · Qortium QDN</span><span>{localClient?'Local preview · nothing uploaded':demo?'Local demo · original test media':'Resources served through your QDN node'}</span></footer>
  </div>;
}
