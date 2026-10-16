// Render documentation images from the real UI and bundled sprite renderer.
// Uses a disposable profile and demo ports; never reads the user's AI accounts.
// Requires macOS, npm ci, and ffmpeg on PATH.
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { _electron as electron } from 'playwright';
import manifest from '../desktop/sprite-manifest.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'docs/images');
const scratch = await mkdtemp(path.join(tmpdir(), 'bytepet-readme-'));
const profile = path.join(scratch, 'profile');
await mkdir(profile); await mkdir(output, { recursive: true });
await writeFile(path.join(profile, 'ai-usage.json'), JSON.stringify({ version: 1, preferences: {
  codex: false, claude: false, badgeMode: 'hidden', badgePosition: 'top', badgeWindow: 'primary',
} }));
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
let app;
const dataURL = async file => `data:image/png;base64,${(await readFile(file)).toString('base64')}`;
async function savePNG(name, data) {
  await writeFile(path.join(output, name), Buffer.from(data.split(',')[1], 'base64'));
}
try {
  execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  app = await electron.launch({ args: [root, `--user-data-dir=${profile}`], cwd: root, env });
  const errors = []; app.on('window', page => page.on('pageerror', error => errors.push(error.message)));
  const pet = await app.firstWindow();
  await pet.waitForFunction(() => document.querySelector('#pet')?.dataset.character);
  await pet.emulateMedia({ reducedMotion: 'reduce' });
  const opened = app.waitForEvent('window');
  await pet.evaluate(() => window.petPanel.toggle());
  const panel = await opened;
  await panel.waitForFunction(() => document.activeElement?.matches('#food-composer > summary'));
  await panel.emulateMedia({ reducedMotion: 'reduce' });
  const capture = async name => {
    await panel.evaluate(() => document.activeElement?.blur());
    await panel.screenshot({ path: path.join(output, name), omitBackground: true });
  };
  // Export the same frames and timing used by the app, without resampling art.
  const jobs = Object.keys(manifest).map(id => ({ id, action: 'idle', name: id }));
  for (const action of ['sleeping', 'eating', 'dragging']) jobs.push({ id: 'cat-cheese', action, name: `motion-${action}` });
  for (const { id, action, name } of jobs) {
    const frames = await pet.evaluate(async ({ id, action, durations }) => {
      const { charactersReady, drawCharacter } = await import('./characters.js');
      await charactersReady;
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 192;
      let elapsed = 0;
      return durations.map(duration => {
        drawCharacter(canvas.getContext('2d'), id, action, elapsed);
        elapsed += duration;
        return canvas.toDataURL();
      });
    }, { id, action, durations: manifest[id].actions[action].durationMs });
    const folder = path.join(scratch, name); await mkdir(folder);
    for (const [i, frame] of frames.entries()) await writeFile(path.join(folder, `${i}.png`), Buffer.from(frame.split(',')[1], 'base64'));
    await writeFile(path.join(folder, 'frames.txt'), frames.map((_, i) => `file '${i}.png'\noption framerate 100\nduration ${manifest[id].actions[action].durationMs[i] / 1000}`).join('\n') + "\nfile '7.png'\n");
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', path.join(folder, 'frames.txt'), '-filter_complex', '[0:v]split[a][b];[a]palettegen=reserve_transparent=1[p];[b][p]paletteuse=dither=none', '-fps_mode', 'vfr', '-frames:v', '8', '-final_delay', String(manifest[id].actions[action].durationMs[7] / 10), '-loop', '0', path.join(output, `${name}.gif`)]);
    if (id === 'cat-cheese' && action === 'idle') await savePNG('marmalade.png', frames[0]);
  }
  await panel.locator('#food-composer > summary').click();
  await panel.locator('#draft').fill('오늘의 아이디어: 작업 공간에 작은 친구 한 마리.');
  await panel.locator('#feed-text').click();
  await panel.locator('#food-list li').first().waitFor();
  await panel.locator('#files').setInputFiles([
    { name: '작업 노트.md', mimeType: 'text/markdown', buffer: Buffer.from('# 오늘의 작업\n메뉴 UI 다듬기') },
    { name: '아이디어.txt', mimeType: 'text/plain', buffer: Buffer.from('작업 공간에 작은 친구 한 마리.') },
    { name: 'settings.json', mimeType: 'application/json', buffer: Buffer.from('{"pet":"marmalade"}') },
    { name: '마멀레이드.png', mimeType: 'image/png', buffer: await readFile(path.join(output, 'marmalade.png')) },
  ]);
  await panel.waitForFunction(() => document.querySelectorAll('#food-list li').length === 5);
  await panel.locator('.file-thumbnail').waitFor();
  await panel.waitForFunction(() => document.querySelector('#feed-status').textContent === '');
  await capture('food-shelf.png');
  await panel.locator('.file-tile[data-kind=image]').click();
  await panel.locator('#shelf-preview').click();
  await panel.locator('#preview-content img').waitFor();
  await panel.locator('#preview-content img').evaluate(image => image.decode());
  await capture('food-preview.png');
  await panel.locator('#close-food-preview').click();

  await panel.locator('#show-convert').click();
  await panel.locator('#convert-draft').fill('{"name":"BytePet","friends":6,"ready":true}');
  await panel.locator('#input-format').selectOption('json');
  await panel.locator('#run-tool').click();
  await panel.locator('#json-output').waitFor();
  await panel.locator('#json-result').scrollIntoViewIfNeeded();
  await capture('json-tool.png');

  // All rows are fixtures, so documentation cannot expose local processes.
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('ports:list');
    ipcMain.handle('ports:list', () => ({ ok: true, value: { checkedAt: Date.now(), warning: null, items:
      [3000, 5173, 8080].map((port, i) => ({ port, pid: 12001 + i, name: i === 2 ? 'python' : 'node', protocol: 'TCP',
        addresses: [{ family: 'IPv4', address: '127.0.0.1' }], url: `http://127.0.0.1:${port}`, terminationBlocked: null })) } }));
  });
  await panel.locator('#show-ports').click();
  await panel.waitForFunction(() => document.querySelectorAll('#port-list li').length === 3);
  await capture('dev-ports.png');
  await panel.locator('#show-settings').click();
  await panel.locator('#character-picker').waitFor();
  await capture('settings.png');
  await pet.waitForFunction(() => document.querySelector('#pet').dataset.state === 'idle' && document.querySelector('#pet-message').hidden);
  await pet.screenshot({ path: path.join(output, 'yard.png'), omitBackground: true });

  // A clearly labeled presentation layout, using the captured app windows.
  const presentation = path.join(scratch, 'hero.html');
  await writeFile(presentation, `<!doctype html><meta charset="utf-8"><style>
    *{box-sizing:border-box}body{margin:0;width:1200px;height:650px;overflow:hidden;background:#f2f0e8;color:#2d4036;font-family:-apple-system,BlinkMacSystemFont,sans-serif}
    .copy{position:absolute;left:64px;top:85px;width:510px}.eyebrow{font-size:15px;letter-spacing:3px;color:#678474;font-weight:650}h1{font-size:88px;letter-spacing:-5px;margin:19px 0 24px}h2{font-size:31px;line-height:1.5;letter-spacing:-1px;margin:0;font-weight:650}.desc{font-size:18px;line-height:1.85;color:#718076;margin-top:22px}.tag{display:inline-block;border:1px solid #c7d2c6;border-radius:20px;padding:9px 15px;margin:17px 8px 0 0;font-size:13px}.stage{position:absolute;left:610px;top:38px;width:540px;height:568px}.house{position:absolute;left:9px;bottom:24px;width:340px}.yard{position:absolute;left:0;bottom:0;width:540px}.gauge{position:absolute;right:9px;bottom:0;width:131px}.caption{position:absolute;bottom:20px;left:65px;font-size:12px;color:#8a9489}
    </style><div class="copy"><div class="eyebrow">YOUR LITTLE DESKTOP COMPANION</div><h1>BytePet</h1><h2>작업하는 동안 곁을 지키는,<br>작은 픽셀 친구.</h2><p class="desc">메모와 사진은 먹이로 보관하고,<br>자주 쓰는 도구와 AI 사용량은 가까이에.</p><span class="tag">macOS</span><span class="tag">DMG로 간편 설치</span><span class="tag">고양이 3 · 강아지 3</span></div>
    <div class="stage"><img class="yard" src="${await dataURL(path.join(output, 'yard.png'))}"><img class="house" src="${await dataURL(path.join(output, 'ai-usage-panel.png'))}"><img class="gauge" src="${await dataURL(path.join(output, 'ai-usage-gauge.png'))}"></div><div class="caption">실제 앱 화면을 배치한 소개 이미지 · 사용량은 예시 데이터</div>`);
  const previewOpened = app.waitForEvent('window');
  await app.evaluate(({ BrowserWindow }, url) => {
    const win = new BrowserWindow({ width: 1200, height: 650, useContentSize: true, show: false, webPreferences: { contextIsolation: true, sandbox: true } });
    void win.loadURL(url);
  }, pathToFileURL(presentation).href);
  const preview = await previewOpened;
  await preview.waitForLoadState('load');
  await preview.evaluate(() => Promise.all([...document.images].map(img => img.decode())));
  await preview.screenshot({ path: path.join(output, 'hero.png') });
  if (errors.length) throw new Error(errors.join('\n'));
  console.log('README assets rendered from isolated demo profile.');
} finally {
  if (app) await app.close();
  await rm(scratch, { recursive: true, force: true });
}
