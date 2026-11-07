
export interface ParsedDisconnectError {
  code: number | null;
  message: string | null;
}

export class DisconnectErrorParser {
  parse(error: unknown): ParsedDisconnectError {
    return {
      code: this.extractStatusCode(error),
      message: this.extractMessage(error),
    };
  }

  private extractStatusCode(
    error: unknown,
  ): number | null {
    if (
      !error ||
      typeof error !== 'object' ||
      !('output' in error)
    ) {
      return null;
    }

    const output = error.output;

    if (
      !output ||
      typeof output !== 'object' ||
      !('statusCode' in output)
    ) {
      return null;
    }

    const code = output.statusCode;

    return typeof code === 'number' &&
      Number.isFinite(code)
      ? code
      : null;
  }

  private extractMessage(
    error: unknown,
  ): string | null {
    if (
      !error ||
      typeof error !== 'object' ||
      !('message' in error)
    ) {
      return null;
    }

    return typeof error.message === 'string'
      ? error.message
      : null;
  }
}
