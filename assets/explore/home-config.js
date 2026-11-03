/**
 * Words you can spell on the homepage sphere (index.html), and what each one does.
 *
 * action.type:
 *   scroll   – smooth-scroll to an element on the page (`target` is a CSS selector)
 *   page     – go to another page on the site (with the shared page transition)
 *   external – open a link in a new tab
 *   copy     – copy text to the clipboard ("Copied!" pops over the spelled word)
 *
 * Words must be letters A–Z and unique. Run `node --test tests/` after editing:
 * it checks that every word is spellable and that no letters overlap.
 */
// Chosen so words share opening letters and branch apart on the sphere:
// PRO → FILE / JECTS, and CO → DE / N → TACT / NECT.
// Order matters: the homepage hint lists first letters in this order (S, P, C).
import { GRAPH_LAYOUT } from './config.js';

/** Homepage layout: first letters spaced evenly so P, S and C are all on screen at rest,
 *  and later forks kept close so both branches stay in view. */
export const HOME_LAYOUT = { ...GRAPH_LAYOUT, evenRoot: true, branchSpread: 0.7 };

export const HOME_DESTINATIONS = [
  { id: 'studies',  word: 'STUDIES',  title: 'Studies',  action: { type: 'page', href: 'about.html#education' } },
  { id: 'profile',  word: 'PROFILE',  title: 'Profile',  action: { type: 'page', href: 'about.html' } },
  { id: 'projects', word: 'PROJECTS', title: 'Projects', action: { type: 'page', href: 'work.html' } },
  { id: 'contact',  word: 'CONTACT',  title: 'Contact',  action: { type: 'copy', text: 'niteshsachinkothari@gmail.com' } },
  { id: 'code',     word: 'CODE',     title: 'Code',     action: { type: 'external', href: 'https://github.com/nitkots' } },
  { id: 'connect',  word: 'CONNECT',  title: 'Connect',  action: { type: 'external', href: 'https://www.linkedin.com/in/nitesh-kothari-205504299/' } },
];
