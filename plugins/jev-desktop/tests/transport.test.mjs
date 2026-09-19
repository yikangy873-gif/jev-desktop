import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import https from 'node:https';
import {createDefaultTransport,endpoint} from '../scripts/transport.mjs';
import {createClient} from '../scripts/client.mjs';
import {execFileSync} from 'node:child_process';

const proxyEnv={HTTPS_PROXY:'http://local-proxy.invalid:8080',HTTP_PROXY:'http://http-proxy.invalid:8080',NO_PROXY:'localhost',https_proxy:'http://lower-proxy.invalid:8080',no_proxy:'127.0.0.1'};
const init={method:'POST',redirect:'error',headers:{Authorization:'Bearer fake-test-key'},body:'{"state":"synthetic"}'};
test('restricted host without process uses its provided fetch without probing environment',()=>{
  const script=`const {createDefaultTransport}=await import('./scripts/transport.mjs');const nativeFetch=globalThis.fetch;delete globalThis.process;if(createDefaultTransport()!==nativeFetch)throw Error('Wrong transport');`;
  assert.doesNotThrow(()=>execFileSync(process.execPath,['--input-type=module','-e',script],{cwd:new URL('..',import.meta.url),stdio:'pipe'}));
});
function fixture({status=200,body='{"answers":{}}',hold=false,error=false}={}) {
  const agents=[],calls=[],responses=[];let destroyed=0;
  class Agent {constructor(options){agents.push(options);}}
  const request=(url,options,callback)=>{
    const req=new EventEmitter();calls.push({url,options,req});
    req.destroy=()=>{destroyed++;};
    req.end=sent=>{calls.at(-1).body=sent;queueMicrotask(()=>{
      if(error){req.emit('error',Error('private proxy error'));return;}
      const res=new PassThrough();res.statusCode=status;res.headers={'retry-after':'2',location:'https://evil.invalid'};responses.push(res);callback(res);
      if(!hold)res.end(body);
    });};
    return req;
  };
  return {agents,calls,responses,request,Agent,get destroyed(){return destroyed;}};
}
const configured=(f,extra={})=>createDefaultTransport({env:proxyEnv,nodeVersion:'24.11.1',requestImpl:f.request,AgentImpl:f.Agent,...extra});

test('no proxy returns the existing fetch implementation without creating an agent',()=>{
  const f=fixture(),fetchImpl=()=>{};assert.equal(configured(f,{env:{},fetchImpl}),fetchImpl);assert.equal(f.agents.length,0);
});

test('scoped agent gets only proxy env, retains NO_PROXY/case precedence, and is reused without global changes',async()=>{
  const f=fixture(),previousFetch=globalThis.fetch,previousAgent=https.globalAgent;
  const transport=configured(f,{env:{...proxyEnv,UNRELATED_PRIVATE_ENV:'not copied'}});
  assert.equal(typeof transport,'function');assert.equal(f.agents.length,1);assert.deepEqual(f.agents[0].proxyEnv,proxyEnv);assert.equal(f.agents[0].keepAlive,true);
  for(let i=0;i<2;i++){const response=await transport(endpoint,init);assert.equal(response.ok,true);assert.deepEqual(await response.json(),{answers:{}});}
  assert.equal(f.calls.length,2);assert.equal(f.calls[0].options.agent,f.calls[1].options.agent);assert.equal(f.calls[0].url,endpoint);assert.equal(f.calls[0].body,init.body);
  assert.equal(globalThis.fetch,previousFetch);assert.equal(https.globalAgent,previousAgent);
});

test('proxy support enforces exact supported runtime boundaries without leaking config',()=>{
  for(const nodeVersion of ['22.21.0','22.30.0','24.5.0','24.11.1','25.0.0','26.1.0'])assert.equal(typeof configured(fixture(),{nodeVersion}),'function');
  for(const nodeVersion of ['20.19.0','22.20.9','23.11.0','24.4.9','invalid'])assert.throws(()=>configured(fixture(),{nodeVersion}),/^Error: MODEL_PROXY_RUNTIME_UNSUPPORTED$/);
});

test('agent initialization errors are sanitized',()=>{
  assert.throws(()=>configured(fixture(),{AgentImpl:class{constructor(){throw Error('private proxy URL password');}}}),/^Error: MODEL_PROXY_CONFIGURATION_ERROR$/);
});

