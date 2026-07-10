import React, { useState } from 'react';
import { CheckCircle2, Lightbulb, Loader2, Mail, RotateCcw, Send, Sparkles } from 'lucide-react';
import { api } from '../lib/api';
import {
  COMMUNITY_SUGGESTION_CATEGORIES,
  COMMUNITY_SUGGESTION_LIMITS,
  CommunitySuggestionPayload,
} from '../lib/communityIntake';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const EMPTY_FORM: CommunitySuggestionPayload = {
  name: '',
  email: '',
  projectName: '',
  category: '',
  description: '',
  goal: '',
  audience: '',
};

type EmailCopyStatus = 'idle' | 'sending' | 'sent' | 'error' | 'not-configured';

interface SubmissionReceipt {
  id: string;
  code: string;
  payload: CommunitySuggestionPayload;
}

function buildMailtoFallback(receipt: SubmissionReceipt): string {
  const subject = `Copy of your project suggestion (${receipt.code})`;
  const body = [
    'Your idea has been added to our project board for consideration.',
    '',
    `Reference code: ${receipt.code}`,
    `Project name: ${receipt.payload.projectName}`,
    `Category: ${receipt.payload.category}`,
    `Submitted by: ${receipt.payload.name} (${receipt.payload.email})`,
    '',
    `Description: ${receipt.payload.description}`,
    '',
    `Goal: ${receipt.payload.goal}`,
    ...(receipt.payload.audience ? ['', `Who it would help: ${receipt.payload.audience}`] : []),
  ].join('\n');
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

const inputClasses =
  'w-full rounded-xl border border-outline-variant/30 bg-surface-container-lowest/70 px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/60 shadow-sm outline-none transition-all focus:border-primary/50 focus:ring-2 focus:ring-primary/30';

export default function CommunityIntakeForm() {
  const [form, setForm] = useState<CommunitySuggestionPayload>(EMPTY_FORM);
  const [honeypot, setHoneypot] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<SubmissionReceipt | null>(null);
  const [copyEmail, setCopyEmail] = useState('');
  const [copyStatus, setCopyStatus] = useState<EmailCopyStatus>('idle');
  const [copyError, setCopyError] = useState<string | null>(null);

  const setField = (field: keyof CommunitySuggestionPayload) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const validate = (): string | null => {
    if (!form.name.trim()) return 'Please tell us your name.';
    if (!EMAIL_REGEX.test(form.email.trim())) return 'Please enter a valid email address.';
    if (!form.projectName.trim()) return 'Please give your idea a short project name.';
    if (!form.category) return 'Please pick a category.';
    if (form.description.trim().length < 10) return 'Please describe your idea in a sentence or two.';
    if (!form.goal.trim()) return 'Please tell us what this idea should accomplish.';
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    // Hidden honeypot field: bots that fill it get a silent no-op "success".
    if (honeypot.trim()) {
      setReceipt({ id: '', code: 'SLS-RECEIVED', payload: { ...form } });
      return;
    }

    const validationError = validate();
    if (validationError) {
      setSubmitError(validationError);
      return;
    }

    setSubmitting(true);
    try {
      const trimmed: CommunitySuggestionPayload = {
        name: form.name.trim(),
        email: form.email.trim(),
        projectName: form.projectName.trim(),
        category: form.category,
        description: form.description.trim(),
        goal: form.goal.trim(),
        audience: form.audience?.trim() || undefined,
      };
      const result = await api.submitCommunitySuggestion(trimmed);
      setReceipt({ ...result, payload: trimmed });
      setCopyEmail(trimmed.email);
      setCopyStatus('idle');
      setCopyError(null);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Unable to submit your suggestion right now.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleEmailCopy = async () => {
    if (!receipt) return;
    if (!EMAIL_REGEX.test(copyEmail.trim())) {
      setCopyStatus('error');
      setCopyError('Please enter a valid email address.');
      return;
    }
    setCopyStatus('sending');
    setCopyError(null);
    try {
      await api.emailSuggestionCopy(receipt.id, copyEmail.trim());
      setCopyStatus('sent');
    } catch (error) {
      const notConfigured = Boolean((error as { notConfigured?: boolean }).notConfigured);
      setCopyStatus(notConfigured ? 'not-configured' : 'error');
      setCopyError(error instanceof Error ? error.message : 'Unable to send the email copy right now.');
    }
  };

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setHoneypot('');
    setSubmitError(null);
    setReceipt(null);
    setCopyEmail('');
    setCopyStatus('idle');
    setCopyError(null);
  };

  if (receipt) {
    return (
      <div className="glass-card glass-sheen p-8 sm:p-10 text-center animate-fade-in-up" role="status" aria-live="polite">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/15">
          <CheckCircle2 className="h-9 w-9 text-emerald-600" aria-hidden />
        </div>
        <h3 className="font-headline text-2xl font-extrabold text-brand-dark">Thank you for your idea!</h3>
        <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-on-surface-variant">
          Your suggestion has been added to our project board for consideration. Submitting an idea doesn&rsquo;t
          guarantee it will be built, but our team reviews every suggestion when planning future work.
        </p>
        {receipt.code && (
          <p className="mt-4 text-xs font-bold uppercase tracking-wider text-on-surface-variant">
            Reference code:{' '}
            <span className="rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 font-mono text-primary normal-case">{receipt.code}</span>
          </p>
        )}

        {receipt.id && (
          <div className="mx-auto mt-8 max-w-md rounded-2xl border border-outline-variant/20 bg-surface-container-lowest/50 p-5 text-left">
            <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-brand-dark">
              <Mail className="h-4 w-4 text-primary" aria-hidden />
              Want a copy of your submission?
            </p>
            {copyStatus === 'sent' ? (
              <p className="flex items-center gap-2 text-sm font-semibold text-emerald-700">
                <CheckCircle2 className="h-4 w-4" aria-hidden />
                Copy sent to {copyEmail.trim()}.
              </p>
            ) : (
              <>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <label htmlFor="suggestion-copy-email" className="sr-only">Email address for your copy</label>
                  <input
                    id="suggestion-copy-email"
                    type="email"
                    value={copyEmail}
                    onChange={(e) => setCopyEmail(e.target.value)}
                    placeholder="you@stanford.edu"
                    maxLength={COMMUNITY_SUGGESTION_LIMITS.email}
                    className={`${inputClasses} flex-1`}
                    disabled={copyStatus === 'sending'}
                  />
                  <button
                    type="button"
                    onClick={handleEmailCopy}
                    disabled={copyStatus === 'sending'}
                    className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-bold text-white shadow-md transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {copyStatus === 'sending' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
                    {copyStatus === 'sending' ? 'Sending…' : 'Send copy'}
                  </button>
                </div>
                {(copyStatus === 'error' || copyStatus === 'not-configured') && (
                  <p className="mt-3 text-xs text-error" role="alert">
                    {copyError}{' '}
                    {copyStatus === 'not-configured' && (
                      <a href={buildMailtoFallback(receipt)} className="font-semibold underline">
                        Open a pre-filled email instead
                      </a>
                    )}
                  </p>
                )}
              </>
            )}
          </div>
        )}

        <button
          type="button"
          onClick={resetForm}
          className="mt-8 inline-flex items-center gap-2 rounded-full border border-outline-variant/30 bg-surface-container-lowest/70 px-5 py-2.5 text-sm font-semibold text-brand-dark shadow-sm transition-all hover:border-primary/40 hover:shadow-md"
        >
          <RotateCcw className="h-4 w-4" aria-hidden />
          Suggest another idea
        </button>
      </div>
    );
  }

  return (
    <div className="glass-card glass-sheen overflow-hidden animate-fade-in-up">
      <div className="grid lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        {/* Intro panel */}
        <div className="relative isolate overflow-hidden p-8 sm:p-10 text-white">
          <div className="brand-hero absolute inset-0 -z-20" aria-hidden />
          <div className="brand-hero-grid absolute inset-0 -z-10 opacity-60" aria-hidden />
          <div className="pointer-events-none absolute -bottom-16 -left-16 h-56 w-56 rounded-full bg-white/10 blur-3xl" aria-hidden />
          <span className="inline-flex items-center gap-2 rounded-full glass-on-dark px-3 py-1 text-xs font-bold uppercase tracking-[0.18em]">
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
            SLS Community
          </span>
          <h3 className="mt-5 font-headline text-3xl font-extrabold tracking-tight leading-tight">
            Have an idea for us?
          </h3>
          <p className="mt-4 text-sm leading-relaxed text-white/85">
            The Stanford Law School community can suggest projects for our team to consider — a new guide, an AI
            learning idea, a tool that would make your work easier. It takes about a minute.
          </p>
          <div className="mt-6 glass-on-dark rounded-2xl p-4 text-xs leading-relaxed text-white/80">
            <Lightbulb className="mb-2 h-4 w-4 text-amber-300" aria-hidden />
            Submitting an idea doesn&rsquo;t mean it will be accepted — every suggestion goes onto our project board
            and is reviewed for future work.
          </div>
        </div>

        {/* Form panel */}
        <form onSubmit={handleSubmit} className="p-8 sm:p-10" noValidate>
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <label htmlFor="suggestion-name" className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-on-surface-variant">
                Your name
              </label>
              <input
                id="suggestion-name"
                type="text"
                value={form.name}
                onChange={setField('name')}
                placeholder="Jane Doe"
                maxLength={COMMUNITY_SUGGESTION_LIMITS.name}
                autoComplete="name"
                required
                className={inputClasses}
              />
            </div>
            <div>
              <label htmlFor="suggestion-email" className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-on-surface-variant">
                Your email
              </label>
              <input
                id="suggestion-email"
                type="email"
                value={form.email}
                onChange={setField('email')}
                placeholder="you@stanford.edu"
                maxLength={COMMUNITY_SUGGESTION_LIMITS.email}
                autoComplete="email"
                required
                className={inputClasses}
              />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="suggestion-project-name" className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-on-surface-variant">
                Project name
              </label>
              <input
                id="suggestion-project-name"
                type="text"
                value={form.projectName}
                onChange={setField('projectName')}
                placeholder="A short name for your idea"
                maxLength={COMMUNITY_SUGGESTION_LIMITS.projectName}
                required
                className={inputClasses}
              />
            </div>
            <fieldset className="sm:col-span-2">
              <legend className="mb-2 block text-xs font-bold uppercase tracking-wider text-on-surface-variant">
                Category
              </legend>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Suggestion category">
                {COMMUNITY_SUGGESTION_CATEGORIES.map((category) => {
                  const selected = form.category === category;
                  return (
                    <button
                      key={category}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => setForm((prev) => ({ ...prev, category }))}
                      className={`rounded-full px-4 py-2 text-xs font-semibold shadow-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
                        selected
                          ? 'bg-primary text-white shadow-md'
                          : 'border border-outline-variant/30 bg-surface-container-lowest/70 text-on-surface hover:border-primary/40 hover:text-primary'
                      }`}
                    >
                      {category}
                    </button>
                  );
                })}
              </div>
            </fieldset>
            <div className="sm:col-span-2">
              <label htmlFor="suggestion-description" className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-on-surface-variant">
                What&rsquo;s the idea?
              </label>
              <textarea
                id="suggestion-description"
                value={form.description}
                onChange={setField('description')}
                placeholder="Describe your idea in a sentence or two — plain language is perfect."
                maxLength={COMMUNITY_SUGGESTION_LIMITS.description}
                rows={4}
                required
                className={`${inputClasses} resize-y`}
              />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="suggestion-goal" className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-on-surface-variant">
                What should it accomplish?
              </label>
              <textarea
                id="suggestion-goal"
                value={form.goal}
                onChange={setField('goal')}
                placeholder="e.g. Save time preparing course materials, make research data easier to find…"
                maxLength={COMMUNITY_SUGGESTION_LIMITS.goal}
                rows={2}
                required
                className={`${inputClasses} resize-y`}
              />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="suggestion-audience" className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-on-surface-variant">
                Who would this help? <span className="font-medium normal-case tracking-normal text-on-surface-variant/70">(optional)</span>
              </label>
              <input
                id="suggestion-audience"
                type="text"
                value={form.audience ?? ''}
                onChange={setField('audience')}
                placeholder="Students, faculty, library staff…"
                maxLength={COMMUNITY_SUGGESTION_LIMITS.audience}
                className={inputClasses}
              />
            </div>
          </div>

          {/* Honeypot: visually hidden from people, tempting for bots. */}
          <div className="sr-only" aria-hidden="true">
            <label htmlFor="suggestion-website">Leave this field empty</label>
            <input
              id="suggestion-website"
              type="text"
              tabIndex={-1}
              autoComplete="off"
              value={honeypot}
              onChange={(e) => setHoneypot(e.target.value)}
            />
          </div>

          {submitError && (
            <p className="mt-5 rounded-xl border border-error/30 bg-error-container/60 px-4 py-3 text-sm font-semibold text-error" role="alert">
              {submitError}
            </p>
          )}

          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs leading-relaxed text-on-surface-variant/80">
              Ideas go to our project board for review — we&rsquo;ll consider them for future work.
            </p>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full bg-gradient-to-b from-primary to-brand-dark px-8 py-3 text-sm font-bold text-white shadow-lg transition-all hover:-translate-y-0.5 hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
              {submitting ? 'Submitting…' : 'Submit idea'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
