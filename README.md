# grimoire

One store for your agent skills. Deploy them to every directory your agents read from, and export them to git repos for
history and sharing.

If you run more than one agent, account or config directory, each one needs its own copy of your skills. The copies drift as
you edit them, and nothing records where they went. Symlinking by hand fixes the drift, but you make every link yourself, and
nothing tells you when one breaks.

grimoire keeps one copy of each skill in a store you edit, deploys it from there, and tracks every place it went. When you
want version history, or to share skills with others, it exports them into a git repo of yours.

grimoire manages skills you write or already have on disk. It ships no skills, fetches none, and is not a package manager.

## Install

```shell
npm install -g @ghamadi/grimoire
pnpm add -g @ghamadi/grimoire
yarn global add @ghamadi/grimoire
bun add -g @ghamadi/grimoire
```

This installs `grimoire` and `grim`, the same binary under a shorter name.

It needs Node 22.18 or later, on macOS or Linux. npm refuses the install on Windows; WSL works. git is needed only to export
skills to a repo.

> [!NOTE]
>
> [`grimoire update`](./docs/commands/update.md) can update grimoire itself only when it was installed with `npm install -g`.
> If you installed it with pnpm, yarn or bun, `grimoire update` installs nothing. It prints the command for you to run with
> your package manager instead.

## How it works

The **store** is `~/.grimoire/skills/`, with one directory per skill. It is the copy you edit.

A **workspace** is a directory an agent reads skills from, such as `~/.claude/skills` or a project's `.agents/skills`. A
**repo** is a directory inside a git work tree. You register each by name.

A skill leaves the store in one of three ways:

| Command  | Writes                         | Follows store edits                        | Use it for                                                         |
| -------- | ------------------------------ | ------------------------------------------ | ------------------------------------------------------------------ |
| `link`   | a symlink in a workspace       | yes, immediately                           | the default                                                        |
| `clone`  | a recorded copy in a workspace | no, until `clone --overwrite` refreshes it | a workspace that cannot use a symlink, or a project's local skills |
| `export` | a copy in a repo               | no, until you export again                 | history, review and sharing with git                               |

A workspace registered with `--auto-link` receives a link to every skill added to the store after it.

## Quick start

Say your skills already sit in `~/.claude/skills`, and you've set up a second Claude account for work, with its config in
`~/.claude-work`. You want some of your skills available there too.

### 1. Register the directory your skills are in

```shell
$ grimoire workspaces add claude-personal ~/.claude/skills --auto-link
registered workspace "claude-personal" → /Users/me/.claude/skills (auto-link)
```

`~/.claude/skills` is now a workspace named `claude-personal`. With `--auto-link`, every skill added to the store from now on
is linked into it.

### 2. Move your skills into the store

```shell
$ grimoire skills add ~/.claude/skills --all
added brainstorm
added triage
linked brainstorm → claude-personal
linked triage → claude-personal
```

Each skill is copied into `~/.grimoire/skills/`. Because `claude-personal` is auto-link, each original directory is then
replaced with a link to its store copy, which holds the same files. Without `--all`, grimoire displays a picker for you to
choose the skills you want to add.

### 3. Share a skill with a second workspace

```shell
$ grimoire workspaces add claude-work ~/.claude-work/skills
registered workspace "claude-work" → /Users/me/.claude-work/skills (manual)

$ grimoire link triage claude-work
linked triage → claude-work
```

`claude-work` has no `--auto-link`, so it gets only the skills you link into it. An edit to `triage` in the store now shows
in both workspaces.

### 4. See where everything is deployed

```shell
$ grimoire status
Workspaces  2 registered
┌─────────────────┬───────────┬───────┬───────────────────────────────┐
│ NAME            │ MODE      │ STATE │ PATH                          │
├─────────────────┼───────────┼───────┼───────────────────────────────┤
│ claude-personal │ auto-link │ ok    │ /Users/me/.claude/skills      │
│ claude-work     │ manual    │ ok    │ /Users/me/.claude-work/skills │
└─────────────────┴───────────┴───────┴───────────────────────────────┘

Skills  2 in /Users/me/.grimoire/skills
┌────────────┬─────────────────┬─────────────┐
│ SKILL      │ claude-personal │ claude-work │
├────────────┼─────────────────┼─────────────┤
│ brainstorm │ link            │ ·           │
│ triage     │ link            │ link        │
└────────────┴─────────────────┴─────────────┘

Problems  none ✓
```

The grid shows what each workspace holds of each skill, and `·` means nothing. `Problems` lists anything stale, such as a
dangling link or a missing clone, each with its fix.

### Going further

```shell
grimoire clone brainstorm claude-work   # a real copy instead of a link
grimoire repos add library ~/dotfiles   # register a directory in a git work tree
grimoire export library triage          # copy triage into it, then commit it yourself
grimoire skills remove triage           # unlink it everywhere and move the store copy to the trash
```

## What grimoire touches

Outside its store, grimoire removes only its own symlinks and directories the store already holds in full: the same files,
with the same contents. Two commands go further, but only where you point them:

- `clone --overwrite` replaces a skill directory in a workspace with the store copy.
- `export` replaces a skill's entry in a repo when git reports nothing uncommitted there, or when you pass `--force`. Files
  git ignores are not protected. _**grimoire only reads from git: it never commits, stages or pushes**_.

On `grimoire update`, npm replaces grimoire's own installed package, and nothing else.

Skills removed from the store go to `~/.grimoire/.trash/` until `grimoire trash empty`. The full rule is in
[`docs/safety.md`](./docs/safety.md).

## Commands

| Command                                       | Description                                             |
| --------------------------------------------- | ------------------------------------------------------- |
| [`workspaces`](./docs/commands/workspaces.md) | Manage the workspaces grimoire deploys to               |
| [`skills`](./docs/commands/skills.md)         | Manage the skills in the grimoire store                 |
| [`link`](./docs/commands/link.md)             | Symlink store skills into workspaces                    |
| [`unlink`](./docs/commands/unlink.md)         | Remove a skill's links from workspaces                  |
| [`clone`](./docs/commands/clone.md)           | Copy a store skill into workspaces                      |
| [`unclone`](./docs/commands/unclone.md)       | Forget clone records                                    |
| [`repos`](./docs/commands/repos.md)           | Manage the git repos grimoire exports skills to         |
| [`export`](./docs/commands/export.md)         | Copy store skills into a repo, replacing what is there  |
| [`trash`](./docs/commands/trash.md)           | Manage the trash that removed skills are moved to       |
| [`status`](./docs/commands/status.md)         | Show where skills are deployed, and what has gone stale |
| [`update`](./docs/commands/update.md)         | Update grimoire to the latest release                   |

Each page lists the command's arguments, every outcome and its exact output. `grimoire <command> --help` prints the short
form.

## Further reading

- [`docs/safety.md`](./docs/safety.md): what grimoire writes and removes outside its store.
- [`docs/conventions.md`](./docs/conventions.md): the output, exit codes and refusals every command shares.
- [`docs/state.md`](./docs/state.md): the `~/.grimoire/` layout and `state.json`, which you can edit by hand.

## License

[MIT](./LICENSE)
