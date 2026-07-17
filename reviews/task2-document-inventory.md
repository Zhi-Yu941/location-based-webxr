# Task 2 document inventory and organization proposal

> **Status:** Current review — documentation inventory only. This file does not approve a proposal, create an official plan, or record a Product Owner decision.

Audit date: 2026-07-17

## 1. Scope and evidence limits

This audit covers `AGENTS.md` and every Markdown file currently present under `Draft/`, `reviews/`, and `plans/` that relates to Task 2. There are four Task 2 drafts, eight Task 2 reviews, and no Markdown files under `plans/`.

`OWNER_DECISIONS.md` is referenced by `AGENTS.md` and several drafts but is not present in this checkout. It therefore could not be read, and no proposal or review is treated as an accepted decision record. The Team 6 assignment PDF is also not present in this checkout. It was not needed to identify the documents' stated purposes, so this audit did not substitute another document for the assignment. Requirements quoted or classified by the Markdown files remain secondary summaries; the assignment itself remains authoritative.

No production source, Task 1 fixture, external source, or unrelated documentation was inspected for this inventory. Git history was used only to clarify file chronology and known authorship.

## 2. Executive findings

- There is no current official plan in `plans/`, despite `AGENTS.md` naming a missing `Draft/task2-contracts-plan.md` as the official plan.
- There is no available accepted decision record because `OWNER_DECISIONS.md` is missing.
- The current independent proposal pair is `Draft/filip-contract-1a.md` and `Draft/mingna-contract.md`. They must remain separate.
- Filip's original audit, its review/disposition, the broad v2 candidate, the v2 review, and the resolved 1A assignment check form a historical revision chain. They remain useful evidence but should not sit beside current proposals without status banners.
- `reviews/task2-goal1a-technical-comparison.md` is the current detailed comparison. `reviews/task2-goal1a-owner.md` is its decision-oriented call brief. They overlap by design but are not duplicates.
- `reviews/task2-review-comparison.md` is an unfilled, stale comparison template. It is functionally superseded by the Goal 1A technical comparison.
- `reviews/task2-goal1-requirements.md` is a useful current traceability review, but it is not an authoritative requirement source.
- Several live navigation references in `AGENTS.md` are missing or misspelled. A root `TASK2_DOCUMENTS.md` index is the main missing navigation artifact.
- Reviews remain evidence even where their recommendations were rejected or later narrowed. Archiving should preserve them unchanged apart from an explicit status banner and necessary path-reference maintenance.

## 3. File-by-file inventory

### 3.1 Identity, purpose, scope, and status

