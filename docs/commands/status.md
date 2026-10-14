# `status`

`status` is a read-only inventory of every deployment, in four sections: the registered workspaces, a grid of skills by
workspace, the clones outside workspaces, and the problems, each with its fix.

```shell
grimoire status
```

It takes no arguments and no flags.

## Output

```shell
$ grimoire status
Workspaces  3 registered
┌──────────┬───────────┬─────────────┬───────────────────────────────┐
│ NAME     │ MODE      │ STATE       │ PATH                          │
├──────────┼───────────┼─────────────┼───────────────────────────────┤
│ personal │ auto-link │ 1 problem   │ /Users/me/.claude/skills      │
│ scratch  │ manual    │ unreachable │ /Volumes/ext/skills           │
│ work     │ manual    │ 2 problems  │ /Users/me/work/.agents/skills │
└──────────┴───────────┴─────────────┴───────────────────────────────┘

Skills  6 in /Users/me/.grimoire/skills · 2 not deployed
┌────────────────────┬─────────────┬─────────┬───────────────┐
│ SKILL              │ personal    │ scratch │ work          │
├────────────────────┼─────────────┼─────────┼───────────────┤
│ brainstorm         │ link        │ ?       │ ·             │
│ deploy             │ link        │ clone ? │ clone         │
│ lint               │ ·           │ ?       │ clone missing │
│ notes              │ ·           │ ?       │ ·             │
│ old (not in store) │ ·           │ ?       │ clone         │
│ review             │ ·           │ ?       │ ·             │
│ triage             │ link as tri │ ?       │ link          │
└────────────────────┴─────────────┴─────────┴───────────────┘

Clones outside workspaces  directories recorded by path
┌───────┬─────────┬──────────────────────┐
│ SKILL │ STATE   │ DIRECTORY            │
├───────┼─────────┼──────────────────────┤
│ notes │ present │ /Users/me/old/skills │
└───────┴─────────┴──────────────────────┘

Problems  6

  ! link gone in workspace personal resolves nowhere
    It points into the store, at a skill that is not there.
    Delete the link yourself.

  ! workspace scratch is unreachable
    /Volumes/ext/skills does not resolve.
    Make it readable, or unregister it:
      grimoire workspaces remove scratch

  ! clone of old in workspace work is no longer in the store
    Forget the record:
      grimoire unclone old work

  ! clone of lint in workspace work is missing
    Copy it again:
      grimoire clone lint work
    Or forget the record:
      grimoire unclone lint work

  ! clone of triage is recorded under "ghost", which is not a registered workspace
    Remove the record from /Users/me/.grimoire/state.json.

  ! store entry notes.txt is not a skill directory
    Move it out of the store, or add it to "ignore" in /Users/me/.grimoire/state.json.
```

- Sections are separated by one blank line.
- A section starts with a title line: the title, two spaces, a caption. Its table follows with no blank line.
- A section with no rows has no table.
- Tables are boxed. Every column is left-aligned and as wide as its longest cell.
- No problem prints inside a table. The `Problems` title line is `Problems`, two spaces, and the number of problems.
- Each problem is an entry. One blank line follows the title, and one separates entries.
- An entry starts with ` !` and a headline naming the kind of entity and its name. Its other lines are indented four spaces.
- A fix that is a command prints alone on its line, exactly as it would be typed, indented six spaces. A word holding any
  character other than a letter, a digit, `_`, `.`, `/` or `-` prints in single quotes:
  `grimoire unclone notes '/Users/me/My Projects/skills'`. A fix that is not a command is a sentence.
- No line of an entry is wrapped by grimoire.

## Sections

Sections print in this order:

1. **Workspaces.** Every registered workspace. Always printed.
2. **Skills.** Every skill, against every registered workspace. Always printed.
3. **Clones outside workspaces.** The clones in directories named by `{ path }` clone records that no registered workspace's
   path equals. Printed only when there is one.
