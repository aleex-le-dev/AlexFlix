import { config, validateConfig } from './config.js';
import { Scanner } from './lib/scanner.js';
import { CatalogStore } from './lib/store.js';
import { tmdbEnabled } from './lib/tmdb.js';

const errors = validateConfig('scan');
if (errors.length > 0) {
  console.error(`[AlexFlix] Configuration invalide :\n - ${errors.join('\n - ')}`);
  process.exit(1);
}

const full = process.argv.includes('--full');
const store = new CatalogStore(config.dataDir);
await store.load();
const scanner = new Scanner(store);

console.log(`AlexFlix — scan ${full ? 'complet' : 'delta'} de ${config.mediaPath} (TMDB ${tmdbEnabled() ? 'actif' : 'désactivé'})`);

const timer = setInterval(() => {
  const status = scanner.getStatus();
  process.stdout.write(
    `\r[${status.phase}] fichiers : ${status.filesFound} · traités : ${status.processed}/${status.newFiles} · supprimés : ${status.removedFiles}   `
  );
}, 500);

scanner.start(full);
await scanner.wait();
clearInterval(timer);

const status = scanner.getStatus();
console.log(`\nTerminé (${status.phase}) : ${status.itemsTotal} titres, ${status.filesFound} fichiers.`);
if (status.errors.length > 0) {
  console.log(`${status.errors.length} avertissement(s) :`);
  for (const error of status.errors) console.log(` - ${error}`);
}
process.exit(status.phase === 'error' ? 1 : 0);
