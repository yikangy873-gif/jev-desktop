import {Agent,request} from 'node:https';

export const endpoint='https://api.typesafe.ai/v1/systemone';

/** Per-client proxy support. No global dispatcher/agent changes, redirects or retries. */
export function createDefaultTransport({env=typeof process==='undefined'?{}:process.env,nodeVersion=typeof process==='undefined'?'':process.versions.node,fetchImpl=globalThis.fetch,AgentImpl=Agent,requestImpl=request}={}) {
  const proxyEnv=Object.fromEntries(['HTTP_PROXY','http_proxy','HTTPS_PROXY','https_proxy','NO_PROXY','no_proxy'].filter(k=>env[k]!==undefined).map(k=>[k,env[k]]));
  if(!['HTTP_PROXY','http_proxy','HTTPS_PROXY','https_proxy'].some(k=>proxyEnv[k])) return fetchImpl;
  const [major,minor]=nodeVersion.split('.').map(Number);
  if(!(major>=25 || major===24 && minor>=5 || major===22 && minor>=21)) throw new Error('MODEL_PROXY_RUNTIME_UNSUPPORTED');
  let agent;
  try {agent=new AgentImpl({keepAlive:true,proxyEnv});}
  catch {throw new Error('MODEL_PROXY_CONFIGURATION_ERROR');}

  return async (url,init={})=>{
    if(url!==endpoint || init.method!=='POST' || init.redirect!=='error') throw new Error('MODEL_TRANSPORT_SCOPE_ERROR');
    return new Promise((resolve,reject)=>{
      let req,res,settled=false;
      const cleanup=()=>init.signal?.removeEventListener('abort',fail);
      const fail=()=>{
        if(settled)return;
        settled=true;cleanup();res?.destroy();req?.destroy();
        reject(new Error('MODEL_NETWORK_OR_TIMEOUT'));
      };
      const finish=value=>{if(settled)return;settled=true;cleanup();resolve(value);};
      if(init.signal?.aborted){fail();return;}
      init.signal?.addEventListener('abort',fail,{once:true});
      try {
        req=requestImpl(endpoint,{method:'POST',headers:init.headers,agent,signal:init.signal},incoming=>{
          res=incoming;
          res.on('error',fail);
          if(settled){res.destroy();return;}
          const status=res.statusCode,ok=status>=200&&status<300;
          const headers=new Headers(Object.entries(res.headers).filter(([,value])=>value!==undefined).map(([key,value])=>[key,Array.isArray(value)?value.join(', '):value]));
          if(!ok){finish({ok,status,headers});res.destroy();return;}
          const chunks=[];
          res.on('data',chunk=>chunks.push(Buffer.from(chunk)));
          res.on('aborted',fail);
          // Resolve only after the body ends, so cancellation remains active
          // beyond response headers. json() stays local and never echoes data.
          res.on('end',()=>{
            const body=Buffer.concat(chunks).toString('utf8');
            finish({ok,status,headers,json:async()=>{init.signal?.throwIfAborted();return JSON.parse(body);}});
          });
        });
        req.on('error',fail);
        req.end(init.body);
      } catch {fail();}
    });
  };
}
