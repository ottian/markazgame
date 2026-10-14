import * as THREE from 'three';
import { makeFacadeSet } from './facades.js';
import { makeRandomTraffic } from './vehicles.js';
import { latLonToLocal } from './realcity.js';

// إسكندرية الحقيقية من OpenStreetMap: مباني بأشكالها الحقيقية + شوارع + مرور + أرصفة
// البيانات في data/osm (بتتولّد بـ tools/fetch_osm.py) — © OpenStreetMap contributors (ODbL)

const ROAD_W = { 1: 16, 2: 13, 3: 11, 4: 9, 5: 7, 6: 5, 7: 5 }; // عرض الشارع بالمتر حسب النوع
const FLOOR_H = 3.1;
// أنواع المباني (لازم تطابق tools/fetch_osm.py)
const T_GENERIC = 0, T_RESID = 1, T_HOUSE = 2, T_COMM = 3, T_MOSQUE = 4, T_CHURCH = 5, T_SCHOOL = 6, T_HOSP = 7, T_INDUS = 8, T_SMALL = 9, T_STATION = 10;
void T_GENERIC; void T_RESID;
const WHITE = new THREE.Color(1, 1, 1);

function hash(n) {
  n = (n ^ 61) ^ (n >>> 16);
  n = (n + (n << 3)) | 0;
  n ^= n >>> 4;
  n = Math.imul(n, 0x27d4eb2d);
  return ((n ^ (n >>> 15)) >>> 0) / 4294967296;
}

export class OsmCity {
  static async load(origin) {
    const r = await fetch('data/osm/index.json');
    if (!r.ok) return null;
    const index = await r.json();
    return new OsmCity(index, origin);
  }

