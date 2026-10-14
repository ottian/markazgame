import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { TILE, COLS, ROWS, T, CENTER, DISTRICTS, buildMap, solidAt, tileAt, districtAt, tileCenter, randomPickup, sidewalkPaths, cornicheStanders, crossingAhead } from './map.js';
import { buildWorld, makeMarker } from './world.js';
import { People } from './people.js';
import { Characters } from './characters.js';
import { makeVan } from './vehicles.js';
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
  low: { label: 'منخفضة', pr: 1, shadows: 0, bloom: false, peds: 110, traffic: 50 },
  medium: { label: 'متوسطة', pr: 1.25, shadows: 1024, bloom: true, peds: 200, traffic: 70 },
  high: { label: 'عالية', pr: 2, shadows: 2048, bloom: true, peds: 300, traffic: 90 },
};
const isTouch = matchMedia('(pointer: coarse)').matches;
let qKey = store.get('markaz_quality');
if (!QUALITY[qKey]) qKey = isTouch ? 'low' : 'medium';
const Q = QUALITY[qKey];
Q.tileError = { low: 24, medium: 14, high: 8 }[qKey];

// ---------- الوضع: خريطة اللعبة أو إسكندرية الحقيقية (جوجل 3D) ----------
const hasGoogle = !!CONFIG.googleMapsApiKey;
let modeKey = store.get('markaz_mode') === 'real' && hasGoogle ? 'real' : 'grid';
const REAL = modeKey === 'real';

// ---------- الإعداد ----------
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !Q.bloom, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, Q.pr));
renderer.shadowMap.enabled = !!Q.shadows;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, 1, 0.5, 2500);
let composer = null;
if (Q.bloom) {
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.45, 0.85));
  composer.addPass(new OutputPass());
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
let city = null;
if (REAL) {
  const { RealCity } = await import('./realcity.js');
  city = new RealCity(scene, camera, renderer, Q);
}
const van = makeVan();
scene.add(van);
if (Q.shadows) {
  // نور الفوانيس القدّامية
  const head = new THREE.SpotLight(0xfff0d0, 40, 45, 0.5, 0.6, 1.5);
  head.position.set(2.6, 1.0, 0);
  head.target.position.set(15, 0, 0);
  van.add(head, head.target);
}
const traffic = new Traffic(scene, REAL ? [] : map.roads, REAL ? 0 : Q.traffic);
const people = REAL
  ? new People(scene, { walkers: 0, shadows: !!Q.shadows })
  : new People(scene, { paths: sidewalkPaths(map), standers: cornicheStanders(), walkers: Q.peds, shadows: Q.shadows >= 2048 });
const characters = new Characters(scene, people, { low: 8, medium: 16, high: 28 }[qKey]);
characters.load();
const sfx = new Sfx();

const pickupMarker = makeMarker(0xff8a1f);
const centerMarker = makeMarker(0x22e0a8);
scene.add(pickupMarker, centerMarker);
pickupMarker.visible = false;
centerMarker.visible = false;
const door = REAL ? city.door : tileCenter(CENTER.doorCol, CENTER.doorRow);
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
  ? { x: city.start.x, z: city.start.z, heading: city.start.heading, speed: 0, steer: 0, siren: false }
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
  if (e.code === 'KeyH' || e.code === 'Space') { sfx.horn(); e.preventDefault(); }
  if (e.code === 'KeyC') camMode = (camMode + 1) % 3;
  if (e.code === 'KeyM') sfx.setMuted(!sfx.muted);
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
$('btnHorn').addEventListener('pointerdown', (e) => { e.preventDefault(); sfx.horn(); });
$('btnCam').addEventListener('pointerdown', (e) => { e.preventDefault(); camMode = (camMode + 1) % 3; });

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
    b.disabled = k === 'real' && !hasGoogle;
    if (b.disabled) b.title = 'محتاج مفتاح Google Maps في js/config.js';
    b.onclick = () => { if (k !== modeKey) { store.set('markaz_mode', k); location.reload(); } };
    mbox.appendChild(b);
  }
  $('modeNote').hidden = hasGoogle;
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

