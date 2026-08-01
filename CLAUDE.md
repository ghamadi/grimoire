# grimoire

Skill management and distribution CLI. [ARCHITECTURE.md](./ARCHITECTURE.md) specifies the behavior — read the relevant
section before implementing.

Verify: `pnpm typecheck && pnpm lint && pnpm test`

## Project Management

See @CLAUDE.local.md

## Conventions

- Relative imports take an explicit `.ts`; subpath imports (e.g., `#src/*`) take none — package.json's `imports` map supplies
  it. Always prefer subpath imports over relative imports. The editor emits both correctly; if a specifier comes out wrong,
  fix `.vscode/settings.json`.
- When a module exposes a public barrel file, it's the module's public surface — don't import past it.
- Tests: module-local in `src/<module>/tests/`, cross-cutting in `tests/`.
- Prefer named parameters over positional ones in most cases unless there's a good reason not to.
- Enforce preconditions in code, not prose. A function relying on a precondition of the input at runtime (e.g., normalized
  paths) should either apply the condition itself or validate the input and fail loudly.
- Use section banners to group related code when the file contains multiple sections.

### Comments

- Code is self-explanatory until proven otherwise; the burden of proof is on the comment. Keep one only if you can name the
  wrong conclusion a reader draws without it.
- Never explain why the code isn't buggy. Behavioral subtleties go in a test name.
- Rejected alternatives earn a comment **only** when they might seem more intuitive, and a reader would otherwise "fix" the
  code back.
