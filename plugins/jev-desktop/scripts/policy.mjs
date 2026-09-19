const broadSamples=['Button','删除文件','__JEV_SCOPE_SENTINEL__'];

function tests(rule,value) {
  rule.lastIndex=0;
  return rule.test(value);
}

export function compileLabelRule(rule) {
  if(typeof rule==='string') return rule;
  if(!(rule instanceof RegExp)) throw new Error('MATCH_RULE_INVALID');
  if(rule.source.length>256) throw new Error('MATCH_RULE_TOO_LARGE');
  if(!/^[iuv]*$/.test(rule.flags) || (rule.flags.includes('u') && rule.flags.includes('v'))) throw new Error('MATCH_RULE_FLAGS_UNSUPPORTED');
  const clone=new RegExp(rule.source,rule.flags);
  if(tests(clone,'') || broadSamples.every(value=>tests(clone,value))) throw new Error('MATCH_RULE_TOO_BROAD');
  return clone;
}

function freezeList(value,map,name) {
  if(value===undefined) return undefined;
  if(!Array.isArray(value)) throw new Error(`INVALID_${name}`);
  return Object.freeze(value.map(map));
}

function copyRecord(value) {
  return Object.freeze({...value});
}

function copyTextSlot(slot) {
  return Object.freeze({...slot,fieldLabel:compileLabelRule(slot?.fieldLabel)});
}

function copyFillGroup(group) {
  const slots=Array.isArray(group?.slots)?Object.freeze([...group.slots]):group?.slots;
  return Object.freeze({...group,slots});
}

export function compileSessionOptions(input) {
  if(!input || typeof input!=='object') return input;
  return Object.freeze({...input,
    clickLabels:freezeList(input.clickLabels,compileLabelRule,'CLICK_LABELS'),
    scrollLabels:freezeList(input.scrollLabels,compileLabelRule,'SCROLL_LABELS'),
    textSlots:freezeList(input.textSlots,copyTextSlot,'TEXT_SLOTS'),
    fillGroups:freezeList(input.fillGroups,copyFillGroup,'FILL_GROUPS'),
    keys:freezeList(input.keys,copyRecord,'KEYS'),
    observations:freezeList(input.observations,copyRecord,'OBSERVATIONS'),
  });
}
