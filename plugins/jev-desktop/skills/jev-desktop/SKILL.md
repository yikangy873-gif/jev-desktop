---
name: jev-desktop
description: Speed up repeated computer operations in native macOS apps and browser tabs using TypeSafe Jev inside the existing Computer Use runtime. Use when the user asks Codex to operate the computer faster, use Jev for desktop automation, or perform a multi-step UI workflow with reliable accessibility elements. Handles both Chinese and English controls.
---

# Jev Desktop

This installed plugin batches an observation → Jev decision → CUA action → verification loop inside one `mcp__cua_repl.js` invocation. Jev uses the user's configured TypeSafe API key. The host Codex remains responsible for task scope, preparation, permissions, visual fallback and final verification.

## Start with the right level of automation

Prefer purpose-built app connectors or direct file operations when suitable. Batch a short known deterministic UI sequence directly with Computer Use; this is usually faster than calling Jev for a sequence already fully known. Use this loop for several UI decisions where the current controls change between actions. It supports native Mac apps as well as browser tabs; do not automatically substitute a browser for a desktop request.

For a simple search, do not create a Jev session just because this skill was invoked. Prefer a known search URL with safely encoded query data, then verify the loaded result. Use UI typing/clicking when the user specifically asks to exercise those interactions. For native apps, batch known actions using documented CUA methods and fresh state; reserve Jev for genuine choices between observed controls. Do not bypass required confirmations in either route.

For normal operation, execute the installed helper rather than reading its source, probing the API key or re-running setup. Debug those only after a concrete error. Reuse the selected browser binding; reuse a tab only when it is in scope and navigation will not discard the user's work.

Do not claim global replacement of Codex's model, system-wide acceleration or support for every application. This is an explicitly invoked workflow layer. Speed depends on UI observation, action latency and network latency. No scripts install keyboard hooks or capture the entire desktop continuously.

## Setup

Resolve `PLUGIN_ROOT` as two directories above this skill directory, using the actual skill path in the current session. The installed copy can live in a versioned plugin cache. Do not use a relative path from the user's project.

```sh
node PLUGIN_ROOT/scripts/doctor.mjs
```

Only if the key is missing, run:

```sh
python3 PLUGIN_ROOT/scripts/setup.py
```

Open the returned `setupUrl` for the user to enter their TypeSafe key themselves. Do not read or print the credential file, put the key into a tool argument or ask for it in chat. The setup page stores it at `~/.config/codex-jev-desktop/config.json`, mode 0600, directory 0700. Then run `doctor.mjs --live` once to verify connectivity. Never copy the credential into the plugin or deliverables.

The runtime sends a scoped task, allowed control labels, checked/selected states, matched text-slot IDs, boolean observations and recent action descriptions to `https://api.typesafe.ai/v1/systemone`. It does not send screenshots or whole AX trees. Actual text-slot values stay local unless the caller also puts them in the task, slot name or control label. Review those fields before sharing. Do not route private messages, personal document names, credentials, financial details or other sensitive data without the task-specific authorization required by Computer Use. Redaction is only a backstop, not a guarantee.

### Start the authenticated loopback bridge

The restricted CUA runtime may not inherit the host proxy. Before a Jev-driven CUA task, start the installed bridge in a shell session and retain that session handle:

```sh
node PLUGIN_ROOT/scripts/bridge-server.mjs --idle-ms=300000
```

Proceed only after it prints `{"ready":true,"host":"127.0.0.1",...}`. It binds a random IPv4 loopback port, reads the protected TypeSafe key itself, uses the host's existing proxy, accepts only the pinned Jev decision route and exits after the idle interval. It writes a mode-0600 descriptor containing an ephemeral bridge token; neither the TypeSafe key nor bridge token is printed. It rejects browser origins, non-loopback Host headers, redirects, arbitrary paths, wrong tokens and oversized/non-JSON requests. Request bodies and upstream calls have independent deadlines; shutdown aborts active local sockets. No POST is retried.

Stop the retained shell session with Ctrl-C when the task finishes; idle expiry is the recovery fallback. The bridge removes only its own matching descriptor. If startup reports a descriptor or network error, stop any retained bridge session, inspect once and create a fresh one rather than replaying UI mutations. Do not run a persistent daemon or expose the port to the LAN.

## Bind an application through Computer Use

Use only the documented `cua` API for all computer reads and actions. On the first CUA call follow its bootstrap rule: make exactly one supported entry-point call and read the returned documentation and state before importing this plugin.

Native app example:

```js
var target = await cua.getApp('com.apple.calculator');
```

For browsers use the user-specified tab/browser according to Computer Use instructions, then keep that returned `Tab` as the target. The runner never creates its own browser, grabs a Chrome profile or calls private Computer Use endpoints.

Inspect the initial UI, derive task-specific control labels, prepare literal field contents, and define an independent success predicate. Chinese native roles such as 按钮/文本 and English browser roles are normalized. Menus, canvas, unnamed controls and inaccessible apps may require direct Codex Computer Use.

## Direct Baidu search (zero Jev requests)

