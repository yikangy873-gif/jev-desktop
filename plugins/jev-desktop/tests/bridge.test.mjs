import test from 'node:test';
import assert from 'node:assert/strict';
import {access,chmod,mkdtemp,readFile,stat,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {request as httpRequest} from 'node:http';
import {connect as netConnect} from 'node:net';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {runBridgeCli,startBridge} from '../scripts/bridge-server.mjs';
import {createLocalBridgeClient,loadBridgeDescriptor} from '../scripts/bridge-client.mjs';

const execFileAsync=promisify(execFile);

test('authenticated loopback bridge forwards only scoped JSON and keeps the TypeSafe key upstream',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'jev-bridge-')),descriptorPath=join(dir,'bridge.json');
  let upstream;
  const bridge=await startBridge({
    config:{apiKey:'typesafe-private-test-key',model:'jev-test'},descriptorPath,idleMs:60000,
    transport:async(url,init)=>{upstream={url,init};return {ok:true,status:200,headers:new Headers(),json:async()=>({answers:{next:{choice:'done'}}})};},
  });
  t.after(()=>bridge.close());
  const descriptor=JSON.parse(await readFile(descriptorPath,'utf8'));
  assert.equal((await stat(descriptorPath)).mode&0o077,0);
  assert.match(descriptor.url,/^http:\/\/127\.0\.0\.1:\d+\/v1\/systemone$/);

  const unauthorized=await fetch(descriptor.url,{method:'POST',headers:{'Content-Type':'application/json'},body:'{"state":{},"questions":{}}'});
  assert.equal(unauthorized.status,401);assert.equal(upstream,undefined);
  const response=await fetch(descriptor.url,{method:'POST',redirect:'error',headers:{Authorization:`Bridge ${descriptor.token}`,'Content-Type':'application/json'},body:JSON.stringify({state:{task:'safe'},questions:{next:{}}})});
  assert.equal(response.status,200);assert.deepEqual(await response.json(),{answers:{next:{choice:'done'}}});
  assert.equal(upstream.url,'https://api.typesafe.ai/v1/systemone');
  assert.equal(upstream.init.headers.Authorization,'Bearer typesafe-private-test-key');
  assert.deepEqual(JSON.parse(upstream.init.body),{model:'jev-test',state:{task:'safe'},questions:{next:{}}});
});

test('bridge health is local, credential-free and contains no configuration',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'jev-bridge-')),descriptorPath=join(dir,'bridge.json');
  const bridge=await startBridge({config:{apiKey:'private-key',model:'jev-test'},descriptorPath,idleMs:60000,transport:async()=>assert.fail('health must not call upstream')});
  t.after(()=>bridge.close());
  const response=await fetch(`http://127.0.0.1:${bridge.port}/health`,{redirect:'error'});
  assert.equal(response.status,200);assert.deepEqual(await response.json(),{ready:true});
});

test('bridge fixes an existing descriptor to mode 0600',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'jev-bridge-')),descriptorPath=join(dir,'bridge.json');
  await chmod(dir,0o755);
  await writeFile(descriptorPath,'stale\n',{mode:0o644});await chmod(descriptorPath,0o644);
  const bridge=await startBridge({config:{apiKey:'private-key',model:'jev-test'},descriptorPath,idleMs:60000,transport:async()=>assert.fail('unused')});
  t.after(()=>bridge.close());assert.equal((await stat(descriptorPath)).mode&0o077,0);assert.equal((await stat(dir)).mode&0o077,0);
});

test('bridge rejects untrusted local requests before upstream access',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'jev-bridge-')),descriptorPath=join(dir,'bridge.json');let calls=0;
  const bridge=await startBridge({config:{apiKey:'private-key',model:'jev-test'},descriptorPath,idleMs:60000,maxBodyBytes:32,transport:async()=>{calls++;return {ok:true,status:200,headers:new Headers(),json:async()=>({})};}});
  t.after(()=>bridge.close());const descriptor=JSON.parse(await readFile(descriptorPath,'utf8'));
  const base={method:'POST',redirect:'error',headers:{Authorization:`Bridge ${descriptor.token}`,'Content-Type':'application/json'},body:'{"state":{},"questions":{}}'};
  const cases=[
    [{...base,headers:{...base.headers,Origin:'https://evil.invalid'}},403],
    [{...base,headers:{...base.headers,Authorization:'Bridge wrong'}},401],
    [{...base,headers:{...base.headers,'Content-Type':'text/plain'}},415],
    [{...base,method:'PUT'},404],
    [{...base,body:'not json'},400],
    [{...base,body:'{"state":"012345678901234567890123456789","questions":{}}'},413],
  ];
  for(const [init,status] of cases)assert.equal((await fetch(descriptor.url,init)).status,status);
  const wrongHostStatus=await new Promise((resolve,reject)=>{const request=httpRequest(descriptor.url,{method:'POST',headers:{...base.headers,Host:'evil.invalid'}},response=>{response.resume();resolve(response.statusCode);});request.on('error',reject);request.end(base.body);});
  assert.equal(wrongHostStatus,403);
  assert.equal((await fetch(`http://127.0.0.1:${bridge.port}/other`,base)).status,404);
  assert.equal(calls,0);
});

