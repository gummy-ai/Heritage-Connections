/* 유물과 유물 사이: site runtime. Plain ES module, no build step, no dependencies. */

const NS = 'http://www.w3.org/2000/svg';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const root = document.documentElement;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

function setProps(node, props) {
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.setAttribute('class', v);
    else if (k === 'text') node.textContent = v;
    else if (k === 'style') for (const [sk, sv2] of Object.entries(v)) node.style.setProperty(sk, String(sv2));
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  return node;
}
const kidsOf = kids => kids.flat(Infinity).filter(k => k != null && k !== false);
const el = (tag, props = {}, ...kids) => { const n = setProps(document.createElement(tag), props); n.append(...kidsOf(kids)); return n; };
const sv = (tag, props = {}, ...kids) => { const n = setProps(document.createElementNS(NS, tag), props); n.append(...kidsOf(kids)); return n; };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const pct = w => `${(w * 100).toFixed(w >= .095 ? 0 : 1)}%`;
const short = (s, n) => (s.length > n ? `${s.slice(0, n)}…` : s);
const P = (deg, r) => { const a = deg * Math.PI / 180; return [Math.cos(a) * r, Math.sin(a) * r]; };
const raf2 = fn => requestAnimationFrame(() => requestAnimationFrame(fn));
function hasBatchim(word) {
  const c = String(word).trim().slice(-1).charCodeAt(0);
  return c >= 0xac00 && c <= 0xd7a3 ? (c - 0xac00) % 28 !== 0 : false;
}
// Particle 으로 after a final consonant other than ㄹ, otherwise 로.
function ro(word) {
  const c = String(word).trim().slice(-1).charCodeAt(0);
  const jong = c >= 0xac00 && c <= 0xd7a3 ? (c - 0xac00) % 28 : 0;
  return jong && jong !== 8 ? '으로' : '로';
}
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* Vocabulary ------------------------------------------------------------ */
const FAMILIES = {
  time: { label: '시대', glyph: '時', color: 'var(--f-time)' },
  material: { label: '재질', glyph: '材', color: 'var(--f-material)' },
  pattern: { label: '문양', glyph: '紋', color: 'var(--f-pattern)' },
  class: { label: '분류', glyph: '類', color: 'var(--f-class)' },
  place: { label: '장소', glyph: '處', color: 'var(--f-place)' },
};
const REL_FAMILY = {
  '시대': 'time', '재질 1': 'material', '재질 2': 'material', '문양': 'pattern',
  '유물분류 1': 'class', '유물분류 2': 'class', '유물분류 3': 'class', '유물분류 4': 'class',
  '국적': 'place', '출토지': 'place', '출토지_상세': 'place',
};
const REL_LABEL = {
  '시대': '시대', '재질 1': '재질·대', '재질 2': '재질·세부', '문양': '문양',
  '유물분류 1': '분류·대', '유물분류 2': '분류·중', '유물분류 3': '분류·소', '유물분류 4': '분류·세부',
  '국적': '국적', '출토지': '출토지', '출토지_상세': '출토지·세부',
};
const familyOf = rel => REL_FAMILY[rel] || 'class';
const SHORT = { '신수14621': '백자 달항아리', '동원1347': '청자 상감 매병', '동원285': '백자 철화 용무늬 항아리', '신수11349': '청동 투구', '신수10147': '정화팔년명 삼족 향로' };
const HANJA_NUM = ['一', '二', '三', '四', '五', '六'];

function glyphFor(item) {
  const m = `${item.material || ''} ${item.materialDetail || ''}`;
  if (/도자|자기|청자|백자|분청/.test(m)) return '瓷';
  if (/금속|동합금|청동|은|철|금/.test(m)) return '金';
  if (/토|와질|경질|연질/.test(m)) return '土';
  if (/석|돌/.test(m)) return '石';
  if (/나무|목/.test(m)) return '木';
  if (/견|사직|비단/.test(m)) return '絹';
  if (/지|종이/.test(m)) return '紙';
  if (/옥/.test(m)) return '玉';
  if (/유리/.test(m)) return '琉';
  return '器';
}
const attrValues = (item, rel) => (item?.attributes || []).filter(a => a.relation === rel).map(a => a.value);
const eraOrNation = item => item.era || attrValues(item, '국적')[0] || '';
const metaLine = item => [eraOrNation(item), item.materialDetail || item.material].filter(Boolean).join(' · ');

/* Data ------------------------------------------------------------------ */
const store = { manifest: null, demo: null, pool: null, items: new Map(), collection: [], cutouts: {}, photos: new Map() };
const keyOf = item => item.headKey || `artifact::${item.institution || '국립중앙박물관'}::${item.id}`;
const photoFor = item => store.photos.get(keyOf(item));
const licenseLabel = l => (typeof l === 'string' ? l : l?.label || '');

async function getJSON(url) {
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}

async function load() {
  const [manifest, coll, demo, legacy, cutouts, pool] = await Promise.allSettled([
    getJSON('./assets/media/manifest.json'),
    getJSON('./assets/collection.json'),
    getJSON('./assets/recommendations.json'),
    getJSON('./assets/legacy-images.json'),
    getJSON('./assets/cutouts/cutouts.json?v=20261115-helm'),
    getJSON('./assets/recommendation-pool.json'),
  ]);
  if (manifest.status === 'fulfilled') store.manifest = manifest.value;
  if (demo.status === 'fulfilled') store.demo = demo.value;
  if (pool.status === 'fulfilled') store.pool = pool.value;
  // One table of artifact info by headKey: the stored catalog plus every pooled candidate.
  for (const c of Object.values(store.demo?.catalog || {})) store.items.set(c.headKey, { ...c });
  for (const [hk, p] of Object.entries(store.pool?.items || {})) {
    const known = store.items.get(hk);
    if (known) { known.edges = p.edges; continue; }
    store.items.set(hk, {
      id: p.id, headKey: hk, institution: hk.split('::')[1] || '', name: p.name, era: p.era,
      material: p.material, materialDetail: p.materialDetail, description: p.description,
      attributes: p.attributes.map(([relation, value]) => ({ relation, value })), edges: p.edges,
    });
  }
  if (cutouts.status === 'fulfilled') for (const c of cutouts.value.items) store.cutouts[c.id] = c;
  const seen = new Set();
  if (coll.status === 'fulfilled') {
    for (const a of coll.value.artifacts || []) {
      const key = keyOf(a);
      store.photos.set(key, { image: a.image, thumb: a.thumb || a.thumbnail || a.image, title: a.name, id: a.id, credit: a.credit || a.institution, license: a.license, sourceUrl: a.sourceUrl });
      if (!seen.has(key) && a.image) { seen.add(key); store.collection.push(a); }
    }
  }
  if (legacy.status === 'fulfilled') {
    for (const l of legacy.value) {
      const key = `artifact::${l.institution}::${l.id}`;
      store.photos.set(key, { image: l.webPath, thumb: l.thumbnailWebPath || l.webPath, title: l.title, id: l.id, credit: l.credit, license: l.license, sourceUrl: l.sourceUrl });
      if (seen.has(key)) continue;
      seen.add(key);
      const cat = store.demo?.catalog?.[l.id];
      store.collection.push({
        id: l.id, headKey: key, institution: l.institution, name: cat?.name || l.title,
        era: cat ? eraOrNation(cat) : '', material: cat?.material || '', materialDetail: cat?.materialDetail || '',
        pattern: cat ? attrValues(cat, '문양').join(', ') : '', classification: cat ? attrValues(cat, '유물분류 2')[0] || '' : '',
        kind: cat ? attrValues(cat, '유물분류 4')[0] || '' : '', image: l.webPath, thumb: l.thumbnailWebPath || l.webPath,
      });
    }
  }
}

/* Masthead -------------------------------------------------------------- */
function initMasthead() {
  const head = $('#masthead');
  const toggle = $('#nav-toggle');
  const nav = $('#site-nav');
  const onScroll = () => head.classList.toggle('scrolled', scrollY > 24);
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  const setOpen = open => {
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? '메뉴 닫기' : '메뉴 열기');
    nav.classList.toggle('open', open);
  };
  toggle.addEventListener('click', () => setOpen(toggle.getAttribute('aria-expanded') !== 'true'));
  $$('a', nav).forEach(a => a.addEventListener('click', () => setOpen(false)));
  const io = new IntersectionObserver(entries => entries.forEach(e => {
    if (e.isIntersecting) $$('a', nav).forEach(a => a.classList.toggle('active', a.hash === `#${e.target.id}`));
  }), { rootMargin: '-45% 0px -50% 0px' });
  ['story', 'discover', 'collection', 'research'].forEach(id => io.observe(document.getElementById(id)));
}

/* Gold dust: additive sprites drifting upward ---------------------------- */
class Dust {
  constructor(canvas, opts = {}) {
    this.c = canvas;
    this.g = canvas.getContext('2d');
    this.o = { density: 1, max: 150, rise: 1, size: [0.5, 1.9], tint: [240, 214, 150], ...opts };
    this.sprite = this.makeSprite();
    this.pointer = { x: 0, y: 0, tx: 0, ty: 0 };
    this.running = false;
    this.visible = false;
    this.ps = [];
    new ResizeObserver(() => this.resize()).observe(canvas);
    new IntersectionObserver(([e]) => { this.visible = e.isIntersecting; this.sync(); }).observe(canvas);
    document.addEventListener('visibilitychange', () => this.sync());
    opts.pointerTarget?.addEventListener('pointermove', e => {
      const r = this.c.getBoundingClientRect();
      this.pointer.tx = (e.clientX - r.left) / r.width - .5;
      this.pointer.ty = (e.clientY - r.top) / r.height - .5;
    });
  }
  makeSprite() {
    const s = document.createElement('canvas');
    s.width = s.height = 32;
    const g = s.getContext('2d');
    const [r, gg, b] = this.o.tint;
    const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, 'rgba(255, 251, 238, 1)');
    grad.addColorStop(.22, `rgba(${r}, ${gg}, ${b}, .8)`);
    grad.addColorStop(1, `rgba(${r}, ${gg}, ${b}, 0)`);
    g.fillStyle = grad;
    g.fillRect(0, 0, 32, 32);
    return s;
  }
  resize() {
    const w = this.c.clientWidth;
    const h = this.c.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.w = w;
    this.h = h;
    this.c.width = Math.round(w * dpr);
    this.c.height = Math.round(h * dpr);
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = Math.min(this.o.max, Math.round((w * h) / 11000 * this.o.density));
    this.ps = Array.from({ length: n }, () => this.spawn(true));
    this.draw(0);
  }
  spawn(anywhere) {
    const [a, b] = this.o.size;
    return {
      x: Math.random() * this.w, y: anywhere ? Math.random() * this.h : this.h + 8,
      z: .3 + Math.random() * .7, r: a + Math.random() * (b - a),
      vy: (.12 + Math.random() * .42) * this.o.rise, ph: Math.random() * 6.283,
      f: .25 + Math.random() * .7, tw: .5 + Math.random() * 1.6, a: .22 + Math.random() * .6,
    };
  }
  sync() {
    const go = this.visible && !document.hidden && !reduced;
    if (go && !this.running) {
      this.running = true;
      this.last = performance.now();
      requestAnimationFrame(t => this.loop(t));
    } else if (!go) this.running = false;
  }
  loop(t) {
    if (!this.running) return;
    const k = Math.min(3, (t - this.last) / 16.7);
    this.last = t;
    const s = t / 1000;
    this.pointer.x += (this.pointer.tx - this.pointer.x) * .04;
    this.pointer.y += (this.pointer.ty - this.pointer.y) * .04;
    for (const p of this.ps) {
      p.y -= p.vy * k * (.6 + p.z);
      p.x += Math.sin(s * p.f + p.ph) * .16 * k;
      if (p.y < -8) Object.assign(p, this.spawn(false));
      if (p.x < -8) p.x = this.w + 8;
      if (p.x > this.w + 8) p.x = -8;
    }
    this.draw(s);
    requestAnimationFrame(tt => this.loop(tt));
  }
  draw(s) {
    const g = this.g;
    g.clearRect(0, 0, this.w, this.h);
    g.globalCompositeOperation = 'lighter';
    for (const p of this.ps) {
      g.globalAlpha = p.a * (.55 + .45 * Math.sin(s * p.tw + p.ph));
      const size = p.r * 6 * (.6 + p.z * .6);
      g.drawImage(this.sprite, p.x + this.pointer.x * 34 * p.z - size / 2, p.y + this.pointer.y * 22 * p.z - size / 2, size, size);
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }
}

/* Hero effects: lantern lights over the backdrop and an ink brush that follows the mouse.
   One knob sets the strength of the whole layer: 0 turns it off, 1 is the designed strength.
   Lower it if the copy ever loses legibility. */
const HERO_FX_INTENSITY = 0.85;
const hash = n => { const s = Math.sin(n * 12.9898) * 43758.5453; return s - Math.floor(s); };

class HeroFX {
  constructor(canvas, host) {
    this.c = canvas;
    this.g = canvas.getContext('2d');
    this.host = host;
    this.k = HERO_FX_INTENSITY;
    // Touch screens get the lights only; the brush needs a hovering pointer.
    this.brushOn = matchMedia('(hover: hover) and (pointer: fine)').matches;
    this.ink = document.createElement('canvas');
    this.ig = this.ink.getContext('2d');
    this.tmp = document.createElement('canvas');
    this.tg = this.tmp.getContext('2d');
    this.canBlur = 'filter' in this.tg;
    this.sprites = {
      light: HeroFX.sprite('255, 248, 228', '236, 212, 160', 64, .18),
      // Grey ink, a shade lighter than the page's ink black: reads as wash on the misty backdrop.
      ink: HeroFX.sprite('46, 45, 42', '58, 56, 52', 48, .5),
      gold: HeroFX.sprite('228, 198, 122', '214, 178, 94', 48, .4),
    };
    this.lights = [];
    this.last = null;
    this.width = 12;
    this.seed = Math.random() * 1000;
    this.travel = 0;
    this.inkUntil = 0;
    this.inkDirty = false;
    this.running = false;
    this.visible = false;
    new ResizeObserver(() => this.resize()).observe(canvas);
    new IntersectionObserver(([e]) => { this.visible = e.isIntersecting; this.sync(); }).observe(host);
    document.addEventListener('visibilitychange', () => this.sync());
    if (this.brushOn) {
      host.addEventListener('pointermove', e => this.onMove(e), { passive: true });
      host.addEventListener('pointerleave', () => { this.last = null; });
    }
  }
  static sprite(core, edge, size, solid) {
    const s = document.createElement('canvas');
    s.width = s.height = size;
    const g = s.getContext('2d');
    const h = size / 2;
    const grad = g.createRadialGradient(h, h, 0, h, h, h);
    grad.addColorStop(0, `rgba(${core}, 1)`);
    grad.addColorStop(solid, `rgba(${edge}, .7)`);
    grad.addColorStop(1, `rgba(${edge}, 0)`);
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    return s;
  }
  resize() {
    const w = this.c.clientWidth;
    const h = this.c.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.w = w;
    this.h = h;
    this.c.width = Math.round(w * dpr);
    this.c.height = Math.round(h * dpr);
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const cv of [this.ink, this.tmp]) { cv.width = w; cv.height = h; }
    if (this.canBlur) this.tg.filter = 'blur(0.4px)';
    this.wide = w >= 900;
    const count = this.wide ? clamp(Math.round((w * h) / 36000), 20, 40) : 20;
    this.lights = Array.from({ length: count }, () => this.spawnLight(true));
    this.render(performance.now());
  }
  // Where lights may glow: away from the copy (left column on wide screens, lower half on phones).
  weight(x, y) {
    return this.wide ? smooth(.28, .6, x) : smooth(.72, .32, y);
  }
  spawnLight(anywhere) {
    let x = 0;
    let y = 0;
    for (let i = 0; i < 40; i++) {
      x = Math.random();
      y = anywhere ? .06 + Math.random() * .88 : .9 + Math.random() * .08;
      if (Math.random() < .03 + .97 * this.weight(x, anywhere ? y : .5)) break;
    }
    return {
      x, y, r: 1.2 + Math.random() * 2.4, vy: .004 + Math.random() * .01,
      fx: .05 + Math.random() * .12, fy: .04 + Math.random() * .1, ph: Math.random() * 6.283,
      tw: .35 + Math.random() * 1.1, a: .2 + Math.random() * .35, born: performance.now(),
    };
  }
  onMove(e) {
    if (e.pointerType === 'touch') return;
    const r = this.c.getBoundingClientRect();
    const events = e.getCoalescedEvents?.() || [];
    for (const ev of events.length ? events : [e]) {
      const p = { x: ev.clientX - r.left, y: ev.clientY - r.top, t: ev.timeStamp };
      const last = this.last;
      if (!last) { this.last = p; this.seed = Math.random() * 1000; continue; }
      const dist = Math.hypot(p.x - last.x, p.y - last.y);
      if (dist < 1.5) continue;
      this.last = p;
      if (dist > 160) continue;
      const speed = dist / Math.max(4, p.t - last.t);
      // Slow: broad, wet, bleeding. Fast: thin, dry, broken (flying white).
      const target = 2.5 + 26 * (1 - smooth(.05, 1.5, speed));
      this.width += (target - this.width) * .3;
      this.stroke(last, p, this.width, smooth(.55, 1.6, speed));
    }
  }
  stroke(a, b, w, dry) {
    const g = this.ig;
    const k = this.k;
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const nx = -(b.y - a.y) / dist;
    const ny = (b.x - a.x) / dist;
    const wet = 1 - dry;
    const n = Math.ceil(dist / Math.max(1.2, w * .22));
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t;
      if (wet > .02) {
        const s = w * 1.55;
        g.globalAlpha = .09 * wet * k;
        g.drawImage(this.sprites.gold, x - s * .6, y - s * .6, s * 1.2, s * 1.2);
        g.globalAlpha = .2 * wet * k;
        g.drawImage(this.sprites.ink, x - s / 2, y - s / 2, s, s);
      }
      if (dry > .02) {
        const chunk = Math.floor((this.travel + dist * t) / 6);
        for (let j = 0; j < 6; j++) {
          if (hash(this.seed + j * 7.13 + chunk * 1.7) < .35) continue;
          const o = (j / 5 - .5) * w * 1.4;
          const s = Math.max(1.6, w * .35);
          g.globalAlpha = .45 * dry * k;
          g.drawImage(this.sprites.ink, x + nx * o - s / 2, y + ny * o - s / 2, s, s);
        }
      }
    }
    g.globalAlpha = 1;
    this.travel += dist;
    this.inkUntil = performance.now() + 2600;
    this.inkDirty = true;
  }
  // Ink spreading in water: a little blur every frame, then an exponential fade (~2 s to vanish).
  fadeInk(dt) {
    const g = this.ig;
    if (this.canBlur) {
      this.tg.clearRect(0, 0, this.w, this.h);
      this.tg.drawImage(this.ink, 0, 0);
      g.clearRect(0, 0, this.w, this.h);
      g.drawImage(this.tmp, 0, 0);
    }
    g.globalCompositeOperation = 'destination-out';
    g.globalAlpha = 1 - Math.pow(.972, dt / 16.7);
    g.fillRect(0, 0, this.w, this.h);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
  }
  render(t) {
    const g = this.g;
    g.clearRect(0, 0, this.w, this.h);
    if (this.k <= 0) return;
    if (t < this.inkUntil) g.drawImage(this.ink, 0, 0, this.w, this.h);
    else if (this.inkDirty) { this.ig.clearRect(0, 0, this.w, this.h); this.inkDirty = false; }
    g.globalCompositeOperation = 'lighter';
    const s = t / 1000;
    for (const p of this.lights) {
      const x = (p.x + Math.sin(s * p.fx + p.ph) * .012) * this.w;
      const y = (p.y + Math.cos(s * p.fy + p.ph) * .01) * this.h;
      const a = p.a * this.k * this.weight(x / this.w, y / this.h) * (.6 + .4 * Math.sin(s * p.tw + p.ph)) * smooth(0, 2500, t - p.born);
      if (a < .01) continue;
      const size = p.r * 14;
      g.globalAlpha = a;
      g.drawImage(this.sprites.light, x - size / 2, y - size / 2, size, size);
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }
  sync() {
    const go = this.visible && !document.hidden;
    if (go && !this.running) {
      this.running = true;
      this.prev = 0;
      requestAnimationFrame(t => this.loop(t));
    } else if (!go) this.running = false;
  }
  loop(t) {
    if (!this.running) return;
    const dt = this.prev ? Math.min(50, t - this.prev) : 16.7;
    this.prev = t;
    for (const p of this.lights) {
      p.y -= p.vy * dt / 1000;
      if (p.y < .02) Object.assign(p, this.spawnLight(false));
    }
    if (t < this.inkUntil) this.fadeInk(dt);
    this.render(t);
    requestAnimationFrame(tt => this.loop(tt));
  }
}

