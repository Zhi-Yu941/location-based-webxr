# Iteration 1A Plan Readiness Review

## 1. Executive verdict

Stable-input check passed: `plans/task2-goal1a-contract.md` existed, had a complete ending through sections 18-20, and was reviewed at SHA-256 `F5A446751CEE968284EAD33877A2A0009BE894DFAA5CCD4F20F1E9C276CD05B9`. The plan passes all 17 applicable assignment checks and implements 11 owner decisions fully. One Blocker remains: `OWNER_DECISIONS.md` OD-010 preserves every untouched archive entry, but plan sections 7.3-7.4 permit ZIP directory records to be omitted. No Product Owner choice remains. After that narrow correction and the explicitly listed Team 6 approvals, implementation can begin. `reviews/filip-contract-1a-assignment-check.md` was absent; the authoritative assignment PDF was checked directly. The optional Simon brief was also absent.

## 2. Assignment coverage matrix

| Requirement | Status | Assignment source | Plan evidence | Required correction |
|---|---|---|---|---|
| 1. Open a recorder COLMAP ZIP | Pass | §2.3, component 1 | `plans/task2-goal1a-contract.md` - “3. Normative 1A outcome”; “7.1 Public core boundary” | None |
| 2. Parse `sparse/0/cameras.txt` | Pass | §2.2, reader/writer; Appendix | `plans/task2-goal1a-contract.md` - “3. Normative 1A outcome”; “8.1 Supported text records” | None |
| 3. Parse `sparse/0/images.txt` | Pass | §2.2, reader/writer; Appendix | `plans/task2-goal1a-contract.md` - “3. Normative 1A outcome”; “8.1 Supported text records” | None |
| 4. Parse `sparse/0/points3D.txt` | Pass | §2.2, reader/writer; Appendix | `plans/task2-goal1a-contract.md` - “3. Normative 1A outcome”; “8.1 Supported text records” | None |
| 5. Represent cameras, images and points as typed data | Pass | §2.2, reader/writer | `plans/task2-goal1a-contract.md` - “8.2 Typed model” | None |
| 6. Resolve image references | Pass | §2.3, component 1 | `plans/task2-goal1a-contract.md` - “3. Normative 1A outcome”; “7.3 Required input profile” | None |
| 7. Write the model back into a ZIP | Pass | §2.3, component 1 | `plans/task2-goal1a-contract.md` - “7.1 Public core boundary”; “7.4 Output preservation” | None |
| 8. Preserve the image list and required assets | Pass | §2.3, component 1 test | `plans/task2-goal1a-contract.md` - “7.4 Output preservation”; “13.4 Archive tests with synthetic in-memory ZIPs” | None |
| 9. Demonstrate a structurally faithful unchanged round trip | Pass | §2.2 reader/writer; §2.3, component 1 test | `plans/task2-goal1a-contract.md` - “10.3 Separate guarantees”; “13.6 Real Task 1 fixture replay” | None |
| 10. Test quaternion and translation conventions | Pass | §2.3, component 1 test; §2.5.1 | `plans/task2-goal1a-contract.md` - “9. Coordinate and pose contract”; “13.3 Pose-convention tests” | None |
| 11. Print the number of images | Pass | §2.3, component 1 demo | `plans/task2-goal1a-contract.md` - “12. CLI and assignment demonstration” | None |
| 12. Print camera intrinsics | Pass | §2.3, component 1 demo | `plans/task2-goal1a-contract.md` - “12. CLI and assignment demonstration” | None |
| 13. Print the pose of image 1 | Pass | §2.3, component 1 demo | `plans/task2-goal1a-contract.md` - “7.1 Public core boundary”; “12. CLI and assignment demonstration” | None |
| 14. Re-emit a ZIP through the actual parser and writer | Pass | §2.3, component 1 demo | `plans/task2-goal1a-contract.md` - “10.3 Separate guarantees”; “12. CLI and assignment demonstration” | None |
| 15. Verify that output remains usable by LichtFeld | Pass | §2.3, component 1 | `plans/task2-goal1a-contract.md` - “14. LichtFeld compatibility gate” | None |
| 16. Require `.txt` support | Pass | §2.3, component 1 | `plans/task2-goal1a-contract.md` - “4. Scope and explicit non-goals”; “8.1 Supported text records” | None |
| 17. Keep `.bin` nice-to-have rather than mandatory | Pass | §2.3, component 1 | `plans/task2-goal1a-contract.md` - “4. Scope and explicit non-goals”; “7.3 Required input profile” | None |

## 3. Owner-decision compliance

Decision sources are the exact OD-001 through OD-012 headings in `OWNER_DECISIONS.md`.

