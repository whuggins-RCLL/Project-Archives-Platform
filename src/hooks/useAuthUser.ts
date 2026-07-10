import { useEffect, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth, isFirebaseConfigured } from '../lib/firebase';

/**
 * Lightweight auth-state subscription for views that live outside the
 * protected app shell (public portal, login). Firebase persists sessions
 * across navigation, so these views can react to an existing sign-in
 * instead of forcing the user through the login flow again.
 */
export function useAuthUser() {
  const [user, setUser] = useState<User | null>(() => (isFirebaseConfigured ? auth.currentUser : null));
  const [isAuthReady, setIsAuthReady] = useState(false);

  useEffect(() => {
    if (!isFirebaseConfigured) {
      setIsAuthReady(true);
      return;
    }
    const unsubscribe = onAuthStateChanged(auth, (next) => {
      setUser(next);
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  return { user, isAuthReady };
}
