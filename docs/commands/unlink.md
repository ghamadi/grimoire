# `unlink`

`unlink` removes one skill's link from one or more workspaces. Unlike `workspaces remove --hard`, which clears every link in
a workspace and unregisters it, `unlink` touches one skill at a time and leaves the workspace registered.

```shell
grimoire unlink <skill> <workspaces...>
grimoire unlink <skill> --all-workspaces
```

## Arguments

| Argument           | Meaning                                                                                            |
| ------------------ | -------------------------------------------------------------------------------------------------- |
| `<skill>`          | Skill to unlink. The only check is that it exists in the store; it is not checked for portability. |
| `<workspaces...>`  | Registered workspace names to unlink from.                                                         |
| `--all-workspaces` | Every registered workspace, instead of naming any.                                                 |

One of `<workspaces...>` or `--all-workspaces` is required, and the two are mutually exclusive. Duplicate names follow
[Arguments](../conventions.md#arguments).

## What counts as the link

`unlink` removes a [link](../conventions.md#links-and-clones). Only the symlink is removed. The store's copy of the skill and
`state.json` are never touched. So a workspace's auto-link mode is unchanged, and a later bare `grimoire link <skill>` links
it back.

An [unreachable or unreadable](../conventions.md#unreachable-and-unreadable-workspaces) workspace is declined like any other
destination, and stays registered.

`<path>` below is `<registered workspace path>/<skill>`.

## `unlink <skill> <workspaces...>`

Each pair gets one outcome, decided by what sits at `<path>`:

```shell
$ grimoire unlink triage personal work
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

## `unlink <skill> --all-workspaces`

The destinations are every registered workspace, auto-link or manual, in name order, each treated as if named
([Arguments](../conventions.md#arguments)):

```shell
$ grimoire unlink triage --all-workspaces
unlinked triage → personal
not linked triage → scratch
warning: could not unlink triage → work: /Users/me/work/.agents/skills/triage is a directory, not a link
```

If no workspace is registered, the run prints `nothing to unlink: no workspace is registered`.

## What `unlink` refuses

[Refusals](../conventions.md#refusals) are checked in this order:

**1. Workspaces are given.**

**2. Not both at once.**

```shell
$ grimoire unlink triage personal --all-workspaces
error: --all-workspaces cannot be combined with named workspaces
```

**3. The skill exists in the store.**

**4. Every named workspace is registered.**
