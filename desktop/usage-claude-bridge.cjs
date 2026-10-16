// Installed by BytePet's explicit Connect action. Receives Claude's statusLine
// JSON, persists only rate-limit numbers, then preserves the prior status line.
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const { atomicWrite, readJson, normalizeClaude } = require('./usage-data.cjs');
function run(configFile, input) {
  const config = readJson(configFile, 1024 * 1024);
  let windows = [];
  try {
    windows = normalizeClaude(JSON.parse(input));
    atomicWrite(config.snapshotPath, { version: 1, updatedAt: Date.now(), windows });
  } catch { /* A broken snapshot must not break the user's status line. */ }
  const previous = config.previousStatusLine;
  if (previous?.type === 'command' && typeof previous.command === 'string') {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const result = spawnSync('/bin/sh', ['-c', previous.command], {
      input, encoding: 'utf8', timeout: 2000, maxBuffer: 1024 * 1024, env,
    });
    if (result.stdout) process.stdout.write(result.stdout);
  } else {
    process.stdout.write(windows.length ? windows.map(w => `${w.id === 'primary' ? '5h' : '7d'} ${Math.round(w.usedPercent)}%`).join(' · ') : 'Claude');
  }
}
if (require.main === module) {
  let input = '', size = 0;
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    size += Buffer.byteLength(chunk);
    if (size > 1024 * 1024) process.exit(0);
    input += chunk;
  });
  process.stdin.on('end', () => { try { run(process.argv[2], input); } catch {} });
}
module.exports = { run };
