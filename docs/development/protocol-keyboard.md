# Apex Pro HID Protocol Reference

## Desktop lighting scope

The desktop RGB implementation currently targets **Apex Pro TKL Gen 3 wired (`1038:1642`, interface 1)**, not the 2023 device described in the historical sections below.

- `src/devices/hid_reports/apex_gen3.rs` builds 643-byte feature reports: `0x4b` initialization followed by `0x40` direct color over the documented 112-address table.
- `src/desktop/lighting.rs` checks model/interface/node generation, explicit request consent and cancellation. It reports pending/error/last-sent state, not device readback.
- Brightness scales RGB values. No firmware effects, on-board saving or automatic reconnect replay is exposed.
- The `1038:1628` experimental path remains guarded and unavailable in the default desktop workflow. **Do not substitute its 645-byte report layout for Gen 3's 643-byte layout.**

Protocol evidence is pinned to OpenRGB commit `19112cdeff94086fa994c4a9cf45ec5786a599bf`: [detector](https://github.com/CalcProgrammer1/OpenRGB/blob/19112cdeff94086fa994c4a9cf45ec5786a599bf/Controllers/SteelSeriesController/SteelSeriesControllerDetect.cpp), [controller](https://github.com/CalcProgrammer1/OpenRGB/blob/19112cdeff94086fa994c4a9cf45ec5786a599bf/Controllers/SteelSeriesController/SteelSeriesApexController/SteelSeriesApexController.cpp), [address table](https://github.com/CalcProgrammer1/OpenRGB/blob/19112cdeff94086fa994c4a9cf45ec5786a599bf/Controllers/SteelSeriesController/SteelSeriesApexRegions.h). This is source-derived support with transport tests, **not physical Gen 3 acceptance**.

## Historical upstream 2023 notes

The remaining captures and “connected hardware” statements are retained as historical upstream observations. They do not describe hardware currently connected to a user's machine or certify all similarly named models.


**VID:** `0x1038` (all SteelSeries devices)

---

## Supported Devices

| Model | PID | Zones | Per-Key RGB | Actuation | Notes |
|-------|-----|-------|-------------|-----------|-------|
| Apex Pro | `0x1610` | 1 | No | No | |
| Apex Pro TKL | `0x1614` | 1 | No | No | |
| **Apex Pro TKL (2023)** | **`0x1628`** | **9** | **0x40 ✅** | **0x2D ✅** | **Connected hardware — primary target** |
| Apex Pro TKL (2023) Wireless | `0x1632` | 9 | ? | ? | Mirrors 0x1628 protocol |
| Apex Pro TKL (2023) Wireless 2 | `0x1630` | 9 | ? | ? | Mirrors 0x1632 |
| Apex 3 | `0x161A` | 10 | No | No | |
| Apex 3 TKL | `0x1622` | 9 | No | No | Reactive/color-shift confirmed |
| Apex 5 | `0x161C` | 1 | No | No | |
| Apex 7 | `0x1612` | 1 | No | No | |
| Apex 7 TKL | `0x1618` | 1 | No | No | ⚠️ ssgg has wrong PID (0x1616 → 0x1618) |

> GG firmware calls PID `0x1628` "apex_pro_tkl_2022" regardless of purchase year.

---

## USB Interface Layout

The keyboard exposes 5 USB interfaces:

| Interface | Description | Used for |
|-----------|-------------|----------|
| MI_00 | Standard HID keyboard | Keypress events |
| **MI_01** | Vendor-defined HID | **RGB, actuation, all config** |
| MI_02 | Secondary HID | Additional keycodes |
| MI_03 | HID mouse | Mouse emulation keys |
| MI_04 | USB input device | Media/additional keys |

All configuration commands go to **MI_01** (usage page `0xFF00`, vendor-defined).

---

## Report Format

Standard keyboard output/feature reports are 65 bytes:

```
[0x00] [CMD] [DATA...] [0x00 padding...]
  ^      ^     ^-- up to 63 bytes of command data
  |      +-- command byte
  +-- report ID (always 0x00)
```

The per-key RGB command (`0x40`) uses a 645-byte feature report (see below).

---

## Command Reference

### Confirmed (hardware-tested on Apex Pro TKL 2023)

| Byte | Name | Format |
|------|------|--------|
| `0x09` | Apply/Save | `[0x00 0x09 0x00…]` — must follow any config command |
| `0x21` | Zone RGB | `[0x00 0x21 zone R G B R G B…]` |
| `0x22` | Brightness | `[0x00 0x22 brightness 0x00…]` — 0–100 |
| `0x24` | OSD Navigation | `[0x00 0x24 position 0x00…]` — opens actuation menu on OLED |
| `0x25` | Reactive Mode | `[0x00 0x25 0x01/0x00 0x00…]` — confirmed on Apex 3 TKL; compatible |
| `0x26` | Color Shift | `[0x00 0x26 R1 G1 B1 R2 G2 B2 speed 0x00…]` — speed 0–100 |
| `0x2D` | Actuation Write | `[0x00 0x2D value 0x00…]` — write only; read-back unknown |

**`0x21` zone selector:**
- `0xFF` = all zones simultaneously
- `0x00`–`0x08` = individual zone 0–8

**`0x2D` actuation encoding** (0.1 mm increments):
- `1` = 0.1 mm, `8` = 0.8 mm (default), `20` = 2.0 mm, `40` = 4.0 mm (max)
- GG UI exposes 0.4–3.6 mm; firmware accepts the full 0.1–4.0 mm range

---

### Confirmed — Per-Key RGB (`0x40`, Apex Pro TKL 2023)

Captured via `IOCTL_HID_SET_FEATURE` (code `0x000B0191`) from `SteelSeriesEngine.exe`, 2026-05-27.

**Packet layout — 645 bytes total:**

```
[0x00][0x40][0x54]  [hid R G B] × 84  [0x00 × 306]
  ^     ^     ^      ^----- 336 bytes ------^
  |     |     +-- count byte, always 0x54 = 84 (fixed)
  |     +-- command byte 0x40
  +-- report ID 0x00
```

- `hid`: USB HID keyboard Usage ID (e.g. `0x04` = A, `0x28` = Enter, `0xE0` = L Ctrl)
- `R G B`: 0–255 each
- Keys are in **physical layout order**, not ascending Usage ID order
- Trailing entries after the last key are zero-padded to reach 645 bytes
- Sent via `DeviceIoControl`/`NtDeviceIoControlFile` with `IOCTL_HID_SET_FEATURE`, **not** `WriteFile`
- Rust implementation: `Apex2023DirectCommand` in `src/devices/hid_reports.rs` (feature `experimental-apex-2023`)

---

### Placeholder (unconfirmed)

| Byte | Name | Notes |
|------|------|-------|
| `0x23` | Per-Key RGB | Placeholder for non-2023 models. Packet structure unknown. |

> ⚠️ UNVERIFIED: `0x23` is a placeholder command code. The real per-key RGB
> command for non-2023 SteelSeries keyboards has not been discovered. Do not
> treat the `PerKeyRgbCommand` packet layout as confirmed hardware behavior.

---

### Unknown — Actuation Read-Back and Rapid Trigger

`discover_actuation` binary scanned codes `0x00`–`0xFF` on 2026-05-27:
- **No read-back command found** — no HID input response to any GET_FEATURE probe
- Read-back likely requires a query-then-interrupt-read pattern, or a different report type

Rapid Trigger command byte: unknown. Hypothesized in range `0x2E`–`0x3F`. Requires live USB capture.

---

## Zone Mapping — Apex Pro TKL 2023

9 logical zones used with the `0x21` zone command:

| Zone | Position | Physical Area |
|------|----------|---------------|
| 0 | MainKeys (left) | Left side keys |
| 1 | MainKeys (left-center) | Left-center area |
| 2 | MainKeys (center) | Center area |
| 3 | MainKeys (right-center) | Right-center area |
| 4 | MainKeys (right) | Right side keys |
| 5 | FunctionRow | F1–F12 |
| 6 | Custom(0) — NumberRow | Number row (1–0) |
| 7 | Custom(1) — WASD | WASD cluster |
| 8 | ArrowKeys | Arrow key cluster |

Prism DB (`zone_cache`) confirms **84 individually addressable keys** on the US layout. The migration file lists 87 — the 3 extra are international-only keys (HID 50, 100, 133, 135–139) absent on US keyboards.

---

## Zone Mapping — Apex 3 TKL (`0x1622`, Issue #173)

`ssgg rgb solid` reports success on the Apex 3 TKL but nothing changes (multiple
users, Issue #173). The Apex 3 TKL is a zone keyboard, so the missing per-key
map is expected; the suspect is the zone-color command path.

**External lead — OpenRGB `SteelSeriesApex8ZoneController`** (linked in #173):
a 65-byte report (report ID + 64 payload) with this dialect:

| Command | Byte 0 | Layout |
|---------|--------|--------|
| Set zone colors | `0x21` | byte 1 = LED bitmask (`0xFF` = all 8), bytes 2–25 = `R G B` × 8 zones, rest zero-padded |
| Rainbow wave | `0x22` | byte 1 = `0xFF` |
| Brightness | `0x23` | byte 1 = `0x00`–`0x10` (multiplier) |

> ⚠️ UNVERIFIED for this SKU. The OpenRGB layout is a strong lead, not an
> Apex 3 TKL-confirmed protocol. Open questions, pending hardware:
> - **Zone count:** this codebase registers **9** zones for `0x1622`
>   (`zone_count_for_product_id` in `src/devices/mod.rs`, `zone_mapping.rs`),
>   but OpenRGB models the controller as **8**. The current color path already
>   emits `0x21` with the `0xFF` selector via `RgbZoneCommand`, so a zone-count
>   mismatch (9 written where firmware expects 8) is a plausible root cause —
>   confirm the true count before changing the mapping.
> - **Brightness coupling:** unknown whether color shows only after a non-zero
>   `0x23` brightness write, or whether `0x21` is self-sufficient.

---

## Key Addressing (USB HID Usage IDs)

Per-key RGB uses **USB HID Usage IDs** (keyboard page 7), not row/column matrix.

**TKL key list** (from `apex_7+pro.migration`; US layout uses 84 of these):
```
4–69, 73–82, 100, 133, 135–139, 224–231, 240
```

**HID code → key reference:**

| Code | Key | Code | Key | Code | Key |
|------|-----|------|-----|------|-----|
| 4 | A | 29 | Z | 58 | F1 |
| 5 | B | 30 | 1 | 59 | F2 |
| 6 | C | 31 | 2 | 60 | F3 |
| 7 | D | 32 | 3 | 61 | F4 |
| 8 | E | 33 | 4 | 62 | F5 |
| 9 | F | 34 | 5 | 63 | F6 |
| 10 | G | 35 | 6 | 64 | F7 |
| 11 | H | 36 | 7 | 65 | F8 |
| 12 | I | 37 | 8 | 66 | F9 |
| 13 | J | 38 | 9 | 67 | F10 |
| 14 | K | 39 | 0 | 68 | F11 |
| 15 | L | 40 | Enter | 69 | F12 |
| 16 | M | 41 | Escape | 73 | Insert |
| 17 | N | 42 | Backspace | 74 | Home |
| 18 | O | 43 | Tab | 75 | Page Up |
| 19 | P | 44 | Space | 76 | Delete |
| 20 | Q | 45 | - _ | 77 | End |
| 21 | R | 46 | = + | 78 | Page Down |
| 22 | S | 47 | [ { | 79 | Right → |
| 23 | T | 48 | ] } | 80 | Left ← |
| 24 | U | 49 | \ \| | 81 | Down ↓ |
| 25 | V | 51 | ; : | 82 | Up ↑ |
| 26 | W | 52 | ' " | 224 | L Ctrl |
| 27 | X | 53 | ` ~ | 225 | L Shift |
| 28 | Y | 54 | , < | 226 | L Alt |
| 57 | Caps Lock | 55 | . > | 227 | L GUI (Win) |
| | | 56 | / ? | 228 | R Ctrl |
| | | | | 229 | R Shift |
| | | | | 230 | R Alt |
| | | | | 231 | R GUI (Win) |
| | | | | 240 | SteelSeries FN key |

Source: `SteelSeriesGG107.0.0Setup.exe` configuration migration files (`apex_7+pro.migration`), extracted 2026-03-27.

---

## How to Capture Unknown Commands

1. Open Wireshark; select USBPcap interface for the root hub containing `VID_1038/PID_1628`
2. Start capture
3. Trigger **one** action in SteelSeries GG (e.g. set actuation to 1.0 mm)
4. Stop capture; filter: `usb.transfer_type==0x01 && usb.endpoint_address.direction==0`
5. Extract `usb.capdata` from HID OUT reports
6. Hub path: `USB\ROOT_HUB30\4&5375334&0&0`

---

## Implementation Status

| Feature | Status | Rust location |
|---------|--------|---------------|
| Zone RGB (`0x21`) | ✅ Working | `src/devices/hid_reports.rs::RgbZoneCommand` |
| Brightness (`0x22`) | ✅ Working | `src/devices/hid_reports.rs::BrightnessCommand` |
| Apply (`0x09`) | ✅ Working | `src/devices/hid_reports.rs::ApplyCommand` |
| Actuation write (`0x2D`) | ✅ Experimental | `src/devices/keyboards/apex_pro_tkl_2023.rs` |
| Reactive mode (`0x25`) | ✅ Working | `src/devices/keyboards/apex.rs::Apex3Tkl` |
| Color shift (`0x26`) | ✅ Working | `src/devices/keyboards/apex.rs::Apex3Tkl` |
| Per-key RGB (`0x40`, Apex 2023) | ✅ Confirmed | `src/devices/hid_reports.rs::Apex2023DirectCommand` (feature `experimental-apex-2023`) |
| Per-key RGB (`0x23`, other) | ⚠️ Placeholder | `src/devices/hid_reports.rs::PerKeyRgbCommand` |
| Actuation read-back | ❌ Unknown | Needs USB capture |
| Rapid Trigger | ❌ Unknown | Needs USB capture |

---

## References

- [GameSense SDK](https://github.com/SteelSeries/gamesense-sdk) — official high-level API
- [apex-tux](https://github.com/not-jan/apex-tux) — Rust OLED support for Apex keyboards
- [apex7tkl_linux](https://github.com/FrankGrimm/apex7tkl_linux) — Python RGB + OLED for Apex 7 TKL
- [msi-perkeyrgb](https://github.com/Askannz/msi-perkeyrgb) — detailed per-key protocol docs (MSI/SteelSeries)
- [apexctl](https://github.com/AstroSnail/apexctl) — C tool using hidapi-hidraw
- [USB HID 1.11 Specification](https://www.usb.org/sites/default/files/documents/hid1_11.pdf)