| Current path | Title | Author / proposal origin | Intended purpose | Actual content scope | Status category | Still active? |
|---|---|---|---|---|---|---|
| `Draft/filip-contract.md` | Task 2 contract planning audit | Independent Codex/Filip proposal lineage | Audit the proposed Task 2 contracts and identify a minimum first iteration | Assignment summary, repository/fixture evidence ledger, architecture risks, proposed boundaries, measurement concerns, questions, and a plan outline | Superseded | No; historical input to the revision chain |
| `Draft/filip-contract-v2.md` | Filip's Task 2 contract, version 2 | Independent Filip/Codex proposal lineage | Replace the audit with a concrete broad contract candidate | Four large boundaries spanning ZIP handling, COLMAP codec, pose-refinement port, experimental measurement/report schema, failures, tests, and later work | Superseded | No for Iteration 1A; broader ideas remain historical/exploratory evidence |
| `Draft/filip-contract-1a.md` | Filip's Task 2 Iteration 1A contract | Independent Filip/Codex proposal lineage | Define only the Goal 1A recorder-ZIP/COLMAP reader-writer contract and demo | Detailed normative 1A ZIP adapter, codec, typed model, pose conventions, errors, demo, tests, fixture replay, and external compatibility smoke; later work is informational | Current proposal | Yes; current Filip proposal for 1A |
| `Draft/mingna-contract.md` | Pose Refinement Pipeline: Initial Architecture & Seam Plan | Mingna-led independent proposal; file metadata credits Mingna Sun and Filip Kral | Propose the initial pipeline architecture and seam | Broad reader/writer types, synchronous refine function, measurement interface, edge cases, and PO questions covering more than 1A | Current proposal | Yes; current Mingna-origin proposal and must remain independent from Filip's proposal |
| `reviews/filip-contract-review.md` | Hostile architecture review — Filip's independent Task 2 contract proposal | Independent AI architecture review of `Draft/filip-contract.md` | Challenge the original audit and prescribe minimum corrections | Nineteen findings plus retained/simplified/deferred features, minimum safe candidate, and human questions | Historical | No as a current review; retained as evidence |
| `reviews/filip-contract-review-disposition.md` | Filip Contract Review — Finding Dispositions | Draft disposition in the Filip revision workflow; human acceptance is not evidenced by `OWNER_DECISIONS.md` | Record responses to the nineteen review findings and direct v2 | Marks all findings accepted, defines four intended boundaries, and describes required revisions | Historical | No as a decision record; it remains revision evidence only |
| `reviews/filip-contractv2-review.md` | Review of Filip's Task 2 contract, version 2 | Independent AI review of `Draft/filip-contract-v2.md` | Test whether v2 is ready for comparison and identify remaining blockers | Seventeen findings, especially on the missing callable harness, holdout evidence, metric support, source-build parity, exact preservation, scope, and provenance | Historical | No as the current 1A review; retained as evidence for why v2 was narrowed |
| `reviews/filip-contract-1a-assignment-check.md` | Filip Contract 1A Assignment Check | Independent assignment-conformance check | Identify a specific mismatch in the 1A demo requirement | One major finding: the required demo did not guarantee printing image ID 1 | Superseded | No; the current 1A file explicitly applies the correction |
| `reviews/task2-goal1-requirements.md` | Task 2 Goal 1 requirements traceability matrix | Assignment-derived review; author not stated | Map assignment requirements to 1A-1D, the gate, and post-gate work | Detailed requirement IDs, classifications, deliverables, evidence, dependencies, and gate distinctions | Current review | Yes as a traceability aid; not authoritative over the assignment |
| `reviews/task2-goal1a-technical-comparison.md` | Task 2 Goal 1A Technical Comparison | Team 6 comparison draft; author not stated | Compare only overlapping 1A content in Filip and Mingna proposals | Assignment baseline, proposal extraction, coverage matrix, material conflicts, merge candidates, and sufficiency verdict | Current comparison | Yes until the Simon call is concluded and recorded |
| `reviews/task2-goal1a-owner.md` | Goal 1A Decision Brief | Team 6 call-preparation brief; author not stated | Present the 1A comparison and recommended decisions to Simon | Concise shared conclusions, differences, combined recommendation, Team 6 decisions, Simon decisions, and proposed call outcome | Current review | Yes as pre-call material only |
| `reviews/task2-review-comparison.md` | Task 2 contracts comparison | Initial Team 6 comparison template | Compare the original Codex and Gemini/Mingna drafts | Empty table and empty headings; no actual analysis or conclusion | Superseded | No; superseded by the populated Goal 1A technical comparison |

### 3.2 Lineage, overlap, contradictions, and recommended treatment

