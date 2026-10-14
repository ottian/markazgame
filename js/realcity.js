import * as THREE from 'three';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import {
  TilesRenderer, GoogleCloudAuthPlugin, GLTFExtensionsPlugin, ReorientationPlugin,
  TilesFadePlugin, TileCompressionPlugin, UnloadTilesPlugin,
} from '../vendor/3d-tiles-renderer.min.js';
import { CONFIG } from './config.js';

// وضع "إسكندرية الحقيقية": مباني جوجل ثلاثية الأبعاد (Photorealistic 3D Tiles)
// الإحداثيات المحلية: x شرق، z جنوب، y فوق — والأصل عند مكان المركز

const DEG = Math.PI / 180;
const M_PER_DEG_LAT = 110574;

export function latLonToLocal(lat, lon, origin) {
  const mPerDegLon = 111320 * Math.cos(origin.lat * DEG);
  return { x: (lon - origin.lon) * mPerDegLon, z: -(lat - origin.lat) * M_PER_DEG_LAT };
}

export class RealCity {
  constructor(scene, camera, renderer, quality) {
    const R = CONFIG.real;
    this.origin = R.center;
    this.scene = scene;
    this.camera = camera;

    const draco = new DRACOLoader().setDecoderPath('vendor/addons/libs/draco/');
    const tiles = new TilesRenderer();
    tiles.registerPlugin(new GoogleCloudAuthPlugin({ apiToken: CONFIG.googleMapsApiKey, autoRefreshToken: true }));
    tiles.registerPlugin(new GLTFExtensionsPlugin({ dracoLoader: draco }));
    tiles.registerPlugin(new TileCompressionPlugin());
    tiles.registerPlugin(new UnloadTilesPlugin());
    tiles.registerPlugin(new TilesFadePlugin());
    tiles.registerPlugin(new ReorientationPlugin({ lat: this.origin.lat * DEG, lon: this.origin.lon * DEG, height: 0 }));
    tiles.errorTarget = quality.tileError;
    tiles.setCamera(camera);
    tiles.setResolutionFromRenderer(camera, renderer);
    // غلاف خارجي: بنحرّكه إحنا لظبط الأرض، والمكتبة بتتحكم في tiles.group نفسه
    this.wrap = new THREE.Group();
    this.wrap.add(tiles.group);
    // المكتبة بتحط X ناحية الغرب وZ ناحية الشمال، إحنا عايزين X شرق وZ جنوب
    this.wrap.rotation.y = Math.PI;
    scene.add(this.wrap);
    this.tiles = tiles;
    this.loadedOnce = false;
    tiles.addEventListener('load-model', () => { this.loadedOnce = true; });
    this.error = null;
    tiles.addEventListener('load-error', (e) => { this.error = e?.error?.message || 'error'; });

    // نقطة البداية: قدّام المركز
    this.door = { x: 0, z: 0 };
    this.start = { x: 0, z: 6, heading: 0 };
    this.landmarks = R.landmarks.map((l) => ({ ...l, ...latLonToLocal(l.lat, l.lon, this.origin) }));

    this.ray = new THREE.Raycaster();
    this.ray.firstHitOnly = true;
    this.down = new THREE.Vector3(0, -1, 0);
    this.ground = 0;
    this.groundTimer = 0;
    this.calibrated = false;
  }

  hit(origin, dir, far) {
    this.ray.set(origin, dir);
    this.ray.far = far;
    const hits = this.ray.intersectObject(this.wrap, true);
    return hits.length ? hits[0] : null;
  }

  // أقل ارتفاع تحت العربية (٥ أشعة) = الأسفلت، مش شجرة ولا عربية راكنة
  sampleGround(x, z) {
    let min = Infinity;
    for (const [dx, dz] of [[0, 0], [2.5, 0], [-2.5, 0], [0, 2.5], [0, -2.5]]) {
      const h = this.hit(new THREE.Vector3(x + dx, 3000, z + dz), this.down, 6000);
      if (h) min = Math.min(min, h.point.y);
    }
    return min;
  }

