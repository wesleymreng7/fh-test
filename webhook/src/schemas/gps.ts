// gps.ts
import { z } from 'zod';
export const gpsSchema = z.object({
  eventId: z.string().min(8),
  driverId: z.string(),
  timestamp: z.iso.datetime(),
  lat: z.number().gte(-90).lte(90),
  lng: z.number().gte(-180).lte(180),
  speedKph: z.number().nonnegative().optional(),
});
export type GpsPayload = z.infer<typeof gpsSchema>;
