import * as THREE from 'three';
import { ARENA_HALF_D, ARENA_HALF_W, BASE_POSITIONS, POWERUP_META } from './arenaData';
import type { ProceduralTextureSet } from './textures';
import type { ArenaObstacle, PowerupDropState, PowerupKind, TeamId, UnitRole } from './types';

export const TEAM_PALETTE: Record<
  TeamId,
  {
    primary: number;
    bright: number;
    dark: number;
    paintHex: number;
    accentHex: string;
    emissive: number;
  }
> = {
  cobalt: {
    primary: 0x1d63ed,
    bright: 0x38bdf8,
    dark: 0x12326e,
    paintHex: 0x1c74ff,
    accentHex: '#38BDF8',
    emissive: 0x0d3a8a,
  },
  crimson: {
    primary: 0xe6452e,
    bright: 0xfb923c,
    dark: 0x7c1d15,
    paintHex: 0xff3b26,
    accentHex: '#FB923C',
    emissive: 0x7a1c12,
  },
};

export interface PaintballerRig {
  root: THREE.Group;
  bodyPivot: THREE.Group;
  upperBody: THREE.Group;
  leftLeg: THREE.Group;
  rightLeg: THREE.Group;
  weaponGroup: THREE.Group;
  muzzlePoint: THREE.Object3D;
  muzzleFlash: THREE.Mesh;
  flagSocket: THREE.Object3D;
  telegraphRing: THREE.Mesh;
  playerRing: THREE.Mesh | null;
  shieldAura: THREE.Mesh;
  buffRing: THREE.Mesh;
  stunEffectGroup: THREE.Group;
  hitFlashMaterials: THREE.MeshStandardMaterial[];
  baseEmissives: THREE.Color[];
  hpBarBg: THREE.Mesh;
  hpBarFill: THREE.Mesh;
}

export interface FlagRig {
  root: THREE.Group;
  clothMesh: THREE.Mesh;
  clothBasePositions: Float32Array;
  beaconRing: THREE.Mesh;
}

