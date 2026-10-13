import * as THREE from 'three';
import { TILE, COLS, ROWS, T, CENTER, DISTRICTS, buildMap, solidAt, tileAt, districtAt, tileCenter, randomPickup } from './map.js';
import { buildWorld, makeMarker, makePerson } from './world.js';
import { makeVan } from './vehicles.js';
import { Traffic } from './traffic.js';
import { Sfx } from './audio.js';
import { CONFIG } from './config.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const toArabicDigits = (n) => String(n).replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[d]);

// ---------- الإعداد ----------
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, 1, 0.5, 2500);

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.fov = w < h ? 75 : 62;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

const map = buildMap();
const world = buildWorld(scene, map);
const van = makeVan();
scene.add(van);
const traffic = new Traffic(scene, map.roads, 80);
const sfx = new Sfx();

const pickupMarker = makeMarker(0xff8a1f);
const centerMarker = makeMarker(0x22e0a8);
scene.add(pickupMarker, centerMarker);
pickupMarker.visible = false;
centerMarker.visible = false;
const door = tileCenter(CENTER.doorCol, CENTER.doorRow);
centerMarker.position.set(door.x, 0, door.z);

// سهم فوق العربية بيشاور على الهدف
const arrow = new THREE.Mesh(
  new THREE.ConeGeometry(0.7, 2, 4).rotateZ(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0xffd23a }),
);
scene.add(arrow);

// أشخاص عند مكان الاستلام
const patient = makePerson(0x7aa0c8);
const family = makePerson(0xa05a7a);
scene.add(patient, family);
patient.visible = family.visible = false;

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
const player = { x: door.x + 8, z: door.z + 3, heading: 0, speed: 0, steer: 0, siren: false };
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
$('centerName').textContent = CONFIG.centerName;
$('bestScore').textContent = toArabicDigits(best);
$('btnStart').addEventListener('click', startGame);

function startGame() {
  sfx.init();
  $('menu').hidden = true;
  $('hud').hidden = false;
  if (matchMedia('(pointer: coarse)').matches) $('touch').hidden = false;
  $('driverCard').innerHTML = `${avatarHTML(driver, 40)}<div><b>${driver.name}</b><small>${driver.title}</small></div>`;
  state = 'playing';
  camPos.set(player.x - 11, 5, player.z);
  camLook.set(player.x + 8, 1.6, player.z);
  toast(`أهلاً ${driver.name}! استنّى أول بلاغ...`);
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
  $('dialog').hidden = false;
  $('dialog').innerHTML = `${avatarHTML(staff, 52)}<div><b>${staff.name} <small>${staff.title}</small></b><p>${text}</p></div>`;
}
function hideDialog() { $('dialog').hidden = true; dialogLine = -1; }

// ---------- المهمّات ----------
function newMission() {
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
    placePeople(p, pos);
    pickupMarker.position.set(pos.x, 0, pos.z);
    pickupMarker.visible = true;
    centerMarker.visible = false;
    sfx.call();
    toast(`📞 بلاغ جديد من ${d.name}`, 5);
    $('missionCase').textContent = kase.text;
    state = 'playing';
    return;
  }
}

