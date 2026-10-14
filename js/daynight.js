import * as THREE from 'three';

// اليوم والليل والطقس
// الساعة بتمشي: ساعة في اللعبة = ٩٠ ثانية حقيقية

const K = [
  // ساعة، سما فوق، نص، أفق، لون الشمس، قوة الشمس، نور السما، ضباب
  { h: 0, top: [0.01, 0.015, 0.05], mid: [0.02, 0.035, 0.09], hor: [0.06, 0.08, 0.15], sun: [0.5, 0.6, 0.9], sunI: 0.25, hemi: 0.3, night: 1 },
  { h: 5, top: [0.02, 0.03, 0.08], mid: [0.05, 0.06, 0.14], hor: [0.12, 0.12, 0.2], sun: [0.5, 0.6, 0.9], sunI: 0.25, hemi: 0.35, night: 1 },
  { h: 6.3, top: [0.12, 0.2, 0.42], mid: [0.5, 0.4, 0.55], hor: [1.0, 0.62, 0.42], sun: [1.0, 0.65, 0.4], sunI: 1.2, hemi: 0.75, night: 0.35 },
  { h: 8, top: [0.18, 0.38, 0.74], mid: [0.42, 0.62, 0.88], hor: [0.78, 0.85, 0.92], sun: [1.0, 0.93, 0.82], sunI: 2.5, hemi: 1.15, night: 0 },
  { h: 15.5, top: [0.18, 0.38, 0.74], mid: [0.42, 0.62, 0.88], hor: [0.8, 0.86, 0.92], sun: [1.0, 0.92, 0.8], sunI: 2.5, hemi: 1.15, night: 0 },
  { h: 17.3, top: [0.08, 0.12, 0.3], mid: [0.38, 0.24, 0.46], hor: [1.0, 0.55, 0.25], sun: [1.0, 0.6, 0.32], sunI: 2.0, hemi: 1.0, night: 0.25 },
  { h: 18.4, top: [0.04, 0.05, 0.16], mid: [0.2, 0.12, 0.3], hor: [0.6, 0.28, 0.24], sun: [0.9, 0.45, 0.3], sunI: 0.7, hemi: 0.6, night: 0.75 },
  { h: 19.5, top: [0.01, 0.02, 0.06], mid: [0.03, 0.04, 0.1], hor: [0.08, 0.09, 0.16], sun: [0.5, 0.6, 0.9], sunI: 0.25, hemi: 0.32, night: 1 },
  { h: 24, top: [0.01, 0.015, 0.05], mid: [0.02, 0.035, 0.09], hor: [0.06, 0.08, 0.15], sun: [0.5, 0.6, 0.9], sunI: 0.25, hemi: 0.3, night: 1 },
];

const lerp = (a, b, t) => a + (b - a) * t;
const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

export class DayNight {
  constructor(world, scene, startHour = 16.5) {
    this.world = world;
    this.scene = scene;
    this.hour = startHour;
    this.speed = 1 / 90; // ساعة لكل ٩٠ ثانية
    this.nightMats = []; // [material, نهار, ليل]
    this.night = 0;
    this.rain = 0; // ٠..١
    this.listeners = [];
  }

  // خامة بتنوّر بالليل: الشبابيك، الفوانيس، اليفط
  addNight(mat, dayI, nightI) { if (mat) this.nightMats.push([mat, dayI, nightI]); }

  sample(h) {
    let i = 0;
    while (i < K.length - 2 && K[i + 1].h <= h) i++;
    const a = K[i], b = K[i + 1], t = Math.min(1, Math.max(0, (h - a.h) / (b.h - a.h)));
    return {
      top: lerp3(a.top, b.top, t), mid: lerp3(a.mid, b.mid, t), hor: lerp3(a.hor, b.hor, t),
      sun: lerp3(a.sun, b.sun, t), sunI: lerp(a.sunI, b.sunI, t), hemi: lerp(a.hemi, b.hemi, t), night: lerp(a.night, b.night, t),
    };
  }