function createTeamBannerTexture(team: TeamId): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 160;
  const ctx = canvas.getContext('2d')!;

  const isCobalt = team === 'cobalt';
  ctx.fillStyle = isCobalt ? '#1854D6' : '#DC3A24';
  ctx.fillRect(0, 0, 256, 160);

  ctx.fillStyle = isCobalt ? '#0E348A' : '#8D1E12';
  ctx.beginPath();
  ctx.moveTo(0, 160);
  ctx.lineTo(105, 0);
  ctx.lineTo(155, 0);
  ctx.lineTo(50, 160);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = isCobalt ? '#7DD3FC' : '#FDBA74';
  ctx.lineWidth = 10;
  ctx.strokeRect(8, 8, 240, 144);

  ctx.fillStyle = '#F8FAFC';
  ctx.beginPath();
  if (isCobalt) {
    ctx.moveTo(138, 26);
    ctx.lineTo(94, 84);
    ctx.lineTo(126, 84);
    ctx.lineTo(116, 134);
    ctx.lineTo(164, 72);
    ctx.lineTo(132, 72);
    ctx.closePath();
  } else {
    ctx.moveTo(86, 126);
    ctx.lineTo(102, 42);
    ctx.lineTo(128, 76);
    ctx.lineTo(154, 42);
    ctx.lineTo(170, 126);
    ctx.lineTo(148, 126);
    ctx.lineTo(142, 86);
    ctx.lineTo(128, 108);
    ctx.lineTo(114, 86);
    ctx.lineTo(108, 126);
    ctx.closePath();
  }
  ctx.fill();

  ctx.fillStyle = 'rgba(0,0,0,0.08)';
  for (let y = 0; y < 160; y += 6) {
    ctx.fillRect(0, y, 256, 1);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Helper: Adds a soft directional baked ground shadow aligned with the golden afternoon sun
 * (sun sits at -X, +Y, +Z -> shadows cast cleanly toward +X, -Z).
 */
function addDirectionalGroundShadow(
  parent: THREE.Group,
  width: number,
  depth: number,
  height: number,
  shadowTex: THREE.CanvasTexture,
  opacity = 0.44,
): void {
  const shiftX = height * 0.46;
  const shiftZ = -height * 0.36;
  const sw = width + height * 0.55;
  const sd = depth + height * 0.45;
  const mat = new THREE.MeshBasicMaterial({
    map: shadowTex,
    transparent: true,
    opacity,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(sw, sd), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(shiftX * 0.55, 0.014, shiftZ * 0.55);
  parent.add(mesh);
}

/**
 * Builds a composite 12+ part articulated 3D paintball player/NPC character
 * with crisp top-down silhouette readability and glowing paintball hopper.
 */
export function createPaintballerRig(
  team: TeamId,
  role: UnitRole,
  isPlayer: boolean,
  contactShadowTex: THREE.CanvasTexture,
): PaintballerRig {
  const palette = TEAM_PALETTE[team];
  const root = new THREE.Group();
  const bodyPivot = new THREE.Group();
  root.add(bodyPivot);

  const hitFlashMaterials: THREE.MeshStandardMaterial[] = [];
  const baseEmissives: THREE.Color[] = [];

  const trackMat = (mat: THREE.MeshStandardMaterial) => {
    hitFlashMaterials.push(mat);
    baseEmissives.push(mat.emissive.clone());
    return mat;
  };

  const undersuitMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x252c36,
      roughness: 0.85,
      metalness: 0.06,
    }),
  );
  const armorMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: palette.primary,
      roughness: 0.38,
      metalness: 0.14,
    }),
  );
  const trimMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: isPlayer ? 0xf8fafc : palette.bright,
      roughness: 0.3,
      metalness: 0.22,
    }),
  );
  const darkGearMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x181e26,
      roughness: 0.7,
      metalness: 0.2,
    }),
  );
  const visorMat = new THREE.MeshPhysicalMaterial({
    color: isPlayer ? 0x102238 : 0x121822,
    roughness: 0.08,
    metalness: 0.45,
    clearcoat: 1.0,
    clearcoatRoughness: 0.08,
    emissive: isPlayer ? 0x2563eb : palette.dark,
    emissiveIntensity: isPlayer ? 0.5 : 0.32,
  });
  const gunMetalMat = new THREE.MeshStandardMaterial({
    color: 0x444d59,
    roughness: 0.22,
    metalness: 0.84,
  });
  const brassMat = new THREE.MeshStandardMaterial({
    color: 0xe0b252,
    roughness: 0.25,
    metalness: 0.88,
  });

  // 1. Contact shadow disc + subtle directional sun offset shadow
  const shadowGeo = new THREE.CircleGeometry(role === 'heavy' ? 0.92 : 0.78, 20);
  const shadowMat = new THREE.MeshBasicMaterial({
    map: contactShadowTex,
    transparent: true,
    opacity: 0.76,
    depthWrite: false,
  });
  const shadowDisc = new THREE.Mesh(shadowGeo, shadowMat);
  shadowDisc.rotation.x = -Math.PI / 2;
  shadowDisc.position.set(0.16, 0.02, -0.12);
  root.add(shadowDisc);

  // Team identification ground ring (golden-cream double ring for player)
  let playerRing: THREE.Mesh | null = null;
  const ringGeo = new THREE.RingGeometry(
    isPlayer ? 0.72 : 0.54,
    isPlayer ? 0.9 : 0.64,
    28,
  );
  const ringMat = new THREE.MeshBasicMaterial({
    color: isPlayer ? 0xfef08a : palette.bright,
    transparent: true,
    opacity: isPlayer ? 0.92 : 0.48,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const teamRing = new THREE.Mesh(ringGeo, ringMat);
  teamRing.rotation.x = -Math.PI / 2;
  teamRing.position.y = 0.032;
  root.add(teamRing);
  if (isPlayer) playerRing = teamRing;

  // Heavy attack telegraph ground ring
  const teleGeo = new THREE.RingGeometry(0.88, 1.18, 24);
  const teleMat = new THREE.MeshBasicMaterial({
    color: 0xfacc15,
    transparent: true,
    opacity: 0.9,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const telegraphRing = new THREE.Mesh(teleGeo, teleMat);
  telegraphRing.rotation.x = -Math.PI / 2;
  telegraphRing.position.y = 0.04;
  telegraphRing.visible = false;
  root.add(telegraphRing);

  const scaleFactor = role === 'heavy' ? 1.14 : role === 'striker' ? 0.98 : 1.04;
  bodyPivot.scale.setScalar(scaleFactor);

  // 2. Articulated Legs
  const makeLeg = (xOff: number) => {
    const leg = new THREE.Group();
    leg.position.set(xOff, 0.58, 0);

    const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.095, 0.42, 10), undersuitMat);
    thigh.position.y = -0.2;
    thigh.castShadow = true;
    leg.add(thigh);

    const kneePad = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.14, 0.15), armorMat);
    kneePad.position.set(0, -0.26, 0.07);
    kneePad.castShadow = true;
    leg.add(kneePad);

    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.28), darkGearMat);
    boot.position.set(0, -0.48, 0.05);
    boot.castShadow = true;
    leg.add(boot);

    return leg;
  };
  const leftLeg = makeLeg(-0.17);
  const rightLeg = makeLeg(0.17);
  bodyPivot.add(leftLeg, rightLeg);

  // 3. Upper Body Group
  const upperBody = new THREE.Group();
  upperBody.position.y = 0.62;
  bodyPivot.add(upperBody);

  const belt = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.14, 0.36), darkGearMat);
  belt.position.y = 0.04;
  belt.castShadow = true;
  upperBody.add(belt);

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.54, 0.34), undersuitMat);
  torso.position.y = 0.36;
  torso.castShadow = true;
  torso.receiveShadow = true;
  upperBody.add(torso);

  const chestPlate = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.42, 0.4), armorMat);
  chestPlate.position.y = 0.39;
  chestPlate.castShadow = true;
  chestPlate.receiveShadow = true;
  upperBody.add(chestPlate);

  // Bright top-readable shoulder yoke & chest stripe
  const chestStripe = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.1, 0.43), trimMat);
  chestStripe.position.y = 0.52;
  upperBody.add(chestStripe);

  // Shoulder pauldrons with bright top accent cap for unmistakable top-down separation
  const pauldronSize = role === 'heavy' ? [0.28, 0.24, 0.38] : [0.2, 0.18, 0.3];
  for (const side of [-1, 1]) {
    const pad = new THREE.Mesh(
      new THREE.BoxGeometry(pauldronSize[0], pauldronSize[1], pauldronSize[2]),
      role === 'heavy' ? armorMat : darkGearMat,
    );
    pad.position.set(side * (role === 'heavy' ? 0.4 : 0.35), 0.54, 0);
    pad.rotation.z = -side * 0.22;
    pad.castShadow = true;
    upperBody.add(pad);

    const padCap = new THREE.Mesh(
      new THREE.BoxGeometry(pauldronSize[0] * 0.9, 0.055, pauldronSize[2] * 0.92),
      trimMat,
    );
    padCap.position.set(side * (role === 'heavy' ? 0.4 : 0.35), 0.64, 0);
    padCap.rotation.z = -side * 0.22;
    upperBody.add(padCap);
  }

  // Rear HPA Compressed Air Tank & Harness Pack
  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.4, 0.2), darkGearMat);
  pack.position.set(0, 0.4, -0.24);
  pack.castShadow = true;
  upperBody.add(pack);

  const tankGeo = new THREE.CylinderGeometry(0.085, 0.085, 0.38, 12);
  if (role === 'heavy') {
    for (const tx of [-0.11, 0.11]) {
      const tank = new THREE.Mesh(tankGeo, gunMetalMat);
      tank.position.set(tx, 0.42, -0.34);
      tank.castShadow = true;
      upperBody.add(tank);
      const reg = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.08, 8), brassMat);
      reg.position.set(tx, 0.63, -0.34);
      upperBody.add(reg);
    }
  } else {
    const tank = new THREE.Mesh(tankGeo, gunMetalMat);
    tank.position.set(0, 0.42, -0.33);
    tank.castShadow = true;
    upperBody.add(tank);
    const reg = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.08, 8), brassMat);
    reg.position.set(0, 0.63, -0.33);
    upperBody.add(reg);
  }

  if (role === 'striker') {
    for (const px of [-0.14, 0.14]) {
      const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.28, 10), trimMat);
      pod.position.set(px, 0.2, -0.34);
      pod.rotation.z = px > 0 ? -0.32 : 0.32;
      upperBody.add(pod);
    }
  } else if (role === 'defender') {
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.72, 8), gunMetalMat);
    mast.position.set(-0.18, 0.86, -0.26);
    upperBody.add(mast);
    const tip = new THREE.Mesh(
      new THREE.SphereGeometry(0.065, 10, 10),
      new THREE.MeshStandardMaterial({
        color: palette.bright,
        emissive: palette.primary,
        emissiveIntensity: 0.85,
        roughness: 0.2,
      }),
    );
    tip.position.set(-0.18, 1.24, -0.26);
    upperBody.add(tip);
  }

  // 4. Sculpted Paintball Helmet & Glossy Tinted Visor Mask
  const headGroup = new THREE.Group();
  headGroup.position.set(0, 0.85, 0.02);
  upperBody.add(headGroup);

  const helmetShell = new THREE.Mesh(new THREE.SphereGeometry(0.25, 16, 14), armorMat);
  helmetShell.scale.set(1.0, 0.96, 1.08);
  helmetShell.castShadow = true;
  headGroup.add(helmetShell);

  const jawMask = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.18, 0.26), darkGearMat);
  jawMask.position.set(0, -0.1, 0.11);
  jawMask.castShadow = true;
  headGroup.add(jawMask);

  const visor = new THREE.Mesh(
    new THREE.CylinderGeometry(0.242, 0.242, 0.14, 16, 1, false, -Math.PI * 0.38, Math.PI * 0.76),
    visorMat,
  );
  visor.position.set(0, 0.01, 0.04);
  headGroup.add(visor);

  const crest = new THREE.Mesh(
    new THREE.BoxGeometry(0.09, isPlayer ? 0.12 : 0.07, 0.4),
    isPlayer ? new THREE.MeshStandardMaterial({ color: 0xfef08a, roughness: 0.22, metalness: 0.35 }) : trimMat,
  );
  crest.position.set(0, 0.23, -0.02);
  headGroup.add(crest);

  // 5. Articulated Arms + Composite 6-Part Paintball Marker (Gun)
  const weaponGroup = new THREE.Group();
  weaponGroup.position.set(0.28, 0.44, 0.24);
  upperBody.add(weaponGroup);

  const rightArm = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.36), undersuitMat);
  rightArm.position.set(0.04, -0.04, -0.14);
  rightArm.castShadow = true;
  weaponGroup.add(rightArm);

  const leftArm = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.44), undersuitMat);
  leftArm.position.set(-0.28, -0.05, 0.04);
  leftArm.rotation.y = 0.62;
  leftArm.castShadow = true;
  weaponGroup.add(leftArm);

  const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.15, 0.46), gunMetalMat);
  receiver.position.set(0, 0, 0.14);
  receiver.castShadow = true;
  weaponGroup.add(receiver);

  const shroud = new THREE.Mesh(new THREE.BoxGeometry(0.135, 0.065, 0.3), armorMat);
  shroud.position.set(0, 0.03, 0.22);
  weaponGroup.add(shroud);

  const barrelLen = role === 'heavy' ? 0.6 : 0.52;
  const barrel = new THREE.Mesh(
    new THREE.CylinderGeometry(0.036, 0.04, barrelLen, 10),
    gunMetalMat,
  );
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.02, 0.34 + barrelLen * 0.5);
  barrel.castShadow = true;
  weaponGroup.add(barrel);

  const muzzleTip = new THREE.Mesh(
    new THREE.CylinderGeometry(0.048, 0.044, 0.11, 10),
    trimMat,
  );
  muzzleTip.rotation.x = Math.PI / 2;
  muzzleTip.position.set(0, 0.02, 0.34 + barrelLen);
  weaponGroup.add(muzzleTip);

  // Iconic top-mounted Paintball Hopper with glowing team paintball dome!
  const hopperNeck = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.1, 8), darkGearMat);
  hopperNeck.position.set(0.03, 0.11, 0.2);
  hopperNeck.rotation.z = -0.25;
  weaponGroup.add(hopperNeck);

  const hopperShell = new THREE.Mesh(
    new THREE.SphereGeometry(role === 'heavy' ? 0.14 : 0.115, 12, 10),
    darkGearMat,
  );
  hopperShell.scale.set(0.88, 0.9, 1.42);
  hopperShell.position.set(0.05, 0.22, 0.18);
  hopperShell.castShadow = true;
  weaponGroup.add(hopperShell);

  const hopperLid = new THREE.Mesh(
    new THREE.SphereGeometry(role === 'heavy' ? 0.095 : 0.08, 10, 8),
    new THREE.MeshStandardMaterial({
      color: palette.paintHex,
      emissive: palette.primary,
      emissiveIntensity: 0.65,
      roughness: 0.18,
    }),
  );
  hopperLid.scale.set(0.95, 0.55, 1.35);
  hopperLid.position.set(0.05, 0.3, 0.18);
  weaponGroup.add(hopperLid);

  const stockTank = new THREE.Mesh(new THREE.CylinderGeometry(0.046, 0.046, 0.26, 10), brassMat);
  stockTank.rotation.x = Math.PI / 2;
  stockTank.position.set(0, -0.09, -0.05);
  weaponGroup.add(stockTank);

  const muzzlePoint = new THREE.Object3D();
  muzzlePoint.position.set(0, 0.02, 0.44 + barrelLen);
  weaponGroup.add(muzzlePoint);

  // Dynamic paint-burst muzzle flash mesh (briefly pops on shot!)
  const muzzleFlash = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.24, 0),
    new THREE.MeshBasicMaterial({
      color: palette.bright,
      transparent: true,
      opacity: 0.92,
    }),
  );
  muzzleFlash.position.copy(muzzlePoint.position);
  muzzleFlash.visible = false;
  weaponGroup.add(muzzleFlash);

  const flagSocket = new THREE.Object3D();
  flagSocket.position.set(0, 0.72, -0.34);
  upperBody.add(flagSocket);

  const hpBarBg = new THREE.Mesh(
    new THREE.PlaneGeometry(0.98, 0.14),
    new THREE.MeshBasicMaterial({
      color: 0x0b1016,
      transparent: true,
      opacity: 0.82,
      depthTest: false,
    }),
  );
  hpBarBg.position.set(0, 2.34, 0);
  hpBarBg.renderOrder = 20;
  root.add(hpBarBg);

  const hpBarFill = new THREE.Mesh(
    new THREE.PlaneGeometry(0.9, 0.085),
    new THREE.MeshBasicMaterial({
      color: isPlayer ? 0x38bdf8 : palette.bright,
      depthTest: false,
    }),
  );
  hpBarFill.position.set(0, 0, 0.01);
  hpBarFill.renderOrder = 21;
  hpBarBg.add(hpBarFill);
  hpBarBg.visible = false;

  // Translucent Kevlar Shield energy dome + active powerup aura ring
  const shieldAura = new THREE.Mesh(
    new THREE.IcosahedronGeometry(1.08, 1),
    new THREE.MeshBasicMaterial({
      color: 0x22d3ee,
      transparent: true,
      opacity: 0.24,
      wireframe: false,
      depthWrite: false,
    }),
  );
  shieldAura.position.set(0, 1.05, 0);
  shieldAura.visible = false;
  const shieldWire = new THREE.Mesh(
    new THREE.IcosahedronGeometry(1.1, 1),
    new THREE.MeshBasicMaterial({
      color: 0x67e8f9,
      transparent: true,
      opacity: 0.45,
      wireframe: true,
      depthWrite: false,
    }),
  );
  shieldAura.add(shieldWire);
  root.add(shieldAura);

  const buffRing = new THREE.Mesh(
    new THREE.RingGeometry(0.92, 1.06, 28),
    new THREE.MeshBasicMaterial({
      color: 0x10b981,
      transparent: true,
      opacity: 0.78,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  buffRing.rotation.x = -Math.PI / 2;
  buffRing.position.y = 0.044;
  buffRing.visible = false;
  root.add(buffRing);

  // Electric Stun Shockwave status rig: spinning overhead halo + orbiting spark nodes + ground stun lock ring
  const stunEffectGroup = new THREE.Group();
  const stunHalo = new THREE.Mesh(
    new THREE.TorusGeometry(0.46, 0.042, 8, 24),
    new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.94,
    }),
  );
  stunHalo.rotation.x = Math.PI / 2;
  stunHalo.position.y = 2.04;
  stunEffectGroup.add(stunHalo);

  const stunSparkGeo = new THREE.OctahedronGeometry(0.11, 0);
  const stunSparkMat = new THREE.MeshBasicMaterial({
    color: 0xfef08a,
  });
  for (let i = 0; i < 3; i++) {
    const ang = (i * Math.PI * 2) / 3;
    const spark = new THREE.Mesh(stunSparkGeo, stunSparkMat);
    spark.position.set(Math.cos(ang) * 0.54, 2.04, Math.sin(ang) * 0.54);
    stunEffectGroup.add(spark);
  }

  const stunGroundRing = new THREE.Mesh(
    new THREE.RingGeometry(0.84, 1.06, 28),
    new THREE.MeshBasicMaterial({
      color: 0x22d3ee,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  stunGroundRing.rotation.x = -Math.PI / 2;
  stunGroundRing.position.y = 0.056;
  stunEffectGroup.add(stunGroundRing);

  stunEffectGroup.visible = false;
  root.add(stunEffectGroup);

  return {
    root,
    bodyPivot,
    upperBody,
    leftLeg,
    rightLeg,
    weaponGroup,
    muzzlePoint,
    muzzleFlash,
    flagSocket,
    telegraphRing,
    playerRing,
    shieldAura,
    buffRing,
    stunEffectGroup,
    hitFlashMaterials,
    baseEmissives,
    hpBarBg,
    hpBarFill,
  };
}

/**
 * Creates an animated waving 3D cloth flag on a metallic tournament flagpole.
 */
export function createFlagRig(team: TeamId): FlagRig {
  const palette = TEAM_PALETTE[team];
  const root = new THREE.Group();

  const poleMat = new THREE.MeshStandardMaterial({
    color: 0xdce2ea,
    roughness: 0.2,
    metalness: 0.9,
  });
  const finialMat = new THREE.MeshStandardMaterial({
    color: 0xeab94e,
    roughness: 0.22,
    metalness: 0.88,
  });

  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.058, 3.85, 12), poleMat);
  pole.position.y = 1.92;
  pole.castShadow = true;
  root.add(pole);

  const finial = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 12), finialMat);
  finial.position.y = 3.92;
  root.add(finial);

  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.1, 12), finialMat);
  collar.position.y = 3.75;
  root.add(collar);

  const clothGeo = new THREE.PlaneGeometry(1.9, 1.12, 14, 6);
  clothGeo.translate(1.9 * 0.5 + 0.04, 0, 0);
  const clothBasePositions = new Float32Array(clothGeo.attributes.position.array);

  const bannerTex = createTeamBannerTexture(team);
  const clothMat = new THREE.MeshStandardMaterial({
    map: bannerTex,
    color: 0xffffff,
    roughness: 0.56,
    metalness: 0.05,
    side: THREE.DoubleSide,
    emissive: palette.emissive,
    emissiveIntensity: 0.22,
  });
  const clothMesh = new THREE.Mesh(clothGeo, clothMat);
  clothMesh.position.y = 3.15;
  clothMesh.castShadow = true;
  root.add(clothMesh);

  const beaconGeo = new THREE.RingGeometry(0.95, 1.32, 32);
  const beaconMat = new THREE.MeshBasicMaterial({
    color: palette.bright,
    transparent: true,
    opacity: 0.78,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const beaconRing = new THREE.Mesh(beaconGeo, beaconMat);
  beaconRing.rotation.x = -Math.PI / 2;
  beaconRing.position.y = 0.06;
  root.add(beaconRing);

  return {
    root,
    clothMesh,
    clothBasePositions,
    beaconRing,
  };
}

export function updateFlagClothWave(rig: FlagRig, elapsed: number, windBoost = 1): void {
  const posAttr = rig.clothMesh.geometry.attributes.position as THREE.BufferAttribute;
  const base = rig.clothBasePositions;
  const arr = posAttr.array as Float32Array;

  for (let i = 0; i < posAttr.count; i++) {
    const bx = base[i * 3];
    const by = base[i * 3 + 1];
    const factor = Math.max(0, bx / 1.9);
    const wave1 = Math.sin(elapsed * 5.2 * windBoost - bx * 3.0 + by * 0.8) * 0.2 * factor;
    const wave2 = Math.cos(elapsed * 8.4 * windBoost - bx * 5.2) * 0.06 * factor * factor;
    arr[i * 3] = bx - factor * factor * 0.065;
    arr[i * 3 + 1] = by + wave2 * 0.5;
    arr[i * 3 + 2] = wave1 + wave2;
  }
  posAttr.needsUpdate = true;
  rig.clothMesh.geometry.computeVertexNormals();
}

/**
 * Heroic Multi-Part Stone & Steel Base Fort Pedestal + Trussed Team Archway + Beacon Lamps.
 */
export function createBaseFort(team: TeamId, textures: ProceduralTextureSet): THREE.Group {
  const palette = TEAM_PALETTE[team];
  const group = new THREE.Group();
  const basePos = BASE_POSITIONS[team];
  group.position.set(basePos.x, 0, basePos.z);

  const stoneMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: textures.stoneColor,
    bumpMap: textures.stoneBump,
    bumpScale: 0.06,
    roughness: 0.84,
    metalness: 0.05,
  });
  const teamMetalMat = new THREE.MeshStandardMaterial({
    color: palette.primary,
    roughness: 0.34,
    metalness: 0.46,
  });
  const darkSteelMat = new THREE.MeshStandardMaterial({
    color: 0x262d36,
    roughness: 0.38,
    metalness: 0.72,
  });
  const trimGlowMat = new THREE.MeshStandardMaterial({
    color: palette.bright,
    emissive: palette.primary,
    emissiveIntensity: 0.72,
    roughness: 0.2,
    metalness: 0.2,
  });

  // Baked directional ground shadow under plinth & arch columns
  addDirectionalGroundShadow(group, 5.2, 7.2, 2.8, textures.softRectShadow, 0.36);

  // Stepped octagonal flag plinth
  const lowerPlinth = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.85, 0.14, 8), stoneMat);
  lowerPlinth.position.y = 0.07;
  lowerPlinth.receiveShadow = true;
  group.add(lowerPlinth);

  const midRing = new THREE.Mesh(new THREE.CylinderGeometry(1.92, 2.04, 0.06, 8), darkSteelMat);
  midRing.position.y = 0.15;
  group.add(midRing);

  const upperRing = new THREE.Mesh(new THREE.CylinderGeometry(1.48, 1.62, 0.08, 8), teamMetalMat);
  upperRing.position.y = 0.19;
  upperRing.receiveShadow = true;
  group.add(upperRing);

  const socket = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.38, 0.26, 12), darkSteelMat);
  socket.position.y = 0.28;
  socket.castShadow = true;
  group.add(socket);

  // Glowing Capture Zone Ring
  const zoneRing = new THREE.Mesh(
    new THREE.RingGeometry(2.75, 3.08, 36),
    new THREE.MeshBasicMaterial({
      color: palette.bright,
      transparent: true,
      opacity: 0.64,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  zoneRing.rotation.x = -Math.PI / 2;
  zoneRing.position.y = 0.032;
  group.add(zoneRing);

  // Trussed Overhead Tournament Arch Frame
  for (const side of [-1, 1]) {
    const col = new THREE.Mesh(new THREE.BoxGeometry(0.46, 4.6, 0.46), darkSteelMat);
    col.position.set(0, 2.3, side * 3.15);
    col.castShadow = true;
    col.receiveShadow = true;
    group.add(col);

    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.56, 0.84), stoneMat);
    foot.position.set(0, 0.28, side * 3.15);
    foot.castShadow = true;
    group.add(foot);

    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.5, 2.9, 0.16), trimGlowMat);
    strip.position.set(0, 2.4, side * 3.15);
    group.add(strip);

    // Diagonal knee brace connecting column to top beam
    const brace = new THREE.Mesh(new THREE.BoxGeometry(0.24, 1.35, 0.24), darkSteelMat);
    brace.position.set(0, 3.95, side * 2.55);
    brace.rotation.x = side * 0.72;
    group.add(brace);

    // Glowing team beacon lantern atop each arch pillar
    const lampCap = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.24, 10), trimGlowMat);
    lampCap.position.set(0, 4.82, side * 3.15);
    group.add(lampCap);
  }

  const topBeam = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.46, 7.0), darkSteelMat);
  topBeam.position.set(0, 4.55, 0);
  topBeam.castShadow = true;
  group.add(topBeam);

  const signBoard = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.62, 3.7), teamMetalMat);
  signBoard.position.set(0, 4.62, 0);
  signBoard.castShadow = true;
  group.add(signBoard);

  const signStripe = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.16, 3.35), trimGlowMat);
  signStripe.position.set(0, 4.62, 0);
  group.add(signStripe);

  return group;
}

