import { useEffect, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth, isFirebaseConfigured } from '../lib/firebase';

/**
 * Subscribes to the Firebase auth state so views outside the protected /app
 * shell (public page, login page) can tell whether a team member is already
 * signed in. `loading` stays true until Firebase restores the persisted
 * session, so callers can avoid flashing signed-out UI at returning users.
 */
export function useAuthUser(): { user: User | null; loading: boolean } {
  const [user, setUser] = useState<User | null>(() => auth.currentUser);
  const [loading, setLoading] = useState(isFirebaseConfigured && !auth.currentUser);

  useEffect(() => {
    if (!isFirebaseConfigured) return;
    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  return { user, loading };
}
