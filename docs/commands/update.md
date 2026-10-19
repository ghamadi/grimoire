# `update`

Updates grimoire to the latest release, when grimoire was installed with `npm install -g`.

```shell
$ grimoire update
updated grimoire 0.1.0 → 0.2.0
```

It takes no arguments and no flags.

## Finding the latest release

`update` asks npm for the latest release, however grimoire was installed. npm ships with Node and follows your registry
config, so npm must be on your `PATH` even when another package manager installed grimoire.

Releases are staged, and the latest release changes only once a new one is approved. `update` never offers a version that has
not been approved.

If npm cannot be run at all, `update` exits 1:

```shell
$ grimoire update
error: could not run npm: `grimoire update` needs it installed and on your PATH
```

## Outcomes

The running version is compared with the latest release, number by number.

When they are equal, nothing is installed, and the run exits 0:

```shell
$ grimoire update
grimoire 0.2.0 is up to date
```

When the running version is newer, as with a package installed by hand from a tarball, nothing is installed, and the run
exits 0:

```shell
$ grimoire update
grimoire 0.3.0 is newer than the latest release, 0.2.0
```

When the latest release is newer, `update` installs it with npm, but only over an npm global install. npm's own output is not
shown. On success, the run prints the old and new versions and exits 0.

The versions are compared first, so a copy installed another way is told it is up to date rather than refused.

## What counts as an npm global install

The running copy counts when its package directory, with symlinks followed, sits inside the directory `npm root -g` prints.
These do not count, because they resolve elsewhere:

- `npm link`, and `npm install -g` from a local folder
- `npx`
- a development checkout
- pnpm, yarn and bun installs

Any other copy is refused, and the run exits 1:

```shell
$ grimoire update
error: grimoire 0.2.0 is available, but this copy was not installed with `npm install -g`
  update it with the package manager that installed it:
    pnpm add -g @ghamadi/grimoire@latest
    yarn global add @ghamadi/grimoire@latest
    bun add -g @ghamadi/grimoire@latest
```

### Why only npm

The other managers cannot be detected reliably. pnpm moves its global packages between major versions, `yarn global` exists
only in Yarn 1, and bun has no command that prints its global directory. Running npm over another manager's install would
leave two copies competing on your `PATH`.

## When npm fails

If npm runs but fails, for example when you are offline or cannot write to npm's global directory, the run exits 1. The
message names the npm command, then shows npm's error output, indented:

```shell
$ grimoire update
error: `npm install -g '@ghamadi/grimoire@0.2.0'` failed:
  npm error code EACCES
  npm error syscall mkdir
  npm error path /usr/local/lib/node_modules/@ghamadi
```

This applies to all three npm calls: finding the latest release, finding npm's global directory, and the install.