  update(dt) {
    this.hour = (this.hour + dt * this.speed) % 24;
    const s = this.sample(this.hour);
    const W = this.world, R = this.rain;
    const dim = 1 - R * 0.45;
    // اتجاه الشمس: بتطلع من الشرق (+x) وتغرب في الغرب فوق البحر، والضهر في الجنوب
    const a = ((this.hour - 6) / 12) * Math.PI;
    if (this.hour > 5.5 && this.hour < 18.8) W.sunDir.set(Math.cos(a), Math.max(0.06, Math.sin(a) * 1.1), 0.25 - Math.cos(a) * 0.35).normalize();
    else W.sunDir.set(0.3, 0.7, -0.3).normalize(); // القمر
    W.sun.color.setRGB(...s.sun);
    W.sun.intensity = s.sunI * dim;
    W.hemi.intensity = s.hemi * (1 - R * 0.25);
    W.hemi.color.setRGB(lerp(1, 0.55, s.night), lerp(0.88, 0.62, s.night), lerp(0.75, 0.95, s.night));
    const u = W.sky.material.uniforms;
    u.uTop.value.set(...s.top);
    u.uMid.value.set(...s.mid);
    u.uHor.value.set(...s.hor);
    u.uSunDir.value.copy(W.sunDir);
    u.uSunCol.value.set(...s.sun);
    u.uSunPow.value = s.night > 0.6 ? 600 : 40 + (1 - s.night) * 60;
    u.uStars.value = s.night;
    u.uCloud.value = R;
    if (this.scene.fog) {
      const f = this.scene.fog;
      f.color.setRGB(lerp(s.hor[0], 0.45, R * 0.6) * 0.85, lerp(s.hor[1], 0.47, R * 0.6) * 0.85, lerp(s.hor[2], 0.5, R * 0.6) * 0.85);
      f.near = lerp(150, 40, R);
      f.far = lerp(900, 320, R);
    }
    this.night = s.night;
    for (const [m, d, n] of this.nightMats) m.emissiveIntensity = lerp(d, n, s.night);
    for (const fn of this.listeners) fn(s.night);
  }

  label() {
    const h = Math.floor(this.hour), m = Math.floor((this.hour - h) * 60);
    const h12 = h % 12 || 12;
    const ar = (n) => String(n).replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[d]);
    const icon = this.night > 0.6 ? '🌙' : this.rain > 0.3 ? '🌧️' : this.hour < 7 || this.hour > 17 ? '🌇' : '☀️';
    return `${icon} ${ar(h12)}:${ar(String(m).padStart(2, '0'))} ${h < 12 ? 'ص' : 'م'}`;
  }
}

// المطر: نقط حوالين الكاميرا + سحب + برق في النوّة
export class Weather {
  constructor(scene, mode = 'auto') {
    this.mode = mode; // auto | clear | rain | storm
    this.target = mode === 'rain' ? 0.7 : mode === 'storm' ? 1 : 0;
    this.value = this.target;
    this.timer = 60 + Math.random() * 120;
    this.flash = 0;
    this.nextBolt = 8;
    const N = 3000;
    const pos = new Float32Array(N * 6);
    this.drops = [];
    for (let i = 0; i < N; i++) this.drops.push({ x: (Math.random() - 0.5) * 80, y: Math.random() * 40, z: (Math.random() - 0.5) * 80, v: 18 + Math.random() * 8 });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xaab8c8, transparent: true, opacity: 0.45 }));
    this.lines.frustumCulled = false;
    scene.add(this.lines);
  }

  get storm() { return this.value > 0.85; }

  update(dt, cam, onThunder) {
    if (this.mode === 'auto') {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.timer = 90 + Math.random() * 180;
        const r = Math.random();
        this.target = r < 0.62 ? 0 : r < 0.9 ? 0.6 : 1;
      }
    }
    this.value += Math.sign(this.target - this.value) * Math.min(Math.abs(this.target - this.value), dt * 0.08);
    const v = this.value;
    this.lines.visible = v > 0.02;
    if (this.lines.visible) {
      const arr = this.lines.geometry.attributes.position.array;
      const n = Math.floor(this.drops.length * v);
      const wind = this.storm ? 6 : 1.5;
      for (let i = 0; i < this.drops.length; i++) {
        const d = this.drops[i];
        d.y -= d.v * dt;
        d.x += wind * dt;
        if (d.y < 0) { d.y = 30 + Math.random() * 10; d.x = (Math.random() - 0.5) * 80; d.z = (Math.random() - 0.5) * 80; }
        const o = i * 6;
        if (i >= n) { arr[o] = arr[o + 3] = 0; arr[o + 1] = arr[o + 4] = -999; arr[o + 2] = arr[o + 5] = 0; continue; }
        const x = cam.x + d.x, z = cam.z + d.z;
        arr[o] = x; arr[o + 1] = d.y; arr[o + 2] = z;
        arr[o + 3] = x - wind * 0.04; arr[o + 4] = d.y + 0.7; arr[o + 5] = z;
      }
      this.lines.geometry.attributes.position.needsUpdate = true;
    }
    // برق في النوّة
    this.flash = Math.max(0, this.flash - dt * 4);
    if (this.storm) {
      this.nextBolt -= dt;
      if (this.nextBolt <= 0) { this.nextBolt = 6 + Math.random() * 14; this.flash = 1; setTimeout(() => onThunder && onThunder(), 600 + Math.random() * 1500); }
    }
  }
}
