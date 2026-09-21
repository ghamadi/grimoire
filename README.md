# grimoire

One store for your agent skills, fanned out to the config directories and projects where agents read them.

Running more than one agent account or config directory means copying every skill N times — edits drift, and there is no
record of where the copies went. Grimoire keeps a single editing surface (`~/.grimoire/skills/`) and deploys from there:
**link** into a workspace for live edits, **clone** where a copy should drift on its own.

It is not a discovery or package-manager tool. It ships no skills of its own. Installers for other people's skill repos
already exist — **they install other people's skills; grimoire maintains your own.**

> **Early stage.** `workspaces add/remove/list`, `skills add/list/remove`, `link`, and `unlink` work; nothing else is
> implemented yet.

Command reference: [`docs/`](./docs/README.md). Vision and layout: [`ARCHITECTURE.md`](./ARCHITECTURE.md)
