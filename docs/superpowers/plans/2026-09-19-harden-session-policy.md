# Harden Session Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Snapshot every caller-controlled session policy at construction and reject label matchers that are broad enough to defeat the closed action set.

**Architecture:** Add a small policy compiler that copies mutable arrays and records while preserving fixed references to the approved CUA target, client, and local callbacks. Compile label rules into cloned exact strings or bounded regular expressions, then freeze the copied policy containers before the runner closes over them.

**Tech Stack:** Node.js ESM, built-in `node:test`, existing Jev runner and Codex adapter.

---

### Task 1: Snapshot nested session policy

**Files:**
- Create: `plugins/jev-desktop/scripts/policy.mjs`
- Modify: `plugins/jev-desktop/scripts/runner.mjs:4,183-199`
- Test: `plugins/jev-desktop/tests/runner.test.mjs`

- [x] **Step 1: Write the failing nested-mutation tests**

Add tests that create a session, mutate the caller's `clickLabels` and `textSlots` afterwards, and assert that the session still clicks and fills using the values captured at construction.

```js
test('session snapshots nested action policy at construction', async () => {
  // Create with Safe/original, mutate caller-owned arrays and records to
  // Unsafe/changed, then assert only Safe/original is executed.
});
```

- [x] **Step 2: Run the focused tests and verify RED**

Run: `node --test tests/runner.test.mjs`

Expected: the new test fails because `createSession()` currently retains mutable nested references.

- [x] **Step 3: Add the minimal policy compiler**

Create `policy.mjs` with immutable container copies:

```js
const freezeList = (value, map, name) => {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error(`INVALID_${name}`);
  return Object.freeze(value.map(map));
};

export function compileSessionOptions(input) {
  if (!input || typeof input !== 'object') return input;
  const copyRecord = value => Object.freeze({...value});
  return Object.freeze({
    ...input,
    clickLabels: freezeList(input.clickLabels, compileLabelRule, 'CLICK_LABELS'),
    scrollLabels: freezeList(input.scrollLabels, compileLabelRule, 'SCROLL_LABELS'),
    textSlots: freezeList(input.textSlots, slot => Object.freeze({...slot, fieldLabel: compileLabelRule(slot.fieldLabel)}), 'TEXT_SLOTS'),
    fillGroups: freezeList(input.fillGroups, group => Object.freeze({...group, slots: Object.freeze([...group.slots])}), 'FILL_GROUPS'),
    keys: freezeList(input.keys, copyRecord, 'KEYS'),
    observations: freezeList(input.observations, copyRecord, 'OBSERVATIONS'),
  });
}
```

Import it in `runner.mjs` and replace the function parameter with the compiled snapshot before validation and closure capture.

- [x] **Step 4: Run focused and complete tests and verify GREEN**

Run: `node --test tests/runner.test.mjs`

Expected: all runner tests pass.

Run: `npm test`

Expected: all project tests pass.

- [x] **Step 5: Commit the immutable policy change**

```bash
git add plugins/jev-desktop/scripts/policy.mjs plugins/jev-desktop/scripts/runner.mjs plugins/jev-desktop/tests/runner.test.mjs
git commit -m "fix: snapshot Jev session policy"
```

### Task 2: Reject broad label matchers

**Files:**
- Modify: `plugins/jev-desktop/scripts/policy.mjs`
- Test: `plugins/jev-desktop/tests/runner.test.mjs`
- Modify: `plugins/jev-desktop/skills/jev-desktop/SKILL.md`

- [x] **Step 1: Write failing matcher-boundary tests**

Add tests proving that `/.*/`, `/^.+$/`, and stateful regex flags fail before the first UI read, while a narrow matcher such as `/Preview(?: result)?/i` still works. Existing narrow prefix and substring matchers remain compatible.

```js
for (const rule of [/.*/, /^.+$/, /^Preview$/g]) {
  assert.throws(() => createSession({...options, clickLabels: [rule]}), /^Error: MATCH_RULE_/);
}
```

- [x] **Step 2: Run the focused tests and verify RED**

Run: `node --test tests/runner.test.mjs`

Expected: broad and stateful regular expressions are currently accepted.

- [x] **Step 3: Implement scoped matcher compilation**

Implement exact-string preservation and cloned RegExp validation:

```js
export function compileLabelRule(rule) {
  if (typeof rule === 'string') return rule;
  if (!(rule instanceof RegExp)) throw new Error('MATCH_RULE_INVALID');
  if (rule.source.length > 256) throw new Error('MATCH_RULE_TOO_LARGE');
  if (!/^[iuv]*$/.test(rule.flags) || (rule.flags.includes('u') && rule.flags.includes('v'))) {
    throw new Error('MATCH_RULE_FLAGS_UNSUPPORTED');
  }
  const clone = new RegExp(rule.source, rule.flags);
  clone.lastIndex = 0;
  if (clone.test('') || ['Button', '删除文件', '__JEV_SCOPE_SENTINEL__'].every(value => {
    clone.lastIndex = 0;
    return clone.test(value);
  })) throw new Error('MATCH_RULE_TOO_BROAD');
  return clone;
}
```

Update the skill documentation to state that runtime regex rules must be narrow, bounded, and free of stateful flags.

- [x] **Step 4: Verify focused and complete tests**

Run: `node --test tests/runner.test.mjs`

Expected: all runner tests pass.

Run: `npm test`

Expected: all project tests pass.

- [x] **Step 5: Commit matcher hardening**

```bash
git add plugins/jev-desktop/scripts/policy.mjs plugins/jev-desktop/tests/runner.test.mjs plugins/jev-desktop/skills/jev-desktop/SKILL.md
git commit -m "fix: reject broad Jev label matchers"
```

### Task 3: Final verification and documentation consistency

**Files:**
- Modify: `plugins/jev-desktop/README.md`

- [x] **Step 1: Document the immutable policy boundary**

Add one concise paragraph explaining that session construction snapshots allowed labels, prepared text metadata, groups, keys, and observations; later caller mutations do not expand session authority.

- [x] **Step 2: Run syntax, tests, and coverage**

Run: `node --check scripts/policy.mjs && node --check scripts/runner.mjs`

Expected: both files pass syntax checking.

Run: `npm test`

Expected: all tests pass.

Run: `node --test --experimental-test-coverage tests/*.test.mjs`

Expected: all tests pass and the new policy module is covered by the new regression tests.

- [x] **Step 3: Inspect the final diff and commit documentation**

Run: `git diff --check && git status --short && git diff HEAD~2 --stat`

Expected: no whitespace errors; only the planned files are changed.

```bash
git add plugins/jev-desktop/README.md docs/superpowers/plans/2026-09-19-harden-session-policy.md
git commit -m "docs: describe immutable Jev policies"
```
