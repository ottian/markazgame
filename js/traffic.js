import { TILE } from './map.js';
import { makeRandomTraffic } from './vehicles.js';

// كل طريق رئيسي فيه حارتين (السواقة يمين زي مصر)
function buildLanes(roads) {
  const lanes = [];
  for (const rd of roads) {
    const from = rd.a * TILE + 2, to = (rd.b + 1) * TILE - 2;
    if (rd.dir === 'h') {
      if (rd.line === 5) lanes.push({ axis: 'x', fixed: 5.5 * TILE, from, to, dir: -1 });
      else if (rd.line === 6) lanes.push({ axis: 'x', fixed: 6.5 * TILE, from, to, dir: 1 });
      else {
        const zc = (rd.line + 0.5) * TILE;
        lanes.push({ axis: 'x', fixed: zc + 3, from, to, dir: 1 });
        lanes.push({ axis: 'x', fixed: zc - 3, from, to, dir: -1 });
      }
    } else {
      const xc = (rd.line + 0.5) * TILE;
      lanes.push({ axis: 'z', fixed: xc - 3, from, to, dir: 1 });
      lanes.push({ axis: 'z', fixed: xc + 3, from, to, dir: -1 });
    }
  }
  return lanes;
}

export class Traffic {
  constructor(scene, roads, count = 70) {
    this.lanes = buildLanes(roads);
    this.cars = [];
    const totalLen = this.lanes.reduce((s, l) => s + (l.to - l.from), 0);
    for (let i = 0; i < count; i++) {
      // اختيار حارة بالتناسب مع طولها
      let k = Math.random() * totalLen, lane = this.lanes[0];
      for (const l of this.lanes) {
        k -= l.to - l.from;
        if (k <= 0) { lane = l; break; }
      }
      const mesh = makeRandomTraffic();
      scene.add(mesh);
      const car = {
        lane,
        s: lane.from + Math.random() * (lane.to - lane.from),
        speed: 0,
        max: 9 + Math.random() * 7, // م/ث
        mesh,
        x: 0, z: 0, heading: 0,
        stuck: 0, ghost: 0, bump: 0,
      };
      this.place(car);
      this.cars.push(car);
    }
  }

  place(car) {
    const l = car.lane;
    if (l.axis === 'x') {
      car.x = car.s; car.z = l.fixed;
      car.heading = l.dir > 0 ? 0 : Math.PI;
    } else {
      car.x = l.fixed; car.z = car.s;
      car.heading = l.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    }
    const edge = Math.min(car.s - car.lane.from, car.lane.to - car.s);
    const sc = Math.max(0.01, Math.min(1, edge / 10));
    car.mesh.scale.setScalar(sc);
    car.mesh.position.set(car.x, 0, car.z);
    car.mesh.rotation.y = -car.heading;
  }

  update(dt, player) {
    const cars = this.cars;
    for (const c of cars) {
      const fx = Math.cos(c.heading), fz = Math.sin(c.heading);
      let target = c.max;
      if (c.bump > 0) { c.bump -= dt; target = 0; }

      // عربيات قدّام
      if (c.ghost <= 0) {
        for (const o of cars) {
          if (o === c) continue;
          const dx = o.x - c.x, dz = o.z - c.z;
          const ahead = dx * fx + dz * fz;
          if (ahead <= 0 || ahead > 11) continue;
          const lat = Math.abs(-dx * fz + dz * fx);
          if (lat < 2.6) { target = Math.min(target, ahead < 6.5 ? 0 : o.speed); }
        }
      } else c.ghost -= dt;

      // اللاعب قدّام
      {
        const dx = player.x - c.x, dz = player.z - c.z;
        const ahead = dx * fx + dz * fz;
        const lat = Math.abs(-dx * fz + dz * fx);
        if (ahead > 0 && ahead < 13 && lat < 3) target = 0;
        // السارينة: العربيات تهدّي وتفسح
        if (player.siren && dx * dx + dz * dz < 60 * 60) target = Math.min(target, 3);
      }

      if (c.speed < 0.3 && target === 0) {
        c.stuck += dt;
        if (c.stuck > 3.5) { c.ghost = 2; c.stuck = 0; }
      } else c.stuck = 0;

      const acc = target > c.speed ? 4 : 12;
      c.speed += Math.sign(target - c.speed) * Math.min(Math.abs(target - c.speed), acc * dt);
      c.s += c.speed * c.lane.dir * dt;
      if (c.lane.dir > 0 && c.s > c.lane.to) c.s = c.lane.from;
      if (c.lane.dir < 0 && c.s < c.lane.from) c.s = c.lane.to;
      this.place(c);
      for (const w of c.mesh.userData.wheels || []) w.rotation.z -= c.speed * dt / 0.4;
    }
  }
}
