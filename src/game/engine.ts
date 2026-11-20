import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  ARENA_HALF_D,
  ARENA_HALF_W,
  ARENA_OBSTACLES,
  BASE_POSITIONS,
  MATCH_DURATION_SEC,
  POWERUP_DROP_LIFETIME,
  POWERUP_MAX_ACTIVE,
  POWERUP_META,
  POWERUP_SPAWN_POINTS,
  SCORE_LIMIT,
  SPAWN_POINTS,
} from './arenaData';
import { PaintballAudio } from './audio';
import {
  createArenaEnvironment,
  createBaseFort,
  createFlagRig,
  createObstacleMesh,
  createPaintballerRig,
  createPowerupDropRig,
  createWeatherAtmosphereRig,
  TEAM_PALETTE,
  updateFlagClothWave,
  updatePowerupDropVisual,
  updateWeatherAtmosphereVisuals,
  type FlagRig,
  type PaintballerRig,
  type PowerupDropRig,
  type WeatherAtmosphereRig,
} from './models';
import {
  computeAiObjective,
  computeStunWaveRadius,
  createInitialFlags,
  dist2D,
  dropFlagForActor,
  evaluateMatchWinner,
  getActorBuffEffects,
  hasLineOfSight,
  oppositeTeam,
  pickFreePowerupSpawnIndex,
  pointHitsObstacle,
  registerKillForStunCharge,
  resolveArenaCollision,
  STUN_KILLS_REQUIRED,
  stepActorBuffs,
  stepFlagRules,
  stepPowerupDrops,
  triggerStunShockwave,
} from './rules';
import { createArenaTextures, type ProceduralTextureSet } from './textures';
import {
  createWeatherCycle,
  evaluateWeatherAtmosphere,
  stepWeatherCycle,
  WEATHER_LABELS,
  type WeatherCycleState,
} from './weather';
import type {
  NetGameEvent,
  NetMatchSnapshot,
  PlayerInputPacket,
} from './netTypes';
import type {
  ActorState,
  FlagState,
  GamePhase,
  HudSnapshot,
  MatchBanner,
  MatchConfig,
  MatchStats,
  PowerupDropState,
  PowerupKind,
  TeamId,
  UnitRole,
  Vec2,
  WeatherKind,
} from './types';

interface ProjectileSlot {
  active: boolean;
  team: TeamId;
  ownerId: string;
  isPlayerShot: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  damage: number;
  splashRadius: number;
  mesh: THREE.Mesh;
  trail: THREE.Mesh;
}

interface ParticleSlot {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  size: number;
  gravity: number;
  color: THREE.Color;
}

interface ShockwaveSlot {
  active: boolean;
  age: number;
  duration: number;
  maxRadius: number;
  group: THREE.Group;
  ringMesh: THREE.Mesh;
  innerRingMesh: THREE.Mesh;
  discMesh: THREE.Mesh;
  ringMat: THREE.MeshBasicMaterial;
  innerMat: THREE.MeshBasicMaterial;
  discMat: THREE.MeshBasicMaterial;
}

const MAX_PROJECTILES = 96;
const MAX_PARTICLES = 220;
const MAX_SPLATS = 160;
const MAX_SHOCKWAVES = 8;
const RELOAD_DURATION = 1.15;
const DASH_COOLDOWN = 2.2;
const DASH_DURATION = 0.22;
const BURST_COOLDOWN = 2.6;
const RESPAWN_TIME = 4.0;
const KO_FALL_DURATION = 0.38;

// Pre-allocated scratch helpers (zero GC inside render loop)
const _v3A = new THREE.Vector3();
const _v3B = new THREE.Vector3();
const _mat4 = new THREE.Matrix4();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _color = new THREE.Color();
const _raycaster = new THREE.Raycaster();
const _ndc = new THREE.Vector2();
const _aimPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -1.05);

function detectSoftwareGl(): boolean {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
}

export class CaptureTheFlagEngine {
  private container: HTMLElement;
  private onHudUpdate: (snapshot: HudSnapshot) => void;
  private isSoftwareGl: boolean;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private textures: ProceduralTextureSet;
  private envCleanup: () => void;
  private pollenPoints: THREE.Points;
  private audio = new PaintballAudio();

  // Dynamic weather lighting & atmosphere handles
  private skyColor: THREE.Color;
  private fogExp: THREE.FogExp2;
  private hemiLight: THREE.HemisphereLight;
  private sunLight: THREE.DirectionalLight;
  private rimLight: THREE.DirectionalLight;
  private weatherRig: WeatherAtmosphereRig;
  private weatherState: WeatherCycleState;

  private phase: GamePhase = 'title';
  private networkMode: 'solo' | 'multiplayer' = 'solo';
  private localPlayerId: string | null = null;
  private localTeam: TeamId = 'cobalt';
  private roomCode: string | null = null;
  private isHost = false;
  private connectedPlayers = 1;
  private titleHotkeysBlocked = false;
  private inputSender: ((input: PlayerInputPacket) => void) | null = null;
  private inputSendTimer = 0;
  private pendingNetDash = false;
  private pendingNetBurst = false;
  private pendingNetReload = false;
  private pendingNetStunWave = false;
  private actorNetTargets = new Map<string, { x: number; z: number; facing: number }>();
  private nameplateSprites = new Map<string, THREE.Sprite>();

  private config: MatchConfig = { teamSize: 4, difficulty: 'standard' };
  private scores: Record<TeamId, number> = { cobalt: 0, crimson: 0 };
  private matchTimeRemaining = MATCH_DURATION_SEC;
  private elapsedMatchTime = 0;
  private endStats: MatchStats | null = null;

  private actors: ActorState[] = [];
  private actorRigs = new Map<string, PaintballerRig>();
  private flags: Record<TeamId, FlagState> = createInitialFlags();
  private flagRigs: Record<TeamId, FlagRig>;

  // Field powerup drops state & 3D rigs
  private powerups: PowerupDropState[] = [];
  private powerupRigs = new Map<string, PowerupDropRig>();
  private powerupSpawnTimer = 11;
  private powerupSeq = 1;
  private powerupKindCursor = 0;

  private projectiles: ProjectileSlot[] = [];
  private particles: ParticleSlot[] = [];
  private particleMesh!: THREE.InstancedMesh;
  private splatPool: THREE.Mesh[] = [];
  private splatCursor = 0;
  private splatMaterials: Record<TeamId, THREE.MeshStandardMaterial[]>;
  private shockwaves: ShockwaveSlot[] = [];

  // In-world aim indicator & muzzle flash light
  private aimReticleGroup: THREE.Group;
  private aimLine: THREE.Line;
  private muzzleLight: THREE.PointLight;
  private muzzleLightTimer = 0;

  // Input state
  private keysPressed = new Set<string>();
  private mouseDownLeft = false;
  private mouseDownRight = false;
  private pointerClient = { x: 0, y: 0, active: false };
  private aimMode: 'keyboard' | 'mouse' = 'keyboard';
  private aimOffset: Vec2 = { x: 8.5, z: 0 };
  private aimWorldPos: Vec2 = { x: 0, z: 0 };
  private canvasBounds = { left: 0, top: 0, width: 1280, height: 720 };
  private resizeObserver: ResizeObserver;

  // Juice, timing & camera state
  private running = true;
  private frameId = 0;
  private lastNow = 0;
  private totalTime = 0;
  private hitstopTimer = 0;
  private cameraTrauma = 0;
  private cameraLookPos = new THREE.Vector3(6.5, 1.4, -1.5);
  private cameraCurrentPos = new THREE.Vector3(16, 17.5, 23);
  private hudEmitTimer = 0;
  private banner: MatchBanner | null = null;
  private bannerTimer = 0;
  private bannerSeq = 1;
  private attackTokenPool = 3;

  // Cached listeners for clean unmount
  private boundKeyDown: (e: KeyboardEvent) => void;
  private boundKeyUp: (e: KeyboardEvent) => void;
  private boundPointerMove: (e: PointerEvent) => void;
  private boundPointerDown: (e: PointerEvent) => void;
  private boundPointerUp: (e: PointerEvent) => void;
  private boundContextMenu: (e: MouseEvent) => void;
  private boundBlur: () => void;
  private boundVisibility: () => void;

