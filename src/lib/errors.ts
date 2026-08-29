/**
 * Error taxonomy. The HTTP status is a property of the error, not a decision
 * made at each route — 4xx means the caller did something we cannot fix by
 * retrying, 5xx means we did. n8n retries on 5xx and gives up on 4xx, so this
 * split has operational consequences.
 */

export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(message: string, status: number, code: string, details?: unknown) {
    super(message);
    this.name = new.target.name;
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Invalid request', details?: unknown) {
    super(message, 400, 'VALIDATION_ERROR', details);
  }
}

export class UnauthenticatedError extends AppError {
  constructor(message = 'Sign in required') {
    super(message, 401, 'UNAUTHENTICATED');
  }
}

/**
 * Deliberately a 403 with no detail about what exists. Returning 404 to hide
 * existence sounds safer but makes real bugs indistinguishable from denials;
 * returning the record's name in the message leaks across projects.
 */
export class ForbiddenError extends AppError {
  constructor(message = 'You do not have access to this project') {
    super(message, 403, 'FORBIDDEN');
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not found') {
    super(message, 404, 'NOT_FOUND');
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Conflict', details?: unknown) {
    super(message, 409, 'CONFLICT', details);
  }
}

export class RateLimitError extends AppError {
  constructor(message = 'Too many attempts. Try again shortly.') {
    super(message, 429, 'RATE_LIMITED');
  }
}

export class IntegrationError extends AppError {
  constructor(message = 'External integration failed', details?: unknown) {
    super(message, 502, 'INTEGRATION_ERROR', details);
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
