import React, { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  LayoutDashboard,
  Users,
  MailCheck,
  Plane,
  Hotel,
  FileBarChart2,
  Settings,
  Menu,
  X,
  Download,
  RotateCcw,
} from 'lucide-react';
import type { DashboardMetrics, EventDatabase } from './types/event';
import { OverviewDashboard, type WorkspaceTab } from './components/OverviewDashboard';
import { MasterRegistryView } from './components/MasterRegistryView';
import { ResponseSyncView } from './components/ResponseSyncView';
import { LogisticsView } from './components/LogisticsView';
import { BookingsView } from './components/BookingsView';
import { ReportsView } from './components/ReportsView';
import { InviteeDetailDrawer } from './components/InviteeDetailDrawer';
import { ConfirmDialog } from './components/ConfirmDialog';
import {
  initWorkspaceAuth,
  signInWithGoogleWorkspace,
  signOutGoogleWorkspace,
} from './services/googleWorkspaceAuth';
import { buildAllReports, exportMasterWorkbookToExcel } from './utils/exportReports';

const NAV_ITEMS: Array<{ id: WorkspaceTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'overview', label: 'Executive Overview', icon: LayoutDashboard },
  { id: 'registry', label: 'Master Invitee DB', icon: Users },
  { id: 'responses', label: 'Response & Workspace', icon: MailCheck },
  { id: 'logistics', label: 'Logistics Tracking', icon: Plane },
  { id: 'bookings', label: 'Bookings & Fleet', icon: Hotel },
  { id: 'reports', label: 'Reports & Export', icon: FileBarChart2 },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('overview');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [db, setDb] = useState<EventDatabase | null>(null);
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [inspectedInviteeId, setInspectedInviteeId] = useState<string | null>(null);

  // Google Workspace Auth state (in-memory token only)
  const [workspaceUser, setWorkspaceUser] = useState<User | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  // Event Meta & Reset modals
  const [showEventSettings, setShowEventSettings] = useState(false);
  const [metaDraft, setMetaDraft] = useState({ eventName: '', eventDates: '', venue: '', city: '' });
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);

  const fetchInitialState = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch('/api/state');
      if (!res.ok) throw new Error('Failed to load event database');
      const data = await res.json();
      setDb(data.db);
      setMetrics(data.metrics);
    } catch (err: any) {
      setLoadError(err.message || 'Unable to connect to server');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInitialState();
    const unsubscribe = initWorkspaceAuth(
      (user, token) => {
        setWorkspaceUser(user);
        setAccessToken(token);
      },
      (user) => {
        setWorkspaceUser(user);
        setAccessToken(null);
      }
    );
    return () => unsubscribe();
  }, []);

  const handleRefreshState = (nextDb: EventDatabase, nextMetrics: DashboardMetrics) => {
    setDb(nextDb);
    setMetrics(nextMetrics);
  };

  const handleGoogleSignIn = async () => {
    setAuthError(null);
    try {
      const { user, accessToken: token } = await signInWithGoogleWorkspace();
      setWorkspaceUser(user);
      setAccessToken(token);
    } catch (err: any) {
      setAuthError(err?.message || 'Google Workspace sign-in failed.');
    }
  };

  const handleGoogleSignOut = async () => {
    await signOutGoogleWorkspace();
    setWorkspaceUser(null);
    setAccessToken(null);
  };

  const openEventSettings = () => {
    if (!db) return;
    setMetaDraft({
      eventName: db.meta.eventName,
      eventDates: db.meta.eventDates,
      venue: db.meta.venue,
      city: db.meta.city,
    });
    setShowEventSettings(true);
  };

  const handleSaveEventMeta = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch('/api/event-meta', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(metaDraft),
    });
    const data = await res.json();
    if (res.ok) {
      handleRefreshState(data.db, data.metrics);
      setShowEventSettings(false);
    }
  };

  const handleResetWorkspace = async () => {
    const res = await fetch('/api/reset-seed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ empty: true }),
    });
    const data = await res.json();
    if (res.ok) {
      handleRefreshState(data.db, data.metrics);
    }
    setConfirmClearOpen(false);
    setShowEventSettings(false);
  };

  const activeNavLabel = NAV_ITEMS.find((n) => n.id === activeTab)?.label ?? 'Executive Overview';

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:flex-col w-64 bg-white border-r border-slate-200 shrink-0">
        <div className="h-14 px-5 border-b border-slate-200 flex items-center justify-between">
          <span className="font-display text-base font-bold tracking-tight text-slate-900 whitespace-nowrap">
            SummitOps
          </span>
        </div>

        {/* Event Context Box */}
        <div className="px-4 py-3.5 border-b border-slate-200 bg-slate-50/70">
          <div className="text-[11px] font-medium text-slate-500">Active Event</div>
          <div className="text-xs font-semibold text-slate-900 mt-0.5 leading-snug">
            {db?.meta.eventName || 'Loading event...'}
          </div>
          {db && (
            <div className="text-[11px] text-slate-500 mt-1 font-mono tabular-nums">
              {db.meta.eventDates} · {db.meta.city}
            </div>
          )}
          <button
            type="button"
            onClick={openEventSettings}
            className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-blue-700 hover:text-blue-900"
          >
            <Settings className="w-3 h-3" />
            <span>Configure Event</span>
          </button>
        </div>

        {/* Primary Navigation */}
        <nav className="flex-1 p-3 space-y-1" aria-label="Primary sections">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            const badgeCount =
              item.id === 'responses' && metrics
                ? metrics.pendingVerification
                : item.id === 'bookings' && metrics
                ? metrics.revisionRequiredCount
                : item.id === 'registry' && metrics
                ? metrics.duplicateFlaggedCount
                : 0;

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                  isActive
                    ? 'bg-blue-50 text-blue-800'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <span className="inline-flex items-center gap-2.5 truncate">
                  <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-blue-700' : 'text-slate-400'}`} />
                  <span className="truncate">{item.label}</span>
                </span>
                {badgeCount > 0 && (
                  <span className="font-mono text-[11px] tabular-nums text-amber-700 font-semibold">
                    {badgeCount}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Bottom Workspace Status */}
        <div className="p-4 border-t border-slate-200 text-xs">
          <div className="text-slate-500 mb-1">Google Workspace</div>
          {accessToken && workspaceUser ? (
            <div className="text-emerald-800 font-medium truncate">
              Connected: {workspaceUser.email}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setActiveTab('responses')}
              className="text-blue-700 hover:underline font-medium"
            >
              Connect Gmail / Forms / Sheets
            </button>
          )}
        </div>
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="fixed inset-0 bg-slate-900/40" onClick={() => setMobileMenuOpen(false)} />
          <aside className="relative w-64 bg-white h-full border-r border-slate-200 flex flex-col z-10">
            <div className="h-14 px-5 border-b border-slate-200 flex items-center justify-between">
              <span className="font-display text-base font-bold text-slate-900">SummitOps</span>
              <button type="button" onClick={() => setMobileMenuOpen(false)} aria-label="Close navigation">
                <X className="w-4 h-4 text-slate-500" />
              </button>
            </div>
            <nav className="p-3 space-y-1">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setActiveTab(item.id);
                      setMobileMenuOpen(false);
                    }}
                    className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-md text-xs font-medium ${
                      isActive ? 'bg-blue-50 text-blue-800' : 'text-slate-600'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar Contract: Breadcrumb on left, 1 primary action on right */}
        <header className="h-14 bg-white border-b border-slate-200 px-4 sm:px-6 flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-1.5 text-slate-600 hover:bg-slate-100 rounded"
              aria-label="Open menu"
            >
              <Menu className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-2 text-xs text-slate-500 truncate">
              <span className="hidden sm:inline font-medium text-slate-700 truncate max-w-[240px]">
                {db?.meta.eventName || 'Event Command'}
              </span>
              <span className="hidden sm:inline text-slate-300" aria-hidden="true">/</span>
              <span className="font-semibold text-slate-900 whitespace-nowrap">{activeNavLabel}</span>
            </div>
          </div>

          <div className="shrink-0">
            <button
              type="button"
              disabled={!db || !metrics}
              onClick={() => {
                if (!db || !metrics) return;
                const reports = buildAllReports(db, metrics);
                exportMasterWorkbookToExcel(reports, db.meta.eventName);
              }}
              className="px-3.5 py-1.5 text-xs font-medium text-white bg-blue-700 rounded-md hover:bg-blue-800 disabled:opacity-50 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export Master Excel</span>
            </button>
          </div>
        </header>

        {/* Viewport Body */}
        <main className="flex-1 p-4 sm:p-6 max-w-[1440px] w-full mx-auto">
          {authError && (
            <div className="mb-4 bg-red-50 border border-red-200 text-red-800 rounded-lg px-4 py-3 text-xs">
              {authError}
            </div>
          )}

          {loading ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                {[1, 2, 3, 4].map((n) => (
                  <div key={n} className="h-32 bg-white border border-slate-200 rounded-lg animate-pulse" />
                ))}
              </div>
              <div className="h-80 bg-white border border-slate-200 rounded-lg animate-pulse" />
            </div>
          ) : loadError || !db || !metrics ? (
            <div className="bg-white border border-slate-200 rounded-lg p-8 text-center">
              <p className="text-sm text-red-700 font-medium">{loadError || 'Unable to load dashboard state.'}</p>
              <button
                type="button"
                onClick={fetchInitialState}
                className="mt-3 px-4 py-2 text-xs font-medium text-white bg-blue-700 rounded-md"
              >
                Retry
              </button>
            </div>
          ) : (
            <>
              {activeTab === 'overview' && (
                <OverviewDashboard
                  db={db}
                  metrics={metrics}
                  onNavigate={(tab) => setActiveTab(tab)}
                  onInspectInvitee={(id) => setInspectedInviteeId(id)}
                />
              )}
              {activeTab === 'registry' && (
                <MasterRegistryView
                  db={db}
                  onRefreshState={handleRefreshState}
                  onInspectInvitee={(id) => setInspectedInviteeId(id)}
                />
              )}
              {activeTab === 'responses' && (
                <ResponseSyncView
                  db={db}
                  workspaceUser={workspaceUser}
                  accessToken={accessToken}
                  onSignIn={handleGoogleSignIn}
                  onSignOut={handleGoogleSignOut}
                  onRefreshState={handleRefreshState}
                  onInspectInvitee={(id) => setInspectedInviteeId(id)}
                />
              )}
              {activeTab === 'logistics' && (
                <LogisticsView
                  db={db}
                  onRefreshState={handleRefreshState}
                  onInspectInvitee={(id) => setInspectedInviteeId(id)}
                />
              )}
              {activeTab === 'bookings' && (
                <BookingsView
                  db={db}
                  metrics={metrics}
                  onRefreshState={handleRefreshState}
                  onInspectInvitee={(id) => setInspectedInviteeId(id)}
                />
              )}
              {activeTab === 'reports' && <ReportsView db={db} metrics={metrics} />}
            </>
          )}
        </main>
      </div>

      {/* Unified Invitee ID 360 Drawer */}
      <InviteeDetailDrawer
        inviteeId={inspectedInviteeId}
        db={db ?? { meta: { eventId: '', eventName: '', eventDates: '', venue: '', city: '', lastSyncedAt: null }, invitees: [], responseLogs: [], logistics: {}, bookings: [] }}
        onClose={() => setInspectedInviteeId(null)}
      />

      {/* Event Settings Modal */}
      {showEventSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-lg bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900">Event Configuration & Workspace Data</h3>
              <button type="button" onClick={() => setShowEventSettings(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSaveEventMeta} className="p-6 space-y-4 text-xs">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Event Title</label>
                <input
                  type="text"
                  required
                  value={metaDraft.eventName}
                  onChange={(e) => setMetaDraft({ ...metaDraft, eventName: e.target.value })}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Event Dates</label>
                  <input
                    type="text"
                    value={metaDraft.eventDates}
                    onChange={(e) => setMetaDraft({ ...metaDraft, eventDates: e.target.value })}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded font-mono"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Host City</label>
                  <input
                    type="text"
                    value={metaDraft.city}
                    onChange={(e) => setMetaDraft({ ...metaDraft, city: e.target.value })}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded"
                  />
                </div>
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Venue</label>
                <input
                  type="text"
                  value={metaDraft.venue}
                  onChange={(e) => setMetaDraft({ ...metaDraft, venue: e.target.value })}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded"
                />
              </div>

              <div className="pt-3 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmClearOpen(true)}
                  className="px-2.5 py-1.5 text-xs text-red-700 border border-red-200 rounded hover:bg-red-50 inline-flex items-center gap-1"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Clear All Records</span>
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-medium text-white bg-blue-700 rounded hover:bg-blue-800"
                >
                  Save Event Details
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmClearOpen}
        title="Clear All Event Records?"
        description="This will remove all current invitees, response logs, logistics profiles, and bookings so you can start with a clean event database."
        confirmLabel="Clear All Records"
        destructive
        onConfirm={handleResetWorkspace}
        onCancel={() => setConfirmClearOpen(false)}
      />
    </div>
  );
}
