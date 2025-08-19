export type LatLng = { lat: number; lng: number };

export type Stop = {
  id: string;
  sequence: number;
  type: 'PICKUP' | 'DELIVERY';
  name?: string;
  location: LatLng;
  radiusM?: number;
  windowStart?: string;
  windowEnd?: string;
};

export type Route = {
  id: string;
  driverId: string;
  shipmentId: string;
  status: 'PLANNED' | 'EN_ROUTE' | 'COMPLETED' | 'CANCELLED';
  stops: Stop[];
  updatedAt?: string;
};

export type Driver = {
  id: string;
  name: string;
};

export type GpsPing = {
  eventId: string;
  driverId: string;
  lat: number;
  lng: number;
  speedKph?: number;
  heading?: number;
  timestamp?: string;
};
