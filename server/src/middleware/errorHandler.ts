import { Request, Response, NextFunction } from 'express';

export const errorHandler = (
  err: any,
  _req: Request,
  res: Response,
  _next: NextFunction
): void => {
  console.error('Error:', err);

  // Supabase/PostgreSQL errors
  if (err.code) {
    if (err.code === 'PGRST116') {
      res.status(404).json({
        error: 'Not Found',
        detail: 'Resource not found',
      });
      return;
    }

    if (err.code === '23505') {
      res.status(409).json({
        error: 'Conflict',
        detail: 'Resource already exists',
      });
      return;
    }

    if (err.code === '23503') {
      res.status(400).json({
        error: 'Bad Request',
        detail: 'Referenced resource does not exist',
      });
      return;
    }
  }

  // Default error response
  const statusCode = err.statusCode || err.status || 500;
  const message = err.message || 'Internal Server Error';

  res.status(statusCode).json({
    error: statusCode >= 500 ? 'Internal Server Error' : 'Error',
    detail: message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};
