//! Enumeration only: never opens hidraw, initializes a driver or sends a query.
use serde_json::{Value, json};
pub fn inventory() -> crate::Result<Vec<Value>> {
    let api = hidapi::HidApi::new()?;
    let mut devices = std::collections::BTreeMap::new();
    for info in api.device_list().filter(|d| d.vendor_id() == 0x1038) {
        let nova = info.product_id() == 0x227e;
        if nova && !(info.interface_number() == 3 && info.usage_page() == 0xffc0 && info.usage() == 1) {
            continue;
        }
        let id = format!(
            "{:04x}:{:04x}:{}",
            info.vendor_id(),
            info.product_id(),
            info.serial_number().unwrap_or("usb")
        );
        let reason = "Hardware acquisition is not enabled in this service; no HID commands were sent";
        let mut capabilities = serde_json::Map::new();
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
            capabilities.insert(name.into(), json!({"supported":false,"reason":reason}));
        }
        devices.entry(id.clone()).or_insert_with(||json!({
   "id":id,"name":info.product_string().unwrap_or("SteelSeries device"),"vendorId":info.vendor_id(),"productId":info.product_id(),
   "connected":true,"kind":if nova {"headset"} else {"other"},"battery":null,
   "artworkKey":if nova {Some("arctis-nova-7-gen-2")} else {None},"capabilities":capabilities,
   "hardwareAcquired":false,"protocolStatus":if nova {"Dedicated protocol available separately; integration pending"} else {"Unverified model"}
  }));
    }
    Ok(devices.into_values().collect())
}
