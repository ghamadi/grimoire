# `unclone`

`unclone` forgets clone records — where `unlink` removes a symlink, `unclone` never touches the cloned directory at all.

```shell
grimoire unclone <skill> <targets...>
```

## Arguments

| Argument       | Meaning                                                                                                                                                                                                                                               |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<skill>`      | The skill the records belong to. Need not be in the store — [`skills remove`](./skills.md#skills-remove-skills---forget-clones-alias-rm) without `--forget-clones` deliberately leaves records behind, and this is how they're cleared one at a time. |
| `<targets...>` | Workspace names or recorded paths. A target given twice counts once, keeping its first position.                                                                                                                                                      |

## What a target may be

A target that is a valid [workspace name](../state.md#names) is one, and it must be registered. Anything else is a path:
normalized, then matched against the directory each record resolves to. A relative path with no separator reads as a name, so
write `./skills` rather than `skills`.

## `unclone <skill> <targets...>`

Each target gets one outcome, decided by whether a record resolves to it:

| Record for this directory | Outcome | Output                                 |
| ------------------------- | ------- | -------------------------------------- |
| exists                    | dropped | stdout `uncloned <skill> → <target>`   |
| none                      | —       | stdout `not cloned <skill> → <target>` |

`<target>` prints as the workspace name as given, or the path normalized.

```shell
$ grimoire unclone triage personal /Users/me/old/skills
uncloned triage → personal
not cloned triage → /Users/me/old/skills
```

`uncloned` lines print first, then `not cloned`, each group in argument order. Argument parsing aside, the run always exits 0
— there is no decline.

### Nothing is ever declined

`unclone` reads no directory, only `state.json`, so an unreachable workspace is not a reason to decline a target — it's only
ever a reason for the run's [workspace check](#what-unclone-refuses) to fail up front.

### Matching is by directory, not by record arm

A name target matches a `{ path }` record for the same directory, and a path target matches a `{ workspace }` record for the
same directory — [the record's identity is the directory it resolves to](./clone.md#what-counts-as-the-clone), never which
arm wrote it.

### A misspelled skill prints `not cloned`, not an error

There is no skill-existence check. Since orphaned records — the whole point of this command — belong to skills that may no
longer be in the store, a name typo just reads as "no record here" and exits 0. That's the cost of keeping orphaned records
reachable.

## What `unclone` refuses

A refusal exits 1 and drops no record. The checks run in the order below.

**1. Targets are given.**

```shell
$ grimoire unclone triage
error: missing required argument 'targets'
```

**2. Every named workspace is registered.** Only the first unregistered name is reported, and it refuses the run before any
record is dropped.

```shell
$ grimoire unclone triage personal ghost
error: no workspace named "ghost"
```
