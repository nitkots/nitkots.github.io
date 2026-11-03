// Run with: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph } from '../assets/explore/graph.js';
import { createNavigator } from '../assets/explore/navigation.js';
import { DESTINATIONS, GRAPH_LAYOUT } from '../assets/explore/config.js';

const graph = buildGraph(DESTINATIONS, GRAPH_LAYOUT);

const spell = (nav, word) => {
  let result;
  for (const ch of word) result = nav.select(ch);
  return result;
};

test('initial letters are exactly the first letters of the destinations', () => {
  const nav = createNavigator(graph);
  const expected = [...new Set(DESTINATIONS.map((d) => d.word[0]))].sort();
  assert.deepEqual([...nav.state.nextLetters].sort(), expected);
});

test('every destination can be fully spelled and completes on its last letter', () => {
  for (const dest of DESTINATIONS) {
    const nav = createNavigator(graph);
    const word = dest.word;
    for (let i = 0; i < word.length; i++) {
      const r = nav.select(word[i]);
      assert.equal(r.ok, true, `${word}: letter ${i} (${word[i]})`);
      if (i < word.length - 1) {
        assert.equal(r.complete, null);
        assert.ok(nav.state.nextLetters.includes(word[i + 1]), `${word}: next letter offered`);
      } else {
        assert.equal(r.complete?.id, dest.id);
      }
    }
  }
});

test('input is case-insensitive', () => {
  const nav = createNavigator(graph);
  assert.equal(spell(nav, 'contact').complete?.id, 'contact');
});

test('invalid letters do not change state and report feedback', () => {
  const nav = createNavigator(graph);
  const events = [];
  nav.subscribe((e) => events.push(e));
  nav.select('P');
  const r = nav.select('Z');
  assert.equal(r.ok, false);
  assert.equal(nav.state.prefix, 'P');
  assert.equal(events.at(-1).type, 'invalid');
  assert.equal(events.at(-1).existsElsewhere, false);
  nav.select('O'); // O exists in the graph (ABOUT) but not after P
  assert.equal(events.at(-1).existsElsewhere, true);
  assert.equal(nav.state.prefix, 'P');
});

test('back removes the last letter; reset clears; back at root is a no-op', () => {
  const nav = createNavigator(graph);
  spell(nav, 'RES');
  assert.equal(nav.back(), true);
  assert.equal(nav.state.prefix, 'RE');
  nav.reset();
  assert.equal(nav.state.prefix, '');
  assert.equal(nav.back(), false);
});

test('goTo jumps back along the current path only', () => {
  const nav = createNavigator(graph);
  spell(nav, 'GITH');
  const g = graph.byPrefix.get('GI');
  assert.equal(nav.goTo(g), true);
  assert.equal(nav.state.prefix, 'GI');
  assert.equal(nav.goTo(graph.byPrefix.get('AB')), false);
  assert.equal(nav.goTo(graph.root), true);
  assert.equal(nav.state.isRoot, true);
});

test('commit resolves a unique candidate', () => {
  const nav = createNavigator(graph);
  assert.equal(nav.commit(), null);
  nav.select('W');
  assert.equal(nav.commit()?.id, 'writing');
});

test('shared prefixes keep all paths alive until they diverge', () => {
  const g = buildGraph([
    { id: 'projects', word: 'PROJECTS' },
    { id: 'prose', word: 'PROSE' },
    { id: 'papers', word: 'PAPERS' },
    { id: 'pro', word: 'PRO' },
  ]);
  const nav = createNavigator(g);
  assert.deepEqual(nav.state.nextLetters, ['P']);
  nav.select('P');
  assert.deepEqual([...nav.state.nextLetters].sort(), ['A', 'R']);
  nav.select('R');
  nav.select('O');
  // PRO is itself a destination but longer words continue: not auto-completed.
  assert.equal(nav.state.exact?.id, 'pro');
  assert.deepEqual([...nav.state.nextLetters].sort(), ['J', 'S']);
  assert.equal(nav.state.candidates.length, 3);
  assert.equal(nav.commit()?.id, 'pro');
  assert.equal(spell(nav, 'SE').complete?.id, 'prose');
});

test('shared prefix branches get distinct sphere positions', () => {
  const g = buildGraph([
    { id: 'a', word: 'PROJECTS' },
    { id: 'b', word: 'PROSE' },
  ]);
  const j = g.byPrefix.get('PROJ').position;
  const s = g.byPrefix.get('PROS').position;
  const dist = Math.hypot(j[0] - s[0], j[1] - s[1], j[2] - s[2]);
  assert.ok(dist > 0.1, `branches separated (${dist.toFixed(3)})`);
});

test('all node positions are unit vectors and no two letters overlap', () => {
  for (const n of graph.nodes) {
    const len = Math.hypot(...n.position);
    assert.ok(Math.abs(len - 1) < 1e-9);
  }
  const letters = graph.nodes.filter((n) => n.depth > 0);
  for (let i = 0; i < letters.length; i++) {
    for (let k = i + 1; k < letters.length; k++) {
      const a = letters[i].position, b = letters[k].position;
      const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      assert.ok(d > 0.1, `${letters[i].prefix} vs ${letters[k].prefix}: ${d.toFixed(3)}`);
    }
  }
});

test('rejects bad configuration', () => {
  assert.throws(() => buildGraph([{ id: 'x', word: 'NO-PE' }]));
  assert.throws(() => buildGraph([{ id: 'x', word: 'A' }, { id: 'x', word: 'B' }]));
  assert.throws(() => buildGraph([{ id: 'x', word: 'SAME' }, { id: 'y', word: 'same' }]));
});
