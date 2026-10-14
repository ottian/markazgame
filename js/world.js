import * as THREE from 'three';
import { TILE, COLS, ROWS, T, CENTER, tileAt, DISTRICTS, MAIN_V } from './map.js';
import { CONFIG } from './config.js';

const W = COLS * TILE;
const H = ROWS * TILE;

function canvasTex(w, h, draw) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// واجهة مبنى: 4×4 شبابيك (بعضها منوّر) + بلكونات
export function makeFacadeTextures() {
  const rand = rng(42);
  const lit = [];
  for (let i = 0; i < 16; i++) lit.push(rand() < 0.35);
  const map = canvasTex(256, 256, (g) => {
    g.fillStyle = '#e9e2d6';
    g.fillRect(0, 0, 256, 256);
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        const px = x * 64, py = y * 64;
        g.fillStyle = '#d6cdbd';
        g.fillRect(px, py + 54, 64, 10); // فاصل الدور
        g.fillStyle = lit[y * 4 + x] ? '#ffd27a' : '#2b3342';
        g.fillRect(px + 16, py + 12, 32, 36);
        g.fillStyle = '#6b5a48';
        g.fillRect(px + 12, py + 46, 40, 5); // بلكونة
      }
    }
  });
  const emissive = canvasTex(256, 256, (g) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, 256, 256);
    for (let y = 0; y < 4; y++)
      for (let x = 0; x < 4; x++)
        if (lit[y * 4 + x]) {
          g.fillStyle = '#ffb347';
          g.fillRect(x * 64 + 16, y * 64 + 12, 32, 36);
        }
  });
  for (const t of [map, emissive]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
  }
  return { map, emissive };
}

function stripeTex() {
  const t = canvasTex(64, 8, (g) => {
    g.fillStyle = '#f2c230';
    g.fillRect(0, 0, 64, 8);
    g.fillStyle = '#151515';
    g.fillRect(32, 0, 32, 8);
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function signTex(text, sub) {
  return canvasTex(1024, 256, (g, w, h) => {
    g.fillStyle = '#0f6b5c';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#ffffff';
    g.lineWidth = 10;
    g.strokeRect(10, 10, w - 20, h - 20);
    g.fillStyle = '#fff';
    g.direction = 'rtl';
    g.textAlign = 'center';
    g.font = 'bold 84px Cairo, Tahoma, sans-serif';
    g.fillText(text, w / 2, 120);
    g.font = '44px Cairo, Tahoma, sans-serif';
    g.fillText(sub, w / 2, 200);
  });
}

function makeSkyDome(day = false) {
  const geo = new THREE.SphereGeometry(1500, 32, 16);
  const v3 = (r, g, b) => ({ value: new THREE.Vector3(r, g, b) });
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uTop: day ? v3(0.18, 0.38, 0.75) : v3(0.05, 0.07, 0.2),
      uMid: day ? v3(0.45, 0.65, 0.9) : v3(0.33, 0.18, 0.42),
      uHor: day ? v3(0.8, 0.86, 0.92) : v3(1.0, 0.55, 0.25),
      uSunDir: { value: new THREE.Vector3(-0.75, 0.08, -0.65).normalize() },
      uSunCol: v3(1.0, 0.6, 0.3),
      uSunPow: { value: day ? 200 : 40 },
      uStars: { value: 0 },
      uCloud: { value: 0 },
    },
    vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
    fragmentShader: `varying vec3 vP;
      uniform vec3 uTop, uMid, uHor, uSunDir, uSunCol; uniform float uSunPow, uStars, uCloud;
      float h31(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,45.164)))*43758.5453); }
      void main(){
        float h = vP.y;
        vec3 c = mix(uHor, uMid, smoothstep(0.0,0.18,h));
        c = mix(c, uTop, smoothstep(0.18,0.7,h));
        float sun = max(dot(vP, normalize(uSunDir)),0.0);
        c += uSunCol*pow(sun,uSunPow)*1.5 + uSunCol*pow(sun,6.0)*0.25*(1.0-uCloud);
        // نجوم بالليل
        vec3 q = floor(vP*400.0);
        float st = step(0.9985, h31(q)) * smoothstep(0.05,0.3,h) * uStars * (1.0-uCloud);
        c += vec3(st);
        // سحب رمادي وقت المطر
        c = mix(c, vec3(0.42,0.45,0.5)*(0.35+0.65*length(uHor)), uCloud*0.75);
        if(h<0.0) c = mix(uHor*0.6, uTop*0.5, smoothstep(0.0,-0.2,h));
        gl_FragColor = vec4(c,1.0);
      }`,
  });
  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = -1;
  return m;
}

