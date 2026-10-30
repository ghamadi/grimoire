# `link`

`link` symlinks store skills into one or more workspaces, so an edit to the store copy shows up in each of them immediately.
[`clone`](./clone.md) is the copy, for a workspace that cannot use a link.

`link --drop` removes one skill's link from workspaces. Unlike `workspaces remove --hard`, which clears every link in a
workspace and unregisters it, `--drop` touches one skill at a time and leaves the workspace registered.

```shell
grimoire link <skill> [--to <workspaces...>]
grimoire link --all-skills [--to <workspaces...>]
grimoire link <skill> --drop [workspaces...]
grimoire link <skill> --drop --all-workspaces
```

## Arguments

| Argument                 | Meaning                                                                        |
| ------------------------ | ------------------------------------------------------------------------------ |
| `<skill>`                | The store skill to link, or to unlink with `--drop`.                           |
| `--to <workspaces...>`   | Registered workspace names to link into.                                       |
| `--all-skills`           | Every skill the store holds, instead of naming one. Not allowed with `--drop`. |
| `--drop [workspaces...]` | Registered workspace names to remove the link from.                            |
| `--all-workspaces`       | With `--drop`, every registered workspace, instead of naming any.              |

`<skill>` is required unless `--all-skills` is given. Without `--to`, the destinations are every
[auto-link](./workspaces.md#workspaces-add-name-path---auto-link) workspace. `--drop` takes workspace names,
`--all-workspaces`, or neither, in which case you [choose them](#choosing-workspaces-to-drop-from). Duplicate names follow
[Arguments](../conventions.md#arguments).

## What counts as the link

`<dest>` below is `<workspace path>/<skill>`. `already linked` means `<dest>` already holds a
[link](../conventions.md#links-and-clones).

A new link is a symlink at `<dest>` whose target is the store path as written, `/Users/me/.grimoire/skills/<skill>`. The
target is never resolved to a realpath.

Nothing is written to `state.json`. Only `<dest>` is examined, so a link to the same skill under another entry name goes
unseen, and a second link is written beside it.

## `link <skill> --to <workspaces...>`

Each pair gets one outcome, decided by what sits at `<dest>`:

| At `<dest>`                                        | Outcome        | Output                                                                                                                                                                                                           |
| -------------------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| the workspace path does not resolve                | skipped        | stderr `warning: workspace "<workspace>" was skipped: <workspace path> is not an existing directory`                                                                                                             |
| the workspace cannot be read                       | skipped        | stderr `warning: workspace "<workspace>" was skipped: <workspace path> cannot be read`                                                                                                                           |
| nothing                                            | linked         | stdout `linked <skill> → <workspace>`                                                                                                                                                                            |
| a symlink resolving to this store skill            | already linked | stdout `already linked <skill> → <workspace>`                                                                                                                                                                    |
| any other symlink, dangling ones included          | declined       | stderr `warning: could not link <skill> → <workspace>: <dest> is a symlink pointing elsewhere`                                                                                                                   |
| a directory with a clone record                    | declined       | stderr ``warning: could not link <skill> → <workspace>: <dest> is a clone — unclone it first with `grimoire clone <skill> --drop <workspace>` ``                                                                 |
| a directory the store copy holds in full           | replaced       | stdout `linked <skill> → <workspace>`                                                                                                                                                                            |
| a directory holding something the store copy lacks | declined       | stderr ``warning: could not link <skill> → <workspace>: <dest> holds a directory that differs from the store copy at "<entry>" — keep it with `grimoire clone <skill> --to <workspace>`, or delete it yourself`` |
| a directory that cannot be compared (a symlink)    | declined       | stderr `warning: could not link <skill> → <workspace>: <root> holds the symlink "<entry>", so the two copies cannot be compared`                                                                                 |
| a directory that cannot be read in full            | declined       | stderr `warning: could not link <skill> → <workspace>: <path> cannot be read`                                                                                                                                    |
| anything else                                      | declined       | stderr `warning: could not link <skill> → <workspace>: <dest> is not a directory`                                                                                                                                |

```shell
$ grimoire link triage --to personal work scratch
linked triage → personal
already linked triage → work
warning: could not link triage → scratch: /Users/me/scratch/skills/triage holds a directory that differs from the store copy at "notes.md" — keep it with `grimoire clone triage --to scratch`, or delete it yourself
```

Lines print grouped as `linked`, then `already linked`, then warnings. Among the warnings, a skipped workspace comes before
any pair. Under `--all-skills`, pairs inside a group go by skill first. The rest follows
[Outcomes](../conventions.md#outcomes) and
[When every destination is declined](../conventions.md#when-every-destination-is-declined).

### Replacing a directory the store already holds

A directory at `<dest>` is removed and replaced by the link when the store copy
[holds it in full](../conventions.md#containment). An empty directory is replaced too. The replacement prints the plain
`linked` line.

A directory holding anything else is declined, and `<entry>` names the first path that differs, relative to `<dest>`.

A directory that holds a symlink cannot be compared, and is declined. `<root>` is the side holding it: `<dest>` when the
directory holds any symlink, or the store skill path when the store copy holds one at a path the directory also has.

### A recorded clone is never replaced

A directory at `<dest>` named by a [clone record](../conventions.md#links-and-clones), in either form, is declined before any
comparison, even when it matches the store copy. [`clone --drop`](./clone.md#clone-skill---drop-targets) drops the record,
after which the directory is compared like any other.

### A workspace is skipped once

A workspace that is [unreachable or unreadable](../conventions.md#unreachable-and-unreadable-workspaces) is skipped once per
run, however many skills the run links. Its line carries no skill name, and its directory is never created. A skip counts as
a decline, so a run with only skips and declines exits 1.

## `link <skill>`

The destinations are the auto-link workspaces in name order, each treated as if named
([Arguments](../conventions.md#arguments)):

```shell
$ grimoire link triage
linked triage → personal
already linked triage → scratch
```

If no auto-link workspace is registered, the run prints `nothing to link: no auto-link workspace is registered`.

## `link --all-skills [--to <workspaces...>]`

Every skill the store holds, in name order. Without `--to`, the destinations are the same auto-link set as `link <skill>`.
Below, the directory of `work` is gone, and `work` is [skipped once](#a-workspace-is-skipped-once):

```shell
$ grimoire link --all-skills
linked brainstorm → personal
linked triage → personal
warning: workspace "work" was skipped: /Users/me/work/.agents/skills is not an existing directory
```

If the store holds no skills, the run prints `nothing to link: the store holds no skills`.

## `link <skill> --drop <workspaces...>`

`--drop` removes a [link](../conventions.md#links-and-clones). Only the symlink is removed. The store's copy of the skill and
`state.json` are never touched. So a workspace's auto-link mode is unchanged, and a later bare `grimoire link <skill>` links
it back.

An [unreachable or unreadable](../conventions.md#unreachable-and-unreadable-workspaces) workspace is declined like any other
destination, and stays registered.

`<path>` below is `<registered workspace path>/<skill>`. Each pair gets one outcome, decided by what sits at `<path>`:

```shell
$ grimoire link triage --drop personal work
unlinked triage → personal
not linked triage → work
```

| At `<path>`                         | Outcome    | Output                                                                                           |
| ----------------------------------- | ---------- | ------------------------------------------------------------------------------------------------ |
| the link                            | unlinked   | stdout `unlinked <skill> → <workspace>`                                                          |
| nothing                             | not linked | stdout `not linked <skill> → <workspace>`                                                        |
| the workspace does not resolve      | declined   | stderr `warning: could not unlink <skill> → <workspace>: <path> workspace path does not resolve` |
| the workspace cannot be read        | declined   | stderr `warning: could not unlink <skill> → <workspace>: <path> workspace path cannot be read`   |
| a directory                         | declined   | stderr `warning: could not unlink <skill> → <workspace>: <path> is a directory, not a link`      |
| anything else that is not a symlink | declined   | stderr `warning: could not unlink <skill> → <workspace>: <path> is not a link`                   |
| a symlink resolving anywhere else   | declined   | stderr `warning: could not unlink <skill> → <workspace>: <path> is a symlink pointing elsewhere` |

Lines print grouped as `unlinked`, then `not linked`, then warnings. The rest follows [Outcomes](../conventions.md#outcomes)
and [When every destination is declined](../conventions.md#when-every-destination-is-declined).

## `link <skill> --drop --all-workspaces`

The destinations are every registered workspace, auto-link or manual, in name order, each treated as if named
([Arguments](../conventions.md#arguments)):

```shell
$ grimoire link triage --drop --all-workspaces
unlinked triage → personal
not linked triage → scratch
warning: could not unlink triage → work: /Users/me/work/.agents/skills/triage is a directory, not a link
```

If no workspace is registered, the run prints `nothing to unlink: no workspace is registered`.

## Choosing workspaces to drop from

With `--drop` and no workspace named, `link` offers every registered workspace in name order,
[as the conventions describe](../conventions.md#missing-destinations). A workspace is offered whether or not it holds the
link. What you pick is unlinked as if named after `--drop`.

Without a terminal, the refusal also names `--all-workspaces`:

```shell
$ grimoire link triage --drop | cat
error: no workspace named, and no terminal to choose from
  use --all-workspaces, or name them after --drop: personal work
```

On a terminal, with no workspace registered or nothing picked, the exit code is 0:

```shell
$ grimoire link triage --drop
nothing to unlink: no workspace is registered
```

```shell
$ grimoire link triage --drop
nothing to unlink: no workspace selected
```

## What `link` refuses

[Refusals](../conventions.md#refusals) are checked in this order:

**1. Not `--to` and `--drop` at once.**

```shell
$ grimoire link triage --to personal --drop work
error: --to cannot be combined with --drop
```

**2. Each flag stays in its mode.**

```shell
$ grimoire link --all-skills --drop personal
error: --all-skills cannot be combined with --drop
```

```shell
$ grimoire link triage --all-workspaces
error: --all-workspaces works only with --drop
```

```shell
$ grimoire link triage --all-skills
error: --all-skills cannot be combined with a named skill
```

**3. A skill is given, or `--all-skills`.** `--drop` always needs a skill.

**4. `--drop` names workspaces or takes `--all-workspaces`, not both.**

```shell
$ grimoire link triage --drop personal --all-workspaces
error: --all-workspaces cannot be combined with named workspaces
```

**5. The skill exists in the store.**

**6. The skill passes the portability check.** `--drop` skips this check.

**7. Every named workspace is registered.**
