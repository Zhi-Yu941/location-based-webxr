# Task 2 Goal 1A implementation evidence

## Slice 7 - real Task 1 fixture replay

- Date: 2026-08-08
- Source revision: `178ce543060fb50d74c095ba70cb5be3054f5dc3`
- Automated operator: Codex in Filip's workspace
- Human review: confirmed by Filip on 2026-09-07; Mingna's separate sign-off is
  not recorded here

### Preflight

- `pnpm test` from `Task2_Goal1A/`: passed formatting, lint, application
  typecheck, test typecheck, build, and 7 test files with 131 tests.
- Both reviewed fixture hashes were recomputed before replay:
  - `first-capture.zip`:
    `cba147f0fc418ccf7f5b978d661d22c88172f806b36caafb12ffd31608176e76`
  - `second-capture.zip`:
    `43699ee56b34a6ff985811aa29a7e123609be6f302c2a29a526723051972d0ca`
- Both hashes matched section 13.6 of the accepted plan.

### Replay command and artifact identities

The actual built package CLI was run with:

```text
pnpm --filter task2-goal1a-colmap run colmap:roundtrip -- "C:\Users\filip\OneDrive\Documents\PisacieVeci\location-based-webxr\dev\task1-fixtures\first-capture.zip" "C:\Users\filip\AppData\Local\Temp\task2-goal1a\slice7-29b9f2f5aa5b4f4193c265acde657ff8\first-capture-roundtrip.zip"
```

- Input path:
  `dev/task1-fixtures/first-capture.zip`
- Input byte length: `5,067,918`
- Input SHA-256:
  `cba147f0fc418ccf7f5b978d661d22c88172f806b36caafb12ffd31608176e76`
- Output path:
  `C:\Users\filip\AppData\Local\Temp\task2-goal1a\slice7-29b9f2f5aa5b4f4193c265acde657ff8\first-capture-roundtrip.zip`
- Output byte length: `3,016,161`
- Output SHA-256:
  `c4b5710af4a41e4bd70178c619cc958acff9110af890a4b6a50e631e7f8f3326`
- The tracked input hash was unchanged after replay.

The retained independent verifier was then run with:

```text
node scripts/verify-first-capture-replay.mjs "C:\Users\filip\OneDrive\Documents\PisacieVeci\location-based-webxr\dev\task1-fixtures\first-capture.zip" "C:\Users\filip\AppData\Local\Temp\task2-goal1a\slice7-29b9f2f5aa5b4f4193c265acde657ff8\first-capture-roundtrip.zip"
```

### Known fixture oracle

All reviewed first-capture facts passed:

- 124 file entries and 108 action files;
- camera `1 PINHOLE 823 1920 1254.3877251148224 1254.169921875 411.5 960`;
- 11 model images, 12 image assets, and 820 points;
- image ID `1` references `frame-000002.jpg`;
- `images/frame-000001.jpg` is the sole unreferenced image;
- all three `sparse/0/*.txt` files exist and no corresponding model binary
  exists; and
- all observations and tracks are empty.

### CLI summary

```text
Images: 11
Camera 1: PINHOLE 823x1920 fx=1254.3877251148224 fy=1254.169921875 cx=411.5 cy=960
Image 1 world-to-camera qvec: [0.894457291710854, 0.19180837132181047, -0.38847979668867616, -0.11063068995935861]
Image 1 world-to-camera tvec: [1.3862506016953726, 1.1485304288803049, 0.7874150127379612]
```

### Reopen and preservation result

- The CLI output reopened through the compiled public reader.
- Every referenced image resolved.
- Semantic model comparison passed.
- Exact unchanged-model comparison passed.
- Input and output archive path and entry-kind sets matched.
- Every untouched decompressed file payload was byte-identical.
- All three emitted sparse payloads matched a repeated serializer run.
- The public round-trip verification reported semantic model, exact no-op
  model, untouched entries, and exactly the three required replacement paths.

The first fixture exposed no additional assumption requiring cross-fixture
confirmation, so the second fixture replay was not required by section 13.6.
No generated ZIP or raw log was added to the repository during this automated
replay.

## Slice 8 - LichtFeld compatibility smoke

- Confirmation date: 2026-09-07
- Operator confirmation: Filip confirmed that the emitted ZIP works in
  LichtFeld and accepted Slices 7 and 8 for progression to refiner planning.
- Product Owner coordination: Filip reported that the related call with Simon
  was completed.
- Evidence limitation: the LichtFeld release/build, settings, training duration,
  machine, output artifact identity, and raw log were not supplied for this
  record. No more specific compatibility or quality claim is inferred.

This confirmation closes the one external compatibility smoke for the current
team workflow. It does not establish the reproducible LichtFeld recipe or
controlled-settings evidence deferred to later work.

## Slice 9 - AppFramework integration

Filip deferred the move into `GpsPlusSlamJs_AppFramework` until after the
refiner work. The temporary `Task2_Goal1A` package therefore remains the local
reader/writer foundation during refiner planning and experiments. This is a
sequencing decision, not removal of the final integration requirement.
