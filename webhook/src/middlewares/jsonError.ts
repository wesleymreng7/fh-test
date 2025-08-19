import { Request, Response, NextFunction } from 'express';
export function jsonError(err: any, _req: Request, res: Response, _next: NextFunction) {
  const status = err.statusCode || 500;
  res.status(status).json({ error: err.message || 'Internal Error' });
}
