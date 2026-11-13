export type InviteeCategory =
  | 'Dignitary'
  | 'Government Official'
  | 'Industry Representative'
  | 'Speaker'
  | 'Panellist'
  | 'Exhibitor'
  | 'Sponsor'
  | 'Delegate';

export const INVITEE_CATEGORIES: InviteeCategory[] = [
  'Dignitary',
  'Government Official',
  'Industry Representative',
  'Speaker',
  'Panellist',
  'Exhibitor',
  'Sponsor',
  'Delegate',
];

export type ResponseStatus =
  | 'Confirmation Received'
  | 'Regret Received'
  | 'Awaiting Response'
  | 'No Response'
  | 'Response Pending Verification';

export const RESPONSE_STATUSES: ResponseStatus[] = [
  'Confirmation Received',
  'Regret Received',
  'Awaiting Response',
  'No Response',
  'Response Pending Verification',
];

export type LogisticsStatus =
  | 'Received'
  | 'Partially Received'
  | 'Pending'
  | 'Not Required';

export type ResponseChannel =
  | 'Email'
  | 'Google Form'
  | 'Google Sheet'
  | 'Excel Import'
  | 'Direct Entry'
  | 'Invitee Portal';

export type VipTier = 'VVIP' | 'VIP' | 'Standard';

export interface Invitee {
  inviteeId: string;
  name: string;
  designation: string;
  organisation: string;
  category: InviteeCategory;
  email: string;
  phone: string;
  city: string;
  vipTier: VipTier;
  invitationSent: boolean;
  invitationSentDate: string | null;
  rsvpStatus: ResponseStatus;
  confirmedParticipation: boolean;
  lastResponseAt: string | null;
  lastResponseChannel: ResponseChannel | null;
  responseCount: number;
  duplicateOfId: string | null;
  duplicateReason: string | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface ResponseLog {
  id: string;
  inviteeId: string | null;
  senderName: string;
  senderEmail: string;
  channel: ResponseChannel;
  subject: string;
  rawContent: string;
  detectedStatus: ResponseStatus;
  confidence: number;
  aiRationale: string;
  extractedLogisticsSummary: string | null;
  verificationState: 'Auto-Applied' | 'Needs Verification' | 'Verified' | 'Dismissed';
  externalMessageId: string | null;
  receivedAt: string;
}

export type TravelMode = 'Flight' | 'Train' | 'Road / Self' | 'Local / No Travel' | '';

export interface LogisticsRecord {
  inviteeId: string;
  logisticsStatus: LogisticsStatus;
  arrivalDate: string;
  arrivalTime: string;
  departureDate: string;
  departureTime: string;
  travelMode: TravelMode;
  carrierDetails: string;
  accommodationRequired: boolean;
  hotelCheckIn: string;
  hotelCheckOut: string;
  roomTypePreference: string;
  airportPickupRequired: boolean;
  airportDropRequired: boolean;
  localTransportRequired: boolean;
  specialRequirements: string;
  sourceChannel: ResponseChannel | null;
  lastUpdated: string;
  revisionFlag: boolean;
  revisionNote: string | null;
}

export type BookingType =
  | 'Hotel Room'
  | 'Airport/Station Pickup'
  | 'Airport/Station Drop'
  | 'Local Vehicle'
  | 'Hospitality / Escort';

export type BookingStatus =
  | 'Pending'
  | 'Requested'
  | 'Confirmed'
  | 'Revision Required'
  | 'Cancelled';

export interface BookingAllocation {
  id: string;
  inviteeId: string;
  bookingType: BookingType;
  vendorOrProperty: string;
  confirmationRef: string;
  checkInOrDate: string;
  checkOutOrTime: string;
  vehicleOrRoomDetails: string;
  driverOrContact: string;
  status: BookingStatus;
  notes: string;
  updatedAt: string;
}

export interface EventMeta {
  eventId: string;
  eventName: string;
  eventDates: string;
  venue: string;
  city: string;
  lastSyncedAt: string | null;
}

export interface EventDatabase {
  meta: EventMeta;
  invitees: Invitee[];
  responseLogs: ResponseLog[];
  logistics: Record<string, LogisticsRecord>;
  bookings: BookingAllocation[];
}

export interface DashboardMetrics {
  totalInvited: number;
  invitationsIssued: number;
  confirmationsReceived: number;
  regretsReceived: number;
  awaitingResponse: number;
  noResponse: number;
  pendingVerification: number;
  confirmedParticipation: number;
  logisticsReceived: number;
  logisticsPartial: number;
  logisticsPending: number;
  logisticsNotRequired: number;
  hotelRequiredCount: number;
  hotelConfirmedCount: number;
  transportRequiredCount: number;
  transportConfirmedCount: number;
  duplicateFlaggedCount: number;
  revisionRequiredCount: number;
  multiResponseCount: number;
}
