import * as THREE from 'three';
import type { GameInit, Snapshot, UnitSnap, VisualInfo, GameEvent } from '../../shared/protocol';
import { F } from '../../shared/protocol';
import { BANNER_RADIUS, CAMPS, FORTRESS, FOUNTAIN, MAP, OBSTACLES, bannerSpots, buildPads, lanepath } from '../../shared/map';
import { TEAM_COLORS } from '../../shared/constants';
import { rng } from '../../shared/math';
import { assets } from '../assets';
import { Vfx, GLOW } from './vfx';
import { sfx } from '../sfx';

const TEAM_HEX = TEAM_COLORS.map((c) => new THREE.Color(c));
const NEUTRAL_HEX = new THREE.Color('#f5c542');

export interface UnitView {
  id: number;
  vis: string;
  info: VisualInfo;
  team: number;
  root: THREE.Group;
  model: THREE.Object3D;
  mixer: THREE.AnimationMixer | null;
  actions: Map<string, THREE.AnimationAction>;
  loop: string;
  oneShotUntil: number;
  pos: THREE.Vector3;
  target: THREE.Vector3;
  facing: number;
  targetFacing: number;
  hpBar: THREE.Group | null;
  hpFill: THREE.Mesh | null;
  shieldFill: THREE.Mesh | null;
  ring: THREE.Mesh | null;
  snap: UnitSnap;
  lastSeen: number;
  dead: boolean;
  isStructure: boolean;
  destroyed: THREE.Object3D | null;
  baseY: number;
  height: number;
  statusFx: THREE.Sprite | null;
}

const PX = 8; // ground texture pixels per world unit

export class World {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(38, 1, 0.5, 600);
  readonly renderer: THREE.WebGLRenderer;
  readonly vfx: Vfx;
  readonly units = new Map<number, UnitView>();
  private projViews = new Map<number, { obj: THREE.Object3D; target: THREE.Vector3; style: string; spin: number }>();
  private zoneViews = new Map<number, { mesh: THREE.Mesh; inner: THREE.Mesh; color: THREE.Color; style: string; r: number }>();
  private bannerViews: { home: number; key: string; group: THREE.Group; flag: THREE.Object3D | null; owner: number; ring: THREE.Mesh; progress: THREE.Mesh; lock: THREE.Sprite }[] = [];
  private padViews: { ring: THREE.Mesh; base: THREE.Object3D; team: number }[] = [];
  private fogCanvas = document.createElement('canvas');
  private fogTex: THREE.CanvasTexture;
  private fogMesh: THREE.Mesh;
  private sun: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private nightT = 0;
  private time = 0;
  myTeam = 0;
  myUnit = 0;
  spectator = false;
  camTarget = new THREE.Vector3(0, 0, 0);
  camDist = 42;
  private hoverRing: THREE.Mesh;
  private rangeRing: THREE.Mesh;
  private aimMesh: THREE.Mesh;
  private moveMarker: { mesh: THREE.Mesh; t: number };

  constructor(canvas: HTMLCanvasElement, private init: GameInit) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.scene.background = new THREE.Color('#9ec9e8');
    this.scene.fog = new THREE.Fog('#9ec9e8', 90, 260);

    this.hemi = new THREE.HemisphereLight('#dff1ff', '#5a6b3a', 1.1);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight('#fff3dd', 2.2);
    this.sun.position.set(-30, 60, 25);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera as THREE.OrthographicCamera;
    sc.left = -45; sc.right = 45; sc.top = 45; sc.bottom = -45; sc.near = 1; sc.far = 160;
    this.sun.shadow.bias = -0.0008;
    this.scene.add(this.sun, this.sun.target);

    this.vfx = new Vfx(this.scene);
    this.buildGround();
    this.buildEnvironment();
    this.buildBanners();
    this.buildPads();