| Current path | Supersedes | Superseded by | Main overlap | Contradictions or mismatches with newer documents | Recommendation |
|---|---|---|---|---|---|
| `Draft/filip-contract.md` | None | Explicitly replaced by `Draft/filip-contract-v2.md`; its 1A role is later replaced by `Draft/filip-contract-1a.md` | Same recorder ZIP, codec, refinement, and measurement topics as later Filip drafts | Its claim that fixture/result mapping was missing and its strong sparse-write atomicity wording were corrected by the review/v2 chain; it is an audit despite a contract-like filename | Archive and rename as an audit; add a Superseded banner |
| `Draft/filip-contract-v2.md` | `Draft/filip-contract.md` | Functionally superseded for 1A by `Draft/filip-contract-1a.md`; no later broad contract replaces every section | Repeats and expands the ZIP/codec core later retained in 1A; overlaps 1B/1C/Goal 2 concerns | Newer review says its experiment schema is not a callable harness, its source-build work is improperly optional, exact preservation is too tolerant, and its filename restriction is unsupported; 1A removes or revises those points | Archive as a broad historical candidate; add a Superseded banner |
| `Draft/filip-contract-1a.md` | Replaces the 1A portion of v2 and incorporates the image-ID-1 check | None | Overlaps Mingna only on 1A reader/writer content; overlaps the requirements matrix on 1A obligations | It explicitly records an unresolved staging conflict: the assignment traceability matrix says the first plan should include early `refine` and harness interfaces, while this bounded proposal intentionally defines only the 1A seam | Remain in `Draft/`; standardize its Current proposal banner; do not merge with Mingna |
| `Draft/mingna-contract.md` | None | None | Broadly overlaps all three seams in the original Filip/v2 proposals; only its reader/writer portion is compared in the current 1A comparison | Newer comparison identifies unresolved/direct conflicts: ZIP versus directory public boundary, optional versus mandatory preservation source, fixed 10-decimal output versus round-trip-safe output, thrown exceptions versus typed outcomes, broad camera registry versus strict 1A subset, and synchronous refine versus later async needs | Remain in `Draft/` as a separate Current proposal; add a banner clarifying origin and non-authoritative status |
| `reviews/filip-contract-review.md` | None | Its open findings are dispositioned by `reviews/filip-contract-review-disposition.md`; v2 is the response artifact | Overlaps the disposition and v2 review as part of one review chain | Its recommendation to treat unsupported rendering/metrics as an acceptable closed state is later qualified by the requirements matrix, which says rendering and PSNR/SSIM remain assignment obligations rather than silently waived work | Archive; retain findings as evidence; add a Historical banner |
| `reviews/filip-contract-review-disposition.md` | Closes the original review as a draft revision tracker | `Draft/filip-contract-v2.md` records the implemented response; 1A later narrows it | Repeats all nineteen findings and prescribes v2 changes | It says all findings are “accepted” while its own status is Draft and no accepted decision record exists. It also treats quantitative rendering work as experimental/deferred, whereas the newer requirements matrix keeps it mandatory Goal 1 work | Archive; add a Historical banner explicitly denying decision-record status |
| `reviews/filip-contractv2-review.md` | None | No complete superseder; `Draft/filip-contract-1a.md` responds to the 1A subset and defers later concerns | Overlaps v2 and the 1A redesign rationale | No newer document invalidates its evidence; 1A intentionally does not resolve its later measurement-harness findings because those are outside 1A | Archive with the v2 lineage; add a Historical banner |
| `reviews/filip-contract-1a-assignment-check.md` | None | Corrected by the final section and acceptance criterion in `Draft/filip-contract-1a.md` | Narrow overlap with the 1A summary/demo contract | The finding is no longer true of the current 1A proposal because the demo now explicitly requests image ID 1 | Archive as a resolved check; add a Superseded banner |
| `reviews/task2-goal1-requirements.md` | None; it must not be said to supersede the assignment | None | Provides the baseline used by the 1A comparison and brief; overlaps every proposal on stated obligations | It conflicts with older v2/disposition language that made the source build optional or treated unavailable exact rendering as sufficient deferral. The assignment, not this matrix, resolves any dispute | Remain in `reviews/`; add a Current review banner that states it is secondary |
| `reviews/task2-goal1a-technical-comparison.md` | Functionally replaces the unfilled `reviews/task2-review-comparison.md` for the active 1A comparison | Expected to become historical after the Simon call; no current superseder | Substantial deliberate overlap with the Simon brief; detailed evidence versus executive decision presentation | Its merge candidates and verdicts are advisory. They do not override either independent proposal or become accepted without human review | Remain through the call, then archive; add a Current comparison banner now |
| `reviews/task2-goal1a-owner.md` | Does not supersede the technical comparison; summarizes it | Expected to be superseded by a recorded Simon decision and any accepted plan | Repeats the technical comparison's shared conclusions and recommendations in shorter form | “Team 6 technical decisions” and “Proposed call outcome” could be mistaken for accepted decisions. Its recommendation to delay later Goal 1 work until 1A passes is a proposed sequencing rule, not an assignment-recorded per-package gate | Remain through the call, then archive; add a Current review banner now |
| `reviews/task2-review-comparison.md` | None | `reviews/task2-goal1a-technical-comparison.md` | Duplicates the intended purpose of the later comparison but contains no content | References the misspelled, missing `Draft/migna-contract.md`; its scope uses original drafts rather than the current 1A comparison pair | Archive and rename as a template; add a Superseded banner |

## 4. Duplicate and overlapping documents