  constructor(index, origin) {
    this.index = index;
    this.CH = index.chunk;
    this.unit = index.unit;
    // لو مكان المركز في الإعدادات اتغيّر عن اللي اتعملت بيه البيانات
    this.shift = latLonToLocal(index.origin.lat, index.origin.lon, origin);
    this.available = new Set(index.chunks.map(([x, z]) => `${x}_${z}`));
    this.chunks = new Map(); // key -> {state, data, group, polys, grid}
    this.queue = [];
    this.group = new THREE.Group();
    this.facades = makeFacadeSet();
    this.roofMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    this.roadMat = new THREE.MeshLambertMaterial({ color: 0x3a3c42 });
    this.walkMat = new THREE.MeshLambertMaterial({ color: 0xb9b3a8 });
    this.parkMat = new THREE.MeshLambertMaterial({ color: 0x4a7a3a });
    this.lineMat = new THREE.MeshBasicMaterial({ color: 0xeeeeea });
    this.yellowMat = new THREE.MeshBasicMaterial({ color: 0xf2c230 });
    this.domeGeo = new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2);
    this.domeMat = new THREE.MeshStandardMaterial({ color: 0x2f8a6a, metalness: 0.4, roughness: 0.35 });
    this.minaretGeo = new THREE.CylinderGeometry(1.0, 1.3, 1, 10).translate(0, 0.5, 0);
    this.minaretCapGeo = new THREE.ConeGeometry(1.3, 4, 10).translate(0, 2, 0);
    this.minaretMat = new THREE.MeshLambertMaterial({ color: 0xf4efe2 });
    this.tankGeo = new THREE.CylinderGeometry(0.7, 0.7, 1.4, 8).translate(0, 0.7, 0);
    this.tankMat = new THREE.MeshLambertMaterial({ color: 0x3a3a3a });
    this.roads = []; // كل الشوارع المحمّلة (للمرور والأرصفة والخريطة الصغيرة)
    this.version = 0; // بيزيد لما شوارع جديدة تحمّل
  }

  key(cx, cz) { return `${cx}_${cz}`; }

  // ---------- تحميل القطع حوالين اللاعب ----------
  update(px, pz, radius) {
    const cx0 = Math.floor((px - this.shift.x) / this.CH), cz0 = Math.floor((pz - this.shift.z) / this.CH);
    const want = new Set();
    for (let dz = -radius; dz <= radius; dz++)
      for (let dx = -radius; dx <= radius; dx++) {
        const k = this.key(cx0 + dx, cz0 + dz);
        if (!this.available.has(k)) continue;
        want.add(k);
        if (!this.chunks.has(k)) {
          const c = { state: 'loading' };
          this.chunks.set(k, c);
          fetch(`data/osm/c_${k}.json`).then((r) => r.json()).then((d) => { c.data = d; c.state = 'parsed'; this.queue.push(k); })
            .catch(() => { c.state = 'failed'; });
        }
      }
    // نبني قطعة واحدة كل فريم عشان منقطّعش
    const k = this.queue.shift();
    if (k && this.chunks.get(k)?.state === 'parsed') this.build(k);
    // نشيل القطع البعيدة
    for (const [k2, c] of this.chunks) {
      if (want.has(k2) || c.state !== 'built') continue;
      const [x, z] = k2.split('_').map(Number);
      if (Math.abs(x - cx0) > radius + 1 || Math.abs(z - cz0) > radius + 1) this.unload(k2);
    }
  }

  unload(k) {
    const c = this.chunks.get(k);
    if (c.group) {
      this.group.remove(c.group);
      c.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    }
    this.roads = this.roads.filter((r) => r.chunk !== k);
    this.version++;
    this.chunks.delete(k);
  }

  pts(arr, from) {
    const out = new Float32Array(arr.length - from);
    for (let i = from; i < arr.length; i += 2) {
      out[i - from] = arr[i] * this.unit + this.shift.x;
      out[i - from + 1] = arr[i + 1] * this.unit + this.shift.z;
    }
    return out;
  }

  build(k) {
    const c = this.chunks.get(k);
    const d = c.data;
    const g = new THREE.Group();
    c.polys = [];
    c.roadsLocal = [];

    // ---------- المباني ----------
    // كل خامة ليها مصفوفات: p (أماكن) n (اتجاهات) u (UV) c (ألوان)
    const buf = {};
    const B = (m) => (buf[m] ||= { p: [], n: [], u: [], c: [] });
    const roof = [], roofCol = [];
    const domes = [], minarets = [], tanks = [];
    const col = new THREE.Color();
    const WALLS = [0xece2cf, 0xf2e6c8, 0xe6d3b3, 0xddd5c8, 0xefdccb, 0xe9e4d6, 0xd9cdb6, 0xf3ecdd, 0xe8d9bc, 0xcfc6b5];
    const v1 = d.b.length && d.b[0].length >= 3 && this.index.version >= 2;
    let idx = -1;
    for (const b of d.b) {
      idx++;
      const off = v1 ? 3 : 1;
      const hData = b[0] * this.unit, lvData = v1 ? b[1] : 0, type = v1 ? b[2] : 0;
      const p = this.pts(b, off);
      const n = p.length / 2;
      if (n < 3) continue;
      let cx = 0, cz = 0, area2 = 0, minx = Infinity, minz = Infinity, maxx = -Infinity, maxz = -Infinity;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        area2 += p[i * 2] * p[j * 2 + 1] - p[j * 2] * p[i * 2 + 1];
        cx += p[i * 2]; cz += p[i * 2 + 1];
        minx = Math.min(minx, p[i * 2]); maxx = Math.max(maxx, p[i * 2]);
        minz = Math.min(minz, p[i * 2 + 1]); maxz = Math.max(maxz, p[i * 2 + 1]);
      }
      const area = Math.abs(area2 / 2);
      cx /= n; cz /= n;
      const seed = hash(Math.round(cx * 7) ^ Math.round(cz * 13));
      const seed2 = hash(Math.round(cx * 3) ^ Math.round(cz * 17) ^ 999);

      // الارتفاع: من الخريطة لو موجود، وإلا تقدير حسب النوع والمساحة
      let floors;
      if (lvData) floors = lvData;
      else if (type === T_SMALL) floors = 1;
      else if (type === T_HOUSE) floors = 2 + Math.floor(seed * 2);
      else if (type === T_INDUS || type === T_STATION) floors = 2;
      else if (type === T_SCHOOL || type === T_HOSP) floors = 3 + Math.floor(seed * 3);
      else if (type === T_MOSQUE) floors = 2;
      else if (type === T_CHURCH) floors = 4;
      else if (type === T_COMM) floors = 4 + Math.floor(seed * 5);
      else if (area < 40) floors = 1 + Math.floor(seed * 3);
      else if (area < 120) floors = 4 + Math.floor(seed * 5);
      else if (area < 400) floors = 6 + Math.floor(seed * 6);
      else floors = 7 + Math.floor(seed * 7);
      const h = Math.max(3, Math.min(hData || floors * FLOOR_H, 150));

      const facade =
        type === T_INDUS || type === T_STATION || type === T_SMALL ? 'industrial'
          : type === T_SCHOOL || type === T_HOSP ? 'institutional'
            : type === T_MOSQUE || type === T_CHURCH ? 'classic'
              : type === T_COMM ? (seed2 < 0.6 ? 'modern' : 'residential')
                : seed2 < 0.12 ? 'classic' : seed2 < 0.2 ? 'modern' : 'residential';
      // ألوان: المدارس مدهونة، المساجد والمستشفيات أبيض
      let wallHex = WALLS[Math.floor(seed * WALLS.length)];
      if (type === T_SCHOOL) wallHex = [0xf0c060, 0xe8a070, 0xd8d0a0][Math.floor(seed * 3)];
      if (type === T_MOSQUE || type === T_HOSP) wallHex = 0xf7f4ec;
      if (type === T_INDUS) wallHex = 0xb8b2a6;
      col.setHex(wallHex);
      // تعتيق بسيط: الأدوار اللي تحت أغمق شوية
      const shopsBand = (facade === 'residential' || facade === 'modern') && area > 50 && floors >= 3 && seed2 > 0.25 ? 4.2 : 0;

      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const ax = p[i * 2], az = p[i * 2 + 1], bx = p[j * 2], bz = p[j * 2 + 1];
        const len = Math.hypot(bx - ax, bz - az);
        if (len < 0.3) continue;
        const nx = (bz - az) / len, nz = -(bx - ax) / len;
        const quad = (mat, y0, y1, u1, v0, v1x, tint) => {
          const o = B(mat);
          o.p.push(ax, y0, az, bx, y0, bz, bx, y1, bz, ax, y0, az, bx, y1, bz, ax, y1, az);
          o.u.push(0, v0, u1, v0, u1, v1x, 0, v0, u1, v1x, 0, v1x);
          for (let q = 0; q < 6; q++) { o.n.push(nx, 0, nz); o.c.push(tint.r, tint.g, tint.b); }
        };
        const top = h;
        if (shopsBand) {
          quad('shops', 0, shopsBand, len / 13.6, 0, 1, WHITE);
          quad(facade, shopsBand, top, len / 13.6, 0, (top - shopsBand) / 12.4, col);
        } else {
          quad(facade, 0, top, len / 13.6, 0, top / 12.4, col);
        }
        // سور السطح
        if (type !== T_SMALL && type !== T_HOUSE) quad(facade, top, top + 0.9, len / 13.6, 0.97, 1, col);
      }
      // السطح
      const contour = [];
      for (let i = 0; i < n; i++) contour.push(new THREE.Vector2(p[i * 2], p[i * 2 + 1]));
      try {
        const roofHex = type === T_HOUSE ? 0xa0523d : 0x9c9284;
        col.setHex(roofHex);
        for (const t of THREE.ShapeUtils.triangulateShape(contour, [])) for (const vi of t) { roof.push(contour[vi].x, h, contour[vi].y); roofCol.push(col.r, col.g, col.b); }
      } catch { /* شكل غريب */ }
      // تفاصيل: قبة ومئذنة للمساجد، خزانات مية على أسطح العمارات
      const minDim = Math.min(maxx - minx, maxz - minz);
      if (type === T_MOSQUE && minDim > 6) {
        domes.push(cx, h, cz, Math.min(minDim * 0.33, 12));
        // المئذنة عند أبعد ركن عن المركز
        let fi = 0, fd = -1;
        for (let i = 0; i < n; i++) { const dd = (p[i * 2] - cx) ** 2 + (p[i * 2 + 1] - cz) ** 2; if (dd > fd) { fd = dd; fi = i; } }
        const mx = p[fi * 2] + (cx - p[fi * 2]) * 0.12, mz = p[fi * 2 + 1] + (cz - p[fi * 2 + 1]) * 0.12;
        minarets.push(mx, mz, h + 14 + seed * 12);
      } else if ((facade === 'residential' || facade === 'classic') && floors >= 4 && area > 60) {
        const count = 1 + Math.floor(seed2 * 3);
        for (let q = 0; q < count; q++) tanks.push(cx + (seed - 0.5) * minDim * 0.4 + q * 1.8, h, cz + (seed2 - 0.5) * minDim * 0.4);
      }
      c.polys.push({ p, minx, minz, maxx, maxz });
    }
    for (const [mat, o] of Object.entries(buf)) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(o.p, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(o.n, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(o.u, 2));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(o.c, 3));
      const m = new THREE.Mesh(geo, this.facades[mat]);
      m.castShadow = m.receiveShadow = true;
      g.add(m);
    }
    if (roof.length) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(roof, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(roofCol, 3));
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, this.roofMat);
      m.receiveShadow = true;
      g.add(m);
    }
    const dummy = new THREE.Object3D();
    if (domes.length) {
      const dm = new THREE.InstancedMesh(this.domeGeo, this.domeMat, domes.length / 4);
      for (let i = 0; i < domes.length; i += 4) {
        dummy.position.set(domes[i], domes[i + 1], domes[i + 2]);
        dummy.scale.setScalar(domes[i + 3]);
        dummy.updateMatrix();
        dm.setMatrixAt(i / 4, dummy.matrix);
      }
      dm.castShadow = true;
      g.add(dm);
    }
    if (minarets.length) {
      const k3 = minarets.length / 3;
      const shaft = new THREE.InstancedMesh(this.minaretGeo, this.minaretMat, k3);
      const cap = new THREE.InstancedMesh(this.minaretCapGeo, this.domeMat, k3);
      for (let i = 0; i < minarets.length; i += 3) {
        dummy.scale.set(1, minarets[i + 2], 1);
        dummy.position.set(minarets[i], 0, minarets[i + 1]);
        dummy.updateMatrix();
        shaft.setMatrixAt(i / 3, dummy.matrix);
        dummy.scale.setScalar(1);
        dummy.position.set(minarets[i], minarets[i + 2], minarets[i + 1]);
        dummy.updateMatrix();
        cap.setMatrixAt(i / 3, dummy.matrix);
      }
      shaft.castShadow = cap.castShadow = true;
      g.add(shaft, cap);
    }
    if (tanks.length) {
      const tm = new THREE.InstancedMesh(this.tankGeo, this.tankMat, tanks.length / 3);
      dummy.scale.setScalar(1);
      for (let i = 0; i < tanks.length; i += 3) {
        dummy.position.set(tanks[i], tanks[i + 1], tanks[i + 2]);
        dummy.updateMatrix();
        tm.setMatrixAt(i / 3, dummy.matrix);
      }
      g.add(tm);
    }

    // ---------- الشوارع ----------
    const asphalt = [], walk = [], white = [], yellow = [];
    const ribbon = (arr, p, offA, offB, y, from = 0, to = Infinity) => {
      // شريط بين إزاحتين (offA → offB) على طول الخط
      const n = p.length / 2;
      let run = 0;
      for (let i = 0; i < n - 1; i++) {
        const ax = p[i * 2], az = p[i * 2 + 1], bx = p[i * 2 + 2], bz = p[i * 2 + 3];
        const len = Math.hypot(bx - ax, bz - az);
        if (len < 0.05) continue;
        const s0 = Math.max(run, from), s1 = Math.min(run + len, to);
        run += len;
        if (s1 <= s0) continue;
        const ux = (bx - ax) / len, uz = (bz - az) / len, rx = -uz, rz = ux; // rx,rz = يمين الاتجاه
        const t0 = s0 - (run - len), t1 = s1 - (run - len);
        const x0 = ax + ux * t0, z0 = az + uz * t0, x1 = ax + ux * t1, z1 = az + uz * t1;
        arr.push(x0 + rx * offA, y, z0 + rz * offA, x1 + rx * offA, y, z1 + rz * offA, x1 + rx * offB, y, z1 + rz * offB,
          x0 + rx * offA, y, z0 + rz * offA, x1 + rx * offB, y, z1 + rz * offB, x0 + rx * offB, y, z0 + rz * offB);
      }
      return run;
    };
    const polyLen = (p) => { let L = 0; for (let i = 0; i < p.length - 2; i += 2) L += Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]); return L; };
    const disc = (arr, x, z, r, y) => {
      for (let a = 0; a < 8; a++) {
        const a0 = (a / 8) * Math.PI * 2, a1 = ((a + 1) / 8) * Math.PI * 2;
        arr.push(x, y, z, x + Math.cos(a1) * r, y, z + Math.sin(a1) * r, x + Math.cos(a0) * r, y, z + Math.sin(a0) * r);
      }
    };
    for (const r of d.r) {
      const v2 = this.index.version >= 2;
      const [type, lanesTag, oneway] = r;
      const nameIdx = v2 ? r[3] : -1;
      const p = this.pts(r, v2 ? 4 : 3);
      const lanes = lanesTag || (oneway ? (type <= 3 ? 2 : 1) : type <= 2 ? 4 : type <= 4 ? 2 : 2);
      const laneW = type <= 4 ? 3.3 : 2.9;
      const w = type === 7 ? 5 : Math.max(lanes * laneW, type >= 6 ? 4 : 5.5);
      const name = nameIdx >= 0 ? d.names[nameIdx] : '';
      const road = { chunk: k, type, oneway, w, p, name, lanes };
      this.roads.push(road);
      const L = polyLen(p);
      const ya = 0.09, yw = 0.06, ym = 0.115;
      ribbon(asphalt, p, -w / 2, w / 2, type === 7 ? yw + 0.01 : ya);
      disc(asphalt, p[0], p[1], w / 2, ya);
      disc(asphalt, p[p.length - 2], p[p.length - 1], w / 2, ya);
      if (type >= 2 && type <= 6) {
        ribbon(walk, p, w / 2, w / 2 + 2.4, yw);
        ribbon(walk, p, -w / 2 - 2.4, -w / 2, yw);
      }
      if (type > 6 || L < 6) continue;
      // علامات الأرض
      if (!oneway && type <= 4) {
        ribbon(yellow, p, -0.28, -0.12, ym, 3, L - 3); // خط أصفر مزدوج في النص
        ribbon(yellow, p, 0.12, 0.28, ym, 3, L - 3);
      }
      const perDir = oneway ? lanes : Math.max(1, Math.floor(lanes / 2));
      if (type <= 5) {
        // خطوط الحارات المتقطعة
        for (let side of oneway ? [1] : [1, -1]) {
          for (let li = 1; li < perDir; li++) {
            const o = oneway ? -w / 2 + li * (w / lanes) : side * li * (w / 2 / perDir);
            for (let s = 4; s < L - 4; s += 10) ribbon(white, p, o - 0.07, o + 0.07, ym, s, s + 4);
          }
        }
        if (type <= 3) { ribbon(white, p, w / 2 - 0.45, w / 2 - 0.3, ym, 2, L - 2); ribbon(white, p, -w / 2 + 0.3, -w / 2 + 0.45, ym, 2, L - 2); }
      }
      // أسهم الاتجاه في الشوارع اللي اتجاه واحد
      if (oneway) for (let s = 15; s < L - 8; s += 40) this.arrow(white, p, s, ym, w, lanes);
      // عبور مشاة (زيبرا) عند أطراف الشوارع الرئيسية
      if (type >= 2 && type <= 4 && L > 40) {
        for (const s of [5, L - 7]) for (let o = -w / 2 + 0.6; o < w / 2 - 0.4; o += 1.1) ribbon(white, p, o, o + 0.55, ym, s, s + 2.6);
      }
    }
    const flat = (arr, mat) => {
      if (!arr.length) return;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
      const nrm = new Float32Array(arr.length);
      for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1;
      geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
      const m = new THREE.Mesh(geo, mat);
      m.receiveShadow = true;
      g.add(m);
    };
    flat(walk, this.walkMat);
    flat(asphalt, this.roadMat);
    flat(white, this.lineMat);
    flat(yellow, this.yellowMat);

    // ---------- الحدائق ----------
    const pp = [];
    for (const pk of d.p) {
      const p = this.pts(pk, 0);
      const contour = [];
      for (let i = 0; i < p.length; i += 2) contour.push(new THREE.Vector2(p[i], p[i + 1]));
      if (contour.length < 3) continue;
      try {
        for (const t of THREE.ShapeUtils.triangulateShape(contour, [])) for (const vi of t) pp.push(contour[vi].x, 0.03, contour[vi].y);
      } catch { /* ignore */ }
    }
    flat(pp, this.parkMat);

    // شبكة للتصادم (خلية ٢٥ م)
    c.grid = new Map();
    c.polys.forEach((poly, i) => {
      for (let x = Math.floor(poly.minx / 25); x <= Math.floor(poly.maxx / 25); x++)
        for (let z = Math.floor(poly.minz / 25); z <= Math.floor(poly.maxz / 25); z++) {
          const gk = x * 100003 + z;
          if (!c.grid.has(gk)) c.grid.set(gk, []);
          c.grid.get(gk).push(i);
        }
    });

    c.coast = d.c.map((cl) => this.pts(cl, 0));
    c.group = g;
    c.state = 'built';
    c.data = null;
    this.group.add(g);
    this.version++;
  }

  // سهم مرسوم على الأرض عند المسافة s في كل حارة
  arrow(arr, p, s, y, w, lanes) {
    let run = 0;
    for (let i = 0; i < p.length - 2; i += 2) {
      const ax = p[i], az = p[i + 1], bx = p[i + 2], bz = p[i + 3];
      const len = Math.hypot(bx - ax, bz - az);
      if (run + len >= s) {
        const t = s - run, ux = (bx - ax) / len, uz = (bz - az) / len, rx = -uz, rz = ux;
        for (let li = 0; li < lanes; li++) {
          const o = -w / 2 + (li + 0.5) * (w / lanes);
          const cx = ax + ux * t + rx * o, cz = az + uz * t + rz * o;
          const P = (f, l) => [cx + ux * f + rx * l, y, cz + uz * f + rz * l];
          // ساق السهم + راسه
          arr.push(...P(-2, -0.15), ...P(0.6, -0.15), ...P(0.6, 0.15), ...P(-2, -0.15), ...P(0.6, 0.15), ...P(-2, 0.15));
          arr.push(...P(0.6, -0.6), ...P(2, 0), ...P(0.6, 0.6));
        }
        return;
      }
      run += len;
    }
  }

  // ---------- التصادم ----------
  pointInBuilding(x, z) {
    const k = this.key(Math.floor((x - this.shift.x) / this.CH), Math.floor((z - this.shift.z) / this.CH));
    const candidates = [this.chunks.get(k)];
    // المباني اللي على حدود القطع
    for (const [k2, c] of this.chunks) if (k2 !== k && c.state === 'built') candidates.push(c);
    for (const c of candidates) {
      if (!c || c.state !== 'built') continue;
      const list = c.grid.get(Math.floor(x / 25) * 100003 + Math.floor(z / 25));
      if (!list) continue;
      for (const i of list) {
        const poly = c.polys[i];
        if (x < poly.minx || x > poly.maxx || z < poly.minz || z > poly.maxz) continue;
        const p = poly.p, n = p.length / 2;
        let inside = false;
        for (let a = 0, b = n - 1; a < n; b = a++) {
          const xa = p[a * 2], za = p[a * 2 + 1], xb = p[b * 2], zb = p[b * 2 + 1];
          if ((za > z) !== (zb > z) && x < ((xb - xa) * (z - za)) / (zb - za) + xa) inside = !inside;
        }
        if (inside) return true;
      }
    }
    return false;
  }

  blocked(x, z, h, len = 5.4, wid = 2.2) {
    const c = Math.cos(h), s = Math.sin(h);
    const hl = len / 2 - 0.2, hw = wid / 2 - 0.1;
    for (const [a, b] of [[hl, hw], [hl, -hw], [-hl, hw], [-hl, -hw], [hl, 0], [-hl, 0]]) {
      if (this.pointInBuilding(x + a * c - b * s, z + a * s + b * c)) return true;
    }
    return false;
  }

  // أقرب نقطة على شارع (لمكان البداية والبلاغات)
  nearestRoad(x, z, types = [1, 2, 3, 4, 5, 6]) {
    let best = null, bd = Infinity;
    for (const r of this.roads) {
      if (!types.includes(r.type)) continue;
      const p = r.p;
      for (let i = 0; i < p.length - 2; i += 2) {
        const ax = p[i], az = p[i + 1], bx = p[i + 2], bz = p[i + 3];
        const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
        const u = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
        const qx = ax + dx * u, qz = az + dz * u;
        const d = (qx - x) ** 2 + (qz - z) ** 2;
        if (d < bd) { bd = d; best = { x: qx, z: qz, heading: Math.atan2(dz, dx), road: r }; }
      }
    }
    return best;
  }

  randomRoadPoint(px, pz, minD, maxD, types = [5, 6]) {
    const cands = this.roads.filter((r) => types.includes(r.type));
    for (let i = 0; i < 40 && cands.length; i++) {
      const r = cands[Math.floor(Math.random() * cands.length)];
      const j = Math.floor(Math.random() * (r.p.length / 2)) * 2;
      const x = r.p[j], z = r.p[j + 1], d = Math.hypot(x - px, z - pz);
      if (d >= minD && d <= maxD) return { x, z };
    }
    return null;
  }

  // اسم الشارع اللي العربية ماشية فيه
  streetName(x, z) {
    const nr = this.nearestRoad(x, z, [1, 2, 3, 4, 5, 6, 7]);
    if (!nr || Math.hypot(nr.x - x, nr.z - z) > nr.road.w / 2 + 6) return '';
    return nr.road.name || '';
  }

  // أرصفة: على جنبين الشوارع (مش السريعة)
  sidewalks() {
    const out = [];
    for (const r of this.roads) {
      if (r.type < 2 || r.type > 7) continue;
      const p = r.p, n = p.length / 2;
      if (n < 2) continue;
      for (const side of [1, -1]) {
        const pts = [];
        for (let i = 0; i < n; i++) {
          const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
          const dx = p[b * 2] - p[a * 2], dz = p[b * 2 + 1] - p[a * 2 + 1], l = Math.hypot(dx, dz) || 1;
          const off = r.w / 2 + 1.2; // نص الرصيف (عرضه ٢.٤ م)
          pts.push(p[i * 2] + (-dz / l) * off * side, p[i * 2 + 1] + (dx / l) * off * side);
        }
        out.push({ pts });
      }
    }
    return out;
  }

  drawMinimap(g, S, player, target, door, landmarks) {
    const half = S / 2, k = S / 2 / 350;
    g.save();
    g.clearRect(0, 0, S, S);
    g.beginPath();
    g.arc(half, half, half, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = '#2a2f3a';
    g.fillRect(0, 0, S, S);
    g.lineCap = 'round';
    for (const r of this.roads) {
      const p = r.p;
      if (Math.abs(p[0] - player.x) > 900 || Math.abs(p[1] - player.z) > 900) continue;
      g.strokeStyle = r.type <= 2 ? '#f2c230' : r.type <= 4 ? '#e0e0e0' : '#9aa0aa';
      g.lineWidth = Math.max(1.2, r.w * k * 0.9);
      g.beginPath();
      for (let i = 0; i < p.length; i += 2) {
        const x = half + (p[i] - player.x) * k, y = half + (p[i + 1] - player.z) * k;
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.stroke();
    }
    const dot = (x, z, color, r) => {
      let px = half + (x - player.x) * k, py = half + (z - player.z) * k;
      const dx = px - half, dy = py - half, d = Math.hypot(dx, dy);
      if (d > half - 10) { px = half + (dx / d) * (half - 10); py = half + (dy / d) * (half - 10); }
      g.fillStyle = color; g.strokeStyle = '#fff'; g.lineWidth = 2;
      g.beginPath(); g.arc(px, py, r, 0, Math.PI * 2); g.fill(); g.stroke();
    };
    for (const l of landmarks) dot(l.x, l.z, 'rgba(242,194,48,0.7)', 2.5);
    dot(door.x, door.z, '#22e0a8', 5);
    if (target) dot(target.x, target.z, '#ff8a1f', 7);
    g.translate(half, half);
    g.rotate(player.heading);
    g.fillStyle = '#fff';
    g.beginPath();
    g.moveTo(9, 0); g.lineTo(-6, 6); g.lineTo(-3, 0); g.lineTo(-6, -6);
    g.closePath();
    g.fill();
    g.restore();
  }
}

// ---------- مرور على الشوارع الحقيقية ----------
export class OsmTraffic {
  constructor(scene, city, count) {
    this.scene = scene;
    this.city = city;
    this.cars = [];
    this.honks = [];
    this.lanes = [];
    this.ends = new Map();
    this.version = -1;
    for (let i = 0; i < count; i++) {
      const mesh = makeRandomTraffic();
      mesh.visible = false;
      scene.add(mesh);
      this.cars.push({ mesh, lane: null, s: 0, speed: 0, max: 8 + Math.random() * 6, x: 1e9, z: 1e9, heading: 0, bump: 0, stuck: 0, ghost: 0, blocked: 0 });
    }
  }

  rebuild() {
    this.version = this.city.version;
    this.lanes = [];
    this.ends = new Map();
    const endKey = (x, z) => `${Math.round(x)},${Math.round(z)}`;
    for (const r of this.city.roads) {
      if (r.type > 5) continue;
      const n = r.p.length / 2;
      if (n < 2) continue;
      for (const dir of r.oneway ? [1] : [1, -1]) {
        const raw = [];
        for (let i = 0; i < n; i++) {
          const k = dir > 0 ? i : n - 1 - i;
          raw.push(r.p[k * 2], r.p[k * 2 + 1]);
        }
        // إزاحة لليمين (السواقة يمين)
        // سواقة يمين: في الشارع اللي باتجاهين بنمشي في نص الحارة اللي على اليمين
        const off = r.oneway ? 0 : r.w / 4;
        const pts = [];
        for (let i = 0; i < n; i++) {
          const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
          const dx = raw[b * 2] - raw[a * 2], dz = raw[b * 2 + 1] - raw[a * 2 + 1], l = Math.hypot(dx, dz) || 1;
          pts.push(raw[i * 2] + (-dz / l) * off, raw[i * 2 + 1] + (dx / l) * off);
        }
        const cum = [0];
        for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]));
        const lane = { pts, cum, len: cum[n - 1], startKey: endKey(raw[0], raw[1]), endKey: endKey(raw[raw.length - 2], raw[raw.length - 1]) };
        if (lane.len < 8) continue;
        this.lanes.push(lane);
        if (!this.ends.has(lane.startKey)) this.ends.set(lane.startKey, []);
        this.ends.get(lane.startKey).push(lane);
      }
    }
  }

  pos(c) {
    const { pts, cum } = c.lane;
    let i = 1;
    while (i < cum.length - 1 && cum[i] < c.s) i++;
    const seg = cum[i] - cum[i - 1] || 1;
    const u = Math.min(1, Math.max(0, (c.s - cum[i - 1]) / seg));
    const ax = pts[i * 2 - 2], az = pts[i * 2 - 1], bx = pts[i * 2], bz = pts[i * 2 + 1];
    c.x = ax + (bx - ax) * u;
    c.z = az + (bz - az) * u;
    const h = Math.atan2(bz - az, bx - ax);
    let dh = h - c.heading;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    c.heading += dh * 0.3;
  }

  spawn(c, px, pz) {
    const near = this.lanes.filter((l) => {
      const x = l.pts[0], z = l.pts[1], d = Math.hypot(x - px, z - pz);
      return d > 60 && d < 260;
    });
    if (!near.length) { c.lane = null; c.mesh.visible = false; c.x = c.z = 1e9; return; }
    c.lane = near[Math.floor(Math.random() * near.length)];
    c.s = Math.random() * c.lane.len * 0.5;
    c.speed = c.max * 0.6;
    c.heading = Math.atan2(c.lane.pts[3] - c.lane.pts[1], c.lane.pts[2] - c.lane.pts[0]);
    this.pos(c);
    c.mesh.visible = true;
  }

  update(dt, player, peds = []) {
    if (this.version !== this.city.version) {
      this.rebuild();
      for (const c of this.cars) if (c.lane && !this.lanes.includes(c.lane)) this.spawn(c, player.x, player.z);
    }
    if (!this.lanes.length) return;
    for (const c of this.cars) {
      if (!c.lane || Math.hypot(c.x - player.x, c.z - player.z) > 320) { this.spawn(c, player.x, player.z); continue; }
      const fx = Math.cos(c.heading), fz = Math.sin(c.heading);
      let target = c.max;
      if (c.bump > 0) { c.bump -= dt; target = 0; }
      if (c.ghost <= 0) {
        for (const o of this.cars) {
          if (o === c || !o.lane) continue;
          const dx = o.x - c.x, dz = o.z - c.z;
          const ahead = dx * fx + dz * fz;
          if (ahead <= 0 || ahead > 11) continue;
          if (Math.abs(-dx * fz + dz * fx) < 2.4) target = Math.min(target, ahead < 6.5 ? 0 : o.speed);
        }
      } else c.ghost -= dt;
      {
        const dx = player.x - c.x, dz = player.z - c.z;
        const ahead = dx * fx + dz * fz, lat = Math.abs(-dx * fz + dz * fx);
        if (ahead > 0 && ahead < 13 && lat < 3) {
          target = 0;
          c.blocked += dt;
          if (c.blocked > 2.5) { c.blocked = -2 - Math.random() * 3; this.honks.push(c); }
        } else c.blocked = Math.min(0, c.blocked + dt);
        if (player.siren && dx * dx + dz * dz < 3600) target = Math.min(target, 3);
      }
      for (const p of peds) {
        const dx = p.x - c.x, dz = p.z - c.z, ahead = dx * fx + dz * fz;
        if (ahead > 0 && ahead < 10 && Math.abs(-dx * fz + dz * fx) < 2.6) { target = 0; break; }
      }
      if (c.speed < 0.3 && target === 0) { c.stuck += dt; if (c.stuck > 3.5) { c.ghost = 2; c.stuck = 0; } } else c.stuck = 0;
      c.speed += Math.sign(target - c.speed) * Math.min(Math.abs(target - c.speed), (target > c.speed ? 4 : 12) * dt);
      c.s += c.speed * dt;
      if (c.s >= c.lane.len) {
        // تقاطع: نكمّل في شارع متوصّل
        const next = (this.ends.get(c.lane.endKey) || []).filter((l) => l.endKey !== c.lane.startKey);
        if (next.length) { c.lane = next[Math.floor(Math.random() * next.length)]; c.s = 0; } else { this.spawn(c, player.x, player.z); continue; }
      }
      this.pos(c);
      c.mesh.position.set(c.x, 0, c.z);
      c.mesh.rotation.y = -c.heading;
      for (const w of c.mesh.userData.wheels || []) w.rotation.z -= c.speed * dt / 0.4;
    }
  }
}
