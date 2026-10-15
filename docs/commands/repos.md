# `repos`

A repo is a directory inside a git work tree that `export` copies store skills into, registered by name. From there, history,
review, and sharing are git's and yours. There is no import: skills go from the store to a repo, never back.

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

**1. The name follows [the name rule](../state.md#names).**

**2. The name is free.** Within the repo registry.

```shell
$ grimoire repos add library ~/work/skills
error: repo "library" is already registered
```

**3. The path follows [the path rule](../state.md#the-path-rule).**

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
