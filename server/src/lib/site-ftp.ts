import path from 'node:path';
import { Readable } from 'node:stream';
import { Client } from 'basic-ftp';
import { config } from '../config.js';

/** Envoie un petit fichier texte à la racine du site (ex. audio-status.json lu par la page Paramètres). */
export async function uploadSiteFile(name: string, content: string): Promise<void> {
  const client = new Client(30000);
  try {
    await client.access({
      host: config.ftpHost,
      port: config.ftpPort,
      user: config.ftpUser,
      password: config.ftpPassword,
      secure: config.ftpSecure === 'implicit' ? 'implicit' : config.ftpSecure !== 'false',
      secureOptions: { rejectUnauthorized: !config.ftpTlsInsecure }
    });
    const root = config.ftpRemoteDir.replace(/\\/g, '/').replace(/\/+$/, '') || '/';
    await client.uploadFrom(Readable.from([content]), path.posix.join(root, name));
  } finally {
    client.close();
  }
}
