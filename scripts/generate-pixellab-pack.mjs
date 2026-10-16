import { readFile, access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { profiles } from './pixellab-character-profiles.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const selected = process.argv.slice(2);
const characters = selected.length ? selected : Object.keys(profiles).filter(id => id !== 'marmalade');
if (characters.some(id => !Object.hasOwn(profiles, id))) throw new Error('Unknown character profile.');
const run = (script, args) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [path.join(root, 'scripts', script), ...args], { cwd: root, stdio: 'inherit' });
  child.on('error', reject);
  child.on('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`${script} ${args.join(' ')}: ${signal ?? code}`)));
});
async function ensureStage(character, stage) {
  const folder = path.join(root, 'art', `${character}-pixellab`);
  let job;
  try { job = JSON.parse(await readFile(path.join(folder, `${stage}-job.json`), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (job?.status === 'completed') {
    try { await access(path.join(folder, 'source', stage, stage === 'idle' || stage === 'sleeping' ? '08.png' : '00.png')); return; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const command = !job ? 'generate' : job.status === 'rejected' && job.httpStatus === 429 ? 'retry-rejected' : 'poll';
  console.log(`PACK ${character}: ${stage} (${command})`);
  // Sequential jobs respect the account's concurrency limit. Ambiguous POSTs
  // and HTTP errors never trigger an automatic paid retry.
  await run('pixellab-new-character.mjs', [command, stage, character]);
}
const failed = [];
for (const character of characters) {
  try {
    await ensureStage(character, 'design');
    await run('build-marmalade-preview.mjs', ['prepare-design', character]);
    await ensureStage(character, 'sleep-pose-wide');
    await run('build-marmalade-preview.mjs', ['prepare', character]);
    await ensureStage(character, 'idle');
    await ensureStage(character, 'sleeping');
    await run('build-marmalade-preview.mjs', ['build', character]);
    console.log(`PACK ${character}: complete`);
  } catch (error) {
    failed.push(character); console.error(`PACK ${character}: stopped — ${error.message}`);
  }
}
if (failed.length) { console.error(`Incomplete characters: ${failed.join(', ')}`); process.exitCode = 1; }
else console.log('All requested character packs completed.');
