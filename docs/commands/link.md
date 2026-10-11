# `link`

`link` symlinks store skills into one or more workspaces, so an edit to the store copy shows up in each of them immediately.
[`clone`](./clone.md) is the copy, for a workspace that cannot use a link.

```shell
grimoire link <skill> [workspaces...]
grimoire link --all-skills [workspaces...]
```

## Arguments

| Argument          | Meaning                                             |
| ----------------- | --------------------------------------------------- |
| `<skill>`         | The store skill to link.                            |
| `[workspaces...]` | Registered workspace names to link into.            |
| `--all-skills`    | Every skill the store holds, instead of naming one. |

`<skill>` is required unless `--all-skills` is given. With no workspace named, the destinations are every
[auto-link](./workspaces.md#workspaces-add-name-path---auto-link) workspace. A name given twice counts once, keeping its
first position.

Under `--all-skills` there is no skill argument, so every positional is read as a workspace name:
`grimoire link triage --all-skills` fails with `no workspace named "triage"`.

## What counts as the link

`<dest>` below is `<workspace path>/<skill>`. The link is a symlink at `<dest>` whose target is the store path as written,
`/Users/me/.grimoire/skills/<skill>`, not its realpath.

`already linked` means `<dest>` is a symlink that resolves, following chains, to the store's `<skill>` directory.

Nothing is written to `state.json`. Only `<dest>` is examined, so a link to the same skill under another entry name is not
seen, and a second link is written beside it.

A missing workspace directory is never created.

## `link <skill> <workspaces...>`

Each pair gets one outcome, decided by what sits at `<dest>`:

| At `<dest>`                                        | Outcome  | Output                                                                                                                                                                                                      |
| -------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| the workspace path does not resolve                | skipped  | stderr `warning: workspace "<workspace>" was skipped: <workspace path> is not an existing directory`                                                                                                        |
| the workspace cannot be read                       | skipped  | stderr `warning: workspace "<workspace>" was skipped: <workspace path> cannot be read`                                                                                                                      |
| nothing                                            | linked   | stdout `linked <skill> → <workspace>`                                                                                                                                                                       |
| a symlink resolving to this store skill            | success  | stdout `already linked <skill> → <workspace>`                                                                                                                                                               |
| any other symlink, dangling ones included          | declined | stderr `warning: could not link <skill> → <workspace>: <dest> is a symlink pointing elsewhere`                                                                                                              |
| a directory with a clone record                    | declined | stderr ``warning: could not link <skill> → <workspace>: <dest> is a clone — unclone it first with `grimoire unclone <skill> <workspace>` ``                                                                 |
| a directory the store copy holds in full           | replaced | stdout `linked <skill> → <workspace>`                                                                                                                                                                       |
| a directory holding something the store copy lacks | declined | stderr ``warning: could not link <skill> → <workspace>: <dest> holds a directory that differs from the store copy at "<entry>" — keep it with `grimoire clone <skill> <workspace>`, or delete it yourself`` |
| a directory that cannot be compared (a symlink)    | declined | stderr `warning: could not link <skill> → <workspace>: <root> holds the symlink "<entry>", so the two copies cannot be compared`                                                                            |
| anything else                                      | declined | stderr `warning: could not link <skill> → <workspace>: <dest> is not a directory`                                                                                                                           |

```shell
$ grimoire link triage personal work scratch
linked triage → personal
already linked triage → work
warning: could not link triage → scratch: /Users/me/scratch/skills/triage holds a directory that differs from the store copy at "notes.md" — keep it with `grimoire clone triage scratch`, or delete it yourself
```

Lines print grouped as `linked`, then `already linked`, then warnings. Inside a group, pairs are in argument order, and among
the warnings a skipped workspace comes before any pair. A decline or a skip alongside any `linked` or `already linked` pair
prints as a warning on stderr, and the exit code stays 0.

### Replacing a directory the store already holds

A directory at `<dest>` is removed and replaced by the link when the store copy holds it in full. That is containment, not
equality: every entry under `<dest>` must exist in the store copy with the same type, the same bytes and the same execute
bit. What only the store copy holds does not matter, so an empty directory is replaced too. A `.DS_Store` written by Finder
is not counted.

The replacement prints the plain `linked` line, the same as for an empty destination: the store already held that content.
This is the removal [the rule](../safety.md) allows, and what makes `skills add`
[double as adoption](./skills.md#the-name-in-the-store).

A directory holding anything else is declined, and `<entry>` names the first path that differs, relative to `<dest>`.

A directory that holds a symlink cannot be compared, and is declined. `<root>` is the side holding it: `<dest>` when the
directory holds any symlink, the store skill path when the store copy holds one at a path the directory also has.

### A recorded clone is never replaced

A directory at `<dest>` that a clone record names is declined before any comparison, even when it matches the store copy. A
record by either arm counts, `{ workspace }` or `{ path }`. [`unclone`](./unclone.md) drops the record, after which the
directory is compared like any other.

### A workspace is skipped once

A workspace whose path does not resolve to a directory, or cannot be read, is skipped once per run, not once per skill. Its
line carries no skill name. These are the conditions [`status`](./status.md) reports as `workspace-unreachable` and
`workspace-unreadable`.

### When every pair is declined

A run that has warnings and no `linked` or `already linked` pair exits 1, and prints them as an error instead. One prints as
a single line:

```shell
$ grimoire link triage work
error: could not link triage → work: /Users/me/work/.agents/skills/triage is a symlink pointing elsewhere
```

Several print `error: nothing linked:`, followed by each sentence on its own line, indented two spaces:

```shell
$ grimoire link triage personal work
error: nothing linked:
  could not link triage → personal: /Users/me/.claude/skills/triage is a clone — unclone it first with `grimoire unclone triage personal`
  could not link triage → work: /Users/me/work/.agents/skills/triage is a symlink pointing elsewhere
```

## `link <skill>`

The auto-link workspaces are taken sorted by name. Each is treated exactly as if it had been named, so outcomes, grouping,
warnings, and the exit code follow the rules above, with name order in place of argument order:

```shell
$ grimoire link triage
linked triage → personal
already linked triage → scratch
```

If no auto-link workspace is registered, the exit code is 0:

```shell
$ grimoire link triage
nothing to link: no auto-link workspace is registered
```

## `link --all-skills [workspaces...]`

Every skill the store holds, in name order. With no workspace named, the destinations are the same auto-link set as
`link <skill>`. Output is grouped as above, and inside a group pairs go by skill first. Below, the directory of `work` is
gone, and `work` is [skipped once](#a-workspace-is-skipped-once):

```shell
$ grimoire link --all-skills
linked brainstorm → personal
linked triage → personal
warning: workspace "work" was skipped: /Users/me/work/.agents/skills is not an existing directory
```

If the store holds no skills, the exit code is 0:

```shell
$ grimoire link --all-skills
nothing to link: the store holds no skills
```

## What `link` refuses

A refusal exits 1 and touches nothing. The checks run in the order below.

**1. A skill is given, or `--all-skills`.**

```shell
$ grimoire link
error: missing required argument 'skill' (or use --all-skills)
```

**2. The skill exists in the store.**

```shell
$ grimoire link ghost personal
error: no skill named "ghost"
```

**3. The skill passes the portability check.** Every skill is verified before any destination is examined, so under
`--all-skills` one unportable skill refuses the whole run.

```shell
$ grimoire link triage personal
error: skill "/Users/me/.grimoire/skills/triage" is not portable. Contains a nested skill.
```

**4. Every named workspace is registered.** Only the first unregistered name is reported.

```shell
$ grimoire link triage personal ghost
error: no workspace named "ghost"
```
