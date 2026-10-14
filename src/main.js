import * as THREE from 'three';
import plan from '../floor-plan.json';
import './style.css';
import { validatePlan } from './plan.js';
import { buildHouse } from './building.js';
import { createSunSystem } from './solar.js';
import { createMovement } from './movement.js';
import { createInterface } from './interface.js';

try {
  validatePlan(plan);
  const mobile = window.matchMedia('(pointer: coarse)').matches;
  const canvas = document.createElement('canvas');
  const viewport = document.getElementById('viewport');
  if (!canvas.getContext('webgl2')) throw new Error('当前浏览器或设备未提供 WebGL2，请使用支持 WebGL2 的现代 Chrome 或 Safari。');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !mobile, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, mobile ? 1.35 : 1.75));
  renderer.setSize(viewport.clientWidth, viewport.clientHeight, false);
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.localClippingEnabled = true;
  viewport.append(renderer.domElement);
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog('#c8d0b9', 90, 700);
  const camera = new THREE.PerspectiveCamera(mobile ? 72 : 65, viewport.clientWidth / viewport.clientHeight, .05, 6500);
  const house = buildHouse(scene, plan);
  const sun = createSunSystem(scene, renderer, house, plan.settings, mobile);
  const ui = createInterface(plan, camera, mobile);
  const movement = createMovement(camera, renderer, plan, house, mobile, { onActive: ui.onActive, onMode: ui.onMode, onMessage: ui.message, onPlayback: ui.togglePlayback });
  ui.bind(movement, sun);
  renderer.domElement.addEventListener('webglcontextlost', event => { event.preventDefault(); window.showHouseError('图形上下文已丢失，请重新加载页面。'); });
  window.addEventListener('resize', () => {
    camera.aspect = viewport.clientWidth / viewport.clientHeight; camera.updateProjectionMatrix(); renderer.setSize(viewport.clientWidth, viewport.clientHeight, false);
    movement.resize();
  });
  let previousTime = null;
  renderer.setAnimationLoop(time => {
    const delta = previousTime === null ? 0 : Math.min((time - previousTime) / 1000, .05); previousTime = time;
    movement.update(delta); ui.update(delta); renderer.render(scene, camera);
  });
  renderer.render(scene, camera);
  document.getElementById('loading').hidden = true;
} catch (error) {
  window.showHouseError(error.message);
  console.error(error);
}
