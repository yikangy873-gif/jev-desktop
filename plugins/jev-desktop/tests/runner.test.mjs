import test from 'node:test';
import assert from 'node:assert/strict';
import {parseAX,buildActions,createSession} from '../scripts/runner.mjs';
import {validateChoice,createClient,endpoint} from '../scripts/client.mjs';

const screen=(value='',checked=false,result='尚未预览')=>`0 AXWebArea Test\n  1 text field 项目名称, Value: ${value}\n  2 checkbox 启用提醒${checked?' [checked]':''}\n  3 button 预览结果\n  4 text ${result}`;
const choice=(criteria,id,confidence=.99)=>({choice:id,confidence,probabilities:Object.fromEntries(Object.keys(criteria).map(k=>[k,k===id?1:0]))});
function mockTarget(){
  let value='',checked=false,result='尚未预览';const actions=[];
  return {actions,getAXState:async()=>screen(value,checked,result),setValue:async(id,text)=>{assert.equal(id,1);value=text;actions.push(['setValue',id,text]);},click:async id=>{actions.push(['click',id]);if(id===2)checked=!checked;if(id===3)result=`预览：${value}；提醒：${checked?'已启用':'未启用'}`;},pressKey:async(...args)=>actions.push(['key',...args])};
}
function opts(target,client,extra={}){return {target,kind:'app',targetName:'Test',goal:'Fill the project, enable reminder, preview',shareWithTypeSafe:true,clickLabels:['启用提醒','预览结果'],textSlots:[{name:'project',value:'Jev Desktop',fieldLabel:'项目名称'}],verify:raw=>raw.includes('预览：Jev Desktop；提醒：已启用'),client,...extra};}

test('CUA runner requires an injected client before any UI read',()=>{
  let reads=0;
  const options=opts({getAXState:async()=>{reads++;return screen();}},undefined);
  assert.throws(()=>createSession(options),/^Error: RUNNER_REQUIRES_CLIENT$/);
  assert.equal(reads,0);
});

test('parses browser/native AX indices, multiword roles, values and checks',()=>{
  const nodes=parseAX(screen('hello',true));
  assert.equal(nodes[0].role,'AXWebArea');assert.equal(nodes[1].value,'hello');assert.equal(nodes[2].checked,true);
  assert.equal(parseAX('[12] AXButton Preview')[0].id,12);
  assert.equal(parseAX('12 text field Description: Search, Value: query')[0].label,'Search');
  assert.equal(parseAX('6 text field (settable) Description: 项目名称, ID: name')[0].label,'项目名称');
  assert.equal(parseAX('7 checkbox (settable, integer) Description: 启用提醒, Value: 1, ID: notify')[0].checked,true);
  assert.equal(parseAX('15 按钮 +, Description: 加, Help: 加')[0].role,'button');
  assert.equal(parseAX('15 按钮 +, Description: 加, Help: 加')[0].label,'+');
  assert.equal(parseAX('1 文本 Description: 主显示器, Value: 46')[0].value,'46');
});
test('only scoped actions; filled fields excluded; sensitive and consequential controls deferred',()=>{
  const nodes=parseAX(screen('Jev Desktop')+'\n5 button 删除文件\n6 secure text field 密码, Value: secret\n7 button Another');
  const {candidates,deferred}=buildActions(nodes,opts({},null,{clickLabels:['删除文件','预览结果']}));
  assert.deepEqual(candidates.map(x=>x.id),['click_3']);assert.equal(deferred,1);
});
test('rejects forged, incomplete, nonfinite and non-maximal model distributions',()=>{
  const criteria={a:'',b:''};assert.throws(()=>validateChoice({choice:'evil'},criteria));
  assert.throws(()=>validateChoice({choice:'a',confidence:1,probabilities:{a:1}},criteria));
  assert.throws(()=>validateChoice({choice:'a',confidence:NaN,probabilities:{a:1,b:0}},criteria));
  assert.throws(()=>validateChoice({choice:'a',confidence:1,probabilities:{a:.2,b:.8}},criteria));
});
test('three decisions execute in one run and verify; unrelated UI/text content never transmitted',async()=>{
  const target=mockTarget();const sequence=['fill_1_0','click_2','click_3'];const states=[];
  const client=async(state,questions)=>{states.push(state);return {answers:{next:choice(questions.next.criteria,sequence.shift())},latencyMs:1,usage:{input_tokens:100}};};
  const session=createSession(opts(target,client));const result=await session.run();
  assert.equal(result.status,'done');assert.equal(result.steps,3);assert.equal(result.requests,3);assert.equal(result.usage.input_tokens,300);
  assert.equal(result.verified,true);assert.equal(states[0].controls[0].value,undefined);
  assert.equal((await session.run()).status,'done');
});
test('stale state cancels selection and regenerates before clicking',async()=>{
  let snapshot=0;const calls=[];let decisions=0;
  const target={getAXState:async()=>++snapshot===1?'1 button Go':'2 button Go',click:async id=>calls.push(id)};
  const client=async(s,q)=>({answers:{next:choice(q.next.criteria,++decisions===1?'click_1':'click_2')},usage:{}});
  const session=createSession(opts(target,client,{clickLabels:['Go'],textSlots:[],verify:()=>calls.length===1}));
  const result=await session.run();assert.equal(result.status,'done');assert.deepEqual(calls,[2]);assert.equal(decisions,2);
});
test('low confidence escalates without mutating',async()=>{
  const target=mockTarget();const client=async(s,q)=>({answers:{next:choice(q.next.criteria,'click_2',.2)}});
  const result=await createSession(opts(target,client)).run();assert.equal(result.status,'low_confidence');assert.equal(target.actions.length,0);
});
test('DONE is not accepted without independent evidence',async()=>{
  const client=async(s,q)=>({answers:{next:choice(q.next.criteria,'DONE')}});
  const result=await createSession(opts(mockTarget(),client)).run();assert.equal(result.status,'failed_verification');
});
test('uncertain mutation is consumed, poisoned and never replayed',async()=>{
  const target=mockTarget();let attempted=0;target.click=async()=>{attempted++;throw Error('UI timed out');};
  const client=async(s,q)=>({answers:{next:choice(q.next.criteria,'click_2')}});
  const session=createSession(opts(target,client));assert.equal((await session.run()).status,'needs_inspection');
  assert.equal((await session.run()).status,'needs_inspection');assert.equal(attempted,1);
});
test('cancellation while model request is in flight prevents action',async()=>{
  let release;const target=mockTarget();const client=async(s,q)=>{await new Promise(r=>release=r);return {answers:{next:choice(q.next.criteria,'click_2')}};};
  const session=createSession(opts(target,client));const pending=session.run();
  await new Promise(r=>setImmediate(r));session.cancel();release();assert.equal((await pending).status,'cancelled');assert.equal(target.actions.length,0);
});
test('bounded chunks resume without reusing stale indices',async()=>{
  const target=mockTarget();const sequence=['fill_1_0','click_2','click_3'];
  const client=async(s,q)=>({answers:{next:choice(q.next.criteria,sequence.shift())}});
  const session=createSession(opts(target,client));assert.equal((await session.run({maxActions:1})).status,'yielded');assert.equal((await session.run()).status,'done');
});
test('native and tab shortcuts use their correct CUA signature',async()=>{
  for(const kind of ['app','tab']){
    const target=mockTarget();const client=async(s,q)=>({answers:{next:choice(q.next.criteria,'key_0')}});
    const session=createSession(opts(target,client,{kind,keys:[{key:'Escape',description:'Close menu'}],verify:()=>target.actions.length>0}));
    assert.equal((await session.run()).status,'done');assert.deepEqual(target.actions,[kind==='app'?['key','Escape']:['key',null,'Escape']]);
  }
});
test('endpoint pinned and provider errors do not leak response bodies or credentials',async()=>{
  const client=createClient({apiKey:'test-secret-key'},async(url,init)=>{assert.equal(url,endpoint);assert.equal(init.redirect,'error');return {ok:false,status:401,headers:new Headers(),text:async()=>{throw Error('must not read');}};});
  await assert.rejects(client('test',{}),/^Error: TYPESAFE_HTTP_401$/);
});

