import { EATING_MS } from './cat.js';

export const CHEW_MS = 650;
export const RESULT_MS = 1100;

export function createReactionPlayer(onChange, { schedule = setTimeout, cancel = clearTimeout, now = () => performance.now() } = {}) {
  let timers = [];
  let version = 0;
  function stop() {
    version++;
    timers.forEach(cancel);
    timers = [];
  }
  function play(outcome) {
    if (!['eating', 'success', 'failure'].includes(outcome)) return;
    stop();
    const current = version;
    const change = state => { if (current === version) onChange({ state, startedAt: now() }); };
    change(outcome === 'eating' ? 'eating' : 'processing');
    if (outcome !== 'eating') timers.push(schedule(() => change(outcome), CHEW_MS));
    timers.push(schedule(() => change('idle'), outcome === 'eating' ? EATING_MS : CHEW_MS + RESULT_MS));
  }
  return { play, dispose: stop };
}
