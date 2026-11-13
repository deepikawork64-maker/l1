import React, { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  Search,
  Plus,
  Upload,
  Download,
  GitMerge,
  Trash2,
  Eye,
  Edit3,
  AlertTriangle,
  X,
} from 'lucide-react';
import type {
  EventDatabase,
  Invitee,
  InviteeCategory,
  ResponseStatus,
  VipTier,
} from '../types/event';
import { INVITEE_CATEGORIES, RESPONSE_STATUSES } from '../types/event';
import { StatusText } from './StatusText';
import { ConfirmDialog } from './ConfirmDialog';

interface MasterRegistryViewProps {
  db: EventDatabase;
  onRefreshState: (nextDb: EventDatabase, nextMetrics: any) => void;
  onInspectInvitee: (inviteeId: string) => void;
}

export const MasterRegistryView: React.FC<MasterRegistryViewProps> = ({
  db,
  onRefreshState,
  onInspectInvitee,
}) => {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [onlyDuplicates, setOnlyDuplicates] = useState(false);

  const [editingInvitee, setEditingInvitee] = useState<Invitee | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Invitee | null>(null);
  const [mergeTarget, setMergeTarget] = useState<Invitee | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Add/Edit form state
  const [formState, setFormState] = useState<{
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
    rsvpStatus: ResponseStatus;
    notes: string;
  }>({
    inviteeId: '',
    name: '',
    designation: '',
    organisation: '',
    category: 'Delegate',
    email: '',
    phone: '',
    city: '',
    vipTier: 'Standard',
    invitationSent: true,
    rsvpStatus: 'Awaiting Response',
    notes: '',
  });

  // Excel/CSV preview rows
  const [importRows, setImportRows] = useState<Array<Record<string, any>>>([]);
  const [importFileName, setImportFileName] = useState('');

  const duplicateRecords = useMemo(
    () => db.invitees.filter((i) => Boolean(i.duplicateOfId)),
    [db.invitees]
  );

  const filteredInvitees = useMemo(() => {
    const q = search.trim().toLowerCase();
    return db.invitees.filter((inv) => {
      if (onlyDuplicates && !inv.duplicateOfId) return false;
      if (!onlyDuplicates && statusFilter !== 'ALL' && inv.rsvpStatus !== statusFilter) return false;
      if (categoryFilter !== 'ALL' && inv.category !== categoryFilter) return false;
      if (q) {
        const hay = `${inv.inviteeId} ${inv.name} ${inv.designation} ${inv.organisation} ${inv.email} ${inv.phone}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [db.invitees, search, statusFilter, categoryFilter, onlyDuplicates]);

  const openAdd = () => {
    setFormState({
      inviteeId: '',
      name: '',
      designation: '',
      organisation: '',
      category: 'Delegate',
      email: '',
      phone: '',
      city: '',
      vipTier: 'Standard',
      invitationSent: true,
      rsvpStatus: 'Awaiting Response',
      notes: '',
    });
    setEditingInvitee(null);
    setErrorMsg(null);
    setShowAddModal(true);
  };

  const openEdit = (inv: Invitee) => {
    setFormState({
      inviteeId: inv.inviteeId,
      name: inv.name,
      designation: inv.designation,
      organisation: inv.organisation,
      category: inv.category,
      email: inv.email,
      phone: inv.phone,
      city: inv.city,
      vipTier: inv.vipTier,
      invitationSent: inv.invitationSent,
      rsvpStatus: inv.rsvpStatus,
      notes: inv.notes,
    });
    setEditingInvitee(inv);
    setErrorMsg(null);
    setShowAddModal(true);
  };

  const handleSaveInvitee = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErrorMsg(null);
    try {
      const url = editingInvitee
        ? `/api/invitees/${encodeURIComponent(editingInvitee.inviteeId)}`
        : '/api/invitees';
      const method = editingInvitee ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formState),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save invitee');
      onRefreshState(data.db, data.metrics);
      setShowAddModal(false);
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/invitees/${encodeURIComponent(deleteTarget.inviteeId)}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (res.ok) onRefreshState(data.db, data.metrics);
    } finally {
      setBusy(false);
      setDeleteTarget(null);
    }
  };

  const handleMergeDuplicate = async () => {
    if (!mergeTarget || !mergeTarget.duplicateOfId) return;
    setBusy(true);
    try {
      const res = await fetch('/api/invitees/merge-duplicate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          duplicateId: mergeTarget.inviteeId,
          targetId: mergeTarget.duplicateOfId,
        }),
      });
      const data = await res.json();
      if (res.ok) onRefreshState(data.db, data.metrics);
    } finally {
      setBusy(false);
      setMergeTarget(null);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportFileName(file.name);
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const firstSheet = wb.SheetNames[0];
    const rows = XLSX.utils.sheet_to_json<Record<string, any>>(wb.Sheets[firstSheet], { defval: '' });
    setImportRows(rows);
  };

  const handleCommitImport = async () => {
    if (importRows.length === 0) return;
    setBusy(true);
    setErrorMsg(null);
    try {
      const normalized = importRows.map((r) => ({
        inviteeId: r.inviteeId || r['Invitee ID'] || r.ID || '',
        name: r.name || r.Name || r['Full Name'] || '',
        designation: r.designation || r.Designation || r.Title || '',
        organisation: r.organisation || r.Organisation || r.Organization || r.Company || '',
        category: r.category || r.Category || 'Delegate',
        email: r.email || r.Email || r['Email ID'] || '',
        phone: r.phone || r.Phone || r.Mobile || r.Contact || '',
        city: r.city || r.City || '',
        vipTier: r.vipTier || r['VIP Tier'] || 'Standard',
        rsvpStatus: r.rsvpStatus || r['RSVP Status'] || undefined,
      }));

      const res = await fetch('/api/invitees/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: normalized, channel: 'Excel Import', mode: 'create' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Import failed');
      onRefreshState(data.db, data.metrics);
      setShowImportModal(false);
      setImportRows([]);
      setImportFileName('');
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setBusy(false);
    }
  };

  const downloadSampleTemplate = () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      [
        'Invitee ID',
        'Name',
        'Designation',
        'Organisation',
        'Category',
        'Email',
        'Phone',
        'City',
        'VIP Tier',
        'RSVP Status',
      ],
    ]);
    XLSX.utils.book_append_sheet(wb, ws, 'Master_Invitees_Template');
    XLSX.writeFile(wb, 'SummitOps-Invitee-Template.xlsx');
  };

  return (
    <div className="space-y-4">
      {/* Duplicate Alert Strip (only shown when duplicates exist) */}
      {duplicateRecords.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 text-xs text-amber-900">
            <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
            <span>
              <strong>{duplicateRecords.length} duplicate invitee record(s)</strong> detected across imported sheets. Merge them into their canonical Invitee ID to prevent duplicate counting.
            </span>
          </div>
          <button
            type="button"
            onClick={() => setOnlyDuplicates((prev) => !prev)}
            className="px-3 py-1.5 text-xs font-medium bg-white border border-amber-300 text-amber-900 rounded hover:bg-amber-100 whitespace-nowrap"
          >
            {onlyDuplicates ? 'Show All Records' : 'Review Flagged Duplicates'}
          </button>
        </div>
      )}

      {/* Action & Filter Toolbar */}
      <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5 flex-1 min-w-[260px]">
          <div className="relative flex-1 max-w-xs">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search ID, name, org, email..."
              className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
            />
          </div>

          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setOnlyDuplicates(false);
            }}
            aria-label="Filter by RSVP status"
            className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-md bg-white text-slate-700"
          >
            <option value="ALL">All RSVP Statuses</option>
            {RESPONSE_STATUSES.map((st) => (
              <option key={st} value={st}>
                {st}
              </option>
            ))}
          </select>

          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            aria-label="Filter by category"
            className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-md bg-white text-slate-700"
          >
            <option value="ALL">All Categories</option>
            {INVITEE_CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => {
              setImportRows([]);
              setImportFileName('');
              setShowImportModal(true);
            }}
            className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Import Excel/CSV</span>
          </button>
          <button
            type="button"
            onClick={openAdd}
            className="px-3.5 py-1.5 text-xs font-medium text-white bg-blue-700 rounded-md hover:bg-blue-800 inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Invitee</span>
          </button>
        </div>
      </div>

      {/* Master Invitee Data Table */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-slate-500 font-medium">
                <th className="py-2.5 px-3 whitespace-nowrap">Invitee ID</th>
                <th className="py-2.5 px-3">Invitee & Designation</th>
                <th className="py-2.5 px-3">Category / Tier</th>
                <th className="py-2.5 px-3">Contact</th>
                <th className="py-2.5 px-3">RSVP Status</th>
                <th className="py-2.5 px-3">Logistics Status</th>
                <th className="py-2.5 px-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredInvitees.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-slate-500">
                    No invitees match your current search or filter criteria.
                  </td>
                </tr>
              ) : (
                filteredInvitees.map((inv) => {
                  const logi = db.logistics[inv.inviteeId];
                  const logiStatus = inv.confirmedParticipation
                    ? logi?.logisticsStatus ?? 'Pending'
                    : 'Not Applicable';
                  return (
                    <tr
                      key={inv.inviteeId}
                      className={`hover:bg-slate-50 transition-colors ${
                        inv.duplicateOfId ? 'bg-amber-50/40' : ''
                      }`}
                    >
                      <td className="py-2.5 px-3 align-top whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => onInspectInvitee(inv.inviteeId)}
                          className="font-mono font-medium text-blue-700 hover:underline tabular-nums"
                        >
                          {inv.inviteeId}
                        </button>
                        {inv.duplicateOfId && (
                          <div className="mt-0.5 text-[11px] font-medium text-red-700">
                            Dup of {inv.duplicateOfId}
                          </div>
                        )}
                      </td>

                      <td className="py-2.5 px-3 align-top max-w-[240px]">
                        <div className="font-medium text-slate-900 truncate">{inv.name}</div>
                        <div className="text-slate-500 truncate">
                          {[inv.designation, inv.organisation].filter(Boolean).join(' · ')}
                        </div>
                      </td>

                      <td className="py-2.5 px-3 align-top whitespace-nowrap">
                        <div className="text-slate-800">{inv.category}</div>
                        <div className="text-[11px] text-slate-500 font-mono">
                          {inv.vipTier} · {inv.city || '—'}
                        </div>
                      </td>

                      <td className="py-2.5 px-3 align-top">
                        <div className="text-slate-700 truncate max-w-[190px]">{inv.email}</div>
                        <div className="text-[11px] font-mono tabular-nums text-slate-500">
                          {inv.phone || '—'}
                        </div>
                      </td>

                      <td className="py-2.5 px-3 align-top whitespace-nowrap">
                        <StatusText status={inv.rsvpStatus} />
                        <div className="text-[11px] text-slate-500 mt-0.5">
                          {inv.lastResponseChannel ? `${inv.lastResponseChannel}` : inv.invitationSent ? `Sent ${inv.invitationSentDate ?? ''}` : 'Not Sent'}
                          {inv.responseCount > 1 && (
                            <span className="ml-1 font-mono text-slate-700">
                              · {inv.responseCount}x merged
                            </span>
                          )}
                        </div>
                      </td>

                      <td className="py-2.5 px-3 align-top whitespace-nowrap">
                        {inv.confirmedParticipation ? (
                          <div>
                            <StatusText status={logiStatus} />
                            {logi?.revisionFlag && (
                              <div className="text-[11px] font-medium text-red-700 mt-0.5">
                                Schedule revision flagged
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>

                      <td className="py-2.5 px-3 align-top text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          {inv.duplicateOfId && (
                            <button
                              type="button"
                              onClick={() => setMergeTarget(inv)}
                              title={`Merge into ${inv.duplicateOfId}`}
                              className="p-1.5 text-amber-700 hover:bg-amber-100 rounded"
                            >
                              <GitMerge className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => onInspectInvitee(inv.inviteeId)}
                            title="Inspect unified Invitee ID record"
                            className="p-1.5 text-slate-500 hover:text-blue-700 hover:bg-slate-100 rounded"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => openEdit(inv)}
                            title="Edit invitee"
                            className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeleteTarget(inv)}
                            title="Remove invitee"
                            className="p-1.5 text-slate-400 hover:text-red-700 hover:bg-red-50 rounded"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-2.5 border-t border-slate-200 bg-slate-50 flex items-center justify-between text-xs text-slate-500">
          <span className="tabular-nums">
            Showing {filteredInvitees.length} of {db.invitees.length} records ({duplicateRecords.length} flagged duplicates)
          </span>
          <span>Unique Invitee ID primary key enforced across all channels</span>
        </div>
      </div>

      {/* Add / Edit Invitee Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-2xl bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900">
                {editingInvitee ? `Edit Invitee · ${editingInvitee.inviteeId}` : 'Add Master Invitee Record'}
              </h3>
              <button type="button" onClick={() => setShowAddModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSaveInvitee} className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
              {errorMsg && (
                <div className="p-3 text-xs text-red-800 bg-red-50 border border-red-200 rounded">{errorMsg}</div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Invitee ID (Leave blank to auto-assign)
                  </label>
                  <input
                    type="text"
                    value={formState.inviteeId}
                    disabled={Boolean(editingInvitee)}
                    onChange={(e) => setFormState({ ...formState, inviteeId: e.target.value })}
                    placeholder="e.g. INV-2026-021"
                    className="w-full px-3 py-1.5 text-xs font-mono border border-slate-300 rounded-md disabled:bg-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Full Name *</label>
                  <input
                    type="text"
                    required
                    value={formState.name}
                    onChange={(e) => setFormState({ ...formState, name: e.target.value })}
                    className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Designation</label>
                  <input
                    type="text"
                    value={formState.designation}
                    onChange={(e) => setFormState({ ...formState, designation: e.target.value })}
                    className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Organisation</label>
                  <input
                    type="text"
                    value={formState.organisation}
                    onChange={(e) => setFormState({ ...formState, organisation: e.target.value })}
                    className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Category</label>
                  <select
                    value={formState.category}
                    onChange={(e) => setFormState({ ...formState, category: e.target.value as InviteeCategory })}
                    className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-md bg-white"
                  >
                    {INVITEE_CATEGORIES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">VIP Tier</label>
                  <select
                    value={formState.vipTier}
                    onChange={(e) => setFormState({ ...formState, vipTier: e.target.value as VipTier })}
                    className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-md bg-white"
                  >
                    <option value="VVIP">VVIP</option>
                    <option value="VIP">VIP</option>
                    <option value="Standard">Standard</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Email ID *</label>
                  <input
                    type="email"
                    required
                    value={formState.email}
                    onChange={(e) => setFormState({ ...formState, email: e.target.value })}
                    className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Phone / Contact</label>
                  <input
                    type="text"
                    value={formState.phone}
                    onChange={(e) => setFormState({ ...formState, phone: e.target.value })}
                    className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">City / Origin</label>
                  <input
                    type="text"
                    value={formState.city}
                    onChange={(e) => setFormState({ ...formState, city: e.target.value })}
                    className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">RSVP Status</label>
                  <select
                    value={formState.rsvpStatus}
                    onChange={(e) => setFormState({ ...formState, rsvpStatus: e.target.value as ResponseStatus })}
                    className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-md bg-white"
                  >
                    {RESPONSE_STATUSES.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="inline-flex items-center gap-2 text-xs text-slate-700">
                  <input
                    type="checkbox"
                    checked={formState.invitationSent}
                    onChange={(e) => setFormState({ ...formState, invitationSent: e.target.checked })}
                  />
                  <span>Official Invitation Issued</span>
                </label>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Protocol / Event Notes</label>
                <textarea
                  rows={2}
                  value={formState.notes}
                  onChange={(e) => setFormState({ ...formState, notes: e.target.value })}
                  className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-md"
                />
              </div>
              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="px-4 py-2 text-xs font-medium text-white bg-blue-700 rounded-md hover:bg-blue-800 disabled:opacity-50"
                >
                  {busy ? 'Saving...' : 'Save Invitee Record'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Excel / CSV Import Modal */}
      {showImportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-2xl bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900">Import Master Invitee Spreadsheet (.xlsx / .csv)</h3>
              <button type="button" onClick={() => setShowImportModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50 border border-slate-200 rounded-md p-3">
                <p className="text-xs text-slate-600">
                  Upload any Excel or CSV contact sheet. Existing emails/phones are automatically flagged for duplicate reconciliation.
                </p>
                <button
                  type="button"
                  onClick={downloadSampleTemplate}
                  className="px-3 py-1.5 text-xs font-medium text-blue-700 bg-white border border-blue-200 rounded hover:bg-blue-50 inline-flex items-center gap-1.5 whitespace-nowrap"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download Template</span>
                </button>
              </div>

              <div>
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleFileSelect}
                  className="block w-full text-xs text-slate-600 file:mr-3 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-xs file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                />
              </div>

              {importRows.length > 0 && (
                <div className="border border-slate-200 rounded-md overflow-hidden">
                  <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 text-xs font-medium text-slate-700">
                    Previewing {importRows.length} rows from {importFileName}
                  </div>
                  <div className="max-h-52 overflow-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                        <tr>
                          {Object.keys(importRows[0]).slice(0, 5).map((k) => (
                            <th key={k} className="py-2 px-3 font-medium">{k}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {importRows.slice(0, 6).map((row, idx) => (
                          <tr key={idx}>
                            {Object.keys(importRows[0]).slice(0, 5).map((k) => (
                              <td key={k} className="py-1.5 px-3 text-slate-700 truncate max-w-[140px]">
                                {String(row[k] ?? '')}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowImportModal(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={busy || importRows.length === 0}
                  onClick={handleCommitImport}
                  className="px-4 py-2 text-xs font-medium text-white bg-blue-700 rounded-md hover:bg-blue-800 disabled:opacity-50"
                >
                  {busy ? 'Importing...' : `Import ${importRows.length} Records`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete Master Invitee Record?"
        description={`Are you sure you want to delete ${deleteTarget?.name} (${deleteTarget?.inviteeId})? This will also remove their linked logistics profile and booking allocations.`}
        confirmLabel="Delete Record"
        destructive
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
      />

      <ConfirmDialog
        open={Boolean(mergeTarget)}
        title="Merge Duplicate Invitee Record?"
        description={`Consolidate ${mergeTarget?.inviteeId} (${mergeTarget?.name}) into canonical record ${mergeTarget?.duplicateOfId}? Response history and contact fields will be preserved on the primary ID.`}
        confirmLabel="Merge & Deduplicate"
        onConfirm={handleMergeDuplicate}
        onCancel={() => setMergeTarget(null)}
      />
    </div>
  );
};
