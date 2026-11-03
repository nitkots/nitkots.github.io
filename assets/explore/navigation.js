/**
 * Navigation state machine for the letter graph. Pure (no DOM, no rendering).
 *
 * State is just the current trie node. Every operation is synchronous, so
 * rapid typing is applied in order and never dropped; renderers simply
 * animate toward whatever the latest state is.
 */
import { pathTo } from './graph.js';

export function createNavigator(graph) {
  let current = graph.root;
  const listeners = new Set();

  const snapshot = () => ({
    node: current,
    prefix: current.prefix,
    path: pathTo(current),
    next: current.children,
    nextLetters: current.children.map((c) => c.letter),
    candidates: current.destinations.map((id) => graph.destinations.find((d) => d.id === id)),
    exact: current.terminal,
    isRoot: current === graph.root,
  });

  const emit = (event) => {
    const state = snapshot();
    listeners.forEach((fn) => fn(event, state));
  };

  return {
    get state() { return snapshot(); },

    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    /** Try to extend the path. Returns { ok, complete } where complete is a destination or null. */
    select(letter) {
      const L = String(letter).toUpperCase();
      const child = current.children.find((c) => c.letter === L);
      if (!child) {
        const existsElsewhere = graph.nodes.some((n) => n.letter === L);
        emit({ type: 'invalid', letter: L, existsElsewhere });
        return { ok: false, complete: null };
      }
      current = child;
      // A destination completes once its word is spelled and nothing longer continues from it.
      // (If a word is a prefix of another, commit() opens it on Enter.)
      const complete = child.terminal && child.children.length === 0 ? child.terminal : null;
      emit({ type: 'select', letter: L, complete });
      return { ok: true, complete };
    },

    back() {
      if (current === graph.root) return false;
      current = current.parent;
      emit({ type: 'back' });
      return true;
    },

    reset() {
      const was = current;
      current = graph.root;
      emit({ type: 'reset', changed: was !== graph.root });
    },

    /** Jump back to an already-selected node on the current path (or the root). */
    goTo(node) {
      if (!node || !pathTo(current).concat(graph.root).includes(node)) return false;
      current = node;
      emit({ type: node === graph.root ? 'reset' : 'back', changed: true });
      return true;
    },

    /** Destination for Enter: the exact word if spelled, or the single remaining candidate. */
    commit() {
      if (current.terminal) return current.terminal;
      if (current !== graph.root && current.destinations.length === 1) {
        return graph.destinations.find((d) => d.id === current.destinations[0]);
      }
      return null;
    },
  };
}