/* Ink-wash mountain range, drawn once per svg ------------------------------ */
function smoothPath(pts) {
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}
function inkRange(svg, seed) {
  const W = 1600;
  const H = 640;
  const rand = mulberry32(seed);
  const fid = `brush-${seed}`;
  const defs = sv('defs', {},
    sv('filter', { id: fid, x: '-5%', y: '-10%', width: '110%', height: '120%' },
      sv('feTurbulence', { type: 'fractalNoise', baseFrequency: '0.006 0.05', numOctaves: 2, seed }),
      sv('feDisplacementMap', { in: 'SourceGraphic', scale: 16, xChannelSelector: 'R', yChannelSelector: 'G' })));
  const tones = [
    ['rgba(140, 152, 160, .30)', 'rgba(140, 152, 160, 0)', '.9'],
    ['rgba(92, 102, 110, .55)', 'rgba(92, 102, 110, 0)', '.9'],
    ['rgba(40, 46, 52, .94)', 'rgba(40, 46, 52, .1)', '.95'],
    ['#121417', '#0f1012', '.55'],
  ];
  const groups = tones.map(([top, bottom, stop], i) => {
    const gid = `ink-${seed}-${i}`;
    defs.append(sv('linearGradient', { id: gid, x1: 0, y1: 0, x2: 0, y2: 1 },
      sv('stop', { offset: '0', 'stop-color': top }), sv('stop', { offset: stop, 'stop-color': bottom })));
    const base = 250 + i * 92;
    const amp = 200 - i * 38;
    const n = 6 + i * 2;
    let pts = [];
    for (let k = 0; k <= n; k++) {
      const h = amp * (.32 + rand() * .68) * (.78 + .22 * Math.sin(k * 1.9 + seed + i));
      pts.push([(k / n) * W, base - h]);
    }
    for (let pass = 0; pass < 3; pass++) {
      const next = [];
      for (let k = 0; k < pts.length - 1; k++) {
        const [x1, y1] = pts[k];
        const [x2, y2] = pts[k + 1];
        next.push([x1, y1], [(x1 + x2) / 2, (y1 + y2) / 2 + (rand() - .5) * amp * .3 / (pass + 1)]);
      }
      next.push(pts.at(-1));
      pts = next;
    }
    const ridge = smoothPath(pts);
    const g = sv('g', { class: `layer layer-${i}` });
    g.append(sv('path', { d: `${ridge} L${W},${H} L0,${H} Z`, fill: `url(#${gid})`, filter: i < 3 ? `url(#${fid})` : null }));
    if (i < 3) g.append(sv('path', { d: ridge, fill: 'none', stroke: 'rgba(236, 230, 214, .08)', 'stroke-width': 1.2, filter: `url(#${fid})` }));
    return g;
  });
  svg.replaceChildren(defs, ...groups);
  return groups;
}

/* Hero ------------------------------------------------------------------ */
function initHero() {
  const groups = inkRange($('#hero-range'), 11);
  if (reduced) return;
  new HeroFX($('#hero-fx'), $('#top'));
  const obj = $('#hero-object');
  let ticking = false;
  const update = () => {
    ticking = false;
    const y = scrollY;
    if (y > innerHeight * 1.3) return;
    groups.forEach((g, i) => { g.style.transform = `translate3d(0, ${(-y * (.03 + i * .05)).toFixed(1)}px, 0)`; });
    obj.style.translate = `0 ${(y * .14).toFixed(1)}px`;
  };
  addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
}

/* Media slots (filled when generated media lands in the manifest) --------- */
// Mounts a still (poster or image) and, motion allowed, a muted looping video above it.
// Returns the video element, the still, or null when the slot is empty.
function mountMedia(slot, spec) {
  if (!slot || !spec) return null;
  let node = null;
  const still = spec.poster || spec.image;
  if (still) {
    node = el('img', { src: still, alt: '', decoding: 'async' });
    node.addEventListener('load', () => node.classList.add('ready'), { once: true });
    slot.append(node);
  }
  if (spec.video && !reduced) {
    const holding = root.classList.contains('intro-pending');
    const v = el('video', { muted: true, loop: true, playsinline: true, autoplay: !holding, preload: 'auto' });
    v.muted = true;
    v.addEventListener('loadeddata', () => v.classList.add('ready'), { once: true });
    v.src = spec.video;
    slot.append(v);
    if (!holding) v.play().catch(() => {});
    node = v;
  }
  return node;
}
function applyMedia(m) {
  if (!m) return;
  const hero = mountMedia($('#hero-slot'), m.hero);
  if (hero) $('#top').classList.add('has-media');
  if (hero?.tagName === 'VIDEO') {
    store.heroVideo = hero;
    // Decode the loop only while the hero is on screen.
    new IntersectionObserver(([e]) => {
      if (root.classList.contains('intro-pending')) return;
      if (e.isIntersecting) hero.play().catch(() => {});
      else hero.pause();
    }).observe($('#top'));
  }
  if (mountMedia($('#vitrine-slot'), m.vitrine)) {
    const v = $('#vitrine');
    v.classList.add('has-media');
    // Stand the artifact on the case photo's lit floor (measured, see VITRINE_LIGHT).
    v.style.setProperty('--lx', `${(VITRINE_LIGHT.x * 100).toFixed(1)}%`);
    v.style.setProperty('--ly', `${(VITRINE_LIGHT.y * 100).toFixed(1)}%`);
  }
  if (m.textures?.silk) root.style.setProperty('--tex-silk', `url("${m.textures.silk}")`);
  if (m.textures?.clouds) root.style.setProperty('--tex-cloud', `url("${m.textures.clouds}")`);
}

/* Story: pinned stage with scroll-driven scene ---------------------------- */
const film = { video: null, ready: false, target: 0, pending: null };
function seekFilm(p) {
  film.target = p;
  const v = film.video;
  if (!film.ready || !v || !v.duration) return;
  const t = p * Math.max(0, v.duration - .05);
  if (v.seeking) { film.pending = t; return; }
  if (Math.abs(v.currentTime - t) > .015) v.currentTime = t;
}
function initFilm(spec) {
  if (!spec?.video) return;
  const story = $('#story');
  const slot = $('#story-slot');
  // The first frame stands in until the clip is decoded (and for good under reduced motion).
  if (spec.poster) {
    const img = el('img', { src: spec.poster, alt: '', decoding: 'async' });
    img.addEventListener('load', () => { img.classList.add('ready'); story.classList.add('has-film'); }, { once: true });
    slot.append(img);
  }
  if (reduced) return;
  const small = matchMedia('(max-width: 760px), (pointer: coarse)').matches;
  const url = small && spec.videoMobile ? spec.videoMobile : spec.video;
  const video = el('video', { muted: true, playsinline: true, preload: 'auto' });
  video.muted = true;
  slot.append(video);
  video.addEventListener('seeked', () => {
    if (film.pending == null) return;
    const t = film.pending;
    film.pending = null;
    video.currentTime = t;
  });
  const start = () => {
    // Blob URLs keep currentTime seekable even when the server ignores Range requests.
    fetch(url).then(r => { if (!r.ok) throw new Error(String(r.status)); return r.blob(); }).then(blob => {
      video.addEventListener('loadeddata', () => {
        film.video = video;
        film.ready = true;
        video.classList.add('ready');
        story.classList.add('has-film');
        seekFilm(film.target);
      }, { once: true });
      video.src = URL.createObjectURL(blob);
    }).catch(() => video.remove());
  };
  // Fetch only when the story is about to scroll into view, not on first paint.
  new IntersectionObserver(([e], obs) => {
    if (!e.isIntersecting) return;
    obs.disconnect();
    start();
  }, { rootMargin: '120% 0px' }).observe(story);
  addEventListener('touchstart', () => { video.play().then(() => video.pause()).catch(() => {}); }, { once: true, passive: true });
}

function pickStoryRecs(demo, seedId) {
  // Candidates for the story's seed in model order (seed similarity), with their attributes.
  const sp = store.pool?.seeds?.[seedId];
  const seedKeys = new Set((demo?.catalog?.[seedId]?.attributes || []).map(a => `${a.relation}|${a.value}`));
  const pool = (sp ? [...sp.candidates].sort((a, b) => b[2] - a[2] || a[1] - b[1]).map(c => c[0]) : [])
    .slice(0, 60).map(hk => store.items.get(hk)).filter(Boolean)
    .map(info => ({ ...info, sharedAttributes: info.attributes.filter(a => seedKeys.has(`${a.relation}|${a.value}`)) }));
  const sharesPattern = (r, v) => r.sharedAttributes.some(a => a.relation === '문양' && (!v || a.value === v));
  const tests = {
    time: r => r.era === '고려',
    material: r => r.materialDetail === '청자',
    pattern: r => sharesPattern(r, '매화') || sharesPattern(r),
  };
  const used = new Set();
  const out = {};
  for (const fam of ['pattern', 'time', 'material']) {
    const cands = pool.filter(r => !used.has(r.headKey) && tests[fam](r));
    const best = (fam === 'pattern' && cands.find(r => sharesPattern(r, '매화') && photoFor(r)))
      || cands.find(r => photoFor(r)) || cands[0];
    if (best) { used.add(best.headKey); out[fam] = best; }
  }
  return out;
}
function buildScene(svg, demo) {
  const seedId = '동원1347';
  const seed = demo?.catalog?.[seedId];
  const picks = demo ? pickStoryRecs(demo, seedId) : {};
  const shared = (picks.pattern?.sharedAttributes || []).filter(a => a.relation === '문양').map(a => a.value);
  const patternValue = shared.includes('매화') ? '매화' : shared[0] || '매화';
  const seals = [
    { fam: 'time', label: '시대', value: seed?.era || '고려' },
    { fam: 'material', label: '재질', value: attrValues(seed, '재질 2')[0] || '청자' },
    { fam: 'pattern', label: '문양', value: patternValue },
  ];
  const LAYOUTS = {
    // Right-hand seals sit below the top-right corner, where the story film's moon rises.
    wide: {
      vb: [1600, 900], obj: { cx: 1120, cy: 470, h: 520 },
      seals: [[1310, 330], [1330, 655], [720, 380]], sides: ['left', 'left', 'right'],
      anchors: [[.5, .04], [.95, .55], [.06, .42]], recs: [[1480, 480], [1500, 795], [800, 700]],
    },
    tall: {
      vb: [900, 1100], obj: { cx: 450, cy: 440, h: 400 },
      seals: [[590, 130], [600, 560], [100, 380]], sides: ['left', 'left', 'right'],
      anchors: [[.5, .04], [.95, .55], [.06, .42]], recs: [[790, 330], [700, 830], [190, 790]],
    },
  };
  const objW = h => h * (461 / 781);
  let L = LAYOUTS.wide;
  const threads = [];
  const sealNodes = [];
  const recNodes = [];
  let objG;
  let spot;

  function render() {
    const [vw, vh] = L.vb;
    svg.setAttribute('viewBox', `0 0 ${vw} ${vh}`);
    const { cx, cy, h } = L.obj;
    const w = objW(h);
    const defs = sv('defs', {},
      sv('linearGradient', { id: 'thread-gold', x1: 0, y1: 0, x2: 1, y2: 1 },
        sv('stop', { offset: '0', 'stop-color': '#f0d898' }), sv('stop', { offset: '1', 'stop-color': '#a8843a' })),
      sv('filter', { id: 'soft-glow', x: '-20%', y: '-20%', width: '140%', height: '140%' },
        sv('feGaussianBlur', { stdDeviation: 2.4, result: 'b' }),
        sv('feMerge', {}, sv('feMergeNode', { in: 'b' }), sv('feMergeNode', { in: 'SourceGraphic' }))),
      sv('radialGradient', { id: 'scene-spot' },
        sv('stop', { offset: '0', 'stop-color': 'rgba(255, 240, 206, .30)' }),
        sv('stop', { offset: '.55', 'stop-color': 'rgba(255, 240, 206, .07)' }),
        sv('stop', { offset: '1', 'stop-color': 'rgba(255, 240, 206, 0)' })),
      sv('clipPath', { id: 'scene-clip' }, sv('circle', { r: 58 })));
    spot = sv('ellipse', { cx, cy: cy - h * .05, rx: w * 1.25, ry: h * .78, fill: 'url(#scene-spot)' });
    objG = sv('g', {}, sv('image', { href: store.cutouts[seedId]?.file || 'assets/cutouts/celadon-vase.webp', x: -w / 2, y: -h / 2, width: w, height: h, preserveAspectRatio: 'xMidYMid meet' }));
    objG.style.transformOrigin = '0 0';
    const threadG = sv('g', {});
    const sealG = sv('g', {});
    const recG = sv('g', {});
    threads.length = 0;
    sealNodes.length = 0;
    recNodes.length = 0;
    seals.forEach((s, i) => {
      const [sx, sy] = L.seals[i];
      const meta = FAMILIES[s.fam];
      const [ax, ay] = L.anchors[i];
      const start = [cx - w / 2 + ax * w, cy - h / 2 + ay * h];
      const sealW = 224;
      const edge = L.sides[i] === 'left' ? [sx - 26, sy] : [sx - 26 + sealW, sy];
      const t1 = sv('path', { class: 'scene-thread', d: `M${start[0]},${start[1]} Q${(start[0] + edge[0]) / 2},${Math.min(start[1], edge[1]) - 40} ${edge[0]},${edge[1]}` });
      threadG.append(t1);
      threads.push({ path: t1, stage: 1 });
      const g = sv('g', { class: 'scene-seal', style: { '--c': meta.color } },
        sv('rect', { x: -26, y: -38, width: sealW, height: 76 }),
        sv('text', { class: 'glyph', x: 12, y: 0, text: meta.glyph }),
        sv('text', { class: 'label', x: 56, y: -10, text: s.label }),
        sv('text', { class: 'value', x: 56, y: 20, text: s.value }));
      sealG.append(g);
      sealNodes.push({ g, x: sx, y: sy });
      const rec = picks[s.fam];
      if (!rec) return;
      const [rx, ry] = L.recs[i];
      const from = [sx - 26 + sealW / 2, sy + 38];
      const t2 = sv('path', { class: 'scene-thread', d: `M${from[0]},${from[1]} Q${(from[0] + rx) / 2 + 40},${(from[1] + ry) / 2} ${rx},${ry - 64}` });
      threadG.append(t2);
      threads.push({ path: t2, stage: 2 });
      const photo = photoFor(rec);
      const rg = sv('g', { class: 'scene-rec' },
        sv('circle', { class: 'disk', r: 58 }),
        photo ? sv('image', { href: photo.thumb || photo.image, x: -58, y: -58, width: 116, height: 116, preserveAspectRatio: 'xMidYMid slice', 'clip-path': 'url(#scene-clip)' })
          : sv('text', { class: 'glyph', text: glyphFor(rec) }),
        sv('circle', { class: 'ring', r: 63 }),
        sv('text', { class: 'name', y: 96, text: short(rec.name, 10) }));
      recG.append(rg);
      recNodes.push({ g: rg, x: rx, y: ry });
    });
    svg.replaceChildren(defs, spot, threadG, objG, sealG, recG);
    threads.forEach(t => { t.len = t.path.getTotalLength(); t.path.style.strokeDasharray = `${t.len} ${t.len}`; });
  }

  function layout() {
    const box = svg.getBoundingClientRect();
    const next = box.width && box.width / box.height < .9 ? LAYOUTS.tall : LAYOUTS.wide;
    if (next !== L || !objG) { L = next; render(); }
  }

  function set(p) {
    if (!objG) return;
    const { cx, cy } = L.obj;
    const a = smooth(0, .22, p);
    objG.style.transform = `translate(${cx}px, ${cy + (1 - a) * 40}px) scale(${.88 + .12 * a})`;
    objG.style.filter = `brightness(${(.45 + .55 * a).toFixed(3)})`;
    spot.style.opacity = String(.25 + .75 * a);
    const s1 = smooth(.36, .54, p);
    const s2 = smooth(.69, .84, p);
    threads.forEach(t => { t.path.style.strokeDashoffset = String(t.len * (1 - (t.stage === 1 ? s1 : s2))); });
    const so = smooth(.42, .56, p);
    sealNodes.forEach(n => {
      n.g.style.transform = `translate(${n.x}px, ${n.y + (1 - so) * 14}px)`;
      n.g.style.opacity = String(so);
    });
    const ro = smooth(.74, .9, p);
    recNodes.forEach(n => {
      n.g.style.transform = `translate(${n.x}px, ${n.y}px) scale(${.72 + .28 * ro})`;
      n.g.style.opacity = String(ro);
    });
  }
  layout();
  return { set, layout };
}

