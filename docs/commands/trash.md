# `trash`

[`skills remove`](./skills.md#where-the-copy-goes) moves each store copy into `~/.grimoire/.trash/` instead of deleting it.
This group is the only thing that deletes from there.

| Command                       | Purpose                                    |
| ----------------------------- | ------------------------------------------ |
| [`trash empty`](#trash-empty) | Permanently delete everything in the trash |

## `trash empty`

```shell
$ grimoire trash empty
deleted /Users/me/.grimoire/.trash/deploy-20260920T091502
deleted /Users/me/.grimoire/.trash/triage-20260915T124530
emptied the trash: 2 bins
```

It takes no arguments and no flags.

Every entry under `.trash/` is deleted, in name order, including anything put there by hand. `.trash/` itself stays.

Deletion is permanent. There is no prompt and no undo, so move anything worth keeping out with `mv` first.

A symlink inside a bin is removed; what it points at is left alone.

A bin that can't be deleted doesn't stop the others. It may be left partly deleted. The bins deleted print first, then the
run exits 1, with no count line:

```shell
$ grimoire trash empty
deleted /Users/me/.grimoire/.trash/deploy-20260920T091502
error: failed to delete /Users/me/.grimoire/.trash/triage-20260915T124530: EACCES: permission denied, rmdir '/Users/me/.grimoire/.trash/triage-20260915T124530/store'
```

Several print `error: deletions failed:`, followed by each sentence on its own line, indented two spaces.

An empty trash is not an error, and exits 0:

```shell
$ grimoire trash empty
nothing to delete: the trash is empty
```

## Colors

See [Colors](../conventions.md#colors).

- `deleted` is red.
- The count line is bold.
- The empty-trash line is dim.
