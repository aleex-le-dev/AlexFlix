import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'basic-ftp';
import { config, PROJECT_ROOT, validateConfig } from './config.js';
import { FreeboxClient } from './lib/freebox.js';
import { imagesDir } from './lib/images.js';
import { buildWebImages, fetchHdBackdrops, webImagesDir } from './lib/webp.js';
import { loadAges } from './lib/ages.js';
import { idleStatus, Scanner } from './lib/scanner.js';
import { ensurePeople } from './lib/people.js';
import { CatalogStore } from './lib/store.js';
import { errorMessage } from './lib/utils.js';
import { configPhp, gatePhp, htaccess, resolveHomeIps, vitrineSecrets } from './lib/vitrine.js';
import type { ItemDTO } from './types.js';

interface LinkRecord {
  token: string;
  url: string;
  expire: number;
  relPath: string;
}

const args = new Set(process.argv.slice(2));
const withScan = args.has('--scan');
const skipLinks = args.has('--no-links');
const distDir = path.join(PROJECT_ROOT, 'client', 'dist-vitrine');
const linksFile = path.join(config.dataDir, 'share-links.json');
const stageDir = path.join(config.dataDir, 'publish');
const log = (message: string): void => console.log(`[deploy] ${message}`);

const errors = validateConfig(withScan ? 'deploy-scan' : 'deploy');
if (!existsSync(path.join(distDir, 'index.html'))) {
  errors.push('client/dist-vitrine absent : lancez « npm run deploy » depuis la racine (il compile la vitrine).');
}
if (errors.length > 0) {
  console.error(`[AlexFlix] Configuration invalide :\n - ${errors.join('\n - ')}`);
  process.exit(1);
}

const store = new CatalogStore(config.dataDir);
await store.load();

if (withScan) {
  const scanner = new Scanner(store);
  log('Scan de la bibliothèque…');
  scanner.start();
  await scanner.wait();
  const status = scanner.getStatus();
  if (status.phase === 'error') {
    console.warn(`[deploy] Scan impossible (${status.lastError}) → publication du catalogue déjà connu, sans modification.`);
  } else {
    log(`Scan terminé : ${status.itemsTotal} titres (${status.newFiles} nouveaux fichiers).`);
  }
}

const files = Object.values(store.data.files);
if (files.length === 0) {
  if (!skipLinks) {
    console.error('[deploy] Catalogue vide : lancez d’abord « npm run scan » (ou deploy.ps1 -SiteSeul pour publier l’interface seule).');
    process.exit(1);
  }
  log('Catalogue vide : publication de l’interface seule.');
}

let links: Record<string, LinkRecord> = {};
try {
  links = JSON.parse(await fs.readFile(linksFile, 'utf8')) as Record<string, LinkRecord>;
} catch {
  links = {};
}

if (!skipLinks) {
  const freebox = new FreeboxClient(log);
  await freebox.open();
  try {
    const domain = await freebox.resolveShareDomain();
    if (domain) {
      log(`Liens HTTPS servis par ${domain}.`);
    } else {
      console.warn(
        '\n[deploy] ⚠ Aucun domaine Freebox avec certificat valide : les vidéos ne pourront pas être lues dans le navigateur (lien http bloqué sur un site https).\n' +
          '          Freebox OS → Paramètres de la Freebox → Nom de domaine → Ajouter (ex : alexflix.freeboxos.fr), attendre le certificat, puis relancer le deploy.\n'
      );
    }
    const remote = new Set((await freebox.listShareLinks()).map((link) => link.token));
    const now = Math.floor(Date.now() / 1000);
    const expire = config.freeboxLinkDays > 0 ? now + config.freeboxLinkDays * 86400 : 0;
    const renewMargin = Math.max(1, Math.min(30, Math.floor(config.freeboxLinkDays / 4))) * 86400;
    let created = 0;
    let kept = 0;
    let failed = 0;
    let removed = 0;

    for (const [index, file] of files.entries()) {
      const previous = links[file.id];
      const stillValid =
        previous !== undefined &&
        previous.relPath === file.relPath &&
        remote.has(previous.token) &&
        (previous.expire === 0 || previous.expire - now > renewMargin);
      if (stillValid) {
        previous.url = freebox.shareUrl(previous.token, path.posix.basename(previous.relPath)) ?? previous.url;
        kept++;
      } else {
        try {
          const link = await freebox.createShareLink(`${config.freeboxMediaRoot}/${file.relPath}`, expire);
          if (previous && remote.has(previous.token) && previous.token !== link.token) {
            await freebox.deleteShareLink(previous.token).catch(() => undefined);
          }
          links[file.id] = { token: link.token, url: freebox.publicUrl(link), expire: link.expire ?? expire, relPath: file.relPath };
          created++;
        } catch (error) {
          failed++;
          if (previous) kept++;
          console.warn(
            `\n[deploy] Lien impossible pour « ${file.relPath} » : ${errorMessage(error)}${previous ? ' → ancien lien conservé (disque déconnecté ?)' : ''}`
          );
        }
      }
      process.stdout.write(`\r[deploy] Liens Freebox : ${index + 1}/${files.length}`);
    }

    for (const id of Object.keys(links)) {
      if (store.data.files[id]) continue;
      if (remote.has(links[id].token)) await freebox.deleteShareLink(links[id].token).catch(() => undefined);
      delete links[id];
      removed++;
    }
    process.stdout.write('\n');
    log(`Liens : ${created} créés, ${kept} conservés, ${removed} supprimés, ${failed} échec(s).`);
  } finally {
    await freebox.close();
  }
  await fs.mkdir(config.dataDir, { recursive: true });
  await fs.writeFile(linksFile, JSON.stringify(links, null, 2));
}

