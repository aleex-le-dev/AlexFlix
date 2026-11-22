import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { parseDuration } from './lib/utils.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SERVER_ROOT = path.resolve(here, '..');
export const PROJECT_ROOT = path.resolve(SERVER_ROOT, '..');

for (const file of [path.join(PROJECT_ROOT, '.env'), path.join(SERVER_ROOT, '.env')]) {
  if (fs.existsSync(file)) dotenv.config({ path: file, quiet: true });
}

function str(name: string, fallback = ''): string {
  const value = process.env[name];
  return value === undefined || value.trim() === '' ? fallback : value.trim();
}

function int(name: string, fallback: number): number {
  const value = Number.parseInt(str(name), 10);
  return Number.isFinite(value) ? value : fallback;
}

function bool(name: string, fallback: boolean): boolean {
  const value = str(name).toLowerCase();
  if (!value) return fallback;
  return ['1', 'true', 'yes', 'on', 'oui'].includes(value);
}

function list(name: string, fallback: string[]): string[] {
  const value = str(name);
  return value ? value.split(',').map((item) => item.trim()).filter(Boolean) : fallback;
}

function fromRoot(target: string): string {
  return path.isAbsolute(target) ? target : path.resolve(PROJECT_ROOT, target);
}

const rawMediaPath = str('MEDIA_PATH');

export const config = {
  port: int('PORT', 4000),
  host: str('HOST', '0.0.0.0'),
  logLevel: str('LOG_LEVEL', 'info'),
  mediaPath: rawMediaPath ? path.resolve(fromRoot(rawMediaPath)) : '',
  moviesDir: str('MOVIES_DIR', 'Films'),
  seriesDir: str('SERIES_DIR', 'Séries'),
  dataDir: fromRoot(str('DATA_DIR', './data')),
  videoExtensions: list('VIDEO_EXTENSIONS', ['.mp4', '.mkv', '.avi', '.mov', '.m4v', '.webm', '.ts', '.m2ts', '.wmv', '.mpg']).map(
    (ext) => (ext.startsWith('.') ? ext : `.${ext}`).toLowerCase()
  ),
  tmdbApiKey: str('TMDB_API_KEY'),
  tmdbLanguage: str('TMDB_LANGUAGE', 'fr-FR'),
  masterPassword: str('MASTER_PASSWORD'),
  jwtSecret: str('JWT_SECRET'),
  jwtExpiresSeconds: parseDuration(str('JWT_EXPIRES_IN', '7d'), 604800),
  cookieSecure: bool('COOKIE_SECURE', false),
  trustProxy: bool('TRUST_PROXY', false),
  corsOrigin: list('CORS_ORIGIN', []),
  scanOnStart: bool('SCAN_ON_START', true),
  scanIntervalMinutes: int('SCAN_INTERVAL_MINUTES', 60),
  enableTranscode: bool('ENABLE_TRANSCODE', true),
  ffmpegPath: str('FFMPEG_PATH', 'ffmpeg'),
  ffprobePath: str('FFPROBE_PATH', 'ffprobe'),
  clientDist: path.join(PROJECT_ROOT, 'client', 'dist'),
  scanSource: str('SCAN_SOURCE', 'auto').toLowerCase(),
  scanExclude: list('SCAN_EXCLUDE', []).map((name) => name.toLowerCase()),
  freeboxUrl:str('FREEBOX_URL', 'http://mafreebox.freebox.fr').replace(/\/+$/, ''),
  freeboxMediaRoot: str('FREEBOX_MEDIA_ROOT', '/Disque dur/Vidéos').replace(/\\/g, '/').replace(/\/+$/, ''),
  freeboxLinkDays: int('FREEBOX_LINK_DAYS', 365),
  vitrinePin: str('VITRINE_PIN'),
  homeIps: list('HOME_IPS', ['auto']),
  vitrineSessionDays: int('VITRINE_SESSION_DAYS', 365),
  siteUrl: str('SITE_URL'),
  freeboxAppId: str('FREEBOX_APP_ID', 'alexprime.app'),
  ftpHost: str('FTP_HOST'),
  ftpPort: int('FTP_PORT', 21),
  ftpUser: str('FTP_USER'),
  ftpPassword: process.env.FTP_PASSWORD ?? '',
  ftpSecure: str('FTP_SECURE', 'true').toLowerCase(),
  ftpTlsInsecure: bool('FTP_TLS_INSECURE', false),
  ftpRemoteDir: str('FTP_REMOTE_DIR', '/')
};

export type AppConfig = typeof config;

export function validateConfig(scope: 'server' | 'scan' | 'deploy' | 'deploy-scan' = 'server'): string[] {
  const errors: string[] = [];
  if (!['auto', 'smb', 'freebox'].includes(config.scanSource)) errors.push('SCAN_SOURCE doit valoir auto, smb ou freebox.');
  const needsMedia = scope === 'server' || (config.scanSource === 'smb' && scope !== 'deploy');
  if (needsMedia && !config.mediaPath) errors.push('MEDIA_PATH est obligatoire (ex : Z:\\Vidéos ou /mnt/freebox/Vidéos).');
  if (scope === 'server' && config.masterPassword.length < 8) errors.push('MASTER_PASSWORD doit contenir au moins 8 caractères.');
  if (scope === 'server' || scope.startsWith('deploy')) {
    if (config.jwtSecret.length < 32) errors.push('JWT_SECRET doit contenir au moins 32 caractères.');
  }
  if (scope.startsWith('deploy')) {
    if (!/^\d{4,6}$/.test(config.vitrinePin)) errors.push('VITRINE_PIN doit contenir 4 à 6 chiffres.');
    if (!config.ftpHost || !config.ftpUser || !config.ftpPassword) errors.push('FTP_HOST, FTP_USER et FTP_PASSWORD sont obligatoires.');
    if (!['true', 'false', 'implicit'].includes(config.ftpSecure)) errors.push('FTP_SECURE doit valoir true, false ou implicit.');
  }
  return errors;
}
