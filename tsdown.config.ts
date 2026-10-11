import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: 'src/cli.ts',
  // The Node default emits cli.mjs, which breaks both bin entries.
  fixedExtension: false,
  // An unresolved import would otherwise only warn and write a bundle that crashes on start.
  failOnWarn: true,
  // Empty allow-list: a runtime dependency misfiled under devDependencies fails the build, not inlined.
  deps: { onlyBundle: [] },
});
