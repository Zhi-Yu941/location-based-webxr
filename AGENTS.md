# Team 6 — Codex Instructions

## Project

SoftwareLab project: Reality Reconstruction via Gaussian Splats.

Current stage: Task 2 planning and contract definition.

## Source precedence

When information conflicts, use:

1. SoftwareLab assignment document
2. Decisions explicitly confirmed by Simon, the Product Owner
3. Verified repository and tool behavior
4. Reviewed and accepted Team 6 plan
5. Task 1 evidence
6. Research notes
7. AI drafts and chat output

Report contradictions instead of silently resolving them.

## Current boundaries

For the first Task 2 iteration:

- Treat the recorder ZIP as the external contract.
- Do not modify existing recorder or exporter code.
- Focus first on `sparse/0/` and `images/`.
- Keep the proposed reader/writer, refinement transform and measurement harness independent.
- Keep `points3D` and camera intrinsics unchanged unless the reviewed plan later decides otherwise.
- Do not assume that LichtFeld pose optimization exists without evidence.

## Current task isolation

While producing the independent Codex contracts draft:

- Do not read the Gemini contracts draft.
- Do not read an existing comparison review.
- Do not modify the official plan.
- Write only to `Draft/filip-contract.md`.
- Repository and assignment evidence may be inspected as needed.


## AI Usage

### Purpose

AI is used as a planning, review, research, prototyping and debugging assistant.

AI output is treated as a draft and must be reviewed by the team before it becomes part of the official project plan or production code.

### Rules

- Plan before implementation.
- Keep independent AI drafts separate.
- Do not blindly copy generated production code.
- Verify technical claims using the assignment, repository or experiments.
- Record important decisions outside the AI chat.
- Review generated code and tests before committing.
- The team must be able to explain every accepted decision.
- AI does not make final Product Owner decisions.

### Workflow

1. Filip and Mingna define the task.
2. Gemini and Codex may produce independent drafts.
3. The drafts are compared.
4. The team accepts, combines or rejects proposals.
5. Important decisions are recorded in `OWNER_DECISIONS.md`.
6. The accepted result becomes the official plan.
7. Implementation is tested and reviewed separately.



## Repository safety

- Make the smallest coherent change.
- Do not touch unrelated recorder functionality.
- Do not commit or push unless explicitly requested.
- Do not add production dependencies without explaining why.
- Do not modify generated files manually.

## Current planning output

Official plan:

`Draft/task2-contracts-plan.md`

Independent Codex draft:

`Draft/filip-contract.md`

Independent Gemini draft:

`Draft/migna-contract.md`

Comparison review:

`reviews/task2-contracts-comparison.md`