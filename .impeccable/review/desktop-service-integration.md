# Desktop service integration — verification

Scope: Electron transport/lifetime, strict hardware preload, observable native volume and labels, and the independent initial-review regressions. Rust implementation is owned by the parent integration branches.

## Verified

- `npm test`: 28 tests passed across 10 files; `npm run typecheck` passed.
- `npm run smoke`: real sandboxed Electron; renderer seccomp 2; JSON-lines sidecar round trips; private fixture UDS reconnect; external service survives GUI quit; unsupported hardware error; safe-mode process separation and main-process mutation gating; helpful configuration-lock conflict.
- `npm run build:local -- /absolute/prebuilt/ssgg-desktop`: staged private mode-755 binary, built UI and generated runnable local service unit. `systemd-analyze --user verify local-bin/ssgg-desktop-local.service` passed, with an unrelated installed `spice-vdagent.service` warning. No unit installed or started.
- `tests/live-readonly.mjs` and `tests/launch-readonly.mjs`: actual Rust safe inventory, detected Arctis Nova 7 Gen 2 `1038:227e:` (empty serial preserved), audio available, ChatMix disabled, no HID acquisition or audio/HID mutation. Stream counts vary with live activity and are recorded per run rather than hardcoded.
- Actual launch artifact captured at 1320/900px; no horizontal overflow. Bounded visual inspection found no clipping/overlaps in hardware controls. Tight native/base caption wrapping was corrected with nonbreaking label-value spaces.
- Original review defects covered by tests: native 150% retained alongside effective 120%; punctuation/UTF-8 profile names; late photo from device A cannot appear for B; disabled controls track new confirmed values; pre-decode PNG/JPEG dimension/pixel limits.

## Deliberate limits

- No physical commands tested on the connected receiver. Source capability support and `locallyValidated` remain separate; no validation claim is added.
- The service template and local launcher are artifacts, not installed services or a portable Electron installer. The sandbox helper symlink is an ignored development dependency only.
- Exact photo stays opt-in with provenance; no generic or wrong-model substitute is added.
- Mechanical Impeccable detector found only the incumbent `cubic-bezier(0.22, 1.25, 0.36, 1)` fader-easing warning. Retained because the pinned design explicitly calls for spring-like fader feedback; no unrelated redesign.

The parent integrator owns final cross-branch review. This record reports execution evidence, not a claim of that final review.
