import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { profiles, sharedStyle } from './pixellab-character-profiles.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const [command, stage, character = 'marmalade'] = process.argv.slice(2);
if (!Object.hasOwn(profiles, character)) throw new Error('Unknown character profile.');
const profile = profiles[character];
const directory = path.join(root, 'art', `${character}-pixellab`);
const stages = ['design', 'sleep-pose', 'sleep-pose-wide', 'idle', 'sleeping'];
const image = async name => ({ type: 'base64', format: 'png', base64: (await readFile(path.join(directory, 'source', name, '00.png'))).toString('base64') });

async function requestFor(stage) {
  if (character !== 'marmalade') {
    if (stage === 'design') return { endpoint: '/create-image-pixen', body: {
      description: `${profile.description} ${sharedStyle}`, image_size: { width: 32, height: 32 },
      outline: 'single color outline', detail: 'low detail', view: 'side', direction: 'south-east',
      no_background: true, enhance_prompt: false, seed: profile.seed,
    } };
    if (stage === 'sleep-pose-wide') return { endpoint: '/edit-image-pixen', body: {
      image: { type: 'base64', format: 'png', base64: (await readFile(path.join(directory, 'references/idle.png'))).toString('base64') },
      width: 48, height: 48, seed: profile.seed + 1, no_background: true,
      description: `Put this ${profile.species} asleep on its belly, head resting low on tucked paws, eyes closed, tail resting beside its rump. Keep SAME head size and body scale, ${profile.identity}. Use extra horizontal space, up to 40 pixels wide. Floor y=44. Same pixel style and view. Transparent background. No Z letters or shadow.`,
    } };
    if (stage === 'sleep-pose') throw new Error('Use sleep-pose-wide for this profile.');
    const first = { type: 'base64', format: 'png', base64: (await readFile(path.join(directory, 'references', `${stage}.png`))).toString('base64') };
    return { endpoint: '/animate-with-text-v3', body: {
      first_frame: first, last_frame: first, frame_count: 8, seed: profile.seed + (stage === 'idle' ? 2 : 3),
      no_background: true, enhance_prompt: false, drift_threshold: 0,
      action: stage === 'idle'
        ? `A charming relaxed idle loop of this ${profile.species} ${character === 'corgi' ? 'resting in its starting pose' : 'sitting in place'}. Soft natural breathing through chest and shoulders, a slow friendly blink, a small ear twitch and a gentle ${character === 'corgi' ? 'bobtail wiggle' : 'tail-tip wag'}. Organic overlapping motion. Keep the same design, pixel style, camera, body scale and paw contact with ground. No walking, turning or sliding. Settle seamlessly back to the starting pose.`
        : `This ${profile.species} sleeps peacefully in place. Slow natural breathing gently lifts and relaxes the back, shoulders and head together, with a tiny ear twitch. Eyes stay closed, paws and tail rest on the ground. Keep the same design, pixel style, body scale and camera. No sideways rocking, sliding, letters or new objects. Calm seamless loop returning to the starting pose.`,
    } };
  }
  if (stage === 'design') return { endpoint: '/create-image-pixen', body: {
    description: 'One original adorable orange tabby kitten desktop pet sprite. Plump pear-shaped body, oversized ROUND head, tiny rounded triangular ears, soft cream crescent muzzle and cream belly, dark curious bead eyes, three short cinnamon forehead stripes, small teal triangular bandana, thick curved tail wrapping beside the body. Sitting comfortably with small paws together, front three-quarter view. Charming expressive silhouette with rounded cheeks, not a rectangular robot. Chunky readable retro game pixel art, warm limited palette, flat two-tone shading, clean single-pixel warm dark-brown outline, no dithering, no gradients, no text, no props, no ground shadow. Full body centered with 3 pixels of transparent breathing room all around.',
    image_size: { width: 32, height: 32 }, outline: 'single color outline', detail: 'low detail',
    view: 'side', direction: 'south-east', no_background: true, enhance_prompt: false, seed: 117,
  } };
  if (stage === 'sleep-pose') return { endpoint: '/edit-image-pixen', body: {
    image: await image('design'), width: 32, height: 32, seed: 118, no_background: true,
    description: 'Change the pose: this same orange kitten is now curled up asleep on its belly, head resting low on its tucked front paws, eyes gently closed, curved tail hugging its side. Keep its round face, cream muzzle, tabby markings and teal bandana. Keep the same pixel size and body proportions, not enlarged to fill the canvas. Full body, same side view, transparent background, no letters or sleep symbols, no ground shadow. A low, relaxed sleeping silhouette with space above.',
  } };
  if (stage === 'sleep-pose-wide') return { endpoint: '/edit-image-pixen', body: {
    image: { type: 'base64', format: 'png', base64: (await readFile(path.join(directory, 'references/idle.png'))).toString('base64') },
    width: 48, height: 48, seed: 121, no_background: true,
    description: 'Put this kitten in a sleeping pose, lying on its belly with its large round head resting on tucked paws and its tail curled beside its rump. Close the eyes. Keep the SAME head size (about 20 pixels wide), same body scale, cream muzzle, orange stripes and teal bandana. Do not make a miniature cat. Use the extra horizontal space: the lying cat may be 40 pixels wide. Keep the floor at y=44, transparent space above, same side view and pixel style. No Z letters or ground shadow.',
  } };
  const first = { type: 'base64', format: 'png', base64: (await readFile(path.join(directory, 'references', `${stage}.png`))).toString('base64') };
  return { endpoint: '/animate-with-text-v3', body: {
    first_frame: first, last_frame: first, frame_count: 8, seed: stage === 'idle' ? 119 : 120,
    no_background: true, enhance_prompt: false, drift_threshold: 0,
    action: stage === 'idle'
      ? 'A charming relaxed idle animation of this kitten sitting in place: soft natural breathing through the chest and shoulders, a slow friendly blink, a small ear twitch and an easy swish of the curled tail tip. Gentle overlapping organic motion. Preserve this character design and pixel style. Keep the same camera, overall size and paw contact with the ground. No walking or turning. Seamlessly settle back into the starting pose.'
      : 'This curled-up kitten sleeps peacefully. Slow natural breathing lifts and relaxes its soft back, shoulders and head together very subtly, with a tiny relaxed ear twitch. Eyes remain closed and paws rest on the ground. No rocking sideways or sliding across the floor. Keep the same camera, overall size, character design and pixel style. No symbols or objects. A calm seamless sleeping loop returning to the starting pose.',
  } };
}

