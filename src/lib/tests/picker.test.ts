import { afterEach, describe, expect, it } from 'vitest';
import { clackPicker } from '@/lib/picker';

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