test('bridge never relays upstream error bodies or redirects',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'jev-bridge-')),descriptorPath=join(dir,'bridge.json');
  const bridge=await startBridge({config:{apiKey:'private-key',model:'jev-test'},descriptorPath,idleMs:60000,transport:async()=>({ok:false,status:302,headers:new Headers({'retry-after':'3'}),json:async()=>assert.fail('must not read private provider body')})});
  t.after(()=>bridge.close());const descriptor=JSON.parse(await readFile(descriptorPath,'utf8'));
  const response=await fetch(descriptor.url,{method:'POST',redirect:'error',headers:{Authorization:`Bridge ${descriptor.token}`,'Content-Type':'application/json'},body:'{"state":{},"questions":{}}'});
  assert.equal(response.status,502);assert.equal(response.headers.get('retry-after'),'3');assert.deepEqual(await response.json(),{error:'TYPESAFE_HTTP_302'});
});

test('bridge bounds a stalled upstream independently of the CUA caller',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'jev-bridge-')),descriptorPath=join(dir,'bridge.json');
  const bridge=await startBridge({config:{apiKey:'private-key',model:'jev-test'},descriptorPath,idleMs:60000,upstreamTimeoutMs:15,transport:async(_url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('private upstream stall')),{once:true}))});
  t.after(()=>bridge.close());const descriptor=JSON.parse(await readFile(descriptorPath,'utf8'));
  const response=await fetch(descriptor.url,{method:'POST',headers:{Authorization:`Bridge ${descriptor.token}`,'Content-Type':'application/json'},body:'{"state":{},"questions":{}}',signal:AbortSignal.timeout(200)});
  assert.equal(response.status,502);assert.deepEqual(await response.json(),{error:'BRIDGE_REQUEST_REJECTED'});
});

test('idle expiry closes the bridge and removes only its own descriptor',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'jev-bridge-')),descriptorPath=join(dir,'bridge.json');
  await startBridge({config:{apiKey:'private-key',model:'jev-test'},descriptorPath,idleMs:20,transport:async()=>assert.fail('unused')});
  await new Promise(r=>setTimeout(r,60));await assert.rejects(access(descriptorPath));

  const second=await startBridge({config:{apiKey:'private-key',model:'jev-test'},descriptorPath,idleMs:60000,transport:async()=>assert.fail('unused')});
  await writeFile(descriptorPath,'{"version":1,"token":"newer"}\n',{mode:0o600});await second.close();
  assert.equal(JSON.parse(await readFile(descriptorPath,'utf8')).token,'newer');
});

test('idle shutdown aborts an incomplete authenticated body and finishes cleanup promptly',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'jev-bridge-')),descriptorPath=join(dir,'bridge.json');
  const bridge=await startBridge({config:{apiKey:'private-key',model:'jev-test'},descriptorPath,idleMs:20,bodyTimeoutMs:1000,transport:async()=>assert.fail('partial body must not reach upstream')});
  const descriptor=JSON.parse(await readFile(descriptorPath,'utf8'));
  const socket=netConnect({host:'127.0.0.1',port:bridge.port});
  await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('error',reject);});
  socket.write(`POST /v1/systemone HTTP/1.1\r\nHost: 127.0.0.1:${bridge.port}\r\nAuthorization: Bridge ${descriptor.token}\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n{`);
  await new Promise(r=>setTimeout(r,60));
  let settled=false;const closed=bridge.close().then(()=>{settled=true;});
  await new Promise(r=>setTimeout(r,20));
  const prompt=settled;
  socket.destroy();await closed;
  assert.equal(prompt,true);await assert.rejects(access(descriptorPath));
});

test('request-body deadline terminates a partial authenticated body',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'jev-bridge-')),descriptorPath=join(dir,'bridge.json');
  const bridge=await startBridge({config:{apiKey:'private-key',model:'jev-test'},descriptorPath,idleMs:60000,bodyTimeoutMs:20,transport:async()=>assert.fail('partial body must not reach upstream')});
  const descriptor=JSON.parse(await readFile(descriptorPath,'utf8'));
  const socket=netConnect({host:'127.0.0.1',port:bridge.port});
  await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('error',reject);});
  let ended=false;socket.once('close',()=>{ended=true;});
  socket.write(`POST /v1/systemone HTTP/1.1\r\nHost: 127.0.0.1:${bridge.port}\r\nAuthorization: Bridge ${descriptor.token}\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n{`);
  await new Promise(r=>setTimeout(r,60));
  const timedOut=ended;socket.destroy();await bridge.close();assert.equal(timedOut,true);
});

