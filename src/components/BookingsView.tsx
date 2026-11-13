import React, { useMemo, useState } from 'react';
import { Plus, Wand2, Edit3, Trash2, X, AlertTriangle } from 'lucide-react';
import type {
  BookingAllocation,
  BookingStatus,
  BookingType,
  DashboardMetrics,
  EventDatabase,
} from '../types/event';
import { StatusText } from './StatusText';
import { ConfirmDialog } from './ConfirmDialog';

interface BookingsViewProps {
  db: EventDatabase;
  metrics: DashboardMetrics;
  onRefreshState: (nextDb: EventDatabase, nextMetrics: any) => void;
  onInspectInvitee: (inviteeId: string) => void;
}

export const BookingsView: React.FC<BookingsViewProps> = ({
  db,
  metrics,
  onRefreshState,
  onInspectInvitee,
}) => {
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [busy, setBusy] = useState(false);
  const [bannerMsg, setBannerMsg] = useState<string | null>(null);

  const [editingBooking, setEditingBooking] = useState<BookingAllocation | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<BookingAllocation | null>(null);

  const [formState, setFormState] = useState<{
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
  }>({
    inviteeId: '',
    bookingType: 'Hotel Room',
    vendorOrProperty: '',
    confirmationRef: '',
    checkInOrDate: '',
    checkOutOrTime: '',
    vehicleOrRoomDetails: '',
    driverOrContact: '',
    status: 'Pending',
    notes: '',
  });

  const inviteeMap = useMemo(
    () => new Map(db.invitees.map((i) => [i.inviteeId, i])),
    [db.invitees]
  );

  const uniqueInvitees = useMemo(
    () => db.invitees.filter((i) => !i.duplicateOfId),
    [db.invitees]
  );

  const filteredBookings = useMemo(() => {
    return db.bookings.filter((b) => {
      if (typeFilter !== 'ALL' && b.bookingType !== typeFilter) return false;
      if (statusFilter !== 'ALL' && b.status !== statusFilter) return false;
      return true;
    });
  }, [db.bookings, typeFilter, statusFilter]);

  const dateWiseDemand = useMemo(() => {
    const map = new Map<string, { date: string; hotels: number; pickups: number; drops: number; local: number }>();
    for (const inv of uniqueInvitees) {
      if (!inv.confirmedParticipation) continue;
      const logi = db.logistics[inv.inviteeId];
      if (!logi) continue;

      if (logi.accommodationRequired && (logi.hotelCheckIn || logi.arrivalDate)) {
        const d = logi.hotelCheckIn || logi.arrivalDate;
        const cur = map.get(d) ?? { date: d, hotels: 0, pickups: 0, drops: 0, local: 0 };
        cur.hotels += 1;
        map.set(d, cur);
      }
      if (logi.airportPickupRequired && logi.arrivalDate) {
        const cur = map.get(logi.arrivalDate) ?? { date: logi.arrivalDate, hotels: 0, pickups: 0, drops: 0, local: 0 };
        cur.pickups += 1;
        map.set(logi.arrivalDate, cur);
      }
      if (logi.airportDropRequired && logi.departureDate) {
        const cur = map.get(logi.departureDate) ?? { date: logi.departureDate, hotels: 0, pickups: 0, drops: 0, local: 0 };
        cur.drops += 1;
        map.set(logi.departureDate, cur);
      }
      if (logi.localTransportRequired && logi.arrivalDate) {
        const cur = map.get(logi.arrivalDate) ?? { date: logi.arrivalDate, hotels: 0, pickups: 0, drops: 0, local: 0 };
        cur.local += 1;
        map.set(logi.arrivalDate, cur);
      }
    }
    return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [uniqueInvitees, db.logistics]);

  const handleAutoGenerate = async () => {
    setBusy(true);
    setBannerMsg(null);
    try {
      const res = await fetch('/api/bookings/auto-generate', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        onRefreshState(data.db, data.metrics);
        setBannerMsg(
          data.created > 0
            ? `Generated ${data.created} pending hotel/transfer allocation(s) from confirmed invitees' logistics requirements.`
            : 'All confirmed invitee logistics requirements already have matching booking records.'
        );
      }
    } finally {
      setBusy(false);
    }
  };

  const openAdd = () => {
    setEditingBooking(null);
    setFormState({
      inviteeId: uniqueInvitees[0]?.inviteeId || '',
      bookingType: 'Hotel Room',
      vendorOrProperty: '',
      confirmationRef: '',
      checkInOrDate: '',
      checkOutOrTime: '',
      vehicleOrRoomDetails: '',
      driverOrContact: '',
      status: 'Pending',
      notes: '',
    });
    setShowModal(true);
  };

  const openEdit = (bkg: BookingAllocation) => {
    setEditingBooking(bkg);
    setFormState({
      inviteeId: bkg.inviteeId,
      bookingType: bkg.bookingType,
      vendorOrProperty: bkg.vendorOrProperty,
      confirmationRef: bkg.confirmationRef,
      checkInOrDate: bkg.checkInOrDate,
      checkOutOrTime: bkg.checkOutOrTime,
      vehicleOrRoomDetails: bkg.vehicleOrRoomDetails,
      driverOrContact: bkg.driverOrContact,
      status: bkg.status,
      notes: bkg.notes,
    });
    setShowModal(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const url = editingBooking ? `/api/bookings/${encodeURIComponent(editingBooking.id)}` : '/api/bookings';
      const method = editingBooking ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formState),
      });
      const data = await res.json();
      if (res.ok) {
        onRefreshState(data.db, data.metrics);
        setShowModal(false);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/bookings/${encodeURIComponent(deleteTarget.id)}`, { method: 'DELETE' });
      const data = await res.json();
      if (res.ok) onRefreshState(data.db, data.metrics);
    } finally {
      setBusy(false);
      setDeleteTarget(null);
    }
  };

  return (
    <div className="space-y-5">
      {bannerMsg && (
        <div className="bg-blue-50 border border-blue-200 text-blue-900 rounded-lg px-4 py-3 text-xs">
          {bannerMsg}
        </div>
      )}

      {/* Summary & Date-wise Demand */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-4 bg-white border border-slate-200 rounded-lg p-5 space-y-4">
          <h3 className="text-sm font-semibold text-slate-900">Resource Allocation Summary</h3>
          <div className="space-y-2.5 text-xs">
            <div className="flex items-center justify-between py-1.5 border-b border-slate-100">
              <span className="text-slate-600">Hotel Rooms Confirmed / Required</span>
              <span className="font-mono font-semibold tabular-nums text-slate-900">
                {metrics.hotelConfirmedCount} / {metrics.hotelRequiredCount}
              </span>
            </div>
            <div className="flex items-center justify-between py-1.5 border-b border-slate-100">
              <span className="text-slate-600">Transfers Confirmed / Required</span>
              <span className="font-mono font-semibold tabular-nums text-slate-900">
                {metrics.transportConfirmedCount} / {metrics.transportRequiredCount}
              </span>
            </div>
            <div className="flex items-center justify-between py-1.5">
              <span className="text-slate-600">Revisions Pending Action</span>
              <span className="font-mono font-semibold tabular-nums text-red-700">
                {db.bookings.filter((b) => b.status === 'Revision Required').length}
              </span>
            </div>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={handleAutoGenerate}
            className="w-full px-3.5 py-2 text-xs font-medium text-white bg-slate-900 rounded-md hover:bg-slate-800 inline-flex items-center justify-center gap-1.5"
          >
            <Wand2 className="w-3.5 h-3.5" />
            <span>Auto-Generate Pending Bookings</span>
          </button>
        </div>

        <div className="lg:col-span-8 bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200">
            <h3 className="text-sm font-semibold text-slate-900">Date-wise Hotel & Vehicle Requirement Rollup</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-medium">
                  <th className="py-2 px-4">Date</th>
                  <th className="py-2 px-3 text-right">Hotel Check-Ins</th>
                  <th className="py-2 px-3 text-right">Pickups</th>
                  <th className="py-2 px-3 text-right">Drops</th>
                  <th className="py-2 px-4 text-right">Local Vehicles</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {dateWiseDemand.map((row) => (
                  <tr key={row.date} className="hover:bg-slate-50">
                    <td className="py-2 px-4 font-mono font-medium text-slate-900">{row.date}</td>
                    <td className="py-2 px-3 text-right font-mono tabular-nums">{row.hotels}</td>
                    <td className="py-2 px-3 text-right font-mono tabular-nums">{row.pickups}</td>
                    <td className="py-2 px-3 text-right font-mono tabular-nums">{row.drops}</td>
                    <td className="py-2 px-4 text-right font-mono tabular-nums">{row.local}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Filter & Actions */}
      <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-md bg-white text-slate-700"
          >
            <option value="ALL">All Booking Types</option>
            <option value="Hotel Room">Hotel Room</option>
            <option value="Airport/Station Pickup">Airport/Station Pickup</option>
            <option value="Airport/Station Drop">Airport/Station Drop</option>
            <option value="Local Vehicle">Local Vehicle</option>
            <option value="Hospitality / Escort">Hospitality / Escort</option>
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-md bg-white text-slate-700"
          >
            <option value="ALL">All Booking Statuses</option>
            <option value="Pending">Pending</option>
            <option value="Requested">Requested</option>
            <option value="Confirmed">Confirmed</option>
            <option value="Revision Required">Revision Required</option>
            <option value="Cancelled">Cancelled</option>
          </select>
        </div>

        <button
          type="button"
          onClick={openAdd}
          className="px-3.5 py-1.5 text-xs font-medium text-white bg-blue-700 rounded-md hover:bg-blue-800 inline-flex items-center gap-1.5 whitespace-nowrap"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>New Allocation</span>
        </button>
      </div>

      {/* Bookings Ledger */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-slate-500 font-medium">
                <th className="py-2.5 px-3">Invitee ID & Guest</th>
                <th className="py-2.5 px-3">Type</th>
                <th className="py-2.5 px-3">Vendor / Hotel</th>
                <th className="py-2.5 px-3">Room / Vehicle Details</th>
                <th className="py-2.5 px-3">Schedule</th>
                <th className="py-2.5 px-3">Status</th>
                <th className="py-2.5 px-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredBookings.map((b) => {
                const inv = inviteeMap.get(b.inviteeId);
                return (
                  <tr
                    key={b.id}
                    className={`hover:bg-slate-50 ${b.status === 'Revision Required' ? 'bg-red-50/40' : ''}`}
                  >
                    <td className="py-2.5 px-3 align-top">
                      <button
                        type="button"
                        onClick={() => onInspectInvitee(b.inviteeId)}
                        className="font-mono font-medium text-blue-700 hover:underline"
                      >
                        {b.inviteeId}
                      </button>
                      <div className="font-medium text-slate-900">{inv?.name || b.inviteeId}</div>
                      <div className="text-[11px] text-slate-500">{inv?.vipTier} · {inv?.category}</div>
                    </td>
                    <td className="py-2.5 px-3 align-top whitespace-nowrap text-slate-800">{b.bookingType}</td>
                    <td className="py-2.5 px-3 align-top">
                      <div className="font-medium text-slate-800">{b.vendorOrProperty}</div>
                      <div className="font-mono text-[11px] text-slate-500">
                        {b.confirmationRef ? `Ref: ${b.confirmationRef}` : 'No Ref'}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 align-top max-w-[200px]">
                      <div className="text-slate-800">{b.vehicleOrRoomDetails || '—'}</div>
                      <div className="text-[11px] text-slate-500">{b.driverOrContact || ''}</div>
                    </td>
                    <td className="py-2.5 px-3 align-top font-mono text-[11px] tabular-nums whitespace-nowrap">
                      <div>{b.checkInOrDate || '—'}</div>
                      <div className="text-slate-500">{b.checkOutOrTime || '—'}</div>
                    </td>
                    <td className="py-2.5 px-3 align-top">
                      <StatusText status={b.status} />
                      {b.notes && (
                        <div className="text-[11px] text-slate-500 mt-0.5 max-w-[180px] truncate" title={b.notes}>
                          {b.status === 'Revision Required' && <AlertTriangle className="w-3 h-3 inline mr-1 text-red-700" />}
                          {b.notes}
                        </div>
                      )}
                    </td>
                    <td className="py-2.5 px-3 align-top text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => openEdit(b)}
                        className="p-1.5 text-slate-500 hover:text-blue-700 hover:bg-slate-100 rounded"
                        title="Edit allocation"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(b)}
                        className="p-1.5 text-slate-400 hover:text-red-700 hover:bg-red-50 rounded"
                        title="Delete allocation"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add / Edit Allocation Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-xl bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900">
                {editingBooking ? `Update Allocation · ${editingBooking.id}` : 'Create Booking Allocation'}
              </h3>
              <button type="button" onClick={() => setShowModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSave} className="p-6 space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Invitee ID</label>
                  <select
                    value={formState.inviteeId}
                    disabled={Boolean(editingBooking)}
                    onChange={(e) => setFormState({ ...formState, inviteeId: e.target.value })}
                    className="w-full px-2.5 py-1.5 border border-slate-300 rounded bg-white disabled:bg-slate-100"
                  >
                    {uniqueInvitees.map((i) => (
                      <option key={i.inviteeId} value={i.inviteeId}>
                        {i.inviteeId} — {i.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Booking Type</label>
                  <select
                    value={formState.bookingType}
                    onChange={(e) => setFormState({ ...formState, bookingType: e.target.value as BookingType })}
                    className="w-full px-2.5 py-1.5 border border-slate-300 rounded bg-white"
                  >
                    <option value="Hotel Room">Hotel Room</option>
                    <option value="Airport/Station Pickup">Airport/Station Pickup</option>
                    <option value="Airport/Station Drop">Airport/Station Drop</option>
                    <option value="Local Vehicle">Local Vehicle</option>
                    <option value="Hospitality / Escort">Hospitality / Escort</option>
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Hotel / Fleet Vendor</label>
                  <input
                    type="text"
                    required
                    value={formState.vendorOrProperty}
                    onChange={(e) => setFormState({ ...formState, vendorOrProperty: e.target.value })}
                    className="w-full px-2.5 py-1.5 border border-slate-300 rounded"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Confirmation Ref</label>
                  <input
                    type="text"
                    value={formState.confirmationRef}
                    onChange={(e) => setFormState({ ...formState, confirmationRef: e.target.value })}
                    className="w-full px-2.5 py-1.5 border border-slate-300 rounded font-mono"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Check-In / Date</label>
                  <input
                    type="text"
                    value={formState.checkInOrDate}
                    onChange={(e) => setFormState({ ...formState, checkInOrDate: e.target.value })}
                    placeholder="YYYY-MM-DD"
                    className="w-full px-2.5 py-1.5 border border-slate-300 rounded font-mono"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Check-Out / Time</label>
                  <input
                    type="text"
                    value={formState.checkOutOrTime}
                    onChange={(e) => setFormState({ ...formState, checkOutOrTime: e.target.value })}
                    placeholder="YYYY-MM-DD or HH:MM"
                    className="w-full px-2.5 py-1.5 border border-slate-300 rounded font-mono"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Room / Vehicle Details</label>
                  <input
                    type="text"
                    value={formState.vehicleOrRoomDetails}
                    onChange={(e) => setFormState({ ...formState, vehicleOrRoomDetails: e.target.value })}
                    className="w-full px-2.5 py-1.5 border border-slate-300 rounded"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Driver / Hotel Contact</label>
                  <input
                    type="text"
                    value={formState.driverOrContact}
                    onChange={(e) => setFormState({ ...formState, driverOrContact: e.target.value })}
                    className="w-full px-2.5 py-1.5 border border-slate-300 rounded"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block font-medium text-slate-700 mb-1">Allocation Status</label>
                  <select
                    value={formState.status}
                    onChange={(e) => setFormState({ ...formState, status: e.target.value as BookingStatus })}
                    className="w-full px-2.5 py-1.5 border border-slate-300 rounded bg-white"
                  >
                    <option value="Pending">Pending</option>
                    <option value="Requested">Requested</option>
                    <option value="Confirmed">Confirmed</option>
                    <option value="Revision Required">Revision Required</option>
                    <option value="Cancelled">Cancelled</option>
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="block font-medium text-slate-700 mb-1">Notes</label>
                  <textarea
                    rows={2}
                    value={formState.notes}
                    onChange={(e) => setFormState({ ...formState, notes: e.target.value })}
                    className="w-full px-2.5 py-1.5 border border-slate-300 rounded"
                  />
                </div>
              </div>
              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 border border-slate-300 rounded-md"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="px-4 py-2 text-xs font-medium text-white bg-blue-700 rounded-md hover:bg-blue-800"
                >
                  {busy ? 'Saving...' : 'Save Allocation'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete Booking Allocation?"
        description={`Remove booking ${deleteTarget?.id} (${deleteTarget?.bookingType}) for ${deleteTarget?.inviteeId}?`}
        confirmLabel="Delete"
        destructive
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
};