if (!store.data.baselineAt && store.baselineAt()) await store.save();

const { genres, keywords } = store.facets();
// Pistes son AAC séparées (npm run audio) pour les vidéos en Dolby, illisible par les navigateurs.
const audioTracks = JSON.parse(await fs.readFile(path.join(config.dataDir, 'audio-tracks.json'), 'utf8').catch(() => '{}')) as Record<
  string,
  { status: string; relPath: string; url?: string }
>;
const audioUrlOf = (fileId: string): string | null => {
  const track = audioTracks[fileId];
  return track?.status === 'done' && track.url && track.relPath === store.data.files[fileId]?.relPath ? track.url : null;
};
type PublishedFile = ItemDTO['files'][number] & { downloadUrl: string | null; audioUrl: string | null };
// Âge conseillé (profil Enfants), classification TMDB mise en cache.
const ages = await loadAges(Object.values(store.data.items).filter((item) => item.fileIds.length > 0), log);
const items: Array<Omit<ItemDTO, 'files'> & { files: PublishedFile[]; age: number | null; ageUs: number | null }> = store
  .list()
  .map((item) => ({
    ...item,
    age: ages[item.id]?.fr ?? ages[item.id]?.us ?? null,
    ageUs: ages[item.id]?.us ?? null,
    files: item.files.map((file) => ({ ...file, downloadUrl: links[file.id]?.url ?? null, audioUrl: audioUrlOf(file.id) }))
  }));
log(`Pistes son AAC : ${items.reduce((count, item) => count + item.files.filter((file) => file.audioUrl).length, 0)} vidéo(s).`);

const imageNames = new Set<string>();
for (const item of items) {
  if (item.poster) imageNames.add(item.poster);
  if (item.backdrop) imageNames.add(item.backdrop);
  for (const season of Object.values(item.seasons)) {
    if (season.poster) imageNames.add(season.poster);
    for (const episode of Object.values(season.episodes)) if (episode.still) imageNames.add(episode.still);
  }
}

// Visages par saga : la liste publiée porte les sagas (collections = sous-dossiers du disque).
const people = await ensurePeople(items, log);
for (const person of people) imageNames.add(person.image);

// Images WebP (rangées, fiche, bannière HD) publiées dans /img/ ; les JPEG restent dans /images/.
await fetchHdBackdrops(Object.values(store.data.items).filter((item) => item.fileIds.length > 0), log);
const webImageNames = await buildWebImages(imageNames, log);

const catalog = {
  updatedAt: new Date().toISOString(),
  baselineAt: store.baselineAt(),
  people,
  items,
  genres,
  keywords,
  scan: idleStatus(),
  tmdbEnabled: false,
  transcodeAvailable: false
};

await fs.rm(stageDir, { recursive: true, force: true });
await fs.mkdir(stageDir, { recursive: true });
await fs.writeFile(path.join(stageDir, 'catalog.json'), JSON.stringify(catalog));
const homeIps = await resolveHomeIps();
log(`Accès sans code depuis la maison : ${homeIps.join(', ') || '(aucune IP détectée)'}`);
await fs.writeFile(path.join(stageDir, 'ap-config.php'), configPhp(vitrineSecrets(), homeIps));
await fs.writeFile(path.join(stageDir, 'gate.php'), gatePhp);
await fs.writeFile(path.join(stageDir, '.htaccess'), htaccess);

