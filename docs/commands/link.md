# `link`

`link` symlinks store skills into one or more workspaces, so an edit to the store copy shows up in each of them immediately.
[`clone`](./clone.md) is the copy, for a workspace that cannot use a link.

```shell
grimoire link <skill> [workspaces...]
grimoire link --all-skills [workspaces...]
```

## Arguments

| Argument          | Meaning                                             |
| ----------------- | --------------------------------------------------- |
| `<skill>`         | The store skill to link.                            |
| `[workspaces...]` | Registered workspace names to link into.            |
| `--all-skills`    | Every skill the store holds, instead of naming one. |

`<skill>` is required unless `--all-skills` is given. With no workspace named, the destinations are every
[auto-link](./workspaces.md#workspaces-add-name-path---auto-link) workspace. Duplicate names follow
[Arguments](../conventions.md#arguments).

Under `--all-skills` there is no skill argument, so every positional is read as a workspace name:
`grimoire link triage --all-skills` fails with `no workspace named "triage"`.

## What counts as the link

`<dest>` below is `<workspace path>/<skill>`. `already linked` means `<dest>` already holds a
[link](../conventions.md#links-and-clones).

A new link is a symlink at `<dest>` whose target is the store path as written, `/Users/me/.grimoire/skills/<skill>`. The
target is never resolved to a realpath.

Nothing is written to `state.json`. Only `<dest>` is examined, so a link to the same skill under another entry name goes
unseen, and a second link is written beside it.

## `link <skill> <workspaces...>`

Each pair gets one outcome, decided by what sits at `<dest>`:

| At `<dest>`                                        | Outcome        | Output                                                                                                                                                                                                      |
| -------------------------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| the workspace path does not resolve                | skipped        | stderr `warning: workspace "<workspace>" was skipped: <workspace path> is not an existing directory`                                                                                                        |
| the workspace cannot be read                       | skipped        | stderr `warning: workspace "<workspace>" was skipped: <workspace path> cannot be read`                                                                                                                      |
| nothing                                            | linked         | stdout `linked <skill> → <workspace>`                                                                                                                                                                       |
| a symlink resolving to this store skill            | already linked | stdout `already linked <skill> → <workspace>`                                                                                                                                                               |
| any other symlink, dangling ones included          | declined       | stderr `warning: could not link <skill> → <workspace>: <dest> is a symlink pointing elsewhere`                                                                                                              |
| a directory with a clone record                    | declined       | stderr ``warning: could not link <skill> → <workspace>: <dest> is a clone — unclone it first with `grimoire unclone <skill> <workspace>` ``                                                                 |
| a directory the store copy holds in full           | replaced       | stdout `linked <skill> → <workspace>`                                                                                                                                                                       |
| a directory holding something the store copy lacks | declined       | stderr ``warning: could not link <skill> → <workspace>: <dest> holds a directory that differs from the store copy at "<entry>" — keep it with `grimoire clone <skill> <workspace>`, or delete it yourself`` |
| a directory that cannot be compared (a symlink)    | declined       | stderr `warning: could not link <skill> → <workspace>: <root> holds the symlink "<entry>", so the two copies cannot be compared`                                                                            |
| anything else                                      | declined       | stderr `warning: could not link <skill> → <workspace>: <dest> is not a directory`                                                                                                                           |

```shell
$ grimoire link triage personal work scratch
linked triage → personal
already linked triage → work
warning: could not link triage → scratch: /Users/me/scratch/skills/triage holds a directory that differs from the store copy at "notes.md" — keep it with `grimoire clone triage scratch`, or delete it yourself
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
comparison, even when it matches the store copy. [`unclone`](./unclone.md) drops the record, after which the directory is
compared like any other.

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

## `link --all-skills [workspaces...]`

Every skill the store holds, in name order. With no workspace named, the destinations are the same auto-link set as
`link <skill>`. Below, the directory of `work` is gone, and `work` is [skipped once](#a-workspace-is-skipped-once):

```shell
$ grimoire link --all-skills
linked brainstorm → personal
linked triage → personal
warning: workspace "work" was skipped: /Users/me/work/.agents/skills is not an existing directory
```

If the store holds no skills, the run prints `nothing to link: the store holds no skills`.

## What `link` refuses

[Refusals](../conventions.md#refusals) are checked in this order:

**1. A skill is given, or `--all-skills`.**

**2. The skill exists in the store.**

**3. The skill passes the portability check.**

**4. Every named workspace is registered.**
