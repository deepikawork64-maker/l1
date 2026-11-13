import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { DashboardMetrics, EventDatabase } from '../types/event';
import { INVITEE_CATEGORIES } from '../types/event';

export type ReportId =
  | 'invitation-summary'
  | 'category-confirmation'
  | 'regret-nonresponse'
  | 'logistics-status'
  | 'hotel-accommodation'
  | 'arrival-departure'
  | 'transport-allocation'
  | 'booking-pending'
  | 'final-execution';

export interface ReportDefinition {
  id: ReportId;
  title: string;
  subtitle: string;
  columns: string[];
  rows: Array<Array<string | number>>;
}

export function buildAllReports(
  db: EventDatabase,
  metrics: DashboardMetrics
): ReportDefinition[] {
  const uniqueInvitees = db.invitees.filter((i) => !i.duplicateOfId);
  const byId = new Map(uniqueInvitees.map((i) => [i.inviteeId, i]));

  // 1. Invitation & Response Summary
  const invitationSummary: ReportDefinition = {
    id: 'invitation-summary',
    title: '01. Invitation & Response Summary',
    subtitle: 'Executive headcount & response status overview across unique Invitee IDs',
    columns: ['Metric', 'Count', 'Share / Benchmark'],
    rows: [
      ['Total Unique Invitees in Master DB', metrics.totalInvited, '100%'],
      [
        'Invitations Issued',
        metrics.invitationsIssued,
        metrics.totalInvited ? `${Math.round((metrics.invitationsIssued / metrics.totalInvited) * 100)}%` : '0%',
      ],
      [
        'Confirmations Received',
        metrics.confirmationsReceived,
        metrics.totalInvited ? `${Math.round((metrics.confirmationsReceived / metrics.totalInvited) * 100)}%` : '0%',
      ],
      ['Regrets Received', metrics.regretsReceived, 'Declined'],
      ['Awaiting Response', metrics.awaitingResponse, 'Follow-up Active'],
      ['No Response (Overdue)', metrics.noResponse, 'Escalation Needed'],
      ['Response Pending Verification', metrics.pendingVerification, 'Manual Review'],
      ['Logistics Details Received (Confirmed)', metrics.logisticsReceived, 'Ready for Allocation'],
      ['Logistics Partially Received', metrics.logisticsPartial, 'Incomplete'],
      ['Logistics Pending (Confirmed)', metrics.logisticsPending, 'Action Required'],
      ['Hotel Bookings Confirmed / Required', `${metrics.hotelConfirmedCount} / ${metrics.hotelRequiredCount}`, 'Accommodation'],
      ['Transport Confirmed / Required', `${metrics.transportConfirmedCount} / ${metrics.transportRequiredCount}`, 'Transfers & Fleet'],
      ['Duplicate Entries Flagged', metrics.duplicateFlaggedCount, 'Master Hygiene'],
      ['Multi-Submission Consolidated Records', metrics.multiResponseCount, 'Deduplicated by ID'],
    ],
  };

  // 2. Category-wise Confirmation Report
  const categoryRows = INVITEE_CATEGORIES.map((cat) => {
    const group = uniqueInvitees.filter((i) => i.category === cat);
    const confirmed = group.filter((i) => i.rsvpStatus === 'Confirmation Received').length;
    const regret = group.filter((i) => i.rsvpStatus === 'Regret Received').length;
    const pending = group.filter(
      (i) =>
        i.rsvpStatus === 'Awaiting Response' ||
        i.rsvpStatus === 'No Response' ||
        i.rsvpStatus === 'Response Pending Verification'
    ).length;
    const logiReady = group.filter(
      (i) =>
        i.confirmedParticipation &&
        (db.logistics[i.inviteeId]?.logisticsStatus === 'Received' ||
          db.logistics[i.inviteeId]?.logisticsStatus === 'Not Required')
    ).length;
    return [
      cat,
      group.length,
      confirmed,
      regret,
      pending,
      logiReady,
      group.length ? `${Math.round((confirmed / group.length) * 100)}%` : '0%',
    ];
  });

  const categoryConfirmation: ReportDefinition = {
    id: 'category-confirmation',
    title: '02. Category-wise Confirmation Report',
    subtitle: 'Participation and logistics readiness grouped by invitee profile category',
    columns: ['Category', 'Invited', 'Confirmed', 'Regret', 'Pending / Verify', 'Logistics Ready', 'Confirm Rate'],
    rows: categoryRows,
  };

  // 3. Regret & Non-Response Report
  const regretNonRespRows = uniqueInvitees
    .filter(
      (i) =>
        i.rsvpStatus === 'Regret Received' ||
        i.rsvpStatus === 'No Response' ||
        i.rsvpStatus === 'Awaiting Response'
    )
    .map((i) => [
      i.inviteeId,
      i.name,
      i.category,
      i.organisation,
      i.email,
      i.phone,
      i.rsvpStatus,
      i.invitationSentDate || '-',
      i.notes || '-',
    ]);

  const regretNonResponse: ReportDefinition = {
    id: 'regret-nonresponse',
    title: '03. Regret & Non-Response Report',
    subtitle: 'Invitees who declined or have not yet responded for targeted follow-up',
    columns: ['Invitee ID', 'Name', 'Category', 'Organisation', 'Email', 'Phone', 'RSVP Status', 'Sent Date', 'Notes'],
    rows: regretNonRespRows,
  };

  // 4. Logistics Information Received / Pending Report
  const logisticsStatusRows = uniqueInvitees
    .filter((i) => i.confirmedParticipation)
    .map((i) => {
      const l = db.logistics[i.inviteeId];
      return [
        i.inviteeId,
        i.name,
        i.category,
        i.vipTier,
        l?.logisticsStatus || 'Pending',
        l?.travelMode || '-',
        l?.arrivalDate || '-',
        l?.departureDate || '-',
        l?.accommodationRequired ? 'Yes' : 'No',
        l?.airportPickupRequired || l?.airportDropRequired ? 'Yes' : 'No',
        l?.revisionFlag ? 'REVISION FLAGGED' : 'Clear',
      ];
    });

  const logisticsStatusReport: ReportDefinition = {
    id: 'logistics-status',
    title: '04. Logistics Information Received / Pending Report',
    subtitle: 'Confirmed participants tracked independently for travel & stay completeness',
    columns: [
      'Invitee ID',
      'Name',
      'Category',
      'Tier',
      'Logistics Status',
      'Mode',
      'Arrival',
      'Departure',
      'Hotel Req',
      'Transfer Req',
      'Revision State',
    ],
    rows: logisticsStatusRows,
  };

  // 5. Hotel Accommodation Requirement Report
  const hotelRows = uniqueInvitees
    .filter((i) => i.confirmedParticipation && db.logistics[i.inviteeId]?.accommodationRequired)
    .map((i) => {
      const l = db.logistics[i.inviteeId];
      const bkg = db.bookings.find(
        (b) => b.inviteeId === i.inviteeId && b.bookingType === 'Hotel Room' && b.status !== 'Cancelled'
      );
      return [
        i.inviteeId,
        i.name,
        i.vipTier,
        i.organisation,
        l?.hotelCheckIn || l?.arrivalDate || 'TBD',
        l?.hotelCheckOut || l?.departureDate || 'TBD',
        l?.roomTypePreference || 'Standard',
        bkg?.vendorOrProperty || 'Unassigned',
        bkg?.confirmationRef || '-',
        bkg?.status || 'Pending',
      ];
    });

  const hotelAccommodation: ReportDefinition = {
    id: 'hotel-accommodation',
    title: '05. Hotel Accommodation Requirement Report',
    subtitle: 'Room inventory, check-in/check-out windows, and property confirmation references',
    columns: [
      'Invitee ID',
      'Guest Name',
      'Tier',
      'Organisation',
      'Check-In',
      'Check-Out',
      'Room Pref',
      'Hotel Property',
      'Conf. Ref',
      'Booking Status',
    ],
    rows: hotelRows,
  };

  // 6. Arrival & Departure Schedule
  const arrivalRows = uniqueInvitees
    .filter((i) => i.confirmedParticipation && db.logistics[i.inviteeId]?.arrivalDate)
    .sort((a, b) =>
      `${db.logistics[a.inviteeId]?.arrivalDate} ${db.logistics[a.inviteeId]?.arrivalTime}`.localeCompare(
        `${db.logistics[b.inviteeId]?.arrivalDate} ${db.logistics[b.inviteeId]?.arrivalTime}`
      )
    )
    .map((i) => {
      const l = db.logistics[i.inviteeId];
      return [
        l.arrivalDate,
        l.arrivalTime || 'TBD',
        i.inviteeId,
        i.name,
        i.vipTier,
        l.travelMode || '-',
        l.carrierDetails || '-',
        l.airportPickupRequired ? 'Yes' : 'No',
        l.departureDate || 'TBD',
        l.departureTime || 'TBD',
      ];
    });

  const arrivalDeparture: ReportDefinition = {
    id: 'arrival-departure',
    title: '06. Arrival & Departure Schedule',
    subtitle: 'Chronological flight, train, and transfer manifest for airport/station protocol teams',
    columns: [
      'Arrival Date',
      'Arr Time',
      'Invitee ID',
      'Guest Name',
      'Tier',
      'Mode',
      'Flight / Train Details',
      'Pickup Req',
      'Departure Date',
      'Dep Time',
    ],
    rows: arrivalRows,
  };

  // 7. Transportation & Vehicle Allocation Report
  const transportRows = db.bookings
    .filter((b) => b.bookingType !== 'Hotel Room')
    .map((b) => {
      const inv = byId.get(b.inviteeId);
      return [
        b.id,
        b.inviteeId,
        inv?.name || b.inviteeId,
        inv?.vipTier || '-',
        b.bookingType,
        b.checkInOrDate || '-',
        b.checkOutOrTime || '-',
        b.vendorOrProperty,
        b.vehicleOrRoomDetails,
        b.driverOrContact,
        b.status,
      ];
    });

  const transportAllocation: ReportDefinition = {
    id: 'transport-allocation',
    title: '07. Transportation & Vehicle Allocation Report',
    subtitle: 'Assigned fleet vehicles, drivers, vendors, and transfer dispatch status',
    columns: [
      'Booking ID',
      'Invitee ID',
      'Guest Name',
      'Tier',
      'Transfer Type',
      'Date',
      'Time',
      'Fleet Vendor',
      'Vehicle Details',
      'Driver / Contact',
      'Status',
    ],
    rows: transportRows,
  };

  // 8. Booking Status & Pending Logistics Report
  const pendingBookingRows = db.bookings
    .filter((b) => b.status === 'Pending' || b.status === 'Requested' || b.status === 'Revision Required')
    .map((b) => {
      const inv = byId.get(b.inviteeId);
      return [
        b.id,
        b.inviteeId,
        inv?.name || b.inviteeId,
        b.bookingType,
        b.status,
        b.checkInOrDate || '-',
        b.vendorOrProperty,
        b.notes || '-',
      ];
    });

  const bookingPending: ReportDefinition = {
    id: 'booking-pending',
    title: '08. Booking Status & Pending Logistics Report',
    subtitle: 'All unconfirmed, requested, and schedule-revision-flagged bookings requiring action',
    columns: ['Booking ID', 'Invitee ID', 'Guest Name', 'Type', 'Status', 'Date', 'Vendor / Property', 'Action Note'],
    rows: pendingBookingRows,
  };

  // 9. Final Confirmed Attendee List & Execution Sheet
  const executionRows = uniqueInvitees
    .filter((i) => i.confirmedParticipation)
    .map((i) => {
      const l = db.logistics[i.inviteeId];
      const hotel = db.bookings.find(
        (b) => b.inviteeId === i.inviteeId && b.bookingType === 'Hotel Room' && b.status !== 'Cancelled'
      );
      const pickup = db.bookings.find(
        (b) =>
          b.inviteeId === i.inviteeId &&
          b.bookingType === 'Airport/Station Pickup' &&
          b.status !== 'Cancelled'
      );
      return [
        i.inviteeId,
        i.name,
        i.designation,
        i.organisation,
        i.category,
        i.vipTier,
        i.phone,
        l?.logisticsStatus || 'Pending',
        l?.carrierDetails || '-',
        hotel ? `${hotel.vendorOrProperty} (${hotel.status})` : l?.accommodationRequired ? 'Pending' : 'N/A',
        pickup ? `${pickup.vehicleOrRoomDetails} (${pickup.status})` : l?.airportPickupRequired ? 'Pending' : 'N/A',
        l?.specialRequirements || '-',
      ];
    });

  const finalExecution: ReportDefinition = {
    id: 'final-execution',
    title: '09. Final Confirmed Attendee & Event Execution Sheet',
    subtitle: 'Unified single-source-of-truth operational runbook keyed by Invitee ID',
    columns: [
      'Invitee ID',
      'Name',
      'Designation',
      'Organisation',
      'Category',
      'Tier',
      'Phone',
      'Logistics',
      'Travel',
      'Hotel Allocation',
      'Pickup Allocation',
      'Special Requirements',
    ],
    rows: executionRows,
  };

  return [
    invitationSummary,
    categoryConfirmation,
    regretNonResponse,
    logisticsStatusReport,
    hotelAccommodation,
    arrivalDeparture,
    transportAllocation,
    bookingPending,
    finalExecution,
  ];
}

