# Security Policy

## Supported versions

Only the latest released version of Jev Desktop receives security fixes.

## Reporting a vulnerability

Please do **not** open a public issue for security problems. Report them privately through
GitHub's [private vulnerability reporting](https://github.com/yikangy873-gif/jev-desktop/security/advisories/new).

Helpful details include affected version, reproduction steps, and impact. Areas of particular
interest:

- The loopback bridge (authentication, origin checks, endpoint pinning)
- The local setup UI (`scripts/setup.py`) and credential storage
- Bypasses of action allowlists or of the consequential-control handoff to Codex
- Leakage of prepared values, screenshots, or the full accessibility tree off the machine

Never include real API keys in a report. You should receive an acknowledgement within a few days.
