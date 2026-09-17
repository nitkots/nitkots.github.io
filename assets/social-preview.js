/* Adapted from Colin Lienard's Contacts.svelte and flyWithBlur (MIT).
   Copyright (c) 2026 Colin Lienard. See social-preview-LICENSE.txt. */
(function () {
  var links = document.querySelector('.links');
  if (!links) return;
  var items = Array.from(document.querySelectorAll('.link-item, .bio-link-item'));
  var popup = document.createElement('a');
  popup.className = 'social-preview';
  popup.tabIndex = -1;
  document.body.appendChild(popup);
  document.documentElement.classList.add('social-previews-ready');
  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  var active = -1, content = null, closeTimer;

  function close() {
    clearTimeout(closeTimer);
    popup.classList.remove('is-open');
    popup.tabIndex = -1;
    popup.removeAttribute('href');
    active = -1;
  }
  function scheduleClose() {
    clearTimeout(closeTimer);
    closeTimer = setTimeout(function () {
      if (!popup.matches(':hover, :focus-within')) close();
    }, 150);
  }
  function fly(node, direction, incoming) {
    if (reducedMotion.matches) {
      if (!incoming) node.remove();
      return;
    }
    var blurred = { transform: 'translateX(' + direction * 200 + 'px)', opacity: 0, filter: 'blur(2px)' };
    var clear = { transform: 'translateX(0)', opacity: 1, filter: 'blur(0)' };
    var animation = node.animate(incoming ? [blurred, clear] : [clear, blurred], {
      duration: 300, easing: 'cubic-bezier(.215,.61,.355,1)', fill: 'both'
    });
    animation.onfinish = function () {
      if (!incoming) node.remove();
      animation.cancel();
    };
  }
  function show(index) {
    clearTimeout(closeTimer);
    if (index === active) return;
    var wasOpen = active !== -1;
    var direction = wasOpen ? Math.sign(index - active) : 0;
    var anchor = items[index].querySelector('a');
    var source = items[index].querySelector('.preview-card');
    if (!source) return;
    popup.href = anchor.href;
    popup.target = anchor.target;
    popup.rel = 'noopener noreferrer';
    popup.setAttribute('aria-label', 'Open ' + anchor.textContent.trim());
    popup.tabIndex = 0;
    var next = source.cloneNode(true);
    next.setAttribute('aria-hidden', 'true');
    next.classList.add('social-preview-content');
    var width = Math.min(300, window.innerWidth - 24);
    next.style.width = (width - 2) + 'px';
    popup.appendChild(next);
    var height = next.offsetHeight + 2;
    var rect = anchor.getBoundingClientRect();
    var left = Math.max(12, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - 12));
    popup.classList.toggle('is-moving', wasOpen);
    popup.style.left = left + 'px';
    popup.style.bottom = (window.innerHeight - rect.top + 8) + 'px';
    popup.style.width = width + 'px';
    popup.style.height = height + 'px';
    if (wasOpen && content) {
      // Discard older outgoing cards when the pointer moves quickly.
      Array.from(popup.children).forEach(function (child) {
        if (child !== content && child !== next) child.remove();
      });
      content.getAnimations().forEach(function (animation) { animation.cancel(); });
      fly(content, -direction, false);
    } else {
      Array.from(popup.children).forEach(function (child) { if (child !== next) child.remove(); });
    }
    fly(next, direction, true);
    popup.classList.add('is-open');
    content = next;
    active = index;
  }
  items.forEach(function (item, index) {
    item.addEventListener('pointerenter', function (event) {
      if (event.pointerType === 'mouse') show(index);
    });
    item.addEventListener('focusin', function () { show(index); });
    item.addEventListener('pointerleave', scheduleClose);
    item.addEventListener('focusout', function (event) {
      if (event.relatedTarget !== popup) scheduleClose();
    });
    item.querySelector('a').addEventListener('keydown', function (event) {
      if (event.key === 'Tab' && !event.shiftKey && active === index) {
        event.preventDefault();
        popup.focus({ preventScroll: true });
      }
    });
  });
  popup.addEventListener('focus', function () { clearTimeout(closeTimer); });
  popup.addEventListener('blur', scheduleClose);
  popup.addEventListener('keydown', function (event) {
    if (event.key === 'Tab' && active !== -1) {
      var index = active;
      var anchors = Array.from(document.querySelectorAll('a[href], button'));
      var trigger = items[index].querySelector('a');
      var destination = event.shiftKey ? trigger : anchors[anchors.indexOf(trigger) + 1];
      if (destination && destination !== popup) {
        event.preventDefault();
        destination.focus({ preventScroll: true });
      }
    }
    if (event.key === 'Escape' && active !== -1) items[active].querySelector('a').focus({ preventScroll: true });
  });
  popup.addEventListener('pointerenter', function () { clearTimeout(closeTimer); });
  popup.addEventListener('pointerleave', scheduleClose);
  document.addEventListener('keydown', function (event) { if (event.key === 'Escape') close(); });
  window.addEventListener('scroll', close, { passive: true });
  window.addEventListener('resize', close);
})();
