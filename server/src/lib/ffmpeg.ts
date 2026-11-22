import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { config } from '../config.js';

export interface ProbeInfo {
  duration: number | null;
  formatName: string;
  videoCodec: string | null;
  pixFmt: string | null;
  width: number | null;
  height: number | null;
  audioCodec: string | null;
  audioIndex: number | null;
  audioLanguages: string[];
}

export interface PlaybackDecision {
  needsTranscode: boolean;
  copyVideo: boolean;
  reason: string;
}

interface ProbeStream {
  index: number;
  codec_type?: string;
  codec_name?: string;
  pix_fmt?: string;
  width?: number;
  height?: number;
  tags?: { language?: string };
  disposition?: { default?: number; attached_pic?: number };
}

let ffmpegFound = false;
const probeCache = new Map<string, ProbeInfo>();
const FRENCH = new Set(['fre', 'fra', 'fr', 'french']);
const DIRECT_CONTAINERS = new Set(['.mp4', '.m4v', '.webm', '.mkv', '.mov']);
const BROWSER_VIDEO = new Set(['h264', 'vp8', 'vp9', 'av1']);
const BROWSER_AUDIO = new Set(['aac', 'mp3', 'opus', 'vorbis', 'flac']);

export const transcodeAvailable = (): boolean => config.enableTranscode && ffmpegFound;

function run(command: string, args: string[], timeoutMs: number): Promise<{ code: number | null; stdout: string }> {
  return new Promise((resolve) => {
    let stdout = '';
    let settled = false;
    const finish = (code: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout });
    };
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(command, args, { windowsHide: true });
    } catch {
      resolve({ code: -1, stdout: '' });
      return;
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(-1);
    }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.resume();
    child.on('error', () => finish(-1));
    child.on('close', (code) => finish(code));
  });
}

export async function detectFfmpeg(): Promise<boolean> {
  if (!config.enableTranscode) {
    ffmpegFound = false;
    return false;
  }
  const [ffmpeg, ffprobe] = await Promise.all([
    run(config.ffmpegPath, ['-hide_banner', '-version'], 10000),
    run(config.ffprobePath, ['-hide_banner', '-version'], 10000)
  ]);
  ffmpegFound = ffmpeg.code === 0 && ffprobe.code === 0;
  return ffmpegFound;
}

export async function probeFile(cacheKey: string, absPath: string): Promise<ProbeInfo | null> {
  if (!ffmpegFound) return null;
  const cached = probeCache.get(cacheKey);
  if (cached) return cached;
  const { code, stdout } = await run(
    config.ffprobePath,
    ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', absPath],
    30000
  );
  if (code !== 0) return null;
  try {
    const data = JSON.parse(stdout) as { format?: { duration?: string; format_name?: string }; streams?: ProbeStream[] };
    const streams = data.streams ?? [];
    const video = streams.find((stream) => stream.codec_type === 'video' && stream.disposition?.attached_pic !== 1);
    const audios = streams.filter((stream) => stream.codec_type === 'audio');
    let audioIndex = audios.findIndex((stream) => FRENCH.has((stream.tags?.language ?? '').toLowerCase()));
    if (audioIndex < 0) audioIndex = audios.findIndex((stream) => stream.disposition?.default === 1);
    if (audioIndex < 0 && audios.length > 0) audioIndex = 0;
    const audio = audioIndex >= 0 ? audios[audioIndex] : undefined;
    const info: ProbeInfo = {
      duration: Number(data.format?.duration) || null,
      formatName: data.format?.format_name ?? '',
      videoCodec: video?.codec_name ?? null,
      pixFmt: video?.pix_fmt ?? null,
      width: video?.width ?? null,
      height: video?.height ?? null,
      audioCodec: audio?.codec_name ?? null,
      audioIndex: audioIndex >= 0 ? audioIndex : null,
      audioLanguages: audios.map((stream) => stream.tags?.language ?? 'und')
    };
    probeCache.set(cacheKey, info);
    return info;
  } catch {
    return null;
  }
}

export function decide(ext: string, info: ProbeInfo | null): PlaybackDecision {
  const pixFmt = info?.pixFmt ?? '';
  const copyVideo =
    info !== null && info.videoCodec === 'h264' && !pixFmt.includes('10') && !pixFmt.includes('422') && !pixFmt.includes('444');
  if (!DIRECT_CONTAINERS.has(ext.toLowerCase())) {
    return { needsTranscode: true, copyVideo, reason: `Conteneur ${ext} non lu par les navigateurs` };
  }
  if (!info) return { needsTranscode: false, copyVideo, reason: 'Analyse indisponible : lecture directe' };
  if (info.videoCodec && !BROWSER_VIDEO.has(info.videoCodec)) {
    return { needsTranscode: true, copyVideo, reason: `Vidéo ${info.videoCodec.toUpperCase()} non supportée` };
  }
  if (info.videoCodec === 'h264' && !copyVideo) {
    return { needsTranscode: true, copyVideo, reason: 'H.264 10 bits / 4:2:2 non supporté' };
  }
  if (info.audioCodec && !BROWSER_AUDIO.has(info.audioCodec)) {
    return { needsTranscode: true, copyVideo, reason: `Audio ${info.audioCodec.toUpperCase()} non supporté` };
  }
  return { needsTranscode: false, copyVideo, reason: 'Lecture directe compatible' };
}

export function spawnTranscode(
  absPath: string,
  start: number,
  copyVideo: boolean,
  audioIndex: number | null
): ChildProcessWithoutNullStreams {
  const args = ['-hide_banner', '-loglevel', 'error', '-nostdin'];
  if (start > 0) args.push('-ss', start.toFixed(2));
  args.push('-i', absPath, '-map', '0:v:0', '-map', `0:a:${audioIndex ?? 0}?`, '-sn', '-dn');
  if (copyVideo) {
    args.push('-c:v', 'copy');
  } else {
    args.push(
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '21',
      '-pix_fmt', 'yuv420p',
      '-profile:v', 'high',
      '-vf', "scale='min(1920,iw)':-2",
      '-maxrate', '12M',
      '-bufsize', '24M'
    );
  }
  args.push(
    '-c:a', 'aac',
    '-b:a', '192k',
    '-ac', '2',
    '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
    '-f', 'mp4',
    'pipe:1'
  );
  return spawn(config.ffmpegPath, args, { windowsHide: true });
}
