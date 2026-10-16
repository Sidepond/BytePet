import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'build/tauri-web');
await rm(output, { recursive: true, force: true }); await mkdir(output, { recursive: true });
for (const name of await readdir(path.join(root, 'desktop'))) {
  if (!/\.(js|css|html)$/.test(name)) continue;
  let text = await readFile(path.join(root, 'desktop', name), 'utf8');
  if (name.endsWith('.html')) {
    text = text.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '');
    text = text.replace('<head>', '<head>\n  <script src="./tauri-bridge.js"></script>');
  }
  if (name === 'panel.css') text += await readFile(path.join(root, 'tauri/context-menu.css'), 'utf8');
  await writeFile(path.join(output, name), text);
}
await cp(path.join(root, 'desktop/assets'), path.join(output, 'assets'), { recursive: true });
await cp(path.join(root, 'tauri/bridge.js'), path.join(output, 'tauri-bridge.js'));
console.log('Prepared shared UI for Tauri (runtime-only files).');
