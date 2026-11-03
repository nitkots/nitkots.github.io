/**
 * The letter sphere: Three.js rendering of the navigation graph.
 *
 * Letters, nodes and arcs are anchored to the sphere surface and move with it
 * as one system. Visibility uses the exact convex-sphere test
 * dot(normal, toCamera) > 0, so anything on the far side is hidden and
 * letters fade out as they cross the horizon.
 *
 * Rotation is never sequenced: every navigation state maps to one
 * deterministic target orientation and the sphere eases toward the latest
 * target each frame. Rapid input therefore cannot produce conflicting
 * rotations — it simply retargets.
 */
import * as THREE from 'three';

const R = 10;
const UP = new THREE.Vector3(0, 1, 0);

/**
 * Themes. `night` is the original dark full-screen scene (now unused). `archive` is the
 * homepage (index.html): a matte graphite instrument on charcoal, with every
 * letter permanently inscribed and only the route you spell lit in bronze.
 * Anything a theme leaves out falls back to DEFAULTS (the night behaviour).
 */
const DEFAULTS = {
  variant: 'night',
  additive: true,
  stars: { count: [700, 1600], color: '#c9d2f5', opacity: 0.75, size: 1 },
  dust: { color: '#9fb0ee', opacity: 0.5 },
  glowGain: 1,
  glyphWeight: 500,
  letterTilt: 0.42,      // how far letters tip from the surface toward the viewer
  inscribed: 0,          // opacity of letters that aren't on the current route (0 = hidden)
  wobble: true,          // springy shake on an invalid letter
  spring: false,         // critically damped rotation instead of plain easing
  parallax: 1,
  drawSpeed: 3.2,        // how fast a newly selected arc is traced (per second)
  litAlpha: 0.9,
  flow: 0.18,
  camera: { halfWidth: [0.56, 0.7, 0.84], look: [0.74, 0.88], focus: [-0.3, -0.27], letter: [0.084, 0.064], elev: 0.5 },
};
const THEMES = {
  night: {
    colors: {
      glyph: '#d9deec', glyphSelected: '#ffffff', glow: '#7f93ff', glowSelected: '#b4a6ff',
      ring: '#aab5dc', dot: '#93a2d6', invalid: '#e6a3c4', edge: '#6d7cb0', edgeActive: '#cdc6ff', origin: '#ffffff', trace: '#ffffff',
    },
    sphere: { base: '#05081a', lit: '#1c2647', rimA: '#6f86d8', rimB: '#8f7fc8', line: '#a9b6ff' },
    atmo: { color: '#7d8ff0', strength: 0.55 },
  },
  archive: {
    // A dark celestial object emerging into the warm, quiet page: charcoal-black
    // surface, bronze light, warm ivory inscriptions, a faint smoky haze at the edge.
    variant: 'archive',
    stars: null,
    dust: null,
    colors: {
      glyph: '#ebe3d4', glyphSelected: '#f7f3ec', glow: '#eae8e1', glowSelected: '#eae8e1',
      ring: '#b3a99c', dot: '#8f857a', invalid: '#d08a72', edge: '#c9bba8', edgeActive: '#eae8e1', origin: '#e4ddd0', trace: '#fbf9f5', // selected line = the page's beige
    },
    // Display colours, written to the screen unchanged (see raw()).
    sphere: { base: '#080808', lit: '#252220', rimA: '#a07e61', rimB: '#3f362f', line: '#7a6e62' },
    sphereRaw: true,
    // Smoky haze: darkest at the silhouette, broken up by slow-moving noise, gone well before it reads as a halo.
    atmo: { color: '#2a2725', strength: 0.22, blend: 'normal', scale: 1.7, outer: [1.55, 1.28], smoke: true },
    rings: false,           // no circles around letters
    glowBlend: 'additive',
    grain: 0.1,
    glowGain: 0,            // selection brightens the letter; no coloured glow
    glyphWeight: 300,
    letterTilt: 0.3,
    inscribed: 0.24,
    wobble: false,
    spring: true,
    parallax: 0.6,
    drawSpeed: 1.5,
    litAlpha: 0,            // the hairline hands over to the thicker ribbon once selected
    flow: 0,
    // Selected arcs: a ribbon that thickens from a hairline and flows into the letter.
    ribbon: { thinPx: 0.6, thickPx: 2.4, alpha: 0.78 },
    // Hairline opacity: next letters / later on the route / spelled / everything else.
    hairline: { front: 0.16, future: 0.07, sel: 0.1, rest: 0.045 },
    frontPulse: 0.32,       // a faint pulse flowing from the current letter toward the next ones
    camera: { halfWidth: [0.5, 0.58, 0.62], look: [0.95, 1.06], focus: [-0.47, -0.46], letter: [0.066, 0.05], elev: 0.42 },
  },
};

/** A colour the shader writes out unchanged (no sRGB → linear conversion on the way in). */
const raw = (hex) => new THREE.Color().setHex(parseInt(hex.slice(1), 16), THREE.LinearSRGBColorSpace);

const damp = (a, b, lambda, dt) => a + (b - a) * (1 - Math.exp(-lambda * dt));
const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

/* ---------- shaders ---------- */

const NOISE = /* glsl */`
  float hash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float noise(vec3 x){
    vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  float fbm(vec3 p){ float v = 0.0; float a = 0.5; for (int i = 0; i < OCTAVES; i++) { v += a * noise(p); p = p * 2.03 + 11.7; a *= 0.5; } return v; }
`;

