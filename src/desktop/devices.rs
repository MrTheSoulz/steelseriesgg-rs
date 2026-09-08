//! Enumeration only: never opens hidraw, initializes a driver or sends a query.
use serde_json::{Value, json};
pub fn capabilities(nova: bool) -> Value {
    let mut result = serde_json::Map::new();
    for name in [
        "battery",
        "physicalChatmix",
        "sidetone",
        "autoOff",
        "hardwareEq",
        "rgb",
        "micMute",
        "micVolume",
    ] {
        let supported = nova && ["battery", "physicalChatmix", "sidetone", "autoOff"].contains(&name);
        let reason = if supported {
            "Dedicated model protocol implemented from cited upstream sources; local hardware validation pending. Explicit acquisition required"
        } else {
            "No verified model-specific implementation; no command will be sent"
        };
        result.insert(
            name.into(),
            json!({"supported":supported,"locallyValidated":false,"reason":reason}),
        );
    }
    Value::Object(result)
}
pub fn with_physical(mut entries: Vec<Value>, physical: &super::hardware::Physical) -> Vec<Value> {
    for entry in &mut entries {
        if physical.device_id.as_deref().is_some_and(|id| entry["id"] == id) {
            entry["physical"] = json!(physical);
            entry["hardwareAcquired"] = json!(physical.hardware_acquired);
            entry["hardwareEnabled"] = json!(physical.hardware_enabled);
            entry["battery"] = json!(physical.battery);
        }
    }
    entries
}
pub fn inventory() -> crate::Result<Vec<Value>> {
    let api = hidapi::HidApi::new()?;
    let mut devices = std::collections::BTreeMap::new();
    for info in api.device_list().filter(|d| d.vendor_id() == 0x1038) {
        let nova = info.product_id() == 0x227e;
        if nova && !(info.interface_number() == 3 && info.usage_page() == 0xffc0 && info.usage() == 1) {
            continue;
        }
        let rgb_model = info.product_id() == 0x1642;
        if rgb_model && info.interface_number() != 1 {
            continue;
        }
        let id = if rgb_model {
            super::lighting::Endpoint::from_info(info)
                .map_err(crate::Error::DeviceCommunication)?
                .id
        } else {
            format!(
                "{:04x}:{:04x}:{}",
                info.vendor_id(),
                info.product_id(),
                info.serial_number().unwrap_or("usb")
            )
        };
        let mut capabilities = capabilities(nova);
        capabilities["rgb"] = super::lighting::capability(info.vendor_id(), info.product_id(), info.interface_number());
        devices.entry(id.clone()).or_insert_with(||json!({
   "id":id,"name":info.product_string().unwrap_or("SteelSeries device"),"vendorId":info.vendor_id(),"productId":info.product_id(),
   "connected":true,"kind":if nova {"headset"} else if rgb_model || info.product_id() == 0x1628 {"keyboard"} else {"other"},"battery":null,
   "artworkKey":if nova {Some("arctis-nova-7-gen-2")} else {None},"capabilities":capabilities,
   "hardwareEnabled":false,"hardwareAcquired":false,"protocolStatus":if nova {"Source-supported dedicated protocol; local hardware validation pending"} else {"Unverified model"}
  }));
    }
    Ok(devices.into_values().collect())
}