function initStory() {
  const story = $('#story');
  const pin = $('.story-pin', story);
  const chapters = $$('.chapter', story);
  const steps = $$('.story-steps li', story);
  const groups = inkRange($('#story-range'), 29);
  const moon = $('.story-moon', story);
  const scene = buildScene($('#story-scene'), store.demo);
  initFilm(store.manifest?.story);
  if (reduced) { scene.set(1); return; }
  root.classList.add('pinned');
  let ticking = false;
  const update = () => {
    ticking = false;
    const r = story.getBoundingClientRect();
    const total = story.offsetHeight - pin.offsetHeight;
    const p = clamp(-r.top / Math.max(1, total), 0, 1);
    chapters.forEach((c, i) => {
      const center = (i + .5) / 3;
      const dist = (p - center) * 3;
      let o = clamp(1 - (Math.abs(dist) - .32) * 6, 0, 1);
      if ((i === 0 && dist < 0) || (i === chapters.length - 1 && dist > 0)) o = 1;
      c.style.setProperty('--co', o.toFixed(3));
      c.style.setProperty('--cy', `${(-dist * 24).toFixed(1)}px`);
    });
    steps.forEach((s, i) => s.style.setProperty('--fill', clamp(p * 3 - i, 0, 1).toFixed(3)));
    groups.forEach((g, i) => { g.style.transform = `translate3d(0, ${((1 - p) * (8 + i * 24)).toFixed(1)}px, 0)`; });
    moon.style.transform = `translate3d(0, ${(-p * 90).toFixed(1)}px, 0)`;
    scene.set(p);
    seekFilm(p);
  };
  addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
  new ResizeObserver(() => { scene.layout(); update(); }).observe(pin);
  update();
}

/* Constellation: CAFE weights as a star chart ----------------------------- */
const C = { center: 82, tickIn: 96, tickOut: 106, ringA: 92, ringB: 112, famLabel: 132, arc: 154, star: 206, rec: 392, recR: 44, line: 404 };
// Weight lines sway like grass in a breeze: only the middle control points move, by at most
// 1.5% of a line's length, thick lines less. Width and brightness never change with the sway.
// 0 keeps the lines still; prefers-reduced-motion always does.
const SWAY_INTENSITY = 1;

// uid keeps the SVG ids of separate instances apart.
class Constellation {
  constructor(svg, { onOpen, onHighlight, uid = 'c' }) {
    this.svg = svg;
    this.onOpen = onOpen;
    this.onHighlight = onHighlight;
    this.uid = uid;
    this.stars = new Map();
    this.recs = new Map();
    this.order = [];
    this.links = [];
    this.data = null;
    this.curating = false;
    this.visible = false;
    this.running = false;
    const defs = sv('defs', {},
      sv('radialGradient', { id: `${uid}-center-fill` }, sv('stop', { offset: '0', 'stop-color': '#252c33' }), sv('stop', { offset: '1', 'stop-color': '#0e1012' })),
      sv('radialGradient', { id: `${uid}-glow` }, sv('stop', { offset: '0', 'stop-color': 'rgba(255, 236, 196, .22)' }), sv('stop', { offset: '1', 'stop-color': 'rgba(255, 236, 196, 0)' })),
      // Warm pool of light behind each photo; the photo multiplies into it so studio backdrops melt away.
      sv('radialGradient', { id: `${uid}-plate`, cx: '.5', cy: '.46', r: '.62' },
        sv('stop', { offset: '0', 'stop-color': '#ddd4c3' }), sv('stop', { offset: '.58', 'stop-color': '#8d877c' }), sv('stop', { offset: '1', 'stop-color': '#202124' })),
      sv('clipPath', { id: `${uid}-clip` }, sv('circle', { r: C.recR })));
    this.L = {};
    for (const name of ['static', 'arcs', 'spokes', 'links', 'hits', 'stars', 'labels', 'recs', 'center']) this.L[name] = sv('g', { class: `c-layer-${name}` });
    svg.append(defs, ...Object.values(this.L));
    this.drawStatic();
    this.drawCenter();
    if (!reduced && SWAY_INTENSITY > 0) {
      new IntersectionObserver(([e]) => { this.visible = e.isIntersecting; this.syncSway(); }).observe(svg);
      document.addEventListener('visibilitychange', () => this.syncSway());
    }
  }
  drawStatic() {
    const g = this.L.static;
    g.append(sv('circle', { class: 'c-ring', r: 488 }), sv('circle', { class: 'c-ring orbit', r: C.rec }), sv('circle', { class: 'c-ring orbit', r: C.star }),
      sv('circle', { class: 'c-ring gold', r: C.ringA }), sv('circle', { class: 'c-ring gold', r: C.ringB }));
    for (let k = 0; k < 28; k++) {
      const [x1, y1] = P(k * (360 / 28), C.tickIn);
      const [x2, y2] = P(k * (360 / 28), C.tickOut);
      g.append(sv('line', { class: 'c-tick', x1, y1, x2, y2 }));
    }
    for (let k = 0; k < 120; k++) {
      const [x1, y1] = P(k * 3, 482);
      const [x2, y2] = P(k * 3, k % 10 === 0 ? 470 : 477);
      g.append(sv('line', { class: 'c-tick', x1, y1, x2, y2, opacity: .45 }));
    }
    [['北', -90], ['東', 0], ['南', 90], ['西', 180]].forEach(([t, deg]) => {
      const [x, y] = P(deg, 456);
      g.append(sv('text', { class: 'c-cardinal', x, y, text: t }));
    });
  }
  drawCenter() {
    const g = this.L.center;
    g.setAttribute('class', 'c-center');
    this.centerImg = sv('image', { x: -60, y: -64, width: 120, height: 120, preserveAspectRatio: 'xMidYMid meet' });
    g.append(sv('circle', { r: C.center + 30, fill: `url(#${this.uid}-glow)` }), sv('circle', { class: 'disk', r: C.center, style: { fill: `url(#${this.uid}-center-fill)` } }), this.centerImg);
  }
  setCenter(src) { this.centerImg.setAttribute('href', src); }
  centerRect() { return $('.disk', this.L.center).getBoundingClientRect(); }
  hideCenter(h) { this.centerImg.style.opacity = h ? '0' : '1'; }
  draw(path, delay, dur) {
    if (reduced) return;
    const len = path.getTotalLength();
    path.style.strokeDasharray = `${len} ${len}`;
    path.style.strokeDashoffset = String(len);
    path.style.transition = `stroke-dashoffset ${dur}ms cubic-bezier(.2,.7,.1,1) ${delay}ms, opacity .35s`;
    raf2(() => { path.style.strokeDashoffset = '0'; });
  }
  // Ring slot (or, in curator mode, a place on the walking line) of rank i among n.
  slot(i, n, curating = this.curating) {
    if (curating) {
      const span = Math.min(760, 152 * (n - 1));
      return [n > 1 ? -span / 2 + (span * i) / (n - 1) : 0, C.line];
    }
    return P(n === 6 ? -60 + i * 60 : -90 + (360 * (i + .5)) / n, C.rec);
  }

  update(recs, { seedAttrs, boosted }) {
    const values = new Map();
    let minEdge = Infinity;
    let maxEdge = 0;
    recs.forEach(r => r.explanationEdges.forEach(e => {
      const key = `${e.relation}|${e.value}`;
      if (!values.has(key)) values.set(key, { key, relation: e.relation, value: e.value, family: familyOf(e.relation), weight: 0, shared: seedAttrs.has(key) });
      values.get(key).weight += e.weight;
      minEdge = Math.min(minEdge, e.weight);
      maxEdge = Math.max(maxEdge, e.weight);
    }));
    const fams = new Map();
    for (const v of values.values()) {
      if (!fams.has(v.family)) fams.set(v.family, { family: v.family, total: 0, values: [] });
      const f = fams.get(v.family);
      f.total += v.weight;
      f.values.push(v);
    }
    const famList = [...fams.values()].sort((a, b) => b.total - a.total);
    famList.forEach(f => f.values.sort((a, b) => b.weight - a.weight));
    const ordered = famList.flatMap(f => f.values);
    const GAP = 8;
    const avail = 360 - famList.length * GAP;
    const minSpan = Math.min(5, (avail * .55) / Math.max(1, ordered.length));
    const total = ordered.reduce((s, v) => s + v.weight, 0) || 1;
    let a = -90 + GAP / 2;
    for (const f of famList) {
      f.start = a;
      for (const v of f.values) {
        const span = minSpan + (avail - ordered.length * minSpan) * (v.weight / total);
        v.ang = a + span / 2;
        a += span;
      }
      f.end = a;
      a += GAP;
    }
    const maxV = ordered.length ? Math.max(...ordered.map(v => v.weight)) : 1;
    this.data = { values, famList, ordered };
    this.order = recs.map(r => r.headKey);
    this.drawArcs(famList);
    this.drawSpokes(ordered);
    this.drawStars(ordered, maxV, boosted);
    this.drawLabels(ordered, maxV, boosted);
    this.drawRecs(recs);
    this.drawLinks(recs, values, minEdge, maxEdge);
    this.highlight({});
    return { famList, ordered };
  }
  drawArcs(famList) {
    const g = this.L.arcs;
    g.replaceChildren();
    famList.forEach((f, i) => {
      const meta = FAMILIES[f.family];
      const [x0, y0] = P(f.start, C.arc);
      const [x1, y1] = P(f.end, C.arc);
      const path = sv('path', { class: 'c-arc', 'data-family': f.family, style: { '--c': meta.color },
        d: `M${x0.toFixed(1)},${y0.toFixed(1)} A${C.arc},${C.arc} 0 ${f.end - f.start > 180 ? 1 : 0} 1 ${x1.toFixed(1)},${y1.toFixed(1)}` });
      g.append(path);
      this.draw(path, 250 + i * 110, 900);
      const span = f.end - f.start;
      if (span < 9) return;
      const [lx, ly] = P((f.start + f.end) / 2, C.famLabel);
      g.append(sv('text', { class: 'c-famlabel', 'data-family': f.family, x: lx.toFixed(1), y: ly.toFixed(1), style: { '--c': meta.color },
        text: span > 26 ? `${meta.label} ${pct(f.total)}` : meta.label }));
    });
  }
  drawSpokes(ordered) {
    const g = this.L.spokes;
    g.replaceChildren();
    ordered.filter(v => v.shared).forEach(v => {
      const [x1, y1] = P(v.ang, C.ringB + 4);
      const [x2, y2] = P(v.ang, C.star - 10);
      g.append(sv('line', { class: 'c-spoke', 'data-key': v.key, 'data-family': v.family, x1, y1, x2, y2, style: { '--c': FAMILIES[v.family].color } }));
    });
  }
  drawStars(ordered, maxV, boosted) {
    const g = this.L.stars;
    const seen = new Set();
    ordered.forEach((v, i) => {
      seen.add(v.key);
      const r = 3.5 + 13 * Math.sqrt(v.weight / maxV);
      let node = this.stars.get(v.key);
      const fresh = !node;
      if (fresh) {
        node = sv('g', {}, sv('circle', { class: 'halo' }), sv('circle', { class: 'core' }), sv('title'));
        node.style.transform = 'translate(0px, 0px) scale(.2)';
        node.style.opacity = '0';
        node.addEventListener('pointerenter', () => this.highlight({ value: node.dataset.key }));
        node.addEventListener('pointerleave', () => this.highlight({}));
        g.append(node);
        this.stars.set(v.key, node);
      }
      const on = boosted.has(v.key);
      node.setAttribute('class', `c-star${v.shared ? '' : ' hollow'}${on ? ' interest' : ''}`);
      node.dataset.key = v.key;
      node.dataset.family = v.family;
      node.style.setProperty('--c', FAMILIES[v.family].color);
      $('.halo', node).setAttribute('r', Math.max(10, r * 2.1).toFixed(1));
      $('.core', node).setAttribute('r', r.toFixed(1));
      let ring = $('.ring', node);
      if (on) {
        if (!ring) { ring = sv('circle', { class: 'ring' }); node.insertBefore(ring, $('title', node)); }
        ring.setAttribute('r', (r + 5).toFixed(1));
      } else ring?.remove();
      $('title', node).textContent = `${REL_LABEL[v.relation] || v.relation} ${v.value} · 비중 ${pct(v.weight)}${v.shared ? ' · 기준 유물과 같은 속성' : ''}`;
      const [x, y] = P(v.ang, C.star);
      const apply = () => { node.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`; node.style.opacity = ''; };
      if (fresh && !reduced) { node.style.transitionDelay = `${280 + i * 22}ms`; raf2(apply); } else { node.style.transitionDelay = '0ms'; apply(); }
    });
    for (const [key, node] of this.stars) {
      if (seen.has(key)) continue;
      this.stars.delete(key);
      node.style.transitionDelay = '0ms';
      node.style.opacity = '0';
      setTimeout(() => node.remove(), 500);
    }
  }
  drawLabels(ordered, maxV, boosted) {
    const g = this.L.labels;
    g.replaceChildren();
    // Matches the CSS font size of .c-vlabel (larger on phones).
    const fs = matchMedia('(max-width: 760px)').matches ? 26 : 15;
    const chosen = [...ordered].sort((a, b) => b.weight - a.weight).slice(0, fs > 15 ? 6 : 8);
    ordered.filter(v => boosted.has(v.key) && !chosen.includes(v)).forEach(v => chosen.unshift(v));
    const boxes = [];
    chosen.forEach(v => {
      const r = 3.5 + 13 * Math.sqrt(v.weight / maxV);
      const [x, y] = P(v.ang, C.star + r + 12);
      const cos = Math.cos(v.ang * Math.PI / 180);
      const sin = Math.sin(v.ang * Math.PI / 180);
      const anchor = Math.abs(cos) < .3 ? 'middle' : cos > 0 ? 'start' : 'end';
      const ty = y + (Math.abs(cos) < .3 ? (sin > 0 ? fs * .8 : -4) : fs / 3);
      const w = v.value.length * fs + 6;
      const x0 = anchor === 'start' ? x : anchor === 'end' ? x - w : x - w / 2;
      const box = [x0, ty - fs, x0 + w, ty + 4];
      if (boxes.some(b => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) return;
      boxes.push(box);
      g.append(sv('text', { class: `c-vlabel${boosted.has(v.key) ? ' interest' : ''}`, 'data-key': v.key, 'data-family': v.family, x: x.toFixed(1), y: ty.toFixed(1), 'text-anchor': anchor, text: v.value }));
    });
    if (!reduced) g.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 700, delay: 700, fill: 'backwards' });
  }
  drawRecs(recs) {
    const g = this.L.recs;
    const seen = new Set();
    recs.forEach((r, i) => {
      seen.add(r.headKey);
      let node = this.recs.get(r.headKey);
      const fresh = !node;
      if (fresh) {
        node = this.makeRec(r);
        node.style.transform = 'translate(0px, 0px) scale(.25)';
        node.style.opacity = '0';
        g.append(node);
        this.recs.set(r.headKey, node);
      }
      $('.rank', node).textContent = HANJA_NUM[i] || String(i + 1);
      node.setAttribute('aria-label', `추천 ${i + 1}위 ${r.name}. 자세히 보기`);
      this.place(node, i, recs.length, fresh ? 420 + i * 90 : 0);
    });
    for (const [key, node] of this.recs) {
      if (seen.has(key)) continue;
      this.recs.delete(key);
      node.style.transitionDelay = '0ms';
      node.style.opacity = '0';
      node.style.transform = 'translate(0px, 0px) scale(.25)';
      setTimeout(() => node.remove(), 800);
    }
  }
  place(node, i, n, delay = 0) {
    const [x, y] = this.slot(i, n);
    const above = y < -40;
    $('.name', node).setAttribute('y', above ? -C.recR - 30 : C.recR + 26);
    $('.meta', node).setAttribute('y', above ? -C.recR - 12 : C.recR + 44);
    const apply = () => { node.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`; node.style.opacity = ''; };
    node.style.transitionDelay = `${delay}ms`;
    if (delay && !reduced) raf2(apply); else apply();
  }
  makeRec(r) {
    const photo = photoFor(r);
    const bx = -C.recR * .76;
    const R = C.recR;
    const node = sv('g', { class: 'c-rec', tabindex: 0, role: 'button', 'data-key': r.headKey },
      sv('circle', { class: `disk${photo ? ' lit' : ''}`, r: R, style: photo ? { fill: `url(#${this.uid}-plate)` } : null }),
      photo ? sv('image', { class: 'plate-img', href: photo.thumb || photo.image, x: -R * .92, y: -R * .92, width: R * 1.84, height: R * 1.84, preserveAspectRatio: 'xMidYMid meet', 'clip-path': `url(#${this.uid}-clip)` })
        : sv('text', { class: 'glyph', text: glyphFor(r) }),
      sv('circle', { class: 'ring', r: R + 4 }),
      sv('circle', { class: 'badge', cx: bx, cy: bx, r: 12 }),
      sv('text', { class: 'rank', x: bx, y: bx }),
      sv('text', { class: 'name', x: 0, text: short(r.name, 9) }),
      sv('text', { class: 'meta', x: 0, text: [metaLine(r), photo ? '' : '사진 미수록'].filter(Boolean).join(' · ') }),
      sv('title', { text: r.name }));
    node.addEventListener('pointerenter', () => this.highlight({ rec: r.headKey }));
    node.addEventListener('pointerleave', () => this.highlight({}));
    node.addEventListener('focus', () => this.highlight({ rec: r.headKey }));
    node.addEventListener('blur', () => this.highlight({}));
    node.addEventListener('click', () => this.onOpen(r.headKey));
    node.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.onOpen(r.headKey); } });
    return node;
  }
  // Lines keep a weight-proportional width in screen pixels: normalised over the shown six, 1 px to 6 px.
  drawLinks(recs, values, minEdge, maxEdge) {
    const g = this.L.links;
    const hits = this.L.hits;
    g.replaceChildren();
    hits.replaceChildren();
    this.links = [];
    const span = Math.max(1e-12, maxEdge - minEdge);
    recs.forEach((r, i) => {
      const deg = recs.length === 6 ? -60 + i * 60 : -90 + (360 * (i + .5)) / recs.length;
      const [ex, ey] = P(deg, C.rec - C.recR - 6);
      const [c2x, c2y] = P(deg, C.rec - C.recR - 80);
      const set = sv('g', { class: 'c-linkset' });
      g.append(set);
      r.explanationEdges.forEach(e => {
        const key = `${e.relation}|${e.value}`;
        const v = values.get(key);
        if (!v) return;
        const [sx, sy] = P(v.ang, C.star);
        const [c1x, c1y] = P(v.ang, C.star + 80);
        const norm = (e.weight - minEdge) / span;
        const d = `M${sx.toFixed(1)},${sy.toFixed(1)} C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${ex.toFixed(1)},${ey.toFixed(1)}`;
        const path = sv('path', { class: 'c-link', d, 'data-rec': r.headKey, 'data-key': key, 'data-family': v.family,
          style: { '--c': FAMILIES[v.family].color, '--w': `${(1 + 5 * norm).toFixed(2)}px` } });
        const hit = sv('path', { class: 'c-hit', d, 'data-rec': r.headKey });
        hit.addEventListener('pointerenter', () => this.highlight({ rec: r.headKey }));
        hit.addEventListener('pointerleave', () => this.highlight({}));
        hit.addEventListener('click', () => this.onOpen(r.headKey));
        set.append(path);
        hits.append(hit);
        const len = Math.hypot(ex - sx, ey - sy) || 1;
        this.links.push({
          path, hit, sx, sy, ex, ey, c1x, c1y, c2x, c2y, nx: -(ey - sy) / len, ny: (ex - sx) / len,
          amp: len * .015 * (1 - .65 * norm) * SWAY_INTENSITY, omega: (2 * Math.PI) / (4 + Math.random() * 3),
          phase: Math.random() * 6.283, gain: 1, hot: false,
        });
      });
      if (!reduced) set.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 900, delay: 650 + i * 90, easing: 'ease-out', fill: 'backwards' });
    });
    this.syncSway();
  }
  syncSway() {
    const go = this.visible && !document.hidden && this.links.length > 0 && !reduced && SWAY_INTENSITY > 0;
    if (go && !this.running) {
      this.running = true;
      requestAnimationFrame(t => this.sway(t));
    } else if (!go) this.running = false;
  }
  sway(t) {
    if (!this.running) return;
    const s = t / 1000;
    for (const L of this.links) {
      // Hovered lines and the curator's walk hold almost still so they read crisply.
      const target = this.curating ? .04 : L.hot ? .05 : 1;
      L.gain += (target - L.gain) * .07;
      const o1 = L.amp * L.gain * Math.sin(s * L.omega + L.phase);
      const o2 = L.amp * L.gain * Math.sin(s * L.omega + L.phase + .9);
      const d = `M${L.sx.toFixed(1)},${L.sy.toFixed(1)} C${(L.c1x + L.nx * o1).toFixed(2)},${(L.c1y + L.ny * o1).toFixed(2)} ${(L.c2x + L.nx * o2).toFixed(2)},${(L.c2y + L.ny * o2).toFixed(2)} ${L.ex.toFixed(1)},${L.ey.toFixed(1)}`;
      L.path.setAttribute('d', d);
      L.hit.setAttribute('d', d);
    }
    requestAnimationFrame(tt => this.sway(tt));
  }
  setCurator(on) {
    this.curating = on;
    this.svg.classList.toggle('curating', on);
    if (on) this.highlight({});
    const n = this.order.length;
    this.order.forEach((key, i) => { const node = this.recs.get(key); if (node) this.place(node, i, n, on ? i * 60 : (n - i) * 50); });
  }
  setCurrent(key) {
    for (const [k, node] of this.recs) node.classList.toggle('current', k === key);
  }
  highlight({ rec = null, value = null, family = null } = {}) {
    if (this.curating) { rec = null; value = null; family = null; }
    const on = Boolean(rec || value || family);
    this.svg.classList.toggle('focusing', on);
    const hotKeys = new Set();
    const hotRecs = new Set();
    for (const L of this.links) {
      const l = L.path;
      const hot = on && Boolean((rec && l.dataset.rec === rec) || (value && l.dataset.key === value) || (family && l.dataset.family === family));
      l.classList.toggle('hot', hot);
      L.hot = hot;
      if (hot) { hotKeys.add(l.dataset.key); hotRecs.add(l.dataset.rec); }
    }
    if (rec) hotRecs.add(rec);
    if (value) hotKeys.add(value);
    const hotFams = new Set([...hotKeys].map(k => this.data?.values.get(k)?.family));
    if (family) hotFams.add(family);
    for (const [key, node] of this.stars) node.classList.toggle('hot', hotKeys.has(key) || (family != null && node.dataset.family === family));
    for (const [key, node] of this.recs) node.classList.toggle('hot', hotRecs.has(key));
    $$('.c-vlabel, .c-spoke', this.svg).forEach(n => n.classList.toggle('hot', hotKeys.has(n.dataset.key)));
    $$('.c-arc, .c-famlabel', this.svg).forEach(n => n.classList.toggle('hot', hotFams.has(n.dataset.family)));
    this.onHighlight?.({ on, hotKeys, hotRecs });
  }
}

