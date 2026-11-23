import { useEffect, useRef, useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { LoaderCircle, Pencil, Plus, Upload, X } from 'lucide-react';
import type { AvatarId, PersonAvatar, Profile } from '../types';
import { api } from '../lib/api';
import { Logo } from '../components/Logo';
import { ImageCropper } from '../components/ImageCropper';
import { ProfileAvatar } from '../components/ProfileAvatar';
import { AVATARS, deleteAvatar, listAvatars, MAX_PROFILES, newProfileId, uploadAvatar } from '../lib/profiles';

interface Props {
  profiles: Profile[];
  startManaging?: boolean;
  onSelect: (profileId: string) => void;
  onChange: (profiles: Profile[], removed: string[]) => Promise<void>;
  onAvatarRemoved: (avatar: string) => void;
}

type Editing = { mode: 'new' } | { mode: 'edit'; profile: Profile } | null;

const OUTLINE_BUTTON =
  'border border-neutral-500 px-6 py-2 text-sm uppercase tracking-[0.2em] text-neutral-400 transition hover:border-white hover:text-white md:text-base';

export function Profiles({ profiles, startManaging = false, onSelect, onChange, onAvatarRemoved }: Props) {
  const [managing, setManaging] = useState(startManaging);
  const [editing, setEditing] = useState<Editing>(null);

  return (
    <div className="flex min-h-screen flex-col bg-ap-bg">
      <header className="px-6 py-6 md:px-12">
        <Logo size="sm" />
      </header>
      <AnimatePresence mode="wait">
        {editing ? (
          <ProfileEditor
            key="editor"
            editing={editing}
            canDelete={editing.mode === 'edit' && profiles.length > 1}
            onCancel={() => setEditing(null)}
            onSave={async (profile) => {
              const next =
                editing.mode === 'new' ? [...profiles, profile] : profiles.map((item) => (item.id === profile.id ? profile : item));
              await onChange(next, []);
              setEditing(null);
            }}
            onAvatarRemoved={onAvatarRemoved}
            onDelete={async (profile) => {
              await onChange(
                profiles.filter((item) => item.id !== profile.id),
                [profile.id]
              );
              setEditing(null);
            }}
          />
        ) : (
          <motion.main
            key="list"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="flex flex-1 flex-col items-center justify-center px-6 pb-24"
          >
            <h1 className="text-center text-4xl font-medium text-white md:text-6xl">{managing ? 'Gérer les profils' : 'Qui est-ce ?'}</h1>
            <div className="mt-10 flex flex-wrap justify-center gap-5 md:gap-8">
              {profiles.map((profile, index) => (
                <button
                  key={profile.id}
                  type="button"
                  autoFocus={index === 0}
                  onClick={() => (managing ? setEditing({ mode: 'edit', profile }) : onSelect(profile.id))}
                  className="group flex w-28 flex-col items-center gap-3 outline-hidden md:w-40"
                >
                  <span className="relative block h-28 w-28 overflow-hidden rounded-md ring-[3px] ring-transparent transition duration-200 group-hover:ring-white group-focus-visible:ring-white md:h-40 md:w-40">
                    <ProfileAvatar avatar={profile.avatar} className="h-full w-full" />
                    {managing && (
                      <span className="absolute inset-0 grid place-items-center bg-black/55">
                        <Pencil className="h-9 w-9 text-white" />
                      </span>
                    )}
                  </span>
                  <span className="w-full truncate text-center text-lg text-neutral-400 transition group-hover:text-white group-focus-visible:text-white md:text-xl">
                    {profile.name}
                  </span>
                </button>
              ))}
              {profiles.length < MAX_PROFILES && (
                <button
                  type="button"
                  onClick={() => setEditing({ mode: 'new' })}
                  className="group flex w-28 flex-col items-center gap-3 outline-hidden md:w-40"
                >
                  <span className="grid h-28 w-28 place-items-center rounded-md transition group-hover:bg-white group-focus-visible:bg-white md:h-40 md:w-40">
                    <Plus className="h-16 w-16 text-neutral-400 transition group-hover:text-black group-focus-visible:text-black md:h-20 md:w-20" />
                  </span>
                  <span className="text-lg text-neutral-400 transition group-hover:text-white md:text-xl">Ajouter un profil</span>
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => setManaging((value) => !value)}
              className={`mt-14 ${managing ? 'bg-white px-6 py-2 text-sm font-semibold uppercase tracking-[0.2em] text-black hover:bg-ap-red hover:text-white md:text-base' : OUTLINE_BUTTON}`}
            >
              {managing ? 'Terminé' : 'Gérer les profils'}
            </button>
          </motion.main>
        )}
      </AnimatePresence>
    </div>
  );
}

interface EditorProps {
  editing: Exclude<Editing, null>;
  canDelete: boolean;
  onCancel: () => void;
  onSave: (profile: Profile) => Promise<void>;
  onDelete: (profile: Profile) => Promise<void>;
  onAvatarRemoved: (avatar: string) => void;
}

function AvatarChoice({
  avatar,
  selected,
  label,
  onPick
}: {
  avatar: string;
  selected: boolean;
  label?: string;
  onPick: (avatar: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onPick(avatar)}
      aria-label={label ?? 'Choisir cette image'}
      title={label}
      className={`aspect-square h-14 w-14 overflow-hidden rounded ring-[3px] transition ${
        selected ? 'ring-white' : 'ring-transparent hover:ring-neutral-400'
      }`}
    >
      <ProfileAvatar avatar={avatar} className="h-full w-full" />
    </button>
  );
}

function ProfileEditor({ editing, canDelete, onCancel, onSave, onDelete, onAvatarRemoved }: EditorProps) {
  const initial = editing.mode === 'edit' ? editing.profile : null;
  const [name, setName] = useState(initial?.name ?? '');
  const [avatar, setAvatar] = useState<string>(initial?.avatar ?? 'blue');
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const isCustom = !AVATARS.includes(avatar as AvatarId);

  const [cropFile, setCropFile] = useState<File | null>(null);
  const [gallery, setGallery] = useState<string[]>([]);
  const [people, setPeople] = useState<PersonAvatar[]>([]);

  useEffect(() => {
    let cancelled = false;
    void listAvatars().then((list) => {
      if (!cancelled) setGallery(list);
    });
    api
      .catalog()
      .then((catalog) => {
        if (!cancelled) setPeople(catalog.people ?? []);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const removeImage = async (image: string): Promise<void> => {
    if (!window.confirm('Supprimer cette image ? Les profils qui l’utilisent reprendront un avatar par défaut.')) return;
    try {
      await deleteAvatar(image);
      setGallery((list) => list.filter((item) => item !== image));
      if (avatar === image) setAvatar('red');
      onAvatarRemoved(image);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Suppression impossible');
    }
  };

  const pickImage = (file: File | undefined): void => {
    if (fileRef.current) fileRef.current.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Choisissez un fichier image.');
      return;
    }
    setError(null);
    setCropFile(file);
  };

  const importImage = async (dataUrl: string): Promise<void> => {
    setCropFile(null);
    setUploading(true);
    setError(null);
    try {
      const uploaded = await uploadAvatar(dataUrl);
      setAvatar(uploaded);
      if (uploaded.startsWith('custom:')) setGallery((list) => [uploaded, ...list.filter((item) => item !== uploaded)]);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Import impossible');
    } finally {
      setUploading(false);
    }
  };

  const run = async (task: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await task();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Enregistrement impossible');
      setBusy(false);
    }
  };

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const clean = name.replace(/\s+/g, ' ').trim();
    if (!clean) {
      setError('Indiquez un nom.');
      return;
    }
    void run(() => onSave({ id: initial?.id ?? newProfileId(clean), name: clean.slice(0, 20), avatar }));
  };

  return (
    <motion.main
      initial={{ opacity: 0, scale: 1.04 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      className="flex flex-1 items-center justify-center px-6 pb-24"
    >
      <form onSubmit={submit} className="w-full max-w-2xl">
        <h1 className="text-4xl font-medium text-white md:text-6xl">{initial ? 'Modifier le profil' : 'Ajouter un profil'}</h1>
        {!initial && <p className="mt-2 text-neutral-400">Ajoutez un profil pour une autre personne qui regarde AlexFlix.</p>}
        <div className="mt-6 flex flex-col gap-6 border-y border-neutral-700 py-6 sm:flex-row">
          <ProfileAvatar avatar={avatar} className="h-28 w-28 shrink-0 rounded-md md:h-32 md:w-32" />
          <div className="flex-1">
            <input
              autoFocus
              value={name}
              maxLength={20}
              onChange={(event) => setName(event.target.value)}
              placeholder="Nom"
              aria-label="Nom du profil"
              className="w-full bg-neutral-600 px-4 py-2.5 text-lg text-white outline-hidden placeholder:text-neutral-300 focus:ring-2 focus:ring-white"
            />
            <p className="mt-5 text-sm text-neutral-400">Image de profil</p>
            <div className="mt-2 flex flex-wrap gap-3">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => pickImage(event.target.files?.[0])}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                aria-label="Importer une image"
                title="Importer une image"
                className="grid h-14 w-14 place-items-center rounded border-2 border-dashed border-neutral-500 text-neutral-300 transition hover:border-white hover:text-white disabled:opacity-60"
              >
                {uploading ? <LoaderCircle className="h-6 w-6 animate-spin" /> : <Upload className="h-6 w-6" />}
              </button>
              {isCustom && !gallery.includes(avatar) && !avatar.startsWith('film:') && (
                <AvatarChoice avatar={avatar} selected onPick={setAvatar} />
              )}
              {AVATARS.map((option) => (
                <AvatarChoice key={option} avatar={option} selected={avatar === option} onPick={setAvatar} />
              ))}
            </div>

            {gallery.length > 0 && (
              <>
                <p className="mt-5 text-sm text-neutral-400">Mes images</p>
                <div className="mt-2 flex flex-wrap gap-3">
                  {gallery.map((option) => (
                    <div key={option} className="group relative">
                      <AvatarChoice avatar={option} selected={avatar === option} onPick={setAvatar} />
                      <button
                        type="button"
                        onClick={() => void removeImage(option)}
                        aria-label="Supprimer cette image"
                        title="Supprimer cette image"
                        className="absolute -right-2 -top-2 grid h-6 w-6 place-items-center rounded-full bg-black text-white ring-1 ring-white/50 transition hover:bg-ap-red md:opacity-0 md:group-hover:opacity-100"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}

            {people.length > 0 && (
              <>
                <p className="mt-5 text-sm text-neutral-400">Les visages de vos films</p>
                <div className="no-scrollbar mt-2 grid max-h-64 grid-cols-5 gap-3 overflow-y-auto p-1 sm:grid-cols-7">
                  {people.map((person) => (
                    <AvatarChoice
                      key={person.image}
                      avatar={`film:${person.image}`}
                      label={`${person.name}${person.character ? ` (${person.character})` : ''} · ${person.film}`}
                      selected={avatar === `film:${person.image}`}
                      onPick={setAvatar}
                    />
                  ))}
                </div>
              </>
            )}
            {error && <p className="mt-4 text-sm text-[#e87c03]">{error}</p>}
          </div>
        </div>
        <div className="mt-8 flex flex-wrap gap-4">
          <button
            type="submit"
            disabled={busy || uploading}
            className="bg-white px-6 py-2 text-sm font-semibold uppercase tracking-[0.2em] text-black transition hover:bg-ap-red hover:text-white disabled:opacity-60 md:text-base"
          >
            Enregistrer
          </button>
          <button type="button" onClick={onCancel} disabled={busy} className={OUTLINE_BUTTON}>
            Annuler
          </button>
          {initial && canDelete && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (window.confirm(`Supprimer le profil « ${initial.name} » et sa liste ?`)) void run(() => onDelete(initial));
              }}
              className={OUTLINE_BUTTON}
            >
              Supprimer le profil
            </button>
          )}
        </div>
      </form>
      <AnimatePresence>
        {cropFile && <ImageCropper file={cropFile} onCancel={() => setCropFile(null)} onConfirm={(dataUrl) => void importImage(dataUrl)} />}
      </AnimatePresence>
    </motion.main>
  );
}
