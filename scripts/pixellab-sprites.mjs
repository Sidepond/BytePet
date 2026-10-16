import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { loadEnvFile } from 'node:process';
import { crc32, deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { drawCat } from '../desktop/cat.js';
import { drawSleeping } from '../desktop/sleeping.js';
import catalog from '../desktop/character-catalog.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const revision = process.argv[4] ?? '1';
if (!/^[1-9]\d?$/.test(revision)) throw new Error('Revision must be a number from 1 to 99.');
const directory = path.join(root, 'art/cheese-pixellab-v1', ...(revision === '1' ? [] : ['revisions', revision]));
const base = 'https://api.pixellab.ai/v2';
const prompts = {
  idle: 'Seamless quiet idle loop of this exact orange pixel cat sitting in place. Keep the same coarse 24x24 pixel art, flat colors, body size, camera and ground contact. Fixed paws and head position. Gentle one-pixel breathing in chest, one short slow blink and a tiny tail-tip movement. No walking, translation, hopping, rotation, camera motion, added details or particles. Return to the exact first pose at the end.',
  sleeping: 'The sleeping cat breathes: the orange BACK on the RIGHT HALF of the image inflates UPWARD by ONE PIXEL, holds, then gently deflates to the starting pose. Only the right-side back and ribs move. The head on the LEFT is completely motionless, as are the closed eyelids, ears, nose, paws and tail. Do not bend or move the ears. No head motion. No horizontal translation. No blinking, letters, symbols, particles or camera movement. Preserve the exact tiny pixel cat and flat colors. A subtle slow breathing loop, ending in the original pose.',
};

// Export the existing code artwork at its native resolution, without scaling
// or sampling a screenshot. The API receives the same logical pixel grid.
function referencePNG(action) {
  const pixels = Buffer.alloc(24 * 24 * 4);
  const ctx = {
    fillStyle: '#000000',
    clearRect(x, y, width, height) {
      for (let row = y; row < y + height; row++) for (let col = x; col < x + width; col++) pixels.fill(0, (row * 24 + col) * 4, (row * 24 + col) * 4 + 4);
    },
    fillRect(x, y, width, height) {
      if (revision !== '1' && action === 'sleeping' && this.fillStyle === '#6a99b4') return;
      const color = this.fillStyle.slice(1).match(/../g).map(hex => parseInt(hex, 16));
      if (color.length === 4 && color[3] !== 255) return; // No ground shadow in the generation reference.
      for (let row = y; row < y + height; row++) for (let col = x; col < x + width; col++) {
        if (row >= 0 && row < 24 && col >= 0 && col < 24) pixels.set([...color.slice(0, 3), 255], (row * 24 + col) * 4);
      }
    },
  };
  if (action === 'idle') drawCat(ctx, 0);
  else drawSleeping(ctx, 0, catalog[0]);
  function chunk(type, data) {
    const contents = Buffer.concat([Buffer.from(type), data]);
    const length = Buffer.alloc(4), checksum = Buffer.alloc(4);
    length.writeUInt32BE(data.length); checksum.writeUInt32BE(crc32(contents));
    return Buffer.concat([length, contents, checksum]);
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(24, 0); header.writeUInt32BE(24, 4); header[8] = 8; header[9] = 6;
  const scanlines = Buffer.alloc(24 * 97);
  for (let row = 0; row < 24; row++) pixels.copy(scanlines, row * 97 + 1, row * 96, (row + 1) * 96);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(scanlines)), chunk('IEND', Buffer.alloc(0))]);
}

async function prepare(action) {
  await mkdir(path.join(directory, 'source'), { recursive: true });
  const png = referencePNG(action);
  await writeFile(path.join(directory, 'source', `${action}-reference.png`), png);
  const image = { type: 'base64', base64: png.toString('base64'), format: 'png' };
  const request = { first_frame: image, last_frame: image, action: prompts[action], frame_count: 8,
    no_background: true, enhance_prompt: false, drift_threshold: 0, seed: 42 };
  await writeFile(path.join(directory, `${action}-request.json`), JSON.stringify(request, null, 2) + '\n');
  return request;
}