function startGame() {
  sfx.init();
  $('menu').hidden = true;
  $('hud').hidden = false;
  if (isTouch) $('touch').hidden = false;
  $('driverCard').innerHTML = `${avatarHTML(driver, 40)}<div><b>${driver.name}</b><small>${driver.title}</small></div>`;
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
function newMission() {
  if (REAL) {
    const pk = city.pickupNear();
    const kase = CONFIG.cases[Math.floor(Math.random() * CONFIG.cases.length)];
    const route = Math.hypot(player.x - pk.pos.x, player.z - pk.pos.z) + Math.hypot(pk.pos.x - door.x, pk.pos.z - door.z);
    mission = {
      district: { name: pk.name }, tile: null, pos: pk.pos, kase,
      limit: Math.round(route * 1.4 / 11 + 45 + kase.calm),
      elapsed: 0, comfort: 100, hits: 0, calm: 0, handover: 0, aboard: false,
    };
    people.clearActors();
    placePeople(null, pk.pos);
    pickupMarker.position.set(pk.pos.x, groundY, pk.pos.z);
    pickupMarker.visible = true;
    centerMarker.visible = false;
    sfx.radio();
    toast(`📞 بلاغ جديد من ${pk.name}`, 5);
    setTimeout(() => sfx.speak(`بلاغ جديد من ${pk.name}. ${kase.text}`), 700);
    $('missionCase').textContent = kase.text;
    state = 'playing';
    return;
  }
  const choices = DISTRICTS.filter((d) => d.key !== 'smouha');
  for (let tries = 0; tries < 20; tries++) {
    const d = choices[Math.floor(Math.random() * choices.length)];
    const p = randomPickup(map, d);
    if (!p) continue;
    const pos = tileCenter(p.c, p.r);
    if (Math.hypot(pos.x - door.x, pos.z - door.z) < 120) continue;
    const kase = CONFIG.cases[Math.floor(Math.random() * CONFIG.cases.length)];
    const route = Math.abs(player.x - pos.x) + Math.abs(player.z - pos.z) + Math.abs(pos.x - door.x) + Math.abs(pos.z - door.z);
    mission = {
      district: d, tile: p, pos, kase,
      limit: Math.round(route / 11 + 35 + kase.calm),
      elapsed: 0, comfort: 100, hits: 0, calm: 0, handover: 0, aboard: false,
    };
    people.clearActors();
    placePeople(p, pos);
    pickupMarker.position.set(pos.x, 0, pos.z);
    pickupMarker.visible = true;
    centerMarker.visible = false;
    sfx.radio();
    toast(`📞 بلاغ جديد من ${d.name}`, 5);
    setTimeout(() => sfx.speak(`بلاغ جديد من ${d.name}. ${kase.text}`), 700);
    $('missionCase').textContent = kase.text;
    state = 'playing';
    return;
  }
}

function placePeople(p, pos) {
  // الناس واقفين على الرصيف ناحية المبنى
  const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];
  let d = (p && dirs.find(([dc, dr]) => tileAt(map, p.c + dc, p.r + dr) === T.BUILDING)) || [0, -1];
  const ox = pos.x + d[0] * 6.4, oz = pos.z + d[1] * 6.4;
  const side = [-d[1], d[0]];
  const faceRoad = Math.atan2(-d[1], -d[0]);
  cast = {
    spot: { x: ox, z: oz, faceRoad, side },
    patient: people.addActor({ x: ox + side[0] * 0.7, z: oz + side[1] * 0.7, yaw: faceRoad, shirt: 0x7aa0c8, pants: 0x2b3245, role: 'patient' }),
    family: people.addActor({ x: ox - side[0] * 0.7, z: oz - side[1] * 0.7, yaw: faceRoad, shirt: 0x6a3a5a, pants: 0x6a3a5a, head: 0x3a2a3a }),
    family2: people.addActor({ x: ox - side[0] * 1.6, z: oz - side[1] * 1.6 + 0.3, yaw: faceRoad, shirt: 0xe6e1d3, pants: 0xe6e1d3 }),
  };
}

