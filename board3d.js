import * as THREE from 'three';

const PITCH = 1.62;
const TILE = 1.5;
const UP = new THREE.Vector3(0, 1, 0);

const ZONE_TOP = [0xc9f2d8, 0xf7edb6, 0xfbd7b6, 0xf6c3c3];
const ZONE_SIDE = [0x74c894, 0xd9bd5c, 0xd79a67, 0xcf8585];

let renderer = null;
let scene = null;
let camera = null;
let boardGroup = null;
let pawns = [];
let activeIndex = 0;
let visible = false;
let rafId = null;
let lastTime = 0;
let ring = null;
let hostEl = null;
let clouds = [];
let intro = { active: false, t: 0, duration: 3.2 };
let introRings = [];
let bolts = [];
let shake = { t: 0, power: 0 };
let snakeModels = {};
let bursts = [];

const camState = {
  mode: 'follow',
  yawOffset: 0,
  azimuth: 0.62,
  elevation: 0.3,
  distance: 22,
  followDist: 7.6,
  followHeight: 4.0
};

const camPos = new THREE.Vector3();
const camLook = new THREE.Vector3();
let camInit = false;

const pointer = { down: false, x: 0, y: 0 };

function tileWorld(tile) {
  if (tile <= 0) {
    const p = tileWorld(1);
    return new THREE.Vector3(p.x, 0, p.z + PITCH * 1.05);
  }
  const z = tile - 1;
  const row = Math.floor(z / 10);
  const inRow = z % 10;
  const col = row % 2 === 0 ? inRow : 9 - inRow;
  return new THREE.Vector3((col - 4.5) * PITCH, 0, (2 - row) * PITCH);
}

function zoneIndex(tile) {
  if (tile <= 12) return 0;
  if (tile <= 25) return 1;
  if (tile <= 37) return 2;
  return 3;
}

function labelTexture(text, sub, bg, fg) {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '700 56px Georgia, serif';
  ctx.fillText(text, size / 2, 60);
  ctx.font = '700 22px Segoe UI, Arial, sans-serif';
  ctx.globalAlpha = 0.75;
  ctx.fillText(sub, size / 2, 100);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function ladderCurve(from, to) {
  const a = tileWorld(from);
  const b = tileWorld(to);
  const dist = a.distanceTo(b);
  a.y = 0.2;
  b.y = 0.2;
  const p1 = a.clone().lerp(b, 0.33);
  p1.y = 0.2 + Math.min(0.5, dist * 0.07);
  const p2 = a.clone().lerp(b, 0.66);
  p2.y = 0.2 + Math.min(0.5, dist * 0.07);
  return new THREE.CatmullRomCurve3([a, p1, p2, b]);
}

function snakeCurve(from, to) {
  const a = tileWorld(from);
  const b = tileWorld(to);
  const dir = b.clone().sub(a).setY(0).normalize();
  const side = new THREE.Vector3(-dir.z, 0, dir.x);
  const pts = [];
  const steps = 10;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const p = a.clone().lerp(b, t);
    p.y = 0.27 + Math.sin(t * Math.PI) * 0.1;
    p.addScaledVector(side, Math.sin(t * Math.PI * 3) * 0.42);
    pts.push(p);
  }
  return new THREE.CatmullRomCurve3(pts);
}

function buildTile(tile, group) {
  const p = tileWorld(tile);
  const zi = zoneIndex(tile);
  const topMat = new THREE.MeshStandardMaterial({ color: ZONE_TOP[zi], roughness: 0.85, metalness: 0.02 });
  const sideMat = new THREE.MeshStandardMaterial({ color: ZONE_SIDE[zi], roughness: 0.95, metalness: 0.02 });

  const geo = new THREE.BoxGeometry(TILE, 0.2, TILE);
  const box = new THREE.Mesh(geo, [sideMat, sideMat, topMat, sideMat, sideMat, sideMat]);
  box.position.set(p.x, 0.1, p.z);
  box.receiveShadow = true;
  box.castShadow = true;
  group.add(box);

  let title = String(tile);
  let sub = '1942';
  if (zi === 1) sub = '1943';
  if (zi === 2) sub = '1944';
  if (zi === 3) sub = '1945';
  if (tile === 1) sub = 'START';
  if (tile === 50) sub = 'MERDEKA';

  const tex = labelTexture(title, sub, '#ffffff', tile === 50 ? '#7f1d1d' : '#2b2118');
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(TILE * 0.86, TILE * 0.86),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.92 })
  );
  plane.rotation.x = -Math.PI / 2;
  plane.position.set(p.x, 0.205, p.z);
  group.add(plane);
}

