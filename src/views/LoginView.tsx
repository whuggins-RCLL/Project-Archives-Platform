import React, { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { FolderArchive, LogIn } from 'lucide-react';
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
  const { user, isAuthReady } = useAuthUser();

  // Firebase persists the session — someone who is already signed in (e.g.
  // coming back from the public portal) goes straight to the dashboard
  // instead of being asked to authenticate again.
  if (!isAuthReady) {
    return (
      <div className="relative min-h-screen flex items-center justify-center font-body text-white overflow-hidden">
        <div className="brand-hero absolute inset-0 -z-20" aria-hidden />
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-white/30 border-t-white" role="status" aria-label="Checking your session" />
      </div>
    );
  }
  if (user) {
    return <Navigate to="/app" replace />;
  }

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
    <div className="relative min-h-screen flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8 font-body text-white overflow-hidden">
      <div className="brand-hero absolute inset-0 -z-20" aria-hidden />
      <div className="brand-hero-grid absolute inset-0 -z-10 opacity-60" aria-hidden />
      <div className="pointer-events-none absolute -top-24 -left-24 h-72 w-72 rounded-full bg-white/10 blur-3xl" aria-hidden />
      <div className="pointer-events-none absolute -bottom-24 -right-24 h-72 w-72 rounded-full bg-white/10 blur-3xl" aria-hidden />

      <div className="absolute top-4 right-4 z-10">
        <ThemeToggle tone="on-dark" />
      </div>

      <div className="sm:mx-auto sm:w-full sm:max-w-md animate-fade-in-up">
        <div className="flex justify-center">
          {branding.logoUrl ? (
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-white/30 bg-white shadow-xl">
              <img src={branding.logoUrl} alt="" className="max-h-14 max-w-14 object-contain" />
            </div>
          ) : (
            <div className="w-16 h-16 glass-on-dark glass-sheen rounded-2xl flex items-center justify-center shadow-xl">
              <FolderArchive className="text-white w-8 h-8" aria-hidden />
            </div>
          )}
        </div>
        <h2 className="mt-6 text-center text-3xl font-extrabold font-headline tracking-tight">
          Team Login
        </h2>
        <p className="mt-2 text-center text-sm text-white/70">
          Sign in to the {branding.suiteName || APP_CONFIG.appName} workspace for {branding.portalName || APP_CONFIG.portalName}
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md animate-fade-in-up" style={{ animationDelay: '120ms' }}>
        <div className="glass-on-dark glass-sheen py-8 px-6 sm:px-10 rounded-2xl shadow-2xl text-center">
          <button
            onClick={handleLogin}
            disabled={isLoading}
            className="w-full flex justify-center items-center gap-2 py-3 px-4 rounded-xl text-sm font-semibold text-brand-dark bg-white shadow-lg transition-all hover:-translate-y-0.5 hover:shadow-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-60 disabled:translate-y-0"
          >
            <LogIn className="w-5 h-5" />
            {isLoading ? 'Signing in...' : 'Sign in with Google'}
          </button>

          {error && <p className="mt-4 text-sm text-red-200">{error}</p>}

          <div className="mt-6 text-center">
            <button
              onClick={() => navigate('/')}
              className="text-sm text-white/70 hover:text-white transition-colors"
            >
              &larr; Back to Public Portal
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
