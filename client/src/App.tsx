import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { Profile } from './types';
import { api, UNAUTHORIZED_EVENT } from './lib/api';
import { activateProfile, flushProgress, loadProfiles, readSelectedProfile, saveProfiles, writeSelectedProfile } from './lib/profiles';
import { Login } from './pages/Login';
import { Browse } from './pages/Browse';
import { Profiles } from './pages/Profiles';
import { Splash } from './components/Skeletons';

type AuthState = 'checking' | 'in' | 'out';

export default function App() {
  const [auth, setAuth] = useState<AuthState>('checking');
  const [profiles, setProfiles] = useState<Profile[] | null>(null);
  const [profileId, setProfileId] = useState<string | null>(readSelectedProfile);
  const [managing, setManaging] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .me()
      .then(async () => {
        const list = await loadProfiles();
        if (cancelled) return;
        const selected = readSelectedProfile();
        if (selected && list.some((profile) => profile.id === selected)) activateProfile(selected);
        setProfiles(list);
        setAuth('in');
      })
      .catch(() => {
        if (!cancelled) setAuth('out');
      });
    const onUnauthorized = (): void => {
      if (__VITRINE__) window.location.reload();
      else setAuth('out');
    };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => {
      cancelled = true;
      window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    };
  }, []);

  const current = profiles?.find((profile) => profile.id === profileId) ?? null;

  useEffect(() => {
    if (current) activateProfile(current.id);
  }, [current]);

  const selectProfile = useCallback((id: string | null, manage = false) => {
    if (id) activateProfile(id);
    writeSelectedProfile(id);
    setProfileId(id);
    setManaging(manage);
    window.scrollTo({ top: 0 });
  }, []);

  const changeProfiles = useCallback(
    async (next: Profile[], removed: string[]) => {
      await saveProfiles(next, removed);
      setProfiles(next);
      if (profileId && removed.includes(profileId)) selectProfile(null, true);
    },
    [profileId, selectProfile]
  );

  const logout = useCallback(async () => {
    flushProgress(true);
    writeSelectedProfile(null);
    if (__VITRINE__) {
      window.location.assign('/__logout');
      return;
    }
    await api.logout().catch(() => undefined);
    setProfileId(null);
    setAuth('out');
  }, []);

  if (auth === 'checking') return <Splash />;
  if (auth === 'out') return <Login onSuccess={() => window.location.reload()} />;
  if (!profiles) return <Splash />;

  return (
    <AnimatePresence mode="wait">
      {current ? (
        <motion.div key={`browse-${current.id}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.45 }}>
          <Browse
            profile={current}
            profiles={profiles}
            onSwitchProfile={(id) => selectProfile(id)}
            onManageProfiles={() => selectProfile(null, true)}
            onLogout={() => void logout()}
          />
        </motion.div>
      ) : (
        <motion.div key={`profiles-${managing}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, scale: 1.08 }} transition={{ duration: 0.35 }}>
          <Profiles
            profiles={profiles}
            startManaging={managing}
            onSelect={(id) => selectProfile(id)}
            onChange={changeProfiles}
            onAvatarRemoved={(removed) =>
              setProfiles((list) => list?.map((item) => (item.avatar === removed ? { ...item, avatar: 'red' } : item)) ?? list)
            }
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