4. **Problems.** Always printed, last. See [Problems](#problems).

### Workspaces

One row per registered workspace, sorted by name. The caption is `<n> registered`.

- `MODE` is `auto-link` or `manual`.
- `STATE` is `unreachable` or `unreadable` when the workspace carries that problem. Otherwise it is `ok`, or the count of the
  workspace's problems: `1 problem`, `2 problems`.

A workspace whose path does not resolve to a directory is unreachable. It gets a single `workspace-unreachable` problem, and
no links are read. Its clone records are unverified, because the path may be an unmounted volume with everything intact.

A workspace whose path is a directory that grimoire cannot list or enter, or that sits under a directory it cannot enter, is
unreadable. It is treated like an unreachable one: a single problem, no links read, and its clone records unverified. The
problem is `workspace-unreadable`.

### Skills

One column per registered workspace, sorted by name, after `SKILL`. One row per store skill, plus one per skill that a
workspace holds a clone record for when the skill is not in the store, plus one per store entry that is not a skill when a
workspace links to it. Rows sort by name. A cell says what that workspace holds of that skill:

| Cell              | Meaning                                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------------------------- |
| `link`            | a symlink in the workspace that resolves, following chains, to the row's skill or store entry, under its name |
| `link as <entry>` | such a link whose workspace entry has another name                                                            |
| `clone`           | a recorded clone whose directory is there                                                                     |
| `clone missing`   | a recorded clone whose directory is gone                                                                      |
| `clone ?`         | a recorded clone in an unreachable or unreadable workspace, unverified                                        |
| `·`               | nothing                                                                                                       |
| `?`               | nothing recorded, in an unreachable or unreadable workspace                                                   |

A cell holding more than one of these joins them with `, `. A skill that is not in the store has ` (not in store)` after its
name. A store entry that is not a skill directory has ` (not a skill)` after its name when a workspace links to it, even when
a workspace also holds a clone record for it.

The caption is `<n> in <skills path>`, counting store skills, followed by ` · <n> not deployed` when any are. A skill is not
deployed when it has no link in any reachable workspace and no clone whose directory is there, in a workspace or outside one.

`not deployed` is computed only from what could be read, so a skill linked only into an unreachable or unreadable workspace
reads as not deployed. That workspace's `STATE`, its `?` cells, and its entry in `Problems` are the caveat.

With no workspace registered, the grid has the `SKILL` column alone.

### Clones outside workspaces

One row per clone in a directory named by `{ path }` clone records that no registered workspace's path equals, sorted by
directory, then skill. The caption is `directories recorded by path`.

- `STATE` is `present` when `<directory>/<skill>` is a directory, and `missing` otherwise.
- A skill that is not in the store has ` (not in store)` after its name.

These directories hold clones only. They are never scanned for links, because grimoire tracks links only in registered
workspaces.

A recorded path that no longer resolves or cannot be read earns no problem of its own. Each of its clones reads as `missing`
and as a `clone-missing` problem, whose remedy is an [`unclone`](./unclone.md) naming that path.

### A clone belongs to its directory

A clone record's identity is the directory it resolves to, compared canonically — see
[what counts as the clone](./clone.md#what-counts-as-the-clone). A record shows in every workspace column and every
`Clones outside workspaces` row whose directory it resolves to:

- A `{ path }` record for a registered workspace's path shows in that workspace's column.
- Two workspaces registered at one path both show what is there.

A skill shows once per directory, however many records name it there.

## Width

On a terminal, each table is fitted to the terminal's width. Piped output is never fitted.

| Table                     | When it is too wide                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------- |
| Workspaces                | the `PATH` cell wraps inside its column                                               |
| Clones outside workspaces | the `DIRECTORY` cell wraps the same way                                               |
| Skills                    | the workspace columns are dealt into stacked grids, each repeating the `SKILL` column |

A wrapped path breaks after a `/`. The row's other cells are blank on its extra lines.

```
┌──────┬────────┬───────┬────────────────────────────┐
│ NAME │ MODE   │ STATE │ PATH                       │
├──────┼────────┼───────┼────────────────────────────┤
│ app  │ manual │ ok    │ /Users/me/projects/my-app/ │
│      │        │       │ .claude/skills             │
└──────┴────────┴───────┴────────────────────────────┘
```

The workspace columns keep their order across the stacked grids, which have no line between them.

```
┌─────────┬──────────┬───────┐
│ SKILL   │ personal │ work  │
├─────────┼──────────┼───────┤
│ archify │ link     │ clone │
└─────────┴──────────┴───────┘
┌─────────┬───────┬────────┐
│ SKILL   │ codex │ gemini │
├─────────┼───────┼────────┤
│ archify │ link  │ link   │
└─────────┴───────┴────────┘
```

Title lines and problem entries are never fitted.

Two things still print whole and overflow the terminal: a path segment longer than its column, on that one line, and a grid
whose skill name and one workspace column are together wider than the terminal.

## Problems

| Problem                        | Reported when                                                                                        | Block                    |
| ------------------------------ | ---------------------------------------------------------------------------------------------------- | ------------------------ |
| `workspace-unreachable`        | the registered path does not resolve to a directory                                                  | workspace                |
| `workspace-unreadable`         | the registered path is a directory grimoire cannot list or enter, or sits under one it cannot enter  | workspace                |
| `dangling-link`                | a symlink's target names a path under the store's `skills/` directory, and the link does not resolve | workspace (reachable)    |
| `clone-not-in-store`           | the record's `<dir>/<skill>` is a directory, and the skill is not in the store                       | workspace, recorded path |
| `clone-missing`                | the record's `<dir>/<skill>` is not a directory                                                      | workspace, recorded path |
| `clone-unregistered-workspace` | a `{ workspace }` clone record names a workspace that is not registered                              | store                    |
| `stray-entry`                  | an entry in the store's `skills/` directory is not a skill directory and matches no glob in `ignore` | store                    |

Each problem prints as an entry in the `Problems` section, in this order: each workspace's, by workspace name, then each
recorded path's, then the store's.

```
  ! <headline>
    <sentence>
    <sentence that introduces a command>:
      grimoire <command>
```

`<location>` is `workspace <name>` for a workspace and the directory for a recorded path. `<target>` is the workspace name,
or the directory for a recorded path.

```
workspace-unreachable
  ! workspace <name> is unreachable
    <path> does not resolve.
    Make it readable, or unregister it:
      grimoire workspaces remove <name>

workspace-unreadable
  ! workspace <name> is unreadable
    <path> cannot be read.
    Make it readable, or unregister it anyway:
      grimoire workspaces remove <name> --force

dangling-link
  ! link <entry> in workspace <name> resolves nowhere
    It points into the store, at a skill that is not there.
    Delete the link yourself.

clone-not-in-store
  ! clone of <skill> in <location> is no longer in the store
    Forget the record:
      grimoire unclone <skill> <target>

clone-missing (recloneable)
  ! clone of <skill> in workspace <name> is missing
    Copy it again:
      grimoire clone <skill> <name>
    Or forget the record:
      grimoire unclone <skill> <name>

clone-missing
  ! clone of <skill> in <location> is missing
    Forget the record:
      grimoire unclone <skill> <target>

clone-unregistered-workspace
  ! clone of <skill> is recorded under "<workspace>", which is not a registered workspace
    Remove the record from <state path>.

stray-entry
  ! store entry <entry> is not a skill directory
    Move it out of the store, or add it to "ignore" in <state path>.
```

The recloneable form of `clone-missing` appears only for a workspace, for a skill still in the store. A recorded path has no
workspace name to `clone` into, and a skill gone from the store has nothing to copy.

### `clone-missing` wins over `clone-not-in-store`

A record whose directory is gone, for a skill also gone from the store, is one `clone-missing` whose only remedy is
`unclone`.

### Dangling links

A dangling link is found from the link's target text, without following it. The text, resolved against the link's directory,
names a path under the store's `skills/` directory, and the link does not resolve. grimoire always writes the store path as
its link target, so its own links are always recognizable.

A link that reached the store through a now-missing intermediate symlink reads as an ordinary broken link and is not
reported.

### Stray entries and `ignore`

A stray entry is an entry in the store's `skills/` directory that is not a skill directory and matches no glob in
`state.json`'s `ignore`, which defaults to `[".DS_Store"]`. Each glob is matched against the entry's name.

An entry that is a symlink cycle, or that cannot be read, is not a skill directory, so it is a stray entry.

A stray entry that a workspace links to also has a row in the `Skills` grid, and so does a linked entry that `ignore` hides,
which earns no problem.

There is no exemption for dot-entries. A version-controlled store's `.git` prints as stray until it is added to `ignore`.
`status` is the only command that reads `ignore`.

### Remedies and `doctor`

Every entry names its fix: a command alone on its line where one exists, and otherwise a sentence giving the manual step.
Three are manual today: dangling links, stray entries, and records naming an unregistered workspace.
[`unclone`](./unclone.md) cannot reach the last one, because an unregistered name refuses.

The planned `doctor` command is where these get repaired.

## Empty cases

- No workspace registered: the `Workspaces` section is the one line `Workspaces  none registered`, with no table.
- No store skill, no clone recorded in a workspace, and no workspace link into the store: the grid has no row, so the
  `Skills` section is its title line, `Skills  0 in <skills path>`, with no table.
- No clone recorded outside a workspace: the `Clones outside workspaces` section does not print.
- With no problems, the `Problems` section is the one line `Problems  none ✓`.

## Colors

On a color-capable stdout only. Piped output, or `NO_COLOR` set, keeps the layout and the box-drawing characters and prints
plain.

| Text                                                                                                                             | Style   |
| -------------------------------------------------------------------------------------------------------------------------------- | ------- |
| section titles, table headers, problem headlines                                                                                 | bold    |
| captions, table borders, `·`, `?`                                                                                                | dim     |
| the name of a skill that is not deployed, in the `Skills` grid                                                                   | dim     |
| `ok`, `none ✓`                                                                                                                   | green   |
| `link`, `link as <entry>`, fix commands                                                                                          | cyan    |
| `clone`, `present`                                                                                                               | magenta |
| every other `STATE`, `clone missing`, `clone ?`, `missing`, ` (not in store)` and ` (not a skill)` names, `!`, the problem count | yellow  |

A cell has one style. A cell that joins several states is yellow when any of them is, and otherwise takes the style of its
first. Paths, other names, and an entry's sentences are never styled.

## Exit code and refusals

Everything `status` reports goes to stdout, because problems are its result, not warnings. It exits 0 whenever `state.json`
loads, problems included.

Beyond creating `~/.grimoire/`'s directories when missing, as every command does, it writes nothing: no workspace, no store
entry, and not `state.json`.

The only refusals are the load failures every command shares. Each prints to stderr and exits 1:

- A `state.json` that is not valid JSON prints `error: <state.json path>: is not valid JSON`. One that does not match its
  shape is refused with a message naming what is wrong.
- A registered workspace or repo whose path touches `~/.grimoire/` — only possible by editing `state.json` by hand. The
  message names which kind: `workspace "bad" cannot be used: …`, or `repo "bad" cannot be used: …` for a repo.

```shell
$ grimoire status
error: workspace "bad" cannot be used: /Users/me/.grimoire/skills sits inside the grimoire store (/Users/me/.grimoire)
  no command can run until it is gone from /Users/me/.grimoire/state.json
```

- A registered workspace whose path equals, contains, or sits inside a registered repo's path — only possible by editing
  `state.json` by hand, or by repointing a symlink after registration. The first workspace by name is reported, against the
  first repo by name it overlaps. A path touching `~/.grimoire/` is reported before any overlap.

```shell
$ grimoire status
error: workspace "dotfiles" cannot be used: /Users/me/dotfiles/skills sits inside repo "library" (/Users/me/dotfiles)
  no command can run until one of them is gone from /Users/me/.grimoire/state.json
```