/**
 * Creates sculptural, grounded multi-part 3D cover structures with baked directional shadows.
 */
export function createObstacleMesh(
  ob: ArenaObstacle,
  textures: ProceduralTextureSet,
): THREE.Group {
  const group = new THREE.Group();
  group.position.set(ob.x, 0, ob.z);

  // Every obstacle casts a grounded directional shadow on the turf (visible on both GPU & software WebGL)
  addDirectionalGroundShadow(group, ob.width, ob.depth, ob.height, textures.softRectShadow, 0.46);

  const accentColor =
    ob.accent === 'cobalt'
      ? TEAM_PALETTE.cobalt.primary
      : ob.accent === 'crimson'
        ? TEAM_PALETTE.crimson.primary
        : 0xe6a119; // rich tournament amber-gold for center midfield

  const brightAccent =
    ob.accent === 'cobalt'
      ? TEAM_PALETTE.cobalt.bright
      : ob.accent === 'crimson'
        ? TEAM_PALETTE.crimson.bright
        : 0xfacc15;

  if (ob.kind === 'bunker_inflatable') {
    // Sleek sculpted charcoal-slate speedball Temple/Dorito cover pod with tapered pyramid frustum silhouette
    const pvcMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: textures.bunkerColor,
      bumpMap: textures.bunkerBump,
      bumpScale: 0.05,
      roughness: 0.56,
      metalness: 0.08,
    });
    const bandMat = new THREE.MeshStandardMaterial({
      color: accentColor,
      roughness: 0.36,
      metalness: 0.14,
    });
    const brightTrimMat = new THREE.MeshStandardMaterial({
      color: brightAccent,
      roughness: 0.3,
      metalness: 0.18,
    });
    const skirtMat = new THREE.MeshStandardMaterial({
      color: 0x1d2228,
      roughness: 0.86,
      metalness: 0.08,
    });

    // Heavy rubberized perimeter anchor apron
    const skirt = new THREE.Mesh(
      new THREE.BoxGeometry(ob.width + 0.14, 0.22, ob.depth + 0.14),
      skirtMat,
    );
    skirt.position.y = 0.11;
    skirt.castShadow = true;
    skirt.receiveShadow = true;
    group.add(skirt);

    // Tapered 4-sided speedball pod body (CylinderGeometry with 4 radial segments rotated 45 deg!)
    const diagW = ob.width * 0.707;
    const diagD = ob.depth * 0.707;
    const podGeo = new THREE.CylinderGeometry(0.68, 1.0, ob.height - 0.22, 4, 1);
    podGeo.rotateY(Math.PI / 4);
    podGeo.scale(diagW, 1, diagD);
    const pod = new THREE.Mesh(podGeo, pvcMat);
    pod.position.y = 0.22 + (ob.height - 0.22) * 0.5;
    pod.castShadow = true;
    pod.receiveShadow = true;
    group.add(pod);

    // Bold athletic team/gold tapered racing band around waist
    const bandGeo = new THREE.CylinderGeometry(0.84, 0.91, 0.32, 4, 1);
    bandGeo.rotateY(Math.PI / 4);
    bandGeo.scale(diagW * 1.015, 1, diagD * 1.015);
    const band = new THREE.Mesh(bandGeo, bandMat);
    band.position.y = 0.22 + (ob.height - 0.22) * 0.38;
    group.add(band);

    // Sculpted inflated crown cushion on top with bright team inlay
    const crown = new THREE.Mesh(
      new THREE.BoxGeometry(ob.width * 0.62, 0.14, ob.depth * 0.62),
      bandMat,
    );
    crown.position.y = ob.height + 0.02;
    crown.castShadow = true;
    group.add(crown);

    const crownInlay = new THREE.Mesh(
      new THREE.BoxGeometry(ob.width * 0.44, 0.06, ob.depth * 0.44),
      brightTrimMat,
    );
    crownInlay.position.y = ob.height + 0.09;
    group.add(crownInlay);

    // Corner anchor sandbags + tie-down stakes
    const bagMat = new THREE.MeshStandardMaterial({ color: 0x8b7e66, roughness: 0.92, metalness: 0 });
    const bagGeo = new THREE.SphereGeometry(0.24, 8, 6);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const bag = new THREE.Mesh(bagGeo, bagMat);
        bag.scale.set(1.25, 0.55, 0.85);
        bag.position.set(sx * (ob.width * 0.5 + 0.06), 0.11, sz * (ob.depth * 0.5 + 0.06));
        bag.rotation.y = sx * sz * 0.7;
        group.add(bag);
      }
    }
  } else if (ob.kind === 'timber_wall') {
    const woodMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: textures.woodColor,
      bumpMap: textures.woodBump,
      bumpScale: 0.07,
      roughness: 0.84,
      metalness: 0.04,
    });
    const postMat = new THREE.MeshStandardMaterial({
      color: 0x5c3c22,
      roughness: 0.88,
      metalness: 0.04,
    });
    const bracketMat = new THREE.MeshStandardMaterial({
      color: 0x2c323a,
      roughness: 0.34,
      metalness: 0.76,
    });
    const stripeMat = new THREE.MeshStandardMaterial({
      color: accentColor,
      roughness: 0.42,
      metalness: 0.14,
    });

    const wall = new THREE.Mesh(
      new THREE.BoxGeometry(ob.width - 0.16, ob.height - 0.22, ob.depth * 0.62),
      woodMat,
    );
    wall.position.y = (ob.height - 0.22) * 0.5;
    wall.castShadow = true;
    wall.receiveShadow = true;
    group.add(wall);

    const rail = new THREE.Mesh(
      new THREE.BoxGeometry(ob.width + 0.12, 0.2, ob.depth * 0.92),
      postMat,
    );
    rail.position.y = ob.height - 0.12;
    rail.castShadow = true;
    group.add(rail);

    // Top painted metallic edge strip for clean top-down readability
    const topEdge = new THREE.Mesh(
      new THREE.BoxGeometry(ob.width * 0.82, 0.06, 0.22),
      stripeMat,
    );
    topEdge.position.y = ob.height;
    group.add(topEdge);

    const postCount = 3;
    for (let i = 0; i < postCount; i++) {
      const px = -ob.width * 0.46 + (i / (postCount - 1)) * (ob.width * 0.92);
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, ob.height + 0.16, ob.depth * 0.98), postMat);
      post.position.set(px, (ob.height + 0.16) * 0.5, 0);
      post.castShadow = true;
      post.receiveShadow = true;
      group.add(post);

      const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.18, ob.depth * 1.04), bracketMat);
      bracket.position.set(px, 0.38, 0);
      group.add(bracket);

      const capPlate = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.08, ob.depth * 1.02), bracketMat);
      capPlate.position.set(px, ob.height + 0.17, 0);
      group.add(capPlate);
    }

    const stencil = new THREE.Mesh(
      new THREE.BoxGeometry(ob.width * 0.64, 0.22, ob.depth * 0.66),
      stripeMat,
    );
    stencil.position.y = ob.height * 0.54;
    group.add(stencil);
  } else if (ob.kind === 'crate_stack') {
    const crateFaceMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: textures.crateTopColor,
      bumpMap: textures.woodBump,
      bumpScale: 0.06,
      roughness: 0.8,
      metalness: 0.06,
    });
    const ironMat = new THREE.MeshStandardMaterial({
      color: 0x2b323b,
      roughness: 0.34,
      metalness: 0.78,
    });
    const drumMat = new THREE.MeshStandardMaterial({
      color: accentColor,
      roughness: 0.3,
      metalness: 0.52,
    });
    const drumRimMat = new THREE.MeshStandardMaterial({
      color: brightAccent,
      roughness: 0.28,
      metalness: 0.6,
    });

    const addCrate = (cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, rotY: number) => {
      const cGroup = new THREE.Group();
      cGroup.position.set(cx, cy + sy * 0.5, cz);
      cGroup.rotation.y = rotY;
      const box = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), crateFaceMat);
      box.castShadow = true;
      box.receiveShadow = true;
      cGroup.add(box);
      // Heavy iron corner straps
      const strap = new THREE.Mesh(new THREE.BoxGeometry(sx + 0.04, 0.08, sz + 0.04), ironMat);
      strap.position.y = sy * 0.42;
      cGroup.add(strap);
      group.add(cGroup);
    };

    addCrate(-0.25, 0, -0.58, 1.42, 1.15, 1.38, 0.07);
    addCrate(0.22, 0, 0.72, 1.38, 1.05, 1.3, -0.09);
    addCrate(-0.08, 1.12, -0.22, 1.12, 0.82, 1.12, 0.22);

    // Metallic paintball supply drum with ribbed rings
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 1.18, 16), drumMat);
    drum.position.set(0.7, 0.59, -0.82);
    drum.castShadow = true;
    drum.receiveShadow = true;
    group.add(drum);

    const drumTop = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.09, 16), drumRimMat);
    drumTop.position.set(0.7, 1.16, -0.82);
    group.add(drumTop);
  } else if (ob.kind === 'fort_wall') {
    // Reinforced base bastion wing wall: weathered stone masonry + cedar timber battlement + brass rivets
    const stoneMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: textures.stoneColor,
      bumpMap: textures.stoneBump,
      bumpScale: 0.08,
      roughness: 0.84,
      metalness: 0.05,
    });
    const timberCapMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: textures.woodColor,
      bumpMap: textures.woodBump,
      bumpScale: 0.05,
      roughness: 0.82,
      metalness: 0.05,
    });
    const accentMat = new THREE.MeshStandardMaterial({
      color: accentColor,
      roughness: 0.34,
      metalness: 0.28,
    });
    const trimMat = new THREE.MeshStandardMaterial({
      color: brightAccent,
      roughness: 0.26,
      metalness: 0.42,
    });

    const baseWall = new THREE.Mesh(
      new THREE.BoxGeometry(ob.width, ob.height * 0.72, ob.depth),
      stoneMat,
    );
    baseWall.position.y = ob.height * 0.36;
    baseWall.castShadow = true;
    baseWall.receiveShadow = true;
    group.add(baseWall);

    // Weathered cedar top battlement parapet (much warmer & richer from top-down than flat black!)
    const upperShield = new THREE.Mesh(
      new THREE.BoxGeometry(ob.width * 0.86, ob.height * 0.28, ob.depth * 0.96),
      timberCapMat,
    );
    upperShield.position.y = ob.height * 0.86;
    upperShield.castShadow = true;
    group.add(upperShield);

    const crestBar = new THREE.Mesh(
      new THREE.BoxGeometry(ob.width * 0.94, 0.18, ob.depth * 1.02),
      accentMat,
    );
    crestBar.position.y = ob.height * 0.72;
    group.add(crestBar);

    const topInlay = new THREE.Mesh(
      new THREE.BoxGeometry(ob.width * 0.34, 0.07, ob.depth * 0.88),
      trimMat,
    );
    topInlay.position.y = ob.height + 0.02;
    group.add(topInlay);
  } else {
    // stone_pillar — Rear base monument monolith with cedar & team crest cap
    const stoneMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: textures.stoneColor,
      bumpMap: textures.stoneBump,
      bumpScale: 0.07,
      roughness: 0.85,
      metalness: 0.06,
    });
    const accentMat = new THREE.MeshStandardMaterial({
      color: accentColor,
      roughness: 0.34,
      metalness: 0.28,
    });
    const trimMat = new THREE.MeshStandardMaterial({
      color: brightAccent,
      roughness: 0.26,
      metalness: 0.4,
    });

    const plinth = new THREE.Mesh(new THREE.BoxGeometry(ob.width + 0.24, 0.45, ob.depth + 0.24), stoneMat);
    plinth.position.y = 0.225;
    plinth.castShadow = true;
    plinth.receiveShadow = true;
    group.add(plinth);

    const mainCol = new THREE.Mesh(new THREE.BoxGeometry(ob.width * 0.88, ob.height - 0.45, ob.depth * 0.88), stoneMat);
    mainCol.position.y = 0.45 + (ob.height - 0.45) * 0.5;
    mainCol.castShadow = true;
    mainCol.receiveShadow = true;
    group.add(mainCol);

    const band = new THREE.Mesh(new THREE.BoxGeometry(ob.width * 0.94, 0.32, ob.depth * 0.94), accentMat);
    band.position.y = ob.height - 0.3;
    group.add(band);

    const cap = new THREE.Mesh(new THREE.BoxGeometry(ob.width * 0.7, 0.14, ob.depth * 0.76), trimMat);
    cap.position.y = ob.height + 0.05;
    group.add(cap);
  }

  return group;
}

