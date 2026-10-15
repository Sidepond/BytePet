import { EATING_MS } from './cat.js';

export const CHEW_MS = 650;
export const RESULT_MS = 1100;
export const ATTACK_MS = 650;

export function createReactionPlayer(onChange, { schedule = setTimeout, cancel = clearTimeout, now = () => performance.now() } = {}) {
  let timers = [];
  let version = 0;
  let attack = null;
  function stop() {
    version++;
    attack = null;
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
  function portReaction({ id, phase }) {
    if (phase === 'attack') {
      stop();
      attack = { id, startedAt: now(), version };
      onChange({ state: 'attack', source: 'ports', startedAt: now() });
    } else if (['success', 'failure'].includes(phase) && attack?.id === id) {
      const current = attack;
      attack = null;
      const wait = Math.max(0, ATTACK_MS - (now() - current.startedAt));
      timers.push(schedule(() => {
        if (version === current.version) onChange({ state: phase, source: 'ports', startedAt: now() });
      }, wait));
      timers.push(schedule(() => {
        if (version === current.version) onChange({ state: 'idle', startedAt: now() });
      }, wait + RESULT_MS));
    }
  }
  return { play, portReaction, dispose: stop };
}
