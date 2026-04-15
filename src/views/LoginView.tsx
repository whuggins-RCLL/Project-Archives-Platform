import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FolderArchive, LogIn } from 'lucide-react';
import { signInWithPopup, GoogleAuthProvider, signOut } from 'firebase/auth';
import { auth } from '../lib/firebase';
import { APP_CONFIG } from '../config';
import { useBranding } from '../hooks/useBranding';

export default function LoginView() {
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { branding } = useBranding();

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
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8 font-body">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex justify-center">
          {branding.logoUrl ? (
            <img src={branding.logoUrl} alt={`${branding.portalName} logo`} className="w-12 h-12 rounded-xl object-cover shadow-lg border border-outline-variant/30" />
          ) : (
            <div className="w-12 h-12 bg-primary rounded-xl flex items-center justify-center shadow-lg">
              <FolderArchive className="text-white w-6 h-6" />
            </div>
          )}
        </div>
        <h2 className="mt-6 text-center text-3xl font-extrabold text-slate-900 font-headline">
          Team Login
        </h2>
        <p className="mt-2 text-center text-sm text-slate-600">
          Access the {branding.appName || APP_CONFIG.appName} internal dashboard
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10 border border-slate-200 text-center">
          <button
            onClick={handleLogin}
            disabled={isLoading}
            className="w-full flex justify-center items-center gap-2 py-3 px-4 border border-slate-300 rounded-md shadow-sm text-sm font-medium text-slate-700 bg-white hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary transition-colors disabled:opacity-50"
          >
            <LogIn className="w-5 h-5" />
            {isLoading ? 'Signing in...' : 'Sign in with Google'}
          </button>
          
          {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
          
          <div className="mt-6 text-center">
            <button 
              onClick={() => navigate('/')}
              className="text-sm text-slate-500 hover:text-primary transition-colors"
            >
              &larr; Back to Public Portal
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
