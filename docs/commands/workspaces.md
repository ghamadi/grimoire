# `workspaces`

A workspace is a directory an agent reads skills from (e.g., `~/.claude/skills`, a project's `.agents/skills`), registered by
name.

> [!NOTE]
>
> Skills managed by grimoire reach a workspace in one of two ways: `link` symlinks the store's copy in, so edits to the store
> are visible immediately; [`clone`](./clone.md) copies it, for a workspace that cannot use a link — the copy does not follow
> the store.

Workspaces are **flat**: an agent reads `<workspace>/<skill>/SKILL.md`, so the directory holds one entry per skill and
nothing is nested.

| Command                                                                | Purpose                    |
| ---------------------------------------------------------------------- | -------------------------- |
| [`workspaces add`](#workspaces-add-name-path---auto-link)              | Register a workspace       |
| [`workspaces remove`](#workspaces-remove-name---hard---force-alias-rm) | Unregister a workspace     |
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

`--auto-link` is a standing default for later commands, not an action taken now: skills already in the store are not linked
in by registering the workspace. Without it, a workspace receives only what you name explicitly. `manual` and `auto-link` are
the same two labels `list` prints, so the confirmation reads as the row it just created.

### The directory may not exist yet

A missing path is not automatically a mistake: `~/.claude/skills` appears the first time a skill is written there. `add`
creates the **final segment** and says so, on its own line above the confirmation:

```shell
$ grimoire workspaces add personal ~/.claude/skills
created /Users/me/.claude/skills
registered workspace "personal" → /Users/me/.claude/skills (manual)
```

One segment, never recursive — a typo in the parent should surface as one rather than materialize a tree:

```shell
$ grimoire workspaces add personal ~/.claude/skils/nested
error: /Users/me/.claude/skils does not exist
```

The creation line is a result, not a warning: it goes to stdout, the exit code is 0, and the confirmation below it is
byte-identical to the run where the directory was already there.

### What `add` rejects

A refusal exits 1 and registers nothing: `state.json` is left exactly as it was found, and no directory is created.

The checks run in the order below, and only the first failure is reported. The name goes first because the path check can
create a directory, and a refused `add` must leave nothing behind.

**1. The name uses only letters, digits, `-` and `_`,** and starts with a letter or digit. ASCII only. That's how
[`unclone`](./unclone.md) tells a workspace name from a recorded path.

```shell
$ grimoire workspaces add a/b ~/.claude/skills
error: workspace name "a/b" must start with a letter or digit and contain only letters, digits, "-" and "_"
```

**2. The name is free.** Within the workspace registry.

```shell
$ grimoire workspaces add personal ~/.config/other-agent/skills
error: workspace "personal" is already registered
```

**3. The path does not collide** with `~/.grimoire/` — see [the collision rule](#the-collision-rule).

```shell
$ grimoire workspaces add personal ~/.grimoire/skills
error: /Users/me/.grimoire/skills sits inside the grimoire store (/Users/me/.grimoire)
```

**4. The path is usable.** If it exists, it has to be a directory; if it does not, its parent has to exist.

```shell
$ grimoire workspaces add personal ~/notes.md
error: /Users/me/notes.md is not a directory

$ grimoire workspaces add personal ~/nope/skills
error: /Users/me/nope does not exist
```

### The collision rule

`add` checks the path against `~/.grimoire/` only — never against other workspaces. Two workspaces may share a path, and one
may be registered at an ancestor of another; both succeed.

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

Paths are compared canonically, with symlinks resolved. A refusal names the path as typed, not as resolved.

## `workspaces remove <name> [--hard] [--force]` _(alias: `rm`)_

```shell
$ grimoire workspaces remove personal
unregistered workspace "personal" → /Users/me/.claude/skills

$ grimoire workspaces remove ghost
error: no workspace named "ghost"
```

Unregisters only. The directory is never deleted — not the workspace's, not a cloned skill's inside it. A workspace whose
path no longer resolves to a directory — deleted by hand, replaced by a file — still unregisters cleanly.

A directory that exists but cannot be read refuses, because the links inside it cannot be seen, and unregistering would
strand them. [`--force`](#an-unreadable-workspace-refuses) is the way out, so a registration never needs a hand-edit of
`state.json` to clear.

What `remove` does have to deal with is what still points at the workspace. Links and clones get opposite treatment, because
only one of them is grimoire's to clean up:

| Deployment | Without `--hard`            | With `--hard`        |
| ---------- | --------------------------- | -------------------- |
| Links      | refuses, naming every one   | deletes the symlinks |
| Clones     | records rewritten to a path | records forgotten    |

### An unreadable workspace refuses

A workspace whose path is a directory grimoire cannot list or enter, or that sits under one it cannot enter, refuses. This is
the same condition [`status`](./status.md) reports as `workspace-unreadable`. The refusal writes nothing, and it applies with
`--hard` too, because links that cannot be seen cannot be cleared:

```shell
$ grimoire workspaces remove work
error: cannot remove workspace "work": /Volumes/ext/skills cannot be read
  make it readable, then run this again, or unregister it anyway with `grimoire workspaces remove work --force`

$ grimoire workspaces remove work --hard
error: cannot remove workspace "work": /Volumes/ext/skills cannot be read
  make it readable, then run this again, or unregister it anyway with `grimoire workspaces remove work --hard --force`
```

The suggested command repeats `--hard` when the refused run had it. Otherwise following the fix would convert clone records
the run meant to forget.

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
block the removal, so the flag can never leave links in a readable workspace untracked. It changes nothing for a path that
does not resolve either, which already unregisters.

### Links refuse

A link is a symlink from the workspace into `~/.grimoire/skills/`. Nothing records it — reading the workspace directory
answers the question — so unregistering while links remain would leave symlinks on disk that no command can find again, in a
directory grimoire has stopped tracking:

```shell
$ grimoire workspaces remove personal
error: workspace "personal" is still in use
  links: brainstorm, triage
  use --hard to clear them
```

The message names every skill that would have been stranded, not just the first, and puts them on their own line so the list
stays readable at ten of them. The refusal writes nothing.

`--hard` clears them and reports what went:

```shell
$ grimoire workspaces remove personal --hard
removed 2 links: brainstorm, triage
unregistered workspace "personal" → /Users/me/.claude/skills
```

Only the symlink is removed. The store's copy of the skill is untouched, which is the entire difference between clearing a
link and deleting a skill.

A symlink pointing anywhere else — a skill you linked in by hand from another directory — is not grimoire's, so it neither
blocks the removal nor gets cleared. Chains are followed: a link that reaches a store skill through an intermediate symlink
counts. A link has to resolve to count, though. Once its skill is deleted from the store it resolves nowhere, so it neither
blocks `remove` nor is cleared by `--hard`, and is left for you to delete by hand. [`status`](./status.md) reports these
links, and the planned `doctor` command is meant to clear them.

### Clones convert

A clone is a copy, not a link, and `state.json` recording it is the only thing on disk that distinguishes a managed copy from
a directory you wrote yourself. Deleting that record destroys information; the cloned directory itself is yours.

So clones don't refuse. A record naming this workspace is rewritten to carry the workspace's **path** instead — the same
directory it always named, reached the same way the state lookup would have reached it, except that lookup is about to start
failing:

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

The clone stays reachable by [`unclone`](./unclone.md),
[`skills remove --forget-clones`](./skills.md#skills-remove-skills---forget-clones-alias-rm), and [`status`](./status.md) —
it has simply stopped being addressable by a name that no longer resolves. Records naming a **different** workspace, and ones
already keyed by path, are left alone.

`--hard` forgets them instead:

```shell
$ grimoire workspaces remove personal --hard
forgot 1 clone record: deploy
unregistered workspace "personal" → /Users/me/.claude/skills
cloned directories were left in place
```

The last line appears only when a forgotten record names a directory still present under the workspace. Those copies are now
ordinary directories: grimoire will not update them, will not report them under [`status`](./status.md), and will not delete
them. No grimoire command deletes a cloned directory — `--hard` here and
[`skills remove --forget-clones`](./skills.md#skills-remove-skills---forget-clones-alias-rm) both stop at the record;
removing the copy is yours to do by hand.

## `workspaces list` _(alias: `ls`)_

```shell
$ grimoire workspaces list
personal  auto-link  /Users/me/.claude/skills
work      manual     /Users/me/work/.agents/skills
```

Sorted by name. There is no header row, so the middle column spells out which mode it is in. Empty registry prints
`No workspaces registered.`

The listing is state, not truth — a registered path that no longer exists on disk is still listed, and reporting it is
[`status`](./status.md)'s job.