function placePeople(p, pos) {
  // الناس واقفين على الرصيف ناحية المبنى
  const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];
  let d = dirs.find(([dc, dr]) => tileAt(map, p.c + dc, p.r + dr) === T.BUILDING) || [0, -1];
  const ox = pos.x + d[0] * 5.6, oz = pos.z + d[1] * 5.6;
  const side = [-d[1], d[0]];
  patient.position.set(ox + side[0] * 0.8, 0, oz + side[1] * 0.8);
  family.position.set(ox - side[0] * 0.8, 0, oz - side[1] * 0.8);
  patient.visible = family.visible = true;
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

  if (!m.aboard) {
    $('objective').textContent = `روح لـ ${m.district.name} (العلامة البرتقاني)`;
    if (dist < 6.5 && stopped) {
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
        m.aboard = true;
        patient.visible = false;
        pickupMarker.visible = false;
        centerMarker.visible = true;
        $('progress').hidden = true;
        sfx.ding();
        toast('✅ الحالة ركبت — سوق بهدوء ورجّعها المركز', 4);
        setTimeout(hideDialog, 2500);
      }
    } else if (m.calm > 0 && m.calm < m.kase.calm) {
      $('progressLabel').textContent = 'اقف جوّه الدايرة عشان الفريق يكمّل';
    } else {
      $('progress').hidden = true;
    }
  } else {
    $('objective').textContent = `رجّع الحالة لـ ${CONFIG.centerShort} (العلامة الخضرا)`;
    if (dist < 6.5 && stopped) {
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
  family.visible = false;
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

  if (!blockedAt(nx, nz, newH)) {
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
      if (!blockedAt(tx, tz, player.heading)) { player.x = tx; player.z = tz; }
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

  // سلوك السواقة مع وجود الحالة
  if (mission && mission.aboard) {
    tipCooldown -= dt;
    if (back && player.speed > 14) { hurt(7 * dt); if (tipCooldown <= 0) { toast('⚠️ فرامل جامدة — براحة', 2); tipCooldown = 4; } }
    if (Math.abs(player.steer) > 0.6 && Math.abs(player.speed) > 16) { hurt(6 * dt); if (tipCooldown <= 0) { toast('⚠️ لفّة سريعة — هدّي', 2); tipCooldown = 4; } }
    if (player.speed > 23) hurt(2 * dt);
    if (player.siren) { hurt(1.2 * dt); if (tipCooldown <= 0) { toast('🔇 السارينة بتوتّر الحالة — استخدمها في الزحمة بس', 3); tipCooldown = 8; } }
  }

  van.position.set(player.x, 0, player.z);
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
  if (shake > 0) {
    camera.position.x += (Math.random() - 0.5) * shake * 0.6;
    camera.position.y += (Math.random() - 0.5) * shake * 0.6;
    shake = Math.max(0, shake - dt * 2.5);
  }
  camera.lookAt(camLook);
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
function step(dt) {
  t += dt;

  if (state === 'playing') {
    updatePlayer(dt);
    updateMission(dt);
  }
  if (state !== 'paused') traffic.update(dt, player);
  if (state === 'menu') {
    // كاميرا بتلف حوالين المركز في القائمة
    const a = t * 0.08;
    camera.position.set(door.x + Math.cos(a) * 60, 28, door.z + Math.sin(a) * 60);
    camera.lookAt(door.x, 6, door.z - 10);
  } else updateCamera(dt);

  // سارينة
  const sl = van.userData.siren;
  const flash = player.siren && Math.floor(t * 6) % 2 === 0;
  sl.red.color.setHex(player.siren ? (flash ? 0xff2020 : 0x551111) : 0x551111);
  sl.blue.color.setHex(player.siren ? (!flash ? 0x2050ff : 0x111155) : 0x111155);

  // علامات
  for (const mk of [pickupMarker, centerMarker]) {
    mk.userData.ring.scale.setScalar(1 + Math.sin(t * 4) * 0.08);
    mk.userData.beam.material.opacity = 0.18 + Math.sin(t * 3) * 0.07;
  }
  patient.rotation.y = Math.sin(t * 0.7) * 0.4;
  family.rotation.y = -Math.sin(t * 0.9) * 0.4;

  // سهم الاتجاه
  const target = mission ? (mission.aboard ? door : mission.pos) : null;
  arrow.visible = !!target && state === 'playing' && camMode !== 1;
  if (target) {
    arrow.position.set(player.x, 4.2 + Math.sin(t * 3) * 0.2, player.z);
    arrow.rotation.y = -Math.atan2(target.z - player.z, target.x - player.x);
  }

  if (state !== 'menu') {
    $('speed').textContent = toArabicDigits(Math.round(Math.abs(player.speed) * 3.6));
    $('score').textContent = toArabicDigits(score);
    $('district').textContent = '📍 ' + districtAt(player.x).name;
    drawMinimap();
  }
  if (toastTimer > 0) {
    toastTimer -= dt;
    if (toastTimer <= 0) $('toast').classList.remove('show');
  }
  sfx.update(state === 'playing' ? player.speed : 0, player.siren && state === 'playing');
  world.update(t, camera.position);
}
function frame() {
  requestAnimationFrame(frame);
  frames++;
  step(Math.min(clock.getDelta(), 0.05));
  renderer.render(scene, camera);
}
frame();

// للاختبار من الكونسول
window.__game = { get frames() { return frames; }, get t() { return t; }, player, get state() { return state; }, get mission() { return mission; }, startGame, newMission, step(n, dt = 1 / 30) { for (let i = 0; i < n; i++) step(dt); } };
