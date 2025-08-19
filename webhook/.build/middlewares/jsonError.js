export function jsonError(err, _req, res, _next) {
    const status = err.statusCode || 500;
    res.status(status).json({ error: err.message || 'Internal Error' });
}
