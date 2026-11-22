import { config } from './config.js';
import { FreeboxClient, toFreeboxPath } from './lib/freebox.js';
import { errorMessage } from './lib/utils.js';

const freebox = new FreeboxClient((message) => console.log(`[freebox] ${message}`));

try {
  await freebox.open();
  console.log('[freebox] Session ouverte, permission « gestionnaire de fichiers » OK.');

  const disks = await freebox.listDir(toFreeboxPath('/'));
  console.log(`\nDisques visibles : ${disks.map((entry) => `/${entry.name}`).join(' · ') || '(aucun)'}`);

  try {
    const entries = await freebox.listDir(toFreeboxPath(config.freeboxMediaRoot));
    console.log(`\nContenu de FREEBOX_MEDIA_ROOT (${config.freeboxMediaRoot}) :`);
    for (const entry of entries) console.log(`  ${entry.type === 'dir' ? '[dossier]' : '         '} ${entry.name}`);
    console.log('\nOK : le scan sans montage fonctionnera.');
  } catch (error) {
    console.log(`\nFREEBOX_MEDIA_ROOT introuvable (${config.freeboxMediaRoot}) : ${errorMessage(error)}`);
    for (const disk of disks) {
      const children = await freebox.listDir(disk.path || toFreeboxPath(`/${disk.name}`)).catch(() => []);
      console.log(`  /${disk.name} → ${children.map((entry) => entry.name).join(', ') || '(vide)'}`);
    }
    console.log('\nCorrigez FREEBOX_MEDIA_ROOT dans .env avec le bon chemin (ex : /Disque dur/Vidéos).');
    process.exitCode = 1;
  }
} catch (error) {
  console.error(`[freebox] ${errorMessage(error)}`);
  process.exitCode = 1;
} finally {
  await freebox.close();
}
