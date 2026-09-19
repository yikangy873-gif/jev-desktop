import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createSession, parseAX, buildActions} from '../scripts/runner.mjs';
import {decision} from './helpers/decision.mjs';

const firstDecision=q=>{
  const head=Object.entries(q).find(([name])=>name!=='operation')?.[1];
  return decision(q,Object.keys(head.criteria)[0]);
};
const slots=[{name:'first',fieldLabel:'First',value:'private-alpha'},{name:'second',fieldLabel:'Second',value:'private-beta'}];
test('static labels beside unique editable fields do not disable prepared groups',async()=>{
  const f=setup({fillGroups:[{name:'draft',slots:[0,1]}]});
  const read=f.target.getAXState;
  f.target.getAXState=async()=>`${await read()}\n  4 text First\n  5 text Second`;
  const result=await createSession(f.options).run();
  assert.equal(result.status,'done');assert.equal(result.requests,1);assert.equal(result.trace[0].kind,'fillGroup');
});
test('failed action summary includes its finalized duration',async()=>{
  const f=setup();
  f.target.setValue=async()=>{await new Promise(r=>setTimeout(r,15));throw Error('private failure');};
  const session=createSession(f.options),result=await session.run();
  assert.equal(result.status,'needs_inspection');
  assert.ok(result.trace[0].actionMs>=10);
  assert.equal(result.trace[0].actionMs,session.status().trace[0].actionMs);
});
function setup(extra={}) {
  const values=['','']; const actions=[]; const sent=[]; let reads=0;
  const target={getAXState:async()=>{reads++;return `0 AXWebArea Form\n  1 text field First, Value: ${values[0]}\n  2 text field Second, Value: ${values[1]}\n  3 text ticker ${reads}`;},setValue:async(id,value)=>{actions.push([id,value]);values[id-1]=value;}};
  const options={target,kind:'tab',targetName:'Fixture',goal:'Fill form',shareWithTypeSafe:true,textSlots:slots,
    guardMode:'scoped',scopeCheck:()=>true,decisionContext:()=>({page:'form'}),
    verify:()=>values.every((v,i)=>v===slots[i].value),
    client:async(s,q)=>{sent.push({s,q});return firstDecision(q);},...extra};
  return {options,target,values,actions,sent,get reads(){return reads;}};
}

test('scoped mode requires local synchronous callbacks and bounded pending observations',async()=>{
  const f=setup();
  for(const extra of [{scopeCheck:undefined},{decisionContext:undefined},{guardMode:'unknown'},{maxPendingObservations:Infinity},{maxPendingObservations:NaN},{maxPendingObservations:-1},{maxPendingObservations:1.5},{maxPendingObservations:101}]) assert.throws(()=>createSession({...f.options,...extra}));
  for(const extra of [{scopeCheck:async()=>true},{decisionContext:async()=>({})}]) {
    const g=setup(extra); assert.equal((await createSession(g.options).run()).status,'error');assert.equal(g.actions.length,0);
  }
});

test('scoped guard ignores unrelated ticker text while strict guard preserves full-tree matching',async()=>{
  const f=setup();const result=await createSession(f.options).run();
  assert.equal(result.status,'done');assert.equal(result.requests,2);assert.equal(f.actions.length,2);
  const strict=setup({guardMode:'strict'});assert.equal((await createSession(strict.options).run()).status,'needs_codex');assert.equal(strict.actions.length,0);
});

test('scoped guard rejects changed permission during model await even with identical AX',async()=>{
  let permitted=true; const f=setup({scopeCheck:()=>permitted});
  f.target.getAXState=async()=>'0 AXWebArea Form\n  1 text field First\n  2 text field Second';
  f.options.client=async(s,q)=>{permitted=false;return decision(q,'fill_1_0');};
  const result=await createSession(f.options).run();assert.equal(result.status,'scope_changed');assert.equal(f.actions.length,0);
});

