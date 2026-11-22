import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { api, UNAUTHORIZED_EVENT } from './lib/api';
import { Login } from './pages/Login';
import { Browse } from './pages/Browse';
import { Profiles } from './pages/Profiles';
import { Splash } from './components/Skeletons';

type AuthState = 'checking' | 'in' | 'out';

export const PROFILES_EVENT = 'alexprime:profiles';
const PROFILE_KEY = 'alexprime:profile';

function readProfile(): boolean {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('profil') === 'alex') {
      sessionStorage.setItem(PROFILE_KEY, 'alex');
      window.history.replaceState(null, '', window.location.pathname);
      return true;
    }
    return sessionStorage.getItem(PROFILE_KEY) === 'alex';
  } catch {
    return false;
  }
}

function writeProfile(selected: boolean): void {
  try {
    if (selected) sessionStorage.setItem(PROFILE_KEY, 'alex');
    else sessionStorage.removeItem(PROFILE_KEY);
  } catch {
    return;
  }
}

export default function App() {
  const [auth, setAuth] = useState<AuthState>('checking');
  const [profile, setProfile] = useState<boolean>(readProfile);

  useEffect(() => {
    let cancelled = false;
    api
      .me()
      .then(() => {
        if (!cancelled) setAuth('in');
      })
      .catch(() => {
        if (!cancelled) setAuth('out');
      });
    const onUnauthorized = (): void => {
      if (__VITRINE__) window.location.reload();
      else setAuth('out');
    };
    const onProfiles = (): void => {
      writeProfile(false);
      setProfile(false);
      window.scrollTo({ top: 0 });
    };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    window.addEventListener(PROFILES_EVENT, onProfiles);
    return () => {
      cancelled = true;
      window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
      window.removeEventListener(PROFILES_EVENT, onProfiles);
    };
  }, []);

  if (auth === 'checking') return <Splash />;
  if (auth === 'out') return <Login onSuccess={() => setAuth('in')} />;

  return (
    <AnimatePresence mode="wait">
      {profile ? (
        <motion.div key="browse" initial={{ opacity: 0, scale: 1.04 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.45 }}>
          <Browse onLogout={() => setAuth('out')} />
        </motion.div>
      ) : (
        <motion.div key="profiles" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, scale: 1.08 }} transition={{ duration: 0.35 }}>
          <Profiles
            onSelect={() => {
              writeProfile(true);
              setProfile(true);
            }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
