import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { CONFIG } from './config.js';

// عربية الإحضار بتاعة المركز — موديل تفصيلي:
// جسم فان سقف عالي، أبواب ورا بتتفتح، باب جنب بيتزحلق، كابينة سواق، جوّه نقالة وكراسي ودولاب،
// لمبة سقف، كشافات وسارينة، شريط عاكس، مرايات، مساحات، فتحات عجل، سلم ورا.
// متجهة لقدّام على +x، والعرض على z، والأرض y = 0.

const L = 5.6, W = 2.05, H = 2.65; // الطول والعرض والارتفاع
const hw = W / 2;

const M = {
  body: new THREE.MeshPhysicalMaterial({ color: 0xf6f6f2, roughness: 0.35, metalness: 0.15, clearcoat: 1, clearcoatRoughness: 0.08 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x1c1d20, roughness: 0.7 }),
  plastic: new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.55 }),
  chrome: new THREE.MeshStandardMaterial({ color: 0xe0e0e0, roughness: 0.12, metalness: 1 }),
  glass: new THREE.MeshPhysicalMaterial({ color: 0x0b1118, roughness: 0.04, metalness: 0.1, clearcoat: 1, transparent: true, opacity: 0.8 }),
  tire: new THREE.MeshStandardMaterial({ color: 0x121212, roughness: 0.95 }),
  rim: new THREE.MeshStandardMaterial({ color: 0xc9cdd1, roughness: 0.2, metalness: 0.95 }),
  interior: new THREE.MeshStandardMaterial({ color: 0xdfe6e4, roughness: 0.8 }),
  floor: new THREE.MeshStandardMaterial({ color: 0x5d6a6a, roughness: 0.9 }),
  mattress: new THREE.MeshStandardMaterial({ color: 0x0f8f7a, roughness: 0.6 }),
  seat: new THREE.MeshStandardMaterial({ color: 0x24353d, roughness: 0.8 }),
  head: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4d6, emissiveIntensity: 1 }),
  drl: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xe8f2ff, emissiveIntensity: 1.5 }),
  tail: new THREE.MeshStandardMaterial({ color: 0x4a0000, emissive: 0xff1a10, emissiveIntensity: 0.8 }),
  rev: new THREE.MeshStandardMaterial({ color: 0x777777, emissive: 0xffffff, emissiveIntensity: 0 }),
  amberL: new THREE.MeshStandardMaterial({ color: 0x4a2a00, emissive: 0xff9a10, emissiveIntensity: 0 }),
  amberR: new THREE.MeshStandardMaterial({ color: 0x4a2a00, emissive: 0xff9a10, emissiveIntensity: 0 }),
  red: new THREE.MeshStandardMaterial({ color: 0x3a0000, emissive: 0xff1010, emissiveIntensity: 0 }),
  blue: new THREE.MeshStandardMaterial({ color: 0x00003a, emissive: 0x1848ff, emissiveIntensity: 0 }),
  cabinLight: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xf2f8ff, emissiveIntensity: 0 }),
};

function canvasTex(w, h, draw, repeat = false) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// شطرنج عاكس (تيل وأبيض) على الجنبين، واسم المركز
const sideTex = canvasTex(2048, 512, (g, w, h) => {
  g.clearRect(0, 0, w, h);
  // شريط شطرنج
  const sq = 64;
  for (let x = 0; x < w; x += sq) for (let r = 0; r < 2; r++) {
    g.fillStyle = ((x / sq + r) % 2) ? '#0f8f7a' : '#ffffff';
    g.fillRect(x, 300 + r * sq, sq, sq);
  }
  g.fillStyle = '#0b5d50';
  g.fillRect(0, 296, w, 4); g.fillRect(0, 300 + sq * 2, w, 4);
  // الاسم
  g.fillStyle = '#0d5f52';
  g.direction = 'rtl';
  g.textAlign = 'center';
  g.font = 'bold 120px Cairo, Tahoma, sans-serif';
  g.fillText(CONFIG.centerShort, w / 2, 170);
  g.font = '64px Cairo, Tahoma, sans-serif';
  g.fillText('للطب النفسي وعلاج الإدمان', w / 2, 260);
  // نجمة/علامة طبية بسيطة
  g.fillStyle = '#0f8f7a';
  g.fillRect(150, 70, 40, 140); g.fillRect(100, 120, 140, 40);
  g.fillRect(w - 190, 70, 40, 140); g.fillRect(w - 240, 120, 140, 40);
});

