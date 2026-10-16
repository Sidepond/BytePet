import { readFile, access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { profiles } from './pixellab-character-profiles.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const characters = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(profiles);
if (characters.some(id => !Object.hasOwn(profiles, id))) throw new Error('Unknown character profile.');
const run = (script, args) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [path.join(root, 'scripts', script), ...args], { cwd: root, stdio: 'inherit' });
  child.on('error', reject);
  child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${script}: exit ${code}`)));
});
for (const character of characters) {
  const folder = path.join(root, 'art', `${character}-pixellab`);
  let complete = false;
  try { await access(path.join(folder, 'source/eating/08.png')); complete = true; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!complete) {
    let job;
    try { job = JSON.parse(await readFile(path.join(folder, 'eating-job.json'), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const command = !job ? 'generate' : job.status === 'rejected' && job.httpStatus === 429 ? 'retry-rejected' : 'poll';
    // One paid job at a time. Existing or ambiguous submissions are only polled.
    await run('pixellab-new-character.mjs', [command, 'eating', character]);
  }
  await run('build-marmalade-preview.mjs', ['build', character]);
  console.log(`EATING ${character}: complete`);
}
