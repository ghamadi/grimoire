import { isCancel, multiselect } from '@clack/prompts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MissingDestinationError } from '@/lib/errors';
import { clackPicker, pickChoices } from '@/lib/picker';
import { fakePicker } from '@test-helpers/fake-picker';

vi.mock('@clack/prompts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@clack/prompts')>();

  return { ...actual, multiselect: vi.fn(), isCancel: vi.fn(actual.isCancel) };
});

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

describe('clackPicker.pick', () => {
  const message = 'Select the skills';
  const choices = [
    { value: { name: 'brainstorm' }, label: 'brainstorm', hint: '/skills/brainstorm' },
    { value: { name: 'review' }, label: 'review' },
    { value: { name: 'triage' }, label: 'triage', hint: '/skills/triage' },
  ];

  it('offers clack each choice by its index, with its label and hint', async () => {
    vi.mocked(multiselect).mockResolvedValueOnce([]);

    await clackPicker.pick({ message, choices });

    expect(multiselect).toHaveBeenCalledWith({
      message,
      options: [
        { value: 0, label: 'brainstorm', hint: '/skills/brainstorm' },
        { value: 1, label: 'review', hint: undefined },
        { value: 2, label: 'triage', hint: '/skills/triage' },
      ],
      required: false,
    });
  });

  it('returns the values of the choices at the indices clack returns', async () => {
    vi.mocked(multiselect).mockResolvedValueOnce([2, 0]);

    await expect(clackPicker.pick({ message, choices })).resolves.toEqual([
      choices[0]?.value,
      choices[2]?.value,
    ]);
  });

  it('returns nothing when the prompt is cancelled', async () => {
    // clack does not export its cancel symbol, so a selection stands in for it.
    vi.mocked(multiselect).mockResolvedValueOnce([0]);
    vi.mocked(isCancel).mockReturnValueOnce(true);

    await expect(clackPicker.pick({ message, choices })).resolves.toEqual([]);
  });
});

describe('pickChoices', () => {
  const choices = [
    { value: 'dotfiles', label: 'dotfiles' },
    { value: 'library', label: 'library' },
  ];
  const message = 'Select the repos';
  const refusal = { noun: 'repo', remedy: 'name them with --to' };

  it('returns no-choices without offering a pick on a terminal', async () => {
    const picker = fakePicker({ choose: (labels) => labels });

    await expect(pickChoices({ picker, message, choices: [], refusal })).resolves.toEqual({
      kind: 'no-choices',
    });
    expect(picker.offered).toEqual([]);
  });

  it('refuses with no choice labels when there is nothing to offer and no terminal', async () => {
    const picker = fakePicker({ choose: (labels) => labels, isInteractive: false });

    await expect(pickChoices({ picker, message, choices: [], refusal })).rejects.toMatchObject({
      name: 'MissingDestinationError',
      noun: 'repo',
      remedy: 'name them with --to',
      choiceLabels: [],
    });
    expect(picker.offered).toEqual([]);
  });

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
