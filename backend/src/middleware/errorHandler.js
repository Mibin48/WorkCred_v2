import { formatError, ErrorCodes, AppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export function notFoundHandler(req, res) {
  res.status(404).json(formatError(ErrorCodes.NOT_FOUND, `Route not found: ${req.method} ${req.originalUrl || req.url}`));
}

export function errorHandler(err, req, res, next) {
  // Handle syntax error from malformed JSON body
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json(formatError(ErrorCodes.BAD_JSON, 'Invalid JSON payload received'));
  }

  // Handle known AppError
  if (err instanceof AppError) {
    return res.status(err.statusCode).json(formatError(err.code, err.message, err.details));
  }

  // Log unhandled errors safely without stack traces leaking to client
  logger.error({
    err: err.message,
    path: req.originalUrl || req.url,
    method: req.method
  }, 'Unhandled application error');

  return res.status(500).json(formatError(ErrorCodes.INTERNAL_ERROR, 'An internal server error occurred'));
}
