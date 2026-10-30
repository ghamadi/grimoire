# grimoire

One store for your agent skills, linked into every directory your agents read from.

grimoire is for anyone who keeps the same skills in more than one place: two agents, two accounts, or a project's own
`.agents/skills`. Copy them by hand, and each copy drifts as you edit it, and nothing records where they went. Symlinking by
hand fixes the drift, but you make every link yourself, and nothing tells you when one breaks.

grimoire keeps one copy in a store you edit, links it into each directory, and tracks every place it went. For a directory
that can't use a link, it makes a copy instead and keeps a record of it. For version history or sharing, it exports skills
into a git repo of yours.

```
Before
~/.claude/skills/triage/              a copy
~/.claude-work/skills/triage/         another copy, drifting from the first

After
~/.grimoire/skills/triage/            the one copy you edit
~/.claude/skills/triage         ──►   ~/.grimoire/skills/triage
~/.claude-work/skills/triage    ──►   ~/.grimoire/skills/triage
```

## Install

```shell
npm install -g @ghamadi/grimoire
```

It installs `grimoire` and `grim`, the same binary under a shorter name. It needs Node 22.18 or later, on macOS or Linux. npm
refuses the install on Windows; WSL works.

grimoire ships no skills. It manages the ones you write or already have on disk. Given a git URL, it copies skills from the
repo once and records nothing about the source, so later changes to the repo never reach your store.

## How it works

The **store** is `~/.grimoire/skills/`, with one directory per skill. It is the copy you edit.

A **workspace** is a directory an agent reads skills from, such as `~/.claude/skills` or a project's `.agents/skills`. A
**repo** is a directory inside a git work tree, where you keep skills under version control or share them. You register
workspaces and repos by name.

> [!NOTE]
>
> grimoire works without any repo. You need git installed only to export skills to a repo, or to add skills from a git URL.

A skill leaves the store in one of these ways:

| Command       | Writes                         | Follows store edits                         | Use it for                                                         |
| ------------- | ------------------------------ | ------------------------------------------- | ------------------------------------------------------------------ |
| `link`        | a symlink in a workspace       | yes, immediately                            | the default                                                        |
| `clone`       | a recorded copy in a workspace | no, until `clone --overwrite` refreshes it  | a workspace that cannot use a symlink, or a project's local skills |
| `export`      | a copy in a repo               | no, until you export again                  | history, review and sharing with git                               |
| `skills pack` | a zip in a folder you choose   | no, until you delete the zip and pack again | uploading to a provider such as claude.ai                          |

A workspace registered with `--auto-link` receives a link to every skill added to the store after it.

## Quick start

Say your skills already sit in `~/.claude/skills`, and you've set up a second Claude account for work, with its config in
`~/.claude-work`. You want some of your skills available there too. The steps are the same for any other agent that reads
skills from a directory: register that directory as one more workspace.

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

### 3. Add skills from a git repo

```shell
$ grimoire skills add https://github.com/someone/skills.git --all
cloning https://github.com/someone/skills.git…
added deploy
linked deploy → claude-personal
```

grimoire clones the repo into a temporary directory, adds the skills it finds there, and deletes the clone. The store copy of
`deploy` is now yours to edit like any other.

### 4. Share a skill with a second workspace

```shell
$ grimoire workspaces add claude-work ~/.claude-work/skills
created /Users/me/.claude-work/skills
registered workspace "claude-work" → /Users/me/.claude-work/skills (manual)

$ grimoire link triage --to claude-work
linked triage → claude-work
```

`claude-work` has no `--auto-link`, so it gets only the skills you link into it. An edit to `triage` in the store now shows
in both workspaces. `grimoire workspaces add` creates the directory when it is missing.

### 5. See where everything is deployed

```shell
$ grimoire status
Workspaces  2 registered
┌─────────────────┬───────────┬───────┬───────────────────────────────┐
│ NAME            │ MODE      │ STATE │ PATH                          │
├─────────────────┼───────────┼───────┼───────────────────────────────┤
│ claude-personal │ auto-link │ ok    │ /Users/me/.claude/skills      │
│ claude-work     │ manual    │ ok    │ /Users/me/.claude-work/skills │
└─────────────────┴───────────┴───────┴───────────────────────────────┘

Skills  3 in /Users/me/.grimoire/skills
┌────────────┬─────────────────┬─────────────┐
│ SKILL      │ claude-personal │ claude-work │
├────────────┼─────────────────┼─────────────┤
│ brainstorm │ link            │ ·           │
│ deploy     │ link            │ ·           │
│ triage     │ link            │ link        │
└────────────┴─────────────────┴─────────────┘

Problems  none ✓
```

The grid shows what each workspace holds of each skill, and `·` means nothing. `Problems` lists anything stale, such as a
dangling link or a missing clone, each with its fix.

### Going further

```shell
code "$(grimoire skills path triage)"       # open the store copy of triage in your editor
grimoire link triage --drop claude-work     # remove the link, and keep the skill in the store
grimoire clone brainstorm --to claude-work  # a real copy instead of a link
grimoire repos add library ~/dotfiles       # register a directory in a git work tree
grimoire export triage --to library         # copy triage into it, then commit it yourself
grimoire skills pack triage --out ~/dist    # zip triage for uploading to a provider
grimoire skills remove triage               # unlink it everywhere and move the store copy to the trash
```

## What grimoire touches

Outside its store, grimoire removes only its own symlinks and directories the store already holds in full: the same files,
with the same contents. Two commands go further, but only where you point them:

- `clone --overwrite` replaces a skill directory in a workspace with the store copy.
- `export` replaces a skill's entry in a repo when git reports nothing uncommitted there, or when you pass `--force`. Files
  git ignores are not protected. _**grimoire only reads from git: it never commits, stages or pushes**_.

`skills pack` writes zips into the folder you choose and never replaces what is already there.

On `grimoire update`, npm replaces grimoire's own installed package, and nothing else.

Skills removed from the store go to `~/.grimoire/.trash/` until `grimoire trash empty`. The full rule is in
[`docs/safety.md`](./docs/safety.md).

## Commands

| Command                                       | Description                                                     |
| --------------------------------------------- | --------------------------------------------------------------- |
| [`workspaces`](./docs/commands/workspaces.md) | Manage the workspaces grimoire deploys to                       |
| [`skills`](./docs/commands/skills.md)         | Manage the skills in the grimoire store                         |
| [`link`](./docs/commands/link.md)             | Symlink store skills into workspaces, or remove their links     |
| [`clone`](./docs/commands/clone.md)           | Copy a store skill into workspaces, or forget its clone records |
| [`repos`](./docs/commands/repos.md)           | Manage the git repos grimoire exports skills to                 |
| [`export`](./docs/commands/export.md)         | Copy store skills into repos, replacing what is there           |
| [`trash`](./docs/commands/trash.md)           | Manage the trash that removed skills are moved to               |
| [`status`](./docs/commands/status.md)         | Show where skills are deployed, and what has gone stale         |
| [`update`](./docs/commands/update.md)         | Update grimoire to the latest release                           |

Each page lists the command's arguments, every outcome and its exact output. `grimoire <command> --help` prints the short
form.

## Further reading

- [`docs/safety.md`](./docs/safety.md): what grimoire writes and removes outside its store.
- [`docs/conventions.md`](./docs/conventions.md): the output, exit codes and refusals every command shares.
- [`docs/state.md`](./docs/state.md): the `~/.grimoire/` layout and `state.json`, which you can edit by hand.

## License

[MIT](./LICENSE)
