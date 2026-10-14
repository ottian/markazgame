import * as THREE from 'three';

// موديلات عربيات معمولة من "بروفايل" جانبي حقيقي (كبوت، زجاج مايل، سقف، شنطة)
// كل حاجة متجهة لقدّام على +x، والعرض على z. أشكال عامة مش ماركات بعينها.

const GLASS = new THREE.MeshPhysicalMaterial({ color: 0x0c141c, roughness: 0.05, metalness: 0.2, clearcoat: 1, transparent: true, opacity: 0.88 });
const TIRE = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.92 });
const RIM = new THREE.MeshStandardMaterial({ color: 0xbfc4c8, roughness: 0.25, metalness: 0.9 });
const TRIM = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.6 });
const CHROME = new THREE.MeshStandardMaterial({ color: 0xdadada, roughness: 0.15, metalness: 1 });
const PLATE = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.5 });
export const HEAD = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff3d0, emissiveIntensity: 1 });
export const TAIL = new THREE.MeshStandardMaterial({ color: 0x5a0000, emissive: 0xff1a1a, emissiveIntensity: 0.8 });
const AMBER = new THREE.MeshStandardMaterial({ color: 0x5a3000, emissive: 0xff9a10, emissiveIntensity: 0.6 });

const paintCache = new Map();
export function paint(hex, metallic = true) {
  const k = `${hex}|${metallic}`;
  if (!paintCache.has(k)) {
    paintCache.set(k, new THREE.MeshPhysicalMaterial({
      color: hex, roughness: metallic ? 0.38 : 0.55, metalness: metallic ? 0.45 : 0.05, clearcoat: 0.6, clearcoatRoughness: 0.15,
    }));
  }
  return paintCache.get(k);
}

// جسم من بروفايل جانبي، مع حواف مدوّرة
function extrudeProfile(pts, width, bevel = 0.06, segs = 3) {
  const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: width - bevel * 2, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: segs, curveSegments: 6,
  });
  geo.translate(0, 0, -(width - bevel * 2) / 2);
  geo.computeVertexNormals();
  return geo;
}

// لوح زجاج جانبي بشكل الشباك
function sidePane(pts, z) {
  const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ShapeGeometry(shape);
  if (z < 0) g.rotateY(Math.PI).scale(-1, 1, 1); // نفس الشكل من الناحية التانية
  g.translate(0, 0, z);
  return g;
}

// لوح زجاج مايل (أمامي/خلفي) بين نقطتين في البروفايل
function slopePane(a, b, halfW) {
  const g = new THREE.BufferGeometry();
  const [ax, ay] = a, [bx, by] = b;
  g.setAttribute('position', new THREE.Float32BufferAttribute([
    ax, ay, -halfW, bx, by, -halfW, bx, by, halfW, ax, ay, -halfW, bx, by, halfW, ax, ay, halfW,
  ], 3));
  g.computeVertexNormals();
  return g;
}

function box(w, h, d, mat, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}

function wheel(r, wdt) {
  const g = new THREE.Group();
  const t = new THREE.Mesh(new THREE.CylinderGeometry(r, r, wdt, 20).rotateX(Math.PI / 2), TIRE);
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.62, r * 0.62, wdt + 0.02, 12).rotateX(Math.PI / 2), RIM);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.18, r * 0.18, wdt + 0.04, 8).rotateX(Math.PI / 2), CHROME);
  g.add(t, rim, hub);
  return g;
}

function addWheels(g, xs, halfTrack, r, wdt = 0.24) {
  const wheels = [];
  for (const x of xs) for (const s of [1, -1]) {
    const w = wheel(r, wdt);
    w.position.set(x, r, s * halfTrack);
    g.add(w);
    wheels.push(w);
  }
  g.userData.wheels = wheels;
}

function lights(g, front, rear, y, halfW, w = 0.42, h = 0.16) {
  for (const s of [1, -1]) {
    g.add(box(0.08, h, w, HEAD, front, y, s * (halfW - w / 2 - 0.06)));
    g.add(box(0.08, h, w * 0.9, TAIL, rear, y, s * (halfW - w / 2 - 0.06)));
    g.add(box(0.06, 0.07, 0.14, AMBER, front - 0.01, y - h / 2 - 0.06, s * (halfW - 0.12)));
  }
}

