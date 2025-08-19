import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';

export function verifySignature(headerName: string, secretEnv: 'HMAC_SECRET_GPS' | 'HMAC_SECRET_TMS') {
  return (req: Request, res: Response, next: NextFunction) => {
    const sig = req.header(headerName);
    if (!sig) return res.status(401).json({ error: 'Missing signature' });

    const secret = process.env[secretEnv]!;
    const body = JSON.stringify(req.body ?? {});
    const digest = crypto.createHmac('sha256', secret).update(body).digest('hex');

    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(digest))) {
      return res.status(401).json({ error: 'Invalid signature' });
    }
    next();
  };
}