function buildLadder(from, to, group) {
  const curve = ladderCurve(from, to);
  const a = tileWorld(from);
  const b = tileWorld(to);
  const dir = b.clone().sub(a).setY(0).normalize();
  const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(0.2);

  const railMat = new THREE.MeshStandardMaterial({ color: 0x1c7a3d, roughness: 0.5, metalness: 0.15 });
  const rungMat = new THREE.MeshStandardMaterial({ color: 0xd8b25a, roughness: 0.6, metalness: 0.2 });

  const samples = 40;
  const left = [];
  const right = [];
  for (let i = 0; i <= samples; i++) {
    const p = curve.getPoint(i / samples);
    left.push(p.clone().add(side));
    right.push(p.clone().sub(side));
  }

  [left, right].forEach(pts => {
    const railCurve = new THREE.CatmullRomCurve3(pts);
    const tube = new THREE.Mesh(new THREE.TubeGeometry(railCurve, 64, 0.045, 8, false), railMat);
    tube.castShadow = true;
    group.add(tube);
  });

  const rungCount = Math.max(6, Math.round(curve.getLength() / 0.52));
  for (let i = 1; i < rungCount; i++) {
    const p = curve.getPoint(i / rungCount);
    const l = p.clone().add(side);
    const r = p.clone().sub(side);
    const length = l.distanceTo(r);
    const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, length, 7), rungMat);
    cyl.position.copy(l.clone().add(r).multiplyScalar(0.5));
    cyl.quaternion.setFromUnitVectors(UP, r.clone().sub(l).normalize());
    cyl.castShadow = true;
    group.add(cyl);
  }
}

function buildSnake(from, to, group) {
  const curve = snakeCurve(from, to);
  const mat = new THREE.MeshStandardMaterial({ color: 0xb91c1c, roughness: 0.55, metalness: 0.05 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x5f1010, roughness: 0.6 });

  const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 96, 0.145, 10, false), mat);
  tube.castShadow = true;
  group.add(tube);

  const headPos = curve.getPoint(0);

  const inner = new THREE.Mesh(
    new THREE.SphereGeometry(0.23, 16, 12),
    new THREE.MeshStandardMaterial({ color: 0x2a0505, roughness: 0.9 })
  );
  inner.position.copy(headPos);
  group.add(inner);

  const upperGroup = new THREE.Group();
  upperGroup.position.copy(headPos);
  const upper = new THREE.Mesh(
    new THREE.SphereGeometry(0.29, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2),
    mat
  );
  upper.castShadow = true;
  upperGroup.add(upper);

  const dir = curve.getTangent(0);
  const side = new THREE.Vector3(-dir.z, 0, dir.x).normalize();
  for (const s of [1, -1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), darkMat);
    eye.position.copy(side).multiplyScalar(0.14 * s).addScaledVector(dir, 0.16).add(new THREE.Vector3(0, 0.16, 0));
    upperGroup.add(eye);
  }
  group.add(upperGroup);

  const lower = new THREE.Mesh(
    new THREE.SphereGeometry(0.28, 20, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
    mat
  );
  lower.position.copy(headPos);
  lower.castShadow = true;
  group.add(lower);

  const tail = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 10), mat);
  tail.position.copy(curve.getPoint(1));
  group.add(tail);

  snakeModels[from] = { upperGroup, lower, headPos, bite: null, curve };
}

function buildFinishFlag(group) {
  const p = tileWorld(50);
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.03, 0.03, 1.5, 8),
    new THREE.MeshStandardMaterial({ color: 0x9a9a9a, metalness: 0.6, roughness: 0.4 })
  );
  pole.position.set(p.x, 0.95, p.z);
  pole.castShadow = true;
  group.add(pole);

  const flagGeo = new THREE.PlaneGeometry(0.55, 0.22);
  const red = new THREE.MeshBasicMaterial({ color: 0xdc2626, side: THREE.DoubleSide });
  const white = new THREE.MeshBasicMaterial({ color: 0xf5f5f5, side: THREE.DoubleSide });
  const top = new THREE.Mesh(flagGeo, red);
  top.position.set(p.x + 0.3, 1.6, p.z);
  const bottom = new THREE.Mesh(flagGeo, white);
  bottom.position.set(p.x + 0.3, 1.38, p.z);
  group.add(top, bottom);
}

function makePawn(color) {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    roughness: 0.35,
    metalness: 0.2,
    emissive: new THREE.Color(color),
    emissiveIntensity: 0.05
  });

  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.32, 0.08, 24), mat);
  foot.position.y = 0.04;
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.29, 0.3, 24), mat);
  body.position.y = 0.23;
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.15, 0.16, 20), mat);
  neck.position.y = 0.46;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.155, 24, 16), mat);
  head.position.y = 0.6;

  [foot, body, neck, head].forEach(m => {
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  });

  group.userData.material = mat;
  return group;
}

function pawnSlot(index, count, tile) {
  const base = tileWorld(tile);
  const offsets = [[0, 0], [0.34, 0.34], [-0.34, 0.34], [0, -0.36]];
  const o = offsets[index % offsets.length];
  const scale = tile <= 0 ? 1 : 0.85;
  return new THREE.Vector3(base.x + o[0] * scale, base.y, base.z + o[1] * scale);
}

function skyTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 8;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#2f9ce0');
  grad.addColorStop(0.42, '#62b8ea');
  grad.addColorStop(0.72, '#8fcdf0');
  grad.addColorStop(0.9, '#b6dff4');
  grad.addColorStop(1, '#d6ecf9');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 8, 256);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const BARK_MAT = new THREE.MeshStandardMaterial({ color: 0x6f4a2f, roughness: 0.95 });
const LEAF_MATS = [];

function leafPalette() {
  if (LEAF_MATS.length) return LEAF_MATS;
  const hues = [0.26, 0.28, 0.3, 0.24, 0.32];
  hues.forEach((h, i) => {
    LEAF_MATS.push(new THREE.MeshStandardMaterial({
      color: new THREE.Color().setHSL(h, 0.46, 0.28 + (i % 3) * 0.05),
      roughness: 0.9,
      metalness: 0
    }));
  });
  return LEAF_MATS;
}

function makeBroadleaf(scale, rng) {
  const group = new THREE.Group();
  const palette = leafPalette();
  const trunkH = (1.6 + rng() * 0.9) * scale;

  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08 * scale, 0.2 * scale, trunkH, 9),
    BARK_MAT
  );
  trunk.position.y = trunkH / 2;
  trunk.castShadow = true;
  trunk.receiveShadow = true;
  group.add(trunk);

  for (let b = 0; b < 3; b++) {
    const len = (0.5 + rng() * 0.55) * scale;
    const branch = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03 * scale, 0.07 * scale, len, 6),
      BARK_MAT
    );
    branch.position.y = trunkH * (0.68 + rng() * 0.25);
    branch.rotation.z = (0.45 + rng() * 0.55) * (b % 2 === 0 ? 1 : -1);
    branch.rotation.x = (rng() - 0.5) * 0.9;
    branch.castShadow = true;
    group.add(branch);
  }

  const lobes = 9 + Math.floor(rng() * 4);
  const canopyBase = trunkH + 0.32 * scale;
  for (let i = 0; i < lobes; i++) {
    const angle = (i / lobes) * Math.PI * 2 + rng() * 0.6;
    const spread = (0.2 + rng() * 0.8) * scale;
    const r = (0.42 + rng() * 0.36) * scale;
    const blob = new THREE.Mesh(
      new THREE.SphereGeometry(r, 14, 10),
      palette[Math.floor(rng() * palette.length)]
    );
    blob.position.set(
      Math.cos(angle) * spread,
      canopyBase + (rng() - 0.2) * 0.9 * scale + r * 0.2,
      Math.sin(angle) * spread
    );
    blob.castShadow = true;
    blob.receiveShadow = true;
    group.add(blob);
  }

  return group;
}

function makeConifer(scale, rng) {
  const group = new THREE.Group();
  const palette = leafPalette();
  const mat = palette[1 + Math.floor(rng() * 2)];

  const trunkH = (0.9 + rng() * 0.5) * scale;
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.07 * scale, 0.16 * scale, trunkH, 8),
    BARK_MAT
  );
  trunk.position.y = trunkH / 2;
  trunk.castShadow = true;
  group.add(trunk);

  const layers = 4;
  for (let i = 0; i < layers; i++) {
    const t = i / (layers - 1);
    const r = (1.2 - t * 0.78) * scale;
    const h = (1.3 - t * 0.5) * scale;
    const cone = new THREE.Mesh(new THREE.ConeGeometry(r, h, 12), mat);
    cone.position.y = trunkH + i * 0.6 * scale + h * 0.35;
    cone.castShadow = true;
    cone.receiveShadow = true;
    group.add(cone);
  }

  return group;
}

function makeBush(scale, rng) {
  const group = new THREE.Group();
  const palette = leafPalette();
  const blobs = 7;
  for (let i = 0; i < blobs; i++) {
    const r = (0.32 + rng() * 0.3) * scale;
    const blob = new THREE.Mesh(
      new THREE.SphereGeometry(r, 12, 9),
      palette[Math.floor(rng() * palette.length)]
    );
    blob.position.set(
      (rng() - 0.5) * 1.15 * scale,
      r * 0.55 + rng() * 0.12 * scale,
      (rng() - 0.5) * 1.15 * scale
    );
    blob.castShadow = true;
    blob.receiveShadow = true;
    group.add(blob);
  }
  return group;
}

function makeTree(x, z, scale, rng, type) {
  let group;
  if (type === 'conifer') group = makeConifer(scale, rng);
  else if (type === 'bush') group = makeBush(scale, rng);
  else group = makeBroadleaf(scale, rng);

  group.position.set(x, 0, z);
  group.rotation.y = rng() * Math.PI * 2;
  return group;
}

