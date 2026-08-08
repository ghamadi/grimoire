# grimoire — architecture

## The problem

Running more than one agent config directory — different agents, different accounts, or both — means an independent copy of
every skill in each one. Every edit has to be made N times, and the copies drift. Symlinking the whole skills directory fixes
the editing and costs the ability to have a skill in one account and not the other, so whatever solves this has to work **per
skill**.

Two more problems: no version history, and no record of where the copies went.

`grimoire` is a **skill management and distribution** tool: one store you edit, fanned out to N destinations — config
directories, projects, repos you own. It is not a discovery or package-manager tool; repos are always given by hand.
Installers for other people's skill repositories already exist — **they install other people's skills; grimoire maintains
your own.**

## Shape

```
repos            ←→        store        ←→       workspaces
(skill libraries)     (editing surface)     (accounts, projects)
```

- **Repos** are directories containing skills. A repo's `mode`, set at registration, decides whether grimoire may write to
  it. A repo is also **where a skill's history lives** — whatever version control you keep over it.
- **The store** is the single live editing surface, holding your active skills at current state only, never history.
- **Workspaces** are the directories an agent reads skills from. Linked workspaces see store edits immediately; clones get a
  copy and are expected to drift.

A repo is _exchanged with_ (`import`/`export`); a workspace is _deployed to_ (`link`/`clone`) and _adopted from_ (`adopt`).
No command spans the two registries — a name resolves in one or the other, never both — and no directory answers to both:

> **No registered path may equal, contain, or sit inside a path in the other registry, and neither registry may touch
> `~/.grimoire/`.**

Call a violation a **collision**. Containment rather than equality is what makes the rule hold: a deployment nested inside a
repo would be walked as repo content, putting every repo-facing rule on a directory that exists only to receive deployments.
And because `link` replaces a directory identical to the store copy without warning or backup, an `import` that auto-linked
back into the repo it had just read would turn that repo's own skills into symlinks.

The same test governs a path handed to a command rather than registered — `import` refuses a source colliding with a
workspace, `clone` a destination inside a repo or inside `~/.grimoire/`, though it may still target an unregistered path, a
project directory you would never register. And it is applied wherever a path is _used_, never inferred from registration,
because `config.json` is last-known-intent: a hand-edit must not be able to corrupt a repository.

The rule is about directories, so paths are compared **canonically** — every symlink resolved. A directory has as many
spellings as there are links pointing at it: under the usual dotfiles layout, where `~/.claude` is a symlink into the repo
that versions it, the repo and the workspace share no lexical prefix at all, and a string comparison calls them unrelated
right up until `import` auto-links that repo's own skills into symlinks.

A path that does not exist yet resolves as far as it can — the nearest existing ancestor, with the remaining segments
rejoined — which loses nothing, because a segment that does not exist cannot be a symlink. A refusal names the path as it was
**given**, not as it resolved: the spelling is what you have to go edit.

Only writing and registering are closed inside `~/.grimoire/`. Reading stays open — that is what keeps `.backup/` and
`.trash/` recoverable by a plain `import`.

The expected use-case is to link a skill that is pure method. Clone one that names agent-specific tooling or paths, or that
has to be available to a project's contributors: format portability is not content portability.

## Data model

```
~/.grimoire/
├── skills/<skill>/SKILL.md  # the store
├── .trash/skills/<skill>/   # removed skills; recoverable by `import`
├── .backup/                 # latest copy of whatever was destroyed
├── config.json              # yours: repos, workspaces, ignore
└── .state.json              # the tool's: clone locations
```

```
config.json  {
  repos:      { <name>: { path, mode } },            // mode: read-only | read-write
  workspaces: { <name>: { path, autoLink: bool } },  // e.g. personal → ~/.claude/skills
  ignore:     [ ".DS_Store" ]                        // globs, matched inside skill directories; default shown
}

.state.json  {
  <skill>: { clones: [ { workspace } | { path } ] }  // empty = never cloned
}
```

