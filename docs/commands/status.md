# `status`

`status` is a read-only inventory of every deployment, grouped by where it lives. Problems print in their own section, last,
each with its fix.

```shell
grimoire status
```

It takes no arguments and no flags.

## Output

```shell
$ grimoire status
personal  auto-link  /Users/me/.claude/skills
  linked   brainstorm, deploy, triage (entry "tri")

scratch   manual     /Volumes/ext/skills
  cloned   deploy
  unreachable

work      manual     /Users/me/work/.agents/skills
  linked   triage
  cloned   deploy, old

/Users/me/old/skills  recorded by path
  cloned   notes

store     /Users/me/.grimoire/skills
  not deployed  review

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

- Blocks are separated by one blank line.
- The name column is padded to the widest workspace name, or to `store` if that is wider. The mode column is padded to
  `auto-link`.
- Lines inside a block are indented two spaces and print in order: `linked`, `cloned`, `not deployed`.
- Lists are comma-separated on one line.
- The block of an unreachable or unreadable workspace ends with one line saying which: `unreachable` or `unreadable`.
- No problem prints inside a block. The `Problems` section follows the store block after one blank line. Its title line is
  `Problems`, two spaces, and the number of problems.
- Each problem is an entry. One blank line follows the title, and one separates entries.
- An entry starts with ` !` and a headline naming the kind of entity and its name. Its other lines are indented four spaces.
- A fix that is a command prints alone on its line, exactly as it would be typed, indented six spaces. A fix that is not a
  command is a sentence.
- No line of an entry is wrapped by grimoire.

## Blocks

Blocks print in three kinds, in this order:

1. **Workspace blocks.** Every registered workspace, sorted by name.
2. **Recorded-path blocks.** One per directory named by `{ path }` clone records that no registered workspace's path equals,
   sorted by path.
3. **The store block.** Always printed, last.

### Workspace blocks

The heading line is `<name>  <mode>  <path>`.

- `linked` lists the store skills linked into the workspace: a symlink in the workspace that resolves, following chains, to a
  store skill. A skill whose workspace entry has a different name is followed by `(entry "<name>")`.
- `cloned` lists the skills with a clone record naming the workspace's directory.

A workspace whose path does not resolve to a directory is unreachable. It gets a single `workspace-unreachable` problem, and
no links are read. `cloned` lists its records unverified, because the path may be an unmounted volume with everything intact.

A workspace whose path is a directory that grimoire cannot list or enter, or that sits under a directory it cannot enter, is
unreadable. It is treated like an unreachable one: a single problem, no links read, and `cloned` listing its records
unverified. The problem is `workspace-unreadable`.

### Recorded-path blocks

The heading line is `<path>  recorded by path`. These blocks hold clones only. They are never scanned for links, because
grimoire tracks links only in registered workspaces.

A recorded path that no longer resolves or cannot be read earns no block-level problem. Each of its clones reads as
`clone-missing`, whose remedy is an [`unclone`](./unclone.md) naming that path.

### The store block

The heading line is `store  <skills path>`. `not deployed` lists the store skills with no link in any reachable workspace and
no clone listed in any block.

It is computed only from what could be read, so a skill linked only into an unreachable or unreadable workspace reads as not
deployed. That workspace's `unreachable` or `unreadable` line, and its entry in `Problems`, are the caveat.

### A clone belongs to its directory

A clone record's identity is the directory it resolves to, compared canonically — see
[what counts as the clone](./clone.md#what-counts-as-the-clone). A record appears in every block whose directory it resolves
to:

- A `{ path }` record for a registered workspace's path shows in that workspace's block.
- Two workspaces registered at one path both show what is there.

`cloned` lists each skill once per block, and only when `<dir>/<skill>` is a directory. A record whose directory is gone
shows only as a problem.

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

Each problem prints as an entry in the `Problems` section, in the order the blocks print: each workspace's, then each
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

There is no exemption for dot-entries. A version-controlled store's `.git` prints as stray until it is added to `ignore`.
`status` is the only command that reads `ignore`.

### Remedies and `doctor`

Every entry names its fix: a command alone on its line where one exists, and otherwise a sentence giving the manual step.
Three are manual today: dangling links, stray entries, and records naming an unregistered workspace.
[`unclone`](./unclone.md) cannot reach the last one, because an unregistered name refuses.

The planned `doctor` command is where these get repaired.

## Empty cases

- No workspace registered: the line `No workspaces registered.` replaces the workspace blocks. Recorded-path blocks and the
  store block still follow.
- A reachable workspace with no links and no clones prints `  nothing deployed`.
- An unreachable or unreadable workspace's block prints its `unreachable` or `unreadable` line, never `nothing deployed`.
- An empty store's block has `  no skills` as its only content line.
- With no problems, the `Problems` section is the one line `Problems  none ✓`.

## Colors

On a color-capable stdout only. Piped output, or `NO_COLOR` set, prints plain.

- Block names are bold. The mode, the heading path, and `recorded by path` are dim.
- The `linked` and `cloned` labels are cyan.
- `not deployed`, `nothing deployed`, `no skills`, and the `unreachable` or `unreadable` line are dim.
- The `Problems` title is bold. The count is yellow, and `none ✓` is green.
- In an entry, `!` is yellow, the headline is bold, and a fix command is cyan.

Content text and an entry's sentences are never styled.

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
