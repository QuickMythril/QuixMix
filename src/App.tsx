import { useRef, useState } from 'react';
import { demoClient, demoPlaylist } from './demo';
import { Player } from './Player';
import { PlaylistEditor } from './PlaylistEditor';
import { loadPlaylist, qdnClient } from './qdn';
import { LocalPreview } from './LocalPreview';
import type { ResourceClient, Playlist } from './model';
export function App() {
  const [playlist,setPlaylist]=useState<Playlist>(demoPlaylist), [demo,setDemo]=useState(true);
  const [view,setView]=useState<'listen'|'edit'>('listen'), [revision,setRevision]=useState(0);
  const [name,setName]=useState(''), [identifier,setIdentifier]=useState(''), [error,setError]=useState(''), [loading,setLoading]=useState(false);
  const pending=useRef<AbortController|null>(null);
  const [localClient,setLocalClient]=useState<ResourceClient|null>(null);
  const localCleanup=useRef<(()=>void)|null>(null);
  const apply=(next:Playlist,isDemo=false)=>{pending.current?.abort();setLoading(false);setError('');localCleanup.current?.();localCleanup.current=null;setLocalClient(null);setPlaylist(next);setDemo(isDemo);setRevision(r=>r+1);setView('listen');};
  const open=async()=>{pending.current?.abort();const controller=new AbortController();pending.current=controller;setLoading(true);setError('');try{const next=await loadPlaylist(name,identifier||'default',controller.signal);if(!controller.signal.aborted)apply(next);}catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Could not open playlist.');}finally{if(pending.current===controller)setLoading(false);}};
  return <div className="app-shell">
    <header className="app-header"><a className="brand" href="#" onClick={e=>{e.preventDefault();setView('listen');}}><span className="brand-icon">♪</span><span>Music<small>ON QORTIUM</small></span></a><nav aria-label="Main navigation"><button className={view==='listen'?'selected':''} onClick={()=>setView('listen')}>Listen</button><button className={view==='edit'?'selected':''} onClick={()=>setView('edit')}>Create playlist</button></nav><span className="header-note">Sound. Picture. Story.</span></header>
    <main>
      <section className="intro"><div><span className="eyebrow">YOUR MUSIC, IN CONTEXT</span><h1>{playlist.title}</h1><p>{demo?'Try the self-contained demo, or open a playlist from QDN.':'A playlist of sound, moving pictures, and the stories behind them.'}</p></div><button className="subtle-button" onClick={()=>apply(demoPlaylist,true)}>Load demo</button></section>
      <details className="open-playlist"><summary>Open a QDN playlist</summary><form onSubmit={e=>{e.preventDefault();void open();}}><label>Publisher name<input required value={name} onChange={e=>setName(e.target.value)} placeholder="QDN name"/></label><label>Playlist identifier<input value={identifier} onChange={e=>setIdentifier(e.target.value)} placeholder="default"/></label><button className="primary" disabled={loading}>{loading?'Loading…':'Open playlist'}</button>{loading&&<button type="button" onClick={()=>{pending.current?.abort();setLoading(false);}}>Cancel</button>}</form>{error&&<p role="alert" className="notice">{error}</p>}</details>
      <LocalPreview onPreview={(p,c,cleanup)=>{apply(p);localCleanup.current=cleanup;setLocalClient(c);}}/>
      <div hidden={view!=='listen'}><Player key={revision} playlist={playlist} client={localClient??(demo?demoClient:qdnClient)}/></div>
      {view==='edit'&&localClient&&<p className="notice">This is a local preview. Upload the files under QDN resource names before publishing their playlist references.</p>}
      {view==='edit'&&<PlaylistEditor playlist={playlist} onLoad={p=>apply(p)}/>}
    </main>
    <footer><span>Music · Qortium QDN</span><span>{localClient?'Local preview · nothing uploaded':demo?'Local demo · original test media':'Resources served through your QDN node'}</span></footer>
  </div>;
}
