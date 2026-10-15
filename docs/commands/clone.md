# `clone`

`clone` copies a store skill into one or more workspaces and records each copy. Use it for a workspace that cannot use a
link. A clone does not follow the store. It changes only when `--overwrite` replaces it with the store copy.

```shell
grimoire clone <skill> <workspaces...> [--overwrite]
```

## Arguments

| Argument          | Meaning                                                                                                  |
| ----------------- | -------------------------------------------------------------------------------------------------------- |
| `<skill>`         | The store skill to copy. Must exist, and pass the portability check, before any destination is examined. |
| `<workspaces...>` | Registered workspace names to clone into.                                                                |
| `--overwrite`     | Replaces a skill directory already at the destination with the store copy, deleting the old directory.   |

At least one workspace is required. Repeated names follow [the shared rule](../conventions.md#arguments).

## What counts as the clone

`<dest>` below is `<workspace path>/<skill>`. A clone is a record naming a directory, as
[defined in the conventions](../conventions.md#links-and-clones). `clone` writes only `{ workspace }` records.

## `clone <skill> <workspaces...> [--overwrite]`

Each pair gets one outcome, decided by what sits at `<dest>`. The first two rows are an unreachable and an unreadable
workspace, as [defined in the conventions](../conventions.md#unreachable-and-unreadable-workspaces).

| At `<dest>`                                           | Outcome                          | Output                                                                                                 |
| ----------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------ |
| workspace path does not resolve                       | declined                         | stderr `warning: could not clone <skill> → <workspace>: <workspace path> is not an existing directory` |
| workspace path cannot be read                         | declined                         | stderr `warning: could not clone <skill> → <workspace>: <workspace path> cannot be read`               |
| nothing                                               | copied and recorded              | stdout `cloned <skill> → <workspace>`                                                                  |
| a symlink resolving to this store skill               | link replaced, recorded          | stdout `cloned <skill> → <workspace> (replaced the link)`                                              |
| any other symlink                                     | declined                         | stderr `warning: could not clone <skill> → <workspace>: <dest> is a symlink pointing elsewhere`        |
| a directory, recorded, no `--overwrite`               | left alone, contents not checked | stdout `already cloned <skill> → <workspace>`                                                          |
| a directory, recorded, `--overwrite`                  | replaced, record kept            | stdout `cloned <skill> → <workspace> (replaced the directory)`                                         |
| a directory, unrecorded, `SKILL.md`, no `--overwrite` | recorded                         | stdout `adopted <skill> → <workspace>`                                                                 |
| a directory, unrecorded, `SKILL.md`, `--overwrite`    | replaced and recorded            | stdout `cloned <skill> → <workspace> (replaced the directory)`                                         |
| a directory, unrecorded, no `SKILL.md`                | declined                         | stderr `warning: could not clone <skill> → <workspace>: <dest> is a directory with no SKILL.md`        |
| anything else                                         | declined                         | stderr `warning: could not clone <skill> → <workspace>: <dest> is not a directory`                     |

```shell
$ grimoire clone triage personal work scratch old
cloned triage → personal
cloned triage → work (replaced the link)
adopted triage → scratch
already cloned triage → old
```

A directory with no `SKILL.md` is declined instead, alongside whatever else succeeds:

```shell
$ grimoire clone triage personal lab
cloned triage → personal
warning: could not clone triage → lab: /Users/me/lab/skills/triage is a directory with no SKILL.md
```

Every copy is [verbatim](../conventions.md#copies).

Results print in the groups `cloned`, `adopted`, `already cloned`, laid out as [the conventions](../conventions.md#outcomes)
describe.

### Missing directories and duplicate records

If a record names `<dest>` but the directory is gone, `<dest>` reads as the "nothing" row. The copy is made again, and the
existing record is left as it is. A record already naming `<dest>`, in either form, is never duplicated. `clone` does not add
a `{ workspace }` record for a directory a `{ path }` record already names.

### Adoption is the default

Adopting writes one record and touches nothing on disk. [`unclone`](./unclone.md) drops the record and leaves the directory.

Its only check is that `SKILL.md` is there. The content is never compared against the store, so a directory that differs from
the store copy is adopted as it is.

A directory with no `SKILL.md` is the case most likely to be unrelated content sharing the name, so it is declined.

### Writes are staged

A write happens when there is nothing at `<dest>`, a link to this skill, or a directory under `--overwrite`. Every write is
[staged](../conventions.md#staged-writes) in `<workspace path>/.grimoire-staging/`. A failed write writes no record. A write
whose old copy could not be fully deleted still counts as `cloned` and is recorded.

### `--overwrite` replaces a skill directory

With `--overwrite`, a skill directory at `<dest>` is replaced by the store copy. It replaces:

- A recorded directory, whether or not it still holds `SKILL.md`. The record is kept as it is.
- An unrecorded directory that holds `SKILL.md`. It is recorded after the copy, as on any clone.

A plain run [adopts](#adoption-is-the-default) directories written by hand, so a record does not prove grimoire wrote the
directory. Only the flag lets `clone` replace one.

It still declines everything a plain run declines: a directory with neither a record nor `SKILL.md`, a foreign symlink,
anything that is not a directory, and an unreachable or unreadable workspace. The flag never turns a decline into a delete.

It changes nothing for a pair with nothing at `<dest>`, or a symlink to this skill: those print the same `cloned` lines as a
plain run. Under the flag no pair is ever `adopted` or `already cloned`.

Nothing is compared, so an identical directory is rewritten like any other. The old directory is not backed up. Only the
workspace's own version control can bring it back.

```shell
$ grimoire clone triage personal work scratch old lab --overwrite
cloned triage → personal
cloned triage → work (replaced the link)
cloned triage → scratch (replaced the directory)
cloned triage → old (replaced the directory)
warning: could not clone triage → lab: /Users/me/lab/skills/triage is a directory with no SKILL.md
```

### When every pair is declined

The run exits 1 and prints the declines as an error,
[as the conventions describe](../conventions.md#when-every-destination-is-declined), headed `nothing cloned` when there are
several.

### When a write fails

Failures print last and the run exits 1, [as the conventions describe](../conventions.md#when-a-write-fails), headed
`clones failed` when there are several. Pairs written before a failure stay written and recorded, and print. With
`--overwrite` their old directories are already deleted, so their lines matter most:

```shell
$ grimoire clone triage a b c --overwrite
cloned triage → a (replaced the directory)
cloned triage → b (replaced the directory)
error: failed to clone triage → c: /Users/me/c/.agents/skills/.grimoire-staging is not a directory
```

## What `clone` refuses

The [refusals](../conventions.md#refusals) run in this order:

**1. Workspaces are given.**

**2. The skill exists in the store.**

**3. The skill passes the portability check.** Checked once for the whole run.

**4. Every named workspace is registered.**
