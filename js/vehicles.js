import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { CONFIG } from './config.js';

// كل العربيات متجهة لقدّام على محور +x
// الأشكال والخامات مشتركة (cache) عشان الأداء

const geoCache = new Map();
function rbox(w, h, d, r = 0.12) {
  const k = `${w}|${h}|${d}|${r}`;
  if (!geoCache.has(k)) geoCache.set(k, new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2, h / 2, d / 2)));
  return geoCache.get(k);
}
function bbox(w, h, d) {
  const k = `b${w}|${h}|${d}`;
  if (!geoCache.has(k)) geoCache.set(k, new THREE.BoxGeometry(w, h, d));
  return geoCache.get(k);
}

const matCache = new Map();
function paint(color, rough = 0.35, metal = 0.4) {
  const k = `${color}|${rough}|${metal}`;
  if (!matCache.has(k)) matCache.set(k, new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal }));
  return matCache.get(k);
}

const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.32, 16);
wheelGeo.rotateX(Math.PI / 2);
const hubGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.34, 10);
hubGeo.rotateX(Math.PI / 2);
const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
const hubMat = new THREE.MeshStandardMaterial({ color: 0xb8b8b8, roughness: 0.3, metalness: 0.9 });
const glassMat = new THREE.MeshStandardMaterial({ color: 0x0e1824, roughness: 0.05, metalness: 0.9 });
const headMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2c8, emissiveIntensity: 2.2 });
const tailMat = new THREE.MeshStandardMaterial({ color: 0x400000, emissive: 0xff1a1a, emissiveIntensity: 1.6 });
const chromeMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.2, metalness: 1 });
const darkMat = new THREE.MeshStandardMaterial({ color: 0x1b1b1b, roughness: 0.7 });

function mesh(geo, mat, x, y, z, shadow = false) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  if (shadow) m.castShadow = true;
  return m;
}

function addWheels(g, len, wid, r = 0.42) {
  const wheels = [];
  for (const x of [len * 0.31, -len * 0.31])
    for (const z of [wid / 2 - 0.12, -wid / 2 + 0.12]) {
      const w = new THREE.Group();
      w.add(new THREE.Mesh(wheelGeo, wheelMat), new THREE.Mesh(hubGeo, hubMat));
      w.position.set(x, r, z);
      w.scale.setScalar(r / 0.42);
      g.add(w);
      wheels.push(w);
    }
  g.userData.wheels = wheels;
}

function addLights(g, len, wid, y) {
  for (const z of [wid / 2 - 0.32, -wid / 2 + 0.32]) {
    g.add(mesh(bbox(0.06, 0.2, 0.38), headMat, len / 2 + 0.01, y, z));
    g.add(mesh(bbox(0.06, 0.2, 0.38), tailMat, -len / 2 - 0.01, y, z));
  }
  g.add(mesh(bbox(0.08, 0.14, wid - 0.2), chromeMat, len / 2 + 0.02, y - 0.28, 0)); // اكصدام
  g.add(mesh(bbox(0.08, 0.14, wid - 0.2), chromeMat, -len / 2 - 0.02, y - 0.28, 0));
}

const shadowGeo = new THREE.PlaneGeometry(1, 1);
const shadowTex = (() => {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const c = cv.getContext('2d');
  const gr = c.createRadialGradient(32, 32, 4, 32, 32, 32);
  gr.addColorStop(0, 'rgba(0,0,0,0.75)');
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = gr;
  c.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(cv);
})();
const shadowMat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false });
function blob(len, wid) {
  const m = new THREE.Mesh(shadowGeo, shadowMat);
  m.rotation.x = -Math.PI / 2;
  m.scale.set(len + 1.2, wid + 1.2, 1);
  m.position.y = 0.07;
  return m;
}

