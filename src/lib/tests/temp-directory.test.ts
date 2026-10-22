import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { withTempDirectory } from '@/lib/temp-directory';

describe('withTempDirectory', () => {
  it("resolves to run's value and removes the directory", async () => {
    let seen = '';

    const value = await withTempDirectory((directory) => {
      seen = directory;
      return Promise.resolve('done');
    });

    expect(value).toBe('done');
    expect(existsSync(seen)).toBe(false);
  });

  it("rethrows run's error and removes the directory", async () => {
    let seen = '';
    const failure = new Error('run failed');

    const result = withTempDirectory((directory) => {
      seen = directory;
      return Promise.reject(failure);
    });

    await expect(result).rejects.toBe(failure);
    expect(existsSync(seen)).toBe(false);
  });

  it('hands run an existing directory under the system temp directory', async () => {
    await withTempDirectory((directory) => {
      expect(directory.startsWith(join(tmpdir(), 'grimoire-'))).toBe(true);
      expect(existsSync(directory)).toBe(true);
      return Promise.resolve();
    });
  });

  it('removes the directory and exits 130 on SIGINT', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    onTestFinished(() => {
      exit.mockRestore();
    });

    await withTempDirectory((directory) => {
      const onSigint = process.listeners('SIGINT').at(-1);
      onSigint?.('SIGINT');

      expect(existsSync(directory)).toBe(false);
      expect(exit).toHaveBeenCalledWith(130);
      return Promise.resolve();
    });
  });

  it('removes its SIGINT listener when run settles', async () => {
    const before = process.listenerCount('SIGINT');

    await withTempDirectory(() => {
      expect(process.listenerCount('SIGINT')).toBe(before + 1);
      return Promise.resolve();
    });

    expect(process.listenerCount('SIGINT')).toBe(before);
  });
});