function blobShadow(len, wid) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const c = cv.getContext('2d');
  const gr = c.createRadialGradient(32, 32, 6, 32, 32, 32);
  gr.addColorStop(0, 'rgba(0,0,0,0.6)');
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = gr;
  c.fillRect(0, 0, 64, 64);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(len + 0.8, wid + 0.8), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.05;
  return m;
}

// ---------- سيدان (ملاكي/تاكسي) ----------
const SEDAN = {
  len: 4.4, wid: 1.74,
  body: [[-2.2, 0.28], [-2.24, 0.62], [-2.12, 0.86], [-1.5, 0.95], [-0.88, 1.38], [0.42, 1.42], [1.12, 0.98], [2.02, 0.84], [2.22, 0.62], [2.2, 0.28]],
  side: [[-1.4, 0.98], [-0.86, 1.33], [0.4, 1.36], [1.02, 1.0]],
  wind: [[1.12, 0.99], [0.44, 1.41]],
  rear: [[-1.5, 0.96], [-0.9, 1.37]],
};

export function makeSedan(color, { roof = null, taxi = false } = {}) {
  const g = new THREE.Group();
  const S = SEDAN, hw = S.wid / 2;
  const body = new THREE.Mesh(extrudeProfile(S.body, S.wid), paint(color));
  body.castShadow = true;
  g.add(body);
  if (roof !== null) {
    // سقف بلون تاني (التاكسي الإسكندراني: أصفر تحت وأسود فوق)
    const top = new THREE.Mesh(extrudeProfile([[-1.48, 0.93], [-0.88, 1.39], [0.42, 1.43], [1.1, 0.96]], S.wid + 0.01, 0.05), paint(roof));
    g.add(top);
  }
  for (const z of [hw + 0.005, -hw - 0.005]) g.add(new THREE.Mesh(sidePane(S.side, z), GLASS));
  g.add(new THREE.Mesh(slopePane(S.wind[0], S.wind[1], hw - 0.08), GLASS));
  g.add(new THREE.Mesh(slopePane(S.rear[0], S.rear[1], hw - 0.1), GLASS));
  // تفاصيل
  g.add(box(0.12, 0.2, S.wid - 0.1, TRIM, 2.2, 0.42, 0)); // اكصدام قدّام
  g.add(box(0.12, 0.2, S.wid - 0.1, TRIM, -2.22, 0.42, 0)); // ورا
  g.add(box(0.05, 0.16, 0.9, TRIM, 2.24, 0.68, 0)); // شبكة
  g.add(box(0.03, 0.14, 0.5, PLATE, 2.27, 0.42, 0)); // نمرة
  g.add(box(0.03, 0.14, 0.5, PLATE, -2.29, 0.5, 0));
  for (const s of [1, -1]) {
    g.add(box(0.16, 0.1, 0.16, paint(roof ?? color), 0.95, 1.05, s * (hw + 0.08))); // مرايات
    g.add(box(1.9, 0.02, 0.01, TRIM, 0.05, 0.62, s * (hw + 0.005))); // خط الباب
    g.add(box(0.01, 0.42, 0.01, TRIM, -0.15, 0.78, s * (hw + 0.006)));
    g.add(box(0.14, 0.03, 0.02, CHROME, 0.4, 0.86, s * (hw + 0.01))); // أكر
    g.add(box(0.14, 0.03, 0.02, CHROME, -0.65, 0.86, s * (hw + 0.01)));
  }
  lights(g, 2.2, -2.24, 0.72, hw);
  if (taxi) {
    const sign = box(0.5, 0.18, 0.32, new THREE.MeshStandardMaterial({ color: 0xffe066, emissive: 0xffc000, emissiveIntensity: 0.6 }), -0.2, 1.53, 0);
    g.add(sign);
  }
  addWheels(g, [1.35, -1.35], hw - 0.12, 0.33);
  g.add(blobShadow(S.len, S.wid));
  g.userData.size = { len: S.len, wid: S.wid };
  return g;
}

// ---------- ميكروباص / فان ----------
const VAN = {
  len: 5.2, wid: 1.92,
  body: [[-2.55, 0.32], [-2.6, 2.02], [-2.48, 2.18], [1.4, 2.2], [2.32, 1.22], [2.52, 1.0], [2.58, 0.32]],
  wind: [[2.3, 1.25], [1.45, 2.12]],
};

