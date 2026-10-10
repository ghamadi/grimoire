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
  │
  └────────export──────►  repos
                          (a git checkout of your skills library, ...)
```

- **link** symlinks the store's copy into a workspace, so edits show up immediately.
- **clone** copies it, for a workspace that cannot use a link — a project's checked-in `.claude/skills/`, for one. The copy
  does not follow the store; edits on either side stay where they were made.
- **export** copies it into a registered repo, replacing what is there unless git reports uncommitted changes. History and
  sharing are git's from there.

See [Repos](#repos) for where version-controlled skill libraries fit.

## Design

### The rule: grimoire never loses content outside its store

Outside `~/.grimoire/`, grimoire writes only three things: copies, its own symlinks, and a `.grimoire-staging/` directory —
inside a workspace while a clone is being written, or inside a repo while an export is — removed once it is empty. It removes
only four: its own symlinks; a directory the store is proven to already hold in full, not counting a `.DS_Store` written by
Finder; a skill directory at a clone destination when `clone --overwrite` is passed, once the store copy has replaced it; and
the entry at `<repo path>/<skill>` on `export`, when git reports nothing uncommitted there or `--force` is passed. Anything
else you put in a workspace or a repo stays exactly as you left it.

Two of those delete content grimoire cannot prove it holds. `clone --overwrite` does, and only on that explicit flag.
`export` does too: replacing a repo entry is safe only for what git has committed, so ignored files under that entry and
`--force` are the two places an export can lose content.

That is why `unclone` and `skills remove --forget-clones` forget records and leave directories, why a plain `clone` adopts a
directory it finds rather than replacing it, and why even `--overwrite` declines a directory that is neither a recorded clone
nor a skill.

### Code layout

The code is organized DDD-flavored, in layers that only call downward:

```
commands → use-cases → domains → lib
```

- **`commands/`** is argv in, stdout out. A command's job is parsing arguments, calling a use case, and formatting the result
  — no domain logic lives here.
- **`use-cases/`** has one file per user-facing action (`add-workspace`, `link-skill`, ...), orchestrating domain objects to
  perform it. Rules that cross domain boundaries live here, not in a domain.
- **`domains/`** holds the entities and services that model the problem — `grimoire-store`, `workspace`, `repo`, `skill` —
  each behind a barrel `index.ts` that is its only public surface.
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
  repos:      { <name>: { path } },
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
| `repos add/remove/list`      | [`docs/commands/repos.md`](./docs/commands/repos.md)           |
| `export`                     | [`docs/commands/export.md`](./docs/commands/export.md)         |
| `skills add/list/remove`     | [`docs/commands/skills.md`](./docs/commands/skills.md)         |
| `link`                       | no page yet                                                    |
| `unlink`                     | [`docs/commands/unlink.md`](./docs/commands/unlink.md)         |
| `clone`                      | [`docs/commands/clone.md`](./docs/commands/clone.md)           |
| `unclone`                    | [`docs/commands/unclone.md`](./docs/commands/unclone.md)       |
| `status`                     | [`docs/commands/status.md`](./docs/commands/status.md)         |

`docs/commands/` is the contract for command behavior — this document does not repeat it.

## Repos

A **repo** is a registered directory inside a git work tree that store skills are exported into. Once a skill is there,
history, review, and sharing belong to git and to you. The store only ever holds current state, and grimoire records nothing
about what it exported.

grimoire runs git read-only: it asks questions (`rev-parse`, `status`) and never runs anything that writes. Committing,
pushing, and everything after are yours.

There is no import: skills go from the store to a repo, never back. grimoire still ships no skills of its own, and a repo,
like a workspace, is always registered by hand.
