import { BookOpen, CircleHelp, Mail, MessageSquare, ShieldCheck } from 'lucide-react';

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

export default function HelpView() {
  return (
    <div className="space-y-6">
      <section className="rounded-2xl bg-surface-container-lowest border border-outline-variant/25 shadow-sm p-6 md:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-on-surface-variant">Help Center</p>
        <h1 className="mt-2 text-2xl md:text-3xl font-bold text-brand-dark">Library Archive Portal Help</h1>
        <p className="mt-3 max-w-3xl text-sm md:text-base text-on-surface-variant">
          Find quick guidance for common workflows, permissions, and support. Use this page whenever you need
          onboarding help or run into blocked actions.
        </p>
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

      <section className="rounded-xl bg-white border border-outline-variant/20 p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-brand-dark">Need more support?</h2>
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="rounded-lg border border-outline-variant/25 p-4 flex items-start gap-3">
            <Mail className="h-5 w-5 text-primary mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-brand-dark">Email support</p>
              <p className="text-sm text-on-surface-variant">support@libraryarchives.example</p>
            </div>
          </div>
          <div className="rounded-lg border border-outline-variant/25 p-4 flex items-start gap-3">
            <MessageSquare className="h-5 w-5 text-primary mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-brand-dark">Office hours</p>
              <p className="text-sm text-on-surface-variant">Weekdays, 9:00 AM–4:00 PM local time</p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
