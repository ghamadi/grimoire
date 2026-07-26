# grimoire — architecture

## Context

Anyone running more than one agent config directory — a personal account and a work account, say —
maintains an independent copy of every skill in each one. Every edit has to be made twice, and the
copies drift: one directory grows a skill the other never gets, the same skill diverges between them,
and junk files accumulate in both.

Symlinking the whole skills directory fixes the editing problem and destroys something worth keeping:
the ability to have a skill in one account and not the other. Whatever solves this has to work **per
skill**, not per directory.

Four problems follow:

1. **Edits must be repeated per config directory.** Per-skill symlinks would fix it, but they don't
   create themselves — every new skill means one link per account, by hand.
2. **Skill-creation tools write wherever they were invoked**, leaving the new skill in the config
   directory of whichever account ran them. Getting it anywhere else is manual.
3. **There is no version history.** An edit that turns out to be a mistake has nothing to roll back to.
4. **Copies made into project directories can't be re-propagated.** Copying a skill into a project to
   tweak it there is easy; updating every copy later is not, because nothing records where the copies
   went.

`grimoire` is an **authoring and distribution** tool: one store you edit, fanned out to N destinations,
with history kept outside the store in whatever version control you already use. It is explicitly
_not_ a discovery or package-manager tool — repos are always given by hand.

## Shape

```
repos            ←→        store        →        workspaces
(skill libraries)     (editing surface)     (accounts, projects)
```

Three layers with one job each:

- **Repos** are directories that contain skills — anywhere a skill can be read from or written back to.
  A repo's `mode`, fixed when it is registered, decides whether grimoire may write to it.
- **The store** is the single live editing surface. It is derived and disposable — a cache of what is
  currently deployed, rebuildable from repos at any time.
- **Workspaces** are the directories an agent actually reads skills from: account config directories,
  and project directories. Linked workspaces see store edits immediately; cloned workspaces get a copy
  and are expected to drift.

**Nothing crosses between repos and workspaces.** A repo is a place grimoire _exchanges_ with
(`import`/`export`); a workspace is a place grimoire _deploys to_ (`link`/`clone`). The two registries
are separate, and no command resolves a name from both. This is the boundary that keeps every command's
blast radius readable — "what does this touch?" is answerable from the verb alone.

The store is the join point, not the owner of history or final state: the tool implements distribution
and delegates versioning to whatever already tracks your repos. That is what keeps it small, and it has
one accepted consequence — **a skill you create and never export has no history.** `status` surfaces
that condition so it stays visible.

## Decisions

| # | Decision |
| --- | --- |
| 1 | Store lives at `~/.grimoire/`, fully owned by the tool. Skills at `~/.grimoire/skills/<name>/`. State files at the store root. |
| 2 | **The store is not version-controlled.** It is a deployment cache: derived, disposable, rebuildable from repos. |
| 3 | **History lives outside the store**, in whatever version control you keep over the repos you export to. The tool implements no history, no `log`, no `restore` — and **never runs git**. |
| 4 | **Repos and workspaces are separate registries** with no command spanning them. Repos are exchanged with; workspaces are deployed to. |
| 5 | **A repo is any directory containing skills**, registered as a named path with a **`mode`**: `read-only` (the default) or `read-write`. |
| 6 | **A skill has no recorded home.** No `origin`, no binding, no per-skill repo. Where a skill goes is decided at `export` time, by hand, and the filesystem remembers it by holding a copy. |
| 7 | **Bulk operations never add; explicit operations may.** `export` always names skills. `update` only refreshes skills a repo already holds. This is what makes a private skill structurally unable to leak into a public repo. |
| 8 | **No direction detection.** `status` reports that a skill _differs_ from a repo, never which side moved. There is no `baseChecksum` and no stored baseline of any kind. |
| 9 | **`.backup/` holds the latest copy of anything grimoire destroys.** It is written automatically and has no commands over it in v1. |
| 10 | **`remove` moves to `~/.grimoire/.trash/`.** Recovery is `import` from the trash path. Removing the same name twice **overwrites** the earlier entry, and nothing prunes the directory — a retention policy is deferred. |
| 11 | **No `sync` command.** A symlink is live, so linked workspaces need no refresh, and `sync` would have to mean opposite things for accounts (take everything) and project clones (take only what was asked for). `link --all` covers the fan-out case. |
| 12 | Clones are tracked in **state**, keyed by **workspace name** (`skill → [workspace]`). Re-running `clone` re-copies to every recorded workspace. |
| 13 | **Clones are designed to drift.** No hash checks, no diff3, no patch tracking — the store holds no merge base to merge against anyway. `clone` overwrites completely; anything else is manual. |
| 14 | A repo or workspace is a **dumb named path** to a skills directory. No presets, no agent-type modelling: other agents' formats differ structurally enough that supporting them means an adapter layer, and multi-agent is a non-goal. |
| 15 | Config declares **default workspaces** — where `import` links a skill at the moment it runs, unless `--no-link`. They are an **action-time default, not a standing invariant**: from then on, a skill's link set is its own. |
| 16 | **The tool ships no skills and is coupled to no skills repository.** Your skills live in a repository you register like any other; the CLI lives in its own. Using grimoire never means adopting someone else's skills. |
| 17 | claude.ai upload (`pack`) is **out of scope for v1**. |
| 18 | Name: binary and directory `grimoire`. npm publishing deferred. |
| 19 | **A repo may nest skills at any depth; the store and workspaces are flat.** Nesting is the repo's private layout, discovered by walking. `export --bucket <subpath>` chooses it; nothing records it. |
| 20 | **A name resolves to one path in a repo — the walk halts at the first match.** Duplicates are permitted and unmodelled: the losing copy is invisible to every command rather than reconciled by any of them. |