/* Recommendation engine ------------------------------------------------------
   Chips are the seed artifact's own attributes (its triples). Choosing chips is the model's
   para_sim interest conditioning, exactly as recommend_top_n with relation_id/tail_id lists:
     score = (1 - para_sim) * cos(seed, item) + para_sim * mean over chosen chips of
             compute_condition_similarity(item, relation, tail)          (para_sim = 0.4)
   scripts/export_recommendations.py exported, per seed, every candidate's seed similarity and
   per-chip condition similarity; the browser ranks them with this formula. Verified against the
   original recommend_top_n for every single chip, chip pair and whole attribute group (208/208).
   - RECOMMEND_TEMPERATURE 0: stable descending sort, the original use_sampling=False path.
   - above 0: six drawn without replacement with probability softmax(score / T) (Gumbel top-k),
     limited to the exported candidates.
   CAFE weights are recomputed for the six shown with src/importance.py's formula; the chosen
   chips get the model's interest boost. */
const RECOMMEND_TEMPERATURE = 0;

const FILTER_GROUPS = [
  { key: 'time', label: '시대', glyph: '時', family: 'time', relations: ['시대'] },
  { key: 'material', label: '재질', glyph: '材', family: 'material', relations: ['재질 1', '재질 2'] },
  { key: 'pattern', label: '문양', glyph: '紋', family: 'pattern', relations: ['문양'] },
  { key: 'form', label: '형태', glyph: '形', family: 'class', relations: ['유물분류 4'] },
  { key: 'use', label: '용도', glyph: '用', family: 'class', relations: ['유물분류 2', '유물분류 3'] },
  { key: 'place', label: '국적·출토지', glyph: '處', family: 'place', relations: ['국적', '출토지', '출토지_상세'] },
];
const GROUP_OF_REL = Object.fromEntries(FILTER_GROUPS.flatMap(g => g.relations.map(r => [r, g])));
const REL_PROSE = {
  '시대': '시대', '재질 1': '재질', '재질 2': '세부 재질', '문양': '문양', '유물분류 1': '분류', '유물분류 2': '용도',
  '유물분류 3': '세부 용도', '유물분류 4': '형태', '국적': '국적', '출토지': '출토지', '출토지_상세': '출토지',
};
const excludedNodes = () => new Set(store.pool?.metadata?.excludeNodes || ['한국']);

function cafeWeights(heads, isBoosted) {
  const rel = store.pool.relations;
  const gamma = store.pool.metadata?.scoring?.gamma ?? 1;
  const boost = store.pool.metadata?.scoring?.interestExplanationBoost ?? 5;
  const rows = [];
  for (const head of heads) for (const [ri, value, s] of store.items.get(head)?.edges || []) rows.push({ head, relation: rel[ri], value, s });
  const byRel = new Map();
  for (const e of rows) {
    let g = byRel.get(e.relation);
    if (!g) byRel.set(e.relation, g = { sumExp: 0, sumS: 0, n: 0 });
    g.sumExp += Math.exp(e.s / gamma);
    g.sumS += e.s;
    g.n += 1;
  }
  let relTotal = 0;
  for (const g of byRel.values()) { g.score = Math.exp(g.sumS / g.n / gamma); relTotal += g.score; }
  let total = 0;
  for (const e of rows) {
    const g = byRel.get(e.relation);
    e.weight = (g.score / relTotal) * (Math.exp(e.s / gamma) / g.sumExp);
    e.boosted = isBoosted(e);
    if (e.boosted) e.weight *= boost;
    total += e.weight;
  }
  for (const e of rows) e.weight /= total + 1e-9;
  return rows;
}
const seedPool = (id = D.seed) => store.pool?.seeds?.[id] || null;
// [headKey, score, entityId] in model order: score descending, ties by entity id (stable sort).
// sel: indices of the seed's chips chosen as interest conditions.
function rankPool(sel, sp = seedPool()) {
  if (!sp) return null;
  const ps = store.pool.metadata.scoring.interestWeight;
  const ranked = sp.candidates.map(([hk, eid, sh, cs]) => [hk, sel.length ? (1 - ps) * sh + ps * sel.reduce((a, i) => a + cs[i], 0) / sel.length : sh, eid]);
  return ranked.sort((a, b) => b[1] - a[1] || a[2] - b[2]);
}
function gumbelTopK(cands, k, T) {
  return cands.map(c => ({ c, key: c[1] / T - Math.log(-Math.log(Math.random() || 1e-12)) }))
    .sort((a, b) => b.key - a.key).slice(0, k).map(x => x.c);
}
function recommendFor(seedId, chips) {
  const seed = store.demo.catalog[seedId];
  const sp = seedPool(seedId);
  const ranked = sp ? rankPool(sp.chips.map(([r, v], i) => (chips.has(`${r}|${v}`) ? i : -1)).filter(i => i >= 0), sp) : null;
  if (!ranked) {
    const recs = store.demo.scenarios[`${seedId}|all`].recommendations.map(r => ({ ...store.items.get(r.headKey), ...r, sharedAttributes: [], chipMatches: 0 }));
    return { recs, poolSize: recs.length, boostedKeys: new Set() };
  }
  const picked = RECOMMEND_TEMPERATURE > 0 ? gumbelTopK(ranked, 6, RECOMMEND_TEMPERATURE) : ranked.slice(0, 6);
  const rows = cafeWeights(picked.map(c => c[0]), e => chips.has(`${e.relation}|${e.value}`));
  const seedKeys = new Set(seed.attributes.map(a => `${a.relation}|${a.value}`));
  const excluded = excludedNodes();
  const recs = picked.map(([hk, score]) => {
    const info = store.items.get(hk);
    return {
      ...info, score,
      sharedAttributes: info.attributes.filter(a => seedKeys.has(`${a.relation}|${a.value}`) && !excluded.has(a.value)),
      chipMatches: info.attributes.filter(a => chips.has(`${a.relation}|${a.value}`)).length,
      explanationEdges: rows.filter(e => e.head === hk).sort((a, b) => b.weight - a.weight)
        .map(({ relation, value, weight }) => ({ relation, value, weight })),
    };
  });
  const boostedKeys = new Set(rows.filter(e => e.boosted).map(e => `${e.relation}|${e.value}`));
  return { recs, poolSize: ranked.length, boostedKeys };
}
const recommend = () => recommendFor(D.seed, D.chips);
// The six with no chips chosen (for rank changes).
function baseHeads() {
  const ranked = rankPool([]);
  return ranked ? ranked.slice(0, 6).map(c => c[0]) : store.demo.scenarios[`${D.seed}|all`].recommendations.map(r => r.headKey);
}

/* Discover: vitrine, plaques, chips, readout, curator ----------------------- */
const D = { seed: null, active: false, chips: new Set(), groups: [], model: null, curator: false, cIndex: 0, auto: null };
let sky = null;
// Brightest floor spot of the case photo (assets/media/vitrine.webp), measured from the image:
// lamp x 63.3%, lit floor centred at x 63.7%, y 70.7%. The artifact stands on that spot.
const VITRINE_LIGHT = { x: .637, y: .707 };
// Plaques hug the vitrine walls. side: the plaque's edge the leader leaves from
// ('left' = plaque on the right wall, 'right' = plaque on the left wall). The artifact stands
// right of centre under the light, so most plaques sit on the roomier left wall.
const SLOTS = {
  time: { x: 5, y: 12, ax: .62, ay: .02, side: 'left' },
  form: { x: 5, y: 14, ax: .3, ay: .06, side: 'right' },
  material: { x: 4, y: 36, ax: .12, ay: .3, side: 'right' },
  pattern: { x: 4, y: 58, ax: .06, ay: .55, side: 'right' },
  use: { x: 5, y: 80, ax: .22, ay: .92, side: 'right' },
  place: { x: 5, y: 86, ax: .8, ay: .98, side: 'left' },
};

// The seed's chips (its own triples), grouped for the plaques and the chip row.
function seedGroups(item) {
  const excluded = excludedNodes();
  const triples = seedPool()?.chips.map(([relation, value]) => ({ relation, value }))
    || item.attributes.filter(a => !excluded.has(a.value));
  return FILTER_GROUPS.map(g => {
    const chips = triples.filter(a => g.relations.includes(a.relation)).map(a => ({ ...a, key: `${a.relation}|${a.value}` }));
    return { ...g, chips, values: chips.map(c => c.value) };
  }).filter(g => g.chips.length);
}

function initDiscover() {
  const demo = store.demo;
  if (!demo) {
    $('#vitrine-hint').textContent = '추천 자료를 불러오지 못했습니다. 페이지를 새로고침해 주세요.';
    return;
  }
  sky = new Constellation($('#constellation'), {
    onOpen: key => {
      const recs = D.model?.recs || [];
      const i = recs.findIndex(r => r.headKey === key);
      if (i < 0) return;
      if (D.curator) { showCurated(i); return; }
      openArtifact(recs[i], { rank: i + 1, rec: recs[i] });
    },
    onHighlight: ({ on, hotKeys, hotRecs }) => {
      $$('.find').forEach(f => f.classList.toggle('hot', on && hotRecs.has(f.dataset.key)));
      $$('.value-chip').forEach(c => c.classList.toggle('hot', on && hotKeys.has(c.dataset.key)));
    },
  });
  if (matchMedia('(pointer: coarse)').matches) $('#vitrine-hint').textContent = '표찰이나 아래 칩을 눌러 보세요.';
  buildSeedRail();
  $('#filter-clear').addEventListener('click', () => { D.chips.clear(); if (D.active) renderScenario(); else syncFilterState(); });
  initCurator();
  new Dust($('#vitrine-dust'), { density: 1.6, max: 90, rise: .7, size: [.4, 1.5] });
  const first = demo.baseArtifactIds.includes('동원1347') ? '동원1347' : demo.baseArtifactIds[0];
  selectSeed(first, {});
  new IntersectionObserver(([e], obs) => {
    if (!e.isIntersecting) return;
    obs.disconnect();
    light();
  }, { threshold: .3 }).observe($('#vitrine'));
  new ResizeObserver(() => layoutLeaders()).observe($('#vitrine'));
}

function light() {
  const v = $('#vitrine');
  if (v.classList.contains('lit')) return;
  v.classList.add('lit');
  if (reduced) return;
  setTimeout(() => {
    if (D.active) return;
    $$('.tag').forEach((t, i) => setTimeout(() => {
      t.classList.add('shine');
      setTimeout(() => t.classList.remove('shine'), 900);
    }, i * 300));
  }, 1500);
}

function buildSeedRail() {
  const rail = $('#seed-rail');
  rail.replaceChildren(...store.demo.baseArtifactIds.map(id => {
    const item = store.demo.catalog[id];
    const src = store.cutouts[id]?.file || photoFor(item)?.thumb || '';
    const btn = el('button', { class: 'seed', type: 'button', role: 'radio', 'aria-checked': 'false', tabindex: -1, 'data-id': id, 'aria-label': `${SHORT[id] || item.name}, ${metaLine(item)}` },
      el('span', { class: 'seed-figure' }, el('img', { src, alt: '', decoding: 'async' })),
      el('span', { class: 'seed-name', text: SHORT[id] || item.name }),
      el('span', { class: 'seed-meta', text: metaLine(item) }));
    btn.addEventListener('click', () => selectSeed(id, { from: btn }));
    return btn;
  }));
  rail.addEventListener('keydown', e => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const btns = $$('.seed', rail);
    const i = btns.findIndex(b => b.dataset.id === D.seed);
    const next = btns[(i + step + btns.length) % btns.length];
    next.focus();
    next.click();
  });
}

async function selectSeed(id, { from = null }) {
  if (D.seed === id) return;
  D.seed = id;
  D.chips.clear();
  const item = store.demo.catalog[id];
  $$('.seed').forEach(b => { const on = b.dataset.id === id; b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; });
  const obj = $('#vitrine-obj');
  const refl = $('#vitrine-reflect');
  const src = store.cutouts[id]?.file || photoFor(item)?.image || '';
  const firstRect = from && !reduced ? $('img', from).getBoundingClientRect() : null;
  obj.src = src;
  refl.src = src;
  obj.alt = `${SHORT[id] || item.name}. ${metaLine(item)}, 국립중앙박물관 ${id}`;
  try { await obj.decode(); } catch { /* keep going with whatever loaded */ }
  if (D.seed !== id) return;
  $('#vitrine-label').replaceChildren(el('span', {}, el('b', { text: SHORT[id] || item.name }), `${metaLine(item)} · 국립중앙박물관 ${id}`));
  renderTags(item);
  sky.setCenter(src);
  if (from) {
    light();
    if (firstRect) flip(obj, firstRect);
  }
  if (D.active) renderScenario();
}

