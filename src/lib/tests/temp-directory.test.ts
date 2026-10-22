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

  it.each([
    { signal: 'SIGINT', exitCode: 130 },
    { signal: 'SIGHUP', exitCode: 129 },
  ] as const)('removes the directory and exits $exitCode on $signal', async ({ signal, exitCode }) => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    onTestFinished(() => {
      exit.mockRestore();
    });

    await withTempDirectory((directory) => {
      const onSignal = process.listeners(signal).at(-1);
      onSignal?.(signal);

      expect(existsSync(directory)).toBe(false);
      expect(exit).toHaveBeenCalledWith(exitCode);
      return Promise.resolve();
    });
  });

  it.each(['SIGINT', 'SIGHUP'] as const)('removes its %s listener when run settles', async (signal) => {
    const before = process.listenerCount(signal);

    await withTempDirectory(() => {
      expect(process.listenerCount(signal)).toBe(before + 1);
      return Promise.resolve();
    });

    expect(process.listenerCount(signal)).toBe(before);
  });

  it('leaves SIGTERM alone', async () => {
    const before = process.listenerCount('SIGTERM');

    await withTempDirectory(() => {
      expect(process.listenerCount('SIGTERM')).toBe(before);
      return Promise.resolve();
    });
  });
});
