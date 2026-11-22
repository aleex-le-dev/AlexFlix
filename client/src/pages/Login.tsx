import { useState, type FormEvent } from 'react';
import { motion } from 'framer-motion';
import { LoaderCircle, Lock } from 'lucide-react';
import { api } from '../lib/api';
import { Logo } from '../components/Logo';

export function Login({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!password || loading) return;
    setLoading(true);
    setError(null);
    try {
      await api.login(password);
      onSuccess();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Connexion impossible.');
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-black">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(229,9,20,0.35),transparent_60%),radial-gradient(ellipse_at_bottom_right,rgba(120,10,30,0.45),transparent_55%)]" />
      <div className="login-grid pointer-events-none absolute inset-0" />
      <div className="absolute inset-0 bg-linear-to-b from-black/60 via-transparent to-black" />

      <header className="relative z-10 px-6 py-6 md:px-12">
        <Logo size="lg" />
      </header>

      <motion.form
        onSubmit={submit}
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className="relative z-10 mx-auto mt-6 w-[calc(100%-2rem)] max-w-md rounded-lg bg-black/70 p-8 shadow-2xl ring-1 ring-white/10 backdrop-blur-md md:mt-16 md:p-14"
      >
        <h1 className="mb-2 text-3xl font-bold text-white">S'identifier</h1>
        <p className="mb-7 text-sm text-neutral-400">Votre bibliothèque Freebox, en streaming privé.</p>

        <div className="relative">
          <input
            id="ap-password"
            type={show ? 'text' : 'password'}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoFocus
            autoComplete="current-password"
            placeholder=" "
            className="peer w-full rounded bg-neutral-800/80 px-4 pb-2 pt-6 pr-20 text-white outline-hidden ring-1 ring-white/10 transition focus:ring-2 focus:ring-white/70"
          />
          <label
            htmlFor="ap-password"
            className="pointer-events-none absolute left-4 top-4 text-neutral-400 transition-all peer-focus:top-1.5 peer-focus:text-xs peer-[:not(:placeholder-shown)]:top-1.5 peer-[:not(:placeholder-shown)]:text-xs"
          >
            Mot de passe maître
          </label>
          <button
            type="button"
            onClick={() => setShow((value) => !value)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-neutral-400 hover:text-white"
          >
            {show ? 'Masquer' : 'Afficher'}
          </button>
        </div>

        {error && <p className="mt-3 rounded bg-[#e87c03]/15 px-3 py-2 text-sm text-[#ffb45a]">{error}</p>}

        <button
          type="submit"
          disabled={loading || !password}
          className="mt-8 inline-flex w-full items-center justify-center gap-2 rounded bg-ap-red py-3 font-semibold text-white transition hover:bg-[#f6121d] disabled:opacity-60"
        >
          {loading ? <LoaderCircle className="h-5 w-5 animate-spin" /> : <Lock className="h-4 w-4" />}
          {loading ? 'Connexion…' : 'Se connecter'}
        </button>

        <p className="mt-8 text-xs leading-relaxed text-neutral-500">
          Accès privé Alex Prime. Session chiffrée par jeton JWT dans un cookie HttpOnly. Utilisez le VPN Freebox ou un accès HTTPS hors de chez vous.
        </p>
      </motion.form>
    </div>
  );
}
