import * as THREE from 'three';

export interface ProceduralTextureSet {
  turfColor: THREE.CanvasTexture;
  turfBump: THREE.CanvasTexture;
  outerTerrainColor: THREE.CanvasTexture;
  woodColor: THREE.CanvasTexture;
  woodBump: THREE.CanvasTexture;
  crateTopColor: THREE.CanvasTexture;
  bunkerColor: THREE.CanvasTexture;
  bunkerBump: THREE.CanvasTexture;
  stoneColor: THREE.CanvasTexture;
  stoneBump: THREE.CanvasTexture;
  splatTextures: THREE.CanvasTexture[];
  contactShadow: THREE.CanvasTexture;
  softRectShadow: THREE.CanvasTexture;
  dispose: () => void;
}

function makeSeededRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function configureTexture(
  tex: THREE.CanvasTexture,
  isColor: boolean,
  anisotropy: number,
  repeatX = 1,
  repeatY = 1,
): THREE.CanvasTexture {
  tex.colorSpace = isColor ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = anisotropy;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Generates high-craft procedural PBR textures (albedo + grayscale micro-relief bump maps)
 * calibrated for rich golden-afternoon alpine contrast.
 */
export function createArenaTextures(maxAnisotropy: number): ProceduralTextureSet {
  const aniso = Math.min(maxAnisotropy, 8);
  const allTextures: THREE.CanvasTexture[] = [];

  // -------------------------------------------------------------------------
  // 1. RICH MOWED ALPINE TURF FIELD (1024x1024) + WORN OCHRE TRAILS + BUMP
  // -------------------------------------------------------------------------
  const turfCanvas = document.createElement('canvas');
  turfCanvas.width = 1024;
  turfCanvas.height = 1024;
  const tctx = turfCanvas.getContext('2d')!;
  const randTurf = makeSeededRandom(4021);

  // Deeper, saturated lush athletic grass bands so colors and splatters pop dramatically
  const stripeCount = 16;
  const stripeW = 1024 / stripeCount;
  for (let i = 0; i < stripeCount; i++) {
    tctx.fillStyle = i % 2 === 0 ? '#446A31' : '#3B5E2A';
    tctx.fillRect(i * stripeW, 0, stripeW + 1, 1024);
  }

  // Organic sun-dappled meadow blade texture
  for (let i = 0; i < 6200; i++) {
    const x = randTurf() * 1024;
    const y = randTurf() * 1024;
    const w = 1.5 + randTurf() * 4.5;
    const h = 1.5 + randTurf() * 3.5;
    const bright = randTurf();
    tctx.fillStyle =
      bright > 0.65
        ? 'rgba(116, 152, 68, 0.24)'
        : bright < 0.28
          ? 'rgba(28, 46, 19, 0.34)'
          : 'rgba(84, 118, 54, 0.2)';
    tctx.fillRect(x, y, w, h);
  }

  // Worn sandy-ochre footpaths connecting bases to central ridge & side flanks
  const drawDirtWear = (cx: number, cy: number, rx: number, ry: number, alpha: number) => {
    const grad = tctx.createRadialGradient(cx, cy, rx * 0.12, cx, cy, rx);
    grad.addColorStop(0, `rgba(134, 108, 72, ${alpha})`);
    grad.addColorStop(0.55, `rgba(104, 92, 58, ${alpha * 0.55})`);
    grad.addColorStop(1, 'rgba(68, 106, 49, 0)');
    tctx.save();
    tctx.translate(cx, cy);
    tctx.scale(1, ry / rx);
    tctx.fillStyle = grad;
    tctx.beginPath();
    tctx.arc(0, 0, rx, 0, Math.PI * 2);
    tctx.fill();
    tctx.restore();
  };
  drawDirtWear(102, 512, 125, 175, 0.72);
  drawDirtWear(922, 512, 125, 175, 0.72);
  drawDirtWear(512, 512, 130, 225, 0.38);
  // Flank sprint ruts
  drawDirtWear(512, 145, 290, 42, 0.24);
  drawDirtWear(512, 879, 290, 42, 0.24);

  // Subtle perimeter vignette darkening around turf boundary curb
  const edgeGrad = tctx.createRadialGradient(512, 512, 340, 512, 512, 680);
  edgeGrad.addColorStop(0, 'rgba(0,0,0,0)');
  edgeGrad.addColorStop(1, 'rgba(14, 24, 10, 0.28)');
  tctx.fillStyle = edgeGrad;
  tctx.fillRect(0, 0, 1024, 1024);

  // Crisp weathered tournament chalk lines
  tctx.strokeStyle = 'rgba(238, 242, 230, 0.68)';
  tctx.lineWidth = 6;
  tctx.strokeRect(18, 22, 988, 980);

  // Midfield divider + center tournament ring + subtle compass ticks
  tctx.beginPath();
  tctx.moveTo(512, 22);
  tctx.lineTo(512, 1002);
  tctx.stroke();

  tctx.beginPath();
  tctx.arc(512, 512, 96, 0, Math.PI * 2);
  tctx.stroke();

  tctx.strokeStyle = 'rgba(238, 242, 230, 0.32)';
  tctx.lineWidth = 3;
  tctx.beginPath();
  tctx.arc(512, 512, 108, 0, Math.PI * 2);
  tctx.stroke();

  // Quarter-field dashed tactical markers
  tctx.save();
  tctx.strokeStyle = 'rgba(238, 242, 230, 0.3)';
  tctx.setLineDash([14, 14]);
  tctx.lineWidth = 4;
  tctx.beginPath();
  tctx.moveTo(270, 22);
  tctx.lineTo(270, 1002);
  tctx.moveTo(754, 22);
  tctx.lineTo(754, 1002);
  tctx.stroke();
  tctx.restore();

  // Bold team base territory arcs on turf
  tctx.strokeStyle = 'rgba(42, 128, 255, 0.62)';
  tctx.lineWidth = 11;
  tctx.beginPath();
  tctx.arc(100, 512, 118, -Math.PI * 0.48, Math.PI * 0.48);
  tctx.stroke();

  tctx.strokeStyle = 'rgba(242, 78, 50, 0.62)';
  tctx.beginPath();
  tctx.arc(924, 512, 118, Math.PI * 0.52, Math.PI * 1.48);
  tctx.stroke();

  const turfColor = configureTexture(new THREE.CanvasTexture(turfCanvas), true, aniso, 1, 1);
  turfColor.wrapS = THREE.ClampToEdgeWrapping;
  turfColor.wrapT = THREE.ClampToEdgeWrapping;
  allTextures.push(turfColor);

  // Turf Bump Map (512x512 tiled)
  const turfBumpCanvas = document.createElement('canvas');
  turfBumpCanvas.width = 512;
  turfBumpCanvas.height = 512;
  const tbctx = turfBumpCanvas.getContext('2d')!;
  tbctx.fillStyle = '#808080';
  tbctx.fillRect(0, 0, 512, 512);
  const randTB = makeSeededRandom(8842);
  for (let i = 0; i < 7500; i++) {
    const v = 80 + Math.floor(randTB() * 96);
    tbctx.fillStyle = `rgb(${v},${v},${v})`;
    tbctx.fillRect(randTB() * 512, randTB() * 512, 2 + randTB() * 3, 2 + randTB() * 3);
  }
  const turfBump = configureTexture(new THREE.CanvasTexture(turfBumpCanvas), false, aniso, 8, 5);
  allTextures.push(turfBump);

  // -------------------------------------------------------------------------
  // 2. OUTER ALPINE VALLEY TERRAIN TEXTURE (richer dark pine-meadow tone)
  // -------------------------------------------------------------------------
  const outerCanvas = document.createElement('canvas');
  outerCanvas.width = 512;
  outerCanvas.height = 512;
  const octx = outerCanvas.getContext('2d')!;
  const randOut = makeSeededRandom(9137);
  octx.fillStyle = '#384F2C';
  octx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 2800; i++) {
    const x = randOut() * 512;
    const y = randOut() * 512;
    const r = 4 + randOut() * 22;
    const pick = randOut();
    octx.fillStyle =
      pick > 0.7
        ? 'rgba(102, 92, 62, 0.18)'
        : pick < 0.3
          ? 'rgba(34, 52, 25, 0.28)'
          : 'rgba(72, 98, 48, 0.2)';
    octx.beginPath();
    octx.arc(x, y, r, 0, Math.PI * 2);
    octx.fill();
  }
  const outerTerrainColor = configureTexture(new THREE.CanvasTexture(outerCanvas), true, aniso, 10, 10);
  allTextures.push(outerTerrainColor);

  // -------------------------------------------------------------------------
  // 3. WEATHERED CEDAR TIMBER PLANKS + TACTICAL CRATE CROSS-FRAME TOP
  // -------------------------------------------------------------------------
  const woodCanvas = document.createElement('canvas');
  woodCanvas.width = 512;
  woodCanvas.height = 512;
  const wctx = woodCanvas.getContext('2d')!;
  const woodBumpCanvas = document.createElement('canvas');
  woodBumpCanvas.width = 512;
  woodBumpCanvas.height = 512;
  const wbctx = woodBumpCanvas.getContext('2d')!;
  const randWood = makeSeededRandom(5519);

  const plankCount = 8;
  const plankH = 512 / plankCount;
  for (let p = 0; p < plankCount; p++) {
    const y0 = p * plankH;
    const toneShift = (randWood() - 0.5) * 22;
    const r = Math.round(138 + toneShift);
    const g = Math.round(92 + toneShift * 0.72);
    const b = Math.round(54 + toneShift * 0.48);
    wctx.fillStyle = `rgb(${r},${g},${b})`;
    wctx.fillRect(0, y0, 512, plankH);

    wbctx.fillStyle = '#929292';
    wbctx.fillRect(0, y0, 512, plankH);

    for (let s = 0; s < 44; s++) {
      const sy = y0 + randWood() * plankH;
      const dark = randWood() > 0.42;
      wctx.fillStyle = dark ? 'rgba(56, 34, 16, 0.24)' : 'rgba(196, 148, 96, 0.16)';
      wctx.fillRect(0, sy, 512, 1 + randWood() * 2.5);
      wbctx.fillStyle = dark ? 'rgba(55, 55, 55, 0.4)' : 'rgba(185, 185, 185, 0.25)';
      wbctx.fillRect(0, sy, 512, 1.5);
    }

    wctx.fillStyle = 'rgba(34, 20, 10, 0.9)';
    wctx.fillRect(0, y0, 512, 4);
    wbctx.fillStyle = '#181818';
    wbctx.fillRect(0, y0, 512, 4);

    for (const nx of [26, 486]) {
      wctx.fillStyle = '#2B2F34';
      wctx.beginPath();
      wctx.arc(nx, y0 + plankH * 0.5, 5, 0, Math.PI * 2);
      wctx.fill();
      wbctx.fillStyle = '#E0E0E0';
      wbctx.beginPath();
      wbctx.arc(nx, y0 + plankH * 0.5, 5, 0, Math.PI * 2);
      wbctx.fill();
    }
  }
  const woodColor = configureTexture(new THREE.CanvasTexture(woodCanvas), true, aniso, 1, 1);
  const woodBump = configureTexture(new THREE.CanvasTexture(woodBumpCanvas), false, aniso, 1, 1);
  allTextures.push(woodColor, woodBump);

  // Tactical Supply Crate Face (cross-bracing X timber frame + stencil mark so top-down view looks detailed!)
  const crateCanvas = document.createElement('canvas');
  crateCanvas.width = 512;
  crateCanvas.height = 512;
  const cctx = crateCanvas.getContext('2d')!;
  cctx.drawImage(woodCanvas, 0, 0);
  // Diagonal cross brace plank
  cctx.save();
  cctx.strokeStyle = '#6A4426';
  cctx.lineWidth = 42;
  cctx.beginPath();
  cctx.moveTo(46, 46);
  cctx.lineTo(466, 466);
  cctx.stroke();
  cctx.strokeStyle = 'rgba(28, 16, 8, 0.65)';
  cctx.lineWidth = 4;
  cctx.strokeRect(46, 46, 420, 420);
  cctx.restore();
  // Perimeter dark cedar border frame
  cctx.strokeStyle = '#5B3A20';
  cctx.lineWidth = 52;
  cctx.strokeRect(26, 26, 460, 460);
  // Corner iron rivets
  cctx.fillStyle = '#2A3038';
  for (const [rx, ry] of [
    [28, 28],
    [484, 28],
    [28, 484],
    [484, 484],
  ]) {
    cctx.fillRect(rx - 14, ry - 14, 28, 28);
  }
  // Subtle cream supply stencil chevron in center
  cctx.fillStyle = 'rgba(244, 238, 220, 0.42)';
  cctx.fillRect(190, 232, 132, 16);
  cctx.fillRect(216, 260, 80, 14);

  const crateTopColor = configureTexture(new THREE.CanvasTexture(crateCanvas), true, aniso, 1, 1);
  allTextures.push(crateTopColor);

  // -------------------------------------------------------------------------
  // 4. ATHLETIC CHARCOAL-SLATE SPEEDBALL BUNKER TARPAULIN (512x512 + bump)
  // -------------------------------------------------------------------------
  const bunkerCanvas = document.createElement('canvas');
  bunkerCanvas.width = 512;
  bunkerCanvas.height = 512;
  const bctx = bunkerCanvas.getContext('2d')!;
  const bunkerBumpCanvas = document.createElement('canvas');
  bunkerBumpCanvas.width = 512;
  bunkerBumpCanvas.height = 512;
  const bbctx = bunkerBumpCanvas.getContext('2d')!;
  const randBunk = makeSeededRandom(3104);

  // Deep athletic matte charcoal-slate PVC tarpaulin (contrast against sunlit green turf!)
  bctx.fillStyle = '#3F4956';
  bctx.fillRect(0, 0, 512, 512);
  bbctx.fillStyle = '#808080';
  bbctx.fillRect(0, 0, 512, 512);

  // Ripstop woven ballistic nylon micro-grid
  bctx.strokeStyle = 'rgba(20, 24, 30, 0.22)';
  bbctx.strokeStyle = 'rgba(110, 110, 110, 0.4)';
  bctx.lineWidth = 1;
  bbctx.lineWidth = 1;
  for (let i = 0; i < 512; i += 14) {
    bctx.beginPath();
    bctx.moveTo(i, 0);
    bctx.lineTo(i, 512);
    bctx.moveTo(0, i);
    bctx.lineTo(512, i);
    bctx.stroke();

    bbctx.beginPath();
    bbctx.moveTo(i, 0);
    bbctx.lineTo(i, 512);
    bbctx.moveTo(0, i);
    bbctx.lineTo(512, i);
    bbctx.stroke();
  }

  // Welded seam border + subtle diagonal speed-graphic chevrons
  bctx.strokeStyle = 'rgba(18, 22, 28, 0.55)';
  bctx.lineWidth = 10;
  bctx.strokeRect(18, 18, 476, 476);
  bbctx.strokeStyle = '#323232';
  bbctx.lineWidth = 10;
  bbctx.strokeRect(18, 18, 476, 476);

  bctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
  bctx.beginPath();
  bctx.moveTo(0, 380);
  bctx.lineTo(380, 0);
  bctx.lineTo(440, 0);
  bctx.lineTo(0, 440);
  bctx.closePath();
  bctx.fill();

  // Subtle historical paintball impact smudges
  for (let i = 0; i < 18; i++) {
    const x = 45 + randBunk() * 422;
    const y = 45 + randBunk() * 422;
    const r = 6 + randBunk() * 14;
    bctx.fillStyle =
      i % 2 === 0 ? 'rgba(56, 152, 255, 0.14)' : 'rgba(248, 96, 66, 0.14)';
    bctx.beginPath();
    bctx.arc(x, y, r, 0, Math.PI * 2);
    bctx.fill();
  }

  const bunkerColor = configureTexture(new THREE.CanvasTexture(bunkerCanvas), true, aniso, 1, 1);
  const bunkerBump = configureTexture(new THREE.CanvasTexture(bunkerBumpCanvas), false, aniso, 1, 1);
  allTextures.push(bunkerColor, bunkerBump);

  // -------------------------------------------------------------------------
  // 5. WEATHERED ALPINE STONE MASONRY (512x512 + bump)
  // -------------------------------------------------------------------------
  const stoneCanvas = document.createElement('canvas');
  stoneCanvas.width = 512;
  stoneCanvas.height = 512;
  const sctx = stoneCanvas.getContext('2d')!;
  const stoneBumpCanvas = document.createElement('canvas');
  stoneBumpCanvas.width = 512;
  stoneBumpCanvas.height = 512;
  const sbctx = stoneBumpCanvas.getContext('2d')!;
  const randStone = makeSeededRandom(7731);

  sctx.fillStyle = '#6D726C';
  sctx.fillRect(0, 0, 512, 512);
  sbctx.fillStyle = '#707070';
  sbctx.fillRect(0, 0, 512, 512);

  const rows = 6;
  const rowH = 512 / rows;
  for (let r = 0; r < rows; r++) {
    const offset = (r % 2) * 85;
    for (let c = -1; c < 4; c++) {
      const x = c * 170 + offset;
      const y = r * rowH;
      const shade = 114 + Math.floor((randStone() - 0.5) * 28);
      sctx.fillStyle = `rgb(${shade}, ${shade + 2}, ${shade - 3})`;
      sctx.fillRect(x + 4, y + 4, 162, rowH - 8);
      sbctx.fillStyle = `rgb(${shade + 24}, ${shade + 24}, ${shade + 24})`;
      sbctx.fillRect(x + 4, y + 4, 162, rowH - 8);
    }
  }
  for (let i = 0; i < 3600; i++) {
    const v = 75 + Math.floor(randStone() * 95);
    sctx.fillStyle = `rgba(${v},${v},${v},0.2)`;
    sctx.fillRect(randStone() * 512, randStone() * 512, 3, 3);
    sbctx.fillStyle = `rgba(${v},${v},${v},0.34)`;
    sbctx.fillRect(randStone() * 512, randStone() * 512, 3, 3);
  }
  const stoneColor = configureTexture(new THREE.CanvasTexture(stoneCanvas), true, aniso, 1, 1);
  const stoneBump = configureTexture(new THREE.CanvasTexture(stoneBumpCanvas), false, aniso, 1, 1);
  allTextures.push(stoneColor, stoneBump);

  // -------------------------------------------------------------------------
  // 6. HIGH-CONTRAST GLOSSY PAINTBALL SPLATTER DECALS (4 organic variants)
  // -------------------------------------------------------------------------
  const splatTextures: THREE.CanvasTexture[] = [];
  for (let v = 0; v < 4; v++) {
    const sc = document.createElement('canvas');
    sc.width = 256;
    sc.height = 256;
    const ctx = sc.getContext('2d')!;
    const rSplat = makeSeededRandom(1200 + v * 337);
    ctx.clearRect(0, 0, 256, 256);

    // Subtle darker wet rim for crisp readability against sunlit turf
    const drawSplashPath = (scale: number) => {
      ctx.beginPath();
      const lobes = 16 + v * 2;
      for (let i = 0; i <= lobes; i++) {
        const ang = (i / lobes) * Math.PI * 2;
        const rad = (48 + Math.sin(ang * 3 + v) * 16 + Math.cos(ang * 5 - v) * 10 + rSplat() * 20) * scale;
        const px = 128 + Math.cos(ang) * rad;
        const py = 128 + Math.sin(ang) * rad;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
    };

    ctx.fillStyle = '#D8D8D8';
    drawSplashPath(1.06);
    ctx.fill();

    ctx.fillStyle = '#FFFFFF';
    drawSplashPath(0.98);
    ctx.fill();

    // Radial paint streaks & satellite burst droplets
    const drops = 22 + Math.floor(rSplat() * 10);
    for (let d = 0; d < drops; d++) {
      const ang = rSplat() * Math.PI * 2;
      const dist = 56 + rSplat() * 62;
      const rx = 5 + rSplat() * 13;
      const ry = 3 + rSplat() * 8;
      const px = 128 + Math.cos(ang) * dist;
      const py = 128 + Math.sin(ang) * dist;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(ang);
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    const tex = configureTexture(new THREE.CanvasTexture(sc), true, aniso, 1, 1);
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    splatTextures.push(tex);
    allTextures.push(tex);
  }

  // -------------------------------------------------------------------------
  // 7. SOFT RADIAL CONTACT SHADOW DISC + SOFT RECTANGULAR CAST SHADOW
  // -------------------------------------------------------------------------
  const shCanvas = document.createElement('canvas');
  shCanvas.width = 128;
  shCanvas.height = 128;
  const shCtx = shCanvas.getContext('2d')!;
  const shGrad = shCtx.createRadialGradient(64, 64, 10, 64, 64, 62);
  shGrad.addColorStop(0, 'rgba(10, 18, 8, 0.78)');
  shGrad.addColorStop(0.58, 'rgba(10, 18, 8, 0.36)');
  shGrad.addColorStop(1, 'rgba(10, 18, 8, 0)');
  shCtx.fillStyle = shGrad;
  shCtx.fillRect(0, 0, 128, 128);
  const contactShadow = configureTexture(new THREE.CanvasTexture(shCanvas), false, 1, 1, 1);
  contactShadow.wrapS = THREE.ClampToEdgeWrapping;
  contactShadow.wrapT = THREE.ClampToEdgeWrapping;
  allTextures.push(contactShadow);

  // Soft rectangular directional ground shadow for bunkers, walls & structures
  const rshCanvas = document.createElement('canvas');
  rshCanvas.width = 128;
  rshCanvas.height = 128;
  const rshCtx = rshCanvas.getContext('2d')!;
  rshCtx.clearRect(0, 0, 128, 128);
  rshCtx.filter = 'blur(10px)';
  rshCtx.fillStyle = 'rgba(10, 20, 8, 0.76)';
  rshCtx.fillRect(18, 18, 92, 92);
  const softRectShadow = configureTexture(new THREE.CanvasTexture(rshCanvas), false, 1, 1, 1);
  softRectShadow.wrapS = THREE.ClampToEdgeWrapping;
  softRectShadow.wrapT = THREE.ClampToEdgeWrapping;
  allTextures.push(softRectShadow);

  return {
    turfColor,
    turfBump,
    outerTerrainColor,
    woodColor,
    woodBump,
    crateTopColor,
    bunkerColor,
    bunkerBump,
    stoneColor,
    stoneBump,
    splatTextures,
    contactShadow,
    softRectShadow,
    dispose: () => {
      allTextures.forEach((t) => t.dispose());
    },
  };
}
