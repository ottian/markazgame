import * as THREE from 'three';
import { makeFacadeSet } from './facades.js';
import { makeRandomTraffic } from './vehicles.js';
import { latLonToLocal } from './realcity.js';
import { CONFIG } from './config.js';
import { sedanInstanceParts } from './carmodels.js';

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
    const city = new OsmCity(index, origin);
    try {
      const cr = await fetch('data/osm/coast.json');
      if (cr.ok) city.buildCoast((await cr.json()).chains);
    } catch { /* مفيش ساحل */ }
    return city;
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
    this.roadMat = new THREE.MeshLambertMaterial({ color: 0x3a3c42, side: THREE.DoubleSide });
    this.walkMat = new THREE.MeshLambertMaterial({ color: 0xb9b3a8, side: THREE.DoubleSide });
    this.parkMat = new THREE.MeshLambertMaterial({ color: 0x4a7a3a, side: THREE.DoubleSide });
    this.lineMat = new THREE.MeshBasicMaterial({ color: 0xeeeeea, side: THREE.DoubleSide });
    this.yellowMat = new THREE.MeshBasicMaterial({ color: 0xf2c230, side: THREE.DoubleSide });
    this.domeGeo = new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2);
    this.domeMat = new THREE.MeshStandardMaterial({ color: 0x2f8a6a, metalness: 0.4, roughness: 0.35 });
    this.minaretGeo = new THREE.CylinderGeometry(1.0, 1.3, 1, 10).translate(0, 0.5, 0);
    this.minaretCapGeo = new THREE.ConeGeometry(1.3, 4, 10).translate(0, 2, 0);
    this.minaretMat = new THREE.MeshLambertMaterial({ color: 0xf4efe2 });
    this.tankGeo = new THREE.CylinderGeometry(0.7, 0.7, 1.4, 8).translate(0, 0.7, 0);
    this.tankMat = new THREE.MeshLambertMaterial({ color: 0x3a3a3a });
    // بردورة مدهونة أصفر وأسود (متر لكل لون)
    const stripe = document.createElement('canvas');
    stripe.width = 64; stripe.height = 8;
    const sg = stripe.getContext('2d');
    sg.fillStyle = '#f2c230'; sg.fillRect(0, 0, 32, 8);
    sg.fillStyle = '#161616'; sg.fillRect(32, 0, 32, 8);
    const stripeTex = new THREE.CanvasTexture(stripe);
    stripeTex.wrapS = THREE.RepeatWrapping;
    stripeTex.colorSpace = THREE.SRGBColorSpace;
    this.curbMat = new THREE.MeshLambertMaterial({ map: stripeTex, side: THREE.DoubleSide });
    this.plainCurbMat = new THREE.MeshLambertMaterial({ color: 0x9a958c, side: THREE.DoubleSide });
    const signTex = (draw) => {
      const cv = document.createElement('canvas');
      cv.width = cv.height = 128;
      draw(cv.getContext('2d'));
      const t = new THREE.CanvasTexture(cv);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    };
    const oneTex = signTex((s2) => {
      s2.fillStyle = '#fff'; s2.beginPath(); s2.arc(64, 64, 62, 0, 7); s2.fill();
      s2.fillStyle = '#1456b8'; s2.beginPath(); s2.arc(64, 64, 56, 0, 7); s2.fill();
      s2.fillStyle = '#fff'; s2.fillRect(56, 44, 16, 52);
      s2.beginPath(); s2.moveTo(36, 50); s2.lineTo(64, 18); s2.lineTo(92, 50); s2.fill();
    });
    const noTex = signTex((s2) => {
      s2.fillStyle = '#fff'; s2.beginPath(); s2.arc(64, 64, 62, 0, 7); s2.fill();
      s2.fillStyle = '#d0141e'; s2.beginPath(); s2.arc(64, 64, 56, 0, 7); s2.fill();
      s2.fillStyle = '#fff'; s2.fillRect(26, 54, 76, 20);
    });
    const cyl = (r, h) => new THREE.CylinderGeometry(r, r, h, 8).translate(0, h / 2, 0);
    this.furn = {
      poleMat: new THREE.MeshLambertMaterial({ color: 0x2f3a36 }),
      lampMat: new THREE.MeshStandardMaterial({ color: 0xfff1d0, emissive: 0xffd28a, emissiveIntensity: 3 }),
      boxMat: new THREE.MeshLambertMaterial({ color: 0x1b1b1b }),
      signOneMat: new THREE.MeshBasicMaterial({ map: oneTex, transparent: true, alphaTest: 0.5 }),
      signNoMat: new THREE.MeshBasicMaterial({ map: noTex, transparent: true, alphaTest: 0.5 }),
      lampPole: cyl(0.09, 7.5),
      lampArm: new THREE.BoxGeometry(1.8, 0.12, 0.12).translate(0.9, 7.4, 0),
      lampHead: new THREE.BoxGeometry(0.6, 0.18, 0.35).translate(1.75, 7.3, 0),
      lightPole: cyl(0.1, 3.6),
      lightBox: new THREE.BoxGeometry(0.35, 1.05, 0.35).translate(0, 4.15, 0),
      bulbR: new THREE.SphereGeometry(0.11, 8, 6).translate(0.19, 4.5, 0),
      bulbY: new THREE.SphereGeometry(0.11, 8, 6).translate(0.19, 4.15, 0),
      bulbG: new THREE.SphereGeometry(0.11, 8, 6).translate(0.19, 3.8, 0),
      signPole: cyl(0.05, 2.6),
      signDisc: new THREE.CircleGeometry(0.4, 20).rotateY(Math.PI / 2).translate(0.06, 2.4, 0),
    };
    this.lightR = new THREE.MeshStandardMaterial({ color: 0x330000, emissive: 0xff2010, emissiveIntensity: 0.05 });
    this.lightY = new THREE.MeshStandardMaterial({ color: 0x332200, emissive: 0xffb000, emissiveIntensity: 0.05 });
    this.lightG = new THREE.MeshStandardMaterial({ color: 0x003300, emissive: 0x10ff60, emissiveIntensity: 0.05 });
    // يافطة المركز
    {
      const cv = document.createElement('canvas');
      cv.width = 1024; cv.height = 256;
      const s2 = cv.getContext('2d');
      s2.fillStyle = '#0f6b5c'; s2.fillRect(0, 0, 1024, 256);
      s2.strokeStyle = '#fff'; s2.lineWidth = 10; s2.strokeRect(10, 10, 1004, 236);
      s2.fillStyle = '#fff'; s2.direction = 'rtl'; s2.textAlign = 'center';
      s2.font = 'bold 86px Cairo, Tahoma, sans-serif';
      s2.fillText(CONFIG.centerShort, 512, 118);
      s2.font = '46px Cairo, Tahoma, sans-serif';
      s2.fillText('للطب النفسي وعلاج الإدمان', 512, 200);
      this.centerSignTex = new THREE.CanvasTexture(cv);
      this.centerSignTex.colorSpace = THREE.SRGBColorSpace;
    }
    this.centerInfo = null;
    {
      // بلكونة: سقف خرسانة بارز + سور حديد بفراغات
      const cv = document.createElement('canvas');
      cv.width = 64; cv.height = 32;
      const g2 = cv.getContext('2d');
      g2.clearRect(0, 0, 64, 32);
      g2.fillStyle = '#2f3134';
      g2.fillRect(0, 0, 64, 4);
      g2.fillRect(0, 28, 64, 4);
      for (let x = 2; x < 64; x += 6) g2.fillRect(x, 0, 2, 32);
      const railTex = new THREE.CanvasTexture(cv);
      railTex.wrapS = THREE.RepeatWrapping;
      railTex.repeat.set(2, 1);
      railTex.colorSpace = THREE.SRGBColorSpace;
      const rail = new THREE.PlaneGeometry(2.0, 0.95).translate(0, 0.62, 0.45);
      const sides = [];
      const merge = (geos) => {
        const pos = [], nrm = [], uv = [];
        for (const g0 of geos) { const g1 = g0.toNonIndexed(); pos.push(...g1.attributes.position.array); nrm.push(...g1.attributes.normal.array); uv.push(...g1.attributes.uv.array); }
        const out = new THREE.BufferGeometry();
        out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
        out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        return out;
      };
      // البلكونة متجهة لبره على +x
      const rot = (geo) => geo.rotateY(Math.PI / 2);
      this.balc = {
        slab: rot(new THREE.BoxGeometry(2.1, 0.14, 0.95).translate(0, 0.07, 0)),
        rail: rot(merge([rail, ...sides])),
        slabMat: new THREE.MeshLambertMaterial({ color: 0xd9d0bf }),
        railMat: new THREE.MeshLambertMaterial({ map: railTex, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide }),
        room: new THREE.BoxGeometry(3.2, 2.6, 3.0).translate(0, 1.3, 0),
        roomMat: new THREE.MeshLambertMaterial({ color: 0xcfc6b4 }),
        dish: new THREE.SphereGeometry(0.45, 12, 6, 0, Math.PI * 2, 0, Math.PI / 3).rotateX(Math.PI),
        dishMat: new THREE.MeshLambertMaterial({ color: 0xe8e8e8, side: THREE.DoubleSide }),
      };
    }
    {
      // أشكال العربيات الراكنة والقهاوي (متشاركة)
      const box = (w, h, dd, x, y, z) => new THREE.BoxGeometry(w, h, dd).translate(x, y, z);
      const wheelsGeo = [];
      for (const [x, z] of [[1.3, 0.8], [1.3, -0.8], [-1.3, 0.8], [-1.3, -0.8]]) wheelsGeo.push(new THREE.CylinderGeometry(0.34, 0.34, 0.22, 10).rotateX(Math.PI / 2).translate(x, 0.34, z));
      const merge = (geos) => {
        let pos = [], nrm = [];
        for (const g2 of geos) { const ng = g2.toNonIndexed(); pos.push(...ng.attributes.position.array); nrm.push(...ng.attributes.normal.array); }
        const out = new THREE.BufferGeometry();
        out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
        return out;
      };
      const awnCv = document.createElement('canvas');
      awnCv.width = 64; awnCv.height = 8;
      const ag = awnCv.getContext('2d');
      for (let i = 0; i < 8; i++) { ag.fillStyle = i % 2 ? '#f4efe2' : '#1f7a4a'; ag.fillRect(i * 8, 0, 8, 8); }
      const awnTex = new THREE.CanvasTexture(awnCv);
      awnTex.colorSpace = THREE.SRGBColorSpace;
      this.lifeKit = {
        carBody: box(4.2, 0.62, 1.78, 0, 0.62, 0),
        carCabin: box(2.1, 0.5, 1.62, -0.25, 1.17, 0),
        carRoof: box(2.0, 0.06, 1.56, -0.25, 1.45, 0),
        carWheels: merge(wheelsGeo),
        paint: new THREE.MeshPhysicalMaterial({ roughness: 0.4, metalness: 0.4, clearcoat: 0.5, clearcoatRoughness: 0.15 }),
        sedan: sedanInstanceParts(),
        glass: new THREE.MeshStandardMaterial({ color: 0x18222e, roughness: 0.1, metalness: 0.8 }),
        tire: new THREE.MeshLambertMaterial({ color: 0x141414 }),
        table: merge([box(0.8, 0.04, 0.8, 0, 0.75, 0), box(0.06, 0.75, 0.06, 0, 0.37, 0)]),
        chair: merge([box(0.45, 0.05, 0.45, 0, 0.45, 0), box(0.05, 0.45, 0.45, -0.2, 0.7, 0), box(0.04, 0.45, 0.04, 0.2, 0.22, 0.2), box(0.04, 0.45, 0.04, 0.2, 0.22, -0.2)]),
        seatedTorso: merge([box(0.28, 0.6, 0.42, -0.05, 0.85, 0), box(0.45, 0.16, 0.36, 0.2, 0.52, 0), box(0.14, 0.45, 0.32, 0.42, 0.25, 0)]),
        head: new THREE.SphereGeometry(0.13, 10, 8).translate(-0.05, 1.32, 0),
        awning: box(1.6, 0.06, 7.0, 0, 3.0, 0),
        cat: merge([box(0.38, 0.16, 0.14, 0, 0.12, 0), new THREE.SphereGeometry(0.08, 8, 6).translate(0.22, 0.22, 0), box(0.25, 0.03, 0.03, -0.28, 0.2, 0)]),
        metal: new THREE.MeshLambertMaterial({ color: 0x8a8f96 }),
        plastic: new THREE.MeshLambertMaterial({ color: 0xd8d8d0 }),
        cloth: new THREE.MeshLambertMaterial({ color: 0xffffff }),
        skin: new THREE.MeshLambertMaterial({ color: 0xb98a64 }),
        awningMat: new THREE.MeshLambertMaterial({ map: awnTex, side: THREE.DoubleSide }),
        catMat: new THREE.MeshLambertMaterial({ color: 0xc08a4a }),
      };
    }
    this.seaMat = new THREE.MeshPhongMaterial({ color: 0x3a8cc4, emissive: 0x15466e, specular: 0x406080, shininess: 25, side: THREE.DoubleSide });
    {
      // درابزين الكورنيش: أعمدة بيضا وفراغات
      const cv = document.createElement('canvas');
      cv.width = 64; cv.height = 64;
      const s2 = cv.getContext('2d');
      s2.clearRect(0, 0, 64, 64);
      s2.fillStyle = '#f1ede4';
      s2.fillRect(0, 50, 64, 14); // قاعدة
      for (let x = 4; x < 64; x += 16) { s2.fillRect(x, 8, 8, 44); s2.beginPath(); s2.arc(x + 4, 26, 6, 0, 7); s2.fill(); }
      s2.fillRect(0, 0, 64, 8);
      const t = new THREE.CanvasTexture(cv);
      t.wrapS = THREE.RepeatWrapping;
      t.colorSpace = THREE.SRGBColorSpace;
      this.balustradeMat = new THREE.MeshLambertMaterial({ map: t, alphaTest: 0.5, transparent: true, side: THREE.DoubleSide });
    }
    this.railMat = new THREE.MeshLambertMaterial({ color: 0xf1ede4, side: THREE.DoubleSide });
    this.rockMat = new THREE.MeshLambertMaterial({ color: 0x8f8a82, flatShading: true });
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
    // التفاصيل الصغيرة بتظهر في القطع القريبة بس
    const near = radius >= 2 ? 520 : 380;
    for (const [k3, c3] of this.chunks) {
      if (c3.state !== 'built') continue;
      const [x3, z3] = k3.split('_').map(Number);
      const mx = (x3 + 0.5) * this.CH + this.shift.x, mz = (z3 + 0.5) * this.CH + this.shift.z;
      c3.detail.visible = Math.hypot(mx - px, mz - pz) < near;
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
    const detail = new THREE.Group(); // تفاصيل صغيرة بتظهر قريب بس
    g.add(detail);
    c.detail = detail;
    c.cx = 0; c.cz = 0;
    c.polys = [];
    c.roadsLocal = [];
    // ---------- تكميل المباني الناقصة ----------
    // OpenStreetMap ناقص فيه مباني كتير في إسكندرية: بنملا الأراضي الفاضية على الشوارع بعمارات شبه اللي حواليها
    {
      const v2i = this.index.version >= 2;
      const roadsPre = d.r.map((r) => {
        const [type, lanesTag, oneway] = r;
        const lanes = lanesTag || (oneway ? (type <= 3 ? 2 : 1) : type <= 2 ? 4 : 2);
        const w = type === 7 ? 5 : Math.max(lanes * (type <= 4 ? 3.3 : 2.9), type >= 6 ? 4 : 5.5);
        return { type, w, p: this.pts(r, v2i ? 4 : 3) };
      });
      // شبكة لقطع الشوارع (عشان ما نبنيش فوق شارع)
      const segGrid = new Map();
      const CELL = 20;
      for (const r of roadsPre) {
        const p = r.p;
        for (let i = 0; i < p.length - 2; i += 2) {
          const seg = [p[i], p[i + 1], p[i + 2], p[i + 3], r.w / 2 + 2.8];
          const x0 = Math.floor(Math.min(p[i], p[i + 2]) / CELL) - 1, x1 = Math.floor(Math.max(p[i], p[i + 2]) / CELL) + 1;
          const z0 = Math.floor(Math.min(p[i + 1], p[i + 3]) / CELL) - 1, z1 = Math.floor(Math.max(p[i + 1], p[i + 3]) / CELL) + 1;
          for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
            const k2 = x * 100003 + z;
            if (!segGrid.has(k2)) segGrid.set(k2, []);
            segGrid.get(k2).push(seg);
          }
        }
      }
      const onRoad = (x, z) => {
        for (const [ax, az, bx, bz, hw] of segGrid.get(Math.floor(x / CELL) * 100003 + Math.floor(z / CELL)) || []) {
          const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
          const u = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
          if ((ax + dx * u - x) ** 2 + (az + dz * u - z) ** 2 < hw * hw) return true;
        }
        return false;
      };
      // خلايا ٢ م مشغولة بالمباني الموجودة
      const occ = new Set();
      const mark = (x, z) => occ.add(Math.floor(x / 2) * 100003 + Math.floor(z / 2));
      const taken = (x, z) => occ.has(Math.floor(x / 2) * 100003 + Math.floor(z / 2));
      for (const b of d.b) {
        const p = this.pts(b, 3);
        let minx = Infinity, minz = Infinity, maxx = -Infinity, maxz = -Infinity;
        for (let i = 0; i < p.length; i += 2) { minx = Math.min(minx, p[i]); maxx = Math.max(maxx, p[i]); minz = Math.min(minz, p[i + 1]); maxz = Math.max(maxz, p[i + 1]); }
        for (let x = minx; x <= maxx + 1; x += 2) for (let z = minz; z <= maxz + 1; z += 2) mark(x, z);
      }
      const added = [];
      for (const r of roadsPre) {
        if (r.type < 3 || r.type > 6) continue;
        const p = r.p;
        let run = 0;
        for (let i = 0; i < p.length - 2; i += 2) {
          const ax = p[i], az = p[i + 1], bx = p[i + 2], bz = p[i + 3];
          const len = Math.hypot(bx - ax, bz - az);
          if (len < 12) { run += len; continue; }
          const ux = (bx - ax) / len, uz = (bz - az) / len, rx = -uz, rz = ux;
          for (const side of [1, -1]) {
            let s = 3;
            while (s < len - 6) {
              const seed = hash(Math.round((ax + s) * 13) ^ Math.round(az * 7) ^ (side > 0 ? 77 : 33));
              const W = 8 + seed * 7, D = 11 + hash(Math.round(s * 31) ^ Math.round(bx)) * 8;
              if (s + W > len - 3) break;
              const off = r.w / 2 + 2.9;
              // ٤ أركان + نقط جوّه
              const pt = (a, o) => [ax + ux * (s + a) + rx * side * (off + o), az + uz * (s + a) + rz * side * (off + o)];
              let ok = true;
              for (let a = 0; a <= W && ok; a += 2) for (let o = 0; o <= D && ok; o += 2) {
                const [x, z] = pt(a, o);
                if (taken(x, z) || onRoad(x, z) || x * x + z * z < 35 * 35 || this.pointInSea(x, z)) ok = false; // نسيب حوالين المركز فاضي
              }
              if (ok) {
                const corners = [pt(0, 0), pt(W, 0), pt(W, D), pt(0, D)];
                for (let a = 0; a <= W; a += 2) for (let o = 0; o <= D; o += 2) { const [x, z] = pt(a, o); mark(x, z); }
                const floors = r.type <= 4 ? 6 + Math.floor(seed * 6) : 4 + Math.floor(seed * 6);
                const entry = [0, floors, 1];
                for (const [x, z] of corners) entry.push((x - this.shift.x) / this.unit, (z - this.shift.z) / this.unit);
                added.push(entry);
                s += W + 0.3;
              } else s += 3;
            }
          }
          run += len;
        }
      }
      for (const e of added) d.b.push(e);
      this.infilled = (this.infilled || 0) + added.length;
    }


    // ---------- المباني ----------
    // كل خامة ليها مصفوفات: p (أماكن) n (اتجاهات) u (UV) c (ألوان)
    const buf = {};
    const B = (m) => (buf[m] ||= { p: [], n: [], u: [], c: [] });
    const roof = [], roofCol = [];
    const domes = [], minarets = [], tanks = [], balconies = [], roofRooms = [], dishes = [];
    const col = new THREE.Color();
    const WALLS = [0xece2cf, 0xf2e6c8, 0xe6d3b3, 0xddd5c8, 0xefdccb, 0xe9e4d6, 0xd9cdb6, 0xf3ecdd, 0xe8d9bc, 0xcfc6b5];
    const v1 = d.b.length && d.b[0].length >= 3 && this.index.version >= 2;
    // مبنى المركز: اللي فيه نقطة المركز، أو أقرب واحد ليها (لحد ٤٠ م)
    let centerIdx = -1, centerPoly = null;
    if (!this.centerInfo) {
      let bestD = 40;
      d.b.forEach((b, i) => {
        const p = this.pts(b, v1 ? 3 : 1), n = p.length / 2;
        let inside = false, cx = 0, cz = 0;
        for (let a = 0, j = n - 1; a < n; j = a++) {
          const xa = p[a * 2], za = p[a * 2 + 1], xb = p[j * 2], zb = p[j * 2 + 1];
          if ((za > 0) !== (zb > 0) && 0 < ((xb - xa) * (0 - za)) / (zb - za) + xa) inside = !inside;
          cx += xa; cz += za;
        }
        const dist = inside ? -1 : Math.hypot(cx / n, cz / n);
        if (dist < bestD) { bestD = dist; centerIdx = i; }
      });
    }
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
      let h = Math.max(3, Math.min(hData || floors * FLOOR_H, 150));
      if (idx === centerIdx) h = Math.max(h, 4 * FLOOR_H);

      const isCenter = idx === centerIdx;
      const facade = isCenter ? 'center' :
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
      if (isCenter) wallHex = 0xffffff;
      col.setHex(wallHex);
      // تعتيق بسيط: الأدوار اللي تحت أغمق شوية
      const grime = hash(Math.round(cx * 11) ^ Math.round(cz * 5) ^ 4242);
      const shopsBand = !isCenter && (facade === 'residential' || facade === 'modern') && area > 50 && floors >= 3 && seed2 > 0.25 ? 4.2 : 0;

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
          // تعتيق: تحت أغمق (تراب وعوادم)، وفوق أفتح شوية من الشمس
          const g0 = mat === 'shops' ? 1 : 0.78 + grime * 0.1, g1 = mat === 'shops' ? 1 : Math.min(1.06, 0.96 + (y1 / 40) * 0.1);
          const ys = [y0, y0, y1, y0, y1, y1];
          for (let q = 0; q < 6; q++) { const f = ys[q] === y0 ? g0 : g1; o.n.push(nx, 0, nz); o.c.push(tint.r * f, tint.g * f, tint.b * f); }
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
        // بلكونات حقيقية بارزة (سقف خرسانة + سور حديد) على الحيطان الطويلة
        if ((facade === 'residential' || facade === 'classic') && floors >= 3 && len > 5 && balconies.length < 2500 * 5) {
          const mx = (ax + bx) / 2, mz = (az + bz) / 2;
          const out = nx * (mx - cx) + nz * (mz - cz) >= 0 ? 1 : -1;
          const ox = nx * out, oz = nz * out;
          const fh = h / floors;
          const f0 = shopsBand ? 2 : 1;
          for (let k = 0; (k + 0.5) * 3.4 < len - 0.8; k++) {
            const s0 = (k + 0.5) * 3.4 / len;
            const px = ax + (bx - ax) * s0, pz = az + (bz - az) * s0;
            for (let f = f0; f < floors; f++) {
              if ((k + f + Math.floor(seed2 * 3)) % 2) continue;
              balconies.push(px + ox * 0.5, f * fh, pz + oz * 0.5, Math.atan2(oz, ox), seed2);
            }
          }
        }
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
        // أوضة السلم على السطح + دش
        if (minDim > 7) roofRooms.push(cx - (seed - 0.5) * minDim * 0.3, h, cz - (seed2 - 0.5) * minDim * 0.3, seed * 6);
        if (seed2 > 0.35) dishes.push(cx + (seed2 - 0.5) * minDim * 0.5, h, cz + (seed - 0.5) * minDim * 0.5, seed * 6);
      }
      if (isCenter) centerPoly = { p, cx, cz, h };
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
    if (balconies.length) {
      const n5 = balconies.length / 5;
      const slab = new THREE.InstancedMesh(this.balc.slab, this.balc.slabMat, n5);
      const rail = new THREE.InstancedMesh(this.balc.rail, this.balc.railMat, n5);
      const dd = new THREE.Object3D();
      for (let i = 0; i < n5; i++) {
        dd.position.set(balconies[i * 5], balconies[i * 5 + 1], balconies[i * 5 + 2]);
        dd.rotation.set(0, -balconies[i * 5 + 3], 0);
        dd.updateMatrix();
        slab.setMatrixAt(i, dd.matrix);
        rail.setMatrixAt(i, dd.matrix);
      }
      slab.castShadow = rail.castShadow = true;
      slab.receiveShadow = true;
      detail.add(slab, rail);
    }
    if (roofRooms.length) {
      const n4 = roofRooms.length / 4;
      const rm = new THREE.InstancedMesh(this.balc.room, this.balc.roomMat, n4);
      const dd = new THREE.Object3D();
      for (let i = 0; i < n4; i++) {
        dd.position.set(roofRooms[i * 4], roofRooms[i * 4 + 1], roofRooms[i * 4 + 2]);
        dd.rotation.set(0, roofRooms[i * 4 + 3], 0);
        dd.updateMatrix();
        rm.setMatrixAt(i, dd.matrix);
      }
      rm.castShadow = true;
      g.add(rm);
    }
    if (dishes.length) {
      const n4 = dishes.length / 4;
      const dm2 = new THREE.InstancedMesh(this.balc.dish, this.balc.dishMat, n4);
      const dd = new THREE.Object3D();
      for (let i = 0; i < n4; i++) {
        dd.position.set(dishes[i * 4], dishes[i * 4 + 1] + 0.9, dishes[i * 4 + 2]);
        dd.rotation.set(-0.7, dishes[i * 4 + 3], 0);
        dd.updateMatrix();
        dm2.setMatrixAt(i, dd.matrix);
      }
      g.add(dm2);
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
    const curbs = { p: [], u: [], n: [] }, plainCurbs = { p: [], u: [], n: [] };
    const lamps = [], lights = [], signsOne = [], signsNo = [], parked = [], cafes = [];
    const parkedCells = new Set();
    // العربية الراكنة متدخلش في مبنى
    const onAnyBuilding = (x, z) => c.polys.some((pl) => x > pl.minx - 1 && x < pl.maxx + 1 && z > pl.minz - 1 && z < pl.maxz + 1 && (() => {
      const pp = pl.p, n = pp.length / 2; let ins = false;
      for (let i = 0, j = n - 1; i < n; j = i++) { const xa = pp[i * 2], za = pp[i * 2 + 1], xb = pp[j * 2], zb = pp[j * 2 + 1]; if ((za > z) !== (zb > z) && x < ((xb - xa) * (z - za)) / (zb - za) + xa) ins = !ins; }
      return ins;
    })());
    const ribbon = (arr, p, offA, offB, y, from = 0, to = Infinity) => {
      // شريط أفقي بين إزاحتين (offA → offB) على طول الخط
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
    // حيطة رأسية (بردورة) على إزاحة ثابتة، UV بطول الشارع عشان الخطوط الصفرا والسودا
    const wall = (o, p, off, y0, y1, from, to, facing) => {
      const n = p.length / 2;
      let run = 0;
      for (let i = 0; i < n - 1; i++) {
        const ax = p[i * 2], az = p[i * 2 + 1], bx = p[i * 2 + 2], bz = p[i * 2 + 3];
        const len = Math.hypot(bx - ax, bz - az);
        if (len < 0.05) continue;
        const s0 = Math.max(run, from), s1 = Math.min(run + len, to);
        run += len;
        if (s1 <= s0) continue;
        const ux = (bx - ax) / len, uz = (bz - az) / len, rx = -uz, rz = ux;
        const t0 = s0 - (run - len), t1 = s1 - (run - len);
        const x0 = ax + ux * t0 + rx * off, z0 = az + uz * t0 + rz * off, x1 = ax + ux * t1 + rx * off, z1 = az + uz * t1 + rz * off;
        o.p.push(x0, y0, z0, x1, y0, z1, x1, y1, z1, x0, y0, z0, x1, y1, z1, x0, y1, z0);
        o.u.push(s0, 0, s1, 0, s1, 1, s0, 0, s1, 1, s0, 1);
        for (let q = 0; q < 6; q++) o.n.push(rx * facing, 0, rz * facing);
      }
    };
    // نقطة واتجاه على مسافة s من أول الخط
    const at = (p, s) => {
      let run = 0;
      for (let i = 0; i < p.length - 2; i += 2) {
        const len = Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]);
        if (run + len >= s || i === p.length - 4) {
          const t = len ? Math.min(1, Math.max(0, (s - run) / len)) : 0;
          const ux = len ? (p[i + 2] - p[i]) / len : 1, uz = len ? (p[i + 3] - p[i + 1]) / len : 0;
          return { x: p[i] + (p[i + 2] - p[i]) * t, z: p[i + 1] + (p[i + 3] - p[i + 1]) * t, ux, uz };
        }
        run += len;
      }
      return { x: p[0], z: p[1], ux: 1, uz: 0 };
    };
    const polyLen = (p) => { let L = 0; for (let i = 0; i < p.length - 2; i += 2) L += Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]); return L; };
    const disc = (arr, x, z, r, y) => {
      for (let a = 0; a < 10; a++) {
        const a0 = (a / 10) * Math.PI * 2, a1 = ((a + 1) / 10) * Math.PI * 2;
        arr.push(x, y, z, x + Math.cos(a1) * r, y, z + Math.sin(a1) * r, x + Math.cos(a0) * r, y, z + Math.sin(a0) * r);
      }
    };

    // ١) نقرا الشوارع ونلاقي التقاطعات (نقط مشتركة بين أكتر من شارع)
    const v2 = this.index.version >= 2;
    const list = [];
    const vmap = new Map();
    for (const r of d.r) {
      const [type, lanesTag, oneway] = r;
      const nameIdx = v2 ? r[3] : -1;
      const p = this.pts(r, v2 ? 4 : 3);
      const lanes = lanesTag || (oneway ? (type <= 3 ? 2 : 1) : type <= 2 ? 4 : 2);
      const laneW = type <= 4 ? 3.3 : 2.9;
      const w = type === 7 ? 5 : Math.max(lanes * laneW, type >= 6 ? 4 : 5.5);
      const road = { chunk: k, type, oneway, w, p, name: nameIdx >= 0 ? d.names[nameIdx] : '', lanes, L: polyLen(p) };
      this.roads.push(road);
      list.push(road);
      const seen = new Set();
      for (let i = 0; i < p.length; i += 2) {
        const key = `${Math.round(p[i])},${Math.round(p[i + 1])}`;
        if (seen.has(key)) continue;
        seen.add(key);
        let v = vmap.get(key);
        if (!v) vmap.set(key, (v = { x: p[i], z: p[i + 1], roads: [], minType: 9, maxW: 0 }));
        v.roads.push(road);
        v.minType = Math.min(v.minType, type);
        v.maxW = Math.max(v.maxW, w);
      }
    }
    const junctions = [...vmap.values()].filter((v) => v.roads.length >= 2 && v.roads.some((r) => r.type <= 6));

    // ٢) نرسم كل شارع: أسفلت، رصيف عالي ببردورة، جزيرة في نص الشوارع الكبيرة، خطوط وأسهم
    const ya = 0.09, yw = 0.2, ym = 0.115;
    for (const road of list) {
      const { type, oneway, w, p, lanes, L } = road;
      ribbon(asphalt, p, -w / 2, w / 2, type === 7 ? yw : ya);
      // أماكن التقاطعات على الشارع ده (عشان الرصيف والجزيرة يتقطعوا عندها)
      const gaps = [];
      let run = 0;
      for (let i = 0; i < p.length; i += 2) {
        if (i) run += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]);
        const v = vmap.get(`${Math.round(p[i])},${Math.round(p[i + 1])}`);
        if (v && v.roads.length >= 2) {
          const other = Math.max(...v.roads.filter((r) => r !== road).map((r) => r.w), 0);
          gaps.push([run - other / 2 - 2.5, run + other / 2 + 2.5]);
        }
      }
      const spans = [];
      let cur = 0;
      for (const [a, b] of gaps.sort((x, y) => x[0] - y[0])) { if (a > cur) spans.push([cur, a]); cur = Math.max(cur, b); }
      if (cur < L) spans.push([cur, L]);

      if (type >= 2 && type <= 6) {
        const curbO = type <= 3 ? curbs : plainCurbs;
        for (const [a, b] of spans) {
          if (b - a < 1) continue;
          ribbon(walk, p, w / 2, w / 2 + 2.6, yw, a, b);
          ribbon(walk, p, -w / 2 - 2.6, -w / 2, yw, a, b);
          wall(curbO, p, w / 2, ya, yw, a, b, -1);
          wall(curbO, p, -w / 2, ya, yw, a, b, 1);
        }
      }
      if (type > 6 || L < 6) continue;
      const bigMedian = !oneway && type <= 2 && lanes >= 4 && w >= 12;
      if (bigMedian) {
        // جزيرة خرسانة في النص بحواجز صفرا وسودا
        for (const [a, b] of spans) {
          if (b - a < 4) continue;
          ribbon(walk, p, -0.7, 0.7, 0.42, a + 1, b - 1);
          wall(curbs, p, 0.7, ya, 0.42, a + 1, b - 1, 1);
          wall(curbs, p, -0.7, ya, 0.42, a + 1, b - 1, -1);
        }
      } else if (!oneway && type <= 4) {
        ribbon(yellow, p, -0.28, -0.12, ym, 3, L - 3); // خط أصفر مزدوج
        ribbon(yellow, p, 0.12, 0.28, ym, 3, L - 3);
      }
      const perDir = oneway ? lanes : Math.max(1, Math.floor(lanes / 2));
      if (type <= 5) {
        for (const side of oneway ? [1] : [1, -1]) {
          for (let li = 1; li < perDir; li++) {
            const o = oneway ? -w / 2 + li * (w / lanes) : side * li * (w / 2 / perDir);
            for (let s = 4; s < L - 4; s += 10) ribbon(white, p, o - 0.07, o + 0.07, ym, s, s + 4);
          }
        }
        if (type <= 3) { ribbon(white, p, w / 2 - 0.45, w / 2 - 0.3, ym, 2, L - 2); ribbon(white, p, -w / 2 + 0.3, -w / 2 + 0.45, ym, 2, L - 2); }
      }
      if (oneway) {
        for (let s = 15; s < L - 8; s += 40) this.arrow(white, p, s, ym, w, lanes);
        // يافطة "اتجاه واحد" في الأول، و"ممنوع الدخول" من الناحية التانية في الآخر
        if (L > 25 && type <= 5) {
          const a = at(p, 4), b = at(p, L - 4);
          signsOne.push(a.x + -a.uz * (w / 2 + 0.6), a.z + a.ux * (w / 2 + 0.6), Math.atan2(-a.uz, -a.ux));
          signsNo.push(b.x - -b.uz * (w / 2 + 0.6), b.z - b.ux * (w / 2 + 0.6), Math.atan2(b.uz, b.ux));
        }
      }
      // زيبرا عند أطراف الشوارع الرئيسية
      if (type >= 2 && type <= 4 && L > 40) {
        for (const s of [5, L - 7]) for (let o = -w / 2 + 0.6; o < w / 2 - 0.4; o += 1.1) ribbon(white, p, o, o + 0.55, ym, s, s + 2.6);
      }
      // عربيات راكنة على يمين الشارع، أغلبها على الرصيف (زي مصر)، بس في الشوارع اللي عرضها يسمح
      if (type >= 4 && type <= 6 && L > 24 && w >= 6.5) {
        const side = oneway ? 1 : 1; // يمين اتجاه الرسم
        for (const [a2, b2] of spans) {
          let s2 = a2 + 9;
          while (s2 < b2 - 9) {
            const h = hash(Math.round(s2 * 17) ^ Math.round(p[0] * 3) ^ 5);
            const q = at(p, s2);
            const off = (w / 2 + 0.75) * side;
            const x = q.x + -q.uz * off, z = q.z + q.ux * off;
            const key = Math.floor(x / 5) * 100003 + Math.floor(z / 5);
            if (h > 0.45 && !parkedCells.has(key) && !onAnyBuilding(x, z)) {
              parkedCells.add(key);
              const yaw = Math.atan2(q.uz, q.ux);
              parked.push(x, z, yaw, h);
              const cx = Math.cos(yaw), cz = Math.sin(yaw), hl = 2.15, hw = 0.88;
              const poly = new Float32Array([x + cx * hl - cz * hw, z + cz * hl + cx * hw, x + cx * hl + cz * hw, z + cz * hl - cx * hw,
                x - cx * hl + cz * hw, z - cz * hl - cx * hw, x - cx * hl - cz * hw, z - cz * hl + cx * hw]);
              c.polys.push({ p: poly, minx: x - 2.3, maxx: x + 2.3, minz: z - 2.3, maxz: z + 2.3 });
            }
            s2 += 7.5 + h * 5;
          }
        }
      }
      if (type >= 3 && type <= 6 && L > 40) {
        for (const [a, b] of spans) {
          for (let s = a + 15; s < b - 15; s += 55) {
            const h = hash(Math.round(s * 29) ^ Math.round(p[1] * 7));
            if (h > 0.3) continue;
            const side = h < 0.15 ? 1 : -1;
            const q = at(p, s);
            const off = (w / 2 + 1.9) * side;
            cafes.push(q.x + -q.uz * off, q.z + q.ux * off, Math.atan2(q.ux * side, -q.uz * side) + Math.PI, h);
          }
        }
      }
      // أعمدة نور على الرصيف كل ٣٠ م، بالتبادل يمين وشمال
      if (type <= 4) {
        let side = 1;
        for (const [a, b] of spans) {
          for (let s = a + 6; s < b - 4; s += 30) {
            const q = at(p, s);
            const off = (w / 2 + 0.5) * side;
            lamps.push(q.x + -q.uz * off, q.z + q.ux * off, Math.atan2(-side * q.ux, side * q.uz));
            side = -side;
          }
        }
      }
    }
    // ٣) التقاطعات: أسفلت يقفل الزوايا + إشارات مرور عند تقاطعات الشوارع الرئيسية
    for (const v of junctions) {
      disc(asphalt, v.x, v.z, v.maxW / 2 + 0.5, ya + 0.002);
      if (v.minType <= 3 && v.roads.length >= 2 && v.roads.filter((r) => r.type <= 5).length >= 2) {
        const r0 = v.roads.reduce((a, b) => (a.type <= b.type ? a : b));
        const q = at(r0.p, 0);
        const off = v.maxW / 2 + 1.2;
        for (const [sx, sz] of [[1, 1], [-1, -1]]) {
          const x = v.x + (q.ux * sx - q.uz * sz) * off, z = v.z + (q.uz * sx + q.ux * sz) * off;
          lights.push(x, z, Math.atan2(v.z - z, v.x - x));
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
    const vert = (o, mat) => {
      if (!o.p.length) return;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(o.p, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(o.n, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(o.u, 2));
      g.add(new THREE.Mesh(geo, mat));
    };
    flat(asphalt, this.roadMat);
    flat(walk, this.walkMat);
    flat(white, this.lineMat);
    flat(yellow, this.yellowMat);
    vert(curbs, this.curbMat);
    vert(plainCurbs, this.plainCurbMat);
    this.furniture(detail, lamps, lights, signsOne, signsNo);
    this.life(detail, parked, cafes);
    if (centerPoly) this.placeCenter(g, centerPoly);

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

  // عربيات راكنة + قهاوي (ترابيزات وكراسي وناس قاعدة وتندة) + قطط
  life(g, parked, cafes) {
    const L = this.lifeKit;
    const d = new THREE.Object3D();
    const col = new THREE.Color();
    const CAR = [0xf2b705, 0x8a1c1c, 0x2a4a8a, 0xcfcfcf, 0x2b2b2b, 0x5a6b3a, 0xe8e8e8, 0x6a6f78, 0xf2b705, 0x9b7b4a];
    const nP = parked.length / 4;
    if (nP) {
      const P = L.sedan;
      const body = new THREE.InstancedMesh(P.body, L.paint, nP);
      const cabin = new THREE.InstancedMesh(P.glass, P.glassMat, nP);
      const roof = new THREE.InstancedMesh(P.roof, L.paint, nP);
      const wheels = new THREE.InstancedMesh(P.wheels, P.tireMat, nP);
      const trim = new THREE.InstancedMesh(P.trim, P.trimMat, nP);
      for (let i = 0; i < nP; i++) {
        d.position.set(parked[i * 4], 0.06, parked[i * 4 + 1]);
        d.rotation.set(0.03, -parked[i * 4 + 2], 0.02);
        d.updateMatrix();
        for (const m of [body, cabin, roof, wheels, trim]) m.setMatrixAt(i, d.matrix);
        const ci = Math.floor(parked[i * 4 + 3] * 97) % CAR.length;
        body.setColorAt(i, col.setHex(CAR[ci]));
        roof.setColorAt(i, col.setHex(ci === 0 || ci === 8 ? 0x151515 : CAR[ci])); // التاكسي: سقف أسود
      }
      body.castShadow = roof.castShadow = true;
      g.add(body, cabin, roof, wheels, trim);
    }
    const nC = cafes.length / 4;
    if (nC) {
      const per = 3; // ترابيزات لكل قهوة
      const tables = new THREE.InstancedMesh(L.table, L.metal, nC * per);
      const chairs = new THREE.InstancedMesh(L.chair, L.plastic, nC * per * 2);
      const torsos = new THREE.InstancedMesh(L.seatedTorso, L.cloth, nC * per * 2);
      const heads = new THREE.InstancedMesh(L.head, L.skin, nC * per * 2);
      const awnings = new THREE.InstancedMesh(L.awning, L.awningMat, nC);
      const cats = new THREE.InstancedMesh(L.cat, L.catMat, nC);
      const SHIRT = [0xe6e1d3, 0x2b4a7a, 0x3d6b4a, 0x6a4a8a, 0x8a5a2a, 0x222222, 0xb03a3a];
      let t = 0, ch = 0;
      for (let i = 0; i < nC; i++) {
        const x = cafes[i * 4], z = cafes[i * 4 + 1], yaw = cafes[i * 4 + 2], h = cafes[i * 4 + 3];
        const fx = Math.cos(yaw), fz = Math.sin(yaw), sx = -fz, sz = fx;
        d.position.set(x - fx * 1.6, 0.2, z - fz * 1.6);
        d.rotation.set(0, -yaw, 0);
        d.scale.set(1, 1, 1);
        d.updateMatrix();
        awnings.setMatrixAt(i, d.matrix);
        d.position.set(x + sx * 3.5 + fx * 0.6, 0.2, z + sz * 3.5 + fz * 0.6);
        d.rotation.set(0, -yaw + h * 9, 0);
        d.updateMatrix();
        cats.setMatrixAt(i, d.matrix);
        for (let k = 0; k < per; k++) {
          const tx = x + sx * (k - 1) * 2.1, tz = z + sz * (k - 1) * 2.1;
          d.position.set(tx, 0.2, tz); d.rotation.set(0, 0, 0); d.updateMatrix();
          tables.setMatrixAt(t++, d.matrix);
          for (const sd of [1, -1]) {
            const cx2 = tx + sx * sd * 0.65, cz2 = tz + sz * sd * 0.65;
            const face = Math.atan2(tz - cz2, tx - cx2);
            d.position.set(cx2, 0.2, cz2); d.rotation.set(0, -face, 0); d.updateMatrix();
            chairs.setMatrixAt(ch, d.matrix);
            const sitting = hash(ch * 31 + Math.round(x)) < 0.7;
            d.scale.setScalar(sitting ? 1 : 0);
            d.updateMatrix();
            torsos.setMatrixAt(ch, d.matrix);
            heads.setMatrixAt(ch, d.matrix);
            torsos.setColorAt(ch, col.setHex(SHIRT[ch % SHIRT.length]));
            d.scale.setScalar(1);
            ch++;
          }
        }
      }
      for (const m of [tables, chairs, torsos, heads, awnings]) m.castShadow = true;
      g.add(tables, chairs, torsos, heads, awnings, cats);
    }
  }

  // أعمدة نور، إشارات مرور، يافطات — كلها InstancedMesh
  furniture(g, lamps, lights, signsOne, signsNo) {
    const d = new THREE.Object3D();
    const inst = (geo, mat, arr, stride, place) => {
      const n = arr.length / stride;
      if (!n) return;
      const m = new THREE.InstancedMesh(geo, mat, n);
      for (let i = 0; i < n; i++) {
        d.position.set(0, 0, 0); d.rotation.set(0, 0, 0); d.scale.set(1, 1, 1);
        place(arr[i * stride], arr[i * stride + 1], arr[i * stride + 2]);
        d.updateMatrix();
        m.setMatrixAt(i, d.matrix);
      }
      m.castShadow = true;
      g.add(m);
    };
    const F = this.furn;
    const pose = (x, z, yaw, y = 0) => { d.position.set(x, y, z); d.rotation.y = -yaw; };
    // أعمدة النور
    inst(F.lampPole, F.poleMat, lamps, 3, (x, z, yaw) => pose(x, z, yaw));
    inst(F.lampArm, F.poleMat, lamps, 3, (x, z, yaw) => pose(x, z, yaw));
    inst(F.lampHead, F.lampMat, lamps, 3, (x, z, yaw) => pose(x, z, yaw));
    // إشارات المرور
    inst(F.lightPole, F.poleMat, lights, 3, (x, z, yaw) => pose(x, z, yaw));
    inst(F.lightBox, F.boxMat, lights, 3, (x, z, yaw) => pose(x, z, yaw));
    inst(F.bulbR, this.lightR, lights, 3, (x, z, yaw) => pose(x, z, yaw));
    inst(F.bulbY, this.lightY, lights, 3, (x, z, yaw) => pose(x, z, yaw));
    inst(F.bulbG, this.lightG, lights, 3, (x, z, yaw) => pose(x, z, yaw));
    // اليافطات
    const allSigns = [...signsOne, ...signsNo];
    inst(F.signPole, F.poleMat, allSigns, 3, (x, z, yaw) => pose(x, z, yaw));
    inst(F.signDisc, F.signOneMat, signsOne, 3, (x, z, yaw) => pose(x, z, yaw));
    inst(F.signDisc, F.signNoMat, signsNo, 3, (x, z, yaw) => pose(x, z, yaw));
  }

  // الإشارات بتقلب: أخضر ٨ث، أصفر ٢ث، أحمر ٨ث
  tick(t) {
    const ph = t % 18;
    this.lightG.emissiveIntensity = ph < 8 ? 3 : 0.05;
    this.lightY.emissiveIntensity = ph >= 8 && ph < 10 ? 3 : 0.05;
    this.lightR.emissiveIntensity = ph >= 10 ? 3 : 0.05;
  }

  // مبنى المركز: يافطة باسمه على الواجهة اللي على الشارع + يافطة على السطح
  placeCenter(g, cp) {
    const p = cp.p, n = p.length / 2;
    let best = null;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ax = p[i * 2], az = p[i * 2 + 1], bx = p[j * 2], bz = p[j * 2 + 1];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 3) continue;
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      let nx = (bz - az) / len, nz = -(bx - ax) / len;
      if (nx * (mx - cp.cx) + nz * (mz - cp.cz) < 0) { nx = -nx; nz = -nz; }
      const nr = this.nearestRoad(mx + nx * 2, mz + nz * 2);
      const dist = nr ? Math.hypot(nr.x - mx, nr.z - mz) : 999;
      if (!best || dist < best.dist) best = { mx, mz, nx, nz, len, dist, nr };
    }
    if (!best) return;
    const tex = this.centerSignTex;
    const yaw = Math.atan2(best.nx, best.nz);
    const wSign = Math.min(best.len * 0.8, 9);
    const signMat = new THREE.MeshLambertMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.25 });
    this.centerSignMat = signMat;
    const front = new THREE.Mesh(new THREE.PlaneGeometry(wSign, wSign / 4), signMat);
    front.position.set(best.mx + best.nx * 0.2, Math.min(cp.h - 1.2, 5.5), best.mz + best.nz * 0.2);
    front.rotation.y = yaw;
    const top = new THREE.Mesh(new THREE.PlaneGeometry(10, 2.5), new THREE.MeshLambertMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.25, side: THREE.DoubleSide }));
    top.position.set(cp.cx, cp.h + 3.2, cp.cz);
    top.rotation.y = yaw;
    const legs = new THREE.InstancedMesh(new THREE.BoxGeometry(0.2, 3.2, 0.2).translate(0, 1.6, 0), this.furn.poleMat, 2);
    const dd = new THREE.Object3D();
    for (const [i, s] of [[0, -5], [1, 5]]) {
      dd.position.set(cp.cx + Math.cos(yaw) * s, cp.h, cp.cz - Math.sin(yaw) * s);
      dd.updateMatrix();
      legs.setMatrixAt(i, dd.matrix);
    }
    // بوابة صغيرة قدّام الواجهة
    const gate = new THREE.Mesh(new THREE.BoxGeometry(Math.min(wSign * 0.5, 6), 3, 0.3), new THREE.MeshLambertMaterial({ color: 0x0f6b5c }));
    gate.position.set(best.mx + best.nx * 0.25, 1.5, best.mz + best.nz * 0.25);
    gate.rotation.y = yaw;
    g.add(front, top, legs, gate);
    const door = best.nr || { x: best.mx + best.nx * 6, z: best.mz + best.nz * 6, heading: 0 };
    this.centerInfo = { x: door.x, z: door.z, heading: door.heading || 0, sign: { x: best.mx, z: best.mz } };
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

  // ---------- البحر والكورنيش ----------
  buildCoast(chains) {
    const g = new THREE.Group();
    this.sea = [];
    const wallP = [], wallU = [], wallN = [], railP = [], rocks = [];
    for (const raw of chains) {
      const n = raw.length / 2;
      if (n < 20) continue;
      const p = new Float32Array(raw.length);
      for (let i = 0; i < raw.length; i += 2) { p[i] = raw[i] * this.unit + this.shift.x; p[i + 1] = raw[i + 1] * this.unit + this.shift.z; }
      const closed = p[0] === p[p.length - 2] && p[1] === p[p.length - 1];
      if (closed) continue; // جزر صغيرة/لسان — نسيبها
      // البحر على يمين اتجاه الخط (قاعدة OSM): نقفل المضلع بنقطتين بعاد في البحر
      let ux = p[p.length - 2] - p[0], uz = p[p.length - 1] - p[1];
      const ul = Math.hypot(ux, uz) || 1; ux /= ul; uz /= ul;
      const rx = -uz, rz = ux, FAR = 6000;
      const poly = Array.from(p);
      poly.push(p[p.length - 2] + rx * FAR + ux * FAR, p[p.length - 1] + rz * FAR + uz * FAR, p[0] + rx * FAR - ux * FAR, p[1] + rz * FAR - uz * FAR);
      let minx = Infinity, minz = Infinity, maxx = -Infinity, maxz = -Infinity;
      for (let i = 0; i < poly.length; i += 2) { minx = Math.min(minx, poly[i]); maxx = Math.max(maxx, poly[i]); minz = Math.min(minz, poly[i + 1]); maxz = Math.max(maxz, poly[i + 1]); }
      this.sea.push({ p: poly, minx, minz, maxx, maxz });
      const contour = [];
      for (let i = 0; i < poly.length; i += 2) contour.push(new THREE.Vector2(poly[i], poly[i + 1]));
      try {
        const pos = [];
        for (const t of THREE.ShapeUtils.triangulateShape(contour, [])) for (const vi of t) pos.push(contour[vi].x, 0.03, contour[vi].y);
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        const nrm = new Float32Array(pos.length);
        for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1;
        geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
        g.add(new THREE.Mesh(geo, this.seaMat));
      } catch { /* ignore */ }
      // سور الكورنيش (درابزين أبيض) على حافة اليابسة + بلوكات خرسانة في المية
      let run = 0;
      for (let i = 0; i < n - 1; i++) {
        const ax = p[i * 2], az = p[i * 2 + 1], bx = p[i * 2 + 2], bz = p[i * 2 + 3];
        const len = Math.hypot(bx - ax, bz - az);
        if (len < 0.2) continue;
        const sx = (bx - ax) / len, sz = (bz - az) / len, lx = sz, lz = -sx; // ناحية اليابسة (شمال الاتجاه)
        const o = 0.6;
        const x0 = ax + lx * o, z0 = az + lz * o, x1 = bx + lx * o, z1 = bz + lz * o;
        wallP.push(x0, 0, z0, x1, 0, z1, x1, 1.15, z1, x0, 0, z0, x1, 1.15, z1, x0, 1.15, z0);
        wallU.push(run, 0, run + len, 0, run + len, 1, run, 0, run + len, 1, run, 1);
        for (let q = 0; q < 6; q++) wallN.push(-lx, 0, -lz);
        // الكوبستة اللي فوق السور
        const w2 = 0.18;
        railP.push(x0 - lx * w2, 1.15, z0 - lz * w2, x1 - lx * w2, 1.15, z1 - lz * w2, x1 + lx * w2, 1.15, z1 + lz * w2,
          x0 - lx * w2, 1.15, z0 - lz * w2, x1 + lx * w2, 1.15, z1 + lz * w2, x0 + lx * w2, 1.15, z0 + lz * w2);
        for (let s = 0; s < len; s += 2.2) {
          const h = hash((Math.round(ax * 10 + s * 7) ^ Math.round(az * 13)) >>> 0);
          const off = 1.5 + h * 4;
          rocks.push(ax + sx * s - lx * off, az + sz * s - lz * off, h);
        }
        run += len;
      }
    }
    if (wallP.length) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(wallP, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(wallU, 2));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(wallN, 3));
      const m = new THREE.Mesh(geo, this.balustradeMat);
      m.castShadow = true;
      g.add(m);
      const rg = new THREE.BufferGeometry();
      rg.setAttribute('position', new THREE.Float32BufferAttribute(railP, 3));
      rg.computeVertexNormals();
      g.add(new THREE.Mesh(rg, this.railMat));
    }
    if (rocks.length) {
      const inst = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), this.rockMat, rocks.length / 3);
      const d = new THREE.Object3D();
      for (let i = 0; i < rocks.length; i += 3) {
        const h = rocks[i + 2];
        d.position.set(rocks[i], 0.1 + h * 0.4, rocks[i + 1]);
        d.rotation.set(h * 5, h * 11, h * 3);
        d.scale.setScalar(0.8 + h * 0.7);
        d.updateMatrix();
        inst.setMatrixAt(i / 3, d.matrix);
      }
      g.add(inst);
    }
    this.group.add(g);
  }

  pointInSea(x, z) {
    for (const s of this.sea || []) {
      if (x < s.minx || x > s.maxx || z < s.minz || z > s.maxz) continue;
      const p = s.p, n = p.length / 2;
      let inside = false;
      for (let a = 0, b = n - 1; a < n; b = a++) {
        const xa = p[a * 2], za = p[a * 2 + 1], xb = p[b * 2], zb = p[b * 2 + 1];
        if ((za > z) !== (zb > z) && x < ((xb - xa) * (z - za)) / (zb - za) + xa) inside = !inside;
      }
      if (inside) return true;
    }
    return false;
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
      const px = x + a * c - b * s, pz = z + a * s + b * c;
      if (this.pointInBuilding(px, pz) || this.pointInSea(px, pz)) return true;
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
