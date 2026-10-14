import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { CONFIG } from './config.js';

// شخصيات واقعية متحركة (Mixamo FBX أو GLB)
// بتتربط بأقرب الناس للكاميرا من نظام People، والباقي بيفضل بالشكل البسيط

const BASE = 'assets/people/';

async function loadAsset(file) {
  const url = BASE + file;
  if (/\.fbx$/i.test(file)) {
    const obj = await new FBXLoader().loadAsync(url);
    return { scene: obj, animations: obj.animations || [] };
  }
  const g = await new GLTFLoader().loadAsync(url);
  return { scene: g.scene, animations: g.animations || [] };
}

export class Characters {
  constructor(scene, people, maxActive) {
    this.scene = scene;
    this.people = people;
    this.max = maxActive;
    this.ready = false;
    this.pool = [];
    this.bound = new Map(); // ped -> slot
    this.timer = 0;
  }

  get enabled() { return CONFIG.characters.models.length > 0; }

  async load() {
    const C = CONFIG.characters;
    if (!this.enabled) return false;
    try {
      const models = await Promise.all(C.models.map(loadAsset));
      const walkA = C.walk ? await loadAsset(C.walk) : null;
      const idleA = C.idle ? await loadAsset(C.idle) : null;
      const special = {};
      for (const role of ['doctor', 'nurse', 'patient']) if (C[role]) special[role] = await loadAsset(C[role]);
      const clip = (asset, fallback) => {
        const c = asset?.animations?.[0] || fallback;
        if (!c) return null;
        // نشيل حركة الجذر عشان الشخص ميزحلقش من مكانه (إحنا اللي بنحرّكه)
        const cc = c.clone();
        cc.tracks = cc.tracks.filter((t) => !/(Hips|Root).*\.position$/i.test(t.name) || /\.y$/.test(t.name));
        return cc;
      };
      const make = (asset, i) => {
        const obj = SkeletonUtils.clone(asset.scene);
        obj.scale.setScalar(C.scale);
        obj.traverse((o) => {
          if (o.isMesh || o.isSkinnedMesh) { o.castShadow = true; o.frustumCulled = false; }
        });
        const mixer = new THREE.AnimationMixer(obj);
        const walk = clip(walkA, asset.animations[0]);
        const idle = clip(idleA, asset.animations[1] || asset.animations[0]);
        const aw = walk ? mixer.clipAction(walk) : null;
        const ai = idle ? mixer.clipAction(idle) : null;
        if (aw) aw.play();
        if (ai) { ai.play(); ai.setEffectiveWeight(0); }
        if (aw) aw.time = Math.random() * walk.duration;
        obj.visible = false;
        this.scene.add(obj);
        return { obj, mixer, aw, ai, ped: null, i };
      };
      for (let i = 0; i < this.max; i++) this.pool.push(make(models[i % models.length], i));
      this.special = {};
      for (const [role, asset] of Object.entries(special)) this.special[role] = make(asset, -1);
      this.ready = true;
      return true;
    } catch (e) {
      console.warn('تعذّر تحميل الشخصيات الواقعية — هنكمّل بالشكل البسيط', e);
      return false;
    }
  }

  release(slot) {
    if (slot.ped) { slot.ped.realistic = false; this.bound.delete(slot.ped); }
    slot.ped = null;
    slot.obj.visible = false;
  }

  update(dt, camX, camZ, groundY = 0) {
    if (!this.ready) return;
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = 0.4;
      // الممثلين (الفريق والحالة) ليهم أولوية، وبعدهم الأقرب للكاميرا
      const cands = this.people.peds
        .filter((p) => p.active)
        .map((p) => ({ p, d: (p.x - camX) ** 2 + (p.z - camZ) ** 2 - (p.kind === 'actor' ? 1e9 : 0) }))
        .filter((c) => c.d < 70 * 70)
        .sort((a, b) => a.d - b.d);
      const want = new Set();
      const specialFor = new Map();
      for (const { p } of cands) {
        if (p.role && this.special[p.role]) { specialFor.set(p, this.special[p.role]); continue; }
        if (want.size < this.pool.length) want.add(p);
      }
      for (const s of [...this.pool, ...Object.values(this.special)]) if (s.ped && !want.has(s.ped) && specialFor.get(s.ped) !== s) this.release(s);
      for (const [p, s] of specialFor) if (s.ped !== p) { if (s.ped) this.release(s); s.ped = p; p.realistic = true; this.bound.set(p, s); }
      const free = this.pool.filter((s) => !s.ped);
      for (const p of want) {
        if (this.bound.has(p)) continue;
        const s = free.pop();
        if (!s) break;
        s.ped = p;
        p.realistic = true;
        this.bound.set(p, s);
      }
    }
    for (const s of [...this.pool, ...Object.values(this.special || {})]) {
      const p = s.ped;
      if (!p) continue;
      if (!p.active) { this.release(s); continue; }
      s.obj.visible = true;
      s.obj.position.set(p.x, groundY, p.z);
      // موديلات Mixamo باصّة على +z → نلفّها لاتجاه المشي
      s.obj.rotation.y = Math.PI / 2 - p.yaw;
      const w = p.walking ? 1 : 0;
      if (s.aw) { s.aw.setEffectiveWeight(s.ai ? w : 1); s.aw.timeScale = p.walking ? p.speed / 1.3 : 0; }
      if (s.ai) s.ai.setEffectiveWeight(1 - w);
      s.mixer.update(dt);
    }
  }
}
