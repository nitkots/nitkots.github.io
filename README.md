# niteshkothari.com

A static site, no build step for the pages. The homepage is a 3D letter sphere
(Three.js, loaded from a CDN): spell STUDIES, PROFILE, PROJECTS, CONTACT, CODE or
CONNECT to go there. Every page change plays the same transition: a dark dome rises
with the destination's name and a quote, then sinks away on the next page.

```
index.html                 homepage: the letter sphere
about.html                 profile: bio, links, education
work.html                  projects and research
privacy.html, terms.html   short privacy note and terms (linked from the footer)
404.html                   "page not found" (served by GitHub Pages)
robots.txt, sitemap.xml    search engine files
assets/transition.css/.js  the shared page transition (and the QUOTES per page)
assets/footer.css          the shared footer
assets/explore/
  home-config.js           homepage words and what each one does (page/external/copy)
  home.js                  homepage sphere wiring
  home.css                 homepage sphere styles (scoped to .sphere-hero)
  home.bundle.js           GENERATED from the modules here by tools/build-home.mjs
  config.js                shared graph layout (and the word list used by the tests)
  graph.js                 prefix trie + layout on the sphere (pure)
  navigation.js            navigation state machine (pure)
  sphere.js                Three.js scene (`archive` theme is the homepage)
tests/                     unit tests for graph + navigation + homepage words
_archive/                  local only (git-ignored): retired files and image originals
```

## Run locally

Open `index.html` directly, or serve the folder:

```sh
python3 -m http.server 8765     # then open http://localhost:8765
node --test tests/*.test.mjs    # logic tests
```

## Homepage words

Edit `HOME_DESTINATIONS` in `assets/explore/home-config.js` (the order sets the
"Press S, P, or C" hint), update the links under the name in `index.html`, then:

```sh
node tools/build-home.mjs       # regenerates assets/explore/home.bundle.js
node --test tests/*.test.mjs    # fails if the bundle is stale or letters overlap
```

`index.html` loads `home.bundle.js` (one plain script) so it also works opened
straight from disk. Rebuild after changing any module in `assets/explore/`.

## Page transitions and quotes

`assets/transition.js` handles every same-site link to another page. Each page
includes, in its `<head>`:

```html
<link rel="stylesheet" href="assets/transition.css">
<script>try{if(sessionStorage.getItem('pt-label')!==null){var r=document.documentElement;r.classList.add('pt-entering');requestAnimationFrame(function(){requestAnimationFrame(function(){r.classList.add('pt-go')})})}}catch(e){}</script>
<script src="assets/transition.js" defer></script>
```

The word shown is the link text, or `data-pt-label="…"`. Quotes per destination are in
`QUOTES` at the top of `transition.js`; any click or key skips them. A new page also
needs `assets/footer.css` and a copy of the `<footer class="site-footer">` block.

## SEO

Each page has a title, description, canonical URL, Open Graph and Twitter tags
(preview image: `assets/og-image.jpg`, 1200×630). `index.html`, `about.html` and
`work.html` carry schema.org JSON-LD (Person, WebSite, ProfilePage, and an ItemList of
projects and papers). When you add a page, add it to `sitemap.xml` and give it the same
head tags.

## Deploy

GitHub Pages serves the repository root (`CNAME` → niteshkothari.com; `.nojekyll`
serves files as-is). Commit and push to `main`.
