/**
 * The demo's Redux store: the framework's `createSlamAppStore` with the opt-in
 * `qrDetected` slice wired in (Note 3). The demo is geo-less — it only OBSERVES
 * the slice to drive the HUD + debug overlay; it casts no GPS vote and persists
 * nothing (NullStorageBackend).
 */

import { createSlamAppStore } from "gps-plus-slam-app-framework/state";
import { qrDetectedReducer } from "gps-plus-slam-app-framework/state";
import { NullStorageBackend } from "gps-plus-slam-app-framework/storage";

export function createQrDemoStore() {
  return createSlamAppStore({
    storageBackend: new NullStorageBackend(),
    extraReducers: { qrDetected: qrDetectedReducer },
  });
}

export type QrDemoStore = ReturnType<typeof createQrDemoStore>;