// الدكتور والممرض بينزلوا من العربية ويروحوا للحالة
function teamOut() {
  const rx = player.x - Math.cos(player.heading) * 3.4, rz = player.z - Math.sin(player.heading) * 3.4;
  const s = cast.spot;
  cast.doctor = people.addActor({ x: rx, z: rz, shirt: 0xf6f6f6, pants: 0x2b3245, role: 'doctor' });
  cast.nurse = people.addActor({ x: rx + 0.5, z: rz + 0.5, shirt: 0x1f9a8a, pants: 0x1f9a8a, role: 'nurse' });
  const fwd = [-s.side[1], s.side[0]];
  people.walkTo(cast.doctor, s.x + fwd[0] * 1.2 + s.side[0] * 0.2, s.z + fwd[1] * 1.2 + s.side[1] * 0.2, (a) => { a.yaw = Math.atan2(s.z - a.z, s.x - a.x); });
  people.walkTo(cast.nurse, s.x + fwd[0] * 1.2 + s.side[0] * 1.4, s.z + fwd[1] * 1.2 + s.side[1] * 1.4, (a) => { a.yaw = Math.atan2(s.z - a.z, s.x - a.x); });
}

// الحالة والفريق بيركبوا من الباب اللي ورا
function boardVan(done) {
  const rx = player.x - Math.cos(player.heading) * 3.4, rz = player.z - Math.sin(player.heading) * 3.4;
  let left = 0;
  for (const a of [cast.patient, cast.doctor, cast.nurse]) {
    if (!a) continue;
    left++;
    people.walkTo(a, rx, rz, () => { people.removeActor(a); if (--left === 0) done(); });
  }
  if (!left) done();
}

function updateMission(dt) {
  if (!mission) {
    dispatchTimer -= dt;
    $('objective').textContent = 'مستني بلاغ من الكول سنتر...';
    $('missionInfo').hidden = true;
    if (dispatchTimer <= 0) newMission();
    return;
  }
  const m = mission;
  m.elapsed += dt;
  const remain = Math.max(0, m.limit - m.elapsed);
  $('missionInfo').hidden = false;
  $('timer').textContent = `${toArabicDigits(Math.floor(remain / 60))}:${toArabicDigits(String(Math.floor(remain % 60)).padStart(2, '0'))}`;
  $('timer').classList.toggle('late', remain <= 0);

  const target = m.aboard ? door : m.pos;
  const dist = Math.hypot(target.x - player.x, target.z - player.z);
  $('distance').textContent = `${toArabicDigits(Math.round(dist))} م`;
  const stopped = Math.abs(player.speed) < 1.5;
  const zoneR = REAL ? 14 : 6.5;

  if (!m.aboard) {
    $('objective').textContent = `روح لـ ${m.district.name} (العلامة البرتقاني)`;
    if (m.boarding) {
      $('progressLabel').textContent = 'الحالة بتركب العربية...';
      if (!stopped || dist > 8) { people.clearActors(); finishBoarding(); }
    } else if (dist < zoneR && stopped) {
      if (!m.teamOut) { m.teamOut = true; teamOut(); }
      m.calm += dt;
      const frac = m.calm / m.kase.calm;
      $('progress').hidden = false;
      $('progressBar').style.width = `${Math.min(100, frac * 100)}%`;
      $('progressLabel').textContent = 'الفريق بيتكلم مع الحالة والأسرة...';
      const line = Math.min(2, Math.floor(frac * 3));
      if (line !== dialogLine) {
        dialogLine = line;
        if (line === 0) say(pick('doctor'), `مساء الخير، إحنا فريق ${CONFIG.centerShort}. خلّينا نتكلم بهدوء ونفهم محتاجين إيه.`);
        if (line === 1) say(pick('nurse'), 'متقلقش خالص، إحنا معاك خطوة بخطوة. خد نفس عميق.');
        if (line === 2) say(pick('social'), 'الأسرة مطمّنة وجاية ورانا. يلا بينا على المركز بالراحة.');
      }
      if (frac >= 1) {
        m.boarding = true;
        boardVan(finishBoarding);
      }
    } else if (m.calm > 0 && m.calm < m.kase.calm) {
      $('progressLabel').textContent = 'اقف جوّه الدايرة عشان الفريق يكمّل';
    } else {
      $('progress').hidden = true;
    }
  } else {
    $('objective').textContent = `رجّع الحالة لـ ${CONFIG.centerShort} (العلامة الخضرا)`;
    if (dist < zoneR && stopped) {
      m.handover += dt;
      $('progress').hidden = false;
      $('progressBar').style.width = `${Math.min(100, (m.handover / 2.5) * 100)}%`;
      $('progressLabel').textContent = 'تسليم الحالة لفريق الاستقبال...';
      if (m.handover >= 2.5) finishMission();
    } else {
      $('progress').hidden = true;
    }
  }
  $('comfortWrap').hidden = !m.aboard;
  $('comfortBar').style.width = `${m.comfort}%`;
  $('comfortBar').style.background = m.comfort > 70 ? '#3ad29f' : m.comfort > 40 ? '#f2c230' : '#ff5a4a';
}

