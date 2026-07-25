# Task 2 Goal 1A Development Package

This private workspace package isolates Team 6's COLMAP ZIP reader/writer work
from regular AppFramework development. It is the temporary implementation and
verification location for Iteration 1A, not a second long-lived product.

The reusable core remains browser-compatible TypeScript under `src/colmap/`.
Node-only CLI behavior belongs under `scripts/`. The package must not import
AppFramework or RecorderApp implementation modules.

After the accepted 1A tests, Task 1 fixture replay, and LichtFeld compatibility
gate pass, Team 6 will move the accepted source and tests into
`GpsPlusSlamJs_AppFramework` and delete this temporary package. The two copies
must never be maintained in parallel.
