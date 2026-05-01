# Changelog

All notable changes to `@mulmobridge/protocol` are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
under the rules described in [README.md → Versioning](./README.md#versioning).

## [Unreleased]

## [0.2.0] — 2026-05-01

First release under the published semver policy. No code change versus 0.1.4 —
the minor bump signals that the public surface (`EVENT_TYPES`, `Attachment`,
`CHAT_SOCKET_*`, `CHAT_SERVICE_ROUTES`, `GENERATION_KINDS`, `BridgeOptions`)
is now governed by the rules in [README.md → Versioning](./README.md#versioning),
and that breaking changes will be flagged with a major bump and a
[`MIGRATIONS.md`](./MIGRATIONS.md) entry.

### Changed

- Declare semver policy and add `CHANGELOG.md` / `MIGRATIONS.md`. Bridges and
  internal consumers should pin against `^0.2.0`.

## [0.1.4] — 2026-04-22

### Added

- `BridgeOptions` — opaque options passthrough from a bridge's environment to
  the host app, narrowed to flat primitives.

## [0.1.3] — 2026-04-19

### Added

- Background generation for MulmoScript:
  - `GENERATION_KINDS` / `GenerationKind`
  - `GenerationEvent` event payload type
  - `PendingGeneration` state interface
  - `generationKey` helper (with delimiter-collision hardening)

## [0.1.2] — 2026-04-18

### Added

- First public publishable release of `@mulmobridge/protocol` (renamed from
  `@mulmobridge/types`).
- Wire-level constants: `EVENT_TYPES`, `EventType`, `CHAT_SOCKET_PATH`,
  `CHAT_SOCKET_EVENTS`, `ChatSocketEvent`, `CHAT_SERVICE_ROUTES`.
- Shared types: `Attachment`, `BridgeHandshakeAuth`.
- Package shape: `dist`-only `files`, dual `import`/`require`/`default`
  conditions in `exports`.

[Unreleased]: https://github.com/receptron/mulmoclaude/compare/@mulmobridge/protocol@0.2.0...HEAD
[0.2.0]: https://github.com/receptron/mulmoclaude/compare/@mulmobridge/protocol@0.1.4...@mulmobridge/protocol@0.2.0
[0.1.4]: https://github.com/receptron/mulmoclaude/compare/@mulmobridge/protocol@0.1.3...@mulmobridge/protocol@0.1.4
[0.1.3]: https://github.com/receptron/mulmoclaude/compare/@mulmobridge/protocol@0.1.2...@mulmobridge/protocol@0.1.3
[0.1.2]: https://github.com/receptron/mulmoclaude/releases/tag/@mulmobridge/protocol@0.1.2
