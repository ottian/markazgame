import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { TILE, COLS, ROWS, T, CENTER, DISTRICTS, buildMap, solidAt, tileAt, districtAt, tileCenter, randomPickup, sidewalkPaths, cornicheStanders, crossingAhead } from './map.js';
import { buildWorld, makeMarker } from './world.js';
import { People } from './people.js';
import { Characters } from './characters.js';
import { setNightLights } from './vehicles.js';
import { makeDetailedVan } from './vanmodel.js';
import { EgyptRadio } from './radio.js';
import { DayNight, Weather } from './daynight.js';
import { Traffic } from './traffic.js';
import { Sfx } from './audio.js';
import { CONFIG } from './config.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const toArabicDigits = (n) => String(n).replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[d]);

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};

// ---------- الجودة ----------
const QUALITY = {
  low: { label: 'منخفضة', pr: 1, shadows: 0, bloom: false, ao: 0, pbr: false, peds: 110, traffic: 50 },
  medium: { label: 'متوسطة', pr: 1.25, shadows: 2048, bloom: true, ao: 1, pbr: true, peds: 200, traffic: 70 },
  high: { label: 'عالية', pr: 2, shadows: 4096, bloom: true, ao: 2, pbr: true, peds: 300, traffic: 90 },
};
const isTouch = matchMedia('(pointer: coarse)').matches;
let qKey = store.get('markaz_quality');
if (!QUALITY[qKey]) qKey = isTouch ? 'low' : 'medium';
const Q = QUALITY[qKey];
Q.tileError = { low: 24, medium: 14, high: 8 }[qKey];

// ---------- الوضع: خريطة اللعبة أو إسكندرية الحقيقية (جوجل 3D) ----------
const hasGoogle = !!CONFIG.googleMapsApiKey;
const hasOsm = await fetch('data/osm/index.json', { method: 'HEAD' }).then((r) => r.ok).catch(() => false);
const canReal = hasGoogle || hasOsm;
let modeKey = store.get('markaz_mode') === 'real' && canReal ? 'real' : 'grid';
const REAL = modeKey === 'real';

// ---------- الإعداد ----------
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !Q.bloom, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, Q.pr));
renderer.shadowMap.enabled = !!Q.shadows;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = Q.pbr ? 1.2 : 1.05;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, 1, 0.5, 2500);
// إضاءة بيئة (انعكاسات على دهان العربيات والزجاج)
{
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.25;
}
let composer = null, post = null;
if (Q.bloom) {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  const { makeComposer } = await import('./postfx.js');
  post = await makeComposer(renderer, scene, camera, Q);
  composer = post.composer;
}

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  if (composer) { composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(w, h); }
  camera.aspect = w / h;
  camera.fov = w < h ? 75 : 62;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