| Owner decision | Status | Plan evidence | Comment |
|---|---|---|---|
| OD-001 — Reader/writer is the current implementation priority | Implemented correctly | `plans/task2-goal1a-contract.md` - “2. Goal 1 position and the purpose of 1A”; “3. Normative 1A outcome” | 1A is first and bounded. |
| OD-002 — Normal operation is local and offline | Implemented correctly | `plans/task2-goal1a-contract.md` - “3. Normative 1A outcome”; “12. CLI and assignment demonstration” | Core and CLI require no service. |
| OD-003 — Iteration 1A uses a local CLI | Implemented correctly | `plans/task2-goal1a-contract.md` - “5. Component boundary and ownership”; “12. CLI and assignment demonstration” | Uses the public round-trip pipeline. |
| OD-004 — The reusable core remains browser-compatible TypeScript | Implemented correctly | `plans/task2-goal1a-contract.md` - “6. Proposed runtime and repository placement”; “7.1 Public core boundary” | Node behavior stays in the CLI. |
| OD-005 — Iteration 1A uses lean internal error handling | Implemented correctly | `plans/task2-goal1a-contract.md` - “11. Lean failure contract” | One contextual exception; fail closed. |
| OD-006 — The reader/writer is a foundation for later quality experiments | Implemented correctly | `plans/task2-goal1a-contract.md` - “2. Goal 1 position and the purpose of 1A”; “19. Minimal future seams and deferred work” | Later stages remain separate. |
| OD-007 — CSUtils product integration is deferred | Implemented correctly | `plans/task2-goal1a-contract.md` - “4. Scope and explicit non-goals”; “19. Minimal future seams and deferred work” | UI/product work is excluded. |
| OD-008 — Archive, codec, and model-validation ownership is separated | Implemented correctly | `plans/task2-goal1a-contract.md` - “5. Component boundary and ownership”; “7.2 Internal archive-adapter boundary” | One ZIP adapter; codec and validator are separate. |
| OD-009 — The 1A model is recorder-specific but deliberately extensible | Implemented correctly | `plans/task2-goal1a-contract.md` - “8. Supported COLMAP profile and typed model” | Strict text/`PINHOLE` profile with typed seams. |
| OD-010 — Round-trip fidelity is semantic, deterministic, and archive-preserving | Partially implemented | `plans/task2-goal1a-contract.md` - “7.3 Required input profile”; “7.4 Output preservation”; “10.3 Separate guarantees” | File payloads pass; directory records may be omitted. |
| OD-011 — The 1A LichtFeld check is one external compatibility gate | Implemented correctly | `plans/task2-goal1a-contract.md` - “14. LichtFeld compatibility gate” | Compatibility only, after local gates. |
| OD-012 — The first shared plan records minimal future seams only | Implemented correctly | `plans/task2-goal1a-contract.md` - “19. Minimal future seams and deferred work” | Interfaces are planning-only and deliberately incomplete. |

**Owner decision:**  
`OWNER_DECISIONS.md` - “OD-010 — Round-trip fidelity is semantic, deterministic, and archive-preserving”: every untouched archive entry keeps its normalized path and decompressed bytes.

**Plan statement:**  
`plans/task2-goal1a-contract.md` - “7.3 Required input profile” permits directory records to be reconstructed or omitted; “7.4 Output preservation” excludes them.

**Mismatch:**  
The plan narrows “every untouched archive entry” to file entries without an accepted exception.

**Minimum correction:**  
Preserve and verify every untouched entry, including directory records; keep ZIP metadata exclusions.

## 4. Merge-quality assessment

Merge dispositions were checked against `reviews/task2-goal1a-technical-comparison.md` - “4. Material conflicts” and “5. Merge candidates.”

“Plan” below denotes `plans/task2-goal1a-contract.md`; every citation names its exact heading.

| Decision area | Merge choice | Status | Reason |
|---|---|---|---|
| Archive adapter ownership | Exclusive adapter plus copy-through | Correct complementary merge | `plans/task2-goal1a-contract.md` - “5. Component boundary and ownership.” |
| Referenced images | Resolve and byte-preserve | Correct shared choice | Plan - “7.3 Required input profile”; “7.4 Output preservation.” |
| Unreferenced images | Opaque preservation | Correct shared choice | Plan - “7.4 Output preservation.” |
| `actions/`, `session.json`, unknown entries | File-only copy-through | Useful requirement lost | Plan - “7.4 Output preservation” excludes directory records despite OD-010. |
| Recorder-specific vs generic support | Strict text/`PINHOLE` profile | Superseded by owner decision | OD-009 settles the earlier ambiguity. |
| Arrays, Maps and ordering | Ordered arrays plus ID/reference validation | Correctly adopted from Filip | Plan - “8.2 Typed model”; “8.3 Validation rules.” |
| Numeric serialization | Round-trip-safe output; proposed `1e-12` comparison | Defined but awaiting Team 6 approval | Plan - “10.1 Codec boundary”; “10.3 Separate guarantees.” |
| Semantic vs byte-identical round trip | Separate semantic, exact-no-op and archive checks | Correct complementary merge | Plan - “10.3 Separate guarantees.” |
| Coordinate conventions | W2C, WXYZ, translation and no reconversion | Correctly adopted from Filip | Plan - “9. Coordinate and pose contract.” |
| Failure handling | One contextual exception | Superseded by owner decision | OD-005 supersedes the comparison recommendation. |
| Summary CLI | Assignment-exact local CLI | Correctly adopted from Filip | Plan - “12. CLI and assignment demonstration.” |
| LichtFeld smoke | Completed training plus openable artifact | Superseded by owner decision | OD-011 rejects undefined parity claims. |
| Future refinement/evaluation seams | Typed-model planning seams only | Correct complementary merge | Plan - “19. Minimal future seams and deferred work.” |

