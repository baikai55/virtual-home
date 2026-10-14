import * as THREE from 'three';
import { createMaterials } from './materials.js';
import { box, cylinder, createFurniture } from './furniture.js';
import { roomPolygon, polygonBounds, wallLength, wallPoint, radians } from './plan.js';

function floorMesh(room, material) {
  const polygon = roomPolygon(room);
  const shape = new THREE.Shape();
  polygon.forEach(([x, y], index) => index ? shape.lineTo(x, y) : shape.moveTo(x, y));
  shape.closePath();
  const geometry = new THREE.ShapeGeometry(shape);
  geometry.rotateX(-Math.PI / 2);
  const position = geometry.attributes.position;
  const uv = geometry.attributes.uv;
  for (let i = 0; i < position.count; i++) uv.setXY(i, position.getX(i), -position.getZ(i));
  uv.needsUpdate = true;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = .017; mesh.receiveShadow = true; return mesh;
}

function wallBox(group, wall, from, to, bottom, top, material) {
  const mid = wallPoint(wall, (from + to) / 2);
  const horizontal = wall.y1 === wall.y2;
  return box(group, horizontal ? to - from : wall.thickness, top - bottom, horizontal ? wall.thickness : to - from, mid.x, (bottom + top) / 2, -mid.y, material);
}

function addWallCollider(colliders, wall, from, to, id) {
  if (to <= from) return;
  const mid = wallPoint(wall, (from + to) / 2);
  colliders.push({ x: mid.x, y: mid.y, w: to - from, d: wall.thickness, rotation: wall.y1 === wall.y2 ? 0 : 90, id });
}

function openingGroup(scene, wall, opening) {
  const mid = wallPoint(wall, opening.offset + opening.width / 2);
  const group = new THREE.Group(); group.position.set(mid.x, opening.sillHeight || 0, -mid.y);
  group.rotation.y = wall.y1 === wall.y2 ? 0 : Math.PI / 2;
  scene.add(group); return group;
}

