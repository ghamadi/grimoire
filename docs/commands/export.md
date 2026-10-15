# `export`

`export` copies store skills into a registered [repo](./repos.md), replacing what is there. From then on history, review, and
sharing belong to git and to you: grimoire commits nothing, and records nothing about what it exported.

```shell
grimoire export <repo> <skills...> [--force]
grimoire export <repo> --all-skills [--force]
```

## Arguments

| Argument       | Meaning                                                                                                    |
| -------------- | ---------------------------------------------------------------------------------------------------------- |
| `<repo>`       | The registered repo to export into — see [`repos add`](./repos.md#repos-add-name-path).                    |
| `<skills...>`  | Store skills to copy. Each must exist, and pass the portability check, before any destination is examined. |
| `--all-skills` | Every skill the store holds, instead of naming any.                                                        |
| `--force`      | Replaces the destination even when git reports uncommitted changes there, potentially overwriting them.    |

One of `<skills...>` or `--all-skills` is required, and the two are mutually exclusive. Repeated names follow
[the shared rule](../conventions.md#arguments).

## What `export` checks

`<dest>` below is `<repo path>/<skill>`. A repo is flat, so each skill has exactly one destination.

`export` has one rule for a destination:

> If git reports nothing uncommitted at or under `<dest>`, replace whatever is there. Otherwise decline, unless `--force`.

There is no record, no `SKILL.md` check and no comparison against the store. Every copy is
[verbatim](../conventions.md#copies).

"Uncommitted" is anything `git status` lists at or under `<dest>`: modified, staged, deleted, or untracked. Ignored files
[do not count](#ignored-files-are-deleted).

Git is asked about `<dest>` without regard to case, because a case-insensitive filesystem serves `Triage/` at `triage`. On a
case-sensitive one, uncommitted changes under a sibling that differs only in case decline the export too.

Git is run read-only. `export` asks git whether the repo is inside a work tree and what is uncommitted. It never stages,
commits or changes a config.

## `export <repo> <skills...> [--force]`

Each skill gets one outcome:

| At `<dest>`                     | `--force` | Outcome  | Output                                                                              |
| ------------------------------- | --------- | -------- | ----------------------------------------------------------------------------------- |
| nothing, or nothing uncommitted | either    | replaced | stdout `exported <skill> → <repo>`                                                  |
| uncommitted changes             | no        | declined | stderr `warning: could not export <skill> → <repo>: <dest> has uncommitted changes` |
| uncommitted changes             | yes       | replaced | stdout `exported <skill> → <repo>`                                                  |

```shell
$ grimoire export library triage review
exported triage → library
exported review → library
```

A skill whose destination has uncommitted changes is declined, alongside whatever else succeeds:

```shell
$ grimoire export library triage review
exported review → library
warning: could not export triage → library: /Users/me/library/triage has uncommitted changes
```

The `exported` line is the same whether or not something was replaced. What was replaced is git's to show: `git status` and
`git diff` in the repo.

Results print as `exported` lines, laid out as [the conventions](../conventions.md#outcomes) describe.

### A committed entry of the same name is replaced

Whatever is committed at `<dest>` is replaced without `--force`: a skill directory, a directory that is not a skill, or a
file.

```shell
$ ls ~/library
triage              # a committed directory of notes, no SKILL.md
$ grimoire export library triage
exported triage → library
```

`git status` then shows the notes deleted and the skill's files untracked. The notes are still in git's history.

### Re-exporting before a commit declines

The first export of a new skill leaves `<dest>` untracked. Untracked is uncommitted, so a second export declines until you
commit, or pass `--force`.

```shell
$ grimoire export library triage
exported triage → library
$ grimoire export library triage
error: could not export triage → library: /Users/me/library/triage has uncommitted changes
  commit first, or use --force to overwrite them
```

### `--force` skips the git check and nothing else

Under `--force` git is not asked what is uncommitted at `<dest>`, and whatever is there is replaced by the store copy. When
the uncommitted change is only an earlier export, nothing is lost. An edit made in the repo's copy and never committed is
overwritten, and git cannot bring it back.

[Everything `export` refuses](#what-export-refuses) is still refused.

```shell
$ grimoire export library triage --force
exported triage → library
```

### Ignored files are deleted

A file git ignores is never listed by `git status`, so it does not make a destination uncommitted. A plain `export` replaces
a destination that holds ignored files, the ignored files are deleted with the rest, and git cannot bring them back.

```shell
$ cat ~/library/.gitignore
*.log
$ ls ~/library/triage
SKILL.md   debug.log
$ grimoire export library triage
exported triage → library
$ ls ~/library/triage
SKILL.md
```

Ignored files are left out of the check on purpose. Counting them would let a globally ignored `.DS_Store` block every export
once Finder had opened the folder.

### Writes are staged

Every write is [staged](../conventions.md#staged-writes) in `<repo path>/.grimoire-staging/`. One left behind shows up as
untracked in your own `git status`. It never blocks a later export, because the check looks only at or under `<dest>`.

### When every skill is declined

The run exits 1 and prints the declines as an error,
[as the conventions describe](../conventions.md#when-every-destination-is-declined), headed `nothing exported` when there are
several. The error then ends with the line `commit first, or use --force to overwrite them`:

```shell
$ grimoire export library triage
error: could not export triage → library: /Users/me/library/triage has uncommitted changes
  commit first, or use --force to overwrite them
```

```shell
$ grimoire export library triage review
error: nothing exported:
  could not export triage → library: /Users/me/library/triage has uncommitted changes
  could not export review → library: /Users/me/library/review has uncommitted changes
  commit first, or use --force to overwrite them
```

A decline warning beside an exported skill carries no `--force` line.

### When a write fails

Failures print last and the run exits 1, [as the conventions describe](../conventions.md#when-a-write-fails), headed
`exports failed` when there are several.

## `export <repo> --all-skills [--force]`

Exports every skill the store holds in name order, [as if named](../conventions.md#arguments). `--force` applies to every
destination.

```shell
$ grimoire export library --all-skills
exported review → library
exported triage → library
```

If the store holds no skills, the exit code is 0:

```shell
$ grimoire export library --all-skills
nothing to export: the store holds no skills
```

Checks 2 and 5 of [What `export` refuses](#what-export-refuses) still run first, so an unknown repo, or one whose path fails
check 5, refuses with exit 1 even when the store is empty.

## What `export` refuses

The [refusals](../conventions.md#refusals) run in this order:

**1. Skills are given, or `--all-skills`, and not both.**

```shell
$ grimoire export library triage --all-skills
error: --all-skills cannot be combined with named skills
```

**2. The repo is registered.**

**3. Every skill exists in the store.**

**4. Every skill passes the portability check.** Under `--force` too. Under `--all-skills`, one unportable skill refuses the
whole run.

**5. The repo path is an existing directory inside a git work tree, and git can be run.** A repo is checked when it is
registered and again on every `export`, because the directory can change afterwards.

```shell
$ grimoire export library triage
error: /Users/me/library does not exist
```

```shell
$ grimoire export library triage
error: /Users/me/library is not a directory
```

```shell
$ grimoire export library triage
error: /Users/me/library is not inside a git work tree
```

```shell
$ grimoire export library triage
error: could not run git: repos need it installed and on your PATH
```
