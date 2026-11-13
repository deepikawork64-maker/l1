import React, { useMemo } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { ArrowRight, AlertCircle, CheckCircle2, Clock, CopyCheck } from 'lucide-react';
import type { DashboardMetrics, EventDatabase } from '../types/event';
import { INVITEE_CATEGORIES } from '../types/event';
import { StatusText } from './StatusText';

export type WorkspaceTab =
  | 'overview'
  | 'registry'
  | 'responses'
  | 'logistics'
  | 'bookings'
  | 'reports';

interface OverviewDashboardProps {
  db: EventDatabase;
  metrics: DashboardMetrics;
  onNavigate: (tab: WorkspaceTab, filterHint?: string) => void;
  onInspectInvitee: (inviteeId: string) => void;
}

export const OverviewDashboard: React.FC<OverviewDashboardProps> = ({
  db,
  metrics,
  onNavigate,
  onInspectInvitee,
}) => {
  const uniqueInvitees = useMemo(
    () => db.invitees.filter((i) => !i.duplicateOfId),
    [db.invitees]
  );

  const categoryChartData = useMemo(() => {
    return INVITEE_CATEGORIES.map((cat) => {
      const group = uniqueInvitees.filter((i) => i.category === cat);
      const confirmed = group.filter((i) => i.rsvpStatus === 'Confirmation Received').length;
      const regret = group.filter((i) => i.rsvpStatus === 'Regret Received').length;
      const pending = group.length - confirmed - regret;
      const shortName = cat
        .replace('Government Official', 'Govt Official')
        .replace('Industry Representative', 'Industry Rep');
      return {
        category: shortName,
        fullCategory: cat,
        Confirmed: confirmed,
        Pending: pending,
        Regret: regret,
        Total: group.length,
      };
    }).filter((d) => d.Total > 0);
  }, [uniqueInvitees]);

  const dateTrafficData = useMemo(() => {
    const map = new Map<string, { date: string; Arrivals: number; Departures: number }>();
    for (const inv of uniqueInvitees) {
      if (!inv.confirmedParticipation) continue;
      const logi = db.logistics[inv.inviteeId];
      if (!logi) continue;
      if (logi.arrivalDate) {
        const cur = map.get(logi.arrivalDate) ?? { date: logi.arrivalDate, Arrivals: 0, Departures: 0 };
        cur.Arrivals += 1;
        map.set(logi.arrivalDate, cur);
      }
      if (logi.departureDate) {
        const cur = map.get(logi.departureDate) ?? { date: logi.departureDate, Arrivals: 0, Departures: 0 };
        cur.Departures += 1;
        map.set(logi.departureDate, cur);
      }
    }
    return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [uniqueInvitees, db.logistics]);

  const urgentItems = useMemo(() => {
    const items: Array<{
      id: string;
      type: string;
      subject: string;
      detail: string;
      severity: 'crimson' | 'amber';
      targetTab: WorkspaceTab;
      inviteeId?: string;
    }> = [];

    // 1. Ambiguous responses pending verification
    for (const log of db.responseLogs.filter((l) => l.verificationState === 'Needs Verification')) {
      items.push({
        id: `verify-${log.id}`,
        type: 'Verification',
        subject: log.senderName || log.senderEmail,
        detail: `${log.channel}: ${log.aiRationale}`,
        severity: 'amber',
        targetTab: 'responses',
        inviteeId: log.inviteeId ?? undefined,
      });
    }

    // 2. Revision required bookings
    for (const bkg of db.bookings.filter((b) => b.status === 'Revision Required')) {
      const inv = db.invitees.find((i) => i.inviteeId === bkg.inviteeId);
      items.push({
        id: `rev-${bkg.id}`,
        type: 'Schedule Revision',
        subject: `${inv?.name ?? bkg.inviteeId} (${bkg.bookingType})`,
        detail: bkg.notes || 'Travel schedule changed after confirmation.',
        severity: 'crimson',
        targetTab: 'bookings',
        inviteeId: bkg.inviteeId,
      });
    }

    // 3. Duplicate entries flagged
    for (const dup of db.invitees.filter((i) => Boolean(i.duplicateOfId))) {
      items.push({
        id: `dup-${dup.inviteeId}`,
        type: 'Duplicate Flag',
        subject: `${dup.inviteeId} · ${dup.name}`,
        detail: dup.duplicateReason || `Matches ${dup.duplicateOfId}`,
        severity: 'crimson',
        targetTab: 'registry',
        inviteeId: dup.inviteeId,
      });
    }

    // 4. Confirmed guests with Pending logistics
    for (const inv of uniqueInvitees) {
      if (!inv.confirmedParticipation) continue;
      const logi = db.logistics[inv.inviteeId];
      if (!logi || logi.logisticsStatus === 'Pending' || logi.logisticsStatus === 'Partially Received') {
        items.push({
          id: `logi-${inv.inviteeId}`,
          type: 'Logistics Pending',
          subject: `${inv.inviteeId} · ${inv.name}`,
          detail:
            logi?.logisticsStatus === 'Partially Received'
              ? 'Partial travel details only; hotel/return schedule awaited.'
              : 'Participation confirmed, awaiting travel & accommodation details.',
          severity: 'amber',
          targetTab: 'logistics',
          inviteeId: inv.inviteeId,
        });
      }
    }

    // 5. Non-responders
    for (const inv of uniqueInvitees.filter((i) => i.rsvpStatus === 'No Response')) {
      items.push({
        id: `noresp-${inv.inviteeId}`,
        type: 'No Response',
        subject: `${inv.inviteeId} · ${inv.name}`,
        detail: `${inv.organisation} · Sent ${inv.invitationSentDate || 'N/A'}`,
        severity: 'amber',
        targetTab: 'registry',
        inviteeId: inv.inviteeId,
      });
    }

    return items.slice(0, 12);
  }, [db, uniqueInvitees]);

  const confirmPct = metrics.totalInvited
    ? Math.round((metrics.confirmationsReceived / metrics.totalInvited) * 100)
    : 0;
  const logisticsReadyCount = metrics.logisticsReceived + metrics.logisticsNotRequired;
  const logisticsPct = metrics.confirmedParticipation
    ? Math.round((logisticsReadyCount / metrics.confirmedParticipation) * 100)
    : 0;

  return (
    <div className="space-y-6">
      {uniqueInvitees.length === 0 && (
        <div className="bg-white border border-slate-200 rounded-lg p-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Your Event Database Is Empty</h2>
            <p className="text-xs text-slate-500 mt-1 max-w-2xl">
              Start by uploading your Master Invitee Excel/CSV sheet, adding invitees manually, or connecting Gmail, Google Forms, and Google Sheets to populate unique Invitee IDs.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => onNavigate('registry')}
              className="px-3.5 py-2 text-xs font-medium text-white bg-blue-700 rounded-md hover:bg-blue-800 whitespace-nowrap"
            >
              Add / Import Invitees
            </button>
            <button
              type="button"
              onClick={() => onNavigate('responses')}
              className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap"
            >
              Connect Google Workspace
            </button>
          </div>
        </div>
      )}

      {/* KPI Strip: 4 balanced single-elevation summary blocks */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Master Invitations</span>
            <span className="font-mono tabular-nums text-slate-400">Unique IDs</span>
          </div>
          <div className="mt-2 flex items-baseline gap-2.5">
            <span className="text-3xl font-semibold tracking-tight text-slate-900 font-display tabular-nums">
              {metrics.invitationsIssued}
            </span>
            <span className="text-xs text-slate-500 tabular-nums">
              of {metrics.totalInvited} records issued
            </span>
          </div>
          <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-600">
            <span>Duplicates flagged: <strong className="font-mono tabular-nums text-red-700">{metrics.duplicateFlaggedCount}</strong></span>
            <span>Consolidated: <strong className="font-mono tabular-nums text-slate-900">{metrics.multiResponseCount}</strong></span>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Confirmed Participation</span>
            <span className="font-mono tabular-nums text-emerald-700">{confirmPct}% rate</span>
          </div>
          <div className="mt-2 flex items-baseline gap-2.5">
            <span className="text-3xl font-semibold tracking-tight text-emerald-800 font-display tabular-nums">
              {metrics.confirmedParticipation}
            </span>
            <span className="text-xs text-slate-500 tabular-nums">
              Regrets: {metrics.regretsReceived}
            </span>
          </div>
          <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-600">
            <span>Awaited / None: <strong className="font-mono tabular-nums">{metrics.awaitingResponse + metrics.noResponse}</strong></span>
            <span>Verify Queue: <strong className="font-mono tabular-nums text-amber-700">{metrics.pendingVerification}</strong></span>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Logistics Details Status</span>
            <span className="font-mono tabular-nums text-blue-700">{logisticsPct}% ready</span>
          </div>
          <div className="mt-2 flex items-baseline gap-2.5">
            <span className="text-3xl font-semibold tracking-tight text-slate-900 font-display tabular-nums">
              {metrics.logisticsReceived}
            </span>
            <span className="text-xs text-slate-500 tabular-nums">
              received ({metrics.logisticsNotRequired} local)
            </span>
          </div>
          <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-600">
            <span>Partial: <strong className="font-mono tabular-nums text-amber-700">{metrics.logisticsPartial}</strong></span>
            <span>Pending: <strong className="font-mono tabular-nums text-red-700">{metrics.logisticsPending}</strong></span>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Bookings & Fleet Confirmed</span>
            <span className="font-mono tabular-nums text-slate-400">Allocations</span>
          </div>
          <div className="mt-2 flex items-baseline gap-3">
            <div>
              <span className="text-2xl font-semibold text-slate-900 font-display tabular-nums">
                {metrics.hotelConfirmedCount}/{metrics.hotelRequiredCount}
              </span>
              <span className="ml-1 text-xs text-slate-500">Hotels</span>
            </div>
            <span className="text-slate-300">/</span>
            <div>
              <span className="text-2xl font-semibold text-slate-900 font-display tabular-nums">
                {metrics.transportConfirmedCount}/{metrics.transportRequiredCount}
              </span>
              <span className="ml-1 text-xs text-slate-500">Transfers</span>
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-600">
            <span>Revision Alerts: <strong className="font-mono tabular-nums text-red-700">{metrics.revisionRequiredCount}</strong></span>
            <button
              type="button"
              onClick={() => onNavigate('bookings')}
              className="text-blue-700 hover:text-blue-900 font-medium inline-flex items-center gap-1"
            >
              <span>Manage</span>
              <ArrowRight className="w-3 h-3" />
            </button>
          </div>
        </div>
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-lg p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Category-wise Invitation & Confirmation Breakdown</h3>
              <p className="text-xs text-slate-500 mt-0.5">Unique invitee records grouped by profile classification</p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('registry')}
              className="text-xs font-medium text-blue-700 hover:text-blue-900 whitespace-nowrap shrink-0"
            >
              View Registry
            </button>
          </div>
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={categoryChartData} margin={{ top: 8, right: 12, left: -12, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                <XAxis
                  dataKey="category"
                  tick={{ fontSize: 11, fill: '#475569' }}
                  interval={0}
                  angle={-18}
                  textAnchor="end"
                  height={48}
                />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#475569' }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#FFFFFF',
                    borderColor: '#CBD5E1',
                    borderRadius: '6px',
                    fontSize: '12px',
                  }}
                />
                <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '4px' }} />
                <Bar dataKey="Confirmed" stackId="a" fill="#15803D" radius={[0, 0, 0, 0]} />
                <Bar dataKey="Pending" stackId="a" fill="#D97706" radius={[0, 0, 0, 0]} />
                <Bar dataKey="Regret" stackId="a" fill="#DC2626" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-lg p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Date-wise Arrival & Departure Load</h3>
              <p className="text-xs text-slate-500 mt-0.5">Confirmed guests requiring airport/station protocol by day</p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('logistics')}
              className="text-xs font-medium text-blue-700 hover:text-blue-900 whitespace-nowrap shrink-0"
            >
              Travel Sheet
            </button>
          </div>
          {dateTrafficData.length === 0 ? (
            <div className="h-72 flex items-center justify-center text-xs text-slate-500">
              No arrival or departure dates logged yet.
            </div>
          ) : (
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dateTrafficData} margin={{ top: 8, right: 12, left: -12, bottom: 12 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#475569' }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#475569' }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#FFFFFF',
                      borderColor: '#CBD5E1',
                      borderRadius: '6px',
                      fontSize: '12px',
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: '12px' }} />
                  <Bar dataKey="Arrivals" fill="#1D4ED8" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="Departures" fill="#64748B" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* Pending Actions & Category Table */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Pending Actions Requiring Immediate Attention</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Verification queues, schedule revisions, duplicate flags, and missing logistics
              </p>
            </div>
            <span className="font-mono text-xs tabular-nums text-slate-500">{urgentItems.length} open</span>
          </div>
          {urgentItems.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">
              <CheckCircle2 className="w-6 h-6 text-emerald-600 mx-auto mb-2" />
              All confirmations, duplicates, logistics, and bookings are currently reconciled.
            </div>
          ) : (
            <div className="divide-y divide-slate-100 max-h-96 overflow-y-auto">
              {urgentItems.map((item) => (
                <div
                  key={item.id}
                  className="px-5 py-3 flex items-center justify-between gap-4 hover:bg-slate-50 transition-colors"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-xs">
                      <span
                        className={`font-medium ${
                          item.severity === 'crimson' ? 'text-red-700' : 'text-amber-700'
                        }`}
                      >
                        {item.type}
                      </span>
                      <span className="text-slate-300" aria-hidden="true">·</span>
                      <button
                        type="button"
                        onClick={() => (item.inviteeId ? onInspectInvitee(item.inviteeId) : onNavigate(item.targetTab))}
                        className="font-medium text-slate-900 hover:text-blue-700 truncate text-left"
                      >
                        {item.subject}
                      </button>
                    </div>
                    <p className="text-xs text-slate-500 truncate mt-0.5">{item.detail}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onNavigate(item.targetTab)}
                    className="px-2.5 py-1 text-xs font-medium text-slate-700 border border-slate-200 rounded hover:bg-white hover:border-slate-300 shrink-0 whitespace-nowrap"
                  >
                    Resolve
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Category Readiness Matrix</h3>
              <p className="text-xs text-slate-500 mt-0.5">Participation vs. logistics completion by profile</p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('reports')}
              className="text-xs font-medium text-blue-700 hover:text-blue-900 whitespace-nowrap shrink-0"
            >
              Export PDF/XLS
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-500 font-medium">
                  <th className="py-2.5 px-4">Category</th>
                  <th className="py-2.5 px-2 text-right">Invited</th>
                  <th className="py-2.5 px-2 text-right">Confirmed</th>
                  <th className="py-2.5 px-2 text-right">Regret</th>
                  <th className="py-2.5 px-4 text-right">Logistics Ready</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {INVITEE_CATEGORIES.map((cat) => {
                  const group = uniqueInvitees.filter((i) => i.category === cat);
                  const conf = group.filter((i) => i.confirmedParticipation).length;
                  const reg = group.filter((i) => i.rsvpStatus === 'Regret Received').length;
                  const ready = group.filter(
                    (i) =>
                      i.confirmedParticipation &&
                      (db.logistics[i.inviteeId]?.logisticsStatus === 'Received' ||
                        db.logistics[i.inviteeId]?.logisticsStatus === 'Not Required')
                  ).length;
                  return (
                    <tr key={cat} className="hover:bg-slate-50">
                      <td className="py-2.5 px-4 font-medium text-slate-800">{cat}</td>
                      <td className="py-2.5 px-2 text-right font-mono tabular-nums text-slate-600">{group.length}</td>
                      <td className="py-2.5 px-2 text-right font-mono tabular-nums text-emerald-700 font-medium">{conf}</td>
                      <td className="py-2.5 px-2 text-right font-mono tabular-nums text-red-700">{reg}</td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-700">
                        {ready}/{conf}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-3 border-t border-slate-100 bg-slate-50 flex items-center justify-between text-xs text-slate-500">
            <span className="inline-flex items-center gap-1.5">
              <CopyCheck className="w-3.5 h-3.5 text-slate-400" />
              Keyed by unique Invitee ID
            </span>
            <span className="inline-flex items-center gap-1.5">
              {db.meta.lastSyncedAt ? (
                <>
                  <Clock className="w-3.5 h-3.5 text-slate-400" />
                  Synced {new Date(db.meta.lastSyncedAt).toLocaleTimeString()}
                </>
              ) : (
                <>
                  <AlertCircle className="w-3.5 h-3.5 text-slate-400" />
                  <StatusText status="Local Master Active" toneOverride="blue" />
                </>
              )}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
