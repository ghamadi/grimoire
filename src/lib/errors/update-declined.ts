import { GrimoireError } from '@/lib/errors/grimoire-error';

export type UpdateDeclinedErrorProps = {
  latestVersion: string;
  packageName: string;
};

export class UpdateDeclinedError extends GrimoireError {
  readonly latestVersion: string;
  readonly packageName: string;

  constructor(props: UpdateDeclinedErrorProps) {
    const { latestVersion, packageName } = props;
    super(
      [
        `grimoire ${latestVersion} is available, but this copy was not installed with \`npm install -g\``,
        '  update it with the package manager that installed it:',
        `    pnpm add -g ${packageName}@latest`,
        `    yarn global add ${packageName}@latest`,
        `    bun add -g ${packageName}@latest`,
      ].join('\n'),
    );

    this.name = 'UpdateDeclinedError';
    this.latestVersion = latestVersion;
    this.packageName = packageName;
  }
}
