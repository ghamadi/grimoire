import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parseJsonFile, writeJsonFileAtomic } from '../json-file.ts';
import { tempRoot } from '#test-helpers/temp-root';

const schema = z.object({ name: z.string(), tags: z.array(z.string()) });

describe('readJsonFile', () => {
  it('returns undefined when the file does not exist', async () => {
    const root = await tempRoot();

    expect(parseJsonFile(join(root, 'missing.json'), schema)).toBeUndefined();
  });
});

describe('writeJsonFileAtomic', () => {
  it('round-trips a value through write then read', async () => {
    const root = await tempRoot();
    const file = join(root, 'data.json');
    const value = { name: 'grimoire', tags: ['skills', 'cli'] };

    writeJsonFileAtomic(file, value);

    expect(parseJsonFile(file, schema)).toEqual(value);
  });

  it('leaves no temp file behind on success', async () => {
    const root = await tempRoot();

    writeJsonFileAtomic(join(root, 'data.json'), { name: 'grimoire', tags: [] });

    expect(readdirSync(root)).toEqual(['data.json']);
  });

  // The deterministic half of the crash-safety claim: a BigInt makes
  // JSON.stringify throw, exercising the failure path without killing the
  // process.
  it('leaves the previous file byte-identical when serialization throws', async () => {
    const root = await tempRoot();
    const file = join(root, 'data.json');
    const original = '{ "name": "original", "tags": [] }\n';

    writeFileSync(file, original, 'utf8');

    expect(() => {
      writeJsonFileAtomic(file, { name: 'grimoire', size: 1n });
    }).toThrow(TypeError);

    expect(readFileSync(file, 'utf8')).toBe(original);
    expect(readdirSync(root)).toEqual(['data.json']);
  });
});
