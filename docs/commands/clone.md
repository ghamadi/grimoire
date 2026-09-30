# `clone`

`clone` copies a store skill into one or more workspaces, and records each copy — where `link` symlinks it. A clone is
expected to drift: once copied, it is never refreshed or overwritten.

```shell
grimoire clone <skill> <workspaces...> [--adopt]
```

## Arguments

| Argument          | Meaning                                                                                                  |
| ----------------- | -------------------------------------------------------------------------------------------------------- |
| `<skill>`         | The store skill to copy. Must exist, and pass the portability check, before any destination is examined. |
| `<workspaces...>` | Registered workspace names to clone into.                                                                |
| `--adopt`         | Records an unrecorded skill directory already sitting at the destination, instead of declining it.       |

At least one workspace is required. A name given twice counts once, keeping its first position.

## What counts as the clone

A clone is a record in `state.json` naming a directory — nothing on disk marks a cloned directory as such; it looks exactly
like one you wrote by hand. `<dest>` below is `<workspace path>/<skill>`.

The record's identity is the directory it resolves to, compared canonically — not which of two arms it uses: a
`{ workspace }` record, or a `{ path }` record left behind by
[`workspaces remove`](./workspaces.md#workspaces-remove-name---hard---force-alias-rm). So a record `workspaces remove` left
keyed by path still counts as already cloned once a workspace is re-registered at that path, and [`unclone`](./unclone.md)
finds it too. `clone` itself only ever writes `{ workspace }` records — it never creates a new kind.

## `clone <skill> <workspaces...> [--adopt]`

Each pair gets one outcome, decided by what sits at `<dest>`:

| At `<dest>`                                       | Outcome                                                  | Output                                                                                                                                 |
| ------------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| workspace path does not resolve                   | declined `workspace-unreachable`                         | stderr `warning: could not clone <skill> → <workspace>: <workspace path> is not an existing directory`                                 |
| workspace path cannot be read                     | declined `workspace-unreadable`                          | stderr `warning: could not clone <skill> → <workspace>: <workspace path> cannot be read`                                               |
| nothing                                           | copy, record → `cloned`                                  | stdout `cloned <skill> → <workspace>`                                                                                                  |
| a symlink resolving to this store skill           | remove link, copy, record → `cloned (replaced the link)` | stdout `cloned <skill> → <workspace> (replaced the link)`                                                                              |
| any other symlink                                 | declined `foreign-symlink`                               | stderr `warning: could not clone <skill> → <workspace>: <dest> is a symlink pointing elsewhere`                                        |
| a directory, recorded                             | `already cloned` — content never inspected               | stdout `already cloned <skill> → <workspace>`                                                                                          |
| a directory, unrecorded, no `--adopt`             | declined `unrecorded-directory`                          | stderr `warning: could not clone <skill> → <workspace>: <dest> already holds a directory — rerun with --adopt to keep it as the clone` |
| a directory, unrecorded, `--adopt`, `SKILL.md`    | record → `adopted`                                       | stdout `adopted <skill> → <workspace>`                                                                                                 |
| a directory, unrecorded, `--adopt`, no `SKILL.md` | declined `not-a-skill`                                   | stderr `warning: could not clone <skill> → <workspace>: <dest> holds no SKILL.md, so it cannot be adopted`                             |
| anything else                                     | declined `not-a-directory`                               | stderr `warning: could not clone <skill> → <workspace>: <dest> is not a directory`                                                     |

```shell
$ grimoire clone triage personal work scratch old --adopt
cloned triage → personal
cloned triage → work (replaced the link)
adopted triage → scratch
already cloned triage → old
```

The same run without `--adopt` cannot produce that `adopted` line — adoption only happens when it's asked for. A plain run
instead declines an unrecorded directory it finds, alongside whatever else succeeds:

```shell
$ grimoire clone triage personal lab
cloned triage → personal
warning: could not clone triage → lab: /Users/me/lab/skills/triage already holds a directory — rerun with --adopt to keep it as the clone
```

Lines print grouped as `cloned`, `adopted`, `already cloned`, then warnings, each group in argument order. A decline
alongside any non-declined pair prints as a warning on stderr, and the exit code stays 0.

### The copy lands before the record

The copy is written first, then the record. A record never names a half-written directory. If grimoire crashes between the
two, the result is an unrecorded full copy on disk — indistinguishable from one you wrote by hand until the next
`clone --adopt` claims it.

### Missing directories and duplicate records

If a record names `<dest>` but nothing is there anymore — deleted by hand — `<dest>` reads as the "nothing" row: the copy is
made again, and the existing record is left as it is. A record already naming `<dest>`, by either arm, is never duplicated —
`clone` does not add a second `{ workspace }` record for a directory a `{ path }` record already names.

### Replacing a link is allowed

Removing a symlink to make room for the copy does not break
[the rule](../../ARCHITECTURE.md#the-rule-grimoire-never-loses-content-outside-its-store): the symlink is grimoire's own, and
holds no content of its own to lose.

### `--adopt` is opt-in

A directory of the same name at the destination may be a different skill, not a copy of this one. Its only check is that
`SKILL.md` is there — the content is never compared against the store, and adopting a directory that differs from the store
copy is the point of the flag.

### The copy is verbatim

`copyTree` — dotfiles, nested directories, and symlinks included, the same as `skills add`. The store skill is verified for
portability first, exactly as `link` does.

### A clone is never refreshed or overwritten

Re-running `clone` against a destination it already holds prints `already cloned` and touches nothing; there is no `--force`.
Giving up a drifted copy is a manual step: delete the directory yourself, then run `unclone` and `clone` again. See
[the rule](../../ARCHITECTURE.md#the-rule-grimoire-never-loses-content-outside-its-store).

### When every pair is declined

A run where every pair was declined exits 1 instead of warning. One refusal prints as a single line:

```shell
$ grimoire clone triage work
grimoire: could not clone triage → work: /Users/me/work/.agents/skills/triage is not a directory
```

Several print `grimoire: nothing cloned:`, followed by each sentence on its own line, indented two spaces:

```shell
$ grimoire clone triage personal work
grimoire: nothing cloned:
  could not clone triage → personal: /Users/me/.claude/skills/triage is a symlink pointing elsewhere
  could not clone triage → work: /Users/me/work/.agents/skills/triage already holds a directory — rerun with --adopt to keep it as the clone
```

## What `clone` refuses

A refusal exits 1 and touches nothing. The checks run in the order below.

**1. Workspaces are given.**

```shell
$ grimoire clone triage
error: missing required argument 'workspaces'
```

**2. The skill exists in the store.**

```shell
$ grimoire clone ghost personal
grimoire: no skill named "ghost"
```

**3. The skill passes the portability check.** Checked once for the whole run, not per workspace.

```shell
$ grimoire clone triage personal
grimoire: skill "/Users/me/.grimoire/skills/triage" is not portable. Contains a nested skill.
```

**4. Every named workspace is registered.** Only the first unregistered name is reported.

```shell
$ grimoire clone triage personal ghost
grimoire: no workspace named "ghost"
```
