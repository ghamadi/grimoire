import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { configSchema, defaultConfig, type Config } from './config.ts';
import { parseJsonFile, writeJsonFileAtomic } from './json-file.ts';
import { defaultState, stateSchema, type State } from './state.ts';

export type StorePaths = {
  root: string;
  skills: string;
  trash: string;
  backup: string;
  config: string;
  state: string;
};

export class GrimoireStore {
  readonly paths: StorePaths;

  constructor(root: string) {
    this.paths = {
      root,
      skills: join(root, 'skills'),
      trash: join(root, '.trash'),
      backup: join(root, '.backup'),
      config: join(root, 'config.json'),
      state: join(root, '.state.json'),
    };
  }

  loadConfig(): Config {
    this.ensureLayout();
    return parseJsonFile(this.paths.config, configSchema) ?? defaultConfig();
  }

  saveConfig(config: Config): void {
    this.ensureLayout();
    writeJsonFileAtomic(this.paths.config, configSchema.parse(config));
  }

  loadState(): State {
    this.ensureLayout();
    return parseJsonFile(this.paths.state, stateSchema) ?? defaultState();
  }

  saveState(state: State): void {
    this.ensureLayout();
    writeJsonFileAtomic(this.paths.state, stateSchema.parse(state));
  }

  /**
   * Creates the store's directory scaffold, including `root` itself.
   * Idempotent - does nothing if the layout already exists.
   *
   * Must be called before any operation touching the store, so that reading
   * and writing always finds a path that loads.
   */
  private ensureLayout(): void {
    for (const dir of this.storeSubdirectories) {
      mkdirSync(dir, { recursive: true });
    }
  }

  private get storeSubdirectories(): readonly string[] {
    return [this.paths.skills, this.paths.trash, this.paths.backup];
  }
}
