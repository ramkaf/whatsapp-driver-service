export class RabbitMQError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'RabbitMQError';
  }
}
export class RpcRemoteError extends RabbitMQError {
  constructor(message = 'Remote handler failed') {
    super('RPC_REMOTE_ERROR', message);
  }
}
/** Only this error's message is safe to return to an RPC caller. */
export class RpcPublicError extends Error {}