function sideDecal(text) {
  const cv = document.createElement('canvas');
  cv.width = 512;
  cv.height = 128;
  const g = cv.getContext('2d');
  g.fillStyle = '#0f8f7a';
  g.fillRect(0, 74, 512, 26);
  g.fillStyle = '#f2c230';
  g.fillRect(0, 100, 512, 6);
  g.fillStyle = '#0d5f52';
  g.direction = 'rtl';
  g.textAlign = 'center';
  g.font = 'bold 46px Cairo, Tahoma, sans-serif';
  g.fillText(text, 256, 58);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// عربية الإحضار بتاعة المركز
export function makeVan() {
  const g = new THREE.Group();
  const len = 5.4, wid = 2.2;
  const white = paint(0xf4f4f0, 0.3, 0.2);
  g.add(mesh(rbox(len - 1.1, 2.05, wid, 0.18), white, -0.55, 1.5, 0, true)); // الصندوق
  g.add(mesh(rbox(1.5, 1.25, wid - 0.04, 0.22), white, len / 2 - 0.85, 1.05, 0, true)); // المقدّمة
  g.add(mesh(rbox(0.9, 0.85, wid - 0.1, 0.12), white, len / 2 - 1.4, 1.95, 0, true));
  g.add(mesh(bbox(0.05, 0.7, wid - 0.35), glassMat, len / 2 - 0.92, 1.95, 0)); // زجاج
  g.userData.windshield = g.children[g.children.length - 1];
  g.children[g.children.length - 1].rotation.z = -0.35;
  g.children[g.children.length - 1].position.x = len / 2 - 0.95;
  for (const s of [1, -1]) g.add(mesh(bbox(0.9, 0.55, 0.04), glassMat, len / 2 - 1.45, 2.0, s * (wid / 2 - 0.03)));
  for (const s of [1, -1]) g.add(mesh(bbox(1.3, 0.5, 0.04), glassMat, -0.2, 2.05, s * (wid / 2 + 0.005)));
  // شريط وكتابة على الجنبين
  const decal = sideDecal(CONFIG.centerShort);
  for (const s of [1, -1]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 0.9), new THREE.MeshStandardMaterial({ map: decal, transparent: true, roughness: 0.4 }));
    p.position.set(-0.75, 1.3, s * (wid / 2 + 0.015));
    if (s < 0) p.rotation.y = Math.PI;
    g.add(p);
  }
  const back = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.3), new THREE.MeshStandardMaterial({ color: 0x0f8f7a }));
  back.position.set(-len / 2 - 0.02, 1.25, 0);
  back.rotation.y = -Math.PI / 2;
  g.add(back);
  for (const s of [1, -1]) g.add(mesh(bbox(0.04, 1.5, 0.03), darkMat, -len / 2 - 0.02, 1.6, s * 0.02)); // باب ورا
  // سارينة
  const red = new THREE.MeshStandardMaterial({ color: 0x330000, emissive: 0xff1010, emissiveIntensity: 0 });
  const blue = new THREE.MeshStandardMaterial({ color: 0x000033, emissive: 0x1040ff, emissiveIntensity: 0 });
  g.add(mesh(rbox(0.5, 0.2, 1.6, 0.08), darkMat, 0.6, 2.6, 0));
  g.add(mesh(rbox(0.42, 0.22, 0.7, 0.08), red, 0.6, 2.72, 0.4));
  g.add(mesh(rbox(0.42, 0.22, 0.7, 0.08), blue, 0.6, 2.72, -0.4));
  for (const s of [1, -1]) g.add(mesh(bbox(0.25, 0.18, 0.08), darkMat, len / 2 - 1.2, 1.9, s * (wid / 2 + 0.12))); // مرايات
  addLights(g, len, wid, 0.95);
  addWheels(g, len, wid, 0.44);
  g.add(blob(len, wid));
  g.userData.siren = { red, blue };
  g.userData.size = { len, wid };
  return g;
}

// تاكسي إسكندراني: أصفر تحت وأسود فوق
export function makeTaxi() {
  const g = new THREE.Group();
  const len = 4.3, wid = 1.8;
  g.add(mesh(rbox(len, 0.72, wid, 0.16), paint(0xf2b705, 0.35, 0.3), 0, 0.78, 0, true));
  g.add(mesh(rbox(2.2, 0.62, wid - 0.12, 0.14), paint(0x151515, 0.4, 0.3), -0.2, 1.4, 0, true));
  g.add(mesh(bbox(0.05, 0.45, wid - 0.4), glassMat, 0.91, 1.42, 0));
  for (const s of [1, -1]) g.add(mesh(bbox(1.8, 0.4, 0.03), glassMat, -0.2, 1.45, s * (wid / 2 - 0.05)));
  g.add(mesh(rbox(0.55, 0.22, 0.32, 0.05), new THREE.MeshStandardMaterial({ color: 0xffd23a, emissive: 0xffb000, emissiveIntensity: 0.8 }), -0.2, 1.82, 0));
  addLights(g, len, wid, 0.82);
  addWheels(g, len, wid, 0.38);
  g.add(blob(len, wid));
  g.userData.size = { len, wid };
  return g;
}

