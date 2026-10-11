import { join } from 'node:path';
import { build } from 'tsdown';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    cliBundlePath: string;
  }
}

export default async function setup(project: TestProject) {
  const outDir = join(project.config.root, 'node_modules/.cache/grimoire-test-bundle');
  const buildCliBundle = async () => {
    await build({ outDir });
  };

  await buildCliBundle();
  project.provide('cliBundlePath', join(outDir, 'cli.js'));
  project.onTestsRerun(buildCliBundle);
}
