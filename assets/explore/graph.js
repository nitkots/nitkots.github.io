/**
 * Builds the letter graph: a prefix trie of destination words, laid out as a
 * radial tree on the surface of a unit sphere.
 *
 * Pure module (no DOM, no Three.js), so it can be unit-tested in Node.
 *
 * Layout: the origin node (empty prefix) sits at the local pole +Z. First
 * letters form a ring around it; each path then travels away from the pole
 * one `step` per letter. Every subtree owns an azimuthal wedge sized by its
 * number of destinations, so shared prefixes stay one path and split cleanly
 * where words diverge.
 */

const TAU = Math.PI * 2;

export function normalizeWord(word) {
  return String(word || '').trim().toUpperCase();
}

export function buildGraph(destinations, layout = {}) {
  const { rootColatitude = 0.27, step = 0.165, meander = 0.12, evenRoot = false, branchSpread = 1 } = layout;

  const root = makeNode('', '', null);
  const byPrefix = new Map([['', root]]);
  const seenIds = new Set();

  for (const dest of destinations) {
    const word = normalizeWord(dest.word);
    if (!/^[A-Z]+$/.test(word)) {
      throw new Error(`Destination "${dest.id}" has an invalid word "${dest.word}" (letters A–Z only).`);
    }
    if (seenIds.has(dest.id)) throw new Error(`Duplicate destination id "${dest.id}".`);
    seenIds.add(dest.id);

    let current = root;
    root.destinations.push(dest.id);
    for (let i = 0; i < word.length; i++) {
      const prefix = word.slice(0, i + 1);
      let next = byPrefix.get(prefix);
      if (!next) {
        next = makeNode(prefix, word[i], current);
        current.children.push(next);
        byPrefix.set(prefix, next);
      }
      next.destinations.push(dest.id);
      current = next;
    }
    if (current.terminal) {
      throw new Error(`Destinations "${current.terminal.id}" and "${dest.id}" share the word "${word}".`);
    }
    current.terminal = { ...dest, word };
  }

  // Radial tree: give every subtree a wedge proportional to its destinations.
  const assign = (node, a0, a1) => {
    node.wedge = [a0, a1];
    node.azimuth = (a0 + a1) / 2;
    // evenRoot: first letters are spaced evenly round the origin (so none hides
    // off-screen), and only deeper branches are sized by their destinations.
    const even = evenRoot && node === root;
    const weight = (c) => (even ? 1 : c.destinations.length);
    const total = node.children.reduce((s, c) => s + weight(c), 0);
    // branchSpread < 1 keeps forks below the first letters closer together.
    const width = (a1 - a0) * (node === root ? 1 : branchSpread);
    let a = (a0 + a1) / 2 - width / 2;
    for (const child of node.children) {
      const span = (width * weight(child)) / total;
      assign(child, a, a + span);
      a += span;
    }
  };
  // Offset so the first wedge is centred at the top of the ring.
  const firstSpan = !root.children.length ? 0
    : evenRoot ? TAU / root.children.length
    : (TAU * root.children[0].destinations.length) / root.destinations.length;
  assign(root, Math.PI / 2 - firstSpan / 2, Math.PI / 2 - firstSpan / 2 + TAU);

  const nodes = [];
  const walk = (node, branchIndex) => {
    node.branch = branchIndex;
    if (node.depth === 0) {
      node.position = [0, 0, 1];
    } else {
      const k = node.depth;
      const colat = rootColatitude + (k - 1) * step;
      // Meander depends only on (branch, depth) so sibling sub-branches stay apart.
      const ramp = Math.min(1, (k - 1) / 2);
      const az = node.azimuth + meander * ramp * Math.sin(k * 0.82 + branchIndex * 1.9);
      node.colatitude = colat;
      node.position = [Math.sin(colat) * Math.cos(az), Math.sin(colat) * Math.sin(az), Math.cos(colat)];
    }
    nodes.push(node);
    node.children.forEach((child, i) => walk(child, node.depth === 0 ? i : branchIndex));
  };
  walk(root, 0);

  const edges = nodes.filter((n) => n.parent).map((n) => ({ from: n.parent, to: n }));
  const maxDepth = nodes.reduce((m, n) => Math.max(m, n.depth), 0);

  return { root, nodes, edges, byPrefix, maxDepth, destinations: destinations.map((d) => ({ ...d, word: normalizeWord(d.word) })) };
}

function makeNode(prefix, letter, parent) {
  return {
    id: prefix || '∅',
    prefix,
    letter,
    parent,
    depth: parent ? parent.depth + 1 : 0,
    children: [],
    destinations: [],
    terminal: null,
  };
}

/** All ancestors of `node` from depth 1 down to the node itself. */
export function pathTo(node) {
  const path = [];
  for (let n = node; n && n.depth > 0; n = n.parent) path.unshift(n);
  return path;
}

export function isDescendant(node, ancestor) {
  for (let n = node; n; n = n.parent) if (n === ancestor) return true;
  return false;
}
