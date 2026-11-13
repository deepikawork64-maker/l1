import React, { useMemo, useState } from 'react';
import { Edit3, ExternalLink, Search, X, AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { EventDatabase, LogisticsRecord, TravelMode } from '../types/event';
import { StatusText } from './StatusText';

interface LogisticsViewProps {
  db: EventDatabase;
  onRefreshState: (nextDb: EventDatabase, nextMetrics: any) => void;
  onInspectInvitee: (inviteeId: string) => void;
}

export const LogisticsView: React.FC<LogisticsViewProps> = ({
  db,
  onRefreshState,
  onInspectInvitee,
}) => {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [includeUnconfirmed, setIncludeUnconfirmed] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [showPortalModal, setShowPortalModal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [formState, setFormState] = useState<Partial<LogisticsRecord> & { clearRevisionFlag?: boolean }>({});

  // Invitee Self-Service Portal state
  const [portalForm, setPortalForm] = useState({
    inviteeId: '',
    email: '',
    attending: true,
    arrivalDate: '',
    arrivalTime: '',
    departureDate: '',
    departureTime: '',
    travelMode: 'Flight' as TravelMode,
    carrierDetails: '',
    accommodationRequired: false,
    hotelCheckIn: '',
    hotelCheckOut: '',
    roomTypePreference: '',
    airportPickupRequired: false,
    airportDropRequired: false,
    localTransportRequired: false,
    specialRequirements: '',
  });
  const [portalResult, setPortalResult] = useState<string | null>(null);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return db.invitees
      .filter((inv) => !inv.duplicateOfId)
      .filter((inv) => (includeUnconfirmed ? true : inv.confirmedParticipation))
      .map((inv) => ({
        inv,
        logi: db.logistics[inv.inviteeId] ?? null,
      }))
      .filter(({ inv, logi }) => {
        const lStatus = logi?.logisticsStatus ?? 'Pending';
        if (statusFilter !== 'ALL' && lStatus !== statusFilter) return false;
        if (q) {
          const hay = `${inv.inviteeId} ${inv.name} ${inv.organisation} ${logi?.carrierDetails ?? ''}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      });
  }, [db, search, statusFilter, includeUnconfirmed]);

  const openLogisticsEditor = (inviteeId: string) => {
    const existing = db.logistics[inviteeId];
    setEditingId(inviteeId);
    setErrorMsg(null);
    setFormState({
      arrivalDate: existing?.arrivalDate ?? '',
      arrivalTime: existing?.arrivalTime ?? '',
      departureDate: existing?.departureDate ?? '',
      departureTime: existing?.departureTime ?? '',
      travelMode: existing?.travelMode ?? '',
      carrierDetails: existing?.carrierDetails ?? '',
      accommodationRequired: existing?.accommodationRequired ?? false,
      hotelCheckIn: existing?.hotelCheckIn ?? '',
      hotelCheckOut: existing?.hotelCheckOut ?? '',
      roomTypePreference: existing?.roomTypePreference ?? '',
      airportPickupRequired: existing?.airportPickupRequired ?? false,
      airportDropRequired: existing?.airportDropRequired ?? false,
      localTransportRequired: existing?.localTransportRequired ?? false,
      specialRequirements: existing?.specialRequirements ?? '',
      clearRevisionFlag: false,
    });
  };

  const handleSaveLogistics = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingId) return;
    setBusy(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/logistics/${encodeURIComponent(editingId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formState),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update logistics');
      onRefreshState(data.db, data.metrics);
      setEditingId(null);
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handlePortalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setPortalResult(null);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/portal/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(portalForm),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Portal submission failed');
      onRefreshState(data.db, data.metrics);
      setPortalResult(
        `Consolidated under ${data.invitee.inviteeId} (${data.invitee.name}) — participation & logistics updated without duplicate counting.`
      );
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5 flex-1 min-w-[260px]">
          <div className="relative flex-1 max-w-xs">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search Invitee ID, guest, flight..."
              className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-300 rounded-md"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-md bg-white text-slate-700"
          >
            <option value="ALL">All Logistics Statuses</option>
            <option value="Received">Received</option>
            <option value="Partially Received">Partially Received</option>
            <option value="Pending">Pending</option>
            <option value="Not Required">Not Required</option>
          </select>
          <label className="inline-flex items-center gap-1.5 text-xs text-slate-600 ml-1">
            <input
              type="checkbox"
              checked={includeUnconfirmed}
              onChange={(e) => setIncludeUnconfirmed(e.target.checked)}
            />
            <span>Include unconfirmed invitees</span>
          </label>
        </div>

        <button
          type="button"
          onClick={() => {
            setPortalResult(null);
            setErrorMsg(null);
            setShowPortalModal(true);
          }}
          className="px-3.5 py-1.5 text-xs font-medium text-white bg-blue-700 rounded-md hover:bg-blue-800 inline-flex items-center gap-1.5 whitespace-nowrap"
        >
          <ExternalLink className="w-3.5 h-3.5" />
          <span>Open Invitee Logistics Form</span>
        </button>
      </div>

      {/* Logistics Table */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-slate-500 font-medium">
                <th className="py-2.5 px-3">Invitee ID</th>
                <th className="py-2.5 px-3">Guest & Participation</th>
                <th className="py-2.5 px-3">Logistics Status</th>
                <th className="py-2.5 px-3">Arrival / Departure</th>
                <th className="py-2.5 px-3">Mode & Flight/Train</th>
                <th className="py-2.5 px-3">Hotel Stay</th>
                <th className="py-2.5 px-3">Transfers & Special</th>
                <th className="py-2.5 px-3 text-right">Edit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-slate-500">
                    No logistics records match your filter.
                  </td>
                </tr>
              ) : (
                rows.map(({ inv, logi }) => (
                  <tr key={inv.inviteeId} className={`hover:bg-slate-50 ${logi?.revisionFlag ? 'bg-red-50/30' : ''}`}>
                    <td className="py-2.5 px-3 align-top whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => onInspectInvitee(inv.inviteeId)}
                        className="font-mono font-medium text-blue-700 hover:underline tabular-nums"
                      >
                        {inv.inviteeId}
                      </button>
                    </td>
                    <td className="py-2.5 px-3 align-top">
                      <div className="font-medium text-slate-900">{inv.name}</div>
                      <div className="mt-0.5">
                        <StatusText status={inv.rsvpStatus} />
                      </div>
                    </td>
                    <td className="py-2.5 px-3 align-top whitespace-nowrap">
                      <StatusText status={logi?.logisticsStatus ?? 'Pending'} />
                      {logi?.revisionFlag && (
                        <div className="mt-1 text-[11px] font-medium text-red-700 inline-flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" />
                          <span>Revision Flagged</span>
                        </div>
                      )}
                    </td>
                    <td className="py-2.5 px-3 align-top font-mono text-[11px] tabular-nums whitespace-nowrap">
                      <div className="text-slate-800">
                        Arr: {logi?.arrivalDate || '—'} {logi?.arrivalTime}
                      </div>
                      <div className="text-slate-500">
                        Dep: {logi?.departureDate || '—'} {logi?.departureTime}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 align-top max-w-[180px]">
                      <div className="text-slate-800">{logi?.travelMode || '—'}</div>
                      <div className="text-[11px] text-slate-500 truncate">{logi?.carrierDetails || '—'}</div>
                    </td>
                    <td className="py-2.5 px-3 align-top whitespace-nowrap">
                      {logi?.accommodationRequired ? (
                        <div>
                          <div className="font-mono text-[11px] text-slate-800">
                            {logi.hotelCheckIn || 'TBD'} → {logi.hotelCheckOut || 'TBD'}
                          </div>
                          <div className="text-[11px] text-slate-500">{logi.roomTypePreference || 'Standard'}</div>
                        </div>
                      ) : (
                        <span className="text-slate-400">Not Req</span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 align-top max-w-[200px]">
                      <div className="text-slate-700">
                        {[
                          logi?.airportPickupRequired ? 'Pickup' : '',
                          logi?.airportDropRequired ? 'Drop' : '',
                          logi?.localTransportRequired ? 'Local Cab' : '',
                        ]
                          .filter(Boolean)
                          .join(' · ') || 'None'}
                      </div>
                      {logi?.specialRequirements && (
                        <div className="text-[11px] text-slate-500 truncate">{logi.specialRequirements}</div>
                      )}
                    </td>
                    <td className="py-2.5 px-3 align-top text-right">
                      <button
                        type="button"
                        onClick={() => openLogisticsEditor(inv.inviteeId)}
                        className="p-1.5 text-slate-500 hover:text-blue-700 hover:bg-slate-100 rounded"
                        title="Edit logistics profile"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Logistics Editor Modal */}
      {editingId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-2xl bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900">
                Edit Logistics Profile · <span className="font-mono text-blue-700">{editingId}</span>
              </h3>
              <button type="button" onClick={() => setEditingId(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSaveLogistics} className="p-6 space-y-4 max-h-[80vh] overflow-y-auto text-xs">
              {errorMsg && <div className="p-3 bg-red-50 border border-red-200 text-red-800 rounded">{errorMsg}</div>}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Travel Mode</label>
                  <select
                    value={formState.travelMode ?? ''}
                    onChange={(e) => setFormState({ ...formState, travelMode: e.target.value as TravelMode })}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-md bg-white"
                  >
                    <option value="">Select mode...</option>
                    <option value="Flight">Flight</option>
                    <option value="Train">Train</option>
                    <option value="Road / Self">Road / Self</option>
                    <option value="Local / No Travel">Local / No Travel</option>
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Flight / Train Details</label>
                  <input
                    type="text"
                    value={formState.carrierDetails ?? ''}
                    onChange={(e) => setFormState({ ...formState, carrierDetails: e.target.value })}
                    placeholder="e.g. AI-865 (DEL → BOM T2)"
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-md"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Arrival Date</label>
                  <input
                    type="date"
                    value={formState.arrivalDate ?? ''}
                    onChange={(e) => setFormState({ ...formState, arrivalDate: e.target.value })}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-md font-mono"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Arrival Time</label>
                  <input
                    type="time"
                    value={formState.arrivalTime ?? ''}
                    onChange={(e) => setFormState({ ...formState, arrivalTime: e.target.value })}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-md font-mono"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Departure Date</label>
                  <input
                    type="date"
                    value={formState.departureDate ?? ''}
                    onChange={(e) => setFormState({ ...formState, departureDate: e.target.value })}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-md font-mono"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Departure Time</label>
                  <input
                    type="time"
                    value={formState.departureTime ?? ''}
                    onChange={(e) => setFormState({ ...formState, departureTime: e.target.value })}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-md font-mono"
                  />
                </div>
              </div>

              <div className="pt-2 border-t border-slate-200 space-y-3">
                <label className="inline-flex items-center gap-2 font-medium text-slate-800">
                  <input
                    type="checkbox"
                    checked={Boolean(formState.accommodationRequired)}
                    onChange={(e) => setFormState({ ...formState, accommodationRequired: e.target.checked })}
                  />
                  <span>Hotel Accommodation Required</span>
                </label>

                {formState.accommodationRequired && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block font-medium text-slate-700 mb-1">Check-In Date</label>
                      <input
                        type="date"
                        value={formState.hotelCheckIn ?? ''}
                        onChange={(e) => setFormState({ ...formState, hotelCheckIn: e.target.value })}
                        className="w-full px-2.5 py-1.5 border border-slate-300 rounded font-mono"
                      />
                    </div>
                    <div>
                      <label className="block font-medium text-slate-700 mb-1">Check-Out Date</label>
                      <input
                        type="date"
                        value={formState.hotelCheckOut ?? ''}
                        onChange={(e) => setFormState({ ...formState, hotelCheckOut: e.target.value })}
                        className="w-full px-2.5 py-1.5 border border-slate-300 rounded font-mono"
                      />
                    </div>
                    <div>
                      <label className="block font-medium text-slate-700 mb-1">Room Preference</label>
                      <input
                        type="text"
                        value={formState.roomTypePreference ?? ''}
                        onChange={(e) => setFormState({ ...formState, roomTypePreference: e.target.value })}
                        className="w-full px-2.5 py-1.5 border border-slate-300 rounded"
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="pt-2 border-t border-slate-200 flex flex-wrap gap-5">
                <label className="inline-flex items-center gap-2 text-slate-700">
                  <input
                    type="checkbox"
                    checked={Boolean(formState.airportPickupRequired)}
                    onChange={(e) => setFormState({ ...formState, airportPickupRequired: e.target.checked })}
                  />
                  <span>Airport / Station Pickup</span>
                </label>
                <label className="inline-flex items-center gap-2 text-slate-700">
                  <input
                    type="checkbox"
                    checked={Boolean(formState.airportDropRequired)}
                    onChange={(e) => setFormState({ ...formState, airportDropRequired: e.target.checked })}
                  />
                  <span>Airport / Station Drop</span>
                </label>
                <label className="inline-flex items-center gap-2 text-slate-700">
                  <input
                    type="checkbox"
                    checked={Boolean(formState.localTransportRequired)}
                    onChange={(e) => setFormState({ ...formState, localTransportRequired: e.target.checked })}
                  />
                  <span>Local Transportation</span>
                </label>
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">Special Requirements (Dietary, Accessibility, Security)</label>
                <textarea
                  rows={2}
                  value={formState.specialRequirements ?? ''}
                  onChange={(e) => setFormState({ ...formState, specialRequirements: e.target.value })}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-md"
                />
              </div>

              {db.logistics[editingId]?.revisionFlag && (
                <label className="inline-flex items-center gap-2 text-amber-800 font-medium">
                  <input
                    type="checkbox"
                    checked={Boolean(formState.clearRevisionFlag)}
                    onChange={(e) => setFormState({ ...formState, clearRevisionFlag: e.target.checked })}
                  />
                  <span>Mark schedule revision as reconciled</span>
                </label>
              )}

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditingId(null)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 border border-slate-300 rounded-md"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="px-4 py-2 text-xs font-medium text-white bg-blue-700 rounded-md hover:bg-blue-800"
                >
                  {busy ? 'Saving...' : 'Save Logistics'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Invitee Self-Service RSVP & Logistics Submission Portal Modal */}
      {showPortalModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-2xl bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold text-slate-900">Invitee RSVP & Logistics Submission Portal</h3>
                <p className="text-xs text-slate-500">
                  Submissions link strictly by Invitee ID or registered Email — preventing duplicate records.
                </p>
              </div>
              <button type="button" onClick={() => setShowPortalModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handlePortalSubmit} className="p-6 space-y-4 max-h-[80vh] overflow-y-auto text-xs">
              {errorMsg && <div className="p-3 bg-red-50 border border-red-200 text-red-800 rounded">{errorMsg}</div>}
              {portalResult && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-900 rounded flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
                  <span>{portalResult}</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Unique Invitee ID</label>
                  <input
                    type="text"
                    value={portalForm.inviteeId}
                    onChange={(e) => setPortalForm({ ...portalForm, inviteeId: e.target.value })}
                    placeholder="INV-2026-006"
                    className="w-full px-3 py-1.5 border border-slate-300 rounded font-mono"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Registered Email (Alternative Lookup)</label>
                  <input
                    type="email"
                    value={portalForm.email}
                    onChange={(e) => setPortalForm({ ...portalForm, email: e.target.value })}
                    placeholder="guest@organisation.com"
                    className="w-full px-3 py-1.5 border border-slate-300 rounded"
                  />
                </div>
              </div>

              <div className="flex items-center gap-6 py-1">
                <label className="inline-flex items-center gap-2 font-medium text-slate-800">
                  <input
                    type="radio"
                    checked={portalForm.attending}
                    onChange={() => setPortalForm({ ...portalForm, attending: true })}
                  />
                  <span>Confirm Participation</span>
                </label>
                <label className="inline-flex items-center gap-2 font-medium text-slate-800">
                  <input
                    type="radio"
                    checked={!portalForm.attending}
                    onChange={() => setPortalForm({ ...portalForm, attending: false })}
                  />
                  <span>Regret / Unable to Attend</span>
                </label>
              </div>

              {portalForm.attending && (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block font-medium text-slate-700 mb-1">Travel Mode</label>
                      <select
                        value={portalForm.travelMode}
                        onChange={(e) => setPortalForm({ ...portalForm, travelMode: e.target.value as TravelMode })}
                        className="w-full px-3 py-1.5 border border-slate-300 rounded bg-white"
                      >
                        <option value="Flight">Flight</option>
                        <option value="Train">Train</option>
                        <option value="Road / Self">Road / Self</option>
                        <option value="Local / No Travel">Local / No Travel</option>
                      </select>
                    </div>
                    <div>
                      <label className="block font-medium text-slate-700 mb-1">Flight / Train Number</label>
                      <input
                        type="text"
                        value={portalForm.carrierDetails}
                        onChange={(e) => setPortalForm({ ...portalForm, carrierDetails: e.target.value })}
                        className="w-full px-3 py-1.5 border border-slate-300 rounded"
                      />
                    </div>
                    <div>
                      <label className="block font-medium text-slate-700 mb-1">Arrival Date & Time</label>
                      <div className="flex gap-2">
                        <input
                          type="date"
                          value={portalForm.arrivalDate}
                          onChange={(e) => setPortalForm({ ...portalForm, arrivalDate: e.target.value })}
                          className="flex-1 px-2 py-1.5 border border-slate-300 rounded font-mono"
                        />
                        <input
                          type="time"
                          value={portalForm.arrivalTime}
                          onChange={(e) => setPortalForm({ ...portalForm, arrivalTime: e.target.value })}
                          className="w-24 px-2 py-1.5 border border-slate-300 rounded font-mono"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block font-medium text-slate-700 mb-1">Departure Date & Time</label>
                      <div className="flex gap-2">
                        <input
                          type="date"
                          value={portalForm.departureDate}
                          onChange={(e) => setPortalForm({ ...portalForm, departureDate: e.target.value })}
                          className="flex-1 px-2 py-1.5 border border-slate-300 rounded font-mono"
                        />
                        <input
                          type="time"
                          value={portalForm.departureTime}
                          onChange={(e) => setPortalForm({ ...portalForm, departureTime: e.target.value })}
                          className="w-24 px-2 py-1.5 border border-slate-300 rounded font-mono"
                        />
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-5 pt-1">
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={portalForm.accommodationRequired}
                        onChange={(e) => setPortalForm({ ...portalForm, accommodationRequired: e.target.checked })}
                      />
                      <span>Need Hotel Room</span>
                    </label>
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={portalForm.airportPickupRequired}
                        onChange={(e) => setPortalForm({ ...portalForm, airportPickupRequired: e.target.checked })}
                      />
                      <span>Need Airport/Station Pickup</span>
                    </label>
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={portalForm.airportDropRequired}
                        onChange={(e) => setPortalForm({ ...portalForm, airportDropRequired: e.target.checked })}
                      />
                      <span>Need Airport/Station Drop</span>
                    </label>
                  </div>
                </>
              )}

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowPortalModal(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 border border-slate-300 rounded-md"
                >
                  Close
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="px-4 py-2 text-xs font-medium text-white bg-blue-700 rounded-md hover:bg-blue-800"
                >
                  {busy ? 'Submitting...' : 'Submit & Consolidate'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