for(const change of ['index','root','parent','context','observation','value','state']) test(`scoped guard regenerates after relevant ${change} changes during model await`,async()=>{
  let changed=false,calls=0,clicked=[];
  const raw=()=>`${change==='root'&&changed?'9 AXWebArea Other':'0 AXWebArea Page'}\n  5 group ${change==='parent'&&changed?'Other':'Form'}\n    ${change==='index'&&changed?2:1} checkbox Go${change==='value'&&changed?', Value: 1':''}${change==='state'&&changed?' [selected]':''}`;
  const f=setup({textSlots:[],clickLabels:['Go'],verify:()=>clicked.length>0,decisionContext:()=>({v:change==='context'&&changed}),observations:[{name:'ready',test:()=>change==='observation'&&changed}]});
  f.target.getAXState=async()=>raw();f.target.click=async id=>clicked.push(id);
  f.options.client=async(s,q)=>{calls++;changed=true;return firstDecision(q);};
  assert.equal((await createSession(f.options).run()).status,'done');assert.equal(calls,2);assert.deepEqual(clicked,[change==='index'?2:1]);
});

test('fill groups choose once, observe between fields, save requests and reads, never transmit values',async()=>{
  const f=setup({fillGroups:[{name:'profile',slots:[0,1]}]});
  const result=await createSession(f.options).run();assert.equal(result.status,'done');assert.equal(result.requests,1);assert.equal(result.steps,1);
  assert.equal(result.trace[0].kind,'fillGroup');assert.equal(result.mutationCount,2);assert.equal(f.reads,4);
  assert.deepEqual(f.actions,[[1,slots[0].value],[2,slots[1].value]]);
  assert.deepEqual(Object.keys(f.sent[0].q.operation.criteria),['FILL_GROUP','DONE','BLOCKED']);
  assert.deepEqual(Object.keys(f.sent[0].q.fill_group_target.criteria),['fill_group_0']);
  for(const value of slots.map(s=>s.value)) {assert.ok(!JSON.stringify(f.sent).includes(value));assert.ok(!JSON.stringify(result).includes(value));}
  const serial=setup();assert.equal((await createSession(serial.options).run()).status,'done');assert.equal(serial.sent.length,2);assert.equal(serial.reads,5);
  assert.equal(result.timing.observe.count,4);assert.equal(result.timing.decision.count,1);assert.equal(result.timing.action.count,2);
  assert.deepEqual(result.observationPhases,{initial:1,guard:1,post:2,pending:0});
});

test('group validation rejects invalid slots and requires unique enabled non-sensitive editable matches',()=>{
  const f=setup();
  for(const fillGroups of [[{name:'x',slots:[]}],[{name:'x',slots:[0,0]}],[{name:'x',slots:[2]}],[{name:'x',slots:[0,'1']}]]) assert.throws(()=>createSession({...f.options,fillGroups}));
  for(const raw of ['1 text field First\n2 text field Second\n3 text field Second','1 text field First\n2 text field (disabled) Second','1 text field First\n2 secure text field Second','1 text field First\n1 text field Second']) {
    assert.ok(!buildActions(parseAX(raw),{textSlots:slots,fillGroups:[{name:'profile',slots:[0,1]}]}).candidates.some(c=>c.kind==='fillGroup'));
  }
});

for(const reason of ['disabled','missing','duplicate','index','scope','context','observation']) test(`partial group stops safely after ${reason} changes`,async()=>{
  const f=setup({fillGroups:[{name:'profile',slots:[0,1]}]});
  f.options.scopeCheck=()=>reason!=='scope'||f.actions.length===0;
  f.options.decisionContext=()=>({changed:reason==='context'&&f.actions.length>0});
  f.options.observations=[{name:'allowed',test:()=>reason!=='observation'||f.actions.length===0}];
  f.target.getAXState=async()=>`0 AXWebArea Form\n  1 text field First, Value: ${f.values[0]}\n${f.actions.length&&reason==='missing'?'':`  ${f.actions.length&&reason==='index'?4:2} text field ${f.actions.length&&reason==='disabled'?'(disabled) ':''}Second, Value: ${f.values[1]}`}\n${f.actions.length&&reason==='duplicate'?'  6 text field Second':''}`;
  const session=createSession(f.options);assert.equal((await session.run()).status,'needs_inspection');assert.equal(f.actions.length,1);assert.equal((await session.run()).status,'needs_inspection');assert.equal(f.actions.length,1);
});

