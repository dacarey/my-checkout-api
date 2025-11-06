/**
 * Base error class for authentication service errors
 */
export class AuthenticationServiceError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'AuthenticationServiceError';

    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * Session not found or expired
 * Maps to HTTP 409 Conflict in API responses
 */
export class SessionNotFoundError extends AuthenticationServiceError {
  constructor(threeDSSessionId: string, cause?: Error) {
    super(
      `Authentication session not found or expired: ${threeDSSessionId}`,
      'SESSION_NOT_FOUND',
      409,
      cause
    );
    this.name = 'SessionNotFoundError';
  }
}

/**
 * Attempt to reuse a consumed session
 * Maps to HTTP 409 Conflict in API responses
 */
export class SessionAlreadyUsedError extends AuthenticationServiceError {
  constructor(threeDSSessionId: string) {
    super(
      `Authentication session already used: ${threeDSSessionId}`,
      'SESSION_ALREADY_USED',
      409
    );
    this.name = 'SessionAlreadyUsedError';
  }
}

/**
 * Session has expired (>30 minutes old)
 * Maps to HTTP 409 Conflict in API responses
 */
export class SessionExpiredError extends AuthenticationServiceError {
  constructor(threeDSSessionId: string, expiresAt: string) {
    super(
      `Authentication session expired at ${expiresAt}: ${threeDSSessionId}`,
      'SESSION_EXPIRED',
      409
    );
    this.name = 'SessionExpiredError';
  }
}

/**
 * Underlying storage service error
 * Maps to HTTP 500 Internal Server Error in API responses
 */
export class StorageServiceError extends AuthenticationServiceError {
  constructor(message: string, cause?: Error) {
    super(
      `Storage service error: ${message}`,
      'STORAGE_ERROR',
      500,
      cause
    );
    this.name = 'StorageServiceError';
  }
}