test('native transport rejects unpinned endpoints or changed request method before networking',async()=>{
  const f=fixture(),transport=configured(f);
  for(const [url,options] of [['https://evil.invalid',init],[endpoint,{...init,method:'GET'}],[endpoint,{...init,redirect:'follow'}]]) await assert.rejects(transport(url,options),/^Error: MODEL_TRANSPORT_SCOPE_ERROR$/);
  assert.equal(f.calls.length,0);
});

test('redirect is returned as HTTP failure without following or reading provider body',async()=>{
  const f=fixture({status:302,hold:true}),transport=configured(f);
  const response=await transport(endpoint,init);assert.equal(response.ok,false);assert.equal(response.status,302);assert.equal(f.calls.length,1);assert.equal(f.responses[0].destroyed,true);
  await assert.rejects(createClient({apiKey:'fake-test-key'},transport)('synthetic',{}),/^Error: TYPESAFE_HTTP_302: retry after 2s$/);assert.equal(f.calls.length,2);
});

test('native network errors are sanitized and never retried',async()=>{
  const f=fixture({error:true});await assert.rejects(configured(f)(endpoint,init),/^Error: MODEL_NETWORK_OR_TIMEOUT$/);assert.equal(f.calls.length,1);
});

test('already-aborted signal prevents native POST',async()=>{
  const f=fixture(),controller=new AbortController();controller.abort(Error('private abort'));
  await assert.rejects(configured(f)(endpoint,{...init,signal:controller.signal}),/^Error: MODEL_NETWORK_OR_TIMEOUT$/);assert.equal(f.calls.length,0);
});

for(const when of ['before-headers','during-body'])test(`native cancellation remains active ${when}`,async()=>{
  const f=fixture({hold:true}),controller=new AbortController(),pending=configured(f)(endpoint,{...init,signal:controller.signal});
  if(when==='during-body') {await new Promise(r=>setImmediate(r));f.responses[0].write('{"answers":');}
  controller.abort(Error('private cancellation'));
  await assert.rejects(pending,/MODEL_NETWORK_OR_TIMEOUT/);assert.equal(f.calls.length,1);assert.ok(f.destroyed>=1);
  if(when==='during-body')assert.equal(f.responses[0].destroyed,true);
});

test('successful headers followed by stalled body obey client timeout',async()=>{
  const f=fixture({hold:true}),client=createClient({apiKey:'fake-test-key'},configured(f));
  const keepAlive=setTimeout(()=>{},1000);
  try{await assert.rejects(client('synthetic',{}, {timeoutMs:15}),/^Error: MODEL_NETWORK_OR_TIMEOUT$/);}finally{clearTimeout(keepAlive);}
  assert.equal(f.calls.length,1);assert.equal(f.responses[0].destroyed,true);
});

test('response stream error after headers cannot leak body or transport details',async()=>{
  const f=fixture({hold:true}),pending=configured(f)(endpoint,init);await new Promise(r=>setImmediate(r));
  f.responses[0].destroy(Error('private provider body'));await assert.rejects(pending,/^Error: MODEL_NETWORK_OR_TIMEOUT$/);
});

test('injected fetch remains authoritative and malformed JSON remains sanitized',async()=>{
  let calls=0;const client=createClient({apiKey:'fake-test-key'},async(url,options)=>{calls++;assert.equal(url,endpoint);assert.equal(options.redirect,'error');return {ok:true,json:async()=>{throw Error('private body');}};});
  await assert.rejects(client('synthetic',{}),/^Error: INVALID_MODEL_JSON$/);assert.equal(calls,1);
});

for(const mode of ['cancel','timeout'])test(`client identifies ${mode} while awaiting JSON rather than invalid JSON`,async()=>{
  const controller=new AbortController();let jsonStarted;
  const began=new Promise(r=>jsonStarted=r);
  const client=createClient({apiKey:'fake-test-key'},async(url,{signal})=>({ok:true,json:async()=>{jsonStarted();await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('private body abort')),{once:true}));}}));
  const keepAlive=setTimeout(()=>{},1000),pending=client('synthetic',{}, {signal:controller.signal,timeoutMs:mode==='timeout'?15:1000});
  await began;if(mode==='cancel')controller.abort();
  try{await assert.rejects(pending,mode==='cancel'?/^Error: CANCELLED$/:/^Error: MODEL_NETWORK_OR_TIMEOUT$/);}finally{clearTimeout(keepAlive);}
});
