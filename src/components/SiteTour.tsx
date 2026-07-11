import React, { useEffect, useMemo, useRef, useState } from 'react';

type SiteTourStep = {
  title: string;
  description: string;
};

type SiteTourProps = {
  isOpen: boolean;
  onComplete: (doNotShowAgain: boolean) => void;
  onSkip: (doNotShowAgain: boolean) => void;
};

const TOUR_STEPS: SiteTourStep[] = [
  {
    title: 'Welcome to the collaborator workspace',
    description: 'Use this tour to quickly learn where collaboration tools live and how to navigate project work.',
  },
  {
    title: 'Sidebar navigation',
    description: 'Use the sidebar to jump between Kanban, Priority, Portfolio, records, help, and settings areas.',
  },
  {
    title: 'Work and collaborate',
    description: 'Open any project to update details, progress, dependencies, and governance checkpoints with your team.',
  },
  {
    title: 'Need help later?',
    description: 'Use the Help view at any time for guidance, and refresh permissions from the top bar if your access changes.',
  },
];

export default function SiteTour({ isOpen, onComplete, onSkip }: SiteTourProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [doNotShowAgain, setDoNotShowAgain] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);
  const onSkipRef = useRef(onSkip);
  onSkipRef.current = onSkip;

  const totalSteps = TOUR_STEPS.length;
  const step = TOUR_STEPS[currentStep];
  const progressText = useMemo(() => `Step ${currentStep + 1} of ${totalSteps}`, [currentStep, totalSteps]);

  useEffect(() => {
    if (!isOpen) return;
    setCurrentStep(0);
    setDoNotShowAgain(false);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    previousActiveElementRef.current = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onSkipRef.current(false);
        return;
      }

      if (event.key !== 'Tab') return;

      const dialogElement = dialogRef.current;
      if (!dialogElement) return;
      const focusableElements = Array.from(
        dialogElement.querySelectorAll(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
        )
      ) as HTMLElement[];
      if (focusableElements.length === 0) return;

      const first = focusableElements[0];
      const last = focusableElements[focusableElements.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && (active === first || active === dialogElement)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previousActiveElementRef.current?.focus();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleNext = () => {
    if (currentStep >= totalSteps - 1) {
      onComplete(doNotShowAgain);
      return;
    }
    setCurrentStep((prev) => prev + 1);
  };

  const handleBack = () => {
    setCurrentStep((prev) => Math.max(0, prev - 1));
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4" role="presentation">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="site-tour-title"
        aria-describedby="site-tour-description"
        tabIndex={-1}
        className="w-full max-w-2xl rounded-2xl border border-outline-variant/20 bg-surface-container-lowest shadow-2xl"
      >
        <div className="border-b border-outline-variant/20 px-6 py-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-on-surface-variant">Collaborator onboarding tour</p>
          <h2 id="site-tour-title" className="mt-1 text-2xl font-bold text-on-surface">{step.title}</h2>
          <p className="mt-2 text-sm text-on-surface-variant">{progressText}</p>
        </div>

        <div className="px-6 py-5">
          <p id="site-tour-description" className="text-base leading-relaxed text-on-surface">{step.description}</p>
        </div>

        <div className="flex flex-col gap-4 border-t border-outline-variant/20 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          <label className="inline-flex items-center gap-2 text-sm text-on-surface-variant">
            <input
              type="checkbox"
              checked={doNotShowAgain}
              onChange={(event) => setDoNotShowAgain(event.target.checked)}
              className="h-4 w-4 rounded border border-outline-variant/40"
            />
            Do not show this again
          </label>

          <div className="flex items-center justify-end gap-2">
            <button
              onClick={() => onSkip(doNotShowAgain)}
              className="rounded-lg px-3 py-2 text-sm font-semibold text-on-surface-variant hover:bg-surface-container-high"
            >
              Skip tour
            </button>
            <button
              onClick={handleBack}
              disabled={currentStep === 0}
              className="rounded-lg border border-outline-variant/40 px-3 py-2 text-sm font-semibold text-on-surface disabled:cursor-not-allowed disabled:opacity-50"
            >
              Back
            </button>
            <button
              onClick={handleNext}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90"
            >
              {currentStep === totalSteps - 1 ? 'Finish tour' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
