import {createServer} from 'node:http';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {chmod,mkdir,readFile,unlink,writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {loadConfig} from './client.mjs';
import {createDefaultTransport,endpoint} from './transport.mjs';
import {defaultBridgeDescriptorPath} from './bridge-client.mjs';

const jsonHeaders={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'};

function equalSecret(actual,expected) {
  const a=Buffer.from(actual),b=Buffer.from(expected);
  return a.length===b.length && timingSafeEqual(a,b);
}

function send(res,status,payload={error:'BRIDGE_REQUEST_REJECTED'}) {
  if(res.headersSent || res.destroyed)return;
  res.writeHead(status,jsonHeaders);res.end(JSON.stringify(payload));
}

async function readBody(req,maxBodyBytes,bodyTimeoutMs) {
  const declared=Number(req.headers['content-length']);
  if(Number.isFinite(declared) && declared>maxBodyBytes)throw new Error('TOO_LARGE');
  const timer=setTimeout(()=>req.destroy(new Error('BODY_TIMEOUT')),bodyTimeoutMs);timer.unref?.();
  try {
    const chunks=[];let size=0;
    for await(const chunk of req){size+=chunk.length;if(size>maxBodyBytes)throw new Error('TOO_LARGE');chunks.push(chunk);}
    return Buffer.concat(chunks).toString('utf8');
  } finally {clearTimeout(timer);}
}

export async function startBridge({config,transport,descriptorPath,idleMs=300000,maxLifetimeMs=3600000,maxBodyBytes=262144,bodyTimeoutMs=5000,upstreamTimeoutMs=15000}={}) {
  if(!config?.apiKey || typeof transport!=='function' || !descriptorPath || !Number.isInteger(idleMs) || idleMs<1 || !Number.isInteger(maxLifetimeMs) || maxLifetimeMs<idleMs || maxLifetimeMs>86400000 || !Number.isInteger(maxBodyBytes) || maxBodyBytes<1 || maxBodyBytes>1048576 || !Number.isInteger(bodyTimeoutMs) || bodyTimeoutMs<1 || bodyTimeoutMs>30000 || !Number.isInteger(upstreamTimeoutMs) || upstreamTimeoutMs<1 || upstreamTimeoutMs>60000)throw new Error('BRIDGE_INVALID_OPTIONS');
  const model=config.model||'jev-latest';
  const token=randomBytes(32).toString('base64url');let closePromise,idleTimer,lifetimeTimer;const sockets=new Set();
  const server=createServer(async(req,res)=>{
    const port=server.address()?.port,expectedHost=`127.0.0.1:${port}`;
    if(req.headers.host!==expectedHost || Object.hasOwn(req.headers,'origin')){send(res,403);return;}
    if(req.method==='GET' && req.url==='/health'){send(res,200,{ready:true});return;}
    if(req.method!=='POST' || req.url!=='/v1/systemone'){send(res,404);return;}
    const auth=req.headers.authorization || '';
    if(!auth.startsWith('Bridge ') || !equalSecret(auth.slice(7),token)){send(res,401);return;}
    if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||'')){send(res,415);return;}
    clearTimeout(idleTimer);idleTimer=setTimeout(()=>void close(),idleMs);idleTimer.unref?.();
    try {
      const input=JSON.parse(await readBody(req,maxBodyBytes,bodyTimeoutMs));
      if(!input || typeof input!=='object' || Array.isArray(input) || !Object.hasOwn(input,'state') || !input.questions || typeof input.questions!=='object' || Array.isArray(input.questions))throw new Error('INVALID');
      const controller=new AbortController();
      res.once('close',()=>{if(!res.writableEnded)controller.abort();});
      const upstreamSignal=AbortSignal.any([controller.signal,AbortSignal.timeout(upstreamTimeoutMs)]);
      const upstream=await transport(endpoint,{method:'POST',redirect:'error',headers:{Authorization:`Bearer ${config.apiKey}`,'Content-Type':'application/json'},body:JSON.stringify({model,state:input.state,questions:input.questions}),signal:upstreamSignal});
      if(!upstream.ok){const originalStatus=Number(upstream.status)||502,status=originalStatus>=300&&originalStatus<400?502:originalStatus;const retry=upstream.headers?.get?.('retry-after');if(retry)res.setHeader('Retry-After',retry);send(res,status,{error:`TYPESAFE_HTTP_${originalStatus}`});return;}
      const data=await upstream.json();send(res,200,data);
    } catch(error) {
      send(res,error?.message==='TOO_LARGE'?413:error instanceof SyntaxError || error?.message==='INVALID'?400:502);
    }
  });
  server.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});
  server.on('clientError',(_error,socket)=>socket.destroy());
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const port=server.address().port,url=`http://127.0.0.1:${port}/v1/systemone`;
  try {
    await mkdir(dirname(descriptorPath),{recursive:true,mode:0o700});
    await chmod(dirname(descriptorPath),0o700);
    await writeFile(descriptorPath,JSON.stringify({version:1,url,token,expiresAt:Date.now()+maxLifetimeMs})+'\n',{mode:0o600});
    await chmod(descriptorPath,0o600);
  } catch(error) {
    await new Promise(resolve=>server.close(()=>resolve()));
    try {const current=JSON.parse(await readFile(descriptorPath,'utf8'));if(current.token===token)await unlink(descriptorPath);} catch {}
    throw error;
  }
  idleTimer=setTimeout(()=>void close(),idleMs);idleTimer.unref?.();
  lifetimeTimer=setTimeout(()=>void close(),maxLifetimeMs);lifetimeTimer.unref?.();
  function close(){
    if(closePromise)return closePromise;
    closePromise=(async()=>{
      clearTimeout(idleTimer);clearTimeout(lifetimeTimer);
      const closed=new Promise(resolve=>server.close(()=>resolve()));
      for(const socket of sockets)socket.destroy();
      await closed;
      try {const current=JSON.parse(await readFile(descriptorPath,'utf8'));if(current.token===token)await unlink(descriptorPath);} catch {}
    })();
    return closePromise;
  }
  return {url,port,close};
}

export async function runBridgeCli({config,transport=createDefaultTransport(),descriptorPath=defaultBridgeDescriptorPath,idleMs=300000,write=line=>console.log(line)}={}) {
  const bridge=await startBridge({config,transport,descriptorPath,idleMs});
  write(JSON.stringify({ready:true,host:'127.0.0.1',port:bridge.port,idleMs}));
  return bridge;
}

function cliIdleMs(argv) {
  const item=argv.find(value=>value.startsWith('--idle-ms='));
  const value=item?Number(item.slice(10)):300000;
  if(!Number.isInteger(value) || value<10000 || value>3600000)throw new Error('BRIDGE_INVALID_IDLE');
  return value;
}

const main=typeof process!=='undefined' && process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href;
if(main){
  try {
    const bridge=await runBridgeCli({config:await loadConfig(),idleMs:cliIdleMs(process.argv.slice(2))});
    const stop=async()=>{await bridge.close();process.exit(0);};
    process.once('SIGINT',stop);process.once('SIGTERM',stop);
  } catch(error) {
    const message=String(error?.message||'');
    const safe=/^(KEY_MISSING|CONFIG_|MODEL_PROXY_|BRIDGE_INVALID_IDLE)/.test(message)?message:'BRIDGE_START_FAILED';
    console.error(JSON.stringify({ready:false,error:safe}));process.exitCode=1;
  }
}
