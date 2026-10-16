export class AppError extends Error {
  /**
   * @param {string} code Machine-readable error code (e.g. BAD_REQUEST, NOT_FOUND)
   * @param {string} message Human-readable error message
   * @param {number} statusCode HTTP status code
   * @param {any} [details] Optional error details (e.g. validation errors)
   */
  constructor(code, message, statusCode = 400, details = undefined) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export const ErrorCodes = {
  BAD_REQUEST: 'BAD_REQUEST',
  BAD_JSON: 'BAD_JSON',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  TOO_MANY_REQUESTS: 'TOO_MANY_REQUESTS',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  INTERNAL_ERROR: 'INTERNAL_ERROR'
};

export function formatSuccess(data = {}, message = '') {
  return {
    success: true,
    data,
    message
  };
}

export function formatError(code, message, details = undefined) {
  const errPayload = { code, message };
  if (details !== undefined) {
    errPayload.details = details;
  }
  return {
    success: false,
    error: errPayload
  };
}
