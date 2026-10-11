# grimoire

Skill management and distribution CLI. Command behavior is specified in [`docs/commands/`](./docs/commands/); anything not
committed there is undecided — don't infer its design from git history or old docs. [`docs/safety.md`](./docs/safety.md)
holds the rule every command keeps outside the store, and [`docs/state.md`](./docs/state.md) the `~/.grimoire/` shape.

Verify: `pnpm typecheck && pnpm lint && pnpm test`

## Code layout

DDD-flavored, in layers that only call downward:

```
commands → use-cases → domains → lib
```

- **`commands/`** is argv in, stdout out: parse arguments, call a use case, format the result. No domain logic lives here.
- **`use-cases/`** has one per user-facing action (`add-workspace`, `link-skill`, ...), orchestrating domain objects to
  perform it. Rules that cross domain boundaries live here, not in a domain.
- **`domains/`** holds the entities and services that model the problem — `grimoire-store`, `workspace`, `repo`, `skill` —
  each behind a barrel `index.ts` that is its only public surface.
- **`lib/`** is dependency-free, reusable primitives (path comparison, atomic file writes, error types) with no knowledge of
  grimoire's domain.

## Project Management

See @CLAUDE.local.md

## Conventions

- Import through the tsconfig `paths` aliases — `@/*` for `src/`, `@test-helpers/*` for `tests/helpers/`, `@package.json` —
  never a relative path; lint enforces it. Specifiers take no extension, and a barrel is imported by its explicit `/index`.
  If the editor emits a wrong specifier, fix `.vscode/settings.json`.
- When a module exposes a public barrel file, it's the module's public surface — don't import past it.
- Tests: module-local in `src/<module>/tests/`, cross-cutting in `tests/`.
- Prefer named parameters over positional ones in most cases unless there's a good reason not to.
- Enforce preconditions in code, not prose. A function relying on a precondition of the input at runtime (e.g., normalized
  paths) should either apply the condition itself or validate the input and fail loudly.
- Use section banners to group related code when the file contains multiple sections.
- Command groups are named in the plural: `skills`, `workspaces`.
- A command factory takes its collaborators as named parameters — `storeManager`, plus anything that reads or writes outside
  the process, such as a picker or a clock. `program.ts` supplies the real ones and tests supply fakes; no command reaches
  for `process.stdin` or `new Date()` directly.

### Comments

- Code is self-explanatory until proven otherwise; the burden of proof is on the comment. Keep one only if you can name the
  wrong conclusion a reader draws without it.
- Never explain why the code isn't buggy. Behavioral subtleties go in a test name.
- Rejected alternatives earn a comment **only** when they might seem more intuitive, and a reader would otherwise "fix" the
  code back.

## Branch review

Supplies what the `branch-review` skill would otherwise look up.

- `BASE_REF` is `origin/main`, after `git fetch origin main`.
- `CHECKS` are `pnpm typecheck`, `pnpm lint` and `pnpm test`, each run on its own. No coverage provider is installed, so map
  tests to code paths by reading.
- A suite is named after the file it covers: `src/<module>/**/<file>.ts` → `src/<module>/tests/<file>.test.ts`.
