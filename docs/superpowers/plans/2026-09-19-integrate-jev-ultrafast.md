# Jev Ultrafast Policy Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port Jev Ultrafast's single-request operation/target-head policy into Jev Desktop while preserving Codex Computer Use execution, local prepared text, scoped permissions, stale-state guards, and independent verification.

**Architecture:** `runner.mjs` will transform the already-scoped CUA action candidates into an operation table plus operation-specific target tables. One TypeSafe request will contain the `operation` question and every speculative target question; only the target head selected by `operation` will be validated or executed. Text remains a caller-prepared local slot, so this integration adds neither OpenRouter nor Browser Harness.

**Tech Stack:** Node.js 22 ESM, TypeSafe System One choice API, Codex Computer Use target facade, built-in `node:test`.

---

### Task 1: Define and test the dynamic operation/target decision space

**Files:**
- Create: `plugins/jev-desktop/tests/helpers/decision.mjs`
- Modify: `plugins/jev-desktop/tests/runner.test.mjs`
- Modify: `plugins/jev-desktop/scripts/runner.mjs`

- [x] **Step 1: Add a test helper that returns valid operation and selected-target answers**

```js
export function choice(criteria,id,confidence=1) {
  return {choice:id,confidence,probabilities:Object.fromEntries(Object.keys(criteria).map(key=>[key,key===id?1:0]))};
}

export function decision(questions,actionId,confidence=1) {
  if(['DONE','BLOCKED'].includes(actionId)) {
    return {answers:{operation:choice(questions.operation.criteria,actionId,confidence)}};
  }
  const [headName,head]=Object.entries(questions).find(([name,q])=>name!=='operation' && Object.hasOwn(q.criteria,actionId));
  const operation=head.instructions.operation;
  return {answers:{operation:choice(questions.operation.criteria,operation,confidence),[headName]:choice(head.criteria,actionId,confidence)}};
}
```

- [x] **Step 2: Write failing runner tests for action grouping and speculative heads**

Add tests that require:

```js
const space=buildDecisionSpace(candidates);
assert.deepEqual(Object.keys(space.operations),['CLICK','TYPE_TEXT','DONE','BLOCKED']);
assert.ok(space.questions.click_target);
assert.ok(space.questions.type_text_target);
```

Also assert that the client receives all available target heads in one call, a malformed unused head is ignored, and a malformed selected head produces no mutation.

- [x] **Step 3: Run the focused tests and confirm the new contract fails**

Run: `node --test tests/runner.test.mjs`

Expected: FAIL because `buildDecisionSpace` and the multi-head contract do not exist.

- [x] **Step 4: Implement the decision-space builder**

Add operation mapping in `runner.mjs`:

```js
const operationFor=action=>action.kind==='click'?'CLICK':action.kind==='fill'?'TYPE_TEXT':action.kind==='fillGroup'?'FILL_GROUP':action.kind==='scroll'?(action.direction==='up'?'SCROLL_UP':'SCROLL_DOWN'):'KEY';

export function buildDecisionSpace(candidates) {
  const targets={};
  for(const action of candidates) (targets[operationFor(action)]??={})[action.id]=action;
  const operations=Object.fromEntries(Object.keys(targets).map(operation=>[operation,operationDescription(operation)]));
  operations.DONE='Every requested outcome is already visibly satisfied.';
  operations.BLOCKED='No permitted operation can make progress.';
  const questions={operation:{type:'choice',criteria:operations,instructions:{goal:'Choose the next operation for the entire task.',rules:NEXT_ACTION_RULES}}};
  for(const [operation,actions] of Object.entries(targets)) {
    questions[targetHead(operation)]={type:'choice',criteria:Object.fromEntries(Object.entries(actions).map(([id,action])=>[id,targetDescription(action)])),instructions:{operation,goal:'Choose the best current target only if this operation is selected.',rules:TARGET_RULES}};
  }
  return {operations,targets,questions};
}
```

Keep descriptions free of prepared text values and sensitive AX state.

- [x] **Step 5: Run the focused tests**

Run: `node --test tests/runner.test.mjs`

Expected: the new decision-space unit tests pass; existing flattened-choice tests may still fail until Task 2.

### Task 2: Execute only the selected target head with two-level confidence gates

**Files:**
- Modify: `plugins/jev-desktop/scripts/runner.mjs`
- Modify: `plugins/jev-desktop/tests/runner.test.mjs`
- Modify: `plugins/jev-desktop/tests/runner-continuous.test.mjs`
- Modify: `plugins/jev-desktop/tests/codex-adapter.test.mjs`

- [x] **Step 1: Convert test clients from `answers.next` to operation/target answers**

Replace flattened helpers with the shared helper:

