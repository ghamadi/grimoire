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

Problems  5

  ! link gone in workspace personal resolves nowhere
    It points into the store, at a skill that is not there.
    Delete the link yourself.

  ! workspace scratch is unreachable
    /Volumes/ext/skills does not resolve.
    Make it readable, or unregister it:
      grimoire workspaces remove scratch

  ! clone of old in workspace work is no longer in the store
    Forget the record:
      grimoire clone old --drop work

  ! clone of lint in workspace work is missing
    Copy it again:
      grimoire clone lint --to work
    Or forget the record:
      grimoire clone lint --drop work

  ! store entry notes.txt is not a skill directory
    Move it out of the store, or add it to "ignore" in /Users/me/.grimoire/state.json.
```

A fix command prints exactly as it would be typed. A word holding any character other than a letter, a digit, `_`, `.`, `/`
or `-` prints in single quotes: `grimoire clone notes --drop '/Users/me/My Projects/skills'`.

## Sections

Sections print in this order:

1. **Workspaces.** Every registered workspace.
2. **Skills.** Every skill, against every registered workspace.
3. **Clones outside workspaces.** Clones recorded by path.
4. **Problems.** See [Problems](#problems).

### Workspaces

One row per registered workspace, sorted by name. The caption is `<n> registered`.

- `MODE` is `auto-link` or `manual`.
- `STATE` is `unreachable` or `unreadable` when the workspace carries that problem. Otherwise it is `ok`, or the count of the
  workspace's problems: `1 problem`, `2 problems`.

An [unreachable or unreadable](../conventions.md#unreachable-and-unreadable-workspaces) workspace gets a single problem, and
no links are read. Its clone records are unverified, because the path may be an unmounted volume with everything intact.

### Skills

One column per registered workspace, sorted by name, after `SKILL`. One row per store skill, plus one per skill that a
workspace holds a clone record for when the skill is not in the store, plus one per store entry that is not a skill, ignored
or not, when a workspace links to it. Rows sort by name. A cell says what that workspace holds of that skill:

| Cell              | Meaning                                                                                        |
| ----------------- | ---------------------------------------------------------------------------------------------- |
| `link`            | a [link](../conventions.md#links-and-clones) to the row's skill or store entry, under its name |
| `link as <entry>` | such a link whose workspace entry has another name                                             |
| `clone`           | a recorded clone whose directory is there                                                      |
| `clone missing`   | a recorded clone whose directory is gone                                                       |
| `clone ?`         | a recorded clone in an unreachable or unreadable workspace, unverified                         |
| `·`               | nothing                                                                                        |
| `?`               | nothing recorded, in an unreachable or unreadable workspace                                    |

A cell holding more than one of these joins them with `, `. A skill that is not in the store has ` (not in store)` after its
name. A store entry that is not a skill directory has ` (not a skill)` after its name when a workspace links to it, even when
a workspace also holds a clone record for it.

A clone record shows in every workspace column and every `Clones outside workspaces` row whose directory it resolves to,
compared as in [links and clones](../conventions.md#links-and-clones). So a `{ path }` record at a registered workspace's
path shows in that workspace's column, and two workspaces registered at one path both show what is there. A skill shows once
per directory, however many records name it there.

The caption is `<n> in <skills path>`, counting store skills, followed by ` · <n> not deployed` when any are. A skill is not
deployed when it has no link in any reachable workspace and no clone. A clone counts when its directory is there, in a
workspace or outside one, and when it is recorded in an unreachable or unreadable workspace, unverified.

`not deployed` is computed only from what could be read, so a skill linked only into an unreachable or unreadable workspace
reads as not deployed. That workspace's `STATE`, its `?` cells, and its entry in `Problems` are the caveat.

With no workspace registered, the grid has the `SKILL` column alone.

### Clones outside workspaces

One row per clone in a directory named by `{ path }` clone records that no registered workspace's path equals, sorted by
directory, then skill. The caption is `directories recorded by path`.

- `STATE` is `present` when `<directory>/<skill>` is a directory, and `missing` otherwise.
- A skill that is not in the store has ` (not in store)` after its name.

These directories are never scanned for links, because grimoire tracks links only in registered workspaces.

A recorded path that no longer resolves or cannot be read earns no problem of its own. Each of its clones reads as `missing`
and as a missing-clone problem, whose remedy is a [`clone --drop`](./clone.md#clone-skill---drop-targets) naming that path.

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

Width is counted as string length, not in terminal columns. So a CJK character, most emoji, or a separately stored accent in
a path, skill name or entry name puts its row out of line with the borders, and can make a fitted table wider than the
terminal.

## Problems

| Problem                      | Reported when                                                                                   | Reported for             |
| ---------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------ |
| unreachable workspace        | the workspace is [unreachable](../conventions.md#unreachable-and-unreadable-workspaces)         | workspace                |
| unreadable workspace         | the workspace is [unreadable](../conventions.md#unreachable-and-unreadable-workspaces)          | workspace                |
| dangling link                | a link into the store does not resolve; see [Dangling links](#dangling-links)                   | workspace (reachable)    |
| clone no longer in the store | the record's `<dir>/<skill>` is a directory, and the skill is not in the store                  | workspace, recorded path |
| missing clone                | the record's `<dir>/<skill>` is not a directory                                                 | workspace, recorded path |
| stray entry                  | a store entry is not a skill and is not ignored; see [Stray entries](#stray-entries-and-ignore) | store                    |

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
  ! workspace <name> is unreachable
    <path> does not resolve.
    Make it readable, or unregister it:
      grimoire workspaces remove <name>

  ! workspace <name> is unreadable
    <path> cannot be read.
    Make it readable, or unregister it anyway:
      grimoire workspaces remove <name> --force

  ! link <entry> in workspace <name> resolves nowhere
    It points into the store, at a skill that is not there.
    Delete the link yourself.

  ! clone of <skill> in <location> is no longer in the store
    Forget the record:
      grimoire clone <skill> --drop <target>

  ! clone of <skill> in workspace <name> is missing
    Copy it again:
      grimoire clone <skill> --to <name>
    Or forget the record:
      grimoire clone <skill> --drop <name>

  ! clone of <skill> in <location> is missing
    Forget the record:
      grimoire clone <skill> --drop <target>

  ! store entry <entry> is not a skill directory
    Move it out of the store, or add it to "ignore" in <state path>.
```

