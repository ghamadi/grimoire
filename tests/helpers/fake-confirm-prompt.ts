import type { ConfirmPrompt } from '@/lib/confirm-prompt';

export function fakeConfirmPrompt(params: {
  answer: boolean;
  onPrompt?: () => void;
}): ConfirmPrompt & { messages: string[] } {
  const { answer, onPrompt } = params;
  const messages: string[] = [];

  const prompt: ConfirmPrompt = ({ message }) => {
    messages.push(message);
    onPrompt?.();

    return Promise.resolve(answer);
  };

  return Object.assign(prompt, { messages });
}
