import { motion } from 'framer-motion';
import { Logo } from '../components/Logo';

interface Props {
  onSelect: () => void;
}

function Avatar() {
  return <img src="/avatar.jpg" alt="" className="h-full w-full object-cover" draggable={false} />;
}

export function Profiles({ onSelect }: Props) {
  return (
    <div className="flex min-h-screen flex-col bg-ap-bg">
      <header className="px-6 py-6 md:px-12">
        <Logo size="sm" />
      </header>
      <main className="flex flex-1 flex-col items-center justify-center px-6 pb-24">
        <motion.h1
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="text-center text-4xl font-medium text-white md:text-6xl"
        >
          Qui est-ce ?
        </motion.h1>
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, delay: 0.15 }}
          className="mt-10 flex flex-wrap justify-center gap-8"
        >
          <button type="button" onClick={onSelect} className="group flex flex-col items-center gap-4 outline-hidden" autoFocus>
            <span className="block h-28 w-28 overflow-hidden rounded-md ring-[3px] ring-transparent transition duration-200 group-hover:ring-white group-focus-visible:ring-white md:h-40 md:w-40">
              <Avatar />
            </span>
            <span className="text-lg text-neutral-400 transition group-hover:text-white group-focus-visible:text-white md:text-xl">Alex</span>
          </button>
        </motion.div>
      </main>
    </div>
  );
}
