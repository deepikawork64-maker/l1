import type { EventDatabase } from '../src/types/event.ts';

export function createEmptyDatabase(): EventDatabase {
  return {
    meta: {
      eventId: 'EVT-2026-001',
      eventName: 'Event Management Workspace',
      eventDates: '',
      venue: '',
      city: '',
      lastSyncedAt: null,
    },
    invitees: [],
    responseLogs: [],
    logistics: {},
    bookings: [],
  };
}
