import React, { useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  Mail,
  FileSpreadsheet,
  ClipboardList,
  RefreshCw,
  Check,
  XCircle,
  Send,
  LogOut,
  AlertCircle,
  Upload,
} from 'lucide-react';
import type { EventDatabase, ResponseLog, ResponseStatus } from '../types/event';
import { StatusText } from './StatusText';

interface ResponseSyncViewProps {
  db: EventDatabase;
  workspaceUser: User | null;
  accessToken: string | null;
  onSignIn: () => Promise<void>;
  onSignOut: () => Promise<void>;
  onRefreshState: (nextDb: EventDatabase, nextMetrics: any) => void;
  onInspectInvitee: (inviteeId: string) => void;
}

export const ResponseSyncView: React.FC<ResponseSyncViewProps> = ({
  db,
  workspaceUser,
  accessToken,
  onSignIn,
  onSignOut,
  onRefreshState,
  onInspectInvitee,
}) => {
  const [gmailQuery, setGmailQuery] = useState('newer_than:14d');
  const [formId, setFormId] = useState('');
  const [spreadsheetId, setSpreadsheetId] = useState('');
  const [sheetPreview, setSheetPreview] = useState<{
    spreadsheetTitle: string;
    tabs: string[];
    activeTab: string;
    values: string[][];
  } | null>(null);

  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  // Manual Email Analyzer form
  const [senderName, setSenderName] = useState('');
  const [senderEmail, setSenderEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');

  // Verification selection map: logId -> selected inviteeId
  const [verifyIdMap, setVerifyIdMap] = useState<Record<string, string>>({});
  const [logFilter, setLogFilter] = useState<'needs-verification' | 'all'>('needs-verification');

  const uniqueInvitees = useMemo(
    () => db.invitees.filter((i) => !i.duplicateOfId),
    [db.invitees]
  );

  const pendingLogs = useMemo(
    () => db.responseLogs.filter((l) => l.verificationState === 'Needs Verification'),
    [db.responseLogs]
  );

  const displayedLogs = logFilter === 'needs-verification' ? pendingLogs : db.responseLogs;

  const handleGmailSync = async () => {
    if (!accessToken) return;
    setBusyAction('gmail');
    setSyncError(null);
    setSyncMessage(null);
    try {
      const res = await fetch('/api/workspace/gmail/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ query: gmailQuery, maxResults: 12 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gmail sync failed');
      onRefreshState(data.db, data.metrics);
      setSyncMessage(
        `Gmail sync complete: ${data.syncedCount} relevant message(s) analyzed & linked, ${data.skippedCount} skipped/already processed.`
      );
    } catch (err: any) {
      setSyncError(err.message);
    } finally {
      setBusyAction(null);
    }
  };

  const handleFormsSync = async () => {
    if (!accessToken || !formId.trim()) return;
    setBusyAction('forms');
    setSyncError(null);
    setSyncMessage(null);
    try {
      const res = await fetch('/api/workspace/forms/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ formId: formId.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Google Forms sync failed');
      onRefreshState(data.db, data.metrics);
      setSyncMessage(
        `Google Form "${data.formTitle}" synced: ${data.syncedCount} submission(s) processed, ${data.skippedCount} already consolidated.`
      );
    } catch (err: any) {
      setSyncError(err.message);
    } finally {
      setBusyAction(null);
    }
  };

  const handleFetchSheet = async (tabOverride?: string) => {
    if (!accessToken || !spreadsheetId.trim()) return;
    setBusyAction('sheets');
    setSyncError(null);
    setSyncMessage(null);
    try {
      const res = await fetch('/api/workspace/sheets/fetch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          spreadsheetId: spreadsheetId.trim(),
          sheetTitle: tabOverride,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Google Sheets fetch failed');
      setSheetPreview(data);
    } catch (err: any) {
      setSyncError(err.message);
    } finally {
      setBusyAction(null);
    }
  };

  const handleImportSheetPreview = async () => {
    if (!sheetPreview || sheetPreview.values.length < 2) return;
    setBusyAction('sheets-import');
    setSyncError(null);
    try {
      const [headers, ...dataRows] = sheetPreview.values;
      const rows = dataRows.map((cols) => {
        const obj: Record<string, string> = {};
        headers.forEach((h, idx) => {
          obj[String(h).trim()] = String(cols[idx] ?? '').trim();
        });
        return obj;
      });
      const res = await fetch('/api/invitees/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows, channel: 'Google Sheet', mode: 'merge' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Sheet import failed');
      onRefreshState(data.db, data.metrics);
      setSyncMessage(
        `Google Sheet "${sheetPreview.spreadsheetTitle}" (${sheetPreview.activeTab}) imported: ${data.summary.createdCount} new, ${data.summary.updatedCount} updated, ${data.summary.duplicateFlaggedCount} duplicate(s) flagged.`
      );
      setSheetPreview(null);
    } catch (err: any) {
      setSyncError(err.message);
    } finally {
      setBusyAction(null);
    }
  };

  const handleAnalyzeManualEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!body.trim()) return;
    setBusyAction('analyze');
    setSyncError(null);
    setSyncMessage(null);
    try {
      const res = await fetch('/api/responses/analyze-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ senderName, senderEmail, subject, body }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Email analysis failed');
      onRefreshState(data.db, data.metrics);
      setSyncMessage(
        `Classified as "${data.logEntry.detectedStatus}" (${data.logEntry.confidence}% confidence)${
          data.matchedInvitee ? ` and linked to ${data.matchedInvitee.inviteeId}` : ' — queued for manual Invitee ID linking'
        }.`
      );
      setSenderName('');
      setSenderEmail('');
      setSubject('');
      setBody('');
    } catch (err: any) {
      setSyncError(err.message);
    } finally {
      setBusyAction(null);
    }
  };

  const handleUploadEmlFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    setBusyAction('eml');
    setSyncError(null);
    setSyncMessage(null);
    try {
      const files = await Promise.all(
        Array.from(fileList).slice(0, 25).map(async (f) => ({
          filename: f.name,
          content: await f.text(),
        }))
      );
      const res = await fetch('/api/responses/import-eml', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to import .eml files');
      onRefreshState(data.db, data.metrics);
      setSyncMessage(
        `Processed ${data.importedCount} .eml email file(s) (${data.skippedCount} skipped/duplicates). Check the Verification Queue for any unmatched items.`
      );
    } catch (err: any) {
      setSyncError(err.message);
    } finally {
      setBusyAction(null);
      e.target.value = '';
    }
  };

  const handleVerifyLog = async (
    log: ResponseLog,
    finalStatus: ResponseStatus | 'Dismiss'
  ) => {
    setBusyAction(log.id);
    setSyncError(null);
    try {
      const chosenId = verifyIdMap[log.id] || log.inviteeId || '';
      const res = await fetch(`/api/responses/${encodeURIComponent(log.id)}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          finalStatus === 'Dismiss'
            ? { dismiss: true }
            : { inviteeId: chosenId, finalStatus }
        ),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Verification failed');
      onRefreshState(data.db, data.metrics);
    } catch (err: any) {
      setSyncError(err.message);
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Feedback Banners */}
      {syncMessage && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-lg px-4 py-3 text-xs">
          {syncMessage}
        </div>
      )}
      {syncError && (
        <div className="bg-red-50 border border-red-200 text-red-900 rounded-lg px-4 py-3 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-red-700 shrink-0" />
          <span>{syncError}</span>
        </div>
      )}

      {/* Google Workspace Live Sync Hub */}
      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-200">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Google Workspace Channel Integration</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Connect Gmail, Google Forms, and Google Sheets to ingest responses and map them to canonical Invitee IDs.
            </p>
          </div>
          {accessToken && workspaceUser ? (
            <div className="flex items-center gap-3">
              <div className="text-right text-xs">
                <div className="font-medium text-slate-900">{workspaceUser.displayName || workspaceUser.email}</div>
                <div className="text-emerald-700 font-mono text-[11px]">Workspace Connected</div>
              </div>
              <button
                type="button"
                onClick={onSignOut}
                className="px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-300 rounded-md hover:bg-slate-50 inline-flex items-center gap-1.5"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Disconnect</span>
              </button>
            </div>
          ) : (
            <button type="button" onClick={onSignIn} className="gsi-material-button">
              <div className="gsi-material-button-content-wrapper">
                <div className="gsi-material-button-icon">
                  <svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" style={{ display: 'block' }}>
                    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
                    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
                    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
                    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
                  </svg>
                </div>
                <span className="gsi-material-button-contents">Sign in with Google</span>
              </div>
            </button>
          )}
        </div>

        <div className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Gmail Channel */}
          <div className="border border-slate-200 rounded-md p-4 space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-900">
              <Mail className="w-4 h-4 text-blue-700" />
              <span>Gmail Official Inbox Sync</span>
            </div>
            <p className="text-xs text-slate-500">
              Scans inbox threads, matches sender to Invitee ID, and auto-classifies Confirmation vs. Regret vs. Ambiguous.
            </p>
            <input
              type="text"
              value={gmailQuery}
              onChange={(e) => setGmailQuery(e.target.value)}
              placeholder="Gmail search query (e.g. newer_than:14d)"
              className="w-full px-2.5 py-1.5 text-xs font-mono border border-slate-300 rounded"
            />
            <button
              type="button"
              disabled={!accessToken || busyAction === 'gmail'}
              onClick={handleGmailSync}
              className="w-full px-3 py-1.5 text-xs font-medium text-white bg-blue-700 rounded hover:bg-blue-800 disabled:bg-slate-200 disabled:text-slate-500 inline-flex items-center justify-center gap-1.5"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${busyAction === 'gmail' ? 'animate-spin' : ''}`} />
              <span>{busyAction === 'gmail' ? 'Scanning Gmail...' : 'Sync Gmail Responses'}</span>
            </button>
          </div>

          {/* Google Forms Channel */}
          <div className="border border-slate-200 rounded-md p-4 space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-900">
              <ClipboardList className="w-4 h-4 text-blue-700" />
              <span>Google Forms RSVP & Logistics</span>
            </div>
            <p className="text-xs text-slate-500">
              Imports submissions from a linked Google Form ID and consolidates travel/stay answers by Invitee ID.
            </p>
            <input
              type="text"
              value={formId}
              onChange={(e) => setFormId(e.target.value)}
              placeholder="Google Form ID (from /forms/d/<ID>/edit)"
              className="w-full px-2.5 py-1.5 text-xs font-mono border border-slate-300 rounded"
            />
            <button
              type="button"
              disabled={!accessToken || !formId.trim() || busyAction === 'forms'}
              onClick={handleFormsSync}
              className="w-full px-3 py-1.5 text-xs font-medium text-white bg-blue-700 rounded hover:bg-blue-800 disabled:bg-slate-200 disabled:text-slate-500 inline-flex items-center justify-center gap-1.5"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${busyAction === 'forms' ? 'animate-spin' : ''}`} />
              <span>{busyAction === 'forms' ? 'Syncing Form...' : 'Pull Form Submissions'}</span>
            </button>
          </div>

          {/* Google Sheets Channel */}
          <div className="border border-slate-200 rounded-md p-4 space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-900">
              <FileSpreadsheet className="w-4 h-4 text-blue-700" />
              <span>Google Sheets Confirmation Sync</span>
            </div>
            <p className="text-xs text-slate-500">
              Reads any Google Sheet tab by Spreadsheet ID to merge invitation lists or logistics confirmation sheets.
            </p>
            <input
              type="text"
              value={spreadsheetId}
              onChange={(e) => setSpreadsheetId(e.target.value)}
              placeholder="Spreadsheet ID (from /spreadsheets/d/<ID>/)"
              className="w-full px-2.5 py-1.5 text-xs font-mono border border-slate-300 rounded"
            />
            <button
              type="button"
              disabled={!accessToken || !spreadsheetId.trim() || busyAction === 'sheets'}
              onClick={() => handleFetchSheet()}
              className="w-full px-3 py-1.5 text-xs font-medium text-white bg-blue-700 rounded hover:bg-blue-800 disabled:bg-slate-200 disabled:text-slate-500 inline-flex items-center justify-center gap-1.5"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${busyAction === 'sheets' ? 'animate-spin' : ''}`} />
              <span>{busyAction === 'sheets' ? 'Reading Sheet...' : 'Load Google Sheet'}</span>
            </button>
          </div>
        </div>

        {/* Google Sheet Preview Drawer */}
        {sheetPreview && (
          <div className="mt-4 border border-blue-200 bg-blue-50/30 rounded-md p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-semibold text-slate-900">
                {sheetPreview.spreadsheetTitle} · Tab:
                <select
                  value={sheetPreview.activeTab}
                  onChange={(e) => handleFetchSheet(e.target.value)}
                  className="ml-2 px-2 py-1 text-xs border border-slate-300 rounded bg-white"
                >
                  {sheetPreview.tabs.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSheetPreview(null)}
                  className="px-3 py-1 text-xs text-slate-600 border border-slate-300 rounded bg-white"
                >
                  Dismiss
                </button>
                <button
                  type="button"
                  disabled={busyAction === 'sheets-import'}
                  onClick={handleImportSheetPreview}
                  className="px-3 py-1 text-xs font-medium text-white bg-blue-700 rounded hover:bg-blue-800"
                >
                  Merge {Math.max(0, sheetPreview.values.length - 1)} Rows into Master DB
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Split Layout: Manual Email Classifier + Verification Queue */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Paste / Process Email Response */}
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-lg p-5">
          <h3 className="text-sm font-semibold text-slate-900">Automated Email Response Classifier</h3>
          <p className="text-xs text-slate-500 mt-0.5 mb-4">
            Ingest an email reply to detect Confirmation, Regret, or Ambiguous status and extract flight/hotel clues automatically.
          </p>
          <form onSubmit={handleAnalyzeManualEmail} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Sender Name</label>
                <input
                  type="text"
                  value={senderName}
                  onChange={(e) => setSenderName(e.target.value)}
                  placeholder="Invitee full name"
                  className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Sender Email</label>
                <input
                  type="email"
                  value={senderEmail}
                  onChange={(e) => setSenderEmail(e.target.value)}
                  placeholder="name@gov.in or name@gmail.com"
                  className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Subject</label>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Re: Event Invitation (INV-2026-001)"
                className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Email Body *</label>
              <textarea
                rows={5}
                required
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Paste email message text here..."
                className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded"
              />
            </div>
            <button
              type="submit"
              disabled={busyAction === 'analyze'}
              className="w-full px-4 py-2 text-xs font-medium text-white bg-slate-900 rounded-md hover:bg-slate-800 disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{busyAction === 'analyze' ? 'Classifying Response...' : 'Classify & Map to Invitee ID'}</span>
            </button>
          </form>

          <div className="mt-5 pt-4 border-t border-slate-200 space-y-2">
            <div className="text-xs font-semibold text-slate-900">
              Batch Upload `.eml` Emails (No Mailbox Password Needed)
            </div>
            <p className="text-[11px] text-slate-500">
              Download replies from NIC / `mail.gov.in` or Outlook as `.eml` files and upload up to 25 at once for automatic classification and Invitee ID mapping.
            </p>
            <label className="w-full px-3 py-2 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 cursor-pointer inline-flex items-center justify-center gap-1.5">
              <Upload className="w-3.5 h-3.5" />
              <span>{busyAction === 'eml' ? 'Processing .eml files...' : 'Select .eml Email File(s)'}</span>
              <input
                type="file"
                accept=".eml,message/rfc822"
                multiple
                disabled={busyAction === 'eml'}
                onChange={handleUploadEmlFiles}
                className="hidden"
              />
            </label>
          </div>
        </div>

        {/* Manual Verification & Consolidation Audit Log */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-lg overflow-hidden flex flex-col">
          <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Response Verification & Consolidation Queue</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Ambiguous emails require coordinator confirmation; matched responses deduplicate by Invitee ID.
              </p>
            </div>
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-md text-xs">
              <button
                type="button"
                onClick={() => setLogFilter('needs-verification')}
                className={`px-2.5 py-1 rounded font-medium whitespace-nowrap ${
                  logFilter === 'needs-verification' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                }`}
              >
                Pending Verify ({pendingLogs.length})
              </button>
              <button
                type="button"
                onClick={() => setLogFilter('all')}
                className={`px-2.5 py-1 rounded font-medium whitespace-nowrap ${
                  logFilter === 'all' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                }`}
              >
                All Logs ({db.responseLogs.length})
              </button>
            </div>
          </div>

          <div className="divide-y divide-slate-200 max-h-[540px] overflow-y-auto">
            {displayedLogs.length === 0 ? (
              <div className="p-10 text-center text-xs text-slate-500">
                No responses in this queue.
              </div>
            ) : (
              displayedLogs.map((log) => (
                <div key={log.id} className="p-4 space-y-2.5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2 text-xs">
                        <span className="font-semibold text-slate-900">{log.senderName}</span>
                        <span className="text-slate-400" aria-hidden="true">·</span>
                        <span className="text-slate-500">{log.senderEmail || 'No email'}</span>
                        <span className="text-slate-400" aria-hidden="true">·</span>
                        <span className="font-mono text-slate-600">{log.channel}</span>
                      </div>
                      <div className="text-xs font-medium text-slate-700 mt-0.5">{log.subject}</div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-[11px] tabular-nums text-slate-500">
                        {log.confidence}% conf.
                      </span>
                      <StatusText status={log.verificationState} />
                    </div>
                  </div>

                  <p className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded p-2.5 whitespace-pre-line">
                    {log.rawContent}
                  </p>

                  <div className="text-xs text-slate-600 flex flex-wrap items-center justify-between gap-2">
                    <span>
                      <strong>Analysis:</strong> {log.aiRationale}
                      {log.extractedLogisticsSummary ? ` · Travel clue: ${log.extractedLogisticsSummary}` : ''}
                    </span>
                    {log.inviteeId && (
                      <button
                        type="button"
                        onClick={() => onInspectInvitee(log.inviteeId!)}
                        className="font-mono text-blue-700 hover:underline"
                      >
                        {log.inviteeId}
                      </button>
                    )}
                  </div>

                  {log.verificationState === 'Needs Verification' && (
                    <div className="pt-2 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100">
                      <select
                        value={verifyIdMap[log.id] ?? log.inviteeId ?? ''}
                        onChange={(e) => setVerifyIdMap({ ...verifyIdMap, [log.id]: e.target.value })}
                        className="px-2.5 py-1.5 text-xs border border-slate-300 rounded bg-white max-w-xs"
                      >
                        <option value="">Select Invitee ID to link...</option>
                        {uniqueInvitees.map((i) => (
                          <option key={i.inviteeId} value={i.inviteeId}>
                            {i.inviteeId} — {i.name} ({i.organisation})
                          </option>
                        ))}
                      </select>

                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          disabled={busyAction === log.id}
                          onClick={() => handleVerifyLog(log, 'Confirmation Received')}
                          className="px-2.5 py-1 text-xs font-medium text-white bg-emerald-700 rounded hover:bg-emerald-800 inline-flex items-center gap-1 whitespace-nowrap"
                        >
                          <Check className="w-3 h-3" />
                          <span>Verify Confirm</span>
                        </button>
                        <button
                          type="button"
                          disabled={busyAction === log.id}
                          onClick={() => handleVerifyLog(log, 'Regret Received')}
                          className="px-2.5 py-1 text-xs font-medium text-white bg-red-700 rounded hover:bg-red-800 inline-flex items-center gap-1 whitespace-nowrap"
                        >
                          <XCircle className="w-3 h-3" />
                          <span>Verify Regret</span>
                        </button>
                        <button
                          type="button"
                          disabled={busyAction === log.id}
                          onClick={() => handleVerifyLog(log, 'Dismiss')}
                          className="px-2.5 py-1 text-xs font-medium text-slate-600 border border-slate-300 rounded hover:bg-slate-50"
                        >
                          Dismiss
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
