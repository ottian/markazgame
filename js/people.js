import * as THREE from 'three';

// ناس ماشية في الشارع — كل أجزاء الجسم InstancedMesh (6 draw calls لكل الناس)
// الشخص متجه لقدّام على +x، والجنب على z

const SKINS = [0xc89a74, 0xb07e58, 0x8d5f3e, 0xd8ae88, 0x9c6b48];
const SHIRTS = [0x2b4a7a, 0xa23b3b, 0xe6e1d3, 0x3d6b4a, 0x6a4a8a, 0x222222, 0xc58a2a, 0x4f6f8f, 0xffffff, 0x7a2e4e];
const PANTS = [0x23283a, 0x3a3a3a, 0x4a3b2a, 0x1f2f4f, 0x5a5a5a];
const SCARVES = [0x5a2a4a, 0x1f3f6f, 0x2a2a2a, 0x8a4a2a, 0xd9c7a8, 0x6a7f5a];

const PARTS = {
  legL: { geo: () => new THREE.BoxGeometry(0.17, 0.86, 0.18).translate(0, -0.43, 0) },
  legR: { geo: () => new THREE.BoxGeometry(0.17, 0.86, 0.18).translate(0, -0.43, 0) },
  torso: { geo: () => new THREE.BoxGeometry(0.28, 0.64, 0.46) },
  armL: { geo: () => new THREE.BoxGeometry(0.12, 0.62, 0.12).translate(0, -0.31, 0) },
  armR: { geo: () => new THREE.BoxGeometry(0.12, 0.62, 0.12).translate(0, -0.31, 0) },
  head: { geo: () => new THREE.SphereGeometry(0.14, 10, 8) },
};

const pick = (arr, r) => arr[Math.floor(r() * arr.length)];

// مسار = خط متكسّر (pts = [x0,z0,x1,z1,...]) — أو قطعة {ax,az,bx,bz}
export function makePath(p) {
  const pts = p.pts || [p.ax, p.az, p.bx, p.bz];
  const cum = [0];
  for (let i = 2; i < pts.length; i += 2) cum.push(cum[cum.length - 1] + Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]));
  return { pts, cum, len: cum[cum.length - 1] };
}

function pointAt(path, t, out) {
  const { pts, cum } = path;
  let i = 1;
  while (i < cum.length - 1 && cum[i] < t) i++;
  const seg = cum[i] - cum[i - 1] || 1;
  const u = Math.min(1, Math.max(0, (t - cum[i - 1]) / seg));
  const ax = pts[(i - 1) * 2], az = pts[(i - 1) * 2 + 1], bx = pts[i * 2], bz = pts[i * 2 + 1];
  out.x = ax + (bx - ax) * u;
  out.z = az + (bz - az) * u;
  out.yaw = Math.atan2(bz - az, bx - ax);
  return out;
}

