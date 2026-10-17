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

  // Handle known AppError or error with statusCode
  if (err instanceof AppError) {
    const extra = err.extra || (err.attemptsLeft !== undefined ? { attemptsLeft: err.attemptsLeft } : undefined);
    return res.status(err.statusCode).json(formatError(err.code, err.message, err.details, extra));
  }
  if (err && typeof err.statusCode === 'number') {
    const extra = {};
    if (err.attemptsLeft !== undefined) extra.attemptsLeft = err.attemptsLeft;
    if (err.minutesLeft !== undefined) extra.minutesLeft = err.minutesLeft;
    if (err.earliestAt !== undefined) extra.earliestAt = err.earliestAt;
    const extraPayload = Object.keys(extra).length > 0 ? extra : undefined;
    return res.status(err.statusCode).json(formatError(err.code || 'BAD_REQUEST', err.message, err.details, extraPayload));
  }

  // Log unhandled errors safely without stack traces leaking to client
  logger.error({
    err: err.message,
    stack: err.stack,
    path: req.originalUrl || req.url,
    method: req.method
  }, 'Unhandled application error');

  return res.status(500).json(formatError(ErrorCodes.INTERNAL_ERROR, 'An internal server error occurred'));
}