Repos and workspaces are both **dumb named paths** to a _skills directory_ (`~/.claude/skills`), not a config root.

**State records only what cannot be re-derived from the filesystem.** A cloned skill is indistinguishable from one made by
hand, so without the record there is no way to tell a managed copy from an unmanaged one. Links need no such record — reading
the workspace directories (flat by design) answers it.

A clone records either a **workspace name** or an **absolute path**. Named clones move when you edit that workspace's path in
config; path clones don't, which is the price of cloning somewhere unregistered. A path that matches a registered workspace
is recorded as that workspace, so one directory never collects two records. `workspace remove` runs that rule backwards,
rewriting the workspace's named records to carry its path: the name is about to stop resolving, and the record is the only
thing marking that directory as a managed copy.

`link` takes no such path: an unregistered link would be invisible to `remove` and to `status`'s check (4), and the only fix
— recording it — is what the state rule above forbids. Clones are recorded either way, so a path variant costs nothing new.

`config.json` is the user's to edit by hand or through commands; `.state.json` changes only through commands. Both are
**last-known-intent, not truth** — truth is the filesystem.

## Discovery

A repo may group its skills into subdirectories — buckets — to any depth. **The store and workspaces stay flat**, which is
forced rather than chosen: an agent reads `<workspace>/<skill>/SKILL.md`, so skill names are already globally unique and a
bucket carries no information the store needs.

Two rules, applied wherever a directory is read for skills:

> **A directory containing `SKILL.md` is a skill, and never contains another. Any other directory is descended into.**
>
> **A name resolves to one path: the first copy a depth-first walk reaches, reading each directory's entries in lexicographic
> order. Every later copy of the name is ignored.**

Descending is what makes a bucketed repo legible; a bucket holds no `SKILL.md` of its own. A directory with no `SKILL.md`
anywhere beneath it yields nothing, and yields it **silently** — naming one explicitly is the same error as naming a skill
that is not there. Listing them instead would cost a line per junk directory on every bulk run, and could only name a barren
subtree by its shallowest directory: the ancestor of the near-miss you were hoping to be told about, never the near-miss
itself.

The first rule is stated about directories with no exception, so it holds for the directory a walk starts at: one that
contains `SKILL.md` **is** that skill, named by its own basename, which is what makes `import ~/Downloads/brainstorm` work on
a bare skill directory someone sent you. Below that starting point, a directory whose resolved name begins with `.` is
neither descended into nor reported — a repo is registered at its skills directory and `.git` can sit right there. The
starting directory itself is read whatever it is named — otherwise `.backup/` and `.trash/` would be unreachable.

A symlink is a way to reach a skill, never a second skill. Every path is resolved before it is read, so a skill is found at
the directory that holds `SKILL.md` and is named by **that** directory — two entries pointing at one directory are one skill,
not two copies of it. Centralizing skills by symlink is the case worth serving; a link that renames what it points at is not,
and honouring the alias would only put one skill in the store twice. So the listing never carries a link's own name, and a
link that renames its target leaves that skill unaddressable under the name you see on disk.

Ignoring the rest is what leaves **duplicates unmodelled**. A second copy of a name is invisible to every command — not
written to, not compared, not reported — and will go stale unmentioned. Enumeration follows the same rule, so
`import <repo> --all` and `import <repo> <skill>` never disagree about what a repo holds. Grimoire has no `move` and no
"remove from repo"; how a repo files its skills is the repo's business.

Which copy wins is arbitrary, and meant to be: a repo holding one name twice is a repo to go fix, not a case to model. The
order is pinned rather than left to the filesystem only so that the arbitrary answer is always the same one — `readdir`
returns entries in hash order on some filesystems, so which copy wins would otherwise depend on which filesystem the repo
sits on.

## Repo modes

| Mode                  | `import` | `export` / `publish` |
| --------------------- | -------- | -------------------- |
| `read-only` (default) | allowed  | rejected             |
| `read-write`          | allowed  | allowed              |

