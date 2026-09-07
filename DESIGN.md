# SSGG desktop design system

<!-- impeccable:design-schema 1 -->

## Built surface

Operate-mode Linux desktop console in `desktop/src`. The broadcast-studio direction is translated into clean software: graphite navigation, cool neutral workspace, labelled channel strips and a wide, centered ChatMix control. Device, mixer, profiles and settings share one frame. No promotional feed or gaming-dashboard ornaments.

## Scene and color

The user adjusts calls and music on a laptop throughout the day. A cool light work surface keeps dense controls readable; a graphite rail anchors navigation without making the entire app a dark glowing dashboard.

- Rail: `#20282d`, active rail `#3a4a4e`.
- Workspace: `#edf0f2`; panel `#f8fafb`.
- Primary ink: `#263238`; supporting ink `#596770`.
- Dividers: `#d1d9de`.
- Active audio/action: `#166c60`; pale state fill `#e2f2ed`.
- Read-only/test notices: amber field; failures use restrained warm warning surfaces.

Color indicates state or action; it does not decorate unrelated chrome. Disabled controls retain labels and nearby reasons.

## Type and spacing

Native workhorse stack (`Segoe UI`, system UI, sans-serif) is intentional for an operate surface. Main titles 32px, weight 650; section titles 20–21px; operational labels and explanatory copy mostly 12–14px; compact metadata 10–11px. Tabular numerals for gains, balance and USB IDs. Body copy is bounded to readable measures. Main workspace inset 42px horizontally / 32px vertically, reduced at compact desktop width. Tight row groupings, larger separation between functional sections.

## Components

- Sticky 224px device/navigation rail, 188px on compact desktop; a continuous dark column under full-page content.
- Broad ChatMix panel with A/B labels, scalar balance, central detent and explicit enable action.
- Three channel strips: group label, wheel-side selector, assigned applications, gain fader, mute.
- Compact application rows: application/stream identity, logical group selector, volume and mute. No simulated meters.
- Device scene: exact-model photograph with complete alpha silhouette, independently sourced official image and user-local override. Portrait product artwork retains its receiver and is fitted, not stretched.
- Profiles: named save form and explicit apply action. Settings: bounded descriptive rows and a native checkbox, not a modal.

## Motion and accessibility

One 360ms scene transition uses a small translate/scale with clip-path, exponential deceleration and visible content by default. Fader feedback uses a short spring-ish response as pinned in the implementation brief; no RGB glows. All motion is removed under reduced-motion. Controls use native buttons, select elements, checkboxes and ranges; labelled values, 3px focus rings and keyboard commits are supported. Polling pauses while the document is hidden and serializes with mutations. Rejected slider writes return to the confirmed state.

## Truth and assets

Production data comes only from the Rust sidecar, validated through `electron/adapter.ts`. Source-derived hardware support is not described as live validation. Unsupported RGB/EQ/microphone operations remain disabled. No placeholder battery value. Native audio controls and physical wheel acquisition are separate.

Official photography is optional, requested explicitly, cached with provenance and not shipped under the code license. The catalog currently verifies only USB `1038:227e` / Arctis Nova 7 Gen 2; unknown models receive no substitute photograph. SteelSeries owns its product art; black casing is not inferred from USB.

## Evidence and review boundary

Two bounded rendered passes covered 1320px and 900px desktop classes with actual Electron. Final comparison confirmed complete unclipped photography, continuous rail and no visible overlaps; supporting text remains intentionally compact. Runtime evidence includes reduced-motion checks, image decoding, no horizontal overflow and the real Rust read-only device inventory. Independent final review is delegated to the parent integrator; this document does not claim that review has already shipped.
