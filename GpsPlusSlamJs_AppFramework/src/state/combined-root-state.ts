/**
 * `CombinedRootState` — back-compat type alias for the framework root state.
 *
 * Previously composed `refPoints` into the framework root state; that slice
 * now lives in the recorder app (Iter 3 of the AppFramework / RecorderApp
 * boundary migration), so the framework root only carries what
 * `createSlamAppStore` ships by default.
 *
 * Consumers that own additional slices should compose their own root type
 * via `SlamAppCombinedState<{ extraReducers }>` and pass that as the
 * structural state argument to framework selectors / subscribers.
 */

import type { SlamAppCombinedState } from './create-slam-app-store';

export type CombinedRootState = SlamAppCombinedState;
