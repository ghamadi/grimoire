# `export`

`export` copies store skills into a registered [repo](./repos.md), replacing what is there. From then on history, review, and
sharing belong to git and to you: grimoire commits nothing, and records nothing about what it exported.

```shell
grimoire export <repo> <skills...> [--force]
```

## Arguments

| Argument      | Meaning                                                                                                    |
| ------------- | ---------------------------------------------------------------------------------------------------------- |
| `<repo>`      | The registered repo to export into — see [`repos add`](./repos.md#repos-add-name-path).                    |
| `<skills...>` | Store skills to copy. Each must exist, and pass the portability check, before any destination is examined. |
| `--force`     | Replaces the destination even when git reports uncommitted changes there, potentially overwriting them.    |

At least one skill is required. A name given twice counts once, keeping its first position.

## What `export` checks

`<dest>` below is `<repo path>/<skill>`. A repo is flat, so each skill has exactly one destination.

`export` has one rule for a destination:

> If git reports nothing uncommitted at or under `<dest>`, replace whatever is there. Otherwise decline, unless `--force`.

Git already holds every committed byte, so a destination git calls clean is safe to replace. There is no record, no
`SKILL.md` check, and no comparison against the store — see [the rule](../safety.md).

"Uncommitted" is anything `git status` lists at or under `<dest>`: modified, staged, deleted, or untracked. Ignored files
[do not count](#ignored-files-are-deleted).

Git is asked about `<dest>` without regard to case, because a case-insensitive filesystem serves `Triage/` at `triage`. On a
case-sensitive one, uncommitted changes under a sibling that differs only in case decline the export too.

Git is run read-only. `export` asks two questions — `rev-parse`, for whether the repo is inside a work tree, and `status`,
for what is uncommitted — and never stages, commits, or changes a config.

## `export <repo> <skills...> [--force]`

Each skill gets one outcome:

| At `<dest>`         | `--force` | Outcome  | Output                                                                              |
| ------------------- | --------- | -------- | ----------------------------------------------------------------------------------- |
| nothing uncommitted | either    | replaced | stdout `exported <skill> → <repo>`                                                  |
| uncommitted changes | no        | declined | stderr `warning: could not export <skill> → <repo>: <dest> has uncommitted changes` |
| uncommitted changes | yes       | replaced | stdout `exported <skill> → <repo>`                                                  |
| (the write failed)  | either    | failed   | stderr `error: failed to export <skill> → <repo>: <reason>`, and the run carries on |

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

Lines print grouped as `exported`, then warnings, then failures, each group in argument order. Warnings are the decline
warnings first, then the [stranded old copy](#writes-are-staged) warnings. A decline alongside any exported skill prints as a
warning on stderr, and the exit code stays 0. A skill whose write [failed](#when-a-write-fails) prints last, after every
other line, and the exit code is 1 when any skill failed.

### A committed entry of the same name is replaced

Whatever is committed at `<dest>` is replaced without `--force` — a skill directory, a directory that is not a skill, a file.
Git holds it, so nothing is lost.

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

In a bulk run, the decline warnings are the list of skills still waiting on a commit.

### `--force` skips the git check and nothing else

Under `--force` git is not asked what is uncommitted at `<dest>`: whatever is there is replaced by the store copy. When the
uncommitted change is only an earlier export, nothing is lost. An edit made in the repo's copy and never committed is
overwritten, and git cannot bring it back.

[Everything `export` refuses](#what-export-refuses) is still refused — the repo must still be an existing directory inside a
git work tree, and every skill must still exist and be portable.

```shell
$ grimoire export library triage --force
exported triage → library
```

### Nothing at the destination is clean

Git reports nothing uncommitted where nothing exists, so a first export needs no flag.

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

### The copy is verbatim

`copyTree` — dotfiles, nested directories, and symlinks included, the same as [`clone`](./clone.md#the-copy-is-verbatim).
Every skill is verified for portability first.

### Writes are staged

Every write goes through `<repo path>/.grimoire-staging/`, the same mechanism and directory name `clone` uses in a workspace:
see [Writes are staged](./clone.md#writes-are-staged) for the steps. `<dest>` only ever holds the whole old entry or the
whole new copy, never a partial one.

If `.grimoire-staging` exists and is not a real directory — a file, or a symlink — every skill [fails](#when-a-write-fails),
leaving each `<dest>` untouched.

```shell
$ grimoire export library triage
error: failed to export triage → library: /Users/me/library/.grimoire-staging is not a directory
```

A skill whose write fails leaves `<dest>` as it was: an old entry already moved aside is put back.

A failed delete of the old copy is not a failure: the new copy is complete and in place, so the skill is `exported`, and a
warning names the stranded `.outgoing` entry.

```shell
$ grimoire export library triage
exported triage → library
warning: exported triage → library, but the old copy at /Users/me/library/.grimoire-staging/triage.4f9a1c.outgoing could not be fully deleted: EACCES: permission denied, rmdir '/Users/me/library/.grimoire-staging/triage.4f9a1c.outgoing/refs'
```

In a repo, a `.grimoire-staging` left behind shows up as untracked in your own `git status`. It never blocks a later export:
the check looks only at or under `<dest>`.

### When every skill is declined

A run where every skill was declined, and no skill failed, exits 1 instead of warning. The error ends with a line naming
`--force`. One refusal prints as a single sentence:

```shell
$ grimoire export library triage
error: could not export triage → library: /Users/me/library/triage has uncommitted changes
  commit first, or use --force to overwrite them
```

Several print `error: nothing exported:`, followed by each sentence on its own line, indented two spaces:

```shell
$ grimoire export library triage review
error: nothing exported:
  could not export triage → library: /Users/me/library/triage has uncommitted changes
  could not export review → library: /Users/me/library/review has uncommitted changes
  commit first, or use --force to overwrite them
```

A decline warning beside an exported skill carries no `--force` line.

### When a write fails

A failed [staged write](#writes-are-staged) is one skill's outcome, not the end of the run. The remaining skills are still
attempted, and every `exported` and warning line prints. The failures print last, and the run exits 1.

A failure reads `failed to export`, where a decline reads `could not export`: a decline touched nothing, a failure was a
write that was attempted and undone.

One failure prints as a single line:

```shell
$ grimoire export library triage
error: failed to export triage → library: EACCES: permission denied, mkdir '/Users/me/library/.grimoire-staging'
```

Several print `error: exports failed:`, followed by each sentence on its own line, indented two spaces:

```shell
$ grimoire export library triage review
error: exports failed:
  failed to export triage → library: /Users/me/library/.grimoire-staging is not a directory
  failed to export review → library: /Users/me/library/.grimoire-staging is not a directory
```

A run with any failed skill exits 1, whether or not other skills were exported or declined. The
[every skill declined](#when-every-skill-is-declined) form applies only when no skill failed; declines alongside a failure
print as warnings.

## What `export` refuses

A refusal exits 1 and touches nothing. The checks run in the order below.

**1. Skills are given.**

```shell
$ grimoire export library
error: missing required argument 'skills'
```

**2. The repo is registered.**

```shell
$ grimoire export ghost triage
error: no repo named "ghost"
```

**3. Every skill exists in the store.** Only the first unknown name is reported, and it is reported ahead of any skill that
fails the next check.

```shell
$ grimoire export library triage ghost
error: no skill named "ghost"
```

**4. Every skill passes the portability check.** Under `--force` too.

```shell
$ grimoire export library triage
error: skill "/Users/me/.grimoire/skills/triage" is not portable. Contains a nested skill.
```

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
