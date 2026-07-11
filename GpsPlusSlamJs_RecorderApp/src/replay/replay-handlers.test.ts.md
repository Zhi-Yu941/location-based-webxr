# replay-handlers.test.ts

## Purpose

Tests for the extracted replay handlers module (`replay-handlers.ts`), verifying that the factory-based extraction from `main.ts` preserves all original behavior.

## Tests

| Suite                        | Test                                                   | Why                                                                |
| ---------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------ |
| `createReplayHandlers`       | returns all handler functions and state accessors      | Contract validation — ensures the factory returns the complete API |
|                              | initializes with default state                         | Defaults must match original module-level initialization           |
| `handleReplayScenarioChange` | clears sessions when no folder handle                  | Guard clause: no folder → empty list                               |
|                              | clears sessions when scenario name is empty            | Guard clause: empty name → empty list                              |
|                              | lists sessions from scenario subdirectory              | Core path: directory-based session discovery                       |
|                              | serves cache sessions when directory does not exist    | Metadata-only scenarios: NotFoundError → use cache                 |
|                              | merges directory and cache sessions without duplicates | Deduplication by filename                                          |
|                              | sorts merged sessions by filename                      | Consistent display order                                           |
|                              | shows error toast on unexpected directory error        | Non-NotFoundError exceptions surface to user                       |
|                              | calls populateReplaySessions with display entries      | UI receives filename+date, not fileHandle                          |
| `handleReplaySessionSelect`  | stores the selected session index                      | Index is stored for handleStartReplay to use                       |
| `handleStartReplay`          | shows error when no session is selected                | Guard: no selection → error message                                |
|                              | initializes replay from selected session zip           | Core path: zip → startReplayMode                                   |
|                              | calls setStore with the replay controller store        | R6 coupling: store replacement callback                            |
|                              | hides setup modal and shows replay controls            | UI state transitions                                               |
|                              | starts playback at the requested speed                 | Speed factor passed through                                        |
|                              | shows error when startReplayMode fails                 | Error handling for corrupt/invalid zips                            |
| `handleReplayPlayPause`      | no-op when no controller                               | Safe guard                                                         |
|                              | pauses when currently playing                          | Delegates to controller.pause()                                    |
|                              | resumes when currently paused                          | Delegates to controller.resume()                                   |
| `handleReplaySpeedChange`    | sets speed on the controller                           | Delegates to controller.setSpeed()                                 |
|                              | no-op when no controller                               | Safe guard                                                         |
| `handleReplayCameraToggle`   | toggles camera mode and updates button                 | Delegates to replay-scene + UI                                     |
| `handleReplayMapToggle`      | no-op when no replay controller                        | Guard: can't create overlay without active replay                  |
|                              | no-op when replay scene not initialized                | Guard: needs scene, camera                                         |
|                              | lazily creates LeafletMapOverlay on first toggle       | Overlay created with scene, camera, mapParent from CameraFollower  |
|                              | reuses overlay and calls toggle on subsequent calls    | Singleton per replay session                                       |
|                              | sets GPS position from store on overlay creation       | Overlay starts with last known GPS                                 |
|                              | calls setMapOverlay on controller                      | Wires proxy so store subscribers can update map                    |
| State management             | get/set isReplayMode                                   | Flag accessor                                                      |
|                              | accepts and uses replayZipScenariosCache               | Cache set externally, used by scenario change                      |
|                              | resets all state                                       | reset() clears everything                                          |
