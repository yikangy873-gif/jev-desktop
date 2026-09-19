import test from 'node:test';
import assert from 'node:assert/strict';
import {createCodexJev} from '../scripts/codex-adapter.mjs';
import {decision} from './helpers/decision.mjs';

function fixture(kind='tab') {
  let stage=0,reads=0,screenshots=0;const calls=[],states=[];
  const image=Buffer.from('fixture screenshot');
  const target={getAXState:async()=>{reads++;return `0 AXWebArea Fixture\n  1 button Next\n  2 text stage ${stage}`;},
    click:async id=>{calls.push(id);stage++;},getScreenshot:async options=>{assert.deepEqual(options,{emit:false});screenshots++;return image;},
    close:()=>assert.fail('must not close caller target')};
  const options={target,kind,targetName:'Fixture',goal:'Reach stage two',shareWithTypeSafe:true,clickLabels:['Next'],verify:()=>stage===2,
    client:async(s,q)=>{states.push(s);return decision(q,'click_1');}};
  return {target,options,calls,states,image,get reads(){return reads;},get screenshots(){return screenshots;}};
}

test('facade exposes only a fixed-target runner, state, stop and local raw-state accessor',()=>{
  const f=fixture();const adapter=createCodexJev(f.options);
  assert.deepEqual(Object.keys(adapter).sort(),['latestState','run','state','stop']);
  assert.equal(adapter.state().status,'ready');assert.equal(adapter.state().trace,undefined);
  assert.equal(adapter.latestState(),'');assert.equal(f.reads,0);assert.equal(f.screenshots,0);
});

test('facade fails closed before any UI read when the bridge client is omitted',()=>{
  const f=fixture();delete f.options.client;
  assert.throws(()=>createCodexJev(f.options),/^Error: CODEX_ADAPTER_REQUIRES_BRIDGE_CLIENT$/);
  assert.equal(f.reads,0);assert.equal(f.screenshots,0);assert.equal(f.calls.length,0);
});

for(const kind of ['app','tab']) test(`${kind}: chunked runs retain model memory and cumulative metrics`,async()=>{
  const f=fixture(kind),adapter=createCodexJev(f.options);
  const first=await adapter.run({maxActions:1});assert.equal(first.status,'yielded');assert.equal(first.requests,1);assert.equal(first.trace,undefined);assert.equal(first.screenshotStatus,'not_requested');assert.equal(first.screenshotMs,0);
  const second=await adapter.run({includeTrace:true});assert.equal(second.status,'done');assert.equal(second.verified,true);assert.equal(second.requests,2);assert.equal(second.trace.length,2);assert.equal(f.states[1].recentActions.length,1);
  assert.ok(second.adapterElapsedMs>=0);assert.ok(!('fullTurnMs' in second));assert.equal(f.screenshots,0);
  const reads=f.reads;const state=adapter.state();assert.equal(state.status,'done');assert.equal(state.verified,true);assert.equal(state.mutationCount,2);assert.equal(state.trace,undefined);assert.equal(state.finalScreenshot,undefined);assert.equal(f.reads,reads);
  assert.match(adapter.latestState(),/stage 2/);
});

test('optional final screenshot occurs once after all actions, stays separate, and is never sent to Jev',async()=>{
  const f=fixture(),adapter=createCodexJev(f.options);const capture=f.target.getScreenshot;
  f.target.getScreenshot=async options=>{assert.equal(f.calls.length,2);return capture(options);};
  const result=await adapter.run({captureFinalScreenshot:true});assert.equal(result.status,'done');assert.equal(result.verified,true);assert.equal(result.screenshotStatus,'captured');assert.equal(result.finalScreenshot,f.image);assert.equal(f.screenshots,1);assert.ok(result.screenshotMs>=0);
  assert.ok(!JSON.stringify(f.states).includes('fixture screenshot'));assert.equal(adapter.state().finalScreenshot,undefined);
});

