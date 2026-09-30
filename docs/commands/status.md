# `status`

`status` is a read-only inventory of every deployment, grouped by where it lives. Each problem is flagged in the block it
concerns, together with the command that fixes it.

```shell
grimoire status
```

It takes no arguments and no flags.

## Output

```shell
$ grimoire status
personal  auto-link  /Users/me/.claude/skills
  linked   brainstorm, deploy, triage (entry "tri")
  problem  gone is a link into the store that resolves nowhere — delete it yourself

work      manual     /Users/me/work/.agents/skills
  linked   triage
  cloned   deploy, old
  problem  old is no longer in the store — forget the record with `grimoire unclone old work`
  problem  the clone of lint is missing — copy it again with `grimoire clone lint work`, or forget it with `grimoire unclone lint work`

scratch   manual     /Volumes/ext/skills
  cloned   deploy
  problem  /Volumes/ext/skills does not resolve — make it readable, or unregister it with `grimoire workspaces remove scratch`

/Users/me/old/skills  recorded by path
  cloned   notes

store     /Users/me/.grimoire/skills
  not deployed  review
  problem  notes.txt is not a skill directory — move it out of the store, or add it to "ignore" in /Users/me/.grimoire/state.json
  problem  a clone of triage is recorded under "ghost", which is not registered — remove it from /Users/me/.grimoire/state.json
```

- Blocks are separated by one blank line.
- The name column is padded to the widest workspace name, or to `store` if that is wider. The mode column is padded to
  `auto-link`.
- Lines inside a block are indented two spaces and print in order: `linked`, `cloned`, `not deployed`, then problems.
- Lists are comma-separated on one line.
- A problem is one line and is never hard-wrapped.

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

The heading line is `<path>  recorded by path`. These blocks hold clones and clone problems only. They are never scanned for
links, because grimoire tracks links only in registered workspaces.

A recorded path that no longer resolves or cannot be read earns no block-level problem. Each of its clones reads as
`clone-missing`, whose remedy is an [`unclone`](./unclone.md) naming that path.

### The store block

The heading line is `store  <skills path>`. `not deployed` lists the store skills with no link in any reachable workspace and
no clone listed in any block.

It is computed only from what could be read, so a skill linked only into an unreachable or unreadable workspace reads as not
deployed. The `workspace-unreachable` or `workspace-unreadable` problem printed above it is the caveat.

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

The text after `problem  ` is one of the following. `<target>` is the workspace name in a workspace block, and the path in a
recorded-path block.

```
workspace-unreachable         <path> does not resolve — make it readable, or unregister it with `grimoire workspaces remove <name>`
workspace-unreadable          <path> cannot be read — make it readable, or unregister it anyway with `grimoire workspaces remove <name> --force`
dangling-link                 <entry> is a link into the store that resolves nowhere — delete it yourself
clone-not-in-store            <skill> is no longer in the store — forget the record with `grimoire unclone <skill> <target>`
clone-missing (recloneable)   the clone of <skill> is missing — copy it again with `grimoire clone <skill> <name>`, or forget it with `grimoire unclone <skill> <name>`
clone-missing                 the clone of <skill> is missing — forget it with `grimoire unclone <skill> <target>`
clone-unregistered-workspace  a clone of <skill> is recorded under "<workspace>", which is not registered — remove it from <statePath>
stray-entry                   <entry> is not a skill directory — move it out of the store, or add it to "ignore" in <statePath>
```

The recloneable form of `clone-missing` appears only in a workspace block, for a skill still in the store. A recorded-path
block has no workspace name to `clone` into, and a skill gone from the store has nothing to copy.

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

Every problem names its fix: a command where one exists, and otherwise the manual step. Three are manual today: dangling
links, stray entries, and records naming an unregistered workspace. [`unclone`](./unclone.md) cannot reach the last one,
because an unregistered name refuses.

The planned `doctor` command is where these get repaired.

## Empty cases

- No workspace registered: the line `No workspaces registered.` replaces the workspace blocks. Recorded-path blocks and the
  store block still follow.
- A reachable workspace with no links, no clones, and no problems prints `  nothing deployed`.
- An empty store's block has `  no skills` as its only content line, followed by any problems.

## Colors

On a color-capable stdout only. Piped output, or `NO_COLOR` set, prints plain.

- Block names are bold. The mode, the heading path, and `recorded by path` are dim.
- The `linked` and `cloned` labels are cyan, and the `problem` label is yellow.
- `not deployed`, `nothing deployed`, and `no skills` are dim.

Content text is never styled.

## What `status` never reports

Clone drift. `status` never compares a clone to the store, because drifting is what a clone is for — see
[`clone`](./clone.md). This is permanent, not deferred.

## Exit code and refusals

Everything `status` reports goes to stdout, because problems are its result, not warnings. It exits 0 whenever `state.json`
loads, problems included.

Beyond creating `~/.grimoire/`'s directories when missing, as every command does, it writes nothing: no workspace, no store
entry, and not `state.json`.

The only refusals are the load failures every command shares. Each prints to stderr and exits 1:

- A `state.json` that is not valid JSON prints `grimoire: <state.json path>: is not valid JSON`. One that does not match its
  shape is refused with a message naming what is wrong.
- A registered workspace whose path touches `~/.grimoire/` — only possible by editing `state.json` by hand:

```shell
$ grimoire status
grimoire: workspace "bad" cannot be used: /Users/me/.grimoire/skills sits inside the grimoire store (/Users/me/.grimoire)
  no command can run until it is gone from /Users/me/.grimoire/state.json
```
