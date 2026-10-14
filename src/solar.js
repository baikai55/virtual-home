import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { radians, degrees, clamp } from './plan.js';

const DAY_MS = 86400000;
const UNIX_JULIAN = 2440587.5;
const J2000 = 2451545;
const wrap = value => ((value % 360) + 360) % 360;

export function localDateString(utcOffsetHours, now = new Date()) {
  return new Date(now.getTime() + utcOffsetHours * 3600000).toISOString().slice(0, 10);
}

// NOAA 太阳几何公式：儒略日 -> 赤纬/时间方程 -> 真太阳时 -> 高度与方位。
// 使用几何高度角，不含天气、大气折射与外部建筑遮挡。
export function solarPosition(dateString, minutes, latitude, longitude, utcOffsetHours) {
  const [year, month, day] = dateString.split('-').map(Number);
  if (![year, month, day, minutes, latitude, longitude, utcOffsetHours].every(Number.isFinite) || latitude <= -90 || latitude >= 90 || longitude < -180 || longitude > 180 || utcOffsetHours < -12 || utcOffsetHours > 14) throw new Error('日照日期或坐标无效。');
  const utcTime = Date.UTC(year, month - 1, day) + (minutes - utcOffsetHours * 60) * 60000;
  const century = (utcTime / DAY_MS + UNIX_JULIAN - J2000) / 36525;
  const meanLongitude = wrap(280.46646 + century * (36000.76983 + century * .0003032));
  const meanAnomaly = 357.52911 + century * (35999.05029 - .0001537 * century);
  const eccentricity = .016708634 - century * (.000042037 + .0000001267 * century);
  const equationCenter = Math.sin(radians(meanAnomaly)) * (1.914602 - century * (.004817 + .000014 * century)) + Math.sin(radians(2 * meanAnomaly)) * (.019993 - .000101 * century) + Math.sin(radians(3 * meanAnomaly)) * .000289;
  const trueLongitude = meanLongitude + equationCenter;
  const omega = 125.04 - 1934.136 * century;
  const apparentLongitude = trueLongitude - .00569 - .00478 * Math.sin(radians(omega));
  const obliquity = 23 + (26 + (21.448 - century * (46.815 + century * (.00059 - century * .001813))) / 60) / 60 + .00256 * Math.cos(radians(omega));
  const declination = Math.asin(Math.sin(radians(obliquity)) * Math.sin(radians(apparentLongitude)));
  const y = Math.tan(radians(obliquity) / 2) ** 2;
  const equationMinutes = 4 * degrees(y * Math.sin(2 * radians(meanLongitude)) - 2 * eccentricity * Math.sin(radians(meanAnomaly)) + 4 * eccentricity * y * Math.sin(radians(meanAnomaly)) * Math.cos(2 * radians(meanLongitude)) - .5 * y * y * Math.sin(4 * radians(meanLongitude)) - 1.25 * eccentricity * eccentricity * Math.sin(2 * radians(meanAnomaly)));
  const trueSolarMinutes = ((minutes + equationMinutes + 4 * longitude - utcOffsetHours * 60) % 1440 + 1440) % 1440;
  const hourAngle = radians(trueSolarMinutes / 4 - 180);
  const lat = radians(latitude);
  const altitude = Math.asin(clamp(Math.sin(lat) * Math.sin(declination) + Math.cos(lat) * Math.cos(declination) * Math.cos(hourAngle), -1, 1));
  const azimuth = wrap(degrees(Math.atan2(Math.sin(hourAngle), Math.cos(hourAngle) * Math.sin(lat) - Math.tan(declination) * Math.cos(lat))) + 180);
  return { altitudeDeg: degrees(altitude), azimuthDeg: azimuth, solarNoonMinutes: 720 - 4 * longitude - equationMinutes + utcOffsetHours * 60 };
}

export function sunDirection(position, planUpAzimuthDeg) {
  const altitude = radians(position.altitudeDeg);
  const angle = radians(position.azimuthDeg - planUpAzimuthDeg);
  return new THREE.Vector3(Math.cos(altitude) * Math.sin(angle), Math.sin(altitude), -Math.cos(altitude) * Math.cos(angle));
}

export function createSunSystem(scene, renderer, house, settings, mobile) {
  const sky = new Sky(); sky.scale.setScalar(4500); scene.add(sky);
  sky.material.uniforms.turbidity.value = 3.2;
  sky.material.uniforms.rayleigh.value = 1.5;
  sky.material.uniforms.mieCoefficient.value = .004;
  sky.material.uniforms.mieDirectionalG.value = .82;
  const skyDay = sky.material;
  const skyNight = new THREE.MeshBasicMaterial({ color: '#142538', side: THREE.BackSide, depthWrite: false, fog: false });
  const ambient = new THREE.HemisphereLight('#f0f3ed', '#e2dacc', 1.4); scene.add(ambient);
  const bounce = new THREE.AmbientLight('#eee6d5', .35); scene.add(bounce);
  const sun = new THREE.DirectionalLight('#fff2dd', 3.5);
  sun.castShadow = true; sun.shadow.mapSize.set(mobile ? 1024 : 2048, mobile ? 1024 : 2048);
  sun.shadow.camera.left = -11; sun.shadow.camera.right = 11;
  sun.shadow.camera.top = 11; sun.shadow.camera.bottom = -11;
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 100;
  sun.shadow.bias = -.00015; sun.shadow.normalBias = .012;
  sun.shadow.radius = 2;
  sun.target.position.set(5, 1, -5.5); scene.add(sun.target); scene.add(sun);
  let current = null;
  function update(date, minutes) {
    current = solarPosition(date, minutes, settings.latitude, settings.longitude, settings.utcOffsetHours);
    const direction = sunDirection(current, settings.planUpAzimuthDeg);
    sun.position.copy(sun.target.position).addScaledVector(direction, 45);
    renderer.shadowMap.needsUpdate = true;
    skyDay.uniforms.sunPosition.value.copy(direction);
    const altitude = current.altitudeDeg;
    const day = clamp((altitude + 5) / 14, 0, 1);
    const sunlight = Math.pow(clamp(Math.sin(radians(altitude)), 0, 1), .45);
    sun.intensity = altitude > 0 ? 3.8 * sunlight : 0;
    sun.color.copy(new THREE.Color('#f7b16c')).lerp(new THREE.Color('#fff6e3'), clamp(altitude / 35, 0, 1));
    ambient.intensity = .08 + 1.25 * day;
    bounce.intensity = .03 + .32 * day;
    ambient.color.copy(new THREE.Color('#526782')).lerp(new THREE.Color('#f0f3ed'), day);
    sky.material = altitude < -6 ? skyNight : skyDay;
    scene.fog.color.copy(new THREE.Color('#182b3b')).lerp(new THREE.Color('#c8d0b9'), day);
    renderer.toneMappingExposure = .83 + day * .17;
    const lampLevel = clamp((8 - altitude) / 10, 0, 1);
    for (const { light, baseIntensity } of house.roomLights) {
      light.intensity = baseIntensity * lampLevel;
      light.visible = lampLevel > 0;
    }
    house.materials.lamp.emissiveIntensity = .18 + lampLevel * 1.3;
    return current;
  }
  return { update, sun, sky, ambient, get current() { return current; } };
}
