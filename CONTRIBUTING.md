# Contributing to Jev Desktop

Thanks for your interest in improving Jev Desktop. Issues and pull requests are welcome.

## Development setup

Requirements: Node.js 22+ and Python 3.10+. The plugin has no npm dependencies.

```bash
git clone https://github.com/yikangy873-gif/jev-desktop.git
cd jev-desktop/plugins/jev-desktop
npm test
```

The test suite runs fully offline and does not need a TypeSafe API key.

## Pull requests

- Keep changes focused; one logical change per pull request is easiest to review.
- Add or update tests in `plugins/jev-desktop/tests/` for behavior changes.
- Run `npm test` before opening the PR; CI runs the same suite.
- Preserve the safety model: actions must stay explicitly allowlisted, and consequential
  controls (send, publish, payment, deletion, upload, login, installation, permission
  changes) must return to Codex rather than execute in the fast loop.
- Never commit API keys, credential files, screenshots, or accessibility dumps containing personal data.
- Use clear commit messages, e.g. `fix: ...`, `feat: ...`, `docs: ...`, `ci: ...`.

## Reporting bugs

Open an issue with the bug report template. Include your OS, Node version, Codex version,
and the output of `node scripts/doctor.mjs` (it never prints the credential).

Security issues should follow [SECURITY.md](SECURITY.md) instead of a public issue.