The "Copy it again" form of a missing clone appears only for a workspace and a skill still in the store. A record whose
directory is gone, for a skill also gone from the store, is reported once, as missing.

### Dangling links

A dangling link is found from the link's target text, without following it. The text, resolved against the link's directory,
names a path under the store's `skills/` directory, and the link does not resolve.

A link that reached the store through a now-missing intermediate symlink reads as an ordinary broken link and is not
reported.

### Stray entries and `ignore`

A stray entry is an entry in the store's `skills/` directory that is not a skill directory and matches no glob in
`state.json`'s `ignore`, which defaults to `[".DS_Store"]`. Each glob is matched against the entry's name.

An entry that is a symlink cycle, or that cannot be read, is not a skill directory, so it is a stray entry.

There is no exemption for dot-entries. A version-controlled store's `.git` prints as stray until it is added to `ignore`.
`status` is the only command that reads `ignore`.

### Manual fixes

Two problems have no fix command: dangling links and stray entries.

## Empty cases

- No workspace registered: the `Workspaces` section is the one line `Workspaces  none registered`, with no table.
- No store skill, no clone recorded in a workspace, and no workspace link into the store: the grid has no row, so the
  `Skills` section is its title line, `Skills  0 in <skills path>`, with no table.
- No clone recorded outside a workspace: the `Clones outside workspaces` section does not print.
- With no problems, the `Problems` section is the one line `Problems  none ✓`.

## Colors

Colored as in [colors](../conventions.md#colors).

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
first. Other names and an entry's sentences are never styled.

## Exit code and refusals

Problems are what `status` reports, so they go to stdout with the rest. It exits 0 whenever `state.json` loads, problems
included.

Beyond creating `~/.grimoire/`'s directories when missing, as every command does, it writes nothing: no workspace, no store
entry, and not `state.json`.

Its only refusals are the [load failures](../state.md#load-failures) every command shares.
