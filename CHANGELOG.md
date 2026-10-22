# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.2.1] - 2026-10-22

### Added
- `CONTRIBUTING.md`, `SECURITY.md`, issue templates, and a pull request template.
- README troubleshooting section.
- CI tests on Node 22 and 24, plus syntax checks for scripts and `setup.py`.

## [0.2.0] - 2026-09-19

### Added
- Single-request operation plus operation-specific target-head policy (adapted from Jev Ultrafast).
- Separate validation of operation and selected-target distributions and confidence.
- Indexed element table with supported operations sent instead of a flat action list.

### Changed
- Malformed speculative heads for non-selected operations are ignored.
- Untrusted-interface rule applies to both operation and target decisions.
- `TYPE_TEXT` selects a caller-prepared slot; text stays local.
- Automated coverage expanded to 123 tests.

### Fixed
- Session policy is snapshotted so it cannot change mid-session.
- Overly broad label matchers are rejected.
- Bridge timeouts stay alive on Node.js 22.

## [0.1.1]

- Initial release of Jev Desktop for Codex.
