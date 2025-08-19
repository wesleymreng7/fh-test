import { Router } from 'express';
import { gpsSchema } from '../schemas/gps';
import { verifySignature } from '../middlewares/signature';
import { seenEvent } from '../libs/idempotency';
import { enqueue } from '../libs/sqs';

const router = Router();
router.post('/', async (req, res, next) => {
  try {
    //res.status(200).json(req.body);

    const data = req.body;
    const raw = Buffer.from(data).toString('utf8');
    const dataObj = JSON.parse(raw);
    const checkedData = gpsSchema.parse(dataObj);
    if (await seenEvent(checkedData.eventId)) return res.status(200).json({ ok: true, deduped: true });

    await enqueue('gps', req.body);
    res.status(202).json({ ok: true });
  } catch (e) { next(e); }
});
export default router;
