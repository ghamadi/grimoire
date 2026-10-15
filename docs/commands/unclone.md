# `unclone`

`unclone` forgets clone records. It never touches the cloned directory.

```shell
grimoire unclone <skill> <targets...>
```

## Arguments

| Argument       | Meaning                                                                                                    |
| -------------- | ---------------------------------------------------------------------------------------------------------- |
| `<skill>`      | The skill the records belong to. Need not be in the store.                                                 |
| `<targets...>` | Workspace names or recorded paths. Repeated targets follow [the shared rule](../conventions.md#arguments). |

## What a target may be

A target that is a valid [workspace name](../state.md#names) is one, and it must be registered. Anything else is a path:
normalized, then matched against the directory each record resolves to. A relative path with no separator reads as a name, so
write `./skills` rather than `skills`.

A target matches any record for its directory, whichever form the record takes. See
[links and clones](../conventions.md#links-and-clones).

## `unclone <skill> <targets...>`

Each target gets one outcome, decided by whether a record resolves to it:

| Record for this directory | Outcome | Output                                 |
| ------------------------- | ------- | -------------------------------------- |
| exists                    | dropped | stdout `uncloned <skill> → <target>`   |
| none                      | —       | stdout `not cloned <skill> → <target>` |

`<target>` prints as the workspace name as given, or the path normalized.

```shell
$ grimoire unclone triage personal /Users/me/old/skills
uncloned triage → personal
not cloned triage → /Users/me/old/skills
```

Results print in the groups `uncloned`, `not cloned`, laid out as [the conventions](../conventions.md#outcomes) describe.
Apart from a refusal, the run exits 0.

### Nothing is ever declined

`unclone` reads only `state.json`, so an [unreachable or unreadable](../conventions.md#unreachable-and-unreadable-workspaces)
workspace is never declined.

## What `unclone` refuses

The [refusals](../conventions.md#refusals) run in this order:

**1. Targets are given.**

**2. Every named workspace is registered.**