### Duplicate documents

No two in-scope files are content duplicates.

The only functional duplicate is `reviews/task2-review-comparison.md`: it is an empty predecessor for the populated `reviews/task2-goal1a-technical-comparison.md`. It should be retained as a historical template, not completed or merged retroactively.

### Overlapping purposes

| Documents | Relationship | Curatorial treatment |
|---|---|---|
| `Draft/filip-contract.md`, `Draft/filip-contract-v2.md`, `Draft/filip-contract-1a.md` | Revision lineage: audit → broad contract → bounded 1A contract | Keep the latest 1A proposal active; archive the first two with explicit lineage banners |
| `reviews/filip-contract-review.md`, `reviews/filip-contract-review-disposition.md`, `reviews/filip-contractv2-review.md`, `reviews/filip-contract-1a-assignment-check.md` | Review and correction evidence attached to the Filip lineage | Archive together but do not combine; each records a different stage and remains evidence |
| `Draft/filip-contract-1a.md`, `Draft/mingna-contract.md` | Independent proposals with overlapping 1A seam content | Keep separate; compare through a review document only |
| `reviews/task2-goal1a-technical-comparison.md`, `reviews/task2-goal1a-owner.md` | Detailed comparison and concise decision brief | Retain both until the call; archive both after outcomes are recorded |
| `reviews/task2-goal1-requirements.md`, all proposals/reviews | Requirements traceability versus proposed interpretation | Keep the matrix as navigation/evidence, but always link back to the assignment as authoritative |

## 5. Filenames that no longer match scope

- `Draft/filip-contract.md` is titled and written as an audit, not a contract. Proposed archive name: `archive/task2-filip-contract-audit.md`.
- `Draft/filip-contract-v2.md` is a broad multi-work-package architecture candidate rather than simply a second version of the current 1A contract. Proposed archive name: `archive/task2-filip-broad-contract-v2.md`.
- `reviews/filip-contractv2-review.md` is missing the separator used elsewhere and does not show that v2 was broad. Proposed archive name: `archive/task2-filip-broad-contract-v2-review.md`.
- `reviews/task2-review-comparison.md` is an empty template, not a completed comparison. Proposed archive name: `archive/task2-contracts-comparison-template.md`.
- `Draft/mingna-contract.md` is broad rather than 1A-specific, but its filename is still adequate and preserves proposal origin. Renaming it now would add churn without resolving ambiguity; clarify scope in its banner and index instead.

## 6. Exploratory reviews versus accepted material

The following are exploratory/advisory rather than accepted decisions:

- both architecture reviews of Filip's drafts;
- the draft finding disposition, despite its use of “accepted” for review findings;
- the 1A assignment check;
- the requirements traceability matrix;
- the Goal 1A technical comparison;
- the Simon decision brief and its proposed call outcome.

No AI review is authoritative. Reviews remain evidence even when later documents reject, narrow, or resolve their recommendations. Only the Team 6 assignment is the requirement source, and only `OWNER_DECISIONS.md` may record accepted Simon decisions. Because that file is absent, this inventory identifies no accepted Task 2 decision.

## 7. Current documents missing clear status information

The following files have no explicit status line or banner: `Draft/mingna-contract.md`, `reviews/filip-contract-review.md`, `reviews/filip-contractv2-review.md`, `reviews/filip-contract-1a-assignment-check.md`, `reviews/task2-goal1-requirements.md`, `reviews/task2-goal1a-technical-comparison.md`, `reviews/task2-goal1a-owner.md`, and `reviews/task2-review-comparison.md`.

`Draft/filip-contract.md`, `Draft/filip-contract-v2.md`, `Draft/filip-contract-1a.md`, and `reviews/filip-contract-review-disposition.md` contain status text, but standardized banners would make their authority and lineage much clearer.

## 8. Broken, stale, or missing references