export function makeCar(color) {
  const g = new THREE.Group();
  const len = 4.2, wid = 1.8;
  const mat = paint(color, 0.25, 0.6);
  g.add(mesh(rbox(len, 0.7, wid, 0.2), mat, 0, 0.78, 0, true));
  g.add(mesh(rbox(2.1, 0.6, wid - 0.14, 0.18), mat, -0.25, 1.38, 0, true));
  g.add(mesh(bbox(0.05, 0.42, wid - 0.4), glassMat, 0.81, 1.4, 0));
  for (const s of [1, -1]) g.add(mesh(bbox(1.7, 0.4, 0.03), glassMat, -0.25, 1.42, s * (wid / 2 - 0.06)));
  addLights(g, len, wid, 0.82);
  addWheels(g, len, wid, 0.38);
  g.add(blob(len, wid));
  g.userData.size = { len, wid };
  return g;
}

// ميكروباص أبيض بشريط أزرق
export function makeMicrobus() {
  const g = new THREE.Group();
  const len = 5.2, wid = 2.0;
  g.add(mesh(rbox(len, 1.85, wid, 0.25), paint(0xeeeeee, 0.4, 0.2), 0, 1.38, 0, true));
  g.add(mesh(bbox(len + 0.02, 0.22, wid + 0.02), paint(0x1f5fbf, 0.4, 0.2), 0, 1.0, 0));
  g.add(mesh(bbox(0.05, 0.7, wid - 0.35), glassMat, len / 2 + 0.01, 1.85, 0));
  for (const s of [1, -1]) g.add(mesh(bbox(len - 1.2, 0.55, 0.03), glassMat, -0.2, 1.88, s * (wid / 2 + 0.005)));
  addLights(g, len, wid, 0.9);
  addWheels(g, len, wid, 0.44);
  g.add(blob(len, wid));
  g.userData.size = { len, wid };
  return g;
}

// توك توك
export function makeTuktuk() {
  const g = new THREE.Group();
  const len = 2.7, wid = 1.3;
  const body = paint([0x1f8a3a, 0xc81e1e, 0x1e5ac8][Math.floor(Math.random() * 3)], 0.4, 0.3);
  g.add(mesh(rbox(len, 0.7, wid, 0.15), body, 0, 0.75, 0, true));
  g.add(mesh(rbox(len - 0.3, 0.12, wid + 0.1, 0.05), darkMat, -0.1, 1.95, 0, true)); // سقف
  for (const s of [1, -1]) g.add(mesh(bbox(0.08, 0.9, 0.08), darkMat, 0.9, 1.45, s * 0.55));
  for (const s of [1, -1]) g.add(mesh(bbox(0.08, 0.9, 0.08), darkMat, -1.1, 1.45, s * 0.55));
  g.add(mesh(bbox(0.04, 0.5, wid - 0.2), glassMat, 1.0, 1.5, 0));
  g.add(mesh(bbox(0.06, 0.18, 0.3), headMat, len / 2 + 0.01, 0.95, 0));
  g.add(mesh(bbox(0.06, 0.14, 0.25), tailMat, -len / 2 - 0.01, 0.9, 0.4));
  g.add(mesh(bbox(0.06, 0.14, 0.25), tailMat, -len / 2 - 0.01, 0.9, -0.4));
  const wheels = [];
  for (const [x, z] of [[1.0, 0], [-0.9, 0.6], [-0.9, -0.6]]) {
    const w = new THREE.Group();
    w.add(new THREE.Mesh(wheelGeo, wheelMat));
    w.scale.setScalar(0.7);
    w.position.set(x, 0.3, z);
    g.add(w);
    wheels.push(w);
  }
  g.userData.wheels = wheels;
  g.add(blob(len, wid));
  g.userData.size = { len, wid };
  return g;
}

const CAR_COLORS = [0x8a1c1c, 0x2a4a8a, 0xcfcfcf, 0x2b2b2b, 0x5a6b3a, 0xb06a2a, 0xe8e8e8, 0x6a6f78];

export function makeRandomTraffic(rand = Math.random) {
  const r = rand();
  if (r < 0.38) return makeTaxi();
  if (r < 0.52) return makeMicrobus();
  if (r < 0.6) return makeTuktuk();
  return makeCar(CAR_COLORS[Math.floor(rand() * CAR_COLORS.length)]);
}
