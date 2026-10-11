# grimoire

One store for your agent skills, fanned out to the config directories and projects where agents read them.

Running more than one agent account or config directory means copying every skill N times — edits drift, and there is no
record of where the copies went. Grimoire keeps a single editing surface (`~/.grimoire/skills/`) and deploys from there:
**link** into a workspace (a directory an agent reads skills from) for live edits, **clone** a real copy where a link cannot
work, **export** into a git repo of yours for history and sharing.

It is not a discovery or package-manager tool. It ships no skills of its own. Installers for other people's skill repos
already exist — **they install other people's skills; grimoire maintains your own.**

## Install

```shell
npm install -g @ghamadi/grimoire
```

This installs `grimoire` and `grim`, the same binary under a shorter name.

## Requirements

- Node 22.18 or later.
- macOS or Linux. npm refuses the install on Windows; WSL works.
- git, only for `repos add` and `export`.

## Quick start

Say your skills already sit in `~/.claude/skills`, and a second config directory, `~/.claude-work/skills`, should share one
of them.

```shell
$ grimoire workspaces add personal ~/.claude/skills --auto-link
registered workspace "personal" → /Users/me/.claude/skills (auto-link)

$ grimoire skills add ~/.claude/skills --all
added brainstorm
added triage
linked brainstorm → personal
linked triage → personal

$ grimoire workspaces add work ~/.claude-work/skills
registered workspace "work" → /Users/me/.claude-work/skills (manual)

$ grimoire link triage work
linked triage → work

$ grimoire status
personal  auto-link  /Users/me/.claude/skills
  linked   brainstorm, triage

work      manual     /Users/me/.claude-work/skills
  linked   triage

store     /Users/me/.grimoire/skills
```

`skills add` copied each skill into `~/.grimoire/skills/` and replaced the original directory with a symlink to it. An edit
to the store copy now shows in both workspaces, and dropping `--all` in a terminal gives a picker.

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
| [`status`](./docs/commands/status.md)         | Show where skills are deployed, and what has gone stale |

What grimoire will and will not touch outside its store is in [`docs/safety.md`](./docs/safety.md), and the `~/.grimoire/`
layout in [`docs/state.md`](./docs/state.md).

## License

[MIT](./LICENSE)
