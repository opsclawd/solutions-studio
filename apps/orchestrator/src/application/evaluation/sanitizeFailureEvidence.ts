import type { FixtureExecutionErrorDto } from '@solutions-studio/contracts';
import {
  AuthenticationOrConfigError,
  CliExecutionTimeoutError,
  ExecutableNotFoundError,
  MalformedOutputError,
  NonZeroExitError
} from '../ports/generation/GenerationErrors.js';
import { LineageValidationError } from './validateSourceLineage.js';

export const MAX_ERROR_MESSAGE_LENGTH = 500;

// Patterns to redact
const REDACTION_PATTERNS = [
  // Bearer tokens
  /Bearer\s+[A-Za-z0-9._~+/-]+=*/gi,
  // Key / Token assignments (e.g. token=xyz, api_key: "abc")
  /(?:api[_-]?key|secret|token|password|auth|credential)[\s:=]+["']?([A-Za-z0-9._~+/-]{8,})["']?/gi,
  // Common token prefixes
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g,
  /\bsk-[A-Za-z0-9]{20,}\b/g,
  // JWTs
  /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g
];

export function sanitizeErrorMessage(rawMessage: string): string {
  // 1. Strip ANSI escape codes
  // eslint-disable-next-line no-control-regex
  let cleaned = rawMessage.replace(/\u001b\[[0-9;]*[a-zA-Z]/g, '');

  // 2. Strip non-printable control characters (keep \n and \t)
  // eslint-disable-next-line no-control-regex
  cleaned = cleaned.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  // 3. Redact secret-like material
  for (const pattern of REDACTION_PATTERNS) {
    cleaned = cleaned.replace(pattern, (match) => {
      if (match.toLowerCase().startsWith('bearer')) {
        return 'Bearer [REDACTED]';
      }
      return match.replace(/([A-Za-z0-9._~+/-]{8,})/, '[REDACTED]');
    });
  }

  // 4. Bound length
  if (cleaned.length > MAX_ERROR_MESSAGE_LENGTH) {
    cleaned = cleaned.slice(0, MAX_ERROR_MESSAGE_LENGTH) + '... [TRUNCATED]';
  }

  return cleaned.trim();
}

export function sanitizeFailureEvidence(
  err: unknown,
  phase: 'capture' | 'compile' | 'scoring'
): FixtureExecutionErrorDto {
  if (err instanceof NonZeroExitError) {
    const sanitizedStderr = sanitizeErrorMessage(err.stderr);
    return {
      name: 'ProcessExecutionFailure',
      message: `CLI exited with non-zero code (${err.exitCode ?? 'null'}). Stderr: ${sanitizedStderr}`,
      phase
    };
  }

  if (err instanceof AuthenticationOrConfigError) {
    return {
      name: 'AuthenticationOrConfigFailure',
      message: sanitizeErrorMessage(err.message),
      phase
    };
  }

  if (err instanceof CliExecutionTimeoutError) {
    return {
      name: 'CliExecutionTimeout',
      message: sanitizeErrorMessage(err.message),
      phase
    };
  }

  if (err instanceof ExecutableNotFoundError) {
    return {
      name: 'ExecutableNotFound',
      message: sanitizeErrorMessage(err.message),
      phase
    };
  }

  if (err instanceof MalformedOutputError) {
    return {
      name: 'MalformedOutputFailure',
      message: sanitizeErrorMessage(err.message),
      phase
    };
  }

  if (err instanceof LineageValidationError) {
    return {
      name: 'LineageValidationError',
      message: sanitizeErrorMessage(err.message),
      phase
    };
  }

  const errorName = err instanceof Error ? err.name : 'UnknownError';
  const rawMessage = err instanceof Error ? err.message : String(err);

  return {
    name: errorName,
    message: sanitizeErrorMessage(rawMessage),
    phase
  };
}