After the CUA bootstrap and browser-selection policy are satisfied, use the absolute installed path:

```js
var direct = await import('PLUGIN_ROOT/scripts/fast-path.mjs');
var result = await direct.searchBaidu({cua, browser:'chrome', query:'jev'});
nodeRepl.write({status:result.status, verified:result.verified, requests:result.requests, timing:result.timing});
```

Use the actual user-selected browser ID in place of `chrome`. The helper creates one tab and navigates directly; alternatively supply `{tab: approvedExistingTab, query:'jev'}` only if that tab is not already at the requested result URL. If already there, inspect it without navigating. The helper does not read the key or send data to TypeSafe. Search text is sent to Baidu, so normal data-sharing policy still applies.

`done` requires the correct URL query, result title and an indexed heading inside the result body. A changed layout or no-results page returns `waiting_for_ui` for Codex to inspect, not invented success. Do not rerun the helper to wait: retain `result.tab` and inspect the current state without navigation. Keep the tab only when it is the requested output, according to browser cleanup policy.

`timing.totalMs` covers helper start, tab opening/navigation and result verification, **not** time since the user's message. `openMs` includes CUA's initial page observation on a new tab. The elapsed-time budget is soft: it cannot interrupt an in-flight CUA call, and one final observation is still made after slow navigation. Default verification is capped at four observations. A navigation error returns `needs_inspection` and is never automatically replayed.

## Run a bounded task

Each observation is converted into scoped indexed elements with supported operations. The runner sends one TypeSafe request containing an `operation` head and every compatible target head, then validates and consumes only the head selected by `operation`. Operation and selected-target confidence are checked independently. This follows the Jev Ultrafast policy shape while keeping execution inside CUA.

`TYPE_TEXT` does not call OpenRouter or another text model. It selects a permitted field and a caller-prepared `textSlots` entry; the literal value stays local and CUA performs the fill. If the required value is not already known and authorized, stop and ask or let Codex prepare it before creating the session.

In the next CUA call import the bridge client and adapter using the absolute resolved plugin path. Its bounded-session design references Cline's `jev-browser`, but executes through the existing CUA binding, not an independent browser or extra MCP server:

```js
var fast = await import('PLUGIN_ROOT/scripts/codex-adapter.mjs');
var localBridge = await import('PLUGIN_ROOT/scripts/bridge-client.mjs');
var jevClient = await localBridge.createLocalBridgeClient();
var session = fast.createCodexJev({
  target,
  client: jevClient,
  kind: 'app', // 'tab' for browser bindings
  targetName: 'the exact app or scoped page',
  goal: 'A concise task in English is preferred; preserve actual Chinese labels.',
  shareWithTypeSafe: true,
  clickLabels: ['observed permitted control label'],
  textSlots: [{name:'project title', value:'prepared text', fieldLabel:'observed field label'}],
  observations: [{name:'result visible', text:'expected non-sensitive text'}],
  verify: raw => raw.includes('specific final result'),
  scopeCheck: raw => raw.includes('known app/page marker'),
  maxSteps: 24,
  maxRequests: 32,
  maxTotalMs: 120000,
});
var result = await session.run({maxMs:18000, maxActions:8});
nodeRepl.write(result);
```

`clickLabels`, `textSlots[].fieldLabel`, and `scrollLabels` accept exact strings or narrowly scoped RegExp values. Regex rules may use only `i`, `u`, or `v` flags and cannot match empty text or every representative label; the runtime rejects blanket, stateful, or oversized patterns before reading the UI. Prefer exact labels from the observed UI. Never add all controls just to make a task work. `verify`, optional `scopeCheck`, and `observations[].test(raw)` execute locally and may inspect raw AX text. They must be pure, non-mutating checks. Observe the actual result format before writing them.

Optional `keys` entries are `{key:'Escape',description:'Dismiss the currently observed menu'}`. They must come from Codex's observed/known app workflow, never Jev-generated strings. Return/Enter and delete shortcuts are deliberately excluded from this fast loop. A key that can submit or delete data must be handled outside it under the applicable task policy. Native and browser `pressKey` signatures are adapted internally.

Call `run()` with tool `timeout_ms:30000` or more and leave time for pending UI calls. The 18-second chunk limit is checked between calls; it cannot interrupt a hung OS/UI operation. Do not use Promise.race to abandon an in-flight mutation and then retry it.

### Session reuse and final screenshots

Keep this `session` across `yielded` chunks. `session.state()` is a local summary with no GUI read or model call. `session.stop()` prevents subsequent actions and cancels an in-flight Jev request, but cannot interrupt a CUA operation already running. Stopped sessions are not resumable. These are JavaScript methods inside CUA, **not separately registered Codex tools**. The lower-level `runner.mjs` / `createSession` API remains available only with an explicitly injected client; it does not load credentials.

