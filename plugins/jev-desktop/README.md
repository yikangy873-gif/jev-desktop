# Jev Desktop for Codex

A local Codex skill plugin that runs TypeSafe Jev's decision loop **inside the existing Computer Use runtime**, using the same documented API for native macOS apps and browser tabs. No separate desktop controller or private app API.

Ask Codex: **“用 Jev 桌面加速操作 [应用]，完成 [明确目标]。”**

The current release supports observed, indexed buttons, links, checkboxes, editable fields, scoped scrolling and prepared shortcuts. Chinese macOS role names are supported. Codex prepares text and task scope; Jev selects among allowed actions; the local verifier checks the outcome. Visual-only UI and unfamiliar screens return to Codex.

## Installation

Add this repository as a Codex marketplace, then install the plugin:

```bash
codex plugin marketplace add yikangy873-gif/jev-desktop
codex plugin add jev-desktop@yikangy873-plugins
```

Start a new Codex task so the skill is loaded. Node 22+ and Python 3.10+ are sufficient; there are no npm dependencies.

## Credentials

Run `python3 scripts/setup.py`, open the loopback setup URL and enter the TypeSafe API key locally. It is saved outside the plugin at `~/.config/codex-jev-desktop/config.json` with permissions 0600. `node scripts/doctor.mjs --live` tests a synthetic request without printing the key. The setup server is temporary and not needed while running the plugin.

## Operation

Version 0.1.1 routes deterministic operations before Jev: a known search URL or short known CUA sequence needs no model decision. `scripts/fast-path.mjs` provides `searchBaidu({cua,browser,query})` (or an explicitly reusable `tab`). It returns verified status and separate opening/verification/total timings, with zero Jev requests. These times exclude Codex planning and browser bootstrap. Native app support remains in the shared CUA runner; the Baidu helper does not generalize to other apps.

The runner also recognizes Baidu's `text entry area` and stable field IDs, and supports explicitly scoped `isPending` UI states without unnecessary model requests. Pending checks and direct-search verification are bounded; uncertain mutations are never automatically replayed.

See `skills/jev-desktop/SKILL.md` for the actual CUA integration. Import `scripts/codex-adapter.mjs` from `mcp__cua_repl`, pass an already approved app/tab binding plus the loopback bridge client, and use `createCodexJev(...).run()`. The same object exposes `state()`, `stop()` and `latestState()`. It batches the full loop; a separate MCP call for each prediction would lose much of the latency advantage. These are local JavaScript methods, not independently registered tools. The lower-level CUA runner also requires an injected client and never loads credentials itself.

When CUA does not inherit the host proxy, run `node scripts/bridge-server.mjs --idle-ms=300000` in a retained shell session, then import `scripts/bridge-client.mjs` in CUA and pass `await createLocalBridgeClient()` as the adapter's `client`. The bridge listens only on a random `127.0.0.1` port, authenticates an ephemeral mode-0600 session descriptor, reads the TypeSafe key outside CUA, pins the upstream endpoint, rejects browser origins and exits on Ctrl-C or idle timeout. Request bodies and upstream calls have independent deadlines, and shutdown aborts active local sockets before removing its descriptor. It does not install a daemon, change global networking, expose the key or retry POSTs.

The Cline-inspired adapter reuses a bounded session and its history, returns compact timing by default, and optionally captures one final screenshot for Codex (`captureFinalScreenshot:true`). Screenshots never go to Jev. Prepared `fillGroups` can reduce model calls for independent fields while retaining a fresh observation after every mutation. Strict freshness is the default; scoped freshness requires explicit local scope/context checks. Reactive forms should use individual fills.

Session construction snapshots the allowed labels, prepared text-slot metadata, fill groups, keys and observations into immutable policy containers. Later mutation of the caller's arrays or records cannot expand an active session's authority. Exact label strings remain preferred; regular expressions are cloned and must be bounded, non-blanket patterns without stateful flags.

### Reference adaptation

