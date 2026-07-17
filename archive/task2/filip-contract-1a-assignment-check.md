# Filip Contract 1A Assignment Check

> **Status: Superseded.** The image-ID-1 demo finding was applied to the current `Draft/filip-contract-1a.md`. This check is retained as correction evidence.

Severity:
Major

Evidence:
The Team 6 assignment, section 2.3, Goal 1 component 1, requires the demo summary to print "N images, camera intrinsics, pose of image 1." Section 15 of the contract makes `selectedImageId` optional and otherwise selects the first image in source-record order. Sections 9 and 16 allow sparse IDs and arbitrary preserved source order, and the acceptance criteria require only one selected image pose.

Mismatch:
The contract does not guarantee that the conformance demo prints the pose of image ID 1. A conforming implementation could print another image's pose when that record appears first, while still passing the current Iteration 1A acceptance criteria.

Minimum correction:
Require the Iteration 1A demo or required fixture replay to request and print image ID 1. Keep the generic selector unchanged; its existing missing-ID rejection is sufficient when image ID 1 is absent.

Ready after listed corrections
