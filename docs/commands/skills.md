# `skills`

The store at `~/.grimoire/skills/` is flat — one directory per skill. This group is what fills it, reads it, and empties it.

| Command                                                           | Purpose                                             |
| ----------------------------------------------------------------- | --------------------------------------------------- |
| [`skills add`](#skills-add-path---all)                            | Add a skill, or a directory of skills, to the store |
| [`skills list`](#skills-list-alias-ls)                            | List what the store holds                           |
| [`skills remove`](#skills-remove-skills---forget-clones-alias-rm) | Remove a skill from the store                       |

## `skills add <path> [--all]`

| Argument | Meaning                                                      |
| -------- | ------------------------------------------------------------ |
| `path`   | A skill directory, or a directory to search under for skills |

| Flag    | Default | Effect                                                              |
| ------- | ------- | ------------------------------------------------------------------- |
| `--all` | false   | add every skill found under `path`, skipping the interactive picker |

```shell
$ grimoire skills add ~/dev/skills --all
added brainstorm
already in the store: triage
linked brainstorm → personal
already linked triage → personal
```

### What `<path>` may be

A directory holding `SKILL.md` at its root is the skill itself. Otherwise, `<path>` is a container: the crawl descends
indefinitely, skipping entries whose name starts with `.`, and stops the moment it identifies a skill. It reads no file
contents beyond checking for `SKILL.md` — the same check the store already runs on its own entries.

Two directories under a container may hold a skill of the same name; both are found, and the second is handled as a collision
against what the first just added — see [When the name is taken](#when-the-name-is-taken).

Once a directory is identified as a skill, nothing inside it is skipped: it's copied verbatim, including dotfiles, nested
directories, and symlinks. A skill cannot itself contain another skill, though — that's refused as not portable:

```shell
warning: could not add scratch: skill "/Users/me/dev/scratch" is not portable. Contains a nested skill.
```

### Choosing what to add

```
--all given              →  every skill found          (works anywhere)
a terminal, no --all     →  multi-select prompt         (the normal path)
no terminal, no --all    →  refuse, exit 1
```

A container with nothing under it, or a run where nothing ends up selected, isn't a refusal — both exit 0:

```shell
$ grimoire skills add ~/dev
nothing to add: no skill found under /Users/me/dev

$ grimoire skills add ~/dev/skills
nothing added: no skill selected
```

### The name in the store

The store name is always the source directory's basename — there's no `--as`. Skipping it is what makes `add` double as
adoption: run it from inside an auto-link workspace, on a skill written in place, and the workspace ends up linking to
itself.

```
~/.claude/skills/            (workspace "personal", auto-link)
└── triage/                  a skill the user wrote in place

$ grimoire skills add ~/.claude/skills/triage

  1. copy  ~/.claude/skills/triage  →  ~/.grimoire/skills/triage
  2. auto-link fires for "triage"
  3. link finds ~/.claude/skills/triage occupied by a directory,
     compares it to the store copy, gets `contained`, replaces it
     with a symlink

~/.claude/skills/
└── triage  ──────►  ~/.grimoire/skills/triage
```

A `--as` flag would break this: under a different store name the link would land beside the original instead of replacing it,
and the workspace would end up with two copies of the same skill.

### Auto-linking what was added

Once the copy step is done, every skill now in the store under a name this run added or found already there gets linked into
every [auto-link workspace](./workspaces.md#workspaces-add-name-path---auto-link). "Found already there" is what makes `add`
idempotent — running it twice against the same source leaves the same end state, instead of leaving a plain copy the first
run's link never reached.

```shell
linked brainstorm → personal
already linked triage → personal
```

A workspace that can't take the link warns on stderr and doesn't fail the run or move the exit code — the store copy is what
was asked for, and it landed regardless. What makes a workspace decline a link, and the shape of that per destination,
belongs to `link`'s own contract; this page only reports the outcome.

### When the name is taken

A source whose name is already in the store is decided by asking whether the store copy already holds everything the source
does — not whether the two are equal:

| Store copy vs. source | Outcome                                                | Stream |
| --------------------- | ------------------------------------------------------ | ------ |
| identical             | `already in the store: triage`                         | stdout |
| holds more            | `already in the store: triage (also holds "notes.md")` | stdout |
| differs               | `warning: could not add …`                             | stderr |

```shell
warning: could not add deploy: the store holds a different deploy, differing at "SKILL.md" — edit the store copy, or run `grimoire skills remove deploy` first
```

The middle row is what containment buys over equality. A store copy carrying a file the source lacks still holds every byte
of the skill being added, so there is nothing to refuse and nothing to warn about — the add is already done. Only the other
direction is a refusal: an entry the source holds and the store doesn't means the store isn't the thing being added, and
neither is a file whose contents, type, or execute bit disagree. Refusing over the store's extras instead would strand a
plain copy in an auto-link workspace that no re-run could ever adopt, because auto-link only fires for what `add` copied or
found already there.

A `.DS_Store` written by Finder is left out of the comparison on both sides. One the source holds and the store lacks is not
a difference, and one only the store holds is not named in the `(also holds …)` note. It is recognized by its name plus the
header Finder writes, so a file that is merely named `.DS_Store` is compared like any other.

The note is parenthetical because the extra is almost never part of the skill — a manifest referencing it would itself
differ, and that's a refusal. It names the first entry the walk reaches rather than every one, in the same voice as the
refusals above.

Nothing here ever overwrites — there's no `--force`. The store copy is the user's editing surface, and a command that
silently replaced it would destroy whatever edits made it differ. The warning names the remedy: edit the store copy, or
`grimoire skills remove <skill>` first.

The comparison itself can fail to run at all, when a symlink the two trees share a path for means they can't be compared:

```shell
warning: could not add notes: /Users/me/dev/notes holds the symlink "ref", so the two copies cannot be compared
```

A symlink only the store copy holds is not that case — it's one more thing the store holds and the source doesn't, and reads
as the middle row above.

### What `add` refuses

A refusal exits 1.

**1. The path does not sit inside the grimoire store.**

```shell
$ grimoire skills add ~/.grimoire/skills
error: /Users/me/.grimoire/skills sits inside the grimoire store (/Users/me/.grimoire)
```

**2. There's a terminal to choose from, or `--all` was given.** Without either, a run has nobody to choose what to add.

```shell
$ grimoire skills add ~/dev/skills
error: /Users/me/dev/skills holds 12 skills and no terminal to choose from
  use --all to add every one
```

A source can also be declined on its own — differs from the store copy, isn't portable, or can't be compared — without
failing the run; see [When the name is taken](#when-the-name-is-taken). Only when every source given is declined, and none is
added or already present, does the run itself fail:

```shell
error: could not add deploy: the store holds a different deploy, differing at "SKILL.md" — edit the store copy, or run `grimoire skills remove deploy` first
```

```shell
error: nothing added:
  could not add deploy: the store holds a different deploy, differing at "SKILL.md" — edit the store copy, or run `grimoire skills remove deploy` first
  could not add scratch: skill "/Users/me/dev/scratch" is not portable. Contains a nested skill.
```

The same shape `link` and `unlink` use.

## `skills list` _(alias: `ls`)_

```shell
$ grimoire skills list
brainstorm
deploy
triage
```

Sorted by name. The listing is the store's directory itself, not `state.json` — a skill with no links or clones anywhere
still shows up here. Empty store prints `No skills in the store.`

## `skills remove <skills...> [--forget-clones]` _(alias: `rm`)_

| Argument | Meaning                              |
| -------- | ------------------------------------ |
| `skills` | One or more skill names in the store |

| Flag              | Default | Effect                                                                            |
| ----------------- | ------- | --------------------------------------------------------------------------------- |
| `--forget-clones` | false   | also forget the skill's whole `state.json` entry — no cloned directory is touched |

```shell
$ grimoire skills remove triage
unlinked triage → personal
unlinked triage → work (entry "tri")
trashed triage → /Users/me/.grimoire/.trash/triage-20260915T124530
clones left in place: triage → work
```

Report order, per skill in the order named on the command line: links first, then the trash path, then clone lines.

### Links are cleared first

Deleting the store copy before the links are gone would strand every one of them: once the target is gone, nothing can tell a
stale link apart from an unrelated symlink someone made by hand. So links are always cleared first, and this order isn't a
preference — it's forced.

Links are matched by the store directory they resolve into, not by the workspace entry's name. A symlink's name and its
target are independent — `mv triage tri` inside a workspace leaves `tri` still pointing at `skills/triage` — so the report
names the entry when it differs from the skill:

```shell
unlinked triage → work (entry "tri")
```

### Where the copy goes

The store copy is moved, not deleted, into one timestamped bin per skill per removal:

```
~/.grimoire/.trash/
└── triage-20260915T124530/
    └── store/                 the store copy
```

There is no restore command. Recovery is `mv`, from the exact path the removal just printed:

```shell
trashed triage → /Users/me/.grimoire/.trash/triage-20260915T124530
```

### Clones are kept

Neither with nor without the flag does `skills remove` touch a cloned directory —
[only `clone --overwrite` ever deletes one](../safety.md). Without `--forget-clones`, records and directories are both left
exactly where they are — the store copy is gone, but the workspaces that cloned it keep their copy, and grimoire keeps the
record of where it went:

```shell
clones left in place: triage → work
```

`--forget-clones` drops the skill's whole `state.json` entry — by then nothing it described exists in the store anymore —
while touching no directory:

```shell
forgot clone triage → work
```

Forgetting one record at a time, for a skill still in the store, is [`unclone`](./unclone.md)'s job.

### What `remove` refuses

A refusal exits 1, and nothing is touched — not a link, not the store, not `state.json`.

**1. Every named skill exists.**

```shell
$ grimoire skills remove ghost
error: no skill named "ghost"
```

**2. Every registered workspace resolves.** A workspace whose path no longer reads as a directory — unmounted volume, deleted
directory — might still hold a link inside it that `remove` can't see to clear, so the whole run refuses rather than risk
stranding it:

```shell
$ grimoire skills remove triage
error: cannot remove a skill while a workspace is unreadable
  work: /Volumes/ext/skills does not resolve
  make it readable, or unregister it with `grimoire workspaces remove work`
```

The escape is one of the two ordinary commands named above: make the path resolve again and rerun, or unregister the
workspace with `grimoire workspaces remove work` if it's gone for good.

A workspace whose path is a directory that can't be listed or entered, or that sits under one that can't be entered, is
listed as `cannot be read` instead. The remedy line follows the first workspace listed. When that one is unreadable, it
points at `--force`:

```shell
$ grimoire skills remove triage
error: cannot remove a skill while a workspace is unreadable
  work: /Volumes/ext/skills cannot be read
  make it readable, or unregister it anyway with `grimoire workspaces remove work --force`
```
