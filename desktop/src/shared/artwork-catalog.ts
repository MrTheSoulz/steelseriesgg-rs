// Manufacturer artwork is not included in the code license or the app bundle.
export const nova7Gen2Artwork = {
  model: "Arctis Nova 7 Gen 2",
  variant: "Black; USB identification does not determine casing color",
  imageURL:
    "https://images.ctfassets.net/hmm5mo4qf4mf/2yt5bxGCEbi0Wym2AHqWAQ/c5603bd4ed02257fc86036e15271da62/arctis_nova_7_wl_gen_2_black_pdp_img_buy_01.png",
  sourceURL: "https://steelseries.com/gaming-headsets/arctis-nova-7-gen-2",
  attribution: "Product photograph © SteelSeries. SSGG is an independent project, not affiliated with SteelSeries.",
};
export function artworkFor(vendorId: number, productId: number) {
  return vendorId === 0x1038 && productId === 0x227e ? nova7Gen2Artwork : null;
}