// شيفرون أحمر وأصفر على الأبواب اللي ورا
const chevronTex = canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#f2c230'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#d3122a';
  for (let i = -4; i < 8; i++) { g.beginPath(); g.moveTo(i * 64, h); g.lineTo(i * 64 + 32, h); g.lineTo(i * 64 + 32 + h, 0); g.lineTo(i * 64 + h, 0); g.closePath(); g.fill(); }
}, true);

const plateTex = canvasTex(256, 64, (g, w, h) => {
  g.fillStyle = '#f4f4f4'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#2f6fd6'; g.fillRect(0, 0, w, 16);
  g.fillStyle = '#111'; g.font = 'bold 34px Cairo, Tahoma, sans-serif'; g.textAlign = 'center';
  g.fillText('ع ر ب  ١٢٣٤', w / 2, 54);
});

function rbox(w, h, d, r, mat, x, y, z) {
  const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2, h / 2, d / 2)), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}
function box(w, h, d, mat, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}
function plane(w, h, mat, x, y, z, ry = 0) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  m.position.set(x, y, z);
  m.rotation.y = ry;
  return m;
}

function wheel(r = 0.4) {
  const g = new THREE.Group();
  const tire = new THREE.Mesh(new THREE.TorusGeometry(r * 0.78, r * 0.24, 12, 28), M.tire);
  const tread = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.26, 28, 1, true).rotateX(Math.PI / 2), M.tire);
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.56, r * 0.56, 0.22, 20).rotateX(Math.PI / 2), M.rim);
  g.add(tire, tread, rim);
  // صواميل وبرامق
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const sp = new THREE.Mesh(new THREE.BoxGeometry(0.05, r * 0.42, 0.03), M.rim);
    sp.position.set(Math.cos(a) * r * 0.22, Math.sin(a) * r * 0.22, 0.12);
    sp.rotation.z = a + Math.PI / 2;
    g.add(sp);
  }
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.26, 10).rotateX(Math.PI / 2), M.chrome));
  return g;
}

