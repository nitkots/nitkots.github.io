// Run with: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph } from '../assets/explore/graph.js';
import { createNavigator } from '../assets/explore/navigation.js';
import { HOME_DESTINATIONS, HOME_LAYOUT } from '../assets/explore/home-config.js';

const graph = buildGraph(HOME_DESTINATIONS, HOME_LAYOUT);

test('home: every word can be spelled and completes on its last letter', () => {
  for (const dest of HOME_DESTINATIONS) {
    const nav = createNavigator(graph);
    let r;
    for (const ch of dest.word) {
      r = nav.select(ch);
      assert.equal(r.ok, true, `${dest.word}: ${ch}`);
    }
    assert.equal(r.complete?.id, dest.id);
  }
});

test('home: every destination has a known action', () => {
  for (const d of HOME_DESTINATIONS) {
    assert.ok(['scroll', 'page', 'external', 'copy'].includes(d.action?.type), d.id);
  }
});

test('home: no two letters overlap on the sphere', () => {
  const letters = graph.nodes.filter((n) => n.depth > 0);
  for (let i = 0; i < letters.length; i++) {
    for (let k = i + 1; k < letters.length; k++) {
      const a = letters[i].position, b = letters[k].position;
      const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      assert.ok(d > 0.1, `${letters[i].prefix} vs ${letters[k].prefix}: ${d.toFixed(3)}`);
    }
  }
});

test('home: home.bundle.js is up to date with the source modules', async () => {
  const { readFileSync } = await import('node:fs');
  const { buildHome } = await import('../tools/build-home.mjs');
  const current = readFileSync(new URL('../assets/explore/home.bundle.js', import.meta.url), 'utf8');
  assert.equal(current, buildHome(), 'run: node tools/build-home.mjs');
});
