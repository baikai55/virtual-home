import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { artMaterial } from './materials.js';
import { radians } from './plan.js';

const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
const roundGeometry = new RoundedBoxGeometry(1, 1, 1, 2, 0.08);
const cylinderGeometry = new THREE.CylinderGeometry(1, 1, 1, 16);
const sphereGeometry = new THREE.SphereGeometry(1, 12, 8);

export function box(parent, w, h, d, x, y, z, material, rounded = false) {
  const mesh = new THREE.Mesh(rounded ? roundGeometry : boxGeometry, material);
  mesh.scale.set(w, h, d); mesh.position.set(x, y, z);
  mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh);
  return mesh;
}

export function cylinder(parent, radius, h, x, y, z, material) {
  const mesh = new THREE.Mesh(cylinderGeometry, material);
  mesh.scale.set(radius, h, radius); mesh.position.set(x, y, z);
  mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
}

function sphere(parent, rx, ry, rz, x, y, z, material) {
  const mesh = new THREE.Mesh(sphereGeometry, material);
  mesh.scale.set(rx, ry, rz); mesh.position.set(x, y, z); mesh.castShadow = true; parent.add(mesh); return mesh;
}

function legs(group, w, d, height, material, inset = 0.1) {
  for (const x of [-w / 2 + inset, w / 2 - inset]) for (const z of [-d / 2 + inset, d / 2 - inset]) box(group, .04, height, .04, x, height / 2, z, material);
}

function lamp(group, x, z, m) {
  cylinder(group, .045, .018, x, .61, z, m.metal);
  cylinder(group, .016, .21, x, .72, z, m.metal);
  const shade = new THREE.Mesh(new THREE.CylinderGeometry(.1, .14, .16, 14), m.linen);
  shade.position.set(x, .88, z); shade.castShadow = true; group.add(shade);
}

function art(group, w, h, x, y, z, m, palette = 'sage') {
  box(group, w + .045, h + .045, .035, x, y, z, m.oak);
  box(group, w, h, .006, x, y, z + .021, artMaterial(palette));
}

function sofa(group, f, m, single = false) {
  const { w, d } = f;
  legs(group, w, d, .15, m.walnut, .12);
  box(group, w, .28, d, 0, .28, 0, m.fabric, true);
  box(group, w - .1, .54, .18, 0, .68, -d / 2 + .09, m.fabric, true);
  const count = single ? 1 : 3;
  for (let i = 0; i < count; i++) {
    const x = (i - (count - 1) / 2) * (w - .24) / count;
    box(group, (w - .3) / count - .025, .16, d - .25, x, .5, .065, m.fabric, true);
  }
  for (const x of [-w / 2 + .075, w / 2 - .075]) box(group, .15, .36, d, x, .58, 0, m.fabric, true);
  if (!single) {
    box(group, .42, .42, .16, -w * .27, .72, -.17, m.sage, true).rotation.z = -.13;
    box(group, .38, .38, .14, w * .3, .68, -.13, m.sand, true).rotation.z = .17;
    art(group, 1.25, .65, 0, 1.65, -.46, m, 'sage');
  }
}

function bed(group, f, m) {
  const { w, d } = f;
  legs(group, w, d, .16, m.walnut, .09);
  box(group, w + .04, .27, d + .035, 0, .27, 0, m.oak, true);
  box(group, w, .2, d, 0, .48, 0, m.linen, true);
  box(group, w + .08, .96, .095, 0, .55, -d / 2 + .025, m[f.color], true);
  box(group, w - .055, .075, d * .66, 0, .615, d * .15, m[f.color], true);
  box(group, w - .065, .024, .27, 0, .66, d * .17, m.linen);
  for (const x of [-w / 4, w / 4]) box(group, w * .4, .105, .37, x, .625, -d * .31, m.linen, true);
  art(group, .88, .6, 0, 1.61, -d / 2 - .022, m, f.color);
}

function wardrobe(group, f, m) {
  const { w, d } = f;
  box(group, w, 2.36, d, 0, 1.18, 0, m.white);
  box(group, w, .1, d + .02, 0, .06, 0, m.oak);
  const count = Math.max(2, Math.round(w / .5));
  for (let i = 0; i < count; i++) {
    const x = (i - (count - 1) / 2) * w / count;
    box(group, w / count - .015, 2.23, .024, x, 1.225, d / 2 + .008, i % 3 === 0 ? m.oak : m.white);
    box(group, .012, .18, .024, x + w / count * .35, 1.12, d / 2 + .032, m.walnut);
  }
}

