/** Runs inside cua_repl after its documented bootstrap. No model, credentials,
 * private browser endpoint or separate GUI controller is used here. */
export function baiduSearchUrl(query) {
  if (typeof query !== 'string' || !query.trim() || query.length>2000 || /[\r\n\x00]/.test(query)) throw Error('INVALID_QUERY');
  const url=new URL('https://www.baidu.com/s');
  url.searchParams.set('wd',query);
  return url.href;
}

export function isBaiduResult(raw,query) {
  if (typeof raw!=='string') return false;
  const match=raw.match(/^Browser tab:.*URL: "([^"]+)"/m);
  if (!match) return false;
  let url;
  try {url=new URL(match[1]);} catch {return false;}
  if (url.protocol!=='https:' || !['www.baidu.com','baidu.com'].includes(url.hostname) || url.pathname!=='/s' || url.searchParams.get('wd')!==query) return false;
  const title=raw.match(/^\s*\d+ AXWebArea (.*?)(?:, URL:.*)?$/m)?.[1];
  // Do not accept merely reaching /s. The result body and at least one heading
  // must be present in the same current accessibility snapshot.
  if (title!==`${query}_百度搜索`) return false;
  let resultDepth=null;
  for (const line of raw.split('\n')) {
    const node=line.match(/^(\s*)\d+ (.*)$/);
    if (!node) continue;
    const depth=node[1].replace(/\t/g,'    ').length;
    if(resultDepth!==null && depth<=resultDepth) resultDepth=null;
    if(node[2]==='container content_left') resultDepth=depth;
    else if(resultDepth!==null && /^heading\s+\S/.test(node[2])) return true;
  }
  return false;
}

export async function searchBaidu({cua,browser,tab,query,maxObservations=4,maxTotalMs=20000,signal}={}) {
  const url=baiduSearchUrl(query);
  if (!Number.isInteger(maxObservations) || maxObservations<1 || maxObservations>8 || !Number.isFinite(maxTotalMs) || maxTotalMs<1 || maxTotalMs>60000) throw Error('INVALID_BUDGET');
  if (!tab && (!cua || typeof browser!=='string' || !browser)) throw Error('REQUIRE_BROWSER_OR_APPROVED_TAB');
  const start=performance.now();
  const timing={openMs:0,verifyMs:0,totalMs:0,boundary:'helper start through visible-result verification; excludes Codex planning and browser bootstrap'};
  let observations=0,phase='open';
  const done=(status)=>({status,verified:status==='done',route:'direct',requests:0,observations,tab,timing:{...timing,totalMs:Math.round(performance.now()-start)}});
  if (signal?.aborted) return done('cancelled');
  try {
    // Existing tabs are reused only when deliberately supplied by Codex.
    if (tab) await tab.goto(url);
    else tab=await cua.createBrowserTab(browser,url,browser==='iab'?{visible:true}:{sessionName:'🔎 百度搜索'});
    timing.openMs=Math.round(performance.now()-start);
    phase='verify';
    const verifyStart=performance.now();
    // CUA calls are not abortable. Even a slow open gets one final observation;
    // the soft elapsed budget only prevents additional observations afterward.
    while(observations<maxObservations && (observations===0 || performance.now()-start<maxTotalMs)) {
      if(signal?.aborted) return done('cancelled');
      const raw=await tab.getAXState({disableDiffing:true,emit:false});
      observations++;
      timing.verifyMs=Math.round(performance.now()-verifyStart);
      if(signal?.aborted) return done('cancelled');
      if(isBaiduResult(raw,query)) return done('done');
    }
    return done('waiting_for_ui');
  } catch {
    // A failed navigation may have taken effect. Never replay or emit raw errors.
    if(phase==='open') timing.openMs=Math.round(performance.now()-start);
    else timing.verifyMs=Math.round(performance.now()-start)-timing.openMs;
    return done('needs_inspection');
  }
}
