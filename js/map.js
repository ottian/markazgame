// خريطة إسكندرية المبسّطة: شبكة مربعات (شمال = البحر، جنوب = بحيرة مريوط)
// كل مربع = TILE متر. الإحداثيات: x شرق، z جنوب.

export const TILE = 12;
export const COLS = 96;
export const ROWS = 40;

export const T = {
  BUILDING: 0,
  ROAD: 1,
  SEA: 2,
  PROMENADE: 3,
  PARK: 4,
  LAKE: 5,
  CENTER: 6,
};

// الأحياء من الغرب للشرق (نطاق الأعمدة)
export const DISTRICTS = [
  { key: 'agami', name: 'العجمي والمكس', c0: 0, c1: 8 },
  { key: 'karmouz', name: 'كرموز', c0: 9, c1: 15 },
  { key: 'mansheya', name: 'المنشية', c0: 16, c1: 21 },
  { key: 'raml', name: 'محطة الرمل', c0: 22, c1: 29 },
  { key: 'shatby', name: 'الشاطبي', c0: 30, c1: 37 },
  { key: 'sporting', name: 'سبورتنج وكليوباترا', c0: 38, c1: 44 },
  { key: 'smouha', name: 'سيدي جابر وسموحة', c0: 45, c1: 53 },
  { key: 'rushdy', name: 'رشدي وستانلي', c0: 54, c1: 60 },
  { key: 'sidibishr', name: 'سيدي بشر', c0: 61, c1: 68 },
  { key: 'miami', name: 'ميامي', c0: 69, c1: 74 },
  { key: 'asafra', name: 'العصافرة', c0: 75, c1: 80 },
  { key: 'mandara', name: 'المندرة', c0: 81, c1: 86 },
  { key: 'montaza', name: 'المنتزه', c0: 87, c1: 95 },
];

export const MAIN_V = [2, 9, 16, 22, 28, 34, 40, 46, 52, 58, 64, 70, 76, 82, 88, 94];
export const MAIN_H = [14, 23, 32];
export const CORNICHE = [5, 6]; // صفين = كورنيش باتجاهين

// مكان المركز: مجمّع 3×3 فوق طريق الصف 23 مباشرة
export const CENTER = { c0: 48, c1: 50, r0: 20, r1: 22, doorCol: 49, doorRow: 23 };

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function buildMap(seed = 1957) {
  const rand = rng(seed);
  const g = new Uint8Array(COLS * ROWS).fill(T.BUILDING);
  const height = new Uint8Array(COLS * ROWS); // عدد الأدوار
  const set = (c, r, v) => {
    if (c >= 0 && c < COLS && r >= 0 && r < ROWS) g[r * COLS + c] = v;
  };
  const roads = []; // مقاطع الطرق الرئيسية للمرور

  for (let r = 0; r <= 3; r++) for (let c = 0; c < COLS; c++) set(c, r, T.SEA);
  for (let c = 0; c < COLS; c++) set(c, 4, T.PROMENADE);

  // بحيرة مريوط في الجنوب الغربي
  for (let r = 34; r < ROWS; r++) for (let c = 0; c <= 33; c++) set(c, r, T.LAKE);
  for (let c = 0; c <= 33; c++) set(c, 33, T.PROMENADE);
  // جنوب شرق: مساحات خضرا
  for (let r = 34; r < ROWS; r++) for (let c = 34; c < COLS; c++) set(c, r, rand() < 0.7 ? T.PARK : T.BUILDING);

  // حدائق: المنتزه، الشلالات، نادي سموحة، أنطونيادس
  const park = (c0, c1, r0, r1) => {
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) set(c, r, T.PARK);
  };
  park(86, 95, 7, 13);
  park(23, 27, 15, 18);
  park(47, 51, 24, 30);
  park(35, 39, 24, 27);

  // الطرق
  const hRoad = (r, c0, c1, main) => {
    for (let c = c0; c <= c1; c++) set(c, r, T.ROAD);
    if (main) roads.push({ dir: 'h', line: r, a: c0, b: c1 });
  };
  const vRoad = (c, r0, r1, main) => {
    for (let r = r0; r <= r1; r++) set(c, r, T.ROAD);
    if (main) roads.push({ dir: 'v', line: c, a: r0, b: r1 });
  };

  hRoad(5, 0, COLS - 1, true);
  hRoad(6, 0, COLS - 1, true);
  for (const r of MAIN_H) hRoad(r, 0, COLS - 1, true);
  for (const c of MAIN_V) vRoad(c, 7, 32, true);

  // شوارع جانبية عشوائية (ثابتة بنفس البذرة)
  for (const r of [10, 19, 28]) {
    for (let i = 0; i < MAIN_V.length - 1; i++) {
      if (rand() < 0.55) hRoad(r, MAIN_V[i], MAIN_V[i + 1], false);
    }
  }
  for (let i = 0; i < MAIN_V.length - 1; i++) {
    const c = MAIN_V[i] + 3;
    for (const [r0, r1] of [[7, 14], [14, 23], [23, 32]]) {
      if (rand() < 0.35) vRoad(c, r0, r1, false);
    }
  }

  // المركز
  for (let r = CENTER.r0; r <= CENTER.r1; r++)
    for (let c = CENTER.c0; c <= CENTER.c1; c++) set(c, r, T.CENTER);
  set(CENTER.doorCol, CENTER.doorRow, T.ROAD);

  // ارتفاعات المباني: أعلى عند الكورنيش
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const i = r * COLS + c;
      if (g[i] !== T.BUILDING) continue;
      const nearSea = r <= 9;
      const base = nearSea ? 9 : r < 20 ? 6 : 4;
      height[i] = Math.max(2, Math.round(base + rand() * 6 - 2));
    }
  }

  return { grid: g, height, roads };
}