Architecture reference: [Cline jev-browser](https://github.com/cline/plugins/tree/main/plugins/jev-browser), inspected at commit `96bde661f630ec23c1ce0cd86a2361a9959ef65a`, package version 0.2.2. This is an original Codex adaptation, not a drop-in Cline plugin or a copy of its implementation.

| Concern | Cline reference | This Codex adaptation |
| --- | --- | --- |
| Host interface | Cline plugin tools, run/state/stop | Codex skill and in-CUA JavaScript facade |
| Executor | Isolated Playwright Chromium | Existing documented CUA app or tab target |
| Jev access | Vercel Gateway | Existing TypeSafe official API key |
| Text | Separate Gemini helper | Codex-prepared literal text slots |
| Completion | Host verifies final output | Independent local verifier, optional screenshot |
| Session | Reused browser/history | Reused approved target/history/budgets |

Not ported: isolated browser sandbox, videos/live viewer, Cline registration APIs, its DOM-node/occlusion guards, arbitrary DOM actions or native menu adapters. CUA element-index freshness is not equivalent to DOM node identity. This plugin does not gain permissions or make inaccessible native apps supported merely by using Jev.

The plugin does not change Codex's main model, global permissions or OS settings. It is not a system-wide automatic replacement for all computer actions. No result or speed is guaranteed for apps that lack useful accessibility information.

## Data boundary

Only scoped goals, permitted control labels, checked/selected flags, filled-slot IDs, boolean observations and recent action descriptions go to TypeSafe. Full AX snapshots and typed values remain local unless a caller includes them elsewhere in the request. No screenshot is sent to Jev. Redaction is heuristic; the invoking Codex must limit sensitive data before invoking it. The key is never returned by the runtime or logs.

The fast loop hands consequential actions back to Codex and does not infer permission from confidence. A poisoned session never retries uncertain mutations. OS/UI calls cannot be forcibly interrupted by this library; task cancellation prevents subsequent actions.

## Validation

`node --test tests/*.test.mjs`

Current source validation (2026-09-19): 115 automated tests passed before final installation validation. The authenticated loopback bridge then completed a real end-to-end browser task through CUA: three real TypeSafe decisions selected a four-field prepared group, reminder checkbox and preview; six mutations and ten AX observations finished in 3.949 seconds with independent visible-result verification. Decision time was 1.699 seconds, action time 0.083 seconds and observation time 2.157 seconds. This excludes Codex planning, bridge/page startup and app launch and is not a controlled speedup comparison. A prior deterministic-selector executor-only run was 3.033 seconds; a native TextEdit attempt still timed out independently, so arbitrary native-app support is not established.

Live smoke tests on 2026-09-19 used the real TypeSafe `jev-1.13.0` API:

| Test | Actions | Loop time | Result |
| --- | ---: | ---: | --- |
| Local browser form: fill, check, preview | 3 | 3.412s | Correct visible preview |
| macOS Calculator: 12 + 34 = | 6 | 8.338s | Display 46 |

Excludes Codex planning, module preparation, app launch and earlier native-service recovery. Not a controlled comparison against Codex-only execution. The calculator task was a constrained integration test, not a reasoning benchmark. Test results do not establish compatibility with WeChat, WPS, editing software or all desktop apps.

0.1.1 follow-up smoke tests on the same date:

| Path | Measured interval | Outcome |
| --- | --- | --- |
| Direct Baidu search in new Chrome tab | 17.134s: opening/initial observation 13.673s, final verification 3.460s | Verified results, zero Jev requests |
| Homepage → Jev fill/click | 25.062s through an uncertain click timeout; subsequent observation took 0.611s | Results verified afterward, no repeated click; two Jev decisions totaled 1.577s |
| Native Calculator direct keys: clear, 21+43, Return, full AX check | 0.500s, excluding app binding | Display 64 verified, zero Jev requests |

An earlier development sample spent 27.082s opening a Chrome tab, exhausting its soft budget before verification; this led to the final-observation fix. Retained as a slow sample, not omitted from conclusions. All are single samples, not a statistically controlled speedup, and none measures time from the user's message to the final chat reply. Browser transport/navigation/observation remains the dominant unresolved latency in these samples.

Architecture reference: https://github.com/browser-use/jev-ultrafast (dynamic closed-set action selection). This implementation uses Codex CUA for execution, not Browser Harness. TypeSafe protocol: https://docs.typesafe.ai/api.
