import { useState } from 'react';
import type { Playlist, ResourceClient, ResourceRef } from './model';
import { parseVtt } from './schema';
type Slot='audio'|'video'|'cover'|'lyrics'|'commentary';
export function LocalPreview({onPreview}:{onPreview:(playlist:Playlist,client:ResourceClient,cleanup:()=>void)=>void}) {
  const [files,setFiles]=useState<Partial<Record<Slot,File>>>({});
  const [title,setTitle]=useState('My preview'), [error,setError]=useState(''), [offset,setOffset]=useState(0), [aligned,setAligned]=useState(false);
  const [busy,setBusy]=useState(false);
  const preview=async()=>{
    const urls:string[]=[];setBusy(true);setError('');
    try{
      if(!files.audio&&!files.video)throw new Error('Choose an audio or video file.');
      const resources=new Map<string,string>(), text=new Map<string,string>();
      for(const role of ['lyrics','commentary'] as const){const file=files[role];if(file){if(file.size>1024*1024)throw new Error(`${role} file exceeds 1 MiB.`);const content=await file.text();parseVtt(content);text.set(role,content);}}
      for(const role of ['audio','video','cover'] as const){const file=files[role];if(file){const url=URL.createObjectURL(file);urls.push(url);resources.set(role,url);}}
      const ref=(service:ResourceRef['service'],identifier:string):ResourceRef=>({service,name:'LocalPreview',identifier});
      const textRef=(role:'lyrics'|'commentary')=>files[role]?{...ref('FILE',role),service:'FILE' as const,format:'vtt' as const}:undefined;
      const playlist:Playlist={kind:'qortium-music-playlist',schemaVersion:1,title:title||'My preview',tracks:[{id:'local-preview',title:title||'My preview',artist:'Local files · not published',defaultVersion:files.video?'video':'audio',switchPolicy:aligned?'aligned':'restart',versions:{...(files.audio?{audio:{resource:ref('AUDIO','audio')}}:{}),...(files.video?{video:{resource:ref('VIDEO','video'),timelineOffsetMs:offset}}:{})},cover:files.cover?ref('IMAGE','cover'):undefined,lyrics:textRef('lyrics'),commentary:textRef('commentary')}]};
      const client:ResourceClient={async mediaUrl(r,signal){signal?.throwIfAborted();const value=resources.get(r.identifier);if(!value)throw new Error('Local file is unavailable.');return value;},async text(r,signal){signal?.throwIfAborted();const value=text.get(r.identifier);if(value===undefined)throw new Error('Local text is unavailable.');return value;}};
      onPreview(playlist,client,()=>urls.forEach(url=>URL.revokeObjectURL(url)));
    }catch(e){urls.forEach(url=>URL.revokeObjectURL(url));setError(e instanceof Error?e.message:'Preview failed.');}finally{setBusy(false);}
  };
  return <details className="local-preview open-playlist"><summary>Preview your files before uploading</summary><div className="local-preview-body"><p className="hint">Files stay in this browser session. Choose either media version or both, then attach optional cover and WebVTT text.</p><div className="local-preview-grid"><label>Track title<input value={title} onChange={e=>setTitle(e.target.value)}/></label>{(['audio','video','cover','lyrics','commentary'] as const).map(role=><label key={role}>{role[0].toUpperCase()+role.slice(1)}<input type="file" accept={role==='audio'?'audio/*':role==='video'?'video/*':role==='cover'?'image/*':'.vtt,text/vtt'} onChange={e=>setFiles(f=>({...f,[role]:e.target.files?.[0]}))}/></label>)}<label>Video intro offset (ms)<input type="number" value={offset} step="1" min="-86400000" max="86400000" onChange={e=>setOffset(Number(e.target.value))}/></label><label><span><input type="checkbox" checked={aligned} onChange={e=>setAligned(e.target.checked)}/> Versions have matching edits</span></label></div><button className="primary" disabled={busy} onClick={()=>void preview()}>{busy?'Preparing…':'Preview files'}</button>{error&&<p role="alert" className="notice">{error}</p>}</div></details>;
}