test('descriptor remains valid while accepted requests extend idle within a hard lifetime',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'jev-bridge-')),descriptorPath=join(dir,'bridge.json');
  const bridge=await startBridge({config:{apiKey:'private-key',model:'jev-test'},descriptorPath,idleMs:100,maxLifetimeMs:1000,transport:async()=>({ok:true,status:200,headers:new Headers(),json:async()=>({answers:{}})})});
  t.after(()=>bridge.close());const descriptor=JSON.parse(await readFile(descriptorPath,'utf8'));
  await new Promise(r=>setTimeout(r,70));
  assert.equal((await fetch(descriptor.url,{method:'POST',headers:{Authorization:`Bridge ${descriptor.token}`,'Content-Type':'application/json'},body:'{"state":{},"questions":{}}'})).status,200);
  await new Promise(r=>setTimeout(r,60));
  assert.equal((await loadBridgeDescriptor(descriptorPath)).url,descriptor.url);
  assert.equal((await fetch(`http://127.0.0.1:${bridge.port}/health`)).status,200);
});

test('concurrent close callers join cleanup instead of returning before descriptor removal',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'jev-bridge-')),descriptorPath=join(dir,'bridge.json');let release,started;
  const began=new Promise(r=>started=r);
  const bridge=await startBridge({config:{apiKey:'private-key',model:'jev-test'},descriptorPath,idleMs:60000,transport:async()=>{started();return new Promise(r=>release=()=>r({ok:true,status:200,headers:new Headers(),json:async()=>({answers:{}})}));}});
  const descriptor=JSON.parse(await readFile(descriptorPath,'utf8'));
  const request=fetch(descriptor.url,{method:'POST',headers:{Authorization:`Bridge ${descriptor.token}`,'Content-Type':'application/json'},body:'{"state":{},"questions":{}}'}).then(()=> 'resolved',()=> 'rejected');await began;
  const first=bridge.close(),second=bridge.close();assert.equal(first,second);
  await Promise.all([first,second]);await assert.rejects(access(descriptorPath));
  release();assert.equal(await request,'rejected');
});

test('local bridge client reads only the protected descriptor and matches the Jev client contract',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'jev-bridge-')),descriptorPath=join(dir,'bridge.json');let upstream;
  const bridge=await startBridge({config:{apiKey:'typesafe-private-key',model:'jev-test'},descriptorPath,idleMs:60000,transport:async(url,init)=>{upstream={url,init};return {ok:true,status:200,headers:new Headers(),json:async()=>({answers:{next:{choice:'preview'}},model:'jev-test',usage:{input_tokens:7}})};}});
  t.after(()=>bridge.close());
  let localRequest;
  const client=await createLocalBridgeClient({descriptorPath,fetchImpl:async(url,init)=>{localRequest={url,init};return fetch(url,init);}});
  const result=await client({task:'synthetic'},{next:{type:'choice'}},{timeoutMs:1000});
  assert.equal(result.answers.next.choice,'preview');assert.equal(result.model,'jev-test');assert.equal(result.usage.input_tokens,7);assert.ok(result.latencyMs>=0);
  assert.match(localRequest.init.headers.Authorization,/^Bridge /);assert.ok(!localRequest.init.headers.Authorization.includes('typesafe-private-key'));
  assert.deepEqual(JSON.parse(localRequest.init.body),{state:{task:'synthetic'},questions:{next:{type:'choice'}}});
  assert.equal(upstream.init.headers.Authorization,'Bearer typesafe-private-key');
});

test('bridge descriptor validation rejects stale, permissive and non-loopback sessions',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'jev-bridge-')),descriptorPath=join(dir,'bridge.json');
  const valid={version:1,url:'http://127.0.0.1:32123/v1/systemone',token:'x'.repeat(32),expiresAt:Date.now()+60000};
  const invalid=[
    {...valid,version:2},
    {...valid,url:'http://localhost:32123/v1/systemone'},
    {...valid,url:'https://127.0.0.1:32123/v1/systemone'},
    {...valid,url:'http://user:pass@127.0.0.1:32123/v1/systemone'},
    {...valid,url:'http://127.0.0.1:32123/v1/systemone?next=https://evil.invalid'},
    {...valid,expiresAt:Date.now()-1},
    {...valid,token:'short'},
  ];
  for(const value of invalid){await writeFile(descriptorPath,JSON.stringify(value),{mode:0o600});await chmod(descriptorPath,0o600);await assert.rejects(loadBridgeDescriptor(descriptorPath),/^Error: BRIDGE_DESCRIPTOR_INVALID$/);}
  await writeFile(descriptorPath,JSON.stringify(valid),{mode:0o600});await chmod(descriptorPath,0o644);await assert.rejects(loadBridgeDescriptor(descriptorPath),/^Error: BRIDGE_DESCRIPTOR_PERMISSIONS$/);
});

