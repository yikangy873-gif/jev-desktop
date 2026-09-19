export function choice(criteria,id,confidence=1) {
  return {choice:id,confidence,probabilities:Object.fromEntries(Object.keys(criteria).map(key=>[key,key===id?1:0]))};
}

export function decision(questions,actionId,confidence=1) {
  if(['DONE','BLOCKED'].includes(actionId)) {
    return {answers:{operation:choice(questions.operation.criteria,actionId,confidence)}};
  }
  const selected=Object.entries(questions).find(([name,question])=>name!=='operation' && Object.hasOwn(question.criteria,actionId));
  if(!selected) throw new Error(`No target head contains ${actionId}`);
  const [headName,head]=selected;
  const operation=head.instructions.operation;
  return {answers:{operation:choice(questions.operation.criteria,operation,confidence),[headName]:choice(head.criteria,actionId,confidence)}};
}
