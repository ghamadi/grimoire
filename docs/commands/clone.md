# `clone`

`clone` copies a store skill into one or more workspaces, and records each copy — where `link` symlinks it. A clone is a real
copy for a workspace that cannot use a link: it does not follow the store, and changes only when `--overwrite` replaces it
with the store copy.

```shell
grimoire clone <skill> <workspaces...> [--overwrite]
```

## Arguments

| Argument          | Meaning                                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------------------ |
| `<skill>`         | The store skill to copy. Must exist, and pass the portability check, before any destination is examined.           |
| `<workspaces...>` | Registered workspace names to clone into.                                                                          |
| `--overwrite`     | Replaces a skill directory already at the destination with the store copy. The old directory is deleted, not kept. |

At least one workspace is required. A name given twice counts once, keeping its first position.

## What counts as the clone

A clone is a record in `state.json` naming a directory — nothing on disk marks a cloned directory as such; it looks exactly
like one you wrote by hand. `<dest>` below is `<workspace path>/<skill>`.

The record's identity is the directory it resolves to, compared canonically — not which of two arms it uses: a
`{ workspace }` record, or a `{ path }` record left behind by
[`workspaces remove`](./workspaces.md#workspaces-remove-name---hard---force-alias-rm). So a record `workspaces remove` left
keyed by path still counts as already cloned once a workspace is re-registered at that path, and [`unclone`](./unclone.md)
finds it too. `clone` itself only ever writes `{ workspace }` records — it never creates a new kind.

## `clone <skill> <workspaces...> [--overwrite]`

Each pair gets one outcome, decided by what sits at `<dest>`:

| At `<dest>`                                           | Outcome                                             | Output                                                                                                 |
| ----------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| workspace path does not resolve                       | declined `workspace-unreachable`                    | stderr `warning: could not clone <skill> → <workspace>: <workspace path> is not an existing directory` |
| workspace path cannot be read                         | declined `workspace-unreadable`                     | stderr `warning: could not clone <skill> → <workspace>: <workspace path> cannot be read`               |
| nothing                                               | copy, record → `cloned`                             | stdout `cloned <skill> → <workspace>`                                                                  |
| a symlink resolving to this store skill               | replace link, record → `cloned (replaced the link)` | stdout `cloned <skill> → <workspace> (replaced the link)`                                              |
| any other symlink                                     | declined `foreign-symlink`                          | stderr `warning: could not clone <skill> → <workspace>: <dest> is a symlink pointing elsewhere`        |
| a directory, recorded, no `--overwrite`               | `already cloned` — content never inspected          | stdout `already cloned <skill> → <workspace>`                                                          |
| a directory, recorded, `--overwrite`                  | replace → `cloned (replaced the directory)`         | stdout `cloned <skill> → <workspace> (replaced the directory)`                                         |
| a directory, unrecorded, `SKILL.md`, no `--overwrite` | record → `adopted`                                  | stdout `adopted <skill> → <workspace>`                                                                 |
| a directory, unrecorded, `SKILL.md`, `--overwrite`    | replace, record → `cloned (replaced the directory)` | stdout `cloned <skill> → <workspace> (replaced the directory)`                                         |
| a directory, unrecorded, no `SKILL.md`                | declined `not-a-skill`                              | stderr `warning: could not clone <skill> → <workspace>: <dest> is a directory with no SKILL.md`        |
| anything else                                         | declined `not-a-directory`                          | stderr `warning: could not clone <skill> → <workspace>: <dest> is not a directory`                     |

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

Lines print grouped as `cloned`, `adopted`, `already cloned`, then warnings, then failures, each group in argument order.
Warnings are the decline warnings first, then the [stranded old copy](#writes-are-staged) warnings. A decline alongside any
non-declined pair prints as a warning on stderr, and the exit code stays 0. A pair whose write [failed](#when-a-write-fails)
prints last, after every other line, and the exit code is 1 when any pair failed.

### The copy lands before the record

The copy is written first, then the record, so the record is written after the swap. A record never names a half-written
directory. If grimoire crashes between the two, the result is an unrecorded full copy on disk — indistinguishable from one
you wrote by hand until the next `clone` adopts it.

### Missing directories and duplicate records

If a record names `<dest>` but nothing is there anymore — deleted by hand — `<dest>` reads as the "nothing" row: the copy is
made again, and the existing record is left as it is. A record already naming `<dest>`, by either arm, is never duplicated —
`clone` does not add a second `{ workspace }` record for a directory a `{ path }` record already names.

### Replacing a link is allowed

Moving a symlink aside to make room for the copy, and deleting it once the copy is in place (see
[Writes are staged](#writes-are-staged)), does not break [the rule](../safety.md): the symlink is grimoire's own, and holds
no content of its own to lose.

### Adoption is the default

Adopting writes one record and touches nothing on disk. [`unclone`](./unclone.md) drops the record and leaves the directory.

Its only check is that `SKILL.md` is there. The content is never compared against the store, so a directory that differs from
the store copy is adopted as it is. The `adopted` line names every pair it happened to, so an adoption is never silent.

A directory with no `SKILL.md` is the case most likely to be unrelated content sharing the name, so it is declined.

### The copy is verbatim

`copyTree` — dotfiles, nested directories, and symlinks included, the same as `skills add`. The store skill is verified for
portability first, exactly as `link` does.

### Writes are staged

Every write — nothing at `<dest>`, a link to this skill, a directory under `--overwrite` — goes through
`<workspace path>/.grimoire-staging/`:

1. The store skill is copied to `<workspace path>/.grimoire-staging/<skill>.<id>.incoming`.
2. Whatever is at `<dest>` is renamed to `<skill>.<id>.outgoing`, beside it.
3. The new copy is renamed to `<dest>`.
4. The outgoing entry is deleted.
5. `.grimoire-staging` is removed when it is empty.

`<id>` is random per write. `<dest>` only ever holds the whole old entry or the whole new copy, never a partial one. The
staging directory sits inside the workspace so both renames stay on one filesystem, and one level down so an agent listing
the workspace does not see a half-built skill.

If `.grimoire-staging` exists and is not a real directory — a file, or a symlink — every pair that would write to that
workspace [fails](#when-a-write-fails), leaving `<dest>` untouched. The run continues with the next pair. Pairs that do not
write never look at it.

```shell
$ grimoire clone triage work
error: failed to clone triage → work: /Users/me/work/.agents/skills/.grimoire-staging is not a directory
```

A pair whose write fails writes no record and leaves `<dest>` as it was: an old entry already moved aside is put back. The
incoming copy is deleted, and `.grimoire-staging` is removed when that leaves it empty.

Removing the empty `.grimoire-staging` is best-effort: it never fails a write.

A failed delete of the old copy is not a failure: the new copy is complete and in place, so the pair is `cloned` and
recorded, and a warning names the stranded `.outgoing` entry. The usual cause is a subdirectory in the old copy that you
cannot write to; the partly deleted `.outgoing` entry stays in `.grimoire-staging` until you `chmod` that subdirectory back
and remove it.

```shell
$ grimoire clone triage work --overwrite
cloned triage → work (replaced the directory)
warning: cloned triage → work, but the old copy at /Users/me/work/.agents/skills/.grimoire-staging/triage.4f9a1c.outgoing could not be fully deleted: EACCES: permission denied, rmdir '/Users/me/work/.agents/skills/.grimoire-staging/triage.4f9a1c.outgoing/refs'
```

Only filesystem errors — those carrying an errno `code` — and an unusable staging directory become failed pairs. Any other
error is a bug in grimoire and still crashes.

A killed grimoire (Ctrl-C, SIGKILL, power loss) skips all cleanup. It can strand entries in `.grimoire-staging`. If it died
between renaming the old entry aside and renaming the new copy in, `<dest>` is missing and the old entry is the `.outgoing`
one. A write whose rename in fails, and whose put-back then fails too, ends the same way. Once nothing in the directory is
wanted, `rm -rf <workspace path>/.grimoire-staging` is the whole cleanup. It fails on an entry that holds a subdirectory you
cannot write to until you `chmod` it back.

### `--overwrite` replaces a skill directory

With `--overwrite`, a skill directory at `<dest>` is replaced by the store copy. It replaces:

- A recorded directory, whether or not it still holds `SKILL.md` — the record is what makes it a clone. The record is kept as
  it is.
- An unrecorded directory that holds `SKILL.md`. It is recorded after the copy, as on any clone.

It still declines everything a plain run declines: a directory with neither a record nor `SKILL.md`, a foreign symlink,
anything that is not a directory, and an unreachable or unreadable workspace. The first is
[the case most likely to be unrelated content](#adoption-is-the-default), which is where a permanent delete is most likely a
mistake. The flag never turns a decline into a delete.

It changes nothing for a pair with nothing at `<dest>`, or a symlink to this skill: those print the same `cloned` lines as a
plain run. Under the flag no pair is ever `adopted` or `already cloned`.

A failed copy leaves the old directory untouched: it is deleted only after [the verbatim copy](#the-copy-is-verbatim) is in
place, see [Writes are staged](#writes-are-staged). Nothing is compared, so an identical directory is rewritten like any
other. Once the new copy is in place the old directory is not backed up; only the workspace's own version control can bring
it back.

The flag is the consent, not the record. A plain run [adopts](#adoption-is-the-default) a directory it finds, including one
written by hand, so a record does not prove grimoire wrote what it names.

Nothing is deleted for a skill that cannot be copied: [portability is checked](#what-clone-refuses) before any destination is
examined.

This is the one exception to [the rule](../safety.md), parallel to [replacing a link](#replacing-a-link-is-allowed).

```shell
$ grimoire clone triage personal work scratch old lab --overwrite
cloned triage → personal
cloned triage → work (replaced the link)
cloned triage → scratch (replaced the directory)
cloned triage → old (replaced the directory)
warning: could not clone triage → lab: /Users/me/lab/skills/triage is a directory with no SKILL.md
```

### When every pair is declined

A run where every pair was declined, and no pair failed, exits 1 instead of warning. One refusal prints as a single line:

```shell
$ grimoire clone triage work
error: could not clone triage → work: /Users/me/work/.agents/skills/triage is not a directory
```

Several print `error: nothing cloned:`, followed by each sentence on its own line, indented two spaces:

```shell
$ grimoire clone triage personal work
error: nothing cloned:
  could not clone triage → personal: /Users/me/.claude/skills/triage is a symlink pointing elsewhere
  could not clone triage → work: /Users/me/work/.agents/skills/triage is a directory with no SKILL.md
```

### When a write fails

A failed [staged write](#writes-are-staged) is one pair's outcome, not the end of the run. The remaining pairs are still
attempted, and every `cloned`, `adopted`, `already cloned` and warning line prints. The failures print last, and the run
exits 1.

A failure reads `failed to clone`, where a decline reads `could not clone`: a decline touched nothing, a failure was a write
that was attempted and undone.

One failure prints as a single line:

```shell
$ grimoire clone triage work
error: failed to clone triage → work: EACCES: permission denied, rename '/Users/me/work/.agents/skills/triage' -> '/Users/me/work/.agents/skills/.grimoire-staging/triage.4f9a1c.outgoing'
```

Several print `error: clones failed:`, followed by each sentence on its own line, indented two spaces:

```shell
$ grimoire clone triage personal work
error: clones failed:
  failed to clone triage → personal: EACCES: permission denied, rename '/Users/me/.claude/skills/triage' -> '/Users/me/.claude/skills/.grimoire-staging/triage.4f9a1c.outgoing'
  failed to clone triage → work: /Users/me/work/.agents/skills/.grimoire-staging is not a directory
```

Pairs written before a failure stay written and recorded, and print. With `--overwrite` their old directories are already
deleted, so their lines matter most:

```shell
$ grimoire clone triage a b c --overwrite
cloned triage → a (replaced the directory)
cloned triage → b (replaced the directory)
error: failed to clone triage → c: /Users/me/c/.agents/skills/.grimoire-staging is not a directory
```

A run with any failed pair exits 1, whether or not other pairs were cloned or declined. The
[every pair declined](#when-every-pair-is-declined) form applies only when no pair failed; declines alongside a failure print
as warnings.

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
error: no skill named "ghost"
```

**3. The skill passes the portability check.** Checked once for the whole run, not per workspace.

```shell
$ grimoire clone triage personal
error: skill "/Users/me/.grimoire/skills/triage" is not portable. Contains a nested skill.
```

**4. Every named workspace is registered.** Only the first unregistered name is reported.

```shell
$ grimoire clone triage personal ghost
error: no workspace named "ghost"
```
