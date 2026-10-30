import { describe, expect, it } from 'vitest';
import { AutoLinkStoppedError, GrimoireError } from '@/lib/errors';

describe('AutoLinkStoppedError', () => {
  it('names the reason and says what happens to the added skills', () => {
    const error = new AutoLinkStoppedError({ reason: '/Users/me/refs cannot be read' });

    expect(error).toBeInstanceOf(GrimoireError);
    expect(error.name).toBe('AutoLinkStoppedError');
    expect(error.reason).toBe('/Users/me/refs cannot be read');
    expect(error.message).toBe(
      [
        'auto-link stopped: /Users/me/refs cannot be read',
        '  added skills stay in the store; fix this and run skills add again to link them',
      ].join('\n'),
    );
  });
});