function flip(node, first) {
  const last = node.getBoundingClientRect();
  if (!last.width || !first.width) return;
  const dx = first.left + first.width / 2 - (last.left + last.width / 2);
  const dy = first.top + first.height / 2 - (last.top + last.height / 2);
  const s = first.height / last.height;
  node.animate([{ transform: `translate(${dx}px, ${dy}px) scale(${s})` }, { transform: 'none' }], { duration: 1000, easing: 'cubic-bezier(.2,.7,.1,1)' });
  const v = $('#vitrine');
  v.classList.remove('flash');
  setTimeout(() => { v.classList.add('flash'); setTimeout(() => v.classList.remove('flash'), 750); }, 820);
}

function renderTags(item) {
  D.groups = seedGroups(item);
  const wrap = $('#tags');
  const glints = $('#glints');
  wrap.replaceChildren();
  glints.replaceChildren();
  D.groups.forEach((grp, i) => {
    const slot = SLOTS[grp.key];
    const fam = FAMILIES[grp.family];
    const text = grp.values.slice(0, 2).join(' · ') + (grp.values.length > 2 ? ` 외 ${grp.values.length - 2}` : '');
    const btn = el('button', {
      class: `tag${slot.side === 'left' ? ' from-right' : ''}`, type: 'button', 'aria-pressed': 'false', 'data-group': grp.key,
      style: { '--x': `${slot.x}%`, '--y': `${slot.y}%`, '--c': fam.color, '--delay': `${(.35 + i * .12).toFixed(2)}s` },
      'aria-label': `${grp.label} ${grp.values.join(', ')}. 이 속성에 끌림`,
    }, el('span', { class: 'tag-glyph', 'aria-hidden': 'true', text: grp.glyph }), el('span', { class: 'tag-text' }, el('small', { text: grp.label }), el('b', { text })));
    const hot = on => {
      $$('#leaders g')[i]?.classList.toggle('hot', on);
      glints.children[i]?.classList.toggle('on', on);
      if (on) {
        const v = $('#vitrine');
        v.classList.remove('flash');
        void v.offsetWidth;
        v.classList.add('flash');
        setTimeout(() => v.classList.remove('flash'), 750);
      }
      if (D.active) sky.highlight(on ? { family: grp.family } : {});
    };
    btn.addEventListener('pointerenter', () => hot(true));
    btn.addEventListener('pointerleave', () => hot(false));
    btn.addEventListener('focus', () => hot(true));
    btn.addEventListener('blur', () => hot(false));
    btn.addEventListener('click', () => toggleGroup(grp.key));
    wrap.append(btn);
    glints.append(el('span', { class: 'glint' }));
  });
  renderFilterChips();
  raf2(layoutLeaders);
}

function layoutLeaders() {
  const svg = $('#leaders');
  const obj = $('#vitrine-obj');
  const kase = $('#case');
  if (!obj.offsetWidth || getComputedStyle(svg).display === 'none') return;
  // The case is centred with auto margins; the artifact is centred on the light with translate: -50% 0.
  const ox = kase.offsetLeft + obj.offsetLeft - obj.offsetWidth / 2;
  const oy = kase.offsetTop + obj.offsetTop;
  const ow = obj.offsetWidth;
  const oh = obj.offsetHeight;
  svg.replaceChildren();
  $$('.tag').forEach((t, i) => {
    const slot = SLOTS[t.dataset.group];
    // translate: 0 -50% leaves offsetTop on the plaque's vertical centre.
    const cy = t.offsetTop;
    const sx = slot.side === 'left' ? t.offsetLeft : t.offsetLeft + t.offsetWidth;
    const elbow = slot.side === 'left' ? sx - 18 : sx + 18;
    const ex = ox + slot.ax * ow;
    const ey = oy + slot.ay * oh;
    svg.append(sv('g', { style: { '--c': t.style.getPropertyValue('--c'), '--delay': `${(.5 + i * .12).toFixed(2)}s` } },
      sv('path', { d: `M${sx.toFixed(1)},${cy.toFixed(1)} L${elbow.toFixed(1)},${cy.toFixed(1)} L${ex.toFixed(1)},${ey.toFixed(1)}` }),
      sv('circle', { cx: ex.toFixed(1), cy: ey.toFixed(1), r: 3.5 })));
    const glint = $('#glints').children[i];
    if (glint) { glint.style.left = `${ex}px`; glint.style.top = `${ey}px`; }
  });
}

function renderFilterChips() {
  $('#filter-groups').replaceChildren(...D.groups.map(grp => el('div', { class: 'fgroup', style: { '--c': FAMILIES[grp.family].color } },
    el('span', { class: 'fgroup-name' }, el('i', { 'aria-hidden': 'true', text: grp.glyph }), grp.label),
    el('span', { class: 'fchips' }, grp.chips.map(c => {
      const b = el('button', { class: 'fchip', type: 'button', 'aria-pressed': 'false', 'data-key': c.key, title: `${REL_LABEL[c.relation] || c.relation} ${c.value}`, text: c.value });
      b.addEventListener('click', () => toggleChip(c.key));
      return b;
    })))));
  syncFilterState();
}
function syncFilterState() {
  $$('.fchip').forEach(b => b.setAttribute('aria-pressed', String(D.chips.has(b.dataset.key))));
  $$('.tag').forEach(t => t.setAttribute('aria-pressed', String(D.groups.find(g => g.key === t.dataset.group)?.chips.some(c => D.chips.has(c.key)) || false)));
  $('#filter-clear').disabled = !D.chips.size;
}
function toggleChip(key) {
  if (D.chips.has(key)) D.chips.delete(key); else D.chips.add(key);
  activate();
}
// A plaque stands for the whole attribute: all of this artifact's values in it, or none.
function toggleGroup(gk) {
  const chips = D.groups.find(g => g.key === gk).chips;
  if (chips.some(c => D.chips.has(c.key))) chips.forEach(c => D.chips.delete(c.key));
  else chips.forEach(c => D.chips.add(c.key));
  activate();
}

function activate() {
  const firstTime = !D.active;
  D.active = true;
  $('#theater').dataset.active = 'true';
  $('#readout').hidden = false;
  light();
  if (firstTime) flyToChart();
  renderScenario();
}

function flyToChart() {
  if (reduced) return;
  const src = $('#vitrine-obj');
  const a = src.getBoundingClientRect();
  const b = sky.centerRect();
  if (!a.width || !b.width || b.bottom < 0 || b.top > innerHeight) return;
  const ghost = el('img', { class: 'flyer', src: src.currentSrc || src.src, alt: '' });
  Object.assign(ghost.style, { left: `${a.left}px`, top: `${a.top}px`, width: `${a.width}px`, height: `${a.height}px` });
  document.body.append(ghost);
  const scale = Math.min((b.width * .78) / a.width, (b.height * .78) / a.height);
  const dx = b.left + b.width / 2 - (a.left + a.width / 2);
  const dy = b.top + b.height / 2 - (a.top + a.height / 2);
  sky.hideCenter(true);
  ghost.animate([{ transform: 'none' }, { transform: `translate(${dx}px, ${dy}px) scale(${scale})` }], { duration: 950, easing: 'cubic-bezier(.65,0,.25,1)' })
    .finished.then(() => { sky.hideCenter(false); ghost.remove(); }, () => { sky.hideCenter(false); ghost.remove(); });
}

function selectionText() {
  return D.groups.filter(g => g.chips.some(c => D.chips.has(c.key)))
    .map(g => `${g.label} ${g.chips.filter(c => D.chips.has(c.key)).map(c => c.value).join(', ')}`).join(' · ');
}
function composeNote(model) {
  const ps = store.pool?.metadata?.scoring?.interestWeight ?? .4;
  const parts = [];
  const sel = selectionText();
  if (!sel) parts.push('끌리는 점을 고르지 않아, 고른 유물과 얼마나 가까운지(임베딩 유사도)만으로 순위를 매긴 여섯 점입니다.');
  else {
    const n = D.chips.size;
    parts.push(`${sel}${hasBatchim(sel) ? '을' : '를'} 관심 조건으로 더해 다시 순위를 매겼습니다. 점수 = ${(1 - ps).toFixed(1)} × 고른 유물과의 유사도 + ${ps.toFixed(1)} × ${n > 1 ? `고른 속성 ${n}개와의 유사도 평균` : '고른 속성과의 유사도'}.`);
  }
  if (RECOMMEND_TEMPERATURE > 0) parts.push(`temperature ${RECOMMEND_TEMPERATURE}로 후보 안에서 확률에 따라 뽑았습니다.`);
  return parts.join(' ');
}

function renderScenario() {
  const model = recommend();
  D.model = model;
  const seed = store.demo.catalog[D.seed];
  const seedAttrs = new Set(seed.attributes.map(a => `${a.relation}|${a.value}`));
  const { famList } = sky.update(model.recs, { seedAttrs, boosted: model.boostedKeys });
  $('#lens-note').textContent = composeNote(model);
  $('#chart-empty').hidden = model.recs.length > 0;
  renderReading(famList, model.boostedKeys);
  renderFinds(model.recs, baseHeads());
  syncFilterState();
  $('#curate-toggle').hidden = !model.recs.length;
  if (D.curator) {
    if (!model.recs.length) toggleCurator(false);
    else { sky.setCurator(true); showCurated(Math.min(D.cIndex, model.recs.length - 1)); }
  }
}

function renderReading(famList, boostedKeys) {
  const list = $('#families');
  list.replaceChildren(...famList.map(f => {
    const meta = FAMILIES[f.family];
    const bar = el('button', { class: 'family-bar', type: 'button', 'aria-label': `${meta.label} 관계 비중 ${pct(f.total)}` },
      el('span', { class: 'name', text: meta.label }), el('span', { class: 'track' }, el('i', { style: { '--w': 0 } })), el('b', { text: pct(f.total) }));
    const on = () => sky.highlight({ family: f.family });
    const off = () => sky.highlight({});
    bar.addEventListener('pointerenter', on);
    bar.addEventListener('pointerleave', off);
    bar.addEventListener('focus', on);
    bar.addEventListener('blur', off);
    const shown = f.values.filter(v => v.weight >= .005);
    const rest = f.values.length - shown.length;
    const vals = el('ul', { class: 'values' },
      shown.map(v => {
        const chip = el('span', { class: `value-chip${boostedKeys.has(v.key) ? ' interest' : ''}`, 'data-key': v.key, tabindex: 0, title: `${REL_LABEL[v.relation] || v.relation} ${v.value}` },
          el('i', { class: `dot${v.shared ? '' : ' hollow'}`, 'aria-hidden': 'true' }), el('span', { text: v.value }), el('small', { text: pct(v.weight) }));
        chip.addEventListener('pointerenter', () => sky.highlight({ value: v.key }));
        chip.addEventListener('pointerleave', off);
        chip.addEventListener('focus', () => sky.highlight({ value: v.key }));
        chip.addEventListener('blur', off);
        return el('li', {}, chip);
      }),
      rest > 0 ? el('li', { class: 'more-values', text: `그 밖 ${rest}개` }) : null);
    return el('li', { class: 'family', style: { '--c': meta.color } }, bar, vals);
  }));
  raf2(() => $$('.track i', list).forEach((i, k) => i.style.setProperty('--w', famList[k].total.toFixed(4))));
}

// A photo plate: the warm pool of light the photo multiplies into (studio backdrops melt away,
// the artifact itself is never cropped), or the material glyph when there is no photo yet.
function plate(item, cls, full = false) {
  const photo = photoFor(item);
  if (!photo) return el('span', { class: `${cls} blank` }, el('span', { class: 'plate-glyph', 'aria-hidden': 'true', text: glyphFor(item) }), el('small', { text: '사진 미수록' }));
  return el('span', { class: cls }, el('img', { src: full ? photo.image : photo.thumb || photo.image, alt: '', loading: 'lazy', decoding: 'async' }));
}

function renderFinds(recs, baseList) {
  const host = $('#finds');
  if (!recs.length) {
    host.replaceChildren(el('li', { class: 'finds-empty', text: '추천 자료를 불러오지 못했습니다.' }));
    return;
  }
  host.replaceChildren(...recs.map((r, i) => {
    const why = r.explanationEdges.slice(0, 3)
      .map(e => el('span', { style: { '--c': FAMILIES[familyOf(e.relation)].color }, title: `${REL_LABEL[e.relation] || e.relation} ${e.value}`, text: e.value }));
    const flags = [];
    if (D.chips.size) {
      if (r.chipMatches) flags.push(el('span', { class: 'flag interest', text: r.chipMatches === D.chips.size ? '고른 속성 모두 지님' : `고른 속성 ${r.chipMatches}개 지님` }));
      const j = baseList.indexOf(r.headKey);
      if (j < 0) flags.push(el('span', { class: 'flag new', text: '새로 등장' }));
      else flags.push(el('span', { class: 'flag', text: j > i ? `${j - i}계단 위로` : j < i ? `${i - j}계단 아래로` : '순위 그대로' }));
    }
    const btn = el('button', { class: 'find', type: 'button', 'data-key': r.headKey, 'aria-label': `추천 ${i + 1}위 ${r.name}. 자세히 보기` },
      plate(r, 'find-plate'),
      el('span', { class: 'find-copy' },
        el('span', { class: 'find-head' }, el('span', { class: 'find-rank', 'aria-hidden': 'true', text: HANJA_NUM[i] }), el('span', { class: 'find-name', text: r.name })),
        el('span', { class: 'find-meta', text: metaLine(r) }),
        el('span', { class: 'find-why' }, why),
        flags.length ? el('span', { class: 'find-flags' }, flags) : null));
    btn.addEventListener('pointerenter', () => sky.highlight({ rec: r.headKey }));
    btn.addEventListener('pointerleave', () => sky.highlight({}));
    btn.addEventListener('focus', () => sky.highlight({ rec: r.headKey }));
    btn.addEventListener('blur', () => sky.highlight({}));
    btn.addEventListener('click', () => openArtifact(r, { rank: i + 1, rec: r }));
    return el('li', { style: { '--i': i } }, btn);
  }));
}

/* Curator mode: the ring straightens into a walking line and one artifact at a time
   stands under the spotlight with the reasons it was chosen. */
