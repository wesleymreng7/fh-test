import crypto from 'crypto';
export function verifySignature(headerName, secretEnv) {
    return (req, res, next) => {
        const sig = req.header(headerName);
        if (!sig)
            return res.status(401).json({ error: 'Missing signature' });
        const secret = process.env[secretEnv];
        const body = JSON.stringify(req.body ?? {});
        const digest = crypto.createHmac('sha256', secret).update(body).digest('hex');
        if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(digest))) {
            return res.status(401).json({ error: 'Invalid signature' });
        }
        next();
    };
}
