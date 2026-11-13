import React, { useMemo, useState } from 'react';
import { FileSpreadsheet, FileText, Download } from 'lucide-react';
import type { DashboardMetrics, EventDatabase } from '../types/event';
import {
  buildAllReports,
  exportMasterWorkbookToExcel,
  exportReportToExcel,
  exportReportToPdf,
  type ReportId,
} from '../utils/exportReports';

interface ReportsViewProps {
  db: EventDatabase;
  metrics: DashboardMetrics;
}

export const ReportsView: React.FC<ReportsViewProps> = ({ db, metrics }) => {
  const reports = useMemo(() => buildAllReports(db, metrics), [db, metrics]);
  const [selectedId, setSelectedId] = useState<ReportId>('invitation-summary');

  const activeReport = useMemo(
    () => reports.find((r) => r.id === selectedId) ?? reports[0],
    [reports, selectedId]
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      {/* Report Selector Column */}
      <div className="lg:col-span-4 bg-white border border-slate-200 rounded-lg overflow-hidden flex flex-col">
        <div className="px-5 py-4 border-b border-slate-200">
          <h3 className="text-sm font-semibold text-slate-900">Automated Event Reports</h3>
          <p className="text-xs text-slate-500 mt-0.5">Live snapshots generated from the unified Master DB</p>
        </div>

        <div className="divide-y divide-slate-100 flex-1">
          {reports.map((rep) => {
            const active = rep.id === activeReport.id;
            return (
              <button
                key={rep.id}
                type="button"
                onClick={() => setSelectedId(rep.id)}
                className={`w-full text-left px-5 py-3 transition-colors flex items-center justify-between gap-2 ${
                  active ? 'bg-blue-50 text-blue-900' : 'hover:bg-slate-50 text-slate-700'
                }`}
              >
                <div className="min-w-0">
                  <div className={`text-xs font-medium truncate ${active ? 'text-blue-900' : 'text-slate-900'}`}>
                    {rep.title}
                  </div>
                  <div className="text-[11px] text-slate-500 truncate mt-0.5">{rep.subtitle}</div>
                </div>
                <span className="font-mono text-[11px] tabular-nums text-slate-500 shrink-0">
                  {rep.rows.length}
                </span>
              </button>
            );
          })}
        </div>

        <div className="p-4 border-t border-slate-200 bg-slate-50">
          <button
            type="button"
            onClick={() => exportMasterWorkbookToExcel(reports, db.meta.eventName)}
            className="w-full px-4 py-2 text-xs font-medium text-white bg-slate-900 rounded-md hover:bg-slate-800 inline-flex items-center justify-center gap-2 whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export Full 9-Sheet Master Workbook (.xlsx)</span>
          </button>
        </div>
      </div>

      {/* Live Report Preview & Export Column */}
      <div className="lg:col-span-8 bg-white border border-slate-200 rounded-lg overflow-hidden flex flex-col">
        <div className="px-6 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-slate-900">{activeReport.title}</h3>
            <p className="text-xs text-slate-500 mt-0.5">{activeReport.subtitle}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => exportReportToExcel(activeReport, db.meta.eventName)}
              className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-700" />
              <span>Export Excel</span>
            </button>
            <button
              type="button"
              onClick={() => exportReportToPdf(activeReport, db.meta.eventName)}
              className="px-3 py-1.5 text-xs font-medium text-white bg-blue-700 rounded-md hover:bg-blue-800 inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Export PDF</span>
            </button>
          </div>
        </div>

        <div className="overflow-x-auto flex-1">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-medium">
                {activeReport.columns.map((col) => (
                  <th key={col} className="py-2.5 px-4 whitespace-nowrap">{col}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {activeReport.rows.length === 0 ? (
                <tr>
                  <td colSpan={activeReport.columns.length} className="py-10 text-center text-slate-500">
                    No records currently qualify for this report.
                  </td>
                </tr>
              ) : (
                activeReport.rows.map((row, idx) => (
                  <tr key={idx} className="hover:bg-slate-50">
                    {row.map((cell, cIdx) => (
                      <td key={cIdx} className="py-2.5 px-4 text-slate-700 font-mono tabular-nums text-[11px]">
                        {String(cell)}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
