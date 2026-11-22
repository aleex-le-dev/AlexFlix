interface Props {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

const SIZES: Record<NonNullable<Props['size']>, string> = {
  sm: 'text-[1.7rem] md:text-[2.1rem]',
  md: 'text-3xl md:text-4xl',
  lg: 'text-5xl md:text-6xl',
  xl: 'text-6xl md:text-8xl'
};

export function Logo({ size = 'md', className = '' }: Props) {
  return (
    <span
      className={`inline-flex select-none items-baseline font-display leading-none tracking-[0.06em] ${SIZES[size]} ${className}`}
      aria-label="Alex Prime"
    >
      <span className="bg-linear-to-b from-[#ff3b47] via-[#e50914] to-[#9d0610] bg-clip-text text-transparent drop-shadow-[0_2px_12px_rgba(229,9,20,0.55)]">
        ALEX
      </span>
      <span className="ml-[0.16em] bg-linear-to-b from-white via-neutral-200 to-neutral-500 bg-clip-text text-transparent drop-shadow-[0_2px_10px_rgba(0,0,0,0.6)]">
        PRIME
      </span>
    </span>
  );
}