| Source | Current reference | Problem | Recommended handling |
|---|---|---|---|
| `AGENTS.md` | `Draft/task2-contracts-plan.md` | Missing; `plans/` has no Markdown plan | Change only in a separate governance update after a real accepted plan exists; the index must say “none” now |
| `AGENTS.md` | `Draft/migna-contract.md` | Misspelled and missing; actual file is `Draft/mingna-contract.md` | Correct in a separate governance update |
| `AGENTS.md` | `reviews/task2-contracts-comparison.md` | Missing; current populated comparison is `reviews/task2-goal1a-technical-comparison.md` | Correct in a separate governance update, or point to `TASK2_DOCUMENTS.md` instead |
| `AGENTS.md`, `Draft/filip-contract-v2.md` | `OWNER_DECISIONS.md` | Expected accepted-decision record is absent | Do not create or infer it in this task; expose the gap in the index |
| `reviews/task2-review-comparison.md` | `Draft/migna-contract.md` | Misspelled and missing | Preserve the historical body; explain the stale reference in its banner/index rather than silently completing the template |
| `Draft/filip-contract.md` | `task1-review.md`, `colmap-serializers.ts.md` | Historical evidence references are not present at those paths in this checkout | Keep as historical context; do not repair by guessing paths in this inventory |

The current comparison and brief also lack direct navigation links back to both current proposals and the traceability matrix. This is not a broken reference, but it reinforces the need for `TASK2_DOCUMENTS.md`.

## 9. Documents to archive after the Simon call

Immediately archive the already superseded Filip revision chain and the empty comparison template; they do not need to wait for the call.

After the Simon call, archive these two meeting artifacts once the outcome is recorded in `OWNER_DECISIONS.md`:

- `reviews/task2-goal1a-technical-comparison.md`;
- `reviews/task2-goal1a-owner.md`.

Keep both independent proposals in `Draft/` until the call outcome is recorded and an accepted current plan actually exists. At that point, archive each proposal separately; do not merge them or rewrite them to match the accepted result. If the call does not produce an accepted result, they remain current proposals.

Keep `reviews/task2-goal1-requirements.md` active after the call unless the assignment changes or a newer verified traceability matrix explicitly supersedes it.

## 10. Proposed target directory structure

Use the existing folders and add only one flat `archive/` folder:

```text
AGENTS.md
OWNER_DECISIONS.md                 # accepted human decisions only; currently missing
TASK2_DOCUMENTS.md                 # proposed navigation index

Draft/
  filip-contract-1a.md             # current independent Filip proposal
  mingna-contract.md               # current independent Mingna proposal

reviews/
  task2-goal1-requirements.md      # current secondary traceability review
  task2-goal1a-technical-comparison.md
  task2-goal1a-owner.md

plans/
  task2-contracts-plan.md           # only after Team 6 accepts an official plan; none now

archive/
  task2-filip-contract-audit.md
  task2-filip-contract-audit-review.md
  task2-filip-contract-audit-review-disposition.md
  task2-filip-broad-contract-v2.md
  task2-filip-broad-contract-v2-review.md
  task2-filip-contract-1a-assignment-check.md
  task2-contracts-comparison-template.md
  # post-call copies remain separate:
  task2-goal1a-technical-comparison.md
  task2-goal1a-owner.md
  task2-filip-contract-1a.md
  task2-mingna-contract.md
```

The entries marked post-call are conditional. They should appear in `archive/` only after decisions are recorded and, for proposal files, an accepted plan exists.

## 11. Proposed moves and renames

No move or rename is performed by this inventory.

