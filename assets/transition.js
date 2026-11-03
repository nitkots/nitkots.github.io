/**
 * Page transition shared by every page (see transition.css).
 *
 * Leaving: the dark sphere rises until it fills the screen, the destination's
 * name appears, fades, then the browser navigates.
 * Arriving: handled in CSS. The inline <head> script adds `pt-entering` before
 * first paint and the sphere sinks away; this file only tidies up afterwards.
 *
 * Internal links (same site, same tab, a different page) use it automatically.
 * Scripts can call PageTransition.go(href, label), as the letter sphere does.
 * Add data-pt-label="…" to a link to choose the word shown.
 */
(function () {
  var KEY = 'pt-label';
  var RISE_MS = 750, LABEL_IN_MS = 300, LABEL_OUT_MS = 220;

  /**
   * A quote shown while the screen is covered, chosen by destination.
   * Keys are page file names (with #hash for a section); DEFAULT covers the rest.
   */
  var QUOTES = {
    'about.html':           { text: 'Don\u2019t take yourself so seriously. You\u2019re just a monkey with a plan.', by: 'Naval Ravikant' },
    'about.html#education': { text: 'Cool cool cool cool cool. No doubt no doubt no doubt.', by: 'Jake Peralta, Brooklyn Nine-Nine' },
    'work.html':            { text: 'Anybody can do my job, but no one can be me.', by: 'Harvey Specter, Suits' },
    'index.html':           { text: 'I know of no better life purpose than to perish in attempting the great and the impossible.', by: 'Friedrich Nietzsche' },
    DEFAULT:                { text: 'With great power comes great responsibility.', by: 'Spider-Man' },  // Privacy, Terms
  };
  function quoteFor(href) {
    var url;
    try { url = new URL(href, location.href); } catch (e) { return QUOTES.DEFAULT; }
    var file = url.pathname.split('/').pop() || 'index.html';
    return QUOTES[file + url.hash] || QUOTES[file] || QUOTES.DEFAULT;
  }
  // Long enough to read comfortably, never a chore: ~1.2s to 2.2s.
  function holdFor(q) { return Math.min(2200, 900 + q.text.length * 12); }
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  var root = document.documentElement;
  var veil, label, quote, leaving = false;

  try { sessionStorage.removeItem(KEY); } catch (e) {}
  // The arrival reveal has finished by now; drop the class so its layer is freed.
  if (root.classList.contains('pt-entering')) {
    var tidy = function () { root.classList.remove('pt-entering', 'pt-go'); };
    window.addEventListener('animationend', function (e) { if (e.animationName === 'pt-sink' || e.animationName === 'pt-fade') tidy(); });
    setTimeout(tidy, 4000); // safety net
  }

  function build() {
    if (veil) return;
    veil = document.createElement('div');
    veil.className = 'pt-veil';
    veil.setAttribute('aria-hidden', 'true');
    label = document.createElement('span');
    label.className = 'pt-label';
    veil.appendChild(label);
    quote = document.createElement('figure');
    quote.className = 'pt-quote';
    quote.innerHTML = '<blockquote></blockquote><figcaption></figcaption>';
    veil.appendChild(quote);
    document.body.appendChild(veil);
    void veil.offsetWidth; // commit the off-screen start position before any transition
  }

  function go(href, name) {
    if (leaving) return;
    leaving = true;
    try { sessionStorage.setItem(KEY, '1'); } catch (e) {}
    if (reduced.matches) { location.href = href; return; }
    build();
    var q = quoteFor(href);
    label.textContent = name || '';
    quote.firstChild.textContent = '\u201C' + q.text + '\u201D';
    quote.lastChild.textContent = q.by;
    var timers = [];
    var navigate = function () { location.href = href; };
    // Once the name and quote are up, any click or key skips the rest of the wait.
    var skip = function () {
      timers.forEach(clearTimeout);
      veil.classList.remove('show-label');
      setTimeout(navigate, LABEL_OUT_MS);
      document.removeEventListener('keydown', skip, true);
      veil.removeEventListener('click', skip);
    };
    requestAnimationFrame(function () {
      veil.classList.add('is-covering');
      // The name and quote appear once the sphere has covered the screen, then fade
      // so the next page (which starts with the plain sphere) matches exactly.
      var shown = RISE_MS - 120, hold = holdFor(q);
      timers.push(setTimeout(function () {
        veil.classList.add('show-label');
        document.addEventListener('keydown', skip, true);
        veil.addEventListener('click', skip);
      }, shown));
      timers.push(setTimeout(function () { veil.classList.remove('show-label'); }, shown + LABEL_IN_MS + hold));
      timers.push(setTimeout(navigate, shown + LABEL_IN_MS + hold + LABEL_OUT_MS));
    });
  }

  function isInternalPage(a) {
    if (!a.href || a.target === '_blank' || a.hasAttribute('download')) return false;
    var url;
    try { url = new URL(a.href, location.href); } catch (e) { return false; }
    if (url.protocol !== location.protocol || url.host !== location.host) return false;
    return url.pathname !== location.pathname; // same page (#hash only): scroll normally
  }

  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target.closest && e.target.closest('a[href]');
    if (!a || !isInternalPage(a)) return;
    e.preventDefault();
    go(a.href, a.getAttribute('data-pt-label') || a.textContent.trim());
  });

  // Back/forward can restore this page from cache while covered: uncover instantly.
  window.addEventListener('pageshow', function (e) {
    if (!e.persisted) return;
    leaving = false;
    root.classList.remove('pt-entering', 'pt-go');
    if (veil) {
      veil.classList.add('no-anim');
      veil.classList.remove('is-covering', 'show-label');
      void veil.offsetWidth;
      veil.classList.remove('no-anim');
    }
  });

  window.PageTransition = { go: go };
})();
