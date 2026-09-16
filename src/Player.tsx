import { useCallback, useEffect, useRef, useState } from 'react';
import type { Cue, MediaKind, Playlist, ResourceClient, TextRef, Track } from './model';
import { activeCues, chooseVersion, parseVtt, seekTime, switchTime } from './timing';

const formatTime = (n:number) => `${Math.floor(Math.max(0,n)/60)}:${String(Math.floor(Math.max(0,n)%60)).padStart(2,'0')}`;
function savedAudioOnly() { try { return localStorage.getItem('music.audioOnly')==='true'; } catch { return false; } }
function textRef(track:Track, kind:MediaKind, role:'lyrics'|'commentary'):TextRef|undefined {
  const value=track.versions[kind]?.[role]; return value===null?undefined:value??track[role];
}
type AdvanceReason = 'ended'|'failure'|'manual';
function isAbortError(error:unknown) { return error instanceof DOMException&&error.name==='AbortError'; }
export function Player({playlist,client}:{playlist:Playlist;client:ResourceClient}) {
  const media=useRef<HTMLVideoElement>(null), stage=useRef<HTMLDivElement>(null);
  const [audioOnly,setAudioOnly]=useState(savedAudioOnly);
  const [selection,setSelection]=useState<{index:number;kind:MediaKind;revision:number}>(()=>{
    const index=playlist.tracks.findIndex(t=>chooseVersion(t,savedAudioOnly())!==null);
    return {index,kind:index>=0?chooseVersion(playlist.tracks[index],savedAudioOnly())!:'audio',revision:0};
  });
  const [playing,setPlaying]=useState(false), [loading,setLoading]=useState(false);
  const [time,setTime]=useState(0), [duration,setDuration]=useState(0);
  const [volume,setVolume]=useState(0.7), [rate,setRate]=useState(1);
  const [lyrics,setLyrics]=useState<Cue[]>([]), [commentary,setCommentary]=useState<Cue[]>([]);
  const [cover,setCover]=useState(''), [notice,setNotice]=useState(''), [textError,setTextError]=useState('');
  const [showLyrics,setShowLyrics]=useState(true), [showCommentary,setShowCommentary]=useState(true);
  const [textSize,setTextSize]=useState(1), [immersive,setImmersive]=useState(false), [fullscreen,setFullscreen]=useState(false);
  const [shuffle,setShuffle]=useState(false), [repeat,setRepeat]=useState<'off'|'all'|'one'>('off');
  const wantsPlay=useRef(false), pendingTime=useRef(0), abort=useRef<AbortController|null>(null), mediaGeneration=useRef(0);
  const failed=useRef(new Set<number>()), history=useRef<number[]>([]), played=useRef(new Set<number>());
  const track=playlist.tracks[selection.index];
  const kind=selection.kind, version=track?.versions[kind];
  const lyricRef=track?textRef(track,kind,'lyrics'):undefined;
  const commentRef=track?textRef(track,kind,'commentary'):undefined;
  const eligible=playlist.tracks.map((t,i)=>({t,i})).filter(({t})=>chooseVersion(t,audioOnly)!==null).map(({i})=>i);
  const snapshot=useRef({selection,audioOnly,shuffle,repeat,eligible,playlist});
  snapshot.current={selection,audioOnly,shuffle,repeat,eligible,playlist};

  const release=useCallback(()=>{
    mediaGeneration.current+=1;
    abort.current?.abort();
    const el=media.current; if(el){el.pause();el.removeAttribute('src');el.load();}
    setPlaying(false);setLoading(false);setTime(0);setDuration(0);setLyrics([]);setCommentary([]);setCover('');
  },[]);
  const select=useCallback((index:number,nextKind?:MediaKind,preserve=false)=>{
    const state=snapshot.current, target=state.playlist.tracks[index];
    const selectedKind=target?chooseVersion(target,state.audioOnly,nextKind):null;
    let nextTime=0;
    if(preserve&&target&&selectedKind&&index===state.selection.index) {
      const from=target.versions[state.selection.kind], to=target.versions[selectedKind];
      if(from&&to) nextTime=switchTime(media.current?.currentTime??0,from,to,target.switchPolicy);
    }
    if(index!==state.selection.index&&state.selection.index>=0) history.current.push(state.selection.index);
    release();pendingTime.current=nextTime;
    if(selectedKind===null){setSelection(s=>({index:-1,kind:'audio',revision:s.revision+1}));wantsPlay.current=false;return;}
    setSelection(s=>({index,kind:selectedKind,revision:s.revision+1}));
  },[release]);
  const advance=useCallback((reason:AdvanceReason='ended')=>{
    const isFailure=reason==='failure';
    const state=snapshot.current, current=state.selection.index;
    if(isFailure) failed.current.add(current);
    else played.current.add(current);
    let candidates=state.eligible.filter(i=>!failed.current.has(i));
    if(!candidates.length){wantsPlay.current=false;release();setLoading(false);setNotice(state.eligible.length?'No tracks are available. Select a track to retry.':'No audio versions in this playlist. Turn off Audio only to play video.');return;}
    if(reason==='ended'&&state.repeat==='one'){select(current,state.selection.kind);return;}
    let next:number|undefined;
    if(state.shuffle){
      let pool=candidates.filter(i=>i!==current&&!played.current.has(i));
      if(!pool.length&&state.repeat==='all'){played.current.clear();pool=candidates.filter(i=>i!==current);}
      if(pool.length) next=pool[Math.floor(Math.random()*pool.length)];
      else if(state.repeat==='all'&&!isFailure) next=current;
    } else {
      next=candidates.find(i=>i>current);
      if(next===undefined&&state.repeat==='all') next=candidates.find(i=>i!==current)??current;
    }
    if(next===undefined){wantsPlay.current=false;setPlaying(false);setLoading(false);media.current?.pause();setNotice(isFailure?'No remaining tracks are available.':'End of playlist.');return;}
    select(next);
  },[release,select]);
  const advanceRef=useRef(advance);advanceRef.current=advance;

  useEffect(()=>{
    const el=media.current;
    if(!el||!version||!track){setNotice('No audio versions in this playlist. Turn off Audio only to play video.');return;}
    const controller=new AbortController();abort.current=controller;const {signal}=controller;
    let failureHandled=false;
    setLoading(true);setTextError('');setNotice('Preparing track…');
    const fail=(message:string)=>{
      if(signal.aborted||failureHandled)return;failureHandled=true;
      setNotice(`${track.title}: ${message} Skipping unavailable track.`);advanceRef.current('failure');
    };
    const onError=()=>fail('Media could not play.');
    el.addEventListener('error',onError);
    void client.mediaUrl(version.resource,signal).then(url=>{
      if(signal.aborted)return;el.src=url;el.load();setNotice('');
    }).catch(e=>fail(e instanceof Error?e.message:'Resource unavailable.'));
    if(track.cover&&kind==='audio') void client.mediaUrl(track.cover,signal).then(url=>{if(!signal.aborted)setCover(url);}).catch(()=>{});
    for(const role of ['lyrics','commentary'] as const){
      const ref=textRef(track,kind,role);if(!ref)continue;
      void client.text(ref,signal).then(value=>{
        const cues=parseVtt(value);if(!signal.aborted)(role==='lyrics'?setLyrics:setCommentary)(cues);
      }).catch(e=>{if(!signal.aborted)setTextError(prev=>`${prev?`${prev} `:''}${role}: ${e instanceof Error?e.message:'Could not load text.'}`);});
    }
    return ()=>{controller.abort();el.removeEventListener('error',onError);el.pause();el.removeAttribute('src');el.load();};
  },[selection,client,track,version,kind]);

  useEffect(()=>{
    const update=()=>setFullscreen(document.fullscreenElement===stage.current);
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape')setImmersive(false);};
    document.addEventListener('fullscreenchange',update);document.addEventListener('keydown',escape);
    return ()=>{document.removeEventListener('fullscreenchange',update);document.removeEventListener('keydown',escape);};
  },[]);
  useEffect(()=>{
    if(!immersive)return;
    const previous=document.body.style.overflow;document.body.style.overflow='hidden';
    return ()=>{document.body.style.overflow=previous;};
  },[immersive]);
  useEffect(()=>{
    let frame=0;
    const tick=()=>{if(media.current)setTime(media.current.currentTime);frame=requestAnimationFrame(tick);};
    if(playing)frame=requestAnimationFrame(tick);
    const visible=()=>{if(media.current)setTime(media.current.currentTime);};
    document.addEventListener('visibilitychange',visible);
    return ()=>{cancelAnimationFrame(frame);document.removeEventListener('visibilitychange',visible);};
  },[playing]);
  useEffect(()=>{if(media.current){media.current.volume=volume;media.current.playbackRate=rate;}},[volume,rate,selection]);
  useEffect(()=>{
    if(duration<=0||shuffle||repeat==='one'||selection.index<0)return;
    const prefetchEligible=playlist.tracks.map((item,index)=>chooseVersion(item,audioOnly)!==null&&!failed.current.has(index)?index:-1).filter(index=>index>=0);
    let nextIndex=prefetchEligible.find(index=>index>selection.index);
    if(nextIndex===undefined&&repeat==='all')nextIndex=prefetchEligible.find(index=>index!==selection.index);
    if(nextIndex===undefined)return;
    const nextTrack=playlist.tracks[nextIndex], nextKind=chooseVersion(nextTrack,audioOnly);
    const nextVersion=nextKind?nextTrack.versions[nextKind]:undefined;
    if(!nextKind||!nextVersion)return;
    const controller=new AbortController(), tasks:Promise<unknown>[]=[client.mediaUrl(nextVersion.resource,controller.signal)];
    for(const role of ['lyrics','commentary'] as const){const ref=textRef(nextTrack,nextKind,role);if(ref)tasks.push(client.text(ref,controller.signal));}
    void Promise.allSettled(tasks);
    return ()=>controller.abort();
  },[audioOnly,client,duration,playlist,repeat,selection.index,selection.kind,selection.revision,shuffle]);

  const play=async()=>{
    const el=media.current;if(!el)return;
    if(playing){wantsPlay.current=false;el.pause();return;}
    wantsPlay.current=true;failed.current.clear();
    if(!el.getAttribute('src')){if(track)select(selection.index,kind);return;}
    if(el.ended){el.currentTime=0;played.current.clear();}
    const generation=mediaGeneration.current;
    try{await el.play();if(generation===mediaGeneration.current)setNotice('');}catch(error){if(generation!==mediaGeneration.current||isAbortError(error))return;wantsPlay.current=false;setNotice('Playback needs a tap on Play, or this media format is unsupported.');}
  };
  const toggleAudioOnly=(enabled:boolean)=>{
    try{localStorage.setItem('music.audioOnly',String(enabled));}catch{/* Preferences still work for this visit. */}
    snapshot.current.audioOnly=enabled;
    snapshot.current.eligible=playlist.tracks.map((t,i)=>chooseVersion(t,enabled)!==null?i:-1).filter(i=>i>=0);
    failed.current.clear();
    setAudioOnly(enabled);
    if(enabled&&kind==='video'){
      if(track?.versions.audio){select(selection.index,'audio',true);}
      else{const next=snapshot.current.eligible.find(i=>i>selection.index)??snapshot.current.eligible[0];select(next??-1,'audio');setNotice('Video-only track skipped in Audio only mode.');}
    }else if(!enabled&&!track){select(0);}
  };
  const seek=(value:number)=>{const el=media.current;if(!el||!Number.isFinite(el.duration))return;el.currentTime=Math.max(0,Math.min(value,el.duration));setTime(el.currentTime);};
  const enterFullscreen=async()=>{
    if(fullscreen){await document.exitFullscreen();return;}
    if(immersive){setImmersive(false);return;}
    try{if(!stage.current?.requestFullscreen)throw new Error('unsupported');await stage.current.requestFullscreen();}
    catch{setImmersive(true);setNotice('Expanded view — this host does not allow fullscreen.');}
  };
  const onMetadata=()=>{
    const el=media.current;if(!el)return;
    setDuration(Number.isFinite(el.duration)?el.duration:0);
    if(pendingTime.current){el.currentTime=Math.max(0,Math.min(pendingTime.current,Number.isFinite(el.duration)?Math.max(0,el.duration-.01):pendingTime.current));pendingTime.current=0;}
    setTime(el.currentTime);setLoading(false);
    if(wantsPlay.current){const generation=mediaGeneration.current;void el.play().catch(error=>{if(generation!==mediaGeneration.current||isAbortError(error))return;wantsPlay.current=false;setNotice('Tap Play to continue.');});}
  };
  const activeLyrics=activeCues(lyrics,time,version?.timelineOffsetMs??0,lyricRef?.offsetMs??0);
  const activeCommentary=activeCues(commentary,time,version?.timelineOffsetMs??0,commentRef?.offsetMs??0);
  const previous=()=>{failed.current.clear();const prev=history.current.pop();if(prev!==undefined&&eligible.includes(prev)){select(prev);history.current.pop();}else{select(eligible.filter(i=>i<selection.index).at(-1)??eligible[0]??-1);}};
  return <div className="listening-layout">
    <section className="player-column" aria-label="Music player">
      <div className="section-heading"><div><span className="eyebrow">NOW PLAYING</span><h2>{track?.title??'Nothing to play'}</h2><p>{track?.artist??'Choose a playlist with an available version.'}</p></div>
        <label className="toggle"><input type="checkbox" checked={audioOnly} onChange={e=>toggleAudioOnly(e.target.checked)}/> Audio only</label>
      </div>
      <div ref={stage} className={`player-stage ${immersive?'immersive':''} ${kind==='audio'?'audio-stage':''}`} style={{'--cue-scale':textSize} as React.CSSProperties}>
        <video ref={media} className={kind==='audio'?'audio-media':'video-media'} playsInline preload="metadata" aria-label="Current track media"
          onLoadedMetadata={onMetadata} onTimeUpdate={()=>{if(media.current)setTime(media.current.currentTime);}}
          onPlay={()=>setPlaying(true)} onPause={()=>setPlaying(false)} onWaiting={()=>setLoading(true)} onPlaying={()=>setLoading(false)}
          onSeeked={()=>{if(media.current)setTime(media.current.currentTime);}} onEnded={()=>advance('ended')}/>
        {kind==='audio'&&<div className="cover-surface">{cover?<img src={cover} alt={`${track?.title??'Track'} cover`} onError={()=>setCover('')}/>:<div className="cover-placeholder"><span>♫</span><strong>{track?.title??'Music'}</strong></div>}</div>}
        {showCommentary&&activeCommentary.length>0&&<div className="cue-overlay commentary-overlay" data-testid="commentary-overlay">{activeCommentary.map(c=><p key={c.id}>{c.text}</p>)}</div>}
        {showLyrics&&activeLyrics.length>0&&<div className="cue-overlay lyrics-overlay" data-testid="lyrics-overlay">{activeLyrics.map(c=><p key={c.id}>{c.text}</p>)}</div>}
        {loading&&<span className="loading-badge" role="status">Preparing media…</span>}
        <div className="stage-controls">
          <button onClick={()=>void play()} disabled={!track} aria-label={playing?'Pause':'Play'}>{playing?'Ⅱ':'▶'}</button>
          <span className="stage-time">{formatTime(time)} / {formatTime(duration)}</span>
          <input aria-label="Seek" type="range" min="0" max={duration||0} step="0.05" value={Math.min(time,duration||0)} onChange={e=>seek(Number(e.target.value))}/>
          <button onClick={()=>void enterFullscreen()} aria-label={fullscreen||immersive?'Exit fullscreen':'Fullscreen'}>{fullscreen||immersive?'↙':'⛶'}</button>
        </div>
      </div>
      <div className="transport">
        <div className="button-group"><button onClick={previous} disabled={!eligible.length} aria-label="Previous track">← Previous</button><button onClick={()=>{failed.current.clear();advance('manual');}} disabled={!eligible.length} aria-label="Next track">Next →</button></div>
        <div className="version-switch" aria-label="Media version">{(['audio','video'] as const).map(v=><button key={v} aria-pressed={kind===v} disabled={!track?.versions[v]||(v==='video'&&audioOnly)} onClick={()=>{if(v!==kind){failed.current.clear();select(selection.index,v,true);}}}>{v==='audio'?'Audio':'Video'}</button>)}</div>
      </div>
      <div className="playback-settings">
        <label><input type="checkbox" checked={shuffle} onChange={e=>{setShuffle(e.target.checked);played.current.clear();}}/> Shuffle</label>
        <label>Repeat <select aria-label="Repeat" value={repeat} onChange={e=>setRepeat(e.target.value as typeof repeat)}><option value="off">Off</option><option value="all">Playlist</option><option value="one">Track</option></select></label>
        <label>Speed <select aria-label="Playback speed" value={rate} onChange={e=>setRate(Number(e.target.value))}>{[.75,1,1.25,1.5,2].map(v=><option key={v} value={v}>{v}×</option>)}</select></label>
        <label className="volume">Volume <input aria-label="Volume" type="range" min="0" max="1" step="0.05" value={volume} onChange={e=>setVolume(Number(e.target.value))}/></label>
      </div>
      {notice&&<p className="notice" role="status">{notice}</p>}
      {audioOnly&&playlist.tracks.some(t=>!t.versions.audio)&&<p className="hint">Audio only is on. Video-only tracks are skipped.</p>}
      {textError&&<p className="notice" role="status">{textError} Playback is still available.</p>}
      <div className="text-settings"><label><input type="checkbox" checked={showLyrics} onChange={e=>setShowLyrics(e.target.checked)}/> Lyrics</label><label><input type="checkbox" checked={showCommentary} onChange={e=>setShowCommentary(e.target.checked)}/> Commentary</label><label>Text size <select aria-label="Text size" value={textSize} onChange={e=>setTextSize(Number(e.target.value))}><option value=".85">Small</option><option value="1">Medium</option><option value="1.2">Large</option></select></label></div>
      <div className="transcripts">
        {showLyrics&&<Transcript title="Lyrics" cues={lyrics} active={activeLyrics} onSeek={c=>seek(seekTime(c,version?.timelineOffsetMs??0,lyricRef?.offsetMs??0))}/>}
        {showCommentary&&<Transcript title="Commentary" cues={commentary} active={activeCommentary} onSeek={c=>seek(seekTime(c,version?.timelineOffsetMs??0,commentRef?.offsetMs??0))}/>}
      </div>
    </section>
    <aside className="queue"><div className="section-heading"><div><span className="eyebrow">UP NEXT</span><h2>Your playlist</h2></div><span className="count">{playlist.tracks.length}</span></div>
      <ol>{playlist.tracks.map((item,index)=>{const disabled=audioOnly&&!item.versions.audio;return <li key={item.id} className={`${selection.index===index?'current':''} ${disabled?'unavailable':''}`}><button disabled={disabled} onClick={()=>{failed.current.clear();wantsPlay.current=true;select(index);}} aria-label={`Play ${item.title}`}><span className="track-number">{selection.index===index?'♫':String(index+1).padStart(2,'0')}</span><span className="track-info"><strong>{item.title}</strong><small>{item.artist}</small><span className="track-badges">{item.versions.audio&&<span>Audio</span>}{item.versions.video&&<span>Video</span>}{disabled&&<span>Skipped · Audio only</span>}</span></span></button></li>;})}</ol>
      <div className="queue-note">One playlist.<br/>Every side of the song.<p>Lyrics below. The story above.</p></div>
    </aside>
  </div>;
}
function Transcript({title,cues,active,onSeek}:{title:string;cues:Cue[];active:Cue[];onSeek:(c:Cue)=>void}) {
  return <section className="transcript"><h3>{title}<span>{cues.length?`${cues.length} passages`:''}</span></h3>{!cues.length?<p className="hint">No {title.toLowerCase()} loaded for this version.</p>:<div className="transcript-scroll">{cues.map(c=><button key={c.id} className={active.some(a=>a.id===c.id)?'active-cue':''} onClick={()=>onSeek(c)}><time>{formatTime(c.start)}</time><span>{c.text}</span></button>)}</div>}</section>;
}