export function makeVanBody(color, { len = 5.2, high = 1 } = {}) {
  const g = new THREE.Group();
  const sx = len / VAN.len;
  const prof = VAN.body.map(([x, y]) => [x * sx, y <= 0.4 ? y : 0.32 + (y - 0.32) * high]);
  const hw = VAN.wid / 2;
  const body = new THREE.Mesh(extrudeProfile(prof, VAN.wid, 0.08), paint(color, false));
  body.castShadow = true;
  g.add(body);
  const topY = 0.32 + (2.18 - 0.32) * high;
  const w0 = [VAN.wind[0][0] * sx, 0.32 + (VAN.wind[0][1] - 0.32) * high], w1 = [VAN.wind[1][0] * sx, 0.32 + (VAN.wind[1][1] - 0.32) * high];
  g.add(new THREE.Mesh(slopePane(w0, w1, hw - 0.1), GLASS));
  return { g, hw, sx, topY, prof };
}

export function makeMicrobus() {
  const { g, hw, sx } = makeVanBody(0xf0f0ec, { len: 5.2 });
  // شبابيك جنب الركاب + شريط أزرق
  for (const z of [hw + 0.005, -hw - 0.005]) {
    g.add(new THREE.Mesh(sidePane([[-2.35 * sx, 1.35], [-2.35 * sx, 1.95], [1.35 * sx, 1.95], [1.95 * sx, 1.35]], z), GLASS));
    g.add(new THREE.Mesh(sidePane([[-2.55 * sx, 1.05], [-2.55 * sx, 1.18], [2.5 * sx, 1.18], [2.5 * sx, 1.05]], z + Math.sign(z) * 0.002), new THREE.MeshStandardMaterial({ color: 0x1f5fbf })));
  }
  g.add(box(0.12, 0.22, 1.8, TRIM, 2.58 * sx, 0.45, 0));
  g.add(box(0.12, 0.22, 1.8, TRIM, -2.62 * sx, 0.45, 0));
  g.add(box(0.03, 0.14, 0.5, PLATE, 2.62 * sx, 0.45, 0));
  for (const s of [1, -1]) g.add(box(0.18, 0.14, 0.16, TRIM, 1.6 * sx, 1.75, s * (hw + 0.1)));
  lights(g, 2.56 * sx, -2.62 * sx, 0.85, hw, 0.36, 0.2);
  addWheels(g, [1.65 * sx, -1.65 * sx], hw - 0.14, 0.36);
  g.add(blobShadow(5.2, VAN.wid));
  g.userData.size = { len: 5.2, wid: VAN.wid };
  return g;
}

// أجزاء مدموجة للعربيات الراكنة (InstancedMesh): جسم، سقف، زجاج، عجل
export function sedanInstanceParts() {
  const S = SEDAN, hw = S.wid / 2;
  const merge = (geos) => {
    const pos = [], nrm = [];
    for (const g0 of geos) {
      const g1 = g0.index ? g0.toNonIndexed() : g0;
      if (!g1.attributes.normal) g1.computeVertexNormals();
      pos.push(...g1.attributes.position.array);
      nrm.push(...g1.attributes.normal.array);
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    return out;
  };
  // نسخة خفيفة (مضلعات قليلة) عشان ممكن يبقى فيه آلاف العربيات الراكنة
  const body = extrudeProfile(S.body, S.wid, 0.05, 1);
  const roof = extrudeProfile([[-1.48, 0.93], [-0.88, 1.39], [0.42, 1.43], [1.1, 0.96]], S.wid + 0.01, 0.03, 1);
  const glass = merge([sidePane(S.side, hw + 0.005), sidePane(S.side, -hw - 0.005), slopePane(S.wind[0], S.wind[1], hw - 0.08), slopePane(S.rear[0], S.rear[1], hw - 0.1)]);
  const wheels = merge([1.35, -1.35].flatMap((x) => [1, -1].map((s) => new THREE.CylinderGeometry(0.33, 0.33, 0.24, 8).rotateX(Math.PI / 2).translate(x, 0.33, s * (hw - 0.12)))));
  const trim = merge([new THREE.BoxGeometry(0.12, 0.2, S.wid - 0.1).translate(2.2, 0.42, 0), new THREE.BoxGeometry(0.12, 0.2, S.wid - 0.1).translate(-2.22, 0.42, 0)]);
  return { body, roof, glass, wheels, trim, glassMat: GLASS, tireMat: TIRE, trimMat: TRIM };
}
