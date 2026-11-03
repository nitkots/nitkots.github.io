/**
 * DESTINATIONS: the original word list, kept as fixtures for tests/navigation.test.mjs.
 * The homepage's real words live in home-config.js.
 *
 * Words that share a prefix (e.g. PROJECTS / PROFILE) are handled automatically:
 * the shared letters become one path that branches where the words diverge.
 */
export const DESTINATIONS = [
  { id: 'about',      word: 'ABOUT',      title: 'About',      summary: 'Who I am and how I build' },
  { id: 'research',   word: 'RESEARCH',   title: 'Research',   summary: 'Questions I keep returning to' },
  { id: 'projects',   word: 'PROJECTS',   title: 'Projects',   summary: 'Things I have built' },
  { id: 'experience', word: 'EXPERIENCE', title: 'Experience', summary: 'Roles, research, and work' },
  { id: 'writing',    word: 'WRITING',    title: 'Writing',    summary: 'Essays, notes, and papers' },
  { id: 'github',     word: 'GITHUB',     title: 'GitHub',     summary: 'Code and works in progress' },
  { id: 'contact',    word: 'CONTACT',    title: 'Contact',    summary: 'Ways to reach me' },
];

/** Layout of the letter graph on the sphere (angles in radians). */
export const GRAPH_LAYOUT = {
  rootColatitude: 0.27, // distance of first letters from the central origin node
  step: 0.165,          // angular spacing between consecutive letters
  meander: 0.12,        // gentle sideways drift of each path
};