### Rejected, with reasons worth remembering

Each of these is something a reasonable design would reach for by default. The note exists to answer
"why not just —" without relitigating it.

- **`origin` — a recorded home per skill.** It looks like it answers "where may I write," but `mode`
  already does; what it actually records is "where this skill lives." That costs `bind`/`unbind` to
  maintain, makes `import` refuse on a binding mismatch rather than on content, and leaves a field that
  can name a repo you've since removed. Its one irreplaceable job — stopping a bulk write from reaching
  a repo the skill doesn't belong in — is done better by _bulk never adds_, which needs no state at all.
- **Direction detection (`ahead`/`behind`/`diverged`).** A stored `baseChecksum` per skill, refreshed at
  each agreement, yielding a third value beyond same/different. It only works with a single recorded
  origin, so it dies with `origin` anyway; the baseline is invisible state that goes stale in ways
  nothing on disk can reveal; and what it buys — "you have unexported work" — is recovered by
  reporting mere difference, which needs nothing stored. You lose the word "ahead"; `git diff` in the
  repo supplies it in one command and can't go stale.
- **Versioning the store.** The store is where edits actually happen, so it looks like the natural home
  for an undo buffer. But every mutation forces a commit-policy decision with no correct answer, since
  the tool constantly finds dirty state it did not create; two histories of one artifact with no shared
  ancestry means "which version is this skill" loses its single answer; the history is inert unless
  `log`/`diff`/`restore` are built too, i.e. a git porcelain; and the store stops being disposable.
  `.trash/`, `.backup/`, and difference reporting in `status` recover the useful part for a fraction of
  the cost.
- **`push`/`pull` as the verb pair**, and `remote` as the noun. `git push` refuses to overwrite a remote
  that has moved ahead, while this tool's outbound write clobbers unconditionally, on purpose — the
  borrowed word would promise precisely the safety property the design removes, at the single most
  destructive moment. `import`/`export` promise nothing, which is honest, because the operation is a
  directory copy. `remote` goes with them: every one of these is a local directory, and `repo`
  advertises the central bargain every time you type it — history lives there, not here.
- **`write-only` as a third mode.** Unenforceable: `import` accepts a path, so `import <that-repo's-path>`
  reads it regardless. A rule you sidestep by typing a path instead of a name is not a rule.
- **A configurable "require `--force` on export".** It cannot fire usefully. _Differs_ is the normal
  state at export time — it is why you are exporting — so a knob keyed on difference triggers on every
  legitimate write. Distinguishing your edit from someone else's needs direction detection, which is
  gone.
- **`-m "msg"` to commit in the repo.** It would give the tool its only reason to know what git is, and
  bring with it a "must be a git repo" branch in the permission chain and the oddity of `update --all`
  writing one identical commit message into several repositories. Exporting several skills and then
  making one reviewed commit is a better history than N automatic ones.
