export class AppError extends Error {
  constructor(message, statusCode = 500, code = 'APP_ERROR', details) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export class ValidationError extends AppError {
  constructor(message, details) {
    super(message, 400, 'VALIDATION_ERROR', details);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not found') {
    super(message, 404, 'NOT_FOUND');
    this.name = 'NotFoundError';
  }
}

export class UpstreamError extends AppError {
  constructor(message, details) {
    super(message, 502, 'UPSTREAM_ERROR', details);
    this.name = 'UpstreamError';
  }
}

export function errorHandler(logger) {
  return (err, req, res, _next) => {
    const status = err.statusCode || 500;
    const payload = {
      error: {
        code: err.code || 'INTERNAL_ERROR',
        message: status >= 500 ? 'Internal server error' : err.message,
      },
    };
    if (err.details) payload.error.details = err.details;
    logger.error({ err, path: req.path, status }, err.message);
    res.status(status).json(payload);
  };
}
