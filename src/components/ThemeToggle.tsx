import { Monitor, Moon, Sun } from 'lucide-react';
import { ThemePreference, useTheme } from '../hooks/useTheme';

interface ThemeToggleProps {
  /** Visual treatment: light chrome sits on dark hero backdrops. */
  tone?: 'default' | 'on-dark';
  className?: string;
}

const NEXT_LABEL: Record<ThemePreference, string> = {
  light: 'Switch to dark theme',
  dark: 'Switch to system theme',
  system: 'Switch to light theme',
};

const CURRENT_LABEL: Record<ThemePreference, string> = {
  light: 'Light theme',
  dark: 'Dark theme',
  system: 'System theme',
};

export default function ThemeToggle({ tone = 'default', className = '' }: ThemeToggleProps) {
  const { preference, cycleTheme } = useTheme();

  const Icon = preference === 'light' ? Sun : preference === 'dark' ? Moon : Monitor;

  const toneClasses =
    tone === 'on-dark'
      ? 'glass-on-dark text-white/90 hover:text-white'
      : 'border border-outline-variant/30 bg-surface-container-lowest/70 text-on-surface-variant hover:text-brand-dark hover:border-primary/40';

  return (
    <button
      type="button"
      onClick={cycleTheme}
      aria-label={NEXT_LABEL[preference]}
      title={`${CURRENT_LABEL[preference]} — ${NEXT_LABEL[preference]}`}
      className={`inline-flex h-10 w-10 items-center justify-center rounded-full shadow-sm transition-all hover:shadow-md ${toneClasses} ${className}`.trim()}
    >
      <Icon className="h-[18px] w-[18px]" aria-hidden />
      <span className="sr-only">{CURRENT_LABEL[preference]}</span>
    </button>
  );
}
