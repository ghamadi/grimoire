import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findStoreLinks } from '../links.ts';
import { tempRoot } from '#test-helpers/temp-root';

describe('findStoreLinks', () => {
  it('finds a link into the store', async () => {
    const { workspace, storeSkills, link } = await newFixture();

    link({ skill: 'brainstorm' });

    expect(findStoreLinks({ workspacePath: workspace, storeSkills })).toEqual([
      { skill: 'brainstorm', path: join(workspace, 'brainstorm') },
    ]);
  });

  // The case the whole scan exists for: `realpath` throws on this one.
  it('finds a dangling link into the store', async () => {
    const { workspace, storeSkills, link } = await newFixture();

    link({ skill: 'brainstorm', create: false });

    expect(findStoreLinks({ workspacePath: workspace, storeSkills })).toEqual([
      { skill: 'brainstorm', path: join(workspace, 'brainstorm') },
    ]);
  });

  it('finds a link recorded with a relative target', async () => {
    const { workspace, storeSkills, link } = await newFixture();

    link({ skill: 'brainstorm', relative: true });

    expect(findStoreLinks({ workspacePath: workspace, storeSkills })).toEqual([
      { skill: 'brainstorm', path: join(workspace, 'brainstorm') },
    ]);
  });

  it('finds a link that reaches the store through another link', async () => {
    const { workspace, storeSkills, chain } = await newFixture();

    chain({ skill: 'brainstorm' });

    expect(findStoreLinks({ workspacePath: workspace, storeSkills })).toEqual([
      { skill: 'brainstorm', path: join(workspace, 'brainstorm') },
    ]);
  });

  // `realpath` throws on this one too, but the walk cannot fall back to the
  // lexical path the way it can for a direct link: that lands in the hop.
  it('finds a chained link whose skill in the store is gone', async () => {
    const { workspace, storeSkills, chain } = await newFixture();

    chain({ skill: 'brainstorm', create: false });

    expect(findStoreLinks({ workspacePath: workspace, storeSkills })).toEqual([
      { skill: 'brainstorm', path: join(workspace, 'brainstorm') },
    ]);
  });

  it("resolves a relative target recorded on a hop against the hop's own directory", async () => {
    const { workspace, storeSkills, chain } = await newFixture();

    chain({ skill: 'brainstorm', relative: true });

    expect(findStoreLinks({ workspacePath: workspace, storeSkills })).toEqual([
      { skill: 'brainstorm', path: join(workspace, 'brainstorm') },
    ]);
  });

  it('ignores a link that points at itself', async () => {
    const { workspace, storeSkills } = await newFixture();

    symlinkSync(join(workspace, 'brainstorm'), join(workspace, 'brainstorm'));

    expect(findStoreLinks({ workspacePath: workspace, storeSkills })).toEqual([]);
  });

  it('ignores a link pointing outside the store', async () => {
    const { workspace, storeSkills } = await newFixture();
    const elsewhere = join(await tempRoot(), 'triage');

    mkdirSync(elsewhere);
    symlinkSync(elsewhere, join(workspace, 'triage'));

    expect(findStoreLinks({ workspacePath: workspace, storeSkills })).toEqual([]);
  });

  it('ignores a plain directory', async () => {
    const { workspace, storeSkills } = await newFixture();

    mkdirSync(join(workspace, 'brainstorm'));

    expect(findStoreLinks({ workspacePath: workspace, storeSkills })).toEqual([]);
  });

  it('ignores a regular file', async () => {
    const { workspace, storeSkills } = await newFixture();

    writeFileSync(join(workspace, 'notes.md'), '# notes', 'utf8');

    expect(findStoreLinks({ workspacePath: workspace, storeSkills })).toEqual([]);
  });

  it('returns only the store links, sorted by skill name', async () => {
    const { workspace, storeSkills, link } = await newFixture();
    const elsewhere = join(await tempRoot(), 'vendored');

    mkdirSync(elsewhere);
    mkdirSync(join(workspace, 'scratch'));
    writeFileSync(join(workspace, 'notes.md'), '# notes', 'utf8');
    symlinkSync(elsewhere, join(workspace, 'vendored'));
    link({ skill: 'triage' });
    link({ skill: 'brainstorm' });

    expect(findStoreLinks({ workspacePath: workspace, storeSkills }).map(({ skill }) => skill)).toEqual([
      'brainstorm',
      'triage',
    ]);
  });

  it('treats a workspace directory that is gone as holding no links', async () => {
    const { workspace, storeSkills } = await newFixture();

    expect(findStoreLinks({ workspacePath: join(workspace, 'nope'), storeSkills })).toEqual([]);
  });

  // Not an error, or the registration is only clearable by hand-editing config.
  it('treats a workspace path that is a file as holding no links', async () => {
    const { workspace, storeSkills } = await newFixture();
    const file = join(workspace, 'notes.md');

    writeFileSync(file, '# notes', 'utf8');

    expect(findStoreLinks({ workspacePath: file, storeSkills })).toEqual([]);
  });

  it('treats a workspace path whose parent is a file as holding no links', async () => {
    const { workspace, storeSkills } = await newFixture();
    const file = join(workspace, 'notes.md');

    writeFileSync(file, '# notes', 'utf8');

    expect(findStoreLinks({ workspacePath: join(file, 'skills'), storeSkills })).toEqual([]);
  });
});

/**
 * A workspace and a store skills directory, plus a `link` that writes what the
 * `link` command will — hand-built, since that command does not exist yet.
 */
async function newFixture() {
  const root = await tempRoot();
  const workspace = join(root, 'workspace');
  const storeSkills = join(root, 'store', 'skills');

  mkdirSync(workspace, { recursive: true });
  mkdirSync(storeSkills, { recursive: true });

  function link(options: { skill: string; create?: boolean; relative?: boolean }): void {
    const target = join(storeSkills, options.skill);

    if (options.create !== false) {
      mkdirSync(target);
    }

    symlinkSync(options.relative ? relative(workspace, target) : target, join(workspace, options.skill));
  }

  /**
   * The same link, reaching the store on the second `readlink` instead of the
   * first.
   *
   * The hop sits deeper than the workspace so that a relative target resolved
   * against the wrong directory lands somewhere else rather than by luck on the
   * same path.
   */
  function chain(options: { skill: string; create?: boolean; relative?: boolean }): void {
    const target = join(storeSkills, options.skill);
    const hop = join(root, 'hops', 'deeper', options.skill);

    if (options.create !== false) {
      mkdirSync(target);
    }

    mkdirSync(join(root, 'hops', 'deeper'), { recursive: true });
    symlinkSync(options.relative ? relative(join(root, 'hops', 'deeper'), target) : target, hop);
    symlinkSync(hop, join(workspace, options.skill));
  }

  return { workspace, storeSkills, link, chain };
}
