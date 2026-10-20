import { afterEach, describe, expect, it } from 'vitest';
import { MissingDestinationError } from '@/lib/errors';
import { clackPicker, pickChoices } from '@/lib/picker';
import { fakePicker } from '@test-helpers/fake-picker';

type TtyStream = NodeJS.ReadStream | NodeJS.WriteStream;

describe('clackPicker.isInteractive', () => {
  const stdinDescriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
  const stdoutDescriptor = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');

  afterEach(() => {
    restoreIsTTY({ stream: process.stdin, descriptor: stdinDescriptor });
    restoreIsTTY({ stream: process.stdout, descriptor: stdoutDescriptor });
  });

  it.each([
    { stdin: true, stdout: true, expected: true },
    { stdin: true, stdout: false, expected: false },
    { stdin: false, stdout: true, expected: false },
  ])(
    'is $expected when stdin is a TTY: $stdin, stdout is a TTY: $stdout',
    ({ stdin, stdout, expected }) => {
      setIsTTY({ stream: process.stdin, isTTY: stdin });
      setIsTTY({ stream: process.stdout, isTTY: stdout });

      expect(clackPicker.isInteractive()).toBe(expected);
    },
  );
});

describe('pickChoices', () => {
  const choices = [
    { value: 'dotfiles', label: 'dotfiles' },
    { value: 'library', label: 'library' },
  ];
  const message = 'Select the repos';
  const refusal = { noun: 'repo', remedy: 'name them with --to' };

  it.each([true, false])(
    'returns no-choices without offering a pick when isInteractive is %s',
    async (isInteractive) => {
      const picker = fakePicker({ choose: (labels) => labels, isInteractive });

      await expect(pickChoices({ picker, message, choices: [], refusal })).resolves.toEqual({
        kind: 'no-choices',
      });
      expect(picker.offered).toEqual([]);
    },
  );

  it('refuses with every choice label when there is no terminal', async () => {
    const picker = fakePicker({ choose: (labels) => labels, isInteractive: false });

    const error = await pickChoices({ picker, message, choices, refusal }).catch(
      (error: unknown) => error,
    );

    expect(error).toBeInstanceOf(MissingDestinationError);
    expect(error).toMatchObject({
      noun: 'repo',
      remedy: 'name them with --to',
      choiceLabels: ['dotfiles', 'library'],
    });
    expect(picker.offered).toEqual([]);
  });

  it('returns none-picked when nothing is picked', async () => {
    const picker = fakePicker({ choose: () => [] });

    await expect(pickChoices({ picker, message, choices, refusal })).resolves.toEqual({
      kind: 'none-picked',
    });
  });

  it('returns the picked values in choice order whatever order the picker returns', async () => {
    const picker = fakePicker({ choose: (labels) => [...labels].reverse() });

    await expect(pickChoices({ picker, message, choices, refusal })).resolves.toEqual({
      kind: 'picked',
      values: ['dotfiles', 'library'],
    });
  });
});

function setIsTTY(params: { stream: TtyStream; isTTY: boolean }): void {
  Object.defineProperty(params.stream, 'isTTY', { value: params.isTTY, configurable: true });
}

function restoreIsTTY(params: { stream: TtyStream; descriptor: PropertyDescriptor | undefined }): void {
  if (params.descriptor) {
    Object.defineProperty(params.stream, 'isTTY', params.descriptor);
  } else {
    Reflect.deleteProperty(params.stream, 'isTTY');
  }
}
