import { confirm } from '@clack/prompts';

export type ConfirmPrompt = (params: { message: string }) => Promise<boolean>;

export const clackConfirmPrompt: ConfirmPrompt = async ({ message }) => {
  const answer = await confirm({ message, initialValue: false });

  return answer === true;
};
