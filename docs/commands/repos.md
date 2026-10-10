# `repos`

A repo is a directory inside a git work tree that `export` copies store skills into, registered by name. From there, history,
review, and sharing are git's and yours.

Repos are **flat**: an exported skill lands at `<repo path>/<skill>`, so the directory holds one entry per skill and nothing
is nested.

grimoire runs git read-only — it asks questions and never commits, stages, or changes a config. Only `repos add` and `export`
run it at all; every other command works without git installed.

Repo names and [workspace](./workspaces.md) names are separate registries: a repo and a workspace may share a name.

| Command                                       | Purpose               |
| --------------------------------------------- | --------------------- |
| [`repos add`](#repos-add-name-path)           | Register a repo       |
| [`repos remove`](#repos-remove-name-alias-rm) | Unregister a repo     |
| [`repos list`](#repos-list-alias-ls)          | List registered repos |

## `repos add <name> <path>`

| Argument | Meaning                                                        |
| -------- | -------------------------------------------------------------- |
| `name`   | Name to register it under                                      |
| `path`   | Directory inside a git work tree that skills are exported into |

```shell
$ grimoire repos add library ~/dotfiles/skills
registered repo "library" → /Users/me/dotfiles/skills
```

`add` creates nothing. Unlike [`workspaces add`](./workspaces.md#the-directory-may-not-exist-yet), which makes a missing
final segment, a repo's directory has to exist already — a path that is not there cannot be inside a work tree.

### What `add` rejects

A refusal exits 1 and registers nothing: `state.json` is left exactly as it was found.

The checks run in the order below, and only the first failure is reported.

**1. The name uses only letters, digits, `-` and `_`,** and starts with a letter or digit. ASCII only — the same rule as
[a workspace name](./workspaces.md#what-add-rejects).

```shell
$ grimoire repos add a/b ~/dotfiles/skills
error: repo name "a/b" must start with a letter or digit and contain only letters, digits, "-" and "_"
```

**2. The name is free.** Within the repo registry.

```shell
$ grimoire repos add library ~/work/skills
error: repo "library" is already registered
```

**3. The path does not collide** with `~/.grimoire/` or with a registered workspace — see [the path rule](#the-path-rule).

```shell
$ grimoire repos add library ~/.grimoire/skills
error: /Users/me/.grimoire/skills sits inside the grimoire store (/Users/me/.grimoire)

$ grimoire repos add library ~/dotfiles
error: /Users/me/dotfiles contains workspace "personal" (/Users/me/dotfiles/skills)
```

**4. The path is usable.** It has to be absolute or start with `~/`, and it has to be an existing directory that is not a
symlink. A relative path is refused rather than resolved against the current directory, and echoed as typed:

```shell
$ grimoire repos add library .
error: . must be an absolute path or start with ~/

$ grimoire repos add library ~/dotfile/skills
error: /Users/me/dotfile/skills does not exist
```

**5. The path is inside a git work tree.** A subdirectory of a work tree counts, and so does a linked worktree. A
repository's own `.git` directory does not, and neither does a bare repository.

```shell
$ grimoire repos add library ~/notes
error: /Users/me/notes is not inside a git work tree
```

This is the check that runs git. When git cannot be run at all — not installed, or not on your `PATH` — `add` refuses with:

```shell
$ grimoire repos add library ~/dotfiles/skills
error: could not run git: repos need it installed and on your PATH
```

### The path rule

A repo path may not equal, contain, or sit inside `~/.grimoire/` or the path of a registered workspace. Registering a
workspace refuses a repo's path [the same way](./workspaces.md#the-collision-rule).

Repo against repo is never checked. Two repos may share a path, and one may be registered inside another; both succeed.

When a path collides with both the store and a workspace, the store is named. Among several workspaces, the first by name is.

| Relation | Message                    |
| -------- | -------------------------- |
| equals   | `is the same directory as` |
| inside   | `sits inside`              |
| contains | `contains`                 |

```
workspace "personal"  /Users/me/dotfiles/skills
                      ├─ equals    /Users/me/dotfiles/skills
                      ├─ inside    /Users/me/dotfiles/skills/shared
                      └─ contains  /Users/me/dotfiles
```

The rule exists because `export` writes into the repo's directory. Pointed at the store, it would write into the store.
Pointed at a workspace, it would rewrite a directory skills are deployed into, replacing a clone the store was never meant to
follow.

Paths are compared canonically, with symlinks resolved. A refusal names the path as typed, not as resolved.

The rule is checked again every time `state.json` is read. An overlap made later, by hand or through a repointed symlink,
stops every command, `repos remove` included, until `state.json` is edited. An overlap with a workspace names the workspace
first:

```shell
$ grimoire repos list
error: workspace "dotfiles" cannot be used: /Users/me/dotfiles/skills sits inside repo "library" (/Users/me/dotfiles)
  no command can run until one of them is gone from /Users/me/.grimoire/state.json
```

## `repos remove <name>` _(alias: `rm`)_

```shell
$ grimoire repos remove library
unregistered repo "library" → /Users/me/dotfiles/skills

$ grimoire repos remove ghost
error: no repo named "ghost"
```

Unregisters only. The directory is never touched, and neither is anything exported into it. There are no flags: grimoire
records nothing about what it exported, so nothing points at a repo and a registered name is never refused. A repo whose
directory is already gone unregisters the same way.

## `repos list` _(alias: `ls`)_

```shell
$ grimoire repos list
library  /Users/me/dotfiles/skills
work     /Users/me/work/agent-skills
```

Sorted by name, with no header row. An empty registry prints `No repos registered.`

The listing is state, not truth — it runs no git and reads no repo directory. A repo whose directory is gone, or is no longer
inside a work tree, is still listed; `export` checks again before it writes.

## Load failures

Every command, these three included, first loads `state.json` and refuses when it cannot — see
[`status`'s refusals](./status.md#exit-code-and-refusals).
