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
    cv.width = cv.height = size;
    const g = cv.getContext('2d');
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
  g.fillStyle = night ? '#000' : '#ece4d4';
  g.fillRect(0, 0, S, S);
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const px = x * C, py = y * C, on = lit[y * 4 + x];
      if (!night) {
        g.fillStyle = 'rgba(0,0,0,0.06)';
        g.fillRect(px, py + C - 6, C, 6); // فاصل الدور
      }
      const balcony = (x + y) % 2 === 0;
      // الشباك / باب البلكونة
      const wy = balcony ? py + 8 : py + 14, wh = balcony ? 44 : 30;
      if (night) {
        if (on) { g.fillStyle = '#ffb347'; g.fillRect(px + 18, wy, 28, wh); }
        continue;
      }
      g.fillStyle = on ? '#f6d48a' : '#2a3140';
      g.fillRect(px + 18, wy, 28, wh);
      // شيش مفتوح على الجنبين
      const shutter = ['#3d6b4a', '#6b4a2e', '#5a6f7a'][(x * 7 + y * 3) % 3];
      g.fillStyle = shutter;
      g.fillRect(px + 10, wy, 7, wh);
      g.fillRect(px + 47, wy, 7, wh);
      if (balcony) {
        g.fillStyle = '#d8cfbd';
        g.fillRect(px + 6, py + 48, 52, 4); // أرضية البلكونة
        g.fillStyle = '#4a4a4a';
        for (let i = 0; i < 8; i++) g.fillRect(px + 8 + i * 6.5, py + 40, 1.5, 9); // السور
        g.fillRect(px + 6, py + 39, 52, 2);
      } else if ((x + y * 2) % 3 === 0) {
        g.fillStyle = '#d9d9d9';
        g.fillRect(px + 22, py + 46, 20, 10); // تكييف
        g.fillStyle = '#9a9a9a';
        g.fillRect(px + 24, py + 48, 16, 2);
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