| Current path | Proposed path | Reason | Reference updates needed |
|---|---|---|---|
| `Draft/filip-contract.md` | `archive/task2-filip-contract-audit.md` | Superseded audit whose filename currently overstates contract status | Update references in the archived original review, disposition, v2, and `TASK2_DOCUMENTS.md` |
| `reviews/filip-contract-review.md` | `archive/task2-filip-contract-audit-review.md` | Review applies only to the superseded audit | Update the disposition's review reference and the index |
| `reviews/filip-contract-review-disposition.md` | `archive/task2-filip-contract-audit-review-disposition.md` | Draft revision tracker, not an accepted decision record | Update the v2 revision-history reference and the index |
| `Draft/filip-contract-v2.md` | `archive/task2-filip-broad-contract-v2.md` | Superseded for 1A and broader than its generic version name suggests | Update references in the 1A draft, v2 review, disposition, and index |
| `reviews/filip-contractv2-review.md` | `archive/task2-filip-broad-contract-v2-review.md` | Historical review of the broad v2 candidate; fixes filename separator | Update the index; retain its body conclusions unchanged |
| `reviews/filip-contract-1a-assignment-check.md` | `archive/task2-filip-contract-1a-assignment-check.md` | Single finding has been applied in the current 1A proposal | Update the index only |
| `reviews/task2-review-comparison.md` | `archive/task2-contracts-comparison-template.md` | Empty stale template, not a comparison result | Update the index; preserve its stale body reference as historical evidence |
| `reviews/task2-goal1a-technical-comparison.md` | `archive/task2-goal1a-technical-comparison.md` | Post-call historical comparison evidence | After the call, update `TASK2_DOCUMENTS.md` and any plan/decision references |
| `reviews/task2-goal1a-owner.md` | `archive/task2-goal1a-owner.md` | Post-call meeting-preparation artifact | After the call, update `TASK2_DOCUMENTS.md` and link the accepted outcome from `OWNER_DECISIONS.md` |
| `Draft/filip-contract-1a.md` | `archive/task2-filip-contract-1a.md` | Conditional: proposal becomes historical only after an accepted plan exists | Update the technical comparison, brief, accepted plan, and index; keep separate from Mingna |
| `Draft/mingna-contract.md` | `archive/task2-mingna-contract.md` | Conditional: proposal becomes historical only after an accepted plan exists | Update `AGENTS.md`, the technical comparison, brief, accepted plan, and index; keep separate from Filip |

## 12. Exact proposed status banners

Place each banner immediately below the document title. These are navigation metadata, not rewrites of historical conclusions.

### Drafts

`Draft/filip-contract.md`:

> **Status: Superseded.** Independent Filip audit retained for history. It was replaced by the broad v2 candidate and later by the bounded Iteration 1A proposal for reader/writer scope. It is not an official plan or accepted decision record.

`Draft/filip-contract-v2.md`:

> **Status: Superseded.** Independent broad Filip contract candidate retained for history. Its Iteration 1A scope was replaced by `Draft/filip-contract-1a.md`; its later-stage sections were not accepted as an official plan.

`Draft/filip-contract-1a.md`:

> **Status: Current proposal.** Independent Filip candidate for Task 2 Iteration 1A. It is not merged with Mingna's proposal, is not an official plan, and records no Product Owner decision.

`Draft/mingna-contract.md`:

> **Status: Current proposal.** Independent Mingna-led Task 2 architecture candidate; the file credits Mingna Sun and Filip Kral. It remains separate from Filip's proposal lineage and is not an official plan or accepted decision record.

### Reviews

`reviews/filip-contract-review.md`:

> **Status: Historical.** Advisory AI review of the superseded Filip audit. Its findings remain evidence but are not requirements, accepted decisions, or an official plan.

`reviews/filip-contract-review-disposition.md`:

> **Status: Historical.** Draft finding disposition used to prepare the broad v2 candidate. “Accepted” refers to the revision workflow, not to Product Owner approval; this is not `OWNER_DECISIONS.md`.

`reviews/filip-contractv2-review.md`:

> **Status: Historical.** Advisory AI review of the superseded broad v2 candidate. Its findings remain evidence; the bounded Iteration 1A proposal addresses only the 1A subset.

`reviews/filip-contract-1a-assignment-check.md`:

> **Status: Superseded.** The image-ID-1 demo finding was applied to the current `Draft/filip-contract-1a.md`. This check is retained as correction evidence.

`reviews/task2-goal1-requirements.md`:

> **Status: Current review.** Assignment-derived traceability aid. The Team 6 assignment remains the authoritative requirement source; this matrix is not a requirement source or accepted decision record.

`reviews/task2-goal1a-technical-comparison.md`:

> **Status: Current comparison.** Advisory comparison of the independent Iteration 1A proposal content. Merge candidates and verdicts are recommendations only until Team 6 and Simon record decisions.

`reviews/task2-goal1a-owner.md`:

> **Status: Current review.** Pre-call decision brief for Simon. “Team 6 technical decisions” and the proposed call outcome are proposals, not accepted decisions, until recorded in `OWNER_DECISIONS.md`.

`reviews/task2-review-comparison.md`:

> **Status: Superseded.** Unfilled historical comparison template. The populated Goal 1A comparison is `reviews/task2-goal1a-technical-comparison.md`; this file must not be treated as a completed review.

### Exact post-call replacement banners

Apply these only after the call outcome is recorded.