`read-only` is the default so that a repo you registered only to consume cannot be written into by a stray `publish --all`.
Permission resolves in two steps: the mode must allow writing, and the directory must actually be writable.

> **Writing to a `read-only` repo explicitly is an error. Bulk operations don't consider it.**

`export vendored <skill>` and `publish vendored` both fail loudly; `publish --all` doesn't mention `vendored` at all, because
being read-only is a standing declaration rather than an anomaly.

There is no `write-only` mode because it is not enforceable — `import <path/to/repo/skills>` sidesteps it.

## Command surface

| Command                                         | Behavior                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `import <repo\|path> [<skill>...]`              | Copy skills into the store. First argument resolves as a repo name, falling back to a non-colliding path. Requires `--all` when no skill is named. Links into every `autoLink` workspace. Refuses if the store already holds the skill; `--force` overwrites.                                                                                                                                                                   |
| `adopt <workspace> [<skill>...]`                | Move skills from a workspace into the store and link them back. **Entries that are already symlinks into the store are skipped** — only unmanaged directories are adopted. Requires `--all` when no skill is named. Links into every `autoLink` workspace. Refuses if the store already holds the skill; `--force` overwrites.                                                                                                  |
| `export <repo> <skill>... [--bucket <subpath>]` | Copy store → repo. **Always names skills.** Overwrites, after backup, leaving the working tree dirty for review. See `--bucket`.                                                                                                                                                                                                                                                                                                |
| `publish [<repo>] [--skill <skill>...]`         | Re-export **only skills the repo already holds**, each where it resolves. No repo = every writable repo; no skill = every store skill that repo holds; omitting both requires `--all`. Naming a skill the repo lacks reports it and writes nothing.                                                                                                                                                                             |
| `link <skill>\|--all [<workspace>...]`          | Symlink `workspace/<skill>` → `~/.grimoire/skills/<skill>`. No workspace = every `autoLink` workspace. `--all` links every store skill.                                                                                                                                                                                                                                                                                         |
| `unlink <skill> [<workspace>...]`               | Remove symlinks only; store untouched. No workspace = every one it is linked into.                                                                                                                                                                                                                                                                                                                                              |
| `clone <skill> [<workspace>\|<path>...]`        | Copy store → destination and record it. No destination = every recorded one.                                                                                                                                                                                                                                                                                                                                                    |
| `remove <skill>`                                | Move the store skill to `.trash/`, clear its links, drop its state entry. `--remove-clones` also deletes cloned directories, after backup. Warns if no repo holds the skill.                                                                                                                                                                                                                                                    |
| `status`                                        | See below.                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `repo add/remove/list`                          | `add <name> <path> [--mode <mode>]` defaults to `read-only`, **rejects a path colliding with a workspace**, and **warns if no `.git` is found at the path or any ancestor**. `remove` unregisters only.                                                                                                                                                                                                                         |
| `workspace add/remove/list`                     | `add <name> <path> [--auto-link]`, **rejecting a path colliding with a repo** and **creating the path's final segment when it is missing**, never more. `remove` **errors while any link remains**, listing them; `--hard` clears them. Named clone records are rewritten to carry the workspace's path, so unregistering strands nothing and needs no flag; `--hard` forgets them instead. Neither deletes a cloned directory. |

Splitting `export` from `publish` gives the model its central invariant, which is about repos:

> **Bulk operations never add. Explicit operations may.**

`export` is the only way a skill first arrives in a repo, and it always names the skill, so `publish` can walk every repo
without ever putting a private skill somewhere public — the leak is unreachable rather than guarded against.

`import` accepts a bare path because skills arrive from places you don't want to register: a skill-creation tool's output
written to a scratch directory, a project copy you improved in place, a skill someone sent you. The two forms are
behaviorally identical. A skill written straight into a workspace is the one path form `import` refuses, because that is
`adopt`'s job.

