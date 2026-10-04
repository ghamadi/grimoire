# `unlink`

`unlink` removes one skill's link from one or more workspaces. Unlike `workspaces remove --hard`, which clears every link in
a workspace and unregisters it, `unlink` touches one skill at a time and leaves the workspace registered.

```shell
grimoire unlink <skill> <workspaces...>
grimoire unlink <skill> --all-workspaces
```

## Arguments

| Argument           | Meaning                                                                                                         |
| ------------------ | --------------------------------------------------------------------------------------------------------------- |
| `<skill>`          | Skill to unlink. Must exist in the store — existence is the only check; no SKILL.md read, no portability check. |
| `<workspaces...>`  | Registered workspace names to unlink from.                                                                      |
| `--all-workspaces` | Every registered workspace, instead of naming any.                                                              |

One of `<workspaces...>` or `--all-workspaces` is required, and the two are mutually exclusive. A name given twice counts
once, keeping its first position.

## What counts as the link

`<workspace path>/<skill>` is a symlink that resolves, following chains, to the store's `<skill>` directory. Only the symlink
is removed. The store's copy of the skill and `state.json` are never touched, so a workspace's auto-link mode is unchanged —
a later bare `grimoire link <skill>` with no workspaces links it straight back in.

A registered workspace whose path does not resolve to a directory (gone, a file, buried under a file, a symlink cycle) is one
`unlink` cannot read, so it is declined like any other destination it will not touch. The path may be an unmounted volume or
a renamed directory with the link still intact inside it, and `unlink` will not report a link gone that it never saw.

A workspace whose path is a directory `unlink` cannot list or enter, or that sits under one it cannot enter, is unreadable
and is declined the same way, for the same reason: a link inside it may be intact, and `unlink` will not report it gone
without having seen it.

For the same reason it never unregisters the workspace. Clearing a stale registration is `workspaces remove`'s job, and
listing them is [`status`](./status.md)'s.

`<path>` below is `<registered workspace path>/<skill>`.

## `unlink <skill> <workspaces...>`

Each pair gets one outcome, decided by what sits at `<path>`:

```shell
$ grimoire unlink triage personal work
unlinked triage → personal
not linked triage → work
```

| At `<path>`                         | Outcome  | Output                                                                                           |
| ----------------------------------- | -------- | ------------------------------------------------------------------------------------------------ |
| the link                            | removed  | stdout `unlinked <skill> → <workspace>`                                                          |
| nothing                             | success  | stdout `not linked <skill> → <workspace>`                                                        |
| the workspace does not resolve      | declined | stderr `warning: could not unlink <skill> → <workspace>: <path> workspace path does not resolve` |
| the workspace cannot be read        | declined | stderr `warning: could not unlink <skill> → <workspace>: <path> workspace path cannot be read`   |
| a directory                         | declined | stderr `warning: could not unlink <skill> → <workspace>: <path> is a directory, not a link`      |
| anything else that is not a symlink | declined | stderr `warning: could not unlink <skill> → <workspace>: <path> is not a link`                   |
| a symlink resolving anywhere else   | declined | stderr `warning: could not unlink <skill> → <workspace>: <path> is a symlink pointing elsewhere` |

Lines print grouped as `unlinked`, then `not linked`, then warnings, each group in argument order. A decline alongside any
`unlinked` or `not linked` pair prints as a warning on stderr, and the exit code stays 0:

```shell
$ grimoire unlink triage personal work
unlinked triage → personal
warning: could not unlink triage → work: /Users/me/work/.agents/skills/triage workspace path does not resolve
```

### When every pair is declined

A run where every pair was declined exits 1 instead of warning. One refusal prints as a single line:

```shell
$ grimoire unlink triage work
error: could not unlink triage → work: /Users/me/work/.agents/skills/triage is a directory, not a link
```

Several print `error: nothing unlinked:`, followed by each sentence on its own line, indented two spaces:

```shell
$ grimoire unlink triage personal work
error: nothing unlinked:
  could not unlink triage → personal: /Users/me/.claude/skills/triage is not a link
  could not unlink triage → work: /Users/me/work/.agents/skills/triage is a directory, not a link
```

## `unlink <skill> --all-workspaces`

Every registered workspace — auto-link or manual — sorted by name. Each is treated exactly as if it had been named, so
outcomes, grouping, warnings, and the exit code follow the rules above, with name order in place of argument order:

```shell
$ grimoire unlink triage --all-workspaces
unlinked triage → personal
not linked triage → scratch
warning: could not unlink triage → work: /Users/me/work/.agents/skills/triage is a directory, not a link
```

If no workspace is registered, the exit code is 0:

```shell
$ grimoire unlink triage --all-workspaces
nothing to unlink: no workspace is registered
```

## What `unlink` refuses

A refusal exits 1 and touches nothing. The checks run in the order below.

**1. Workspaces are given.** Either `<workspaces...>` or `--all-workspaces` is required.

```shell
$ grimoire unlink triage
error: missing required argument 'workspaces' (or use --all-workspaces)
```

**2. Not both at once.**

```shell
$ grimoire unlink triage personal --all-workspaces
error: --all-workspaces cannot be combined with named workspaces
```

**3. The skill exists in the store.**

```shell
$ grimoire unlink ghost-skill personal
error: no skill named "ghost-skill"
```

**4. Every named workspace is registered.** Only the first unregistered name is reported.

```shell
$ grimoire unlink triage personal ghost
error: no workspace named "ghost"
```
