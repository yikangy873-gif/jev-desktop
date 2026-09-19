import test from 'node:test';
import assert from 'node:assert/strict';
import * as fast from '../scripts/fast-path.mjs';

const results='Browser tab: 1, Title: "jev_百度搜索", URL: "https://www.baidu.com/s?wd=jev".\n0 AXWebArea jev_百度搜索\n 1 container content_left\n   2 heading Jev model, Value: 3';
function fixture(states=[results]) {
  const calls=[];
  const tab={goto:async url=>{calls.push(['goto',url]);},getAXState:async()=>{calls.push(['observe']);return states.length>1?states.shift():states[0];}};
  const cua={createBrowserTab:async(...args)=>{calls.push(['create',...args]);return tab;}};
  return {tab,cua,calls};
}

test('encodes query as data, pins Baidu, no model dependency',()=>{
  assert.equal(typeof fast.baiduSearchUrl,'function');
  const url=new URL(fast.baiduSearchUrl('Jev & 中文#?'));
  assert.equal(url.origin,'https://www.baidu.com');assert.equal(url.pathname,'/s');
  assert.equal(url.searchParams.get('wd'),'Jev & 中文#?');
  assert.throws(()=>fast.baiduSearchUrl('  '));
});
test('fresh-tab direct search completes with zero Jev requests and explicit timing boundaries',async()=>{
  assert.equal(typeof fast.searchBaidu,'function');
  const f=fixture();const result=await fast.searchBaidu({cua:f.cua,browser:'chrome',query:'jev'});
  assert.equal(result.status,'done');assert.equal(result.verified,true);assert.equal(result.requests,0);
  assert.equal(result.tab,f.tab);assert.deepEqual(f.calls.map(c=>c[0]),['create','observe']);
  assert.ok(result.timing.totalMs>=result.timing.openMs);
  assert.equal(result.timing.boundary,'helper start through visible-result verification; excludes Codex planning and browser bootstrap');
});
test('reuse is explicit, navigates once, and waits for actual headings',async()=>{
  const f=fixture(['0 AXWebArea Loading',results]);
  const result=await fast.searchBaidu({tab:f.tab,query:'jev'});
  assert.equal(result.status,'done');assert.deepEqual(f.calls.map(c=>c[0]),['goto','observe','observe']);
});
test('URL alone, wrong query, and no result body cannot pass verification',()=>{
  assert.equal(fast.isBaiduResult(results,'jev'),true);
  assert.equal(fast.isBaiduResult(results,'different'),false);
  assert.equal(fast.isBaiduResult(results.split('\n').slice(0,2).join('\n'),'jev'),false);
  assert.equal(fast.isBaiduResult(results.replace('www.baidu.com','evil.example'),'jev'),false);
});
test('loading observation budget is bounded without repeated navigation',async()=>{
  const f=fixture(['0 AXWebArea Loading']);
  const result=await fast.searchBaidu({tab:f.tab,query:'jev',maxObservations:2});
  assert.equal(result.status,'waiting_for_ui');assert.equal(result.verified,false);
  assert.deepEqual(f.calls.map(c=>c[0]),['goto','observe','observe']);
});
test('uncertain navigation stops without replay or leaking transport data',async()=>{
  let calls=0;const tab={goto:async()=>{calls++;throw Error('secret');}};
  const result=await fast.searchBaidu({tab,query:'jev'});
  assert.equal(result.status,'needs_inspection');assert.equal(calls,1);
  assert.ok(!JSON.stringify(result).includes('secret'));
});
test('invalid observation budget cannot create or navigate a tab',async()=>{
  const f=fixture();await assert.rejects(fast.searchBaidu({tab:f.tab,query:'jev',maxObservations:Infinity}));
  assert.equal(f.calls.length,0);
});
test('footer heading and text prose are not search result headings',()=>{
  assert.equal(fast.isBaiduResult(results.replace('   2 heading Jev model, Value: 3',' 2 container footer\n   3 heading Help'),'jev'),false);
  assert.equal(fast.isBaiduResult(results.replace('   2 heading Jev model, Value: 3','   2 text Some heading words'),'jev'),false);
});
test('slow navigation still receives one final verification, without replay',async()=>{
  const f=fixture();f.tab.goto=async()=>{f.calls.push(['goto']);await new Promise(resolve=>setTimeout(resolve,5));};
  const result=await fast.searchBaidu({tab:f.tab,query:'jev',maxTotalMs:1});
  assert.equal(result.status,'done');assert.equal(result.observations,1);
});
