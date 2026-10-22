# The rule: grimoire never loses content outside its store

Anything you put in a workspace or a repo stays exactly as you left it, apart from what is listed here.

## What grimoire writes outside `~/.grimoire/`

- Copies of store skills.
- Its own symlinks.
- A [`.grimoire-staging/`](./conventions.md#staged-writes) directory, in a workspace during a clone or in a repo during an
  export. It is removed once empty.
- On [`update`](./commands/update.md), npm replaces grimoire's own installed package. Nothing else is touched.
- A temporary clone in the system temp directory, during a [`skills add`](./commands/skills.md#adding-from-a-git-url) from a
  git URL.

## What grimoire removes outside `~/.grimoire/`

- Its own symlinks.
- A directory the store is proven to [already hold in full](./conventions.md#containment).
- The temporary clone a `skills add` from a git URL made, when the run ends.
- A skill directory at a clone destination when
  [`clone --overwrite`](./commands/clone.md#--overwrite-replaces-a-skill-directory) is passed, once the store copy has
  replaced it.
- The entry at `<repo path>/<skill>` on [`export`](./commands/export.md#what-export-checks), when git reports nothing
  uncommitted there or `--force` is passed.

## Where content can be lost

The last two removals can delete content grimoire cannot prove it holds. For `export`, git holds what is committed, so
content is lost only through [ignored files](./commands/export.md#ignored-files-are-deleted) or
[`--force`](./commands/export.md#--force-skips-the-git-check-and-nothing-else).

## What follows from it

- `clone --drop` and `skills remove --forget-clones` forget records and leave directories.
- A plain `clone` adopts a directory it finds rather than replacing it.
- Even `--overwrite` declines a directory that is neither a recorded clone nor a skill.