export function tileAt(map, c, r) {
  if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return T.BUILDING;
  return map.grid[r * COLS + c];
}

export function solidAt(map, x, z) {
  return tileAt(map, Math.floor(x / TILE), Math.floor(z / TILE)) !== T.ROAD;
}

export function districtAt(x) {
  const c = Math.floor(x / TILE);
  return DISTRICTS.find((d) => c >= d.c0 && c <= d.c1) || DISTRICTS[0];
}

export function tileCenter(c, r) {
  return { x: (c + 0.5) * TILE, z: (r + 0.5) * TILE };
}

// مكان استلام عشوائي: مربع طريق في حي معين، جنبه مبنى (باب بيت)
export function randomPickup(map, district, rand = Math.random) {
  const cands = [];
  for (let r = 7; r <= 32; r++) {
    for (let c = district.c0; c <= district.c1; c++) {
      if (tileAt(map, c, r) !== T.ROAD) continue;
      const nextToBuilding =
        tileAt(map, c, r - 1) === T.BUILDING ||
        tileAt(map, c, r + 1) === T.BUILDING ||
        tileAt(map, c - 1, r) === T.BUILDING ||
        tileAt(map, c + 1, r) === T.BUILDING;
      if (nextToBuilding) cands.push({ c, r });
    }
  }
  if (!cands.length) return null;
  return cands[Math.floor(rand() * cands.length)];
}

// ---------- مسارات المشاة ----------
// أرصفة على جنبي كل طريق رئيسي + ممشى الكورنيش
export function sidewalkPaths(map) {
  const out = [];
  const OFF = TILE / 2 + 0.6;
  for (const rd of map.roads) {
    const a = rd.a * TILE, b = (rd.b + 1) * TILE;
    if (rd.dir === 'h') {
      if (rd.line === 5) continue;
      if (rd.line === 6) { out.push({ ax: a, az: 7 * TILE + 0.6, bx: b, bz: 7 * TILE + 0.6 }); continue; }
      const zc = (rd.line + 0.5) * TILE;
      out.push({ ax: a, az: zc - OFF, bx: b, bz: zc - OFF }, { ax: a, az: zc + OFF, bx: b, bz: zc + OFF });
    } else {
      const xc = (rd.line + 0.5) * TILE;
      out.push({ ax: xc - OFF, az: a, bx: xc - OFF, bz: b }, { ax: xc + OFF, az: a, bx: xc + OFF, bz: b });
    }
  }
  // ممشى الكورنيش (أطول ومزدحم أكتر)
  for (const z of [4 * TILE + 3.5, 4 * TILE + 5.5, 4 * TILE + 9]) {
    for (let c = 0; c < COLS; c += 12) out.push({ ax: c * TILE, az: z, bx: Math.min(COLS, c + 12) * TILE, bz: z });
  }
  return out;
}

// صيادين واقفين على سور الكورنيش باصّين للبحر
export function cornicheStanders(rand = Math.random) {
  const out = [];
  for (let x = 6; x < COLS * TILE; x += 9 + rand() * 18) out.push({ x, z: 4 * TILE + 1.0, yaw: -Math.PI / 2, fisher: rand() < 0.7 });
  return out;
}

// مكان عبور مشاة قدّام اللاعب: بيرجّع خط من رصيف لرصيف
export function crossingAhead(map, x, z, heading, dist) {
  const px = x + Math.cos(heading) * dist, pz = z + Math.sin(heading) * dist;
  const c = Math.floor(px / TILE), r = Math.floor(pz / TILE);
  if (tileAt(map, c, r) !== T.ROAD) return null;
  const road = (cc, rr) => tileAt(map, cc, rr) === T.ROAD;
  if (r === 5 || r === 6) {
    // عبور الكورنيش من الممشى للرصيف التاني
    const flip = Math.random() < 0.5;
    const a = { x: px, z: 4 * TILE + 11.4 }, b = { x: px + (Math.random() - 0.5) * 4, z: 7 * TILE + 0.6 };
    return flip ? { ax: b.x, az: b.z, bx: a.x, bz: a.z } : { ax: a.x, az: a.z, bx: b.x, bz: b.z };
  }
  const horiz = road(c - 1, r) && road(c + 1, r) && !road(c, r - 1) && !road(c, r + 1);
  const vert = road(c, r - 1) && road(c, r + 1) && !road(c - 1, r) && !road(c + 1, r);
  const flip = Math.random() < 0.5;
  let seg = null;
  if (horiz) seg = { ax: px, az: r * TILE - 0.6, bx: px, bz: (r + 1) * TILE + 0.6 };
  else if (vert) seg = { ax: c * TILE - 0.6, az: pz, bx: (c + 1) * TILE + 0.6, bz: pz };
  if (!seg) return null;
  return flip ? { ax: seg.bx, az: seg.bz, bx: seg.ax, bz: seg.az } : seg;
}