async function requestAPI(route, key, body) {
  const response = await fetch(base + route, { method: body ? 'POST' : 'GET', redirect: 'error',
    headers: { Authorization: `Bearer ${key}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(60000) });
  if (!response.ok) {
    // Don't log response bodies: auth tokens and uploaded artwork stay out of logs.
    const hint = { 401: 'API 키를 확인해 주세요.', 402: 'PixelLab 크레딧이 부족합니다.', 422: '요청 규격을 확인해 주세요.', 429: '동시 작업 제한입니다. 기존 작업을 먼저 확인해 주세요.' }[response.status] ?? 'PixelLab 요청에 실패했습니다.';
    throw new Error(`PixelLab HTTP ${response.status}: ${hint}`);
  }
  return response.json();
}

async function run() {
  const [command = 'prepare', action] = process.argv.slice(2);
  if (!['prepare', 'generate', 'poll'].includes(command) || (action && !Object.hasOwn(prompts, action))) throw new Error('Usage: node scripts/pixellab-sprites.mjs prepare | generate idle|sleeping [revision] | poll idle|sleeping [revision]');
  if (command === 'prepare') {
    for (const name of Object.keys(prompts)) {
      try {
        await readFile(path.join(directory, `${name}-job.json`));
        console.log(`${name}: 기존 작업의 입력과 기록을 유지합니다.`);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        await prepare(name);
      }
    }
    console.log(`준비 완료: ${directory} (API 요청 없음)`);
    return;
  }
  if (!action) throw new Error('idle 또는 sleeping을 지정해 주세요.');
  try { loadEnvFile(path.join(root, '.env.local')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const key = process.env.PIXELLAB_API_KEY?.trim();
  if (!key) throw new Error('.env.local에 PIXELLAB_API_KEY를 설정해 주세요.');
  const jobFile = path.join(directory, `${action}-job.json`);
  let job;
  if (command === 'generate') {
    try {
      await readFile(jobFile);
      throw new Error('기존 생성 작업이 있습니다. 중복 과금을 피하려면 poll 명령으로 결과를 가져오세요.');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const body = await prepare(action);
    // Never retry POST automatically: a timed-out request may already be billed.
    const created = await requestAPI('/animate-with-text-v3', key, body);
    if (typeof created.background_job_id !== 'string' || !created.background_job_id) throw new Error('응답에 작업 ID가 없습니다. 자동으로 재요청하지 않습니다.');
    job = { id: created.background_job_id, status: created.status, usage: created.usage ?? null, endpoint: '/animate-with-text-v3' };
    await writeFile(jobFile, JSON.stringify(job, null, 2) + '\n');
    console.log(`${action}: 작업 접수 완료`);
  } else job = JSON.parse(await readFile(jobFile, 'utf8'));
  const deadline = Date.now() + 15 * 60 * 1000;
  while (Date.now() < deadline) {
    const current = await requestAPI(`/background-jobs/${encodeURIComponent(job.id)}`, key);
    job.status = current.status;
    job.usage = current.usage ?? job.usage;
    await writeFile(jobFile, JSON.stringify(job, null, 2) + '\n');
    if (current.status === 'failed') throw new Error(`${action}: PixelLab 생성 실패. 작업 ID는 ${jobFile}에 저장했습니다.`);
    if (current.status === 'completed') {
      const images = current.last_response?.images;
      if (!Array.isArray(images) || images.length < 4) throw new Error('완료 응답에 애니메이션 프레임이 없습니다.');
      // Preserve the original API frames and usage for later review/repacking.
      await writeFile(path.join(directory, `${action}-response.json`), JSON.stringify(current, null, 2) + '\n');
      const frameDir = path.join(directory, 'source', action);
      await mkdir(frameDir, { recursive: true });
      for (const [index, image] of images.entries()) {
        if (typeof image?.base64 !== 'string') throw new Error('예상하지 못한 이미지 응답 형식입니다.');
        const png = Buffer.from(image.base64.replace(/^data:image\/png;base64,/, ''), 'base64');
        if (!png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('PNG가 아닌 프레임 응답입니다.');
        await writeFile(path.join(frameDir, `${String(index).padStart(2, '0')}.png`), png);
      }
      console.log(`${action}: ${images.length}개 프레임 저장 완료. 사용량: ${JSON.stringify(job.usage)}`);
      return;
    }
    console.log(`${action}: ${current.status}`);
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  throw new Error('대기 시간이 끝났습니다. 새로 생성하지 말고 poll 명령으로 이어서 확인하세요.');
}

run().catch(error => { console.error(error.message); process.exitCode = 1; });