const map = buildMap();
const world = buildWorld(scene, map, { ...Q, onlySky: REAL });
let city = null; // صور جوجل (الأرض)
let osm = null; // مباني وشوارع OpenStreetMap
// صور جوجل للأرض مقفولة إلا لو اللاعب شغّلها (المدينة كلها مرسومة من الخريطة)
const useGoogle = REAL && hasGoogle && (!hasOsm || store.get('markaz_google') === '1');
let landmarks = [];
if (REAL) {
  const R = await import('./realcity.js');
  landmarks = CONFIG.real.landmarks.map((l) => ({ ...l, ...R.latLonToLocal(l.lat, l.lon, CONFIG.real.center) }));
  if (useGoogle) city = new R.RealCity(scene, camera, renderer, Q);
  if (hasOsm) {
    const O = await import('./osmcity.js');
    O.OsmCity.pbr = Q.pbr;
    osm = await O.OsmCity.load(CONFIG.real.center);
    if (osm) scene.add(osm.group);
    window.__OsmTraffic = O.OsmTraffic;
    window.__carPoolMat = O.carPoolMat;
  }
  if (!city) {
    // أرض بسيطة لو من غير جوجل
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(30000, 30000), new THREE.MeshLambertMaterial({ color: 0x9a9183 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    ground.receiveShadow = true;
    scene.add(ground);
  }
}
function placeName(x, z) {
  let best = null, bd = Infinity;
  for (const l of landmarks) {
    const d = Math.hypot(l.x - x, l.z - z);
    if (d < bd) { bd = d; best = l; }
  }
  return bd < 900 && best ? `قرب ${best.name}` : 'إسكندرية';
}
const van = makeDetailedVan();
scene.add(van);
// فوانيس بتنوّر الشارع بجد بالليل (كشافين) + بقعة نور على الأسفلت
const headLights = [];
if (Q.pbr) {
  for (const s of [1, -1]) {
    const sp = new THREE.SpotLight(0xfff2d8, 0, 55, 0.42, 0.55, 1.4);
    sp.position.set(2.85, 0.95, s * 0.72);
    sp.target.position.set(18, 0, s * 1.2);
    van.add(sp, sp.target);
    headLights.push(sp);
  }
}
const poolTex = (() => {
  const cv = document.createElement('canvas');
  cv.width = 128; cv.height = 64;
  const g = cv.getContext('2d');
  const gr = g.createRadialGradient(20, 32, 2, 40, 32, 64);
  gr.addColorStop(0, 'rgba(255,240,210,0.9)'); gr.addColorStop(1, 'rgba(255,240,210,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 64);
  return new THREE.CanvasTexture(cv);
})();
const poolMat = new THREE.MeshBasicMaterial({ map: poolTex, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
const headPool = new THREE.Mesh(new THREE.PlaneGeometry(16, 6), poolMat);
headPool.rotation.x = -Math.PI / 2;
headPool.position.set(10.5, 0.13, 0);
van.add(headPool);
const traffic = osm
  ? new window.__OsmTraffic(scene, osm, Math.round(Q.traffic * 0.6))
  : new Traffic(scene, REAL ? [] : map.roads, REAL ? 0 : Q.traffic);
const people = REAL
  ? new People(scene, { walkers: osm ? Math.round(Q.peds * 0.6) : 0, shadows: !!Q.shadows })
  : new People(scene, { paths: sidewalkPaths(map), standers: cornicheStanders(), walkers: Q.peds, shadows: Q.shadows >= 2048 });
const characters = new Characters(scene, people, { low: 8, medium: 16, high: 28 }[qKey]);
characters.load();

// ---------- اليوم والطقس ----------
let savedHour = Number(store.get('markaz_hour'));
const daynight = new DayNight(world, scene, Number.isFinite(savedHour) && savedHour > 0 ? savedHour : 16.5);
const weatherMode = store.get('markaz_weather') || 'auto';
const weather = new Weather(scene, weatherMode);
daynight.listeners.push((n) => { setNightLights(n); if (window.__carPoolMat) window.__carPoolMat.opacity = n * 0.4; scene.environmentIntensity = 0.55 - n * 0.4; });
// انعكاسات من السما الحقيقية (بتتحدّث مع الوقت)
const skyPmrem = new THREE.PMREMGenerator(renderer);
const skyScene = new THREE.Scene();
skyScene.add(new THREE.Mesh(world.sky.geometry, world.sky.material));
let envHour = -99, envTex = null;
function updateSkyEnv() {
  if (Math.abs(daynight.hour - envHour) < 0.25 && envTex) return;
  envHour = daynight.hour;
  const rt = skyPmrem.fromScene(skyScene, 0, 1, 3000);
  if (envTex) envTex.dispose();
  envTex = rt;
  scene.environment = rt.texture;
}
function registerNightMats() {
  if (!osm) return;
  for (const [k, m] of Object.entries(osm.facades)) daynight.addNight(m, k === 'shops' ? 0.25 : 0.04, k === 'shops' ? 1.1 : 0.95);
  daynight.addNight(osm.furn.lampMat, 0.15, 3.5);
}
registerNightMats();

// ---------- رتبة السواق ----------
const RANKS = [
  { xp: 0, name: 'سواق متدرّب' }, { xp: 1500, name: 'سواق' }, { xp: 4000, name: 'سواق خبرة' },
  { xp: 9000, name: 'كبير السواقين' }, { xp: 18000, name: 'أسطى إسكندرية' },
];
let xp = Number(store.get('markaz_xp')) || 0;
const rankOf = (v) => RANKS.filter((r) => v >= r.xp).pop();
const sfx = new Sfx();

const pickupMarker = makeMarker(0xff8a1f);
const centerMarker = makeMarker(0x22e0a8);
scene.add(pickupMarker, centerMarker);
pickupMarker.visible = false;
centerMarker.visible = false;
const door = REAL ? { x: 0, z: 0 } : tileCenter(CENTER.doorCol, CENTER.doorRow);
centerMarker.position.set(door.x, 0, door.z);

// سهم فوق العربية بيشاور على الهدف
const arrow = new THREE.Mesh(
  new THREE.ConeGeometry(0.7, 2, 4).rotateZ(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0xffd23a }),
);
scene.add(arrow);

// أشخاص عند مكان الاستلام (الحالة والأسرة والفريق)
let cast = {};

// ---------- الفريق ----------
const staffBy = (role) => CONFIG.staff.filter((s) => s.role === role);
const pick = (role) => staffBy(role)[0] || { name: role, title: '', photo: null };
let driver = staffBy('driver')[0] || CONFIG.staff[0];

function avatarHTML(s, size = 48) {
  if (s.photo) return `<img class="avatar" style="width:${size}px;height:${size}px" src="assets/staff/${s.photo}" alt="${s.name}">`;
  const hue = [...s.name].reduce((a, ch) => a + ch.charCodeAt(0), 0) % 360;
  return `<div class="avatar" style="width:${size}px;height:${size}px;background:hsl(${hue} 55% 40%)">${s.name.trim()[0] || '؟'}</div>`;
}

// ---------- الحالة ----------
const player = REAL
  ? { x: 0, z: 6, heading: 0, speed: 0, steer: 0, siren: false }
  : { x: door.x + 8, z: door.z + 3, heading: 0, speed: 0, steer: 0, siren: false };
let groundY = 0;
const keys = {};
let state = 'menu';
let score = 0, missionsDone = 0;
let mission = null;
let dispatchTimer = 2.5;
let camMode = 0;
let shake = 0;
let best = 0;
try { best = Number(localStorage.getItem('markaz_best') || 0); } catch { /* ignore */ }

// ---------- التحكم ----------
const KEYMAP = {
  ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
};
window.addEventListener('keydown', (e) => {
  if (KEYMAP[e.code]) { keys[KEYMAP[e.code]] = true; e.preventDefault(); }
  if (e.code === 'KeyQ' || e.code === 'KeyE') toggleSiren();
  if (e.code === 'KeyH' || e.code === 'Space') { honk(); e.preventDefault(); }
  if (e.code === 'KeyC') camMode = (camMode + 1) % 3;
  if (e.code === 'KeyM') sfx.setMuted(!sfx.muted);
  if (e.code === 'KeyR') cycleRadio(e.shiftKey ? -1 : 1);
  if (mission && mission.choosing && ['Digit1', 'Digit2', 'Digit3'].includes(e.code)) chooseOption(Number(e.code.slice(-1)) - 1);
  else if (!mission && offers && state === 'playing' && ['Digit1', 'Digit2', 'Digit3', 'Numpad1', 'Numpad2', 'Numpad3'].includes(e.code)) acceptOffer(Number(e.code.slice(-1)) - 1);
  if (e.code === 'KeyP' || e.code === 'Escape') togglePause();
  if (e.code === 'Enter' && state === 'menu') startGame();
  if (e.code === 'Enter' && state === 'summary') nextMission();
});
window.addEventListener('keyup', (e) => { if (KEYMAP[e.code]) keys[KEYMAP[e.code]] = false; });

document.querySelectorAll('[data-key]').forEach((b) => {
  const k = b.dataset.key;
  const on = (e) => { e.preventDefault(); keys[k] = true; b.classList.add('on'); };
  const off = (e) => { e.preventDefault(); keys[k] = false; b.classList.remove('on'); };
  b.addEventListener('pointerdown', on);
  b.addEventListener('pointerup', off);
  b.addEventListener('pointercancel', off);
  b.addEventListener('pointerleave', off);
});
$('btnSiren').addEventListener('pointerdown', (e) => { e.preventDefault(); toggleSiren(); });
$('btnHorn').addEventListener('pointerdown', (e) => { e.preventDefault(); honk(); });
$('btnCam').addEventListener('pointerdown', (e) => { e.preventDefault(); camMode = (camMode + 1) % 3; });
$('btnRadio').addEventListener('pointerdown', (e) => { e.preventDefault(); cycleRadio(); });
// الراديو: مقفول → موسيقى مولّدة → لاسلكي المركز → محطات مصرية حقيقية (بث مباشر)
const egRadio = new EgyptRadio();
egRadio.load();
let radioMode = 0;
function radioLabel() {
  if (radioMode === 0) return '📻 الراديو: مقفول';
  if (radioMode === 1) return '📻 موسيقى';
  if (radioMode === 2) return '📻 لاسلكي المركز';
  return `📻 ${egRadio.current ? egRadio.current.name : 'بيدوّر على محطة...'}`;
}
egRadio.onChange = () => { $('radioState').textContent = radioLabel(); toast(radioLabel(), 2); };
function cycleRadio(dir = 1) {
  const n = 3 + egRadio.stations.length;
  radioMode = (radioMode + dir + n) % n;
  if (radioMode >= 3) { sfx.setRadio(0); egRadio.play(radioMode - 3); }
  else { egRadio.stop(); sfx.setRadio(radioMode); }
  $('radioState').textContent = radioLabel();
  toast(radioLabel(), 1.8);
}

function toggleSiren() {
  if (state === 'menu') return;
  player.siren = !player.siren;
  $('sirenState').textContent = player.siren ? 'السارينة: شغّالة' : 'السارينة: مقفولة';
  $('btnSiren').classList.toggle('on', player.siren);
}

function togglePause() {
  if (state === 'playing') { state = 'paused'; $('pause').hidden = false; }
  else if (state === 'paused') { state = 'playing'; $('pause').hidden = true; }
}
$('btnResume').addEventListener('click', togglePause);

// ---------- القائمة ----------
function renderDriverPicker() {
  const box = $('drivers');
  box.innerHTML = '';
  for (const s of staffBy('driver')) {
    const b = document.createElement('button');
    b.className = 'driver' + (s === driver ? ' sel' : '');
    b.innerHTML = `${avatarHTML(s, 56)}<span>${s.name}</span>`;
    b.onclick = () => { driver = s; renderDriverPicker(); };
    box.appendChild(b);
  }
}
renderDriverPicker();
function renderSettings() {
  const box = $('quality');
  box.innerHTML = '';
  for (const [k, q] of Object.entries(QUALITY)) {
    const b = document.createElement('button');
    b.className = 'chip' + (k === qKey ? ' sel' : '');
    b.textContent = q.label;
    b.onclick = () => { if (k !== qKey) { store.set('markaz_quality', k); location.reload(); } };
    box.appendChild(b);
  }
  const mbox = $('modes');
  mbox.innerHTML = '';
  for (const [k, label] of [['grid', 'خريطة اللعبة'], ['real', 'إسكندرية الحقيقية (جوجل 3D)']]) {
    const b = document.createElement('button');
    b.className = 'chip' + (k === modeKey ? ' sel' : '');
    b.textContent = label;
    b.disabled = k === 'real' && !canReal;
    if (b.disabled) b.title = 'محتاج بيانات الخريطة أو مفتاح Google Maps';
    b.onclick = () => { if (k !== modeKey) { store.set('markaz_mode', k); location.reload(); } };
    mbox.appendChild(b);
  }
  $('modeNote').hidden = canReal;
  const gt = $('googleToggle');
  gt.hidden = !(hasGoogle && hasOsm);
  const gOn = store.get('markaz_google') === '1';
  gt.textContent = gOn ? '🛰️ صور جوجل للأرض: شغّالة' : '🛰️ صور جوجل للأرض: مقفولة';
  gt.classList.toggle('sel', gOn);
  gt.onclick = () => { store.set('markaz_google', gOn ? '0' : '1'); location.reload(); };
  const wbox = $('weatherChips');
  wbox.innerHTML = '';
  for (const [k, label] of [['auto', 'تلقائي'], ['clear', 'صحو'], ['rain', 'مطر'], ['storm', 'نوّة']]) {
    const b = document.createElement('button');
    b.className = 'chip' + (k === weatherMode ? ' sel' : '');
    b.textContent = label;
    b.onclick = () => { store.set('markaz_weather', k); location.reload(); };
    wbox.appendChild(b);
  }
  const v = $('voiceToggle');
  v.textContent = sfx.voice ? '🗣️ الكلام: شغّال' : '🗣️ الكلام: مقفول';
  v.classList.toggle('sel', sfx.voice);
  v.onclick = () => { sfx.voice = !sfx.voice; store.set('markaz_voice', sfx.voice ? '1' : '0'); renderSettings(); };
}
sfx.voice = store.get('markaz_voice') !== '0';
renderSettings();
$('centerName').textContent = CONFIG.centerName;
$('bestScore').textContent = toArabicDigits(best);
$('btnStart').addEventListener('click', startGame);

function renderDriverCard() {
  $('driverCard').innerHTML = `${avatarHTML(driver, 40)}<div><b>${driver.name}</b><small>${rankOf(xp).name} · ${toArabicDigits(xp)} خبرة</small></div>`;
}

function startGame() {
  sfx.init();
  $('menu').hidden = true;
  $('hud').hidden = false;
  if (isTouch) $('touch').hidden = false;
  renderDriverCard();
  state = 'playing';
  camPos.set(player.x - 11, 5, player.z);
  camLook.set(player.x + 8, 1.6, player.z);
  toast(`أهلاً ${driver.name}! استنّى أول بلاغ...`);
  sfx.speak(`أهلاً يا ${driver.name}. استنّى أول بلاغ.`);
}

// ---------- رسائل ----------
let toastTimer = 0;
function toast(msg, secs = 3.5) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  toastTimer = secs;
}

let dialogLine = -1;
function say(staff, text) {
  sfx.speak(text, { pitch: staff.role === 'nurse' ? 1.15 : 0.95 });
  $('dialog').hidden = false;
  $('dialog').innerHTML = `${avatarHTML(staff, 52)}<div><b>${staff.name} <small>${staff.title}</small></b><p>${text}</p></div>`;
}
function hideDialog() { $('dialog').hidden = true; dialogLine = -1; }

// ---------- المهمّات ----------
// كل مهمة عبارة عن مراحل (legs): استلام حالة، تسليم، تدوير على مريض تايه، استلام علاج، توصيل علاج
const KINDS = {
  pickup: { icon: '🚑', title: 'إحضار حالة' },
  search: { icon: '🔎', title: 'مريض تايه' },
  meds: { icon: '💊', title: 'توصيل علاج' },
  transfer: { icon: '🏥', title: 'نقل لمستشفى' },
};
const CHECKLIST = ['📝 موافقة الأسرة', '📋 التاريخ المرضي', '💊 الأدوية الحالية', '🛏️ تجهيز الترولي'];
let hospitals = [];
if (REAL && hasOsm) fetch('data/osm/pois.json').then((r) => r.json()).then((d) => { hospitals = d.hospitals || []; }).catch(() => {});
let cash = Number(store.get('markaz_cash')) || 0;
$('cash').textContent = `${toArabicDigits(cash)} ج`;
let offers = null;
const rnd = (arr) => arr[Math.floor(Math.random() * arr.length)];

// عنوان على شارع حقيقي (أو معلم لو الشوارع لسه بتحمّل)
function addrPoint(fx, fz, minD, maxD) {
  const a = osm && osm.randomRoadPoint(fx, fz, minD, maxD, [4, 5, 6]);
  if (a) {
    const st = osm.streetName(a.x, a.z), pl = placeName(a.x, a.z);
    return { pos: a, name: st ? (pl === 'إسكندرية' ? st : `${st} (${pl})`) : pl };
  }
  const far = landmarks.filter((l) => { const d = Math.hypot(l.x - fx, l.z - fz); return d > minD && d < maxD * 2.5; });
  const l = rnd(far.length ? far : landmarks);
  return l ? { pos: { x: l.x, z: l.z }, name: l.name } : null;
}

function makeOffer(kind) {
  const pool = CONFIG.cases.filter((c) => !c.night || daynight.night > 0.5);
  if (kind === 'pickup') {
    const a = addrPoint(player.x, player.z, 300, 1100);
    if (!a) return null;
    const d = Math.hypot(a.pos.x - player.x, a.pos.z - player.z) + Math.hypot(a.pos.x - door.x, a.pos.z - door.z);
    return { kind, place: a.name, kase: rnd(pool), dist: d, pay: 120 + Math.round(d / 12),
      legs: [{ action: 'pickup', pos: a.pos, name: a.name }, { action: 'dropoff', pos: door, name: CONFIG.centerShort }] };
  }
  if (kind === 'search') {
    const a = addrPoint(player.x, player.z, 300, 900);
    if (!a) return null;
    const d = Math.hypot(a.pos.x - player.x, a.pos.z - player.z) + Math.hypot(a.pos.x - door.x, a.pos.z - door.z);
    return { kind, place: a.name, kase: rnd(CONFIG.searchCases), dist: d, pay: 220 + Math.round(d / 10),
      legs: [{ action: 'search', pos: a.pos, name: a.name }, { action: 'dropoff', pos: door, name: CONFIG.centerShort }] };
  }
  if (kind === 'meds') {
    const ph = addrPoint(player.x, player.z, 150, 600);
    if (!ph) return null;
    const home = addrPoint(ph.pos.x, ph.pos.z, 250, 800);
    if (!home) return null;
    const d = Math.hypot(ph.pos.x - player.x, ph.pos.z - player.z) + Math.hypot(home.pos.x - ph.pos.x, home.pos.z - ph.pos.z);
    return { kind, place: home.name, kase: rnd(CONFIG.medsCases), dist: d, pay: 90 + Math.round(d / 14),
      legs: [{ action: 'collect', pos: ph.pos, name: `صيدلية ${ph.name}` }, { action: 'deliver', pos: home.pos, name: home.name }] };
  }
  if (kind === 'transfer') {
    const hs = hospitals.filter((h) => { const d = Math.hypot(h.x - door.x, h.z - door.z); return d > 500 && d < 4500; });
    if (!hs.length) return null;
    const h = rnd(hs);
    const legs = [{ action: 'pickup', pos: { ...door }, name: CONFIG.centerShort, atCenter: true }];
    legs.push({ action: 'dropoff', pos: { x: h.x, z: h.z }, name: h.name, hospital: true, snap: true });
    const d = Math.hypot(door.x - player.x, door.z - player.z) + Math.hypot(h.x - door.x, h.z - door.z);
    return { kind, place: h.name, kase: rnd(CONFIG.transferCases), dist: d, pay: 160 + Math.round(d / 12), legs };
  }
  return null;
}

// لوحة البلاغات (زي تليفون الألعاب): ٣ بلاغات تختار منهم
function showOffers() {
  const kinds = ['pickup', 'search', 'meds', 'transfer'].sort(() => Math.random() - 0.5);
  if (!kinds.slice(0, 3).includes('pickup')) kinds.unshift('pickup');
  offers = [];
  for (const k of kinds) {
    if (offers.length >= 3) break;
    const o = makeOffer(k);
    if (o) offers.push(o);
  }
  if (!offers.length) { offers = null; dispatchTimer = 2; return; }
  const box = $('board');
  box.hidden = false;
  box.innerHTML = `<h3>📟 بلاغات الكول سنتر</h3>` + offers.map((o, i) => `
    <button data-i="${i}"><span class="ic">${KINDS[o.kind].icon}</span>
      <span class="tx"><b>${toArabicDigits(i + 1)}. ${KINDS[o.kind].title}</b><small>${o.place}</small><small class="k">${o.kase.text}</small></span>
      <span class="pay">${toArabicDigits(o.pay)} ج<small>${toArabicDigits((o.dist / 1000).toFixed(1))} كم</small></span></button>`).join('');
  box.querySelectorAll('button').forEach((b) => { b.onclick = () => acceptOffer(Number(b.dataset.i)); });
  sfx.radio();
}

function acceptOffer(i) {
  const o = offers && offers[i];
  if (!o) return;
  offers = null;
  $('board').hidden = true;
  const kase = o.kase;
  const est = o.legs.reduce((a, l, j) => a + Math.hypot(l.pos.x - (j ? o.legs[j - 1].pos.x : player.x), l.pos.z - (j ? o.legs[j - 1].pos.z : player.z)), 0);
  mission = {
    kind: o.kind, offer: o, kase, legs: o.legs.map((l) => ({ ...l, pos: { ...l.pos } })), leg: -1, pay: o.pay,
    district: { name: o.place }, pos: o.legs[0].pos,
    limit: Math.round(est * 1.45 / 10.5 + 50 + (kase.calm || 3) * 2 + (o.kind === 'search' ? 70 : 0) + (o.kind === 'meds' ? 20 : 0)),
    elapsed: 0, comfort: 100, hits: 0, calm: 0, handover: 0, aboard: false, agit: kase.agit ?? 30, checks: 0, maxAgit: 0,
  };
  people.clearActors();
  cast = {};
  setLeg(0);
  sfx.radio();
  setTimeout(() => sfx.speak(`${KINDS[o.kind].title}. ${kase.text}`), 600);
  $('missionCase').textContent = `${KINDS[o.kind].icon} ${kase.text}`;
  state = 'playing';
}

// مكان المشهد: على الرصيف جنب الشارع (والأسرة عند باب العمارة)
function sceneSpot(pos, tile) {
  if (osm) {
    const nr = osm.nearestRoad(pos.x, pos.z, [2, 3, 4, 5, 6]);
    if (nr && Math.hypot(nr.x - pos.x, nr.z - pos.z) < 60) {
      const h = nr.heading, rx = -Math.sin(h), rz = Math.cos(h);
      const off = nr.road.w / 2 + 1.5;
      // العربية تقف في الحارة اليمين
      pos.x = nr.x + rx * nr.road.w * 0.22; pos.z = nr.z + rz * nr.road.w * 0.22;
      return { x: nr.x + rx * off, z: nr.z + rz * off, faceRoad: Math.atan2(-rz, -rx), side: [Math.cos(h), Math.sin(h)], out: [rx, rz] };
    }
  }
  const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];
  const d = (tile && dirs.find(([dc, dr]) => tileAt(map, tile.c + dc, tile.r + dr) === T.BUILDING)) || [0, -1];
  return { x: pos.x + d[0] * 6.4, z: pos.z + d[1] * 6.4, faceRoad: Math.atan2(-d[1], -d[0]), side: [-d[1], d[0]], out: d };
}

function placePeople(spot, withFamily = true) {
  const s = spot, sd = s.side, o = s.out;
  cast.spot = s;
  cast.patient = people.addActor({ x: s.x + sd[0] * 0.7, z: s.z + sd[1] * 0.7, yaw: s.faceRoad, shirt: 0x7aa0c8, pants: 0x2b3245, role: 'patient' });
  if (withFamily) {
    cast.family = people.addActor({ x: s.x - sd[0] * 0.7 + o[0] * 0.6, z: s.z - sd[1] * 0.7 + o[1] * 0.6, yaw: s.faceRoad, shirt: 0x6a3a5a, pants: 0x6a3a5a, head: 0x3a2a3a });
    cast.family2 = people.addActor({ x: s.x - sd[0] * 1.6 + o[0] * 1.1, z: s.z - sd[1] * 1.6 + o[1] * 1.1, yaw: s.faceRoad, shirt: 0xe6e1d3, pants: 0xe6e1d3 });
  }
}

function setLeg(i) {
  const m = mission;
  m.leg = i;
  const L = m.legs[i];
  m.pos = L.pos;
  m.calm = 0; m.handover = 0; m.sceneT = 0; m.teamOut = false; m.boarding = false; m.checks = 0;
  m.chosen = false; m.choosing = false; m.extraCalm = 0; m.sirenWarned = false;
  m.district = { name: L.name };
  gps.target = null;
  if (L.action === 'pickup' && !L.atCenter) {
    const spot = sceneSpot(L.pos, L.tile);
    placePeople(spot);
  } else if (L.action === 'pickup' && L.atCenter) {
    // الحالة مستنية على باب المركز مع ممرض الاستقبال
    const spot = sceneSpot(L.pos);
    placePeople(spot, false);
    cast.family = people.addActor({ x: spot.x - spot.side[0] * 0.8, z: spot.z - spot.side[1] * 0.8, yaw: spot.faceRoad, shirt: 0x1f9a8a, pants: 0x1f9a8a });
  } else if (L.action === 'deliver') {
    const spot = sceneSpot(L.pos);
    cast.spot = spot;
    cast.family = people.addActor({ x: spot.x, z: spot.z, yaw: spot.faceRoad, shirt: 0x6a3a5a, pants: 0x6a3a5a, head: 0x3a2a3a });
  } else if (L.action === 'collect') {
    cast.spot = sceneSpot(L.pos);
  } else if (L.action === 'search') {
    // المريض الحقيقي في حتة قريبة من المنطقة (مش في نصها بالظبط)
    const real = (osm && osm.randomRoadPoint(L.pos.x, L.pos.z, 20, 90, [4, 5, 6])) || { x: L.pos.x + 30, z: L.pos.z };
    L.real = real;
    L.r = 130;
    L.area = { x: L.pos.x + (Math.random() - 0.5) * 60, z: L.pos.z + (Math.random() - 0.5) * 60 };
    const spot = sceneSpot({ ...real });
    cast.spot = spot;
    cast.patient = people.addActor({ x: spot.x, z: spot.z, yaw: spot.faceRoad, shirt: 0xf0ede4, pants: 0xf0ede4, role: 'patient' });
    cast.wanderT = 0;
  }
  const atDoor = L.action === 'dropoff' && !L.hospital;
  pickupMarker.visible = !atDoor && L.action !== 'search';
  centerMarker.visible = atDoor;
  pickupMarker.position.set(L.pos.x, groundY, L.pos.z);
  $('checklist').hidden = true;
  $('agitWrap').hidden = true;
}

function newMission() {
  if (REAL) { if (!offers) showOffers(); return; }
  // الخريطة القديمة (المربعات)
  const choices = DISTRICTS.filter((d) => d.key !== 'smouha');
  for (let tries = 0; tries < 20; tries++) {
    const d = choices[Math.floor(Math.random() * choices.length)];
    const p = randomPickup(map, d);
    if (!p) continue;
    const pos = tileCenter(p.c, p.r);
    if (Math.hypot(pos.x - door.x, pos.z - door.z) < 120) continue;
    const kase = CONFIG.cases[Math.floor(Math.random() * CONFIG.cases.length)];
    const dist = Math.abs(player.x - pos.x) + Math.abs(player.z - pos.z) + Math.abs(pos.x - door.x) + Math.abs(pos.z - door.z);
    offers = [{ kind: 'pickup', place: d.name, kase, dist, pay: 120 + Math.round(dist / 12),
      legs: [{ action: 'pickup', pos, name: d.name, tile: p }, { action: 'dropoff', pos: door, name: CONFIG.centerShort }] }];
    acceptOffer(0);
    return;
  }
}

// نقطة الباب الجانبي (يمين العربية) والباب اللي ورا
const vanSidePoint = () => ({ x: player.x - Math.sin(player.heading) * 1.6 + Math.cos(player.heading) * 0.4, z: player.z + Math.cos(player.heading) * 1.6 + Math.sin(player.heading) * 0.4 });
const vanRearPoint = () => ({ x: player.x - Math.cos(player.heading) * 4.0, z: player.z - Math.sin(player.heading) * 4.0 });

// الدكتور والممرض بينزلوا من الباب الجانبي ويروحوا للحالة
function teamOut(who = ['doctor', 'nurse']) {
  const sp = vanSidePoint();
  const v = van.userData.van;
  v.openSide(true);
  sfx.playSample('door', { vol: 0.5 });
  const s = cast.spot;
  const fwd = [-s.out[0], -s.out[1]];
  if (who.includes('doctor')) {
    cast.doctor = people.addActor({ x: sp.x, z: sp.z, shirt: 0xf6f6f6, pants: 0x2b3245, role: 'doctor' });
    people.walkTo(cast.doctor, s.x + fwd[0] * 1.2 + s.side[0] * 0.2, s.z + fwd[1] * 1.2 + s.side[1] * 0.2, (a) => { a.yaw = Math.atan2(s.z - a.z, s.x - a.x); });
  }
  if (who.includes('nurse')) {
    cast.nurse = people.addActor({ x: sp.x + 0.4, z: sp.z + 0.4, shirt: 0x1f9a8a, pants: 0x1f9a8a, role: 'nurse' });
    people.walkTo(cast.nurse, s.x + fwd[0] * 1.2 + s.side[0] * 1.4, s.z + fwd[1] * 1.2 + s.side[1] * 1.4, (a) => { a.yaw = Math.atan2(s.z - a.z, s.x - a.x); });
  }
}

// الفريق يرجع العربية من الباب الجانبي
function teamBack(done) {
  const sp = vanSidePoint();
  let left = 0;
  for (const a of [cast.doctor, cast.nurse]) {
    if (!a || !a.active) continue;
    left++;
    people.walkTo(a, sp.x, sp.z, () => { people.removeActor(a); if (--left === 0) { van.userData.van.openSide(false); setTimeout(() => sfx.thunk && sfx.thunk(), 600); done && done(); } });
  }
  cast.doctor = cast.nurse = null;
  if (!left) { van.userData.van.openSide(false); done && done(); }
}

// الحالة على الترولي ورا الممرض والدكتور، ويركبوا من الباب اللي ورا
function boardVan(done) {
  const rp = vanRearPoint();
  van.userData.van.openRear(true);
  van.userData.van.openSide(false);
  sfx.playSample('door', { vol: 0.6 });
  let left = 0;
  const group = [cast.nurse, cast.patient, cast.doctor].filter((a) => a && a.active);
  group.forEach((a, k) => {
    left++;
    setTimeout(() => people.walkTo(a, rp.x, rp.z, () => {
      people.removeActor(a);
      if (--left === 0) { van.userData.van.openRear(false); setTimeout(() => sfx.thunk && sfx.thunk(), 700); done(); }
    }), k * 450);
  });
  if (!left) done();
}

// الحالة اتوترت وجريت — المهمة بتتحول لتدوير
function patientBolts() {
  const m = mission, L = m.legs[m.leg];
  m.bolted = (m.bolted || 0) + 1;
  m.agit = 70;
  const a = cast.patient;
  const run = (osm && osm.randomRoadPoint(a.x, a.z, 60, 140, [4, 5, 6])) || { x: a.x + 80, z: a.z };
  const spot = sceneSpot({ ...run });
  a.speed = 3.4;
  people.walkTo(a, spot.x, spot.z, (b) => { b.speed = 1.2; });
  hideChoice();
  teamBack();
  toast('😟 الحالة اتوترت وجريت! دوّر عليها في المنطقة — ومن غير سارينة', 5);
  sfx.speak('الحالة جريت. دوّر عليها بالراحة');
  m.legs[m.leg] = { action: 'search', pos: { x: run.x, z: run.z }, name: L.name, real: run, r: 90, area: { x: (a.x + run.x) / 2, z: (a.z + run.z) / 2 }, chased: true };
  cast.spot = spot;
  cast.wanderT = 3;
  m.pos = m.legs[m.leg].pos;
  m.calm = 0; m.teamOut = false; m.sceneT = 0; m.checks = 0; m.chosen = true;
  pickupMarker.visible = false;
  $('checklist').hidden = true;
  $('progress').hidden = true;
}

function hideChoice() { if (mission) mission.choosing = false; $('choice').hidden = true; }

// كلاكس جنب الحالة بيوترها
function honk() {
  sfx.horn();
  const m = mission;
  if (m && m.legs && m.leg >= 0 && ['pickup', 'search'].includes(m.legs[m.leg].action) && Math.hypot(m.pos.x - player.x, m.pos.z - player.z) < 60) {
    m.agit = Math.min(100, m.agit + 9);
    toast('📯 الكلاكس وتّر الحالة', 1.5);
  }
}

function setChecklist(m) {
  const box = $('checklist');
  box.hidden = false;
  box.innerHTML = CHECKLIST.map((c, i) => `<span class="${i < m.checks ? 'ok' : ''}">${i < m.checks ? '✔' : '○'} ${c}</span>`).join('');
}

function updateMission(dt) {
  if (!mission) {
    if (offers) { $('objective').textContent = 'اختار بلاغ من اللوحة (١ / ٢ / ٣)'; $('missionInfo').hidden = true; return; }
    dispatchTimer -= dt;
    $('objective').textContent = 'مستني بلاغ من الكول سنتر...';
    $('missionInfo').hidden = true;
    if (dispatchTimer <= 0) newMission();
    return;
  }
  const m = mission;
  const L = m.legs[m.leg];
  m.elapsed += dt;
  const remain = Math.max(0, m.limit - m.elapsed);
  $('missionInfo').hidden = false;
  $('missionCase').hidden = m.elapsed > 14 && !m.teamOut; // نص البلاغ بيختفي بعد شوية عشان الشاشة تفضى
  $('timer').textContent = `${toArabicDigits(Math.floor(remain / 60))}:${toArabicDigits(String(Math.floor(remain % 60)).padStart(2, '0'))}`;
  $('timer').classList.toggle('late', remain <= 0);

  // المستشفى: نثبّت العلامة على أقرب شارع لما نقرّب والشوارع تحمّل
  if (L.snap && osm && Math.hypot(L.pos.x - player.x, L.pos.z - player.z) < 450) {
    const nr = osm.nearestRoad(L.pos.x, L.pos.z, [2, 3, 4, 5, 6]);
    if (nr && Math.hypot(nr.x - L.pos.x, nr.z - L.pos.z) < 160) { L.pos.x = nr.x; L.pos.z = nr.z; pickupMarker.position.set(nr.x, groundY, nr.z); L.snap = false; }
  }
  const dist = Math.hypot(L.pos.x - player.x, L.pos.z - player.z);
  $('distance').textContent = `${toArabicDigits(Math.round(gps.len || dist))} م`;
  const stopped = Math.abs(player.speed) < 1.5;
  const zoneR = REAL ? 14 : 6.5;
  m.hazard = false;
  const nearScene = dist < 90;

  // التوتر: السارينة جنب الحالة بتوترها
  if ((L.action === 'pickup' || L.action === 'search') && !m.aboard) {
    if (player.siren && (nearScene || (L.action === 'search' && L.found))) {
      m.agit = Math.min(100, m.agit + 7 * dt);
      if (!m.sirenWarned) { m.sirenWarned = true; toast('🔇 اطفي السارينة — صوتها بيوتّر الحالة', 3); }
    }
    m.maxAgit = Math.max(m.maxAgit, m.agit);
    $('agitWrap').hidden = !(nearScene || L.found);
    $('agitBar').style.width = `${m.agit}%`;
    $('agitBar').style.background = m.agit < 40 ? '#3ad29f' : m.agit < 70 ? '#f2c230' : '#ff5a4a';
  } else $('agitWrap').hidden = true;

  if (L.action === 'search') {
    const p = cast.patient;
    $('objective').textContent = L.found ? 'لقيته! اركن جنبه بالراحة (العلامة البرتقاني)' : `دوّر على المريض في المنطقة المعلّمة — ${L.name}`;
    // المريض بيتمشّى حوالين مكانه
    if (p && !L.found && !p.walking) {
      cast.wanderT -= dt;
      if (cast.wanderT <= 0) {
        cast.wanderT = 4 + Math.random() * 5;
        const s = cast.spot;
        people.walkTo(p, s.x + s.side[0] * (Math.random() - 0.5) * 24, s.z + s.side[1] * (Math.random() - 0.5) * 24);
      }
    }
    // بعد دقيقة: الكول سنتر بيدّي معلومة تصغّر المنطقة
    if (!L.found && !L.hinted && m.elapsed > (L.chased ? 25 : 60)) {
      L.hinted = true;
      L.r = 60;
      L.area = { x: p.x + (Math.random() - 0.5) * 30, z: p.z + (Math.random() - 0.5) * 30 };
      sfx.radioBeep();
      toast('📻 الكول سنتر: واحد من الجيران شافه — المنطقة صغرت', 4);
    }
    if (p && !L.found && Math.hypot(p.x - player.x, p.z - player.z) < 38) {
      L.found = true;
      sfx.ding();
      toast('👀 شايفه! اركن جنبه بهدوء ومن غير سارينة', 4);
      // المشهد بيتحوّل لاستلام عادي عند مكان المريض
      const spot = sceneSpot({ x: p.x, z: p.z });
      people.walkTo(p, spot.x, spot.z, (a) => { a.yaw = spot.faceRoad; });
      const pos = { x: p.x, z: p.z };
      sceneSpot(pos);
      cast.spot = spot;
      m.legs[m.leg] = { action: 'pickup', pos, name: L.name, found: true };
      m.pos = pos;
      m.calm = 0; m.teamOut = false; m.sceneT = 0; m.checks = 0;
      if (!m.kase.choice) m.chosen = true;
      pickupMarker.position.set(pos.x, groundY, pos.z);
      pickupMarker.visible = true;
    }
    return;
  }

  if (L.action === 'pickup') {
    $('objective').textContent = L.atCenter ? `الحالة مستنياك على باب ${CONFIG.centerShort}` : `روح لـ ${L.name} (العلامة البرتقاني)`;
    if (m.boarding) {
      $('progressLabel').textContent = 'الحالة بتركب على الترولي...';
      m.hazard = true;
      if (!stopped || dist > 10) { people.clearActors(); finishBoarding(); }
      return;
    }
    if (dist < zoneR && stopped) {
      m.hazard = true;
      if (!m.teamOut) { m.teamOut = true; m.sceneT = 0; teamOut(L.atCenter ? ['nurse'] : ['doctor', 'nurse']); }
      m.sceneT += dt;
      if (m.sceneT < 2.2) { $('progress').hidden = false; $('progressLabel').textContent = 'الفريق نازل من الباب الجانبي...'; $('progressBar').style.width = '0%'; return; }
      if (m.agit >= 100) { patientBolts(); return; }
      // قرار في نص المهمة
      const need = (L.atCenter ? 2 : m.kase.calm || 3) + (m.extraCalm || 0);
      if (!L.atCenter && m.kase.choice && !m.chosen && m.calm / need > 0.35) {
        if (!m.choosing) showChoice(m.kase.choice);
        $('progressLabel').textContent = 'اختار هتتصرفوا إزاي (١ / ٢ / ٣)';
        m.agit = Math.min(100, m.agit + dt * 1.5); // التأخير بيوتّر
        return;
      }
      // كل ما الحالة متوترة، الكلام بياخد وقت أطول
      const rate = Math.max(0.25, 1.15 - m.agit / 110);
      m.calm += dt * rate;
      m.agit = Math.max(0, m.agit - dt * 2.2);
      const frac = m.calm / need;
      $('progress').hidden = false;
      $('progressBar').style.width = `${Math.min(100, frac * 100)}%`;
      $('progressLabel').textContent = L.atCenter ? 'الممرض بيسلّمك ملف الحالة...' : m.agit > 70 ? 'الحالة متوترة جدًا — الفريق بيهدّيها...' : 'الفريق بيتكلم مع الحالة والأسرة...';
      const checks = Math.min(4, Math.floor(frac * 4.4));
      if (checks !== m.checks) { m.checks = checks; if (checks) sfx.radioBeep(); }
      if (!L.atCenter) setChecklist(m);
      const line = Math.min(2, Math.floor(frac * 3));
      if (!L.atCenter && line !== dialogLine && !(m.chosen && line === 1)) {
        dialogLine = line;
        if (line === 0) say(pick('doctor'), L.found ? 'إزيك يا حبيبي، إحنا جايين ناخدك البيت بأمان. ممكن نتكلم دقيقة؟' : `مساء الخير، إحنا فريق ${CONFIG.centerShort}. خلّينا نتكلم بهدوء ونفهم محتاجين إيه.`);
        if (line === 1) say(pick('nurse'), 'متقلقش خالص، إحنا معاك خطوة بخطوة. خد نفس عميق.');
        if (line === 2) say(pick('social'), 'الأسرة مضيّت الموافقة وجاية ورانا. يلا بينا بالراحة.');
      }
      if (frac >= 1) {
        m.boarding = true;
        $('checklist').hidden = true;
        boardVan(finishBoarding);
      }
    } else if (m.teamOut && !m.boarding) {
      // العربية اتحركت والفريق برّه!
      $('progressLabel').textContent = 'ارجع اقف جوّه الدايرة — الفريق لسه برّه';
      if (dist > 25) { toast('⚠️ سبت الفريق في الشارع! ارجع', 2); }
    } else {
      $('progress').hidden = true;
    }
    return;
  }

  if (L.action === 'collect' || L.action === 'deliver') {
    const collect = L.action === 'collect';
    $('objective').textContent = collect ? `استلم العلاج من ${L.name}` : `وصّل العلاج لـ ${L.name}`;
    if (dist < zoneR && stopped) {
      m.hazard = true;
      if (!m.teamOut) {
        m.teamOut = true;
        m.sceneT = 0;
        teamOut(['nurse']);
        if (!collect) say(pick('nurse'), 'السلام عليكم يا حاجّة، ده العلاج. الجرعة زي ما الدكتور كاتب بالظبط، ولو فيه أي حاجة كلّمونا على طول.');
      }
      m.sceneT += dt;
      const need = collect ? 6 : 8;
      $('progress').hidden = false;
      $('progressBar').style.width = `${Math.min(100, (m.sceneT / need) * 100)}%`;
      $('progressLabel').textContent = collect ? 'الممرض بيستلم العلاج ويراجع الروشتة...' : 'الممرض بيشرح الجرعات للأسرة...';
      if (m.sceneT >= need && !m.returning) {
        m.returning = true;
        teamBack(() => {
          m.returning = false;
          if (collect) { toast('💊 العلاج معاك — وصّله بسرعة', 3); sfx.ding(); setLeg(m.leg + 1); }
          else finishMission();
        });
      }
    } else if (m.teamOut && !m.returning) {
      $('progressLabel').textContent = 'ارجع اقف — الممرض لسه برّه';
    } else if (!m.returning) {
      $('progress').hidden = true;
    }
    return;
  }

  // dropoff: تسليم الحالة (المركز أو طوارئ المستشفى)
  $('objective').textContent = L.hospital ? `وصّل الحالة لطوارئ ${L.name}` : `رجّع الحالة لـ ${CONFIG.centerShort} (العلامة الخضرا)`;
  if (dist < zoneR && stopped) {
    m.hazard = true;
    if (!m.handover) { van.userData.van.openRear(true); sfx.playSample('door', { vol: 0.5 }); }
    m.handover += dt;
    $('progress').hidden = false;
    $('progressBar').style.width = `${Math.min(100, (m.handover / 3) * 100)}%`;
    $('progressLabel').textContent = L.hospital ? 'تسليم الحالة لطوارئ المستشفى...' : 'تسليم الحالة لفريق الاستقبال...';
    if (m.handover >= 3) finishMission();
  } else {
    $('progress').hidden = true;
  }
  $('comfortWrap').hidden = !m.aboard;
  $('comfortBar').style.width = `${m.comfort}%`;
  $('comfortBar').style.background = m.comfort > 70 ? '#3ad29f' : m.comfort > 40 ? '#f2c230' : '#ff5a4a';
}

function showChoice(ch) {
  const m = mission;
  m.choosing = true;
  sfx.radioBeep();
  const box = $('choice');
  box.hidden = false;
  box.innerHTML = `<p>${ch.prompt}</p>` + ch.options.map((o, i) => `<button data-i="${i}">${toArabicDigits(i + 1)}. ${o.text}</button>`).join('');
  box.querySelectorAll('button').forEach((b) => { b.onclick = () => chooseOption(Number(b.dataset.i)); });
  sfx.speak(ch.prompt);
}

function chooseOption(i) {
  const m = mission;
  const o = m && m.kase.choice && m.kase.choice.options[i];
  if (!o || !m.choosing) return;
  m.choosing = false;
  m.chosen = true;
  m.extraCalm = o.calm;
  m.comfort = clamp(m.comfort + o.comfort, 0, 100);
  m.agit = clamp(m.agit + (o.score > 0 ? -o.score / 3 : 30), 0, 100);
  m.choiceScore = o.score;
  m.choiceText = o.text;
  $('choice').hidden = true;
  say(pick(o.role), o.reply);
  toast(o.score > 0 ? '👍 قرار سليم — الحالة هديت' : '👎 القرار ده وتّر الحالة', 2.5);
}

function finishBoarding() {
  const m = mission;
  if (!m || m.aboard) return;
  m.boarding = false;
  m.aboard = true;
  $('progress').hidden = true;
  $('checklist').hidden = true;
  $('agitWrap').hidden = true;
  sfx.ding();
  // الحالة ركبت متوترة؟ الراحة بتبدأ أقل
  m.comfort = clamp(m.comfort - Math.max(0, m.agit - 40) * 0.5, 0, 100);
  toast('✅ الحالة ركبت — سوق بهدوء', 4);
  setTimeout(hideDialog, 2500);
  setLeg(m.leg + 1);
}

function finishMission() {
  const m = mission;
  const remain = Math.max(0, m.limit - m.elapsed);
  const carried = m.kind !== 'meds';
  const timeBonus = Math.round(remain * 3);
  const comfortBonus = carried ? Math.round(m.comfort * 3) : 0;
  const choiceBonus = m.choiceScore || 0;
  const calmBonus = carried ? Math.round(Math.max(0, 70 - m.maxAgit) * 2) : 0;
  const boltPenalty = (m.bolted || 0) * 120;
  const hard = (daynight.night > 0.6 ? 0.2 : 0) + (weather.value > 0.3 ? 0.3 : 0);
  const hardBonus = Math.round((150 + timeBonus + comfortBonus) * hard);
  const total = Math.max(0, 150 + timeBonus + comfortBonus + choiceBonus + calmBonus + hardBonus - boltPenalty);
  const stars = carried ? (m.comfort >= 85 && !m.bolted ? 3 : m.comfort >= 60 ? 2 : 1) : (remain > 0 ? 3 : 2);
  const tip = stars === 3 ? Math.round(m.pay * 0.25) : stars === 2 ? Math.round(m.pay * 0.1) : 0;
  const late = remain <= 0 ? Math.round(m.pay * 0.2) : 0;
  const earned = m.pay + tip - late;
  cash += earned;
  store.set('markaz_cash', String(cash));
  const oldRank = rankOf(xp);
  xp += total;
  store.set('markaz_xp', String(xp));
  const newRank = rankOf(xp);
  if (newRank !== oldRank) setTimeout(() => { toast(`🎖️ اترقّيت: ${newRank.name}!`, 5); sfx.speak(`مبروك، اترقّيت ${newRank.name}`); }, 800);
  renderDriverCard();
  score += total;
  missionsDone++;
  if (score > best) {
    best = score;
    try { localStorage.setItem('markaz_best', String(best)); } catch { /* ignore */ }
  }
  sfx.ding();
  people.clearActors();
  setTimeout(() => { van.userData.van.openRear(false); van.userData.van.openSide(false); }, 1500);
  centerMarker.visible = false;
  pickupMarker.visible = false;
  $('progress').hidden = true;
  $('comfortWrap').hidden = true;
  $('agitWrap').hidden = true;
  $('checklist').hidden = true;
  state = 'summary';
  // بانر "المهمة تمّت" الكبير قبل الملخّص
  const bn = $('banner');
  bn.innerHTML = `<b>المهمة تمّت</b><small>+${toArabicDigits(earned)} ج · ${'★'.repeat(stars)}</small>`;
  bn.hidden = false;
  bn.classList.remove('go'); void bn.offsetWidth; bn.classList.add('go');
  setTimeout(() => { bn.hidden = true; if (state === 'summary') $('summary').hidden = false; }, 2300);
  $('sumStars').textContent = '★'.repeat(stars) + '☆'.repeat(3 - stars);
  const row = (a, b) => `<tr><td>${a}</td><td>${b}</td></tr>`;
  $('sumRows').innerHTML = `
    ${row(`${KINDS[m.kind].icon} ${KINDS[m.kind].title}`, toArabicDigits(150))}
    ${row(`الوقت (${remain > 0 ? 'بدري' : 'متأخر'})`, toArabicDigits(timeBonus))}
    ${carried ? row(`راحة الحالة ${toArabicDigits(Math.round(m.comfort))}٪`, toArabicDigits(comfortBonus)) : ''}
    ${carried ? row(`هدوء الحالة (أعلى توتر ${toArabicDigits(Math.round(m.maxAgit))}٪)`, toArabicDigits(calmBonus)) : ''}
    ${m.bolted ? row('الحالة جريت منكم', '−' + toArabicDigits(boltPenalty)) : ''}
    ${row('خبطات', toArabicDigits(m.hits))}
    ${m.choiceText ? row(`قرارك: ${m.choiceText}`, `${m.choiceScore < 0 ? '−' : ''}${toArabicDigits(Math.abs(m.choiceScore))}`) : ''}
    ${hardBonus ? row(`${daynight.night > 0.6 ? 'شغل ليل' : ''}${daynight.night > 0.6 && weather.value > 0.3 ? ' + ' : ''}${weather.value > 0.3 ? 'مطر' : ''}`, toArabicDigits(hardBonus)) : ''}
    <tr class="tot"><td>المجموع</td><td>${toArabicDigits(total)}</td></tr>
    <tr class="cash"><td>💵 الأجرة ${toArabicDigits(m.pay)}${tip ? ` + بقشيش ${toArabicDigits(tip)}` : ''}${late ? ` − تأخير ${toArabicDigits(late)}` : ''}</td><td>${toArabicDigits(earned)} ج</td></tr>`;
  $('sumTip').textContent =
    m.bolted ? 'الحالة جريت لما اتوترت — اطفي السارينة بدري، متزمّرش، واختار القرارات الهادية.' :
    !carried ? (remain > 0 ? 'العلاج وصل في معاده. شغل نضيف!' : 'العلاج وصل متأخر — المرة الجاية خد طريق الـGPS.') :
    m.comfort >= 85 ? 'سواقة ممتازة! الحالة وصلت مرتاحة ومطمّنة.' :
    m.comfort >= 60 ? 'كويس — حاول تفرمل بالراحة وتقلّل السارينة والحالة معاك.' :
    'الحالة اتوترت في الطريق: خبطات وفرامل جامدة. المرة الجاية براحة.';
  mission = null;
  gps.route = null;
  $('cash').textContent = `${toArabicDigits(cash)} ج`;
}

function nextMission() {
  $('summary').hidden = true;
  dispatchTimer = 2;
  state = 'playing';
}
$('btnNext').addEventListener('click', nextMission);

// ---------- GPS ----------
const gps = { route: null, target: null, timer: 0, len: 0, hint: '' };
function updateGps(dt) {
  const m = mission;
  let tgt = null;
  if (m && m.leg >= 0) {
    const L = m.legs[m.leg];
    tgt = L.action === 'search' ? (L.found ? L.pos : L.area) : L.pos;
  }
  if (!tgt || !osm) { gps.route = null; gps.len = 0; $('gpsHint').hidden = true; return; }
  gps.timer -= dt;
  const moved = gps.target && (gps.target.x !== tgt.x || gps.target.z !== tgt.z);
  // نعيد الحساب كل شوية، أو لو العربية بعدت عن الطريق
  let off = 0;
  if (gps.route) {
    let bd = Infinity;
    for (let i = 0; i < Math.min(gps.route.length, 40); i += 2) bd = Math.min(bd, Math.hypot(gps.route[i] - player.x, gps.route[i + 1] - player.z));
    off = bd;
  }
  if (!gps.route || moved || gps.timer <= 0 || off > 25) {
    gps.timer = 2.5;
    gps.target = { x: tgt.x, z: tgt.z };
    gps.route = Math.hypot(tgt.x - player.x, tgt.z - player.z) > 30 ? osm.route(player.x, player.z, tgt.x, tgt.z) : null;
  }
  // نشيل النقط اللي عدّيناها
  const r = gps.route;
  if (r && r.length >= 4) {
    let bi = 0, bd = Infinity;
    for (let i = 0; i < Math.min(r.length, 60); i += 2) { const d = Math.hypot(r[i] - player.x, r[i + 1] - player.z); if (d < bd) { bd = d; bi = i; } }
    if (bi > 0) r.splice(0, bi);
    let len = 0;
    for (let i = 2; i < r.length; i += 2) len += Math.hypot(r[i] - r[i - 2], r[i + 1] - r[i - 1]);
    gps.len = len + Math.hypot(r[0] - player.x, r[1] - player.z) + Math.hypot(tgt.x - r[r.length - 2], tgt.z - r[r.length - 1]);
    // اللفّة الجاية
    let run = Math.hypot(r[0] - player.x, r[1] - player.z), hint = '';
    for (let i = 2; i < r.length - 2; i += 2) {
      const ax = r[i] - r[i - 2], az = r[i + 1] - r[i - 1];
      // اتجاه الخروج: أول نقطة بعيدة شوية (عشان الكيرفات الصغيرة متتحسبش لفّة)
      let j = i + 2;
      while (j < r.length - 2 && Math.hypot(r[j] - r[i], r[j + 1] - r[i + 1]) < 8) j += 2;
      const bx = r[j] - r[i], bz = r[j + 1] - r[i + 1];
      run += Math.hypot(ax, az);
      const la = Math.hypot(ax, az), lb = Math.hypot(bx, bz);
      if (la < 0.5 || lb < 0.5) continue;
      const cross = (ax * bz - az * bx) / (la * lb), dot = (ax * bx + az * bz) / (la * lb);
      if (dot < 0.6) {
        hint = `${cross > 0 ? '↱ لف يمين' : '↰ لف شمال'} بعد ${toArabicDigits(Math.max(10, Math.round(run / 10) * 10))} م`;
        break;
      }
      if (run > 600) break;
    }
    gps.hint = hint || '⬆ كمّل على طول';
  } else { gps.len = Math.hypot(tgt.x - player.x, tgt.z - player.z); gps.hint = ''; }
  $('gpsHint').hidden = !gps.hint;
  $('gpsHint').textContent = gps.hint;
}


// ---------- الفيزيا ----------
const VAN_LEN = 5.4, VAN_WID = 2.2;
function blockedAt(x, z, h) {
  if (osm) return osm.blocked(x, z, h, VAN_LEN, VAN_WID);
  const c = Math.cos(h), s = Math.sin(h);
  const hl = VAN_LEN / 2 - 0.2, hw = VAN_WID / 2 - 0.1;
  for (const [a, b] of [[hl, hw], [hl, -hw], [-hl, hw], [-hl, -hw], [hl, 0], [-hl, 0], [0, hw], [0, -hw]]) {
    if (solidAt(map, x + a * c - b * s, z + a * s + b * c)) return true;
  }
  return false;
}

function hurt(amount, reason) {
  if (!mission || !mission.aboard) return;
  mission.comfort = clamp(mission.comfort - amount, 0, 100);
  if (reason && amount >= 4) toast(reason, 2);
}

let tipCooldown = 0;
function updatePlayer(dt) {
  const fwd = keys.up ? 1 : 0, back = keys.down ? 1 : 0;
  const steerIn = (keys.left ? -1 : 0) + (keys.right ? 1 : 0);
  player.steer += (steerIn - player.steer) * Math.min(1, dt * 6);

  const MAX = 26, MAXR = -7;
  let sp = player.speed;
  if (fwd) sp += (sp < 0 ? 18 : 9 * (1 - sp / (MAX + 4))) * dt;
  if (back) sp -= (sp > 0.5 ? 20 * (1 - weather.value * 0.35) : 6) * dt;
  if (!fwd && !back) sp -= Math.sign(sp) * Math.min(Math.abs(sp), 2.5 * dt);
  sp -= sp * 0.08 * dt;
  player.speed = clamp(sp, MAXR, MAX);

  const grip = clamp(Math.abs(player.speed) / 6, 0, 1) * (1 - 0.45 * clamp(Math.abs(player.speed) / MAX, 0, 1)) * (1 - weather.value * 0.3);
  const newH = player.heading + player.steer * 1.7 * grip * Math.sign(player.speed) * dt;
  const nx = player.x + Math.cos(newH) * player.speed * dt;
  const nz = player.z + Math.sin(newH) * player.speed * dt;

  if (REAL && !osm) {
    if (!city.blocked(player.x, player.z, newH, player.speed)) { player.x = nx; player.z = nz; player.heading = newH; }
    else { player.heading = newH; impact(); }
  } else if (!blockedAt(nx, nz, newH)) {
    player.x = nx; player.z = nz; player.heading = newH;
  } else if (!blockedAt(nx, player.z, newH)) {
    player.x = nx; player.heading = newH; player.speed *= 0.9;
  } else if (!blockedAt(player.x, nz, newH)) {
    player.z = nz; player.heading = newH; player.speed *= 0.9;
  } else if (!blockedAt(player.x, player.z, newH)) {
    player.heading = newH; impact();
  } else impact();

  function impact() {
    const p = Math.abs(player.speed);
    if (p > 3) {
      sfx.crash(p / 20);
      shake = Math.min(1, p / 15);
      if (mission && mission.aboard) mission.hits++;
      hurt(clamp(p * 1.3, 3, 25), '💥 خبطة! الحالة اتخضّت');
    }
    player.speed *= -0.25;
  }

  // تصادم مع العربيات
  for (const c of traffic.cars) {
    const dx = player.x - c.x, dz = player.z - c.z;
    const d = Math.hypot(dx, dz);
    if (d < 3.6 && d > 0.001) {
      const push = 3.6 - d;
      const tx = player.x + (dx / d) * push, tz = player.z + (dz / d) * push;
      if ((REAL && !osm) || !blockedAt(tx, tz, player.heading)) { player.x = tx; player.z = tz; }
      const p = Math.abs(player.speed);
      if (p > 2) {
        sfx.crash(p / 20);
        sfx.horn();
        shake = Math.min(1, p / 12);
        c.bump = 1.5;
        if (mission && mission.aboard) mission.hits++;
        hurt(12, '🚗 خبطت عربية! الحالة اتوترت');
      }
      player.speed *= -0.3;
    }
  }

  // المشاة اللي بيعدّوا
  const c0 = Math.cos(player.heading), s0 = Math.sin(player.heading);
  for (const p of pedsOnRoad) {
    const dx = p.x - player.x, dz = p.z - player.z;
    const a = dx * c0 + dz * s0, b = -dx * s0 + dz * c0;
    if (Math.abs(a) < 3.1 && Math.abs(b) < 1.5 && Math.abs(player.speed) > 1) {
      // الشخص بيتنطّ لورا ويتفادى العربية
      const side = b >= 0 ? 1 : -1;
      p.x += -s0 * side * 2.2; p.z += c0 * side * 2.2;
      if (p.kind === 'cross' && p.start) { p.target = { ...p.start }; }
      player.speed *= 0.3;
      shake = 0.5;
      sfx.horn();
      score = Math.max(0, score - 50);
      if (mission && mission.aboard) { mission.hits++; hurt(20); }
      toast('⚠️ كنت هتخبط واحد بيعدّي! خلّي بالك من المشاة (−٥٠)', 3);
    }
  }
  people.crossCooldown -= dt;
  if (!REAL && people.crossCooldown <= 0 && player.speed > 5) {
    const seg = crossingAhead(map, player.x, player.z, player.heading, 35 + Math.random() * 30);
    if (seg) { people.spawnCrossing(seg); people.crossCooldown = 7 + Math.random() * 8; }
    else people.crossCooldown = 1;
  }

  // إشارات المرور والمطبات (إسكندرية الحقيقية)
  if (osm) {
    for (const sig of osm.signals.values()) {
      const dx = player.x - sig.x, dz = player.z - sig.z;
      if (dx * dx + dz * dz > 7 * 7 || sigPassed.has(sig)) continue;
      sigPassed.add(sig);
      setTimeout(() => sigPassed.delete(sig), 8000);
      if (Math.abs(player.speed) > 4 && !player.siren && osm.signalFor(sig, player.heading) === 'R') {
        score = Math.max(0, score - 40);
        hurt(6);
        toast('🚦 قطعت الإشارة! (−٤٠) — استنّى الأخضر أو شغّل السارينة في الطوارئ', 3);
        sfx.honk(0, 0.12, 2);
      }
    }
    for (const b of osm.bumps) {
      const dx = player.x - b.x, dz = player.z - b.z;
      if (dx * dx + dz * dz > 36) continue;
      const along = dx * b.ux + dz * b.uz, lat = -dx * b.uz + dz * b.ux;
      if (Math.abs(along) < 0.9 && Math.abs(lat) < b.w / 2 && (!b.hitT || t - b.hitT > 2)) {
        b.hitT = t;
        const sp = Math.abs(player.speed);
        bumpKick = Math.min(1, sp / 10);
        sfx.thunk(Math.min(1, 0.3 + sp / 12));
        if (sp > 6) {
          shake = Math.min(1, sp / 14);
          hurt(sp * 1.5);
          if (mission && mission.aboard) toast('⚠️ مطب! خده بالراحة والحالة معاك', 2);
        }
      }
    }
  }

  // سلوك السواقة مع وجود الحالة
  if (mission && mission.aboard) {
    tipCooldown -= dt;
    if (back && player.speed > 14) { hurt(7 * dt); if (tipCooldown <= 0) { toast('⚠️ فرامل جامدة — براحة', 2); tipCooldown = 4; } }
    if (Math.abs(player.steer) > 0.6 && Math.abs(player.speed) > 16) { hurt(6 * dt); if (tipCooldown <= 0) { toast('⚠️ لفّة سريعة — هدّي', 2); tipCooldown = 4; } }
    if (player.speed > 23) hurt(2 * dt);
    if (player.siren) { hurt(1.2 * dt); if (tipCooldown <= 0) { toast('🔇 السارينة بتوتّر الحالة — استخدمها في الزحمة بس', 3); tipCooldown = 8; } }
  }

  if (city) { groundY = city.groundAt(player.x, player.z, dt); people.groundY = groundY; }
  bumpKick = Math.max(0, bumpKick - dt * 3);
  van.position.set(player.x, groundY + Math.sin(bumpKick * Math.PI) * 0.12, player.z);
  van.rotation.y = -player.heading;
  van.rotation.z = clamp(-player.speed * 0.0025 * (back ? -1 : fwd ? 1 : 0), -0.03, 0.03);
  for (const w of van.userData.wheels) w.rotation.z -= player.speed * dt / 0.42;
}

// ---------- الكاميرا ----------
const camPos = new THREE.Vector3(player.x - 12, 6, player.z);
const camLook = new THREE.Vector3();
function updateCamera(dt) {
  const fx = Math.cos(player.heading), fz = Math.sin(player.heading);
  const speedK = clamp(Math.abs(player.speed) / 26, 0, 1);
  let want, look;
  if (camMode === 0) {
    want = new THREE.Vector3(player.x - fx * (10 + speedK * 3), 4.6 + speedK, player.z - fz * (10 + speedK * 3));
    look = new THREE.Vector3(player.x + fx * 8, 1.6, player.z + fz * 8);
  } else if (camMode === 1) {
    want = new THREE.Vector3(player.x - fx * 4, 45, player.z - fz * 4 + 0.01);
    look = new THREE.Vector3(player.x, 0, player.z);
  } else {
    want = new THREE.Vector3(player.x - fx * 18, 12, player.z - fz * 18);
    look = new THREE.Vector3(player.x + fx * 6, 0, player.z + fz * 6);
  }
  camPos.lerp(want, 1 - Math.exp(-dt * 5));
  camLook.lerp(look, 1 - Math.exp(-dt * 8));
  camera.position.copy(camPos);
  camera.position.y += groundY;
  if (shake > 0) {
    camera.position.x += (Math.random() - 0.5) * shake * 0.6;
    camera.position.y += (Math.random() - 0.5) * shake * 0.6;
    shake = Math.max(0, shake - dt * 2.5);
  }
  camera.lookAt(camLook.x, camLook.y + groundY, camLook.z);
}

// ---------- الخريطة الصغيرة ----------
const MM_SCALE = 3;
const mmBase = document.createElement('canvas');
mmBase.width = COLS * MM_SCALE;
mmBase.height = ROWS * MM_SCALE;
{
  const g = mmBase.getContext('2d');
  const colors = { [T.BUILDING]: '#3a3f4a', [T.ROAD]: '#c9ccd2', [T.SEA]: '#1d4f7a', [T.PROMENADE]: '#c9b48e', [T.PARK]: '#3d6b35', [T.LAKE]: '#2f6a6a', [T.CENTER]: '#0f8f7a' };
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      g.fillStyle = colors[tileAt(map, c, r)];
      g.fillRect(c * MM_SCALE, r * MM_SCALE, MM_SCALE, MM_SCALE);
    }
}
const mm = $('minimap');
const mmg = mm.getContext('2d');
function missionTarget() {
  if (!mission || mission.leg < 0) return null;
  const L = mission.legs[mission.leg];
  return L.action === 'search' && !L.found ? L.area : L.pos;
}
function drawMinimap() {
  if (REAL) {
    const target = missionTarget();
    const L = mission && mission.leg >= 0 ? mission.legs[mission.leg] : null;
    const extra = { route: gps.route };
    if (L && L.action === 'search' && !L.found) { extra.search = { x: L.area.x, z: L.area.z, r: L.r }; extra.hideTarget = true; }
    if (L && L.hospital) extra.targetColor = '#5aa0ff';
    if (osm) osm.drawMinimap(mmg, mm.width, player, target, door, landmarks, extra);
    else city.drawMinimap(mmg, mm.width, player, target);
    return;
  }
  const S = mm.width, half = S / 2;
  const k = MM_SCALE / TILE * 1.6; // بكسل لكل متر
  mmg.save();
  mmg.clearRect(0, 0, S, S);
  mmg.beginPath();
  mmg.arc(half, half, half, 0, Math.PI * 2);
  mmg.clip();
  mmg.fillStyle = '#1d4f7a';
  mmg.fillRect(0, 0, S, S);
  mmg.imageSmoothingEnabled = false;
  const scale = k * TILE / MM_SCALE;
  mmg.drawImage(mmBase, half - player.x * k, half - player.z * k, mmBase.width * scale, mmBase.height * scale);
  const dot = (x, z, color, r = 6) => {
    let px = half + (x - player.x) * k, py = half + (z - player.z) * k;
    const dx = px - half, dy = py - half, d = Math.hypot(dx, dy);
    if (d > half - 10) { px = half + (dx / d) * (half - 10); py = half + (dy / d) * (half - 10); }
    mmg.fillStyle = color;
    mmg.strokeStyle = '#fff';
    mmg.lineWidth = 2;
    mmg.beginPath();
    mmg.arc(px, py, r, 0, Math.PI * 2);
    mmg.fill();
    mmg.stroke();
  };
  dot(door.x, door.z, '#22e0a8', 5);
  if (mission && !mission.aboard) dot(mission.pos.x, mission.pos.z, '#ff8a1f', 7);
  for (const c of traffic.cars) {
    const px = half + (c.x - player.x) * k, py = half + (c.z - player.z) * k;
    mmg.fillStyle = '#ffd23a';
    mmg.fillRect(px - 1.5, py - 1.5, 3, 3);
  }
  mmg.translate(half, half);
  mmg.rotate(player.heading);
  mmg.fillStyle = '#fff';
  mmg.beginPath();
  mmg.moveTo(9, 0);
  mmg.lineTo(-6, 6);
  mmg.lineTo(-3, 0);
  mmg.lineTo(-6, -6);
  mmg.closePath();
  mmg.fill();
  mmg.restore();
}

// ---------- اللوب ----------
const clock = new THREE.Clock();
let t = 0, frames = 0;
let pedsOnRoad = [];
const vehiclesNear = [];
let crowdCount = 0, crowdTimer = 0, attribTimer = 0, streetTimer = 0, gullTimer = 5, clockTimer = 0;
const sigPassed = new Set();
let bumpKick = 0;

// ---------- إسكندرية الحقيقية (OSM) ----------
let osmSnapped = false, osmPedsVersion = -1, recycleTimer = 0, osmWait = 0;
function updateOsm(dt) {
  osm.update(player.x, player.z, qKey === 'high' ? 2 : 1);
  osm.tick(t);
  // أول ما الشوارع حوالين المركز تحمّل: نحط باب المركز والعربية على أقرب شارع
  if (!osmSnapped && osm.roads.length && (osm.centerInfo || osmWait++ > 240)) {
    const nr = osm.centerInfo || osm.nearestRoad(0, 0, [2, 3, 4, 5, 6]);
    if (nr) {
      osmSnapped = true;
      door.x = nr.x; door.z = nr.z;
      centerMarker.position.set(door.x, 0, door.z);
      if (state !== 'playing' || !mission) {
        player.x = nr.x; player.z = nr.z; player.heading = nr.heading;
        camPos.set(player.x - Math.cos(player.heading) * 11, 5, player.z - Math.sin(player.heading) * 11);
      }
    }
  }
  recycleTimer -= dt;
  if (recycleTimer <= 0) {
    recycleTimer = 2;
    if (osm.version !== osmPedsVersion) {
      osmPedsVersion = osm.version;
      people.setPaths(osm.sidewalks());
      for (const p of people.peds) if (p.kind === 'walk') p.active = true;
    }
    people.recycle(player.x, player.z);
  }
  if (!city) $('attrib').textContent = '© OpenStreetMap contributors';
}
function step(dt) {
  t += dt;

  if (state === 'playing') {
    updatePlayer(dt);
    updateMission(dt);
    if (REAL) updateGps(dt);
  }
  const isRoad = REAL ? () => false : (x, z) => !solidAt(map, x, z);
  pedsOnRoad = people.onRoad(isRoad);
  if (state !== 'paused') {
    traffic.update(dt, player, pedsOnRoad);
    vehiclesNear.length = 0;
    vehiclesNear.push(player);
    for (const c of traffic.cars) if (Math.abs(c.x - player.x) < 200 && Math.abs(c.z - player.z) < 200) vehiclesNear.push(c);
    people.update(dt, camera.position.x, camera.position.z, vehiclesNear);
    for (const c of traffic.honks) {
      const d = Math.hypot(c.x - player.x, c.z - player.z);
      if (d < 60) sfx.honk(clamp((c.x - player.x) / 30, -1, 1), 0.12 * (1 - d / 60), 2);
    }
    traffic.honks.length = 0;
  }
  if (state === 'menu') {
    // كاميرا بتلف حوالين المركز في القائمة
    const a = t * 0.08;
    camera.position.set(door.x + Math.cos(a) * 60, 28 + groundY + (REAL ? 60 : 0), door.z + Math.sin(a) * 60);
    camera.lookAt(door.x, 6 + groundY, door.z - 10);
  } else updateCamera(dt);

  // سارينة
  van.userData.van.update(dt, {
    braking: keys.down && player.speed > 0.5, reversing: player.speed < -0.3, steer: player.steer, speed: player.speed,
    night: daynight.night, siren: player.siren, time: t, hazard: !!(mission && mission.hazard) && state !== 'menu',
  });
  for (const hl of headLights) hl.intensity = daynight.night * 90 + weather.value * 20;
  poolMat.opacity = Math.min(0.55, daynight.night * 0.6 + weather.value * 0.1);

  // علامات
  for (const mk of [pickupMarker, centerMarker]) {
    mk.userData.ring.scale.setScalar(1 + Math.sin(t * 4) * 0.08);
    mk.userData.beam.material.opacity = 0.18 + Math.sin(t * 3) * 0.07;
  }

  // سهم الاتجاه
  const target = missionTarget();
  arrow.visible = !!target && state === 'playing' && camMode !== 1;
  if (target) {
    arrow.position.set(player.x, groundY + 4.2 + Math.sin(t * 3) * 0.2, player.z);
    arrow.rotation.y = -Math.atan2(target.z - player.z, target.x - player.x);
  }

  if (state !== 'menu') {
    $('speed').textContent = toArabicDigits(Math.round(Math.abs(player.speed) * 3.6));
    $('score').textContent = toArabicDigits(score);
    streetTimer -= 1 / 60;
    if (streetTimer <= 0) {
      streetTimer = 0.5;
      const st = osm ? osm.streetName(player.x, player.z) : '';
      $('district').textContent = '📍 ' + (REAL ? (st || placeName(player.x, player.z)) : districtAt(player.x).name);
    }
    drawMinimap();
  }
  if (toastTimer > 0) {
    toastTimer -= dt;
    if (toastTimer <= 0) $('toast').classList.remove('show');
  }
  crowdTimer -= dt;
  if (crowdTimer <= 0) {
    crowdTimer = 0.5;
    crowdCount = 0;
    for (const p of people.peds) if (p.active && Math.abs(p.x - player.x) < 25 && Math.abs(p.z - player.z) < 25) crowdCount++;
  }
  const playing = state === 'playing';
  const skid = playing ? clamp(Math.abs(player.steer) * Math.abs(player.speed) / 18 - 0.55, 0, 1) + (keys.down && player.speed > 12 ? 0.6 : 0) : 0;
  sfx.update(dt, { speed: playing ? player.speed : 0, throttle: playing && keys.up, siren: player.siren && playing, skid, seaDist: REAL ? 999 : Math.max(0, player.z - 4 * TILE), crowd: crowdCount, active: playing });
  world.follow(player.x, player.z);
  characters.update(dt, camera.position.x, camera.position.z, groundY);
  if (osm) updateOsm(dt);
  if (city) {
    city.update(player.x, player.z);
    centerMarker.position.y = groundY;
    if (city.error && !city.errorShown) {
      city.errorShown = true;
      toast('⚠️ مباني جوجل مش بتحمّل — اتأكد من المفتاح وإن Map Tiles API مفعّل', 8);
    }
    attribTimer -= dt;
    if (attribTimer <= 0) { attribTimer = 2; $('attrib').textContent = (osm ? '© OpenStreetMap contributors · ' : '') + 'Google · ' + city.attributions(); }
  }
  daynight.rain = weather.value;
  daynight.update(state === 'paused' ? 0 : dt);
  updateSkyEnv();
  egRadio.duck(player.siren ? 0.45 : !$('dialog').hidden ? 0.5 : 1);
  if (post) post.grading(daynight.night, weather.value, t);
  if (osm) { osm.setWet(weather.value); osm.setNight(daynight.night); }
  weather.update(dt, camera.position, () => sfx.thunder());
  if (weather.flash > 0) world.hemi.intensity += weather.flash * 4;
  sfx.setRain(weather.value);
  sfx.updateRadio(dt, CONFIG.chatter);
  gullTimer -= dt;
  if (gullTimer <= 0) {
    gullTimer = 6 + Math.random() * 10;
    const nearSea = REAL ? osm && osm.pointInSea(player.x, player.z - 60) : player.z < 9 * TILE;
    if (nearSea && daynight.night < 0.5 && weather.value < 0.3 && state === 'playing') sfx.seagull(Math.random() * 2 - 1);
  }
  clockTimer -= dt;
  if (clockTimer <= 0) { clockTimer = 0.5; $('clock').textContent = daynight.label(); store.set('markaz_hour', daynight.hour.toFixed(2)); }
  world.update(t, camera.position);
}
function frame() {
  requestAnimationFrame(frame);
  frames++;
  step(Math.min(clock.getDelta(), 0.05));
  if (composer) composer.render();
  else renderer.render(scene, camera);
}
frame();

// للاختبار من الكونسول
window.__game = { get offers() { return offers; }, gps, forceMission(k) { const o = makeOffer(k); if (!o) return false; offers = [o]; acceptOffer(0); return true; }, vanApi: van.userData.van, radio: egRadio, people, city, characters, traffic, osm: () => osm, get frames() { return frames; }, get t() { return t; }, player, get state() { return state; }, get mission() { return mission; }, startGame, newMission, step(n, dt = 1 / 30) { for (let i = 0; i < n; i++) step(dt); } };
