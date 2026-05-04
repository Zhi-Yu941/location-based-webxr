/**
 * Redux slice for recording session lifecycle management.
 *
 * Extracted from store.ts to enable proper separation of concerns and
 * break circular dependencies with persistence-middleware.ts.
 *
 * Manages: recording state, session metadata, write failure tracking.
 *
 * @see docs/2026-04-07-architecture-observations-consolidated.md §4
 */

import type { PayloadAction } from '@reduxjs/toolkit';
import { createSlice } from '@reduxjs/toolkit';
import { type RecordingOptions } from './recording-options';
import type { DepthSample } from '../types/ar-types';

// --- Recording-specific Types ---

export interface SessionMetadata {
  scenarioName: string;
  sessionName: string;
  startTime: number;
  deviceInfo?: string;
  notes?: string;
  /** Recording options used for this session (for replay context) */
  recordingOptions?: RecordingOptions;
}

export interface RecordingState {
  isRecording: boolean;
  sessionMetadata: SessionMetadata | null;
  actionCount: number;
  /**
   * Count of failed file write operations during this session.
   * User Feedback Issue #1 Part B: Track write failures for visibility.
   */
  failedWriteCount: number;
}

// --- Initial State ---

const initialRecordingState: RecordingState = {
  isRecording: false,
  sessionMetadata: null,
  actionCount: 0,
  failedWriteCount: 0,
};

// --- Recording Slice ---

const recordingSlice = createSlice({
  name: 'recording',
  initialState: initialRecordingState,
  reducers: {
    startSession(state, action: PayloadAction<SessionMetadata>) {
      state.isRecording = true;
      state.sessionMetadata = action.payload;
      state.actionCount = 0;
      state.failedWriteCount = 0;
    },

    endSession(state) {
      state.isRecording = false;
    },

    /**
     * Record a depth sample from WebXR depth sensing.
     * The sample includes camera pose and a grid of depth points.
     * This action is persisted to enable replay with depth data.
     */
    recordDepthSample(_state, _action: PayloadAction<DepthSample>) {
      // No state mutation needed - action is persisted for replay
      // Depth samples are self-contained with pose data
    },

    /**
     * Record a write failure during persistence.
     * User Feedback Issue #1 Part B: Track write failures for session summary.
     */
    recordWriteFailure(state, _action: PayloadAction<string>) {
      state.failedWriteCount += 1;
    },
  },
});

export const {
  startSession,
  endSession,
  recordDepthSample,
  recordWriteFailure,
} = recordingSlice.actions;

export const recordingReducer = recordingSlice.reducer;