for(const reason of ['budget','cancel','error','observe-error','time']) test(`partial group never replays after ${reason}`,async()=>{
  const f=setup({fillGroups:[{name:'profile',slots:[0,1]}]});let session;
  const set=f.target.setValue; f.target.setValue=async(...args)=>{await set(...args);if(reason==='cancel')session.cancel();if(reason==='error')throw Error('secret transport data');if(reason==='time')await new Promise(r=>setTimeout(r,25));};
  const observe=f.target.getAXState;f.target.getAXState=async()=>{if(reason==='observe-error'&&f.actions.length)throw Error('secret AX data');return observe();};
  session=createSession(f.options);const result=await session.run({maxActions:reason==='budget'?1:8,maxMs:reason==='time'?15:18000});
  assert.equal(result.status,'needs_inspection');assert.equal(result.mutationCount,1);assert.equal(f.actions.length,1);assert.equal((await session.run()).status,'needs_inspection');
  assert.equal(result.timing.action.count,1);assert.equal(result.timing.action.failed,reason==='error'?1:0);assert.ok(!JSON.stringify(result).includes('secret'));
});

test('timing counts failed decisions, observations and verification without sensitive error messages',async()=>{
  for(const operation of ['decision','observe','verification']) {
    const f=setup();if(operation==='decision')f.options.client=async()=>{throw Error('private-alpha');};if(operation==='observe')f.target.getAXState=async()=>{throw Error('private-alpha');};if(operation==='verification')f.options.verify=()=>{throw Error('private-alpha');};
    const result=await createSession(f.options).run();assert.equal(result.status,'error');assert.equal(result.timing[operation].count,1);assert.equal(result.timing[operation].failed,1);assert.ok(result.timing[operation].totalMs>=0);assert.ok(!JSON.stringify(result).includes('private-alpha'));
  }
});

test('scoped guard rechooses when ancestor state changes without changing labels or indices',async()=>{
  let changed=false,calls=0,actions=0;
  const f=setup({textSlots:[],clickLabels:['Go'],verify:()=>actions>0});
  f.target.getAXState=async()=>`0 AXWebArea Form\n  5 group Panel${changed?' [selected]':''}\n    1 button Go`;
  f.target.click=async()=>{actions++;};f.options.client=async(s,q)=>{calls++;changed=true;return decision(q,'click_1');};
  assert.equal((await createSession(f.options).run()).status,'done');assert.equal(calls,2);
});

test('default strict mode aborts a group if an unrelated line changes between fields',async()=>{
  const f=setup({guardMode:'strict',fillGroups:[{name:'profile',slots:[0,1]}]});
  f.target.getAXState=async()=>`0 AXWebArea Form\n  1 text field First, Value: ${f.values[0]}\n  2 text field Second, Value: ${f.values[1]}\n  3 text ticker ${f.actions.length}`;
  assert.equal((await createSession(f.options).run()).status,'needs_inspection');assert.equal(f.actions.length,1);
});

test('group final field is independently checked and unsuccessful fills never replay',async()=>{
  const f=setup({fillGroups:[{name:'profile',slots:[0,1]}]});const set=f.target.setValue;
  f.target.setValue=async(id,value)=>{if(id===2){f.actions.push([id,value]);return;}await set(id,value);};
  const session=createSession(f.options);assert.equal((await session.run()).status,'needs_inspection');assert.equal((await session.run()).status,'needs_inspection');assert.equal(f.actions.length,2);
});

test('global step budget counts each grouped mutation',async()=>{
  const f=setup({maxSteps:1,fillGroups:[{name:'profile',slots:[0,1]}]});
  const result=await createSession(f.options).run();assert.equal(result.status,'needs_inspection');assert.equal(result.mutationCount,1);assert.equal(f.actions.length,1);
});

test('stable strict group accepts only its expected edits',async()=>{
  const f=setup({guardMode:'strict',fillGroups:[{name:'profile',slots:[0,1]}]});
  f.target.getAXState=async()=>`0 AXWebArea Form\n  1 text field First, Value: ${f.values[0]}\n  2 text field Second, Value: ${f.values[1]}`;
  assert.equal((await createSession(f.options).run()).status,'done');assert.equal(f.actions.length,2);
});

