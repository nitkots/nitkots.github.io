/**
 * The letter sphere as the opening of the main site (index.html).
 *
 * The sphere fills the first screen; the original site sits right below it.
 * Spelling a word runs that word's action (see home-config.js): scroll to a
 * section, open a page, open a profile, or copy the email address.
 *
 * Letter keys only drive the sphere while the hero is mostly on screen
 * (body.sphere-active). Once you scroll into the site, the page's own
 * "press C to copy email" shortcut takes over again.
 */
import { HOME_DESTINATIONS, HOME_LAYOUT } from './home-config.js';
import { buildGraph } from './graph.js';
import { createNavigator } from './navigation.js';

const hero = document.querySelector('.sphere-hero');
if (hero) init(hero);

function init(hero) {
  const $ = (sel) => hero.querySelector(sel);
  const body = document.body;
  const reducedMQ = window.matchMedia('(prefers-reduced-motion: reduce)');
  const coarse = window.matchMedia('(pointer: coarse)').matches;

  const graph = buildGraph(HOME_DESTINATIONS, HOME_LAYOUT);
  const nav = createNavigator(graph);

  const els = {
    canvas: $('.sphere-canvas'),
    readout: $('.readout'),
    hint: $('.hint'),
    status: $('.sphere-status'),
    fallback: $('.letter-fallback'),
    ctl: $('.console-ctl'),
  };

  let sphere = null;
  let completing = null;   // timer while the confirmation plays
  let hintTimer = 0;
  let active = true;       // hero mostly visible → letters spell
  let visible = true;      // hero on screen at all → keep rendering

  /** ['S','P','C'] → "S, P, or C" */
  const orList = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')}, or ${xs[xs.length - 1]}`);
  const HINTS = {
    // The first letters come from the word list, so this stays right if the words change.
    idle: `${coarse ? 'Tap to navigate. Tap' : 'Type to navigate. Press'} ${orList(graph.root.children.map((c) => c.letter))}.`,
    moving: coarse ? 'Tap a lit letter to continue' : 'Backspace to step back · Esc to reset',
  };

  /* ---------- readout ---------- */

  function renderReadout(state) {
    const typed = [...state.prefix].map((l, i) => `<span class="ch" style="--i:${i}">${l}</span>`).join('');
    let ghost = '';
    if (!state.isRoot && state.candidates.length === 1) {
      const remaining = state.candidates[0].word.length - state.prefix.length;
      ghost = '<span class="ghost">' + '·'.repeat(Math.max(0, remaining)) + '</span>';
    }
    els.readout.innerHTML = typed + ghost + '<span class="caret" aria-hidden="true"></span>';
    els.readout.classList.toggle('is-empty', state.isRoot);
    els.ctl.hidden = state.isRoot || hero.classList.contains('no-webgl');
  }

  function setHint(text, tone = '') {
    els.hint.textContent = text;
    els.hint.dataset.tone = tone;
  }

  function announce(text) {
    els.status.textContent = '';
    requestAnimationFrame(() => { els.status.textContent = text; });
  }

  els.ctl.addEventListener('click', (e) => {
    const action = e.target.closest('button')?.dataset.action;
    if (action === 'back') stepBack();
    else if (action === 'reset') resetNav();
  });

  /* ---------- fallback letter strip (no WebGL) ---------- */

  function renderFallback(state) {
    if (!hero.classList.contains('no-webgl')) return;
    const letters = state.next.map((n) =>
      `<button type="button" class="fb-letter" data-letter="${n.letter}" aria-label="Letter ${n.letter}">${n.letter}</button>`).join('');
    const controls = state.isRoot ? '' :
      '<button type="button" class="fb-ctl" data-action="back">Back</button><button type="button" class="fb-ctl" data-action="reset">Reset</button>';
    els.fallback.innerHTML = `<div class="fb-letters" role="group" aria-label="Next letters">${letters}</div><div class="fb-controls">${controls}</div>`;
  }

  els.fallback.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.letter) selectLetter(b.dataset.letter);
    else if (b.dataset.action === 'back') stepBack();
    else if (b.dataset.action === 'reset') resetNav();
    requestAnimationFrame(() => els.fallback.querySelector('button')?.focus());
  });

  /* ---------- navigation ---------- */

  function selectLetter(letter) {
    if (completing) return;
    const r = nav.select(letter);
    if (r.complete) complete(r.complete);
  }

  function stepBack() {
    if (completing) return cancelCompletion();
    nav.back();
  }

  function resetNav() {
    if (completing) cancelCompletion();
    nav.reset();
  }

  function cancelCompletion() {
    clearTimeout(completing);
    completing = null;
    hero.classList.remove('is-complete');
    nav.back();
  }

  /**
   * Runs a destination's action. Opening a tab and writing to the clipboard
   * happen immediately, while the key press or tap still counts as a user
   * gesture; scrolling and page changes wait for the confirmation to play.
   */
  function complete(dest) {
    const reduced = reducedMQ.matches;
    const { action } = dest;
    let message = `Opening ${dest.title}`;
    let after = () => {};
    let delay = reduced ? 250 : 900;

    if (action.type === 'scroll') {
      message = `Going to ${dest.title}`;
      after = () => {
        document.querySelector(action.target)?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
        setTimeout(() => nav.reset(), 600);
      };
    } else if (action.type === 'page') {
      delay = reduced ? 250 : 700;
      // The shared page transition (assets/transition.js): the sphere fills the screen, then the page opens.
      after = () => (window.PageTransition ? window.PageTransition.go(action.href, dest.word) : (location.href = action.href));
    } else if (action.type === 'external') {
      const tab = window.open('about:blank', '_blank');
      if (tab) {
        tab.opener = null;
        tab.location.href = action.href;
        message = `${dest.title} opened in a new tab`;
        delay = 1400;
        after = () => nav.reset();
      } else {
        after = () => { location.href = action.href; }; // popup blocked: go there directly
      }
    } else if (action.type === 'copy') {
      copyEmail(action.text, 'readout', 1500);
      message = 'Email copied to clipboard';
      delay = 1900;
      after = () => nav.reset();
    }

    hero.classList.add('is-complete');
    setHint(message, 'complete');
    announce(`${dest.title}. ${message}.`);
    sphere?.celebrate(nav.state.path);
    completing = setTimeout(() => {
      completing = null;
      hero.classList.remove('is-complete');
      after();
    }, delay);
  }

  nav.subscribe((event, state) => {
    sphere?.setState(state);
    renderReadout(state);
    renderFallback(state);
    if (event.type === 'invalid') {
      clearTimeout(hintTimer);
      els.readout.classList.remove('shake');
      void els.readout.offsetWidth; // restart the animation
      els.readout.classList.add('shake');
      sphere?.flashInvalid(event.letter);
      const msg = state.isRoot ? `Nothing begins with “${event.letter}”` : `No path continues with “${event.letter}”`;
      setHint(msg, 'invalid');
      announce(`${msg}. Available: ${state.nextLetters.join(', ')}.`);
      hintTimer = setTimeout(() => setHint(state.isRoot ? HINTS.idle : HINTS.moving), 1600);
      return;
    }
    if (completing) return;
    hero.classList.remove('is-complete');
    setHint(state.isRoot ? HINTS.idle : HINTS.moving);
    if (event.type === 'select') {
      const names = state.candidates.map((d) => d.title).join(', ');
      announce(`${state.prefix.split('').join(' ')}. ${state.nextLetters.length ? `Next: ${state.nextLetters.join(', ')}.` : ''} Leads to ${names}.`);
    } else if (event.type === 'back') {
      announce(state.isRoot ? 'Cleared.' : `Back to ${state.prefix.split('').join(' ')}.`);
    } else if (event.type === 'reset' && event.changed) {
      announce('Reset. Choose a first letter.');
    }
  });

  /* ---------- copy email (same feel as the About page's copy button) ---------- */

  const emailBtn = hero.querySelector('.hw-email');
  const EMAIL = HOME_DESTINATIONS.find((d) => d.action.type === 'copy')?.action.text || '';
  let copyTimer = 0;

  /**
   * Copies the address, then shows "Email copied" over the source: the contact
   * link, or the spelled word. Copying again while it shows just keeps it up
   * (no restart jump). `holdMs` is how long it stays before easing out.
   */
  function copyEmail(text, source, holdMs = 1700) {
    const show = () => {
      const target = source === 'readout' ? hero : emailBtn;
      if (!target) return;
      clearTimeout(copyTimer);
      target.classList.add('copied');
      if (source !== 'readout') {
        target.classList.add('pressed');
        setTimeout(() => target.classList.remove('pressed'), 160);
      }
      copyTimer = setTimeout(() => target.classList.remove('copied'), holdMs);
    };
    const done = navigator.clipboard?.writeText(text);
    if (done) done.then(show, () => setHint(`Copy failed: ${text}`, 'invalid'));
    else setHint(text, 'complete');
  }

  emailBtn?.addEventListener('click', () => {
    copyEmail(EMAIL, 'button');
    announce('Email copied to clipboard.');
  });

  /* ---------- keyboard ---------- */

  const isEditable = (el) => el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

  document.addEventListener('keydown', (e) => {
    if (!active || e.defaultPrevented || e.isComposing) return;
    if (isEditable(e.target)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return; // keep browser and OS shortcuts

    if (/^[a-z]$/i.test(e.key)) {
      if (e.repeat) return;
      selectLetter(e.key);
    } else if (e.key === 'Backspace') {
      e.preventDefault();
      stepBack();
    } else if (e.key === 'Escape') {
      resetNav();
    } else if (e.key === 'Enter') {
      if (e.target.closest?.('a, button')) return; // let focused controls activate normally
      const dest = nav.commit();
      if (dest && !completing) {
        for (const ch of dest.word.slice(nav.state.prefix.length)) nav.select(ch);
        if (!completing) complete(dest);
      }
    }
  });

  /* ---------- visibility: who owns the keyboard, and pause when off screen ---------- */

  function setActive(on) {
    active = on;
    body.classList.toggle('sphere-active', on);
  }
  setActive(true);

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([entry]) => {
      setActive(entry.intersectionRatio >= 0.6);
      const nowVisible = entry.isIntersecting;
      if (nowVisible !== visible) {
        visible = nowVisible;
        if (sphere) visible ? sphere.start() : sphere.stop();
      }
    }, { threshold: [0, 0.6] }).observe(hero);
  }

  /* ---------- boot ---------- */

  function enableFallback(reason) {
    console.info('[sphere] Using the 2D fallback:', reason);
    sphere?.dispose?.();
    sphere = null;
    hero.classList.add('no-webgl');
    renderFallback(nav.state);
    renderReadout(nav.state);
    finishLoading();
  }

  function finishLoading() {
    hero.classList.remove('is-loading');
    hero.classList.add('is-ready');
  }

  function webglAvailable() {
    try {
      const c = document.createElement('canvas');
      return !!(c.getContext('webgl2') || c.getContext('webgl'));
    } catch { return false; }
  }

  async function boot() {
    renderReadout(nav.state);
    setHint(HINTS.idle);
    if (!webglAvailable()) return enableFallback('WebGL unavailable');

    const font = '"IBM Plex Mono", ui-monospace, Menlo, monospace';
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timed out loading 3D')), 9000));
    try {
      const [{ SphereScene }] = await Promise.race([
        Promise.all([import('./sphere.js'), document.fonts?.load(`300 64px ${font}`).catch(() => null)]),
        timeout,
      ]);
      sphere = new SphereScene({
        canvas: els.canvas,
        graph,
        font,
        theme: 'archive',
        // Keep the typed word sitting just above the sphere's edge at any screen size.
        onLayout: ({ horizonY }) => hero.style.setProperty('--horizon', `${Math.round(horizonY)}px`),
        reducedMotion: reducedMQ.matches,
        coarse,
        onPick: (node) => {
          const state = nav.state;
          if (node.depth === 0) return resetNav();
          if (state.path.includes(node) && node !== state.node) return nav.goTo(node);
          if (node === state.node) return;
          selectLetter(node.letter);
        },
        onContextLost: () => enableFallback('WebGL context lost'),
      });
      sphere.setState(nav.state);
      if (visible) sphere.start();
      finishLoading();
    } catch (err) {
      enableFallback(err?.message || err);
    }
  }

  reducedMQ.addEventListener?.('change', () => { if (sphere) sphere.reduced = reducedMQ.matches; });

  boot();
}
