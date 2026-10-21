# `workspaces`

A workspace is a directory an agent reads skills from (e.g., `~/.claude/skills`, a project's `.agents/skills`), registered by
name.

> [!NOTE]
>
> Skills managed by grimoire reach a workspace in one of two ways. `link` symlinks the store's copy in, so edits to the store
> are visible immediately. [`clone`](./clone.md) copies it, for a workspace that cannot use a link. The copy does not follow
> the store.

Workspaces are **flat**: an agent reads `<workspace>/<skill>/SKILL.md`, so the directory holds one entry per skill and
nothing is nested.

| Command                                                                | Purpose                    |
| ---------------------------------------------------------------------- | -------------------------- |
| [`workspaces add`](#workspaces-add-name-path---auto-link)              | Register a workspace       |
| [`workspaces remove`](#workspaces-remove-name---hard---force-alias-rm) | Unregister a workspace     |
| [`workspaces rename`](#workspaces-rename-name-new-name)                | Rename a workspace         |
| [`workspaces list`](#workspaces-list-alias-ls)                         | List registered workspaces |

## `workspaces add <name> <path> [--auto-link]`

| Argument | Meaning                            |
| -------- | ---------------------------------- |
| `name`   | Name to register it under          |
| `path`   | Directory skills are deployed into |

| Flag          | Default | Effect                                                                                   |
| ------------- | ------- | ---------------------------------------------------------------------------------------- |
| `--auto-link` | false   | when true, any new skill entering the store gets linked into the workspace automatically |

```shell
$ grimoire workspaces add personal ~/.claude/skills
registered workspace "personal" → /Users/me/.claude/skills (manual)

$ grimoire workspaces add personal ~/.claude/skills --auto-link
registered workspace "personal" → /Users/me/.claude/skills (auto-link)
```

<!-- TODO: Consider making auto-link apply links retroactively -->

`--auto-link` applies to skills that enter the store later. Registering the workspace does not link skills already in the
store. Without it, a workspace receives only what you name.

### The directory may not exist yet

When the path is missing, `add` creates its **final segment** and prints `created <path>` on its own line above the
confirmation:

```shell
$ grimoire workspaces add personal ~/.claude/skills
created /Users/me/.claude/skills
registered workspace "personal" → /Users/me/.claude/skills (manual)
```

Only one segment is created, so a typo in a parent fails instead of creating a tree:

```shell
$ grimoire workspaces add personal ~/.claude/skils/nested
error: /Users/me/.claude/skils does not exist
```

The `created` line goes to stdout, and the run exits 0.

### What `add` rejects

These checks run in order. A failed check is a [refusal](../conventions.md#refusals).

**1. The name follows [the name rule](../state.md#names).**

**2. The name is free.** Within the workspace registry.

```shell
$ grimoire workspaces add personal ~/.config/other-agent/skills
error: workspace "personal" is already registered
```

**3. The path follows [the path rule](../state.md#the-path-rule)** against `~/.grimoire/` and registered repos.

**4. The path is usable.** If it exists, it has to be a directory; if it does not, its parent has to exist.

```shell
$ grimoire workspaces add personal ~/notes.md
error: /Users/me/notes.md is not a directory

$ grimoire workspaces add personal ~/nope/skills
error: /Users/me/nope does not exist
```

## `workspaces remove <name> [--hard] [--force]` _(alias: `rm`)_

```shell
$ grimoire workspaces remove personal
unregistered workspace "personal" → /Users/me/.claude/skills

$ grimoire workspaces remove ghost
error: no workspace named "ghost"
```

Unregisters only. Neither the workspace directory nor a cloned skill inside it is deleted. An
[unreachable](../conventions.md#unreachable-and-unreadable-workspaces) workspace still unregisters.

An unreadable workspace [refuses](../conventions.md#refusals) unless [`--force`](#an-unreadable-workspace-refuses) is passed.

Links and clones that still point at the workspace are handled differently:

| Deployment | Without `--hard`            | With `--hard`        |
| ---------- | --------------------------- | -------------------- |
| Links      | refuses, naming every one   | deletes the symlinks |
| Clones     | records rewritten to a path | records forgotten    |

### An unreadable workspace refuses

An [unreadable](../conventions.md#unreachable-and-unreadable-workspaces) workspace refuses, with `--hard` too. The refusal
writes nothing:

```shell
$ grimoire workspaces remove work
error: cannot remove workspace "work": /Volumes/ext/skills cannot be read
  make it readable, then run this again, or unregister it anyway with `grimoire workspaces remove work --force`

$ grimoire workspaces remove work --hard
error: cannot remove workspace "work": /Volumes/ext/skills cannot be read
  make it readable, then run this again, or unregister it anyway with `grimoire workspaces remove work --hard --force`
```

The suggested command repeats `--hard` when the refused run had it, so following it still forgets the clone records.

`--force` skips the link scan and unregisters. Clone records are converted to path records, or forgotten with `--hard`, as
usual. The last line says the links were not looked at:

```shell
$ grimoire workspaces remove work --force
1 clone now recorded by path: deploy
unregistered workspace "work" → /Volumes/ext/skills
links in /Volumes/ext/skills could not be checked and were left in place
```

The links notice comes after the `unregistered` line, and after the `cloned directories were left in place` notice when both
apply.

`--force` changes nothing for a workspace grimoire can read. Its links are read as usual, and without `--hard` they still
block the removal. It changes nothing for an unreachable workspace either, which already unregisters.

### Links refuse

A workspace that still holds [links](../conventions.md#links-and-clones) refuses, because once it is unregistered no command
could find those links again:

```shell
$ grimoire workspaces remove personal
error: workspace "personal" is still in use
  links: brainstorm, triage
  use --hard to clear them
```

The message names every linked skill, and nothing is written.

`--hard` clears them and reports what went:

```shell
$ grimoire workspaces remove personal --hard
removed 2 links: brainstorm, triage
unregistered workspace "personal" → /Users/me/.claude/skills
```

Only the symlinks are removed. The store's copies are untouched.

A symlink that is not a link, such as one pointing elsewhere or one whose store skill was deleted, neither blocks the removal
nor is cleared by `--hard`. [`status`](./status.md) reports the broken ones. Delete them by hand.

### Clones convert

A [clone](../conventions.md#links-and-clones) record naming this workspace is rewritten to record the workspace's **path**
instead:

```shell
$ grimoire workspaces remove personal
1 clone now recorded by path: deploy
unregistered workspace "personal" → /Users/me/.claude/skills
```

```diff
  "state.json"
- "deploy": { "clones": [ { "workspace": "personal" } ] }
+ "deploy": { "clones": [ { "path": "/Users/me/.claude/skills" } ] }
```

[`clone --drop`](./clone.md#clone-skill---drop-targets),
[`skills remove --forget-clones`](./skills.md#skills-remove-skills---forget-clones-alias-rm) and [`status`](./status.md)
still find the clone. Records naming a **different** workspace, and ones already recorded by path, are left alone.

`--hard` forgets them instead:

```shell
$ grimoire workspaces remove personal --hard
forgot 1 clone record: deploy
unregistered workspace "personal" → /Users/me/.claude/skills
cloned directories were left in place
```

The last line appears only when a forgotten record names a directory still present under the workspace. grimoire no longer
updates, reports or deletes those directories.

## `workspaces rename <name> <new-name>`

| Argument   | Meaning                       |
| ---------- | ----------------------------- |
| `name`     | Registered name               |
| `new-name` | Name to file it under instead |

```shell
$ grimoire workspaces rename personal home
renamed workspace "personal" → "home"
```

Only the name changes. The path and auto-link setting stay, and nothing on disk is touched. Names compare exactly, so
`personal` → `Personal` is a rename.

Renaming a workspace to the name it already has changes nothing:

```shell
$ grimoire workspaces rename personal personal
nothing to rename: workspace "personal" already has that name
```

The run exits 0 and writes nothing.

A [clone](../conventions.md#links-and-clones) record naming the workspace follows it to the new name:

```diff
  "state.json"
- "deploy": { "clones": [ { "workspace": "personal" } ] }
+ "deploy": { "clones": [ { "workspace": "home" } ] }
```

Records naming a **different** workspace, and ones recorded by path, are left alone.

An [unreachable or unreadable](../conventions.md#unreachable-and-unreadable-workspaces) workspace renames like any other.

### What `rename` rejects

These checks run in order. A failed check is a [refusal](../conventions.md#refusals).

**1. The name is registered.** This runs before the same-name check, so `rename ghost ghost` is refused.

```shell
$ grimoire workspaces rename ghost home
error: no workspace named "ghost"
```

**2. The new name follows [the name rule](../state.md#names).**

**3. The new name is free.** Within the workspace registry, so a repo may hold it.

```shell
$ grimoire workspaces rename personal work
error: workspace "work" is already registered
```

## `workspaces list` _(alias: `ls`)_

```shell
$ grimoire workspaces list
personal  auto-link  /Users/me/.claude/skills
work      manual     /Users/me/work/.agents/skills
```

Sorted by name. An empty registry prints `No workspaces registered.`

A registered path that no longer exists is still listed, and [`status`](./status.md) reports it.
