import * as THREE from 'three';

// خامات PBR مولّدة بالكود: لون + نورمال (تضاريس) + خشونة
// كل خامة بتتكرر من غير ما يبان فيها تكرار واضح

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// value noise متكررة (tileable)
function makeNoise(size, cells, seed) {
  const r = rng(seed);
  const grid = new Float32Array(cells * cells).map(() => r());
  const at = (x, y) => grid[((y % cells) + cells) % cells * cells + (((x % cells) + cells) % cells)];
  return (x, y) => {
    const fx = (x / size) * cells, fy = (y / size) * cells;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}

function fbm(size, seed, octaves = 5, base = 4) {
  const ns = [];
  for (let o = 0; o < octaves; o++) ns.push(makeNoise(size, base << o, seed + o * 101));
  return (x, y) => {
    let v = 0, amp = 0.5, tot = 0;
    for (const n of ns) { v += n(x, y) * amp; tot += amp; amp *= 0.5; }
    return v / tot;
  };
}

function toTexture(canvas, color = true) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// نورمال من خريطة ارتفاع (Sobel)
export function normalFromHeight(h, size, strength = 2) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');
  const img = g.createImageData(size, size);
  const H = (x, y) => h[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (H(x + 1, y - 1) + 2 * H(x + 1, y) + H(x + 1, y + 1) - H(x - 1, y - 1) - 2 * H(x - 1, y) - H(x - 1, y + 1)) * strength;
    const dy = (H(x - 1, y + 1) + 2 * H(x, y + 1) + H(x + 1, y + 1) - H(x - 1, y - 1) - 2 * H(x, y - 1) - H(x + 1, y - 1)) * strength;
    const l = Math.hypot(dx, dy, 1);
    const i = (y * size + x) * 4;
    img.data[i] = (-dx / l * 0.5 + 0.5) * 255;
    img.data[i + 1] = (dy / l * 0.5 + 0.5) * 255;
    img.data[i + 2] = (1 / l * 0.5 + 0.5) * 255;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return toTexture(cv, false);
}

// نورمال من صورة ملونة (الغامق = غاطس) — للواجهات: الشبابيك والبلكونات بتبان ليها عمق
export function normalFromImage(srcCanvas, size = 512, strength = 3) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');
  g.drawImage(srcCanvas, 0, 0, size, size);
  const d = g.getImageData(0, 0, size, size).data;
  const h = new Float32Array(size * size);
  for (let i = 0; i < size * size; i++) h[i] = (d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11) / 255;
  return normalFromHeight(h, size, strength);
}

function build(size, seed, fn) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');
  const img = g.createImageData(size, size);
  const h = new Float32Array(size * size);
  const rough = document.createElement('canvas');
  rough.width = rough.height = size;
  const rg = rough.getContext('2d');
  const rimg = rg.createImageData(size, size);
  fn(img.data, h, rimg.data);
  g.putImageData(img, 0, 0);
  rg.putImageData(rimg, 0, 0);
  return { canvas: cv, h, rough };
}

