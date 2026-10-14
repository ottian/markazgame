import * as THREE from 'three';

// واجهات مرسومة بالكود بستايل إسكندراني — كل صورة = ٤ شبابيك × ٤ أدوار وبتتكرر على الحيطة
// (map للألوان + emissive للشبابيك المنوّرة بالليل)

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function pair(size, seed, draw) {
  const rand = rng(seed);
  const lit = Array.from({ length: 16 }, () => rand() < 0.3);
  const mk = (night) => {
    const cv = document.createElement('canvas');
    cv.width = cv.height = size * 2; // دقة أعلى
    const g = cv.getContext('2d');
    g.scale(2, 2);
    draw(g, size, rand, lit, night);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
    return t;
  };
  const r0 = rand;
  const map = mk(false);
  // نعيد نفس العشوائية للصورة التانية عشان الشبابيك تطابق
  return { map, emissive: (() => { void r0; return mk(true); })() };
}

const C = 64; // حجم الخانة (شباك واحد × دور واحد)

// عمارة سكنية: شيش خشب، بلكونات بسور، تكييفات
function residential(g, S, rand, lit, night) {
  if (night) {
    g.fillStyle = '#000';
    g.fillRect(0, 0, S, S);
  } else {
    g.fillStyle = '#ece4d4';
    g.fillRect(0, 0, S, S);
    // ملمس المحارة: نقط فاتحة وغامقة
    for (let i = 0; i < 1400; i++) {
      g.fillStyle = rand() < 0.5 ? 'rgba(0,0,0,0.035)' : 'rgba(255,255,255,0.05)';
      g.fillRect(rand() * S, rand() * S, 1 + rand() * 2, 1 + rand() * 2);
    }
  }
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const px = x * C, py = y * C, on = lit[y * 4 + x];
      const balcony = (x + y) % 2 === 0;
      const wy = balcony ? py + 8 : py + 14, wh = balcony ? 44 : 30;
      if (night) {
        if (on) { g.fillStyle = (x + y) % 3 ? '#ffb347' : '#e8f0ff'; g.fillRect(px + 19, wy + 1, 26, wh - 2); }
        continue;
      }
      // كرنيشة الدور + خط تراب نازل من تحت الشباك
      g.fillStyle = 'rgba(0,0,0,0.07)';
      g.fillRect(px, py + C - 5, C, 5);
      const grd = g.createLinearGradient(0, wy + wh, 0, wy + wh + 18);
      grd.addColorStop(0, 'rgba(60,50,40,0.18)');
      grd.addColorStop(1, 'rgba(60,50,40,0)');
      g.fillStyle = grd;
      g.fillRect(px + 20, wy + wh, 24, 18);
      // إطار أبيض
      g.fillStyle = '#f7f3ea';
      g.fillRect(px + 16, wy - 3, 32, wh + 5);
      // الزجاج (مع انعكاس سما)
      const gl = g.createLinearGradient(0, wy, 0, wy + wh);
      gl.addColorStop(0, on ? '#f6d48a' : '#56708a');
      gl.addColorStop(1, on ? '#e0b060' : '#222a36');
      g.fillStyle = gl;
      g.fillRect(px + 19, wy, 26, wh);
      g.fillStyle = '#f7f3ea';
      g.fillRect(px + 31, wy, 2, wh); // قايم في النص
      // شيش خشب مفتوح بشرايح
      const shutter = ['#3d6b4a', '#6b4a2e', '#5a6f7a', '#7a5a3a'][(x * 7 + y * 3) % 4];
      for (const sx of [px + 9, px + 48]) {
        g.fillStyle = shutter;
        g.fillRect(sx, wy - 2, 7, wh + 3);
        g.fillStyle = 'rgba(0,0,0,0.25)';
        for (let k = wy; k < wy + wh; k += 3) g.fillRect(sx, k, 7, 1);
      }
      // عتبة
      g.fillStyle = '#d6cbb5';
      g.fillRect(px + 14, wy + wh + 1, 36, 3);
      if (!balcony && (x + y * 2) % 3 === 0) {
        g.fillStyle = '#dcdcdc';
        g.fillRect(px + 21, py + 47, 22, 11); // تكييف
        g.fillStyle = '#8a8a8a';
        for (let k = 0; k < 4; k++) g.fillRect(px + 23, py + 49 + k * 2, 18, 1);
      }
    }
  }
}

// مبنى حديث/تجاري: شرايط إزاز
function modern(g, S, rand, lit, night) {
  g.fillStyle = night ? '#000' : '#cfd4d8';
  g.fillRect(0, 0, S, S);
  for (let y = 0; y < 4; y++) {
    if (!night) { g.fillStyle = '#3b4d5e'; g.fillRect(0, y * C + 10, S, 40); }
    for (let x = 0; x < 4; x++) {
      const on = lit[y * 4 + x];
      if (night) { if (on) { g.fillStyle = '#ffd9a0'; g.fillRect(x * C + 2, y * C + 10, C - 4, 40); } continue; }
      if (on) { g.fillStyle = 'rgba(255,220,150,0.55)'; g.fillRect(x * C + 2, y * C + 10, C - 4, 40); }
      g.fillStyle = '#8c9aa6';
      g.fillRect(x * C, y * C + 10, 2, 40);
    }
  }
}