`adopt` is a separate verb rather than a path form of `import`, for the same reason `export` is separate from `publish`: one
verb serving two intents is where an invariant goes to die. The intents differ in what becomes of the source — a repo keeps
its copy, a workspace surrenders it for a link — and only a named verb carries that difference into the safety table.

`autoLink` chooses destinations when a skill enters the store, and is the default destination set for a bare `link`. Nothing
re-links on its own once a skill is in the store: a skill's link set belongs to it, and **the same skill linked into one
account and not the other is a supported outcome**.

`remove` always clears symlinks, or every linked workspace is left dangling; `unlink` is the command for unlinking without
removing. Cloned directories are opt-in behind `--remove-clones`, being drift-by-design copies living where grimoire is a
guest.

`export` prints the full destination path — with `--bucket` in play the repo name no longer says where content landed — plus
the backup path and a reminder to commit. The reminder fires at write time because `status` goes clean as soon as content
matches, which is before you have committed anything. Having `status` report uncommitted repo changes would close that gap,
at the cost of the standing rule that **grimoire never invokes git.** `repo add`'s warning only stats for `.git`; it walks
upward because a repo is registered at its skills directory, not the git root.

### `export --bucket`

`export` is the one command that _chooses_ a location rather than reading one, so it is the one command that takes a bucket.
`--bucket` is a relative path of any depth, joined to the repo root, creating missing intermediate directories; an absolute
path, or one escaping via `..`, is an error. Every skill named in one `export` lands in the same bucket.

| `--bucket` | `export <repo> <skill>` writes to                                |
| ---------- | ---------------------------------------------------------------- |
| given      | exactly that path                                                |
| omitted    | where `<skill>` **resolves** in that repo — or the **repo root** |

The fallback keeps `export` an overwrite verb: a re-export lands where the skill already is, so it never needs the flag and
never leaves a second copy behind. The root fallback is unconditional — grimoire does not inspect the repo for buckets and
conclude you meant one. Nothing records the choice; the directory tree is the only record, and every later `export` follows
it.

`--bucket` is not on `import` (the path form already expresses it: `import <repo-path>/<bucket> --all`) and not on `publish`
(a bulk operation choosing a home is exactly what _bulk never adds_ prevents).

## Comparing and overwriting

The **tree hash** is the one comparison primitive. Per skill, over one skill directory's subtree: skip everything matching
`ignore`, hash each file's content together with its path **relative to the skill directory root** and its **executable
bit**, sort by that path, hash the concatenation.

Two of those qualifiers are load-bearing. Relative to the skill root, a bucket is invisible to the hash — the same content
filed differently is the same content. And `ignore` has to apply to every side of a comparison, or a single `.DS_Store` makes
a skill differ forever.

The executable bit is in because a copy carries it and git records it: a script that arrives non-executable is broken, and
without the bit the hash calls the two copies identical. The rest of the mode is out — a `umask` difference is not a content
change.

The hash is computed on demand and never stored, so a difference has **no direction** — it says the copies disagree, not
which one moved. `git diff` in the repo answers that.

Its subject is one skill directory: a path holding no `SKILL.md` is refused rather than walked, so a bucket or the store root
cannot be hashed into an answer that looks like a skill's.

A symlink **beneath** a skill directory is refused, by the hash and by every copy alike, because a copy has no honest option:
carried over as a link it either dangles or leaves the two copies sharing one file, and materialized it becomes content the
author never wrote — which `export` would then write back over their link. The target also sits outside the skill, so editing
it changes the skill's hash with nothing in the skill touched. `ignore` is applied first, so a link inside an ignored
directory is pruned rather than refused. A symlink **to** the skill root is unaffected: it resolves to the directory it
names, as everywhere else.

**The tool overwrites only what it can prove is safe to lose, and backs up the rest.**

| Operation | Writes into | Default                                                      | Force        |
| --------- | ----------- | ------------------------------------------------------------ | ------------ |
| `import`  | store       | **refuses** if the skill is already in the store             | after backup |
| `adopt`   | store       | **refuses** if the skill is already in the store             | after backup |
| `export`  | repo        | overwrites, after backup                                     | n/a          |
| `publish` | repo        | overwrites what the repo already holds, after backup         | n/a          |
| `clone`   | destination | accepts an **identical** directory; refuses on anything else | after backup |
| `link`    | workspace   | replaces an **identical** directory; errors on anything else | none         |