const sphereVert = /* glsl */`
  varying vec3 vObj; varying vec3 vN; varying vec3 vW;
  void main(){
    vObj = position;
    vN = normalize(mat3(modelMatrix) * normal);
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const sphereFrag = /* glsl */`
  uniform vec3 uLight; uniform vec3 uBase; uniform vec3 uLit; uniform vec3 uRimA; uniform vec3 uRimB; uniform vec3 uLine; uniform float uGrain;
  varying vec3 vObj; varying vec3 vN; varying vec3 vW;
  ${NOISE}
  float etch(float d){ float w = fwidth(d); return 1.0 - smoothstep(0.0, w * 1.15, abs(d)); }
  void main(){
    vec3 n = normalize(vN);
    vec3 v = normalize(cameraPosition - vW);
    vec3 l = normalize(uLight);
    vec3 p = normalize(vObj);
    float f = fbm(p * 2.6);
    float g = fbm(p * 9.0 + f * 2.0);
    float ndl = dot(n, l);
    float diff = smoothstep(-0.35, 1.0, ndl);
    vec3 col = mix(uBase, uLit, diff);
    // Faint topographic contours: the surface reads as terrain, not plastic.
    float h = f * 11.0;
    float w = fwidth(h);
    float contour = 1.0 - smoothstep(0.0, w * 1.5, 0.5 - abs(fract(h) - 0.5));
  #ifdef ARCHIVE
    {
    // Charcoal-black, lit from the upper left; the lower part falls into shadow.
    float shade = pow(smoothstep(-0.2, 1.0, ndl), 1.6);
    vec3 c = mix(uBase, uLit, shade);
    c *= 0.88 + 0.18 * f + 0.08 * (g - 0.5);   // shadowy mineral mottling
    c *= 1.0 + uGrain * (noise(p * 420.0) - 0.5) + uGrain * 0.6 * (noise(p * 1300.0) - 0.5);

    // Faint etched construction lines in the sphere's own frame (the letter graph
    // is centred on +Z), so they turn with the letters.
    float colat = acos(clamp(p.z, -1.0, 1.0));
    float az = atan(p.y, p.x);
    float lines = 0.0;
    lines += etch(colat - 0.135) * 0.8;
    lines += etch(colat - 0.52) * 0.55;
    lines += etch(colat - 1.02);
    lines += etch(colat - 1.06) * 0.6;
    lines += etch(colat - 1.5708) * 0.7;
    float ta = (az / 6.2831853 + 0.5) * 72.0;
    float tw = fwidth(colat) / max(sin(colat), 1e-3) * 72.0 / 6.2831853;
    float td = abs(fract(ta + 0.5) - 0.5);
    float tickLine = 1.0 - smoothstep(0.0, tw * 1.1, td);
    float major = 1.0 - step(0.5, abs(mod(floor(ta + 0.5), 6.0)));
    float band = step(1.02, colat) * step(colat, 1.02 + mix(0.016, 0.04, major));
    lines += tickLine * band * mix(0.6, 1.0, major);
    lines += etch(acos(clamp(dot(p, normalize(vec3(0.21, -0.12, 1.0))), -1.0, 1.0)) - 0.79) * 0.7;
    lines += etch(asin(clamp(dot(p, normalize(vec3(0.32, -0.55, 0.77))), -1.0, 1.0))) * 0.5;
    lines += etch(asin(clamp(dot(p, normalize(vec3(-0.7, 0.18, 0.69))), -1.0, 1.0))) * 0.4;
    // Topographic contours (the "continents" of the first version), faint and warm.
    c += uLine * contour * 0.17 * (0.35 + shade);
    // Engraving catches a little warm light; in shadow it all but disappears.
    c += uLine * min(lines, 1.4) * 0.09 * (0.15 + shade);

    // Subtle bronze highlight on the lit side, and a thin bronze rim for edge definition.
    vec3 hv = normalize(l + v);
    c += uRimA * pow(max(dot(n, hv), 0.0), 14.0) * 0.07;
    float ndv = max(dot(n, v), 0.0);
    float rimMask = smoothstep(-0.3, 0.6, 0.6 * ndl + 0.6 * n.y);
    c += mix(uRimB, uRimA, rimMask) * pow(1.0 - ndv, 6.5) * (0.1 + 0.45 * rimMask);
    gl_FragColor = vec4(c, 1.0);
    return;
    }
  #endif
    col *= 0.84 + 0.24 * f + 0.08 * (g - 0.5);
    col += uLine * contour * 0.028 * (0.35 + diff);
    // Soft sheen.
    vec3 hv = normalize(l + v);
    col += vec3(0.62, 0.68, 0.95) * pow(max(dot(n, hv), 0.0), 28.0) * 0.16 * (0.7 + 0.6 * g);
    // Fresnel rim, cooler near the top and lavender toward the sides.
    float fr = pow(1.0 - max(dot(n, v), 0.0), 3.2);
    col += mix(uRimB, uRimA, smoothstep(-0.2, 0.9, n.y)) * fr * 0.85;
    gl_FragColor = vec4(col, 1.0);
  }`;

const atmoVert = /* glsl */`
  varying vec3 vN; varying vec3 vW;
  void main(){ vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const atmoFrag = /* glsl */`
  uniform vec3 uColor; uniform float uStrength; uniform vec3 uCenter; uniform float uR; uniform float uOuter; uniform float uTime;
  varying vec3 vN; varying vec3 vW;
  ${NOISE}
  void main(){
    vec3 v = normalize(cameraPosition - vW);
    float d = dot(normalize(vN), v);           // back faces: negative toward the rim
    float a = pow(smoothstep(0.0, 0.42, -d), 2.4);
  #ifdef ATMO_NORMAL
    // Smoky haze: darkest at the sphere's silhouette, fading smoothly outward.
    vec3 dir = normalize(vW - cameraPosition);
    float dist = length(cross(dir, uCenter - cameraPosition)); // ray's closest approach to the centre
    float h = 1.0 - smoothstep(uR, uR * uOuter, dist);
    float alpha = pow(h, 2.4);
  #ifdef SMOKE
    // Break the falloff up into slow drifting wisps so it reads as smoke, not a gradient ring.
    vec3 q = (vW - uCenter) * 0.32;
    float sm = fbm(q + vec3(uTime * 0.04, uTime * 0.06, 0.0));
    float sm2 = fbm(q * 2.3 - vec3(0.0, uTime * 0.05, uTime * 0.03));
    alpha *= smoothstep(0.25, 0.85, 0.55 * sm + 0.45 * sm2) * 1.6;
    alpha = mix(alpha, pow(h, 6.0), 0.35); // keep a soft, even base right at the edge
  #endif
    gl_FragColor = vec4(uColor, alpha * uStrength);
  #else
    gl_FragColor = vec4(uColor * a * uStrength, a * uStrength);
  #endif
  }`;

const edgeVert = /* glsl */`
  attribute float t; varying float vT; varying float vFacing;
  void main(){
    vec4 w = modelMatrix * vec4(position, 1.0);
    vec3 c = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    vFacing = dot(normalize(w.xyz - c), normalize(cameraPosition - w.xyz));
    vT = t;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;
const edgeFrag = /* glsl */`
  uniform vec3 uColor; uniform vec3 uActiveColor; uniform vec3 uTraceColor; uniform float uBase; uniform float uActive; uniform float uDraw; uniform float uTime; uniform float uFade;
  uniform float uLitAlpha; uniform float uFlow; uniform float uHead; uniform float uFront; uniform float uPulse;
  uniform float uGapA; uniform float uGapB;
  varying float vT; varying float vFacing;
  void main(){
    float vis = smoothstep(0.0, 0.18, vFacing) * uFade;
    float lit = uActive * (1.0 - smoothstep(uDraw - 0.02, uDraw, vT));
    float flow = 1.0 - uFlow + uFlow * sin(vT * 18.0 - uTime * 2.4);
    vec3 col = mix(uColor, uActiveColor, lit);
    // Stop just short of each letter so lines never run through the glyphs.
    float gap = smoothstep(uGapA, uGapA + 0.03, vT) * (1.0 - smoothstep(1.0 - uGapB - 0.03, 1.0 - uGapB, vT));
    vis *= gap;
    float a = mix(uBase, uLitAlpha * flow, lit) * vis;
    // A fine point of light travelling along the arc as it is traced.
    float head = uHead * uActive * exp(-pow((vT - uDraw) / 0.035, 2.0));
    col = mix(col, uTraceColor, head);
    a = max(a, head * 0.95 * vis);
    // A faint pulse flowing out from the current letter toward the next ones.
    float ph = fract(uTime * 0.42);
    a += uPulse * uFront * exp(-pow((vT - ph) / 0.07, 2.0)) * (1.0 - ph) * vis;
    if (a < 0.003) discard;
    gl_FragColor = vec4(col, a);
  }`;

// Selected arcs as a thin strip on the surface, so they can be thicker than 1px.
const ribbonVert = /* glsl */`
  attribute float t; attribute float aSide; attribute vec3 aOff;
  uniform float uWidth;
  varying float vT; varying float vFacing; varying float vSide;
  void main(){
    vec3 pos = position + aOff * aSide * uWidth * 0.5;
    vec4 w = modelMatrix * vec4(pos, 1.0);
    vec3 c = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    vFacing = dot(normalize(w.xyz - c), normalize(cameraPosition - w.xyz));
    vT = t; vSide = aSide;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;
const ribbonFrag = /* glsl */`
  uniform vec3 uColor; uniform vec3 uTraceColor;
  uniform float uActive; uniform float uDraw; uniform float uFade; uniform float uAlpha; uniform float uHead;
  uniform float uGapA; uniform float uGapB;
  varying float vT; varying float vFacing; varying float vSide;
  void main(){
    float vis = smoothstep(0.0, 0.18, vFacing) * uFade;
    vis *= smoothstep(uGapA, uGapA + 0.03, vT) * (1.0 - smoothstep(1.0 - uGapB - 0.03, 1.0 - uGapB, vT));
    float drawn = 1.0 - smoothstep(uDraw - 0.015, uDraw, vT);
    float edge = 1.0 - smoothstep(0.45, 1.0, abs(vSide));
    float head = uHead * exp(-pow((vT - uDraw) / 0.05, 2.0)) * drawn;
    float a = uAlpha * drawn * edge * uActive * vis;
    a = max(a, head * 0.9 * edge * vis);
    if (a < 0.003) discard;
    gl_FragColor = vec4(mix(uColor, uTraceColor, head), a);
  }`;

const dustVert = /* glsl */`
  attribute float aSize; attribute float aPhase; uniform float uTime; uniform float uPx; uniform float uFade;
  varying float vA;
  void main(){
    vec4 w = modelMatrix * vec4(position, 1.0);
    vec3 c = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    float facing = dot(normalize(w.xyz - c), normalize(cameraPosition - w.xyz));
    vA = smoothstep(0.0, 0.3, facing) * (0.55 + 0.45 * sin(uTime * 0.7 + aPhase)) * uFade;
    vec4 mv = viewMatrix * w;
    gl_PointSize = aSize * uPx * (30.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }`;
const starVert = /* glsl */`
  attribute float aSize; attribute float aPhase; uniform float uTime; uniform float uPx;
  varying float vA;
  void main(){
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vA = 0.45 + 0.55 * (0.5 + 0.5 * sin(uTime * (0.4 + fract(aPhase) * 0.9) + aPhase * 6.28));
    gl_PointSize = aSize * uPx;
    gl_Position = projectionMatrix * mv;
  }`;
const pointFrag = /* glsl */`
  uniform vec3 uColor; uniform float uOpacity; varying float vA;
  void main(){
    vec2 d = gl_PointCoord - 0.5; float r = length(d);
    float a = smoothstep(0.5, 0.0, r); a *= a;
    if (a * vA < 0.004) discard;
    gl_FragColor = vec4(uColor, a * vA * uOpacity);
  }`;

/* ---------- textures ---------- */

function canvasTexture(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

function glyphTexture(letter, font, anisotropy, weight = 500) {
  const tex = canvasTexture(256, (ctx, s) => {
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.font = `${weight} 168px ${font}`;
    const m = ctx.measureText(letter);
    const h = (m.actualBoundingBoxAscent || 120) - (m.actualBoundingBoxDescent || 0);
    ctx.fillText(letter, s / 2, s / 2 + h / 2);
  });
  tex.anisotropy = anisotropy;
  return tex;
}

/* ---------- scene ---------- */

export class SphereScene {
  constructor({ canvas, graph, reducedMotion, coarse, font, theme = 'night', onPick, onHoverChange, onContextLost, onLayout }) {
    this.canvas = canvas;
    this.theme = { ...DEFAULTS, ...(THEMES[theme] || THEMES.night) };
    this.archive = this.theme.variant === 'archive';
    this.onLayout = onLayout;
    this.angVel = new THREE.Vector3();
    this.colors = Object.fromEntries(Object.entries(this.theme.colors).map(([k, v]) => [k, new THREE.Color(v)]));
    // Line shaders write colours out unconverted; give them display values when the theme asks.
    this.lineColors = Object.fromEntries(['edge', 'edgeActive', 'trace'].map((k) =>
      [k, this.theme.sphereRaw ? raw(this.theme.colors[k]) : this.colors[k]]));
    this.view = { w: 1, h: 1, left: 0, top: 0 };
    this.graph = graph;
    this.reduced = reducedMotion;
    this.coarse = coarse;
    this.onPick = onPick;
    this.onHoverChange = onHoverChange;
    this.small = Math.min(canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight) < 700;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.small ? 1.75 : 2));
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer = renderer;

    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.stop(); onContextLost?.(); }, false);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 600);
    this.rig = new THREE.Group();           // translation only (sinks for sections)
    this.sphereGroup = new THREE.Group();   // rotation only
    this.rig.add(this.sphereGroup);
    this.scene.add(this.rig);

    this.qBase = new THREE.Quaternion();
    this.qTarget = new THREE.Quaternion();
    this.qWorld = new THREE.Quaternion();
    this.pointer = { x: 0, y: 0, tx: 0, ty: 0 };
    this.wobble = { x: 0, v: 0 };
    this.mode = { value: 0, target: 0 };   // 0 = hub, 1 = section
    this.intro = { value: this.reduced ? 1 : 0 };
    this.time = 0;
    this.hovered = null;
    this.focusDir = new THREE.Vector3(0, 0.6, 0.8).normalize();

    this.#buildSphere();
    if (this.theme.stars) this.#buildStars();
    this.baseLight = this.sphereMat.uniforms.uLight.value.clone();
    this.#buildGraph(font);

    this.#bindPointer();
    this.resize();
    this.qBase.copy(this.qTarget);
    this._resizeHandler = () => this.resize();
    window.addEventListener('resize', this._resizeHandler);
    this.clock = new THREE.Clock();
  }

  /* ----- construction ----- */

  #buildSphere() {
    const seg = this.small ? 96 : 160;
    const sc = (hex) => (this.theme.sphereRaw ? raw(hex) : new THREE.Color(hex));
    const mat = new THREE.ShaderMaterial({
      vertexShader: sphereVert,
      fragmentShader: sphereFrag,
      defines: { OCTAVES: this.small ? 3 : 5, ...(this.archive ? { ARCHIVE: 1 } : {}) },
      uniforms: {
        uLight: { value: new THREE.Vector3(-0.55, 0.95, 0.45) },
        uBase: { value: sc(this.theme.sphere.base) },
        uLit: { value: sc(this.theme.sphere.lit) },
        uRimA: { value: sc(this.theme.sphere.rimA) },
        uRimB: { value: sc(this.theme.sphere.rimB) },
        uLine: { value: sc(this.theme.sphere.line) },
        uGrain: { value: this.theme.grain || 0 },
      },
    });
    this.sphere = new THREE.Mesh(new THREE.SphereGeometry(R, seg, seg / 2), mat);
    this.sphereGroup.add(this.sphere);

    this.atmoMat = new THREE.ShaderMaterial({
      vertexShader: atmoVert,
      fragmentShader: atmoFrag,
      defines: {
        OCTAVES: 4,
        ...(this.theme.atmo.blend === 'normal' ? { ATMO_NORMAL: 1 } : {}),
        ...(this.theme.atmo.smoke ? { SMOKE: 1 } : {}),
      },
      uniforms: {
        uColor: { value: new THREE.Color(this.theme.atmo.color) }, uStrength: { value: this.theme.atmo.strength },
        uCenter: { value: new THREE.Vector3() }, uR: { value: R }, uTime: { value: 0 }, uOuter: { value: this.theme.atmo.outer?.[1] || this.theme.atmo.scale || 1.09 },
      },
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      blending: this.theme.atmo.blend === 'normal' ? THREE.NormalBlending : THREE.AdditiveBlending,
    });
    const atmo = new THREE.Mesh(new THREE.SphereGeometry(R * (this.theme.atmo.scale || 1.09), 96, 48), this.atmoMat);
    this.rig.add(atmo);

    this.sphereMat = mat;
    // Surface motes: tiny lights on the sphere, rotating with it.
    if (!this.theme.dust) return;
    const count = this.small ? 260 : 620;
    const pos = new Float32Array(count * 3), size = new Float32Array(count), phase = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
      const r = R * 1.002;
      pos.set([r * s * Math.cos(th), r * s * Math.sin(th), r * u], i * 3);
      size[i] = 0.6 + Math.random() * Math.random() * 2.2;
      phase[i] = Math.random() * 10;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    this.dustMat = new THREE.ShaderMaterial({
      vertexShader: dustVert,
      fragmentShader: pointFrag,
      uniforms: { uTime: { value: 0 }, uPx: { value: 1 }, uColor: { value: new THREE.Color(this.theme.dust.color) }, uOpacity: { value: this.theme.dust.opacity }, uFade: { value: 1 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const dust = new THREE.Points(geo, this.dustMat);
    dust.renderOrder = 2;
    this.sphereGroup.add(dust);
  }

  #buildStars() {
    const st = this.theme.stars;
    const count = st.count[this.small ? 0 : 1];
    const pos = new Float32Array(count * 3), size = new Float32Array(count), phase = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const x = (Math.random() - 0.5) * 360, y = (Math.random() - 0.35) * 220, z = -40 - Math.random() * 200;
      pos.set([x, y, z], i * 3);
      size[i] = (Math.random() < 0.06 ? 2.6 + Math.random() * 1.6 : 0.8 + Math.random() * 1.4) * st.size;
      phase[i] = Math.random() * 10;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    this.starMat = new THREE.ShaderMaterial({
      vertexShader: starVert,
      fragmentShader: pointFrag,
      uniforms: { uTime: { value: 0 }, uPx: { value: 1 }, uColor: { value: new THREE.Color(st.color) }, uOpacity: { value: st.opacity } },
      transparent: true,
      depthWrite: false,
    });
    this.stars = new THREE.Points(geo, this.starMat);
    this.stars.renderOrder = -1;
    this.scene.add(this.stars);
  }

  #buildGraph(font) {
    const aniso = this.renderer.capabilities.getMaxAnisotropy();
    const plane = new THREE.PlaneGeometry(1, 1);
    const ringTex = canvasTexture(256, (ctx, s) => {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 5;
      ctx.beginPath(); ctx.arc(s / 2, s / 2, s * 0.44, 0, Math.PI * 2); ctx.stroke();
    });
    ringTex.anisotropy = aniso;
    const glowTex = canvasTexture(128, (ctx, s) => {
      const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.22, 'rgba(255,255,255,0.55)');
      g.addColorStop(0.55, 'rgba(255,255,255,0.12)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
    });
    const dotTex = canvasTexture(64, (ctx, s) => {
      const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.35, 'rgba(255,255,255,0.8)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
    });
    const glyphCache = new Map();
    const glyph = (L) => { if (!glyphCache.has(L)) glyphCache.set(L, glyphTexture(L, font, aniso, this.theme.glyphWeight)); return glyphCache.get(L); };

    const mat = (map, blending = THREE.NormalBlending) =>
      new THREE.MeshBasicMaterial({ map, transparent: true, depthTest: false, depthWrite: false, opacity: 0, blending });

    this.letterSize = R * (this.small ? 0.078 : 0.066);
    this.nodes = this.graph.nodes.map((node) => {
      const group = new THREE.Group();
      const glow = new THREE.Mesh(plane, mat(glowTex, this.theme.glowBlend === 'normal' ? THREE.NormalBlending : THREE.AdditiveBlending));
      const dot = new THREE.Mesh(plane, mat(dotTex));
      const ring = new THREE.Mesh(plane, mat(ringTex));
      const text = node.letter ? new THREE.Mesh(plane, mat(glyph(node.letter))) : null;
      glow.renderOrder = 10; dot.renderOrder = 11; ring.renderOrder = 12;
      group.add(glow, dot, ring);
      if (text) { text.renderOrder = 13; group.add(text); }
      this.scene.add(group);
      return {
        node, group, glow, dot, ring, text,
        local: new THREE.Vector3(...node.position),
        world: new THREE.Vector3(),
        normal: new THREE.Vector3(),
        facing: 0,
        // animated values and their targets
        a: { letter: 0, sel: 0, current: 0, ring: 0, dot: 0.3, hover: 0, flash: 0, err: 0 },
        t: { letter: 0, sel: 0, current: 0, ring: 0, dot: 0.3 },
        screen: { x: 0, y: 0, r: 0, ok: false },
      };
    });
    this.nodeByGraph = new Map(this.nodes.map((o) => [o.node, o]));

    // Arcs between parent and child, following great circles just above the surface.
    this.edges = this.graph.edges.map(({ from, to }) => {
      const a = new THREE.Vector3(...from.position), b = new THREE.Vector3(...to.position);
      const N = 20, pts = new Float32Array((N + 1) * 3), ts = new Float32Array(N + 1);
      const angle = a.angleTo(b);
      for (let i = 0; i <= N; i++) {
        const s = i / N;
        // slerp between unit vectors
        const p = a.clone().multiplyScalar(Math.sin((1 - s) * angle)).add(b.clone().multiplyScalar(Math.sin(s * angle))).divideScalar(Math.sin(angle));
        p.multiplyScalar(R * 1.0015);
        pts.set([p.x, p.y, p.z], i * 3);
        ts[i] = s;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
      geo.setAttribute('t', new THREE.BufferAttribute(ts, 1));
      const material = new THREE.ShaderMaterial({
        vertexShader: edgeVert,
        fragmentShader: edgeFrag,
        uniforms: {
          uColor: { value: this.lineColors.edge }, uActiveColor: { value: this.lineColors.edgeActive }, uTraceColor: { value: this.lineColors.trace },
          uBase: { value: 0.2 }, uActive: { value: 0 }, uDraw: { value: 1 }, uTime: { value: 0 }, uFade: { value: 1 },
          uLitAlpha: { value: this.theme.litAlpha }, uFlow: { value: this.theme.flow }, uHead: { value: 0 },
          uFront: { value: 0 }, uPulse: { value: this.theme.frontPulse || 0 }, uGapA: { value: 0 }, uGapB: { value: 0 },
        },
        transparent: true,
        depthTest: false,
        depthWrite: false,
      });
      const line = new THREE.Line(geo, material);
      line.renderOrder = 5;
      this.sphereGroup.add(line);
      const ribbon = this.theme.ribbon ? this.#buildRibbon(pts, ts) : null;
      return { from, to, line, material, ribbon, len: angle * R, base: 0.2, baseTarget: 0.2, active: 0, activeTarget: 0, draw: 1, head: 0, front: 0, frontTarget: 0 };
    });
  }

  /** A strip along an arc's points, widened in the vertex shader (width is set per frame). */
  #buildRibbon(pts, ts) {
    const n = ts.length;
    const pos = new Float32Array(n * 2 * 3), off = new Float32Array(n * 2 * 3), side = new Float32Array(n * 2), tt = new Float32Array(n * 2);
    const P = (i) => new THREE.Vector3(pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]);
    for (let i = 0; i < n; i++) {
      const p = P(i);
      const tangent = P(Math.min(n - 1, i + 1)).sub(P(Math.max(0, i - 1)));
      const sideVec = p.clone().normalize().cross(tangent).normalize();
      for (let k = 0; k < 2; k++) {
        const j = i * 2 + k;
        pos.set([p.x, p.y, p.z], j * 3);
        off.set([sideVec.x, sideVec.y, sideVec.z], j * 3);
        side[j] = k ? 1 : -1;
        tt[j] = ts[i];
      }
    }
    const index = [];
    for (let i = 0; i < n - 1; i++) { const a = i * 2; index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aOff', new THREE.BufferAttribute(off, 3));
    geo.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
    geo.setAttribute('t', new THREE.BufferAttribute(tt, 1));
    geo.setIndex(index);
    const material = new THREE.ShaderMaterial({
      vertexShader: ribbonVert,
      fragmentShader: ribbonFrag,
      uniforms: {
        uColor: { value: this.lineColors.edgeActive }, uTraceColor: { value: this.lineColors.trace },
        uActive: { value: 0 }, uDraw: { value: 1 }, uFade: { value: 1 }, uAlpha: { value: this.theme.ribbon.alpha },
        uHead: { value: 0 }, uWidth: { value: 0.01 }, uGapA: { value: 0 }, uGapB: { value: 0 },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, material);
    mesh.renderOrder = 6;
    this.sphereGroup.add(mesh);
    return { mesh, material };
  }

  /* ----- layout ----- */

  resize() {
    // Size to the canvas's own box so the scene works full-screen or inside a page section.
    const w = this.canvas.clientWidth || window.innerWidth, h = this.canvas.clientHeight || window.innerHeight;
    this.view.w = w; this.view.h = h;
    this.small = Math.min(w, h) < 700;
    this.renderer.setSize(w, h, false);
    const aspect = w / h;
    const cam = this.camera;
    cam.aspect = aspect;
    cam.fov = aspect < 0.75 ? 40 : 30;
    // Visible half-width at the sphere front: wide screens see a broad dome,
    // portrait screens zoom in so the letter ring still fills the width.
    const cfg = this.theme.camera;
    const portrait = aspect < 0.75;
    const halfWidth = R * cfg.halfWidth[portrait ? 0 : aspect < 1.2 ? 1 : 2];
    const tanH = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * aspect;
    const dist = halfWidth / tanH;
    // Camera sits low and looks across the top of the dome.
    const elev = cfg.elev;
    this.camBase = new THREE.Vector3(0, Math.sin(elev) * (R + dist * 0.55) + R * 0.12, Math.cos(elev) * R + dist);
    this.lookBase = new THREE.Vector3(0, R * cfg.look[portrait ? 0 : 1], 0);
    cam.position.copy(this.camBase);
    cam.lookAt(this.lookBase);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();

    // The "readable active position": where a ray slightly below screen centre meets the sphere.
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(0, cfg.focus[portrait ? 0 : 1]), cam);
    const hit = new THREE.Vector3();
    const sphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), R);
    if (ray.ray.intersectSphere(sphere, hit)) this.focusDir.copy(hit).normalize();
    const focusDist = cam.position.distanceTo(hit.lengthSq() ? hit : this.lookBase);
    this.pxPerUnit = h / (2 * focusDist * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)));

    const px = this.renderer.getPixelRatio();
    if (this.starMat) this.starMat.uniforms.uPx.value = px;
    if (this.dustMat) this.dustMat.uniforms.uPx.value = px;
    this.letterSize = R * cfg.letter[portrait ? 0 : 1];
    // Narrow screens show the sphere smaller, so the haze reaches further to keep the same feel.
    if (this.theme.atmo.outer) this.atmoMat.uniforms.uOuter.value = this.theme.atmo.outer[portrait ? 0 : 1];

    // Screen row of the sphere's top edge, so the page can place text just above it.
    let lo = -1, hi = 1;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      ray.setFromCamera(new THREE.Vector2(0, mid), cam);
      if (ray.ray.intersectsSphere(sphere)) lo = mid; else hi = mid;
    }
    this.horizonY = ((1 - lo) / 2) * h;
    this.onLayout?.({ horizonY: this.horizonY, width: w, height: h });
    if (this.lastState) this.setState(this.lastState);
  }

  /* ----- state ----- */

  setState(state) {
    this.lastState = state;
    const current = state.node;
    const selected = new Set(state.path);
    const frontier = new Set(current.children);
    const isUnder = (n) => { for (let p = n.parent; p; p = p.parent) if (p === current) return true; return false; };

    for (const o of this.nodes) {
      const n = o.node;
      const t = o.t;
      if (n.depth === 0) {
        // origin node: the hub. Bright at rest, a quiet anchor once you set off.
        t.letter = 0; t.sel = state.isRoot ? 0.65 : 0.35; t.current = 0; t.ring = state.isRoot ? 0.5 : 0.28; t.dot = 0.9;
        continue;
      }
      const isSel = selected.has(n), isFront = frontier.has(n), isFuture = !isSel && !isFront && isUnder(n);
      // Archive: every letter is always inscribed; the route and the next letters are lit.
      t.letter = isSel || isFront ? 1 : this.archive ? (isFuture ? 0.3 : this.theme.inscribed) : 0;
      t.sel = isSel ? 1 : 0;
      t.current = n === current ? 1 : 0;
      t.ring = isFront ? 1 : 0;
      t.dot = isSel || isFront || this.archive ? 0 : isFuture ? 0.55 : 0.16;
    }

    for (const e of this.edges) {
      const toSel = selected.has(e.to);
      const toFront = frontier.has(e.to);
      const toFuture = !toSel && !toFront && isUnder(e.to);
      if (toSel && e.activeTarget === 0) e.draw = this.reduced ? 1 : 0; // draw the new segment on
      e.activeTarget = toSel ? 1 : 0;
      const hl = this.theme.hairline;
      e.baseTarget = hl
        ? (toFront ? hl.front : toFuture ? hl.future : toSel ? hl.sel : hl.rest)
        : (toFront ? 0.42 : toFuture ? 0.2 : toSel ? 0.3 : 0.06);
      e.frontTarget = toFront ? 1 : 0;
    }

    this.qTarget.copy(this.#targetOrientation(current));
    if (this.reduced) this.qBase.copy(this.qTarget);
  }

  /**
   * Orientation that brings the next letters to the focus point, with the
   * direction of travel pointing screen-right so the spelled word reads
   * left-to-right along the surface.
   */
  #targetOrientation(current) {
    const v = (n) => new THREE.Vector3(...n.position);
    let focus, travel;
    if (current.depth === 0) {
      focus = v(current);
      travel = new THREE.Vector3(1, 0, 0);
    } else if (current.children.length) {
      const centroid = current.children.reduce((s, c) => s.add(v(c)), new THREE.Vector3()).normalize();
      const here = v(current);
      focus = here.clone().multiplyScalar(0.42).add(centroid.clone().multiplyScalar(0.58)).normalize();
      travel = centroid.clone().sub(here);
    } else {
      focus = v(current);
      travel = v(current).sub(v(current.parent));
    }
    const tangent = (n, d) => d.clone().sub(n.clone().multiplyScalar(d.dot(n))).normalize();
    const lt = tangent(focus, travel);
    const local = new THREE.Matrix4().makeBasis(focus, lt, focus.clone().cross(lt));
    const a = this.focusDir;
    const right = UP.clone().cross(a).normalize();
    const world = new THREE.Matrix4().makeBasis(a, right, a.clone().cross(right));
    const m = world.multiply(local.transpose());
    return new THREE.Quaternion().setFromRotationMatrix(m);
  }

  setMode(mode, instant = false) {
    this.mode.target = mode === 'section' ? 1 : 0;
    if (instant || this.reduced) this.mode.value = this.mode.target;
  }

  /** Subtle feedback for a letter that doesn't continue any path. */
  flashInvalid(letter) {
    if (!this.reduced && this.theme.wobble) this.wobble.v += 1.6;
    for (const o of this.nodes) if (o.node.letter === letter && o.t.letter === 0) o.a.err = 1;
    const cur = this.nodeByGraph.get(this.lastState?.node);
    if (cur) cur.a.err = 1;
  }

  /** Completion: light the spelled path from first letter to last. */
  celebrate(path) {
    path.forEach((n, i) => {
      const o = this.nodeByGraph.get(n);
      if (!o) return;
      if (this.reduced) { o.a.flash = 1; return; }
      setTimeout(() => { o.a.flash = 1; }, i * 55);
    });
  }

  /* ----- input ----- */

  #bindPointer() {
    const c = this.canvas;
    this._onMove = (e) => {
      if (e.pointerType === 'mouse') {
        const r = c.getBoundingClientRect();
        this.pointer.tx = Math.max(-1, Math.min(1, ((e.clientX - r.left) / (r.width || 1)) * 2 - 1));
        this.pointer.ty = Math.max(-1, Math.min(1, ((e.clientY - r.top) / (r.height || 1)) * 2 - 1));
      }
      if (e.target !== c || e.pointerType !== 'mouse') return;
      const hit = this.pick(e.clientX, e.clientY);
      if (hit !== this.hovered) {
        this.hovered = hit;
        c.style.cursor = hit ? 'pointer' : '';
        this.onHoverChange?.(hit?.node || null);
      }
    };
    this._onLeave = () => { this.pointer.tx = 0; this.pointer.ty = 0; if (this.hovered) { this.hovered = null; c.style.cursor = ''; } };
    let down = null;
    this._onDown = (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; };
    this._onUp = (e) => {
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      const long = performance.now() - down.t > 700;
      down = null;
      if (moved > 10 || long) return;
      const hit = this.pick(e.clientX, e.clientY);
      if (hit) this.onPick?.(hit.node);
    };
    window.addEventListener('pointermove', this._onMove, { passive: true });
    document.addEventListener('pointerleave', this._onLeave);
    c.addEventListener('pointerdown', this._onDown);
    c.addEventListener('pointerup', this._onUp);
  }

  /** Nearest interactive node under a screen point (generous radius on touch). */
  pick(clientX, clientY) {
    if (this.mode.value > 0.2 || !this.lastState) return null;
    // Node screen positions are canvas-local; convert from viewport coordinates.
    const r = this.canvas.getBoundingClientRect();
    const x = clientX - r.left, y = clientY - r.top;
    let best = null, bestD = Infinity;
    const minR = this.coarse ? 30 : 20;
    for (const o of this.nodes) {
      // Only the spelled route and the next letters are clickable (inscribed letters are not).
      const interactive = o.t.letter >= 1 || (o.node.depth === 0 && !this.lastState.isRoot);
      if (!interactive || !o.screen.ok || o.facing < 0.12) continue;
      const d = Math.hypot(o.screen.x - x, o.screen.y - y);
      const r = Math.max(minR, o.screen.r * 0.8);
      if (d < r && d < bestD) { best = o; bestD = d; }
    }
    return best;
  }

  /* ----- loop ----- */

  start() {
    if (this.running) return;
    this.running = true;
    this.clock.start();
    const loop = () => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      if (document.hidden) return;
      this.#frame(Math.min(this.clock.getDelta(), 0.05));
    };
    loop();
  }

  stop() { this.running = false; cancelAnimationFrame(this.raf); }

  #frame(dt) {
    const reduced = this.reduced;
    this.time += reduced ? 0 : dt;
    const time = this.time;

    // Intro: the sphere rises from below on first load.
    this.intro.value = reduced ? 1 : damp(this.intro.value, 1, 1.6, dt);
    const intro = this.intro.value;

    // Mode (hub ↔ section): the sphere sinks and the camera glides forward.
    this.mode.value = reduced ? this.mode.target : damp(this.mode.value, this.mode.target, 2.6, dt);
    const m = this.mode.value;
    const ease = m * m * (3 - 2 * m);
    this.rig.position.y = -R * 0.55 * ease - R * 0.35 * (1 - intro) * (1 - intro);

    // Pointer parallax and organic response.
    const p = this.pointer;
    p.x = damp(p.x, reduced ? 0 : p.tx, 2.2, dt);
    p.y = damp(p.y, reduced ? 0 : p.ty, 2.2, dt);
    const w = this.wobble;
    w.v += (-90 * w.x - 9 * w.v) * dt;
    w.x += w.v * dt;

    const cam = this.camera;
    const par = this.theme.parallax;
    cam.position.set(this.camBase.x + p.x * 0.5 * par, this.camBase.y - p.y * 0.3 * par + ease * 1.5, this.camBase.z - ease * 7);
    if (this.archive) {
      // The light shifts very slightly with the pointer.
      this.sphereMat.uniforms.uLight.value.set(this.baseLight.x + p.x * 0.14, this.baseLight.y - p.y * 0.08, this.baseLight.z);
    }
    cam.lookAt(this.lookBase.x, this.lookBase.y - ease * 2, this.lookBase.z);

    // Rotation: ease toward the latest target. Never queued, so input can't conflict.
    if (!reduced) {
      if (this.theme.spring) this.#springRotate(dt);
      else this.qBase.slerp(this.qTarget, 1 - Math.exp(-3.4 * dt));
    }
    const breathe = reduced ? 0 : Math.sin(time * 0.35) * 0.006;
    const tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler((p.y * 0.045 + breathe) * par, (p.x * 0.07 + w.x * 0.05) * par, 0, 'XYZ'));
    this.qWorld.copy(tilt).multiply(this.qBase);
    this.sphereGroup.quaternion.copy(this.qWorld);
    this.rig.updateMatrixWorld(true);
    cam.updateMatrixWorld();
    this.atmoMat.uniforms.uCenter.value.copy(this.rig.position);
    this.atmoMat.uniforms.uTime.value = time;

    if (this.stars) {
      this.starMat.uniforms.uTime.value = time;
      this.stars.position.set(-p.x * 1.5, p.y * 1 + ease * 4, 0);
    }
    if (this.dustMat) this.dustMat.uniforms.uTime.value = time;

    const graphFade = (1 - ease) * smooth(0.45, 1, intro);
    if (this.dustMat) this.dustMat.uniforms.uFade.value = 0.4 + 0.6 * (1 - ease);

    for (const e of this.edges) {
      e.base = damp(e.base, e.baseTarget, 5, dt);
      e.active = damp(e.active, e.activeTarget, e.activeTarget ? 10 : 5, dt);
      const drawing = e.draw < 1;
      e.draw = reduced ? 1 : Math.min(1, e.draw + dt * this.theme.drawSpeed);
      // The trace point shows while the arc is drawn, then fades.
      e.head = this.archive && !reduced ? (drawing ? 1 : damp(e.head, 0, 5, dt)) : 0;
      const u = e.material.uniforms;
      u.uBase.value = e.base; u.uActive.value = e.active; u.uDraw.value = e.draw; u.uTime.value = time; u.uFade.value = graphFade;
      e.front = damp(e.front, e.frontTarget, 4, dt);
      if (e.ribbon) {
        const gA = (e.from.depth === 0 ? 0.3 : 0.62) * this.letterSize / e.len, gB = 0.62 * this.letterSize / e.len;
        u.uGapA.value = e.ribbon.material.uniforms.uGapA.value = gA;
        u.uGapB.value = e.ribbon.material.uniforms.uGapB.value = gB;
      }
      u.uFront.value = reduced ? 0 : e.front;
      if (e.ribbon) {
        // Thickens from a hairline as it is selected, flowing toward the new letter.
        const rb = this.theme.ribbon, ru = e.ribbon.material.uniforms;
        const grow = smooth(0, 1, e.active);
        ru.uWidth.value = (rb.thinPx + (rb.thickPx - rb.thinPx) * grow) / (this.pxPerUnit || 100);
        ru.uActive.value = e.active; ru.uDraw.value = e.draw; ru.uFade.value = graphFade; ru.uHead.value = e.head;
        u.uHead.value = 0; // the ribbon carries the trace instead
      } else {
        u.uHead.value = e.head;
      }
    }

    this.#updateNodes(dt, time, graphFade);
    this.renderer.render(this.scene, cam);
  }

  /**
   * Turns the sphere toward its target like a heavy, well-made mechanism:
   * accelerates smoothly, moves steadily, settles without overshoot
   * (a slightly over-damped spring on the angular error).
   */
  #springRotate(dt) {
    const k = 15, c = 2.15 * Math.sqrt(k);
    const q = this.qTarget.clone().multiply(this.qBase.clone().invert());
    if (q.w < 0) { q.x = -q.x; q.y = -q.y; q.z = -q.z; q.w = -q.w; }
    const angle = 2 * Math.acos(Math.min(1, q.w));
    const sinHalf = Math.sqrt(Math.max(0, 1 - q.w * q.w));
    const err = sinHalf > 1e-6 ? new THREE.Vector3(q.x, q.y, q.z).multiplyScalar(angle / sinHalf) : new THREE.Vector3();
    // Sub-step for stability on slow frames.
    const steps = Math.ceil(dt / (1 / 120));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      this.angVel.addScaledVector(err, k * h).addScaledVector(this.angVel, -c * h);
      const spd = this.angVel.length();
      if (spd > 1e-7) {
        const dq = new THREE.Quaternion().setFromAxisAngle(this.angVel.clone().divideScalar(spd), spd * h);
        this.qBase.premultiply(dq);
        err.addScaledVector(this.angVel, -h);
      }
    }
    this.qBase.normalize();
    if (angle < 1e-4 && this.angVel.lengthSq() < 1e-8) { this.qBase.copy(this.qTarget); this.angVel.set(0, 0, 0); }
  }

  #updateNodes(dt, time, graphFade) {
    const cam = this.camera;
    const camPos = cam.position;
    const toCam = new THREE.Vector3(), facingDir = new THREE.Vector3(), up = new THREE.Vector3(), right = new THREE.Vector3();
    const basis = new THREE.Matrix4();
    const proj = new THREE.Vector3(), proj2 = new THREE.Vector3();
    const rigPos = this.rig.position;
    const s = this.letterSize;
    const w = this.view.w, h = this.view.h;
    const C = this.colors, glowGain = this.theme.glowGain;
    const hovered = this.hovered;
    const speed = this.reduced ? 30 : 7;

    for (const o of this.nodes) {
      const a = o.a, t = o.t;
      for (const k of ['letter', 'sel', 'current', 'ring', 'dot']) a[k] = damp(a[k], t[k], speed, dt);
      a.hover = damp(a.hover, o === hovered ? 1 : 0, 12, dt);
      a.flash = damp(a.flash, 0, 2.2, dt);
      a.err = damp(a.err, 0, 3.5, dt);

      // Anchor to the rotating surface.
      o.normal.copy(o.local).applyQuaternion(this.qWorld);
      o.world.copy(o.normal).multiplyScalar(R * 1.004).add(rigPos);
      toCam.copy(camPos).sub(o.world).normalize();
      o.facing = o.normal.dot(toCam);
      const vis = smooth(0.03, 0.24, o.facing) * graphFade;

      // Lie on the surface, tipped part-way toward the viewer for legibility, kept upright.
      facingDir.copy(o.normal).lerp(toCam, this.theme.letterTilt).normalize();
      up.copy(UP).sub(facingDir.clone().multiplyScalar(UP.dot(facingDir))).normalize();
      right.crossVectors(up, facingDir);
      basis.makeBasis(right, up, facingDir);
      o.group.quaternion.setFromRotationMatrix(basis);
      o.group.position.copy(o.world);

      const pulse = t.ring ? 0.5 + 0.5 * Math.sin(time * (this.archive ? 1.1 : 2.1) + o.node.depth * 0.9 + o.node.branch) : 0;
      const hov = a.hover;
      const scale = s * (1 + hov * 0.16 + a.flash * 0.18 + a.current * 0.06);

      if (o.text) {
        o.text.scale.setScalar(scale);
        o.text.material.opacity = Math.min(1, a.letter * (0.86 + 0.14 * a.sel + 0.14 * hov)) * vis;
        o.text.material.color.copy(C.glyph).lerp(C.glyphSelected, this.archive ? a.sel : Math.max(a.sel, hov));
      }
      const ringOpacity = o.node.depth === 0 ? a.ring
        : this.archive ? a.ring * (0.14 + 0.06 * pulse) + hov * 0.3
        : a.ring * (0.28 + 0.12 * pulse) + hov * 0.35;
      o.ring.scale.setScalar(o.node.depth === 0 ? s * 0.55 : scale * 1.32);
      o.ring.material.opacity = this.theme.rings === false ? 0 : ringOpacity * vis;
      o.ring.material.color.copy(C.ring).lerp(C.invalid, a.err);

      const glowAmt = a.sel * 0.42 + a.current * 0.3 + hov * 0.22 + a.flash * 0.9 + t.ring * pulse * 0.06 + a.err * 0.25;
      o.glow.scale.setScalar(o.node.depth === 0 ? s * 2.4 : s * (2.5 + a.flash * 1.4));
      o.glow.material.opacity = Math.min(1, glowAmt * glowGain) * vis;
      o.glow.material.color.copy(C.glow).lerp(C.glowSelected, a.sel).lerp(C.invalid, a.err * 0.7);

      o.dot.scale.setScalar(o.node.depth === 0 ? s * 0.32 : s * (0.2 + a.err * 0.25));
      o.dot.material.opacity = Math.min(1, a.dot + a.err * 0.8) * vis;
      o.dot.material.color.copy(o.node.depth === 0 ? C.origin : C.dot).lerp(C.invalid, a.err);

      // Screen-space hit target for picking.
      proj.copy(o.world).project(cam);
      proj2.copy(o.world).addScaledVector(up, s * 0.5).project(cam);
      o.screen.x = (proj.x * 0.5 + 0.5) * w;
      o.screen.y = (-proj.y * 0.5 + 0.5) * h;
      o.screen.r = Math.hypot((proj2.x - proj.x) * 0.5 * w, (proj2.y - proj.y) * 0.5 * h) * 1.4;
      o.screen.ok = proj.z < 1 && vis > 0.4;
    }
  }

  dispose() {
    this.stop();
    window.removeEventListener('resize', this._resizeHandler);
    window.removeEventListener('pointermove', this._onMove);
    this.renderer.dispose();
  }
}
