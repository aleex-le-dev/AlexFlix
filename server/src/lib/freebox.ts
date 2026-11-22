import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import WebSocket from 'ws';
import { config } from '../config.js';
import { sleep } from './utils.js';

interface FbxResponse<T> {
  success: boolean;
  result?: T;
  msg?: string;
  error_code?: string;
}

interface Discovery {
  api_base_url: string;
  api_version: string;
  api_domain?: string;
  https_port?: number;
  https_available?: boolean;
  device_name?: string;
}

export interface FreeboxEntry {
  path: string;
  name: string;
  type: 'dir' | 'file';
  size: number;
  modification: number;
  hidden?: boolean;
}

export const toFreeboxPath = (value: string): string => Buffer.from(value, 'utf8').toString('base64');

export interface ShareLink {
  token: string;
  path: string;
  name: string;
  expire: number;
  fullurl: string;
}

interface OwnedDomain {
  id: string;
  type: string;
  owner: string;
  certs?: Record<string, { status: string; days_left?: number }>;
}

const APP = {
  app_id: config.freeboxAppId,
  app_name: 'AlexFlix',
  app_version: '1.0.0',
  device_name: os.hostname()
};

const tokenFile = (): string => path.join(config.dataDir, 'freebox-app.json');

export class FreeboxClient {
  private base = '';
  private session = '';
  private discovery: Discovery | null = null;
  private shareDomain: string | null = null;

  constructor(private readonly log: (message: string) => void = console.log) {}

  private reconnecting: Promise<void> | null = null;

  /** Rouvre la session (elle expire sur les longs traitements) ; un seul login à la fois. */
  private reconnect(): Promise<void> {
    this.reconnecting ??= (async () => {
      this.session = '';
      await this.open();
    })().finally(() => {
      this.reconnecting = null;
    });
    return this.reconnecting;
  }

