# Release hardening handoff

This is a focused implementation pass, not a certification that the entire application is bug-free. No dependencies were installed in the local workspace. Full compilation, lint, formatting, Electron execution, native tests, and hardware behavior still require CI and release-device validation.

## Implemented

- Renderer isolation: sandboxed CommonJS preload; removed the generic raw IPC bridge; exact entry-document and main-frame checks; narrower lyric-window IPC access; navigation, popup, and permission restrictions.
- Active-content protection: release-note Markdown rejects raw HTML and embedded images, restricts links to HTTP(S), and adds safe external-link attributes. All renderer entries have a content security policy. The main window permits `blob:` scripts for its existing microphone AudioWorklet; inline script and evaluation permissions were not added.
- External control: mandatory bearer-token authentication for HTTP and WebSocket, token copy/revocation controls, request/message limits, connection limits, bounded WebSocket command concurrency and output buffering, and serialized server lifecycle operations. Restart now terminates live sockets.
- Credential storage: streaming, Last.fm, and AI credential writes require OS-backed secure storage. No base64 plaintext fallback; Linux `basic_text` is rejected. Existing OS-encrypted data stays compatible. Unreadable streaming configuration is preserved, and failed writes invalidate the mutated in-memory snapshot.
- Plugin downloads: bounded streaming response reads, bounded decompression, validated redirect chains, and HTTPS downgrade rejection. Plugin code remains a trusted-code boundary; this is not a claim of complete malicious-plugin containment.
- Library integrity: failed file deletions remain in the UI; successful deletions remove only their actual tracks and CUE dependents. Library audio files go to the system trash, with no permanent-delete fallback. Unrecognized paths and non-files are rejected. Folder cleanup escapes SQL wildcard characters; ID lookup uses bounded batches.
- Streaming scale: songs and albums paginate until the server returns an empty page, including servers imposing smaller page limits. Missing/repeated IDs abort synchronization before stale-record pruning. Album synchronization no longer stops at 500.
- Playback: shared CUE-relative status/seek conversion, bounded CUE seeks, stale load-completion checks, stop invalidation, and no optimistic successful external seek notification before the engine succeeds.
- Background jobs: scan generations reject old progress/completion callbacks and cancelled CUE commits; native scan startup failure releases the busy state; native recognition callbacks are tied to their originating session.
- Microphone capture: cleanup on setup failure and delayed permission/cancellation; explicit flush acknowledgment; bounded flush waits and PCM accumulation; idempotent stop/close; timers remove abort listeners.
- Accessibility/performance: keyboard-operable sliders, accessible core playback controls, visible focus, non-submitting default buttons, cancelled gestures do not commit seeks, focused controls retain their keys, hidden main content is inert, route scroll history is bounded, and animated backgrounds stop when the document is hidden and respect reduced motion.
- Delivery: regression suites run on all pull requests; release packaging depends on JavaScript validation; sandboxed preload smoke test; broader Linux/macOS native test coverage with Windows-only crates excluded there. The development renderer no longer competes with the external API's default port.

## Compatibility notes

Existing HTTP/WebSocket clients must supply an access token from Settings → External API. See [HTTP](docs/en/api.md) and [WebSocket](docs/en/socket.md). Never publish tokens or expose the unencrypted LAN API to the internet.

Users whose older credentials were stored through plaintext fallback must authenticate again after configuring/unlocking their OS keychain. Restoring trashed audio files requires a library rescan; deleted playlist memberships are not automatically restored.

## Strengths to retain and next improvements

The strongest foundations are the main/preload/renderer separation, native audio modules with generated types, SQLite-backed persistence, lightweight queue tracks with on-demand details, and separate reactive UI/non-reactive animation clocks. Keep these boundaries as features grow.

The highest-value follow-up is measurable reliability: a redacted diagnostic export, automated rapid-playback/network-failure scenarios, representative large-library benchmarks, and explicit empty/loading/error/retry states across media-server views. After that, prioritize adaptive layouts for smaller work areas, complete keyboard/screen-reader coverage, and paged library browsing. These are recommendations, not features represented as implemented in this pass.

## Verification

Locally passed: 16 dependency-free regression tests, syntax/repository-import checks across 521 source files, and `git diff --check`.

Dependency-free regression tests cover authentication, trusted document matching, response size limits, pagination, CUE timeline/load generations, IPC primitive validation, and microphone worklet flush behavior. The dependency-free syntax checker parses TypeScript/Vue script bodies; it does **not** typecheck or compile Vue templates.

Additional CI tests cover Markdown injection, IPC ownership, scanner cancellation, SQLite folder cleanup/bulk lookup, secure-storage failure behavior, slider interaction, and microphone setup cleanup. The preload smoke test checks the compiled bridge in a sandboxed renderer without loading native audio modules. It is not a complete application end-to-end test.

## Release gates still requiring evidence

- Successful `pnpm prettier --check .`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, renderer build, and preload smoke test in CI. None is represented here as locally executed.
- Native tests and packaged startup on supported Windows, macOS, and Linux architectures.
- Real-device testing: rapid next/previous/stop during loading, CUE transitions, network loss, output-device switching, exclusive/bit-perfect modes, sleep/resume, microphone permissions, and all lyric windows.
- Renderer checks: each theme and layout at high DPI and small work areas; keyboard navigation and screen readers; covers/lyrics/AudioWorklet loading under CSP; reduced-motion and hidden-window behavior.
- Memory samples at 60 seconds and every 10 minutes, before/after equivalent playback/library workloads. No measured memory improvement is claimed by this pass.
- Signing/notarization and trusted updater artifacts. Certificates, Apple credentials, Windows signing identity, and repository protection rules cannot be supplied by source edits alone. This pass does not claim releases are signed.
- Large-library architectural follow-up: SQLite-backed paged renderer views, artist/playlist pagination where supported, end-to-end sync cancellation, and realistic 10k/50k/100k-library benchmarks.
- Broader security follow-up: complete per-channel payload schemas, plugin capability/egress permissions, account-cookie storage/backup redaction, and an independent security review.

Security choices follow Electron's [security guidance](https://github.com/electron/electron/blob/main/docs/tutorial/security.md), [sandbox model](https://www.electronjs.org/docs/latest/tutorial/sandbox/), and [permission API](https://github.com/electron/electron/blob/main/docs/api/session.md).
