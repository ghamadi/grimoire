import { describe, expect, it } from 'vitest';
import { GrimoireError, MissingDestinationError } from '@/lib/errors';

const props = {
  noun: 'clone',
  remedy: 'name them after --drop',
  choiceLabels: ['personal', '/Users/me/My Projects/skills'],
};

describe('MissingDestinationError', () => {
  it('routes to the exit-1 branch as a GrimoireError', () => {
    const error = new MissingDestinationError(props);

    expect(error).toBeInstanceOf(GrimoireError);
    expect(error.name).toBe('MissingDestinationError');
  });

  it('names the flag to use and every choice, quoting labels the shell would split', () => {
    expect(new MissingDestinationError(props).message).toBe(
      [
        'no clone named, and no terminal to choose from',
        "  name them after --drop: personal '/Users/me/My Projects/skills'",
      ].join('\n'),
    );
  });

  it('carries the props it was constructed with', () => {
    const error = new MissingDestinationError(props);

    expect(error.noun).toBe('clone');
    expect(error.remedy).toBe('name them after --drop');
    expect(error.choiceLabels).toEqual(['personal', '/Users/me/My Projects/skills']);
  });
});