export function buildWorld(scene, map, quality = { shadows: 0 }) {
  const rand = rng(7);
  const sky = makeSkyDome(!!quality.onlySky);
  scene.add(sky);
  scene.fog = new THREE.Fog(0x6a4a66, 120, 620);

  const hemi = new THREE.HemisphereLight(0xffd2b0, 0x30283a, 1.1);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffa96b, 2.0);
  const SUN_DIR = new THREE.Vector3(-0.72, 0.42, -0.55).normalize();
  sun.position.copy(SUN_DIR).multiplyScalar(200);
  if (quality.shadows) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(quality.shadows, quality.shadows);
    const sc = sun.shadow.camera;
    sc.left = -70; sc.right = 70; sc.top = 70; sc.bottom = -70; sc.near = 10; sc.far = 450;
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.4;
  }
  scene.add(sun, sun.target);
  const follow = (x, z) => {
    sun.target.position.set(x, 0, z);
    sun.position.set(x + SUN_DIR.x * 200, SUN_DIR.y * 200, z + SUN_DIR.z * 200);
  };
  if (quality.onlySky) {
    // وضع جوجل: المباني جاية من جوجل، إحنا بنعمل السما والنور بس
    scene.fog = new THREE.Fog(0x9fb4c8, 600, 2200);
    return { sky, hemi, sun, sunDir: SUN_DIR, follow, update(t, camPos) { sky.position.copy(camPos); } };
  }

  // الأرض (رصيف)
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(W + 2000, H + 2000),
    new THREE.MeshLambertMaterial({ color: 0x8d8478 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(W / 2, -0.05, H / 2);
  ground.receiveShadow = true;
  scene.add(ground);

  // البحر
  // بحر بموج متحرك (موج في الـ vertex shader)
  const timeU = { value: 0 };
  const seaMat = new THREE.MeshStandardMaterial({ color: 0x0f3a5e, roughness: 0.12, metalness: 0.2 });
  seaMat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = timeU;
    const waves = `
      float a1 = position.x * 0.07 + uTime * 1.1;
      float a2 = position.z * 0.10 - uTime * 1.6 + position.x * 0.03;
      float a3 = (position.x + position.z) * 0.23 + uTime * 2.3;`;
    sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader
      .replace('#include <beginnormal_vertex>', `${waves}
      float dX = cos(a1) * 0.4 * 0.07 + cos(a2) * 0.3 * 0.03 + cos(a3) * 0.08 * 0.23;
      float dZ = cos(a2) * 0.3 * 0.10 + cos(a3) * 0.08 * 0.23;
      vec3 objectNormal = normalize(vec3(-dX, 1.0, -dZ));`)
      .replace('#include <begin_vertex>', `vec3 transformed = vec3(position);
      transformed.y += sin(a1) * 0.4 + sin(a2) * 0.3 + sin(a3) * 0.08;`);
  };
  const seaGeo = new THREE.PlaneGeometry(W + 3000, 1500, 260, 90);
  seaGeo.rotateX(-Math.PI / 2);
  const sea = new THREE.Mesh(seaGeo, seaMat);
  sea.position.set(W / 2, -0.8, 4 * TILE - 750);
  scene.add(sea);

  // بحيرة مريوط
  const lake = new THREE.Mesh(
    new THREE.PlaneGeometry(34 * TILE + 1000, 6 * TILE + 1000),
    new THREE.MeshPhongMaterial({ color: 0x2f6a6a, shininess: 60 }),
  );
  lake.rotation.x = -Math.PI / 2;
  lake.position.set((34 * TILE - 1000) / 2, -0.4, 34 * TILE + (6 * TILE + 1000) / 2);
  scene.add(lake);

  // تجميع المربعات حسب النوع
  const roadTiles = [], buildingTiles = [], parkTiles = [], promTiles = [];
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      const t = tileAt(map, c, r);
      if (t === T.ROAD) roadTiles.push([c, r]);
      else if (t === T.BUILDING) buildingTiles.push([c, r]);
      else if (t === T.PARK) parkTiles.push([c, r]);
      else if (t === T.PROMENADE) promTiles.push([c, r]);
    }

  const dummy = new THREE.Object3D();
  const flatInstanced = (tiles, color, y, size = TILE) => {
    const geo = new THREE.PlaneGeometry(size, size);
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color }), tiles.length);
    tiles.forEach(([c, r], i) => {
      dummy.position.set((c + 0.5) * TILE, y, (r + 0.5) * TILE);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.receiveShadow = true;
    scene.add(mesh);
    return mesh;
  };
  flatInstanced(roadTiles, 0x2e3036, 0.02);
  flatInstanced(parkTiles, 0x3d6b35, 0.03);
  flatInstanced(promTiles, 0xc9b48e, 0.03);

  // علامات الطريق
  const isRoad = (c, r) => tileAt(map, c, r) === T.ROAD;
  const dashes = [];
  for (const [c, r] of roadTiles) {
    if (r === 5 || r === 6) continue;
    const h = isRoad(c - 1, r) && isRoad(c + 1, r) && !isRoad(c, r - 1) && !isRoad(c, r + 1);
    const v = isRoad(c, r - 1) && isRoad(c, r + 1) && !isRoad(c - 1, r) && !isRoad(c + 1, r);
    if (h) dashes.push([(c + 0.5) * TILE, (r + 0.5) * TILE, 0]);
    if (v) dashes.push([(c + 0.5) * TILE, (r + 0.5) * TILE, Math.PI / 2]);
  }
  for (let c = 0; c < COLS; c++) {
    dashes.push([(c + 0.25) * TILE, 5.5 * TILE, 0], [(c + 0.75) * TILE, 5.5 * TILE, 0]);
    dashes.push([(c + 0.25) * TILE, 6.5 * TILE, 0], [(c + 0.75) * TILE, 6.5 * TILE, 0]);
  }
  {
    const geo = new THREE.PlaneGeometry(3.5, 0.35);
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: 0xe8e8e0 }), dashes.length);
    dashes.forEach(([x, z, rot], i) => {
      dummy.position.set(x, 0.05, z);
      dummy.rotation.set(0, rot, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    scene.add(mesh);
  }
  // خط أصفر في نص الكورنيش
  const median = new THREE.Mesh(new THREE.PlaneGeometry(W, 0.5), new THREE.MeshBasicMaterial({ color: 0xf2c230 }));
  median.rotation.x = -Math.PI / 2;
  median.position.set(W / 2, 0.05, 6 * TILE);
  scene.add(median);

  // بردورة أصفر وأسود على الكورنيش
  const st = stripeTex();
  st.repeat.set(W / 4, 1);
  const curb = new THREE.Mesh(new THREE.BoxGeometry(W, 0.35, 0.6), new THREE.MeshLambertMaterial({ map: st }));
  curb.position.set(W / 2, 0.17, 5 * TILE - 0.3);
  scene.add(curb);
  // سور البحر
  const wall = new THREE.Mesh(new THREE.BoxGeometry(W, 1.1, 0.6), new THREE.MeshLambertMaterial({ color: 0xece6da }));
  wall.position.set(W / 2, 0.55, 4 * TILE + 0.3);
  scene.add(wall);

  // نخل وأعمدة نور على الكورنيش
  {
    const n = COLS;
    const trunk = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.25, 0.4, 7, 6),
      new THREE.MeshLambertMaterial({ color: 0x6b4f33 }),
      n,
    );
    const leafGeo = new THREE.ConeGeometry(2.8, 1.6, 7);
    const leaves = new THREE.InstancedMesh(leafGeo, new THREE.MeshLambertMaterial({ color: 0x2f7a3a }), n);
    const pole = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.1, 0.12, 6, 5),
      new THREE.MeshLambertMaterial({ color: 0x222222 }),
      n,
    );
    const lamp = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.35, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0xffd28a, emissive: 0xffc070, emissiveIntensity: 3 }),
      n,
    );
    for (let c = 0; c < n; c++) {
      const x = (c + 0.3) * TILE, z = 4.5 * TILE;
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.position.set(x, 3.5, z);
      dummy.updateMatrix();
      trunk.setMatrixAt(c, dummy.matrix);
      dummy.position.set(x, 7.3, z);
      dummy.rotation.set(Math.PI, rand() * 6, 0);
      dummy.updateMatrix();
      leaves.setMatrixAt(c, dummy.matrix);
      dummy.rotation.set(0, 0, 0);
      dummy.position.set((c + 0.8) * TILE, 3, z + 4);
      dummy.updateMatrix();
      pole.setMatrixAt(c, dummy.matrix);
      dummy.position.set((c + 0.8) * TILE, 6.1, z + 4);
      dummy.updateMatrix();
      lamp.setMatrixAt(c, dummy.matrix);
    }
    scene.add(trunk, leaves, pole, lamp);
  }

  // شجر في الحدائق
  {
    const count = parkTiles.length * 2;
    const trunk = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.3, 0.4, 3, 5),
      new THREE.MeshLambertMaterial({ color: 0x5a4030 }),
      count,
    );
    const crown = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(2.6, 0),
      new THREE.MeshLambertMaterial({ color: 0x2e6b30 }),
      count,
    );
    let i = 0;
    for (const [c, r] of parkTiles) {
      for (let k = 0; k < 2; k++) {
        const x = (c + 0.2 + rand() * 0.6) * TILE, z = (r + 0.2 + rand() * 0.6) * TILE;
        const s = 0.8 + rand() * 0.6;
        dummy.rotation.set(0, rand() * 6, 0);
        dummy.scale.set(s, s, s);
        dummy.position.set(x, 1.5 * s, z);
        dummy.updateMatrix();
        trunk.setMatrixAt(i, dummy.matrix);
        dummy.position.set(x, 4 * s, z);
        dummy.updateMatrix();
        crown.setMatrixAt(i, dummy.matrix);
        i++;
      }
    }
    scene.add(trunk, crown);
  }

  // المباني: InstancedMesh لكل عدد أدوار
  const facade = makeFacadeTextures();
  const FLOOR_H = 3.2;
  const byFloors = new Map();
  for (const [c, r] of buildingTiles) {
    const f = map.height[r * COLS + c];
    if (!byFloors.has(f)) byFloors.set(f, []);
    byFloors.get(f).push([c, r]);
  }
  const palette = [0xffffff, 0xf3e3c3, 0xe8d0b0, 0xd9e2e8, 0xf0d9c8, 0xe4e0d0, 0xcfd8c8, 0xf5efe0];
  const roofMat = new THREE.MeshLambertMaterial({ color: 0x9a8f80 });
  const color = new THREE.Color();
  const tanks = [];
  for (const [floors, tiles] of byFloors) {
    const map1 = facade.map.clone();
    const em1 = facade.emissive.clone();
    for (const t of [map1, em1]) {
      t.repeat.set(0.75, floors / 4);
      t.needsUpdate = true;
    }
    const side = new THREE.MeshLambertMaterial({ map: map1, emissiveMap: em1, emissive: 0xffffff, emissiveIntensity: 0.9 });
    const h = floors * FLOOR_H;
    const geo = new THREE.BoxGeometry(10, h, 10);
    geo.translate(0, h / 2, 0);
    const mesh = new THREE.InstancedMesh(geo, [side, side, roofMat, roofMat, side, side], tiles.length);
    mesh.castShadow = !!quality.shadows;
    mesh.receiveShadow = !!quality.shadows;
    tiles.forEach(([c, r], i) => {
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.position.set((c + 0.5) * TILE, 0, (r + 0.5) * TILE);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, color.setHex(palette[Math.floor(rand() * palette.length)]));
      if (rand() < 0.5) tanks.push([(c + 0.3 + rand() * 0.4) * TILE, h, (r + 0.3 + rand() * 0.4) * TILE]);
    });
    scene.add(mesh);
  }
  // خزانات مية على الأسطح
  {
    const m = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.7, 0.7, 1.4, 8),
      new THREE.MeshLambertMaterial({ color: 0x3a3a3a }),
      tanks.length,
    );
    tanks.forEach(([x, y, z], i) => {
      dummy.rotation.set(0, 0, 0);
      dummy.position.set(x, y + 0.7, z);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    });
    scene.add(m);
  }

  // المركز
  const center = new THREE.Group();
  {
    const cw = (CENTER.c1 - CENTER.c0 + 1) * TILE - 2;
    const cd = (CENTER.r1 - CENTER.r0 + 1) * TILE - 2;
    const cx = ((CENTER.c0 + CENTER.c1 + 1) / 2) * TILE;
    const cz = ((CENTER.r0 + CENTER.r1 + 1) / 2) * TILE;
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(cw, 16, cd),
      new THREE.MeshLambertMaterial({ color: 0xf7f7f2 }),
    );
    body.position.set(cx, 8, cz);
    const band = new THREE.Mesh(
      new THREE.BoxGeometry(cw + 0.4, 1.2, cd + 0.4),
      new THREE.MeshLambertMaterial({ color: 0x0f8f7a, emissive: 0x0a4a40 }),
    );
    band.position.set(cx, 12, cz);
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(26, 6.5),
      new THREE.MeshBasicMaterial({ map: signTex(CONFIG.centerShort, 'للطب النفسي وعلاج الإدمان') }),
    );
    sign.position.set(cx, 6.5, cz + cd / 2 + 0.3);
    const gate = new THREE.Mesh(
      new THREE.BoxGeometry(8, 4, 0.5),
      new THREE.MeshLambertMaterial({ color: 0x2a3340 }),
    );
    gate.position.set(cx, 2, cz + cd / 2 + 0.3);
    center.add(body, band, sign, gate);
    // شجر قدام المركز
    for (const dx of [-14, 14]) {
      const t = new THREE.Mesh(new THREE.IcosahedronGeometry(2.2, 0), new THREE.MeshLambertMaterial({ color: 0x2e7a40 }));
      t.position.set(cx + dx, 3, cz + cd / 2 - 1.5);
      center.add(t);
    }
  }
  scene.add(center);

  // لافتات أسماء الأحياء على الكورنيش
  for (const d of DISTRICTS) {
    const tex = canvasTex(512, 128, (g, w, h) => {
      g.fillStyle = '#123a6b';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#fff';
      g.direction = 'rtl';
      g.textAlign = 'center';
      g.font = 'bold 60px Cairo, Tahoma, sans-serif';
      g.fillText(d.name, w / 2, 85);
    });
    const col = MAIN_V.find((v) => v >= d.c0 && v <= d.c1) ?? d.c0;
    const s = new THREE.Mesh(new THREE.PlaneGeometry(9, 2.25), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
    s.position.set((col + 0.5) * TILE, 6.5, 7 * TILE + 0.5);
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 6, 5), new THREE.MeshLambertMaterial({ color: 0x333333 }));
    p.position.set((col + 0.5) * TILE, 3, 7 * TILE + 0.5);
    scene.add(s, p);
  }

  // قلعة قايتباي (رمزية) في الغرب على البحر
  {
    const fort = new THREE.Group();
    const m = new THREE.MeshLambertMaterial({ color: 0xd8c39a });
    const base = new THREE.Mesh(new THREE.BoxGeometry(40, 10, 30), m);
    base.position.y = 5;
    const keep = new THREE.Mesh(new THREE.BoxGeometry(16, 10, 16), m);
    keep.position.y = 15;
    fort.add(base, keep);
    for (const [x, z] of [[-20, -15], [20, -15], [-20, 15], [20, 15]]) {
      const t = new THREE.Mesh(new THREE.CylinderGeometry(3.5, 4, 13, 10), m);
      t.position.set(x, 6.5, z);
      fort.add(t);
    }
    fort.position.set(-60, 0, -10);
    scene.add(fort);
  }

  buildCorniche(scene, rand);

  return {
    sky,
    sea,
    hemi,
    sun,
    sunDir: SUN_DIR,
    // الشمس بتمشي ورا اللاعب عشان الظل يفضل حواليه
    follow,
    update(t, camPos) {
      sky.position.copy(camPos);
      timeU.value = t;
    },
  };
}

