/*
 * Minimal observable state container for UI state only: filters, search text,
 * selection, review rows, status, dialogs. It knows nothing about the browser, the
 * backend, or how state is persisted (see theme.js for the one exception).
 */
export function createStore(initial) {
  let state = { ...initial };
  const listeners = new Set();
  let notifyQueued = false;

  function flush() {
    notifyQueued = false;
    for (const listener of listeners) listener(state);
  }

  return {
    get() {
      return state;
    },
    set(patch) {
      const next = typeof patch === 'function' ? patch(state) : patch;
      let changed = false;
      for (const [key, value] of Object.entries(next)) {
        if (state[key] !== value) {
          state = { ...state, [key]: value };
          changed = true;
        }
      }
      if (!changed) return state;
      // Batches several set() calls in one tick into a single render pass.
      if (!notifyQueued) {
        notifyQueued = true;
        queueMicrotask(flush);
      }
      return state;
    },
    subscribe(listener) {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
  };
}