function buildScenery() {
  let seed = 20250817;
  const rng = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };

  const grass = new THREE.Mesh(
    new THREE.PlaneGeometry(90, 70),
    new THREE.MeshStandardMaterial({ color: 0x74c26a, roughness: 0.95 })
  );
  grass.rotation.x = -Math.PI / 2;
  grass.position.y = -0.06;
  grass.receiveShadow = true;
  scene.add(grass);

  const soil = new THREE.Mesh(
    new THREE.BoxGeometry(19.5, 0.42, 11.5),
    new THREE.MeshStandardMaterial({ color: 0x9c7448, roughness: 0.9 })
  );
  soil.position.y = -0.2;
  soil.receiveShadow = true;
  scene.add(soil);

  let placed = 0;
  let guard = 0;
  while (placed < 58 && guard < 4000) {
    guard++;
    const x = (rng() - 0.5) * 46;
    const z = (rng() - 0.5) * 34;
    if (Math.abs(x) < 11.5 && Math.abs(z) < 7.4) continue;
    const dist = Math.hypot(x, z);
    if (dist < 11) continue;

    const roll = rng();
    const type = roll < 0.2 ? 'conifer' : roll < 0.34 ? 'bush' : 'broadleaf';
    const baseScale = type === 'bush' ? 0.6 : 0.8;
    const scale = baseScale + rng() * 0.65 + Math.max(0, (dist - 14) * 0.025);
    scene.add(makeTree(x, z, scale, rng, type));
    placed++;
  }
}

function makeCloud(rng, scale) {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color: 0xfdfeff,
    roughness: 1,
    metalness: 0,
    flatShading: false
  });

  const puffs = 6 + Math.floor(rng() * 4);
  for (let i = 0; i < puffs; i++) {
    const r = (1.0 + rng() * 1.0) * scale;
    const puff = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 10), mat);
    puff.position.set(
      (rng() - 0.5) * 5.5 * scale,
      (rng() - 0.3) * 1.3 * scale,
      (rng() - 0.5) * 2.4 * scale
    );
    puff.castShadow = false;
    group.add(puff);
  }
  return group;
}

function buildClouds() {
  let seed = 77123;
  const rng = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };

  const count = 20;
  for (let i = 0; i < count; i++) {
    const scale = 1.1 + rng() * 1.1;
    const cloud = makeCloud(rng, scale);
    const angle = (i / count) * Math.PI * 2 + rng() * 0.5;
    const radius = 48 + rng() * 30;
    cloud.position.set(
      Math.sin(angle) * radius,
      8 + rng() * 5,
      Math.cos(angle) * radius
    );
    cloud.userData.speed = 0.5 + rng() * 0.8;
    cloud.userData.radius = radius;
    scene.add(cloud);
    clouds.push(cloud);
  }
}

function buildScene() {
  scene = new THREE.Scene();
  scene.background = skyTexture();
  scene.fog = new THREE.Fog(0xcde7f6, 95, 230);

  camera = new THREE.PerspectiveCamera(46, 1, 0.1, 240);
  camera.position.set(0, 14, 16);

  const hemi = new THREE.HemisphereLight(0xdff1ff, 0x4b7a3a, 1.55);
  scene.add(hemi);

  const dir = new THREE.DirectionalLight(0xfff7e2, 2.0);
  dir.position.set(12, 20, 9);
  dir.castShadow = true;
  dir.shadow.mapSize.set(2048, 2048);
  dir.shadow.camera.left = -18;
  dir.shadow.camera.right = 18;
  dir.shadow.camera.top = 18;
  dir.shadow.camera.bottom = -18;
  dir.shadow.camera.near = 1;
  dir.shadow.camera.far = 60;
  dir.shadow.bias = -0.0008;
  scene.add(dir);

  const fill = new THREE.DirectionalLight(0xcfe6ff, 0.45);
  fill.position.set(-14, 9, -10);
  scene.add(fill);

  buildScenery();
  buildClouds();

  boardGroup = new THREE.Group();
  scene.add(boardGroup);

  const deck = new THREE.Mesh(
    new THREE.BoxGeometry(17.2, 0.12, 9.1),
    new THREE.MeshStandardMaterial({ color: 0x8a6a45, roughness: 0.9 })
  );
  deck.position.set(0, 0.04, 0);
  deck.receiveShadow = true;
  boardGroup.add(deck);

  for (let t = 1; t <= 50; t++) buildTile(t, boardGroup);

  if (window.GAME_LADDERS) {
    Object.entries(window.GAME_LADDERS).forEach(([from, data]) => buildLadder(Number(from), data.to, boardGroup));
  }
  if (window.GAME_SNAKES) {
    Object.entries(window.GAME_SNAKES).forEach(([from, data]) => buildSnake(Number(from), data.to, boardGroup));
  }
  buildFinishFlag(boardGroup);

  const ringGeo = new THREE.RingGeometry(0.56, 0.7, 48);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0xfbbf24,
    transparent: true,
    opacity: 0.85,
    side: THREE.DoubleSide
  });
  ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.215;
  ring.visible = false;
  scene.add(ring);
}

