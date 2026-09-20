export class SensitiveDataSanitizer {
  private static readonly SENSITIVE_KEY_REGEX =
    /^(authorization|access_?token|id_?token|refresh_?token|token|password|secret|client_?secret|private_?key|credentials?|api_?key|email|mail|upn|phone|phoneNumber)$/i;

  private static readonly EVIDENCE_TEXT_KEY_REGEX =
    /^(rawText|markdownText|rawMarkdown|evidenceText|sourceText|sourceEvidence|documentText)$/i;

  private static readonly JWT_REGEX =
    /^[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}$/;

  private static readonly EMAIL_REGEX = /[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+/;

  static sanitizeActorId(actorId?: string): string | undefined {
    if (!actorId) return undefined;
    if (this.EMAIL_REGEX.test(actorId) || actorId.includes('@')) {
      return '[REDACTED_IDENTITY]';
    }
    if (this.JWT_REGEX.test(actorId)) {
      return '[REDACTED_TOKEN]';
    }
    if (/password|secret|token|credential/i.test(actorId)) {
      return '[REDACTED]';
    }
    return actorId;
  }

  static sanitizeString(input: string): string {
    let sanitized = input;
    // Redact bearer tokens
    sanitized = sanitized.replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]');
    // Redact query parameter secrets: ?token=..., &password=..., etc.
    sanitized = sanitized.replace(
      /([?&](?:token|code|password|secret|apiKey|client_secret)=)[^&\s]+/gi,
      '$1[REDACTED]'
    );
    // Redact raw JWTs
    sanitized = sanitized.replace(
      /\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g,
      '[REDACTED_TOKEN]'
    );
    // Redact passwords in connection strings or log strings: e.g. :password@ or password=...
    sanitized = sanitized.replace(/(:\/\/[^:]+:)[^@]+(@)/g, '$1[REDACTED]$2');
    // Redact email addresses
    sanitized = sanitized.replace(
      /[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+/g,
      '[REDACTED_IDENTITY]'
    );
    return sanitized;
  }

  static sanitizeError(error: unknown): Record<string, unknown> {
    if (!error) return { message: 'Unknown error' };
    if (typeof error !== 'object') {
      return { message: this.sanitizeString(String(error)) };
    }
    const err = error as Record<string, unknown>;
    const name = typeof err.name === 'string' ? err.name : 'Error';
    const message =
      typeof err.message === 'string' ? this.sanitizeString(err.message) : 'Unknown error';
    const stack = typeof err.stack === 'string' ? this.sanitizeString(err.stack) : undefined;
    const code = err.code;
    const status = err.status ?? err.statusCode;
    return {
      name,
      message,
      ...(code !== undefined ? { code } : {}),
      ...(status !== undefined ? { status } : {}),
      ...(stack !== undefined ? { stack } : {})
    };
  }

  static sanitizeValue(key: string, value: unknown, depth = 0): unknown {
    if (depth > 8) {
      return '[MAX_DEPTH]';
    }

    if (this.SENSITIVE_KEY_REGEX.test(key)) {
      return '[REDACTED]';
    }

    if (key === 'actorId' && typeof value === 'string') {
      return this.sanitizeActorId(value);
    }

    if (this.EVIDENCE_TEXT_KEY_REGEX.test(key)) {
      if (typeof value === 'string') {
        return {
          byteLength: Buffer.byteLength(value, 'utf8'),
          redacted: true
        };
      }
      return '[REDACTED_EVIDENCE]';
    }

    if (typeof value === 'string') {
      if (value.startsWith('Bearer ')) {
        return 'Bearer [REDACTED]';
      }
      if (this.JWT_REGEX.test(value)) {
        return '[REDACTED_TOKEN]';
      }
      return this.sanitizeString(value);
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.sanitizeValue(key, item, depth + 1));
    }

    if (value !== null && typeof value === 'object') {
      const sanitized: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        sanitized[k] = this.sanitizeValue(k, v, depth + 1);
      }
      return sanitized;
    }

    return value;
  }

  static sanitizeObject<T>(input: T): T {
    if (input === null || typeof input !== 'object') {
      return input;
    }
    return this.sanitizeValue('', input) as T;
  }

  static sanitizeActor(actor: {
    readonly id: string;
    readonly actorType: string;
    readonly capabilities?: Iterable<string> | readonly string[];
  }): { id: string; actorType: string; capabilities: string[] } {
    const caps = actor.capabilities
      ? Array.isArray(actor.capabilities)
        ? actor.capabilities
        : Array.from(actor.capabilities)
      : [];
    return {
      id: this.sanitizeActorId(actor.id) ?? 'anonymous',
      actorType: actor.actorType,
      capabilities: caps
    };
  }

  static sanitizeEvidence(params: {
    readonly sourceRevisionId?: string;
    readonly locator?: string;
    readonly contentHash?: string;
    readonly byteLength?: number;
  }): Record<string, unknown> {
    return {
      sourceRevisionId: params.sourceRevisionId,
      locator: params.locator,
      contentHash: params.contentHash,
      byteLength: params.byteLength ?? 0
    };
  }
}