const remoteRoot = config.ftpRemoteDir.replace(/\\/g, '/').replace(/\/+$/, '') || '/';
const remotePath = (name = ''): string => path.posix.join(remoteRoot, name);

const client = new Client(60000);

async function connect(): Promise<void> {
  client.close();
  await client.access({
    host: config.ftpHost,
    port: config.ftpPort,
    user: config.ftpUser,
    password: config.ftpPassword,
    secure: config.ftpSecure === 'implicit' ? 'implicit' : config.ftpSecure !== 'false',
    secureOptions: { rejectUnauthorized: !config.ftpTlsInsecure }
  });
}

async function withRetry<T>(label: string, task: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      if (client.closed) await connect();
      return await task();
    } catch (error) {
      if (attempt >= 5) throw error;
      console.warn(`\n[deploy] ${label} : ${errorMessage(error)} → reconnexion (${attempt}/4)`);
      await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
      await connect().catch(() => undefined);
    }
  }
}

const upload = (local: string, remote: string): Promise<unknown> => withRetry(path.posix.basename(remote), () => client.uploadFrom(local, remote));

async function syncDir(localDir: string, remoteDir: string, names: string[] | null, label: string): Promise<void> {
  await withRetry(label, () => client.ensureDir(remoteDir));
  const listing = await withRetry(label, () => client.list(remoteDir));
  const remoteFiles = new Map(listing.filter((entry) => entry.isFile).map((entry) => [entry.name, entry.size]));
  const localNames =
    names ?? (await fs.readdir(localDir, { withFileTypes: true }).catch(() => [])).filter((entry) => entry.isFile()).map((entry) => entry.name);
  const wanted = new Set(localNames);
  let uploaded = 0;
  let index = 0;
  for (const name of localNames) {
    index++;
    const local = path.join(localDir, name);
    const stat = await fs.stat(local).catch(() => null);
    if (!stat?.isFile()) continue;
    if (remoteFiles.get(name) === stat.size) continue;
    await upload(local, path.posix.join(remoteDir, name));
    uploaded++;
    process.stdout.write(`\r[deploy] ${label} : ${index}/${localNames.length}`);
  }
  let deleted = 0;
  for (const name of remoteFiles.keys()) {
    if (wanted.has(name)) continue;
    await withRetry(name, () => client.remove(path.posix.join(remoteDir, name))).catch(() => undefined);
    deleted++;
  }
  if (uploaded > 0) process.stdout.write('\n');
  log(`${label} : ${uploaded} envoyé(s), ${deleted} supprimé(s), ${localNames.length - uploaded} déjà à jour.`);
}

try {
  log(`Connexion FTP ${config.ftpUser}@${config.ftpHost}:${config.ftpPort} → ${remoteRoot}`);
  await connect();
  await withRetry('racine', () => client.ensureDir(remoteRoot));

  for (const name of ['ap-config.php', 'gate.php', '.htaccess']) await upload(path.join(stageDir, name), remotePath(name));
  log('Passerelle d’accès privée en place.');

  await syncDir(path.join(distDir, 'assets'), remotePath('assets'), null, 'Interface');
  await syncDir(imagesDir, remotePath('images'), [...imageNames], 'Pochettes');
  await syncDir(webImagesDir, remotePath('img'), webImageNames, 'Images WebP');

  const rootFiles = (await fs.readdir(distDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name !== 'index.html')
    .map((entry) => entry.name);
  for (const name of rootFiles) await upload(path.join(distDir, name), remotePath(name));
  await upload(path.join(stageDir, 'catalog.json'), remotePath('catalog.json'));
  await upload(path.join(distDir, 'index.html'), remotePath('index.html'));

  log(`Publication terminée : ${items.length} titres, ${Object.keys(links).length} liens de téléchargement.`);
  const siteUrl = config.siteUrl.replace(/\/+$/, '');
  console.log(`\n[deploy] Site : ${siteUrl} — sans code depuis la maison, code PIN (${config.vitrinePin.length} chiffres) à distance.\n`);
} catch (error) {
  console.error(`[deploy] Échec FTP : ${errorMessage(error)}`);
  process.exitCode = 1;
} finally {
  client.close();
}
