# `repo`

A repo is a directory that skills live under, registered by name. This is not the directory the agent loads skills from, but
rather the one where you keep your skills.

> [!NOTE]
>
> Repos are optional — Grimoire works without them. When you use one, it lets you sync skills between your store and an
> external directory in which you track skills. Typically, you'll pull from a repo you follow when it gets updated, or push
> to a repo you own when you create new skills.

There are two types of repos:

- `read-only` these are usually vendor repos that you do not want to edit.
- `read-write` these are your own repos that you manage.

| Command                                       | Purpose               |
| --------------------------------------------- | --------------------- |
| [`repo add`](#repo-add-name-path---mode-mode) | Register a repo       |
| [`repo remove`](#repo-remove-name-alias-rm)   | Unregister a repo     |
| [`repo list`](#repo-list-alias-ls)            | List registered repos |

## `repo add <name> <path> [--mode <mode>]`

| Argument | Meaning                         |
| -------- | ------------------------------- |
| `name`   | Name to register it under       |
| `path`   | Directory the skills live under |

| Mode         | Default | `import` | `export` / `publish` |
| ------------ | ------- | -------- | -------------------- |
| `read-only`  | Yes     | allowed  | rejected             |
| `read-write` | No      | allowed  | allowed              |

```
$ grimoire repo add my-repo ~/skills
registered repo "my-repo" → /Users/me/skills (read-only)
```

### What `add` rejects

A refusal exits 1 and registers nothing: `config.json` is left exactly as it was found, and the directory is never touched.

The four checks run in the order below, and only the first failure is reported.

**1. The `--mode` value.** Anything outside `read-only` and `read-write` is rejected by the argument parser, before the store
is opened. This is the one refusal that carries commander's `error:` rather than `grimoire:`.

```shell
$ grimoire repo add my-repo ~/skills --mode bogus
error: option '--mode <mode>' argument 'bogus' is invalid. Allowed choices are read-only, read-write.
```

**2. The path is usable.** It has to exist and be a directory.

```shell
$ grimoire repo add my-repo ~/nope
grimoire: /Users/me/nope does not exist

$ grimoire repo add my-repo ~/skills.md
grimoire: /Users/me/skills.md is not a directory
```

**3. The name is free.** Within the repo registry. For example, if `my-repo` is already registered, this will fail:

```shell
$ grimoire repo add my-repo ~/other-skills
grimoire: repo "my-repo" is already registered
```

**4. The path does not collide** with a registered workspace or with `~/.grimoire/` — see
[the collision rule](#the-collision-rule).

```shell
$ grimoire repo add my-repo ~/.agent/skills
grimoire: /Users/me/.agent/skills sits inside workspace "my-agent" (/Users/me/.agent)

$ grimoire repo add my-repo ~/.grimoire/skills
grimoire: /Users/me/.grimoire/skills sits inside the grimoire store (/Users/me/.grimoire)
```

### The collision rule

`add` checks the path against registered **workspaces** and `~/.grimoire/` — never against other repos. Two repos may share a
path, and one may be registered at an ancestor of another; both succeed.

| Relation | Message                    |
| -------- | -------------------------- |
| equals   | `is the same directory as` |
| inside   | `sits inside`              |
| contains | `contains`                 |

```
registered workspace   /home/me/work
                       ├─ equals    /home/me/work
                       ├─ inside    /home/me/work/skills
                       └─ contains  /home/me
```

Paths are compared canonically, with symlinks resolved. A refusal names the path as typed, not as resolved.

Under the usual dotfiles layout — where the workspace is a symlink into the repo that versions it — the two paths share no
lexical prefix at all, and only the resolved forms reveal them as one directory:

```shell
$ ls -ld ~/.claude/skills/linked-skills
lrwxr-xr-x  /Users/me/.claude/skills/linked-skills -> ../../.agents/skills/linked-skills

$ grimoire repo add my-repo ~/.claude/skills/linked-skills
grimoire: /Users/me/.claude/skills/linked-skills sits inside workspace "agents" (/Users/me/.agents/skills)
```

### The `.git` warning

`add` walks upward from `path` looking for a `.git` directory:

```
grimoire repo add my-repo /a/b/skills
  /a/b/skills/.git   ✗
  /a/b/.git          ✗
  /a/.git            ✗
  /.git              ✗   → if no .git is found, a warning is emitted
```

```shell
$ grimoire repo add my-repo /a/b/skills
warning: no .git found at or above /a/b/skills
registered repo "my-repo" → /a/b/skills (read-only)
```

This is a warning, not a failure — the repo is registered and the exit code is 0. Grimoire never invokes git itself.

## `repo remove <name>` _(alias: `rm`)_

```shell
$ grimoire repo remove my-repo
unregistered repo "my-repo" → /Users/me/skills

$ grimoire repo remove ghost
grimoire: no repo named "ghost"
```

Unregisters only — the directory and any imported skills inside it are untouched.

## `repo list` _(alias: `ls`)_

```shell
$ grimoire repo list
my-repo    read-write /Users/me/skills
vendored   read-only  /Users/me/other/skills
```

Sorted by name. Empty registry prints `No repos registered.`