function resize() {
  if (!renderer || !hostEl) return;
  const w = hostEl.clientWidth;
  const h = hostEl.clientHeight;
  if (w === 0 || h === 0) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

function headingForTile(tile) {
  const a = tileWorld(Math.max(0, tile));
  const b = tileWorld(Math.min(50, Math.max(0, tile) + 1));
  const d = b.clone().sub(a).setY(0);
  if (d.lengthSq() < 0.0001) return new THREE.Vector3(0, 0, -1);
  return d.normalize();
}

function ensurePawns(players) {
  if (!players) return;
  if (pawns.length !== players.length) {
    pawns.forEach(p => {
      scene.remove(p.mesh);
      p.mesh.traverse(o => {
        if (o.geometry) o.geometry.dispose();
      });
    });
    pawns = players.map((pl, i) => {
      const mesh = makePawn(pl.color);
      const slot = pawnSlot(i, players.length, pl.position);
      mesh.position.copy(slot);
      scene.add(mesh);
      return {
        mesh,
        targetTile: pl.position,
        lastTile: pl.position,
        count: players.length,
        heading: headingForTile(pl.position),
        traverse: null,
        hop: 0
      };
    });
  }
}

function sync(players, currentIndex) {
  if (!renderer || !players) return;
  ensurePawns(players);
  activeIndex = currentIndex || 0;

  players.forEach((pl, i) => {
    const pawn = pawns[i];
    if (!pawn) return;
    if (pawn.targetTile !== pl.position) {
      pawn.targetTile = pl.position;
    }
    if (!pawn.traverse) {
      pawn.heading.copy(headingForTile(pawn.targetTile));
    }
    const isActive = i === activeIndex;
    pawn.mesh.userData.material.emissiveIntensity = isActive ? 0.3 : 0.05;
    pawn.mesh.scale.setScalar(isActive ? 1.08 : 1);
  });
}

function setPlayers(players, currentIndex) {
  if (!renderer || !players) return;
  pawns = [];
  ensurePawns(players);
  sync(players, currentIndex);
  const active = pawns[currentIndex || 0];
  if (active && ring) {
    const p = tileWorld(active.targetTile);
    ring.position.set(p.x, 0.215, p.z);
    ring.visible = true;
  }
}

function animateTraversal(index, fromTile, toTile, type) {
  if (!renderer || !visible) return Promise.resolve();
  const pawn = pawns[index];
  if (!pawn) return Promise.resolve();

  const curve = type === 'ladder' ? ladderCurve(fromTile, toTile) : snakeCurve(fromTile, toTile);
  const dir = tileWorld(toTile).clone().sub(tileWorld(fromTile)).setY(0);
  if (dir.lengthSq() > 0.0001) pawn.heading.copy(dir.normalize());
  pawn.targetTile = toTile;

  if (type === 'snake') {
    triggerBite(fromTile);
    const model = snakeModels[fromTile];
    return new Promise(resolve => {
      pawn.traverse = {
        curve,
        t: 0,
        duration: 1900,
        type,
        resolve,
        startPos: pawn.mesh.position.clone(),
        headPos: model ? model.headPos.clone() : curve.getPoint(0)
      };
    });
  }

  return new Promise(resolve => {
    pawn.traverse = {
      curve,
      t: 0,
      duration: 1400,
      type,
      resolve
    };
  });
}

function updatePawn(pawn, index, dt) {
  const mesh = pawn.mesh;

  if (pawn.traverse) {
    const tr = pawn.traverse;
    tr.t += dt * 1000 / tr.duration;
    const t = Math.min(1, tr.t);

    if (tr.type === 'snake') {
      const tangent = tr.curve.getTangent(Math.min(0.999, t));
      if (t < 0.22) {
        const k = t / 0.22;
        mesh.position.lerpVectors(tr.startPos, tr.headPos, k);
        mesh.scale.setScalar(1 - 0.94 * k);
      } else if (t < 0.8) {
        const k = (t - 0.22) / 0.58;
        mesh.position.copy(tr.curve.getPoint(k));
        mesh.scale.setScalar(0.06);
      } else {
        const k = (t - 0.8) / 0.2;
        mesh.position.copy(tr.curve.getPoint(1));
        mesh.position.y += Math.sin(k * Math.PI) * 0.3;
        mesh.scale.setScalar(0.06 + 0.94 * k);
      }
      if (tangent.lengthSq() > 0.0001) {
        mesh.rotation.y = Math.atan2(tangent.x, tangent.z);
      }
    } else {
      const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const point = tr.curve.getPoint(Math.min(0.999, eased));
      mesh.position.copy(point);

      const tangent = tr.curve.getTangent(Math.min(0.999, eased));
      if (tangent.lengthSq() > 0.0001) {
        mesh.rotation.y = Math.atan2(tangent.x, tangent.z);
      }
    }

    if (t >= 1) {
      const finished = tr.resolve;
      pawn.traverse = null;
      mesh.rotation.y = 0;
      mesh.scale.setScalar(1);
      mesh.position.copy(pawnSlot(index, pawn.count, pawn.targetTile));
      finished();
    }
    return;
  }

  const target = pawnSlot(index, pawn.count, pawn.targetTile);
  const dist = mesh.position.distanceTo(target);

  if (dist > 0.012) {
    const k = 1 - Math.exp(-dt * 11);
    mesh.position.lerp(target, k);
    const lift = Math.min(1, dist / 1.4);
    pawn.hop = Math.sin(lift * Math.PI * 0.5) * 0.26;
    const heading = pawn.heading;
    mesh.rotation.y = Math.atan2(heading.x, heading.z);
  } else {
    mesh.position.copy(target);
    pawn.hop *= Math.max(0, 1 - dt * 10);
  }

  mesh.position.y = target.y + pawn.hop;
}

function updateRing(dt) {
  const pawn = pawns[activeIndex];
  if (!pawn || !ring) return;
  const base = tileWorld(pawn.targetTile);
  ring.position.set(base.x, 0.215, base.z);
  ring.visible = true;
  ring.rotation.z += dt * 0.7;
  const pulse = 1 + Math.sin(performance.now() * 0.003) * 0.06;
  ring.scale.setScalar(pulse);
}

function updateClouds(dt) {
  clouds.forEach(cloud => {
    cloud.position.x += cloud.userData.speed * dt;
    if (cloud.position.x > 86) cloud.position.x = -86;
    cloud.position.y += Math.sin(performance.now() * 0.0004 + cloud.userData.radius) * dt * 0.06;
  });
}

function easeOutCubic(x) {
  return 1 - Math.pow(1 - x, 3);
}

function easeInOutCubic(x) {
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

function playIntro() {
  if (!renderer) return;
  intro.active = true;
  intro.t = 0;
  camInit = false;

  if (boardGroup) {
    boardGroup.position.y = -1.6;
    boardGroup.scale.setScalar(0.92);
    boardGroup.rotation.y = -0.45;
  }

  introRings.forEach(r => {
    scene.remove(r.mesh);
    r.mesh.geometry.dispose();
    r.mesh.material.dispose();
  });
  introRings = [];

  for (let i = 0; i < 3; i++) {
    const geo = new THREE.RingGeometry(1, 1.18, 64);
    const mat = new THREE.MeshBasicMaterial({
      color: i === 1 ? 0xfff1b8 : 0xfbbf24,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.5;
    scene.add(mesh);
    introRings.push({ mesh, delay: i * 0.22, t: 0 });
  }
}

function updateIntro(dt) {
  const riseT = Math.min(1, intro.t / 0.5);
  const rise = easeOutCubic(riseT);
  if (boardGroup) {
    boardGroup.position.y = -1.6 * (1 - rise);
    boardGroup.scale.setScalar(0.92 + 0.08 * rise);
    boardGroup.rotation.y = -0.45 * (1 - rise);
  }

  introRings.forEach(r => {
    r.t += dt;
    const local = Math.max(0, r.t - r.delay);
    const life = 1.4;
    const p = Math.min(1, local / life);
    r.mesh.scale.setScalar(0.5 + p * 11);
    r.mesh.material.opacity = local <= 0 ? 0 : 0.85 * (1 - p);
  });
}

function strikeLightning(index) {
  if (!renderer || !scene || !visible) return;
  const pawn = pawns[index] || pawns[activeIndex];
  const target = new THREE.Vector3(
    pawn ? pawn.mesh.position.x : 0,
    0.3,
    pawn ? pawn.mesh.position.z : 0
  );

  const top = target.clone().add(new THREE.Vector3((Math.random() - 0.5) * 9, 28, (Math.random() - 0.5) * 9));
  const points = [];
  const segs = 16;
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const p = top.clone().lerp(target, t);
    const jitter = (1 - t * 0.4) * 2.8;
    p.x += (Math.random() - 0.5) * jitter;
    p.z += (Math.random() - 0.5) * jitter;
    points.push(p);
  }

  const curve = new THREE.CatmullRomCurve3(points);
  const group = new THREE.Group();
  const coreMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1 });
  const glowMat = new THREE.MeshBasicMaterial({ color: 0x9edeff, transparent: true, opacity: 0.55 });

  group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 90, 0.2, 6, false), coreMat));
  group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 90, 0.62, 8, false), glowMat));

  const impactMat = new THREE.MeshBasicMaterial({ color: 0xdff4ff, transparent: true, opacity: 0.9 });
  const impact = new THREE.Mesh(new THREE.SphereGeometry(0.55, 16, 12), impactMat);
  impact.position.copy(target);
  group.add(impact);

  for (let b = 0; b < 3; b++) {
    const startT = 0.2 + Math.random() * 0.5;
    const start = curve.getPoint(startT);
    const dir = new THREE.Vector3(Math.random() - 0.5, -0.7 - Math.random() * 0.5, Math.random() - 0.5).normalize();
    const end = start.clone().addScaledVector(dir, 3 + Math.random() * 3);
    const mid = start.clone().lerp(end, 0.5).add(new THREE.Vector3((Math.random() - 0.5) * 1.4, 0, (Math.random() - 0.5) * 1.4));
    const branchCurve = new THREE.CatmullRomCurve3([start, mid, end]);
    group.add(new THREE.Mesh(new THREE.TubeGeometry(branchCurve, 20, 0.09, 5, false), coreMat));
  }

  scene.add(group);

  const light = new THREE.PointLight(0xbfe9ff, 0, 55, 2);
  light.position.copy(target).add(new THREE.Vector3(0, 6, 0));
  scene.add(light);

  const flash = new THREE.AmbientLight(0xcbeaff, 0);
  scene.add(flash);

  bolts.push({ group, mats: [coreMat, glowMat, impactMat], light, flash, t: 0, life: 0.7 });
  shake.t = 0;
  shake.power = 0.4;
}

