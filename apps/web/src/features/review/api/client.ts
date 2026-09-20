import type { ApiErrorDto, ApiErrorCode } from '@solutions-studio/contracts';
import { ApiErrorDtoSchema } from '@solutions-studio/contracts';
import { getOrchestratorBaseUrl } from './config';
import { getAuthToken } from '../../auth/tokenStore';

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly details?: unknown;
  readonly statusCode: number;

  constructor(params: {
    code: ApiErrorCode;
    message: string;
    details?: unknown;
    statusCode: number;
  }) {
    super(params.message);
    this.name = 'ApiError';
    this.code = params.code;
    this.details = params.details;
    this.statusCode = params.statusCode;
    Object.setPrototypeOf(this, ApiError.prototype);
  }
}

export async function apiClient<T>(
  path: string,
  options?: RequestInit & { baseUrl?: string }
): Promise<T> {
  const baseUrl = options?.baseUrl ?? getOrchestratorBaseUrl();
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const url = `${baseUrl.replace(/\/$/, '')}${normalizedPath}`;

  const headers = new Headers(options?.headers);
  if (options?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (!headers.has('Authorization')) {
    const token = getAuthToken();
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
  }

  let response: Response;
  try {
    response = await fetch(url, {
      ...options,
      headers
    });
  } catch (err) {
    throw new ApiError({
      code: 'INTERNAL_ERROR',
      message: err instanceof Error ? err.message : 'Network request failed',
      statusCode: 0
    });
  }

  if (!response.ok) {
    let errorDto: ApiErrorDto;
    try {
      const text = await response.text();
      const parsedJson = JSON.parse(text);
      const parsed = ApiErrorDtoSchema.safeParse(parsedJson);
      if (parsed.success) {
        errorDto = parsed.data;
      } else {
        errorDto = {
          code: (parsedJson?.code as ApiErrorCode) || 'INTERNAL_ERROR',
          message: parsedJson?.message || `HTTP ${response.status} ${response.statusText}`,
          details: parsedJson
        };
      }
    } catch {
      errorDto = {
        code: 'INTERNAL_ERROR',
        message: `HTTP ${response.status} ${response.statusText}`
      };
    }

    throw new ApiError({
      code: errorDto.code,
      message: errorDto.message,
      details: errorDto.details,
      statusCode: response.status
    });
  }

  if (response.status === 204) {
    return undefined as unknown as T;
  }

  return (await response.json()) as T;
}
