# `repos`

A repo is a directory inside a git work tree that `export` copies store skills into, registered by name. From there, you
handle history, review and sharing with git. There is no import. Skills go from the store to a repo and never back.

Repos are **flat**: an exported skill lands at `<repo path>/<skill>`, so the directory holds one entry per skill and nothing
is nested.

grimoire runs git read-only. It never commits, stages or changes a config. Only `repos add`, `export` and
[`skills add`](./skills.md#adding-from-a-git-url) given a git URL run it, and every other command works without git
installed.

Repo names and [workspace](./workspaces.md) names are separate registries: a repo and a workspace may share a name.

| Command                                       | Purpose               |
| --------------------------------------------- | --------------------- |
| [`repos add`](#repos-add-name-path)           | Register a repo       |
| [`repos remove`](#repos-remove-name-alias-rm) | Unregister a repo     |
| [`repos rename`](#repos-rename-name-new-name) | Rename a repo         |
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

Unlike [`workspaces add`](./workspaces.md#the-directory-may-not-exist-yet), `add` creates nothing, since a missing directory
cannot be inside a git work tree.

### What `add` rejects

These checks run in order. A failed check is a [refusal](../conventions.md#refusals).

**1. The name follows [the name rule](../state.md#names).**

**2. The name is free.** Within the repo registry.

```shell
$ grimoire repos add library ~/work/skills
error: repo "library" is already registered
```

**3. The path follows [the path rule](../state.md#the-path-rule).**

**4. The path is usable.** It has to be absolute or start with `~/`, and it has to be an existing directory that is not a
symlink. A relative path is refused and echoed as typed:

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

If git is not installed or not on your `PATH`, `add` refuses with:

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

Unregisters only. The directory and everything exported into it are left as they are. There are no flags, and a registered
name is never refused, even when its directory is already gone.

## `repos rename <name> <new-name>`

| Argument   | Meaning                       |
| ---------- | ----------------------------- |
| `name`     | Registered name               |
| `new-name` | Name to file it under instead |

```shell
$ grimoire repos rename library docs
renamed repo "library" → "docs"
```

Only the name changes. The path stays, and `rename` reads no directory and runs no git, so a repo whose directory is gone
still renames. Names compare exactly, so `library` → `Library` is a rename.

Renaming a repo to the name it already has changes nothing:

```shell
$ grimoire repos rename library library
nothing to rename: repo "library" already has that name
```

### What `rename` rejects

These checks run in order. A failed check is a [refusal](../conventions.md#refusals).

**1. The name is registered.** This runs before the same-name check, so `rename ghost ghost` is refused.

**2. The new name follows [the name rule](../state.md#names).**

**3. The new name is free.** Within the repo registry, so a workspace may hold it.

```shell
$ grimoire repos rename library work
error: repo "work" is already registered
```

## `repos list` _(alias: `ls`)_

```shell
$ grimoire repos list
library  /Users/me/dotfiles/skills
work     /Users/me/work/agent-skills
```

Sorted by name. An empty registry prints `No repos registered.`

The listing runs no git and reads no repo directory, so a repo whose directory is gone or no longer inside a work tree is
still listed. `export` checks again before it writes.
