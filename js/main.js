import * as THREE from '../vendor/three/three.module.js';
import { OrbitControls } from '../vendor/three/OrbitControls.js';
import { SnakeChain, THEMES } from './snakeGeometry.js';
import { NotationAnimator } from './animator.js';
import { cleanNotation, validateNotation } from './notation.js';
import { loadCatalog, CatalogUI } from './catalog.js';

// ---------------------------------------------------------------------
// Three.js scene setup
// ---------------------------------------------------------------------

const canvas = document.getElementById('three-canvas');
const canvasWrap = canvas.parentElement;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0c0e13);

const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
const CAMERA_OFFSET = new THREE.Vector3(6, 5, 7);
camera.position.copy(CAMERA_OFFSET);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.autoRotateSpeed = 1.6;
controls.minZoom = 0.3;
controls.maxZoom = 4;

scene.add(new THREE.HemisphereLight(0xffffff, 0x30323a, 0.9));
const keyLight = new THREE.DirectionalLight(0xffffff, 1.6);
keyLight.position.set(5, 8, 6);
scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(0xaac0ff, 0.5);
fillLight.position.set(-6, -3, -4);
scene.add(fillLight);

let currentThemeKey = 'classic';
const chain = new SnakeChain(THEMES[currentThemeKey]);
scene.add(chain.group);
// start with a straight chain visible before any figure is picked
chain.update(new Float64Array(24));

// The chain's own centroid shifts every frame while a joint is mid-twist
// (a long downstream arm swinging moves the average position a lot, even
// though each wedge's own motion is smooth). Snapping the camera target
// straight to that raw centroid every frame reads as camera jitter, so we
// damp a separate "smoothedCenter" toward it instead and aim the camera
// at that - same trick as a game camera rig following a bouncy target.
const smoothedCenter = chain.center.clone();
controls.target.copy(smoothedCenter);
camera.position.copy(smoothedCenter).add(CAMERA_OFFSET);
camera.lookAt(smoothedCenter);

let viewRadius = chain.boundingRadius();
let canvasAspect = 1;

function applyFrustum(radius) {
  const r = Math.max(radius, 2);
  camera.left = -r * canvasAspect;
  camera.right = r * canvasAspect;
  camera.top = r;
  camera.bottom = -r;
  camera.updateProjectionMatrix();
}

function resize() {
  const w = canvasWrap.clientWidth;
  const h = canvasWrap.clientHeight;
  if (w === 0 || h === 0) return;
  renderer.setSize(w, h, false);
  canvasAspect = w / h;
  applyFrustum(viewRadius);
}

new ResizeObserver(resize).observe(canvasWrap);
resize();

function renderLoop() {
  requestAnimationFrame(renderLoop);

  smoothedCenter.lerp(chain.center, 0.08);
  controls.target.copy(smoothedCenter);
  controls.update();

  // The frustum targets the current figure's precomputed peak radius
  // (animator.peakRadius - the largest the shape ever gets across its
  // WHOLE build, sampled once when it loads), not the instantaneous
  // shape. Continuously re-fitting to the instantaneous bounding radius
  // was the real source of "chaotic" zooming: a joint with a long,
  // still-unfolded tail downstream sweeps that tail through a wide arc,
  // and the instantaneous radius swings fast and non-monotonically as it
  // does, even though nothing is wrong. A figure-wide fixed target means
  // the camera settles once per figure and then holds still.
  //
  // chain.boundingRadiusFrom(smoothedCenter) stays in the mix purely as
  // a defensive backstop (e.g. for custom pasted-in notation, or if
  // sampling in _computePeakRadius ever undershoots) - in the common
  // case it's smaller than peakRadius and does nothing.
  const peak = animator.peakRadius != null ? animator.peakRadius : chain.boundingRadius();
  const reactive = chain.boundingRadiusFrom(smoothedCenter);
  const targetRadius = Math.max(peak, reactive);
  if (targetRadius > viewRadius) {
    viewRadius = targetRadius;
  } else {
    viewRadius += (targetRadius - viewRadius) * 0.08;
  }
  applyFrustum(viewRadius);

  renderer.render(scene, camera);
}

