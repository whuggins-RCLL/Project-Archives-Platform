import { BookOpen, Bot, CircleHelp, Compass, Mail, Settings, ShieldCheck, Sparkles } from 'lucide-react';
import type { Settings as AppSettings } from '../lib/api';

const helpSections = [
  {
    title: 'Getting started',
    description: 'Use Kanban, Priority Matrix, and Portfolio Overview to track work from intake through completion.',
    icon: BookOpen,
  },
  {
    title: 'Managing project records',
    description: 'Open any project to edit metadata, update milestones, and keep governance checkpoints current.',
    icon: CircleHelp,
  },
  {
    title: 'Roles and permissions',
    description: 'If actions are disabled, your account likely has viewer or read-only access. Ask an owner to adjust access in Access Management.',
    icon: ShieldCheck,
  },
];

const faqs = [
  {
    question: 'Why can’t I create or edit projects?',
    answer: 'Your role may not include editor privileges. Owners and admins can update permissions from Access Management.',
  },
  {
    question: 'How do I refresh my latest access rights?',
    answer: 'Use the Refresh permissions action in the top bar to sync token claims and mirror role updates.',
  },
  {
    question: 'Where can I update branding and defaults?',
    answer: 'Open Archive Settings. Users with view-only settings access can review configuration, but cannot save changes.',
  },
];

const readmeHighlights = [
  {
    title: 'What this platform includes',
    description: 'Kanban + Portfolio workflows, detailed project records, role-based access, and a public transparency dashboard.',
  },
  {
    title: 'Deployment and environment setup',
    description: 'Use Firebase for auth/data, set required env vars, and deploy with Vercel or Cloud Run.',
  },
  {
    title: 'Integrations and operations',
    description: 'Configure Google Drive/Calendar deep links, optional AI providers, and security/rate-limit controls.',
  },
];

const AI_TOOL_LABELS: Array<{ key: keyof AppSettings; label: string }> = [
  { key: 'aiAutoTagEnabled', label: 'Auto-tag suggestions' },
  { key: 'aiSummarizeEnabled', label: 'Project summarization' },
  { key: 'aiNextBestActionEnabled', label: 'Next-best actions' },
  { key: 'aiRiskNarrativeEnabled', label: 'Risk narratives' },
  { key: 'aiDuplicateDetectionEnabled', label: 'Duplicate detection' },
  { key: 'aiPmApproachEnabled', label: 'PM approach coaching' },
];

export default function HelpView({
  settings,
  onOpenTour,
}: {
  settings: AppSettings;
  onOpenTour: () => void;
}) {
  const supportEmail = settings.helpContactEmail?.trim() || '';
  const aiToolStatuses = AI_TOOL_LABELS.map((tool) => ({
    label: tool.label,
    enabled: settings.aiEnabled && Boolean(settings[tool.key]),
  }));

  return (
    <div className="space-y-6">
      <section className="rounded-2xl bg-surface-container-lowest border border-outline-variant/25 shadow-sm p-6 md:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-on-surface-variant">Help Center</p>
        <h1 className="mt-2 text-2xl md:text-3xl font-bold text-brand-dark">Library Archive Portal Help</h1>
        <p className="mt-3 max-w-3xl text-sm md:text-base text-on-surface-variant">
          Find quick guidance for common workflows, permissions, and support. Use this page whenever you need
          onboarding help or run into blocked actions.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={onOpenTour}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90"
          >
            <Compass className="h-4 w-4" />
            Start site tour
          </button>
          <a
            href="#developer-readme"
            className="inline-flex items-center gap-2 rounded-lg border border-outline-variant/40 px-4 py-2 text-sm font-semibold text-on-surface hover:bg-surface-container-high"
          >
            <BookOpen className="h-4 w-4" />
            Read developer guide
          </a>
        </div>
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {helpSections.map((item) => (
          <article key={item.title} className="rounded-xl bg-white border border-outline-variant/20 p-5 shadow-sm">
            <div className="h-10 w-10 rounded-lg bg-primary-container/20 flex items-center justify-center">
              <item.icon className="h-5 w-5 text-primary" />
            </div>
            <h2 className="mt-4 text-base font-semibold text-brand-dark">{item.title}</h2>
            <p className="mt-2 text-sm text-on-surface-variant">{item.description}</p>
          </article>
        ))}
      </section>

      <section className="rounded-xl bg-white border border-outline-variant/20 p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-brand-dark">Frequently asked questions</h2>
        <div className="mt-4 space-y-4">
          {faqs.map((item) => (
            <article key={item.question} className="rounded-lg bg-surface-container-low p-4">
              <h3 className="text-sm font-semibold text-brand-dark">{item.question}</h3>
              <p className="mt-1 text-sm text-on-surface-variant">{item.answer}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="developer-readme" className="rounded-xl bg-white border border-outline-variant/20 p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-brand-dark">Developer README (front-end quick view)</h2>
        <p className="mt-2 text-sm text-on-surface-variant">
          This summarizes the project README into user-friendly guidance for admins and power users managing the portal.
        </p>
        <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
          {readmeHighlights.map((item) => (
            <article key={item.title} className="rounded-lg border border-outline-variant/25 bg-surface-container-low p-4">
              <h3 className="text-sm font-semibold text-brand-dark">{item.title}</h3>
              <p className="mt-2 text-sm text-on-surface-variant">{item.description}</p>
            </article>
          ))}
        </div>
        <div className="mt-4 rounded-lg border border-outline-variant/25 bg-surface-container-low p-4">
          <h3 className="text-sm font-semibold text-brand-dark">How to use AI tools in this platform</h3>
          <p className="mt-2 text-sm text-on-surface-variant">
            Admins control these options from <span className="font-semibold">Settings → Enable AI</span>. End users can access enabled tools inside project records.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {aiToolStatuses.map((tool) => (
              <span
                key={tool.label}
                className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-semibold ${
                  tool.enabled
                    ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                    : 'border-outline-variant/40 bg-white text-on-surface-variant'
                }`}
              >
                {tool.enabled ? <Sparkles className="h-3 w-3" /> : <Bot className="h-3 w-3" />}
                {tool.label}: {tool.enabled ? 'On' : 'Off'}
              </span>
            ))}
          </div>
          {settings.aiEnabled ? null : (
            <p className="mt-3 text-xs text-on-surface-variant">
              AI is currently disabled globally. Enable it in Settings to activate individual tools.
            </p>
          )}
        </div>
      </section>

      <section className="rounded-xl bg-white border border-outline-variant/20 p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-brand-dark">Need more support?</h2>
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="rounded-lg border border-outline-variant/25 p-4 flex items-start gap-3">
            <Mail className="h-5 w-5 text-primary mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-brand-dark">Email support</p>
              {supportEmail ? (
                <a href={`mailto:${supportEmail}`} className="text-sm text-primary underline underline-offset-2">
                  {supportEmail}
                </a>
              ) : (
                <p className="text-sm text-on-surface-variant">
                  No support email configured yet. Ask an admin to set <span className="font-semibold">Help Contact Email</span> in Settings.
                </p>
              )}
            </div>
          </div>
          <div className="rounded-lg border border-outline-variant/25 p-4 flex items-start gap-3">
            <Settings className="h-5 w-5 text-primary mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-brand-dark">Admin settings source</p>
              <p className="text-sm text-on-surface-variant">
                Contact and AI availability shown here are synced from Archive Settings for consistency.
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