function finishBoarding() {
  const m = mission;
  if (!m || m.aboard) return;
  m.boarding = false;
  m.aboard = true;
  pickupMarker.visible = false;
  centerMarker.visible = true;
  $('progress').hidden = true;
  sfx.ding();
  toast('✅ الحالة ركبت — سوق بهدوء ورجّعها المركز', 4);
  setTimeout(hideDialog, 2500);
}

function finishMission() {
  const m = mission;
  const remain = Math.max(0, m.limit - m.elapsed);
  const timeBonus = Math.round(remain * 3);
  const comfortBonus = Math.round(m.comfort * 3);
  const total = 150 + timeBonus + comfortBonus;
  score += total;
  missionsDone++;
  if (score > best) {
    best = score;
    try { localStorage.setItem('markaz_best', String(best)); } catch { /* ignore */ }
  }
  const stars = m.comfort >= 85 ? 3 : m.comfort >= 60 ? 2 : 1;
  sfx.ding();
  people.clearActors();
  centerMarker.visible = false;
  $('progress').hidden = true;
  $('comfortWrap').hidden = true;
  state = 'summary';
  $('summary').hidden = false;
  $('sumStars').textContent = '★'.repeat(stars) + '☆'.repeat(3 - stars);
  $('sumRows').innerHTML = `
    <tr><td>توصيل الحالة</td><td>${toArabicDigits(150)}</td></tr>
    <tr><td>الوقت (${remain > 0 ? 'بدري' : 'متأخر'})</td><td>${toArabicDigits(timeBonus)}</td></tr>
    <tr><td>راحة الحالة ${toArabicDigits(Math.round(m.comfort))}٪</td><td>${toArabicDigits(comfortBonus)}</td></tr>
    <tr><td>خبطات</td><td>${toArabicDigits(m.hits)}</td></tr>
    <tr class="tot"><td>المجموع</td><td>${toArabicDigits(total)}</td></tr>`;
  $('sumTip').textContent =
    m.comfort >= 85 ? 'سواقة ممتازة! الحالة وصلت مرتاحة ومطمّنة.' :
    m.comfort >= 60 ? 'كويس — حاول تفرمل بالراحة وتقلّل السارينة والحالة معاك.' :
    'الحالة اتوترت في الطريق: خبطات وفرامل جامدة. المرة الجاية براحة.';
  mission = null;
}

function nextMission() {
  $('summary').hidden = true;
  dispatchTimer = 2;
  state = 'playing';
}
$('btnNext').addEventListener('click', nextMission);