test('Baidu text entry area uses stable ID before and after filling',()=>{
  const empty=parseAX('25 text entry area (settable) chat-textarea')[0];
  const filled=parseAX('25 text entry area (settable) Value: jev, ID: chat-textarea')[0];
  assert.equal(empty.role,'text area');
  assert.equal(empty.label,'chat-textarea');
  assert.equal(filled.label,'chat-textarea');
  assert.equal(filled.value,'jev');
  const options={textSlots:[{name:'query',fieldLabel:'chat-textarea',value:'jev'}]};
  assert.equal(buildActions([empty],options).candidates[0].kind,'fill');
  assert.equal(buildActions([filled],options).candidates.length,0);
});

test('explicit pending page finishes through observation without another model call',async()=>{
  let clicked=false,reads=0,requests=0;
  const target={getAXState:async()=>!clicked?'1 button Search':++reads<3?'0 AXWebArea Loading':'0 AXWebArea Results',click:async()=>{clicked=true;}};
  const client=async(s,q)=>{requests++;return {answers:{next:choice(q.next.criteria,'click_1')}};};
  const session=createSession(opts(target,client,{textSlots:[],clickLabels:['Search'],verify:raw=>raw.includes('Results'),isPending:raw=>raw.includes('Loading')}));
  const result=await session.run();
  assert.equal(result.status,'done');assert.equal(requests,1);assert.equal(result.steps,1);
});

test('pending observation is bounded and never mutates or calls Jev',async()=>{
  const target={getAXState:async()=>'0 AXWebArea Loading'};
  const session=createSession(opts(target,async()=>{throw Error('must not call');},{isPending:()=>true,maxPendingObservations:2}));
  assert.equal((await session.run()).status,'waiting_for_ui');
});
test('leading disabled metadata never becomes an actionable control',()=>{
  const nodes=parseAX('1 button (disabled) Search\n2 text field (disabled, settable) Query');
  assert.ok(nodes.every(node=>node.disabled));
  assert.equal(buildActions(nodes,{clickLabels:['Search'],textSlots:[{fieldLabel:'Query',name:'query',value:'jev'}]}).candidates.length,0);
});