function updateBolts(dt) {
  for (let i = bolts.length - 1; i >= 0; i--) {
    const b = bolts[i];
    b.t += dt;
    const p = b.t / b.life;
    const fade = Math.max(0, 1 - p);
    b.mats[0].opacity = fade;
    b.mats[1].opacity = 0.55 * fade;
    if (b.mats[2]) b.mats[2].opacity = 0.9 * fade;
    const flicker = p < 0.2 ? (Math.random() > 0.35 ? 1 : 0.15) : 1;
    b.light.intensity = 70 * fade * flicker;
    if (b.flash) b.flash.intensity = 1.6 * Math.pow(fade, 3) * flicker;

    if (b.t >= b.life) {
      scene.remove(b.group);
      b.group.traverse(o => {
        if (o.geometry) o.geometry.dispose();
      });
      b.mats.forEach(m => m.dispose());
      scene.remove(b.light);
      if (b.flash) scene.remove(b.flash);
      bolts.splice(i, 1);
    }
  }
}

function applyShake(dt) {
  if (shake.power <= 0.001) return;
  shake.t += dt;
  const k = Math.max(0, 1 - shake.t / 0.45);
  const p = shake.power * k * k;
  camera.position.x += (Math.random() - 0.5) * p;
  camera.position.y += (Math.random() - 0.5) * p;
  camera.position.z += (Math.random() - 0.5) * p;
  if (k <= 0) shake.power = 0;
}

