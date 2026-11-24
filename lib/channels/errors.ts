export class ChannelError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

export function channelError(error: unknown): ChannelError {
  return error instanceof ChannelError ? error : new ChannelError("channel_operation_failed", 400);
}
