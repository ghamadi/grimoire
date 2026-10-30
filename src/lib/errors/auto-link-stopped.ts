import { GrimoireError } from '@/lib/errors/grimoire-error';

export type AutoLinkStoppedErrorProps = {
  reason: string;
};

export class AutoLinkStoppedError extends GrimoireError {
  readonly reason: string;

  constructor(props: AutoLinkStoppedErrorProps) {
    const { reason } = props;
    super(
      [
        `auto-link stopped: ${reason}`,
        '  added skills stay in the store; fix this and run skills add again to link them',
      ].join('\n'),
    );

    this.name = 'AutoLinkStoppedError';
    this.reason = reason;
  }
}
