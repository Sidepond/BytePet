export const IDLE_DURATIONS = { sleeping: 18000, stretching: 3200, grooming: 4800 };
// Keep the stretching artwork available for revision, but disable its playback.
const enabledActions = ['sleeping', 'grooming'];

// A separate clock keeps quiet-time gestures from competing with tool reactions.
export function createIdleBehavior({ random = Math.random, actions = enabledActions } = {}) {
  const available = [...new Set(actions)].filter(action => Object.hasOwn(IDLE_DURATIONS, action));
  let state = 'idle';
  let startedAt = 0;
  let nextAt = 0;
  let remaining = [];
  let previous;
  function reset(now) {
    state = 'idle';
    startedAt = now;
    nextAt = now + 12000 + random() * 12000;
  }
  function sample(now) {
    if (state !== 'idle' && now - startedAt >= IDLE_DURATIONS[state]) reset(now);
    if (state === 'idle' && now >= nextAt && available.length) {
      if (!remaining.length) remaining = [...available];
      const choices = remaining.filter(action => available.length === 1 || action !== previous);
      state = choices[Math.floor(random() * choices.length)];
      remaining = remaining.filter(action => action !== state);
      previous = state;
      startedAt = now;
    }
    return { state, elapsed: now - startedAt };
  }
  reset(0);
  return { reset, sample };
}