document.getElementById('autorotate-toggle').addEventListener('change', (e) => {
  controls.autoRotate = e.target.checked;
});

// theme select
const themeSelect = document.getElementById('theme-select');
Object.values(THEMES).forEach((t) => {
  const opt = document.createElement('option');
  opt.value = t.key;
  opt.textContent = t.label;
  themeSelect.appendChild(opt);
});
themeSelect.value = currentThemeKey;
themeSelect.addEventListener('change', () => {
  chain.setTheme(THEMES[themeSelect.value]);
});

// ---------------------------------------------------------------------
// Animator + transport controls
// ---------------------------------------------------------------------

const figureTitleEl = document.getElementById('figure-title');
const stepCounterEl = document.getElementById('step-counter');
const progressFillEl = document.getElementById('progress-fill');
const progressTrackEl = document.getElementById('progress-track');
const notationDisplayEl = document.getElementById('notation-display');

const btnPlay = document.getElementById('btn-play');
const btnStepBack = document.getElementById('btn-step-back');
const btnStepFwd = document.getElementById('btn-step-fwd');
const btnReset = document.getElementById('btn-reset');
const btnEnd = document.getElementById('btn-end');
const speedSlider = document.getElementById('speed-slider');

const animator = new NotationAnimator(chain, {
  onFrame: handleFrame,
  onStepChange: handleStepChange,
  onPlayStateChange: handlePlayStateChange,
});
animator.setSpeed(Number(speedSlider.value));

// Deferred until here so the render loop's reference to `animator` (for
// its precomputed peak-radius camera target) is valid on first call.
renderLoop();

function handleFrame(angles, info) {
  highlightNotationToken(info.sequenceIndex);
}

function handleStepChange(current, total) {
  stepCounterEl.textContent = `${current} / ${total}`;
  const pct = total === 0 ? 0 : (current / total) * 100;
  progressFillEl.style.width = `${pct}%`;
  updateTransportButtons();
  renderNotationTokens(current);
}

function handlePlayStateChange(isPlaying) {
  btnPlay.textContent = isPlaying ? '⏸ Pause' : '▶ Play';
  updateTransportButtons();
}

function updateTransportButtons() {
  btnStepBack.disabled = animator.isAtStart();
  btnStepFwd.disabled = animator.isAtEnd() && !animator.isPlaying;
  btnReset.disabled = animator.isAtStart();
  btnEnd.disabled = animator.isAtEnd();
}

let tokenEls = [];
function renderNotationTokens(currentStep) {
  notationDisplayEl.innerHTML = '';
  tokenEls = [];
  if (animator.steps.length === 0) {
    const span = document.createElement('span');
    span.className = 'notation-placeholder';
    span.textContent = 'Notation will appear here once you pick a figure.';
    notationDisplayEl.appendChild(span);
    return;
  }
  animator.steps.forEach((step, i) => {
    const span = document.createElement('span');
    span.className = 'notation-token' + (i < currentStep ? ' done' : '');
    span.textContent = step.raw;
    span.title = `Joint ${step.key}, position ${step.quarterTurns === 3 && step.side === 'R' ? 1 : step.quarterTurns}`;
    span.addEventListener('click', () => animator.jumpToStep(i + 1));
    notationDisplayEl.appendChild(span);
    tokenEls.push(span);
  });
}

function highlightNotationToken(sequenceIndex) {
  tokenEls.forEach((el, i) => el.classList.toggle('current', i === sequenceIndex));
}

btnPlay.addEventListener('click', () => {
  if (animator.isPlaying) animator.pause();
  else animator.play();
});
btnStepFwd.addEventListener('click', () => animator.stepForward());
btnStepBack.addEventListener('click', () => animator.stepBackward());
btnReset.addEventListener('click', () => animator.reset());
btnEnd.addEventListener('click', () => animator.jumpToEnd());

speedSlider.addEventListener('input', () => animator.setSpeed(Number(speedSlider.value)));