// ---------- الفيزيا ----------
const VAN_LEN = 5.4, VAN_WID = 2.2;
function blockedAt(x, z, h) {
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
  if (back) sp -= (sp > 0.5 ? 20 : 6) * dt;
  if (!fwd && !back) sp -= Math.sign(sp) * Math.min(Math.abs(sp), 2.5 * dt);
  sp -= sp * 0.08 * dt;
  player.speed = clamp(sp, MAXR, MAX);

  const grip = clamp(Math.abs(player.speed) / 6, 0, 1) * (1 - 0.45 * clamp(Math.abs(player.speed) / MAX, 0, 1));
  const newH = player.heading + player.steer * 1.7 * grip * Math.sign(player.speed) * dt;
  const nx = player.x + Math.cos(newH) * player.speed * dt;
  const nz = player.z + Math.sin(newH) * player.speed * dt;

  if (REAL) {
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
      if (REAL || !blockedAt(tx, tz, player.heading)) { player.x = tx; player.z = tz; }
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

  // سلوك السواقة مع وجود الحالة
  if (mission && mission.aboard) {
    tipCooldown -= dt;
    if (back && player.speed > 14) { hurt(7 * dt); if (tipCooldown <= 0) { toast('⚠️ فرامل جامدة — براحة', 2); tipCooldown = 4; } }
    if (Math.abs(player.steer) > 0.6 && Math.abs(player.speed) > 16) { hurt(6 * dt); if (tipCooldown <= 0) { toast('⚠️ لفّة سريعة — هدّي', 2); tipCooldown = 4; } }
    if (player.speed > 23) hurt(2 * dt);
    if (player.siren) { hurt(1.2 * dt); if (tipCooldown <= 0) { toast('🔇 السارينة بتوتّر الحالة — استخدمها في الزحمة بس', 3); tipCooldown = 8; } }
  }

  if (REAL) { groundY = city.groundAt(player.x, player.z, dt); people.groundY = groundY; }
  van.position.set(player.x, groundY, player.z);
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
function drawMinimap() {
  if (REAL) {
    const target = mission ? (mission.aboard ? door : mission.pos) : null;
    city.drawMinimap(mmg, mm.width, player, target);
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
let crowdCount = 0, crowdTimer = 0, attribTimer = 0;
function step(dt) {
  t += dt;

  if (state === 'playing') {
    updatePlayer(dt);
    updateMission(dt);
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
  const sl = van.userData.siren;
  const flash = Math.floor(t * 6) % 2 === 0;
  sl.red.emissiveIntensity = player.siren && flash ? 4 : 0;
  sl.blue.emissiveIntensity = player.siren && !flash ? 4 : 0;

  // علامات
  for (const mk of [pickupMarker, centerMarker]) {
    mk.userData.ring.scale.setScalar(1 + Math.sin(t * 4) * 0.08);
    mk.userData.beam.material.opacity = 0.18 + Math.sin(t * 3) * 0.07;
  }

  // سهم الاتجاه
  const target = mission ? (mission.aboard ? door : mission.pos) : null;
  arrow.visible = !!target && state === 'playing' && camMode !== 1;
  if (target) {
    arrow.position.set(player.x, groundY + 4.2 + Math.sin(t * 3) * 0.2, player.z);
    arrow.rotation.y = -Math.atan2(target.z - player.z, target.x - player.x);
  }

  if (state !== 'menu') {
    $('speed').textContent = toArabicDigits(Math.round(Math.abs(player.speed) * 3.6));
    $('score').textContent = toArabicDigits(score);
    $('district').textContent = '📍 ' + (REAL ? city.placeName(player.x, player.z) : districtAt(player.x).name);
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
  if (REAL) {
    city.update(player.x, player.z);
    centerMarker.position.y = groundY;
    if (city.error && !city.errorShown) {
      city.errorShown = true;
      toast('⚠️ مباني جوجل مش بتحمّل — اتأكد من المفتاح وإن Map Tiles API مفعّل', 8);
    }
    attribTimer -= dt;
    if (attribTimer <= 0) { attribTimer = 2; $('attrib').textContent = 'Google · ' + city.attributions(); }
  }
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
window.__game = { people, city, characters, get frames() { return frames; }, get t() { return t; }, player, get state() { return state; }, get mission() { return mission; }, startGame, newMission, step(n, dt = 1 / 30) { for (let i = 0; i < n; i++) step(dt); } };