async function run() {
  if (!['generate', 'retry-rejected', 'poll'].includes(command) || !stages.includes(stage)) throw new Error(`Usage: node scripts/pixellab-new-character.mjs generate|retry-rejected|poll ${stages.join('|')} [character]`);
  try { loadEnvFile(path.join(root, '.env.local')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const key = process.env.PIXELLAB_API_KEY?.trim();
  if (!key) throw new Error('Set PIXELLAB_API_KEY in .env.local.');
  await mkdir(directory, { recursive: true });
  const jobFile = path.join(directory, `${stage}-job.json`);
  const responseFile = path.join(directory, `${stage}-response.json`);
  async function api(route, body) {
    const response = await fetch(`https://api.pixellab.ai/v2${route}`, {
      method: body ? 'POST' : 'GET', redirect: 'error',
      headers: { Authorization: `Bearer ${key}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(body ? 300000 : 60000),
    });
    if (!response.ok) {
      const error = new Error(`PixelLab HTTP ${response.status}; request not retried. Saved records: ${directory}`);
      error.httpStatus = response.status;
      throw error;
    }
    return response.json();
  }
  let current, job;
  if (command === 'generate' || command === 'retry-rejected') {
    const request = await requestFor(stage);
    if (command === 'retry-rejected') {
      const rejected = JSON.parse(await readFile(jobFile, 'utf8'));
      if (rejected.status !== 'rejected' || rejected.httpStatus !== 429 || rejected.id) throw new Error('Only an explicit HTTP 429 rejection without a job ID can be resubmitted.');
      await writeFile(path.join(directory, `${stage}-rejected-${Date.now()}.json`), JSON.stringify(rejected, null, 2) + '\n', { flag: 'wx' });
    }
    // Reserve the stage BEFORE POST: even a timeout cannot cause a blind paid retry.
    await writeFile(jobFile, JSON.stringify({ status: 'submitting', endpoint: request.endpoint }, null, 2) + '\n', { flag: command === 'generate' ? 'wx' : 'w' });
    await writeFile(path.join(directory, `${stage}-request.json`), JSON.stringify(request.body, null, 2) + '\n');
    try { current = await api(request.endpoint, request.body); }
    catch (error) {
      await writeFile(jobFile, JSON.stringify({ status: error.httpStatus === 429 ? 'rejected' : 'unconfirmed', endpoint: request.endpoint, httpStatus: error.httpStatus }, null, 2) + '\n');
      throw error;
    }
    await writeFile(responseFile, JSON.stringify(current, null, 2) + '\n');
    job = { endpoint: request.endpoint, id: current.background_job_id, status: current.status ?? 'completed', usage: current.usage };
    await writeFile(jobFile, JSON.stringify(job, null, 2) + '\n');
    console.log(`${character}/${stage}: ${job.status}`);
  } else {
    job = JSON.parse(await readFile(jobFile, 'utf8'));
    if (job.status === 'completed') current = JSON.parse(await readFile(responseFile, 'utf8'));
    else if (!job.id) throw new Error('No job ID was received. Check PixelLab before submitting another paid request.');
  }
  const deadline = Date.now() + 15 * 60 * 1000;
  while (job.id && current?.status !== 'completed') {
    if (Date.now() > deadline) throw new Error('Polling timed out; use poll to resume without another generation.');
    current = await api(`/background-jobs/${encodeURIComponent(job.id)}`);
    job = { ...job, status: current.status, usage: current.usage ?? job.usage };
    await writeFile(jobFile, JSON.stringify(job, null, 2) + '\n');
    if (current.status === 'failed') {
      await writeFile(responseFile, JSON.stringify(current, null, 2) + '\n');
      throw new Error(`${stage}: generation failed; see saved response.`);
    }
    if (current.status !== 'completed') { console.log(`${character}/${stage}: ${current.status}`); await new Promise(resolve => setTimeout(resolve, 10000)); }
  }
  await writeFile(responseFile, JSON.stringify(current, null, 2) + '\n');
  const result = current.last_response ?? current;
  const images = result.images ?? (result.image ? [result.image] : []);
  if (!images.length) throw new Error('Completed response has no images; inspect the saved response before retrying.');
  const output = path.join(directory, 'source', stage);
  await mkdir(output, { recursive: true });
  for (const [i, image] of images.entries()) {
    if (typeof image.base64 !== 'string') throw new Error('Unexpected image format.');
    const png = Buffer.from(image.base64.replace(/^data:image\/png;base64,/, ''), 'base64');
    if (!png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('Expected PNG.');
    await writeFile(path.join(output, `${String(i).padStart(2, '0')}.png`), png);
  }
  console.log(`${character}/${stage}: saved ${images.length} images; usage ${JSON.stringify(job.usage)}`);
}
run().catch(error => { console.error(error.code === 'EEXIST' ? 'Existing stage: use poll, not generate.' : error.message); process.exitCode = 1; });
