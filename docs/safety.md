# The rule: grimoire never loses content outside its store

Anything you put in a workspace or a repo stays exactly as you left it, apart from what is listed here.

## What grimoire writes outside `~/.grimoire/`

- Copies of store skills.
- Its own symlinks.
- A `.grimoire-staging/` directory — inside a workspace while a clone is being written, or inside a repo while an export is —
  removed once it is empty.

## What grimoire removes outside `~/.grimoire/`

- Its own symlinks.
- A directory the store is proven to
  [already hold in full](./commands/link.md#replacing-a-directory-the-store-already-holds), not counting a `.DS_Store`
  written by Finder.
- A skill directory at a clone destination when
  [`clone --overwrite`](./commands/clone.md#--overwrite-replaces-a-skill-directory) is passed, once the store copy has
  replaced it.
- The entry at `<repo path>/<skill>` on [`export`](./commands/export.md#what-export-checks), when git reports nothing
  uncommitted there or `--force` is passed.

## Where content can be lost

The last two removals delete content grimoire cannot prove it holds.

- `clone --overwrite` does, and only on that explicit flag.
- `export` does too. Replacing a repo entry is safe only for what git has committed, so
  [ignored files](./commands/export.md#ignored-files-are-deleted) under that entry and
  [`--force`](./commands/export.md#--force-skips-the-git-check-and-nothing-else) are the two places an export can lose
  content.

## What follows from it

- `unclone` and `skills remove --forget-clones` forget records and leave directories.
- A plain `clone` adopts a directory it finds rather than replacing it.
- Even `--overwrite` declines a directory that is neither a recorded clone nor a skill.
