/// <reference types="google.maps" />

import { importLibrary, setOptions } from "@googlemaps/js-api-loader";

const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY;
export const googlePickupMapId = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID;
export const googlePickupConfigured = Boolean(apiKey && googlePickupMapId);
let configured = false;

export function loadGoogleLibrary<T extends keyof google.maps.ImportLibraryMap>(library: T) {
  if (!configured) {
    setOptions({ key: apiKey, v: "weekly", language: "es", region: "AR" });
    configured = true;
  }
  return importLibrary(library);
}