/**
 * Builds the entire sunlit Canyon Ridge outer alpine valley, tournament turf,
 * perimeter fence, corner floodlight towers, closer lush alpine pine forest, weathered granite boulders,
 * sideline team benches, and sunlit pollen motes.
 */
export function createArenaEnvironment(
  scene: THREE.Scene,
  textures: ProceduralTextureSet,
): { pollenPoints: THREE.Points; dispose: () => void } {
  const disposables: Array<{ dispose: () => void }> = [];

  // 1. Expansive Outer Alpine Valley Ground
  const valleyGeo = new THREE.PlaneGeometry(260, 220, 48, 40);
  valleyGeo.rotateX(-Math.PI / 2);
  const posAttr = valleyGeo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < posAttr.count; i++) {
    const x = posAttr.getX(i);
    const z = posAttr.getZ(i);
    const dx = Math.max(0, Math.abs(x) - (ARENA_HALF_W + 4.5));
    const dz = Math.max(0, Math.abs(z) - (ARENA_HALF_D + 4.5));
    const edgeDist = Math.hypot(dx, dz);
    if (edgeDist > 0.1) {
      const hill =
        Math.min(edgeDist * 0.22, 11.5) +
        Math.sin(x * 0.08) * Math.cos(z * 0.09) * Math.min(edgeDist * 0.12, 3.8);
      posAttr.setY(i, -0.04 + hill);
    } else {
      posAttr.setY(i, -0.04);
    }
  }
  valleyGeo.computeVertexNormals();
  const valleyMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: textures.outerTerrainColor,
    roughness: 0.94,
    metalness: 0.0,
  });
  const valleyMesh = new THREE.Mesh(valleyGeo, valleyMat);
  valleyMesh.receiveShadow = true;
  scene.add(valleyMesh);
  disposables.push(valleyGeo, valleyMat);

  // 2. Playable Mowed Tournament Turf Field
  const turfGeo = new THREE.PlaneGeometry(ARENA_HALF_W * 2, ARENA_HALF_D * 2);
  turfGeo.rotateX(-Math.PI / 2);
  const turfMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: textures.turfColor,
    bumpMap: textures.turfBump,
    bumpScale: 0.04,
    roughness: 0.88,
    metalness: 0.02,
  });
  const turfMesh = new THREE.Mesh(turfGeo, turfMat);
  turfMesh.position.y = 0;
  turfMesh.receiveShadow = true;
  scene.add(turfMesh);
  disposables.push(turfGeo, turfMat);

  // 3. Tournament Perimeter Timber Curb, Fence Posts, Spectator Dugouts & Corner Floodlight Towers
  const curbMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: textures.woodColor,
    bumpMap: textures.woodBump,
    bumpScale: 0.05,
    roughness: 0.86,
    metalness: 0.04,
  });
  const steelPostMat = new THREE.MeshStandardMaterial({
    color: 0x323a44,
    roughness: 0.4,
    metalness: 0.72,
  });
  const netMat = new THREE.MeshBasicMaterial({
    color: 0xdce6f0,
    transparent: true,
    opacity: 0.14,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  disposables.push(curbMat, steelPostMat, netMat);

  const wFull = ARENA_HALF_W * 2 + 0.6;
  const dFull = ARENA_HALF_D * 2 + 0.6;

  const northSouthCurbGeo = new THREE.BoxGeometry(wFull, 0.54, 0.48);
  const eastWestCurbGeo = new THREE.BoxGeometry(0.48, 0.54, dFull);
  disposables.push(northSouthCurbGeo, eastWestCurbGeo);

  for (const sz of [-1, 1]) {
    const curb = new THREE.Mesh(northSouthCurbGeo, curbMat);
    curb.position.set(0, 0.27, sz * (ARENA_HALF_D + 0.25));
    curb.castShadow = true;
    curb.receiveShadow = true;
    scene.add(curb);

    if (sz === -1) {
      const net = new THREE.Mesh(new THREE.PlaneGeometry(wFull, 2.2), netMat);
      net.position.set(0, 1.55, sz * (ARENA_HALF_D + 0.25));
      scene.add(net);
    }
  }
  for (const sx of [-1, 1]) {
    const curb = new THREE.Mesh(eastWestCurbGeo, curbMat);
    curb.position.set(sx * (ARENA_HALF_W + 0.25), 0.27, 0);
    curb.castShadow = true;
    curb.receiveShadow = true;
    scene.add(curb);
  }

  // Perimeter fence posts + North Sideline Team Dugout Canopies (rich tournament storytelling!)
  const postGeo = new THREE.CylinderGeometry(0.08, 0.09, 2.6, 8);
  disposables.push(postGeo);
  for (let x = -ARENA_HALF_W; x <= ARENA_HALF_W; x += 6.8) {
    const pN = new THREE.Mesh(postGeo, steelPostMat);
    pN.position.set(x, 1.3, -(ARENA_HALF_D + 0.28));
    pN.castShadow = true;
    scene.add(pN);
  }
  for (let z = -ARENA_HALF_D + 5; z <= ARENA_HALF_D - 5; z += 6.5) {
    for (const sx of [-1, 1]) {
      const p = new THREE.Mesh(postGeo, steelPostMat);
      p.position.set(sx * (ARENA_HALF_W + 0.28), 1.3, z);
      p.castShadow = true;
      scene.add(p);
    }
  }

  // Twin Sideline Tournament Dugouts outside North fence (Cobalt West & Crimson East)
  for (const team of ['cobalt', 'crimson'] as TeamId[]) {
    const dugout = new THREE.Group();
    const dx = team === 'cobalt' ? -15 : 15;
    dugout.position.set(dx, 0, -(ARENA_HALF_D + 3.2));
    addDirectionalGroundShadow(dugout, 8.2, 3.2, 2.6, textures.softRectShadow, 0.36);

    const canopyMat = new THREE.MeshStandardMaterial({
      color: TEAM_PALETTE[team].primary,
      roughness: 0.55,
      metalness: 0.1,
    });
    disposables.push(canopyMat);

    // 4 steel canopy legs
    for (const lx of [-3.6, 3.6]) {
      for (const lz of [-1.2, 1.2]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.6, 0.16), steelPostMat);
        leg.position.set(lx, 1.3, lz);
        dugout.add(leg);
      }
    }
    // Slanted canopy roof
    const roof = new THREE.Mesh(new THREE.BoxGeometry(8.0, 0.16, 3.0), canopyMat);
    roof.position.set(0, 2.68, 0);
    roof.rotation.x = 0.14;
    roof.castShadow = true;
    dugout.add(roof);
    // Cedar bench inside dugout
    const bench = new THREE.Mesh(new THREE.BoxGeometry(6.8, 0.16, 0.65), curbMat);
    bench.position.set(0, 0.55, -0.2);
    dugout.add(bench);

    scene.add(dugout);
  }

  // 4 Corner Stadium Floodlight Towers
  const lampGlowMat = new THREE.MeshStandardMaterial({
    color: 0xfff7dc,
    emissive: 0xffdf99,
    emissiveIntensity: 1.5,
    roughness: 0.2,
  });
  disposables.push(lampGlowMat);

  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const tower = new THREE.Group();
      tower.position.set(sx * (ARENA_HALF_W + 2.4), 0, sz * (ARENA_HALF_D + 2.2));
      tower.lookAt(0, 0, 0);
      addDirectionalGroundShadow(tower, 2.6, 2.6, 4.5, textures.softRectShadow, 0.38);

      const baseFoot = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.95, 1.5), steelPostMat);
      baseFoot.position.y = 0.475;
      baseFoot.castShadow = true;
      tower.add(baseFoot);

      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.38, 12.5, 8), steelPostMat);
      mast.position.y = 6.5;
      mast.castShadow = true;
      tower.add(mast);

      const crossbar = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.36, 0.45), steelPostMat);
      crossbar.position.set(0, 12.6, 0.25);
      tower.add(crossbar);

      for (const lx of [-1.1, 0, 1.1]) {
        const housing = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.55, 0.42), steelPostMat);
        housing.position.set(lx, 12.85, 0.48);
        housing.rotation.x = 0.42;
        tower.add(housing);

        const bulb = new THREE.Mesh(new THREE.PlaneGeometry(0.68, 0.42), lampGlowMat);
        bulb.position.set(lx, 12.82, 0.7);
        bulb.rotation.x = 0.42;
        tower.add(bulb);
      }

      scene.add(tower);
    }
  }

  // 4. Instanced Alpine Pine Forest (pulled closer to frame perimeter richly!)
  const treePositions: Array<{ x: number; y: number; z: number; scale: number; rot: number; tint: number }> = [];
  let seed = 1337;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  // Curated perimeter grove along North, West, and East borders so pines frame the gameplay view
  const curatedTreeCoords: Array<[number, number]> = [
    [-38.5, -21], [-39.2, -14], [-38.8, -6], [-39.4, 5], [-38.6, 13], [-38.0, 20],
    [38.5, -21], [39.2, -14], [38.8, -6], [39.4, 5], [38.6, 13], [38.0, 20],
    [-31, -26.5], [-24, -27.2], [-6.5, -26.5], [0, -27.5], [6.5, -26.5], [24, -27.2], [31, -26.5],
  ];

  const pushTree = (x: number, z: number, scaleMin = 0.85, scaleRange = 0.55) => {
    const dx = Math.max(0, Math.abs(x) - (ARENA_HALF_W + 4.5));
    const dz = Math.max(0, Math.abs(z) - (ARENA_HALF_D + 4.5));
    const edgeDist = Math.hypot(dx, dz);
    const groundY =
      -0.04 +
      Math.min(edgeDist * 0.22, 11.5) +
      Math.sin(x * 0.08) * Math.cos(z * 0.09) * Math.min(edgeDist * 0.12, 3.8);
    treePositions.push({
      x,
      y: groundY - 0.2,
      z,
      scale: scaleMin + rand() * scaleRange,
      rot: rand() * Math.PI * 2,
      tint: rand(),
    });
  };

  for (const [cx, cz] of curatedTreeCoords) {
    pushTree(cx, cz, 0.9, 0.45);
  }

  for (let i = 0; i < 115; i++) {
    const angle = rand() * Math.PI * 2;
    const radX = ARENA_HALF_W + 6.5 + rand() * 34;
    const radZ = ARENA_HALF_D + 6.5 + rand() * 28;
    const x = Math.cos(angle) * radX;
    const z = Math.sin(angle) * radZ;
    // Keep foreground camera viewing wedge on South clear
    if (z > ARENA_HALF_D + 2 && Math.abs(x) < ARENA_HALF_W + 7 && z < ARENA_HALF_D + 17) continue;
    // Keep north dugouts clear
    if (z < -(ARENA_HALF_D + 0.5) && z > -(ARENA_HALF_D + 7) && (Math.abs(x + 15) < 6 || Math.abs(x - 15) < 6)) continue;
    pushTree(x, z, 0.85, 0.65);
  }

  const count = treePositions.length;
  const trunkGeo = new THREE.CylinderGeometry(0.24, 0.42, 2.2, 7);
  trunkGeo.translate(0, 1.1, 0);
  const tier1Geo = new THREE.ConeGeometry(2.15, 3.6, 8);
  tier1Geo.translate(0, 3.4, 0);
  const tier2Geo = new THREE.ConeGeometry(1.62, 3.2, 8);
  tier2Geo.translate(0, 5.2, 0);
  const tier3Geo = new THREE.ConeGeometry(1.05, 2.6, 8);
  tier3Geo.translate(0, 6.9, 0);

  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x523620, roughness: 0.92, metalness: 0 });
  const foliageMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.84, metalness: 0.02 });
  const treeShadowMat = new THREE.MeshBasicMaterial({
    map: textures.contactShadow,
    transparent: true,
    opacity: 0.52,
    depthWrite: false,
  });
  const treeShadowGeo = new THREE.PlaneGeometry(4.6, 4.6);
  treeShadowGeo.rotateX(-Math.PI / 2);
  disposables.push(trunkGeo, tier1Geo, tier2Geo, tier3Geo, trunkMat, foliageMat, treeShadowMat, treeShadowGeo);

  const trunkInst = new THREE.InstancedMesh(trunkGeo, trunkMat, count);
  const tier1Inst = new THREE.InstancedMesh(tier1Geo, foliageMat, count);
  const tier2Inst = new THREE.InstancedMesh(tier2Geo, foliageMat, count);
  const tier3Inst = new THREE.InstancedMesh(tier3Geo, foliageMat, count);
  const treeShadowInst = new THREE.InstancedMesh(treeShadowGeo, treeShadowMat, count);
  trunkInst.castShadow = true;
  tier1Inst.castShadow = true;
  tier2Inst.castShadow = true;

  const dummy = new THREE.Object3D();
  const cTmp = new THREE.Color();
  treePositions.forEach((tp, idx) => {
    dummy.position.set(tp.x, tp.y, tp.z);
    dummy.rotation.set(0, tp.rot, 0);
    dummy.scale.setScalar(tp.scale);
    dummy.updateMatrix();
    trunkInst.setMatrixAt(idx, dummy.matrix);
    tier1Inst.setMatrixAt(idx, dummy.matrix);
    tier2Inst.setMatrixAt(idx, dummy.matrix);
    tier3Inst.setMatrixAt(idx, dummy.matrix);

    // Baked pine tree ground shadow
    dummy.position.set(tp.x + 1.1 * tp.scale, tp.y + 0.28, tp.z - 0.8 * tp.scale);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.setScalar(tp.scale);
    dummy.updateMatrix();
    treeShadowInst.setMatrixAt(idx, dummy.matrix);

    cTmp.setHSL(0.32 + (tp.tint - 0.5) * 0.04, 0.4 + tp.tint * 0.1, 0.16 + tp.tint * 0.07);
    tier1Inst.setColorAt(idx, cTmp);
    cTmp.offsetHSL(0, 0.02, 0.035);
    tier2Inst.setColorAt(idx, cTmp);
    cTmp.offsetHSL(0, 0.02, 0.045);
    tier3Inst.setColorAt(idx, cTmp);
  });
  [trunkInst, tier1Inst, tier2Inst, tier3Inst, treeShadowInst].forEach((inst) => {
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    inst.computeBoundingSphere();
    scene.add(inst);
  });

  // Weathered Slate-Moss Alpine Granite Boulders (realistic stone colors, never harsh white!)
  const rockGeo = new THREE.DodecahedronGeometry(1.45, 0);
  const rockMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    bumpMap: textures.stoneBump,
    bumpScale: 0.08,
    roughness: 0.92,
    metalness: 0.04,
    flatShading: true,
  });
  disposables.push(rockGeo, rockMat);
  const rockCount = 48;
  const rockInst = new THREE.InstancedMesh(rockGeo, rockMat, rockCount);
  for (let i = 0; i < rockCount; i++) {
    const angle = rand() * Math.PI * 2;
    const radX = ARENA_HALF_W + 4.8 + rand() * 25;
    const radZ = ARENA_HALF_D + 4.8 + rand() * 19;
    const x = Math.cos(angle) * radX;
    const z = Math.sin(angle) * radZ;
    const dx = Math.max(0, Math.abs(x) - (ARENA_HALF_W + 4.5));
    const dz = Math.max(0, Math.abs(z) - (ARENA_HALF_D + 4.5));
    const edgeDist = Math.hypot(dx, dz);
    const groundY =
      -0.04 +
      Math.min(edgeDist * 0.22, 11.5) +
      Math.sin(x * 0.08) * Math.cos(z * 0.09) * Math.min(edgeDist * 0.12, 3.8);
    dummy.position.set(x, groundY + 0.3, z);
    dummy.rotation.set(rand() * 2, rand() * 6, rand() * 2);
    dummy.scale.set(0.65 + rand() * 1.15, 0.45 + rand() * 0.65, 0.65 + rand() * 1.1);
    dummy.updateMatrix();
    rockInst.setMatrixAt(i, dummy.matrix);
    // Natural weathered alpine granite (dark slate-taupe with subtle moss tint)
    const shade = 0.26 + rand() * 0.14;
    cTmp.setRGB(shade * 0.96, shade * 1.0, shade * 0.92);
    rockInst.setColorAt(i, cTmp);
  }
  rockInst.instanceMatrix.needsUpdate = true;
  if (rockInst.instanceColor) rockInst.instanceColor.needsUpdate = true;
  rockInst.computeBoundingSphere();
  scene.add(rockInst);

  // 5. Drifting Golden Sunlit Pollen / Dust Motes
  const moteCount = 130;
  const motePos = new Float32Array(moteCount * 3);
  for (let i = 0; i < moteCount; i++) {
    motePos[i * 3] = (rand() - 0.5) * (ARENA_HALF_W * 2.2);
    motePos[i * 3 + 1] = 0.8 + rand() * 7.5;
    motePos[i * 3 + 2] = (rand() - 0.5) * (ARENA_HALF_D * 2.2);
  }
  const moteGeo = new THREE.BufferGeometry();
  moteGeo.setAttribute('position', new THREE.BufferAttribute(motePos, 3));
  const moteMat = new THREE.PointsMaterial({
    color: 0xffe8a6,
    size: 0.22,
    transparent: true,
    opacity: 0.58,
    depthWrite: false,
  });
  const pollenPoints = new THREE.Points(moteGeo, moteMat);
  scene.add(pollenPoints);
  disposables.push(moteGeo, moteMat);

  return {
    pollenPoints,
    dispose: () => {
      disposables.forEach((d) => d.dispose());
    },
  };
}