  private async request<T>(method: string, endpoint: string, body?: unknown, retried = false): Promise<T> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (this.session) headers['x-fbx-app-auth'] = this.session;
    const response = await fetch(`${this.base}${endpoint}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20000)
    });
    const data = (await response.json().catch(() => ({ success: false, msg: `HTTP ${response.status}` }))) as FbxResponse<T>;
    if (!data.success && data.error_code === 'auth_required' && !retried && this.session && !endpoint.startsWith('/login')) {
      await this.reconnect();
      return this.request<T>(method, endpoint, body, true);
    }
    if (!data.success) {
      const error = new Error(`Freebox ${data.error_code ?? response.status} : ${data.msg ?? 'erreur inconnue'}`);
      Object.assign(error, { code: data.error_code });
      throw error;
    }
    return data.result as T;
  }

  private async discover(): Promise<void> {
    const response = await fetch(`${config.freeboxUrl}/api_version`, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`Freebox injoignable sur ${config.freeboxUrl} (HTTP ${response.status})`);
    this.discovery = (await response.json()) as Discovery;
    const major = Number.parseInt(this.discovery.api_version, 10);
    this.base = `${config.freeboxUrl}${this.discovery.api_base_url}v${major}`;
    this.log(`Freebox détectée (${this.discovery.device_name ?? 'Freebox'}, API v${major})`);
  }

  private async appToken(): Promise<string> {
    try {
      const saved = JSON.parse(await fs.readFile(tokenFile(), 'utf8')) as { app_token?: string };
      if (saved.app_token) return saved.app_token;
    } catch {
      this.log('Aucune autorisation Freebox enregistrée, demande en cours…');
    }
    const request = await this.request<{ app_token: string; track_id: number }>('POST', '/login/authorize/', APP);
    this.log('➡  Validez « AlexFlix » sur l’écran de la Freebox (flèche droite / bouton OK du Server).');
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      await sleep(2000);
      const state = await this.request<{ status: string }>('GET', `/login/authorize/${request.track_id}`);
      if (state.status === 'granted') {
        await fs.mkdir(config.dataDir, { recursive: true });
        await fs.writeFile(tokenFile(), JSON.stringify({ app_token: request.app_token, granted_at: new Date().toISOString() }, null, 2));
        this.log('Autorisation Freebox accordée et enregistrée.');
        return request.app_token;
      }
      if (state.status !== 'pending') throw new Error(`Autorisation Freebox refusée (${state.status}).`);
    }
    throw new Error('Autorisation Freebox expirée : relancez et validez sur la Freebox dans les 2 minutes.');
  }

  async open(): Promise<void> {
    await this.discover();
    const appToken = await this.appToken();
    const { challenge } = await this.request<{ challenge: string }>('GET', '/login/');
    const password = crypto.createHmac('sha1', appToken).update(challenge).digest('hex');
    try {
      const session = await this.request<{ session_token: string; permissions: Record<string, boolean> }>('POST', '/login/session/', {
        app_id: APP.app_id,
        password
      });
      this.session = session.session_token;
      if (!session.permissions.explorer) {
        throw new Error(
          'Permission manquante : Freebox OS → Paramètres → Gestion des accès → Applications → AlexFlix → cocher « Accès au gestionnaire de fichiers ».'
        );
      }
    } catch (error) {
      if ((error as { code?: string }).code === 'invalid_token') {
        await fs.rm(tokenFile(), { force: true });
        throw new Error('Autorisation Freebox révoquée : relancez la commande pour la redemander.');
      }
      throw error;
    }
  }

  async close(): Promise<void> {
    if (!this.session) return;
    await this.request('POST', '/login/logout/').catch(() => undefined);
    this.session = '';
  }

  async listDir(encodedPath: string): Promise<FreeboxEntry[]> {
    const result = await this.request<FreeboxEntry[] | { entries?: FreeboxEntry[] } | undefined>(
      'GET',
      `/fs/ls/${encodeURIComponent(encodedPath)}?removeHidden=1&countSubFolder=0`
    );
    const entries = Array.isArray(result) ? result : (result?.entries ?? []);
    return entries.filter((entry) => entry.name !== '.' && entry.name !== '..');
  }

  async listShareLinks(): Promise<ShareLink[]> {
    const result = await this.request<ShareLink[] | { entries?: ShareLink[] } | undefined>('GET', '/share_link/');
    return Array.isArray(result) ? result : (result?.entries ?? []);
  }

  createShareLink(fullPath: string, expire: number): Promise<ShareLink> {
    return this.request<ShareLink>('POST', '/share_link/', {
      path: toFreeboxPath(fullPath),
      expire,
      fullurl: ''
    });
  }

  async deleteShareLink(token: string): Promise<void> {
    await this.request('DELETE', `/share_link/${token}`);
  }

  /** Crée le dossier s'il n'existe pas (parent et nom en clair). */
  async ensureDir(parentPath: string, name: string): Promise<void> {
    const entries = await this.listDir(toFreeboxPath(parentPath));
    if (entries.some((entry) => entry.type === 'dir' && entry.name === name)) return;
    await this.request('POST', '/fs/mkdir/', { parent: toFreeboxPath(parentPath), dirname: name });
  }

  /**
   * Envoie un fichier local sur le disque de la Freebox (API WebSocket /ws/upload, l'upload HTTP historique est désactivé).
   * Chaque bloc binaire est acquitté par un message upload_data avant l'envoi du suivant.
   */
  async uploadFile(dirPath: string, fileName: string, localFile: string): Promise<void> {
    const { size } = await fs.stat(localFile);
    const ws = new WebSocket(`${this.base.replace(/^http/, 'ws')}/ws/upload`, { headers: { 'X-Fbx-App-Auth': this.session } });
    const queue: Array<(message: { action: string; success: boolean; msg?: string; error_code?: string }) => void> = [];
    ws.on('message', (raw) => queue.shift()?.(JSON.parse(raw.toString())));
    const reply = (): Promise<{ action: string; success: boolean; msg?: string; error_code?: string }> =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Freebox : pas de réponse à l’envoi')), 60000);
        queue.push((message) => {
          clearTimeout(timer);
          if (message.success) resolve(message);
          else reject(new Error(`Freebox upload ${message.error_code ?? ''} : ${message.msg ?? message.action}`));
        });
      });
    try {
      await new Promise<void>((resolve, reject) => {
        ws.once('open', () => resolve());
        ws.once('error', reject);
      });
      ws.send(JSON.stringify({ action: 'upload_start', request_id: 1, size, dirname: toFreeboxPath(dirPath), filename: fileName, force: 'overwrite' }));
      await reply();
      for await (const chunk of createReadStream(localFile, { highWaterMark: 1024 * 1024 })) {
        ws.send(chunk as Buffer);
        await reply();
      }
      ws.send(JSON.stringify({ action: 'upload_finalize', request_id: 1 }));
      await reply();
    } catch (error) {
      // Session expirée ou connexion muette : on se reconnecte, l'appelant réessaie.
      if (/auth_required|pas de réponse/i.test((error as Error).message)) await this.reconnect().catch(() => undefined);
      throw error;
    } finally {
      ws.close();
    }
  }

  /**
   * Domaine HTTPS au certificat reconnu par les navigateurs (Let's Encrypt, *.freeboxos.fr).
   * Le domaine automatique *.fbxos.fr est signé par la CA Freebox : refusé par les navigateurs,
   * et les liens http:// sont bloqués comme contenu mixte sur le site HTTPS.
   */
  async resolveShareDomain(): Promise<string | null> {
    if (config.freeboxDomain) return (this.shareDomain = config.freeboxDomain);
    const owned = await this.request<OwnedDomain[] | undefined>('GET', '/domain/owned/').catch(() => undefined);
    const issued = (owned ?? []).filter(
      (domain) => domain.type !== 'auto' && Object.values(domain.certs ?? {}).some((cert) => cert.status === 'issued')
    );
    this.shareDomain = issued[0]?.id ?? null;
    return this.shareDomain;
  }

  shareUrl(token: string, name: string): string | null {
    const port = this.discovery?.https_port;
    if (!this.shareDomain || !port) return null;
    return `https://${this.shareDomain}:${port}/share/${token}/${encodeURIComponent(name)}`;
  }

  publicUrl(link: ShareLink): string {
    const secure = this.shareUrl(link.token, link.name);
    if (secure) return secure;
    if (link.fullurl) return link.fullurl;
    const domain = this.discovery?.api_domain;
    const port = this.discovery?.https_port;
    if (!domain || !port) throw new Error('Accès distant HTTPS de Freebox OS désactivé : impossible de construire le lien public.');
    return `https://${domain}:${port}/share/${link.token}/${encodeURIComponent(link.name)}`;
  }
}