    this.fogCanvas.width = MAP.maxX - MAP.minX;
    this.fogCanvas.height = MAP.maxZ - MAP.minZ;
    this.fogTex = new THREE.CanvasTexture(this.fogCanvas);
    this.fogTex.minFilter = THREE.LinearFilter;
    this.fogTex.magFilter = THREE.LinearFilter;
    this.fogMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(MAP.maxX - MAP.minX, MAP.maxZ - MAP.minZ),
      new THREE.MeshBasicMaterial({ color: '#070a14', transparent: true, alphaMap: this.fogTex, depthWrite: false, opacity: 1 }),
    );
    this.fogMesh.rotation.x = -Math.PI / 2;
    this.fogMesh.position.y = 0.2;
    this.fogMesh.renderOrder = 5;
    this.scene.add(this.fogMesh);

    const mk = (color: string, opacity: number) => {
      const m = new THREE.Mesh(new THREE.RingGeometry(0.92, 1, 64), new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide }));
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      m.renderOrder = 6;
      this.scene.add(m);
      return m;
    };
    this.hoverRing = mk('#ffffff', 0.6);
    this.rangeRing = mk('#9be7ff', 0.5);
    this.aimMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: '#9be7ff', transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }));
    this.aimMesh.rotation.x = -Math.PI / 2;
    this.aimMesh.visible = false;
    this.scene.add(this.aimMesh);
    const mm = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.5, 24), new THREE.MeshBasicMaterial({ color: '#7cff8a', transparent: true, depthWrite: false }));
    mm.rotation.x = -Math.PI / 2;
    mm.visible = false;
    this.scene.add(mm);
    this.moveMarker = { mesh: mm, t: 0 };

    const me = init.players.find((p) => p.playerId === init.you);
    this.myTeam = me?.team ?? 0;
    this.myUnit = me?.unitId ?? 0;
    this.spectator = !me;
    if (this.spectator) this.fogMesh.visible = false;
    const f = FOUNTAIN[this.myTeam as 0 | 1];
    this.camTarget.set(f.x, 0, f.z);
    this.resize();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------------ static world
  private buildGround() {
    const W = (MAP.maxX - MAP.minX) * PX, H = (MAP.maxZ - MAP.minZ) * PX;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d')!;
    const R = rng(7);
    const toPx = (x: number, z: number): [number, number] => [(x - MAP.minX) * PX, (z - MAP.minZ) * PX];
    g.fillStyle = '#5f8f3c';
    g.fillRect(0, 0, W, H);
    // grass variation
    for (let i = 0; i < 2600; i++) {
      const x = R() * W, y = R() * H, r = 6 + R() * 40;
      g.fillStyle = `rgba(${60 + R() * 40},${110 + R() * 50},${40 + R() * 25},${0.08 + R() * 0.12})`;
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
    // jungle shade
    const jg = g.createRadialGradient(W / 2, H / 2, 20, W / 2, H / 2, W * 0.42);
    jg.addColorStop(0, 'rgba(30,60,25,0.35)');
    jg.addColorStop(1, 'rgba(30,60,25,0)');
    g.fillStyle = jg;
    g.fillRect(0, 0, W, H);
    // lanes
    const lane = (lw: number, color: string) => {
      g.strokeStyle = color; g.lineWidth = lw * PX; g.lineCap = 'round'; g.lineJoin = 'round';
      for (const l of [0, 1] as const) {
        const pts = lanepath(l, 0);
        g.beginPath();
        pts.forEach((p, i) => { const [x, y] = toPx(p.x, p.z); if (i) g.lineTo(x, y); else g.moveTo(x, y); });
        g.stroke();
      }
    };
    lane(11, 'rgba(120,95,55,0.55)');
    lane(8.5, '#b8945c');
    lane(6, 'rgba(205,170,110,0.7)');
    // pebbles on lanes
    for (const l of [0, 1] as const) for (const p of lanepath(l, 0)) for (let i = 0; i < 30; i++) {
      const [x, y] = toPx(p.x + (R() - 0.5) * 22, p.z + (R() - 0.5) * 8);
      g.fillStyle = `rgba(90,70,40,${0.2 + R() * 0.3})`; g.fillRect(x, y, 2 + R() * 4, 2 + R() * 3);
    }
    // base plazas
    for (const t of [0, 1] as const) {
      const f = FORTRESS[t];
      const [x, y] = toPx(f.x, f.z);
      const grad = g.createRadialGradient(x, y, 10, x, y, 26 * PX);
      grad.addColorStop(0, '#a89f8a'); grad.addColorStop(0.75, '#958b74'); grad.addColorStop(1, 'rgba(149,139,116,0)');
      g.fillStyle = grad;
      g.beginPath(); g.arc(x, y, 26 * PX, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(70,62,50,0.35)'; g.lineWidth = 2;
      for (let r = 4; r < 22; r += 2.5) { g.beginPath(); g.arc(x, y, r * PX, 0, Math.PI * 2); g.stroke(); }
      for (let a = 0; a < 24; a++) { g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a / 24 * Math.PI * 2) * 20 * PX, y + Math.sin(a / 24 * Math.PI * 2) * 20 * PX); g.stroke(); }
      const fo = FOUNTAIN[t];
      const [fx, fy] = toPx(fo.x, fo.z);
      g.fillStyle = t === 0 ? 'rgba(61,139,253,0.35)' : 'rgba(229,72,77,0.35)';
      g.beginPath(); g.arc(fx, fy, 6 * PX, 0, Math.PI * 2); g.fill();
    }
    // colossus pit
    const [cx, cy] = toPx(0, 0);
    const pit = g.createRadialGradient(cx, cy, 0, cx, cy, 12 * PX);
    pit.addColorStop(0, '#4e4232'); pit.addColorStop(0.7, '#6b5a3e'); pit.addColorStop(1, 'rgba(107,90,62,0)');
    g.fillStyle = pit; g.beginPath(); g.arc(cx, cy, 12 * PX, 0, Math.PI * 2); g.fill();
    // camp clearings
    for (const camp of CAMPS) {
      if (camp.kind === 'colossus') continue;
      const [x, y] = toPx(camp.pos.x, camp.pos.z);
      const cg = g.createRadialGradient(x, y, 0, x, y, 6 * PX);
      cg.addColorStop(0, 'rgba(110,95,70,0.7)'); cg.addColorStop(1, 'rgba(110,95,70,0)');
      g.fillStyle = cg; g.beginPath(); g.arc(x, y, 6 * PX, 0, Math.PI * 2); g.fill();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(MAP.maxX - MAP.minX, MAP.maxZ - MAP.minZ), new THREE.MeshStandardMaterial({ map: tex, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);
    const outer = new THREE.Mesh(new THREE.PlaneGeometry(700, 500), new THREE.MeshStandardMaterial({ color: '#4f7a33', roughness: 1 }));
    outer.rotation.x = -Math.PI / 2;
    outer.position.y = -0.05;
    outer.receiveShadow = true;
    this.scene.add(outer);
  }

  private place(name: string, x: number, z: number, opts: { width?: number; scale?: number; rot?: number; y?: number } = {}) {
    const o = assets.envModel(name, opts.width);
    if (opts.scale) o.scale.multiplyScalar(opts.scale);
    o.position.set(x, opts.y ?? 0, z);
    o.rotation.y = opts.rot ?? 0;
    this.scene.add(o);
    return o;
  }

  private buildEnvironment() {
    const R = rng(11);
    // border forest and mountains
    const big = ['trees_A_large', 'trees_B_large', 'trees_A_large', 'trees_B_large', 'trees_A_medium', 'rock_single_A'];
    for (let x = MAP.minX - 30; x <= MAP.maxX + 30; x += 7) for (const side of [-1, 1]) {
      const z = side * (MAP.maxZ + 3 + R() * 14);
      this.place(big[Math.floor(R() * big.length)], x + R() * 3, z, { width: 6 + R() * 6, rot: R() * 6 });
    }
    for (let z = MAP.minZ - 10; z <= MAP.maxZ + 10; z += 7) for (const side of [-1, 1]) {
      const x = side * (MAP.maxX + 3 + R() * 12);
      this.place(big[Math.floor(R() * big.length)], x, z + R() * 3, { width: 6 + R() * 6, rot: R() * 6 });
    }
    // gameplay obstacles
    for (const o of OBSTACLES) {
      if (o.kind === 'trees') {
        this.place(R() > 0.5 ? 'trees_A_large' : 'trees_B_large', o.pos.x, o.pos.z, { width: o.r * 1.9, rot: R() * 6 });
      } else if (o.kind === 'rock') {
        this.place(['rock_single_A', 'rock_single_B', 'rock_single_C', 'rock_single_D'][Math.floor(R() * 4)], o.pos.x, o.pos.z, { width: o.r * 2.1, rot: R() * 6 });
      } else {
        this.place('rock_single_C', o.pos.x, o.pos.z, { width: o.r * 1.6, rot: R() * 6 });
        for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; this.place(i % 2 ? 'trees_B_medium' : 'trees_A_medium', o.pos.x + Math.cos(a) * o.r * 0.75, o.pos.z + Math.sin(a) * o.r * 0.75, { width: o.r * 0.9, rot: R() * 6 }); }
      }
    }
    // decorative scatter (non-blocking, kept off lanes and camps)
    const avoid = (x: number, z: number) => {
      for (const l of [0, 1] as const) for (const p of lanepath(l, 0)) if (Math.hypot(p.x - x, p.z - z) < 9) return true;
      for (const c of CAMPS) if (Math.hypot(c.pos.x - x, c.pos.z - z) < 8) return true;
      for (const o of OBSTACLES) if (Math.hypot(o.pos.x - x, o.pos.z - z) < o.r + 3) return true;
      for (const t of [0, 1] as const) if (Math.hypot(FORTRESS[t].x - x, FORTRESS[t].z - z) < 28) return true;
      return Math.hypot(x, z) < 12;
    };
    const small = ['tree_single_A', 'tree_single_B', 'rock_single_E', 'trees_A_medium', 'trees_B_medium', 'rock_single_D'];
    for (let i = 0; i < 110; i++) {
      const x = MAP.minX + 4 + R() * (MAP.maxX - MAP.minX - 8), z = MAP.minZ + 4 + R() * (MAP.maxZ - MAP.minZ - 8);
      if (avoid(x, z)) continue;
      this.place(small[Math.floor(R() * small.length)], x, z, { width: 1.5 + R() * 2.5, rot: R() * 6 });
    }
    // base dressing: forge (barracks), smithy (shop), market, walls
    for (const t of [0, 1] as const) {
      const s = t === 0 ? 1 : -1;
      const col = t === 0 ? 'blue' : 'red';
      const f = FOUNTAIN[t];
      this.place(`building_barracks_${col}`, f.x + s * 3, f.z - 14, { width: 7, rot: s > 0 ? Math.PI / 2 : -Math.PI / 2 });
      this.place(`building_blacksmith_${col}`, f.x + s * 3, f.z + 14, { width: 6.5, rot: s > 0 ? Math.PI / 2 : -Math.PI / 2 });
      this.place(`building_market_${col}`, f.x - s * 2, f.z + 22, { width: 6 });
      this.place(`building_church_${col}`, f.x - s * 2, f.z - 22, { width: 6 });
      this.place('tent', f.x + s * 9, f.z + 18, { width: 3.5 });
      this.place('weaponrack', f.x + s * 6, f.z + 9, { width: 2 });
      this.place('barrel', f.x + s * 7, f.z - 9, { width: 1.2 });
      this.place('crate_A_big', f.x + s * 8, f.z - 10.5, { width: 1.5 });
      this.place('bucket_arrows', f.x + s * 9, f.z + 10, { width: 1 });
      for (let a = -5; a <= 5; a++) this.place('wall_straight', f.x - s * 5.5, f.z + a * 4.5, { width: 4.6, rot: Math.PI / 2 });
      // glowing fountain disc
      const disc = new THREE.Mesh(new THREE.CircleGeometry(4, 48), new THREE.MeshBasicMaterial({ color: TEAM_COLORS[t], transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
      disc.rotation.x = -Math.PI / 2;
      disc.position.set(f.x, 0.06, f.z);
      this.scene.add(disc);
    }
  }

  private buildBanners() {
    for (const team of [0, 1] as const) for (const b of bannerSpots(team)) {
      const group = new THREE.Group();
      group.position.set(b.pos.x, 0, b.pos.z);
      const ring = new THREE.Mesh(new THREE.RingGeometry(BANNER_RADIUS - 0.25, BANNER_RADIUS, 64), new THREE.MeshBasicMaterial({ color: TEAM_COLORS[team], transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.07;
      const progress = new THREE.Mesh(new THREE.RingGeometry(BANNER_RADIUS - 0.9, BANNER_RADIUS - 0.3, 64, 1, 0, 0.001), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }));
      progress.rotation.x = -Math.PI / 2;
      progress.position.y = 0.08;
      const plinth = assets.envModel('building_stage_A', 4.2);
      plinth.scale.y *= 0.5;
      const lock = new THREE.Sprite(new THREE.SpriteMaterial({ map: emojiTexture('🔒'), depthTest: false, transparent: true }));
      lock.scale.set(1.6, 1.6, 1);
      lock.position.y = 7.5;
      group.add(ring, progress, plinth, lock);
      this.scene.add(group);
      const v = { home: team, key: b.key, group, flag: null as THREE.Object3D | null, owner: -1, ring, progress, lock };
      this.bannerViews.push(v);
      this.setBannerOwner(v, team);
    }
  }

  private setBannerOwner(v: World['bannerViews'][number], owner: number) {
    if (v.owner === owner) return;
    v.owner = owner;
    if (v.flag) v.group.remove(v.flag);
    const f = assets.envModel(owner === 0 ? 'flag_blue' : 'flag_red');
    f.scale.multiplyScalar(4.2);
    f.position.y = 0.6;
    v.group.add(f);
    v.flag = f;
    (v.ring.material as THREE.MeshBasicMaterial).color.set(TEAM_COLORS[owner]);
  }

  private buildPads() {
    for (const team of [0, 1] as const) for (const p of buildPads(team)) {
      const base = assets.envModel(team === 0 ? 'building_tower_base_blue' : 'building_tower_base_red', 2.6);
      base.position.set(p.x, 0, p.z);
      const ring = new THREE.Mesh(new THREE.RingGeometry(1.7, 2, 32), new THREE.MeshBasicMaterial({ color: TEAM_COLORS[team], transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(p.x, 0.06, p.z);
      this.scene.add(base, ring);
      this.padViews.push({ ring, base, team });
    }
  }

  // ------------------------------------------------------------------ units
  private makeUnitView(s: UnitSnap): UnitView {
    const [id, vis, team] = s;
    const info = this.init.visuals[vis] ?? { model: 'Skeleton_Minion', scale: 1, weapons: [], name: vis, kind: 'minion' };
    const root = new THREE.Group();
    let model: THREE.Object3D;
    let mixer: THREE.AnimationMixer | null = null;
    const actions = new Map<string, THREE.AnimationAction>();
    const isStructure = info.model === 'tower' || info.model === 'fortress';
    let height = 2.6;
    if (isStructure) {
      const col = team === 0 ? 'blue' : 'red';
      const tk = info.towerKind ?? 'lane';
      const name = tk === 'fortress' ? `building_castle_${col}` : tk === 'cannon' ? `building_tower_catapult_${col}` : tk === 'lane' ? `building_tower_A_${col}` : `building_tower_B_${col}`;
      const width = tk === 'fortress' ? 10 : tk === 'lane' ? 4.2 : 3.2;
      model = assets.envModel(name, width);
      if (tk === 'frost' || tk === 'arcane') {
        const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, color: tk === 'frost' ? '#9be7ff' : '#c77dff', blending: THREE.AdditiveBlending, depthWrite: false }));
        glow.scale.set(3, 3, 1);
        glow.position.y = 5;
        root.add(glow);
      }
      height = tk === 'fortress' ? 9 : tk === 'lane' ? 8 : 6;
    } else {
      const teamTint = ['#1d4ed8', '#b91c1c'][team];
      const tint = info.kind === 'minion' || (info.kind === 'summon' && !info.tint) ? teamTint : info.tint;
      const c = assets.character(info.model as never, info.weapons, tint, info.kind === 'hero' ? 0.55 : 0.85);
      model = c.root;
      model.scale.setScalar(info.scale);
      height = 2.5 * info.scale;
      mixer = new THREE.AnimationMixer(model);
      for (const clip of c.clips) actions.set(clip.name, mixer.clipAction(clip));
    }
    root.add(model);
    // team ring under characters
    let ring: THREE.Mesh | null = null;
    if (!isStructure) {
      const r = info.kind === 'hero' ? 0.9 : 0.6 * info.scale;
      const isMe = id === this.myUnit;
      ring = new THREE.Mesh(new THREE.RingGeometry(r * 0.8, r, 32), new THREE.MeshBasicMaterial({
        color: isMe ? '#7cff8a' : team === 2 ? NEUTRAL_HEX : TEAM_HEX[team], transparent: true, opacity: info.kind === 'hero' ? 0.85 : 0.45, depthWrite: false, side: THREE.DoubleSide,
      }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.05;
      root.add(ring);
      const blob = new THREE.Mesh(new THREE.CircleGeometry(r * 0.9, 20), new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.25, depthWrite: false }));
      blob.rotation.x = -Math.PI / 2;
      blob.position.y = 0.04;
      root.add(blob);
    }
    // health bar
    const barW = isStructure ? (info.towerKind === 'fortress' ? 6 : 3) : info.kind === 'hero' ? 1.8 : info.kind === 'monster' && info.scale > 2 ? 4 : 1.1;
    const barH = info.kind === 'hero' || isStructure ? 0.2 : 0.12;
    const hpBar = new THREE.Group();
    const bg = new THREE.Mesh(new THREE.PlaneGeometry(barW + 0.08, barH + 0.08), new THREE.MeshBasicMaterial({ color: '#111111', depthTest: false, transparent: true, opacity: 0.85 }));
    const fillColor = id === this.myUnit ? '#4ade80' : team === this.myTeam ? '#60a5fa' : team === 2 ? '#facc15' : '#f87171';
    const fillGeo = new THREE.PlaneGeometry(barW, barH);
    fillGeo.translate(barW / 2, 0, 0);
    const hpFill = new THREE.Mesh(fillGeo, new THREE.MeshBasicMaterial({ color: fillColor, depthTest: false, transparent: true }));
    hpFill.position.x = -barW / 2;
    hpFill.userData.w = barW;
    const shieldFill = new THREE.Mesh(fillGeo.clone(), new THREE.MeshBasicMaterial({ color: '#f1f5f9', depthTest: false, transparent: true }));
    shieldFill.position.x = -barW / 2;
    shieldFill.position.z = 0.001;
    bg.renderOrder = 20; hpFill.renderOrder = 21; shieldFill.renderOrder = 22;
    hpBar.add(bg, hpFill, shieldFill);
    hpBar.position.y = height + (isStructure ? 1 : 0.5);
    root.add(hpBar);

    this.scene.add(root);
    const v: UnitView = {
      id, vis, info, team, root, model, mixer, actions, loop: '', oneShotUntil: 0,
      pos: new THREE.Vector3(s[3], 0, s[4]), target: new THREE.Vector3(s[3], 0, s[4]), facing: s[5], targetFacing: s[5],
      hpBar, hpFill, shieldFill, ring, snap: s, lastSeen: this.time, dead: false, isStructure, destroyed: null, baseY: 0, height, statusFx: null,
    };
    root.position.copy(v.pos);
    model.rotation.y = v.facing;
    if (mixer) this.playLoop(v, 'Idle');
    if (info.kind === 'minion' || info.kind === 'summon') this.playOnce(v, 'Spawn_Ground', 0.9);
    return v;
  }

  private playLoop(v: UnitView, name: string) {
    if (v.loop === name || !v.mixer) return;
    const next = v.actions.get(name) ?? v.actions.get('Idle');
    if (!next) return;
    const prev = v.actions.get(v.loop);
    next.reset();
    next.setLoop(THREE.LoopRepeat, Infinity);
    next.clampWhenFinished = false;
    next.play();
    if (prev && prev !== next) prev.crossFadeTo(next, 0.18, false);
    v.loop = name;
  }

  playOnce(v: UnitView, name: string, speed = 1) {
    const a = v.actions.get(name);
    if (!a || !v.mixer || v.dead) return;
    a.reset();
    a.setLoop(THREE.LoopOnce, 1);
    a.clampWhenFinished = false;
    a.timeScale = speed;
    a.setEffectiveWeight(1);
    a.fadeIn(0.06);
    a.play();
    const cur = v.actions.get(v.loop);
    if (cur && cur !== a) cur.fadeOut(0.06);
    v.oneShotUntil = this.time + a.getClip().duration / speed - 0.08;
    v.loop = `__once:${name}`;
  }

  applySnapshot(s: Snapshot) {
    const seen = new Set<number>();
    for (const u of s.units) {
      seen.add(u[0]);
      let v = this.units.get(u[0]);
      if (!v) { v = this.makeUnitView(u); this.units.set(u[0], v); }
      v.snap = u;
      v.lastSeen = this.time;
      v.root.visible = true;
      const tx = u[3], tz = u[4];
      if (Math.hypot(tx - v.target.x, tz - v.target.z) > 8) v.pos.set(tx, 0, tz); // teleport
      v.target.set(tx, 0, tz);
      v.targetFacing = u[5];
      const dead = (u[9] & F.dead) !== 0;
      if (dead && !v.dead) this.onDeath(v);
      if (!dead && v.dead) this.onRevive(v);
    }
    for (const [id, v] of this.units) {
      if (seen.has(id)) continue;
      if (v.isStructure && !v.dead) continue; // structures stay where they were
      if (v.dead && v.isStructure) continue;
      // out of vision or removed
      this.scene.remove(v.root);
      this.units.delete(id);
    }
    // projectiles
    const pseen = new Set<number>();
    for (const p of s.projs) {
      pseen.add(p[0]);
      let pv = this.projViews.get(p[0]);
      if (!pv) {
        pv = { obj: makeProjectile(p[3], p[4], p[5]), target: new THREE.Vector3(p[1], 1.4, p[2]), style: p[3], spin: 0 };
        pv.obj.position.set(p[1], 1.4, p[2]);
        this.scene.add(pv.obj);
        this.projViews.set(p[0], pv);
      }
      const dir = new THREE.Vector3(p[1] - pv.target.x, 0, p[2] - pv.target.z);
      if (dir.lengthSq() > 1e-4) pv.obj.rotation.y = Math.atan2(dir.x, dir.z);
      pv.target.set(p[1], 1.4, p[2]);
    }
    for (const [id, pv] of this.projViews) if (!pseen.has(id)) {
      const c = new THREE.Color((pv.obj.userData.color as string) ?? '#ffffff');
      this.vfx.emit(pv.target.x, 1.4, pv.target.z, c, { count: 6, speed: 2, life: 0.3, size: 0.5 });
      this.scene.remove(pv.obj);
      this.projViews.delete(id);
    }
    // zones
    const zseen = new Set<number>();
    for (const z of s.zones) {
      zseen.add(z[0]);
      let zv = this.zoneViews.get(z[0]);
      if (!zv) {
        const color = new THREE.Color(z[5]);
        const mesh = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending }));
        mesh.rotation.x = -Math.PI / 2;
        const inner = new THREE.Mesh(new THREE.RingGeometry(0.93, 1, 48), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false }));
        inner.rotation.x = -Math.PI / 2;
        this.scene.add(mesh, inner);
        zv = { mesh, inner, color, style: z[4], r: z[3] };
        this.zoneViews.set(z[0], zv);
      }
      zv.mesh.position.set(z[1], 0.09, z[2]);
      zv.inner.position.set(z[1], 0.1, z[2]);
      zv.mesh.scale.setScalar(z[3]);
      zv.inner.scale.setScalar(z[3]);
    }
    for (const [id, zv] of this.zoneViews) if (!zseen.has(id)) { this.scene.remove(zv.mesh, zv.inner); this.zoneViews.delete(id); }
    // banners
    for (const b of s.banners) {
      const v = this.bannerViews.find((x) => x.home === b[0] && x.key === b[1]);
      if (!v) continue;
      this.setBannerOwner(v, b[2]);
      const prog = b[3];
      v.progress.geometry.dispose();
      v.progress.geometry = new THREE.RingGeometry(BANNER_RADIUS - 0.9, BANNER_RADIUS - 0.3, 64, 1, Math.PI / 2, Math.max(0.001, prog * Math.PI * 2));
      (v.progress.material as THREE.MeshBasicMaterial).color.set(b[4] >= 0 ? TEAM_COLORS[b[4]] : '#ffffff');
      v.lock.visible = b[5] === 1;
    }
    s.pads.forEach((p, i) => { const pv = this.padViews[i]; if (pv) pv.ring.visible = !p[2] && p[1] === this.myTeam; });
    // day / night
    this.nightTarget = s.night ? 1 : 0;
    this.updateFog(s.sight);
  }
  private nightTarget = 0;

  private onDeath(v: UnitView) {
    v.dead = true;
    if (v.isStructure) {
      v.model.visible = false;
      const ruin = assets.envModel('building_destroyed', v.info.towerKind === 'fortress' ? 12 : 4);
      v.root.add(ruin);
      v.destroyed = ruin;
      const c = new THREE.Color('#9c8b70');
      for (let i = 0; i < 4; i++) this.vfx.emit(v.pos.x, 2 + i, v.pos.z, c, { count: 30, speed: 5, up: 5, life: 1.5, size: 1.6, gravity: 3 });
      if (v.hpBar) v.hpBar.visible = false;
      return;
    }
    const a = v.actions.get(Math.random() < 0.5 ? 'Death_A' : 'Death_B') ?? v.actions.get('Death_A');
    if (a && v.mixer) {
      v.mixer.stopAllAction();
      a.reset(); a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; a.play();
      v.loop = '__dead';
    }
    if (v.hpBar) v.hpBar.visible = false;
    if (v.ring) v.ring.visible = false;
  }

  private onRevive(v: UnitView) {
    v.dead = false;
    v.mixer?.stopAllAction();
    v.loop = '';
    this.playLoop(v, 'Idle');
    if (v.hpBar) v.hpBar.visible = true;
    if (v.ring) v.ring.visible = true;
  }

  /** Distance-attenuated, panned sound at a world position. */
  private sound(kind: Parameters<typeof sfx.play>[0], x: number, z: number, boost = 1) {
    const d = Math.hypot(x - this.camTarget.x, z - this.camTarget.z);
    sfx.play(kind, Math.max(0, 1 - d / (this.camDist * 1.1)) * boost, (x - this.camTarget.x) / 30);
  }

  handleEvent(e: GameEvent) {
    this.eventSound(e);
    switch (e.e) {
      case 'atk': {
        const v = this.units.get(e.id);
        if (!v) return;
        if (v.isStructure) {
          const c = new THREE.Color(v.info.towerKind === 'frost' ? '#9be7ff' : '#ffe08a');
          this.vfx.emit(v.pos.x, v.height, v.pos.z, c, { count: 6, speed: 1, life: 0.3 });
        } else this.playOnce(v, e.anim, 1.35);
        return;
      }
      case 'cast': { const v = this.units.get(e.id); if (v) this.playOnce(v, e.anim, 1.2); return; }
      case 'vfx': this.vfx.burst(e.style, e.color, e.x, e.z, e.r, e.shape ?? 'circle', e.dx ?? 0, e.dz ?? 1, e.angle ?? 60, e.w ?? 2, e.delay ?? 0); return;
      case 'chain': this.vfx.chain(e.pts, e.color); return;
      case 'dmg': {
        const v = this.units.get(e.id);
        if (!v || v.isStructure) return;
        const c = new THREE.Color(e.k === 0 ? '#ff9f6b' : e.k === 1 ? '#b18cff' : '#ffffff');
        this.vfx.emit(v.pos.x, v.height * 0.6, v.pos.z, c, { count: e.c ? 10 : 4, speed: 2.5, life: 0.35, size: 0.4 });
        if (e.a > 60 && v.loop === 'Idle' && Math.random() < 0.3) this.playOnce(v, 'Hit_A', 1.4);
        return;
      }
      case 'heal': { const v = this.units.get(e.id); if (v) this.vfx.emit(v.pos.x, 1, v.pos.z, new THREE.Color('#7cff8a'), { count: 10, speed: 0.8, up: 3, gravity: -1, life: 0.9, size: 0.5 }); return; }
      case 'level': { const v = this.units.get(e.id); if (v) this.vfx.burst('holy', '#ffd166', v.pos.x, v.pos.z, 2.2); return; }
      case 'blink': {
        const v = this.units.get(e.id);
        if (v) { v.pos.set(e.x, 0, e.z); v.target.set(e.x, 0, e.z); this.vfx.emit(e.x, 1, e.z, new THREE.Color('#c9b6ff'), { count: 20, speed: 2, life: 0.6 }); }
        return;
      }
      case 'banner': {
        const v = this.bannerViews.find((x) => x.home !== undefined && x.key === e.key && x.group);
        void v;
        return;
      }
    }
  }

  private eventSound(e: GameEvent) {
    const at = (id: number) => this.units.get(id);
    switch (e.e) {
      case 'atk': { const v = at(e.id); if (v && (v.isStructure || v.info.kind === 'hero') && !/Melee|Punch|Kick/.test(e.anim)) this.sound('shoot', v.pos.x, v.pos.z, v.isStructure ? 0.6 : 0.8); break; }
      case 'dmg': {
        const v = at(e.id);
        if (!v) break;
        const mine = e.id === this.myUnit || e.s === this.myUnit;
        this.sound(e.c ? 'crit' : v.isStructure ? 'thud' : 'hit', v.pos.x, v.pos.z, mine ? 1 : v.info.kind === 'hero' ? 0.6 : 0.25);
        break;
      }
      case 'cast': { const v = at(e.id); if (v) this.sound('cast', v.pos.x, v.pos.z, v.info.kind === 'hero' ? 0.9 : 0.5); break; }
      case 'vfx': if (!e.delay) { if (/fire|earth|meteor/.test(e.style) && e.r >= 2.5) this.sound('boom', e.x, e.z, 0.7); else if (e.style === 'lightning') this.sound('zap', e.x, e.z, 0.7); } break;
      case 'chain': this.sound('zap', e.pts[2] ?? 0, e.pts[3] ?? 0, 0.6); break;
      case 'heal': if (e.id === this.myUnit && e.a > 25) sfx.play('heal', 0.6); break;
      case 'gold': if (e.a >= 15) sfx.play('gold', e.a >= 100 ? 0.7 : 0.35); break;
      case 'level': if (e.id === this.myUnit) sfx.play('level', 0.8); break;
      case 'death': { const v = at(e.id); if (v && v.info.kind === 'hero') this.sound('death', v.pos.x, v.pos.z, 1.2); else if (v?.isStructure) sfx.play('boom', 1); break; }
      case 'blink': { const v = at(e.id); if (v) this.sound('blink', e.x, e.z, 0.8); break; }
      case 'banner': sfx.play('horn', 0.8); break;
      case 'struct': sfx.play('boom', 0.9); break;
    }
  }

  showMoveMarker(x: number, z: number, attack: boolean) {
    const m = this.moveMarker;
    m.mesh.position.set(x, 0.08, z);
    (m.mesh.material as THREE.MeshBasicMaterial).color.set(attack ? '#ff6b6b' : '#7cff8a');
    m.mesh.visible = true;
    m.t = 0.5;
  }

  showRange(x: number, z: number, r: number) {
    this.rangeRing.visible = r > 0;
    this.rangeRing.position.set(x, 0.1, z);
    this.rangeRing.scale.setScalar(Math.max(0.01, r));
  }
  showAim(kind: 'none' | 'line' | 'circle', x: number, z: number, tx: number, tz: number, w: number, len: number) {
    this.aimMesh.visible = kind !== 'none';
    this.hoverRing.visible = kind === 'circle';
    if (kind === 'line') {
      const dx = tx - x, dz = tz - z;
      const a = Math.atan2(dx, dz);
      this.aimMesh.geometry.dispose();
      const g = new THREE.PlaneGeometry(w, len);
      g.translate(0, len / 2, 0);
      this.aimMesh.geometry = g;
      this.aimMesh.rotation.set(-Math.PI / 2, 0, Math.PI - a, 'XYZ');
      this.aimMesh.rotation.z = a + Math.PI;
      this.aimMesh.position.set(x, 0.11, z);
    } else if (kind === 'circle') {
      this.aimMesh.visible = false;
      this.hoverRing.position.set(tx, 0.12, tz);
      this.hoverRing.scale.setScalar(Math.max(0.5, w));
    }
  }

  private fogTimer = 0;
  private lastSight: number[] = [];
  private updateFog(sight: number[]) { this.lastSight = sight; }

  private drawFog() {
    // alphaMap samples the green channel: grey = fogged, black = visible
    const c = this.fogCanvas, g = c.getContext('2d')!;
    g.globalCompositeOperation = 'source-over';
    const v = Math.round(255 * (0.55 + this.nightT * 0.15));
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.fillRect(0, 0, c.width, c.height);
    const s = this.lastSight;
    for (let i = 0; i + 2 < s.length; i += 3) {
      const x = s[i] - MAP.minX, y = s[i + 1] - MAP.minZ, r = s[i + 2];
      const grad = g.createRadialGradient(x, y, r * 0.7, x, y, r);
      grad.addColorStop(0, 'rgba(0,0,0,1)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
    this.fogTex.needsUpdate = true;
  }

  // ------------------------------------------------------------------ per-frame
  update(dt: number) {
    this.time += dt;
    const k = 1 - Math.exp(-dt * 14);
    const kMe = 1 - Math.exp(-dt * 26); // own hero follows the server more tightly for responsiveness
    for (const v of this.units.values()) {
      v.pos.lerp(v.target, v.id === this.myUnit ? kMe : k);
      let df = v.targetFacing - v.facing;
      while (df > Math.PI) df -= Math.PI * 2;
      while (df < -Math.PI) df += Math.PI * 2;
      v.facing += df * Math.min(1, dt * 16);
      const f = v.snap[9];
      const airborne = (f & F.airborne) !== 0;
      v.baseY += ((airborne ? 1.3 : 0) - v.baseY) * Math.min(1, dt * 12);
      v.root.position.set(v.pos.x, v.baseY, v.pos.z);
      if (!v.isStructure) v.model.rotation.y = v.facing;
      // stealth: shown as a ghost (only allies, or enemies standing right next to it, receive the unit at all)
      const stealth = (f & F.stealth) !== 0;
      if (stealth !== !!v.root.userData.ghost) { v.root.userData.ghost = stealth; setGhost(v.model, stealth); }
      v.model.visible = v.isStructure ? !v.dead : true;
      if (v.mixer) {
        if (!v.dead) {
          const moving = (f & F.moving) !== 0 || (f & F.dashing) !== 0;
          const stunned = (f & (F.stunned | F.airborne)) !== 0;
          if (v.loop.startsWith('__once') && this.time < v.oneShotUntil && !moving) { /* keep playing */ }
          else if (v.loop.startsWith('__once') && this.time < v.oneShotUntil && moving && v.info.kind !== 'hero') { /* minions finish swings */ }
          else {
            const want = stunned ? 'Hit_B' : (f & F.dashing) ? 'Dodge_Forward' : moving ? (v.info.kind === 'minion' ? 'Walking_D_Skeletons' : 'Running_A') : (f & F.recalling) ? 'Spellcasting' : 'Idle';
            if (v.loop.startsWith('__once')) { const a = v.actions.get(v.loop.slice(7)); a?.fadeOut(0.1); v.loop = ''; }
            this.playLoop(v, v.actions.has(want) ? want : 'Running_A');
          }
          const run = v.actions.get(v.loop);
          if (run && (v.loop === 'Running_A' || v.loop === 'Walking_D_Skeletons')) run.timeScale = v.info.kind === 'minion' ? 1.4 : 1.1;
        }
        v.mixer.update(dt);
      }
      if (v.hpBar && v.hpFill && v.shieldFill) {
        v.hpBar.quaternion.copy(this.camera.quaternion);
        const hp = v.snap[6], max = Math.max(1, v.snap[7]), sh = v.snap[8];
        const total = Math.max(max, hp + sh);
        v.hpFill.scale.x = Math.max(0.001, hp / total);
        v.shieldFill.scale.x = Math.max(0.001, sh / total);
        v.shieldFill.position.x = v.hpFill.position.x + (hp / total) * (v.hpFill.userData.w as number);
        v.hpBar.visible = !v.dead && (hp < max || v.info.kind === 'hero' || v.isStructure || sh > 0);
      }
      if (v.ring) {
        const empowered = (f & F.empowered) !== 0;
        (v.ring.material as THREE.MeshBasicMaterial).opacity = empowered ? 0.6 + 0.4 * Math.sin(this.time * 12) : v.info.kind === 'hero' ? 0.85 : 0.45;
      }
      if ((f & F.stunned) && Math.random() < dt * 8) this.vfx.emit(v.pos.x, v.height + 0.3, v.pos.z, new THREE.Color('#ffe066'), { count: 1, speed: 1, up: 0.3, gravity: 0, life: 0.5, size: 0.4 });
      if ((f & F.slowed) && Math.random() < dt * 5) this.vfx.emit(v.pos.x, 0.4, v.pos.z, new THREE.Color('#9be7ff'), { count: 1, speed: 0.6, up: 0.5, life: 0.6, size: 0.4 });
      if ((f & F.recalling) && Math.random() < dt * 20) this.vfx.emit(v.pos.x, 0.2, v.pos.z, new THREE.Color('#7cb8ff'), { count: 1, speed: 1.2, up: 3, gravity: -1, life: 0.8, size: 0.5 });
    }
    for (const pv of this.projViews.values()) {
      pv.obj.position.lerp(pv.target, 1 - Math.exp(-dt * 20));
      if (pv.style === 'axe' || pv.style === 'hammer' || pv.style === 'dagger' || pv.style === 'shard') { pv.spin += dt * 18; pv.obj.children[0].rotation.x = pv.spin; }
      if (Math.random() < 0.6) this.vfx.emit(pv.obj.position.x, pv.obj.position.y, pv.obj.position.z, new THREE.Color(pv.obj.userData.color ?? '#ffffff'), { count: 1, speed: 0.3, up: 0.2, gravity: 0, life: 0.3, size: (pv.obj.userData.size ?? 1) * 0.6 });
    }
    for (const zv of this.zoneViews.values()) {
      (zv.inner.material as THREE.MeshBasicMaterial).opacity = 0.55 + 0.3 * Math.sin(this.time * 4);
      if (Math.random() < dt * zv.r * 6) {
        const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * zv.r;
        this.vfx.emit(zv.mesh.position.x + Math.cos(a) * r, 0.2, zv.mesh.position.z + Math.sin(a) * r, zv.color, { count: 1, speed: 0.3, up: 1.5, gravity: -0.5, life: 0.9, size: 0.6 });
      }
    }
    for (const b of this.bannerViews) if (b.flag) b.flag.rotation.y = Math.sin(this.time * 0.8 + b.group.position.x) * 0.15;
    if (this.moveMarker.t > 0) {
      this.moveMarker.t -= dt;
      this.moveMarker.mesh.scale.setScalar(1 + (0.5 - this.moveMarker.t) * 2);
      (this.moveMarker.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, this.moveMarker.t * 2);
      if (this.moveMarker.t <= 0) this.moveMarker.mesh.visible = false;
    }
    // day/night lighting
    this.nightT += (this.nightTarget - this.nightT) * Math.min(1, dt * 0.6);
    const n = this.nightT;
    this.sun.intensity = 2.2 - 1.5 * n;
    this.sun.color.setRGB(1, 0.95 - 0.25 * n, 0.87 - 0.1 * n);
    this.hemi.intensity = 1.1 - 0.5 * n;
    const sky = new THREE.Color('#9ec9e8').lerp(new THREE.Color('#1b2140'), n);
    (this.scene.background as THREE.Color).copy(sky);
    (this.scene.fog as THREE.Fog).color.copy(sky);

    this.fogTimer -= dt;
    if (this.fogTimer <= 0) { this.fogTimer = 0.1; this.drawFog(); }

    this.vfx.update(dt);
    // camera
    const off = new THREE.Vector3(0, this.camDist * 0.88, this.camDist * 0.47);
    this.camera.position.copy(this.camTarget).add(off);
    this.camera.lookAt(this.camTarget);
    this.sun.position.set(this.camTarget.x - 30, 60, this.camTarget.z + 25);
    this.sun.target.position.copy(this.camTarget);
    this.renderer.render(this.scene, this.camera);
  }

  /** Ground point under the cursor (NDC coordinates). */
  pick(ndcX: number, ndcY: number): THREE.Vector3 | null {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    const p = new THREE.Vector3();
    return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), p) ? p : null;
  }

  /** Unit under the cursor: nearest to the ray among characters (uses a vertical capsule approximation). */
  pickUnit(ndcX: number, ndcY: number, filter: (v: UnitView) => boolean): UnitView | null {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    let best: UnitView | null = null, bd = Infinity;
    for (const v of this.units.values()) {
      if (v.dead || !filter(v)) continue;
      const r = v.isStructure ? (v.info.towerKind === 'fortress' ? 6 : 2) : 0.9 * Math.max(1, v.info.scale);
      const c = new THREE.Vector3(v.pos.x, v.height * 0.5, v.pos.z);
      const d = ray.ray.distanceToPoint(c);
      if (d < r + v.height * 0.35 && d < bd) { bd = d; best = v; }
    }
    return best;
  }

  screenOf(v: THREE.Vector3): { x: number; y: number; visible: boolean } {
    const p = v.clone().project(this.camera);
    return { x: (p.x + 1) / 2 * window.innerWidth, y: (1 - p.y) / 2 * window.innerHeight, visible: p.z < 1 && p.x > -1.2 && p.x < 1.2 && p.y > -1.2 && p.y < 1.2 };
  }

  dispose() {
    this.renderer.dispose();
  }
}