const CURATOR_AUTOPLAY_MS = 6500;
function initCurator() {
  $('#curate-toggle').addEventListener('click', () => toggleCurator());
  $('#cur-prev').addEventListener('click', () => { showCurated(D.cIndex - 1); restartAuto(); });
  $('#cur-next').addEventListener('click', () => { showCurated(D.cIndex + 1); restartAuto(); });
  $('#cur-auto').addEventListener('click', () => setAuto(!D.auto));
  document.addEventListener('keydown', e => {
    if (!D.curator || document.querySelector('dialog[open]')) return;
    if (e.target.closest('input, textarea, [role="radiogroup"]')) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); showCurated(D.cIndex + 1); restartAuto(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); showCurated(D.cIndex - 1); restartAuto(); }
    else if (e.key === 'Escape') toggleCurator(false);
  });
}
function toggleCurator(on = !D.curator) {
  if (on && !D.model?.recs.length) return;
  D.curator = on;
  const btn = $('#curate-toggle');
  btn.setAttribute('aria-pressed', String(on));
  btn.textContent = on ? '원형으로 보기' : '순서대로 보기';
  $('#theater').classList.toggle('curating', on);
  $('#curator').hidden = !on;
  sky.setCurator(on);
  if (on) showCurated(0);
  else { setAuto(false); sky.setCurrent(null); }
}
function setAuto(on) {
  clearInterval(D.auto);
  D.auto = on && D.curator ? setInterval(() => showCurated(D.cIndex + 1), CURATOR_AUTOPLAY_MS) : null;
  $('#cur-auto').setAttribute('aria-pressed', String(Boolean(D.auto)));
  $('#cur-auto').textContent = D.auto ? '자동 넘김 멈춤' : '자동 넘김';
}
function restartAuto() { if (D.auto) setAuto(true); }
function curatorNote(r) {
  const seed = store.demo.catalog[D.seed];
  const seedName = SHORT[D.seed] || seed.name;
  const [e1, e2] = r.explanationEdges;
  if (!e1) return '이 유물에는 해설에 쓸 연결이 없습니다.';
  const lab = e => `${REL_PROSE[e.relation] || e.relation} ‘${e.value}’`;
  let s = `이 유물을 고른 가장 큰 이유는 ${lab(e1)}입니다.`;
  if (e2) s += ` 그다음은 ${lab(e2)}입니다.`;
  const shared = r.sharedAttributes.map(a => a.value);
  const wa = hasBatchim(seedName) ? '과' : '와';
  if (shared.length) {
    const list = shared.slice(0, 3).join(', ') + (shared.length > 3 ? ' 등' : '');
    s += ` ${seedName}${wa} ${list}${hasBatchim(list) ? '을' : '를'} 함께 지녔습니다.`;
  } else s += ` ${seedName}${wa} 겹치는 속성은 없지만, 모델이 배운 연결에서 가깝게 놓였습니다.`;
  if (D.chips.size && r.chipMatches) s += ` 고른 끌리는 점 가운데 ${r.chipMatches}개를 지녔습니다.`;
  return s;
}
function showCurated(i) {
  const recs = D.model?.recs || [];
  if (!recs.length) return;
  const n = recs.length;
  D.cIndex = ((i % n) + n) % n;
  const r = recs[D.cIndex];
  sky.setCurrent(r.headKey);
  const stage = $('#curator-stage');
  stage.replaceChildren(el('span', { class: 'cur-spot', 'aria-hidden': 'true' }), plate(r, 'cur-plate', true), el('span', { class: 'cur-shadow', 'aria-hidden': 'true' }));
  if (!reduced) stage.animate([{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], { duration: 520, easing: 'cubic-bezier(.2,.7,.1,1)' });
  $('#curator-step').textContent = `${HANJA_NUM[D.cIndex] || D.cIndex + 1} · ${D.cIndex + 1}번째로 만날 유물`;
  $('#curator-name').textContent = r.name;
  $('#curator-meta').textContent = [metaLine(r), `${r.institution || '국립중앙박물관'} ${r.id}`].filter(Boolean).join(' · ');
  const desc = (r.description || '').replace(/\s+/g, ' ').trim();
  $('#curator-note').replaceChildren(curatorNote(r), desc ? el('span', { class: 'cur-desc', text: short(desc, 120) }) : null);
  const top = r.explanationEdges.slice(0, 4);
  const max = top[0]?.weight || 1;
  $('#curator-why').replaceChildren(el('li', { class: 'why-caption', text: '해설 비중 (여섯 점 전체를 1로 볼 때)' }), ...top.map(e => el('li', { style: { '--c': FAMILIES[familyOf(e.relation)].color } },
    el('span', { class: 'why-label' }, el('small', { text: REL_PROSE[e.relation] || e.relation }), e.value),
    el('span', { class: 'track' }, el('i', { style: { '--w': (e.weight / max).toFixed(3) } })),
    el('b', { text: pct(e.weight) }))));
  $('#cur-progress').replaceChildren(...recs.map((x, k) => {
    const b = el('button', { type: 'button', class: k === D.cIndex ? 'on' : '', 'aria-label': `${k + 1}번째 유물 보기`, 'aria-current': k === D.cIndex ? 'step' : null });
    b.addEventListener('click', () => { showCurated(k); restartAuto(); });
    return b;
  }), el('span', { class: 'cur-count', text: `${D.cIndex + 1} / ${n}` }));
}

/* Detail sheet with zoom --------------------------------------------------- */
function zoomViewer(src, alt) {
  const img = el('img', { src, alt, draggable: 'false', decoding: 'async' });
  const wrap = el('div', { class: 'zoom' }, img, el('p', { class: 'zoom-hint', text: '누르거나 휠을 굴려 확대, 끌어서 이동' }));
  let s = 1;
  let tx = 0;
  let ty = 0;
  const apply = () => { img.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`; wrap.classList.toggle('zoomed', s > 1.01); };
  const bound = () => { const w = wrap.clientWidth; const h = wrap.clientHeight; tx = clamp(tx, w - w * s, 0); ty = clamp(ty, h - h * s, 0); };
  const zoomAt = (ns, cx, cy) => { ns = clamp(ns, 1, 6); tx = cx - (cx - tx) * ns / s; ty = cy - (cy - ty) * ns / s; s = ns; bound(); apply(); };
  const local = e => { const r = wrap.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  wrap.addEventListener('wheel', e => { e.preventDefault(); const [x, y] = local(e); zoomAt(s * Math.exp(-e.deltaY * .0016), x, y); }, { passive: false });
  let drag = null;
  wrap.addEventListener('pointerdown', e => {
    if (e.button !== 0 || e.target.closest('.zoom-tools')) return;
    drag = { x: e.clientX, y: e.clientY, tx, ty, moved: false };
    wrap.setPointerCapture(e.pointerId);
  });
  wrap.addEventListener('pointermove', e => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 5) return;
    drag.moved = true;
    if (s <= 1.01) return;
    wrap.classList.add('dragging');
    tx = drag.tx + dx;
    ty = drag.ty + dy;
    bound();
    apply();
  });
  wrap.addEventListener('pointerup', e => {
    if (drag && !drag.moved) { const [x, y] = local(e); zoomAt(s > 1.01 ? 1 : 2.6, x, y); }
    drag = null;
    wrap.classList.remove('dragging');
  });
  wrap.addEventListener('pointercancel', () => { drag = null; wrap.classList.remove('dragging'); });
  const tool = (label, aria, fn) => el('button', { type: 'button', 'aria-label': aria, text: label, onclick: fn });
  wrap.append(el('div', { class: 'zoom-tools' },
    tool('+', '확대', () => zoomAt(s * 1.6, wrap.clientWidth / 2, wrap.clientHeight / 2)),
    tool('−', '축소', () => zoomAt(s / 1.6, wrap.clientWidth / 2, wrap.clientHeight / 2)),
    tool('↺', '원래 크기', () => { s = 1; tx = 0; ty = 0; apply(); })));
  return wrap;
}

function showSheet(dialog) {
  if (!dialog.open) dialog.showModal();
}
function openArtifact(item, extra = {}) {
  const cat = store.items.get(keyOf(item)) || store.demo?.catalog?.[item.id];
  const name = item.name || cat?.name || item.id;
  const photo = photoFor(item);
  const media = photo
    ? zoomViewer(photo.image, `${name}, ${item.institution || '국립중앙박물관'} ${item.id}`)
    : el('div', { class: 'blank-photo' }, el('span', { 'aria-hidden': 'true', text: glyphFor(item) }), el('p', { text: '이 유물의 사진은 아직 확보하지 못했습니다.' }));
  const patterns = item.pattern || (cat ? attrValues(cat, '문양').join(', ') : '');
  const kind = item.kind || item.classification || (cat ? [attrValues(cat, '유물분류 2')[0], attrValues(cat, '유물분류 4')[0]].filter(Boolean).join(' · ') : '');
  const hall = cat?.hall ? cat.hall.split('-').slice(1).join(' ') : '';
  const rows = [
    ['소장기관', item.institution || cat?.institution || '국립중앙박물관'],
    ['소장품번호', item.id],
    ['시대', eraOrNation({ ...cat, ...item })],
    ['재질', [item.material || cat?.material, item.materialDetail || cat?.materialDetail].filter(Boolean).join(' · ')],
    ['문양', patterns],
    ['분류', kind],
    ['전시 위치', hall],
  ].filter(([, v]) => v);
  const copy = el('div', { class: 'detail-copy' },
    el('h2', { id: 'artifact-title', text: name }),
    el('dl', {}, rows.map(([k, v]) => [el('dt', { text: k }), el('dd', { text: v })])),
    cat?.description ? el('p', { class: 'detail-desc', text: cat.description }) : null);
  if (extra.rec?.explanationEdges?.length) {
    const edges = [...extra.rec.explanationEdges].sort((a, b) => b.weight - a.weight);
    copy.append(el('div', { class: 'detail-edges' },
      el('h3', { text: '이 유물로 이어진 해설 연결 (추천 여섯 점 전체 대비 비중)' }),
      el('ul', {}, edges.map(e => el('li', {}, el('span', { class: 'value-chip', style: { '--c': FAMILIES[familyOf(e.relation)].color } },
        el('span', { class: 'rel', text: REL_LABEL[e.relation] || e.relation }), el('span', { text: e.value }), el('small', { text: pct(e.weight) })))))));
  }
  if (photo) {
    const scope = photo.license?.scope === 'collection_record' ? ' 이용조건은 e뮤지엄 소장품 레코드의 공공누리 표시를 기준으로 합니다.' : '';
    copy.append(el('p', { class: 'detail-license', text: `사진 제공: ${photo.credit || '국립중앙박물관'} · ${licenseLabel(photo.license)}.${scope}` }));
  }
  const links = el('p', { class: 'detail-links' });
  if (photo?.sourceUrl) links.append(el('a', { href: photo.sourceUrl, target: '_blank', rel: 'noopener noreferrer', text: '공식 소장품 상세정보' }));
  if (photo) links.append(el('a', { href: 'https://www.emuseum.go.kr/copyright', target: '_blank', rel: 'noopener noreferrer', text: '이미지 이용조건' }));
  if (links.childElementCount) copy.append(links);
  $('#artifact-kicker').textContent = extra.rank ? `추천 ${extra.rank}위` : '소장품';
  $('#artifact-body').replaceChildren(el('article', { class: 'artifact-detail' }, media, copy));
  showSheet($('#artifact-dialog'));
}

function openCredits() {
  const rows = [...store.photos.values()].sort((a, b) => String(a.id).localeCompare(String(b.id), 'ko'));
  const list = el('ul', { class: 'credit-list' });
  let shown = 0;
  const more = el('button', { class: 'more', type: 'button', text: '더 보기' });
  const page = () => {
    rows.slice(shown, shown + 200).forEach(r => list.append(el('li', {},
      el('span', { text: `${r.title || ''} · ${r.id || ''}` }),
      r.sourceUrl ? el('a', { href: r.sourceUrl, target: '_blank', rel: 'noopener noreferrer', text: '원문' }) : el('span'),
      el('small', { text: `${r.credit || '국립중앙박물관'} · ${licenseLabel(r.license)}` }))));
    shown = Math.min(rows.length, shown + 200);
    more.hidden = shown >= rows.length;
  };
  more.addEventListener('click', page);
  page();
  $('#credits-body').replaceChildren(
    el('p', { text: `이 페이지의 유물 사진 ${rows.length}점은 국립중앙박물관이 e뮤지엄으로 공개한 실제 소장품 사진입니다. 각 사진은 소장기관과 소장품번호를 확인해 연결했고, 이용조건은 공공누리 표시를 따릅니다.` }),
    el('p', { text: '첫 화면과 진열장의 기준 유물 5점은 원본 사진의 배경을 지워 사용했습니다. 공공누리 제1유형은 출처를 표시하면 변경 이용을 허락합니다.' }),
    el('p', { text: '첫 화면·이야기·진열장·바닥글의 배경 영상과 이미지, 비단 질감은 생성형 AI로 만든 장식용 그림입니다. 실제 유물이나 장소를 찍은 것이 아닙니다.' }),
    el('p', { text: '첫 화면의 AI 큐레이터 로봇 이미지와 외피가 열리는 영상도 생성형 AI로 만든 연출이며, 실제 기기를 촬영한 것이 아닙니다. 영상 뒤의 가중치 그래프와 추천 여섯 점은 실제 모델 결과입니다.' }),
    el('p', {}, el('a', { href: 'https://www.emuseum.go.kr/copyright', target: '_blank', rel: 'noopener noreferrer', text: 'e뮤지엄 저작권 정책' })),
    list,
    el('div', { class: 'collection-more' }, more));
  showSheet($('#credits-dialog'));
}

function initSheets() {
  $$('dialog.sheet').forEach(d => {
    $$('[data-close]', d).forEach(b => b.addEventListener('click', () => d.close()));
    d.addEventListener('click', e => {
      if (e.target !== d) return;
      const r = d.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) d.close();
    });
  });
  // Optional chaining: a page and script from different deploys must not stop the boot here.
  $('#credits-open')?.addEventListener('click', openCredits);
  const poster = () => showSheet($('#poster-dialog'));
  $('#poster-open')?.addEventListener('click', poster);
  $('#poster-frame')?.addEventListener('click', poster);
}

/* Collection: filters, search, batches -------------------------------------- */
const COLL = { era: 'all', mat: 'all', q: '', list: [], shown: 0, batch: 24 };
const norm = s => String(s || '').normalize('NFKC').replace(/\s+/g, '').toLowerCase();
function materialGroup(item) {
  const md = item.materialDetail || '';
  const m = item.material || '';
  if (md.includes('청자')) return '청자';
  if (md.includes('백자')) return '백자';
  if (md.includes('분청')) return '분청사기';
  if (m === '토제' || /경질|연질|와질|토기/.test(md)) return '토기';
  if (m === '금속' || /동합금|청동|황동|백동/.test(md)) return '금속';
  if (m === '지' || md.includes('종이')) return '종이';
  if (m === '사직' || /^견$|^마$|^면$/.test(md)) return '비단·직물';
  if (m === '나무' || md.includes('목')) return '나무';
  if (!m && !md) return '재질 미상';
  return '그 밖';
}
function initCollection() {
  const items = store.collection;
  $('#collection-total').textContent = items.length.toLocaleString('ko-KR');
  if (!items.length) {
    $('#collection-status').textContent = '소장품 자료를 불러오지 못했습니다. 페이지를 새로고침해 주세요.';
    return;
  }
  items.forEach(it => {
    it._era = it.era || '미상';
    it._mat = materialGroup(it);
    it._q = norm([it.name, it.officialName, it.id, it.era, it.material, it.materialDetail, it.pattern, it.classification, it.kind].join(' '));
  });
  const count = key => items.reduce((m, it) => m.set(it[key], (m.get(it[key]) || 0) + 1), new Map());
  const eras = [...count('_era')].sort((a, b) => b[1] - a[1]);
  const topEras = eras.slice(0, 7).map(([k]) => k);
  const otherEra = eras.length > 7;
  items.forEach(it => { it._eraFacet = topEras.includes(it._era) ? it._era : '그 밖'; });
  const eraFacets = [...topEras, ...(otherEra ? ['그 밖'] : [])];
  const MAT_ORDER = ['청자', '백자', '분청사기', '토기', '금속', '종이', '비단·직물', '나무', '그 밖', '재질 미상'];
  const mats = count('_mat');
  const matFacets = MAT_ORDER.filter(m => mats.has(m));
  const facet = (host, label, values, key, counts) => {
    host.replaceChildren(el('span', { class: 'facet-label', text: label }),
      ...['all', ...values].map(v => {
        const n = v === 'all' ? items.length : counts(v);
        const b = el('button', { type: 'button', 'aria-pressed': String(v === 'all'), 'data-v': v }, v === 'all' ? '전체' : v, el('small', { text: n.toLocaleString('ko-KR') }));
        b.addEventListener('click', () => {
          COLL[key] = v;
          $$('button', host).forEach(x => x.setAttribute('aria-pressed', String(x === b)));
          refilter();
        });
        return b;
      }));
  };
  facet($('#facet-era'), '시대', eraFacets, 'era', v => items.filter(it => it._eraFacet === v).length);
  facet($('#facet-material'), '재질', matFacets, 'mat', v => mats.get(v) || 0);
  let timer;
  $('#collection-search').addEventListener('input', e => {
    clearTimeout(timer);
    timer = setTimeout(() => { COLL.q = norm(e.target.value); refilter(); }, 120);
  });
  // Explicit "more" only: auto-loading thousands of plates would push the rest of the page out of reach.
  $('#load-more').addEventListener('click', () => renderPlates());
  refilter();
}
function refilter() {
  const items = store.collection;
  COLL.list = items.filter(it => (COLL.era === 'all' || it._eraFacet === COLL.era) && (COLL.mat === 'all' || it._mat === COLL.mat) && (!COLL.q || it._q.includes(COLL.q)));
  COLL.shown = 0;
  $('#plates').replaceChildren();
  if (!COLL.list.length) $('#plates').append(el('li', { class: 'empty', text: '찾는 유물이 없습니다. 다른 이름이나 시대로 찾아보세요.' }));
  renderPlates();
}
function renderPlates() {
  const next = COLL.list.slice(COLL.shown, COLL.shown + COLL.batch);
  const frag = document.createDocumentFragment();
  next.forEach((it, k) => {
    const mat = el('span', { class: 'mat' }, el('img', { src: it.thumb || it.image, alt: '', loading: 'lazy', decoding: 'async' }));
    const btn = el('button', { class: 'plate', type: 'button', 'aria-label': `${it.name}, ${[it.era, it.id].filter(Boolean).join(', ')}. 크게 보기` },
      mat, el('span', { class: 'plate-copy' }, el('b', { text: it.name }), el('small', { text: [it.era, it.materialDetail || it.material, it.id].filter(Boolean).join(' · ') })));
    btn.addEventListener('pointermove', e => {
      const r = mat.getBoundingClientRect();
      mat.style.setProperty('--mx', `${((e.clientX - r.left) / r.width * 100).toFixed(1)}%`);
      mat.style.setProperty('--my', `${((e.clientY - r.top) / r.height * 100).toFixed(1)}%`);
    });
    btn.addEventListener('click', () => openArtifact(it));
    frag.append(el('li', { style: { '--i': k } }, btn));
  });
  $('#plates').append(frag);
  COLL.shown += next.length;
  const total = COLL.list.length;
  $('#collection-status').textContent = total ? `${total.toLocaleString('ko-KR')}점 가운데 ${COLL.shown.toLocaleString('ko-KR')}점을 보고 있습니다.` : '';
  const more = $('#load-more');
  more.hidden = COLL.shown >= total;
  more.textContent = `더 보기 (${COLL.shown.toLocaleString('ko-KR')} / ${total.toLocaleString('ko-KR')})`;
}

/* Research and section entrances --------------------------------------------- */
function initResearch() {
  if (reduced) return;
  const io = new IntersectionObserver(entries => entries.forEach(e => {
    if (!e.isIntersecting) return;
    io.unobserve(e.target);
    const dd = e.target;
    const to = Number(dd.dataset.count);
    const t0 = performance.now();
    const tick = t => {
      const k = clamp((t - t0) / 1600, 0, 1);
      dd.textContent = Math.round(to * (1 - (1 - k) ** 3)).toLocaleString('ko-KR');
      if (k < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }), { threshold: .6 });
  $$('#figures dd').forEach(d => io.observe(d));
}
function initReveals() {
  if (reduced) return;
  const targets = $$('.discover-head, .collection-head, .research-copy, .poster');
  const io = new IntersectionObserver(entries => entries.forEach(e => {
    if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  }), { rootMargin: '0px 0px -8% 0px' });
  targets.forEach(t => { if (t.getBoundingClientRect().top > innerHeight) { t.classList.add('reveal'); io.observe(t); } });
}

/* Curator hero ---------------------------------------------------------------------------------
   The museum's AI curator robot (a generated clip, assets/media/curator-explode.mp4) opens its
   shell as the visitor drags the timeline under it; the core in its chest is the LLM. Then the
   CAFE weights of the six artifacts recommended for 청자 상감 매병 plug into that core as a 3D
   bundle: one strand per (artifact, relation, value) edge, width and brightness in proportion to
   its CAFE weight (the same numbers the ring view in 발견 draws), heaviest first. Drag the bundle
   to turn it. Under prefers-reduced-motion (<html data-curator="still">) nothing moves on its own:
   no idle turning, no light pulses; the timeline still works by hand. */

// The core on the clip's last frame, measured on the 1280×720 encode: centre at 50.7% / 49.1%
// of the frame, radius 8.4% of the frame width (the halo reaches about 11.8%).
const CORE_X = .507;
const CORE_Y = .491;
const CORE_R = .084;
// The chest core through the clip: [s, x, y, r] as frame fractions (r of the frame width),
// measured every 0.5 s. Until 2.6 s the shell is closed: the chest centre, no radius.
const CORE_TRACK = [
  [0, .709, .497, 0], [.5, .7045, .497, 0], [1, .6995, .497, 0], [1.5, .691, .496, 0], [2, .682, .496, 0],
  [2.6, .6732, .4928, .0249], [3, .657, .4949, .0273], [3.5, .64, .4965, .0283], [4, .6223, .4976, .0293],
  [4.5, .6039, .4978, .0305], [5, .5859, .4979, .0318], [5.5, .57, .4981, .0338], [6, .5561, .4981, .0366],
  [6.5, .5439, .4977, .0398], [7, .5337, .4976, .0435], [7.5, .5252, .4971, .0477], [8, .5187, .4961, .0527],
  [8.5, .5137, .4953, .0587], [9, .5102, .4943, .0656], [9.5, .5079, .4927, .0741], [10, CORE_X, CORE_Y, CORE_R],
];
const CLIP_END = 10;              // seconds; the track's last row is the clip's last frame
const ROBOT_SPAN = [.045, .89];   // head top and wheels, first frame (fractions of frame height)
// Effect strengths: 0 turns an effect off, 1 is the designed strength.
const CUR_FX = {
  glow: 1,    // the core's ivory glow and pale gold halo, and the gold glow on the heaviest strands
  pulse: 1,   // light pulses running down the strands into the core (count, brightness)
  turn: .07,  // idle turning of the finished bundle, radians per second (0 = still)
  fog: .5,    // how much the far side of the bundle dims (depth cue)
};
const CUR_SEED = '동원1347';      // 청자 상감 매병, the story's artifact
const CUR_PLAY_S = 16;           // the play button runs the whole timeline in this many seconds
const CUR_SMOOTH_MS = 90;        // the timeline eases toward the slider with this time constant
// Timeline (fractions of the slider). The labels under the slider (index.html) follow it.
const CUR_T = {
  clip: [0, .55],     // robot clip, first to last frame; dragging back reassembles it
  nodes: [.58, .7],   // the six recommended artifacts appear around the core
  edges: [.63, .94],  // their CAFE strands plug into the core, heaviest first
};
// 3D bundle, world units: artifacts at distance 1 from the core.
const CUR_3D = { core: .22, node: .12, cam: 4.2, scale: .36, samples: 18 };
const FAMILY_RGB = { time: '214, 178, 94', material: '130, 170, 208', pattern: '216, 116, 92', class: '143, 191, 169', place: '221, 212, 194' };
const CUR_STEPS = [
  ['국립중앙박물관 AI 큐레이터', '아래 막대를 끌면 외피가 열리고, 가슴 속 LLM 코어가 드러납니다.'],
  ['LLM 코어', '해설을 쓰는 언어 모델입니다. 추천의 이유가 이 코어로 전달됩니다.'],
  ['CAFE 가중치 → LLM', '청자 상감 매병을 본 관람객에게 추천한 여섯 점의 속성 연결이 CAFE 가중치만큼 굵고 밝게 코어로 꽂힙니다. 끌어서 돌려 보세요.'],
];

function coreAt(t) {
  const T = CORE_TRACK;
  if (t <= T[0][0]) return T[0];
  for (let i = 1; i < T.length; i++) {
    if (t > T[i][0]) continue;
    const [t0, x0, y0, r0] = T[i - 1];
    const [t1, x1, y1, r1] = T[i];
    const k = (t - t0) / (t1 - t0);
    return [t, x0 + (x1 - x0) * k, y0 + (y1 - y0) * k, r0 + (r1 - r0) * k];
  }
  return T[T.length - 1];
}
const v3 = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  mul: (a, k) => [a[0] * k, a[1] * k, a[2] * k],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  unit: a => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
};
// The six recommended for the seed and their CAFE edges, laid out in 3D. Artifacts sit on a crown
// around the core (alternately above and below); each edge leaves its artifact on its own side of
// a fan, so an artifact's strands open like a bundle and close again at the core.
function curatorBundle() {
  const seed = store.demo?.catalog?.[CUR_SEED];
  if (!seed || !seedPool(CUR_SEED)) return null;
  const { recs } = recommendFor(CUR_SEED, new Set());
  const weights = recs.flatMap(r => r.explanationEdges.map(e => e.weight));
  const lo = Math.min(...weights);
  const hi = Math.max(...weights);
  const { core, node, samples } = CUR_3D;
  const nodes = recs.map((rec, i) => {
    const az = (i * 60 + 30) * Math.PI / 180;
    const el = (i % 2 ? -24 : 24) * Math.PI / 180;
    const pos = [Math.cos(el) * Math.sin(az), -Math.sin(el), Math.cos(el) * Math.cos(az)];
    return { rec, i, pos, photo: photoFor(rec), label: short(rec.name, 9) };
  });
  const strands = [];
  for (const nd of nodes) {
    const u = nd.pos;
    let v = v3.cross(u, [0, 1, 0]);
    if (Math.hypot(...v) < .2) v = v3.cross(u, [1, 0, 0]);
    v = v3.unit(v);
    const w = v3.cross(u, v);
    const edges = nd.rec.explanationEdges;
    edges.forEach((e, j) => {
      const b = (2 * Math.PI * j) / edges.length + nd.i * .9;
      const o = v3.add(v3.mul(v, Math.cos(b)), v3.mul(w, Math.sin(b)));
      const P0 = v3.add(v3.mul(u, 1 - node * .8), v3.mul(o, node * .45));
      const P1 = v3.add(v3.mul(u, .68), v3.mul(o, .34));
      const P2 = v3.add(v3.mul(u, .38), v3.mul(o, .26));
      const P3 = v3.mul(v3.unit(v3.add(u, v3.mul(o, .55))), core * 1.02);
      const pts = [];
      for (let k = 0; k <= samples; k++) {
        const t = k / samples;
        const a = (1 - t) ** 3;
        const b2 = 3 * (1 - t) ** 2 * t;
        const c = 3 * (1 - t) * t * t;
        const d = t ** 3;
        pts.push([0, 1, 2].map(m => a * P0[m] + b2 * P1[m] + c * P2[m] + d * P3[m]));
      }
      strands.push({ nd, e, fam: familyOf(e.relation), norm: (e.weight - lo) / Math.max(1e-12, hi - lo), pts, phase: Math.random() });
    });
  }
  // Strands connect heaviest first; each artifact names its heaviest.
  [...strands].sort((a, b) => b.e.weight - a.e.weight).forEach((s, j) => { s.order = j; s.top = j < 3; });
  for (const nd of nodes) strands.filter(s => s.nd === nd).sort((a, b) => b.e.weight - a.e.weight).slice(0, 1).forEach(s => { s.named = true; });
  return { nodes, strands, recs };
}

class CuratorHero {
  constructor(mode) {
    this.still = mode === 'still';
    this.wrap = $('#cur-wrap');
    this.stage = $('#cur-stage');
    this.box = $('#cur-box');
    this.canvas = $('#cur-canvas');
    this.g = this.canvas.getContext('2d');
    this.range = $('#cur-range');
    this.playBtn = $('#cur-play');
    this.tip = $('#cur-tip');
    this.plaques = { robot: $('#cur-plaque-robot'), core: $('#cur-plaque-core') };
    this.stepEl = $('#cur-step');
    this.step = -1;
    this.net = null;
    this.video = null;
    this.ready = false;
    this.pending = null;
    this.target = 0;
    this.pS = 0;
    this.playing = false;
    this.yaw = .5;
    this.pitch = -.32;
    this.spin = 0;
    this.drag = null;
    this.hover = null;
    this.visible = true;
    this.running = false;
    this.dirty = true;
    this.leaders = [];
    this.pulseSprite = HeroFX.sprite('255, 250, 238', '240, 214, 152', 64, .22);
    new IntersectionObserver(([e]) => { this.visible = e.isIntersecting; this.sync(); }).observe(this.stage);
    document.addEventListener('visibilitychange', () => this.sync());
    new ResizeObserver(() => { this.layout(); this.sync(); }).observe(this.stage);
    this.bindControls();
    this.bindPointer();
    this.layout();
    this.loadVideo();
    document.fonts?.ready.then(() => this.layout());
    this.setStep(0, true);
    this.sync();
  }

  bindControls() {
    const r = this.range;
    const set = v => { this.target = clamp(v, 0, 1); this.paint(); this.sync(); };
    r.addEventListener('input', () => { this.setPlaying(false); this.wrap.classList.add('touched'); set(r.value / 1000); });
    // iOS shows seeked frames only after the clip has played once inside a gesture.
    r.addEventListener('pointerdown', () => { this.video?.play().then(() => this.video.pause()).catch(() => {}); }, { once: true });
    this.playBtn.addEventListener('click', () => {
      this.wrap.classList.add('touched');
      if (!this.playing && this.target >= .999) { this.target = 0; this.pS = 0; }
      this.setPlaying(!this.playing);
    });
  }
  setPlaying(on) {
    this.playing = on;
    this.playBtn.setAttribute('aria-pressed', String(on));
    this.playBtn.setAttribute('aria-label', on ? '멈춤' : '자동으로 재생');
    this.sync();
  }
  // The slider's fill and value follow the timeline (also while the play button runs it).
  paint() {
    this.range.style.setProperty('--p', this.target.toFixed(4));
    const v = String(Math.round(this.target * 1000));
    if (this.range.value !== v) this.range.value = v;
    this.range.setAttribute('aria-valuetext', CUR_STEPS[this.target < .22 ? 0 : this.target < .6 ? 1 : 2][0]);
  }

  bindPointer() {
    const c = this.canvas;
    const at = e => { const r = c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    c.addEventListener('pointerdown', e => {
      if (!this.live) return;
      const [x, y] = at(e);
      this.drag = { x, y, x0: x, y0: y, t: performance.now(), moved: false };
      this.spin = 0;
      c.setPointerCapture(e.pointerId);
      c.classList.add('dragging');
      this.sync();
    });
    c.addEventListener('pointermove', e => {
      const [x, y] = at(e);
      if (this.drag) {
        const dx = x - this.drag.x;
        const dy = y - this.drag.y;
        const now = performance.now();
        this.yaw += dx * .008;
        this.pitch = clamp(this.pitch + dy * .006, -1.1, 1.1);
        this.spin = (dx * .008) / Math.max(8, now - this.drag.t) * 1000;
        Object.assign(this.drag, { x, y, t: now });
        if (Math.hypot(x - this.drag.x0, y - this.drag.y0) > 4) this.drag.moved = true;
        this.hover = null;
        this.showTip(null);
      } else if (this.live) this.pick(x, y);
      this.dirty = true;
      this.sync();
    });
    const end = e => {
      if (!this.drag) return;
      const { moved } = this.drag;
      this.drag = null;
      c.classList.remove('dragging');
      if (!moved) {
        const [x, y] = at(e);
        this.pick(x, y);
        const nd = this.hover?.node || this.hover?.strand?.nd;
        if (nd) openArtifact(nd.rec, { rank: nd.i + 1, rec: nd.rec });
      }
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('pointerleave', () => { if (!this.drag) { this.hover = null; this.showTip(null); this.dirty = true; } });
  }
  // Nearest artifact or strand under the pointer, from the last frame's screen positions.
  pick(x, y) {
    let best = null;
    let dmin = 10;
    for (const nd of this.net?.nodes || []) {
      if (!nd.scr) continue;
      const d = Math.hypot(x - nd.scr[0], y - nd.scr[1]) - nd.scr[2];
      if (d < dmin) { dmin = d; best = { node: nd }; }
    }
    if (!best) {
      for (const s of this.net?.strands || []) {
        if (!s.scr) continue;
        for (const [px, py] of s.scr) {
          const d = Math.hypot(x - px, y - py);
          if (d < dmin) { dmin = d; best = { strand: s }; }
        }
      }
    }
    this.hover = best;
    this.canvas.classList.toggle('pointing', Boolean(best));
    if (!best) { this.showTip(null); return; }
    if (best.node) {
      const r = best.node.rec;
      const total = this.net.strands.filter(s => s.nd === best.node).reduce((a, s) => a + s.e.weight, 0);
      this.showTip(x, y, `추천 ${best.node.i + 1}위 · ${r.name}`, `이 유물이 코어에 넘기는 CAFE 가중치 합 ${pct(total)} · 눌러서 자세히`);
    } else {
      const { e, nd } = best.strand;
      this.showTip(x, y, `${REL_LABEL[e.relation] || e.relation} · ${e.value}`, `${nd.label}에서 LLM 코어로 · CAFE 가중치 ${pct(e.weight)}`);
    }
  }
  showTip(x, y, title, text) {
    const t = this.tip;
    if (x == null) { t.classList.remove('on'); return; }
    t.replaceChildren(el('b', { text: title }), el('span', { text }));
    t.classList.add('on');
    const w = t.offsetWidth;
    const h = t.offsetHeight;
    const G = this.geo;
    t.style.transform = `translate3d(${clamp(x + 14, 4, G.W - w - 4).toFixed(0)}px, ${clamp(y - h - 12, 4, G.H - h - 4).toFixed(0)}px, 0)`;
  }

  layout() {
    const r = this.stage.getBoundingClientRect();
    const W = r.width;
    const H = r.height;
    if (!W || !H) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.dpr = dpr;
    this.canvas.width = Math.round(W * dpr);
    this.canvas.height = Math.round(H * dpr);
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const S = Math.min(W, H);
    const A = { x: W / 2, y: H / 2 };
    const cy0 = CORE_TRACK[0][2];
    const H0 = Math.min((A.y - 4) / (cy0 - ROBOT_SPAN[0]), (H - 4 - A.y) / (ROBOT_SPAN[1] - cy0));
    const W0 = H0 * 16 / 9;
    const U = CUR_3D.scale * S;
    // The clip pushes in on the core; the box shrinks as it plays so the clip's core ends exactly
    // as large as the bundle's core.
    const coreEnd = CUR_3D.core * U;
    this.geo = { W, H, S, A, U, W0, W1: coreEnd / CORE_R, coreEnd, nodeR: CUR_3D.node * U, fs: clamp(S * .02, 11, 13.5) };
    this.box.classList.add('placed');
    this.box.style.setProperty('--bw', `${W0.toFixed(1)}px`);
    this.box.style.setProperty('--bh', `${H0.toFixed(1)}px`);
    this.boxKey = '';
    this.size = Object.fromEntries(Object.entries(this.plaques).map(([k, n]) => [k, [n.offsetWidth, n.offsetHeight]]));
    for (const nd of this.net?.nodes || []) nd.sprite = null;
    this.dirty = true;
  }

  loadVideo() {
    const small = matchMedia('(max-width: 900px)').matches;
    const src = (small && this.wrap.dataset.videoMobile) || this.wrap.dataset.video;
    const v = el('video', { class: 'cur-video', muted: true, playsinline: true, preload: 'auto', 'aria-hidden': 'true' });
    v.muted = true;
    this.box.append(v);
    this.video = v;
    v.addEventListener('seeked', () => {
      if (this.pending == null) return;
      const t = this.pending;
      this.pending = null;
      if (Math.abs(v.currentTime - t) > .02) v.currentTime = t;
    });
    // A Blob URL keeps every frame seekable even where the server ignores Range requests.
    fetch(src).then(r => { if (!r.ok) throw new Error(String(r.status)); return r.blob(); }).then(blob => {
      v.addEventListener('loadeddata', () => { this.ready = true; v.classList.add('ready'); this.dirty = true; this.sync(); }, { once: true });
      v.src = URL.createObjectURL(blob);
    }).catch(() => v.remove());
  }

  setData() {
    this.net = curatorBundle();
    if (!this.net) return;
    for (const nd of this.net.nodes) {
      if (!nd.photo) continue;
      const img = new Image();
      img.decoding = 'async';
      img.addEventListener('load', () => { nd.img = img; nd.sprite = null; this.dirty = true; this.sync(); }, { once: true });
      img.src = nd.photo.thumb || nd.photo.image;
    }
    this.dirty = true;
    this.sync();
  }

  sync() {
    const go = this.visible && !document.hidden;
    if (go && !this.running) {
      this.running = true;
      this.prev = 0;
      requestAnimationFrame(t => this.loop(t));
    } else if (!go) this.running = false;
  }
  loop(now) {
    if (!this.running) return;
    const dt = this.prev ? Math.min(64, now - this.prev) : 16.7;
    this.prev = now;
    let moving = this.dirty;
    if (this.playing) {
      this.target = Math.min(1, this.target + dt / (CUR_PLAY_S * 1000));
      this.paint();
      if (this.target >= 1) this.setPlaying(false);
      moving = true;
    }
    const d = this.target - this.pS;
    if (Math.abs(d) < 1e-4) this.pS = this.target;
    else { this.pS += d * (1 - Math.exp(-dt / CUR_SMOOTH_MS)); moving = true; }
    // The finished bundle keeps turning (and its pulses flowing) unless reduced motion is asked for.
    if (this.pS >= CUR_T.clip[1] - .06) {
      if (!this.drag) {
        if (Math.abs(this.spin) > .002) { this.yaw += this.spin * dt / 1000; this.spin *= Math.pow(.05, dt / 1000); moving = true; }
        else if (!this.still && !this.hover && this.pS >= CUR_T.edges[1]) this.yaw += CUR_FX.turn * dt / 1000;
      }
      moving ||= !this.still;
    }
    if (moving) this.frame(now);
    requestAnimationFrame(t => this.loop(t));
  }

  state(s) {
    const T = CUR_T;
    const hand0 = T.clip[0] + .9 * (T.clip[1] - T.clip[0]);
    const n = this.net?.strands.length || 1;
    const eSpan = T.edges[1] - T.edges[0] - .07;
    const nSpan = T.nodes[1] - T.nodes[0] - .04;
    return {
      vt: CLIP_END * clamp((s - T.clip[0]) / (T.clip[1] - T.clip[0]), 0, 1),
      handK: smooth(hand0, T.clip[1], s),
      boxAlpha: 1 - smooth(T.clip[1] - .005, T.clip[1] + .02, s),
      robot: 1 - smooth(.09, .14, s),
      core: smooth(.17, .22, s) * (1 - smooth(T.clip[1], T.nodes[0] + .02, s)),
      llmK: smooth(T.clip[1] - .01, T.clip[1] + .03, s),
      appear: nd => smooth(T.nodes[0] + nSpan * nd.i / 5, T.nodes[0] + nSpan * nd.i / 5 + .04, s),
      grow: st => smooth(T.edges[0] + eSpan * st.order / Math.max(1, n - 1), T.edges[0] + eSpan * st.order / Math.max(1, n - 1) + .07, s),
      step: s < .22 ? 0 : s < .6 ? 1 : 2,
    };
  }
  placeBox(t) {
    const G = this.geo;
    const [, x, y, r] = coreAt(t);
    const w = G.W0 * Math.pow(G.W1 / G.W0, clamp(t / CLIP_END, 0, 1));
    const h = w * 9 / 16;
    const bx = G.A.x - x * w;
    const by = G.A.y - y * h;
    const key = `${bx.toFixed(1)} ${by.toFixed(1)} ${w.toFixed(1)}`;
    if (key !== this.boxKey) {
      this.boxKey = key;
      this.box.style.transform = `translate3d(${bx.toFixed(1)}px, ${by.toFixed(1)}px, 0) scale(${(w / G.W0).toFixed(4)})`;
      // Half-percent steps: the feather mask is only re-rasterised when it actually changes.
      // The head top sits 4.5% below the frame's top edge at first; the feather widens as the camera closes in.
      const fy = (Math.round((3 + 11 * smooth(1.2, 5, t)) * 2) / 2).toFixed(1);
      const fx = (Math.round((4 + 8 * smooth(1.5, 6, t)) * 2) / 2).toFixed(1);
      if (fy !== this.fy || fx !== this.fx) {
        this.fy = fy;
        this.fx = fx;
        this.box.style.setProperty('--fy', `${fy}%`);
        this.box.style.setProperty('--fx', `${fx}%`);
      }
    }
    return { x: bx, y: by, w, h, cr: r * w, hx: x };
  }
  seek(t) {
    const v = this.video;
    if (!this.ready || !v) return;
    t = Math.min(t, (v.duration || CLIP_END) - .04);
    if (v.seeking) { this.pending = t; return; }
    if (Math.abs(v.currentTime - t) > .02) v.currentTime = t;
  }
  setStep(i, force = false) {
    if (i === this.step && !force) return;
    this.step = i;
    const [kicker, text] = CUR_STEPS[i];
    const node = this.stepEl;
    node.classList.add('swap');
    clearTimeout(this.stepTimer);
    this.stepTimer = setTimeout(() => {
      node.replaceChildren(el('b', { text: kicker }), el('span', { text }));
      node.classList.remove('swap');
    }, force ? 0 : 260);
  }
  // Writes a style only when its value changes (this runs every frame while the timeline moves).
  css(node, prop, value) {
    const memo = node.__curCss || (node.__curCss = {});
    if (memo[prop] === value) return;
    memo[prop] = value;
    node.style.setProperty(prop, value);
  }

  frame(now) {
    const G = this.geo;
    if (!G) return;
    this.dirty = false;
    const s = this.state(this.pS);
    const b = this.placeBox(this.ready ? s.vt : 0);
    this.seek(s.vt);
    this.css(this.box, 'opacity', s.boxAlpha < 1 ? s.boxAlpha.toFixed(3) : '');
    this.css(this.box, 'filter', s.handK > 0 && s.boxAlpha > 0 ? `brightness(${(1 - .85 * s.handK).toFixed(2)})` : '');
    // The canvas core takes the clip's core over at the same place and size.
    s.coreR = this.ready && this.pS < CUR_T.clip[1] ? b.cr : G.coreEnd;
    this.live = Boolean(this.net) && this.pS >= CUR_T.nodes[0];
    this.canvas.classList.toggle('live', this.live);
    this.placePlaques(b, s);
    this.setStep(s.step);
    this.draw(s, now);
  }
  placePlaques(b, s) {
    const G = this.geo;
    this.leaders = [];
    const put = (key, alpha, x, y, tx, ty, side) => {
      const n = this.plaques[key];
      this.css(n, 'opacity', alpha > .001 ? alpha.toFixed(3) : '0');
      if (alpha <= .001) return;
      const [w, h] = this.size[key];
      // Kept inside the stage; the leader leaves from the edge that faces its target.
      const left = clamp(side > 0 ? x : x - w, 6, G.W - w - 6);
      const top = clamp(y - h / 2, 4, G.H - h - 4);
      this.css(n, 'transform', `translate3d(${left.toFixed(1)}px, ${top.toFixed(1)}px, 0)`);
      if (tx < left - 4) this.leaders.push([left, top + h / 2, tx, ty, alpha]);
      else if (tx > left + w + 4) this.leaders.push([left + w, top + h / 2, tx, ty, alpha]);
      else this.leaders.push([clamp(tx, left + 8, left + w - 8), ty > top + h / 2 ? top + h : top, tx, ty, alpha]);
    };
    // Robot: right of the head (left when the stage is too narrow).
    const hx = b.x + b.hx * b.w;
    const hy = b.y + .13 * b.h;
    const gap = .06 * b.w + 26;
    const right = hx + gap + this.size.robot[0] <= G.W - 8;
    put('robot', s.robot, right ? hx + gap : hx - gap, hy - 6, hx + (right ? 1 : -1) * .05 * b.w, hy, right ? 1 : -1);
    // LLM core: up and to the right of the core.
    const r = Math.max(s.coreR, 6);
    const off = r + Math.max(26, .12 * G.S);
    const cRight = G.A.x + off + this.size.core[0] <= G.W - 8;
    const ang = (cRight ? -38 : -142) * Math.PI / 180;
    put('core', s.core, G.A.x + (cRight ? off : -off), G.A.y - .2 * G.S, G.A.x + Math.cos(ang) * (r + 4), G.A.y + Math.sin(ang) * (r + 4), cRight ? 1 : -1);
  }

  // World → screen: turn by yaw (around the vertical) then pitch, then perspective.
  project(p) {
    const G = this.geo;
    const cy = Math.cos(this.yaw);
    const sy = Math.sin(this.yaw);
    const x1 = p[0] * cy + p[2] * sy;
    const z1 = -p[0] * sy + p[2] * cy;
    const cp = Math.cos(this.pitch);
    const sp = Math.sin(this.pitch);
    const y2 = p[1] * cp - z1 * sp;
    const z2 = p[1] * sp + z1 * cp;
    const k = CUR_3D.cam / (CUR_3D.cam - z2);
    return [G.A.x + x1 * k * G.U, G.A.y + y2 * k * G.U, z2, k];
  }
  draw(s, now) {
    const g = this.g;
    const G = this.geo;
    const t = now / 1000;
    g.clearRect(0, 0, G.W, G.H);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (const [x1, y1, x2, y2, a] of this.leaders) {
      g.strokeStyle = `rgba(214, 178, 94, ${(.7 * a).toFixed(3)})`;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(x1, y1);
      g.lineTo(x2, y2);
      g.stroke();
      g.fillStyle = `rgba(240, 216, 152, ${a.toFixed(3)})`;
      g.beginPath();
      g.arc(x2, y2, 2.4, 0, Math.PI * 2);
      g.fill();
    }
    // Far to near: strands (by their middle), artifacts and the core share one depth order.
    const items = [];
    if (this.net && this.pS >= CUR_T.nodes[0] - .01) {
      const hv = this.hover;
      for (const st of this.net.strands) {
        const f = s.grow(st);
        st.scr = null;
        if (f <= 0 || s.appear(st.nd) <= 0) continue;
        const scr = st.pts.map(p => this.project(p));
        st.scr = scr;
        let hl = 1;
        if (hv?.node) hl = hv.node === st.nd ? 1 : .18;
        else if (hv?.strand) hl = hv.strand === st ? 1 : hv.strand.nd === st.nd ? .45 : .14;
        items.push({ z: scr[CUR_3D.samples >> 1][2], draw: () => this.drawStrand(g, st, scr, f, hl, t) });
      }
      for (const nd of this.net.nodes) {
        const a = s.appear(nd);
        nd.scr = null;
        if (a <= 0) continue;
        const p = this.project(nd.pos);
        const rad = G.nodeR * p[3] * (.6 + .4 * a);
        nd.scr = [p[0], p[1], rad];
        const dim = hv?.node && hv.node !== nd ? .5 : hv?.strand && hv.strand.nd !== nd ? .5 : 1;
        items.push({ z: p[2], draw: () => this.drawNode(g, nd, p, rad, a * dim) });
      }
    }
    if (s.handK > 0) items.push({ z: 0, draw: () => this.drawCore(g, s, t) });
    items.sort((a, b) => a.z - b.z).forEach(it => it.draw());
  }
  fog(z) { return 1 - CUR_FX.fog * clamp((1 - z) / 2, 0, 1); }
  drawStrand(g, st, scr, f, hl, t) {
    const m = CUR_3D.samples;
    const end = f * m;
    const last = Math.floor(end);
    const mid = scr[m >> 1];
    const fog = this.fog(mid[2]);
    const a = (.3 + .6 * st.norm) * fog * hl;
    const width = (1 + 5 * st.norm) * mid[3];
    const path = () => {
      g.beginPath();
      g.moveTo(scr[0][0], scr[0][1]);
      for (let k = 1; k <= last; k++) g.lineTo(scr[k][0], scr[k][1]);
      if (last < m) {
        const u = end - last;
        g.lineTo(scr[last][0] + (scr[last + 1][0] - scr[last][0]) * u, scr[last][1] + (scr[last + 1][1] - scr[last][1]) * u);
      }
    };
    if (st.top && CUR_FX.glow > 0) {
      path();
      g.lineWidth = width + 7;
      g.strokeStyle = `rgba(214, 178, 94, ${(.16 * CUR_FX.glow * fog * hl).toFixed(3)})`;
      g.stroke();
    }
    path();
    g.lineWidth = width;
    g.strokeStyle = `rgba(${FAMILY_RGB[st.fam]}, ${a.toFixed(3)})`;
    g.stroke();
    // Light runs from the artifact into the core: more, brighter and faster on heavier strands.
    if (CUR_FX.pulse > 0 && !this.still) {
      const count = Math.max(1, Math.round((1 + 2 * st.norm) * CUR_FX.pulse));
      const speed = .22 + .4 * st.norm;
      g.globalCompositeOperation = 'lighter';
      for (let j = 0; j < count; j++) {
        const u = (t * speed + j / count + st.phase) % 1;
        if (u > f) continue;
        const k = (.35 + .65 * st.norm) * fog * hl * smooth(0, .08, u) * (1 - smooth(.85, 1, u));
        if (k < .01) continue;
        const pos = u * m;
        const i0 = Math.min(m - 1, Math.floor(pos));
        const w = pos - i0;
        const x = scr[i0][0] + (scr[i0 + 1][0] - scr[i0][0]) * w;
        const y = scr[i0][1] + (scr[i0 + 1][1] - scr[i0][1]) * w;
        const size = (7 + 9 * st.norm) * scr[i0][3];
        g.globalAlpha = Math.min(1, k);
        g.drawImage(this.pulseSprite, x - size / 2, y - size / 2, size, size);
      }
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
    }
    // Each artifact's heaviest strand (and every strand of what is pointed at) carries its attribute.
    const shown = this.hover?.strand === st || this.hover?.node === st.nd || (st.named && !this.hover);
    if (shown && f >= 1) {
      const p = scr[Math.round(m * .28)];
      const fs = this.geo.fs * .92 * clamp(p[3], .85, 1.2);
      g.font = `500 ${fs.toFixed(1)}px "Noto Serif KR", serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.globalAlpha = clamp(fog * (this.hover ? 1 : .9), 0, 1);
      g.lineWidth = 4;
      g.strokeStyle = 'rgba(12, 13, 15, .85)';
      g.strokeText(st.e.value, p[0], p[1]);
      g.fillStyle = `rgb(${FAMILY_RGB[st.fam]})`;
      g.fillText(st.e.value, p[0], p[1]);
      g.globalAlpha = 1;
    }
  }
  drawCore(g, s, t) {
    const a = s.handK;
    const glow = CUR_FX.glow;
    const { x, y } = this.geo.A;
    const R = s.coreR * (this.still ? 1 : 1 + .018 * Math.sin(t * 1.4));
    if (R <= .5) return;
    g.save();
    g.globalCompositeOperation = 'lighter';
    const H = R * 2.7;
    let gr = g.createRadialGradient(x, y, R * .6, x, y, H);
    gr.addColorStop(0, `rgba(226, 192, 120, ${(.2 * glow * a).toFixed(3)})`);
    gr.addColorStop(.45, `rgba(214, 178, 94, ${(.07 * glow * a).toFixed(3)})`);
    gr.addColorStop(1, 'rgba(214, 178, 94, 0)');
    g.fillStyle = gr;
    g.fillRect(x - H, y - H, H * 2, H * 2);
    g.globalCompositeOperation = 'source-over';
    gr = g.createRadialGradient(x, y - R * .08, 0, x, y, R * 1.12);
    gr.addColorStop(0, `rgba(255, 252, 244, ${a.toFixed(3)})`);
    gr.addColorStop(.55, `rgba(250, 240, 218, ${a.toFixed(3)})`);
    gr.addColorStop(.86, `rgba(238, 214, 164, ${(.92 * a).toFixed(3)})`);
    gr.addColorStop(1, 'rgba(230, 200, 140, 0)');
    g.fillStyle = gr;
    g.beginPath();
    g.arc(x, y, R * 1.12, 0, Math.PI * 2);
    g.fill();
    if (s.llmK > 0) {
      g.font = `600 ${Math.max(11, R * .5).toFixed(1)}px "Cormorant Garamond", "Noto Serif KR", serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      if ('letterSpacing' in g) g.letterSpacing = `${(R * .05).toFixed(1)}px`;
      g.fillStyle = `rgba(78, 60, 34, ${(.85 * s.llmK * a).toFixed(3)})`;
      g.fillText('LLM', x, y + R * .04);
      if ('letterSpacing' in g) g.letterSpacing = '0px';
    }
    g.restore();
  }
  // An artifact's photo on a warm plate, multiplied so the studio backdrop melts away (as in the ring view).
  sprite(nd) {
    const R = this.geo.nodeR * 1.45;
    const px = Math.ceil(R * 2 * this.dpr) + 4;
    if (nd.sprite?.width === px) return nd.sprite;
    const c = document.createElement('canvas');
    c.width = c.height = px;
    const g = c.getContext('2d');
    const h = px / 2;
    const r = h - 2;
    g.save();
    g.beginPath();
    g.arc(h, h, r, 0, Math.PI * 2);
    g.clip();
    const gr = g.createRadialGradient(h, h - .08 * r, 0, h, h - .08 * r, r * 1.24);
    gr.addColorStop(0, '#ddd4c3');
    gr.addColorStop(.58, '#8d877c');
    gr.addColorStop(1, '#202124');
    g.fillStyle = gr;
    g.fillRect(0, 0, px, px);
    if (nd.img) {
      const k = (r * 1.84) / Math.max(nd.img.naturalWidth, nd.img.naturalHeight);
      const iw = nd.img.naturalWidth * k;
      const ih = nd.img.naturalHeight * k;
      g.globalCompositeOperation = 'multiply';
      g.drawImage(nd.img, h - iw / 2, h - ih / 2, iw, ih);
    }
    g.restore();
    g.strokeStyle = 'rgba(214, 178, 94, .7)';
    g.lineWidth = Math.max(1, this.dpr);
    g.beginPath();
    g.arc(h, h, r, 0, Math.PI * 2);
    g.stroke();
    nd.sprite = c;
    return c;
  }
  drawNode(g, nd, p, rad, alpha) {
    const fog = this.fog(p[2]);
    const spr = this.sprite(nd);
    const size = (spr.width / this.dpr) * (rad / ((spr.width / 2 - 2) / this.dpr));
    g.globalAlpha = alpha * (.45 + .55 * fog);
    g.drawImage(spr, p[0] - size / 2, p[1] - size / 2, size, size);
    const fs = this.geo.fs;
    g.font = `500 ${fs.toFixed(1)}px "Noto Serif KR", serif`;
    g.textAlign = 'center';
    g.textBaseline = 'top';
    g.lineWidth = 4;
    g.strokeStyle = 'rgba(12, 13, 15, .85)';
    const label = `${HANJA_NUM[nd.i]} ${nd.label}`;
    g.strokeText(label, p[0], p[1] + rad + 5);
    g.fillStyle = 'rgba(240, 233, 218, .95)';
    g.fillText(label, p[0], p[1] + rad + 5);
    g.globalAlpha = 1;
  }
}
function initCuratorHero() {
  const mode = root.dataset.curator;
  if (root.dataset.hero === 'moon' || !mode || !$('#cur-wrap')) return null;
  return new CuratorHero(mode);
}

/* First-visit intro (slot only until the intro video exists) -------------------
   <html data-intro="..."> names the clip. The inline head script covers the page before first
   paint when it will play. The hero loop waits on its first frame and starts the moment the
   intro ends, so an intro whose last frame matches media-src/hero-loop-first-frame.png
   hands over without a cut. */
const INTRO_KEY = 'hc-intro-seen-v1';
function initIntro() {
  if (!root.classList.contains('intro-pending')) return;
  const small = matchMedia('(max-width: 760px)').matches;
  const src = (small && root.dataset.introMobile) || root.dataset.intro;
  const video = el('video', { class: 'intro-video', muted: true, playsinline: true, preload: 'auto', poster: root.dataset.introPoster || null, 'aria-hidden': 'true' });
  video.muted = true;
  const skip = el('button', { class: 'intro-skip', type: 'button', text: '건너뛰기' });
  const wrap = el('div', { class: 'intro', role: 'dialog', 'aria-modal': 'true', 'aria-label': '여는 영상' }, video, skip);
  document.body.append(wrap);
  let done = false;
  const onKey = e => { if (e.key === 'Escape') finish(); };
  function finish() {
    if (done) return;
    done = true;
    try { localStorage.setItem(INTRO_KEY, '1'); } catch { /* storage blocked: the intro may play again */ }
    removeEventListener('keydown', onKey);
    const hv = store.heroVideo;
    if (hv) { hv.currentTime = 0; hv.play().catch(() => {}); }
    root.classList.remove('intro-pending');
    // Replay the hero entrance now that it is actually visible.
    $$('.hero h1 .line, .hero-lede, .cta-begin, .hero-object, .cur-view').forEach(n => { n.style.animation = 'none'; void n.offsetWidth; n.style.animation = ''; });
    wrap.classList.add('leaving');
    setTimeout(() => wrap.remove(), 450);
  }
  addEventListener('keydown', onKey);
  skip.addEventListener('click', finish);
  video.addEventListener('ended', finish);
  video.addEventListener('error', finish);
  setTimeout(finish, 15000);
  video.src = src;
  video.play().then(() => skip.focus({ preventScroll: true })).catch(finish);
}

/* Boot ------------------------------------------------------------------- */
initMasthead();
initIntro();
initHero();
const curator = initCuratorHero();
initSheets();
load().then(() => {
  applyMedia(store.manifest);
  curator?.setData();
  initStory();
  initDiscover();
  initCollection();
  initResearch();
  initReveals();
  root.dataset.ready = 'true';
}).catch(err => {
  console.error(err);
  $('#vitrine-hint').textContent = '자료를 불러오지 못했습니다. 페이지를 새로고침해 주세요.';
});
