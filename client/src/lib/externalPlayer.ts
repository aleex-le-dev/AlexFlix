/**
 * Lecture dans VLC quand le navigateur ne décode pas le son (Dolby AC3 / E-AC3 / DTS des MKV).
 * Android : intent VLC ; iPhone/iPad : schéma vlc-x-callback ; ordinateur : playlist .m3u (ouverte par VLC).
 */

type Platform = 'android' | 'ios' | 'desktop';

function platform(): Platform {
  const ua = navigator.userAgent;
  if (/android/i.test(ua)) return 'android';
  if (/iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios';
  return 'desktop';
}

export function openInVlc(url: string, title: string): void {
  const target = platform();
  if (target === 'android') {
    const parsed = new URL(url);
    window.location.href = `intent://${parsed.host}${parsed.pathname}${parsed.search}#Intent;scheme=${parsed.protocol.replace(':', '')};package=org.videolan.vlc;type=video/*;S.title=${encodeURIComponent(title)};end`;
    return;
  }
  if (target === 'ios') {
    window.location.href = `vlc-x-callback://x-callback-url/stream?url=${encodeURIComponent(url)}`;
    return;
  }
  const playlist = `#EXTM3U\n#EXTINF:-1,${title}\n${url}\n`;
  const blob = new Blob([playlist], { type: 'audio/x-mpegurl' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${title.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'video'}.m3u`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 10000);
}

export const vlcHint = (): string =>
  platform() === 'desktop'
    ? 'Le fichier .m3u téléchargé s’ouvre dans VLC (videolan.org si besoin).'
    : 'Nécessite l’application VLC (gratuite).';

/**
 * L'appareil décode-t-il le Dolby lui-même (TV Samsung/LG, Safari, certains Edge) ?
 * Dans ce cas on garde le son d'origine (5.1) au lieu de la piste AAC stéréo.
 */
export function supportsDolby(): boolean {
  try {
    const video = document.createElement('video');
    return ['audio/mp4; codecs="ac-3"', 'audio/mp4; codecs="ec-3"', 'audio/ac3', 'audio/eac3'].some((type) => video.canPlayType(type) !== '');
  } catch {
    return false;
  }
}

/** true si le navigateur lit la vidéo sans décoder aucun son (Chrome/Edge, Firefox, Safari). */
export function hasNoAudio(video: HTMLVideoElement): boolean | null {
  const v = video as HTMLVideoElement & {
    webkitAudioDecodedByteCount?: number;
    mozHasAudio?: boolean;
    audioTracks?: { length: number };
  };
  if (typeof v.webkitAudioDecodedByteCount === 'number') return v.webkitAudioDecodedByteCount === 0;
  if (typeof v.mozHasAudio === 'boolean') return !v.mozHasAudio;
  if (v.audioTracks) return v.audioTracks.length === 0;
  return null;
}
