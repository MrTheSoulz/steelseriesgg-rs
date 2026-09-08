# SteelSeries Device Reference

## Current desktop controls

| Device | Exact identity | Desktop scope |
| --- | --- | --- |
| Arctis Nova 7 Gen 2 | `1038:227e`, control interface 3 / usage page `0xffc0` / usage 1 | Dedicated driver; status and physical wheel, source-derived sidetone/auto-off. No RGB. Wheel center/extremes were read locally; setting writes have separate acceptance gates. |
| Apex Pro TKL Gen 3 wired | `1038:1642`, interface 1 | Source-derived solid RGB/brightness/off, explicit per-request Apply. Physical RGB acceptance pending. |

Discovery does not acquire hardware. A registry match is not a promise that every device feature is implemented, and wireless/older-generation models are not interchangeable. The desktop uses capability reasons and rejects speculative writes. [Current user-facing support](../../README.md#what-works-in-this-branch) and [RGB protocol scope](protocol-keyboard.md#desktop-lighting-scope) take precedence over inherited feature assumptions.

## Historical registry research

The tables and bug findings below preserve upstream firmware/capture research. Their historical “connected hardware” observations are not a live inventory, and are not blanket desktop support claims.


All SteelSeries devices use VID `0x1038`.

PIDs in this file are sourced from GG firmware folder names, which encode `(VID << 16) | PID`.
The tables list the low 16-bit USB PID only.
Verified against: GG 111.0.0 firmware directory + connected hardware (Apex Pro TKL 2023, 2026-05-26).

---

## Keyboards — ssgg Registry

| Constant | PID | Name | Zones | Per-Key RGB | Actuation |
|----------|-----|------|-------|-------------|----------|
| `APEX_PRO` | 0x1610 | Apex Pro | 1 | No | No |
| `APEX_PRO_TKL` | 0x1614 | Apex Pro TKL | 1 | No | No |
| **`APEX_PRO_TKL_2023`** | **0x1628** | **Apex Pro TKL (2023)** | **9** | **0x40 ✅** | **0x2D ✅** |
| `APEX_PRO_TKL_2023_WIRELESS` | 0x1632 | Apex Pro TKL (2023) Wireless | 9 | ? | ? |
| `APEX_PRO_TKL_2023_WIRELESS_2` | 0x1630 | Apex Pro TKL (2023) Wireless (dongle) | 9 | ? | ? |
| `APEX_3` | 0x161A | Apex 3 | 10 | No | No |
| `APEX_3_TKL` | 0x1622 | Apex 3 TKL | 9 | No | No |
| `APEX_5` | 0x161C | Apex 5 | 1 | No | No |
| `APEX_7` | 0x1612 | Apex 7 | 1 | No | No |
| `APEX_7_TKL` | ~~0x1616~~ **→ 0x1618** | Apex 7 TKL | 1 | No | No |

**Connected hardware**: Apex Pro TKL 2023 (PID 0x1628). All others unverified.

**Zone count note**: `APEX_PRO`, `APEX_PRO_TKL`, `APEX_5`, `APEX_7`, `APEX_7_TKL` all return 1 zone in
`zone_count_for_product_id()`. These devices likely have more — pending USB capture or GG.Models.dll decompilation.

---

## Headsets — ssgg Registry

| Constant | PID | Name |
|----------|-----|------|
| `ARCTIS_1` | 0x12AD | ⚠️ See Bug 2 — this is Arctis 7 2018 TX dongle |
| `ARCTIS_1_WIRELESS` | 0x12B3 | Arctis 1 Wireless TX |
| `ARCTIS_5` | 0x12AA | Arctis 5 (2018) |
| `ARCTIS_7_2019` | 0x12CF | Arctis 7 (2019) — ⚠️ not in GG firmware |
| `ARCTIS_9` | 0x12C2 | Arctis 9 TX |
| `ARCTIS_PRO` | 0x1252 | Arctis Pro |
| `ARCTIS_PRO_WIRELESS` | 0x1290 | Arctis Pro Wireless TX |
| `ARCTIS_NOVA_PRO` | 0x12E0 | ⚠️ See Bug 3 — this is the wireless TX dongle |
| `ARCTIS_NOVA_PRO_WIRELESS` | 0x12E4 | ⚠️ See Bug 4 — not in GG firmware |
| `ARCTIS_NOVA_5` | 0x12EA | ⚠️ See Bug 4 — wrong PID (Nova 5 = 0x2230/0x2232) |
| `ARCTIS_NOVA_3` | 0x12EC | Arctis Nova 3 |
| `ARCTIS_NOVA_1` | 0x12EE | ⚠️ See Bug 4 — not in GG firmware |
| `ARCTIS_NOVA_PRO_OMNI` | 0x2290 | Arctis Nova Pro Omni TX |

All headsets are unverified unless connected.

---

## Confirmed Bugs in ssgg `product_ids`

### Bug 1 — `APEX_7_TKL` has wrong PID (HIGH SEVERITY)

```rust
// Wrong:
pub const APEX_7_TKL: u16 = 0x1616;  // 0x1616 is apex_150 in GG firmware

// Correct:
pub const APEX_7_TKL: u16 = 0x1618;  // 0x1618 is apex_7_tkl in GG firmware
// Also add:
pub const APEX_150: u16 = 0x1616;
```

### Bug 2 — `ARCTIS_1` PID is the Arctis 7 2018 TX dongle

`0x12AD` = `arctis_7_2018_tx` in GG. The constant name is misleading.
The actual Arctis 1 PID is unknown — not in GG's firmware directory under an "arctis_1" name.

### Bug 3 — `ARCTIS_NOVA_PRO` maps to the wireless TX dongle, not the wired model

```rust
// Wrong label:
pub const ARCTIS_NOVA_PRO: u16 = 0x12E0;   // GG: arctis_nova_pro_wireless_tx
// Missing:
// pub const ARCTIS_NOVA_PRO: u16 = 0x12CB; // GG: arctis_nova_pro (wired)
```

### Bug 4 — PIDs with no GG firmware evidence

```rust
pub const ARCTIS_NOVA_PRO_WIRELESS: u16 = 0x12E4;  // Not in GG firmware
pub const ARCTIS_NOVA_5: u16 = 0x12EA;              // Wrong; Nova 5 = 0x2230 (RX) / 0x2232 (TX)
pub const ARCTIS_NOVA_1: u16 = 0x12EE;              // Not in GG firmware
```

---

## Full GG Keyboard PID Table

All Apex keyboard PIDs from GG firmware, including devices not yet in ssgg:

| PID | GG firmware name | ssgg const |
|-----|-----------------|----------|
| 0x1200 | apex-raw | — |
| 0x1202 | apex | — |
| 0x1206 | apex-350 | — |
| 0x1208 | apex-300 | — |
| 0x1600 | apex_m800 | — |
| 0x1607 | apex_m500 | — |
| 0x160C | apex_m400 | — |
| 0x160E | apex_100 | — |
| 0x1610 | apex_pro | `APEX_PRO` |
| 0x1612 | apex_7 | `APEX_7` |
| 0x1614 | apex_pro_tkl | `APEX_PRO_TKL` |
| 0x1616 | apex_150 | `APEX_7_TKL` ❌ (wrong device) |
| 0x1618 | apex_7_tkl | — ❌ (missing) |
| 0x161A | apex_3 | `APEX_3` |
| 0x161C | apex_5 | `APEX_5` |
| 0x161E | apex_pro_mini | — |
| 0x1620 | apex_9_mini | — |
| 0x1622 | apex_3_tkl | `APEX_3_TKL` |
| 0x1624 | apex_pro_mini_wireless_dongle | — |
| 0x1626 | apex_pro_mini_wireless | — |
| 0x1628 | apex_pro_tkl_2022 | `APEX_PRO_TKL_2023` ✅ |
| 0x1630 | apex_pro_tkl_wireless_dongle | `APEX_PRO_TKL_2023_WIRELESS_2` ✅ |
| 0x1632 | apex_pro_tkl_wireless | `APEX_PRO_TKL_2023_WIRELESS` ✅ |
| 0x1634 | apex_9_tkl | — |
| 0x1640 | apex_pro_2024 | — |
| 0x1642 | apex_pro_tkl_2024 | — |
| 0x1644 | apex_pro_tkl_wireless_2024_dongle | — |
| 0x1646 | apex_pro_tkl_wireless_2024 | — |
| 0x1648 | apex-pro-mini-2024 | — |
| 0x1650 | apex_5_2024 | — |
| 0x1652 | apex_7_2024 | — |

> GG firmware internally calls PID 0x1628 "apex_pro_tkl_2022" regardless of the purchase year branding.

---

## Full GG Headset PID Table

| PID | GG firmware name | ssgg const |
|-----|-----------------|----------|
| 0x1240 | siberia_840 | — |
| 0x1250 | arctis_5 (2017) | — |
| 0x1252 | arctis_pro | `ARCTIS_PRO` |
| 0x1260 | arctis_7_dongle | — |
| 0x1261 | arctis_7 (2017) | — |
| 0x1290 | arctis_pro_wireless | `ARCTIS_PRO_WIRELESS` |
| 0x1292 | arctis_pro_wireless_headset | — |
| 0x12AA | arctis_5_2018 | `ARCTIS_5` |
| 0x12AD | arctis_7_2018_tx | `ARCTIS_1` ❌ (wrong name) |
| 0x12AE | arctis_7_2018_rx | — |
| 0x12B1 | arctis_9x | — |
| 0x12B3 | arctis_1w_tx | `ARCTIS_1_WIRELESS` |
| 0x12B4 | arctis_1w_rx | — |
| 0x12B6 | arctis_1x_tx | — |
| 0x12B7 | arctis_1x_rx | — |
| 0x12C0 | arctis_9_rx | — |
| 0x12C2 | arctis_9_tx | `ARCTIS_9` |
| 0x12CB | arctis_nova_pro | — ❌ (missing wired Nova Pro) |
| 0x12CD | arctis_nova_pro_xbox | — |
| 0x12CF | (unknown) | `ARCTIS_7_2019` ⚠️ |
| 0x12D5 | arctis_7p_tx | — |
| 0x12D6 | arctis_7p_rx | — |
| 0x12D7 | arctis-7x-tx | — |
| 0x12D8 | arctis-7x-rx | — |
| 0x12E0 | arctis_nova_pro_wireless_tx | `ARCTIS_NOVA_PRO` ❌ (wrong label) |
| 0x12E2 | arctis_nova_pro_wireless_rx | — |
| 0x12E5 | arctis_nova_pro_wireless_xbox_tx | — |
| 0x12E8 | arctis_nova_pro_wireless_xbox_rx | — |
| 0x12EC | arctis_nova_3 | `ARCTIS_NOVA_3` |
| 0x12F0 | arctis_nova_4_rx | — |
| 0x12F2 | arctis_nova_4_tx | — |
| 0x12F4 | arctis_nova_4x_rx | — |
| 0x12F6 | arctis_nova_4x_tx | — |
| 0x12FA | arctis_nova_pro_v2 | — |
| 0x2200 | arctis_nova_7_rx | — |
| 0x2202 | arctis_nova_7_tx | — |
| 0x2204 | arctis_nova_7x_rx | — |
| 0x2206 | arctis_nova_7x_tx | — |
| 0x2208 | arctis_nova_7p_rx | — |
| 0x220A | arctis_nova_7p_tx | — |
| 0x220C | arctis_7_plus_rx | — |
| 0x220E | arctis_7_plus_tx | — |
| 0x2210 | arctis_7p_plus_rx | — |
| 0x2212 | arctis_7p_plus_tx | — |
| 0x2214 | arctis_7x_plus_rx | — |
| 0x2216 | arctis_7x_plus_tx | — |
| 0x2230 | arctis_nova_5_rx | — (ssgg's `ARCTIS_NOVA_5 = 0x12EA` is wrong) |
| 0x2232 | arctis_nova_5_tx | — |
| 0x2238 | arctis_nova_7_diablo_iv_rx | — |
| 0x2240 | arctis_nova_pro_wireless_v2_rx | — |
| 0x2244 | arctis_nova_elite_tx | — |
| 0x2249 | arctis_nova_elite_rx | — |
| 0x2251 | arctis_nova_5x_rx | — |
| 0x2253 | arctis_nova_5x_tx | — |
| 0x2267 | arctis_nova_3_wireless_rx | — |
| 0x2269 | arctis_nova_3_wireless_tx | — |
| 0x2288 | arctis_nova_7p_gen2_rx | — |
| 0x2290 | arctis_nova_pro_omni_tx | `ARCTIS_NOVA_PRO_OMNI` |
| 0x2296 | arctis_nova_pro_omni_rx | — |
| 0x2298 | arctis_nova_7p_gen2_tx | — |
| 0x227C | arctis_nova_7_gen2_rx | — |
| 0x227E | arctis_nova_7_gen2_tx | — |
| 0x229C | arctis_nova_7x_gen2_rx | — |
| 0x229E | arctis_nova_7x_gen2_tx | — |
| 0x230A | arctis_gamebuds_dongle | — |
| 0x230C | arctis_gamebuds_case | — |

---

## Key Mapping — Apex Pro TKL 2023

Source: Prism `zone_cache`, device_id=242, 2026-05-26.

`src/devices/key_mapping.rs` TKL 2023 mapping is largely correct with one discrepancy:

| HID Code | ssgg mapping | Prism zone_cache | Status |
|----------|-------------|-----------------|--------|
| 101 | `Menu` | Absent | ⚠️ Key doesn't exist on this keyboard |
| 240 | `SteelSeriesKey` (FN) | Present | ✅ |
| 50, 100, 133, 135–139 | In `tkl_hid_codes` | Absent | International layout only |

Prism confirms **84 addressable keys** on the US layout (the migration file lists 87 — the 3 extra are international-only keys absent on US keyboards).

`zone_count_for_product_id()` returning 9 for `APEX_PRO_TKL_2023` is correct — these are the 9 logical RGB zones, not the total key count.

### Open questions

- Which keyboards in the registry support per-key RGB? (requires GG.Models.dll decompilation)
- What are the correct zone counts for `APEX_PRO`, `APEX_PRO_TKL`, `APEX_5`, `APEX_7`, `APEX_7_TKL`?
- Do wireless Arctis models use the same HID protocol over the USB dongle?
- Should `Menu (HID 101)` be removed from the TKL 2023 key mapping?

---

## Prioritized ssgg Updates

1. **Fix `APEX_7_TKL` PID** (0x1616 → 0x1618) — correctness bug affecting all Apex 7 TKL users
2. **Add Apex Pro 2024 variants** (0x1640–0x1652)
3. **Add Apex Pro Mini variants** (0x161E, 0x1620, 0x1624, 0x1626)
4. **Add Arctis Nova 7 series** (0x2200–0x220A)
5. **Fix `ARCTIS_NOVA_5` PID** (0x12EA → 0x2230/0x2232)
6. **Add Arctis Nova 3 Wireless** (0x2267, 0x2269)