function triggerBite(fromTile) {
  const model = snakeModels[fromTile];
  if (!model) return;
  model.bite = 0;
  spawnBurst(model.headPos, 0xff6b5e);
}

function updateSnakeModels(dt) {
  Object.keys(snakeModels).forEach(key => {
    const model = snakeModels[key];
    if (model.bite == null) return;
    model.bite += dt;
    const p = Math.min(1, model.bite / 0.75);
    const open = Math.sin(p * Math.PI);
    model.upperGroup.rotation.x = -open * 0.55;
    model.lower.rotation.x = open * 0.95;
    const s = 1 + open * 0.3;
    model.upperGroup.scale.setScalar(s);
    model.lower.scale.setScalar(s);
    if (p >= 1) {
      model.upperGroup.rotation.x = 0;
      model.lower.rotation.x = 0;
      model.upperGroup.scale.setScalar(1);
      model.lower.scale.setScalar(1);
      model.bite = null;
    }
  });
}

function spawnBurst(pos, color) {
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.9,
    side: THREE.DoubleSide
  });
  const mesh = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.46, 40), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.copy(pos);
  mesh.position.y += 0.12;
  scene.add(mesh);
  bursts.push({ mesh, mat, t: 0, life: 0.55 });
}

function updateBursts(dt) {
  for (let i = bursts.length - 1; i >= 0; i--) {
    const b = bursts[i];
    b.t += dt;
    const p = Math.min(1, b.t / b.life);
    b.mesh.scale.setScalar(1 + p * 4);
    b.mat.opacity = 0.9 * (1 - p);
    if (p >= 1) {
      scene.remove(b.mesh);
      b.mesh.geometry.dispose();
      b.mat.dispose();
      bursts.splice(i, 1);
    }
  }
}