function chair(parent, x, z, angle, m, outdoor = false) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = angle; parent.add(g);
  legs(g, .44, .45, .43, m.oak, .06);
  box(g, .47, .065, .46, 0, .46, 0, outdoor ? m.oak : m.fabric, true);
  box(g, .47, .34, .075, 0, .67, -.22, outdoor ? m.oak : m.sage, true);
}

function counter(group, f, m, kind) {
  const { w, d } = f;
  box(group, w, .77, d, 0, .43, 0, m.oak);
  box(group, w + .018, .055, d + .025, 0, .845, 0, m.counter);
  box(group, w - .06, .075, .025, 0, .14, d / 2 + .008, m.walnut);
  const count = Math.max(1, Math.round(w / .5));
  for (let i = 0; i < count; i++) {
    const x = (i - (count - 1) / 2) * w / count;
    box(group, w / count - .02, .56, .015, x, .5, d / 2 + .012, m.oak);
    box(group, .19, .012, .022, x, .72, d / 2 + .025, m.walnut);
  }
  if (kind === 'sinkCounter') {
    box(group, .7, .025, .43, .05, .879, 0, m.metal, true);
    box(group, .6, .027, .34, .05, .894, 0, m.charcoal, true);
    cylinder(group, .019, .28, .05, 1.02, -.2, m.metal);
    box(group, .17, .025, .026, .12, 1.153, -.2, m.metal);
  } else {
    box(group, .61, .018, .46, 0, .883, 0, m.charcoal, true);
    for (const x of [-.18, .18]) cylinder(group, .095, .009, x, .898, 0, m.metal);
    box(group, .72, .19, .34, 0, 1.98, -.05, m.metal);
    box(group, .24, .45, .2, 0, 2.25, -.16, m.metal);
  }
}

