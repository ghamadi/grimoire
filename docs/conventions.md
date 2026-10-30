# Shared conventions

This page holds behavior several commands share. A command page links here and states only where it differs.

## Links and clones

`<dest>` below is `<workspace path>/<skill>`.

A link is a symlink at `<dest>` that resolves, following chains, to the store's `<skill>` directory. A dangling symlink, or
one that resolves anywhere else, is not a link. Nothing records a link. grimoire finds one by reading the workspace
directory.

A clone is a record in `state.json` naming a directory. Nothing on disk marks a cloned directory, so it looks exactly like
one you wrote by hand. A record takes one of two forms: `{ workspace }`, or `{ path }`, which
[`workspaces remove`](./commands/workspaces.md#workspaces-remove-name---hard---force-alias-rm) leaves behind. Either way, a
record is identified by the directory it resolves to, with symlinks resolved. So a `{ path }` record still counts once a
workspace is registered again at that path.

## Containment

The store copy holds a directory in full when every entry under the directory exists in the store copy with the same type,
the same bytes and the same execute bit. What only the store copy holds does not matter, so an empty directory is held in
full.

A `.DS_Store` written by Finder is left out of the comparison on both sides. It is recognized by its name plus the header
Finder writes, so a file that is merely named `.DS_Store` is compared like any other.

When the directory holds something the store copy lacks, the first entry that differs is named, relative to the directory.

The comparison stops at any symlink in the directory, or at one in the store copy at a path the directory also has. The
message names the side that holds it.

Each command words its own messages for these cases.

## Copies

A copy of a store skill is verbatim: dotfiles, nested directories and symlinks included.

## Arguments

A name given twice counts once, keeping its first position.

An `--all-*` flag, such as `--all-skills` or `--all-workspaces`, stands for every item of its kind, in name order. The run
behaves as if you had typed those names in that order. `skills pack --all` follows this rule too.

When the set is empty, the run prints `nothing to <verb>: <reason>` and exits 0:

```shell
$ grimoire link --all-skills
nothing to link: the store holds no skills
```

## Pickers

A picker shows only when stdin and stdout are both terminals, since it draws on stdout.

What you pick runs in the order the picker lists it, whatever order you picked it in.

Choosing nothing, or cancelling, prints `nothing to <verb>: no <noun> selected` and exits 0:

```shell
$ grimoire skills add ~/dev/skills
nothing to add: no skill selected
```

## Missing destinations

Some commands let you leave out where to write. The skills are checked first, so a wrong skill name is reported as one, with
or without a terminal.

Without a terminal, the run then refuses. The error names the flag to use and lists every choice, if there are any:

```shell
$ grimoire export triage | cat
error: no repo named, and no terminal to choose from
  name them with --to: dotfiles library
```

On a terminal with nothing to offer, the run prints `nothing to <verb>: <reason>` and exits 0.

Otherwise a [picker](#pickers) offers the choices, and what you pick runs exactly as if you had typed it.

Each page states its own choices, reason and flag.

## Outcomes

`<verb>` stands for the command (`link`, `clone`), `<destination>` for the workspace or repo it writes to, and `<result>` for
one of the command's success words (`linked`, `already linked`).

Each destination gets one outcome. A result prints to stdout as `<result> <skill> → <destination>`. A decline prints to
stderr as `warning: could not <verb> <skill> → <destination>: <reason>`.

Lines print grouped: results first, then warnings, then [failures](#when-a-write-fails), each group in argument order. Each
page lists its own result groups and their order. When anything succeeds and nothing fails, declines stay warnings and the
exit code is 0:

```shell
$ grimoire link triage --to personal work scratch
linked triage → personal
already linked triage → work
warning: could not link triage → scratch: /Users/me/scratch/skills/triage holds a directory that differs from the store copy at "notes.md" — keep it with `grimoire clone triage --to scratch`, or delete it yourself
```

## When every destination is declined

A run where every destination was declined, and none [failed](#when-a-write-fails), exits 1 and prints the declines as an
error. One decline prints as a single line:

```shell
$ grimoire link triage --to work
error: could not link triage → work: /Users/me/work/.agents/skills/triage is a symlink pointing elsewhere
```

Several print `error: nothing <verb-past>:` (`nothing linked`, `nothing cloned`), followed by each sentence on its own line,
indented two spaces:

```shell
$ grimoire link triage --to personal work
error: nothing linked:
  could not link triage → personal: /Users/me/.claude/skills/triage is a clone — unclone it first with `grimoire clone triage --drop personal`
  could not link triage → work: /Users/me/work/.agents/skills/triage is a symlink pointing elsewhere
```

## When a write fails

A [staged write](#staged-writes) that fails is one destination's outcome. The rest are still attempted, the failures print
last, and the run exits 1.

A failure reads `failed to <verb>`, and a decline reads `could not <verb>`. A decline touched nothing. A failure was a write
that was attempted and undone.

One failure prints as a single line. Several print `error: <noun-plural> failed:` (`clones failed`, `exports failed`),
followed by each sentence on its own line, indented two spaces:

```shell
$ grimoire clone triage --to personal work
error: clones failed:
  failed to clone triage → personal: EACCES: permission denied, rename '/Users/me/.claude/skills/triage' -> '/Users/me/.claude/skills/.grimoire-staging/triage.4f9a1c.outgoing'
  failed to clone triage → work: /Users/me/work/.agents/skills/.grimoire-staging is not a directory
```

Destinations written before a failure stay written, and their lines print. When any destination failed, declines print as
warnings, and the [every-declined](#when-every-destination-is-declined) form is not used.

## Staged writes

`<directory>` below is the workspace or repo path, and `<dest>` is `<directory>/<skill>`. Every write goes through
`<directory>/.grimoire-staging/`:

1. The store skill is copied to `<directory>/.grimoire-staging/<skill>.<id>.incoming`.
2. Whatever is at `<dest>` is renamed to `<skill>.<id>.outgoing`, beside it.
3. The new copy is renamed to `<dest>`.
4. The outgoing entry is deleted.
5. `.grimoire-staging` is removed when it is empty.

`<id>` is random per write. `<dest>` only ever holds the whole old entry or the whole new copy. The staging directory sits
inside `<directory>` so both renames stay on one filesystem, and one level down so an agent listing `<directory>` never sees
a half-built skill.

If `.grimoire-staging` exists and is not a directory, such as a file or a symlink, every write into `<directory>`
[fails](#when-a-write-fails).

A failed write leaves `<dest>` as it was. An old entry already moved aside is put back, the incoming copy is deleted, and
`.grimoire-staging` is removed when that leaves it empty.

When the new copy is in place but the old one cannot be fully deleted, the destination still counts as a success. A warning
names the stranded `.outgoing` entry, printed after the decline warnings:

```shell
$ grimoire clone triage --to work --overwrite
cloned triage → work (replaced the directory)
warning: cloned triage → work, but the old copy at /Users/me/work/.agents/skills/.grimoire-staging/triage.4f9a1c.outgoing could not be fully deleted: EACCES: permission denied, rmdir '/Users/me/work/.agents/skills/.grimoire-staging/triage.4f9a1c.outgoing/refs'
```

A killed run can leave `.grimoire-staging/` behind, and deleting it is the cleanup.

## Refusals

A refusal exits 1 and touches nothing. The checks run in the order each page lists them, and only the first failure is
reported. These messages are shared:

- A missing argument prints `error: missing required argument '<name>'`. When the page has an `--all-*` flag for it, the
  message ends with ` (or use --all-<x>)`, as in `error: missing required argument 'skill' (or use --all-skills)`.
  `skills pack` ends it the same way with its own flag: `error: missing required argument 'skills' (or use --all)`. A flag
  that takes a list, such as `--to`, takes every name after it. So when one was given, a second line names it:

  ```shell
  $ grimoire link --to personal triage
  error: missing required argument 'skill' (or use --all-skills)
    --to takes every name after it, so name the skill before it
  ```

- An unknown skill prints `error: no skill named "<skill>"`.
- A skill that fails the portability check prints its reason, as in
  `error: skill "/Users/me/.grimoire/skills/triage" is not portable. Contains a nested skill.` Every skill is checked before
  any destination is examined, so under `--all-skills` or `skills pack --all` one unportable skill refuses the whole run.
- An unregistered name prints `error: no workspace named "<name>"` or `error: no repo named "<name>"`. Only the first
  unregistered name is reported.

## Unreachable and unreadable workspaces

A workspace is unreachable when its path does not resolve to a directory: it is gone, it is a file, it sits under a file, or
it is a symlink cycle. The path may be an unmounted volume with everything still inside it.

A workspace is unreadable when its path is a directory grimoire cannot list or enter, or sits under a directory it cannot
enter.

[`status`](./commands/status.md#workspaces) reports both as problems. Each command page says what it does with one.

## Colors

Output is colored only on a color-capable stdout. Piped output, or `NO_COLOR` set, prints plain, keeping the layout and any
box-drawing characters. Paths are never styled. Each page lists its own styles.
