# SSGG desktop

<!-- impeccable:product-schema 1 -->

## Platform

web

Linux desktop application using web UI technology, not a hosted website.

## Stack

Existing Rust backend. Electron was the user's proposed wrapper; the implementation proceeds with Electron and a typed local Rust bridge. Frontend framework is delegated to the implementation team. The audio/device service must not depend on keeping a window open.

## Users

Linux users controlling SteelSeries peripherals and mixing music, calls and games. Initial hardware: Arctis Nova 7 Gen 2 receiver, USB 1038:227e.

## Product Purpose

Provide the useful device and audio controls of GG without promotions, game integrations, account requirements or bundled game features. The physical ChatMix wheel should balance user-assigned application groups, including Chrome playing YouTube Music against Discord calls.

## Operating Context

The target laptop runs PipeWire with WirePlumber. An existing ssgg daemon and audio session must remain undisturbed during development. Live disruptive validation requires a coordinated test window. USB recognition is confirmed; Gen 2 command compatibility is not yet verified.

## Capabilities and Constraints

Requested deliverables, not existing capabilities: headset recognition and supported hardware controls; physical ChatMix; per-application/stream gain, mute and group assignment; persistent profiles; EQ and microphone controls where implementable; RGB for devices that actually support it. Expose capabilities and errors truthfully. Do not invent live meters or present fixtures as real devices. A browser's already-mixed stream cannot be split into tabs by the mixer. Preserve base gains separately from wheel attenuation.

## Brand Commitments

The GUI must be fancy and animated while clean and uncluttered. Device views must show pictures matching the real model and generation, including headsets, keyboards and other supported peripherals. The main task must remain obvious. No promotional or gaming-dashboard clutter.

## Evidence on Hand

Fork: https://github.com/MrTheSoulz/steelseriesgg-rs
Requirements: https://github.com/MrTheSoulz/steelseriesgg-rs/issues/1
Official product: https://steelseries.com/gaming-headsets/arctis-nova-7-gen-2
Device images must keep provenance; do not assume code licensing covers manufacturer artwork. USB identification may not distinguish casing color. An unknown model gets an honest fallback rather than another model's picture.

## Product Principles

- Working controls before cosmetic completeness; unsupported is a real state.
- The user chooses which audio belongs on either side of ChatMix.
- Local operation without logins, promotions or telemetry.
- Keep hardware protocol validation separate from device-name recognition.
- Preserve live audio, settings and upstream compatibility during development.

## Accessibility & Inclusion

Implementation quality requirements: keyboard-operable controls, clear focus and numeric values, sufficient contrast, reduced-motion support, and no expensive animation when the UI is hidden.
