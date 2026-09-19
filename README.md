# Jev Desktop for Codex

[![Tests](https://github.com/yikangy873-gif/jev-desktop/actions/workflows/test.yml/badge.svg)](https://github.com/yikangy873-gif/jev-desktop/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Speed up bounded browser and macOS workflows by combining Codex, TypeSafe Jev, and the existing Computer Use runtime.

- **Codex** understands the goal, prepares text, limits the permitted actions, and verifies the result.
- **Jev** selects the next action from the current closed set.
- **Computer Use** observes the interface and performs the actual click, fill, scroll, or shortcut.

The project is an original Codex adaptation inspired by Cline's `jev-browser`. It does not install a second browser controller or use private Computer Use APIs.

## Highlights

- Reuses one bounded Jev session instead of returning to the main agent after every click.
- Keeps screenshots, complete accessibility trees, and prepared field values local.
- Keeps the TypeSafe API key outside the restricted Computer Use runtime.
- Re-observes before mutations and never automatically retries an uncertain action.
- Returns consequential actions such as publishing, payment, deletion, and authorization to Codex.
- Includes 115 automated tests for action scoping, stale-state protection, transport, cancellation, and the authenticated loopback bridge.

## Install

Requirements: Codex desktop/CLI with plugin support, Node.js 22+, Python 3.10+, and a TypeSafe API key.

```bash
codex plugin marketplace add yikangy873-gif/jev-desktop
codex plugin add jev-desktop@yikangy873-plugins
```

Configure the key locally:

```bash
cd ~/.codex/plugins/cache/yikangy873-plugins/jev-desktop/*
python3 scripts/setup.py
node scripts/doctor.mjs --live
```

Then start a new Codex task and ask:

> 用 Jev 桌面加速操作浏览器，完成一个明确任务并验证结果。

The exact cache location can vary by Codex version. If needed, run `codex plugin list --json` and use the installed path it reports.

## Security model

The temporary bridge listens on a random `127.0.0.1` port and uses a short-lived token stored in a mode-0600 descriptor. It pins the TypeSafe endpoint, rejects browser origins and unexpected hosts, paths, methods, content types, and oversized bodies, and applies independent body/upstream deadlines. It does not retry POST requests.

Only scoped goals, allowed control labels, state flags, filled-slot identifiers, boolean observations, and recent action descriptions are sent to Jev. See the [plugin documentation](plugins/jev-desktop/README.md) for the complete data boundary, limitations, and measured integration results.

## Development

```bash
cd plugins/jev-desktop
npm test
```

## Status

The browser integration has been verified end-to-end with the real TypeSafe API. Native macOS support depends on the target application's accessibility quality; compatibility with every native application is not claimed.

## License

MIT © 2026 yikangy873-gif
