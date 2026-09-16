export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function isOfflineError(error: unknown): boolean {
  if (error instanceof TypeError) {
    return true;
  }
  if (error instanceof ApiError && error.status === 0) {
    return true;
  }
  return false;
}
