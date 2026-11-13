import React from 'react';
import { X, Mail, FileText, Plane, Building2 } from 'lucide-react';
import type { EventDatabase } from '../types/event';
import { StatusText } from './StatusText';

interface InviteeDetailDrawerProps {
  inviteeId: string | null;
  db: EventDatabase;
  onClose: () => void;
}

export const InviteeDetailDrawer: React.FC<InviteeDetailDrawerProps> = ({
  inviteeId,
  db,
  onClose,
}) => {
  if (!inviteeId) return null;
  const inv = db.invitees.find((i) => i.inviteeId === inviteeId);
  if (!inv) return null;

  const logi = db.logistics[inv.inviteeId];
  const logs = db.responseLogs.filter((l) => l.inviteeId === inv.inviteeId);
  const bookings = db.bookings.filter((b) => b.inviteeId === inv.inviteeId);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40" role="dialog" aria-modal="true">
      <div className="w-full max-w-xl bg-white h-full border-l border-slate-200 flex flex-col shadow-xl">
        <div className="px-6 py-4 border-b border-slate-200 flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-mono text-blue-700">
              <span>{inv.inviteeId}</span>
              <span className="text-slate-300" aria-hidden="true">·</span>
              <span className="text-slate-600">{inv.vipTier}</span>
              <span className="text-slate-300" aria-hidden="true">·</span>
              <span className="text-slate-600">{inv.category}</span>
            </div>
            <h2 className="mt-1 text-lg font-semibold text-slate-900">{inv.name}</h2>
            <p className="text-xs text-slate-500">
              {inv.designation} · {inv.organisation}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 rounded"
            aria-label="Close drawer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6 text-xs">
          {/* Unified Status Summary */}
          <div className="grid grid-cols-2 gap-4 pb-5 border-b border-slate-200">
            <div>
              <div className="text-slate-500 mb-1">Participation Status</div>
              <StatusText status={inv.rsvpStatus} />
              <div className="text-slate-500 mt-1">
                {inv.responseCount} response(s) consolidated
              </div>
            </div>
            <div>
              <div className="text-slate-500 mb-1">Logistics Status</div>
              {inv.confirmedParticipation ? (
                <StatusText status={logi?.logisticsStatus || 'Pending'} />
              ) : (
                <span className="text-slate-400">Not Applicable</span>
              )}
              {logi?.revisionFlag && (
                <div className="text-red-700 font-medium mt-1">{logi.revisionNote}</div>
              )}
            </div>
            <div>
              <div className="text-slate-500 mb-0.5">Email & Phone</div>
              <div className="text-slate-800">{inv.email}</div>
              <div className="font-mono text-slate-600">{inv.phone || '—'}</div>
            </div>
            <div>
              <div className="text-slate-500 mb-0.5">Origin & Notes</div>
              <div className="text-slate-800">{inv.city || '—'}</div>
              <div className="text-slate-500 mt-0.5">{inv.notes || '—'}</div>
            </div>
          </div>

          {/* Logistics Profile */}
          <div>
            <h3 className="text-xs font-semibold text-slate-900 flex items-center gap-1.5 mb-2.5">
              <Plane className="w-3.5 h-3.5 text-slate-500" />
              <span>Linked Logistics Profile</span>
            </h3>
            {logi ? (
              <div className="bg-slate-50 border border-slate-200 rounded-md p-3.5 grid grid-cols-2 gap-3">
                <div>
                  <span className="text-slate-500">Mode & Carrier:</span>{' '}
                  <span className="text-slate-900 font-medium">
                    {logi.travelMode || '—'} {logi.carrierDetails ? `(${logi.carrierDetails})` : ''}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500">Arrival:</span>{' '}
                  <span className="font-mono text-slate-900">
                    {logi.arrivalDate || '—'} {logi.arrivalTime}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500">Departure:</span>{' '}
                  <span className="font-mono text-slate-900">
                    {logi.departureDate || '—'} {logi.departureTime}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500">Accommodation:</span>{' '}
                  <span className="text-slate-900">
                    {logi.accommodationRequired
                      ? `${logi.hotelCheckIn || 'TBD'} → ${logi.hotelCheckOut || 'TBD'} (${logi.roomTypePreference || 'Standard'})`
                      : 'Not Required'}
                  </span>
                </div>
                <div className="col-span-2">
                  <span className="text-slate-500">Transfers & Special Needs:</span>{' '}
                  <span className="text-slate-900">
                    {[
                      logi.airportPickupRequired ? 'Airport/Station Pickup' : '',
                      logi.airportDropRequired ? 'Airport/Station Drop' : '',
                      logi.localTransportRequired ? 'Local Vehicle' : '',
                      logi.specialRequirements,
                    ]
                      .filter(Boolean)
                      .join(' · ') || 'None'}
                  </span>
                </div>
              </div>
            ) : (
              <p className="text-slate-500">No logistics details captured for this Invitee ID yet.</p>
            )}
          </div>

          {/* Linked Bookings */}
          <div>
            <h3 className="text-xs font-semibold text-slate-900 flex items-center gap-1.5 mb-2.5">
              <Building2 className="w-3.5 h-3.5 text-slate-500" />
              <span>Hotel & Vehicle Allocations ({bookings.length})</span>
            </h3>
            {bookings.length === 0 ? (
              <p className="text-slate-500">No bookings assigned yet.</p>
            ) : (
              <div className="space-y-2">
                {bookings.map((b) => (
                  <div key={b.id} className="border border-slate-200 rounded-md p-3 flex items-start justify-between gap-3">
                    <div>
                      <div className="font-medium text-slate-900">
                        {b.bookingType} · {b.vendorOrProperty}
                      </div>
                      <div className="text-slate-500 mt-0.5">
                        {b.vehicleOrRoomDetails} · <span className="font-mono">{b.checkInOrDate} {b.checkOutOrTime}</span>
                      </div>
                      {b.confirmationRef && (
                        <div className="font-mono text-[11px] text-slate-600 mt-0.5">Ref: {b.confirmationRef}</div>
                      )}
                    </div>
                    <StatusText status={b.status} />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Consolidated Response Timeline */}
          <div>
            <h3 className="text-xs font-semibold text-slate-900 flex items-center gap-1.5 mb-2.5">
              <Mail className="w-3.5 h-3.5 text-slate-500" />
              <span>Consolidated Email & Form Response Audit ({logs.length})</span>
            </h3>
            {logs.length === 0 ? (
              <p className="text-slate-500 flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5" />
                <span>No inbound email or form logs mapped yet.</span>
              </p>
            ) : (
              <div className="space-y-2.5">
                {logs.map((l) => (
                  <div key={l.id} className="border border-slate-200 rounded-md p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-slate-900">{l.channel} · {l.subject}</span>
                      <StatusText status={l.verificationState} />
                    </div>
                    <p className="text-slate-600 mt-1 whitespace-pre-line">{l.rawContent}</p>
                    <div className="mt-1.5 text-[11px] text-slate-400 font-mono">
                      {new Date(l.receivedAt).toLocaleString()} · {l.aiRationale}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
