/**
 * Recorder-app scenario slice â€” owns the currently selected scenario name.
 *
 * Carved out of the framework's `recording-slice` in Iter 1D of the boundary
 * migration ([plan](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-03-appframework-vs-recorderapp-boundary-analysis.md)).
 * Scenarios are a recorder-only concept (named bucket grouping recordings of
 * the same place); the framework now records flat sessions and stays
 * scenario-agnostic. The recorder reads this slice when stamping the session
 * metadata's `contextTag` at start / stop time.
 */

import type { PayloadAction } from '@reduxjs/toolkit';
import { createSlice } from '@reduxjs/toolkit';

export interface ScenarioState {
  /** Currently selected scenario name. Empty string means "no selection". */
  currentScenarioName: string;
}

const initialScenarioState: ScenarioState = {
  currentScenarioName: '',
};

const scenarioSlice = createSlice({
  name: 'scenario',
  initialState: initialScenarioState,
  reducers: {
    setCurrentScenarioName(state, action: PayloadAction<string>) {
      state.currentScenarioName = action.payload;
    },
    resetCurrentScenarioName(state) {
      state.currentScenarioName = '';
    },
  },
});

export const { setCurrentScenarioName, resetCurrentScenarioName } =
  scenarioSlice.actions;

export const scenarioReducer = scenarioSlice.reducer;
