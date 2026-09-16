import { hasHomeBridge, qdnRequest } from './qdnRequest';
import type { QdnRequest } from './qdnRequest';
import type { Playlist, ResourceClient, ResourceRef, ResourceService } from './model';
import { parsePlaylist } from './schema';

const TEXT_MAX_BYTES=1024*1024;
export const STAGED_FILE_MAX_BYTES=25*1024*1024;
const ENCODED_MAX_BYTES=Math.ceil(TEXT_MAX_BYTES/3)*4+4;
const READY_TIMEOUT=60_000;
const SERVICES=new Set(['PLAYLIST','AUDIO','VIDEO','IMAGE','FILE']);
const journalKey='music.pending-publications.v1';
type JournalEntry={ref:ResourceRef;signature?:string;address:string};
let journal:Record<string,JournalEntry>={};
try{const saved:unknown=JSON.parse(localStorage.getItem(journalKey)||'{}');if(saved&&typeof saved==='object'&&!Array.isArray(saved))journal=saved as typeof journal;}catch{/* Browser storage can be unavailable. */}
const key=(ref:ResourceRef)=>JSON.stringify([ref.service,ref.name,ref.identifier]);
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
function saveJournal(){try{localStorage.setItem(journalKey,JSON.stringify(journal));}catch{/* Keep session recovery in memory. */}}
export class ReadinessTimeoutError extends Error {
  readonly accepted=true;
  constructor(public ref:ResourceRef,public transactionSignature?:string){super(`Publish accepted for ${ref.service}/${ref.name}/${ref.identifier}, but the new version is not confirmed readable yet. The reference is saved; check readiness before retrying publication.`);this.name='ReadinessTimeoutError';}
}
function validateRef(ref:ResourceRef){
  if(!SERVICES.has(ref.service))throw new Error('Unsupported resource service.');
  for(const [field,limit] of [['name',40],['identifier',64]] as const){const v=ref[field];if(typeof v!=='string'||!v.trim()||v==='.'||v==='..'||v!==v.trim()||/[\x00-\x1f\x7f]/.test(v)||new TextEncoder().encode(v).length>limit)throw new Error(`Invalid resource ${field} (maximum ${limit} UTF-8 bytes).`);}
  if(ref.path!==undefined){if(!['AUDIO','VIDEO'].includes(ref.service)||!ref.path||/[\\?#\x00-\x1f]/.test(ref.path)||ref.path.split('/').some(p=>{try{const d=decodeURIComponent(p);return !d||d==='.'||d==='..'||/[\\/\x00-\x1f]/.test(d);}catch{return true;}}))throw new Error('Resource path must be a safe relative media path.');}
}
async function request<T=unknown>(payload:QdnRequest,signal?:AbortSignal,timeout=20_000):Promise<T>{
  signal?.throwIfAborted();
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
  let onAbort:()=>void=()=>{};
  const guard=new Promise<never>((_,reject)=>{onAbort=()=>{controller.abort();reject(new DOMException('Aborted','AbortError'));};signal?.addEventListener('abort',onAbort,{once:true});timer=setTimeout(()=>{controller.abort();reject(new Error(`${payload.action} timed out.`));},timeout);});
  try{return await Promise.race([qdnRequest<T>({...payload,signal:controller.signal}),guard]);}
  finally{clearTimeout(timer);signal?.removeEventListener('abort',onAbort);}
}
async function delay(ms:number,signal?:AbortSignal){signal?.throwIfAborted();await new Promise<void>((resolve,reject)=>{const done=()=>{signal?.removeEventListener('abort',abort);resolve();};const timer=setTimeout(done,ms);const abort=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);reject(new DOMException('Aborted','AbortError'));};signal?.addEventListener('abort',abort,{once:true});});}
async function capabilities(){const value=await request({action:'SHOW_ACTIONS'});if(!Array.isArray(value)||!value.every(v=>typeof v==='string'))throw new Error('Home returned invalid capabilities.');return new Set<string>(value);}
async function requireActions(...actions:string[]){if(!hasHomeBridge())throw new Error('Publishing requires Qortium Home. Browser development supports reads only.');const available=await capabilities();for(const action of actions)if(!available.has(action))throw new Error(`Home does not support ${action}.`);}
async function latestSignature(ref:ResourceRef,signal?:AbortSignal){
  const list=await request({action:'LIST_QDN_RESOURCES',service:ref.service,name:ref.name,identifier:ref.identifier,limit:20,offset:0,exactMatchNames:true},signal);
  if(!Array.isArray(list))throw new Error('Invalid resource listing.');
  const item=list.find(v=>record(v)&&v.name===ref.name&&(v.identifier??'default')===ref.identifier);
  return record(item)&&typeof item.latestSignature==='string'?item.latestSignature:undefined;
}
async function waitReady(ref:ResourceRef,signal?:AbortSignal,expectedSignature?:string){
  validateRef(ref);const start=Date.now();let triggered=false;
  while(Date.now()-start<READY_TIMEOUT){
    signal?.throwIfAborted();
    if(expectedSignature&&await latestSignature(ref,signal)!==expectedSignature){await delay(1500,signal);continue;}
    const status=await request({action:'GET_QDN_RESOURCE_STATUS',...ref,build:true},signal);
    if(!record(status)||typeof status.status!=='string')throw new Error('Invalid QDN resource status.');
    if(status.status==='READY')return;
    if(['BLOCKED','BUILD_FAILED','UNSUPPORTED'].includes(status.status))throw new Error(`Resource is ${status.status.toLowerCase()}.`);
    if(!triggered){triggered=true;await request({action:'FETCH_QDN_RESOURCE',...ref,async:true,maxBytes:4096},signal).catch(e=>{signal?.throwIfAborted();if(Date.now()-start>=READY_TIMEOUT)throw e;});}
    await delay(1500,signal);
  }
  throw new Error('Resource is still downloading or awaiting confirmation. Try again shortly.');
}
function decodeText(value:unknown){
  if(typeof value!=='string'||value.length>ENCODED_MAX_BYTES)throw new Error('Text resource is not bounded base64 data.');
  let binary:string;try{binary=atob(value);}catch{throw new Error('Invalid base64 text response.');}
  if(binary.length>TEXT_MAX_BYTES)throw new Error('Text resource exceeds 1 MiB.');
  return new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(binary,c=>c.charCodeAt(0)));
}
export const qdnClient:ResourceClient={
  async mediaUrl(ref,signal){
    validateRef(ref);await waitReady(ref,signal);
    const actions=hasHomeBridge()?await capabilities():new Set<string>();
    const action=actions.has('GET_QDN_RESOURCE_STREAM_URL')?'GET_QDN_RESOURCE_STREAM_URL':'GET_QDN_RESOURCE_URL';
    const value=await request({action,...ref},signal);
    const url=typeof value==='string'?value:record(value)?value.url??value.resourceUrl??value.href:null;
    if(typeof url!=='string'||!url||!['http:','https:','blob:','qortium-home-resource:'].includes(new URL(url,window.location.href).protocol))throw new Error('Home did not return a usable resource URL.');
    return url;
  },
  async text(ref,signal){validateRef(ref);await waitReady(ref,signal);return decodeText(await request({action:'FETCH_QDN_RESOURCE',...ref,encoding:'base64',maxBytes:ENCODED_MAX_BYTES},signal));},
};
export async function loadPlaylist(name:string,identifier:string,signal?:AbortSignal):Promise<Playlist>{return parsePlaylist(await qdnClient.text({service:'PLAYLIST',name:name.trim(),identifier:identifier.trim()||'default'},signal));}
export async function getPublishContext():Promise<{address:string;names:string[]}>{
  await requireActions('GET_SELECTED_ACCOUNT','GET_ACCOUNT_NAMES','PUBLISH_QDN_RESOURCE','STAGE_QDN_PUBLISH_SOURCE','SELECT_QDN_PUBLISH_SOURCE');
  // Current Home desktop and Android return {address,...}; names are a separate read.
  const selected=await request({action:'GET_SELECTED_ACCOUNT'});
  if(!record(selected)||typeof selected.address!=='string'||!selected.address)throw new Error('No selected Home account.');
  const response=await request({action:'GET_ACCOUNT_NAMES',address:selected.address,maxBytes:256*1024});
  if(!Array.isArray(response)||response.some(n=>!record(n)||typeof n.name!=='string'))throw new Error('Home returned invalid owned names.');
  return {address:selected.address,names:response.map(n=>(n as {name:string}).name)};
}
async function owned(name:string,expectedAddress:string){const context=await getPublishContext();if(context.address!==expectedAddress)throw new Error('Selected account changed. Reconnect the publishing account.');if(!context.names.some(n=>n.toLowerCase()===name.toLowerCase()))throw new Error(`The selected account does not own ${name}.`);}
function encode(bytes:Uint8Array){let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(binary);}
export async function uploadResource(service:ResourceService,name:string,identifier:string,expectedAddress:string,file?:File):Promise<ResourceRef>{
  const ref:ResourceRef={service,name,identifier};validateRef(ref);await owned(name,expectedAddress);
  // A prior accepted transaction is checked rather than blindly republished.
  const pending=journal[key(ref)];
  if(pending&&record(pending)&&pending.address===expectedAddress){
    if(typeof pending.signature!=='string')throw new Error('A previous publication has an unresolved outcome. Check Home’s pending transactions before publishing this identifier again.');
    try{await waitReady(ref,undefined,pending.signature);}
    catch{throw new ReadinessTimeoutError(ref,pending.signature);}
    delete journal[key(ref)];saveJournal();
    throw Object.assign(new Error('The previous upload is now confirmed readable. Its reference is saved. No new file was uploaded; choose Upload or Publish again if you intended to replace it.'),{ref,recovered:true});
  }
  if(file&&['FILE','PLAYLIST'].includes(service)&&file.size>TEXT_MAX_BYTES)throw new Error('Text resources are limited to 1 MiB.');
  const usePicker=!file||file.size>STAGED_FILE_MAX_BYTES;
  const staged=await qdnRequest(!usePicker&&file?{action:'STAGE_QDN_PUBLISH_SOURCE',bytesBase64:encode(new Uint8Array(await file.arrayBuffer())),fileName:file.name,mimeType:file.type||'application/octet-stream'}:{action:'SELECT_QDN_PUBLISH_SOURCE',kind:'file'});
  if(!record(staged)||staged.canceled===true||typeof staged.sourceToken!=='string'||!staged.sourceToken)throw new Error('File selection or staging was cancelled.');
  if(usePicker&&file&&(staged.fileName!==file.name||staged.size!==file.size))throw new Error(`Select the matching file: ${file.name} (${file.size} bytes). Nothing was published.`);
  await owned(name,expectedAddress);
  // Do not impose a short timeout on a user approval/signing operation.
  journal[key(ref)]={ref,address:expectedAddress};saveJournal();
  let result:unknown;
  try{result=await qdnRequest({action:'PUBLISH_QDN_RESOURCE',...ref,sourceToken:staged.sourceToken});}
  catch{throw new Error('Publication response was lost. Its outcome is unknown; check Home’s pending transactions before retrying.');}
  if(!record(result)||result.accepted!==true){
    if(record(result)&&result.outcome==='unknown'){journal[key(ref)]={ref,address:expectedAddress};saveJournal();throw new Error('Publication outcome is unknown. Check Home’s pending transactions before retrying.');}
    if(!record(result))throw new Error('Invalid publication response. Check Home’s pending transactions before retrying.');
    delete journal[key(ref)];saveJournal();
    throw new Error(typeof result.error==='string'?result.error:'Publication was cancelled or rejected.');
  }
  const signature=typeof result.transactionSignature==='string'?result.transactionSignature:undefined;
  journal[key(ref)]={ref,signature,address:expectedAddress};saveJournal();
  if(!signature)throw new ReadinessTimeoutError(ref);
  try{await waitReady(ref,undefined,signature);}catch{throw new ReadinessTimeoutError(ref,signature);}
  delete journal[key(ref)];saveJournal();return ref;
}
export async function publishPlaylist(playlist:Playlist,name:string,identifier:string,expectedAddress:string):Promise<unknown>{
  const valid=parsePlaylist(playlist);
  await owned(name,expectedAddress);
  const references:ResourceRef[]=[];
  for(const track of valid.tracks){if(track.cover)references.push(track.cover);if(track.lyrics)references.push(track.lyrics);if(track.commentary)references.push(track.commentary);for(const version of Object.values(track.versions)){references.push(version.resource);if(version.lyrics)references.push(version.lyrics);if(version.commentary)references.push(version.commentary);}}
  const unique=[...new Map(references.map(ref=>[key(ref),ref])).values()];
  // Check dependencies before exposing the manifest. Keep concurrency bounded.
  for(let i=0;i<unique.length;i+=3)await Promise.all(unique.slice(i,i+3).map(ref=>{const pending=journal[key(ref)];if(pending&&!pending.signature)throw new Error('A referenced upload has an unresolved publication outcome. Check Home pending transactions.');return waitReady(ref,undefined,pending?.signature);}));
  const file=new File([JSON.stringify(valid)],`${identifier}.json`,{type:'application/json'});
  try{const ref=await uploadResource('PLAYLIST',name,identifier,expectedAddress,file);return {accepted:true,ready:true,ref};}
  catch(error){if(error instanceof ReadinessTimeoutError)return {accepted:true,ready:false,ref:error.ref,transactionSignature:error.transactionSignature};throw error;}
}
