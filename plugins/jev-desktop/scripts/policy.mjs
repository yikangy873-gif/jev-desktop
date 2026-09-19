function cloneLabelRule(rule) {
  return rule instanceof RegExp ? new RegExp(rule.source,rule.flags) : rule;
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
  return Object.freeze({...slot,fieldLabel:cloneLabelRule(slot?.fieldLabel)});
}

function copyFillGroup(group) {
  const slots=Array.isArray(group?.slots)?Object.freeze([...group.slots]):group?.slots;
  return Object.freeze({...group,slots});
}

export function compileSessionOptions(input) {
  if(!input || typeof input!=='object') return input;
  return Object.freeze({...input,
    clickLabels:freezeList(input.clickLabels,cloneLabelRule,'CLICK_LABELS'),
    scrollLabels:freezeList(input.scrollLabels,cloneLabelRule,'SCROLL_LABELS'),
    textSlots:freezeList(input.textSlots,copyTextSlot,'TEXT_SLOTS'),
    fillGroups:freezeList(input.fillGroups,copyFillGroup,'FILL_GROUPS'),
    keys:freezeList(input.keys,copyRecord,'KEYS'),
    observations:freezeList(input.observations,copyRecord,'OBSERVATIONS'),
  });
}
