import * as THREE from 'three';
import { makeFacadeTextures } from './world.js';
import { makeRandomTraffic } from './vehicles.js';
import { latLonToLocal } from './realcity.js';

// إسكندرية الحقيقية من OpenStreetMap: مباني بأشكالها الحقيقية + شوارع + مرور + أرصفة
// البيانات في data/osm (بتتولّد بـ tools/fetch_osm.py) — © OpenStreetMap contributors (ODbL)

const ROAD_W = { 1: 16, 2: 13, 3: 11, 4: 9, 5: 7, 6: 5, 7: 5 }; // عرض الشارع بالمتر حسب النوع
const FLOOR_H = 3.2;

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
    this.facade = makeFacadeTextures();
    this.wallMat = new THREE.MeshLambertMaterial({
      map: this.facade.map, emissiveMap: this.facade.emissive, emissive: 0xffffff, emissiveIntensity: 0.8,
      vertexColors: true, side: THREE.DoubleSide,
    });
    this.roofMat = new THREE.MeshLambertMaterial({ color: 0xa89c8a, side: THREE.DoubleSide });
    this.roadMat = new THREE.MeshLambertMaterial({ color: 0x34363c, polygonOffset: true, polygonOffsetFactor: -2 });
    this.parkMat = new THREE.MeshLambertMaterial({ color: 0x3d6b35, polygonOffset: true, polygonOffsetFactor: -1 });
    this.lineMat = new THREE.MeshBasicMaterial({ color: 0xe8e8e0, polygonOffset: true, polygonOffsetFactor: -4 });
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

    // ---- المباني: جدران بشبابيك + أسطح ----
    const wp = [], wn = [], wu = [], wc = [], rp = [];
    const col = new THREE.Color();
    const palette = [0xffffff, 0xf3e3c3, 0xe8d0b0, 0xd9e2e8, 0xf0d9c8, 0xe4e0d0, 0xcfd8c8, 0xf5efe0, 0xe9d6b8];
    let id = 0;
    for (const b of d.b) {
      id++;
      const p = this.pts(b, 1);
      const n = p.length / 2;
      if (n < 3) continue;
      let cx = 0, cz = 0, area = 0;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        area += p[i * 2] * p[j * 2 + 1] - p[j * 2] * p[i * 2 + 1];
        cx += p[i * 2]; cz += p[i * 2 + 1];
      }
      area = Math.abs(area / 2);
      cx /= n; cz /= n;
      const seed = hash(Math.round(cx * 7) ^ Math.round(cz * 13));
      // الارتفاع: من OSM لو موجود، وإلا تقدير (العمارات الكبيرة أعلى)
      let h = b[0] * this.unit;
      if (!h) {
        const floors = area < 40 ? 1 + Math.floor(seed * 2) : area < 150 ? 3 + Math.floor(seed * 4) : 5 + Math.floor(seed * 7);
        h = floors * FLOOR_H;
      }
      h = Math.max(3, Math.min(h, 120));
      col.setHex(palette[Math.floor(seed * palette.length)]);
      // جدران
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const ax = p[i * 2], az = p[i * 2 + 1], bx = p[j * 2], bz = p[j * 2 + 1];
        const len = Math.hypot(bx - ax, bz - az);
        if (len < 0.3) continue;
        const nx = (bz - az) / len, nz = -(bx - ax) / len;
        const u1 = len / 13.6, v1 = h / 12.8; // ٤ شبابيك × ٤ أدوار في الصورة
        wp.push(ax, 0, az, bx, 0, bz, bx, h, bz, ax, 0, az, bx, h, bz, ax, h, az);
        for (let q = 0; q < 6; q++) { wn.push(nx, 0, nz); wc.push(col.r, col.g, col.b); }
        wu.push(0, 0, u1, 0, u1, v1, 0, 0, u1, v1, 0, v1);
      }
      // سطح
      const contour = [];
      for (let i = 0; i < n; i++) contour.push(new THREE.Vector2(p[i * 2], p[i * 2 + 1]));
      try {
        const tris = THREE.ShapeUtils.triangulateShape(contour, []);
        for (const t of tris) for (const vi of t) rp.push(contour[vi].x, h, contour[vi].y);
      } catch { /* شكل غريب */ }
      // للتصادم
      let minx = Infinity, minz = Infinity, maxx = -Infinity, maxz = -Infinity;
      for (let i = 0; i < n; i++) {
        minx = Math.min(minx, p[i * 2]); maxx = Math.max(maxx, p[i * 2]);
        minz = Math.min(minz, p[i * 2 + 1]); maxz = Math.max(maxz, p[i * 2 + 1]);
      }
      c.polys.push({ p, minx, minz, maxx, maxz });
    }
    if (wp.length) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(wp, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(wn, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(wu, 2));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(wc, 3));
      const m = new THREE.Mesh(geo, this.wallMat);
      m.castShadow = m.receiveShadow = true;
      g.add(m);
    }
    if (rp.length) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3));
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, this.roofMat);
      m.receiveShadow = true;
      g.add(m);
    }

    // ---- الشوارع: شرايط أسفلت + خط في النص ----
    const sp = [], lp = [];
    for (const r of d.r) {
      const [type, lanes, oneway] = r;
      const p = this.pts(r, 3);
      const w = lanes ? Math.max(ROAD_W[type] * 0.6, lanes * 3.3) : ROAD_W[type];
      this.roads.push({ chunk: k, type, oneway, w, p });
      const n = p.length / 2;
      for (let i = 0; i < n - 1; i++) {
        const ax = p[i * 2], az = p[i * 2 + 1], bx = p[i * 2 + 2], bz = p[i * 2 + 3];
        const len = Math.hypot(bx - ax, bz - az);
        if (len < 0.1) continue;
        const ox = (-(bz - az) / len) * w / 2, oz = ((bx - ax) / len) * w / 2;
        // نطوّل القطعة شوية عشان الوصلات متبانش
        const ex = ((bx - ax) / len) * w * 0.25, ez = ((bz - az) / len) * w * 0.25;
        const y = type === 7 ? 0.03 : 0.04;
        sp.push(ax - ex + ox, y, az - ez + oz, bx + ex + ox, y, bz + ez + oz, bx + ex - ox, y, bz + ez - oz,
          ax - ex + ox, y, az - ez + oz, bx + ex - ox, y, bz + ez - oz, ax - ex - ox, y, az - ez - oz);
        // خط متقطّع في نص الشوارع الكبيرة
        if (type <= 4 && !oneway) {
          for (let s = 2; s < len - 2; s += 9) {
            const t0 = s / len, t1 = Math.min(1, (s + 4) / len);
            const x0 = ax + (bx - ax) * t0, z0 = az + (bz - az) * t0, x1 = ax + (bx - ax) * t1, z1 = az + (bz - az) * t1;
            const lx = (ox / w) * 0.3, lz = (oz / w) * 0.3;
            lp.push(x0 + lx, 0.06, z0 + lz, x1 + lx, 0.06, z1 + lz, x1 - lx, 0.06, z1 - lz,
              x0 + lx, 0.06, z0 + lz, x1 - lx, 0.06, z1 - lz, x0 - lx, 0.06, z0 - lz);
          }
        }
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
    flat(sp, this.roadMat);
    flat(lp, this.lineMat);

    // ---- الحدائق ----
    const pp = [];
    for (const pk of d.p) {
      const p = this.pts(pk, 0);
      const contour = [];
      for (let i = 0; i < p.length; i += 2) contour.push(new THREE.Vector2(p[i], p[i + 1]));
      if (contour.length < 3) continue;
      try {
        for (const t of THREE.ShapeUtils.triangulateShape(contour, [])) for (const vi of t) pp.push(contour[vi].x, 0.02, contour[vi].y);
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
          const off = r.w / 2 + 1.2;
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
        const off = r.oneway ? 0 : Math.min(r.w / 4, 3);
        const pts = [];
        for (let i = 0; i < n; i++) {
          const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
          const dx = raw[b * 2] - raw[a * 2], dz = raw[b * 2 + 1] - raw[a * 2 + 1], l = Math.hypot(dx, dz) || 1;
          pts.push(raw[i * 2] + (-dz / l) * -off, raw[i * 2 + 1] + (dx / l) * -off);
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