progressTrackEl.addEventListener('click', (e) => {
  if (animator.totalSteps === 0) return;
  const rect = progressTrackEl.getBoundingClientRect();
  const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
  animator.jumpToStep(Math.round(frac * animator.totalSteps));
});

function loadFigure(fg) {
  figureTitleEl.textContent = fg.title;
  let rotation = [0, 0, 0];
  try {
    rotation = JSON.parse(fg.rotation || '[0,0,0]');
  } catch (_) { /* keep default */ }
  chain.group.quaternion.setFromEuler(new THREE.Euler(
    (rotation[0] * Math.PI) / 180,
    (rotation[1] * Math.PI) / 180,
    (rotation[2] * Math.PI) / 180,
  ));
  animator.setNotation(fg.notation);
  renderNotationTokens(0);
}

// ---------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------

const catalogUI = new CatalogUI({
  tabsEl: document.getElementById('category-tabs'),
  gridEl: document.getElementById('catalog-grid'),
  searchEl: document.getElementById('search-input'),
  onSelect: loadFigure,
});

loadCatalog().then((catalog) => {
  catalogUI.init(catalog);
  const first = catalog.byCategory.easy && catalog.byCategory.easy[0];
  if (first) {
    catalogUI.setSelected(first.id);
    loadFigure(first);
  }
}).catch((err) => {
  figureTitleEl.textContent = 'Failed to load figure catalog';
  console.error(err);
});

// ---------------------------------------------------------------------
// Custom notation loader
// ---------------------------------------------------------------------

const customInput = document.getElementById('custom-notation-input');
const customLoadBtn = document.getElementById('custom-notation-load');
const customErrorEl = document.getElementById('custom-notation-error');

customLoadBtn.addEventListener('click', () => {
  const value = customInput.value.trim();
  const { valid, invalidTokens, steps } = validateNotation(value);
  if (steps.length === 0) {
    customErrorEl.textContent = 'Enter at least one valid instruction, e.g. 11L1.';
    return;
  }
  if (!valid) {
    customErrorEl.textContent = `Ignored unrecognized token(s): ${invalidTokens.join(', ')}`;
  } else {
    customErrorEl.textContent = '';
  }
  catalogUI.setSelected(null);
  loadFigure({ title: 'Custom notation', notation: cleanNotation(value), rotation: '[25,25,0]' });
  switchView('viewer');
});

// ---------------------------------------------------------------------
// View tabs (Catalog & Viewer / Notation Guide)
// ---------------------------------------------------------------------

