import crypto from 'node:crypto';
import path from 'node:path';

export function sha1(input: string): string {
  return crypto.createHash('sha1').update(input).digest('hex');
}

export function fileIdFor(relPath: string): string {
  return sha1(relPath.normalize('NFC')).slice(0, 16);
}

export function normalizeKey(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function parseDuration(input: string, fallbackSeconds: number): number {
  const match = /^(\d+)\s*([smhdw]?)$/i.exec(input.trim());
  if (!match) return fallbackSeconds;
  const value = Number(match[1]);
  const unit = match[2].toLowerCase();
  const multiplier = unit === 'm' ? 60 : unit === 'h' ? 3600 : unit === 'd' ? 86400 : unit === 'w' ? 604800 : 1;
  return value * multiplier;
}

const VIDEO_MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.ts': 'video/mp2t',
  '.m2ts': 'video/mp2t',
  '.wmv': 'video/x-ms-wmv',
  '.mpg': 'video/mpeg',
  '.mpeg': 'video/mpeg',
  '.flv': 'video/x-flv'
};

export function videoMime(ext: string): string {
  return VIDEO_MIME[ext.toLowerCase()] ?? 'application/octet-stream';
}

export function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export const nowIso = (): string => new Date().toISOString();
