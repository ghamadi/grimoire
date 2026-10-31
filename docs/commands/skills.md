# `skills`

The store at `~/.grimoire/skills/` is flat, with one directory per skill. This group is what fills it, reads it, and empties
it.

| Command                                                           | Purpose                                             |
| ----------------------------------------------------------------- | --------------------------------------------------- |
| [`skills add`](#skills-add-source---all)                          | Add a skill, or a directory of skills, to the store |
| [`skills list`](#skills-list-alias-ls)                            | List what the store holds                           |
| [`skills pack`](#skills-pack-skills---all---out-directory)        | Write store skills as zips into a folder            |
| [`skills path`](#skills-path-skill)                               | Print the path of a store skill, or of the store    |
| [`skills remove`](#skills-remove-skills---forget-clones-alias-rm) | Remove a skill from the store                       |

## `skills add <source> [--all]`

| Argument | Meaning                                                                 |
| -------- | ----------------------------------------------------------------------- |
| `source` | A skill directory, a directory to search under for skills, or a git URL |

| Flag    | Default | Effect                                                                |
| ------- | ------- | --------------------------------------------------------------------- |
| `--all` | false   | add every skill found under `source`, skipping the interactive picker |

```shell
$ grimoire skills add ~/dev/skills --all
added brainstorm
already in the store: triage
linked brainstorm → personal
already linked triage → personal
```

### What `<source>` may be

A directory holding `SKILL.md` at its root is the skill itself. Otherwise, `<source>` is a container: the crawl descends
indefinitely, skipping entries whose name starts with `.`, and stops the moment it identifies a skill. It reads no file
contents beyond checking for `SKILL.md`.

Two directories under a container may hold a skill of the same name. Both are found, and the second is handled as a collision
against what the first just added. See [When the name is taken](#when-the-name-is-taken).

Once a directory is identified as a skill, it is [copied](../conventions.md#copies) whole, dotfiles included. A skill that
contains another skill is refused as not portable:

```shell
warning: could not add scratch: skill "/Users/me/dev/scratch" is not portable. Contains a nested skill.
```

A failure the system reports while checking a source, such as a folder grimoire can't list or enter, declines that source the
same way, with the system's reason:

```shell
warning: could not add scratch: EACCES: permission denied, scandir '/Users/me/dev/scratch/refs'
```

### Adding from a git URL

An argument that starts with `https://`, `ssh://` or `git@<host>:` is a git URL. Any other argument is a path, so `http://`
and `file://` URLs fail as paths that do not exist.

```shell
$ grimoire skills add https://github.com/someone/skills.git --all
cloning https://github.com/someone/skills.git…
added brainstorm
added deploy
linked brainstorm → personal
linked deploy → personal
```

grimoire prints `cloning <url>…` on stderr, then makes a shallow clone of the repo's default branch in a temporary directory.
There is no way to pick a branch, a tag or a folder. A web URL such as `…/tree/main/skills` fails as a failed clone.

Without a terminal or `--all`, grimoire refuses without contacting the repo. It prints no `cloning` line and clones nothing.

The clone is a source like any other directory: discovery, the picker, `--all`, collisions and auto-linking all work as
described on this page. Its `.git` directory is not copied. The clone is removed when the run finishes, fails, is stopped
with Ctrl-C, or its terminal closes.

A repo that is itself a skill takes the name git gives the clone, so `…/triage.git` is added as `triage`.

Messages name each skill by its path inside the repo, and the repo itself by the URL:

```shell
warning: could not add scratch: skill "tools/scratch" is not portable. Contains a nested skill.
```

A user name or token in an `https://` URL is left out of every line grimoire prints.

Nothing records where a skill came from. The store copy is yours to edit, and later changes to the repo do not reach it.

### Choosing what to add

```
--all given              →  every skill found          (works anywhere)
a terminal, no --all     →  multi-select prompt         (the normal path)
no terminal, no --all    →  refuse, exit 1
```

[Pickers](../conventions.md#pickers) covers what counts as a terminal and how a pick runs.

A path is checked first: it must exist and sit outside the store. Then a run with no terminal and no `--all` refuses before
anything is crawled or cloned, even when the source holds no skills.

With a terminal or `--all`, a container with nothing under it, or a run where nothing ends up selected, isn't a refusal. Both
exit 0:

```shell
$ grimoire skills add ~/dev
nothing to add: no skill found under /Users/me/dev

$ grimoire skills add ~/dev/skills
nothing to add: no skill selected
```

### The name in the store

The store name is always the source directory's basename. There's no `--as`, so `add` doubles as adoption: run it from inside
an auto-link workspace, on a skill written in place, and the workspace ends up linking to itself.

```
~/.claude/skills/            (workspace "personal", auto-link)
└── triage/                  a skill the user wrote in place

$ grimoire skills add ~/.claude/skills/triage

  1. copy  ~/.claude/skills/triage  →  ~/.grimoire/skills/triage
  2. auto-link fires for "triage"
  3. link finds ~/.claude/skills/triage occupied by a directory
     the store copy holds in full, and replaces it with a symlink

~/.claude/skills/
└── triage  ──────►  ~/.grimoire/skills/triage
```

A `--as` flag would break this: under a different store name the link would land beside the original instead of replacing it,
and the workspace would end up with two copies of the same skill.

### Auto-linking what was added

Once the copy step is done, every skill now in the store under a name this run added or found already there gets linked into
every [auto-link workspace](./workspaces.md#workspaces-add-name-path---auto-link). Linking skills found already there keeps
`add` idempotent: running it twice against the same source leaves the same end state.

```shell
linked brainstorm → personal
already linked triage → personal
```

Output is grouped as in [Outcomes](../conventions.md#outcomes), with the line shapes from
[When the name is taken](#when-the-name-is-taken): `added`, `already in the store`, then warnings, then the auto-link lines
in [`link`](./link.md)'s order.

A workspace that declines the link, for any reason in [`link`'s outcome table](./link.md#link-skill---to-workspaces), prints
a warning. An auto-link decline never changes the exit code, even when every link is declined, because the store copy landed.

### When the name is taken

Each source gets one outcome, decided by what sits at its store path, `~/.grimoire/skills/<skill>`. "Holds in full" is
[containment](../conventions.md#containment).

| At `<store path>`                                      | Outcome              | Output                                                                                                                              |
| ------------------------------------------------------ | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| nothing                                                | added                | stdout `added <skill>`                                                                                                              |
| a copy that holds the source in full, and nothing more | already in the store | stdout `already in the store: <skill>`                                                                                              |
| a copy that holds the source in full, and more         | already in the store | stdout `already in the store: <skill> (also holds "<entry>")`                                                                       |
| a copy that does not hold the source in full           | declined             | stderr `warning: could not add <skill>: the store holds a different <skill>, differing at "<entry>" — edit or replace <store path>` |
| a copy that cannot be compared (a symlink)             | declined             | stderr `warning: could not add <skill>: <root> holds the symlink "<entry>", so the two copies cannot be compared`                   |
| a copy that cannot be compared (a system failure)      | declined             | stderr `warning: could not add <skill>: <reason>`                                                                                   |

```shell
warning: could not add deploy: the store holds a different deploy, differing at "SKILL.md" — edit or replace /Users/me/.grimoire/skills/deploy
warning: could not add notes: /Users/me/dev/notes holds the symlink "ref", so the two copies cannot be compared
warning: could not add triage: EACCES: permission denied, open '/Users/me/dev/triage/locked.txt'
```

The `(also holds …)` note names only the first extra entry. A `.DS_Store` only the store holds is never named in it. A
symlink only the store copy holds reads as the "and more" row.

There's no `--force`. The store copy is where you edit the skill, and replacing it would lose those edits.

### What `add` refuses

See [Refusals](../conventions.md#refusals).

**1. The path does not sit inside the grimoire store.**

```shell
$ grimoire skills add ~/.grimoire/skills
error: /Users/me/.grimoire/skills sits inside the grimoire store (/Users/me/.grimoire)
```

**2. A local path is an existing folder you can list and enter.**

```shell
$ grimoire skills add ~/locked
error: /Users/me/locked cannot be read
```

**3. A git URL clones, and git can be run.** The error includes git's own reason:

```shell
$ grimoire skills add https://github.com/someone/nope.git
cloning https://github.com/someone/nope.git…
error: could not clone https://github.com/someone/nope.git:
  remote: Repository not found.
  fatal: repository 'https://github.com/someone/nope.git/' not found
```

Ctrl-C during the clone fails the same way:

```shell
$ grimoire skills add https://github.com/someone/skills.git
cloning https://github.com/someone/skills.git…
^Cerror: could not clone https://github.com/someone/skills.git:
  git was stopped by SIGINT
```

Without git:

```shell
$ grimoire skills add https://github.com/someone/skills.git
cloning https://github.com/someone/skills.git…
error: could not run git: grimoire needs it installed and on your PATH
```

**4. There's a terminal to choose from, or `--all` was given.** Without either, a run has nobody to choose what to add.

```shell
$ grimoire skills add ~/dev/skills
error: no terminal to choose skills from /Users/me/dev/skills
  use --all to add every one
```

A declined source does not fail the run. When every source is declined, the run fails as in
[When every destination is declined](../conventions.md#when-every-destination-is-declined): `error: could not add …` for one
source, `error: nothing added:` for several.

## `skills list` _(alias: `ls`)_

```shell
$ grimoire skills list
brainstorm
deploy
triage
```

Sorted by name. It lists the store's directory, so a skill with no links or clones still shows up. Empty store prints
`No skills in the store.`

## `skills pack [skills...] [--all] [--out <directory>]`

| Argument | Meaning                              |
| -------- | ------------------------------------ |
| `skills` | One or more skill names in the store |

| Flag                | Default            | Effect                            |
| ------------------- | ------------------ | --------------------------------- |
| `--all`             | false              | pack every skill the store holds  |
| `--out <directory>` | the current folder | the folder to write the zips into |

With no skill named and no `--all`, a picker offers the store's skills on a terminal, and the run refuses without one, as in
[Missing skills](../conventions.md#missing-skills). `--out` is checked after the pick.

```shell
$ grimoire skills pack triage review --out ~/dist
packed triage → /Users/me/dist/triage.zip
packed review → /Users/me/dist/review.zip
```

### What the zip holds

`<skill>.zip` holds one top-level `<skill>/` folder with an exact copy of the store skill inside: dotfiles, `.DS_Store`,
`.git`, empty folders and execute bits are all kept.

A skill holding a symlink is declined, because a provider's upload or a Windows unzip does not restore one. It would arrive
broken without saying so.

Nothing reads the contents of `SKILL.md`. What a provider rejects, such as a `name` in the wrong format, is the provider's to
report.

### Where the zip goes

`--out` must be an existing folder you can list and enter. It can't be the store or sit inside it, with symlinks resolved. A
folder that contains the store, such as `~`, is fine. With no `--out`, the zip goes in the current folder as the system
reports it, with symlinks resolved. On macOS, a run from `/tmp` prints `/private/tmp/triage.zip`.

Anything already at `<out>/<skill>.zip` declines that skill: a file, a folder or a symlink, even a dangling one. There is no
override, so packing again after an edit means deleting the old zip first.

Each zip is a [staged write](../conventions.md#staged-writes) through `<out>/.grimoire-staging/`, with the zip taking the
place of the copy.

### Outcomes

| Outcome  | When                                   | Output                                                                                                      |
| -------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| packed   | the staged write landed                | stdout `packed <skill> → <zip path>`                                                                        |
| declined | the skill holds a symlink              | stderr `warning: could not pack <skill> → <zip path>: the skill holds the symlink "<entry>"`                |
| declined | something is at `<zip path>`           | stderr `warning: could not pack <skill> → <zip path>: something is already there — delete it to pack again` |
| failed   | the staged write failed and was undone | `failed to pack <skill> → <zip path>: <reason>`, printed last                                               |

Lines are grouped as in [Outcomes](../conventions.md#outcomes). When every skill is declined, the run fails as in
[When every destination is declined](../conventions.md#when-every-destination-is-declined): `error: could not pack …` for one
skill, `error: nothing packed:` for several. Failures follow [When a write fails](../conventions.md#when-a-write-fails),
headed `error: packs failed:` for several.

### What `pack` refuses

See [Refusals](../conventions.md#refusals).

**1. Named skills and `--all` are not combined, and with neither there is a terminal to pick on.**

```shell
$ grimoire skills pack triage --all
error: --all cannot be combined with named skills

$ grimoire skills pack | cat
error: missing required argument 'skills' (or use --all)
```

With `--all` or the picker on an empty store, the run prints `nothing to pack: the store holds no skills` and exits 0.

**2. Every skill is one [`skills list`](#skills-list-alias-ls) would print.** Any other name is refused with
`error: no skill named "<skill>"`.

**3. Every skill passes the portability check.**

**4. `--out` is an existing folder you can list and enter.** A folder you can enter but can't write to passes this check, and
each skill then fails as in [Outcomes](#outcomes).

```shell
$ grimoire skills pack triage --out ~/locked
error: /Users/me/locked cannot be read
```

**5. `--out` is not the store, and does not sit inside it.**

```shell
$ grimoire skills pack triage --out ~/.grimoire/skills
error: /Users/me/.grimoire/skills sits inside the grimoire store (/Users/me/.grimoire)
```

## `skills path [skill]`

| Argument | Meaning                   |
| -------- | ------------------------- |
| `skill`  | A skill name in the store |

Prints the absolute path of the skill's store directory, or of the store with no skill named, alone on one line:

```shell
$ grimoire skills path triage
/Users/me/.grimoire/skills/triage

$ grimoire skills path
/Users/me/.grimoire/skills

$ code "$(grimoire skills path triage)"
```

The store's path prints even before the store exists.

A name that [`skills list`](#skills-list-alias-ls) would not print is refused with `error: no skill named "<skill>"`. See
[Refusals](../conventions.md#refusals).

## `skills remove <skills...> [--forget-clones]` _(alias: `rm`)_

| Argument | Meaning                              |
| -------- | ------------------------------------ |
| `skills` | One or more skill names in the store |

| Flag              | Default | Effect                                           |
| ----------------- | ------- | ------------------------------------------------ |
| `--forget-clones` | false   | also forget the skill's whole `state.json` entry |

```shell
$ grimoire skills remove triage
unlinked triage → personal
unlinked triage → work (entry "tri")
trashed triage → /Users/me/.grimoire/.trash/triage-20260915T124530
clones left in place: triage → work
```

Report order, per skill in the order named on the command line: links first, then the trash path, then clone lines.

### Links are cleared first

Every link is cleared before the store copy moves. A [link](../conventions.md#links-and-clones) is found by its target, so a
link renamed with `mv triage tri` inside a workspace is still cleared. The report names the entry when it differs from the
skill:

```shell
unlinked triage → work (entry "tri")
```

### Where the copy goes

The store copy is moved into the trash, one timestamped bin per skill per removal:

```
~/.grimoire/.trash/
└── triage-20260915T124530/
    └── store/                 the store copy
```

There is no restore command. Recovery is `mv`, from the exact path the removal just printed:

```shell
trashed triage → /Users/me/.grimoire/.trash/triage-20260915T124530
```

A bin stays until [`grimoire trash empty`](./trash.md#trash-empty) deletes every one of them.

### Clones are kept

`skills remove` touches no cloned directory, with or without the flag. Without `--forget-clones`, the clone records stay too,
and each is reported:

```shell
clones left in place: triage → work
```

`--forget-clones` drops the skill's whole `state.json` entry:

```shell
forgot clone triage → work
```

Forgetting one record at a time, for a skill still in the store, is [`clone --drop`](./clone.md#clone-skill---drop-targets)'s
job.

### What `remove` refuses

See [Refusals](../conventions.md#refusals).

**1. Every named skill exists.**

**2. Every registered workspace is reachable and readable.** An
[unreachable or unreadable](../conventions.md#unreachable-and-unreadable-workspaces) workspace might hold a link `remove`
cannot see to clear. Each such workspace is listed as `does not resolve` or `cannot be read`. The remedy line follows the
first one listed:

```shell
$ grimoire skills remove triage
error: cannot remove a skill while a workspace is unreadable
  work: /Volumes/ext/skills does not resolve
  make it readable, or unregister it with `grimoire workspaces remove work`
```

When the first one listed is unreadable, the remedy points at `--force`:

```shell
$ grimoire skills remove triage
error: cannot remove a skill while a workspace is unreadable
  work: /Volumes/ext/skills cannot be read
  make it readable, or unregister it anyway with `grimoire workspaces remove work --force`
```