export function createFurniture(scene, plan, materials, colliders) {
  const m = materials;
  for (const f of plan.furniture) {
    const group = new THREE.Group(); group.name = f.id;
    group.position.set(f.x, .018, -f.y); group.rotation.y = radians(f.rotation); scene.add(group);
    const { w, d } = f;
    let collision = true;
    switch (f.type) {
      case 'rug': box(group, w, .01, d, 0, .009, 0, m.rug).castShadow = false; collision = false; break;
      case 'sofa': sofa(group, f, m); break;
      case 'armchair': sofa(group, f, m, true); break;
      case 'bed': bed(group, f, m); break;
      case 'wardrobe': wardrobe(group, f, m); break;
      case 'coffeeTable':
        box(group, w, .07, d, 0, .37, 0, m.counter, true);
        cylinder(group, .14, .32, -w * .26, .17, 0, m.walnut); cylinder(group, .14, .32, w * .26, .17, 0, m.walnut);
        cylinder(group, .046, .04, w * .2, .42, .05, m.ceramic);
        box(group, .22, .02, .17, -w * .14, .423, 0, m.sage); break;
      case 'tvConsole':
        box(group, w, .4, d, 0, .28, 0, m.oak);
        for (const x of [-w * .31, 0, w * .31]) box(group, .012, .3, .012, x, .28, d / 2 + .003, m.walnut);
        box(group, 1.7, .96, .045, 0, 1.27, -.06, m.charcoal);
        box(group, 1.64, .9, .006, 0, 1.27, -.033, m.screen); break;
      case 'bedside':
        box(group, w, .48, d, 0, .3, 0, m.oak, true); box(group, w - .06, .012, .012, 0, .31, d / 2 + .004, m.walnut); lamp(group, 0, 0, m); break;
      case 'baySeat':
        box(group, w, .43, d, 0, .215, 0, m.counter);
        box(group, .65, .07, d - .07, -w * .26, .464, 0, m.linen, true);
        box(group, .38, .1, .31, -w * .26, .55, -.18, m.sage, true);
        box(group, .24, .018, .18, w * .25, .445, .04, m.oak); break;
      case 'diningTable':
        box(group, w, .055, d, 0, .76, 0, m.oak, true); legs(group, w, d, .73, m.oak, .16);
        cylinder(group, .085, .22, 0, .9, 0, m.ceramic);
        for (const x of [-.67, .67]) for (const z of [-.46, .46]) chair(group, x, z, x > 0 ? -Math.PI / 2 : Math.PI / 2, m);
        for (const x of [-.36, .36]) cylinder(group, .13, .016, x, .795, .32, m.ceramic);
        // 椅子独立参与碰撞，桌子角落仍留通道。
        for (const x of [-.67, .67]) for (const y of [-.46, .46]) colliders.push({ x: f.x + x, y: f.y + y, w: .45, d: .48, rotation: 90 });
        break;
      case 'shoeCabinet':
        box(group, w, 1.04, d, 0, .52, 0, m.oak); box(group, w + .02, .035, d + .02, 0, 1.06, 0, m.counter);
        art(group, .45, .6, 0, 1.72, -.15, m); cylinder(group, .055, .18, -.22, 1.17, 0, m.ceramic); break;
      case 'sinkCounter': case 'hobCounter': counter(group, f, m, f.type); break;
      case 'fridge':
        box(group, w, 1.89, d, 0, .95, 0, m.white, true);
        box(group, w - .02, .025, .018, 0, .64, d / 2 + .006, m.metal);
        box(group, .021, .34, .032, w * .31, 1.25, d / 2 + .022, m.metal); break;
      case 'vanity':
        box(group, w, .48, d, 0, .57, 0, m.oak);
        box(group, w + .025, .09, d + .035, 0, .85, 0, m.ceramic, true);
        box(group, w * .63, .014, d * .58, 0, .9, .015, m.counter, true);
        cylinder(group, .016, .13, 0, .97, -.13, m.metal);
        box(group, w * .82, .76, .023, 0, 1.52, -.21, m.metal, true); break;
      case 'toilet':
        box(group, w * .88, .7, .14, 0, .35, -d / 2 + .085, m.ceramic, true);
        sphere(group, w * .43, .25, d * .4, 0, .32, .04, m.ceramic);
        box(group, w, .07, d * .72, 0, .51, .08, m.white, true);
        box(group, .22, .014, .07, 0, .711, -d / 2 + .085, m.metal); break;
      case 'shower':
        box(group, w, .05, d, 0, .025, 0, m.ceramic);
        for (const x of [-w / 2, w / 2]) box(group, .025, 2.2, .025, x, 1.1, d / 2, m.metal);
        box(group, w * .55, 2.14, .016, -w * .225, 1.1, d / 2, m.glass).castShadow = false;
        box(group, w, .025, .026, 0, 2.21, d / 2, m.metal);
        cylinder(group, .015, 1.58, 0, 1.18, -d / 2 + .025, m.metal);
        cylinder(group, .095, .035, 0, 2.02, -d / 2 + .18, m.metal);
        // 淋浴右侧入口可进入，玻璃半扇保持碰撞。
        colliders.push({ x: f.x - w * .225, y: f.y - d / 2, w: w * .55, d: .025, rotation: f.rotation }); collision = false; break;
      case 'outdoorChair': chair(group, 0, 0, 0, m, true); break;
      case 'roundTable': cylinder(group, w / 2, .04, 0, .61, 0, m.oak); cylinder(group, .06, .59, 0, .3, 0, m.walnut); cylinder(group, .17, .03, 0, .015, 0, m.walnut); break;
      case 'plant':
        cylinder(group, w * .42, .34, 0, .17, 0, m.terracotta); cylinder(group, w * .36, .015, 0, .344, 0, m.soil);
        for (let i = 0; i < 7; i++) {
          const angle = i * 2.4;
          const leaf = sphere(group, .06, .29, .035, Math.cos(angle) * .12, .65 + (i % 3) * .07, Math.sin(angle) * .12, m.green);
          leaf.rotation.z = Math.cos(angle) * .6; leaf.rotation.x = Math.sin(angle) * .6;
        }
        break;
      default: throw new Error(`不支持的家具类型：${f.type}`);
    }
    if (collision) colliders.push({ x: f.x, y: f.y, w: f.w, d: f.d, rotation: f.rotation, id: f.id });
  }
}
