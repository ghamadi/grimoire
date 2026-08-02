export function isErrnoException(
  error: unknown,
  code: 'ENOENT' | 'ENOTDIR',
): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === code;
}

export function isEnoentException(error: unknown): error is NodeJS.ErrnoException {
  return isErrnoException(error, 'ENOENT');
}
