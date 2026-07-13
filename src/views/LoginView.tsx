import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, BookOpenText, GraduationCap, MessageSquareText, UsersRound } from 'lucide-react';
import { signInWithPopup, GoogleAuthProvider, signOut } from 'firebase/auth';
import { auth } from '../lib/firebase';
import { APP_CONFIG } from '../config';
import { useBranding } from '../hooks/useBranding';
import { useAuthUser } from '../hooks/useAuthUser';
import ThemeToggle from '../components/ThemeToggle';

export default function LoginView() {
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { branding } = useBranding();
  const platformName = branding.suiteName || APP_CONFIG.appName;
  const portalName = branding.portalName || APP_CONFIG.portalName;
  const { user: authUser } = useAuthUser();

  // Team members with a live Firebase session should never be asked to sign
  // in again — send them straight back to the dashboard.
  useEffect(() => {
    if (authUser) {
      navigate('/app', { replace: true });
    }
  }, [authUser, navigate]);

  const handleLogin = async () => {
    setIsLoading(true);
    setError('');
    try {
      const provider = new GoogleAuthProvider();
      const allowedDomain = import.meta.env.VITE_ALLOWED_DOMAIN;
      
      if (allowedDomain) {
        provider.setCustomParameters({
          hd: allowedDomain
        });
      }

      const result = await signInWithPopup(auth, provider);
      
      if (allowedDomain && result.user.email && !result.user.email.endsWith(`@${allowedDomain}`)) {
        await signOut(auth);
        throw new Error(`Access restricted to @${allowedDomain} accounts.`);
      }

      navigate('/app');
    } catch (err: any) {
      console.error('Login failed:', err);
      setError(err.message || 'Failed to log in with Google.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden px-4 py-10 font-body text-white sm:px-6 lg:px-8">
      <div className="liquid-hero absolute inset-0 -z-30" aria-hidden />
      <div className="brand-hero-grid absolute inset-0 -z-20 opacity-35" aria-hidden />
      <div className="pointer-events-none absolute left-1/2 top-8 -z-10 h-96 w-96 -translate-x-1/2 rounded-full bg-white/8 blur-3xl" aria-hidden />

      <div className="absolute right-4 top-4 z-10">
        <ThemeToggle tone="on-dark" />
      </div>

      <main className="mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-5xl flex-col items-center justify-center gap-10">
        <section className="w-full max-w-3xl text-center animate-fade-in-up" aria-labelledby="login-title">
          <p className="mb-4 text-xs font-semibold uppercase tracking-[0.45em] text-white/60">
            Stanford Law School
          </p>
          <h1 id="login-title" className="font-headline text-5xl font-extrabold tracking-tight sm:text-6xl lg:text-7xl">
            {platformName}
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg leading-8 text-white/78 sm:text-xl">
            A private Stanford Law School community for sharing AI conversations, classroom ideas, research workflows, and practical prompts.
          </p>
        </section>

        <section className="w-full max-w-2xl animate-fade-in-up" style={{ animationDelay: '120ms' }} aria-label="Sign in">
          <div className="glass-on-dark glass-sheen rounded-[2rem] p-6 shadow-2xl sm:p-8">
            <button
              onClick={handleLogin}
              disabled={isLoading}
              className="group flex w-full items-center justify-center gap-3 rounded-2xl border border-white/35 bg-white/12 px-5 py-4 text-base font-bold text-white shadow-2xl shadow-black/25 backdrop-blur-2xl transition-all hover:-translate-y-0.5 hover:bg-white/18 hover:shadow-red-950/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:translate-y-0 disabled:opacity-60"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white shadow-sm" aria-hidden>
                <svg viewBox="0 0 24 24" className="h-5 w-5" role="img" aria-label="Google logo">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l3.66-2.84z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06L5.84 9.9C6.71 7.3 9.14 5.38 12 5.38z" />
                </svg>
              </span>
              {isLoading ? 'Signing in...' : 'Continue with Google'}
              <ArrowRight className="h-5 w-5 opacity-70 transition-transform group-hover:translate-x-0.5" aria-hidden />
            </button>

            <p className="mx-auto mt-5 max-w-lg text-center text-sm leading-6 text-white/68">
              Access is limited to Stanford Law School Google accounts. New accounts may be reviewed by an admin before access is granted.
            </p>
            {error && <p role="alert" className="mt-4 text-center text-sm text-red-200">{error}</p>}
          </div>
        </section>

        <section className="grid w-full gap-4 md:grid-cols-2" aria-labelledby="features-title">
          <div className="md:col-span-2 text-center">
            <h2 id="features-title" className="font-headline text-2xl font-bold">What you can do in {portalName}</h2>
          </div>
          <div className="glass-on-dark rounded-3xl p-5">
            <GraduationCap className="mb-3 h-6 w-6 text-red-200" aria-hidden />
            <h3 className="font-headline text-lg font-bold">For students</h3>
            <p className="mt-2 text-sm leading-6 text-white/72">Discover responsible AI workflows, swap prompts for classes and clinics, ask questions, and learn from peers across the SLS community.</p>
          </div>
          <div className="glass-on-dark rounded-3xl p-5">
            <UsersRound className="mb-3 h-6 w-6 text-red-200" aria-hidden />
            <h3 className="font-headline text-lg font-bold">For faculty and staff</h3>
            <p className="mt-2 text-sm leading-6 text-white/72">Share teaching, research, and operational use cases; collect feedback; coordinate resources; and surface examples that help SLS use AI thoughtfully.</p>
          </div>
          <div className="glass-on-dark rounded-3xl p-5">
            <MessageSquareText className="mb-3 h-6 w-6 text-red-200" aria-hidden />
            <h3 className="font-headline text-lg font-bold">Discussion threads</h3>
            <p className="mt-2 text-sm leading-6 text-white/72">Start focused conversations around tools, policies, assignments, legal research, and emerging AI practices.</p>
          </div>
          <div className="glass-on-dark rounded-3xl p-5">
            <BookOpenText className="mb-3 h-6 w-6 text-red-200" aria-hidden />
            <h3 className="font-headline text-lg font-bold">Prompt library</h3>
            <p className="mt-2 text-sm leading-6 text-white/72">Save reusable prompts with context so others can adapt successful patterns without starting from scratch.</p>
          </div>
        </section>
      </main>
    </div>
  );
}
