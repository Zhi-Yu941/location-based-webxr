# Location-Based WebXR

Open-source framework and recorder app for building **location-based Augmented Reality** experiences on the web.

This repository contains two packages that sit on top of the closed-source [`gps-plus-slam-js`](https://www.npmjs.com/package/gps-plus-slam-js) core library:

```
┌──────────────────────────────────────────────────┐
│  Your App                                        │
│  (UI, screen flow, app-specific logic)           │
├──────────────────────────────────────────────────┤
│  gps-plus-slam-app-framework   ← this repo       │
│  (WebXR, Three.js, sensors, storage, replay)     │
├──────────────────────────────────────────────────┤
│  gps-plus-slam-js              (npm package)      │
│  (GPS/AR alignment, outlier rejection, GPS math) │
└──────────────────────────────────────────────────┘
```

## Packages

| Package                                                     | Description                                                                                                                              | License    |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| [`GpsPlusSlamJs_AppFramework`](GpsPlusSlamJs_AppFramework/) | Reusable AR+GPS app framework — WebXR session management, Three.js visualization, GPS sensors, storage, replay engine, and store wiring. | Apache-2.0 |
| [`GpsPlusSlamJs_RecorderApp`](GpsPlusSlamJs_RecorderApp/)   | Full-featured recorder app for capturing AR sessions with GPS data. Built on the framework above.                                        | Apache-2.0 |

## About the Core Library

The core alignment library ([`gps-plus-slam-js`](https://www.npmjs.com/package/gps-plus-slam-js)) is **closed-source** and distributed via npm under a proprietary license (EULA). It provides:

- **Sub-meter positioning** — fuses high-frequency AR odometry with noisy GPS.
- **Fully offline** — all computation runs on-device, no network requests.
- **Framework-agnostic** — pure TypeScript with a Redux-based state store.
- **Incremental alignment** — the alignment matrix updates live as new observations arrive.

A free **community license key** is included in the recorder app for evaluation and non-commercial use. See the [EULA](https://www.npmjs.com/package/gps-plus-slam-js) for commercial licensing.

## Getting Started

### Prerequisites

- Node.js ≥ 20
- npm ≥ 10

### Install and Run the Recorder App

```bash
# Clone the repository
git clone https://github.com/cs-util-com/location-based-webxr.git
cd location-based-webxr

# Install dependencies and start the dev server
cd GpsPlusSlamJs_RecorderApp
npm install
npm run dev
```

The recorder app opens at `http://localhost:5173`. Use a WebXR-capable device (or browser emulation) to start recording AR+GPS sessions.

### Build the Framework from Source

```bash
cd GpsPlusSlamJs_AppFramework
npm install
npm run build
```

### Run Tests

```bash
# All tests (framework + recorder unit + recorder E2E)
npm test

# Framework tests only
npm run test:framework

# Recorder unit tests only
npm run test:recorder:unit

# Recorder E2E tests only
npm run test:recorder:e2e
```

## Building Your Own App

Install the framework and core library:

```bash
npm install gps-plus-slam-app-framework gps-plus-slam-js
```

```ts
import { createRecorderStore } from 'gps-plus-slam-app-framework/state';
import { initWebXRSession } from 'gps-plus-slam-app-framework/ar';
import { startGpsWatch } from 'gps-plus-slam-app-framework/sensors';

// 1. Create a store (wraps the core library's Redux store)
const store = createRecorderStore();

// 2. Start AR and GPS
const session = await initWebXRSession(container);
startGpsWatch(store);

// 3. The alignment matrix updates automatically as data arrives
```

See the [AppFramework README](GpsPlusSlamJs_AppFramework/README.md) for the full API and the [RecorderApp](GpsPlusSlamJs_RecorderApp/) for a complete working example.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, coding standards, and the pull request process.

## License

The framework and recorder app are licensed under the [Apache License 2.0](LICENSE).

The core library (`gps-plus-slam-js`) is distributed under a separate proprietary license. See its [EULA](https://www.npmjs.com/package/gps-plus-slam-js) for details.