```js
import {decision} from './helpers/decision.mjs';
const client=async(_state,questions)=>decision(questions,sequence.shift());
```

Retain dedicated forged-response tests that directly construct invalid operation and target heads.

- [x] **Step 2: Add failing confidence and target-isolation tests**

Cover these cases:

```js
// Low operation confidence: no mutation.
// Low selected-target confidence: no mutation.
// An invalid unselected target head: selected operation still executes.
// An invalid selected target head: sanitized error, no mutation.
// DONE remains advisory until the local verifier passes.
```

- [x] **Step 3: Run all plugin tests and confirm the old runner fails the new protocol**

Run: `npm test`

Expected: failures reference missing `questions.operation` or `answers.next` assumptions.

- [x] **Step 4: Replace flattened selection in the session loop**

Use the new decision space and validate only the chosen target head:

```js
const space=buildDecisionSpace(candidates);
const result=await client(state,space.questions,{signal:controller.signal,timeoutMs});
const operationAnswer=validateChoice(result.answers.operation,space.operations);
const operation=operationAnswer.choice;
if(operation==='BLOCKED') return summary('needs_codex',{reason:'Jev could not find a supported next operation.'});
if(operation==='DONE') return summary('failed_verification',{reason:'Jev reported DONE but the independent local verifier did not pass.'});
const head=targetHead(operation);
const targetAnswer=validateChoice(result.answers[head],space.questions[head].criteria);
const action=space.targets[operation][targetAnswer.choice];
```

Apply `minConfidence` and `minProbability` independently to both the operation answer and the selected target answer. Include operation/target confidence and probabilities in trace entries without including text-slot values.

- [x] **Step 5: Send an indexed element table rather than flattened action prose**

Change the outbound state to contain only scoped elements and supported operations:

```js
elements: nodes.filter(isCandidateNode).map(node=>({
  id:node.id,
  role:node.role,
  label:redact(node.label),
  operations:supportedOperations(node,candidates),
  checked:node.checked,
  selected:node.selected,
  filledSlots:matchedPreparedSlots(node,options),
}))
```

Keep full AX trees, screenshots, actual prepared values, and unrelated controls local.

- [x] **Step 6: Run all plugin tests**

Run: `npm test`

Expected: all tests pass with the operation/target protocol.

### Task 3: Document the fused architecture and release boundary

**Files:**
- Modify: `README.md`
- Modify: `plugins/jev-desktop/README.md`
- Modify: `plugins/jev-desktop/skills/jev-desktop/SKILL.md`
- Modify: `plugins/jev-desktop/package.json`
- Modify: `plugins/jev-desktop/.codex-plugin/plugin.json`

- [x] **Step 1: Bump the plugin version**

Change:

```json
"version": "0.2.0"
```

Apply the same version to both `package.json` and `.codex-plugin/plugin.json` so installed plugin caches identify the new release.

- [x] **Step 2: Document what was and was not integrated**

Add concise documentation stating:

```text
Each observation produces scoped indexed elements. TypeSafe receives one request containing an operation head and operation-specific target heads. Only the head selected by the operation can execute. The runner still uses Codex Computer Use, caller-prepared local text, local stale-state checks and local outcome verification. OpenRouter and Browser Harness are not runtime dependencies.
```

Update data-boundary wording from generic candidate actions to indexed elements, supported operations, and selected-head metadata.

- [x] **Step 3: Update the skill usage notes**

Explain that callers still provide `textSlots`; `TYPE_TEXT` selects a prepared slot/field pair and never asks a second text model to invent content.

- [x] **Step 4: Run documentation and version consistency checks**

Run: `rg -n '0\.1\.1|answers\.next|questions\.next|OpenRouter|Browser Harness|operation.*target' --hidden -g '!.git' README.md plugins/jev-desktop`

Expected: old runtime protocol references are gone; historical version text is either updated or explicitly historical; OpenRouter/Browser Harness appear only in boundary explanations.

### Task 4: Final verification and review

**Files:**
- Review: all modified files

- [x] **Step 1: Run the full automated suite**

Run: `cd plugins/jev-desktop && npm test`

Expected: all tests pass, zero failures.

- [x] **Step 2: Run syntax checks for every runtime module**

Run: `for file in scripts/*.mjs; do node --check "$file"; done`

Expected: every module exits zero.

- [x] **Step 3: Inspect the complete diff and repository status**

Run: `git diff --check && git status --short && git diff --stat && git diff`

Expected: no whitespace errors, only planned files changed, and no credentials or generated artifacts.

- [x] **Step 4: Commit the isolated feature branch**

```bash
git add README.md docs/superpowers/plans/2026-09-19-integrate-jev-ultrafast.md plugins/jev-desktop
git commit -m "feat: integrate ultrafast operation target policy"
```