export function makeDetailedVan() {
  const g = new THREE.Group();
  const floorY = 0.62; // أرضية الصندوق
  const boxLen = 3.55, boxX = -L / 2 + boxLen / 2; // صندوق المرضى (ورا)

  // ---------- الجسم ----------
  // صندوق المرضى: جدران منفصلة عشان نقدر نفتح الأبواب ونشوف جوّه
  const t = 0.06;
  g.add(rbox(boxLen, H - floorY, t, 0.03, M.body, boxX, floorY + (H - floorY) / 2, hw - t / 2)); // يمين
  g.add(rbox(boxLen - 1.2, H - floorY, t, 0.03, M.body, boxX - 0.6, floorY + (H - floorY) / 2, -hw + t / 2)); // شمال (فيه الباب الجرّار)
  g.add(rbox(boxLen + 0.05, t, W, 0.08, M.body, boxX, H - t / 2, 0)); // سقف
  g.add(rbox(boxLen, 0.32, W, 0.06, M.body, boxX, floorY - 0.12, 0)); // تحت
  g.add(box(boxLen - 0.1, 0.02, W - 0.14, M.floor, boxX, floorY + 0.01, 0)); // أرضية
  // حواف مدوّرة على أركان الصندوق
  for (const z of [hw - 0.06, -hw + 0.06]) g.add(rbox(boxLen + 0.02, 0.12, 0.12, 0.06, M.body, boxX, H - 0.06, z));
  // جوّه: حيطان فاتحة
  g.add(plane(boxLen - 0.15, H - floorY - 0.1, M.interior, boxX, floorY + (H - floorY) / 2, hw - t - 0.005, Math.PI));
  const ceil = plane(boxLen - 0.15, W - 0.14, M.interior, boxX, H - t - 0.005, 0);
  ceil.rotation.x = Math.PI / 2;
  g.add(ceil);

  // كابينة السواق (قدّام): كبوت قصير + زجاج مايل
  const cabX = boxX + boxLen / 2;
  const cab = new THREE.Shape([
    new THREE.Vector2(0, 0.45), new THREE.Vector2(0, H - 0.05), new THREE.Vector2(0.45, H - 0.12),
    new THREE.Vector2(1.25, 1.42), new THREE.Vector2(1.95, 1.18), new THREE.Vector2(2.05, 0.95), new THREE.Vector2(2.07, 0.45),
  ].map((v) => new THREE.Vector2(v.x, v.y)));
  const cabGeo = new THREE.ExtrudeGeometry(cab, { depth: W - 0.12, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.06, bevelSegments: 4, curveSegments: 8 });
  cabGeo.translate(cabX, 0, -(W - 0.12) / 2);
  const cabMesh = new THREE.Mesh(cabGeo, M.body);
  cabMesh.castShadow = true;
  g.add(cabMesh);
  const front = cabX + 2.07;
  // الزجاج الأمامي
  const ws = new THREE.BufferGeometry();
  const a = [cabX + 0.47, H - 0.13], b = [cabX + 1.23, 1.45];
  ws.setAttribute('position', new THREE.Float32BufferAttribute([a[0], a[1], -hw + 0.12, b[0], b[1], -hw + 0.12, b[0], b[1], hw - 0.12, a[0], a[1], -hw + 0.12, b[0], b[1], hw - 0.12, a[0], a[1], hw - 0.12].map((v, i) => (i % 3 === 0 ? v + 0.02 : i % 3 === 1 ? v + 0.02 : v)), 3));
  ws.computeVertexNormals();
  g.add(new THREE.Mesh(ws, M.glass));
  // شبابيك الكابينة الجانبية
  for (const s of [1, -1]) {
    const sh = new THREE.Shape([new THREE.Vector2(cabX + 0.12, 1.5), new THREE.Vector2(cabX + 0.12, H - 0.22), new THREE.Vector2(cabX + 0.48, H - 0.24), new THREE.Vector2(cabX + 1.12, 1.5)]);
    const geo = new THREE.ShapeGeometry(sh);
    geo.translate(0, 0, s * (hw + 0.01));
    g.add(new THREE.Mesh(geo, M.glass));
    // مساحة
  }
  for (const z of [0.42, -0.2]) {
    const wp = box(0.6, 0.025, 0.03, M.dark, cabX + 1.1, 1.52, z);
    wp.rotation.z = 0.5;
    g.add(wp);
  }

  // ---------- قدّام ----------
  g.add(rbox(0.16, 0.42, W - 0.02, 0.06, M.plastic, front + 0.04, 0.48, 0)); // اكصدام
  g.add(rbox(0.06, 0.34, 1.1, 0.03, M.dark, front + 0.03, 0.92, 0)); // شبكة
  for (let i = 0; i < 4; i++) g.add(box(0.02, 0.025, 1.02, M.chrome, front + 0.065, 0.8 + i * 0.075, 0));
  g.add(plane(0.5, 0.12, new THREE.MeshStandardMaterial({ map: plateTex, roughness: 0.5 }), front + 0.13, 0.5, 0, Math.PI / 2));
  for (const s of [1, -1]) {
    g.add(rbox(0.1, 0.2, 0.36, 0.04, M.head, front + 0.02, 0.95, s * (hw - 0.3))); // فانوس
    g.add(box(0.04, 0.03, 0.34, M.drl, front + 0.07, 1.06, s * (hw - 0.3))); // نور نهاري
    g.add(box(0.06, 0.08, 0.12, s > 0 ? M.amberR : M.amberL, front + 0.03, 0.82, s * (hw - 0.12))); // إشارة
    g.add(box(0.05, 0.12, 0.2, M.blue, front + 0.09, 0.56, s * 0.7)); // فلاشر قدّام
    // مراية بدراع
    g.add(box(0.05, 0.05, 0.25, M.dark, cabX + 0.35, 1.72, s * (hw + 0.13)));
    g.add(rbox(0.1, 0.32, 0.2, 0.03, M.dark, cabX + 0.33, 1.72, s * (hw + 0.3)));
  }

  // ---------- عجل وفتحات ----------
  const wheels = [];
  for (const x of [cabX + 1.35, -L / 2 + 0.95]) for (const s of [1, -1]) {
    const w = wheel(0.4);
    w.position.set(x, 0.4, s * (hw - 0.16));
    if (s < 0) w.rotation.y = Math.PI;
    g.add(w);
    wheels.push(w);
    // قوس العجلة
    const arch = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.05, 6, 16, Math.PI), M.plastic);
    arch.position.set(x, 0.45, s * (hw + 0.005));
    g.add(arch);
  }
  g.userData.wheels = wheels;

  // ---------- الجنبين: شطرنج واسم + باب جرّار ----------
  const sideMat = new THREE.MeshStandardMaterial({ map: sideTex, transparent: true, roughness: 0.4, polygonOffset: true, polygonOffsetFactor: -1 });
  g.add(plane(boxLen + 1.6, (boxLen + 1.6) / 4, sideMat, boxX + 0.6, 1.25, hw + 0.012));
  const left = plane(boxLen + 1.6, (boxLen + 1.6) / 4, sideMat, boxX + 0.6, 1.25, -hw - 0.012, Math.PI);
  g.add(left);
  for (const s of [1, -1]) g.add(box(boxLen + 1.8, 0.04, 0.01, M.dark, boxX + 0.6, 0.62, s * (hw + 0.015))); // خط سفلي

  // الباب الجرّار (الشمال): بيتزحلق لورا
  const slide = new THREE.Group();
  slide.add(rbox(1.15, H - floorY - 0.05, t, 0.03, M.body, 0, 0, 0));
  slide.add(plane(0.7, 0.45, M.glass, 0.1, 0.55, -t / 2 - 0.005, Math.PI));
  slide.add(box(0.2, 0.04, 0.04, M.chrome, 0.45, 0.05, -0.05));
  const slideClosed = new THREE.Vector3(boxX + boxLen / 2 - 0.6, floorY + (H - floorY) / 2, -hw + t / 2);
  slide.position.copy(slideClosed);
  g.add(slide);

  // ---------- ورا: بابين بيتفتحوا ----------
  const rearX = -L / 2;
  const doors = [];
  for (const s of [1, -1]) {
    const pivot = new THREE.Group();
    pivot.position.set(rearX, floorY, s * hw); // المفصّلة عند الركن
    const dw = hw - 0.01;
    const panel = rbox(t, H - floorY - 0.04, dw, 0.03, M.body, 0, (H - floorY) / 2, -s * dw / 2);
    pivot.add(panel);
    // شيفرون عاكس + شباك + أكرة
    const chev = new THREE.Mesh(new THREE.PlaneGeometry(dw - 0.08, 0.7), new THREE.MeshStandardMaterial({ map: chevronTex, roughness: 0.5 }));
    chev.material.map.repeat.set(2, 1);
    chev.position.set(-t / 2 - 0.006, 0.55, -s * dw / 2);
    chev.rotation.y = -Math.PI / 2;
    pivot.add(chev);
    const win = plane(dw - 0.25, 0.55, M.glass, -t / 2 - 0.007, H - floorY - 0.5, -s * dw / 2, -Math.PI / 2);
    pivot.add(win);
    pivot.add(box(0.04, 0.04, 0.18, M.chrome, -0.06, 1.0, -s * (dw - 0.12)));
    // فوانيس ورا على الأبواب العليا
    pivot.add(box(0.04, 0.26, 0.14, M.tail, -t / 2 - 0.01, 0.35, -s * (dw - 0.1)));
    g.add(pivot);
    doors.push({ pivot, side: s });
  }
  // نور ورا تحت + رجوع + نمرة + سلم
  for (const s of [1, -1]) {
    g.add(rbox(0.1, 0.42, 0.16, 0.03, M.tail, rearX - 0.02, 0.9, s * (hw - 0.09)));
    g.add(box(0.06, 0.1, 0.14, M.rev, rearX - 0.04, 0.62, s * (hw - 0.09)));
    g.add(box(0.06, 0.08, 0.14, s > 0 ? M.amberR : M.amberL, rearX - 0.04, 1.2, s * (hw - 0.09)));
  }
  g.add(rbox(0.3, 0.12, W - 0.1, 0.04, M.plastic, rearX - 0.12, 0.42, 0)); // سلم/اكصدام
  for (let i = 0; i < 6; i++) g.add(box(0.28, 0.01, 0.06, M.dark, rearX - 0.12, 0.485, -0.75 + i * 0.3));
  g.add(plane(0.5, 0.12, new THREE.MeshStandardMaterial({ map: plateTex, roughness: 0.5 }), rearX - 0.28, 0.42, 0, -Math.PI / 2));

  // ---------- السقف: سارينة + كشافات + تكييف + إريال ----------
  const bar = new THREE.Group();
  bar.add(rbox(0.38, 0.12, 1.75, 0.05, M.dark, 0, 0, 0));
  const segs = [];
  for (let i = 0; i < 6; i++) {
    const mat = i < 3 ? M.red : M.blue;
    const sgm = rbox(0.34, 0.14, 0.26, 0.04, mat, 0, 0.12, -0.7 + i * 0.28);
    bar.add(sgm);
    segs.push(sgm);
  }
  bar.add(box(0.1, 0.1, 0.5, M.cabinLight, 0.18, 0.1, 0)); // كشاف أبيض
  bar.position.set(cabX + 0.15, H + 0.08, 0);
  g.add(bar);
  // فلاشرات على أركان الصندوق اللي ورا
  for (const s of [1, -1]) g.add(rbox(0.12, 0.16, 0.12, 0.04, s > 0 ? M.red : M.blue, rearX + 0.12, H + 0.06, s * (hw - 0.12)));
  g.add(rbox(0.9, 0.22, 1.1, 0.06, M.plastic, boxX - 0.6, H + 0.11, 0)); // تكييف
  for (let i = 0; i < 5; i++) g.add(box(0.8, 0.01, 0.05, M.dark, boxX - 0.6, H + 0.225, -0.4 + i * 0.2));
  const ant = box(0.02, 0.5, 0.02, M.dark, cabX + 0.8, H + 0.25, -0.3);
  ant.rotation.z = -0.3;
  g.add(ant);

  // ---------- جوّه: نقالة وكراسي ودولاب ولمبة ----------
  const inside = new THREE.Group();
  // نقالة على عجل
  inside.add(box(2.0, 0.05, 0.62, M.chrome, boxX + 0.1, floorY + 0.55, 0.25));
  inside.add(rbox(1.92, 0.12, 0.58, 0.05, M.mattress, boxX + 0.1, floorY + 0.64, 0.25));
  inside.add(rbox(0.4, 0.1, 0.5, 0.05, M.interior, boxX + 0.85, floorY + 0.74, 0.25)); // مخدة
  for (const x of [-0.85, 0.85]) for (const z of [0.0, 0.5]) inside.add(box(0.04, 0.5, 0.04, M.chrome, boxX + 0.1 + x, floorY + 0.28, z));
  // كرسيين للفريق
  for (const x of [0.4, -0.5]) {
    inside.add(rbox(0.5, 0.12, 0.45, 0.04, M.seat, boxX + x, floorY + 0.5, -0.65));
    inside.add(rbox(0.5, 0.6, 0.1, 0.04, M.seat, boxX + x, floorY + 0.85, -0.85));
  }
  // دولاب أدوية بأدراج
  inside.add(rbox(0.9, 1.1, 0.4, 0.03, M.interior, boxX + boxLen / 2 - 0.55, floorY + 0.6, -0.7));
  for (let i = 0; i < 4; i++) inside.add(box(0.8, 0.01, 0.01, M.dark, boxX + boxLen / 2 - 0.55, floorY + 0.25 + i * 0.25, -0.49));
  // أنبوبة أكسجين
  const ox = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.8, 12), new THREE.MeshStandardMaterial({ color: 0x2f7a3a, roughness: 0.4, metalness: 0.4 }));
  ox.position.set(boxX - boxLen / 2 + 0.35, floorY + 0.45, hw - 0.2);
  inside.add(ox);
  // لمبة السقف
  inside.add(box(1.4, 0.03, 0.25, M.cabinLight, boxX, H - t - 0.03, 0));
  g.add(inside);
  const cabinPoint = new THREE.PointLight(0xeef6ff, 0, 5, 1.5);
  cabinPoint.position.set(boxX, H - 0.3, 0);
  g.add(cabinPoint);

  // ظل تحت العربية
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const c2 = cv.getContext('2d');
  const gr = c2.createRadialGradient(32, 32, 6, 32, 32, 32);
  gr.addColorStop(0, 'rgba(0,0,0,0.65)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  c2.fillStyle = gr; c2.fillRect(0, 0, 64, 64);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(L + 0.8, W + 0.8), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.05;
  g.add(shadow);

  // ---------- التحكم ----------
  let doorT = 0, doorTarget = 0, slideT = 0, slideTarget = 0, blink = 0;
  g.userData.size = { len: L, wid: W };
  g.userData.siren = { red: M.red, blue: M.blue };
  g.userData.van = {
    openRear(v = true) { doorTarget = v ? 1 : 0; },
    openSide(v = true) { slideTarget = v ? 1 : 0; },
    get open() { return doorT > 0.05 || slideT > 0.05; },
    rearDoorPoint() { return new THREE.Vector3(rearX - 1.2, 0, 0); },
    update(dt, { braking = false, reversing = false, steer = 0, speed = 0, night = 0, siren = false, time = 0, hazard = false }) {
      // الأبواب بتتفتح بنعومة
      doorT += Math.sign(doorTarget - doorT) * Math.min(Math.abs(doorTarget - doorT), dt * 1.2);
      slideT += Math.sign(slideTarget - slideT) * Math.min(Math.abs(slideTarget - slideT), dt * 0.9);
      const ease = (x) => x * x * (3 - 2 * x);
      for (const d of doors) d.pivot.rotation.y = d.side * ease(doorT) * 1.75;
      const se = ease(slideT);
      slide.position.set(slideClosed.x - se * 1.1, slideClosed.y, slideClosed.z - Math.min(se * 4, 1) * 0.12);
      // نور جوّه لما الأبواب مفتوحة أو بالليل
      const inner = Math.max(doorT, slideT);
      M.cabinLight.emissiveIntensity = inner > 0.05 ? 2.2 : night * 0.3;
      cabinPoint.intensity = inner * 3;
      // فرامل ورجوع
      M.tail.emissiveIntensity = (braking ? 3.2 : 0.5 + night * 1.4);
      M.rev.emissiveIntensity = reversing ? 2.5 : 0;
      M.head.emissiveIntensity = 0.6 + night * 3;
      // إشارات: بتشتغل لوحدها في اللفّات البطيئة
      blink += dt;
      const on = Math.floor(blink * 2.6) % 2 === 0;
      const turning = Math.abs(steer) > 0.35 && Math.abs(speed) < 9;
      // فلاشر (الانتظار): الاتنين مع بعض
      M.amberL.emissiveIntensity = ((turning && steer < 0) || hazard) && on ? 3 : 0;
      M.amberR.emissiveIntensity = ((turning && steer > 0) || hazard) && on ? 3 : 0;
      // السارينة: نبض أحمر/أزرق متبادل
      const ph = Math.floor(time * 8) % 4;
      M.red.emissiveIntensity = siren && (ph === 0 || ph === 2) ? 6 : 0;
      M.blue.emissiveIntensity = siren && (ph === 1 || ph === 3) ? 6 : 0;
    },
  };
  return g;
}