export interface PowerupDropRig {
  root: THREE.Group;
  payloadGroup: THREE.Group;
  iconPivot: THREE.Group;
  parachuteGroup: THREE.Group;
  beaconRing: THREE.Mesh;
  lightBeam: THREE.Mesh;
  padShadow: THREE.Mesh;
  dispose: () => void;
}

/**
 * Builds a high-craft multi-part 3D field powerup air-drop with glowing turf landing zone,
 * tapered vertical light beam, deployable parachute canopy, and custom rotating 3D icon.
 */
export function createPowerupDropRig(
  kind: PowerupKind,
  contactShadowTex: THREE.CanvasTexture,
): PowerupDropRig {
  const meta = POWERUP_META[kind];
  const root = new THREE.Group();
  const disposables: Array<{ dispose: () => void }> = [];
  const track = <T extends { dispose: () => void }>(item: T): T => {
    disposables.push(item);
    return item;
  };

  // 1. Grounded contact shadow & pulsing beacon landing ring
  const shadowGeo = track(new THREE.CircleGeometry(1.18, 24));
  const shadowMat = track(
    new THREE.MeshBasicMaterial({
      map: contactShadowTex,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
    }),
  );
  const padShadow = new THREE.Mesh(shadowGeo, shadowMat);
  padShadow.rotation.x = -Math.PI / 2;
  padShadow.position.y = 0.022;
  root.add(padShadow);

  const ringGeo = track(new THREE.RingGeometry(0.88, 1.12, 32));
  const ringMat = track(
    new THREE.MeshBasicMaterial({
      color: meta.glowHex,
      transparent: true,
      opacity: 0.88,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  const beaconRing = new THREE.Mesh(ringGeo, ringMat);
  beaconRing.rotation.x = -Math.PI / 2;
  beaconRing.position.y = 0.04;
  root.add(beaconRing);

  const innerPadGeo = track(new THREE.RingGeometry(0.45, 0.56, 6));
  const innerPadMat = track(
    new THREE.MeshBasicMaterial({
      color: meta.colorHex,
      transparent: true,
      opacity: 0.72,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  const innerPad = new THREE.Mesh(innerPadGeo, innerPadMat);
  innerPad.rotation.x = -Math.PI / 2;
  innerPad.position.y = 0.042;
  root.add(innerPad);

  // Subtle vertical translucent beacon shaft so drops stand out clearly even in light fog
  const beamGeo = track(new THREE.CylinderGeometry(0.32, 0.82, 5.4, 16, 1, true));
  const beamMat = track(
    new THREE.MeshBasicMaterial({
      color: meta.glowHex,
      transparent: true,
      opacity: 0.16,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  const lightBeam = new THREE.Mesh(beamGeo, beamMat);
  lightBeam.position.y = 2.75;
  root.add(lightBeam);

  // 2. Descending payload group (pedestal pod + rotating bespoke 3D powerup emblem)
  const payloadGroup = new THREE.Group();
  root.add(payloadGroup);

  const darkAlloyMat = track(
    new THREE.MeshStandardMaterial({
      color: 0x1c2532,
      roughness: 0.36,
      metalness: 0.65,
    }),
  );
  const accentMat = track(
    new THREE.MeshStandardMaterial({
      color: meta.colorHex,
      emissive: meta.colorHex,
      emissiveIntensity: 0.52,
      roughness: 0.22,
      metalness: 0.25,
    }),
  );
  const brightMat = track(
    new THREE.MeshStandardMaterial({
      color: meta.glowHex,
      emissive: meta.glowHex,
      emissiveIntensity: 0.78,
      roughness: 0.16,
      metalness: 0.18,
    }),
  );
  const chromeMat = track(
    new THREE.MeshStandardMaterial({
      color: 0xdbe5f0,
      roughness: 0.18,
      metalness: 0.88,
    }),
  );

  // Beveled hexagonal supply pod base
  const podBaseGeo = track(new THREE.CylinderGeometry(0.68, 0.78, 0.24, 6));
  const podBase = new THREE.Mesh(podBaseGeo, darkAlloyMat);
  podBase.position.y = 0.14;
  podBase.castShadow = true;
  payloadGroup.add(podBase);

  const podTrimGeo = track(new THREE.CylinderGeometry(0.56, 0.62, 0.1, 6));
  const podTrim = new THREE.Mesh(podTrimGeo, accentMat);
  podTrim.position.y = 0.28;
  payloadGroup.add(podTrim);

  // Floating rotating 3D icon centerpiece
  const iconPivot = new THREE.Group();
  iconPivot.position.y = 1.08;
  payloadGroup.add(iconPivot);

  // Equatorial orbital halo ring around icon
  const orbitGeo = track(new THREE.TorusGeometry(0.62, 0.04, 8, 24));
  const orbitRing = new THREE.Mesh(orbitGeo, brightMat);
  orbitRing.rotation.x = Math.PI * 0.38;
  iconPivot.add(orbitRing);

  if (kind === 'turbo_boots') {
    // Swept emerald double-chevron sprint thrusters
    const coreGeo = track(new THREE.OctahedronGeometry(0.32, 0));
    const core = new THREE.Mesh(coreGeo, brightMat);
    core.scale.set(0.75, 1.15, 0.75);
    iconPivot.add(core);

    const wingGeo = track(new THREE.BoxGeometry(0.56, 0.14, 0.2));
    for (const side of [-1, 1]) {
      const upperWing = new THREE.Mesh(wingGeo, accentMat);
      upperWing.position.set(side * 0.28, 0.16, 0);
      upperWing.rotation.z = side * 0.48;
      iconPivot.add(upperWing);

      const lowerWing = new THREE.Mesh(wingGeo, chromeMat);
      lowerWing.scale.set(0.82, 0.82, 0.82);
      lowerWing.position.set(side * 0.24, -0.14, 0);
      lowerWing.rotation.z = side * 0.42;
      iconPivot.add(lowerWing);
    }
  } else if (kind === 'rapid_hopper') {
    // Pressurized twin golden HPA paintball canisters + regulator bridge
    const cylGeo = track(new THREE.CylinderGeometry(0.18, 0.18, 0.72, 12));
    const capGeo = track(new THREE.SphereGeometry(0.18, 12, 8));
    for (const side of [-0.22, 0.22]) {
      const tank = new THREE.Mesh(cylGeo, accentMat);
      tank.position.set(side, 0, 0);
      iconPivot.add(tank);
      const topCap = new THREE.Mesh(capGeo, brightMat);
      topCap.position.set(side, 0.36, 0);
      iconPivot.add(topCap);
      const botCap = new THREE.Mesh(capGeo, darkAlloyMat);
      botCap.position.set(side, -0.36, 0);
      iconPivot.add(botCap);
    }
    const bridgeGeo = track(new THREE.BoxGeometry(0.6, 0.16, 0.22));
    const bridge = new THREE.Mesh(bridgeGeo, chromeMat);
    bridge.position.y = 0.08;
    iconPivot.add(bridge);
  } else if (kind === 'paint_shield') {
    // Sculpted hexagonal ballistic shield crest with glowing cyan core
    const plateGeo = track(new THREE.CylinderGeometry(0.46, 0.38, 0.14, 6));
    const plate = new THREE.Mesh(plateGeo, darkAlloyMat);
    plate.rotation.x = Math.PI / 2;
    iconPivot.add(plate);

    const rimGeo = track(new THREE.TorusGeometry(0.42, 0.065, 8, 6));
    const rim = new THREE.Mesh(rimGeo, accentMat);
    iconPivot.add(rim);

    const gemGeo = track(new THREE.OctahedronGeometry(0.22, 0));
    const gem = new THREE.Mesh(gemGeo, brightMat);
    gem.scale.set(1, 1.25, 0.65);
    iconPivot.add(gem);
  } else {
    // Mega Splash Cannon: pressurized violet paint-bomb orb with brass bands & directional nozzles
    const orbGeo = track(new THREE.SphereGeometry(0.42, 16, 12));
    const orb = new THREE.Mesh(orbGeo, accentMat);
    iconPivot.add(orb);

    const bandGeo = track(new THREE.TorusGeometry(0.42, 0.05, 8, 20));
    const band1 = new THREE.Mesh(bandGeo, chromeMat);
    band1.rotation.x = Math.PI / 2;
    iconPivot.add(band1);

    const nozzleGeo = track(new THREE.ConeGeometry(0.11, 0.24, 8));
    const dirs = [
      [0, 0.48, 0, 0, 0, 0],
      [0.48, 0, 0, 0, 0, -Math.PI / 2],
      [-0.48, 0, 0, 0, 0, Math.PI / 2],
      [0, 0, 0.48, Math.PI / 2, 0, 0],
      [0, 0, -0.48, -Math.PI / 2, 0, 0],
    ];
    for (const [x, y, z, rx, ry, rz] of dirs) {
      const noz = new THREE.Mesh(nozzleGeo, brightMat);
      noz.position.set(x, y, z);
      noz.rotation.set(rx, ry, rz);
      iconPivot.add(noz);
    }
  }

  // 3. Air-drop Parachute Canopy (visible during descent, folds cleanly away on touchdown)
  const parachuteGroup = new THREE.Group();
  parachuteGroup.position.y = 1.65;
  const canopyGeo = track(new THREE.SphereGeometry(1.25, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.52));
  const canopyMat = track(
    new THREE.MeshStandardMaterial({
      color: 0xf4f7fa,
      emissive: meta.colorHex,
      emissiveIntensity: 0.16,
      roughness: 0.72,
      side: THREE.DoubleSide,
    }),
  );
  const canopy = new THREE.Mesh(canopyGeo, canopyMat);
  canopy.position.y = 1.35;
  parachuteGroup.add(canopy);

  const cordGeo = track(new THREE.CylinderGeometry(0.015, 0.015, 1.85, 5));
  const cordMat = track(new THREE.MeshBasicMaterial({ color: 0xe2e8f0 }));
  for (let c = 0; c < 4; c++) {
    const ang = (c * Math.PI) / 2 + Math.PI / 4;
    const cord = new THREE.Mesh(cordGeo, cordMat);
    cord.position.set(Math.cos(ang) * 0.55, 0.7, Math.sin(ang) * 0.55);
    cord.rotation.z = Math.cos(ang) * 0.42;
    cord.rotation.x = -Math.sin(ang) * 0.42;
    parachuteGroup.add(cord);
  }
  payloadGroup.add(parachuteGroup);

  return {
    root,
    payloadGroup,
    iconPivot,
    parachuteGroup,
    beaconRing,
    lightBeam,
    padShadow,
    dispose: () => {
      disposables.forEach((d) => d.dispose());
    },
  };
}

export function updatePowerupDropVisual(
  rig: PowerupDropRig,
  drop: PowerupDropState,
  elapsed: number,
): void {
  rig.root.position.set(drop.pos.x, 0, drop.pos.z);
  rig.payloadGroup.position.y = drop.altitude;

  if (!drop.landed) {
    rig.parachuteGroup.visible = true;
    const sway = Math.sin(elapsed * 3.4 + drop.spawnIndex) * 0.14;
    rig.payloadGroup.rotation.z = sway;
    rig.payloadGroup.rotation.x = Math.cos(elapsed * 2.6 + drop.spawnIndex) * 0.08;
    const shadowScale = Math.max(0.35, 1 - drop.altitude / 18);
    rig.padShadow.scale.setScalar(shadowScale);
    rig.lightBeam.scale.set(1.1, 1.45, 1.1);
  } else {
    rig.parachuteGroup.visible = false;
    rig.payloadGroup.rotation.set(0, 0, 0);
    rig.padShadow.scale.setScalar(1);
    rig.lightBeam.scale.set(1, 0.85 + Math.sin(elapsed * 3.5 + drop.spawnIndex) * 0.12, 1);
  }

  // Smooth bobbing + crisp showcase spin
  rig.iconPivot.position.y = 1.06 + Math.sin(elapsed * 3.6 + drop.spawnIndex * 1.7) * 0.16;
  rig.iconPivot.rotation.y = elapsed * 1.85 + drop.spawnIndex;

  // Pulse beacon ring faster when about to expire (< 5s left)
  const expiring = drop.landed && drop.life < 5;
  const pulseSpeed = expiring ? 11 : 4.2;
  const ringScale = 1.0 + Math.sin(elapsed * pulseSpeed + drop.spawnIndex) * (expiring ? 0.2 : 0.1);
  rig.beaconRing.scale.setScalar(ringScale);
}

export interface WeatherAtmosphereRig {
  mistGroup: THREE.Group;
  mistMeshes: Array<{ mesh: THREE.Mesh; baseX: number; baseZ: number; speed: number; phase: number }>;
  mistMaterial: THREE.MeshBasicMaterial;
  cloudGroup: THREE.Group;
  cloudMeshes: Array<{ mesh: THREE.Mesh; baseX: number; baseZ: number; speed: number }>;
  cloudMaterial: THREE.MeshBasicMaterial;
  dispose: () => void;
}

function createSoftRadialPatchTexture(innerRgba: string, midRgba: string, outerRgba: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(128, 128, 12, 128, 128, 126);
  grad.addColorStop(0, innerRgba);
  grad.addColorStop(0.45, midRgba);
  grad.addColorStop(1, outerRgba);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Builds drifting low-altitude canyon mist banks (for Light Fog) and soft sweeping overhead
 * cloud-shadow patches (for Overcast) with zero hard polygon edges.
 */
export function createWeatherAtmosphereRig(scene: THREE.Scene): WeatherAtmosphereRig {
  const disposables: Array<{ dispose: () => void }> = [];

  // 1. Drifting Canyon Mist Banks
  const mistTex = createSoftRadialPatchTexture(
    'rgba(226, 238, 245, 0.72)',
    'rgba(210, 226, 236, 0.34)',
    'rgba(210, 226, 236, 0.0)',
  );
  const mistMaterial = new THREE.MeshBasicMaterial({
    map: mistTex,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mistGeo = new THREE.PlaneGeometry(24, 18);
  mistGeo.rotateX(-Math.PI / 2);
  disposables.push(mistTex, mistMaterial, mistGeo);

  const mistGroup = new THREE.Group();
  const mistMeshes: WeatherAtmosphereRig['mistMeshes'] = [];
  const mistLayout = [
    [-26, -15, 1.35, 1.8],
    [-10, -18, 1.5, 2.2],
    [12, -16, 1.4, 2.0],
    [28, -14, 1.6, 2.5],
    [-28, 14, 1.55, 2.1],
    [-8, 17, 1.45, 1.7],
    [14, 16, 1.5, 2.3],
    [29, 13, 1.35, 1.9],
    [-16, -2, 1.2, 3.2],
    [0, 3, 1.35, 3.8],
    [18, -3, 1.25, 3.4],
    [-4, -8, 1.15, 4.1],
    [8, 9, 1.2, 3.9],
    [-22, 5, 1.3, 2.9],
  ];

  mistLayout.forEach(([bx, bz, scale, y], idx) => {
    const m = new THREE.Mesh(mistGeo, mistMaterial);
    m.position.set(bx, y, bz);
    m.scale.set(scale, 1, scale * 0.85);
    mistGroup.add(m);
    mistMeshes.push({
      mesh: m,
      baseX: bx,
      baseZ: bz,
      speed: 1.1 + (idx % 4) * 0.35,
      phase: idx * 1.1,
    });
  });
  mistGroup.visible = false;
  scene.add(mistGroup);

  // 2. Drifting Overcast Cloud Shadows across the turf
  const cloudTex = createSoftRadialPatchTexture(
    'rgba(18, 30, 46, 0.72)',
    'rgba(24, 38, 56, 0.36)',
    'rgba(24, 38, 56, 0.0)',
  );
  const cloudMaterial = new THREE.MeshBasicMaterial({
    map: cloudTex,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const cloudGeo = new THREE.PlaneGeometry(32, 22);
  cloudGeo.rotateX(-Math.PI / 2);
  disposables.push(cloudTex, cloudMaterial, cloudGeo);

  const cloudGroup = new THREE.Group();
  const cloudMeshes: WeatherAtmosphereRig['cloudMeshes'] = [];
  const cloudSeeds = [
    [-30, -10, 1.15],
    [-8, 8, 1.25],
    [14, -12, 1.1],
    [32, 6, 1.2],
    [-20, 16, 1.05],
    [22, 15, 1.15],
  ];
  cloudSeeds.forEach(([bx, bz, scale], idx) => {
    const c = new THREE.Mesh(cloudGeo, cloudMaterial);
    c.position.set(bx, 0.036 + idx * 0.001, bz);
    c.scale.set(scale, 1, scale * 0.88);
    cloudGroup.add(c);
    cloudMeshes.push({
      mesh: c,
      baseX: bx,
      baseZ: bz,
      speed: 2.2 + (idx % 3) * 0.55,
    });
  });
  cloudGroup.visible = false;
  scene.add(cloudGroup);

  return {
    mistGroup,
    mistMeshes,
    mistMaterial,
    cloudGroup,
    cloudMeshes,
    cloudMaterial,
    dispose: () => {
      scene.remove(mistGroup, cloudGroup);
      disposables.forEach((d) => d.dispose());
    },
  };
}

export function updateWeatherAtmosphereVisuals(
  rig: WeatherAtmosphereRig,
  elapsed: number,
  mistOpacity: number,
  cloudShadowOpacity: number,
): void {
  const showMist = mistOpacity > 0.01;
  rig.mistGroup.visible = showMist;
  if (showMist) {
    rig.mistMaterial.opacity = mistOpacity;
    for (let i = 0; i < rig.mistMeshes.length; i++) {
      const item = rig.mistMeshes[i];
      // Smooth continuous horizontal drift wrapping seamlessly across the canyon
      const span = 88;
      const driftedX = ((((item.baseX + elapsed * item.speed) + span * 0.5) % span) + span) % span - span * 0.5;
      item.mesh.position.x = driftedX;
      item.mesh.position.z = item.baseZ + Math.sin(elapsed * 0.35 + item.phase) * 2.2;
    }
  }

  const showClouds = cloudShadowOpacity > 0.01;
  rig.cloudGroup.visible = showClouds;
  if (showClouds) {
    rig.cloudMaterial.opacity = cloudShadowOpacity;
    for (let i = 0; i < rig.cloudMeshes.length; i++) {
      const item = rig.cloudMeshes[i];
      const span = 96;
      const driftedX = ((((item.baseX + elapsed * item.speed) + span * 0.5) % span) + span) % span - span * 0.5;
      item.mesh.position.x = driftedX;
    }
  }
}
