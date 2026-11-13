import fs from 'fs';
import path from 'path';
import type {
  BookingAllocation,
  DashboardMetrics,
  EventDatabase,
  Invitee,
  InviteeCategory,
  LogisticsRecord,
  LogisticsStatus,
  ResponseChannel,
  ResponseLog,
  ResponseStatus,
} from '../src/types/event.ts';
import { INVITEE_CATEGORIES } from '../src/types/event.ts';
import { createEmptyDatabase } from './seedData.ts';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const STORE_PATH = path.join(DATA_DIR, 'event-db.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function loadDatabase(): EventDatabase {
  ensureDataDir();
  if (!fs.existsSync(STORE_PATH)) {
    const empty = createEmptyDatabase();
    saveDatabase(empty);
    return empty;
  }
  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf-8');
    return JSON.parse(raw) as EventDatabase;
  } catch {
    const empty = createEmptyDatabase();
    saveDatabase(empty);
    return empty;
  }
}

export function saveDatabase(db: EventDatabase): void {
  ensureDataDir();
  const tempPath = `${STORE_PATH}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(db, null, 2), 'utf-8');
  fs.renameSync(tempPath, STORE_PATH);
}

export function normalizeEmail(email: string): string {
  return (email || '').trim().toLowerCase();
}

export function normalizePhone(phone: string): string {
  return (phone || '').replace(/\D+/g, '').slice(-10);
}

export function normalizeName(name: string): string {
  return (name || '')
    .toLowerCase()
    .replace(/\b(dr|mr|mrs|ms|prof|hon|amb|shri|smt)\.?\s+/g, '')
    .replace(/[^a-z0-9]/g, '');
}

export function generateNextInviteeId(invitees: Invitee[]): string {
  let maxNum = 0;
  for (const inv of invitees) {
    const match = inv.inviteeId.match(/INV-\d{4}-(\d+)/i);
    if (match) {
      const n = parseInt(match[1], 10);
      if (n > maxNum) maxNum = n;
    }
  }
  const next = String(maxNum + 1).padStart(3, '0');
  return `INV-2026-${next}`;
}

export function recomputeDuplicateFlags(db: EventDatabase): void {
  const emailMap = new Map<string, string>();
  const phoneMap = new Map<string, string>();
  const nameOrgMap = new Map<string, string>();

  // Sort deterministically by inviteeId so earliest/canonical ID is primary
  const sorted = [...db.invitees].sort((a, b) => a.inviteeId.localeCompare(b.inviteeId));

  for (const inv of sorted) {
    inv.duplicateOfId = null;
    inv.duplicateReason = null;

    const normEmail = normalizeEmail(inv.email);
    const normPhone = normalizePhone(inv.phone);
    const normNameOrg = `${normalizeName(inv.name)}::${(inv.organisation || '').trim().toLowerCase()}`;

    if (normEmail && emailMap.has(normEmail)) {
      const primaryId = emailMap.get(normEmail)!;
      inv.duplicateOfId = primaryId;
      inv.duplicateReason = `Duplicate Email matching ${primaryId}`;
    } else if (normPhone && normPhone.length >= 7 && phoneMap.has(normPhone)) {
      const primaryId = phoneMap.get(normPhone)!;
      inv.duplicateOfId = primaryId;
      inv.duplicateReason = `Duplicate Phone matching ${primaryId}`;
    } else if (normNameOrg.length > 5 && nameOrgMap.has(normNameOrg)) {
      const primaryId = nameOrgMap.get(normNameOrg)!;
      inv.duplicateOfId = primaryId;
      inv.duplicateReason = `Matching Name & Organisation (${primaryId})`;
    } else {
      if (normEmail) emailMap.set(normEmail, inv.inviteeId);
      if (normPhone && normPhone.length >= 7) phoneMap.set(normPhone, inv.inviteeId);
      if (normNameOrg.length > 5) nameOrgMap.set(normNameOrg, inv.inviteeId);
    }
  }
}

export function computeLogisticsStatus(rec: Partial<LogisticsRecord>): LogisticsStatus {
  if (rec.travelMode === 'Local / No Travel' && !rec.accommodationRequired) {
    return 'Not Required';
  }
  const hasArrival = Boolean(rec.arrivalDate && rec.arrivalTime);
  const hasDeparture = Boolean(rec.departureDate);
  const hasMode = Boolean(rec.travelMode);
  const hasStay = !rec.accommodationRequired || Boolean(rec.hotelCheckIn && rec.hotelCheckOut);

  if (hasArrival && hasDeparture && hasMode && hasStay) {
    return 'Received';
  }
  if (
    hasArrival ||
    hasDeparture ||
    hasMode ||
    Boolean(rec.carrierDetails) ||
    Boolean(rec.hotelCheckIn) ||
    Boolean(rec.specialRequirements)
  ) {
    return 'Partially Received';
  }
  return 'Pending';
}

export function findInviteeMatch(
  db: EventDatabase,
  opts: { inviteeId?: string | null; email?: string | null; phone?: string | null; name?: string | null }
): Invitee | undefined {
  if (opts.inviteeId) {
    const cleanId = opts.inviteeId.trim().toUpperCase();
    const byId = db.invitees.find((i) => i.inviteeId.toUpperCase() === cleanId);
    if (byId) return byId;
  }
  if (opts.email) {
    const cleanEmail = normalizeEmail(opts.email);
    const byEmail = db.invitees.find((i) => normalizeEmail(i.email) === cleanEmail && !i.duplicateOfId);
    if (byEmail) return byEmail;
    const anyEmail = db.invitees.find((i) => normalizeEmail(i.email) === cleanEmail);
    if (anyEmail) return anyEmail;
  }
  if (opts.phone) {
    const cleanPhone = normalizePhone(opts.phone);
    if (cleanPhone.length >= 7) {
      const byPhone = db.invitees.find((i) => normalizePhone(i.phone) === cleanPhone);
      if (byPhone) return byPhone;
    }
  }
  if (opts.name) {
    const cleanName = normalizeName(opts.name);
    if (cleanName.length >= 4) {
      const byName = db.invitees.find((i) => normalizeName(i.name) === cleanName);
      if (byName) return byName;
    }
  }
  return undefined;
}

export function normalizeCategory(raw: string): InviteeCategory {
  const lower = (raw || '').trim().toLowerCase();
  const exact = INVITEE_CATEGORIES.find((c) => c.toLowerCase() === lower);
  if (exact) return exact;
  if (lower.includes('dignit') || lower.includes('minister') || lower.includes('ambassador')) return 'Dignitary';
  if (lower.includes('gov') || lower.includes('ministry') || lower.includes('official')) return 'Government Official';
  if (lower.includes('industry') || lower.includes('corp')) return 'Industry Representative';
  if (lower.includes('speak') || lower.includes('keynote')) return 'Speaker';
  if (lower.includes('panel')) return 'Panellist';
  if (lower.includes('exhibit') || lower.includes('booth')) return 'Exhibitor';
  if (lower.includes('sponsor') || lower.includes('partner')) return 'Sponsor';
  return 'Delegate';
}

export function applyResponseToInvitee(
  db: EventDatabase,
  invitee: Invitee,
  status: ResponseStatus,
  channel: ResponseChannel,
  timestamp: string
): void {
  const prevConfirmed = invitee.confirmedParticipation;
  invitee.rsvpStatus = status;
  invitee.confirmedParticipation = status === 'Confirmation Received';
  invitee.lastResponseAt = timestamp;
  invitee.lastResponseChannel = channel;
  invitee.responseCount = (invitee.responseCount || 0) + 1;
  invitee.updatedAt = new Date().toISOString();

  // If previously confirmed and now Regret Received, flag existing bookings for revision/cancellation
  if (prevConfirmed && status === 'Regret Received') {
    for (const bkg of db.bookings) {
      if (bkg.inviteeId === invitee.inviteeId && bkg.status !== 'Cancelled') {
        bkg.status = 'Revision Required';
        bkg.notes = `${bkg.notes ? bkg.notes + ' ' : ''}Invitee changed RSVP to Regret Received; cancel or reallocate.`;
        bkg.updatedAt = new Date().toISOString();
      }
    }
    const logi = db.logistics[invitee.inviteeId];
    if (logi) {
      logi.revisionFlag = true;
      logi.revisionNote = 'Participation status changed to Regret Received.';
    }
  }

  // Ensure a logistics placeholder record exists once confirmed
  if (status === 'Confirmation Received' && !db.logistics[invitee.inviteeId]) {
    db.logistics[invitee.inviteeId] = {
      inviteeId: invitee.inviteeId,
      logisticsStatus: 'Pending',
      arrivalDate: '',
      arrivalTime: '',
      departureDate: '',
      departureTime: '',
      travelMode: '',
      carrierDetails: '',
      accommodationRequired: false,
      hotelCheckIn: '',
      hotelCheckOut: '',
      roomTypePreference: '',
      airportPickupRequired: false,
      airportDropRequired: false,
      localTransportRequired: false,
      specialRequirements: '',
      sourceChannel: channel,
      lastUpdated: timestamp,
      revisionFlag: false,
      revisionNote: null,
    };
  }
}

export function upsertLogisticsForInvitee(
  db: EventDatabase,
  inviteeId: string,
  patch: Partial<LogisticsRecord>,
  channel: ResponseChannel | null
): LogisticsRecord {
  const existing = db.logistics[inviteeId];
  const now = new Date().toISOString();

  const merged: LogisticsRecord = {
    inviteeId,
    logisticsStatus: 'Pending',
    arrivalDate: patch.arrivalDate ?? existing?.arrivalDate ?? '',
    arrivalTime: patch.arrivalTime ?? existing?.arrivalTime ?? '',
    departureDate: patch.departureDate ?? existing?.departureDate ?? '',
    departureTime: patch.departureTime ?? existing?.departureTime ?? '',
    travelMode: patch.travelMode ?? existing?.travelMode ?? '',
    carrierDetails: patch.carrierDetails ?? existing?.carrierDetails ?? '',
    accommodationRequired: patch.accommodationRequired ?? existing?.accommodationRequired ?? false,
    hotelCheckIn: patch.hotelCheckIn ?? existing?.hotelCheckIn ?? '',
    hotelCheckOut: patch.hotelCheckOut ?? existing?.hotelCheckOut ?? '',
    roomTypePreference: patch.roomTypePreference ?? existing?.roomTypePreference ?? '',
    airportPickupRequired: patch.airportPickupRequired ?? existing?.airportPickupRequired ?? false,
    airportDropRequired: patch.airportDropRequired ?? existing?.airportDropRequired ?? false,
    localTransportRequired: patch.localTransportRequired ?? existing?.localTransportRequired ?? false,
    specialRequirements: patch.specialRequirements ?? existing?.specialRequirements ?? '',
    sourceChannel: channel ?? existing?.sourceChannel ?? 'Direct Entry',
    lastUpdated: now,
    revisionFlag: patch.revisionFlag ?? existing?.revisionFlag ?? false,
    revisionNote: patch.revisionNote ?? existing?.revisionNote ?? null,
  };

  // Detect schedule changes against already-confirmed bookings
  if (existing) {
    const scheduleChanged =
      (existing.arrivalDate && merged.arrivalDate !== existing.arrivalDate) ||
      (existing.arrivalTime && merged.arrivalTime !== existing.arrivalTime) ||
      (existing.departureDate && merged.departureDate !== existing.departureDate) ||
      (existing.hotelCheckIn && merged.hotelCheckIn !== existing.hotelCheckIn) ||
      (existing.hotelCheckOut && merged.hotelCheckOut !== existing.hotelCheckOut);

    if (scheduleChanged) {
      const confirmedBookings = db.bookings.filter(
        (b) => b.inviteeId === inviteeId && b.status === 'Confirmed'
      );
      if (confirmedBookings.length > 0) {
        merged.revisionFlag = true;
        merged.revisionNote = `Travel or stay schedule updated (${merged.arrivalDate || 'TBD'} – ${merged.departureDate || 'TBD'}); review ${confirmedBookings.length} confirmed booking(s).`;
        for (const bkg of confirmedBookings) {
          bkg.status = 'Revision Required';
          bkg.updatedAt = now;
        }
      }
    }
  }

  merged.logisticsStatus = computeLogisticsStatus(merged);
  db.logistics[inviteeId] = merged;
  return merged;
}

export function computeDashboardMetrics(db: EventDatabase): DashboardMetrics {
  const uniqueInvitees = db.invitees.filter((i) => !i.duplicateOfId);
  let invitationsIssued = 0;
  let confirmationsReceived = 0;
  let regretsReceived = 0;
  let awaitingResponse = 0;
  let noResponse = 0;
  let pendingVerification = 0;
  let confirmedParticipation = 0;
  let multiResponseCount = 0;

  for (const inv of uniqueInvitees) {
    if (inv.invitationSent) invitationsIssued++;
    if (inv.rsvpStatus === 'Confirmation Received') confirmationsReceived++;
    else if (inv.rsvpStatus === 'Regret Received') regretsReceived++;
    else if (inv.rsvpStatus === 'Awaiting Response') awaitingResponse++;
    else if (inv.rsvpStatus === 'No Response') noResponse++;
    else if (inv.rsvpStatus === 'Response Pending Verification') pendingVerification++;

    if (inv.confirmedParticipation) confirmedParticipation++;
    if (inv.responseCount > 1) multiResponseCount++;
  }

  let logisticsReceived = 0;
  let logisticsPartial = 0;
  let logisticsPending = 0;
  let logisticsNotRequired = 0;
  let hotelRequiredCount = 0;
  let transportRequiredCount = 0;
  let revisionRequiredCount = 0;

  for (const inv of uniqueInvitees) {
    if (!inv.confirmedParticipation) continue;
    const logi = db.logistics[inv.inviteeId];
    if (!logi) {
      logisticsPending++;
      continue;
    }
    if (logi.logisticsStatus === 'Received') logisticsReceived++;
    else if (logi.logisticsStatus === 'Partially Received') logisticsPartial++;
    else if (logi.logisticsStatus === 'Not Required') logisticsNotRequired++;
    else logisticsPending++;

    if (logi.accommodationRequired) hotelRequiredCount++;
    if (logi.airportPickupRequired || logi.airportDropRequired || logi.localTransportRequired) {
      transportRequiredCount++;
    }
    if (logi.revisionFlag) revisionRequiredCount++;
  }

  const hotelConfirmedInvitees = new Set(
    db.bookings
      .filter((b) => b.bookingType === 'Hotel Room' && b.status === 'Confirmed')
      .map((b) => b.inviteeId)
  );
  const transportConfirmedInvitees = new Set(
    db.bookings
      .filter((b) => b.bookingType !== 'Hotel Room' && b.bookingType !== 'Hospitality / Escort' && b.status === 'Confirmed')
      .map((b) => b.inviteeId)
  );

  const duplicateFlaggedCount = db.invitees.filter((i) => Boolean(i.duplicateOfId)).length;

  return {
    totalInvited: uniqueInvitees.length,
    invitationsIssued,
    confirmationsReceived,
    regretsReceived,
    awaitingResponse,
    noResponse,
    pendingVerification,
    confirmedParticipation,
    logisticsReceived,
    logisticsPartial,
    logisticsPending,
    logisticsNotRequired,
    hotelRequiredCount,
    hotelConfirmedCount: hotelConfirmedInvitees.size,
    transportRequiredCount,
    transportConfirmedCount: transportConfirmedInvitees.size,
    duplicateFlaggedCount,
    revisionRequiredCount:
      revisionRequiredCount + db.bookings.filter((b) => b.status === 'Revision Required').length,
    multiResponseCount,
  };
}
