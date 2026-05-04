/**
 * Tests for the recorder-side `scenarioReducer`.
 *
 * The slice owns `currentScenarioName` â€” formerly a field on the framework's
 * `recording-slice`. It moved into the recorder app in Iter 1D of the
 * AppFramework/RecorderApp boundary migration so the framework's recording
 * lifecycle slice has nothing scenario-specific in it.
 *
 * @see ../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-03-appframework-vs-recorderapp-boundary-analysis.md â€” Iter 1D
 */

import { describe, it, expect } from 'vitest';
import {
  scenarioReducer,
  setCurrentScenarioName,
  resetCurrentScenarioName,
  type ScenarioState,
} from './scenario-slice';

describe('scenarioReducer', () => {
  // Why: callers (folder-manager, recording-session-handlers) read this on
  // first mount before any scenario picker fires, so the empty-string default
  // is part of the contract.
  it('initializes with empty currentScenarioName', () => {
    const state = scenarioReducer(undefined, { type: '@@INIT' });
    expect(state).toEqual<ScenarioState>({ currentScenarioName: '' });
  });

  // Why: the dropdown dispatches this action whenever the user picks a
  // scenario; a regression here would make scenarios silently fall back to
  // 'Default Scenario' on Start Recording.
  it('sets currentScenarioName via setCurrentScenarioName', () => {
    const state = scenarioReducer(
      undefined,
      setCurrentScenarioName('Park Walk')
    );
    expect(state.currentScenarioName).toBe('Park Walk');
  });

  // Why: scenario name must NOT reset when a recording starts â€” the value
  // is what gets stamped into the session metadata's contextTag at start
  // time and again into the per-session ZIP at stop time.
  it('preserves currentScenarioName across unrelated actions', () => {
    let state = scenarioReducer(undefined, setCurrentScenarioName('Downtown'));
    state = scenarioReducer(state, { type: 'recording/startSession' });
    expect(state.currentScenarioName).toBe('Downtown');
  });

  // Why: scenario picker uses this to clear back to "no selection" on hard
  // reset / scenario folder eviction.
  it('clears currentScenarioName via resetCurrentScenarioName', () => {
    let state = scenarioReducer(undefined, setCurrentScenarioName('A'));
    state = scenarioReducer(state, resetCurrentScenarioName());
    expect(state.currentScenarioName).toBe('');
  });

  // Why: the action type is what consumer mocks and persistence/devtools
  // observers grep for. Locking it down prevents an accidental rename from
  // silently breaking those listeners.
  it('uses the scenario/setCurrentScenarioName action type', () => {
    expect(setCurrentScenarioName('x').type).toBe(
      'scenario/setCurrentScenarioName'
    );
  });
});