test('scoped guard rejects candidate state metadata changes beyond checked and selected',async()=>{
  let changed=false,calls=0,actions=0;
  const f=setup({textSlots:[],clickLabels:['Go'],verify:()=>actions>0});
  f.target.getAXState=async()=>`0 AXWebArea Form\n  1 button Go, Expanded: ${changed}`;
  f.options.clickLabels=[/^Go/];f.target.click=async()=>{actions++;};f.options.client=async(s,q)=>{calls++;changed=true;return decision(q,'click_1');};
  assert.equal((await createSession(f.options).run()).status,'done');assert.equal(calls,2);
});

for(const metadata of ['root-url','ancestor-value','candidate-metadata']) test(`scoped guard rechooses for ${metadata} changes hidden from parsed labels`,async()=>{
  let changed=false,calls=0,actions=0;
  const f=setup({textSlots:[],clickLabels:['Go'],verify:()=>actions>0});
  f.target.getAXState=async()=>`0 AXWebArea Form, URL: /${metadata==='root-url'&&changed?'other':'first'}\n  5 group Panel, Value: ${metadata==='ancestor-value'&&changed?'other':'first'}\n    1 button Go, ID: go, Expanded: ${metadata==='candidate-metadata'&&changed}`;
  f.target.click=async()=>{actions++;};f.options.client=async(s,q)=>{calls++;changed=true;return decision(q,'click_1');};
  assert.equal((await createSession(f.options).run()).status,'done');assert.equal(calls,2);assert.equal(actions,1);
});

test('group value masking preserves field metadata changes after ID',async()=>{
  const f=setup({fillGroups:[{name:'profile',slots:[0,1]}]});
  f.target.getAXState=async()=>`0 AXWebArea Form\n  1 text field First, Value: ${f.values[0]}, ID: first, Expanded: ${f.actions.length>0}\n  2 text field Second, Value: ${f.values[1]}, ID: second`;
  assert.equal((await createSession(f.options).run()).status,'needs_inspection');assert.equal(f.actions.length,1);
});

for(const callback of ['scopeCheck','decisionContext','observation','verify']) test(`rejecting async ${callback} is consumed and sanitized`,()=>{
  // Isolate process-level unhandled rejections from node:test's own handlers.
  const script=`
    import {createSession} from ${JSON.stringify(new URL('../scripts/runner.mjs',import.meta.url).href)};
    let unhandled=0,mutations=0;process.on('unhandledRejection',()=>{unhandled++;});
    const reject=async()=>{throw Error('private callback failure');};
    const options={target:{getAXState:async()=> '0 AXWebArea Form\\n  1 button Go',click:async()=>{mutations++;}},kind:'tab',targetName:'Fixture',goal:'Click Go',shareWithTypeSafe:true,
      guardMode:'scoped',scopeCheck:()=>true,decisionContext:()=>({}),clickLabels:['Go'],verify:()=>false,client:async()=>{throw Error('must not request');}};
    if(${JSON.stringify(callback)}==='observation') options.observations=[{name:'ready',test:reject}];
    else options[${JSON.stringify(callback)}]=reject;
    const result=await createSession(options).run();await new Promise(r=>setImmediate(r));
    process.stdout.write(JSON.stringify({unhandled,mutations,result}));
  `;
  const output=execFileSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8'});
  const {unhandled,mutations,result}=JSON.parse(output);assert.equal(unhandled,0);assert.equal(mutations,0);assert.equal(result.status,'error');assert.ok(!output.includes('private callback failure'));
});

for(const guardMode of ['strict','scoped']) test(`${guardMode}: grouped native fields may omit Value before their first fill`,async()=>{
  const values=['',''],actions=[];
  const textSlots=[{name:'title',fieldLabel:'事件标题',value:'Prepared title'},{name:'location',fieldLabel:'事件地点',value:'Prepared location'}];
  const target={getAXState:async()=>`0 AXWebArea Form\n  6 text field (settable) Description:事件标题,${values[0]?`Value:${values[0]},`:''}ID:title\n  7 text field (settable) Description:事件地点,${values[1]?`Value:${values[1]},`:''}ID:location`,
    setValue:async(id,value)=>{actions.push(id);values[id-6]=value;}};
  const f=setup({target,guardMode,textSlots,fillGroups:[{name:'event',slots:[0,1]}],verify:()=>values.every((v,i)=>v===textSlots[i].value)});
  const result=await createSession(f.options).run();assert.equal(result.status,'done');assert.equal(result.requests,1);assert.deepEqual(actions,[6,7]);
});