**Filip covered:**  
All untouched entry paths and payloads.  
**Mingna covered:**  
Unmodified images, logs and session data.  
**Current plan chose:**  
Opaque file-entry copy-through but optional directory records.  
**Problem:**  
The merge weakens OD-010.  
**Best smallest merge:**  
Inventory, copy and test every untouched archive entry, including directory records.  
**Decision owner:**  
Already fixed by owner decision

**Filip covered:**  
Round-trip-safe deterministic numbers and exact no-op checking.  
**Mingna covered:**  
Fixed decimals, `1e-6`, and sign-invariant quaternion comparison.  
**Current plan chose:**  
OD-010's formatting policy plus a proposed `1e-12` semantic tolerance.  
**Problem:**  
The tolerance is defined but not yet approved; this is an approval item, not a design defect.  
**Best smallest merge:**  
Team 6 approves `1e-12` or records another epsilon while retaining OD-010.  
**Decision owner:**  
Team 6 technical decision

## 5. Blocker and Major findings

### Finding: Untouched ZIP directory entries may be dropped

**Severity:** Blocker

**Evidence:**  
`OWNER_DECISIONS.md` - “OD-010 — Round-trip fidelity is semantic, deterministic, and archive-preserving”; `plans/task2-goal1a-contract.md` - “7.2 Internal archive-adapter boundary,” “7.3 Required input profile,” “7.4 Output preservation,” and “13.4 Archive tests with synthetic in-memory ZIPs.”

**Problem:**  
OD-010 covers every untouched archive entry. The plan models and tests only file entries and expressly permits directory records to be omitted.

**Why it matters:**  
Implementation would knowingly provide a weaker archive-preservation guarantee than Team 6 accepted, forcing contract or test rework at acceptance.

**Minimum correction:**  
Change the adapter inventory, copy-through rule and preservation test to retain every untouched entry path and payload, including directory records; continue excluding only the accepted container metadata.

**Owner:**  
Team 6

## 6. Implementation-readiness checklist

“Plan” below denotes `plans/task2-goal1a-contract.md`; every citation names its exact heading.

| Readiness item | Status | Evidence or missing requirement |
|---|---|---|
| One candidate component pipeline | Pass | `plans/task2-goal1a-contract.md` - “3. Normative 1A outcome”; “5. Component boundary and ownership” |
| Clear module ownership | Pass | Plan - “5. Component boundary and ownership” |
| Concrete implementation order | Pass | Plan - “15. Implementation sequence” |
| Tests before/alongside implementation | Pass | Plan - “13. Test-first acceptance suite”; “15. Implementation sequence” |
| Task 1 fixtures identified and read-only | Pass | Plan - “13.6 Real Task 1 fixture replay” |
| Recorder/exporter untouched | Pass | Plan - “4. Scope and explicit non-goals”; “6. Proposed runtime and repository placement” |
| Local CLI demonstration | Pass | Plan - “12. CLI and assignment demonstration” |
| One bounded LichtFeld gate | Pass | Plan - “14. LichtFeld compatibility gate” |
| Evidence to retain | Pass | Plan - “17. Verification and completion evidence” |
| Pair responsibilities | Pass | Plan - “16. Pair-programming and review plan” |
| Integration/review points | Pass | Plan - “15. Implementation sequence”; “16. Pair-programming and review plan” |
| Slices/commit boundaries | Pass | Plan - “15. Implementation sequence” |
| No later Goal 1 work included | Pass | Plan - “4. Scope and explicit non-goals”; “19. Minimal future seams and deferred work” |
| Remaining Team 6 approvals identified | Pass | Plan - “18. Approval and go/no-go gate” |
| No unresolved Product Owner decision | Pass | Plan - “18. Approval and go/no-go gate”; `OWNER_DECISIONS.md` - “Decisions intentionally not recorded yet” |

## 7. Required corrections before implementation

**Required plan corrections**

- Align sections 7.2-7.4 and 13.4 with OD-010 by preserving and testing directory records as untouched archive entries.

**Required Team 6 approvals**

- Filip and Mingna complete and record every section 18 approval, including module/API placement, zip.js use, the `1e-12` tolerance (or a recorded replacement), fixture verification, implementation sequence and first pair session.

**Required Product Owner decisions**

- None.

## 8. Items correctly deferred

Binary and generic COLMAP support; action/depth/GPS parsing; refinement selection and implementation; harness metrics and held-out policy; LichtFeld source builds, parity and repeated-run automation; and CSUtils/UI integration remain visible but outside 1A. They are not lost and do not block this component.

## 9. Final verdict

Conditional pass — ready after listed corrections or Team 6 approvals

## 10. Recommended next action

apply specific plan corrections, approve it and begin implementation;