By default the adapter omits the detailed trace. Use `includeTrace:true` only for diagnostics. Optionally pass `captureFinalScreenshot:true` when visual inspection is useful, then display `result.finalScreenshot` with `nodeRepl.emitImage` and print a summary excluding that byte array. This adds one screenshot at the end of the chunk, never per step or sent to Jev. Screenshot failure reports `screenshotStatus:'unavailable'` without invalidating verified AX success. No recording/live viewer is provided.

### Prepared field groups and scoped freshness

For independent, already observed fields, add `fillGroups:[{name:'prepared draft fields',slots:[0,1,2]}]`. Jev chooses the group once; CUA still observes after every field, checks the next target and verifies the final values. It never invents text. Ambiguous, disabled or sensitive fields cannot form a group. Use this only when filling one field does not intentionally change dependent fields, button state or task context; use ordinary actions for reactive forms. Partial groups stop with `needs_inspection`, never auto-replay. Budgets count actual mutations, not groups.

Default `guardMode:'strict'` retains full-state freshness. For a known interface with unrelated ticking text, opt into `guardMode:'scoped'` only with synchronous `scopeCheck(raw)` and JSON-compatible `decisionContext(raw)` callbacks. Include every decision-relevant fact outside permitted controls in that context, such as active page, account, modal and result status. Relevant controls, their ancestors/root metadata, values and declared observations are still compared locally. Do not hide unexplained changes. Async scoped checks/context/observation predicates are rejected; the success verifier may be awaited.

## Interpret results

- `done` means the local `verify` predicate passed; confirm that the predicate actually matches the requested final outcome. Do not infer task success solely from a Jev DONE choice.
- `yielded`: inspect progress and continue the same session with `session.run(...)` if the goal is unfinished. Keep user informed on longer tasks.
- `waiting_for_ui`: an explicitly identified loading state exhausted its observation allowance. Inspect once using the appropriate UI representation; do not click the previous action again or endlessly call `run()`.
- `low_confidence`, `needs_codex`, `failed_verification`, `scope_changed`: Codex inspects the fresh UI and handles the situation; these are not automatically questions for the user.
- `needs_codex_review`: possible consequential control found. Apply the actual task authorization and Computer Use policy; do not treat the plugin's keyword gate as a blanket approval requirement.
- `needs_inspection`: a UI operation may have partially occurred. Inspect current state before making a new session; do not replay the previous action automatically.
- `budget_exceeded`: inspect what remains before explicitly increasing the budget or switching to another tool.
- Provider, bridge and missing-key errors return an error status without performing further actions. Rate-limit responses should back off; no aggressive retry loop.

Use `session.stop()` (`session.cancel()` with the lower-level runner) to prevent further actions and abort an in-flight model request. This does not undo completed actions or interrupt a CUA call already in progress. The user can also stop the Codex task. `session.latestState()` contains the last local AX tree; retrieve only what is needed for diagnostics and never send it wholesale to Jev.

The loop reobserves immediately before each mutation and selects again when the snapshot differs. It fetches a full tree deliberately because each decision needs a complete current set of element indices. It stops on repeated stale states or two consecutive no-progress actions.

For a workflow with an observed loading transition, supply a narrow, pure `isPending(raw)` predicate and optionally `maxPendingObservations` (default 3). While pending, the runner only observes and verifies, making no Jev request and no mutation. Do not define pending as simply `!verify(raw)`: a stalled page, CAPTCHA or wrong destination needs Codex inspection. Browser `text entry area` roles are normalized; fields without a label may use their observed stable `ID` (e.g. `chat-textarea`).

## Consequential actions and recovery

Controls involving sends, publishing, purchases, deletion, permissions, login, credentials or uploads are returned to Codex; no model confidence grants permission. Retain the existing Computer Use confirmation policy and any user preauthorization. Password managers, Terminal and Codex itself are not targets for this loop.

If the native Computer Use backend times out before any Jev call, report a native transport problem, not a model failure. Check existing app/tool status. On this machine a stale SkyComputerUseService caused repeated 120-second timeouts; restarting only the verified helper restored access. Do not reset OS permissions, kill unrelated apps, or restart the helper speculatively during other active computer tasks.

## Verification and honest speed reporting

Tests: `node --test PLUGIN_ROOT/tests/*.test.mjs`. No paid calls in unit tests. Live tests incur TypeSafe API use. `timing` reports cumulative observation/model/action/verification time and `observationPhases` counts initial/guard/post/pending reads. `mutationCount` counts individual attempted mutations. Adapter elapsed time excludes Codex preparation; optional screenshot time is separate. These are soft budgets, not interruption guarantees. Traces omit typed values but may contain control labels; review scope before exposing them.

Report exact tested task boundaries. On 2026-09-19 the loopback build completed a real Jev + CUA synthetic browser task in 3.949 seconds: three TypeSafe decisions, six mutations (four prepared fills, checkbox, preview), ten AX observations and independent visible-result verification. Jev decision time was 1.699 seconds and CUA action time 0.083 seconds. This excludes planning, bridge/page startup and app launch. It is one integration run, not a measured speedup against a Codex-only baseline and not validation of arbitrary native apps. A native TextEdit attempt had previously timed out independently at the OS/UI layer.
