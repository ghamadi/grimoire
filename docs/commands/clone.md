# `clone`

`clone` copies a store skill into one or more workspaces and records each copy. Use it for a workspace that cannot use a
link. A clone does not follow the store. It changes only when `--overwrite` replaces it with the store copy.

`clone --drop` forgets clone records. It never touches the cloned directory.

```shell
grimoire clone <skill> --to <workspaces...> [--overwrite]
grimoire clone <skill> --drop <targets...>
```

## Arguments

| Argument               | Meaning                                                                                                                                                                                  |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<skill>`              | The store skill to copy. Must exist, and pass the portability check, before any destination is examined. With `--drop`, the skill the records belong to, which need not be in the store. |
| `--to <workspaces...>` | Registered workspace names to clone into. Left out, you [choose them](#choosing-workspaces).                                                                                             |
| `--overwrite`          | Replaces a skill directory already at the destination with the store copy, deleting the old directory. Not allowed with `--drop`.                                                        |
| `--drop <targets...>`  | Workspace names or recorded paths whose records to forget. Left out, you [choose them](#choosing-clones-to-drop).                                                                        |

Repeated names follow [the shared rule](../conventions.md#arguments).

## What counts as the clone

`<dest>` below is `<workspace path>/<skill>`. A clone is a record naming a directory, as
[defined in the conventions](../conventions.md#links-and-clones). `clone` writes only `{ workspace }` records.

## `clone <skill> --to <workspaces...> [--overwrite]`

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
$ grimoire clone triage --to personal work scratch old
cloned triage → personal
cloned triage → work (replaced the link)
adopted triage → scratch
already cloned triage → old
```

A directory with no `SKILL.md` is declined instead, alongside whatever else succeeds:

```shell
$ grimoire clone triage --to personal lab
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

Adopting writes one record and touches nothing on disk. [`clone --drop`](#clone-skill---drop-targets) drops the record and
leaves the directory.

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
$ grimoire clone triage --to personal work scratch old lab --overwrite
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
$ grimoire clone triage --to a b c --overwrite
cloned triage → a (replaced the directory)
cloned triage → b (replaced the directory)
error: failed to clone triage → c: /Users/me/c/.agents/skills/.grimoire-staging is not a directory
```

## Choosing workspaces

Without `--to`, `clone` offers every registered workspace in name order,
[as the conventions describe](../conventions.md#missing-destinations). What you pick is cloned into as if named after `--to`.

With no workspace registered, or nothing picked, the exit code is 0:

```shell
$ grimoire clone triage
nothing to clone: no workspace is registered
```

```shell
$ grimoire clone triage
nothing to clone: no workspace selected
```

## `clone <skill> --drop <targets...>`

Each target gets one outcome, decided by whether a record resolves to it:

| Record for this directory | Outcome | Output                                 |
| ------------------------- | ------- | -------------------------------------- |
| exists                    | dropped | stdout `uncloned <skill> → <target>`   |
| none                      | —       | stdout `not cloned <skill> → <target>` |

`<target>` prints as the workspace name as given, or the path normalized.

```shell
$ grimoire clone triage --drop personal /Users/me/old/skills
uncloned triage → personal
not cloned triage → /Users/me/old/skills
```

Results print in the groups `uncloned`, `not cloned`, laid out as [the conventions](../conventions.md#outcomes) describe.
Apart from a refusal, the run exits 0.

### What a target may be

A target that is a valid [workspace name](../state.md#names) is one, and it must be registered. Anything else is a path:
normalized, then matched against the directory each record resolves to. A relative path with no separator reads as a name, so
write `./skills` rather than `skills`.

A target matches any record for its directory, whichever form the record takes. See
[links and clones](../conventions.md#links-and-clones).

### Nothing is ever declined

`clone --drop` reads only `state.json`, so an
[unreachable or unreadable](../conventions.md#unreachable-and-unreadable-workspaces) workspace is never declined.

## Choosing clones to drop

With `--drop` and no target named, `clone` offers the skill's clone records in record order,
[as the conventions describe](../conventions.md#missing-destinations). Each is labeled by its workspace name, or by its path
normalized. What you pick is forgotten as if named after `--drop`.

```shell
$ grimoire clone triage --drop | cat
error: no clone named, and no terminal to choose from
  name them after --drop: personal '/Users/me/My Projects/skills'
```

With no record for the skill, or nothing picked, the exit code is 0:

```shell
$ grimoire clone triage --drop
nothing to unclone: triage has no clone records
```

```shell
$ grimoire clone triage --drop
nothing to unclone: no clone selected
```

## What `clone` refuses

The [refusals](../conventions.md#refusals) run in this order:

**1. A skill is given.**

**2. Not `--to` and `--drop` at once.**

```shell
$ grimoire clone triage --to personal --drop work
error: --to cannot be combined with --drop
```

**3. `--overwrite` stays out of `--drop`.**

```shell
$ grimoire clone triage --drop personal --overwrite
error: --overwrite cannot be combined with --drop
```

**4. The skill exists in the store.** `--drop` skips this check.

**5. The skill passes the portability check.** Checked once for the whole run. `--drop` skips this check.

**6. Every named workspace is registered.** With `--drop`, every target that is a workspace name.
