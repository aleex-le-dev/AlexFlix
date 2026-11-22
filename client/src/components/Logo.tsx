interface Props {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

const SIZES: Record<NonNullable<Props['size']>, string> = {
  sm: 'text-[1.8rem] md:text-[2.2rem]',
  md: 'text-3xl md:text-4xl',
  lg: 'text-5xl md:text-6xl',
  xl: 'text-6xl md:text-8xl'
};

export function Logo({ size = 'md', className = '' }: Props) {
  return (
    <span
      className={`inline-block select-none font-display leading-none tracking-[0.04em] ${SIZES[size]} ${className}`}
      aria-label="AlexFlix"
    >
      <span className="bg-linear-to-b from-[#ff3b47] via-[#e50914] to-[#9d0610] bg-clip-text text-transparent drop-shadow-[0_2px_12px_rgba(229,9,20,0.55)]">
        ALEXFLIX
      </span>
    </span>
  );
}
