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

A symlink inside a bin is removed and what it points at is left alone, so [nothing outside `~/.grimoire/`](../safety.md) is
removed.

An empty trash is not an error, and exits 0:

```shell
$ grimoire trash empty
nothing to delete: the trash is empty
```

### What `empty` refuses

An argument. `trash empty triage` reads like a request to empty one skill's bins, so it exits 1 and deletes nothing:

```shell
$ grimoire trash empty triage
error: too many arguments for 'empty'. Expected 0 arguments but got 1: triage.
```

## Colors

On a color-capable stdout only. Piped output, or `NO_COLOR` set, prints plain.

- `deleted` is red.
- The count line is bold.
- The empty-trash line is dim.

Paths are never styled.
