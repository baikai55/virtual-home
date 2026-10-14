import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { radians, clamp, canStand } from './plan.js';

const PLAYER_RADIUS = .2;
const WALK_SPEED = 1.8;
const SPRINT_SPEED = 3.5;
const TOUCH_LOOK_SPEED = .004;
const MAX_PITCH = Math.PI * .43;
const INITIAL_PITCH = -Math.PI / 36;

export function createMovement(camera, renderer, plan, house, mobile, callbacks) {
  const canvas = renderer.domElement;
  const pointer = new PointerLockControls(camera, canvas);
  pointer.minPolarAngle = Math.PI / 2 - MAX_PITCH;
  pointer.maxPolarAngle = Math.PI / 2 + MAX_PITCH;
  const orbit = new OrbitControls(camera, canvas);
  orbit.enabled = false; orbit.enableDamping = true; orbit.dampingFactor = .09;
  orbit.minDistance = 7; orbit.maxDistance = 36;
  orbit.minPolarAngle = .06; orbit.maxPolarAngle = Math.PI * .44;
  const keys = new Set();
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  const forward = new THREE.Vector3();
  const joystick = document.getElementById('joystick');
  const knob = document.getElementById('joystick-knob');
  const sprint = document.getElementById('sprint-button');
  let joystickId = null, lookId = null, lookX = 0, lookY = 0;
  let stickX = 0, stickY = 0, sprinting = false;
  let active = false, overview = false, lockPending = false, lockRequested = false, overviewFit = 1;
  const savedPosition = new THREE.Vector3();
  const savedQuaternion = new THREE.Quaternion();

  function resetInput() {
    keys.clear(); stickX = stickY = 0; sprinting = false; joystickId = lookId = null;
    knob.style.transform = 'translate(0, 0)';
  }

  function setPose(x, y, yawDeg) {
    if (!canStand(plan, house.colliders, x, y, PLAYER_RADIUS)) throw new Error(`预设站位不可通行：${x.toFixed(2)}, ${y.toFixed(2)}`);
    camera.position.set(x, plan.settings.eyeHeight, -y);
    camera.rotation.set(INITIAL_PITCH, -radians(yawDeg), 0, 'YXZ');
  }
  setPose(plan.settings.initialPosition.x, plan.settings.initialPosition.y, plan.settings.initialPosition.yawDeg);
  savedPosition.copy(camera.position); savedQuaternion.copy(camera.quaternion);

  function pause() {
    resetInput(); active = false; lockRequested = false;
    if (pointer.isLocked) pointer.unlock();
    callbacks.onActive(false);
  }
  function showLockError() {
    resetInput(); active = false; lockRequested = false; callbacks.onActive(false);
    callbacks.onMessage('当前浏览器未能锁定鼠标，请在 Edge 或 Chrome 中打开页面后进入。');
  }
  async function start() {
    if (overview || lockPending || pointer.isLocked) return;
    if (mobile) { active = true; callbacks.onActive(true); return; }
    lockPending = true; lockRequested = true;
    try {
      // PointerLockControls.lock() 不返回原生 Promise，直接等待才能处理锁定失败。
      await canvas.requestPointerLock();
    } catch (error) {
      console.error('鼠标锁定失败：', error);
      showLockError();
    } finally {
      lockPending = false;
    }
  }

  pointer.addEventListener('lock', () => { if (overview || !lockRequested) { pointer.unlock(); return; } active = true; callbacks.onActive(true); });
  pointer.addEventListener('unlock', () => { resetInput(); active = false; lockRequested = false; callbacks.onActive(false); });
  document.addEventListener('pointerlockerror', showLockError);
  canvas.addEventListener('click', event => { if (event.pointerType !== 'touch' && !mobile && !overview && !pointer.isLocked) start(); });

  function overviewFitFactor() {
    return Math.max(1, .75 / camera.aspect, canvas.clientHeight < 550 ? 1.3 : 1);
  }
  function resize() {
    if (!overview) return;
    const nextFit = overviewFitFactor();
    camera.position.sub(orbit.target).multiplyScalar(nextFit / overviewFit).add(orbit.target);
    overviewFit = nextFit; orbit.update();
  }

  function setOverview(enabled) {
    if (enabled === overview) return;
    if (enabled) { savedPosition.copy(camera.position); savedQuaternion.copy(camera.quaternion); pause(); }
    overview = enabled; house.setCutaway(enabled); orbit.enabled = enabled;
    renderer.shadowMap.needsUpdate = true;
    if (enabled) {
      const view = plan.settings.overview;
      orbit.target.set(view.targetX, -.55, -view.targetY);
      camera.position.set(view.x, view.height, -view.y);
      overviewFit = overviewFitFactor();
      camera.position.sub(orbit.target).multiplyScalar(overviewFit).add(orbit.target); orbit.update();
    } else {
      camera.position.copy(savedPosition); camera.quaternion.copy(savedQuaternion);
      if (mobile) { active = true; callbacks.onActive(true); }
    }
    callbacks.onMode(enabled);
  }

  function teleport(roomId) {
    const room = plan.rooms.find(item => item.id === roomId);
    if (!room) throw new Error(`房间不存在：${roomId}`);
    if (overview) setOverview(false);
    resetInput(); setPose(...room.spawn);
    savedPosition.copy(camera.position); savedQuaternion.copy(camera.quaternion);
    callbacks.onMessage(`已到 ${room.name}`);
    if (mobile) { active = true; callbacks.onActive(true); }
  }

  window.addEventListener('keydown', event => {
    if (event.code === 'Escape') { pause(); return; }
    if (event.target.closest('input,select,textarea,button') || event.ctrlKey || event.metaKey || event.altKey) return;
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight'].includes(event.code)) {
      if (active && !overview) { keys.add(event.code); event.preventDefault(); }
    } else if (event.code === 'KeyM' && !event.repeat) { setOverview(!overview); event.preventDefault(); }
    else if (event.code === 'Space' && !event.repeat) { callbacks.onPlayback(); event.preventDefault(); }
    else if (/^Digit[1-9]$/.test(event.code) && !event.repeat) {
      const room = plan.rooms[Number(event.code.slice(-1)) - 1]; if (room) teleport(room.id);
    }
  });
  window.addEventListener('keyup', event => keys.delete(event.code));
  window.addEventListener('blur', pause);
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

  function updateStick(event) {
    const rect = joystick.getBoundingClientRect();
    const max = rect.width * .32;
    const dx = event.clientX - rect.left - rect.width / 2;
    const dy = event.clientY - rect.top - rect.height / 2;
    const distance = Math.hypot(dx, dy);
    const factor = distance > max ? max / distance : 1;
    stickX = dx * factor / max; stickY = -dy * factor / max;
    knob.style.transform = `translate(${dx * factor}px, ${dy * factor}px)`;
  }
  joystick.addEventListener('pointerdown', event => {
    if (!mobile || overview || joystickId !== null) return;
    event.preventDefault(); event.stopPropagation(); joystickId = event.pointerId;
    joystick.setPointerCapture(event.pointerId); active = true; callbacks.onActive(true); updateStick(event);
  });
  joystick.addEventListener('pointermove', event => { if (event.pointerId === joystickId) { updateStick(event); event.preventDefault(); } });
  function releaseStick(event) { if (event.pointerId === joystickId) { joystickId = null; stickX = stickY = 0; knob.style.transform = 'translate(0, 0)'; } }
  joystick.addEventListener('pointerup', releaseStick); joystick.addEventListener('pointercancel', releaseStick); joystick.addEventListener('lostpointercapture', releaseStick);

  canvas.addEventListener('pointerdown', event => {
    if (!mobile || overview || lookId !== null || event.pointerType === 'mouse') return;
    event.preventDefault(); lookId = event.pointerId; lookX = event.clientX; lookY = event.clientY;
    canvas.setPointerCapture(event.pointerId); active = true; callbacks.onActive(true);
  });
  canvas.addEventListener('pointermove', event => {
    if (event.pointerId !== lookId || overview) return;
    euler.setFromQuaternion(camera.quaternion);
    euler.y -= (event.clientX - lookX) * TOUCH_LOOK_SPEED;
    euler.x = clamp(euler.x - (event.clientY - lookY) * TOUCH_LOOK_SPEED, -MAX_PITCH, MAX_PITCH);
    camera.quaternion.setFromEuler(euler); lookX = event.clientX; lookY = event.clientY;
    event.preventDefault();
  });
  function releaseLook(event) { if (event.pointerId === lookId) lookId = null; }
  canvas.addEventListener('pointerup', releaseLook); canvas.addEventListener('pointercancel', releaseLook); canvas.addEventListener('lostpointercapture', releaseLook);
  sprint.addEventListener('pointerdown', event => { if (overview) return; sprinting = true; sprint.setPointerCapture(event.pointerId); event.preventDefault(); });
  for (const eventName of ['pointerup', 'pointercancel', 'lostpointercapture']) sprint.addEventListener(eventName, () => { sprinting = false; });

  function update(delta) {
    if (overview) { orbit.update(); return; }
    if (!active) return;
    let moveForward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0) + stickY;
    let moveRight = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0) + stickX;
    const length = Math.hypot(moveForward, moveRight);
    if (length < .01) return;
    if (length > 1) { moveForward /= length; moveRight /= length; }
    camera.getWorldDirection(forward); forward.y = 0; forward.normalize();
    const speed = sprinting || keys.has('ShiftLeft') || keys.has('ShiftRight') ? SPRINT_SPEED : WALK_SPEED;
    const dx = (forward.x * moveForward - forward.z * moveRight) * speed * delta;
    const dy = (-forward.z * moveForward - forward.x * moveRight) * speed * delta;
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / .07));
    let x = camera.position.x, y = -camera.position.z;
    for (let i = 0; i < steps; i++) {
      if (canStand(plan, house.colliders, x + dx / steps, y, PLAYER_RADIUS)) x += dx / steps;
      if (canStand(plan, house.colliders, x, y + dy / steps, PLAYER_RADIUS)) y += dy / steps;
    }
    camera.position.set(x, plan.settings.eyeHeight, -y);
  }
  return { start, pause, setOverview, teleport, update, resize, get overview() { return overview; }, get active() { return active; }, get playerPosition() { return overview ? savedPosition : camera.position; }, get playerQuaternion() { return overview ? savedQuaternion : camera.quaternion; } };
}
