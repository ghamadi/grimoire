import { confirm } from '@clack/prompts';
import { describe, expect, it, vi } from 'vitest';
import { clackConfirmPrompt } from '@/lib/confirm-prompt';

vi.mock('@clack/prompts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@clack/prompts')>();

  return { ...actual, confirm: vi.fn() };
});

describe('clackConfirmPrompt', () => {
  it('asks with No selected', async () => {
    vi.mocked(confirm).mockResolvedValueOnce(false);

    await clackConfirmPrompt({ message: 'Replace?' });

    expect(confirm).toHaveBeenCalledWith({ message: 'Replace?', initialValue: false });
  });

  it.each([
    { label: 'yes', answer: true, expected: true },
    { label: 'no', answer: false, expected: false },
    { label: 'a cancel', answer: Symbol('clack:cancel'), expected: false },
  ])('returns $expected for $label', async ({ answer, expected }) => {
    vi.mocked(confirm).mockResolvedValueOnce(answer as boolean);

    await expect(clackConfirmPrompt({ message: 'Replace?' })).resolves.toBe(expected);
  });
});