  // بنحرّك المدينة لفوق/لتحت عشان الأرض تحت العربية تفضل عند y = 0
  // (إسكندرية مسطّحة، فده كفاية ومن غير ما نغيّر فيزيا العربية)
  adjustGround(x, z, dt) {
    this.groundTimer -= dt;
    if (this.groundTimer > 0) return;
    this.groundTimer = 0.25;
    this.wrap.updateMatrixWorld(true);
    const y = this.sampleGround(x, z);
    if (!Number.isFinite(y)) return;
    if (!this.calibrated) {
      this.wrap.position.y -= y;
      this.calibrated = true;
      this.jumps = 0;
    } else if (Math.abs(y) < 1.5) {
      this.wrap.position.y -= y * 0.5;
      this.jumps = 0;
    } else if (++this.jumps >= 3) {
      // البلاطات اتغيّرت لدقّة أعلى/أقل → نتظبط على طول
      this.wrap.position.y -= y;
      this.jumps = 0;
    }
  }

  groundAt() {
    return 0;
  }

  // تصادم مع المباني الحقيقية: أشعة أفقية من قدّام/ورا العربية
  blocked(x, z, heading, speed, len = 5.4, wid = 2.2) {
    if (!this.calibrated || Math.abs(speed) < 0.05) return false;
    const dir = Math.sign(speed);
    const fx = Math.cos(heading) * dir, fz = Math.sin(heading) * dir;
    const sx = -fz, sz = fx;
    const y = this.ground + 1.1;
    const reach = len / 2 + 0.6;
    const d = new THREE.Vector3(fx, 0, fz);
    for (const side of [0, wid / 2 - 0.2, -(wid / 2 - 0.2)]) {
      const o = new THREE.Vector3(x + sx * side, y, z + sz * side);
      const h = this.hit(o, d, reach);
      if (h) return true;
    }
    return false;
  }

  pickupNear(rand = Math.random) {
    const far = this.landmarks.filter((l) => Math.hypot(l.x - this.door.x, l.z - this.door.z) > 300);
    const l = far[Math.floor(rand() * far.length)] || this.landmarks[0];
    return { pos: { x: l.x, z: l.z }, name: l.name };
  }

  placeName(x, z) {
    let best = null, bd = Infinity;
    for (const l of this.landmarks) {
      const d = Math.hypot(l.x - x, l.z - z);
      if (d < bd) { bd = d; best = l; }
    }
    return bd < 900 && best ? `قرب ${best.name}` : 'إسكندرية';
  }

  attributions() {
    const list = [];
    try { this.tiles.getAttributions(list); } catch { /* ignore */ }
    return list.filter((a) => a.type === 'string').map((a) => a.value).join(' · ');
  }

  update(x, z) {
    this.camera.updateMatrixWorld();
    this.tiles.update();
    if (this.loadedOnce) this.adjustGround(x, z, 1 / 60);
  }

  drawMinimap(g, S, player, target) {
    const half = S / 2, k = S / 2 / 900; // 900م نص القطر
    g.save();
    g.clearRect(0, 0, S, S);
    g.beginPath();
    g.arc(half, half, half, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = '#16233a';
    g.fillRect(0, 0, S, S);
    g.strokeStyle = 'rgba(255,255,255,0.08)';
    for (let r = 1; r <= 3; r++) { g.beginPath(); g.arc(half, half, (half * r) / 3, 0, Math.PI * 2); g.stroke(); }
    const dot = (x, z, color, r, label) => {
      let px = half + (x - player.x) * k, py = half + (z - player.z) * k;
      const dx = px - half, dy = py - half, d = Math.hypot(dx, dy);
      if (d > half - 10) { px = half + (dx / d) * (half - 10); py = half + (dy / d) * (half - 10); }
      g.fillStyle = color;
      g.beginPath();
      g.arc(px, py, r, 0, Math.PI * 2);
      g.fill();
      if (label) { g.fillStyle = 'rgba(255,255,255,0.6)'; g.font = '10px Cairo, sans-serif'; g.textAlign = 'center'; g.fillText(label, px, py - 6); }
    };
    for (const l of this.landmarks) dot(l.x, l.z, 'rgba(242,194,48,0.6)', 2.5, l.short);
    dot(this.door.x, this.door.z, '#22e0a8', 5);
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