test('screenshot failure preserves independent AX verification and sanitizes exception details',async()=>{
  const f=fixture(),adapter=createCodexJev(f.options);
  f.target.getScreenshot=async()=>{throw Error('Bearer private-token raw screenshot details');};
  const result=await adapter.run({captureFinalScreenshot:true});assert.equal(result.status,'done');assert.equal(result.verified,true);assert.equal(result.screenshotStatus,'unavailable');assert.equal(result.finalScreenshot,undefined);assert.equal(result.screenshotReason,'SCREENSHOT_UNAVAILABLE');assert.ok(!JSON.stringify(result).includes('private-token'));
  assert.equal(adapter.state().verified,true);
});

test('missing screenshot support is unavailable without affecting execution',async()=>{
  const f=fixture();delete f.target.getScreenshot;const result=await createCodexJev(f.options).run({captureFinalScreenshot:true});
  assert.equal(result.status,'done');assert.equal(result.verified,true);assert.equal(result.screenshotStatus,'unavailable');
});

test('concurrent run rejects while a decision is pending',async()=>{
  const f=fixture();let release;f.options.client=async(s,q)=>{await new Promise(r=>release=r);return decision(q,'click_1');};
  const adapter=createCodexJev(f.options),pending=adapter.run({maxActions:1});await new Promise(r=>setImmediate(r));
  await assert.rejects(adapter.run(),/ALREADY_RUNNING/);assert.equal(adapter.state().running,true);release();assert.equal((await pending).status,'yielded');assert.equal(adapter.state().running,false);
});

test('stop during model await cancels permanently without screenshot or target closure',async()=>{
  const f=fixture();let release;f.options.client=async(s,q)=>{await new Promise(r=>release=r);return decision(q,'click_1');};
  const adapter=createCodexJev(f.options),pending=adapter.run({captureFinalScreenshot:true});await new Promise(r=>setImmediate(r));
  assert.equal(adapter.stop().status,'cancelled');release();const result=await pending;assert.equal(result.status,'cancelled');assert.equal(result.screenshotStatus,'unavailable');assert.equal(f.calls.length,0);assert.equal(f.screenshots,0);
  const reads=f.reads;assert.equal((await adapter.run({captureFinalScreenshot:true})).status,'cancelled');assert.equal(f.reads,reads);assert.equal(f.screenshots,0);
});

test('concurrency includes final screenshot and stopping during it starts no additional UI work',async()=>{
  const f=fixture();let release,screenshotCalls=0;
  f.target.getScreenshot=async()=>{screenshotCalls++;await new Promise(r=>release=r);return f.image;};
  const adapter=createCodexJev(f.options),pending=adapter.run({captureFinalScreenshot:true});await new Promise(r=>setImmediate(r));
  await assert.rejects(adapter.run(),/ALREADY_RUNNING/);adapter.stop();const reads=f.reads,actions=f.calls.length;release();
  const result=await pending;assert.equal(result.status,'done');assert.equal(result.verified,true);assert.equal(result.screenshotStatus,'captured');
  assert.equal(adapter.state().status,'cancelled');assert.equal((await adapter.run({captureFinalScreenshot:true})).status,'cancelled');assert.equal(f.calls.length,actions);assert.equal(f.reads,reads);assert.equal(screenshotCalls,1);
});

test('facade freezes the selected target and goal against caller option reassignment',async()=>{
  const f=fixture(),adapter=createCodexJev(f.options);f.options.goal='Different task';f.options.target={getAXState:()=>assert.fail('wrong target')};
  assert.equal((await adapter.run({target:f.options.target,goal:f.options.goal})).status,'done');assert.equal(f.states[0].task,'Reach stage two');assert.equal(f.calls.length,2);
});

test('local state and stop do not read the UI or invoke the supplied bridge client',()=>{
  const f=fixture();const adapter=createCodexJev(f.options);
  assert.equal(adapter.state().status,'ready');assert.equal(adapter.stop().status,'cancelled');assert.equal(adapter.state().status,'cancelled');assert.equal(f.reads,0);assert.equal(f.screenshots,0);
});
