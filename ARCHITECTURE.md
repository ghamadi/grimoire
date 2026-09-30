# grimoire — architecture

This document holds the problem grimoire solves, the command contract that's actually committed, and the shape the code and
`~/.grimoire/` are built around today. It is not a spec: anything beyond what's listed under _Committed_ is undecided, and
gets designed when it's picked up — not inferred from here.

## The problem

Running more than one agent config directory — different agents, different accounts, or both — means an independent copy of
every skill in each one. Every edit has to be made N times, and the copies drift. Symlinking the whole skills directory fixes
the editing and costs the ability to have a skill in one account and not the other, so whatever solves this has to work **per
skill**.

There's also no version history, and no record of where the copies went.

`grimoire` is a **skill management and distribution** tool: one store you edit, deployed out to the config directories and
projects where agents read it. It is not a discovery or package-manager tool and ships no skills of its own — installers for
other people's skill repos already exist. **They install other people's skills; grimoire maintains your own.**

## Vision

```
store  ──link / clone──►  workspaces
(~/.grimoire/skills)      (~/.claude/skills, a project's .agents/skills, ...)
```

- **link** symlinks the store's copy into a workspace, so edits show up immediately.
- **clone** copies it, for a workspace that needs its own version, expected to drift.

See [Future: repos](#future-repos) for where version-controlled skill libraries fit once this core is built.

## Design

### The rule: grimoire never loses content outside its store

Outside `~/.grimoire/`, grimoire writes only two things: copies, and its own symlinks. It removes only two: its own symlinks,
and a directory the store is proven to already hold in full. Anything else you put in a workspace stays exactly as you left
it.

That is why a clone is never refreshed or overwritten, why `unclone` and `skills remove --forget-clones` forget records and
leave directories, and why `clone` can adopt a directory it finds but never replace one.

### Code layout

The code is organized DDD-flavored, in layers that only call downward:

```
commands → use-cases → domains → lib
```

- **`commands/`** is argv in, stdout out. A command's job is parsing arguments, calling a use case, and formatting the result
  — no domain logic lives here.
- **`use-cases/`** has one file per user-facing action (`add-workspace`, `link-skill`, ...), orchestrating domain objects to
  perform it. Rules that cross domain boundaries live here, not in a domain.
- **`domains/`** holds the entities and services that model the problem — `grimoire-store`, `workspace`, `skill` — each
  behind a barrel `index.ts` that is its only public surface.
- **`lib/`** is dependency-free, reusable primitives (path comparison, atomic file writes, error types) with no knowledge of
  grimoire's domain.

## On-disk layout

```
~/.grimoire/
├── skills/<skill>/SKILL.md   # the store — flat, one directory per skill
├── .trash/                   # store copies `skills remove` moves aside, one timestamped bin per skill per removal
├── .backup/                  # reserved; nothing writes to it yet
└── state.json                # everything grimoire persists
```

```
state.json {
  workspaces: { <name>: { path, autoLink } },
  skills:     { <skill>: { clones: [ { workspace } | { path } ] } },
  ignore:     [ ".DS_Store" ]
}
```

`state.json` is the user's to hand-edit or manage through commands. It is **last-known-intent, not truth** — the filesystem
is truth.

## Committed

| Command                      | Contract                                                       |
| ---------------------------- | -------------------------------------------------------------- |
| `workspaces add/remove/list` | [`docs/commands/workspaces.md`](./docs/commands/workspaces.md) |
| `skills add/list/remove`     | [`docs/commands/skills.md`](./docs/commands/skills.md)         |
| `link`                       | no page yet                                                    |
| `unlink`                     | [`docs/commands/unlink.md`](./docs/commands/unlink.md)         |
| `clone`                      | [`docs/commands/clone.md`](./docs/commands/clone.md)           |
| `unclone`                    | [`docs/commands/unclone.md`](./docs/commands/unclone.md)       |
| `status`                     | [`docs/commands/status.md`](./docs/commands/status.md)         |

`docs/commands/` is the contract for command behavior — this document does not repeat it.

## Future: repos

Once the core — deploying and retiring store skills (`clone`, `unlink`, `remove`, and the rest) — is built, **repos** will
let you register a directory you keep skills in under version control, and exchange skills between it and the store: pull in
updates from a repo you follow, or push skills you create to one you own. That's where history will live; the store only ever
holds current state.

grimoire will still invoke no git itself and will still ship no skills of its own — a repo, like a workspace, is always
registered by hand. Nothing about how repos register, what they exchange, or what commands they add is decided; that gets
designed when this is picked up.
