# grimoire

Skill management and distribution CLI. [ARCHITECTURE.md](./ARCHITECTURE.md) specifies the behavior —
read the relevant section before implementing.

Verify: `pnpm typecheck && pnpm lint && pnpm test`

## Conventions

- Relative imports take an explicit `.ts`; subpath imports (e.g., `#src/*`) take none —
  package.json's `imports` map supplies it. Always prefer subpath imports over relative imports.
  The editor emits both correctly; if a specifier comes out wrong, fix `.vscode/settings.json`.
- When a module exposes a public barrel file, it's the module's public surface — don't import past it.
- Tests: module-local in `src/<module>/tests/`, cross-cutting in `tests/`.
- Code should be self-explanatory; comments explain why, not what.
