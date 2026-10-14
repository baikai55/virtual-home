import * as THREE from 'three';

function canvasTexture(draw, size = 512) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  draw(canvas.getContext('2d'), size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  return texture;
}

function random(seed) {
  let state = seed;
  return () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 4294967296; };
}

function woodTexture() {
  const rand = random(29);
  return canvasTexture((ctx, size) => {
    const plank = size / 8;
    for (let column = 0; column < 8; column++) {
      const tone = Math.floor(rand() * 14);
      ctx.fillStyle = `rgb(${188 + tone},${165 + tone},${130 + tone})`;
      ctx.fillRect(column * plank, 0, plank, size);
      for (let grain = 0; grain < 24; grain++) {
        const x = column * plank + rand() * plank;
        ctx.beginPath(); ctx.moveTo(x, 0);
        for (let y = 0; y <= size; y += 16) ctx.lineTo(x + Math.sin(y / 70 + grain) * 1.2, y);
        ctx.strokeStyle = `rgba(111,84,51,${0.035 + rand() * 0.05})`; ctx.lineWidth = rand() * 1.1 + 0.2; ctx.stroke();
      }
      ctx.fillStyle = 'rgba(66,53,32,.13)'; ctx.fillRect(column * plank, 0, 1, size);
      const end = (column % 3) * size / 3;
      ctx.fillRect(column * plank, end, plank, 1);
      ctx.fillRect(column * plank, (end + size / 2) % size, plank, 1);
    }
  });
}

function tileTexture(base, warm = false) {
  const rand = random(57);
  return canvasTexture((ctx, size) => {
    ctx.fillStyle = base; ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 3500; i++) {
      ctx.fillStyle = warm ? 'rgba(93,77,56,.023)' : 'rgba(112,120,111,.022)';
      ctx.fillRect(rand() * size, rand() * size, 1 + rand() * 2, 1 + rand() * 2);
    }
    ctx.strokeStyle = warm ? '#c4bfac' : '#c0c6bd'; ctx.lineWidth = 3;
    ctx.strokeRect(1, 1, size - 2, size - 2);
  }, 256);
}

function textileTexture(base) {
  return canvasTexture((ctx, size) => {
    ctx.fillStyle = base; ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < size; i += 3) {
      ctx.fillStyle = i % 2 ? 'rgba(255,255,255,.035)' : 'rgba(64,55,41,.025)';
      ctx.fillRect(i, 0, 1, size); ctx.fillRect(0, i, size, 1);
    }
  }, 128);
}

export function createMaterials() {
  const wood = woodTexture(); wood.repeat.set(0.42, 0.42);
  const tiles = tileTexture('#dddccf', true); tiles.repeat.set(1.67, 1.67);
  const stone = tileTexture('#d4d7cf'); stone.repeat.set(1.8, 1.8);
  const balcony = tileTexture('#c5c6b6', true); balcony.repeat.set(1.8, 1.8);
  const oak = wood.clone(); oak.repeat.set(1, 1);
  const fabric = textileTexture('#dad3c4'); fabric.repeat.set(5, 5);
  const rugMap = textileTexture('#d9d2bf'); rugMap.repeat.set(15, 15);
  const standard = (color, roughness = 0.75, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, ...extra });
  const m = {
    wall: standard('#f1eee5', 0.88), ceiling: standard('#f3f0e9', 0.9, { side: THREE.DoubleSide }),
    trim: standard('#faf6ed', 0.6), slab: standard('#d7d2c5', 0.9), frame: standard('#554f44', 0.4, { metalness: 0.35 }),
    rail: standard('#55594d', 0.55, { metalness: 0.35 }),
    floors: {
      wood: standard('#ffffff', 0.76, { map: wood, bumpMap: wood, bumpScale: 0.011 }),
      kitchen: standard('#ffffff', 0.53, { map: tiles, bumpMap: tiles, bumpScale: 0.008 }),
      stone: standard('#ffffff', 0.53, { map: stone, bumpMap: stone, bumpScale: 0.008 }),
      balcony: standard('#ffffff', 0.87, { map: balcony }),
    },
    oak: standard('#ffffff', 0.55, { map: oak }), walnut: standard('#896d4e', 0.65, { map: oak }),
    fabric: standard('#ffffff', 0.98, { map: fabric }), rug: standard('#ffffff', 1, { map: rugMap }),
    sage: standard('#899681', 1), sand: standard('#d0c3a8', 1), clay: standard('#c4a393', 1),
    linen: standard('#f6f1e3', 1), charcoal: standard('#3c413b', 0.7), white: standard('#eeeae0', 0.65),
    ceramic: standard('#f2f0e8', 0.25), counter: standard('#e8e3d8', 0.36), metal: standard('#909a91', 0.27, { metalness: 0.75 }),
    screen: standard('#172022', 0.23, { metalness: 0.2 }), soil: standard('#4d4233', 1), green: standard('#667c53', 0.85),
    terracotta: standard('#b99470', 0.9), lamp: standard('#ffedc3', 0.5, { emissive: '#fbe5b4', emissiveIntensity: 0.4 }),
    glass: new THREE.MeshStandardMaterial({ color: '#cee3dc', roughness: 0.16, metalness: 0.08, transparent: true, opacity: 0.11, depthWrite: false, side: THREE.DoubleSide }),
    frosted: new THREE.MeshStandardMaterial({ color: '#e1e9db', roughness: 0.7, transparent: true, opacity: 0.26, depthWrite: false, side: THREE.DoubleSide }),
  };
  return m;
}

export function artMaterial(palette) {
  const texture = canvasTexture((ctx, size) => {
    ctx.fillStyle = '#ece5d3'; ctx.fillRect(0, 0, size, size);
    const colors = palette === 'sage' ? ['#a9b09c', '#7c8d70', '#c7bba2'] : ['#b7aa8d', '#879175', '#d2c6ac'];
    ctx.fillStyle = colors[0]; ctx.beginPath(); ctx.arc(size * .38, size * .43, size * .24, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = colors[1]; ctx.beginPath(); ctx.moveTo(0, size); ctx.lineTo(0, size * .76); ctx.bezierCurveTo(size * .3, size * .37, size * .65, size * .8, size, size * .51); ctx.lineTo(size, size); ctx.fill();
    ctx.fillStyle = colors[2]; ctx.beginPath(); ctx.moveTo(0, size); ctx.lineTo(0, size * .9); ctx.bezierCurveTo(size * .4, size * .68, size * .58, size * .92, size, size * .7); ctx.lineTo(size, size); ctx.fill();
  });
  return new THREE.MeshStandardMaterial({ map: texture, roughness: 1 });
}
