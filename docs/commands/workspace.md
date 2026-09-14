# `workspace`

A workspace is a directory an agent reads skills from (e.g., `~/.claude/skills`, a project's `.agents/skills`), registered by
name.

> [!NOTE]
>
> Skills managed by grimoire reach a workspace in one of two ways: `link` symlinks the store's copy in, so edits to the store
> are visible immediately; `clone` copies it, allowing for drifts and tweaks based on the workspace's needs.

Workspaces are **flat**: an agent reads `<workspace>/<skill>/SKILL.md`, so the directory holds one entry per skill and
nothing is nested.

| Command                                                      | Purpose                    |
| ------------------------------------------------------------ | -------------------------- |
| [`workspace add`](#workspace-add-name-path---auto-link)      | Register a workspace       |
| [`workspace remove`](#workspace-remove-name---hard-alias-rm) | Unregister a workspace     |
| [`workspace list`](#workspace-list-alias-ls)                 | List registered workspaces |

## `workspace add <name> <path> [--auto-link]`

| Argument | Meaning                            |
| -------- | ---------------------------------- |
| `name`   | Name to register it under          |
| `path`   | Directory skills are deployed into |

| Flag          | Default | Effect                                                                                   |
| ------------- | ------- | ---------------------------------------------------------------------------------------- |
| `--auto-link` | false   | when true, any new skill entering the store gets linked into the workspace automatically |

```shell
$ grimoire workspace add personal ~/.claude/skills
registered workspace "personal" → /Users/me/.claude/skills (manual)

$ grimoire workspace add personal ~/.claude/skills --auto-link
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
$ grimoire workspace add personal ~/.claude/skills
created /Users/me/.claude/skills
registered workspace "personal" → /Users/me/.claude/skills (manual)
```

One segment, never recursive — a typo in the parent should surface as one rather than materialize a tree:

```shell
$ grimoire workspace add personal ~/.claude/skils/nested
grimoire: /Users/me/.claude/skils does not exist
```

The creation line is a result, not a warning: it goes to stdout, the exit code is 0, and the confirmation below it is
byte-identical to the run where the directory was already there.

### What `add` rejects

A refusal exits 1 and registers nothing: `state.json` is left exactly as it was found, and no directory is created.

The checks run in the order below, and only the first failure is reported. The name goes first because the path check can
create a directory, and a refused `add` must leave nothing behind.

**1. The name is free.** Within the workspace registry.

```shell
$ grimoire workspace add personal ~/.config/other-agent/skills
grimoire: workspace "personal" is already registered
```

**2. The path does not collide** with `~/.grimoire/` — see [the collision rule](#the-collision-rule).

```shell
$ grimoire workspace add personal ~/.grimoire/skills
grimoire: /Users/me/.grimoire/skills sits inside the grimoire store (/Users/me/.grimoire)
```

**3. The path is usable.** If it exists, it has to be a directory; if it does not, its parent has to exist.

```shell
$ grimoire workspace add personal ~/notes.md
grimoire: /Users/me/notes.md is not a directory

$ grimoire workspace add personal ~/nope/skills
grimoire: /Users/me/nope does not exist
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

## `workspace remove <name> [--hard]` _(alias: `rm`)_

```shell
$ grimoire workspace remove personal
unregistered workspace "personal" → /Users/me/.claude/skills

$ grimoire workspace remove ghost
grimoire: no workspace named "ghost"
```

Unregisters only. The directory is never deleted — not the workspace's, not a cloned skill's inside it — and a workspace
whose path no longer reads as a directory — deleted by hand, replaced by a file — still unregisters cleanly. A registration
you cannot surrender is one only a hand-edit of `state.json` can clear, so nothing about the directory's state is grounds
for a refusal.

What `remove` does have to deal with is what still points at the workspace. Links and clones get opposite treatment, because
only one of them is grimoire's to clean up:

| Deployment | Without `--hard`            | With `--hard`        |
| ---------- | --------------------------- | -------------------- |
| Links      | refuses, naming every one   | deletes the symlinks |
| Clones     | records rewritten to a path | records forgotten    |

### Links refuse

A link is a symlink from the workspace into `~/.grimoire/skills/`. Nothing records it — reading the workspace directory
answers the question — so unregistering while links remain would leave symlinks on disk that no command can find again, in a
directory grimoire has stopped tracking:

```shell
$ grimoire workspace remove personal
grimoire: workspace "personal" is still in use
  links: brainstorm, triage
  use --hard to clear them
```

The message names every skill that would have been stranded, not just the first, and puts them on their own line so the list
stays readable at ten of them. The refusal writes nothing.

`--hard` clears them and reports what went:

```shell
$ grimoire workspace remove personal --hard
removed 2 links: brainstorm, triage
unregistered workspace "personal" → /Users/me/.claude/skills
```

Only the symlink is removed. The store's copy of the skill is untouched, which is the entire difference between clearing a
link and deleting a skill.

A symlink pointing anywhere else — a skill you linked in by hand from another directory — is not grimoire's, so it neither
blocks the removal nor gets cleared. Chains are followed: a link into the store through an intermediate symlink counts, and
so does one whose skill in the store has since been deleted, which is precisely the link you would not want left behind.

### Clones convert

A clone is a copy, not a link, and `state.json` recording it is the only thing on disk that distinguishes a managed copy
from a directory you wrote yourself. Deleting that record destroys information; the cloned directory itself is yours.

So clones don't refuse. A record naming this workspace is rewritten to carry the workspace's **path** instead — the same
directory it always named, reached the same way the state lookup would have reached it, except that lookup is about to start
failing:

```shell
$ grimoire workspace remove personal
1 clone now recorded by path: deploy
unregistered workspace "personal" → /Users/me/.claude/skills
```

```diff
  "state.json"
- "deploy": { "clones": [ { "workspace": "personal" } ] }
+ "deploy": { "clones": [ { "path": "/Users/me/.claude/skills" } ] }
```

The clone stays reachable by `clone`, `remove --remove-clones`, and `status` — it has simply stopped being addressable by a
name that no longer resolves. Records naming a **different** workspace, and ones already keyed by path, are left alone.

`--hard` forgets them instead:

```shell
$ grimoire workspace remove personal --hard
forgot 1 clone record: deploy
unregistered workspace "personal" → /Users/me/.claude/skills
cloned directories were left in place
```

The last line appears only when a forgotten record names a directory still present under the workspace. Those copies are now
ordinary directories: grimoire will not update them, will not report them under `status`, and will not delete them. Deleting
a cloned directory is `remove <skill> --remove-clones`, never this command.

## `workspace list` _(alias: `ls`)_

```shell
$ grimoire workspace list
personal  auto-link  /Users/me/.claude/skills
work      manual     /Users/me/work/.agents/skills
```

Sorted by name. There is no header row, so the middle column spells out which mode it is in. Empty registry prints
`No workspaces registered.`

The listing is state, not truth — a registered path that no longer exists on disk is still listed, and reporting it is
`status`'s job.