function switchView(name) {
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${name}`));
  document.querySelectorAll('.view-tab').forEach((t) => t.classList.toggle('active', t.dataset.view === name));
  if (name === 'viewer') resize();
}

document.querySelectorAll('.view-tab').forEach((tab) => {
  tab.addEventListener('click', () => switchView(tab.dataset.view));
});

// ---------------------------------------------------------------------
// Notation guide content
// ---------------------------------------------------------------------

function buildGuide() {
  const el = document.getElementById('guide-content');
  el.innerHTML = `
    <h2>How the notation works</h2>
    <p>Lay a Rubik's Snake out straight and look at it from the side so you can see the
    triangular cross-section of each wedge. That straight line is the <strong>base
    position</strong>. Working left to right, every other wedge is a "dark" piece,
    numbered 1 to 12. Each dark piece is fused to a "bright" wedge on its right side,
    and - except for piece 1, which is the end of the chain - on its left side too.
    That gives 23 addressable hinges, each named by its piece number plus a side:
    <code>1R</code>, <code>2L</code>, <code>2R</code>, <code>3L</code>, <code>3R</code>, …
    up to <code>12L</code>, <code>12R</code>.</p>

    <p>Every hinge can be folded into four positions: the straight base position
    (which simply isn't written down), and three 90&deg; turns away from it, named
    <strong>1</strong>, <strong>2</strong> and <strong>3</strong>. A single instruction
    is written as <code>&lt;piece&gt;&lt;L|R&gt;&lt;position&gt;</code>, e.g.
    <code>11L1</code> twists the hinge to the left of piece 11 by one quarter turn.
    A full figure is just a list of instructions separated by dashes:</p>
    <blockquote>2R2-3L2-4L2-5R2-6R2-7L2-8L2-10L2-10R2-12R2 &nbsp;(this is "Wolf")</blockquote>

    <p>Any hinge left out of the notation simply stays at the base position. Folding
    order doesn't change the final shape - each hinge's fold is always expressed
    relative to the piece right before it in the chain - but it matters a lot for
    <em>watching</em> the figure being built, which is exactly what the step-by-step
    player on the Catalog &amp; Viewer tab animates, instruction by instruction, in
    the order they're written.</p>

    <h2>Try the four positions of one hinge</h2>
    <p>Here's hinge 11L on its own, cycling through the base position and its three
    quarter turns. Click any thumbnail to load it into the viewer and drag to look
    around it.</p>
    <div class="guide-demo-row" id="guide-joint-demo"></div>

    <h2>Three worked examples from the source site</h2>
    <div class="guide-demo-row" id="guide-example-demo"></div>

    <h2>The figure catalog</h2>
    <p>The Catalog tab bundles 260 figures pulled from four of the site's galleries:
    <strong>Easy figures</strong>, <strong>Hard figures</strong>, <strong>From
    manuals</strong> (the official booklets) and <strong>Fans &amp; friends</strong>
    (reader submissions). A fifth gallery, <em>Victor's World</em>, documents Victor
    Stok's mathematical survey of every flat and convex shape the snake can form -
    it's presented as annotated photography rather than individual notation strings,
    so it isn't part of the interactive catalog here.</p>
  `;

  const jointDemo = document.getElementById('guide-joint-demo');
  const demoEntries = [
    { label: 'base (0)', notation: '' },
    { label: '11L1', notation: '11L1' },
    { label: '11L2', notation: '11L2' },
    { label: '11L3', notation: '11L3' },
    { label: '11R1', notation: '11R1' },
    { label: '11R2', notation: '11R2' },
    { label: '11R3', notation: '11R3' },
  ];
  demoEntries.forEach((d) => {
    const img = d.notation ? `img/figures/notation/${d.notation}.png` : 'img/figures/notation/12R0.png';
    const item = document.createElement('div');
    item.className = 'guide-demo-item';
    item.innerHTML = `<img src="${img}" alt="${d.label}"><div class="label">${d.label}</div>`;
    item.addEventListener('click', () => {
      catalogUI.setSelected(null);
      loadFigure({ title: `Demo: ${d.label}`, notation: d.notation, rotation: '[0,0,-45]' });
      switchView('viewer');
    });
    jointDemo.appendChild(item);
  });

  const exampleDemo = document.getElementById('guide-example-demo');
  const examples = [
    { label: 'Wolf', notation: '2R2-3L2-4L2-5R2-6R2-7L2-8L2-10L2-10R2-12R2', img: 'img/figures/notation/wolf.png', rotation: '[180, 0, 45]' },
    { label: 'Cat', notation: '9R2-9L2-8L2-7R2-6R2-6L2-5L3-4L2-3R2-2R2-2L2', img: 'img/figures/notation/cat.png', rotation: '[-60, 45, 0]' },
    { label: 'Snowflake', notation: '1R3-2L1-2R3-3L3-3R1-4L3-4R1-5L1-5R3-6L1-6R3-7L3-7R1-8L3-8R1-9L1-9R3-10L1-10R3-12L3-11R1-11L3-12R', img: 'img/figures/notation/snowflake.png', rotation: '[-45, -45, 0]' },
  ];
  examples.forEach((ex) => {
    const item = document.createElement('div');
    item.className = 'guide-demo-item';
    item.innerHTML = `<img src="${ex.img}" alt="${ex.label}"><div class="label">${ex.label}</div>`;
    item.addEventListener('click', () => {
      catalogUI.setSelected(null);
      loadFigure(ex);
      switchView('viewer');
    });
    exampleDemo.appendChild(item);
  });
}

buildGuide();