// قديم/كلاسيكي: شبابيك طويلة بأقواس وحجر
function classic(g, S, rand, lit, night) {
  g.fillStyle = night ? '#000' : '#dccaa6';
  g.fillRect(0, 0, S, S);
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const px = x * C, py = y * C, on = lit[y * 4 + x];
      if (night) {
        if (on) { g.fillStyle = '#ffb347'; g.fillRect(px + 20, py + 14, 24, 38); }
        continue;
      }
      g.fillStyle = '#c4b088';
      g.fillRect(px + 14, py + 8, 36, 50); // إطار حجر
      g.fillStyle = on ? '#f6d48a' : '#2b2f38';
      g.beginPath();
      g.moveTo(px + 20, py + 52);
      g.lineTo(px + 20, py + 24);
      g.arc(px + 32, py + 24, 12, Math.PI, 0);
      g.lineTo(px + 44, py + 52);
      g.closePath();
      g.fill();
      g.fillStyle = '#b8a47c';
      g.fillRect(px, py + C - 4, C, 4);
    }
  }
}

// مدرسة/مستشفى/مبنى حكومي: شبابيك عريضة متكررة
function institutional(g, S, rand, lit, night) {
  g.fillStyle = night ? '#000' : '#efe7d6';
  g.fillRect(0, 0, S, S);
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const px = x * C, py = y * C, on = lit[y * 4 + x];
      if (night) { if (on) { g.fillStyle = '#ffe0a8'; g.fillRect(px + 8, py + 16, 48, 28); } continue; }
      g.fillStyle = on ? '#f3e2b0' : '#3a4656';
      g.fillRect(px + 8, py + 16, 48, 28);
      g.fillStyle = '#dcd2bd';
      g.fillRect(px + 31, py + 16, 2, 28);
      g.fillRect(px + 8, py + 29, 48, 2);
    }
  }
}

// مخازن/ورش: حيطة صاج وشبابيك صغيرة فوق
function industrial(g, S, rand, lit, night) {
  g.fillStyle = night ? '#000' : '#a9a398';
  g.fillRect(0, 0, S, S);
  if (night) return;
  for (let x = 0; x < S; x += 8) { g.fillStyle = x % 16 ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.05)'; g.fillRect(x, 0, 4, S); }
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { g.fillStyle = '#4a5260'; g.fillRect(x * C + 16, y * C + 6, 32, 10); }
}

// الدور الأرضي: محلات بيفط ملونة وأبواب صاج
function shops(g, S, rand, lit, night) {
  // صورة واحدة = ٤ محلات عرض × دور واحد (S × S/4 بتتمط على ٤.٢ م)
  g.fillStyle = night ? '#000' : '#bdb3a3';
  g.fillRect(0, 0, S, S);
  const signs = ['#c8102e', '#0f5fa8', '#13804a', '#e6a817', '#6a2c91', '#d4561e', '#0b8a8a'];
  for (let i = 0; i < 4; i++) {
    const px = i * C;
    const col = signs[(i * 3 + 1) % signs.length];
    if (night) {
      g.fillStyle = col; g.fillRect(px + 2, 4, C - 4, 52);
      if (i % 2 === 0) { g.fillStyle = '#ffe9b0'; g.fillRect(px + 6, 70, C - 12, 150); }
      continue;
    }
    g.fillStyle = col;
    g.fillRect(px + 2, 4, C - 4, 52); // يافطة
    g.fillStyle = 'rgba(255,255,255,0.85)';
    for (let k = 0; k < 3; k++) g.fillRect(px + 10 + k * 15, 22 + (k % 2) * 6, 10, 5); // كلام اليافطة
    if (i % 3 === 1) {
      g.fillStyle = '#8a8f96'; // باب صاج مقفول
      g.fillRect(px + 6, 70, C - 12, 170);
      g.fillStyle = 'rgba(0,0,0,0.15)';
      for (let y = 74; y < 240; y += 7) g.fillRect(px + 6, y, C - 12, 2);
    } else {
      g.fillStyle = '#ffeec4'; // فاترينة منوّرة
      g.fillRect(px + 6, 70, C - 12, 150);
      g.fillStyle = rand() < 0.5 ? '#c87a3a' : '#5a8a3a';
      g.fillRect(px + 10, 150, C - 20, 60); // بضاعة
    }
  }
}

export function makeFacadeSet() {
  const set = {
    residential: pair(256, 11, residential),
    modern: pair(256, 22, modern),
    classic: pair(256, 33, classic),
    institutional: pair(256, 44, institutional),
    industrial: pair(256, 55, industrial),
    shops: pair(256, 66, shops),
  };
  const mats = {};
  for (const [k, t] of Object.entries(set)) {
    mats[k] = new THREE.MeshLambertMaterial({
      map: t.map, emissiveMap: t.emissive, emissive: 0xffffff, emissiveIntensity: k === 'shops' ? 1.0 : 0.8,
      vertexColors: true, side: THREE.DoubleSide,
    });
  }
  return mats;
}
