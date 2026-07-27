# eslint.config.mjs

## Purpose

ESLint flat config for the landing page. Mirrors the AppFramework /
RecorderApp / AnchorStarter configs so every package in the repo shares one
lint contract: type-aware TypeScript rules, Vitest-aware overrides for test
files, and a Prettier-compatibility layer.

## Key rules

- `eslint.configs.recommended` + `typescript-eslint` recommended +
  `recommendedTypeChecked` (type-aware) on all `*.ts` sources.
- `no-restricted-imports`: the landing is deliberately dependency-light
  (three.js + anime.js only) and must never import `gps-plus-slam-js` OR
  `gps-plus-slam-app-framework` — it is a marketing surface, not an app;
  app logic belongs in the demo apps it links to.
- `@typescript-eslint/consistent-type-imports`, `return-await` (in-try-catch),
  `no-shadow` (TS variant), `no-console` (warn), `complexity`/`max-depth` warns.
- Test files (`*.test.ts` / `*.spec.ts` / `*.property.test.ts`) relax the
  unsafe-assignment / unbound-method / no-shadow / no-console rules that fire on
  standard Vitest patterns.

## Invariants & assumptions

- Type-aware linting reads `../tsconfig.eslint.json` (src + config + tests).
- `vite.config.ts` / `vitest.config.ts` are ignored: root `.ts` files
  intentionally kept outside the type-aware project.

## Usage

```bash
pnpm run lint        # eslint . --config config/eslint.config.mjs
```

## Tests

No unit test; exercised by the `lint` gate inside `pnpm test`.