For the archived technical comparison:

> **Status: Historical.** Pre-call technical comparison retained as evidence. Accepted outcomes, if any, are recorded separately in `OWNER_DECISIONS.md`; this file is not authoritative.

For the archived Simon brief:

> **Status: Historical.** Pre-call decision brief retained as evidence. Proposed outcomes were not silently converted into decisions; consult `OWNER_DECISIONS.md` for the recorded call outcome.

For each archived independent proposal after an accepted plan exists:

> **Status: Historical.** Independent proposal retained unchanged as design evidence after the Simon call. It is not the accepted plan; consult `OWNER_DECISIONS.md` and the current file under `plans/`.

## 13. Proposed content for root `TASK2_DOCUMENTS.md`

The following is proposed content only. This inventory does not create the root file.

```markdown
# Task 2 documents

> **Status:** Navigation index only. This file does not define requirements, record decisions, or replace the official plan.

## Requirement sources

- **Team 6 SoftwareLab assignment PDF** — authoritative Task 2 requirement source. Its repository path is not available in the current checkout.
- `AGENTS.md` — repository workflow, source precedence, safety, and document-location guidance; not a substitute for the assignment.
- `reviews/task2-goal1-requirements.md` — current secondary traceability review derived from the assignment; use it for navigation, then verify disputed wording against the assignment.

## Current proposals

- `Draft/filip-contract-1a.md` — independent Filip proposal for Iteration 1A.
- `Draft/mingna-contract.md` — independent Mingna-led broader architecture proposal.

These proposals remain separate. Neither is an official plan or accepted decision record.

## Current comparisons and call material

- `reviews/task2-goal1a-technical-comparison.md` — detailed current comparison of overlapping 1A content.
- `reviews/task2-goal1a-owner.md` — concise pre-call decision brief.

Recommendations in these files are advisory until accepted outcomes are recorded.

## Accepted decisions

- `OWNER_DECISIONS.md` — the only Task 2 accepted-decision record. **This file is currently missing from the checkout.** Do not infer accepted decisions from proposals, dispositions, comparisons, or call briefs.

## Official plans

- **None currently present.** The `plans/` directory contains no Task 2 Markdown plan.
- When Team 6 accepts a plan, place the current plan under `plans/` and link it here. Do not promote a proposal by renaming it without the review and decision workflow.

## Historical drafts and reviews

- `archive/task2-filip-contract-audit.md`
- `archive/task2-filip-contract-audit-review.md`
- `archive/task2-filip-contract-audit-review-disposition.md`
- `archive/task2-filip-broad-contract-v2.md`
- `archive/task2-filip-broad-contract-v2-review.md`
- `archive/task2-filip-contract-1a-assignment-check.md`
- `archive/task2-contracts-comparison-template.md`

Post-call comparisons, briefs, and independent proposals belong in `archive/` only after their outcomes are recorded and, for proposals, an accepted current plan exists. Historical reviews remain evidence even where recommendations were rejected.

## Recommended reading order

1. Read the Team 6 assignment PDF for requirements.
2. Read `OWNER_DECISIONS.md` for accepted human decisions, when the file exists.
3. Use `reviews/task2-goal1-requirements.md` as a traceability map, not as authority.
4. Read `Draft/filip-contract-1a.md` and `Draft/mingna-contract.md` independently.
5. Read `reviews/task2-goal1a-technical-comparison.md` for the detailed comparison.
6. Read `reviews/task2-goal1a-owner.md` for the call agenda and proposed outcomes.
7. Read the current file under `plans/` only after Team 6 has accepted one.
8. Consult `archive/` only for provenance, rejected alternatives, and review history.
```

## 14. Conservative implementation order for a later curation task

1. Add banners without changing body conclusions.
2. Create `TASK2_DOCUMENTS.md` and fix live navigation.
3. Create the flat `archive/` folder and move only already superseded files.
4. Keep both independent proposals separate through the Simon call.
5. Record accepted call outcomes only in `OWNER_DECISIONS.md` through a separately authorized task.
6. Create or move an official plan into `plans/` only after Team 6 acceptance.
7. Archive call material and proposals only after the index, decision record, and accepted plan point to their replacements.

This order avoids broken navigation and prevents historical proposals or AI reviews from being mistaken for authoritative material.