- **Collapsing the repo/workspace boundary** — registering project directories as repos (mechanically a
  project's `.claude/skills` is just a directory of skills, so `clone` looks collapsible into `export`),
  or letting `update` cover clones as well as repos. Both are safe under _bulk never adds_, and both
  fail the same way: a project is a place an agent _reads_ skills, and being writable doesn't make it a
  library. Whichever command spans the registries first is the one after which "what does `update --all`
  touch?" stops being answerable without opening `config.json`.
- **Store as a checkout of a skills repository.** Collapses a layer, but one checkout means one
  repository, which forecloses keeping private skills somewhere separate, and it would export local WIP
  by default.
- **Declaring a repo's layout in `config.json`** — a `layout`/`buckets` field, or the cheaper
  `defaultBucket`. Redundant the moment discovery walks: the directory tree already answers it, and
  answers it correctly after someone reorganizes the repo without telling grimoire. It is `origin`'s
  mistake in a smaller package — a declaration of something the filesystem states directly, which can
  therefore be wrong. `defaultBucket` fails differently: re-export already needs no bucket, since the
  existing path wins, so the default would only ever fire on a skill's first arrival in the repo — the
  single moment the choice most deserves to be typed out.
- **Registering each bucket as its own repo** (`repo add <name> <repo-path>/<bucket>`). It needs no new
  concept at all — Decision 14's dumb named path, used as intended. But it cannot seed a library in one
  command, it does nothing for a nested repo somebody hands you, and it puts N names in `status` for one
  git repository, so the "commit in …" reminder fires under a name that isn't the thing you commit.
  Discovery has to walk regardless; once it does, this buys nothing.
- **`export` policing the repo's organization** — erroring on a bare `export` into a bucketed repo, or
  refusing when the repo already holds the skill under a different path. Both have the tool infer a
  convention from the directory tree and then enforce it, the same overreach as `origin`, and both
  presume a mistake where there may well be intent. A repo's filing is the repo's business; grimoire has
  no `move`, so a refusal only converts a copy the user asked for into an error to work around.
- **Modelling duplicates rather than resolving past them.** The intermediate position: permit a name at
  several paths and have each command handle the set — `update` writing to all of them, `status` naming
  them. It reads as thoroughness and is really a promise the tool cannot keep cheaply, because every
  command then owes an answer to "which copy do you mean," and each available answer (all, first,
  newest, refuse) is arbitrary in a different way. Halting resolution at the first match retires the
  question instead of answering it, and costs one sentence of specification.
- **Mirroring buckets into the store.** A nested store would need flattening on every `link` and `clone`
  anyway, and the only thing it would enable — two skills sharing a leaf name in different buckets —
  cannot be deployed regardless.

## Data model

```
~/.grimoire/
├── skills/<name>/SKILL.md  # the store — the live editing surface, derived and disposable
├── .trash/skills/<name>/   # removed skills; recoverable by `import`; never pruned
├── .backup/                # latest copy of whatever was destroyed — see The backup net
├── config.json             # your declarations: repos, workspaces, ignore
└── state.json              # the one thing the filesystem cannot express: clone locations
```

```
config.json  {
  repos:      { <name>: { path, mode } },            // mode: read-only | read-write
  workspaces: { <name>: { path, default: bool } },   // e.g. personal → ~/.claude/skills
  ignore:     [ ".DS_Store", ... ]                   // file globs, matched inside skill directories
}

state.json   {
  <skill>: { clones: [ <workspace-name> ] }          // empty = never cloned
}
```

**State records only what cannot be re-derived from the filesystem**, which leaves exactly one thing.
A symlink is self-describing: read the workspace directory and check whether the entry points into the
store. Whether a repo holds a skill is answered by looking, and whether it differs by hashing. But a
cloned directory is indistinguishable from one the user put there by hand, so without a record there is
no way back to it, and no way to tell a managed copy from an unmanaged one.

Clones are keyed by **workspace name**, not absolute path, so moving a workspace in config carries its
clones along exactly as it carries its links. A workspace has to be registered before you can clone into
it, which is the same gesture you'd make to link into it, and the name _is_ the record of where the
copies went.

`config.json` is yours: you declare repos, workspaces, and ignores there by hand or through commands.
**`state.json` is owned by the tool** and changes only through commands. Both files are
**last-known-intent, not truth** — truth is the filesystem, so every command that reads a path stats it
and reports entries that have vanished rather than trusting them.

Repos and workspaces are both named paths to a _skills directory_ (`~/.claude/skills`), not a config
root — the most literal reading of "dumb path," and it means a project workspace is just
`<project>/.claude/skills`. A **workspace** holds skills directly beneath that path, because that is
where an agent looks; a **repo** may nest them further, per _Repo layout_. **Registering one directory
as both a repo and a workspace is allowed and not policed.** It is the escape hatch for promoting a
project tweak back into the store.

`config.json`, `state.json`, `.trash/`, and `.backup/` are the only unique data in `~/.grimoire/`. That
makes the _store_ disposable — delete `skills/` and rebuild it with `import` — while `~/.grimoire/` as
a whole is not. Config can be rebuilt by hand and state by re-cloning; `.backup/` is bounded at
(repos + workspaces + 1) × skills because it keeps only the latest copy of each, while `.trash/` grows
without bound. Accepted.

### Repo modes

A repo's `mode` is the single place that decides which direction it may be used in.

| mode | `import` | `export` / `update` |
| --- | --- | --- |
| `read-only` (default) | allowed | rejected |
| `read-write` | allowed | allowed |

`read-only` is the default because it fails loudly rather than silently: a repo you registered only to
consume a vendored library cannot be written into by a stray `update --all`, which walks every repo.
That default is doing the same job as _bulk never adds_, one level up.

One rule governs how a rejection surfaces:

> **Naming a `read-only` repo explicitly is an error. Bulk operations simply don't consider it.**

`export vendored <skill>` fails loudly — you asked for something impossible. `update --all` doesn't
mention `vendored` at all, because being read-only is a standing declaration, not an anomaly. Without
that split, every `update --all` would print the same skip lines forever and you would stop reading
them.

Permission resolves in two steps and no more: the mode must allow writing, and the directory must
actually be writable.

### Repo layout

A skills library is usually organized. A repo may group its skills into subdirectories — buckets — to
whatever depth suits it:

```
<repo>/
├── <bucket-1>/
│   ├── <skill-1>/SKILL.md
│   └── <skill-2>/SKILL.md
└── <bucket-2>/
    ├── <skill-3>/SKILL.md
    └── <skill-4>/SKILL.md
```

**The store and workspaces stay flat.** That is not a simplification, it is forced: an agent reads
`<workspace>/<skill>/SKILL.md`, so **skill names are already globally unique** — `<bucket-1>/<skill>`
and `<bucket-2>/<skill>` can never both be deployed. Given that, a bucket carries no information the
store needs. It is one repo's filing decision, and it stops at that repo's edge.

So nesting enters the model in exactly two places: **discovery**, which finds skills however deep they
sit, and **`export --bucket`**, which decides where a new one lands. Nothing is recorded.

#### Discovery

Two rules, applied everywhere a repo or path is read:

> **A directory containing `SKILL.md` is a skill. Any other directory is descended into
> until a `SKILL.md` is found. A skill is never descended into.**
>
> **A name resolves to one path. The walk halts at the first match and never looks further.**

The first is the structural rule with the depth cap removed, and it is what makes a bucketed repo
legible at all. Without it a bucket reads as "not a skill" — it holds no `SKILL.md` of its own — so
`import <repo> --all` would find nothing and report every bucket as skipped.

The second fixes what "first" means, since a walk order left to the filesystem is not a rule at all:
**shallowest wins, and lexicographic order breaks ties among equals.** A skill at the repo root
therefore beats one in a bucket, which pairs with the root being where `export` puts a skill the repo
does not yet hold, and means a stray copy deeper in the tree can never shadow the canonical one.

Discovery is what `import` (what is there to take), `update` (which skills this repo already holds, and
where), and `status` checks (1) and (2) all run on. None of them need a bucket named, because all of
them are looking at a directory that already has one.

Descending costs nothing in precision. A repo that keeps development artifacts alongside its skills —
eval fixtures, scratch directories — holds no `SKILL.md` anywhere beneath them, so they yield no skills
and are **reported as skipped** rather than silently ignored. Naming such a directory directly is an
error, not a silent no-op.

#### `export --bucket`

`export` is the one command that _chooses_ a location rather than reading one, which is why it is the
one command that takes a bucket:

```
export mine code-review --bucket <bucket>
export mine code-review --bucket <bucket>/<sub-bucket>     # any depth
```

`--bucket` takes a **relative path of any depth**, joined to the repo root and checked only for shape —
there is no list of valid buckets to check it against. It creates missing intermediate directories. An
absolute path, or one escaping the repo root via `..`, is an error. Every skill named in one `export`
lands in the same bucket.

This is Decision 6 at one more level of resolution: _where a skill goes is decided at `export` time, by
hand_ already covers which repo, and `--bucket` covers where inside it. Choosing a home stays a
deliberate act, and stays unrecorded.

Placement has two branches and no third:

| `--bucket` | `export <repo> <skill>` writes to |
| --- | --- |
| given | exactly that path |
| omitted | the path `<skill>` **resolves to** in that repo — or the **repo root**, if it resolves to nothing |

Both branches read the filesystem; neither consults config, and neither refuses. Each names a single
destination, because resolution yields a single path.

The second branch is what keeps `export` an overwrite verb: a re-export lands where the skill already
is, so it never needs the flag and never leaves a second copy behind. Without it, `export` into a
bucketed repo could only ever add at the root, and its _overwrites, after backup_ semantics would be
unreachable there. Following the existing path is not an opinion about layout — the organizational
choice was made when the skill was first exported, and the directory tree still records it.

Falling back to the **repo root** is unconditional: grimoire does not inspect the repo for buckets and
conclude you meant to use one. If the root is the wrong place, move the directory in the repo — every
later `export` follows it there.

#### `--bucket` belongs on `export` alone

Not on `import`: the bucket is discoverable there, so `--bucket` could only mean _filter_ — a second
meaning for one flag — and the path form already expresses it. `import <repo-path>/<bucket> --all` takes
one bucket.

Not on `update`: it re-exports where each skill **resolves** in the repo, rediscovered by walking. A
`--bucket` there would let a bulk operation choose a home, which is precisely what _bulk never adds_
exists to make unreachable.

#### Duplicates are not modelled

`--bucket` writes where it is told and never asks whether the repo already holds that skill somewhere
else, so exporting into `<bucket-2>` a skill that sits in `<bucket-1>/` does not move it — it adds a
second copy. Grimoire has no `move` and no "remove from repo"; how a repo files its skills is the
repo's business, and a duplicate may well be deliberate.

What it will not do is _support_ the arrangement. Resolution halts at the first match, so from then on
the name means that path and the other copy is not something the tool knows about — not updated, not
compared, not reported. That is the whole reason the halt rule exists: the moment grimoire promises to
handle duplicates, it owes an answer to "which copy does this command mean," and every available answer
is arbitrary. The losing copy will go stale and grimoire will never mention it, which is the same
bargain the tool makes everywhere else — it manages what it can name, and the repo's own version
control shows you the rest.

Enumeration follows the same rule as lookup: `import <repo> --all` walks the whole tree, but a name it
has already resolved is not resolved again, so a repo holding one name twice yields one skill. This is
what keeps `--all` and `import <repo> <skill>` from disagreeing about what the repo contains.

### Comparing a skill in two places

There is exactly one comparison primitive.

The **tree hash** is computed per skill, over one skill directory's subtree — `skills/<name>/` in the
store, wherever discovery found `<name>/` in a repo, `<workspace>/<name>/` in a workspace. It walks that
subtree, skips everything matching `ignore`, hashes each file's content together with its path
**relative to the skill directory root**, sorts by that path, and hashes the concatenation.

Both of those qualifiers are load-bearing. Paths relative to anything but the skill root, or `ignore`
applied to one side only, makes every skill report as different forever — and a single `.DS_Store` is
enough to trigger it. Buckets sharpen the first: hashing a repo skill relative to the _repo_ root would
fold the bucket path into every entry and guarantee it never matches the flat store copy. Relative to
the skill root a bucket is invisible to the hash, which is exactly right — the same content filed
differently is the same content.

It is used in exactly three places:

1. **`status`** — does the store copy differ from each repo that holds a skill of that name.
2. **`link`** — is the directory occupying `<workspace>/<skill>` identical to the store copy, and
   therefore safe to replace with a symlink.
3. **Every destructive write** — is this overwrite actually destroying anything, or are the two sides
   already identical, in which case no backup is written.

The hash is never stored, so there is no baseline to refresh or go stale. The cost is that a difference
has no direction: it says the two copies disagree, not which one moved. `git diff` in the repo answers
that in one command, which is where you were going to look anyway.

### The backup net

Before grimoire destroys anything, it copies what was there into `.backup/`, namespaced by where the
destruction happened:

```
.backup/store/skills/<skill>/             ← destroyed by `import --force`
.backup/repos/<name>/skills/<skill>/      ← destroyed by `export` or `update`
.backup/workspaces/<name>/skills/<skill>/ ← destroyed by `clone`, or by `remove --clones`
```

Four rules:

- **Latest only.** Each slot holds one copy, overwritten on the next destructive write to that
  location. This bounds the directory rather than letting it grow forever, which is `.trash/`'s
  accepted flaw.
- **Written on every destructive write, not only on `--force`.** `export` overwrites by _default_, so
  the routine export is the dangerous one; a net that only appeared under `--force` would be missing
  wherever it was needed.
- **Skipped when the two sides are identical** by tree hash. Nothing is being destroyed, so nothing is
  backed up.
- **The path is printed in the command output.** A silent safety net you have to already know about is
  not a safety net.

The `skills/` segment in each path is load-bearing: it makes every backup directory a valid import
source, so recovery needs no command. `import ~/.grimoire/.backup/repos/mine/skills <skill> --force`
puts it back. The same is true of `.trash/skills/`, which is why `remove` needs no `restore`. Backups
are keyed by repo and skill name alone, carrying no bucket path — a recovery slot, not a mirror. The two
directories stay separate because they record different events, one an accident and one a decision, so
an `import --force` cannot clobber something you deliberately removed.

Where this earns its keep is narrower than it looks. If a repo is a clean git checkout, an overwrite is
already recoverable with `git checkout`; `.backup/` uniquely saves **uncommitted work in a repo** and
**repos that aren't under version control at all** — plus every clone overwrite, since a project's
`.claude/skills` is quite plausibly gitignored and the "recoverable from the project's own git"
assumption may simply be false.

No commands operate on `.backup/` in v1. Recovery is `import` from the printed path.

### Ignore semantics

`ignore` is a flat list of file globs matched **inside** skill directories — `.DS_Store` and its kind.
It applies on `import` (don't pull junk in), on `export`, `update`, and `clone` (don't push junk out),
and in the tree hash (so a Finder visit doesn't read as a content change).

Whole _skills_ cannot be ignored, and need not be: anything in the store is managed by definition, and
`status` never reports on directories the tool didn't create. What protects `import` from non-skills is
the discovery rule, under which a directory with no `SKILL.md` at any depth beneath it yields nothing
and is reported as skipped — which is what lets `import ~/.claude/skills --all` do the right thing with
a scratch directory or a stray `.DS_Store` without any configuration.

## Command surface

| Command | Behavior |
| --- | --- |
| `import <repo\|path> [skill...]` | Copy skills into the store. The first argument resolves as a registered repo name, falling back to a filesystem path. No skill named requires `--all`. Auto-links to default workspaces; `--no-link` opts out. Refuses on collision; `--force` overwrites. |
| `export <repo> <skill>... [--bucket <subpath>]` | Copy store → repo. **Always names skills** — the explicit half of _bulk never adds_, and the moment a skill's home is chosen. `--bucket` places it at `<repo>/<subpath>/<skill>`, any depth; omitted, it writes to the path the skill resolves to, or the repo root if it resolves to nothing. Overwrites, after backup. Leaves the repo's working tree dirty for review. |
| `update [<repo>] [--skill <n>...]` | Re-export **only skills the repo already holds**, each to the path it resolves to. No repo named = every writable repo. No skill named = every store skill that repo holds. Requires `--all` when both are omitted. Naming a skill the repo does not hold reports it and writes nothing: `update` never adds a skill, and never chooses a bucket. |
| `link <skill> [workspaces...]` | Symlink `workspace/<skill>` → `~/.grimoire/skills/<skill>`. No workspace named = the default workspaces. `--all` links every store skill. Replaces a directory identical by tree hash; **errors on anything else** — see _Overwriting_. |
| `unlink <skill> [workspaces...]` | Remove symlinks only; store untouched. No workspace named = every workspace it is linked into. |
| `clone <skill> [workspaces...]` | Copy store → workspace and record it. With no workspace, re-copy to every recorded one, overwriting after backup. |
| `remove <skill>` | Move the store skill to `.trash/`, clear its links, and drop its state entry. `--clones` also deletes the cloned directories, after backup. Warns if the skill is held by no repo. |
| `status` | See below. |
| `repo add/rm/list` | Manage named repo paths and their `mode`. `add` defaults to `read-only`, and **warns if no `.git` is found at the path or any ancestor** — exports there will have no history. `rm` unregisters only; the store is untouched. |
| `workspace add/rm/list` | Manage named workspace paths and the `default` flag. `rm` **errors while any link or recorded clone into that workspace remains**, listing them; `--force` removes the links and forgets the clone records as it unregisters — it does not delete cloned directories. |

`remove` and `status` carry the garbage collection. Deleting a store skill must clear its symlinks, or
every linked workspace is left with a dangling entry — so `remove` always clears them, and `unlink` is
the command for unlinking without removing. Cloned directories are the exception, opt-in behind
`--clones`: they are drift-by-design copies living where grimoire is a guest. `workspace rm` refuses
while links or clones remain, so unregistering a workspace can never hide live symlinks from check (4)
or orphan a clone record.

Default workspaces are consulted only when a skill enters the store. After that its link set belongs to
the skill: **the same skill linked into one account and not the other is a supported outcome**, which is
the whole reason accounts are linked per skill rather than by symlinking the directory. So `status`
asks whether a skill reaches _any_ workspace, never whether it reaches the expected ones.

Splitting `export` from `update` keeps both predictable, and gives the model its central invariant:

> **Bulk operations never add. Explicit operations may.**

`export` is the only way a skill arrives in a repo for the first time, and it always names the skill, so
choosing a skill's home is always a deliberate act. `update` can therefore walk every repo without ever
being able to put a private skill somewhere public — the leak isn't guarded against, it's unreachable.
This replaces everything `origin` was doing, with no recorded state.

`import` accepts a bare path as well as a repo name because skills arrive from places you don't want to
register: whatever a skill-creation tool just wrote into an account directory, the trash, a backup, a
skill someone sent you. The two forms are behaviourally identical.

`export` prints where the content landed and that git has not been involved:

```
exported code-review → mine (~/skills/<bucket>/code-review)
backed up previous version → .backup/repos/mine/skills/code-review
commit in ~/skills to record it
```

That last line is the whole compensation for dropping `-m`. `status` goes clean the moment content
matches, which is before you have committed anything, so the reminder has to fire at the moment of the
write. Having `status` report uncommitted changes in repos would close the loop, but it would mean
shelling out to git on every invocation and nagging about a state that is frequently intentional.
**Deferred, deliberately.**

The first line prints the **full destination path**, not just the repo name, because with `--bucket` in
play the repo name no longer says where the content landed.

`repo add`'s `.git` check stats the filesystem rather than invoking git, and walks **upward**: a repo is
registered at its skills directory, which is commonly a subdirectory of the git repository rather than
its root. Checking only the registered path would warn "exports there will have no history" about a
directory that is version controlled one or two levels up. That warning is only useful when it is rare,
so it has to be true.

### Overwriting

One rule governs every write: **the tool overwrites only what it can prove is safe to lose, and backs
up the rest.**

| operation | writes into | default | force |
| --- | --- | --- | --- |
| `import` | store | **refuses** if the skill is already in the store | `--force`, after backup |
| `export` | repo | overwrites, after backup | n/a |
| `update` | repo | overwrites what the repo already holds, after backup | n/a |
| `clone` | workspace | overwrites, after backup | n/a |
| `link` | workspace | replaces an **identical** directory; errors on anything else | none — no `--force` exists |

The asymmetry is deliberate and worth stating outright:

> **`--force` exists on `import` only.** `import` refuses by default because the store is the thing
> with no history. `export` overwrites by default because the repo is where history lives.

`link`'s rule is the one that isn't absolute. It may create `workspace/<skill>` when nothing is there,
when the correct symlink is already there (a silent no-op), or when a real directory is there whose
tree hash matches the store copy. That last case is not an exception to _overwrite only what you can
prove is safe to lose_ — it is that rule applied: the store demonstrably holds the same content, so
swapping a duplicate directory for a symlink loses nothing, and nothing goes to `.backup/`. A directory
that differs, a file, or a symlink pointing elsewhere is an **error that writes nothing**.

That single relaxation is what makes two otherwise-broken workflows work:

- **The skill-creation loop.** A tool writes `~/.claude/skills/<new>/`; you run
  `import ~/.claude/skills <new>`; the auto-link finds its own source directory sitting in the
  workspace, recognises it as a duplicate, and replaces it with a symlink. Under an absolute rule, the
  auto-link would fail on the very workspace you imported from, every single time, and the workflow
  would end in a manual delete.
- **First adoption of an existing setup.** Registering config directories that are already full of
  skills and running `import <repo> --all` links everything that already agrees with the repo and
  **errors, by name, on everything that doesn't**. The alternative — emptying the config directories
  first so `link` has clear ground — means deleting the evidence of drift before the tool can show it
  to you.

Refusals in both directions are **per skill**: an `import` over a directory of twenty, or an
`update --all` across every repo, reports what it declined and processes the rest rather than aborting
the batch.

`import --no-link` leaves an unmanaged directory in the workspace that grimoire did not record. `status`
will then report the store skill as reaching no workspace, which is correct rather than a false alarm —
that directory is now going to drift silently forever, and `clone <skill> <workspace>` is how you bring
it under management.

### What `status` reports

This is the tool's whole safety story, so it is worth enumerating:

1. **Differs from a repo** — for each store skill, tree-hashed against every repo that holds a skill of
   that name. No direction: it says the copies disagree, not which one moved. Against a `read-write`
   repo that is usually unexported work; against a `read-only` one it is a local modification of a
   vendored skill.
2. **Held by no repo** — no repo anywhere contains a skill of that name. Nothing you control holds a
   copy, so it has no history, and `update` will never reach it. The fix is `export <repo> <skill>`.
3. **Reaches no workspace** — a store skill with no links and no clones. It is in the store and deployed
   nowhere: an `import` you never finished, or a leftover.
4. **Dangling symlinks** — workspace entries pointing at a store path that no longer exists.
5. **Missing clones** — a recorded clone whose directory is gone from the workspace.
6. **Orphaned state** — a `state.json` key with no matching store skill, left by a skill renamed or
   deleted outside the tool.
7. **Unreachable repo or workspace** — a registered path that no longer exists on disk.

Three things are deliberately **not** reported, and the reasons matter:

- **A skill absent from _some_ repos.** Under _bulk never adds_, a skill only lives in the repos you
  put it in, so absence is the normal state rather than a finding. Only absence from _every_ repo is
  reportable, and that is check (2).
- **A clone differing from the store.** Clones are drift-by-design; that difference is the entire
  reason for choosing `clone` over `link`.
- **A second copy of a skill in one repo.** A name resolves to one path and the walk stops there, so
  the tool never learns the other copy exists. Reporting it would mean modelling duplicates, which is
  exactly what the halt rule declines to do.

(1) and (2) are what make an unversioned store safe: the window where an edit exists only in the store
is something you can see, and (2) names the skills for which that window never closes.

Every check starts from something grimoire owns — a store skill, or a `state.json` entry. **`status`
inspects the tool's own artifacts wherever they live, and never reports on directories it did not
create.** (3) and (4) read registered workspace directories but examine only symlinks pointing into the
store. (1) and (2) walk a repo to resolve skills **whose names are already in the store**, and hash what
they find; a repo skill the store hasn't heard of goes unmentioned, since reporting it would be
discovery. That walk is the one cost buckets impose on `status`, and it is bounded twice over: it stops
at every `SKILL.md`, and entirely once the name resolves.

## Scope for v1

Skills only. The `~/.grimoire/skills/` layout leaves room for sibling artifact types (`commands/`,
`agents/`) without redesign, but none are built. Node + TypeScript. Distributed by local global
install / `npm link`; nothing is published.

## Adopting an existing setup

Grimoire has no `init` that imports the world for you; discovery is a non-goal, and the first-run path
is the ordinary commands in order. The shape is always the same:

1. Get your skills into a repository you control, resolving any drift between existing copies **there**,
   with version control already available. History begins before grimoire runs at all. Organize it
   however you like — grimoire discovers skills at any depth, and never asks you to declare the shape.
2. `repo add <name> <path> read-write`, where `<path>` is the directory the skills live _under_, not the
   git root.
3. `workspace add <name> <path> --default` for each config directory.
4. `import <repo> --all` — seeds the store and links every skill into the default workspaces.
5. Resolve the links step 4 refused. Every skill whose existing workspace copy differs from the
   repository version is reported by name, having written nothing; confirm which version you want,
   remove the stale copy, and `link` it.
6. `unlink` anything that shouldn't be in every workspace.

Steps 4 and 5 are where the `link` relaxation pays for itself, per _Overwriting_ above: you never have
to clear the config directories in advance, so the tool gets to name the disagreements instead of you
deleting them unseen.
