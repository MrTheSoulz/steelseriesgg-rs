# Integration handoff

- Code-led configuration is authoritative. The parent's initial accidental comp-state file was archived, not treated as an approved comp.
- Two visual review passes finished. Parent performs the independent final reviewer. No further autonomous polish loop is owed.
- Actual Rust numeric stream IDs and mixer/backend keys are reconciled in electron/adapter.ts. Executable is ssgg-desktop, with --stdio; development SSGG_READ_ONLY=1 adds --safe-mode.
- Real read-only smoke saw Arctis Nova 7 Gen 2 1038:227e: and one actual native stream. No audio or HID mutation requests were issued. live-readonly-evidence.json is the returned inventory.
- Cargo output was mode 775, correctly rejected. A mode-755 copy was installed under ignored desktop/artifacts/ssgg-desktop; original Rust output untouched. Package with safe permissions.
- Sandbox smoke uses chromiumSandbox:true, asserts absence of --no-sandbox and checks renderer Seccomp: 2. The existing root-owned /opt/google/chrome/chrome-sandbox was linked into the generated Electron dependency directory; no root or host-policy change. Fresh installs need a usable sandbox helper. See README.
- Detector ran once in degraded regex mode. Single spring-ish easing warning is brief-pinned. Parser absence means no contrast certification. All inspected viewports had no horizontal overflow; compact reduced motion reported animation none.
- Actual read-only screenshot review noted primary button color overriding generic disabled styling. A final component-layer disabled rule fixes that hierarchy; the disabled state itself was already asserted by smoke.
- Tray retains the child beyond window hiding, not quitting/logout. Independent OS service/socket attachment is not implemented here.
- No installer, RGB command bridge, microphone gain UI, hardware EQ or physical wheel event source is claimed. Native app gain/mute and logical group assignment use the real Electron/JSON-lines path; mutation tests use an explicitly labelled separate transport.
