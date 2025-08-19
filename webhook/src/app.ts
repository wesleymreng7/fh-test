import express from 'express';
import serverless from 'serverless-http';
import { jsonError } from './middlewares/jsonError';
import gpsRouter from './routes/gps';

const app = express();
app.use(express.json({ type: ['application/json', 'application/*+json'], limit: '1mb' }));
app.get('/health', (_req, res) => res.json({ ok: true }));

app.use('/webhooks/gps', gpsRouter);

app.get("/", (_req, res) => {
  res.json({ ok: true, service: "serverless-express-ts-localstack" });
});

app.use(jsonError);

export const handler = serverless(app);
