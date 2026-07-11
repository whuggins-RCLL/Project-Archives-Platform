import { useEffect, useId, useMemo, useState } from 'react';
import { Database, AlertTriangle, PieChart, TrendingUp, BookOpen, Globe, Lock } from 'lucide-react';
import { buildPortfolioMetrics } from '../lib/portfolioAnalytics';
import { api } from '../lib/api';
import { OperationsDigestReport, Project } from '../types';
import Button from '../components/Button';
import { PDF_LAYOUT } from '../lib/uiDefaults';

type SuiteAction = 'refresh' | 'recompute' | 'sync' | 'digest';

interface PortfolioViewProps {
  projects: Project[];
  loading: boolean;
  onProjectClick: (id: string) => void;
  onProjectsRefreshed: (projects: Project[]) => void;
}

function toCsvValue(value: string | number): string {
  const stringValue = String(value ?? '');
  if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

function downloadFile(fileName: string, content: BlobPart, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function buildPdfReport(projects: Project[], generatedAt: string): string {
  const lines = [
    'Portfolio Report',
    `Generated: ${generatedAt}`,
    '',
    ...projects.map((project, index) => `${index + 1}. ${project.title} | ${project.status} | ${project.riskFactor} | ${project.progress}%`)
  ];

  const escapedLines = lines.map((line) => line.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)'));
  const linesPerPage = Math.floor((PDF_LAYOUT.topY - PDF_LAYOUT.marginLeft) / PDF_LAYOUT.lineHeight) + 1;
  const lineChunks: string[][] = [];

  for (let start = 0; start < escapedLines.length; start += linesPerPage) {
    lineChunks.push(escapedLines.slice(start, start + linesPerPage));
  }

  const objects: string[] = [];
  const pageObjectIds: number[] = [];
  const catalogObjectId = 1;
  const pagesObjectId = 2;
  const fontObjectId = 3;
  let nextObjectId = 4;

  lineChunks.forEach((chunk) => {
    const pageObjectId = nextObjectId++;
    const contentObjectId = nextObjectId++;
    pageObjectIds.push(pageObjectId);

    const textCommands = chunk
      .map((line, index) => `BT /F1 ${PDF_LAYOUT.fontSize} Tf ${PDF_LAYOUT.marginLeft} ${PDF_LAYOUT.topY - index * PDF_LAYOUT.lineHeight} Td (${line}) Tj ET`)
      .join('\n');
    const contentStream = `${textCommands}\n`;

    objects.push(
      `${pageObjectId} 0 obj << /Type /Page /Parent ${pagesObjectId} 0 R /MediaBox [0 0 ${PDF_LAYOUT.pageWidth} ${PDF_LAYOUT.pageHeight}] /Contents ${contentObjectId} 0 R /Resources << /Font << /F1 ${fontObjectId} 0 R >> >> >> endobj`
    );
    objects.push(`${contentObjectId} 0 obj << /Length ${contentStream.length} >> stream\n${contentStream}endstream endobj`);
  });

  const pageRefs = pageObjectIds.map((id) => `${id} 0 R`).join(' ');
  const orderedObjects = [
    `${catalogObjectId} 0 obj << /Type /Catalog /Pages ${pagesObjectId} 0 R >> endobj`,
    `${pagesObjectId} 0 obj << /Type /Pages /Kids [${pageRefs}] /Count ${pageObjectIds.length} >> endobj`,
    `${fontObjectId} 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj`,
    ...objects
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];
  orderedObjects.forEach((obj) => {
    offsets.push(pdf.length);
    pdf += `${obj}\n`;
  });

  const xrefStart = pdf.length;
  pdf += `xref\n0 ${orderedObjects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  offsets.slice(1).forEach((offset) => {
    pdf += `${offset.toString().padStart(10, '0')} 00000 n \n`;
  });
  pdf += `trailer << /Size ${orderedObjects.length + 1} /Root ${catalogObjectId} 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  return pdf;
}

export default function PortfolioView({ projects, loading, onProjectClick, onProjectsRefreshed }: PortfolioViewProps) {
  const metrics = useMemo(() => buildPortfolioMetrics(projects), [projects]);
  const intakeTrendDirection = metrics.intakeTrendPercent >= 0 ? 'up' : 'down';
  const intakeTrendDisplay = `${Math.abs(metrics.intakeTrendPercent).toFixed(1)}% ${intakeTrendDirection}`;
  const projectStatusSummary = Object.entries(metrics.projectsByStatus).map(([status, count]) => `${status}: ${count}`).join(', ');
  const projectsByStatusTitleId = useId();
  const projectsByStatusDescId = useId();

  const [suiteActionMessage, setSuiteActionMessage] = useState<string>('');
  const [suiteActionLoading, setSuiteActionLoading] = useState<SuiteAction | null>(null);
  const [lastDigestReport, setLastDigestReport] = useState<OperationsDigestReport | null>(null);

  useEffect(() => {
    if (!suiteActionMessage) return;
    const timeout = window.setTimeout(() => setSuiteActionMessage(''), 4500);
    return () => window.clearTimeout(timeout);
  }, [suiteActionMessage]);

  const generatedAt = new Date().toISOString();

  const handleExportCsv = () => {
    const headers = ['Project', 'Status', 'Priority', 'Risk', 'Owner', 'Progress', 'Preservation Score', 'Department'];
    const rows = projects.map((project) => [
      project.title,
      project.status,
      project.priority,
      project.riskFactor,
      project.owner.name,
      `${project.progress}%`,
      project.preservationScore.toFixed(1),
      project.department,
    ]);

    const csv = [headers, ...rows].map((row) => row.map(toCsvValue).join(',')).join('\n');
    downloadFile(`portfolio-report-${generatedAt.slice(0, 10)}.csv`, csv, 'text/csv;charset=utf-8');
    setSuiteActionMessage(`CSV report exported at ${new Date().toLocaleTimeString()}.`);
  };

  const handleExportPdf = () => {
    const pdfContent = buildPdfReport(projects, generatedAt);
    downloadFile(`portfolio-report-${generatedAt.slice(0, 10)}.pdf`, pdfContent, 'application/pdf');
    setSuiteActionMessage(`PDF report exported at ${new Date().toLocaleTimeString()}.`);
  };

  const runSuiteAction = async (action: SuiteAction) => {
    setSuiteActionLoading(action);
    try {
      if (action === 'refresh') {
        const refreshedProjects = await api.getProjects();
        onProjectsRefreshed(refreshedProjects);
        setSuiteActionMessage(`Data refresh complete: loaded ${refreshedProjects.length} projects.`);
      }

      if (action === 'recompute') {
        const refreshedProjects = await api.getProjects();
        const recomputedMetrics = buildPortfolioMetrics(refreshedProjects);
        await api.logSuiteAction('recompute_metrics', {
          totalRecords: recomputedMetrics.totalRecords,
          activeProjects: recomputedMetrics.activeProjects,
          criticalMilestonesPending: recomputedMetrics.criticalMilestonesPending,
          generatedAt: new Date().toISOString(),
        });
        onProjectsRefreshed(refreshedProjects);
        setSuiteActionMessage(`Metrics recomputed for ${recomputedMetrics.totalRecords} records and logged.`);
      }

      if (action === 'sync') {
        const refreshedProjects = await api.getProjects();
        const projectsNeedingAttention = refreshedProjects.filter((project) => project.riskFactor !== 'Low').length;
        await api.logSuiteAction('sync_tasks', {
          projectsEvaluated: refreshedProjects.length,
          projectsNeedingAttention,
          syncedAt: new Date().toISOString(),
        });
        onProjectsRefreshed(refreshedProjects);
        setSuiteActionMessage(`Task sync complete: ${projectsNeedingAttention} projects flagged for governance follow-up.`);
      }
    } catch (error) {
      console.error('Suite action failed', error);
      setSuiteActionMessage('Suite action failed. Please try again.');
    } finally {
      setSuiteActionLoading(null);
    }
  };

  const runOperationsDigest = async () => {
    setSuiteActionLoading('digest');
    try {
      const report = await api.runOperationsDigest();
      setLastDigestReport(report);
      setSuiteActionMessage(
        `Ops digest generated: ${report.totals.slaAlerts} SLA alerts, ${report.totals.dormantProjects} dormant, ${report.totals.overdueStages} overdue stages. Slack: ${report.delivery.slack}. Email: ${report.delivery.email}.`
      );
      await api.logSuiteAction('operations_digest', {
        generatedAt: report.generatedAt,
        totals: report.totals,
        delivery: report.delivery,
      });
    } catch (error) {
      console.error('Operations digest failed', error);
      setSuiteActionMessage('Operations digest failed. Please try again.');
    } finally {
      setSuiteActionLoading(null);
    }
  };

  if (loading) return <div className="p-10">Loading portfolio data...</div>;

  return (
    <div className="p-10 space-y-10 max-w-7xl mx-auto">
      <section>
        <div className="flex items-end justify-between mb-6 gap-4 flex-wrap">
          <div className="space-y-1">
            <h2 className="font-headline text-3xl font-extrabold tracking-tight text-on-surface">Portfolio Overview</h2>
            <p className="text-on-surface-variant text-sm">Curation analytics across all active research departments.</p>
          </div>
          <div className="flex gap-2 flex-wrap justify-end">
            <Button aria-label="Export as CSV" onClick={handleExportCsv} variant="outline" size="sm">Export CSV</Button>
            <Button aria-label="Export as PDF" onClick={handleExportPdf} variant="outline" size="sm">Export PDF</Button>
            <Button
              onClick={() => runSuiteAction('refresh')}
              disabled={suiteActionLoading !== null}
              variant="primary"
              size="sm"
            >
              {suiteActionLoading === 'refresh' ? 'Refreshing...' : 'Refresh Data'}
            </Button>
            <Button
              onClick={() => runSuiteAction('recompute')}
              disabled={suiteActionLoading !== null}
              variant="primary"
              size="sm"
            >
              {suiteActionLoading === 'recompute' ? 'Recomputing...' : 'Recompute Metrics'}
            </Button>
            <Button
              onClick={() => runSuiteAction('sync')}
              disabled={suiteActionLoading !== null}
              variant="primary"
              size="sm"
            >
              {suiteActionLoading === 'sync' ? 'Syncing...' : 'Sync Tasks'}
            </Button>
            <Button
              onClick={runOperationsDigest}
              disabled={suiteActionLoading !== null}
              variant="primary"
              size="sm"
            >
              {suiteActionLoading === 'digest' ? 'Running...' : 'Run Ops Digest'}
            </Button>
          </div>
        </div>
        {suiteActionMessage && (
          <div role="status" aria-live="polite" className="mb-4 rounded-lg border border-outline-variant/20 bg-surface-container-low px-4 py-2 text-xs font-medium text-on-surface-variant">
            {suiteActionMessage}
          </div>
        )}
        {lastDigestReport && (
          <div className="mb-4 rounded-lg border border-outline-variant/20 bg-surface-container-lowest px-4 py-3 text-xs text-on-surface-variant space-y-1">
            <div className="font-bold text-on-surface">Latest operations digest ({new Date(lastDigestReport.generatedAt).toLocaleString()})</div>
            {lastDigestReport.summaryLines.map((line) => (
              <div key={line}>{line}</div>
            ))}
          </div>
        )}

        <div className="grid grid-cols-12 gap-6">
          <div className="col-span-12 md:col-span-3 bg-surface-container-lowest p-6 rounded shadow-sm border border-outline-variant/10">
            <div className="flex items-center justify-between mb-4">
              <span className="text-xs font-bold tracking-widest uppercase text-on-secondary-container">Total Records</span>
              <Database className="w-5 h-5 text-primary" />
            </div>
            <div className="text-4xl font-headline font-black text-primary">{metrics.totalRecords}</div>
            <div className="mt-2 text-xs font-medium text-on-tertiary-container flex items-center gap-1">
              <TrendingUp className="w-3 h-3" />
              {intakeTrendDisplay} vs {metrics.baselineLabel}
            </div>
          </div>

          <div className="col-span-12 md:col-span-3 bg-surface-container-lowest p-6 rounded shadow-sm border border-outline-variant/10">
            <div className="flex items-center justify-between mb-4">
              <span className="text-xs font-bold tracking-widest uppercase text-on-secondary-container">Risk Level</span>
              <AlertTriangle className="w-5 h-5 text-error" />
            </div>
            <div className="text-4xl font-headline font-black text-on-surface">{metrics.riskLevel}</div>
            <div className="mt-2 text-xs font-medium text-on-surface-variant">
              {metrics.criticalMilestonesPending} critical milestones pending • {metrics.slaBreaches} SLA breaches
            </div>
          </div>

          <div className="col-span-12 md:col-span-6 bg-surface-container-lowest p-6 rounded shadow-sm border border-outline-variant/10 relative overflow-hidden">
            <div className="flex items-center justify-between mb-6">
              <span className="text-xs font-bold tracking-widest uppercase text-on-secondary-container">Projects by Status</span>
              <PieChart className="w-5 h-5 text-on-surface-variant" />
            </div>
            <div className="flex items-center gap-8">
              <div className="relative w-32 h-32 flex items-center justify-center">
                <svg
                  aria-labelledby={`${projectsByStatusTitleId} ${projectsByStatusDescId}`}
                  className="w-full h-full transform -rotate-90"
                  role="img"
                >
                  <title id={projectsByStatusTitleId}>Projects by Status pie chart</title>
                  <desc id={projectsByStatusDescId}>
                    {`Distribution of projects by status. ${projectStatusSummary}. Active projects: ${metrics.activeProjects}.`}
                  </desc>
                  <circle className="text-surface-container-low" cx="64" cy="64" fill="transparent" r="50" stroke="currentColor" strokeWidth="20"></circle>
                  <circle className="text-primary" cx="64" cy="64" fill="transparent" r="50" stroke="currentColor" strokeDasharray="314" strokeDashoffset="100" strokeWidth="20"></circle>
                  <circle className="text-tertiary-fixed-dim" cx="64" cy="64" fill="transparent" r="50" stroke="currentColor" strokeDasharray="314" strokeDashoffset="250" strokeWidth="20"></circle>
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-xl font-black font-headline">{metrics.activeProjects}</span>
                  <span className="text-[10px] uppercase font-bold text-on-surface-variant">Active</span>
                </div>
              </div>
              <div className="flex-1 space-y-2">
                {Object.entries(metrics.projectsByStatus).map(([status, count]) => (
                  <div key={status} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-primary"></div>
                      <span className="text-xs font-medium">{status}</span>
                    </div>
                    <span className="text-xs font-bold">{count}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-4 text-xs text-on-surface-variant font-medium">Average active age: {metrics.averageProjectAgeDays} days</div>
          </div>
        </div>
      </section>

      <section className="space-y-6">
        <div className="space-y-1">
          <h2 className="font-headline text-3xl font-extrabold tracking-tight text-on-surface">Metric Summary</h2>
          <p className="text-on-surface-variant text-sm">Detailed performance and risk evaluation per project stream.</p>
        </div>
        <div className="bg-surface-container-lowest rounded-xl shadow-sm border border-outline-variant/10 overflow-hidden">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-surface-container-low/50">
                <th scope="col" className="p-4 text-xs font-bold text-on-secondary-container uppercase tracking-widest">Project Name</th>
                <th scope="col" className="p-4 text-xs font-bold text-on-secondary-container uppercase tracking-widest">Visibility</th>
                <th scope="col" className="p-4 text-xs font-bold text-on-secondary-container uppercase tracking-widest">Risk Factor</th>
                <th scope="col" className="p-4 text-xs font-bold text-on-secondary-container uppercase tracking-widest">Completion</th>
                <th scope="col" className="p-4 text-xs font-bold text-on-secondary-container uppercase tracking-widest text-right">Preservation Score</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/5">
              {projects.map(project => (
                <tr key={project.id} onClick={() => onProjectClick(project.id)} className="hover:bg-surface-container-low transition-colors cursor-pointer">
                  <td className="p-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center">
                        <BookOpen className="w-4 h-4 text-primary" aria-hidden />
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onProjectClick(project.id);
                        }}
                        className="text-left"
                        aria-label={`Open project ${project.title}`}
                      >
                        <span className="block text-sm font-bold text-on-surface leading-none">{project.title}</span>
                        <span className="block text-[10px] text-on-surface-variant">Archivist: {project.owner.name}</span>
                      </button>
                    </div>
                  </td>
                  <td className="p-4">
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-tighter ${
                        project.isPublic === false ? 'bg-surface-container-high text-on-surface-variant' : 'bg-tertiary-container text-on-tertiary-container'
                      }`}
                      title={project.isPublic === false ? 'Private — hidden from the public dashboard' : 'Public — shown on the public dashboard'}
                    >
                      {project.isPublic === false ? <Lock className="w-3 h-3" aria-hidden /> : <Globe className="w-3 h-3" aria-hidden />}
                      {project.isPublic === false ? 'Private' : 'Public'}
                    </span>
                  </td>
                  <td className="p-4">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-tighter ${
                      project.riskFactor === 'High' ? 'bg-error-container text-error' :
                      project.riskFactor === 'Medium' ? 'bg-tertiary-container text-tertiary-fixed' :
                      'bg-surface-container-high text-on-secondary-container'
                    }`}>
                      {project.riskFactor}
                    </span>
                  </td>
                  <td className="p-4">
                    <div
                      role="progressbar"
                      aria-valuenow={project.progress}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={`${project.title} completion`}
                      className="w-32 h-1 bg-surface-container-high rounded-full overflow-hidden"
                    >
                      <div className="bg-primary h-full" style={{ width: `${project.progress}%` }}></div>
                    </div>
                  </td>
                  <td className="p-4 text-right">
                    <span className="text-sm font-black text-on-surface">{project.preservationScore.toFixed(1)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
