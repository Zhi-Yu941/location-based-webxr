# Contributing to Location-Based WebXR

Thank you for your interest in contributing! This document covers the development setup, coding standards, and pull request process.

## Development Setup

### Prerequisites

- **Node.js** ≥ 20 and **npm** ≥ 10
- A WebXR-capable browser (or Chrome DevTools WebXR emulation) for E2E testing

### Clone and Install

```bash
git clone https://github.com/cs-util-com/location-based-webxr.git
cd location-based-webxr

# Install framework dependencies
cd GpsPlusSlamJs_AppFramework
npm install

# Install recorder app dependencies
cd ../GpsPlusSlamJs_RecorderApp
npm install
```

### Running Tests

```bash
# Framework: format, lint, typecheck, and unit tests
cd GpsPlusSlamJs_AppFramework
npm test

# Recorder: format, lint, typecheck, unit tests, and E2E tests
cd GpsPlusSlamJs_RecorderApp
npm test

# Unit tests only (faster iteration)
npm run test:unit

# E2E tests only
npm run test:e2e
```

## Coding Standards

### Test-Driven Development (TDD)

This project follows TDD by default:

1. **Write a failing test** for the behavior you want.
2. **Run tests** — confirm the failure is for the expected reason.
3. **Implement the minimum** code to make the test pass.
4. **Refactor** with tests still green.
5. **Update the sidecar doc** (see below).

### Sidecar Documentation

Every code file that implements behavior must have a colocated `*.md` sidecar file. Keep them short but useful:

- **Purpose** — one-line summary.
- **Public API** — exported symbols, inputs/outputs, error modes.
- **Invariants** — preconditions, data shapes.
- **Examples** — minimal usage snippets.
- **Tests** — which tests cover this file.

### Code Quality

- **TypeScript** — strict mode, no `any` unless justified.
- **Formatting** — Prettier (runs automatically in `npm test`).
- **Linting** — ESLint with the project config.
- **No circular dependencies** — enforced by `dpdm`.
- **No dead code** — enforced by `knip`.
- **No code duplication** — enforced by `jscpd`.

### Commit Messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope): subject
```

Types: `feat`, `fix`, `refactor`, `test`, `docs`

Examples:
- `feat(framework): add compass heading selector`
- `fix(recorder): prevent crash on GPS timeout`
- `test(framework): add property tests for GPS weight calculation`

## Pull Request Process

1. **Fork** the repository and create a feature branch from `main`.
2. **Write tests first** — every PR should include tests for the changes.
3. **Run the full test suite** locally before pushing:
   ```bash
   cd GpsPlusSlamJs_AppFramework && npm test
   cd ../GpsPlusSlamJs_RecorderApp && npm test
   ```
4. **Open a PR** with a clear description of what and why.
5. **CI runs automatically** — framework tests, recorder unit tests, and E2E tests must all pass.
6. **Address review feedback** — maintainers may request changes.
7. **Squash-merge** — PRs are squash-merged to keep a clean history.

### What Makes a Good PR

- Small and focused — one logical change per PR.
- Tests included — both unit and property-based where applicable.
- Sidecar docs updated — if you changed behavior, update the `.md` file.
- No unrelated changes — keep diffs minimal.

## Architecture Overview

```
┌──────────────────────────────────────────────────┐
│  Your App / RecorderApp                          │
├──────────────────────────────────────────────────┤
│  gps-plus-slam-app-framework   (this repo)       │
│  WebXR · Three.js · Sensors · Storage · Replay   │
├──────────────────────────────────────────────────┤
│  gps-plus-slam-js              (npm, closed-src)  │
│  Alignment algorithms · GPS math · State store   │
└──────────────────────────────────────────────────┘
```

The **core library** (`gps-plus-slam-js`) is closed-source and installed from npm. You do not need the core source code to contribute to this repository — the published npm package provides full TypeScript types and works out of the box.

### Key Directories

| Directory                                     | Contents                                                   |
| --------------------------------------------- | ---------------------------------------------------------- |
| `GpsPlusSlamJs_AppFramework/src/`             | Framework source (AR, sensors, state, visualization, etc.) |
| `GpsPlusSlamJs_RecorderApp/src/`              | Recorder app source (UI components, screens, app logic)    |
| `GpsPlusSlamJs_AppFramework/src/**/*.test.ts` | Framework unit tests                                       |
| `GpsPlusSlamJs_RecorderApp/src/**/*.test.ts`  | Recorder unit tests                                        |
| `GpsPlusSlamJs_RecorderApp/playwright-tests/` | Recorder E2E tests                                         |

## Contributor License Agreement (CLA)

By submitting a pull request, you agree to the [Contributor License Agreement](https://cla-assistant.io/cs-util-com/location-based-webxr). The CLA bot will comment on your first PR with instructions.

## Getting Help

- **Bug reports** — [open an issue](https://github.com/cs-util-com/location-based-webxr/issues/new?template=bug_report.md)
- **Feature requests** — [open an issue](https://github.com/cs-util-com/location-based-webxr/issues/new?template=feature_request.md)
- **Questions** — check existing issues or open a new one

## License

By contributing, you agree that your contributions will be licensed under the [Apache License 2.0](LICENSE).