function setGhost(o: THREE.Object3D, on: boolean) {
  o.traverse((c) => {
    const mesh = c as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (on) {
      mesh.userData.solid = mesh.material;
      const m = (mesh.material as THREE.Material).clone();
      m.transparent = true;
      m.opacity = 0.35;
      mesh.material = m;
    } else if (mesh.userData.solid) {
      (mesh.material as THREE.Material).dispose();
      mesh.material = mesh.userData.solid;
      delete mesh.userData.solid;
    }
  });
}

function emojiTexture(e: string): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.font = '48px serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(e, 32, 36);
  return new THREE.CanvasTexture(c);
}

function makeProjectile(style: string, color: string, size: number): THREE.Object3D {
  const g = new THREE.Group();
  const c = new THREE.Color(color);
  const mat = new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.8, roughness: 0.4 });
  let mesh: THREE.Mesh;
  switch (style) {
    case 'arrow': case 'spear': {
      const geo = new THREE.CylinderGeometry(0.04 * size, 0.04 * size, style === 'spear' ? 2.2 : 1.1, 6);
      geo.rotateX(Math.PI / 2);
      mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: '#d9c7a1' }));
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.1 * size, 0.3, 6).rotateX(Math.PI / 2), mat);
      tip.position.z = style === 'spear' ? 1.2 : 0.6;
      mesh.add(tip);
      break;
    }
    case 'axe': case 'hammer': mesh = new THREE.Mesh(new THREE.BoxGeometry(0.5 * size, 0.15 * size, 0.7 * size), mat); break;
    case 'dagger': mesh = new THREE.Mesh(new THREE.BoxGeometry(0.1 * size, 0.06, 0.7 * size), mat); break;
    case 'shard': mesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.35 * size), mat); break;
    case 'wave': mesh = new THREE.Mesh(new THREE.TorusGeometry(1.2 * size, 0.15, 6, 16, Math.PI), mat); mesh.rotation.x = Math.PI / 2; break;
    case 'skull': mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.3 * size, 0), mat); break;
    default: mesh = new THREE.Mesh(new THREE.SphereGeometry(0.3 * size, 12, 8), mat);
  }
  g.add(mesh);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, color: c, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  glow.scale.setScalar(1.6 * size);
  g.add(glow);
  g.userData.color = color;
  g.userData.size = size;
  return g;
}