// علامة الهدف: عمود نور + حلقة
export function makeMarker(color) {
  const g = new THREE.Group();
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(3, 3, 60, 24, 1, true),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  beam.position.y = 30;
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(3.6, 4.4, 32),
    new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.1;
  g.add(beam, ring);
  g.userData.ring = ring;
  g.userData.beam = beam;
  return g;
}

export function makePerson(shirt) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.4, 1.2, 8), new THREE.MeshLambertMaterial({ color: shirt }));
  body.position.y = 1.2;
  const legs = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.8, 8), new THREE.MeshLambertMaterial({ color: 0x2b3245 }));
  legs.position.y = 0.4;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), new THREE.MeshLambertMaterial({ color: 0xc89a74 }));
  head.position.y = 2.05;
  g.add(body, legs, head);
  return g;
}

// كراسي وعربيات درة مشوي على الكورنيش
function buildCorniche(scene, rand) {
  const z = 4 * TILE;
  const benchMat = new THREE.MeshStandardMaterial({ color: 0x5a3b22, roughness: 0.8 });
  const n = Math.floor(COLS / 2);
  const bench = new THREE.InstancedMesh(new THREE.BoxGeometry(2.2, 0.5, 0.6).translate(0, 0.45, 0), benchMat, n);
  const back = new THREE.InstancedMesh(new THREE.BoxGeometry(2.2, 0.6, 0.12).translate(0, 0.95, -0.25), benchMat, n);
  const d = new THREE.Object3D();
  for (let i = 0; i < n; i++) {
    d.position.set((i * 2 + 1.5) * TILE, 0, z + 2.2);
    d.updateMatrix();
    bench.setMatrixAt(i, d.matrix);
    back.setMatrixAt(i, d.matrix);
  }
  bench.castShadow = back.castShadow = true;
  scene.add(bench, back);

  const cartMat = new THREE.MeshStandardMaterial({ color: 0x2f6fa8, roughness: 0.6 });
  const coal = new THREE.MeshStandardMaterial({ color: 0x331100, emissive: 0xff5a10, emissiveIntensity: 2.5 });
  const wheelM = new THREE.MeshStandardMaterial({ color: 0x222222 });
  const umbM = new THREE.MeshStandardMaterial({ color: 0xd43a2a, roughness: 0.7, side: THREE.DoubleSide });
  for (let c = 3; c < COLS; c += 7 + Math.floor(rand() * 5)) {
    const g = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.8, 0.8), cartMat);
    box.position.y = 0.9;
    const fire = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.1, 0.5), coal);
    fire.position.y = 1.35;
    const umb = new THREE.Mesh(new THREE.ConeGeometry(1.4, 0.5, 8, 1, true), umbM);
    umb.position.y = 2.6;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.4), wheelM);
    pole.position.y = 1.9;
    g.add(box, fire, umb, pole);
    for (const s of [1, -1]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.08, 10).rotateX(Math.PI / 2), wheelM);
      w.position.set(0, 0.3, s * 0.45);
      g.add(w);
    }
    g.position.set((c + 0.5) * TILE, 0, z + 7.5);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    scene.add(g);
  }
}
