import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findDanglingStoreLinks, findStoreLinks } from '@/domains/grimoire-store/helpers/store-links';
import { tempRoot } from '@test-helpers/temp-root';

describe('findStoreLinks', () => {
  it('finds a link into the store', async () => {
    const { workspace, storeSkills, link } = await newFixture();

    link({ skill: 'brainstorm' });

    expect(findStoreLinks({ workspacePath: workspace, storeSkills })).toEqual([
      { skill: 'brainstorm', storeSkill: 'brainstorm', path: join(workspace, 'brainstorm') },
    ]);
  });

  // What this scan reports is what currently points into the store. The target
  // this link records is a store path, but nothing is there, so it resolves
  // nowhere and is not one.
  it('ignores a link whose skill in the store is gone', async () => {
    const { workspace, storeSkills, link } = await newFixture();

    link({ skill: 'brainstorm', create: false });

    expect(findStoreLinks({ workspacePath: workspace, storeSkills })).toEqual([]);
  });

  it('finds a link recorded with a relative target', async () => {
    const { workspace, storeSkills, link } = await newFixture();

    link({ skill: 'brainstorm', relative: true });

    expect(findStoreLinks({ workspacePath: workspace, storeSkills })).toEqual([
      { skill: 'brainstorm', storeSkill: 'brainstorm', path: join(workspace, 'brainstorm') },
    ]);
  });

  it('finds a link that reaches the store through another link', async () => {
    const { workspace, storeSkills, chain } = await newFixture();

    chain({ skill: 'brainstorm' });

    expect(findStoreLinks({ workspacePath: workspace, storeSkills })).toEqual([
      { skill: 'brainstorm', storeSkill: 'brainstorm', path: join(workspace, 'brainstorm') },
    ]);
  });

  it('ignores a chained link whose skill in the store is gone', async () => {
    const { workspace, storeSkills, chain } = await newFixture();

    chain({ skill: 'brainstorm', create: false });

    expect(findStoreLinks({ workspacePath: workspace, storeSkills })).toEqual([]);
  });

  it("resolves a relative target recorded on a hop against the hop's own directory", async () => {
    const { workspace, storeSkills, chain } = await newFixture();

    chain({ skill: 'brainstorm', relative: true });

    expect(findStoreLinks({ workspacePath: workspace, storeSkills })).toEqual([
      { skill: 'brainstorm', storeSkill: 'brainstorm', path: join(workspace, 'brainstorm') },
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

  it('reports the store skill a renamed entry resolves into', async () => {
    const { workspace, storeSkills, link } = await newFixture();

    link({ skill: 'triage', entry: 'tri' });

    expect(findStoreLinks({ workspacePath: workspace, storeSkills })).toEqual([
      { skill: 'tri', storeSkill: 'triage', path: join(workspace, 'tri') },
    ]);
  });

  it('reports the store skill a link pointing below it resolves into', async () => {
    const { workspace, storeSkills } = await newFixture();

    mkdirSync(join(storeSkills, 'triage', 'references'), { recursive: true });
    symlinkSync(join(storeSkills, 'triage', 'references'), join(workspace, 'x'));

    expect(findStoreLinks({ workspacePath: workspace, storeSkills })).toEqual([
      { skill: 'x', storeSkill: 'triage', path: join(workspace, 'x') },
    ]);
  });

  // There is no skill to attribute it to.
  it('ignores a link pointing at the skills root itself', async () => {
    const { workspace, storeSkills } = await newFixture();

    symlinkSync(storeSkills, join(workspace, 'all'));

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

  // Not an error, or the registration is only clearable by hand-editing state.
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

describe('findDanglingStoreLinks', () => {
  it('reports a link whose skill in the store is gone', async () => {
    const { workspace, storeSkills, link } = await newFixture();

    link({ skill: 'brainstorm', create: false });

    expect(findDanglingStoreLinks({ workspacePath: workspace, storeSkills })).toEqual([
      { entry: 'brainstorm', target: join(storeSkills, 'brainstorm') },
    ]);
  });

  it('reports a link recorded with a relative target, made absolute against the workspace', async () => {
    const { workspace, storeSkills, link } = await newFixture();

    link({ skill: 'brainstorm', create: false, relative: true });

    expect(findDanglingStoreLinks({ workspacePath: workspace, storeSkills })).toEqual([
      { entry: 'brainstorm', target: join(storeSkills, 'brainstorm') },
    ]);
  });

  it('reports a renamed entry under its own name', async () => {
    const { workspace, storeSkills, link } = await newFixture();

    link({ skill: 'triage', entry: 'tri', create: false });

    expect(findDanglingStoreLinks({ workspacePath: workspace, storeSkills })).toEqual([
      { entry: 'tri', target: join(storeSkills, 'triage') },
    ]);
  });

  it('reports a link pointing below a skill that is gone', async () => {
    const { workspace, storeSkills } = await newFixture();
    const target = join(storeSkills, 'gone', 'references');

    symlinkSync(target, join(workspace, 'x'));

    expect(findDanglingStoreLinks({ workspacePath: workspace, storeSkills })).toEqual([
      { entry: 'x', target },
    ]);
  });

  it('reports a link into a store reached through a symlinked root, when its skill is gone', async () => {
    const root = await tempRoot();
    const workspace = join(root, 'workspace');
    const storeSkills = join(root, 'real', 'skills');

    mkdirSync(workspace);
    mkdirSync(storeSkills, { recursive: true });
    symlinkSync(join(root, 'real'), join(root, 'store'));
    symlinkSync(join(root, 'store', 'skills', 'x'), join(workspace, 'x'));

    expect(findDanglingStoreLinks({ workspacePath: workspace, storeSkills })).toEqual([
      { entry: 'x', target: join(root, 'store', 'skills', 'x') },
    ]);
  });

  it('reports a link into the store whose target is a symlink cycle', async () => {
    const { workspace, storeSkills } = await newFixture();
    const loop = join(storeSkills, 'loop');

    symlinkSync(loop, loop);
    symlinkSync(loop, join(workspace, 'loop'));

    expect(findDanglingStoreLinks({ workspacePath: workspace, storeSkills })).toEqual([
      { entry: 'loop', target: loop },
    ]);
  });

  it('ignores a link that resolves into the store', async () => {
    const { workspace, storeSkills, link } = await newFixture();

    link({ skill: 'brainstorm' });

    expect(findDanglingStoreLinks({ workspacePath: workspace, storeSkills })).toEqual([]);
  });

  it('ignores a dangling link aimed outside the store', async () => {
    const { workspace, storeSkills } = await newFixture();

    symlinkSync(join(await tempRoot(), 'nowhere'), join(workspace, 'triage'));

    expect(findDanglingStoreLinks({ workspacePath: workspace, storeSkills })).toEqual([]);
  });

  it('ignores a link that names the store only through another link, even when that skill is gone', async () => {
    const { workspace, storeSkills, chain } = await newFixture();

    chain({ skill: 'brainstorm', create: false });

    expect(findDanglingStoreLinks({ workspacePath: workspace, storeSkills })).toEqual([]);
  });

  it('ignores a link that points at itself', async () => {
    const { workspace, storeSkills } = await newFixture();

    symlinkSync(join(workspace, 'brainstorm'), join(workspace, 'brainstorm'));

    expect(findDanglingStoreLinks({ workspacePath: workspace, storeSkills })).toEqual([]);
  });

  it('ignores a plain directory', async () => {
    const { workspace, storeSkills } = await newFixture();

    mkdirSync(join(workspace, 'brainstorm'));

    expect(findDanglingStoreLinks({ workspacePath: workspace, storeSkills })).toEqual([]);
  });

  it('ignores a regular file', async () => {
    const { workspace, storeSkills } = await newFixture();

    writeFileSync(join(workspace, 'notes.md'), '# notes', 'utf8');

    expect(findDanglingStoreLinks({ workspacePath: workspace, storeSkills })).toEqual([]);
  });

  it('sorts by entry name', async () => {
    const { workspace, storeSkills, link } = await newFixture();

    link({ skill: 'triage', create: false });
    link({ skill: 'brainstorm', create: false });

    expect(
      findDanglingStoreLinks({ workspacePath: workspace, storeSkills }).map(({ entry }) => entry),
    ).toEqual(['brainstorm', 'triage']);
  });

  it('treats a workspace directory that is gone as holding no links', async () => {
    const { workspace, storeSkills } = await newFixture();

    expect(findDanglingStoreLinks({ workspacePath: join(workspace, 'nope'), storeSkills })).toEqual([]);
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

  function link(options: { skill: string; entry?: string; create?: boolean; relative?: boolean }): void {
    const target = join(storeSkills, options.skill);

    if (options.create !== false) {
      mkdirSync(target);
    }

    symlinkSync(
      options.relative ? relative(workspace, target) : target,
      join(workspace, options.entry ?? options.skill),
    );
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
