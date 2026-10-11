# grimoire command reference

| Command group                            | Status          |
| ---------------------------------------- | --------------- |
| [`workspaces`](./commands/workspaces.md) | Implemented     |
| [`repos`](./commands/repos.md)           | Implemented     |
| [`export`](./commands/export.md)         | Implemented     |
| [`skills`](./commands/skills.md)         | Implemented     |
| [`link`](./commands/link.md)             | Implemented     |
| [`unlink`](./commands/unlink.md)         | Implemented     |
| [`clone`](./commands/clone.md)           | Implemented     |
| [`unclone`](./commands/unclone.md)       | Implemented     |
| [`trash`](./commands/trash.md)           | Implemented     |
| [`status`](./commands/status.md)         | Implemented     |
| `doctor`                                 | Not implemented |

Two pages apply to every command:

- [Safety](./safety.md) — what grimoire writes and removes outside its store.
- [On-disk layout](./state.md) — what is in `~/.grimoire/`, and the shape of `state.json`.
