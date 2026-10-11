# On-disk layout

```
~/.grimoire/
├── skills/<skill>/SKILL.md   # the store — flat, one directory per skill
├── .trash/                   # store copies `skills remove` moves aside, a timestamped bin per removal; `trash empty` clears it
├── .backup/                  # reserved; nothing writes to it yet
└── state.json                # everything grimoire persists
```

## `state.json`

```
state.json {
  workspaces: { <name>: { path, autoLink } },
  repos:      { <name>: { path } },
  skills:     { <skill>: { clones: [ { workspace } | { path } ] } },
  ignore:     [ ".DS_Store" ]
}
```

`state.json` is yours to hand-edit or manage through commands. It is **last-known-intent, not truth** — the filesystem is
truth.
