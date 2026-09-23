export class ChannelError extends Error {
  constructor(public readonly code: string, public readonly status = 400) {
    super(code);
  }
}

export function channelError(error: unknown): ChannelError {
  return error instanceof ChannelError ? error : new ChannelError("channel_operation_failed", 400);
}
