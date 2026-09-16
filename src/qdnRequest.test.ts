import {afterEach,describe,expect,it,vi} from 'vitest';
import {qdnRequest} from './qdnRequest';
afterEach(()=>vi.unstubAllGlobals());
describe('read-only browser bridge fallback',()=>{
  it('rejects write methods and unsafe node paths before fetching',async()=>{
    vi.stubGlobal('window',{});const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
    await expect(qdnRequest({action:'FETCH_NODE_API',path:'/arbitrary/resources',method:'POST'})).rejects.toThrow('GET and HEAD');
    for(const path of ['//outside.example/path','/\\outside.example/path','/bad\npath'])await expect(qdnRequest({action:'FETCH_NODE_API',path})).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('strips non-serializable abort signals from Home bridge payloads',async()=>{
    const bridge=vi.fn().mockResolvedValue({status:'READY'});vi.stubGlobal('window',{qdnRequest:bridge});
    await qdnRequest({action:'GET_QDN_RESOURCE_STATUS',service:'AUDIO',name:'Artist',identifier:'song',signal:new AbortController().signal});
    expect(bridge).toHaveBeenCalledWith({action:'GET_QDN_RESOURCE_STATUS',service:'AUDIO',name:'Artist',identifier:'song'});
  });
  it('encodes QDN references and paths in browser media URLs',async()=>{
    vi.stubGlobal('window',{});
    await expect(qdnRequest({action:'GET_QDN_RESOURCE_URL',service:'AUDIO',name:'Artist Name',identifier:'song #1',path:'album/one.mp3'})).resolves.toBe('http://127.0.0.1:24891/arbitrary/AUDIO/Artist%20Name/song%20%231?filepath=album%2Fone.mp3');
    await expect(qdnRequest({action:'GET_QDN_RESOURCE_URL',service:'../admin',name:'Artist',identifier:'song'})).rejects.toThrow();
  });
  it('bounds streamed responses even without a Content-Length header',async()=>{
    vi.stubGlobal('window',{});vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('abcdef')));
    await expect(qdnRequest({action:'FETCH_NODE_API',path:'/arbitrary/resources',maxBytes:3})).rejects.toThrow('byte limit');
  });
  it('never offers a browser-side publication action',async()=>{
    vi.stubGlobal('window',{});
    await expect(qdnRequest({action:'PUBLISH_QDN_RESOURCE'})).rejects.toThrow('not available');
    const actions=await qdnRequest<string[]>({action:'SHOW_ACTIONS'});expect(actions).not.toContain('PUBLISH_QDN_RESOURCE');
  });
});