for(const mode of ['cancel','timeout'])test(`bridge client sanitizes ${mode} while waiting`,async()=>{
  const dir=await mkdtemp(join(tmpdir(),'jev-bridge-')),descriptorPath=join(dir,'bridge.json');
  await writeFile(descriptorPath,JSON.stringify({version:1,url:'http://127.0.0.1:32123/v1/systemone',token:'x'.repeat(32),expiresAt:Date.now()+60000}),{mode:0o600});
  let began;const started=new Promise(r=>began=r),controller=new AbortController();
  const client=await createLocalBridgeClient({descriptorPath,fetchImpl:async(_url,{signal})=>{began();await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('private bridge failure')),{once:true}));}});
  const pending=client({}, {},{signal:controller.signal,timeoutMs:mode==='timeout'?15:1000});await started;if(mode==='cancel')controller.abort();
  await assert.rejects(pending,mode==='cancel'?/^Error: CANCELLED$/:/^Error: MODEL_NETWORK_OR_TIMEOUT$/);
});

test('bridge client never reads error bodies and works without global process',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'jev-bridge-')),descriptorPath=join(dir,'bridge.json');
  const descriptor={version:1,url:'http://127.0.0.1:32123/v1/systemone',token:'x'.repeat(32),expiresAt:Date.now()+60000};
  await writeFile(descriptorPath,JSON.stringify(descriptor),{mode:0o600});
  const client=await createLocalBridgeClient({descriptorPath,fetchImpl:async()=>({ok:false,status:502,headers:new Headers({'retry-after':'4'}),json:async()=>assert.fail('must not read secret body')})});
  await assert.rejects(client({},{}),/^Error: TYPESAFE_HTTP_502: retry after 4s$/);

  const live=await startBridge({config:{apiKey:'private-key',model:'jev-test'},descriptorPath,idleMs:60000,transport:async()=>({ok:true,status:200,headers:new Headers(),json:async()=>({answers:{next:{choice:'ok'}}})})});
  t.after(()=>live.close());
  const moduleUrl=new URL('../scripts/bridge-client.mjs',import.meta.url).href;
  const script=`const {createLocalBridgeClient}=await import(${JSON.stringify(moduleUrl)});delete globalThis.process;const client=await createLocalBridgeClient({descriptorPath:${JSON.stringify(descriptorPath)}});const result=await client({},{});if(result.answers.next.choice!=='ok')throw Error('wrong result');`;
  await assert.doesNotReject(execFileAsync(process.execPath,['--input-type=module','-e',script]));
});

test('bridge CLI output exposes readiness but no token, key or descriptor path',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'jev-bridge-')),descriptorPath=join(dir,'bridge.json'),lines=[];
  const bridge=await runBridgeCli({config:{apiKey:'private-typesafe-key',model:'jev-test'},descriptorPath,idleMs:60000,transport:async()=>assert.fail('health must not call upstream'),write:line=>lines.push(line)});
  try {
    assert.equal(lines.length,1);const status=JSON.parse(lines[0]);
    assert.deepEqual(Object.keys(status).sort(),['host','idleMs','port','ready']);assert.equal(status.ready,true);assert.equal(status.host,'127.0.0.1');assert.equal(status.idleMs,60000);assert.equal(status.port,bridge.port);
    assert.ok(!lines[0].includes('private-typesafe-key'));assert.ok(!lines[0].includes('bridge.json'));
    assert.equal((await fetch(`http://127.0.0.1:${status.port}/health`)).status,200);
  } finally {await bridge.close();}
  await assert.rejects(access(descriptorPath));
});

test('failed descriptor setup rolls back the listening server so the process exits',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'jev-bridge-'));
  const moduleUrl=new URL('../scripts/bridge-server.mjs',import.meta.url).href;
  const script=`const {startBridge}=await import(${JSON.stringify(moduleUrl)});try{await startBridge({config:{apiKey:'fake',model:'jev-test'},descriptorPath:${JSON.stringify(dir)},transport:async()=>{throw Error('unused')}});throw Error('unexpected success')}catch(error){if(error.message==='unexpected success')throw error}`;
  await assert.doesNotReject(execFileAsync(process.execPath,['--input-type=module','-e',script],{timeout:300}));
});