export class People {
  constructor(scene, { paths = [], standers = [], walkers = 220, shadows = false }) {
    this.paths = paths.map(makePath).filter((p) => p.len > 4);
    const totalLen = this.paths.reduce((s, p) => s + p.len, 0);
    this.peds = [];
    const rand = Math.random;

    for (let i = 0; i < walkers && this.paths.length; i++) {
      let k = rand() * totalLen, path = this.paths[0];
      for (const p of this.paths) { k -= p.len; if (k <= 0) { path = p; break; } }
      this.peds.push(this.makePed(rand, { kind: 'walk', path, t: rand() * path.len, dir: rand() < 0.5 ? 1 : -1 }));
    }
    // ناس من غير مسارات لسه (الخريطة الحقيقية بتحمّل بعدين)
    for (let i = this.peds.length; i < walkers; i++) {
      const p = this.makePed(rand, { kind: 'walk' });
      p.path = null;
      p.active = false;
      this.peds.push(p);
    }
    for (const s of standers) this.peds.push(this.makePed(rand, { kind: 'stand', x: s.x, z: s.z, yaw: s.yaw, fisher: !!s.fisher }));
    // خانات فاضية للي بيعدّوا الشارع وللممثلين (الفريق والحالة)
    this.crossers = [];
    for (let i = 0; i < 6; i++) {
      const p = this.makePed(rand, { kind: 'cross' });
      p.active = false;
      this.peds.push(p);
      this.crossers.push(p);
    }
    this.actorSlots = [];
    for (let i = 0; i < 8; i++) {
      const p = this.makePed(rand, { kind: 'actor' });
      p.active = false;
      this.peds.push(p);
      this.actorSlots.push(p);
    }

    const n = this.peds.length;
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.85 });
    this.meshes = {};
    for (const [name, def] of Object.entries(PARTS)) {
      const m = new THREE.InstancedMesh(def.geo(), mat, n);
      m.frustumCulled = false;
      m.castShadow = shadows;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(m);
      this.meshes[name] = m;
    }
    // سنّارة للصيادين
    const fishers = this.peds.filter((p) => p.fisher);
    this.rods = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.015, 0.025, 3.2, 4).translate(0, 1.6, 0),
      new THREE.MeshStandardMaterial({ color: 0x3a2a1a }),
      Math.max(1, fishers.length),
    );
    this.rods.frustumCulled = false;
    scene.add(this.rods);
    const m4 = new THREE.Matrix4();
    fishers.forEach((p, i) => {
      m4.makeRotationFromEuler(new THREE.Euler(0, -p.yaw, -0.9));
      m4.setPosition(p.x + Math.cos(p.yaw) * 0.3, 1.25, p.z + Math.sin(p.yaw) * 0.3);
      this.rods.setMatrixAt(i, m4);
    });
    if (!fishers.length) this.rods.count = 0;
    this.applyColors();

    this._m = new THREE.Matrix4();
    this._b = new THREE.Matrix4();
    this._l = new THREE.Matrix4();
    this._r = new THREE.Matrix4();
    this._zero = new THREE.Matrix4().makeScale(0, 0, 0);
    this.crossCooldown = 4;
    this.groundY = 0;
  }

  makePed(r, o) {
    const female = r() < 0.45;
    const robe = !female && r() < 0.15;
    const shirt = pick(SHIRTS, r);
    return {
      active: true,
      kind: o.kind,
      path: o.path, t: o.t || 0, dir: o.dir || 1,
      x: o.x || 0, z: o.z || 0, yaw: o.yaw || 0,
      fisher: !!o.fisher,
      speed: 1.1 + r() * 0.6,
      phase: r() * 10,
      walking: o.kind !== 'stand',
      pause: 0,
      scale: 0.92 + r() * 0.16,
      colors: {
        skin: pick(SKINS, r),
        shirt,
        pants: female || robe ? (robe ? shirt : pick(SHIRTS, r)) : pick(PANTS, r),
        head: female ? pick(SCARVES, r) : null,
      },
      headScale: female ? 1.25 : 1,
    };
  }

  applyColors() {
    const c = new THREE.Color();
    this.peds.forEach((p, i) => {
      this.meshes.head.setColorAt(i, c.setHex(p.colors.head ?? p.colors.skin));
      this.meshes.torso.setColorAt(i, c.setHex(p.colors.shirt));
      this.meshes.armL.setColorAt(i, c.setHex(p.colors.shirt));
      this.meshes.armR.setColorAt(i, c.setHex(p.colors.shirt));
      this.meshes.legL.setColorAt(i, c.setHex(p.colors.pants));
      this.meshes.legR.setColorAt(i, c.setHex(p.colors.pants));
    });
    for (const m of Object.values(this.meshes)) m.instanceColor.needsUpdate = true;
  }

  // ---------- الخريطة الحقيقية: الناس بتتنقل حوالين اللاعب ----------
  setPaths(paths) {
    this.paths = paths.map(makePath).filter((p) => p.len > 4);
  }

  // اللي بعدوا عن اللاعب بنحطّهم على رصيف قريب
  recycle(px, pz, maxDist = 230) {
    if (!this.paths.length) return;
    const near = this.paths.filter((p) => Math.abs(p.pts[0] - px) < 200 && Math.abs(p.pts[1] - pz) < 200);
    const pool = near.length ? near : this.paths;
    for (const p of this.peds) {
      if (p.kind !== 'walk') continue;
      if (p.path && Math.abs(p.x - px) < maxDist && Math.abs(p.z - pz) < maxDist) continue;
      p.path = pool[Math.floor(Math.random() * pool.length)];
      p.t = Math.random() * p.path.len;
      pointAt(p.path, p.t, p);
    }
  }

  // ---------- الممثلين (الفريق والحالة والأسرة) ----------
  addActor({ x, z, yaw = 0, shirt, pants, head = null, skin, role = null }) {
    const a = this.actorSlots.find((p) => !p.active);
    if (!a) return null;
    Object.assign(a, { active: true, x, z, yaw, target: null, onArrive: null, walking: false, speed: 1.4, role });
    a.colors = { skin: skin ?? pick(SKINS, Math.random), shirt, pants, head };
    a.headScale = head ? 1.25 : 1;
    this.applyColors();
    return a;
  }
  walkTo(a, x, z, onArrive) {
    a.target = { x, z };
    a.walking = true;
    a.onArrive = onArrive || null;
  }
  removeActor(a) { if (a) a.active = false; }
  clearActors() { for (const a of this.actorSlots) a.active = false; }

  // ---------- عبور الشارع ----------
  // findCrossing(player) بترجع {ax,az,bx,bz} أو null
  spawnCrossing(seg) {
    const p = this.crossers.find((c) => !c.active);
    if (!p) return;
    p.active = true;
    p.x = seg.ax; p.z = seg.az;
    p.target = { x: seg.bx, z: seg.bz };
    p.start = { x: seg.ax, z: seg.az };
    p.walking = true;
    p.speed = 1.3 + Math.random() * 0.4;
    p.onArrive = () => { p.active = false; };
  }

  // الناس اللي على الأسفلت (للمرور وللتصادم)
  onRoad(isRoad) {
    const out = [];
    for (const p of this.peds) if (p.active && p.walking && isRoad(p.x, p.z)) out.push(p);
    return out;
  }

  update(dt, camX, camZ, vehicles) {
    const R2 = 170 * 170;
    for (const p of this.peds) {
      if (!p.active) continue;
      if (p.kind === 'walk') {
        if (!p.path) continue;
        if (p.pause > 0) { p.pause -= dt; p.walking = false; } else p.walking = true;
        if (p.walking) {
          p.t += p.speed * p.dir * dt;
          if (p.t > p.path.len) { p.t = p.path.len; p.dir = -1; p.pause = Math.random() * 3; }
          if (p.t < 0) { p.t = 0; p.dir = 1; p.pause = Math.random() * 3; }
        }
        pointAt(p.path, p.t, p);
        if (p.dir < 0) p.yaw += Math.PI;
      } else if (p.target) {
        // بيستنّى لو فيه عربية جاية قريب منه
        let wait = false;
        if (p.kind === 'cross' && vehicles) {
          for (const v of vehicles) {
            const dx = p.x - v.x, dz = p.z - v.z;
            if (dx * dx + dz * dz < 64 && Math.abs(v.speed) > 1.5) { wait = true; break; }
          }
        }
        const dx = p.target.x - p.x, dz = p.target.z - p.z, d = Math.hypot(dx, dz);
        if (d < 0.15) {
          p.walking = false;
          p.target = null;
          const cb = p.onArrive; p.onArrive = null;
          if (cb) cb(p);
        } else if (!wait) {
          p.walking = true;
          const st = Math.min(d, p.speed * dt);
          p.x += (dx / d) * st; p.z += (dz / d) * st;
          p.yaw = Math.atan2(dz, dx);
        } else p.walking = false;
      }
    }
    this.writeMatrices(dt, camX, camZ, R2);
  }

  writeMatrices(dt, camX, camZ, R2) {
    const { _m: M, _b: B, _l: L } = this;
    const ms = this.meshes;
    this.peds.forEach((p, i) => {
      const far = (p.x - camX) ** 2 + (p.z - camZ) ** 2 > R2;
      if (!p.active || far || p.realistic) {
        for (const m of Object.values(ms)) m.setMatrixAt(i, this._zero);
        return;
      }
      if (p.walking) p.phase += dt * p.speed * 5.5;
      const swing = p.walking ? Math.sin(p.phase) * 0.6 : 0;
      const bob = p.walking ? Math.abs(Math.cos(p.phase)) * 0.04 : 0;
      B.makeRotationY(-p.yaw);
      B.setPosition(p.x, bob + this.groundY, p.z);
      if (p.scale !== 1) B.multiply(L.makeScale(p.scale, p.scale, p.scale));
      const put = (mesh, ox, oy, oz, rotZ, s = 1) => {
        L.makeRotationZ(rotZ);
        if (s !== 1) L.scale(new THREE.Vector3(s, s, s));
        L.setPosition(ox, oy, oz);
        M.multiplyMatrices(B, L);
        mesh.setMatrixAt(i, M);
      };
      put(ms.legL, 0, 0.88, 0.11, swing);
      put(ms.legR, 0, 0.88, -0.11, -swing);
      put(ms.torso, 0, 1.2, 0, 0);
      const armSwing = p.fisher ? -1.1 : -swing * 0.8;
      put(ms.armL, 0, 1.48, 0.3, armSwing);
      put(ms.armR, 0, 1.48, -0.3, p.fisher ? -1.1 : swing * 0.8);
      put(ms.head, 0, 1.68, 0, 0, p.headScale);
    });
    for (const m of Object.values(ms)) m.instanceMatrix.needsUpdate = true;
  }
}