export function buildHouse(scene, plan) {
  const m = createMaterials();
  const colliders = [];
  const roomLights = [];
  const wallsGroup = new THREE.Group(); wallsGroup.name = 'architecture'; scene.add(wallsGroup);
  const architectureMaterials = [m.wall, m.ceiling, m.trim, m.frame, m.rail, m.glass, m.frosted];
  const cutPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), .95);
  // 本地裁剪仅影响主视图，clipShadows=false 保留原始墙与屋顶遮挡。
  for (const material of architectureMaterials) material.clipShadows = false;

  for (const room of plan.rooms) {
    const floor = floorMesh(room, m.floors[room.floor]); scene.add(floor);
    const slab = floor.clone(); slab.material = m.slab; slab.position.y = -.08; scene.add(slab);
    const ceiling = floorMesh(room, m.ceiling); ceiling.position.y = plan.settings.wallHeight; ceiling.castShadow = true; ceiling.receiveShadow = false; scene.add(ceiling);
    if (!room.outdoor) {
      const bounds = polygonBounds(roomPolygon(room));
      let x = (bounds.minX + bounds.maxX) / 2;
      let y = (bounds.minY + bounds.maxY) / 2;
      if (room.id === 'hall') { x = 4.3; y = 5.8; }
      const fixture = new THREE.Group(); fixture.position.set(x, plan.settings.wallHeight - .085, -y); scene.add(fixture);
      cylinder(fixture, room.id === 'living' ? .26 : .15, .04, 0, 0, 0, m.trim);
      const diffuser = cylinder(fixture, room.id === 'living' ? .24 : .135, .018, 0, -.028, 0, m.lamp); diffuser.castShadow = false;
      const light = new THREE.PointLight('#ffeac6', 0, 6, 2);
      light.position.set(x, plan.settings.wallHeight - .22, -y); light.castShadow = false; scene.add(light);
      roomLights.push({ light, fixture, baseIntensity: room.id === 'living' ? 28 : 18 });
    }
  }

  for (const wall of plan.walls) {
    const length = wallLength(wall);
    const height = wall.height || plan.settings.wallHeight;
    if (wall.railing) {
      wallBox(wallsGroup, wall, 0, length, 0, .16, m.wall);
      const middle = wallPoint(wall, length / 2);
      const group = new THREE.Group(); group.position.set(middle.x, 0, -middle.y); group.rotation.y = wall.y1 === wall.y2 ? 0 : Math.PI / 2; wallsGroup.add(group);
      box(group, length, .055, .055, 0, height, 0, m.rail);
      box(group, length, .027, .038, 0, .36, 0, m.rail);
      const posts = Math.ceil(length / .16);
      for (let i = 0; i <= posts; i++) box(group, .019, height - .18, .019, -length / 2 + length * i / posts, (height + .18) / 2, 0, m.rail);
      addWallCollider(colliders, wall, 0, length, wall.id); continue;
    }
    const openings = [...plan.doors, ...plan.windows].filter(opening => opening.wallId === wall.id);
    const cuts = [...new Set([0, length, ...openings.flatMap(opening => [opening.offset, opening.offset + opening.width])])].sort((a, b) => a - b);
    for (let i = 0; i < cuts.length - 1; i++) {
      const from = cuts[i], to = cuts[i + 1], middle = (from + to) / 2;
      const opening = openings.find(item => middle > item.offset && middle < item.offset + item.width);
      if (opening) {
        const bottom = opening.sillHeight || 0;
        if (bottom > 0) { wallBox(wallsGroup, wall, from, to, 0, bottom, m.wall); addWallCollider(colliders, wall, from, to, wall.id); }
        const top = bottom + opening.height;
        if (height > top) wallBox(wallsGroup, wall, from, to, top, height, m.wall);
        if (opening.closed) addWallCollider(colliders, wall, from, to, opening.id);
      } else {
        wallBox(wallsGroup, wall, from, to, 0, height, m.wall);
        addWallCollider(colliders, wall, from, to, wall.id);
        const trimWall = { ...wall, thickness: wall.thickness + .025 };
        wallBox(wallsGroup, trimWall, from, to, 0, .085, m.trim);
      }
    }

    for (const opening of openings) {
      const group = openingGroup(wallsGroup, wall, opening);
      const w = opening.width, h = opening.height;
      const frameWidth = .035;
      for (const x of [-w / 2 + frameWidth / 2, w / 2 - frameWidth / 2]) box(group, frameWidth, h, wall.thickness + .035, x, h / 2, 0, opening.kind === 'open' ? m.trim : m.frame);
      box(group, w, frameWidth, wall.thickness + .035, 0, h - frameWidth / 2, 0, opening.kind === 'open' ? m.trim : m.frame);
      if (opening.closed) {
        box(group, w - .07, h - .045, .055, 0, h / 2, 0, m.walnut);
        box(group, .025, .2, .035, w / 2 - .13, 1.02, .05, m.metal);
      } else if (opening.kind === 'sliding') {
        box(group, w, .022, .12, 0, .025, 0, m.frame);
        const panelWidth = w * (1 - opening.openFraction);
        const panelX = w / 2 - panelWidth / 2;
        box(group, panelWidth - .045, h - .07, .017, panelX, h / 2, 0, m.glass).castShadow = false;
        box(group, .035, h, .06, w / 2 - panelWidth, h / 2, 0, m.frame);
        const from = opening.offset + w - panelWidth;
        addWallCollider(colliders, wall, from, opening.offset + w, opening.id);
        // 叠到固定扇上的第二扇，留出左侧通道。
        box(group, .028, h - .045, .05, panelX, h / 2, .045, m.frame);
      } else if (opening.kind !== 'open') {
        box(group, w, .06, wall.thickness + .14, 0, -.02, 0, m.trim);
        box(group, w - .06, h - .05, .012, 0, h / 2, 0, opening.kind === 'frosted' ? m.frosted : m.glass).castShadow = false;
        const dividers = opening.kind === 'bay' ? 3 : 2;
        for (let i = 1; i < dividers; i++) box(group, .027, h, .038, -w / 2 + w * i / dividers, h / 2, 0, m.frame);
        if (opening.kind === 'bay') box(group, w, .023, .036, 0, h * .6, 0, m.frame);
      }
    }
  }
  createFurniture(scene, plan, m, colliders);
  scene.traverse(object => {
    if (object.isMesh && object.material && !architectureMaterials.includes(object.material)) {
      object.material.clipShadows = false;
      architectureMaterials.push(object.material);
    }
  });

  // 室外只提供地面、北侧道路与天空背景，不虚构周边楼栋高度。
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(800, 800), new THREE.MeshStandardMaterial({ color: '#c1c5b0', roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.position.set(5, -.22, -5); ground.receiveShadow = true; scene.add(ground);
  const street = box(scene, 180, .025, 10, 5, -.19, -28, new THREE.MeshStandardMaterial({ color: '#a5aaa0', roughness: 1 })); street.castShadow = false;
  const sidewalk = box(scene, 180, .03, 2, 5, -.185, -21, m.slab); sidewalk.castShadow = false;

  function setCutaway(enabled) {
    for (const material of architectureMaterials) {
      material.clippingPlanes = enabled ? [cutPlane] : null; material.needsUpdate = true;
    }
    for (const { fixture } of roomLights) fixture.visible = !enabled;
  }
  return { materials: m, colliders, roomLights, setCutaway };
}