> **`--force` guards the two destinations grimoire cannot restore from anywhere else.** The store has no history, and a clone
> holds per-destination adaptations that exist nowhere but in that clone. A repo is where history lives, so `export` and
> `publish` overwrite by default and hand you a dirty working tree.

Neither `link` nor `clone` refuses when the directory sitting at the destination is **identical to the store copy**: the
store demonstrably holds the same content, so nothing is destroyed and nothing is backed up. `link` swaps it for a symlink;
`clone` writes nothing and records it. This is what lets you take on config directories already full of skills — on first run
`import <repo> --all` links everything that agrees and errors by name on everything that doesn't, instead of making you empty
the directories first and delete the evidence of drift unseen. `adopt` needs it for its _other_ destinations, where the same
skill usually already sits, identical, in the second account.

The rule is safe only because of the collision rule in _Shape_: the identical directory `link` replaces can only ever be a
workspace's copy, never a repo's own.

Beyond that, `link` may create `workspace/<skill>` where nothing is, or find the correct symlink already in place (a no-op).
A directory that differs, a file, or a symlink pointing elsewhere is an **error that writes nothing**. `link` has no
`--force`: a link and a modified directory are not two versions of one thing — keeping the modification means `clone`, and
discarding it is a deletion you should type yourself.

Refusals are **per skill and per destination**; a batch reports what it declined and processes the rest.

### `.backup/` and `.trash/`

```
.backup/store/skills/<skill>/        ← `import --force`, `adopt --force`
.backup/repos/<name>/skills/<skill>/ ← `export`, `publish`
.backup/clones/<key>/skills/<skill>/ ← `clone --force`, `remove --remove-clones`
```

- **Latest only** — one copy per slot, which bounds the directory. `.trash/` follows the same rule per skill name, but is
  never emptied.
- **Written on every destructive write, not only on `--force`** — `export` overwrites by default, so the routine case is the
  dangerous one.
- **Skipped when the two sides are identical** by tree hash.
- **The path is printed** in command output.

The `skills/` segment makes every backup directory a valid import source, so recovery needs no command:
`import ~/.grimoire/.backup/repos/mine/skills <skill> --force`. The same is true of `.trash/skills/`, which is why `remove`
needs no `restore`. Backups are keyed by destination and skill name alone, carrying no bucket path — a recovery slot, not a
mirror. A clone's `<key>` is its workspace name, or its absolute path with every `/` turned into `-`, leading separator kept:
`/Users/me/projects/app/.claude/skills` → `-Users-me-projects-app-.claude-skills`. That leading `-` is what keeps a path key
from ever clashing with a workspace name. `.backup/` and `.trash/` stay separate because one records an accident and one a
decision. No commands operate on either in v1 — which is what lets the key be lossy, since nothing has to turn one back into
a path.

Backups are the only recovery for **uncommitted work in a repo**, **repos not under version control**, and every
`clone --force` — a project's `.claude/skills` is plausibly gitignored. A clean git checkout is already recoverable with
`git checkout`.

## Ignore

`ignore` is a flat list of globs matched **inside** skill directories. It applies on `import`, `adopt`, `export`, `publish`,
and `clone`, and in the tree hash — one matcher, so what a copy declines to write and what the hash skips can never disagree.
Whole _skills_ cannot be ignored and need not be: anything in the store is managed by definition, and discovery already
yields nothing for a directory holding no skill.

A pattern's shape decides what it is matched against. One with no `/` (`.DS_Store`, `*.tmp`) is tested against each entry's
**basename**, at any depth — Finder drops a `.DS_Store` in _every_ directory it visits, so a root-only match would miss the
case the default list exists for. A pattern containing `/` (`build/**`, `a/*.md`) is tested against the **skill-relative
path** instead, anchored at the skill root.