// أسفلت: حصى، بقع ترقيع، شروخ، آثار كاوتش
export function makeAsphalt(size = 512, seed = 7) {
  const big = fbm(size, seed, 4, 3), fine = fbm(size, seed + 50, 3, 64), mid = fbm(size, seed + 90, 4, 12);
  const r = rng(seed + 3);
  // شروخ: خطوط عشوائية متعرّجة
  const cracks = new Uint8Array(size * size);
  for (let k = 0; k < 9; k++) {
    let x = r() * size, y = r() * size, a = r() * Math.PI * 2;
    const steps = 80 + r() * 160;
    for (let s = 0; s < steps; s++) {
      a += (r() - 0.5) * 0.6;
      x = (x + Math.cos(a) * 1.5 + size) % size;
      y = (y + Math.sin(a) * 1.5 + size) % size;
      cracks[Math.floor(y) * size + Math.floor(x)] = 1;
      if (r() < 0.02) { const b = a + (r() < 0.5 ? 1 : -1) * 0.9; let bx = x, by = y; for (let t = 0; t < 30; t++) { bx = (bx + Math.cos(b) * 1.5 + size) % size; by = (by + Math.sin(b) * 1.5 + size) % size; cracks[Math.floor(by) * size + Math.floor(bx)] = 1; } }
    }
  }
  return build(size, seed, (px, h, rp) => {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const patch = big(x, y) > 0.62 ? 1 : 0; // ترقيع أغمق
      const grain = fine(x, y), m = mid(x, y);
      const speck = r() < 0.08 ? (r() - 0.3) * 0.25 : 0; // حصى فاتح
      const crack = cracks[i];
      let v = 0.24 + (m - 0.5) * 0.08 + (grain - 0.5) * 0.1 + speck - patch * 0.05 - crack * 0.12;
      // آثار الكاوتش: شريطين أغمق شوية
      const lane = (x / size) * 2 % 1;
      if (Math.abs(lane - 0.3) < 0.07 || Math.abs(lane - 0.7) < 0.07) v -= 0.025;
      v = Math.max(0.04, Math.min(0.6, v));
      px[i * 4] = v * 255; px[i * 4 + 1] = v * 255 * 1.01; px[i * 4 + 2] = v * 255 * 1.04; px[i * 4 + 3] = 255;
      h[i] = grain * 0.6 + speck * 2 - crack * 0.8;
      const ro = 0.82 + (grain - 0.5) * 0.2 - patch * 0.08;
      rp[i * 4] = rp[i * 4 + 1] = rp[i * 4 + 2] = Math.max(0, Math.min(1, ro)) * 255; rp[i * 4 + 3] = 255;
    }
  });
}

// رصيف: بلاط ٤٠ سم (رمادي وبيج) بعراميس، وشوية بلاط مكسور
export function makePavers(size = 512, seed = 21) {
  const tiles = 5; // ٥×٥ بلاطات في الصورة = ٢ متر
  const n = fbm(size, seed, 4, 8), fine = fbm(size, seed + 7, 3, 64);
  const r = rng(seed);
  const tint = Array.from({ length: tiles * tiles }, () => [0.62 + r() * 0.1, r() < 0.15 ? 1 : 0]);
  return build(size, seed, (px, h, rp) => {
    const T = size / tiles;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const tx = Math.floor(x / T), ty = Math.floor(y / T);
      const lx = (x % T) / T, ly = (y % T) / T;
      const edge = Math.min(lx, ly, 1 - lx, 1 - ly);
      const joint = edge < 0.03 ? 1 : 0;
      const [base, broken] = tint[ty * tiles + tx];
      let v = base + (n(x, y) - 0.5) * 0.12 + (fine(x, y) - 0.5) * 0.08 - joint * 0.3;
      if (broken && fine(x * 2, y * 2) > 0.65) v -= 0.12;
      const warm = 1 + ((tx + ty) % 2) * 0.03;
      px[i * 4] = v * 255 * warm; px[i * 4 + 1] = v * 255 * 0.98; px[i * 4 + 2] = v * 255 * 0.93; px[i * 4 + 3] = 255;
      h[i] = (joint ? 0 : 0.6 + fine(x, y) * 0.3) - (broken ? 0.1 : 0) - Math.max(0, 0.08 - edge) * 3;
      const ro = joint ? 1 : 0.75 + (fine(x, y) - 0.5) * 0.2;
      rp[i * 4] = rp[i * 4 + 1] = rp[i * 4 + 2] = ro * 255; rp[i * 4 + 3] = 255;
    }
  });
}

export function pbrSet(gen, normalStrength = 2) {
  return {
    map: toTexture(gen.canvas, true),
    normalMap: normalFromHeight(gen.h, gen.canvas.width, normalStrength),
    roughnessMap: toTexture(gen.rough, false),
  };
}

// الخامة تاخد إحداثياتها من مكانها في العالم (مش من الشكل) — مناسب للأرض والشوارع
export function worldUV(mat, scale) {
  const s = scale.toFixed(5);
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <uv_vertex>', `#include <uv_vertex>
      vec2 wuv = (modelMatrix * vec4(position, 1.0)).xz * ${s};
      #ifdef USE_MAP
        vMapUv = wuv;
      #endif
      #ifdef USE_NORMALMAP
        vNormalMapUv = wuv;
      #endif
      #ifdef USE_ROUGHNESSMAP
        vRoughnessMapUv = wuv;
      #endif`);
  };
  mat.customProgramCacheKey = () => 'wuv' + s;
  return mat;
}