function updateCamera(dt) {
  const desiredPos = new THREE.Vector3();
  const desiredLook = new THREE.Vector3();
  const pawn = pawns[activeIndex];
  const traversing = Boolean(pawn && pawn.traverse);
  const snakeTraverse = Boolean(pawn && pawn.traverse && pawn.traverse.type === 'snake');

  if (camState.mode === 'overview' || !pawn) {
    const az = camState.azimuth;
    const el = camState.elevation;
    const d = camState.distance;
    desiredPos.set(Math.sin(az) * Math.cos(el) * d, Math.sin(el) * d, Math.cos(az) * Math.cos(el) * d);
    desiredLook.set(0, 4, 0);
  } else {
    const p = pawn.mesh.position;
    const dir = pawn.heading.clone().setY(0);
    if (dir.lengthSq() < 0.0001) dir.set(0, 0, -1);
    dir.normalize().applyAxisAngle(UP, camState.yawOffset);

    const dist = traversing ? (snakeTraverse ? 9.5 : 6.2) : camState.followDist;
    const height = traversing ? (snakeTraverse ? 6.2 : 3.6) : camState.followHeight;
    desiredPos.copy(p).addScaledVector(dir, -dist);
    desiredPos.y += height;

    desiredLook.copy(p).addScaledVector(dir, traversing ? 1.3 : 2.2);
    desiredLook.y += traversing ? (snakeTraverse ? 1.1 : 0.6) : 2.2;
  }

  if (intro.active) {
    const e = easeInOutCubic(Math.min(1, intro.t));
    const heroPos = new THREE.Vector3(0, 34, 30);
    const heroLook = new THREE.Vector3(0, 0.5, -2);
    desiredPos.lerpVectors(heroPos, desiredPos, e);
    desiredLook.lerpVectors(heroLook, desiredLook, e);
    camPos.copy(desiredPos);
    camLook.copy(desiredLook);
    camInit = true;
    camera.position.copy(camPos);
    applyShake(dt);
    camera.lookAt(camLook);
    return;
  }

  if (!camInit) {
    camPos.copy(desiredPos);
    camLook.copy(desiredLook);
    camInit = true;
  }

  camPos.lerp(desiredPos, 1 - Math.exp(-dt * (traversing ? 6.5 : 4.2)));
  camLook.lerp(desiredLook, 1 - Math.exp(-dt * (traversing ? 7.5 : 5.5)));
  camera.position.copy(camPos);
  applyShake(dt);
  camera.lookAt(camLook);
}

function loop(now) {
  rafId = requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - lastTime) / 1000 || 0.016);
  lastTime = now;

  if (intro.active) {
    intro.t += dt / intro.duration;
    updateIntro(dt);
    if (intro.t >= 1) {
      intro.t = 1;
      intro.active = false;
      if (boardGroup) {
        boardGroup.position.y = 0;
        boardGroup.rotation.y = 0;
        boardGroup.scale.setScalar(1);
      }
    }
  }

  updateClouds(dt);
  updateBolts(dt);
  updateSnakeModels(dt);
  updateBursts(dt);
  pawns.forEach((pawn, i) => updatePawn(pawn, i, dt));
  updateRing(dt);
  updateCamera(dt);
  renderer.render(scene, camera);
}

function start() {
  if (rafId !== null || !renderer) return;
  lastTime = performance.now();
  rafId = requestAnimationFrame(loop);
}

function stop() {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
}

function setVisible(on) {
  visible = on;
  if (!renderer) return;
  if (on) {
    resize();
    start();
  } else {
    stop();
  }
}

function setMode(mode) {
  camState.mode = mode === 'overview' ? 'overview' : 'follow';
  const btns = hostEl ? hostEl.querySelectorAll('[data-cam]') : [];
  btns.forEach(b => b.classList.toggle('active', b.dataset.cam === camState.mode));
}

function bindPointer(canvas) {
  canvas.addEventListener('pointerdown', e => {
    pointer.down = true;
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener('pointermove', e => {
    if (!pointer.down) return;
    const dx = e.clientX - pointer.x;
    const dy = e.clientY - pointer.y;
    pointer.x = e.clientX;
    pointer.y = e.clientY;

    if (camState.mode === 'overview') {
      camState.azimuth -= dx * 0.006;
      camState.elevation = Math.max(0.18, Math.min(1.35, camState.elevation + dy * 0.004));
    } else {
      camState.yawOffset -= dx * 0.008;
    }
  });

  const release = () => {
    pointer.down = false;
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('pointerleave', release);

  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    if (camState.mode === 'overview') {
      camState.distance = Math.max(10, Math.min(32, camState.distance + e.deltaY * 0.02));
    } else {
      camState.followDist = Math.max(2.2, Math.min(7.5, camState.followDist + e.deltaY * 0.005));
    }
  }, { passive: false });
}

function init() {
  hostEl = document.getElementById('board3dHost');
  if (!hostEl) return false;

  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  } catch (err) {
    return false;
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.touchAction = 'none';
  hostEl.appendChild(renderer.domElement);

  buildScene();
  bindPointer(renderer.domElement);
  resize();

  hostEl.querySelectorAll('[data-cam]').forEach(btn => {
    btn.addEventListener('click', () => setMode(btn.dataset.cam));
  });

  const ro = new ResizeObserver(() => resize());
  ro.observe(hostEl);

  document.body.classList.add('view-3d');
  setVisible(true);
  return true;
}

window.Board3D = {
  init,
  setVisible,
  setMode,
  sync,
  setPlayers,
  animateTraversal,
  playIntro,
  strikeLightning,
  isAvailable: () => Boolean(renderer)
};

init();
