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

`state.json` is yours to hand-edit or manage through commands. It records what you asked for. Where it disagrees with what is
on disk, the disk is right.

## Names

Workspace and repo names use letters, digits, `-` and `_`, and start with a letter or digit. ASCII only.

```shell
$ grimoire workspaces add a/b ~/.claude/skills
error: workspace name "a/b" must start with a letter or digit and contain only letters, digits, "-" and "_"
```

For a repo, the message reads `repo name` instead.

The rule is checked when a name is registered or renamed, and again on [every load](#load-failures). It is what lets
[`unclone`](./commands/unclone.md) tell a workspace name from a path.

## The path rule

A workspace path may not equal, contain or sit inside `~/.grimoire/` or any repo path. A repo path follows the same rule
against `~/.grimoire/` and workspace paths.

Paths in the same registry are never compared. Two workspaces may share a path, or one may sit inside another, and the same
goes for two repos.

When a path breaks the rule against both the store and an entry in the other registry, the store is named. Among several
entries, the first by name is.

| Relation | Message                    |
| -------- | -------------------------- |
| equals   | `is the same directory as` |
| inside   | `sits inside`              |
| contains | `contains`                 |

```
grimoire store    /Users/me/.grimoire
                  ├─ equals    /Users/me/.grimoire
                  ├─ inside    /Users/me/.grimoire/skills
                  └─ contains  /Users/me
```

Paths are compared with symlinks resolved. A refusal names the path as you typed it.

```shell
$ grimoire workspaces add personal ~/.grimoire/skills
error: /Users/me/.grimoire/skills sits inside the grimoire store (/Users/me/.grimoire)

$ grimoire workspaces add dotfiles ~/dotfiles/skills
error: /Users/me/dotfiles/skills sits inside repo "library" (/Users/me/dotfiles)

$ grimoire repos add library ~/dotfiles
error: /Users/me/dotfiles contains workspace "personal" (/Users/me/dotfiles/skills)
```

`workspaces add` and `repos add` check the rule, and it is checked again on [every load](#load-failures).

The rule exists because `export` writes into a repo's directory, which must not be the store or a workspace.

## Load failures

Every command loads `state.json` first. When it cannot, the command prints an error to stderr, exits 1 and does nothing else.
That includes `repos remove`.

- A `state.json` that is not valid JSON prints `error: <state.json path>: is not valid JSON`.
- A `state.json` that does not match its shape, including a name that breaks [the name rule](#names), is refused with a
  message naming what is wrong.
- A registered path that breaks [the path rule](#the-path-rule) is refused. This can only happen by editing `state.json` by
  hand, or by repointing a symlink after registration. The message names the kind and the entry:
  `workspace "bad" cannot be used: …`, or `repo "bad" cannot be used: …`.

```shell
$ grimoire status
error: workspace "bad" cannot be used: /Users/me/.grimoire/skills sits inside the grimoire store (/Users/me/.grimoire)
  no command can run until it is gone from /Users/me/.grimoire/state.json

$ grimoire status
error: workspace "dotfiles" cannot be used: /Users/me/dotfiles/skills sits inside repo "library" (/Users/me/dotfiles)
  no command can run until one of them is gone from /Users/me/.grimoire/state.json
```

Only the first problem is reported. A path touching `~/.grimoire/` comes before any overlap, and a workspace before a repo.
Within each, the first entry by name is reported, against the first entry by name it overlaps.