  constructor(container: HTMLElement, onHudUpdate: (snapshot: HudSnapshot) => void) {
    this.container = container;
    this.onHudUpdate = onHudUpdate;
    this.isSoftwareGl = detectSoftwareGl();

    // 1. Renderer setup with modern PBR tone mapping & software-WebGL guard
    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.setPixelRatio(this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const rect = container.getBoundingClientRect();
    const w = Math.max(rect.width, 320);
    const h = Math.max(rect.height, 240);
    this.canvasBounds = { left: rect.left, top: rect.top, width: w, height: h };
    this.renderer.setSize(w, h);
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    container.appendChild(this.renderer.domElement);

    // 2. Scene, Dynamic Weather Horizon Fog & Studio IBL Environment (RoomEnvironment)
    this.scene = new THREE.Scene();
    this.skyColor = new THREE.Color(0x9fc5e2);
    this.scene.background = this.skyColor;
    this.fogExp = new THREE.FogExp2(0x9fc5e2, 0.0058);
    this.scene.fog = this.fogExp;

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    // 3. Perspective Camera tuned for crisp high-angle top-down tactical clarity
    this.camera = new THREE.PerspectiveCamera(42, w / h, 0.5, 220);
    this.camera.position.set(16, 17.5, 23);
    this.camera.lookAt(5, 1.2, -1);

    // 4. Balanced 3-Point Golden-Hour Outdoor Lighting Rig (modulated by Dynamic Weather)
    this.hemiLight = new THREE.HemisphereLight(0x78b6dc, 0x3b3022, 0.74);
    this.scene.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight(0xffe7b8, 2.22);
    this.sunLight.position.set(-28, 42, 24);
    this.sunLight.castShadow = !this.isSoftwareGl;
    this.sunLight.shadow.mapSize.set(1024, 1024);
    this.sunLight.shadow.camera.near = 8;
    this.sunLight.shadow.camera.far = 115;
    this.sunLight.shadow.camera.left = -42;
    this.sunLight.shadow.camera.right = 42;
    this.sunLight.shadow.camera.top = 34;
    this.sunLight.shadow.camera.bottom = -34;
    this.sunLight.shadow.bias = -0.0005;
    this.sunLight.shadow.normalBias = 0.02;
    this.scene.add(this.sunLight);

    this.rimLight = new THREE.DirectionalLight(0xaad6ff, 0.58);
    this.rimLight.position.set(32, 24, -26);
    this.scene.add(this.rimLight);

    // Pooled dynamic muzzle flash light (1 unshadowed point light)
    this.muzzleLight = new THREE.PointLight(0xfff2be, 0, 10, 2);
    this.scene.add(this.muzzleLight);

    // 5. Build Procedural PBR Textures, Arena Environment & Dynamic Weather Layers
    this.textures = createArenaTextures(this.renderer.capabilities.getMaxAnisotropy());
    const env = createArenaEnvironment(this.scene, this.textures);
    this.pollenPoints = env.pollenPoints;
    this.envCleanup = env.dispose;

    // Optional URL weather override (?weather=clear|overcast|light_fog) for inspection; default cycles organically
    const weatherParam =
      typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('weather') : null;
    const initialWeather: WeatherKind =
      weatherParam === 'overcast' || weatherParam === 'light_fog' || weatherParam === 'clear'
        ? weatherParam
        : 'clear';
    const weatherLocked =
      weatherParam === 'overcast' || weatherParam === 'light_fog' || weatherParam === 'clear';
    this.weatherState = createWeatherCycle(initialWeather, weatherLocked);
    this.weatherRig = createWeatherAtmosphereRig(this.scene);
    this.applyWeatherAtmosphere(0);

    // Build Base Forts & Obstacles
    this.scene.add(createBaseFort('cobalt', this.textures));
    this.scene.add(createBaseFort('crimson', this.textures));
    for (const ob of ARENA_OBSTACLES) {
      this.scene.add(createObstacleMesh(ob, this.textures));
    }

    // Build Animated Cloth Flags
    this.flagRigs = {
      cobalt: createFlagRig('cobalt'),
      crimson: createFlagRig('crimson'),
    };
    this.scene.add(this.flagRigs.cobalt.root, this.flagRigs.crimson.root);

    // 6. Initialize Zero-GC Pools (Projectiles, Glossy Paint Splatters, Instanced Droplet Particles)
    this.splatMaterials = {
      cobalt: this.textures.splatTextures.map(
        (tex) =>
          new THREE.MeshStandardMaterial({
            color: TEAM_PALETTE.cobalt.paintHex,
            map: tex,
            transparent: true,
            opacity: 0.92,
            roughness: 0.14,
            metalness: 0.08,
            depthWrite: false,
            polygonOffset: true,
            polygonOffsetFactor: -2,
            polygonOffsetUnits: -2,
          }),
      ),
      crimson: this.textures.splatTextures.map(
        (tex) =>
          new THREE.MeshStandardMaterial({
            color: TEAM_PALETTE.crimson.paintHex,
            map: tex,
            transparent: true,
            opacity: 0.92,
            roughness: 0.14,
            metalness: 0.08,
            depthWrite: false,
            polygonOffset: true,
            polygonOffsetFactor: -2,
            polygonOffsetUnits: -2,
          }),
      ),
    };
    this.initPools();

    // 7. High-Contrast Tactical 3D Aim Reticle & Subtle Sight Line
    this.aimReticleGroup = new THREE.Group();
    const darkBacking = new THREE.Mesh(
      new THREE.RingGeometry(0.46, 0.68, 28),
      new THREE.MeshBasicMaterial({
        color: 0x0b111a,
        transparent: true,
        opacity: 0.65,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    darkBacking.rotation.x = -Math.PI / 2;

    const outerReticle = new THREE.Mesh(
      new THREE.RingGeometry(0.5, 0.63, 28),
      new THREE.MeshBasicMaterial({
        color: 0xfacc15,
        transparent: true,
        opacity: 0.96,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    outerReticle.rotation.x = -Math.PI / 2;
    outerReticle.position.y = 0.005;

    const tickMat = new THREE.MeshBasicMaterial({
      color: 0xfef08a,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const tickGeo = new THREE.PlaneGeometry(0.11, 0.34);
    for (let i = 0; i < 4; i++) {
      const ang = (i * Math.PI) / 2;
      const tick = new THREE.Mesh(tickGeo, tickMat);
      tick.rotation.x = -Math.PI / 2;
      tick.rotation.z = ang;
      tick.position.set(Math.sin(ang) * 0.72, 0.008, Math.cos(ang) * 0.72);
      this.aimReticleGroup.add(tick);
    }

    const innerDot = new THREE.Mesh(
      new THREE.CircleGeometry(0.14, 14),
      new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.98,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    innerDot.rotation.x = -Math.PI / 2;
    innerDot.position.y = 0.008;

    this.aimReticleGroup.add(darkBacking, outerReticle, innerDot);
    this.aimReticleGroup.position.set(0, 0.06, 0);
    this.aimReticleGroup.visible = false;
    this.scene.add(this.aimReticleGroup);

    const lineGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 1.05, 0),
      new THREE.Vector3(1, 1.05, 0),
    ]);
    this.aimLine = new THREE.Line(
      lineGeo,
      new THREE.LineBasicMaterial({
        color: 0xfef08a,
        transparent: true,
        opacity: 0.42,
      }),
    );
    this.aimLine.visible = false;
    this.scene.add(this.aimLine);

    // 8. Spawn Live Background Skirmish Squads & Showcase Powerup Drops for Title Screen Flyover
    this.setupActors(true);
    this.seedShowcaseSplatters();
    this.resetPowerups(true);

    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }

    // 9. Attach Listeners & ResizeObserver
    this.boundKeyDown = this.handleKeyDown.bind(this);
    this.boundKeyUp = this.handleKeyUp.bind(this);
    this.boundPointerMove = this.handlePointerMove.bind(this);
    this.boundPointerDown = this.handlePointerDown.bind(this);
    this.boundPointerUp = this.handlePointerUp.bind(this);
    this.boundContextMenu = (e: MouseEvent) => e.preventDefault();
    this.boundBlur = () => this.clearInputs();
    this.boundVisibility = () => {
      if (document.hidden) this.clearInputs();
    };

    window.addEventListener('keydown', this.boundKeyDown);
    window.addEventListener('keyup', this.boundKeyUp);
    window.addEventListener('pointermove', this.boundPointerMove);
    this.renderer.domElement.addEventListener('pointerdown', this.boundPointerDown);
    window.addEventListener('pointerup', this.boundPointerUp);
    this.renderer.domElement.addEventListener('contextmenu', this.boundContextMenu);
    window.addEventListener('blur', this.boundBlur);
    document.addEventListener('visibilitychange', this.boundVisibility);

    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(this.container);

    // Render frame 0 immediately so Title Screen 3D world is visible on first paint
    this.camera.position.copy(this.cameraCurrentPos);
    this.camera.lookAt(this.cameraLookPos);
    this.renderer.render(this.scene, this.camera);

    // Kick off render & sim loop
    this.lastNow = performance.now();
    this.emitHud();
    this.scheduleNextFrame();
  }

  private initPools(): void {
    const ballGeo = new THREE.SphereGeometry(0.14, 10, 8);
    const trailGeo = new THREE.CylinderGeometry(0.035, 0.09, 0.95, 6);
    trailGeo.rotateX(Math.PI / 2);

    const cobaltBallMat = new THREE.MeshStandardMaterial({
      color: 0x60a5fa,
      emissive: 0x2563eb,
      emissiveIntensity: 0.75,
      roughness: 0.12,
    });
    const crimsonBallMat = new THREE.MeshStandardMaterial({
      color: 0xfb7185,
      emissive: 0xe6452e,
      emissiveIntensity: 0.75,
      roughness: 0.12,
    });
    const cobaltTrailMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.55,
    });
    const crimsonTrailMat = new THREE.MeshBasicMaterial({
      color: 0xfb923c,
      transparent: true,
      opacity: 0.55,
    });

    for (let i = 0; i < MAX_PROJECTILES; i++) {
      const mesh = new THREE.Mesh(ballGeo, i % 2 === 0 ? cobaltBallMat : crimsonBallMat);
      mesh.visible = false;
      const trail = new THREE.Mesh(trailGeo, i % 2 === 0 ? cobaltTrailMat : crimsonTrailMat);
      trail.visible = false;
      this.scene.add(mesh, trail);
      this.projectiles.push({
        active: false,
        team: 'cobalt',
        ownerId: '',
        isPlayerShot: false,
        x: 0,
        y: 1.05,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        life: 0,
        damage: 25,
        splashRadius: 0,
        mesh,
        trail,
      });
    }

    // Store team materials on first two slots for quick reuse
    (this as unknown as { _pMats: Record<TeamId, { ball: THREE.Material; trail: THREE.Material }> })._pMats = {
      cobalt: { ball: cobaltBallMat, trail: cobaltTrailMat },
      crimson: { ball: crimsonBallMat, trail: crimsonTrailMat },
    };

    // Pooled Paint Splatter Decals
    const splatGeo = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < MAX_SPLATS; i++) {
      const m = new THREE.Mesh(splatGeo, this.splatMaterials.cobalt[i % 4]);
      m.visible = false;
      m.receiveShadow = true;
      this.scene.add(m);
      this.splatPool.push(m);
    }

    // Pooled Instanced Particle System (paint droplets + turf dust)
    const pGeo = new THREE.SphereGeometry(0.11, 6, 6);
    const pMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.2,
      metalness: 0.05,
    });
    this.particleMesh = new THREE.InstancedMesh(pGeo, pMat, MAX_PARTICLES);
    this.particleMesh.frustumCulled = false;
    _mat4.makeScale(0, 0, 0);
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.particleMesh.setMatrixAt(i, _mat4);
      this.particleMesh.setColorAt(i, _color.setHex(0xffffff));
      this.particles.push({
        active: false,
        x: 0,
        y: -10,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        life: 0,
        maxLife: 1,
        size: 1,
        gravity: 16,
        color: new THREE.Color(0xffffff),
      });
    }
    this.particleMesh.instanceMatrix.needsUpdate = true;
    if (this.particleMesh.instanceColor) this.particleMesh.instanceColor.needsUpdate = true;
    this.scene.add(this.particleMesh);

    // Pooled 3D Stun Shockwave Expanding Rings & Circular Radius Pulse Discs
    const outerRingGeo = new THREE.RingGeometry(0.86, 1.0, 48);
    outerRingGeo.rotateX(-Math.PI / 2);
    const innerRingGeo = new THREE.RingGeometry(0.64, 0.72, 48);
    innerRingGeo.rotateX(-Math.PI / 2);
    const pulseDiscGeo = new THREE.CircleGeometry(1.0, 48);
    pulseDiscGeo.rotateX(-Math.PI / 2);

    for (let i = 0; i < MAX_SHOCKWAVES; i++) {
      const group = new THREE.Group();
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.92,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const innerMat = new THREE.MeshBasicMaterial({
        color: 0xfef08a,
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const discMat = new THREE.MeshBasicMaterial({
        color: 0x22d3ee,
        transparent: true,
        opacity: 0.24,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const ringMesh = new THREE.Mesh(outerRingGeo, ringMat);
      ringMesh.position.y = 0.04;
      const innerRingMesh = new THREE.Mesh(innerRingGeo, innerMat);
      innerRingMesh.position.y = 0.06;
      const discMesh = new THREE.Mesh(pulseDiscGeo, discMat);
      discMesh.position.y = 0.02;
      group.add(discMesh, ringMesh, innerRingMesh);
      group.visible = false;
      this.scene.add(group);

      this.shockwaves.push({
        active: false,
        age: 0,
        duration: 0.72,
        maxRadius: 8.5,
        group,
        ringMesh,
        innerRingMesh,
        discMesh,
        ringMat,
        innerMat,
        discMat,
      });
    }
  }

  /** Seeds vibrant paint splatters around midfield bunkers & base lanes for instant lived-in storytelling */
  private seedShowcaseSplatters(): void {
    const spots: Array<{ x: number; z: number; team: TeamId; scale: number }> = [
      { x: -3.4, z: -2.4, team: 'cobalt', scale: 1.85 },
      { x: 3.1, z: 2.9, team: 'crimson', scale: 1.95 },
      { x: -2.1, z: 6.2, team: 'crimson', scale: 1.65 },
      { x: 2.4, z: -5.8, team: 'cobalt', scale: 1.75 },
      { x: -9.0, z: -6.0, team: 'crimson', scale: 1.6 },
      { x: 9.2, z: 6.2, team: 'cobalt', scale: 1.6 },
      { x: 0.6, z: 0.9, team: 'cobalt', scale: 1.55 },
      { x: -1.1, z: -0.8, team: 'crimson', scale: 1.6 },
      { x: -16.5, z: 2.4, team: 'cobalt', scale: 1.5 },
      { x: 16.8, z: -2.6, team: 'crimson', scale: 1.55 },
      { x: -7.5, z: 9.4, team: 'cobalt', scale: 1.45 },
      { x: 7.8, z: -9.2, team: 'crimson', scale: 1.45 },
    ];
    for (const s of spots) {
      this.spawnGroundSplat(s.x, s.z, s.team, s.scale);
    }
  }

  private clearSplatters(): void {
    for (const s of this.splatPool) {
      s.visible = false;
    }
    this.splatCursor = 0;
    for (const sw of this.shockwaves) {
      sw.active = false;
      sw.group.visible = false;
    }
  }

  private spawnStunShockwaveVfx(x: number, z: number, radius: number, team: TeamId): void {
    let slot = this.shockwaves.find((s) => !s.active);
    if (!slot) {
      // Recycle oldest active shockwave slot
      slot = this.shockwaves.reduce((oldest, cur) => (cur.age > oldest.age ? cur : oldest), this.shockwaves[0]);
    }
    slot.active = true;
    slot.age = 0;
    slot.duration = 0.72;
    slot.maxRadius = radius;
    slot.group.position.set(x, 0.06, z);
    slot.group.scale.setScalar(0.6);
    slot.ringMat.color.setHex(team === 'cobalt' ? 0x38bdf8 : 0xfb923c);
    slot.innerMat.color.setHex(0xfef08a);
    slot.discMat.color.setHex(team === 'cobalt' ? 0x22d3ee : 0xf97316);
    slot.ringMat.opacity = 0.95;
    slot.innerMat.opacity = 0.88;
    slot.discMat.opacity = 0.28;
    slot.group.visible = true;

    // Electric shockwave ring particles erupting from the caster
    this.spawnParticles(x, 0.8, z, 24, 0x38bdf8, 4.5, 11.5, 1.15, 8);
    this.spawnParticles(x, 1.0, z, 14, 0xfef08a, 3.5, 9.0, 0.95, 6);
  }

  private stepShockwaves(dt: number): void {
    for (let i = 0; i < this.shockwaves.length; i++) {
      const sw = this.shockwaves[i];
      if (!sw.active) continue;
      sw.age += dt;
      const t = sw.age / sw.duration;
      if (t >= 1) {
        sw.active = false;
        sw.group.visible = false;
        continue;
      }
      // Snappy ease-out expansion to exact shockwave radius
      const easeOut = 1 - Math.pow(1 - t, 3);
      const currentRadius = 0.6 + (sw.maxRadius - 0.6) * easeOut;
      sw.group.scale.setScalar(currentRadius);
      sw.innerRingMesh.rotation.y = sw.age * 4.0;

      const fade = t < 0.55 ? 1.0 : Math.max(0, 1 - (t - 0.55) / 0.45);
      sw.ringMat.opacity = 0.95 * fade;
      sw.innerMat.opacity = 0.85 * fade;
      sw.discMat.opacity = 0.26 * fade * (1 - t * 0.35);
    }
  }

  private spawnGroundSplat(x: number, z: number, team: TeamId, scale = 1.2): void {
    const slot = this.splatPool[this.splatCursor];
    const idx = this.splatCursor;
    this.splatCursor = (this.splatCursor + 1) % MAX_SPLATS;

    const mats = this.splatMaterials[team];
    slot.material = mats[Math.floor(Math.random() * mats.length)];
    slot.position.set(x, 0.026 + (idx % 30) * 0.0004, z);
    slot.rotation.set(-Math.PI / 2, 0, Math.random() * Math.PI * 2);
    const s = scale * (0.85 + Math.random() * 0.4);
    slot.scale.set(s, s, 1);
    slot.visible = true;
  }

  private spawnWallSplat(
    x: number,
    y: number,
    z: number,
    nx: number,
    nz: number,
    team: TeamId,
  ): void {
    const slot = this.splatPool[this.splatCursor];
    const idx = this.splatCursor;
    this.splatCursor = (this.splatCursor + 1) % MAX_SPLATS;

    const mats = this.splatMaterials[team];
    slot.material = mats[Math.floor(Math.random() * mats.length)];
    const offset = 0.03 + (idx % 12) * 0.001;
    slot.position.set(x + nx * offset, Math.max(0.45, Math.min(1.65, y)), z + nz * offset);
    slot.rotation.set(0, Math.atan2(nx, nz), Math.random() * Math.PI * 2);
    const s = 0.85 + Math.random() * 0.45;
    slot.scale.set(s, s, 1);
    slot.visible = true;
  }

  private spawnParticles(
    x: number,
    y: number,
    z: number,
    count: number,
    hexColor: number,
    speedMin: number,
    speedMax: number,
    sizeBase: number,
    gravity = 16,
  ): void {
    let spawned = 0;
    for (let i = 0; i < MAX_PARTICLES && spawned < count; i++) {
      const p = this.particles[i];
      if (!p.active) {
        const ang = Math.random() * Math.PI * 2;
        const spd = speedMin + Math.random() * (speedMax - speedMin);
        p.active = true;
        p.x = x;
        p.y = y;
        p.z = z;
        p.vx = Math.cos(ang) * spd;
        p.vy = 2.4 + Math.random() * (speedMax * 0.75);
        p.vz = Math.sin(ang) * spd;
        p.maxLife = 0.34 + Math.random() * 0.36;
        p.life = p.maxLife;
        p.size = sizeBase * (0.7 + Math.random() * 0.7);
        p.gravity = gravity;
        p.color.setHex(hexColor);
        spawned++;
      }
    }
  }

  private createNameplateSprite(name: string, team: TeamId, isLocal: boolean): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, 256, 64);

    // Rounded dark pill backing
    ctx.fillStyle = isLocal ? 'rgba(15, 23, 38, 0.92)' : 'rgba(12, 18, 28, 0.84)';
    ctx.strokeStyle = isLocal ? '#FACC15' : team === 'cobalt' ? '#38BDF8' : '#FB923C';
    ctx.lineWidth = isLocal ? 4 : 3;
    ctx.beginPath();
    ctx.roundRect(14, 10, 228, 44, 14);
    ctx.fill();
    ctx.stroke();

    // Team color dot
    ctx.fillStyle = team === 'cobalt' ? '#38BDF8' : '#FB923C';
    ctx.beginPath();
    ctx.arc(38, 32, 8, 0, Math.PI * 2);
    ctx.fill();

    // Crisp player name
    ctx.fillStyle = isLocal ? '#FEF08A' : '#F8FAFC';
    ctx.font = '700 24px "Plus Jakarta Sans", system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const label = name.slice(0, 12);
    ctx.fillText(label, 56, 33);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(2.35, 0.58, 1);
    sprite.position.set(0, 2.75, 0);
    sprite.renderOrder = 25;
    return sprite;
  }

  private clearNameplates(): void {
    for (const sprite of this.nameplateSprites.values()) {
      sprite.parent?.remove(sprite);
      sprite.material.map?.dispose();
      sprite.material.dispose();
    }
    this.nameplateSprites.clear();
  }

  private setupActors(isTitleShowcase: boolean): void {
    this.clearNameplates();
    this.actorNetTargets.clear();
    // Clean up existing actor meshes
    for (const rig of this.actorRigs.values()) {
      this.scene.remove(rig.root);
    }
    this.actorRigs.clear();
    this.actors = [];

    const teamSize = this.config.teamSize;
    const roleOrder: UnitRole[] =
      teamSize === 3 ? ['striker', 'heavy', 'defender'] : ['striker', 'striker', 'heavy', 'defender'];

    const cobaltNames = ['Vanguard', 'Nova', 'Titan', 'Aegis'];
    const crimsonNames = ['Blaze', 'Viper', 'Forge', 'Bastion'];

    for (const team of ['cobalt', 'crimson'] as TeamId[]) {
      const spawns = SPAWN_POINTS[team];
      const names = team === 'cobalt' ? cobaltNames : crimsonNames;
      for (let i = 0; i < teamSize; i++) {
        const isPlayer = !isTitleShowcase && team === 'cobalt' && i === 0;
        const role: UnitRole = isPlayer ? 'striker' : roleOrder[i];
        const sp = spawns[i % spawns.length];
        const maxHp = isPlayer ? 125 : role === 'heavy' ? 130 : role === 'defender' ? 110 : 95;
        const maxAmmo = isPlayer ? 24 : role === 'heavy' ? 32 : 20;

        const actor: ActorState = {
          id: `${team}-${i}`,
          name: isPlayer ? 'You' : names[i],
          team,
          role,
          isPlayer,
          pos: { x: sp.x, z: sp.z },
          vel: { x: 0, z: 0 },
          facing: team === 'cobalt' ? Math.PI / 2 : -Math.PI / 2,
          radius: role === 'heavy' ? 0.72 : 0.62,
          hp: maxHp,
          maxHp,
          ammo: maxAmmo,
          maxAmmo,
          reloading: false,
          reloadTimer: 0,
          fireCooldown: 0.4 + Math.random() * 0.4,
          burstCooldown: 0,
          dashCooldown: 0,
          dashTimer: 0,
          dashDir: { x: team === 'cobalt' ? 1 : -1, z: 0 },
          alive: true,
          koTimer: 0,
          respawnTimer: 0,
          hitFlashTimer: 0,
          recoilAmount: 0,
          gaitPhase: Math.random() * Math.PI * 2,
          windupTimer: 0,
          telegraphingBurst: false,
          aiWaypoint: null,
          aiStrafeDir: i % 2 === 0 ? 1 : -1,
          aiThinkTimer: Math.random() * 0.5,
          buffs: [],
          stunTimer: 0,
          stunKillsProgress:
            isPlayer && typeof window !== 'undefined'
              ? Math.min(
                  STUN_KILLS_REQUIRED,
                  Math.max(0, Number(new URLSearchParams(window.location.search).get('stunCharge') ?? 0) || 0),
                )
              : 0,
          stunActivations: 0,
          tags: 0,
          captures: 0,
          returns: 0,
        };

        const rig = createPaintballerRig(team, role, isPlayer, this.textures.contactShadow);
        rig.root.position.set(actor.pos.x, 0, actor.pos.z);
        rig.root.rotation.y = actor.facing;
        this.scene.add(rig.root);

        this.actors.push(actor);
        this.actorRigs.set(actor.id, rig);
      }
    }

    this.flags = createInitialFlags();
    this.syncFlagMeshes(0);
  }

  // =========================================================================
  // PUBLIC API FOR REACT SHELL
  // =========================================================================

  public setConfig(partial: Partial<MatchConfig>): void {
    this.config = { ...this.config, ...partial };
    if (this.phase === 'title') {
      this.setupActors(true);
    }
  }

  public setInputSender(sender: ((input: PlayerInputPacket) => void) | null): void {
    this.inputSender = sender;
  }

  public setTitleHotkeysBlocked(blocked: boolean): void {
    this.titleHotkeysBlocked = blocked;
  }

  public updateMultiplayerMeta(roomCode: string | null, isHost: boolean, connectedPlayers: number): void {
    this.roomCode = roomCode;
    this.isHost = isHost;
    this.connectedPlayers = connectedPlayers;
    if (this.phase === 'playing' || this.phase === 'paused' || this.phase === 'gameover') {
      this.emitHud();
    }
  }

  public startMultiplayerMatch(
    localPlayerId: string,
    localTeam: TeamId,
    roomCode: string,
    isHost: boolean,
    connectedPlayers: number,
    initialSnapshot: NetMatchSnapshot,
  ): void {
    this.audio.unlock();
    this.clearInputs();
    this.clearSplatters();
    this.clearPowerups();
    this.clearNameplates();
    this.actorNetTargets.clear();

    for (const rig of this.actorRigs.values()) {
      this.scene.remove(rig.root);
    }
    this.actorRigs.clear();
    this.actors = [];

    for (const p of this.projectiles) {
      p.active = false;
      p.mesh.visible = false;
      p.trail.visible = false;
    }

    this.networkMode = 'multiplayer';
    this.localPlayerId = localPlayerId;
    this.localTeam = localTeam;
    this.roomCode = roomCode;
    this.isHost = isHost;
    this.connectedPlayers = connectedPlayers;
    this.endStats = null;
    this.banner = null;
    this.bannerTimer = 0;
    this.hitstopTimer = 0;
    this.cameraTrauma = 0;
    this.pendingNetDash = false;
    this.pendingNetBurst = false;
    this.pendingNetReload = false;
    this.pendingNetStunWave = false;

    this.seedShowcaseSplatters();
    this.phase = 'playing';
    document.body.dataset.state = 'playing';

    this.applyServerSnapshot(initialSnapshot, []);

    const localPlayer = this.actors.find((a) => a.isPlayer);
    const dirSign = localTeam === 'cobalt' ? 1 : -1;
    if (localPlayer) {
      this.cameraLookPos.set(localPlayer.pos.x + dirSign * 4, 0, localPlayer.pos.z);
      this.cameraCurrentPos.set(localPlayer.pos.x + dirSign * 1, 21.5, localPlayer.pos.z + 17.5);
      this.aimMode = 'keyboard';
      this.aimOffset = { x: dirSign * 8.5, z: 0 };
      this.pointerClient.active = false;
      this.aimWorldPos = {
        x: localPlayer.pos.x + this.aimOffset.x,
        z: localPlayer.pos.z + this.aimOffset.z,
      };
    }

    const enemyName = localTeam === 'cobalt' ? 'Crimson' : 'Cobalt';
    this.pushBanner(
      `TEAM ${localTeam.toUpperCase()}`,
      `Steal the ${enemyName} Flag and return it to your base`,
      localTeam,
    );
    this.camera.position.copy(this.cameraCurrentPos);
    this.camera.lookAt(this.cameraLookPos);
    this.renderer.render(this.scene, this.camera);
    this.emitHud();
  }

  public applyServerSnapshot(snapshot: NetMatchSnapshot, events: NetGameEvent[]): void {
    if (this.networkMode !== 'multiplayer') return;

    this.scores = { ...snapshot.scores };
    this.matchTimeRemaining = snapshot.matchTimeRemaining;
    this.elapsedMatchTime = snapshot.elapsedMatchTime;
    this.weatherState.current = snapshot.weather.current;
    this.weatherState.target = snapshot.weather.target;
    this.weatherState.blend = snapshot.weather.blend;
    this.flags = {
      cobalt: { ...snapshot.flags.cobalt, homePos: { ...snapshot.flags.cobalt.homePos }, pos: { ...snapshot.flags.cobalt.pos } },
      crimson: { ...snapshot.flags.crimson, homePos: { ...snapshot.flags.crimson.homePos }, pos: { ...snapshot.flags.crimson.pos } },
    };

    // Reconcile actors list (preserve smooth visual interpolation & gaitPhase)
    const incomingIds = new Set<string>();
    const existingMap = new Map(this.actors.map((a) => [a.id, a]));
    const nextActors: ActorState[] = [];

    for (const na of snapshot.actors) {
      incomingIds.add(na.id);
      const isLocal = na.id === this.localPlayerId;
      let existing = existingMap.get(na.id);
      let rig = this.actorRigs.get(na.id);

      // Recreate rig if team/role/local identity changed or didn't exist yet
      if (!existing || !rig || existing.team !== na.team || existing.role !== na.role || existing.isPlayer !== isLocal) {
        if (rig) {
          this.scene.remove(rig.root);
          const oldNp = this.nameplateSprites.get(na.id);
          if (oldNp) {
            oldNp.material.map?.dispose();
            oldNp.material.dispose();
            this.nameplateSprites.delete(na.id);
          }
        }
        rig = createPaintballerRig(na.team, na.role, isLocal, this.textures.contactShadow);
        rig.root.position.set(na.pos.x, 0, na.pos.z);
        rig.root.rotation.y = na.facing;
        this.scene.add(rig.root);
        this.actorRigs.set(na.id, rig);

        if (na.isHuman) {
          const sprite = this.createNameplateSprite(na.name, na.team, isLocal);
          rig.root.add(sprite);
          this.nameplateSprites.set(na.id, sprite);
        }

        existing = {
          id: na.id,
          name: na.name,
          team: na.team,
          role: na.role,
          isPlayer: isLocal,
          isHuman: na.isHuman,
          pos: { x: na.pos.x, z: na.pos.z },
          vel: { x: na.vel.x, z: na.vel.z },
          facing: na.facing,
          radius: na.radius,
          hp: na.hp,
          maxHp: na.maxHp,
          ammo: na.ammo,
          maxAmmo: na.maxAmmo,
          reloading: na.reloading,
          reloadTimer: na.reloadTimer,
          fireCooldown: 0,
          burstCooldown: na.burstCooldown,
          dashCooldown: na.dashCooldown,
          dashTimer: na.dashTimer,
          dashDir: { x: 1, z: 0 },
          alive: na.alive,
          koTimer: na.koTimer,
          respawnTimer: na.respawnTimer,
          hitFlashTimer: na.hitFlashTimer,
          recoilAmount: na.recoilAmount,
          gaitPhase: 0,
          windupTimer: 0,
          telegraphingBurst: na.telegraphingBurst,
          aiWaypoint: null,
          aiStrafeDir: 1,
          aiThinkTimer: 0,
          buffs: na.buffs.map((b) => ({ ...b })),
          stunTimer: na.stunTimer,
          stunKillsProgress: na.stunKillsProgress,
          stunActivations: na.stunActivations,
          tags: na.tags,
          captures: na.captures,
          returns: na.returns,
        };
      } else {
        // Snap immediately on respawn or large teleport; otherwise smoothly interpolate in tick()
        const jumpDist = Math.hypot(na.pos.x - existing.pos.x, na.pos.z - existing.pos.z);
        if (jumpDist > 4.5 || (!existing.alive && na.alive)) {
          existing.pos.x = na.pos.x;
          existing.pos.z = na.pos.z;
          existing.facing = na.facing;
        }
        existing.name = na.name;
        existing.isHuman = na.isHuman;
        existing.vel.x = na.vel.x;
        existing.vel.z = na.vel.z;
        existing.hp = na.hp;
        existing.maxHp = na.maxHp;
        existing.ammo = na.ammo;
        existing.maxAmmo = na.maxAmmo;
        existing.reloading = na.reloading;
        existing.reloadTimer = na.reloadTimer;
        existing.burstCooldown = na.burstCooldown;
        existing.dashCooldown = na.dashCooldown;
        existing.dashTimer = na.dashTimer;
        existing.alive = na.alive;
        existing.koTimer = na.koTimer;
        existing.respawnTimer = na.respawnTimer;
        existing.hitFlashTimer = na.hitFlashTimer;
        existing.recoilAmount = na.recoilAmount;
        existing.telegraphingBurst = na.telegraphingBurst;
        existing.buffs = na.buffs.map((b) => ({ ...b }));
        existing.stunTimer = na.stunTimer;
        existing.stunKillsProgress = na.stunKillsProgress;
        existing.stunActivations = na.stunActivations;
        existing.tags = na.tags;
        existing.captures = na.captures;
        existing.returns = na.returns;
      }

      if (isLocal) {
        this.localTeam = na.team;
      }
      this.actorNetTargets.set(na.id, { x: na.pos.x, z: na.pos.z, facing: na.facing });
      nextActors.push(existing);
    }

    // Remove actors that no longer exist in snapshot
    for (const [id, rig] of this.actorRigs.entries()) {
      if (!incomingIds.has(id)) {
        this.scene.remove(rig.root);
        this.actorRigs.delete(id);
        this.actorNetTargets.delete(id);
        const np = this.nameplateSprites.get(id);
        if (np) {
          np.material.map?.dispose();
          np.material.dispose();
          this.nameplateSprites.delete(id);
        }
      }
    }
    this.actors = nextActors;

    // Reconcile field powerup drops
    const incomingPowerupIds = new Set<string>();
    this.powerups = snapshot.powerups.map((d) => {
      incomingPowerupIds.add(d.id);
      if (!this.powerupRigs.has(d.id)) {
        const rig = createPowerupDropRig(d.kind, this.textures.contactShadow);
        updatePowerupDropVisual(rig, d, this.totalTime);
        this.scene.add(rig.root);
        this.powerupRigs.set(d.id, rig);
      }
      return { ...d, pos: { ...d.pos } };
    });
    for (const [id, rig] of this.powerupRigs.entries()) {
      if (!incomingPowerupIds.has(id)) {
        this.scene.remove(rig.root);
        rig.dispose();
        this.powerupRigs.delete(id);
      }
    }

    // Sync active paintball projectiles directly into the zero-GC mesh pool
    const pMats = (
      this as unknown as { _pMats: Record<TeamId, { ball: THREE.Material; trail: THREE.Material }> }
    )._pMats;
    const count = Math.min(snapshot.projectiles.length, MAX_PROJECTILES);
    for (let i = 0; i < MAX_PROJECTILES; i++) {
      const slot = this.projectiles[i];
      if (i < count) {
        const np = snapshot.projectiles[i];
        slot.active = true;
        slot.team = np.team;
        slot.x = np.x;
        slot.y = np.y;
        slot.z = np.z;
        slot.vx = np.vx;
        slot.vz = np.vz;
        slot.splashRadius = np.splashRadius;
        slot.mesh.material = pMats[np.team].ball;
        slot.trail.material = pMats[np.team].trail;
        const isMega = np.splashRadius > 0;
        slot.mesh.scale.setScalar(isMega ? 1.65 : 1.0);
        slot.trail.scale.set(isMega ? 1.5 : 1.0, isMega ? 1.5 : 1.0, isMega ? 1.35 : 1.0);
        slot.mesh.position.set(np.x, np.y, np.z);
        const angle = Math.atan2(np.vx, np.vz);
        const spd = Math.hypot(np.vx, np.vz) || 1;
        slot.trail.rotation.set(0, angle, 0);
        slot.trail.position.set(np.x - (np.vx / spd) * 0.45, np.y, np.z - (np.vz / spd) * 0.45);
        slot.mesh.visible = true;
        slot.trail.visible = true;
      } else if (slot.active) {
        this.deactivateProjectile(slot);
      }
    }

    // Process discrete server VFX/SFX events
    this.applyServerEvents(events);

    // Handle match end
    if (snapshot.phase === 'gameover' && snapshot.endStats && this.phase !== 'gameover') {
      const localActor = this.actors.find((a) => a.isPlayer);
      const teamTags = this.actors
        .filter((a) => a.team === this.localTeam)
        .reduce((acc, a) => acc + a.tags, 0);
      this.endStats = {
        ...snapshot.endStats,
        playerTags: localActor?.tags ?? 0,
        playerCaptures: localActor?.captures ?? 0,
        playerReturns: localActor?.returns ?? 0,
        teamTags,
      };
      this.phase = 'gameover';
      document.body.dataset.state = 'gameover';
      this.clearInputs();
      this.audio.playFlagEvent('capture', snapshot.endStats.winner === this.localTeam);
      this.emitHud();
    }
  }

  private applyServerEvents(events: NetGameEvent[]): void {
    const localActor = this.actors.find((a) => a.isPlayer);
    for (const ev of events) {
      if (ev.type === 'shot') {
        const isLocal = ev.shooterId === this.localPlayerId;
        this.spawnParticles(
          ev.x,
          ev.y,
          ev.z,
          ev.isMega ? 6 : 3,
          ev.isMega ? POWERUP_META.mega_splash.glowHex : TEAM_PALETTE[ev.team].bright,
          1.5,
          4.5,
          ev.isMega ? 0.95 : 0.65,
          10,
        );
        if (isLocal) {
          this.muzzleLight.position.set(ev.x, ev.y + 0.3, ev.z);
          this.muzzleLight.color.setHex(
            ev.isMega ? POWERUP_META.mega_splash.glowHex : TEAM_PALETTE[ev.team].bright,
          );
          this.muzzleLightTimer = 0.06;
          this.audio.playShot(true, ev.isBurst ? 1.15 : 1.0);
          this.cameraTrauma = Math.min(1, this.cameraTrauma + (ev.isBurst ? 0.18 : 0.045));
        } else {
          const dist = localActor ? dist2D(localActor.pos, { x: ev.x, z: ev.z }) : 18;
          this.audio.playShot(false, Math.max(0.15, 1 - dist / 36));
        }
      } else if (ev.type === 'dash') {
        this.spawnParticles(
          ev.x,
          0.25,
          ev.z,
          10,
          ev.hasTurbo ? POWERUP_META.turbo_boots.glowHex : 0xd8d2be,
          2.0,
          5.0,
          1.0,
          8,
        );
        if (ev.actorId === this.localPlayerId) {
          this.audio.playDash();
        }
      } else if (ev.type === 'reload') {
        if (ev.actorId === this.localPlayerId) {
          this.audio.playReload();
        }
      } else if (ev.type === 'windup') {
        if (ev.targetId === this.localPlayerId) {
          this.audio.playWindupTelegraph();
        }
      } else if (ev.type === 'splat_ground') {
        this.spawnGroundSplat(ev.x, ev.z, ev.team, ev.scale);
        this.spawnParticles(ev.x, 0.25, ev.z, 6, TEAM_PALETTE[ev.team].paintHex, 2, 5.5, 0.8, 16);
      } else if (ev.type === 'splat_wall') {
        this.spawnWallSplat(ev.x, ev.y, ev.z, ev.nx, ev.nz, ev.team);
        this.spawnParticles(ev.x, ev.y, ev.z, 9, TEAM_PALETTE[ev.team].paintHex, 2.2, 6.2, 0.9, 17);
        if (ev.shooterId === this.localPlayerId) {
          this.audio.playSplat(false, 0.65);
        }
      } else if (ev.type === 'splash_boom') {
        this.spawnGroundSplat(
          Math.max(-ARENA_HALF_W + 0.6, Math.min(ARENA_HALF_W - 0.6, ev.x)),
          Math.max(-ARENA_HALF_D + 0.6, Math.min(ARENA_HALF_D - 0.6, ev.z)),
          ev.team,
          1.95,
        );
        this.spawnParticles(ev.x, Math.max(0.4, ev.y), ev.z, 18, TEAM_PALETTE[ev.team].paintHex, 3.5, 9.0, 1.15, 14);
        this.spawnParticles(ev.x, Math.max(0.5, ev.y), ev.z, 10, POWERUP_META.mega_splash.glowHex, 2.5, 7.2, 0.95, 11);
        if (ev.shooterId === this.localPlayerId) {
          this.audio.playSplashExplosion(0.95);
          this.cameraTrauma = Math.min(1, this.cameraTrauma + 0.14);
        }
      } else if (ev.type === 'hit') {
        this.spawnParticles(
          ev.x,
          1.15,
          ev.z,
          ev.fatal ? 24 : 12,
          ev.hasShield ? POWERUP_META.paint_shield.glowHex : TEAM_PALETTE[ev.team].paintHex,
          ev.fatal ? 3.5 : 2.5,
          ev.fatal ? 9.5 : 7.2,
          ev.fatal ? 1.25 : 0.95,
          16,
        );
        const hitLocal = ev.targetId === this.localPlayerId;
        const shotByLocal = ev.shooterId === this.localPlayerId;
        if (hitLocal || shotByLocal) {
          this.audio.playSplat(ev.fatal, 1.0);
        }
        if (hitLocal) {
          this.cameraTrauma = Math.min(1, this.cameraTrauma + (ev.fatal ? 0.55 : ev.hasShield ? 0.14 : 0.24));
        }
        if (ev.fatal) {
          if (shotByLocal) {
            this.hitstopTimer = 0.042;
            this.cameraTrauma = Math.min(1, this.cameraTrauma + 0.26);
            this.audio.playTagOut(true);
          } else if (hitLocal) {
            this.hitstopTimer = 0.06;
            this.audio.playTagOut(false);
            const homeLabel = this.localTeam === 'cobalt' ? 'Cobalt' : 'Crimson';
            this.pushBanner('TAGGED OUT!', `Respawning at ${homeLabel} Base in ${RESPAWN_TIME.toFixed(0)}s`, oppositeTeam(this.localTeam));
          }
        }
      } else if (ev.type === 'respawn') {
        this.spawnParticles(ev.x, 0.9, ev.z, 12, TEAM_PALETTE[ev.team].bright, 2, 5, 0.9, 10);
      } else if (ev.type === 'flag_event') {
        const actorTeam = ev.actorTeam ?? 'cobalt';
        const isFriendlyAction = actorTeam === this.localTeam;
        const flagLabel = ev.flagTeam === 'cobalt' ? 'Cobalt' : 'Crimson';
        const teamLabel = actorTeam === 'cobalt' ? 'Cobalt' : 'Crimson';
        if (ev.kind === 'pickup') {
          this.audio.playFlagEvent('pickup', isFriendlyAction);
          this.spawnParticles(ev.pos.x, 1.4, ev.pos.z, 16, TEAM_PALETTE[ev.flagTeam].bright, 2.5, 6.5, 1.1, 10);
          this.pushBanner(
            `${teamLabel.toUpperCase()} TOOK THE FLAG`,
            `${ev.actorName ?? teamLabel} grabbed the ${flagLabel} Flag`,
            actorTeam,
          );
        } else if (ev.kind === 'return') {
          this.audio.playFlagEvent('return', isFriendlyAction);
          this.spawnParticles(ev.pos.x, 1.2, ev.pos.z, 14, TEAM_PALETTE[ev.flagTeam].bright, 2.2, 5.5, 1.0, 10);
          this.pushBanner(
            `${flagLabel.toUpperCase()} FLAG RETURNED`,
            `${ev.actorName ?? teamLabel} secured the flag back at base`,
            ev.flagTeam,
          );
        } else if (ev.kind === 'auto_return') {
          this.pushBanner(`${flagLabel.toUpperCase()} FLAG RESET`, 'Returned automatically to base', ev.flagTeam);
        } else if (ev.kind === 'drop') {
          this.pushBanner(`${flagLabel.toUpperCase()} FLAG DROPPED!`, 'Touch to return or reclaim', ev.flagTeam);
        } else if (ev.kind === 'capture') {
          this.audio.playFlagEvent('capture', isFriendlyAction);
          this.cameraTrauma = Math.min(1, this.cameraTrauma + 0.45);
          this.spawnParticles(ev.pos.x, 1.8, ev.pos.z, 28, TEAM_PALETTE[actorTeam].bright, 4.0, 10.0, 1.35, 9);
          this.pushBanner(
            `${teamLabel.toUpperCase()} SCORED!`,
            `${ev.actorName ?? teamLabel} captured the ${flagLabel} Flag (${ev.cobaltScore} – ${ev.crimsonScore})`,
            actorTeam,
          );
          this.emitHud();
        }
      } else if (ev.type === 'powerup_event') {
        const meta = POWERUP_META[ev.powerupKind];
        if (ev.kind === 'landed') {
          this.spawnParticles(ev.pos.x, 0.35, ev.pos.z, 14, meta.glowHex, 2.2, 5.8, 0.95, 11);
          this.audio.playPowerupSpawn();
        } else if (ev.kind === 'collected') {
          this.spawnParticles(ev.pos.x, 1.0, ev.pos.z, 22, meta.glowHex, 3.0, 8.2, 1.1, 10);
          const isLocal = ev.actorId === this.localPlayerId;
          this.audio.playPowerupCollect(isLocal);
          if (isLocal) {
            this.cameraTrauma = Math.min(1, this.cameraTrauma + 0.14);
            this.pushBanner(`${meta.label} ACTIVE`, meta.shortDesc, this.localTeam);
            this.emitHud();
          }
        }
      } else if (ev.type === 'weather_shift') {
        const label = WEATHER_LABELS[ev.weather].toUpperCase();
        const desc =
          ev.weather === 'overcast'
            ? 'Cloud cover drifting across Canyon Ridge'
            : ev.weather === 'light_fog'
              ? 'Light alpine mist settling over the bunkers'
              : 'Golden afternoon sunlight returning to the arena';
        this.pushBanner(`WEATHER: ${label}`, desc, 'neutral');
      } else if (ev.type === 'stun_wave') {
        this.spawnStunShockwaveVfx(ev.x, ev.z, ev.radius, ev.team);
        for (const targetId of ev.affectedIds) {
          const target = this.actors.find((a) => a.id === targetId);
          if (target) {
            this.spawnParticles(target.pos.x, 1.35, target.pos.z, 14, 0x38bdf8, 2.2, 6.2, 0.95, 10);
          }
        }
        const isLocalCaster = ev.casterId === this.localPlayerId;
        const hitLocal = this.localPlayerId ? ev.affectedIds.includes(this.localPlayerId) : false;
        this.audio.playStunShockwave(isLocalCaster || hitLocal);
        if (isLocalCaster) {
          this.cameraTrauma = Math.min(1, this.cameraTrauma + 0.34);
          const count = ev.affectedIds.length;
          this.pushBanner(
            `STUN SHOCKWAVE · LV.${ev.tier}`,
            count > 0
              ? `Stunned ${count} opponent${count === 1 ? '' : 's'} for 4.0s (${ev.radius.toFixed(1)}m radius)`
              : `Pulse unleashed (${ev.radius.toFixed(1)}m radius) — next radius grows!`,
            ev.team,
          );
          this.emitHud();
        } else if (hitLocal) {
          this.cameraTrauma = Math.min(1, this.cameraTrauma + 0.38);
          this.pushBanner('STUNNED!', `${ev.casterName} froze your movement & marker for 4.0s`, ev.team);
          this.emitHud();
        }
      } else if (ev.type === 'stun_ready') {
        if (ev.actorId === this.localPlayerId) {
          this.audio.playStunReady();
          this.pushBanner(
            'STUN SHOCKWAVE READY!',
            'Press [Q] to unleash a 4s enemy stun pulse (carries across respawn)',
            this.localTeam,
          );
          this.emitHud();
        }
      } else if (ev.type === 'banner') {
        this.pushBanner(ev.text, ev.subtext, ev.team);
      }
    }
  }

  public startMatch(): void {
    this.networkMode = 'solo';
    this.localPlayerId = null;
    this.localTeam = 'cobalt';
    this.roomCode = null;
    this.isHost = false;
    this.connectedPlayers = 1;
    this.audio.unlock();
    this.clearInputs();
    this.clearSplatters();
    for (const p of this.projectiles) {
      p.active = false;
      p.mesh.visible = false;
      p.trail.visible = false;
    }

    this.scores = { cobalt: 0, crimson: 0 };
    this.matchTimeRemaining = MATCH_DURATION_SEC;
    this.elapsedMatchTime = 0;
    this.endStats = null;
    this.banner = null;
    this.bannerTimer = 0;
    this.hitstopTimer = 0;
    this.cameraTrauma = 0;

    this.setupActors(false);
    this.seedShowcaseSplatters();
    this.resetPowerups(false);

    // Immediately snap camera framing onto player side so first playing frame looks crisp
    const player = this.actors.find((a) => a.isPlayer);
    if (player) {
      this.cameraLookPos.set(player.pos.x + 4, 0, player.pos.z);
      this.cameraCurrentPos.set(player.pos.x + 1, 21.5, player.pos.z + 17.5);
      this.aimMode = 'keyboard';
      this.aimOffset = { x: 8.5, z: 0 };
      this.pointerClient.active = false;
      this.aimWorldPos = { x: player.pos.x + this.aimOffset.x, z: player.pos.z + this.aimOffset.z };
    }

    this.phase = 'playing';
    document.body.dataset.state = 'playing';
    this.pushBanner('MATCH START', 'Steal the Crimson Flag and watch for tactical field drops', 'cobalt');
    this.camera.position.copy(this.cameraCurrentPos);
    this.camera.lookAt(this.cameraLookPos);
    this.renderer.render(this.scene, this.camera);
    this.emitHud();
  }

  public togglePause(): void {
    if (this.phase === 'playing') {
      this.phase = 'paused';
      document.body.dataset.state = 'paused';
      this.clearInputs();
      this.emitHud();
    } else if (this.phase === 'paused') {
      this.phase = 'playing';
      document.body.dataset.state = 'playing';
      this.lastNow = performance.now();
      this.emitHud();
    }
  }

  public returnToTitle(): void {
    this.clearInputs();
    this.networkMode = 'solo';
    this.localPlayerId = null;
    this.localTeam = 'cobalt';
    this.roomCode = null;
    this.isHost = false;
    this.connectedPlayers = 1;
    this.phase = 'title';
    document.body.dataset.state = 'title';
    this.endStats = null;
    this.banner = null;
    this.scores = { cobalt: 0, crimson: 0 };
    this.setupActors(true);
    this.resetPowerups(true);
    this.emitHud();
  }

  public toggleMute(): void {
    this.audio.setMuted(!this.audio.muted);
    this.emitHud();
  }

  public dispose(): void {
    this.running = false;
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);
    window.removeEventListener('keydown', this.boundKeyDown);
    window.removeEventListener('keyup', this.boundKeyUp);
    window.removeEventListener('pointermove', this.boundPointerMove);
    this.renderer.domElement.removeEventListener('pointerdown', this.boundPointerDown);
    window.removeEventListener('pointerup', this.boundPointerUp);
    this.renderer.domElement.removeEventListener('contextmenu', this.boundContextMenu);
    window.removeEventListener('blur', this.boundBlur);
    document.removeEventListener('visibilitychange', this.boundVisibility);
    this.resizeObserver.disconnect();
    this.clearPowerups();
    this.weatherRig.dispose();
    this.textures.dispose();
    this.envCleanup();
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }

  // =========================================================================
  // INPUT & RESIZE HANDLERS
  // =========================================================================

  private clearInputs(): void {
    this.keysPressed.clear();
    this.mouseDownLeft = false;
    this.mouseDownRight = false;
    if (this.networkMode === 'multiplayer' && this.phase === 'playing') {
      this.sendCurrentMultiplayerInput();
    }
  }

  private sendCurrentMultiplayerInput(): void {
    if (this.networkMode !== 'multiplayer' || !this.inputSender) return;
    const player = this.actors.find((a) => a.isPlayer);
    if (!player) return;

    let moveX = 0;
    let moveZ = 0;
    let firing = false;
    if (this.phase === 'playing') {
      if (this.keysPressed.has('KeyW')) moveZ -= 1;
      if (this.keysPressed.has('KeyS')) moveZ += 1;
      if (this.keysPressed.has('KeyA')) moveX -= 1;
      if (this.keysPressed.has('KeyD')) moveX += 1;
      firing = this.keysPressed.has('Space') || this.mouseDownLeft;
    }

    const packet: PlayerInputPacket = {
      moveX,
      moveZ,
      aimAngle: player.facing,
      firing,
      dash: this.pendingNetDash || undefined,
      burst: this.pendingNetBurst || undefined,
      reload: this.pendingNetReload || undefined,
      stunWave: this.pendingNetStunWave || undefined,
    };
    this.pendingNetDash = false;
    this.pendingNetBurst = false;
    this.pendingNetReload = false;
    this.pendingNetStunWave = false;
    this.inputSendTimer = 0;
    this.inputSender(packet);
  }

  private handleResize(): void {
    const rect = this.container.getBoundingClientRect();
    const w = Math.max(rect.width, 320);
    const h = Math.max(rect.height, 240);
    this.canvasBounds = { left: rect.left, top: rect.top, width: w, height: h };
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.renderer.render(this.scene, this.camera);
  }

  private handleKeyDown(e: KeyboardEvent): void {
    const code = e.code;
    if (this.phase === 'title') {
      if (this.titleHotkeysBlocked) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (code === 'Enter' || code === 'Space') {
        e.preventDefault();
        this.startMatch();
      }
      return;
    }

    if (code === 'KeyP' || code === 'Escape') {
      if (this.phase === 'playing' || this.phase === 'paused') {
        e.preventDefault();
        this.togglePause();
      }
      return;
    }

    if (code === 'KeyM') {
      e.preventDefault();
      this.toggleMute();
      return;
    }

    if (this.phase !== 'playing') return;

    this.audio.unlock();

    if (
      code === 'Space' ||
      code === 'ArrowUp' ||
      code === 'ArrowDown' ||
      code === 'ArrowLeft' ||
      code === 'ArrowRight'
    ) {
      e.preventDefault();
      if (code.startsWith('Arrow')) {
        this.aimMode = 'keyboard';
      }
    } else if (code === 'ShiftLeft' || code === 'ShiftRight') {
      e.preventDefault();
      if (!this.keysPressed.has(code)) {
        if (this.networkMode === 'multiplayer') {
          this.pendingNetDash = true;
        } else {
          this.triggerPlayerDash();
        }
      }
    } else if (code === 'KeyR') {
      e.preventDefault();
      if (this.networkMode === 'multiplayer') {
        this.pendingNetReload = true;
      } else {
        this.triggerPlayerReload();
      }
    } else if (code === 'KeyE') {
      e.preventDefault();
      if (this.networkMode === 'multiplayer') {
        this.pendingNetBurst = true;
      } else {
        this.triggerPlayerBurst();
      }
    } else if (code === 'KeyQ') {
      e.preventDefault();
      if (!this.keysPressed.has(code)) {
        if (this.networkMode === 'multiplayer') {
          this.pendingNetStunWave = true;
        } else {
          this.triggerPlayerStunWave();
        }
      }
    }

    this.keysPressed.add(code);
    if (this.networkMode === 'multiplayer') {
      this.sendCurrentMultiplayerInput();
    }
  }

  private handleKeyUp(e: KeyboardEvent): void {
    if (this.phase === 'playing' && e.code === 'Space') {
      e.preventDefault();
    }
    this.keysPressed.delete(e.code);
    if (this.networkMode === 'multiplayer' && this.phase === 'playing') {
      this.sendCurrentMultiplayerInput();
    }
  }

  private handlePointerMove(e: PointerEvent): void {
    const wasActive = this.pointerClient.active;
    const movedDist = wasActive
      ? Math.hypot(e.clientX - this.pointerClient.x, e.clientY - this.pointerClient.y)
      : 0;
    this.pointerClient.x = e.clientX;
    this.pointerClient.y = e.clientY;
    this.pointerClient.active = true;
    if (this.phase === 'playing' && wasActive && movedDist > 6) {
      this.aimMode = 'mouse';
    }
  }

  private handlePointerDown(e: PointerEvent): void {
    if (this.phase !== 'playing') return;
    this.audio.unlock();
    this.pointerClient.x = e.clientX;
    this.pointerClient.y = e.clientY;
    this.pointerClient.active = true;
    this.aimMode = 'mouse';

    if (e.button === 0) {
      this.mouseDownLeft = true;
    } else if (e.button === 2) {
      this.mouseDownRight = true;
      if (this.networkMode === 'multiplayer') {
        this.pendingNetBurst = true;
      } else {
        this.triggerPlayerBurst();
      }
    }
    if (this.networkMode === 'multiplayer') {
      this.sendCurrentMultiplayerInput();
    }
  }

  private handlePointerUp(e: PointerEvent): void {
    if (e.button === 0) this.mouseDownLeft = false;
    if (e.button === 2) this.mouseDownRight = false;
    if (this.networkMode === 'multiplayer' && this.phase === 'playing') {
      this.sendCurrentMultiplayerInput();
    }
  }

  private updateAimFromPointer(): void {
    if (!this.pointerClient.active) return;
    const { left, top, width, height } = this.canvasBounds;
    if (width <= 0 || height <= 0) return;
    _ndc.x = ((this.pointerClient.x - left) / width) * 2 - 1;
    _ndc.y = -((this.pointerClient.y - top) / height) * 2 + 1;
    _raycaster.setFromCamera(_ndc, this.camera);
    if (_raycaster.ray.intersectPlane(_aimPlane, _v3A)) {
      this.aimWorldPos.x = Math.max(-ARENA_HALF_W, Math.min(ARENA_HALF_W, _v3A.x));
      this.aimWorldPos.z = Math.max(-ARENA_HALF_D, Math.min(ARENA_HALF_D, _v3A.z));
    }
  }

  private triggerPlayerDash(): void {
    const player = this.actors.find((a) => a.isPlayer);
    if (!player || !player.alive || player.stunTimer > 0 || player.dashCooldown > 0) return;

    let dx = 0;
    let dz = 0;
    if (this.keysPressed.has('KeyW')) dz -= 1;
    if (this.keysPressed.has('KeyS')) dz += 1;
    if (this.keysPressed.has('KeyA')) dx -= 1;
    if (this.keysPressed.has('KeyD')) dx += 1;

    if (dx === 0 && dz === 0) {
      dx = Math.sin(player.facing);
      dz = Math.cos(player.facing);
    } else {
      const len = Math.hypot(dx, dz);
      dx /= len;
      dz /= len;
    }

    const buffs = getActorBuffEffects(player);
    player.dashDir = { x: dx, z: dz };
    player.dashTimer = DASH_DURATION;
    player.dashCooldown = DASH_COOLDOWN * buffs.dashCooldownMult;
    this.audio.playDash();
    this.spawnParticles(
      player.pos.x,
      0.25,
      player.pos.z,
      10,
      buffs.hasTurbo ? POWERUP_META.turbo_boots.glowHex : 0xd8d2be,
      2.0,
      5.0,
      1.0,
      8,
    );
  }

  private triggerPlayerReload(): void {
    const player = this.actors.find((a) => a.isPlayer);
    if (!player || !player.alive || player.stunTimer > 0 || player.reloading || player.ammo >= player.maxAmmo) return;
    player.reloading = true;
    player.reloadTimer = RELOAD_DURATION;
    this.audio.playReload();
  }

  private triggerPlayerBurst(): void {
    const player = this.actors.find((a) => a.isPlayer);
    if (!player || !player.alive || player.stunTimer > 0 || player.reloading || player.burstCooldown > 0) return;
    const buffs = getActorBuffEffects(player);
    if (!buffs.infiniteAmmo && player.ammo < 3) return;
    player.burstCooldown = BURST_COOLDOWN;
    if (!buffs.infiniteAmmo) {
      player.ammo = Math.max(0, player.ammo - 3);
    }
    player.recoilAmount = 1.0;

    const baseAngle = player.facing;
    for (const spread of [-0.11, 0, 0.11]) {
      this.firePaintball(player, baseAngle + spread, Math.round(23 * buffs.damageDealMult), 30, buffs.splashRadius);
    }
    this.audio.playShot(true, 1.15);
    this.cameraTrauma = Math.min(1, this.cameraTrauma + 0.18);
    if (!buffs.infiniteAmmo && player.ammo === 0) {
      player.reloading = true;
      player.reloadTimer = RELOAD_DURATION;
      this.audio.playReload();
    }
  }

  private triggerPlayerStunWave(): void {
    const player = this.actors.find((a) => a.isPlayer);
    if (!player || !player.alive || player.stunTimer > 0) return;
    const res = triggerStunShockwave(player, this.actors);
    if (!res.triggered) return;

    this.spawnStunShockwaveVfx(player.pos.x, player.pos.z, res.radius, player.team);
    for (const targetId of res.affectedIds) {
      const target = this.actors.find((a) => a.id === targetId);
      if (target) {
        this.spawnParticles(target.pos.x, 1.35, target.pos.z, 14, 0x38bdf8, 2.2, 6.2, 0.95, 10);
      }
    }
    this.audio.playStunShockwave(true);
    this.cameraTrauma = Math.min(1, this.cameraTrauma + 0.34);

    const count = res.affectedIds.length;
    const nextRadius = computeStunWaveRadius(player.stunActivations);
    this.pushBanner(
      `STUN SHOCKWAVE · LV.${res.tier}`,
      count > 0
        ? `Stunned ${count} opponent${count === 1 ? '' : 's'} for 4.0s (${res.radius.toFixed(1)}m · Next ${nextRadius.toFixed(1)}m)`
        : `Pulse unleashed (${res.radius.toFixed(1)}m · Next radius ${nextRadius.toFixed(1)}m)`,
      player.team,
    );
    this.emitHud();
  }

  // =========================================================================
  // SIMULATION & RENDER LOOP (with Software-WebGL afterDraw pacing)
  // =========================================================================

  private scheduleNextFrame(): void {
    if (!this.running) return;
    if (this.isSoftwareGl) {
      const gl = this.renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (!this.running) {
          if (sync) gl.deleteSync(sync);
          return;
        }
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          this.frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          this.frameId = window.setTimeout(() => this.tick(), 80);
        }
      };
      this.frameId = window.setTimeout(poll, 5);
    } else {
      this.frameId = requestAnimationFrame(() => this.tick());
    }
  }

  private tick(): void {
    if (!this.running) return;
    const now = performance.now();
    const rawDt = (now - this.lastNow) / 1000;
    this.lastNow = now;
    const dt = Math.min(Math.max(rawDt, 0.001), 0.05);
    this.totalTime += dt;

    const shouldAnimate = this.phase !== 'paused' || this.networkMode === 'multiplayer';
    if (shouldAnimate) {
      // Hitstop freezes simulation kinematics briefly while hit flash & shake keep ticking
      let simDt = dt;
      if (this.hitstopTimer > 0) {
        this.hitstopTimer = Math.max(0, this.hitstopTimer - dt);
        simDt = 0;
      }

      if (this.networkMode === 'multiplayer') {
        this.stepMultiplayerClientFrame(dt);
        this.applyWeatherAtmosphere(this.totalTime);
      } else {
        if (this.phase === 'playing' || this.phase === 'title') {
          if (simDt > 0) {
            this.stepSimulation(simDt, this.phase === 'title');
          }
        }
        this.stepWeather(dt, this.phase === 'title');
      }

      this.stepParticles(dt);
      this.stepShockwaves(dt);
      this.stepAmbientPollen(dt);
      this.syncActorVisuals(dt);
      this.syncFlagMeshes(this.totalTime);
      this.syncPowerupMeshes(this.totalTime);
      this.updateCamera(dt);

      if (this.muzzleLightTimer > 0) {
        this.muzzleLightTimer -= dt;
        this.muzzleLight.intensity = Math.max(0, (this.muzzleLightTimer / 0.06) * 5.0);
      }
      if (this.bannerTimer > 0) {
        this.bannerTimer -= dt;
        if (this.bannerTimer <= 0) {
          this.banner = null;
        }
      }
    }

    this.renderer.render(this.scene, this.camera);

    // Throttled HUD emission (<= 10Hz) so React never fights 60fps WebGL loop
    this.hudEmitTimer += dt;
    if (this.hudEmitTimer >= 0.1) {
      this.hudEmitTimer = 0;
      this.emitHud();
    }

    this.scheduleNextFrame();
  }

  private stepMultiplayerClientFrame(dt: number): void {
    // Smoothly interpolate all actors toward latest authoritative server targets
    const interp = 1 - Math.exp(-18 * dt);
    for (const actor of this.actors) {
      const target = this.actorNetTargets.get(actor.id);
      if (target) {
        const prevX = actor.pos.x;
        const prevZ = actor.pos.z;
        actor.pos.x = THREE.MathUtils.lerp(actor.pos.x, target.x, interp);
        actor.pos.z = THREE.MathUtils.lerp(actor.pos.z, target.z, interp);
        if (!actor.isPlayer) {
          actor.facing = this.lerpAngle(actor.facing, target.facing, interp);
        }
        const moved = Math.hypot(actor.pos.x - prevX, actor.pos.z - prevZ);
        actor.gaitPhase += moved * 2.8;
      }
    }

    // Extrapolate active projectiles smoothly between 30Hz snapshots
    for (let i = 0; i < MAX_PROJECTILES; i++) {
      const p = this.projectiles[i];
      if (!p.active) continue;
      p.x += p.vx * dt;
      p.z += p.vz * dt;
      p.mesh.position.set(p.x, p.y, p.z);
      const spd = Math.hypot(p.vx, p.vz) || 1;
      p.trail.position.set(p.x - (p.vx / spd) * 0.45, p.y, p.z - (p.vz / spd) * 0.45);
    }

    // Sample local player WASD + Arrow/Mouse aim + Space fire and transmit to server
    const player = this.actors.find((a) => a.isPlayer);
    if (!player) return;

    let moveX = 0;
    let moveZ = 0;
    let firing = false;
    if (this.phase === 'playing') {
      if (this.aimMode === 'mouse') {
        this.updateAimFromPointer();
      }
      if (this.keysPressed.has('KeyW')) moveZ -= 1;
      if (this.keysPressed.has('KeyS')) moveZ += 1;
      if (this.keysPressed.has('KeyA')) moveX -= 1;
      if (this.keysPressed.has('KeyD')) moveX += 1;

      let aimMoveX = 0;
      let aimMoveZ = 0;
      if (this.keysPressed.has('ArrowUp')) aimMoveZ -= 1;
      if (this.keysPressed.has('ArrowDown')) aimMoveZ += 1;
      if (this.keysPressed.has('ArrowLeft')) aimMoveX -= 1;
      if (this.keysPressed.has('ArrowRight')) aimMoveX += 1;

      if (aimMoveX !== 0 || aimMoveZ !== 0) {
        this.aimMode = 'keyboard';
        const aimLen = Math.hypot(aimMoveX, aimMoveZ);
        const aimSpeed = 22.0;
        this.aimOffset.x += (aimMoveX / aimLen) * aimSpeed * dt;
        this.aimOffset.z += (aimMoveZ / aimLen) * aimSpeed * dt;
        const offsetDist = Math.hypot(this.aimOffset.x, this.aimOffset.z);
        if (offsetDist > 17.5) {
          this.aimOffset.x = (this.aimOffset.x / offsetDist) * 17.5;
          this.aimOffset.z = (this.aimOffset.z / offsetDist) * 17.5;
        } else if (offsetDist > 0.001 && offsetDist < 1.8) {
          this.aimOffset.x = (this.aimOffset.x / offsetDist) * 1.8;
          this.aimOffset.z = (this.aimOffset.z / offsetDist) * 1.8;
        }
      }

      if (this.aimMode === 'keyboard') {
        this.aimWorldPos.x = Math.max(-ARENA_HALF_W, Math.min(ARENA_HALF_W, player.pos.x + this.aimOffset.x));
        this.aimWorldPos.z = Math.max(-ARENA_HALF_D, Math.min(ARENA_HALF_D, player.pos.z + this.aimOffset.z));
      } else {
        const ox = this.aimWorldPos.x - player.pos.x;
        const oz = this.aimWorldPos.z - player.pos.z;
        const od = Math.hypot(ox, oz);
        if (od > 0.1) {
          const clampedDist = Math.max(1.8, Math.min(17.5, od));
          this.aimOffset.x = (ox / od) * clampedDist;
          this.aimOffset.z = (oz / od) * clampedDist;
        }
      }

      const aimDx = this.aimWorldPos.x - player.pos.x;
      const aimDz = this.aimWorldPos.z - player.pos.z;
      if (aimDx * aimDx + aimDz * aimDz > 0.04) {
        player.facing = Math.atan2(aimDx, aimDz);
      }
      firing = this.keysPressed.has('Space') || this.mouseDownLeft;
    }

    this.inputSendTimer += dt;
    const hasUrgent =
      this.pendingNetDash || this.pendingNetBurst || this.pendingNetReload || this.pendingNetStunWave;
    if (this.inputSender && (hasUrgent || this.inputSendTimer >= 0.035)) {
      this.sendCurrentMultiplayerInput();
    }
  }

  private stepSimulation(dt: number, isTitleShowcase: boolean): void {
    if (!isTitleShowcase) {
      this.matchTimeRemaining = Math.max(0, this.matchTimeRemaining - dt);
      this.elapsedMatchTime += dt;
      if (this.aimMode === 'mouse') {
        this.updateAimFromPointer();
      }
    }

    // Replenish crowd attack token pool each tick (keeps multi-enemy firefights fair & readable)
    this.attackTokenPool = this.config.difficulty === 'veteran' ? 4 : 3;

    // 1. Update all actors (Player + NPCs)
    for (const actor of this.actors) {
      if (actor.hitFlashTimer > 0) actor.hitFlashTimer = Math.max(0, actor.hitFlashTimer - dt);
      if (actor.recoilAmount > 0) actor.recoilAmount = Math.max(0, actor.recoilAmount - dt * 6.5);
      if (actor.fireCooldown > 0) actor.fireCooldown = Math.max(0, actor.fireCooldown - dt);
      if (actor.burstCooldown > 0) actor.burstCooldown = Math.max(0, actor.burstCooldown - dt);
      if (actor.dashCooldown > 0) actor.dashCooldown = Math.max(0, actor.dashCooldown - dt);
      if (actor.stunTimer > 0) actor.stunTimer = Math.max(0, actor.stunTimer - dt);
      stepActorBuffs(actor, dt);

      if (!actor.alive) {
        if (actor.koTimer > 0) actor.koTimer = Math.max(0, actor.koTimer - dt);
        actor.respawnTimer -= dt;
        if (actor.respawnTimer <= 0) {
          this.respawnActor(actor);
        }
        continue;
      }

      if (actor.reloading) {
        actor.reloadTimer -= dt;
        if (actor.reloadTimer <= 0) {
          actor.reloading = false;
          actor.ammo = actor.maxAmmo;
        }
      }

      if (actor.stunTimer > 0) {
        // Stunned actors cannot move or shoot for the full stun duration
        actor.vel.x = 0;
        actor.vel.z = 0;
        actor.dashTimer = 0;
        actor.telegraphingBurst = false;
        continue;
      }

      if (actor.isPlayer) {
        this.stepPlayerActor(actor, dt);
      } else {
        this.stepAiActor(actor, dt, isTitleShowcase);
      }
    }

    // Soft actor-vs-actor separation so teammates/enemies never stack inside each other
    for (let i = 0; i < this.actors.length; i++) {
      const a = this.actors[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < this.actors.length; j++) {
        const b = this.actors[j];
        if (!b.alive) continue;
        const dx = b.pos.x - a.pos.x;
        const dz = b.pos.z - a.pos.z;
        const minDist = a.radius + b.radius;
        const dSq = dx * dx + dz * dz;
        if (dSq < minDist * minDist && dSq > 1e-5) {
          const d = Math.sqrt(dSq);
          const push = (minDist - d) * 0.5;
          const nx = dx / d;
          const nz = dz / d;
          a.pos.x -= nx * push;
          a.pos.z -= nz * push;
          b.pos.x += nx * push;
          b.pos.z += nz * push;
        }
      }
    }

    // 2. Step Paintball Projectiles
    this.stepProjectiles(dt, isTitleShowcase);

    // 3. Step Flag Rules (Pickups, Returns, Captures)
    const flagEvents = stepFlagRules(dt, this.actors, this.flags, this.scores);
    for (const ev of flagEvents) {
      if (isTitleShowcase) {
        // Keep showcase endless without triggering gameover
        if (ev.type === 'capture') {
          this.scores.cobalt = 0;
          this.scores.crimson = 0;
        }
        continue;
      }

      const actor = this.actors.find((a) => a.id === ev.actorId);
      const actorTeam = ev.actorTeam ?? 'cobalt';
      const flagLabel = ev.flagTeam === 'cobalt' ? 'Cobalt' : 'Crimson';
      const teamLabel = actorTeam === 'cobalt' ? 'Cobalt' : 'Crimson';

      if (ev.type === 'pickup') {
        this.audio.playFlagEvent('pickup', actorTeam === 'cobalt');
        this.spawnParticles(ev.pos.x, 1.4, ev.pos.z, 16, TEAM_PALETTE[ev.flagTeam].bright, 2.5, 6.5, 1.1, 10);
        this.pushBanner(
          `${teamLabel.toUpperCase()} TOOK THE FLAG`,
          `${actor?.name ?? teamLabel} grabbed the ${flagLabel} Flag`,
          actorTeam,
        );
      } else if (ev.type === 'return') {
        this.audio.playFlagEvent('return', actorTeam === 'cobalt');
        this.spawnParticles(ev.pos.x, 1.2, ev.pos.z, 14, TEAM_PALETTE[ev.flagTeam].bright, 2.2, 5.5, 1.0, 10);
        this.pushBanner(
          `${flagLabel.toUpperCase()} FLAG RETURNED`,
          `${actor?.name ?? teamLabel} secured the flag back at base`,
          ev.flagTeam,
        );
      } else if (ev.type === 'auto_return') {
        this.pushBanner(`${flagLabel.toUpperCase()} FLAG RESET`, 'Returned automatically to base', ev.flagTeam);
      } else if (ev.type === 'capture') {
        this.audio.playFlagEvent('capture', actorTeam === 'cobalt');
        this.cameraTrauma = Math.min(1, this.cameraTrauma + 0.45);
        this.spawnParticles(ev.pos.x, 1.8, ev.pos.z, 28, TEAM_PALETTE[actorTeam].bright, 4.0, 10.0, 1.35, 9);
        this.pushBanner(
          `${teamLabel.toUpperCase()} SCORED!`,
          `${actor?.name ?? teamLabel} captured the ${flagLabel} Flag (${this.scores.cobalt} – ${this.scores.crimson})`,
          actorTeam,
        );
        this.emitHud();
      }
    }

    // 3b. Step Field Powerup Air-Drops & Collections
    this.stepPowerupSystem(dt, isTitleShowcase);

    // 4. Evaluate Match Win / Timer Finish
    if (!isTitleShowcase) {
      const winner = evaluateMatchWinner(this.scores, this.matchTimeRemaining, SCORE_LIMIT);
      if (winner !== null) {
        this.finishMatch(winner);
      }
    }
  }

  private stepPlayerActor(player: ActorState, dt: number): void {
    const buffs = getActorBuffEffects(player);
    const carryingFlag =
      this.flags.crimson.status === 'carried' && this.flags.crimson.carrierId === player.id;
    const baseSpeed = (carryingFlag ? 7.6 : 8.6) * buffs.speedMult;

    let moveX = 0;
    let moveZ = 0;
    if (this.keysPressed.has('KeyW')) moveZ -= 1;
    if (this.keysPressed.has('KeyS')) moveZ += 1;
    if (this.keysPressed.has('KeyA')) moveX -= 1;
    if (this.keysPressed.has('KeyD')) moveX += 1;

    if (player.dashTimer > 0) {
      player.dashTimer = Math.max(0, player.dashTimer - dt);
      const dashSpd = 19.5 * (buffs.hasTurbo ? 1.15 : 1.0);
      player.vel.x = player.dashDir.x * dashSpd;
      player.vel.z = player.dashDir.z * dashSpd;
      if (Math.random() < 0.6) {
        this.spawnParticles(
          player.pos.x,
          0.2,
          player.pos.z,
          1,
          buffs.hasTurbo ? POWERUP_META.turbo_boots.glowHex : 0xc8bfa6,
          0.8,
          2.2,
          0.8,
          6,
        );
      }
    } else {
      if (moveX !== 0 || moveZ !== 0) {
        const len = Math.hypot(moveX, moveZ);
        moveX /= len;
        moveZ /= len;
      }
      const accel = 1 - Math.exp(-16 * dt);
      player.vel.x = THREE.MathUtils.lerp(player.vel.x, moveX * baseSpeed, accel);
      player.vel.z = THREE.MathUtils.lerp(player.vel.z, moveZ * baseSpeed, accel);
    }

    const nextPos = resolveArenaCollision(
      { x: player.pos.x + player.vel.x * dt, z: player.pos.z + player.vel.z * dt },
      player.radius,
      ARENA_OBSTACLES,
    );
    const movedDist = Math.hypot(nextPos.x - player.pos.x, nextPos.z - player.pos.z);
    player.pos = nextPos;
    player.gaitPhase += movedDist * 2.8;

    // Turbo Sprint emerald trail particles while running
    if (buffs.hasTurbo && movedDist > 0.04 && Math.random() < 0.45) {
      this.spawnParticles(player.pos.x, 0.25, player.pos.z, 1, POWERUP_META.turbo_boots.glowHex, 0.5, 1.8, 0.65, 5);
    }

    // Direction arrows steer the aim reticle smoothly around the player
    let aimMoveX = 0;
    let aimMoveZ = 0;
    if (this.keysPressed.has('ArrowUp')) aimMoveZ -= 1;
    if (this.keysPressed.has('ArrowDown')) aimMoveZ += 1;
    if (this.keysPressed.has('ArrowLeft')) aimMoveX -= 1;
    if (this.keysPressed.has('ArrowRight')) aimMoveX += 1;

    if (aimMoveX !== 0 || aimMoveZ !== 0) {
      this.aimMode = 'keyboard';
      const aimLen = Math.hypot(aimMoveX, aimMoveZ);
      const aimSpeed = 22.0;
      this.aimOffset.x += (aimMoveX / aimLen) * aimSpeed * dt;
      this.aimOffset.z += (aimMoveZ / aimLen) * aimSpeed * dt;
      const offsetDist = Math.hypot(this.aimOffset.x, this.aimOffset.z);
      if (offsetDist > 17.5) {
        this.aimOffset.x = (this.aimOffset.x / offsetDist) * 17.5;
        this.aimOffset.z = (this.aimOffset.z / offsetDist) * 17.5;
      } else if (offsetDist > 0.001 && offsetDist < 1.8) {
        this.aimOffset.x = (this.aimOffset.x / offsetDist) * 1.8;
        this.aimOffset.z = (this.aimOffset.z / offsetDist) * 1.8;
      }
    }

    if (this.aimMode === 'keyboard') {
      this.aimWorldPos.x = Math.max(-ARENA_HALF_W, Math.min(ARENA_HALF_W, player.pos.x + this.aimOffset.x));
      this.aimWorldPos.z = Math.max(-ARENA_HALF_D, Math.min(ARENA_HALF_D, player.pos.z + this.aimOffset.z));
    } else {
      const ox = this.aimWorldPos.x - player.pos.x;
      const oz = this.aimWorldPos.z - player.pos.z;
      const od = Math.hypot(ox, oz);
      if (od > 0.1) {
        const clampedDist = Math.max(1.8, Math.min(17.5, od));
        this.aimOffset.x = (ox / od) * clampedDist;
        this.aimOffset.z = (oz / od) * clampedDist;
      }
    }

    // Face aim reticle smoothly
    const aimDx = this.aimWorldPos.x - player.pos.x;
    const aimDz = this.aimWorldPos.z - player.pos.z;
    if (aimDx * aimDx + aimDz * aimDz > 0.04) {
      player.facing = Math.atan2(aimDx, aimDz);
    }

    // Space (or left-click) fires the paintball marker continuously
    const firing = this.keysPressed.has('Space') || this.mouseDownLeft;
    if (firing && !player.reloading && player.fireCooldown <= 0) {
      if (buffs.infiniteAmmo || player.ammo > 0) {
        if (!buffs.infiniteAmmo) {
          player.ammo -= 1;
        }
        player.fireCooldown = 0.155 / buffs.fireRateMult;
        player.recoilAmount = 0.85;
        const jitter = (Math.random() - 0.5) * 0.045;
        this.firePaintball(
          player,
          player.facing + jitter,
          Math.round(25 * buffs.damageDealMult),
          32,
          buffs.splashRadius,
        );
        this.audio.playShot(true, 1.0);
        this.cameraTrauma = Math.min(1, this.cameraTrauma + 0.045);

        if (!buffs.infiniteAmmo && player.ammo === 0) {
          player.reloading = true;
          player.reloadTimer = RELOAD_DURATION;
          this.audio.playReload();
        }
      }
    }
  }

  private stepAiActor(actor: ActorState, dt: number, isTitleShowcase: boolean): void {
    const enemyTeam = oppositeTeam(actor.team);
    const carryingFlag =
      this.flags[enemyTeam].status === 'carried' && this.flags[enemyTeam].carrierId === actor.id;

    // Periodically swap strafe lane preference for dynamic organic movement
    actor.aiThinkTimer -= dt;
    if (actor.aiThinkTimer <= 0) {
      actor.aiThinkTimer = 2.4 + Math.random() * 2.6;
      if (Math.random() < 0.45) actor.aiStrafeDir *= -1;
    }

    const objective = computeAiObjective(actor, this.actors, this.flags);

    // Find closest visible living enemy
    let closestEnemy: ActorState | null = null;
    let closestDist = 26;
    for (const other of this.actors) {
      if (!other.alive || other.team === actor.team) continue;
      const d = dist2D(actor.pos, other.pos);
      if (d < closestDist && hasLineOfSight(actor.pos, other.pos, ARENA_OBSTACLES)) {
        closestDist = d;
        closestEnemy = other;
      }
    }

    // Desired movement vector toward tactical objective + obstacle whisker avoidance
    let dirX = objective.target.x - actor.pos.x;
    let dirZ = objective.target.z - actor.pos.z;
    const distToObj = Math.hypot(dirX, dirZ);

    if (distToObj > 0.7) {
      dirX /= distToObj;
      dirZ /= distToObj;
    } else {
      dirX = 0;
      dirZ = 0;
    }

    // Combat strafing for Heavy & Defender when engaging an enemy
    if (closestEnemy && objective.mode !== 'carry_home') {
      const toEnemyX = (closestEnemy.pos.x - actor.pos.x) / Math.max(0.1, closestDist);
      const toEnemyZ = (closestEnemy.pos.z - actor.pos.z) / Math.max(0.1, closestDist);
      const perpX = -toEnemyZ * actor.aiStrafeDir;
      const perpZ = toEnemyX * actor.aiStrafeDir;
      if (actor.role === 'heavy' && closestDist < 15) {
        dirX = dirX * 0.35 + perpX * 0.65;
        dirZ = dirZ * 0.35 + perpZ * 0.65;
      } else if (actor.role === 'defender' && closestDist < 14) {
        dirX = dirX * 0.45 + perpX * 0.55;
        dirZ = dirZ * 0.45 + perpZ * 0.55;
      } else if (closestDist < 10) {
        dirX = dirX * 0.72 + perpX * 0.28;
        dirZ = dirZ * 0.72 + perpZ * 0.28;
      }
    }

    // Whisker obstacle steering so NPCs smoothly wrap around speedball bunkers & fort walls
    const lookAhead = 2.4;
    const probeX = actor.pos.x + dirX * lookAhead;
    const probeZ = actor.pos.z + dirZ * lookAhead;
    if (pointHitsObstacle(probeX, probeZ, actor.radius + 0.25, ARENA_OBSTACLES)) {
      const perpX = -dirZ * actor.aiStrafeDir;
      const perpZ = dirX * actor.aiStrafeDir;
      dirX = dirX * 0.2 + perpX * 0.95;
      dirZ = dirZ * 0.2 + perpZ * 0.95;
    }

    const dLen = Math.hypot(dirX, dirZ);
    if (dLen > 0.01) {
      dirX /= dLen;
      dirZ /= dLen;
    }

    const aiBuffs = getActorBuffEffects(actor);
    const diffMult = this.config.difficulty === 'veteran' ? 1.1 : 1.0;
    const roleSpeed =
      actor.role === 'striker' ? 7.2 : actor.role === 'defender' ? 6.4 : 5.7;
    const speed = (carryingFlag ? roleSpeed * 0.9 : roleSpeed) * diffMult * aiBuffs.speedMult;

    const accel = 1 - Math.exp(-10 * dt);
    actor.vel.x = THREE.MathUtils.lerp(actor.vel.x, dirX * speed, accel);
    actor.vel.z = THREE.MathUtils.lerp(actor.vel.z, dirZ * speed, accel);

    const nextPos = resolveArenaCollision(
      { x: actor.pos.x + actor.vel.x * dt, z: actor.pos.z + actor.vel.z * dt },
      actor.radius,
      ARENA_OBSTACLES,
    );
    const moved = Math.hypot(nextPos.x - actor.pos.x, nextPos.z - actor.pos.z);
    actor.pos = nextPos;
    actor.gaitPhase += moved * 2.8;

    // Facing & Combat Firing Policy
    if (closestEnemy) {
      const targetAngle = Math.atan2(
        closestEnemy.pos.x - actor.pos.x,
        closestEnemy.pos.z - actor.pos.z,
      );
      actor.facing = this.lerpAngle(actor.facing, targetAngle, 1 - Math.exp(-12 * dt));

      // Heavy role executes a visible 0.42s telegraphed 3-shot burst!
      if (actor.role === 'heavy') {
        if (actor.telegraphingBurst) {
          actor.windupTimer -= dt;
          if (actor.windupTimer <= 0) {
            actor.telegraphingBurst = false;
            actor.fireCooldown =
              (this.config.difficulty === 'veteran' ? 1.15 : 1.45) / aiBuffs.fireRateMult;
            actor.recoilAmount = 1.0;
            for (const sp of [-0.12, 0, 0.12]) {
              this.firePaintball(
                actor,
                actor.facing + sp,
                Math.round(20 * aiBuffs.damageDealMult),
                22,
                aiBuffs.splashRadius,
              );
            }
            if (!isTitleShowcase) {
              this.audio.playShot(false, Math.max(0.2, 1 - closestDist / 38));
            }
          }
        } else if (
          actor.fireCooldown <= 0 &&
          !actor.reloading &&
          closestDist < 21 &&
          this.attackTokenPool > 0
        ) {
          this.attackTokenPool--;
          actor.telegraphingBurst = true;
          actor.windupTimer = 0.42;
          if (!isTitleShowcase && closestEnemy.isPlayer) {
            this.audio.playWindupTelegraph();
          }
        }
      } else {
        // Striker & Defender steady tactical paintball bursts gated by attack token pool
        if (
          actor.fireCooldown <= 0 &&
          !actor.reloading &&
          closestDist < 22 &&
          this.attackTokenPool > 0
        ) {
          this.attackTokenPool--;
          const spread = this.config.difficulty === 'veteran' ? 0.09 : 0.14;
          const aimJitter = (Math.random() - 0.5) * spread;
          actor.fireCooldown =
            ((actor.role === 'striker' ? 0.34 : 0.28) *
              (this.config.difficulty === 'veteran' ? 0.85 : 1.05)) /
            aiBuffs.fireRateMult;
          actor.recoilAmount = 0.8;
          if (!aiBuffs.infiniteAmmo) {
            actor.ammo = Math.max(0, actor.ammo - 1);
          }
          this.firePaintball(
            actor,
            actor.facing + aimJitter,
            Math.round(21 * aiBuffs.damageDealMult),
            20,
            aiBuffs.splashRadius,
          );
          if (!isTitleShowcase) {
            const player = this.actors.find((a) => a.isPlayer);
            const pDist = player ? dist2D(player.pos, actor.pos) : 20;
            this.audio.playShot(false, Math.max(0.15, 1 - pDist / 36));
          }
          if (!aiBuffs.infiniteAmmo && actor.ammo === 0) {
            actor.reloading = true;
            actor.reloadTimer = RELOAD_DURATION * 1.2;
          }
        }
      }
    } else {
      actor.telegraphingBurst = false;
      if (dLen > 0.05) {
        const moveAng = Math.atan2(dirX, dirZ);
        actor.facing = this.lerpAngle(actor.facing, moveAng, 1 - Math.exp(-9 * dt));
      }
    }
  }

  private lerpAngle(a: number, b: number, t: number): number {
    let diff = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (diff < -Math.PI) diff += Math.PI * 2;
    return a + diff * t;
  }

  private firePaintball(
    shooter: ActorState,
    angle: number,
    damage: number,
    speed: number,
    splashRadius = 0,
  ): void {
    const slot = this.projectiles.find((p) => !p.active);
    if (!slot) return;

    const rig = this.actorRigs.get(shooter.id);
    let sx = shooter.pos.x + Math.sin(angle) * 0.95;
    let sy = 1.08;
    let sz = shooter.pos.z + Math.cos(angle) * 0.95;
    if (rig) {
      rig.muzzlePoint.getWorldPosition(_v3B);
      sx = _v3B.x;
      sy = Math.max(0.85, _v3B.y);
      sz = _v3B.z;
    }

    const pMats = (
      this as unknown as { _pMats: Record<TeamId, { ball: THREE.Material; trail: THREE.Material }> }
    )._pMats[shooter.team];

    slot.active = true;
    slot.team = shooter.team;
    slot.ownerId = shooter.id;
    slot.isPlayerShot = shooter.isPlayer;
    slot.x = sx;
    slot.y = sy;
    slot.z = sz;
    slot.vx = Math.sin(angle) * speed;
    slot.vy = 0.65; // slight pneumatic arc
    slot.vz = Math.cos(angle) * speed;
    slot.life = 1.5;
    slot.damage = damage;
    slot.splashRadius = splashRadius;

    slot.mesh.material = pMats.ball;
    slot.trail.material = pMats.trail;
    const isMega = splashRadius > 0;
    slot.mesh.scale.setScalar(isMega ? 1.65 : 1.0);
    slot.trail.scale.set(isMega ? 1.5 : 1.0, isMega ? 1.5 : 1.0, isMega ? 1.35 : 1.0);
    slot.mesh.position.set(sx, sy, sz);
    slot.trail.position.set(sx, sy, sz);
    slot.trail.rotation.set(0, angle, 0);
    slot.mesh.visible = true;
    slot.trail.visible = true;

    // Subtle muzzle paint puff & brief light flash
    this.spawnParticles(
      sx,
      sy,
      sz,
      isMega ? 6 : 3,
      isMega ? POWERUP_META.mega_splash.glowHex : TEAM_PALETTE[shooter.team].bright,
      1.5,
      4.5,
      isMega ? 0.95 : 0.65,
      10,
    );
    if (shooter.isPlayer) {
      this.muzzleLight.position.set(sx, sy + 0.3, sz);
      this.muzzleLight.color.setHex(isMega ? POWERUP_META.mega_splash.glowHex : TEAM_PALETTE[shooter.team].bright);
      this.muzzleLightTimer = 0.06;
    }
  }

  private detonateSplashPaintball(
    x: number,
    y: number,
    z: number,
    proj: ProjectileSlot,
    directTargetId: string | null,
    isTitleShowcase: boolean,
  ): void {
    const r = proj.splashRadius;
    if (r <= 0) return;

    // Oversized paint blast splats + violet-accented splash ring burst
    this.spawnGroundSplat(
      Math.max(-ARENA_HALF_W + 0.6, Math.min(ARENA_HALF_W - 0.6, x)),
      Math.max(-ARENA_HALF_D + 0.6, Math.min(ARENA_HALF_D - 0.6, z)),
      proj.team,
      1.95,
    );
    this.spawnParticles(x, Math.max(0.4, y), z, 18, TEAM_PALETTE[proj.team].paintHex, 3.5, 9.0, 1.15, 14);
    this.spawnParticles(x, Math.max(0.5, y), z, 10, POWERUP_META.mega_splash.glowHex, 2.5, 7.2, 0.95, 11);

    if (!isTitleShowcase && proj.isPlayerShot) {
      this.audio.playSplashExplosion(0.95);
      this.cameraTrauma = Math.min(1, this.cameraTrauma + 0.14);
    }

    const rSq = r * r;
    for (let j = 0; j < this.actors.length; j++) {
      const a = this.actors[j];
      if (!a.alive || a.team === proj.team || a.id === directTargetId) continue;
      const dx = a.pos.x - x;
      const dz = a.pos.z - z;
      const dSq = dx * dx + dz * dz;
      if (dSq <= rSq) {
        const falloff = 1 - (Math.sqrt(dSq) / r) * 0.45;
        const splashDmg = Math.round(proj.damage * 0.72 * falloff);
        this.applyPaintballHit(a, { ...proj, damage: splashDmg, splashRadius: 0 }, isTitleShowcase);
      }
    }
  }

  private stepProjectiles(dt: number, isTitleShowcase: boolean): void {
    for (let i = 0; i < MAX_PROJECTILES; i++) {
      const p = this.projectiles[i];
      if (!p.active) continue;

      p.life -= dt;
      p.vy -= 4.2 * dt; // subtle real paintball ballistic drop
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;

      // Ground or arena perimeter impact
      if (
        p.life <= 0 ||
        p.y <= 0.12 ||
        Math.abs(p.x) >= ARENA_HALF_W ||
        Math.abs(p.z) >= ARENA_HALF_D
      ) {
        if (p.splashRadius > 0) {
          this.detonateSplashPaintball(p.x, Math.max(0.2, p.y), p.z, p, null, isTitleShowcase);
        } else {
          this.spawnGroundSplat(
            Math.max(-ARENA_HALF_W + 0.5, Math.min(ARENA_HALF_W - 0.5, p.x)),
            Math.max(-ARENA_HALF_D + 0.5, Math.min(ARENA_HALF_D - 0.5, p.z)),
            p.team,
            0.95,
          );
          this.spawnParticles(p.x, Math.max(0.2, p.y), p.z, 6, TEAM_PALETTE[p.team].paintHex, 2, 5.5, 0.8, 16);
        }
        this.deactivateProjectile(p);
        continue;
      }

      // Bunker / Obstacle impact -> stick glossy paint splat onto bunker wall + splash particles!
      const hitOb = pointHitsObstacle(p.x, p.z, 0.14, ARENA_OBSTACLES);
      if (hitOb && p.y <= hitOb.height) {
        const dx = p.x - hitOb.x;
        const dz = p.z - hitOb.z;
        const normX = Math.abs(dx / (hitOb.width * 0.5));
        const normZ = Math.abs(dz / (hitOb.depth * 0.5));
        let nx = 0;
        let nz = 0;
        let sx = p.x;
        let sz = p.z;
        if (normX > normZ) {
          nx = dx >= 0 ? 1 : -1;
          sx = hitOb.x + nx * (hitOb.width * 0.5);
        } else {
          nz = dz >= 0 ? 1 : -1;
          sz = hitOb.z + nz * (hitOb.depth * 0.5);
        }
        this.spawnWallSplat(sx, p.y, sz, nx, nz, p.team);
        if (p.splashRadius > 0) {
          this.detonateSplashPaintball(sx, p.y, sz, p, null, isTitleShowcase);
        } else {
          this.spawnParticles(sx, p.y, sz, 9, TEAM_PALETTE[p.team].paintHex, 2.2, 6.2, 0.9, 17);
          if (!isTitleShowcase && p.isPlayerShot) {
            this.audio.playSplat(false, 0.65);
          }
        }
        this.deactivateProjectile(p);
        continue;
      }

      // Actor hit check
      let hitTarget: ActorState | null = null;
      for (let j = 0; j < this.actors.length; j++) {
        const a = this.actors[j];
        if (!a.alive || a.team === p.team) continue;
        const dx = a.pos.x - p.x;
        const dz = a.pos.z - p.z;
        const hitRad = a.radius + (p.splashRadius > 0 ? 0.36 : 0.24);
        if (dx * dx + dz * dz <= hitRad * hitRad) {
          hitTarget = a;
          break;
        }
      }

      if (hitTarget) {
        this.applyPaintballHit(hitTarget, p, isTitleShowcase);
        if (p.splashRadius > 0) {
          this.detonateSplashPaintball(hitTarget.pos.x, 1.0, hitTarget.pos.z, p, hitTarget.id, isTitleShowcase);
        }
        this.deactivateProjectile(p);
        continue;
      }

      // Sync visual mesh
      p.mesh.position.set(p.x, p.y, p.z);
      const spd = Math.hypot(p.vx, p.vz) || 1;
      p.trail.position.set(p.x - (p.vx / spd) * 0.45, p.y, p.z - (p.vz / spd) * 0.45);
    }
  }

  private deactivateProjectile(p: ProjectileSlot): void {
    p.active = false;
    p.splashRadius = 0;
    p.mesh.visible = false;
    p.trail.visible = false;
  }

  private applyPaintballHit(
    target: ActorState,
    proj: ProjectileSlot,
    isTitleShowcase: boolean,
  ): void {
    const targetBuffs = getActorBuffEffects(target);
    const effectiveDamage = Math.max(1, Math.round(proj.damage * targetBuffs.damageTakenMult));
    target.hp = Math.max(0, target.hp - effectiveDamage);
    target.hitFlashTimer = 0.085;

    // Knockback impulse
    const spd = Math.hypot(proj.vx, proj.vz) || 1;
    const kb = (target.role === 'heavy' ? 1.8 : 3.2) * (targetBuffs.hasShield ? 0.65 : 1.0);
    target.vel.x += (proj.vx / spd) * kb;
    target.vel.z += (proj.vz / spd) * kb;

    this.spawnParticles(
      target.pos.x,
      1.15,
      target.pos.z,
      12,
      targetBuffs.hasShield ? POWERUP_META.paint_shield.glowHex : TEAM_PALETTE[proj.team].paintHex,
      2.5,
      7.2,
      0.95,
      16,
    );

    if (!isTitleShowcase) {
      if (proj.isPlayerShot || target.isPlayer) {
        this.audio.playSplat(target.hp <= 0, 1.0);
      }
      if (target.isPlayer) {
        this.cameraTrauma = Math.min(1, this.cameraTrauma + (targetBuffs.hasShield ? 0.14 : 0.24));
      }
    }

    if (target.hp <= 0) {
      target.alive = false;
      target.koTimer = KO_FALL_DURATION;
      target.respawnTimer = RESPAWN_TIME;
      target.telegraphingBurst = false;
      target.stunTimer = 0;

      const shooter = this.actors.find((a) => a.id === proj.ownerId);
      if (shooter) {
        shooter.tags += 1;
        const { becameReady } = registerKillForStunCharge(shooter);
        if (!isTitleShowcase && shooter.isPlayer && becameReady) {
          this.audio.playStunReady();
          this.pushBanner(
            'STUN SHOCKWAVE READY!',
            'Press [Q] to stun nearby opponents for 4s (carries across respawn)',
            shooter.team,
          );
          this.emitHud();
        }
      }

      // Vivid big ground paint splash under tagged-out opponent!
      this.spawnGroundSplat(target.pos.x, target.pos.z, proj.team, 1.85);
      this.spawnParticles(
        target.pos.x,
        1.1,
        target.pos.z,
        24,
        TEAM_PALETTE[proj.team].paintHex,
        3.5,
        9.5,
        1.25,
        15,
      );

      // Drop carried flag if they held one
      const dropEv = dropFlagForActor(target, this.flags);
      if (dropEv && !isTitleShowcase) {
        const flagName = dropEv.flagTeam === 'cobalt' ? 'Cobalt' : 'Crimson';
        this.pushBanner(`${flagName.toUpperCase()} FLAG DROPPED!`, 'Touch to return or reclaim', dropEv.flagTeam);
      }

      if (!isTitleShowcase) {
        if (proj.isPlayerShot) {
          this.hitstopTimer = 0.042;
          this.cameraTrauma = Math.min(1, this.cameraTrauma + 0.26);
          this.audio.playTagOut(true);
        } else if (target.isPlayer) {
          this.hitstopTimer = 0.06;
          this.cameraTrauma = Math.min(1, this.cameraTrauma + 0.55);
          this.audio.playTagOut(false);
          this.pushBanner('TAGGED OUT!', `Respawning at Cobalt Base in ${RESPAWN_TIME.toFixed(0)}s`, 'crimson');
        }
      }
    }
  }

  private respawnActor(actor: ActorState): void {
    const spawns = SPAWN_POINTS[actor.team];
    const sp = spawns[Math.floor(Math.random() * spawns.length)];
    actor.alive = true;
    actor.hp = actor.maxHp;
    actor.ammo = actor.maxAmmo;
    actor.reloading = false;
    actor.buffs = [];
    actor.stunTimer = 0;
    // Note: actor.stunKillsProgress & actor.stunActivations persist across death & respawn!
    actor.pos = { x: sp.x, z: sp.z };
    actor.vel = { x: 0, z: 0 };
    actor.facing = actor.team === 'cobalt' ? Math.PI / 2 : -Math.PI / 2;
    actor.hitFlashTimer = 0.14;
    this.spawnParticles(actor.pos.x, 0.9, actor.pos.z, 12, TEAM_PALETTE[actor.team].bright, 2, 5, 0.9, 10);
  }

  private finishMatch(winner: TeamId | 'draw'): void {
    const player = this.actors.find((a) => a.isPlayer);
    const teamTags = this.actors
      .filter((a) => a.team === 'cobalt')
      .reduce((acc, a) => acc + a.tags, 0);

    this.endStats = {
      winner,
      cobaltScore: this.scores.cobalt,
      crimsonScore: this.scores.crimson,
      elapsedSeconds: Math.round(this.elapsedMatchTime),
      playerTags: player?.tags ?? 0,
      playerCaptures: player?.captures ?? 0,
      playerReturns: player?.returns ?? 0,
      teamTags,
    };
    this.phase = 'gameover';
    document.body.dataset.state = 'gameover';
    this.clearInputs();
    this.audio.playFlagEvent('capture', winner === 'cobalt');
    this.emitHud();
  }

  private pushBanner(text: string, subtext: string, team: TeamId | 'neutral'): void {
    this.banner = {
      id: this.bannerSeq++,
      text,
      subtext,
      team,
    };
    this.bannerTimer = 2.5;
  }

  // =========================================================================
  // VISUAL SYNCHRONIZATION (Animations, Cloth Waves, Particles, Camera)
  // =========================================================================

  private stepParticles(dt: number): void {
    let anyChanged = false;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = this.particles[i];
      if (!p.active) continue;
      anyChanged = true;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        _mat4.makeScale(0, 0, 0);
        this.particleMesh.setMatrixAt(i, _mat4);
        continue;
      }

      p.vy -= p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.y < 0.08) {
        p.y = 0.08;
        p.vy *= -0.3;
        p.vx *= 0.7;
        p.vz *= 0.7;
      }

      const t = p.life / p.maxLife;
      const sc = p.size * (0.35 + 0.65 * t);
      _v3A.set(p.x, p.y, p.z);
      _scale.set(sc, sc, sc);
      _quat.identity();
      _mat4.compose(_v3A, _quat, _scale);
      this.particleMesh.setMatrixAt(i, _mat4);
      this.particleMesh.setColorAt(i, p.color);
    }

    if (anyChanged) {
      this.particleMesh.instanceMatrix.needsUpdate = true;
      if (this.particleMesh.instanceColor) {
        this.particleMesh.instanceColor.needsUpdate = true;
      }
    }
  }

  private stepAmbientPollen(dt: number): void {
    const pos = this.pollenPoints.geometry.attributes.position as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    for (let i = 0; i < pos.count; i++) {
      arr[i * 3] += Math.sin(this.totalTime * 0.4 + i) * 0.35 * dt;
      arr[i * 3 + 1] += Math.cos(this.totalTime * 0.7 + i * 1.3) * 0.14 * dt;
      arr[i * 3 + 2] += 0.25 * dt;
      if (arr[i * 3 + 2] > ARENA_HALF_D + 6) arr[i * 3 + 2] = -(ARENA_HALF_D + 6);
    }
    pos.needsUpdate = true;
  }

  private syncActorVisuals(dt: number): void {
    const player = this.actors.find((a) => a.isPlayer);

    for (const actor of this.actors) {
      const rig = this.actorRigs.get(actor.id);
      if (!rig) continue;

      if (!actor.alive) {
        if (actor.koTimer > 0) {
          rig.root.visible = true;
          const t = 1 - actor.koTimer / KO_FALL_DURATION;
          rig.bodyPivot.rotation.x = -t * (Math.PI * 0.48);
          rig.bodyPivot.position.y = Math.sin(t * Math.PI) * 0.35;
          rig.hpBarBg.visible = false;
          rig.telegraphRing.visible = false;
          rig.stunEffectGroup.visible = false;
        } else {
          rig.root.visible = false;
        }
        continue;
      }

      rig.root.visible = true;
      rig.root.position.set(actor.pos.x, 0, actor.pos.z);
      rig.root.rotation.y = actor.facing;

      // Reset KO fall pose
      rig.bodyPivot.rotation.x = 0;
      rig.bodyPivot.position.y = 0;

      // Distance-synced leg gait + torso lean & sprint bob
      const speed = Math.hypot(actor.vel.x, actor.vel.z);
      const speedNorm = Math.min(1, speed / 8.5);
      const stride = Math.sin(actor.gaitPhase) * 0.65 * speedNorm;
      rig.leftLeg.rotation.x = stride;
      rig.rightLeg.rotation.x = -stride;

      const bob = Math.abs(Math.sin(actor.gaitPhase)) * 0.085 * speedNorm + Math.sin(this.totalTime * 3.2 + actor.gaitPhase) * 0.015;
      rig.upperBody.position.y = 0.62 + bob;
      rig.upperBody.rotation.x = speedNorm * 0.14 + (actor.dashTimer > 0 ? 0.26 : 0);

      // Squash & stretch subtle dash feel
      const targetSx = actor.dashTimer > 0 ? 0.9 : 1.0;
      const targetSy = actor.dashTimer > 0 ? 1.08 : 1.0;
      const damp = 1 - Math.exp(-14 * dt);
      rig.bodyPivot.scale.x = THREE.MathUtils.lerp(
        rig.bodyPivot.scale.x,
        targetSx * (actor.role === 'heavy' ? 1.12 : actor.role === 'striker' ? 0.96 : 1.02),
        damp,
      );
      rig.bodyPivot.scale.y = THREE.MathUtils.lerp(
        rig.bodyPivot.scale.y,
        targetSy * (actor.role === 'heavy' ? 1.12 : actor.role === 'striker' ? 0.96 : 1.02),
        damp,
      );

      // Paintball marker recoil kickback & brief muzzle paint burst flash
      rig.weaponGroup.position.z = 0.24 - actor.recoilAmount * 0.16;
      rig.weaponGroup.rotation.x = -actor.recoilAmount * 0.12;
      if (actor.recoilAmount > 0.55) {
        rig.muzzleFlash.visible = true;
        const mfScale = 0.7 + (actor.recoilAmount - 0.55) * 1.4;
        rig.muzzleFlash.scale.setScalar(mfScale);
        rig.muzzleFlash.rotation.z += dt * 18;
      } else {
        rig.muzzleFlash.visible = false;
      }

      // Hit flash emissive highlight & stunned electric shimmer
      const flashing = actor.hitFlashTimer > 0;
      const stunned = actor.stunTimer > 0;
      for (let m = 0; m < rig.hitFlashMaterials.length; m++) {
        if (flashing) {
          rig.hitFlashMaterials[m].emissive.setHex(0xffffff);
          rig.hitFlashMaterials[m].emissiveIntensity = 0.85;
        } else if (stunned) {
          rig.hitFlashMaterials[m].emissive.setHex(0x22d3ee);
          rig.hitFlashMaterials[m].emissiveIntensity = 0.32 + Math.sin(this.totalTime * 18) * 0.16;
        } else {
          rig.hitFlashMaterials[m].emissive.copy(rig.baseEmissives[m]);
          rig.hitFlashMaterials[m].emissiveIntensity = 1.0;
        }
      }

      // Stun Shockwave spinning overhead halo + tremble feedback
      rig.stunEffectGroup.visible = stunned;
      if (stunned) {
        rig.stunEffectGroup.rotation.y = this.totalTime * 5.2;
        rig.upperBody.rotation.z = Math.sin(this.totalTime * 42) * 0.085;
      } else {
        rig.upperBody.rotation.z = 0;
      }

      // Heavy burst windup telegraph ring
      rig.telegraphRing.visible = actor.telegraphingBurst;
      if (actor.telegraphingBurst) {
        const s = 0.95 + Math.sin(this.totalTime * 28) * 0.15;
        rig.telegraphRing.scale.setScalar(s);
      }

      // Active powerup Kevlar Shield energy dome & glowing buff ring
      const actorBuffs = getActorBuffEffects(actor);
      rig.shieldAura.visible = actorBuffs.hasShield;
      if (actorBuffs.hasShield) {
        rig.shieldAura.rotation.y = this.totalTime * 1.1;
        const pulse = 1.0 + Math.sin(this.totalTime * 5.2) * 0.04;
        rig.shieldAura.scale.setScalar(pulse);
      }
      if (actor.buffs.length > 0) {
        const latestBuff = actor.buffs[actor.buffs.length - 1];
        rig.buffRing.visible = true;
        (rig.buffRing.material as THREE.MeshBasicMaterial).color.setHex(POWERUP_META[latestBuff.kind].glowHex);
        rig.buffRing.scale.setScalar(1.0 + Math.sin(this.totalTime * 6.5) * 0.07);
      } else {
        rig.buffRing.visible = false;
      }

      // World-space micro HP bar (billboarded toward camera when damaged)
      const damaged = actor.hp < actor.maxHp;
      rig.hpBarBg.visible = damaged && this.phase === 'playing';
      if (rig.hpBarBg.visible) {
        rig.hpBarBg.quaternion.copy(this.camera.quaternion);
        const ratio = Math.max(0.01, actor.hp / actor.maxHp);
        rig.hpBarFill.scale.x = ratio;
        rig.hpBarFill.position.x = -(1 - ratio) * 0.44;
      }
    }

    // Update in-world aim reticle & subtle barrel laser sight line during active play
    if (this.phase === 'playing' && player && player.alive) {
      this.aimReticleGroup.visible = true;
      this.aimReticleGroup.position.set(this.aimWorldPos.x, 0.06, this.aimWorldPos.z);
      this.aimReticleGroup.rotation.y = this.totalTime * 1.4;

      this.aimLine.visible = true;
      const posAttr = this.aimLine.geometry.attributes.position as THREE.BufferAttribute;
      posAttr.setXYZ(0, player.pos.x + Math.sin(player.facing) * 0.9, 1.05, player.pos.z + Math.cos(player.facing) * 0.9);
      posAttr.setXYZ(1, this.aimWorldPos.x, 1.05, this.aimWorldPos.z);
      posAttr.needsUpdate = true;
    } else {
      this.aimReticleGroup.visible = false;
      this.aimLine.visible = false;
    }
  }

  private syncFlagMeshes(elapsed: number): void {
    for (const team of ['cobalt', 'crimson'] as TeamId[]) {
      const state = this.flags[team];
      const rig = this.flagRigs[team];

      if (state.status === 'carried' && state.carrierId) {
        const carrier = this.actors.find((a) => a.id === state.carrierId);
        const carrierRig = this.actorRigs.get(state.carrierId);
        if (carrier && carrierRig) {
          carrierRig.flagSocket.getWorldPosition(_v3A);
          rig.root.position.set(_v3A.x, _v3A.y - 0.55, _v3A.z);
          rig.root.rotation.set(-0.22, carrier.facing + Math.PI, 0);
          rig.root.scale.setScalar(0.86);
          rig.beaconRing.visible = false;
          updateFlagClothWave(rig, elapsed, 1.65);
          continue;
        }
      }

      // Flag at Home Pedestal or Dropped on Turf
      const isHome = state.status === 'home';
      rig.root.position.set(state.pos.x, isHome ? 0.24 : 0.05, state.pos.z);
      rig.root.rotation.set(0, team === 'cobalt' ? 0 : Math.PI, isHome ? 0 : 0.24);
      rig.root.scale.setScalar(1.0);
      rig.beaconRing.visible = true;
      const ringScale = isHome ? 1.0 : 1.05 + Math.sin(elapsed * 6) * 0.16;
      rig.beaconRing.scale.setScalar(ringScale);
      updateFlagClothWave(rig, elapsed, isHome ? 1.0 : 1.25);
    }
  }

  private updateCamera(dt: number): void {
    if (this.phase === 'title') {
      // Sweeping golden-hour aerial flyover framing Crimson Fort, waving flags, pine ridge & midfield skirmish on the right two-thirds
      const orbitAngle = this.totalTime * 0.11 + 0.42;
      const desiredX = 10 + Math.sin(orbitAngle) * 19;
      const desiredZ = 18 + Math.cos(orbitAngle) * 9;
      const desiredY = 17.0 + Math.sin(this.totalTime * 0.25) * 1.6;

      const damp = 1 - Math.exp(-3.2 * dt);
      this.cameraCurrentPos.lerp(_v3A.set(desiredX, desiredY, desiredZ), damp);
      this.cameraLookPos.lerp(_v3B.set(6.5, 1.4, -1.5), damp);
      this.camera.position.copy(this.cameraCurrentPos);
      this.camera.lookAt(this.cameraLookPos);
      return;
    }

    const player = this.actors.find((a) => a.isPlayer);
    let targetX = 0;
    let targetZ = 0;
    if (player) {
      // Subtle cursor look-ahead so player sees enemies ahead in aim direction
      const lookAheadX = Math.max(-5.5, Math.min(5.5, (this.aimWorldPos.x - player.pos.x) * 0.22));
      const lookAheadZ = Math.max(-4.0, Math.min(4.0, (this.aimWorldPos.z - player.pos.z) * 0.22));
      targetX = Math.max(-24, Math.min(24, player.pos.x + lookAheadX));
      targetZ = Math.max(-13, Math.min(13, player.pos.z + lookAheadZ));
    }

    const camDamp = 1 - Math.exp(-7.5 * dt);
    this.cameraLookPos.x = THREE.MathUtils.lerp(this.cameraLookPos.x, targetX, camDamp);
    this.cameraLookPos.y = 0.5;
    this.cameraLookPos.z = THREE.MathUtils.lerp(this.cameraLookPos.z, targetZ, camDamp);

    // Classic commanding top-down 3D camera offset (high enough for sightlines, low enough to showcase 3D depth)
    const desiredCamX = this.cameraLookPos.x;
    const desiredCamY = 22.0;
    const desiredCamZ = this.cameraLookPos.z + 18.2;

    this.cameraCurrentPos.x = THREE.MathUtils.lerp(this.cameraCurrentPos.x, desiredCamX, camDamp);
    this.cameraCurrentPos.y = THREE.MathUtils.lerp(this.cameraCurrentPos.y, desiredCamY, camDamp);
    this.cameraCurrentPos.z = THREE.MathUtils.lerp(this.cameraCurrentPos.z, desiredCamZ, camDamp);

    // Subtle FOV kick during player tactical dash
    const targetFov = player && player.dashTimer > 0 ? 45.5 : 42.0;
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFov, 1 - Math.exp(-10 * dt));
      this.camera.updateProjectionMatrix();
    }

    // Decaying trauma*trauma camera shake
    let shakeX = 0;
    let shakeZ = 0;
    if (this.cameraTrauma > 0) {
      this.cameraTrauma = Math.max(0, this.cameraTrauma - dt * 1.9);
      const shake = this.cameraTrauma * this.cameraTrauma * 0.95;
      shakeX = (Math.random() * 2 - 1) * shake;
      shakeZ = (Math.random() * 2 - 1) * shake;
    }

    this.camera.position.set(
      this.cameraCurrentPos.x + shakeX,
      this.cameraCurrentPos.y,
      this.cameraCurrentPos.z + shakeZ,
    );
    this.camera.lookAt(this.cameraLookPos.x + shakeX * 0.4, this.cameraLookPos.y, this.cameraLookPos.z + shakeZ * 0.4);
  }

  // =========================================================================
  // DYNAMIC WEATHER & FIELD POWERUP DROPS
  // =========================================================================

  private stepWeather(dt: number, isTitleShowcase: boolean): void {
    const { startedTransitionTo } = stepWeatherCycle(this.weatherState, dt);
    this.applyWeatherAtmosphere(this.totalTime);

    if (startedTransitionTo && !isTitleShowcase) {
      const label = WEATHER_LABELS[startedTransitionTo].toUpperCase();
      const desc =
        startedTransitionTo === 'overcast'
          ? 'Cloud cover drifting across Canyon Ridge'
          : startedTransitionTo === 'light_fog'
            ? 'Light alpine mist settling over the bunkers'
            : 'Golden afternoon sunlight returning to the arena';
      this.pushBanner(`WEATHER: ${label}`, desc, 'neutral');
      this.emitHud();
    }
  }

  private applyWeatherAtmosphere(elapsed: number): void {
    const atmo = evaluateWeatherAtmosphere(this.weatherState);
    this.skyColor.setRGB(atmo.sky.r, atmo.sky.g, atmo.sky.b);
    this.fogExp.color.setRGB(atmo.fog.r, atmo.fog.g, atmo.fog.b);
    this.fogExp.density = atmo.fogDensity;

    this.sunLight.color.setRGB(atmo.sunColor.r, atmo.sunColor.g, atmo.sunColor.b);
    this.sunLight.intensity = atmo.sunIntensity;

    this.hemiLight.color.setRGB(atmo.hemiSky.r, atmo.hemiSky.g, atmo.hemiSky.b);
    this.hemiLight.groundColor.setRGB(atmo.hemiGround.r, atmo.hemiGround.g, atmo.hemiGround.b);
    this.hemiLight.intensity = atmo.hemiIntensity;

    this.rimLight.color.setRGB(atmo.rimColor.r, atmo.rimColor.g, atmo.rimColor.b);
    this.rimLight.intensity = atmo.rimIntensity;

    this.renderer.toneMappingExposure = atmo.exposure;

    const pollenMat = this.pollenPoints.material as THREE.PointsMaterial;
    pollenMat.color.setRGB(atmo.pollenColor.r, atmo.pollenColor.g, atmo.pollenColor.b);
    pollenMat.opacity = atmo.pollenOpacity;

    updateWeatherAtmosphereVisuals(this.weatherRig, elapsed, atmo.mistOpacity, atmo.cloudShadowOpacity);

    const activeWeather = this.weatherState.blend >= 0.5 ? this.weatherState.target : this.weatherState.current;
    document.body.dataset.weather = activeWeather;
  }

  private clearPowerups(): void {
    for (const rig of this.powerupRigs.values()) {
      this.scene.remove(rig.root);
      rig.dispose();
    }
    this.powerupRigs.clear();
    this.powerups = [];
  }

  private resetPowerups(isTitleShowcase: boolean): void {
    this.clearPowerups();
    this.powerupSpawnTimer = isTitleShowcase ? 14 : 11;

    // Immediately seed 2 high-visibility field drops so the arena feels alive right from start!
    if (isTitleShowcase) {
      this.spawnPowerupDrop(0, 'mega_splash', true);
      this.spawnPowerupDrop(2, 'rapid_hopper', false);
    } else {
      // One landed drop in Cobalt forward lane (-17, 0) & one parachuting into midfield center (0, 0)
      this.spawnPowerupDrop(1, 'turbo_boots', true);
      this.spawnPowerupDrop(0, 'mega_splash', false);
    }
  }

  private spawnPowerupDrop(
    forcedSpawnIndex?: number,
    forcedKind?: PowerupKind,
    startLanded = false,
  ): void {
    const spawnIndex =
      forcedSpawnIndex !== undefined ? forcedSpawnIndex : pickFreePowerupSpawnIndex(this.powerups);
    if (spawnIndex === null) return;

    const kinds: PowerupKind[] = ['turbo_boots', 'rapid_hopper', 'paint_shield', 'mega_splash'];
    const kind = forcedKind ?? kinds[this.powerupKindCursor++ % kinds.length];
    const pos = POWERUP_SPAWN_POINTS[spawnIndex];
    const id = `pw-${this.powerupSeq++}`;

    const drop: PowerupDropState = {
      id,
      kind,
      pos: { x: pos.x, z: pos.z },
      altitude: startLanded ? 0 : 12.5,
      landed: startLanded,
      life: POWERUP_DROP_LIFETIME,
      maxLife: POWERUP_DROP_LIFETIME,
      spawnIndex,
    };

    const rig = createPowerupDropRig(kind, this.textures.contactShadow);
    updatePowerupDropVisual(rig, drop, this.totalTime);
    this.scene.add(rig.root);
    this.powerups.push(drop);
    this.powerupRigs.set(id, rig);
  }

  private stepPowerupSystem(dt: number, isTitleShowcase: boolean): void {
    // Periodic field drop cadence
    if (this.powerups.length < POWERUP_MAX_ACTIVE) {
      this.powerupSpawnTimer -= dt;
      if (this.powerupSpawnTimer <= 0) {
        this.powerupSpawnTimer = 11.5 + Math.random() * 3.5;
        this.spawnPowerupDrop();
      }
    }

    const events = stepPowerupDrops(dt, this.powerups, this.actors);
    for (const ev of events) {
      const meta = POWERUP_META[ev.kind];
      if (ev.type === 'landed') {
        this.spawnParticles(ev.pos.x, 0.35, ev.pos.z, 14, meta.glowHex, 2.2, 5.8, 0.95, 11);
        if (!isTitleShowcase) {
          this.audio.playPowerupSpawn();
        }
      } else if (ev.type === 'collected') {
        const rig = this.powerupRigs.get(ev.dropId);
        if (rig) {
          this.scene.remove(rig.root);
          rig.dispose();
          this.powerupRigs.delete(ev.dropId);
        }
        this.spawnParticles(ev.pos.x, 1.0, ev.pos.z, 22, meta.glowHex, 3.0, 8.2, 1.1, 10);
        const actor = this.actors.find((a) => a.id === ev.actorId);
        if (!isTitleShowcase) {
          this.audio.playPowerupCollect(Boolean(actor?.isPlayer));
          if (actor?.isPlayer) {
            this.cameraTrauma = Math.min(1, this.cameraTrauma + 0.14);
            this.pushBanner(`${meta.label} ACTIVE`, meta.shortDesc, 'cobalt');
            this.emitHud();
          }
        }
      } else if (ev.type === 'expired') {
        const rig = this.powerupRigs.get(ev.dropId);
        if (rig) {
          this.scene.remove(rig.root);
          rig.dispose();
          this.powerupRigs.delete(ev.dropId);
        }
      }
    }
  }

  private syncPowerupMeshes(elapsed: number): void {
    for (let i = 0; i < this.powerups.length; i++) {
      const drop = this.powerups[i];
      const rig = this.powerupRigs.get(drop.id);
      if (rig) {
        updatePowerupDropVisual(rig, drop, elapsed);
      }
    }
  }

  private emitHud(): void {
    const player = this.actors.find((a) => a.isPlayer);
    const playerTeam: TeamId = player ? player.team : this.localTeam;
    const enemyFlag = this.flags[oppositeTeam(playerTeam)];
    const activeWeather = this.weatherState.blend >= 0.5 ? this.weatherState.target : this.weatherState.current;
    const snapshot: HudSnapshot = {
      phase: this.phase,
      localTeam: playerTeam,
      isMultiplayer: this.networkMode === 'multiplayer',
      roomCode: this.roomCode,
      isHost: this.isHost,
      connectedPlayers: this.connectedPlayers,
      cobaltScore: this.scores.cobalt,
      crimsonScore: this.scores.crimson,
      scoreLimit: SCORE_LIMIT,
      matchTimeRemaining: Math.ceil(this.matchTimeRemaining),
      cobaltFlag: this.flags.cobalt.status,
      crimsonFlag: this.flags.crimson.status,
      weather: activeWeather,
      weatherTransitioning: this.weatherState.current !== this.weatherState.target,
      playerHp: player ? Math.round(player.hp) : 0,
      playerMaxHp: player ? player.maxHp : 125,
      playerAlive: player ? player.alive : true,
      playerRespawnTimer: player ? Math.max(0, player.respawnTimer) : 0,
      playerAmmo: player ? player.ammo : 24,
      playerMaxAmmo: player ? player.maxAmmo : 24,
      playerReloading: player ? player.reloading : false,
      playerReloadProgress:
        player && player.reloading ? 1 - Math.max(0, player.reloadTimer / RELOAD_DURATION) : 1,
      playerDashReady: player ? 1 - Math.max(0, player.dashCooldown / DASH_COOLDOWN) : 1,
      playerBurstReady: player ? 1 - Math.max(0, player.burstCooldown / BURST_COOLDOWN) : 1,
      playerStunTimer: player ? Math.max(0, player.stunTimer) : 0,
      playerStunKills: player ? player.stunKillsProgress : 0,
      playerStunKillsRequired: STUN_KILLS_REQUIRED,
      playerStunReady: player ? player.stunKillsProgress >= STUN_KILLS_REQUIRED : false,
      playerStunRadius: computeStunWaveRadius(player ? player.stunActivations : 0),
      playerStunTier: (player ? player.stunActivations : 0) + 1,
      playerCarryingFlag:
        !!player &&
        enemyFlag.status === 'carried' &&
        enemyFlag.carrierId === player.id,
      playerBuffs: player ? player.buffs.map((b) => ({ ...b })) : [],
      playerTags: player ? player.tags : 0,
      playerCaptures: player ? player.captures : 0,
      muted: this.audio.muted,
      banner: this.banner,
      minimapActors: this.actors.map((a) => ({
        id: a.id,
        team: a.team,
        isPlayer: a.isPlayer,
        isHuman: a.isHuman,
        x: a.pos.x,
        z: a.pos.z,
        alive: a.alive,
        carryingFlag:
          this.flags[oppositeTeam(a.team)].status === 'carried' &&
          this.flags[oppositeTeam(a.team)].carrierId === a.id,
      })),
      minimapPowerups: this.powerups.map((d) => ({
        id: d.id,
        kind: d.kind,
        x: d.pos.x,
        z: d.pos.z,
        landed: d.landed,
      })),
      cobaltFlagPos: { ...this.flags.cobalt.pos },
      crimsonFlagPos: { ...this.flags.crimson.pos },
      endStats: this.endStats,
    };
    this.onHudUpdate(snapshot);
  }
}
