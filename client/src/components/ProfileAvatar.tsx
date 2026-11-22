import type { AvatarId } from '../types';
import { imageUrl } from '../lib/api';

const COLORS: Record<Exclude<AvatarId, 'bounty'>, string> = {
  red: '#e50914',
  blue: '#2f6fde',
  yellow: '#f5b301',
  green: '#1ea35b',
  purple: '#7b3fe4',
  pink: '#e0469a'
};

/** Source d'image d'un avatar non prédéfini (photo par défaut, image importée), sinon null. */
export function avatarImage(avatar: string): string | null {
  if (avatar === 'bounty') return '/avatar.jpg';
  if (avatar.startsWith('data:image/')) return avatar;
  const custom = /^custom:([a-f0-9]{16})$/.exec(avatar);
  if (custom) return `/avatars/${custom[1]}.jpg`;
  const film = /^film:([a-z0-9-]+\.jpg)$/.exec(avatar);
  return film ? imageUrl(film[1]) : null;
}

export function ProfileAvatar({ avatar, className = '' }: { avatar: string; className?: string }) {
  const image = avatarImage(avatar);
  if (image) {
    return (
      <img
        src={image}
        alt=""
        draggable={false}
        className={`object-cover ${className}`}
        style={avatar.startsWith('film:') ? { objectPosition: avatar.startsWith('film:person-') ? '50% 22%' : '50% 18%' } : undefined}
      />
    );
  }
  const color = COLORS[avatar as Exclude<AvatarId, 'bounty'>] ?? COLORS.red;
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true">
      <rect width="100" height="100" fill={color} />
      <circle cx="34" cy="40" r="6" fill="#fff" />
      <circle cx="66" cy="40" r="6" fill="#fff" />
      <path d="M28 62 Q50 82 72 62" stroke="#fff" strokeWidth="6" strokeLinecap="round" fill="none" />
    </svg>
  );
}