export function exportReportToExcel(report: ReportDefinition, eventName: string) {
  const wb = XLSX.utils.book_new();
  const wsData = [
    [eventName],
    [report.title],
    [report.subtitle],
    [`Generated: ${new Date().toLocaleString()}`],
    [],
    report.columns,
    ...report.rows,
  ];
  const ws = XLSX.utils.aoa_to_sheet(wsData);
  XLSX.utils.book_append_sheet(wb, ws, report.id.slice(0, 31));
  XLSX.writeFile(wb, `${report.id}-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

export function exportMasterWorkbookToExcel(
  reports: ReportDefinition[],
  eventName: string
) {
  const wb = XLSX.utils.book_new();
  for (const r of reports) {
    const wsData = [[eventName], [r.title], [`Generated: ${new Date().toLocaleString()}`], [], r.columns, ...r.rows];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    XLSX.utils.book_append_sheet(wb, ws, r.id.slice(0, 31));
  }
  XLSX.writeFile(wb, `Master-Event-Report-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

export function exportReportToPdf(report: ReportDefinition, eventName: string) {
  const doc = new jsPDF({ orientation: report.columns.length > 7 ? 'landscape' : 'portrait' });
  doc.setFontSize(11);
  doc.setTextColor(71, 85, 105);
  doc.text(eventName, 14, 15);

  doc.setFontSize(15);
  doc.setTextColor(15, 23, 42);
  doc.text(report.title, 14, 23);

  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  doc.text(`${report.subtitle} · Generated ${new Date().toLocaleString()}`, 14, 29);

  autoTable(doc, {
    startY: 34,
    head: [report.columns],
    body: report.rows.map((r) => r.map((cell) => String(cell))),
    styles: { fontSize: 7.5, cellPadding: 2.5, textColor: [30, 41, 59] },
    headStyles: { fillColor: [30, 58, 138], textColor: [255, 255, 255], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
  });

  doc.save(`${report.id}-${new Date().toISOString().slice(0, 10)}.pdf`);
}
