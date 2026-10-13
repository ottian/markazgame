import * as THREE from 'three';
import { CONFIG } from './config.js';

// كل العربيات متجهة لقدّام على محور +x

const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.3, 12);
wheelGeo.rotateX(Math.PI / 2);
const wheelMat = new THREE.MeshLambertMaterial({ color: 0x151515 });
const glassMat = new THREE.MeshLambertMaterial({ color: 0x1b2a3a, emissive: 0x0a1018 });
const headMat = new THREE.MeshBasicMaterial({ color: 0xfff4d0 });
const tailMat = new THREE.MeshBasicMaterial({ color: 0xff2a2a });

function box(w, h, d, mat, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}

function addWheels(g, len, wid, y = 0.42) {
  const wheels = [];
  for (const x of [len * 0.32, -len * 0.32])
    for (const z of [wid / 2, -wid / 2]) {
      const w = new THREE.Mesh(wheelGeo, wheelMat);
      w.position.set(x, y, z);
      g.add(w);
      wheels.push(w);
    }
  g.userData.wheels = wheels;
}

function addLights(g, len, wid, y) {
  for (const z of [wid / 2 - 0.35, -wid / 2 + 0.35]) {
    g.add(box(0.08, 0.22, 0.4, headMat, len / 2 + 0.01, y, z));
    g.add(box(0.08, 0.22, 0.4, tailMat, -len / 2 - 0.01, y, z));
  }
}

function shadow(len, wid) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(len + 0.6, wid + 0.6),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }),
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.06;
  return m;
}

function sideDecal(text) {
  const cv = document.createElement('canvas');
  cv.width = 512;
  cv.height = 128;
  const g = cv.getContext('2d');
  g.clearRect(0, 0, 512, 128);
  g.fillStyle = '#0f8f7a';
  g.fillRect(0, 70, 512, 30);
  g.fillStyle = '#0d5f52';
  g.direction = 'rtl';
  g.textAlign = 'center';
  g.font = 'bold 46px Cairo, Tahoma, sans-serif';
  g.fillText(text, 256, 55);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// عربية الإحضار بتاعة المركز
export function makeVan() {
  const g = new THREE.Group();
  const len = 5.4, wid = 2.2;
  const white = new THREE.MeshLambertMaterial({ color: 0xf6f6f2 });
  g.add(box(len, 1.9, wid, white, 0, 1.45, 0));
  g.add(box(1.2, 1.1, wid - 0.05, white, len / 2 - 0.3, 1.0, 0)); // مقدّمة
  g.add(box(0.05, 0.75, wid - 0.3, glassMat, len / 2 + 0.01, 1.95, 0)); // زجاج قدّامي
  for (const s of [1, -1]) g.add(box(1.0, 0.6, 0.05, glassMat, len / 2 - 0.9, 1.95, s * (wid / 2 + 0.01)));
  // شريط وكتابة على الجنبين
  const decal = sideDecal(CONFIG.centerShort);
  for (const s of [1, -1]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 0.9), new THREE.MeshBasicMaterial({ map: decal, transparent: true }));
    p.position.set(-0.5, 1.5, s * (wid / 2 + 0.02));
    if (s < 0) p.rotation.y = Math.PI;
    g.add(p);
  }
  const back = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.35), new THREE.MeshBasicMaterial({ color: 0x0f8f7a }));
  back.position.set(-len / 2 - 0.02, 1.2, 0);
  back.rotation.y = -Math.PI / 2;
  g.add(back);
  // سارينة
  const red = new THREE.MeshBasicMaterial({ color: 0x551111 });
  const blue = new THREE.MeshBasicMaterial({ color: 0x111155 });
  const lr = box(0.4, 0.22, 0.75, red, len / 2 - 1.2, 2.52, 0.42);
  const lb = box(0.4, 0.22, 0.75, blue, len / 2 - 1.2, 2.52, -0.42);
  g.add(lr, lb);
  addLights(g, len, wid, 0.95);
  addWheels(g, len, wid);
  g.add(shadow(len, wid));
  g.userData.siren = { red, blue };
  g.userData.size = { len, wid };
  return g;
}

// تاكسي إسكندراني: أصفر تحت وأسود فوق
export function makeTaxi() {
  const g = new THREE.Group();
  const len = 4.3, wid = 1.8;
  const yellow = new THREE.MeshLambertMaterial({ color: 0xf2b705 });
  const black = new THREE.MeshLambertMaterial({ color: 0x1a1a1a });
  g.add(box(len, 0.7, wid, yellow, 0, 0.75, 0));
  g.add(box(2.2, 0.6, wid - 0.15, black, -0.2, 1.4, 0));
  g.add(box(0.05, 0.45, wid - 0.35, glassMat, 0.91, 1.4, 0));
  g.add(box(0.5, 0.2, 0.3, new THREE.MeshBasicMaterial({ color: 0xffd23a }), -0.2, 1.8, 0));
  addLights(g, len, wid, 0.8);
  addWheels(g, len, wid, 0.38);
  g.add(shadow(len, wid));
  g.userData.size = { len, wid };
  return g;
}

export function makeCar(color) {
  const g = new THREE.Group();
  const len = 4.2, wid = 1.8;
  const mat = new THREE.MeshLambertMaterial({ color });
  g.add(box(len, 0.7, wid, mat, 0, 0.75, 0));
  g.add(box(2.1, 0.6, wid - 0.15, mat, -0.25, 1.4, 0));
  g.add(box(0.05, 0.45, wid - 0.35, glassMat, 0.81, 1.4, 0));
  for (const s of [1, -1]) g.add(box(1.7, 0.42, 0.05, glassMat, -0.25, 1.42, s * (wid / 2 - 0.07)));
  addLights(g, len, wid, 0.8);
  addWheels(g, len, wid, 0.38);
  g.add(shadow(len, wid));
  g.userData.size = { len, wid };
  return g;
}

// ميكروباص أبيض بشريط أزرق
export function makeMicrobus() {
  const g = new THREE.Group();
  const len = 5.2, wid = 2.0;
  const white = new THREE.MeshLambertMaterial({ color: 0xeeeeee });
  const blue = new THREE.MeshLambertMaterial({ color: 0x1f5fbf });
  g.add(box(len, 1.8, wid, white, 0, 1.35, 0));
  g.add(box(len + 0.02, 0.25, wid + 0.02, blue, 0, 1.0, 0));
  g.add(box(0.05, 0.7, wid - 0.3, glassMat, len / 2 + 0.01, 1.85, 0));
  for (const s of [1, -1]) g.add(box(len - 1.2, 0.55, 0.05, glassMat, -0.2, 1.85, s * (wid / 2 + 0.01)));
  addLights(g, len, wid, 0.9);
  addWheels(g, len, wid);
  g.add(shadow(len, wid));
  g.userData.size = { len, wid };
  return g;
}

const CAR_COLORS = [0x8a1c1c, 0x2a4a8a, 0xcccccc, 0x333333, 0x5a6b3a, 0xb06a2a, 0xe0e0e0];

export function makeRandomTraffic(rand = Math.random) {
  const r = rand();
  if (r < 0.4) return makeTaxi();
  if (r < 0.55) return makeMicrobus();
  return makeCar(CAR_COLORS[Math.floor(rand() * CAR_COLORS.length)]);
}
