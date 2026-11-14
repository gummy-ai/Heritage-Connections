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
const INTEREST_LABEL = { all: '관심 없이 보기', goryeo: '고려의 미감', joseon: '조선의 일상', celadon: '청자의 빛', metal: '금속의 공예' };
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
const store = { manifest: null, demo: null, collection: [], cutouts: {}, photos: new Map() };
const keyOf = item => item.headKey || `artifact::${item.institution || '국립중앙박물관'}::${item.id}`;
const photoFor = item => store.photos.get(keyOf(item));
const licenseLabel = l => (typeof l === 'string' ? l : l?.label || '');

async function getJSON(url) {
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}

async function load() {
  const [manifest, coll, demo, legacy, cutouts] = await Promise.allSettled([
    getJSON('./assets/media/manifest.json'),
    getJSON('./assets/collection.json'),
    getJSON('./assets/recommendations.json'),
    getJSON('./assets/legacy-images.json'),
    getJSON('./assets/cutouts/cutouts.json'),
  ]);
  if (manifest.status === 'fulfilled') store.manifest = manifest.value;
  if (demo.status === 'fulfilled') store.demo = demo.value;
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
  new Dust($('#hero-dust'), { density: .9, pointerTarget: $('#top') });
  if (reduced) return;
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
function mountMedia(slot, spec) {
  if (!slot || !spec) return false;
  if (spec.video && !reduced) {
    const v = el('video', { muted: true, loop: true, playsinline: true, autoplay: true, preload: 'auto', poster: spec.poster || spec.image || null });
    v.muted = true;
    v.addEventListener('loadeddata', () => v.classList.add('ready'), { once: true });
    v.src = spec.video;
    slot.append(v);
    v.play().catch(() => {});
    return true;
  }
  const src = spec.image || spec.poster;
  if (!src) return false;
  const img = el('img', { src, alt: '', decoding: 'async' });
  img.addEventListener('load', () => img.classList.add('ready'), { once: true });
  slot.append(img);
  return true;
}
function applyMedia(m) {
  if (!m) return;
  if (mountMedia($('#hero-slot'), m.hero)) $('#top').classList.add('has-media');
  mountMedia($('#vitrine-slot'), m.vitrine);
  if (m.textures?.silk) root.style.setProperty('--grain', `url("${m.textures.silk}")`);
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
  if (!spec?.video || reduced) return;
  const small = matchMedia('(max-width: 760px), (pointer: coarse)').matches;
  const url = small && spec.videoMobile ? spec.videoMobile : spec.video;
  const video = el('video', { muted: true, playsinline: true, preload: 'auto', poster: spec.poster || null });
  video.muted = true;
  $('#story-slot').append(video);
  video.addEventListener('seeked', () => {
    if (film.pending == null) return;
    const t = film.pending;
    film.pending = null;
    video.currentTime = t;
  });
  // Blob URLs keep currentTime seekable even when the server ignores Range requests.
  fetch(url).then(r => { if (!r.ok) throw new Error(String(r.status)); return r.blob(); }).then(blob => {
    video.addEventListener('loadeddata', () => {
      film.video = video;
      film.ready = true;
      video.classList.add('ready');
      $('#story').classList.add('has-film');
      seekFilm(film.target);
    }, { once: true });
    video.src = URL.createObjectURL(blob);
  }).catch(() => video.remove());
  addEventListener('touchstart', () => { video.play().then(() => video.pause()).catch(() => {}); }, { once: true, passive: true });
}

function pickStoryRecs(demo, seedId) {
  const pool = [];
  const seen = new Set();
  for (const k of ['celadon', 'all', 'goryeo', 'joseon', 'metal']) {
    for (const r of demo?.scenarios?.[`${seedId}|${k}`]?.recommendations || []) {
      if (!seen.has(r.id)) { seen.add(r.id); pool.push({ ...demo.catalog[r.id], ...r }); }
    }
  }
  const sharesPattern = (r, v) => r.sharedAttributes?.some(a => a.relation === '문양' && (!v || a.value === v));
  const tests = {
    time: r => r.era === '고려',
    material: r => r.materialDetail === '청자',
    pattern: r => sharesPattern(r, '매화') || sharesPattern(r),
  };
  const used = new Set();
  const out = {};
  for (const fam of ['pattern', 'time', 'material']) {
    const cands = pool.filter(r => !used.has(r.id) && tests[fam](r));
    const best = (fam === 'pattern' && cands.find(r => sharesPattern(r, '매화') && photoFor(r)))
      || cands.find(r => photoFor(r)) || cands[0];
    if (best) { used.add(best.id); out[fam] = best; }
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
    wide: {
      vb: [1600, 900], obj: { cx: 1120, cy: 470, h: 520 },
      seals: [[1300, 170], [1340, 520], [720, 380]], sides: ['left', 'left', 'right'],
      anchors: [[.5, .04], [.95, .55], [.06, .42]], recs: [[1500, 330], [1390, 760], [800, 700]],
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
  if (reduced) { scene.set(1); return; }
  root.classList.add('pinned');
  initFilm(store.manifest?.story);
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
const C = { center: 82, tickIn: 96, tickOut: 106, ringA: 92, ringB: 112, famLabel: 132, arc: 154, star: 206, rec: 392, recR: 44 };

class Constellation {
  constructor(svg, { onOpen, onHighlight }) {
    this.svg = svg;
    this.onOpen = onOpen;
    this.onHighlight = onHighlight;
    this.stars = new Map();
    this.recs = new Map();
    this.data = null;
    const defs = sv('defs', {},
      sv('radialGradient', { id: 'c-center-fill' }, sv('stop', { offset: '0', 'stop-color': '#252c33' }), sv('stop', { offset: '1', 'stop-color': '#0e1012' })),
      sv('radialGradient', { id: 'c-glow' }, sv('stop', { offset: '0', 'stop-color': 'rgba(255, 236, 196, .22)' }), sv('stop', { offset: '1', 'stop-color': 'rgba(255, 236, 196, 0)' })),
      sv('clipPath', { id: 'c-clip' }, sv('circle', { r: C.recR })));
    this.L = {};
    for (const name of ['static', 'arcs', 'spokes', 'links', 'stars', 'labels', 'recs', 'center']) this.L[name] = sv('g', {});
    svg.append(defs, ...Object.values(this.L));
    this.drawStatic();
    this.drawCenter();
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
    g.append(sv('circle', { r: C.center + 30, fill: 'url(#c-glow)' }), sv('circle', { class: 'disk', r: C.center }), this.centerImg);
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

  update(sc, { seedAttrs, interestKey, lens }) {
    const values = new Map();
    let maxEdge = 0;
    sc.recommendations.forEach(r => r.explanationEdges.forEach(e => {
      const key = `${e.relation}|${e.value}`;
      if (!values.has(key)) values.set(key, { key, relation: e.relation, value: e.value, family: familyOf(e.relation), weight: 0, shared: seedAttrs.has(key) });
      values.get(key).weight += e.weight;
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
    const maxV = Math.max(...ordered.map(v => v.weight));
    this.data = { values, famList, ordered };
    this.drawArcs(famList, lens);
    this.drawSpokes(ordered, lens);
    this.drawStars(ordered, maxV, interestKey, lens);
    this.drawLabels(ordered, maxV, interestKey);
    this.drawRecs(sc.recommendations);
    this.drawLinks(sc.recommendations, values, maxEdge, lens);
    this.svg.classList.toggle('lensing', Boolean(lens));
    this.highlight({});
    return { famList, ordered };
  }
  drawArcs(famList, lens) {
    const g = this.L.arcs;
    g.replaceChildren();
    famList.forEach((f, i) => {
      const meta = FAMILIES[f.family];
      const [x0, y0] = P(f.start, C.arc);
      const [x1, y1] = P(f.end, C.arc);
      const lensCls = lens === f.family ? ' lens' : '';
      const path = sv('path', { class: `c-arc${lensCls}`, 'data-family': f.family, style: { '--c': meta.color },
        d: `M${x0.toFixed(1)},${y0.toFixed(1)} A${C.arc},${C.arc} 0 ${f.end - f.start > 180 ? 1 : 0} 1 ${x1.toFixed(1)},${y1.toFixed(1)}` });
      g.append(path);
      this.draw(path, 250 + i * 110, 900);
      const span = f.end - f.start;
      if (span < 9) return;
      const [lx, ly] = P((f.start + f.end) / 2, C.famLabel);
      g.append(sv('text', { class: `c-famlabel${lensCls}`, 'data-family': f.family, x: lx.toFixed(1), y: ly.toFixed(1), style: { '--c': meta.color },
        text: span > 26 ? `${meta.label} ${pct(f.total)}` : meta.label }));
    });
  }
  drawSpokes(ordered, lens) {
    const g = this.L.spokes;
    g.replaceChildren();
    ordered.filter(v => v.shared).forEach(v => {
      const [x1, y1] = P(v.ang, C.ringB + 4);
      const [x2, y2] = P(v.ang, C.star - 10);
      g.append(sv('line', { class: `c-spoke${lens === v.family ? ' lens' : ''}`, 'data-key': v.key, 'data-family': v.family, x1, y1, x2, y2, style: { '--c': FAMILIES[v.family].color } }));
    });
  }
  drawStars(ordered, maxV, interestKey, lens) {
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
      node.setAttribute('class', `c-star${v.shared ? '' : ' hollow'}${v.key === interestKey ? ' interest' : ''}${lens === v.family ? ' lens' : ''}`);
      node.dataset.key = v.key;
      node.dataset.family = v.family;
      node.style.setProperty('--c', FAMILIES[v.family].color);
      $('.halo', node).setAttribute('r', Math.max(10, r * 2.1).toFixed(1));
      $('.core', node).setAttribute('r', r.toFixed(1));
      let ring = $('.ring', node);
      if (v.key === interestKey) {
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
  drawLabels(ordered, maxV, interestKey) {
    const g = this.L.labels;
    g.replaceChildren();
    // Matches the CSS font size of .c-vlabel (larger on phones).
    const fs = matchMedia('(max-width: 760px)').matches ? 26 : 15;
    const chosen = [...ordered].sort((a, b) => b.weight - a.weight).slice(0, fs > 15 ? 6 : 8);
    const iv = interestKey && ordered.find(v => v.key === interestKey);
    if (iv && !chosen.includes(iv)) chosen.unshift(iv);
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
      g.append(sv('text', { class: `c-vlabel${v.key === interestKey ? ' interest' : ''}`, 'data-key': v.key, 'data-family': v.family, x: x.toFixed(1), y: ty.toFixed(1), 'text-anchor': anchor, text: v.value }));
    });
    if (!reduced) g.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 700, delay: 700, fill: 'backwards' });
  }
  drawRecs(recs) {
    const g = this.L.recs;
    const seen = new Set();
    recs.forEach((r, i) => {
      seen.add(r.id);
      const [x, y] = P(-60 + i * 60, C.rec);
      let node = this.recs.get(r.id);
      const fresh = !node;
      if (fresh) {
        node = this.makeRec(r);
        node.style.transform = 'translate(0px, 0px) scale(.25)';
        node.style.opacity = '0';
        g.append(node);
        this.recs.set(r.id, node);
      }
      const name = $('.name', node);
      const meta = $('.meta', node);
      const above = y < -40;
      name.setAttribute('y', above ? -C.recR - 30 : C.recR + 26);
      meta.setAttribute('y', above ? -C.recR - 12 : C.recR + 44);
      $('.rank', node).textContent = HANJA_NUM[i];
      node.setAttribute('aria-label', `추천 ${i + 1}위 ${name.dataset.full}. 자세히 보기`);
      const apply = () => { node.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`; node.style.opacity = ''; };
      if (fresh && !reduced) { node.style.transitionDelay = `${420 + i * 90}ms`; raf2(apply); } else { node.style.transitionDelay = '0ms'; apply(); }
    });
    for (const [id, node] of this.recs) {
      if (seen.has(id)) continue;
      this.recs.delete(id);
      node.style.transitionDelay = '0ms';
      node.style.opacity = '0';
      node.style.transform = 'translate(0px, 0px) scale(.25)';
      setTimeout(() => node.remove(), 800);
    }
  }
  makeRec(r) {
    const item = { ...store.demo.catalog[r.id], ...r };
    const photo = photoFor(item);
    const bx = -C.recR * .76;
    const node = sv('g', { class: 'c-rec', tabindex: 0, role: 'button', 'data-id': r.id },
      sv('circle', { class: 'disk', r: C.recR }),
      photo ? sv('image', { href: photo.thumb || photo.image, x: -C.recR, y: -C.recR, width: C.recR * 2, height: C.recR * 2, preserveAspectRatio: 'xMidYMid slice', 'clip-path': 'url(#c-clip)' })
        : sv('text', { class: 'glyph', text: glyphFor(item) }),
      sv('circle', { class: 'ring', r: C.recR + 4 }),
      sv('circle', { class: 'badge', cx: bx, cy: bx, r: 12 }),
      sv('text', { class: 'rank', x: bx, y: bx }),
      sv('text', { class: 'name', x: 0, 'data-full': item.name, text: short(item.name, 9) }),
      sv('text', { class: 'meta', x: 0, text: [metaLine(item), photo ? '' : '사진 미수록'].filter(Boolean).join(' · ') }),
      sv('title', { text: item.name }));
    node.addEventListener('pointerenter', () => this.highlight({ rec: r.id }));
    node.addEventListener('pointerleave', () => this.highlight({}));
    node.addEventListener('focus', () => this.highlight({ rec: r.id }));
    node.addEventListener('blur', () => this.highlight({}));
    node.addEventListener('click', () => this.onOpen(r.id));
    node.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.onOpen(r.id); } });
    return node;
  }
  drawLinks(recs, values, maxEdge, lens) {
    const g = this.L.links;
    g.replaceChildren();
    recs.forEach((r, i) => {
      const deg = -60 + i * 60;
      const [rx, ry] = P(deg, C.rec - C.recR - 6);
      const [c2x, c2y] = P(deg, C.rec - C.recR - 80);
      r.explanationEdges.forEach(e => {
        const key = `${e.relation}|${e.value}`;
        const v = values.get(key);
        if (!v) return;
        const [sx, sy] = P(v.ang, C.star);
        const [c1x, c1y] = P(v.ang, C.star + 80);
        const path = sv('path', {
          class: `c-link${lens === v.family ? ' lens' : ''}`, 'data-rec': r.id, 'data-key': key, 'data-family': v.family,
          d: `M${sx.toFixed(1)},${sy.toFixed(1)} C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${rx.toFixed(1)},${ry.toFixed(1)}`,
          'stroke-width': (.6 + 6.5 * e.weight / maxEdge).toFixed(2), style: { '--c': FAMILIES[v.family].color },
        });
        g.append(path);
        this.draw(path, 650 + i * 90, 1100);
      });
    });
  }
  highlight({ rec = null, value = null, family = null } = {}) {
    const on = Boolean(rec || value || family);
    this.svg.classList.toggle('focusing', on);
    const hotKeys = new Set();
    const hotRecs = new Set();
    if (on && this.data) {
      $$('.c-link', this.L.links).forEach(l => {
        const hot = (rec && l.dataset.rec === rec) || (value && l.dataset.key === value) || (family && l.dataset.family === family);
        l.classList.toggle('hot', Boolean(hot));
        if (hot) { hotKeys.add(l.dataset.key); hotRecs.add(l.dataset.rec); }
      });
      if (rec) hotRecs.add(rec);
      if (value) hotKeys.add(value);
    } else $$('.c-link.hot', this.L.links).forEach(l => l.classList.remove('hot'));
    const hotFams = new Set([...hotKeys].map(k => this.data?.values.get(k)?.family));
    if (family) hotFams.add(family);
    for (const [key, node] of this.stars) node.classList.toggle('hot', hotKeys.has(key) || (family != null && node.dataset.family === family));
    for (const [id, node] of this.recs) node.classList.toggle('hot', hotRecs.has(id));
    $$('.c-vlabel, .c-spoke', this.svg).forEach(n => n.classList.toggle('hot', hotKeys.has(n.dataset.key)));
    $$('.c-arc, .c-famlabel', this.svg).forEach(n => n.classList.toggle('hot', hotFams.has(n.dataset.family)));
    this.onHighlight?.({ on, hotKeys, hotRecs });
  }
}

/* Discover: vitrine, plaques, lens, readout ------------------------------- */
const D = { seed: null, interest: 'all', active: false, focus: null, tagKey: null, tags: [], note: '' };
let sky = null;
// Plaques hug the vitrine edges. side: which edge the leader leaves from
// ('left' = plaque sits on the right wall, 'right' = plaque sits on the left wall).
const SLOTS = [
  { x: 6, y: 15, ax: .5, ay: .03, side: 'left' },
  { x: 4, y: 58, ax: .95, ay: .55, side: 'left' },
  { x: 4, y: 44, ax: .06, ay: .42, side: 'right' },
  { x: 6, y: 15, ax: .35, ay: .06, side: 'right' },
];
const interestById = id => store.demo.interests.find(i => i.id === id);
const interestLabel = id => INTEREST_LABEL[id] || interestById(id)?.label || id;

function seedTags(item) {
  const tags = [];
  const era = attrValues(item, '시대')[0];
  const nation = attrValues(item, '국적')[0];
  if (era) tags.push({ family: 'time', relation: '시대', value: era, label: '시대', text: era });
  else if (nation) tags.push({ family: 'place', relation: '국적', value: nation, label: '국적', text: nation });
  const m1 = attrValues(item, '재질 1')[0];
  const m2 = attrValues(item, '재질 2')[0];
  if (m1 || m2) tags.push({ family: 'material', relation: m2 ? '재질 2' : '재질 1', value: m2 || m1, m1, m2, label: '재질', text: [m1, m2].filter(Boolean).join(' · ') });
  const pats = attrValues(item, '문양');
  if (pats.length) {
    tags.push({ family: 'pattern', relation: '문양', value: pats[0], multi: pats.length > 1, label: '문양', text: pats.slice(0, 2).join(' · ') + (pats.length > 2 ? ` 외 ${pats.length - 2}` : '') });
  } else {
    const k4 = attrValues(item, '유물분류 4')[0];
    const k3 = attrValues(item, '유물분류 3')[0];
    const kind = k4 && k4.length > 1 ? k4 : k3 || k4;
    if (kind) tags.push({ family: 'class', relation: kind === k4 ? '유물분류 4' : '유물분류 3', value: kind, label: '분류', text: kind });
  }
  tags.forEach(t => { t.key = `${t.relation}|${t.value}`; });
  return tags;
}
function interestFor(tag) {
  for (const it of store.demo.interests) {
    if (!it.relation) continue;
    if (tag.family === 'time' && it.relation === '시대' && it.value === tag.value) return it.id;
    if (tag.family === 'material' && ((it.relation === '재질 2' && it.value === tag.m2) || (it.relation === '재질 1' && it.value === tag.m1))) return it.id;
  }
  return null;
}

function initDiscover() {
  const demo = store.demo;
  if (!demo) {
    $('#vitrine-hint').textContent = '추천 자료를 불러오지 못했습니다. 페이지를 새로고침해 주세요.';
    return;
  }
  sky = new Constellation($('#constellation'), {
    onOpen: id => {
      const sc = demo.scenarios[`${D.seed}|${D.interest}`];
      const i = sc.recommendations.findIndex(r => r.id === id);
      openArtifact({ ...demo.catalog[id], ...sc.recommendations[i] }, { rank: i + 1, rec: sc.recommendations[i] });
    },
    onHighlight: ({ on, hotKeys, hotRecs }) => {
      $$('.find').forEach(f => f.classList.toggle('hot', on && hotRecs.has(f.dataset.id)));
      $$('.value-chip').forEach(c => c.classList.toggle('hot', on && hotKeys.has(c.dataset.key)));
    },
  });
  if (matchMedia('(pointer: coarse)').matches) $('#vitrine-hint').textContent = '표찰 하나를 눌러 보세요.';
  buildSeedRail();
  buildLens();
  new Dust($('#vitrine-dust'), { density: 1.6, max: 90, rise: .7, size: [.4, 1.5] });
  const first = demo.baseArtifactIds.includes('동원1347') ? '동원1347' : demo.baseArtifactIds[0];
  selectSeed(first, {});
  new IntersectionObserver(([e], obs) => {
    if (!e.isIntersecting) return;
    obs.disconnect();
    light();
  }, { threshold: .3 }).observe($('#vitrine'));
  addEventListener('resize', layoutLeaders);
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
    }, i * 380));
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
  $('#vitrine-label').replaceChildren(
    el('span', {}, el('b', { text: SHORT[id] || item.name }), metaLine(item)),
    el('span', { text: `국립중앙박물관 ${id}` }));
  renderTags(item);
  sky.setCenter(src);
  if (from) {
    light();
    if (firstRect) flip(obj, firstRect);
  }
  if (D.active) {
    // A plaque belongs to the previous artifact: keep the interest, drop the plaque lens.
    if (D.interest === 'all') D.focus = null;
    D.tagKey = D.tags.find(t => interestFor(t) === D.interest)?.key || null;
    D.note = interestNote(D.interest);
    renderScenario();
  }
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
  D.tags = seedTags(item);
  const wrap = $('#tags');
  const glints = $('#glints');
  wrap.replaceChildren();
  glints.replaceChildren();
  D.tags.forEach((tag, i) => {
    const slot = SLOTS[i];
    const fam = FAMILIES[tag.family];
    const lensable = interestFor(tag);
    const btn = el('button', {
      class: `tag${slot.side === 'left' ? ' from-right' : ''}`, type: 'button', 'aria-pressed': 'false', 'data-key': tag.key,
      style: { '--x': `${slot.x}%`, '--y': `${slot.y}%`, '--c': fam.color, '--delay': `${(.35 + i * .14).toFixed(2)}s` },
      'aria-label': `${tag.label} ${tag.text}. ${lensable ? '이 속성을 관심 이야기로 더한 추천 보기' : '이 관계의 연결을 밝혀 보기'}`,
    }, el('span', { class: 'tag-glyph', 'aria-hidden': 'true', text: fam.glyph }), el('span', { class: 'tag-text' }, el('small', { text: tag.label }), el('b', { text: tag.text })));
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
      if (D.active) sky.highlight(on ? { family: tag.family } : {});
    };
    btn.addEventListener('pointerenter', () => hot(true));
    btn.addEventListener('pointerleave', () => hot(false));
    btn.addEventListener('focus', () => hot(true));
    btn.addEventListener('blur', () => hot(false));
    btn.addEventListener('click', () => chooseTag(tag));
    wrap.append(btn);
    glints.append(el('span', { class: 'glint' }));
  });
  renderTagState();
  raf2(layoutLeaders);
}

function layoutLeaders() {
  const svg = $('#leaders');
  const obj = $('#vitrine-obj');
  const tags = $$('.tag');
  if (!obj.offsetWidth || getComputedStyle(svg).display === 'none') return;
  const ox = obj.offsetLeft;
  const oy = obj.offsetTop;
  const ow = obj.offsetWidth;
  const oh = obj.offsetHeight;
  svg.replaceChildren();
  tags.forEach((t, i) => {
    const slot = SLOTS[i];
    // translate: 0 -50% leaves offsetTop on the plaque's vertical centre.
    const cy = t.offsetTop;
    const sx = slot.side === 'left' ? t.offsetLeft : t.offsetLeft + t.offsetWidth;
    const elbow = slot.side === 'left' ? sx - 18 : sx + 18;
    const ex = ox + slot.ax * ow;
    const ey = oy + slot.ay * oh;
    const g = sv('g', { style: { '--c': t.style.getPropertyValue('--c'), '--delay': `${(.5 + i * .14).toFixed(2)}s` } },
      sv('path', { d: `M${sx.toFixed(1)},${cy.toFixed(1)} L${elbow.toFixed(1)},${cy.toFixed(1)} L${ex.toFixed(1)},${ey.toFixed(1)}` }),
      sv('circle', { cx: ex.toFixed(1), cy: ey.toFixed(1), r: 3.5 }));
    svg.append(g);
    const glint = $('#glints').children[i];
    if (glint) { glint.style.left = `${ex}px`; glint.style.top = `${ey}px`; }
  });
}

function chooseTag(tag) {
  const interestId = interestFor(tag);
  D.interest = interestId || 'all';
  D.focus = tag.family;
  D.tagKey = tag.key;
  const famLabel = FAMILIES[tag.family].label;
  if (interestId) {
    const label = interestLabel(interestId);
    D.note = `‘${tag.text}’ 표찰에 맞춰 관심 이야기 ‘${label}’${ro(label)} 계산해 둔 추천입니다. 관심 없이 볼 때보다 순위가 어떻게 바뀌었는지도 표시합니다.`;
  } else {
    const what = tag.multi ? `${famLabel} 표찰` : `‘${tag.value}’`;
    const josa = tag.multi ? '은' : hasBatchim(tag.value) ? '은' : '는';
    D.note = `${what}${josa} 미리 계산한 관심 이야기가 아니어서, 관심 없이 본 추천에서 ${famLabel} 연결을 밝혀 보여 드립니다.`;
  }
  activate();
}

function interestNote(id) {
  if (id === 'all') return '관심 이야기 없이, 고른 유물과의 가까움만으로 찾은 여섯 점입니다.';
  const it = interestById(id);
  const label = interestLabel(id);
  return `관심 이야기 ‘${label}’(${REL_LABEL[it.relation]} ${it.value})${hasBatchim(label) ? '을' : '를'} 더해 다시 찾은 여섯 점입니다.`;
}
function selectInterest(id) {
  D.interest = id;
  const it = interestById(id);
  D.focus = it?.relation ? familyOf(it.relation) : null;
  D.tagKey = D.tags.find(t => interestFor(t) === id)?.key || null;
  D.note = interestNote(id);
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

function renderScenario() {
  const demo = store.demo;
  const sc = demo.scenarios[`${D.seed}|${D.interest}`];
  if (!sc) return;
  const base = demo.scenarios[`${D.seed}|all`];
  const it = interestById(D.interest);
  const seedAttrs = new Set(demo.catalog[D.seed].attributes.map(a => `${a.relation}|${a.value}`));
  const interestKey = it?.relation ? `${it.relation}|${it.value}` : null;
  const lens = D.interest === 'all' ? D.focus : null;
  const { famList } = sky.update(sc, { seedAttrs, interestKey, lens });
  let note = D.note;
  if (lens && !famList.some(f => f.family === lens)) note = `관심 없이 본 추천 여섯 점에는 ${FAMILIES[lens].label} 연결이 나타나지 않았습니다.`;
  $('#lens-note').textContent = note;
  renderReading(famList, interestKey);
  renderFinds(sc, base);
  $$('.lens-chip').forEach(b => { const on = b.dataset.id === D.interest; b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; });
  renderTagState();
}

function renderTagState() {
  $$('.tag').forEach(t => t.setAttribute('aria-pressed', String(D.active && t.dataset.key === D.tagKey)));
}

function buildLens() {
  const chips = $('#lens-chips');
  chips.replaceChildren(...store.demo.interests.map((it, i) => {
    const b = el('button', { class: 'lens-chip', type: 'button', role: 'radio', 'aria-checked': 'false', tabindex: i === 0 ? 0 : -1, 'data-id': it.id },
      el('span', { text: interestLabel(it.id) }), it.relation ? el('small', { text: `${REL_LABEL[it.relation]} ${it.value}` }) : null);
    b.addEventListener('click', () => selectInterest(it.id));
    return b;
  }));
  chips.addEventListener('keydown', e => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const btns = $$('.lens-chip', chips);
    const i = Math.max(0, btns.findIndex(b => b.getAttribute('aria-checked') === 'true'));
    const next = btns[(i + step + btns.length) % btns.length];
    next.focus();
    next.click();
  });
}

function renderReading(famList, interestKey) {
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
        const chip = el('span', { class: `value-chip${v.key === interestKey ? ' interest' : ''}`, 'data-key': v.key, tabindex: 0, title: `${REL_LABEL[v.relation] || v.relation} ${v.value}` },
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

function renderFinds(sc, base) {
  const baseIds = base.recommendations.map(r => r.id);
  $('#finds').replaceChildren(...sc.recommendations.map((r, i) => {
    const item = { ...store.demo.catalog[r.id], ...r };
    const photo = photoFor(item);
    const plate = photo
      ? el('span', { class: 'find-plate' }, el('img', { src: photo.thumb || photo.image, alt: '', loading: 'lazy', decoding: 'async' }))
      : el('span', { class: 'find-plate blank' }, el('span', { class: 'find-glyph', 'aria-hidden': 'true', text: glyphFor(item) }), el('small', { text: '사진 미수록' }));
    const why = [...r.explanationEdges].sort((a, b) => b.weight - a.weight).slice(0, 3)
      .map(e => el('span', { style: { '--c': FAMILIES[familyOf(e.relation)].color }, title: `${REL_LABEL[e.relation] || e.relation} ${e.value}`, text: e.value }));
    const flags = [];
    if (D.interest !== 'all') {
      if (r.interestMatched) flags.push(el('span', { class: 'flag interest', text: '관심 일치' }));
      const j = baseIds.indexOf(r.id);
      if (j < 0) flags.push(el('span', { class: 'flag new', text: '새로 등장' }));
      else flags.push(el('span', { class: 'flag', text: j > i ? `${j - i}계단 위로` : j < i ? `${i - j}계단 아래로` : '순위 그대로' }));
    }
    const btn = el('button', { class: 'find', type: 'button', 'data-id': r.id, 'aria-label': `추천 ${i + 1}위 ${item.name}. 자세히 보기` },
      plate,
      el('span', { class: 'find-copy' },
        el('span', { class: 'find-head' }, el('span', { class: 'find-rank', 'aria-hidden': 'true', text: HANJA_NUM[i] }), el('span', { class: 'find-name', text: item.name })),
        el('span', { class: 'find-meta', text: metaLine(item) }),
        el('span', { class: 'find-why' }, why),
        flags.length ? el('span', { class: 'find-flags' }, flags) : null));
    btn.addEventListener('pointerenter', () => sky.highlight({ rec: r.id }));
    btn.addEventListener('pointerleave', () => sky.highlight({}));
    btn.addEventListener('focus', () => sky.highlight({ rec: r.id }));
    btn.addEventListener('blur', () => sky.highlight({}));
    btn.addEventListener('click', () => openArtifact(item, { rank: i + 1, rec: r }));
    return el('li', { style: { '--i': i } }, btn);
  }));
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
  const cat = store.demo?.catalog?.[item.id];
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
  $('#credits-open').addEventListener('click', openCredits);
  const poster = () => showSheet($('#poster-dialog'));
  $('#poster-open').addEventListener('click', poster);
  $('#poster-frame').addEventListener('click', poster);
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

/* Boot ------------------------------------------------------------------- */
initMasthead();
initHero();
initSheets();
load().then(() => {
  applyMedia(store.manifest);
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
