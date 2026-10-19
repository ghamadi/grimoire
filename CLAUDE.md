# grimoire

Skill management and distribution CLI. Command behavior is specified in [`docs/commands/`](./docs/commands/); anything not
committed there is undecided — don't infer its design from git history or old docs. [`docs/safety.md`](./docs/safety.md)
holds the rule every command keeps outside the store, [`docs/conventions.md`](./docs/conventions.md) the behavior commands
share, and [`docs/state.md`](./docs/state.md) the `~/.grimoire/` shape and what makes `state.json` valid.

Verify: `pnpm typecheck && pnpm lint && pnpm test`

CI also runs `pnpm format:check`, on macOS and Linux across the supported Node versions. `main` takes pull requests only
(direct pushes are rejected), so changes land as a squash-merged pull request from a branch.

## Code layout

DDD-flavored, in layers that only call downward:

```
commands → use-cases → domains → lib
```

- **`commands/`** is argv in, stdout out: parse arguments, run the action, format the result. No domain logic lives here.
- **`use-cases/`** exist only for actions that orchestrate domain objects. Rules that cross domain boundaries live here, not
  in a domain. Any other command calls a manager or `lib/` itself.
- **`domains/`** holds the entities and services that model the problem — `grimoire-store`, `workspace`, `repo`, `skill` —
  each behind a barrel `index.ts` that is its only public surface.
- **`lib/`** is dependency-free, reusable primitives (path comparison, atomic file writes, error types) with no knowledge of
  grimoire's domain.

## Project Management

See @CLAUDE.local.md

## Conventions

- Import through the tsconfig `paths` aliases — `@/*` for `src/`, `@test-helpers/*` for `tests/helpers/`, `@package.json` —
  never a relative path. Specifiers take no extension, and a barrel is imported by its folder path (`@/commands/status`),
  never by `/index`. If the editor emits a wrong specifier, fix `.vscode/settings.json`.
- When a module exposes a public barrel file, it's the module's public surface — don't import past it.
- A command that outgrows one file becomes `commands/<name>/index.ts` plus `commands/<name>/helpers/`. Code outside the
  folder imports only `index.ts`, and anything it needs is re-exported there.
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

Code is self-explanatory until proven otherwise. A comment stays only if you can name the wrong conclusion a reader might
draw without it. This test applies to every comment, doc comments included, and to each sentence within one. This test also
applies to comments a plan suggests in its instructions.

These fail the test:

- Restating the name, signature or body, even of code elsewhere (an interface member describing its implementation).
- Explaining why a caller uses the code; that belongs at the call site.
- A summary sentence in front of a "why" that passes.
- Being public API, or matching nearby comment density.
- A rejected alternative no reader would find more intuitive.

Pre-existing comments do not exempt new ones from the test.

Reread each comment you add and apply the test before finishing.

### Docs

- `docs/commands/` is the spec. Cut an observable behavior only when an example or another sentence still states it.
- Shared behavior lives in [`docs/conventions.md`](./docs/conventions.md), and `state.json` validity in
  [`docs/state.md`](./docs/state.md). Link to them; don't restate them.
- A "why" stays only when a reader would otherwise think the behavior is arbitrary, or "fix" it back. Never argue that a
  behavior obeys the safety rule.
- Only what a user sees. No function names, internal reason codes or git plumbing.
- Plain words, short sentences. No "X, not Y" reframes, no punchy closing lines, and em-dashes only sparingly.

## Branch review

Supplies what the `branch-review` skill would otherwise look up.

- `BASE_REF` is `origin/main`, after `git fetch origin main`.
- `CHECKS` are `pnpm typecheck`, `pnpm lint` and `pnpm test`, each run on its own. No coverage provider is installed, so map
  tests to code paths by reading.
- A suite is named after the file it covers: `src/<module>/**/<file>.ts` → `src/<module>/tests/<file>.test.ts`.
- A command folder's `index.ts` is covered by `src/commands/tests/<name>.test.ts`.
- A comment that fails the [Comments](#comments) rules is a finding.