Every entry is tested, files and directories alike, and a matched directory is **not descended into** — a bare `node_modules`
in the list skips its whole subtree, which is also the cheaper walk. The default list is `['.DS_Store']`.

`SKILL.md` at the skill root is the one exemption: no pattern reaches it, so `*.md` stays a usable thing to write. Without
that carve-out "whole skills cannot be ignored" would hold only by convention — a skill hashed without its manifest matches
every other manifest-less skill, and a copy made without it lands as a directory discovery can no longer see.

## What `status` reports

1. **Differs from a repo** — each store skill, tree-hashed against every repo holding that name. Against a `read-write` repo
   that is usually unexported work; against a `read-only` one, a local modification of a vendored skill.
2. **Held by no repo** — nothing you control holds a copy, so it has no history and `publish` will never reach it. The fix is
   `export <repo> <skill>`.
3. **Deployed nowhere** — a store skill with no links and no clones.
4. **Dangling symlinks** — workspace entries pointing at a store path that no longer exists.
5. **Missing clones** — a recorded clone whose directory is gone.
6. **Orphaned state** — a `.state.json` key with no matching store skill.
7. **Unreachable repo or workspace** — a registered path that no longer exists on disk.
8. **Colliding registrations** — a repo and a workspace whose paths violate the collision rule, or either one touching
   `~/.grimoire/`. The fix is to unregister one and `add` it at a path that doesn't collide. `workspace remove` therefore
   reports a collision rather than refusing over one — refusing would put the fix out of reach — and clears no links from a
   directory that turned out to be a repo's.

(1) and (2) are what make an unversioned store safe: the window where an edit exists only in the store is visible, and (2)
names the skills for which that window never closes.

(8) is the only check that reports a state `add` would have refused. Two things reach it: a hand-edit, and a symlink
repointed after the fact — under the dotfiles layout, the workspace and the repo that versions it are one `ln -s` apart from
being the same directory. Because the rule is enforced wherever a path is _used_, the violation would otherwise surface as an
unrelated `import` failing on a collision, naming two registrations that have been sitting there since whenever.

**`status` inspects the tool's own artifacts and never reports on directories it did not create.** Every check starts from a
store skill, a state entry, or a registration. (3) and (4) read workspace directories but examine only symlinks pointing into
the store; (1) and (2) walk repos to resolve names **already in the store**, so a repo skill the store hasn't heard of goes
unmentioned — reporting it would be discovery. (7) and (8) resolve registered paths without reading anything inside them.

Deliberately not reported: a skill absent from _some_ repos (normal under _bulk never adds_; only absence from every repo is
check 2), a clone differing from the store (drift-by-design, and `clone` surfaces it at the moment something would destroy
it), and a second copy of a skill in one repo (the walk ignores it).

## Scope for v1

Skills only — the `~/.grimoire/skills/` layout leaves room for `commands/` and `agents/` without redesign, but none are
built. Node + TypeScript; binary `grimoire`, aliased `grim`; distributed by local global install / `npm link`, nothing
published to npm. **The tool ships no skills and is coupled to no skills repository** — your skills live in a repo you
register like any other.

There is no `init`. First run is the ordinary commands in order:

1. Get your skills into a repository you control, resolving drift between existing copies **there**. History begins before
   grimoire runs at all.
2. `repo add <name> <path> --mode read-write`, where `<path>` is the directory skills live _under_, not the git root.
3. `workspace add <name> <path> --auto-link` for each config directory.
4. `import <repo> --all` — seeds the store and links into the `autoLink` workspaces.
5. Resolve what step 4 refused: where a workspace already held a differing copy, `link` reported it by name and wrote
   nothing. If the store's version wins, delete the workspace's copy and `link` it; if the workspace's does,
   `adopt <workspace> <skill> --force`.
6. `unlink` skills you don't want in a given account — step 4 linked every skill into every `autoLink` workspace.
