import * as THREE from 'three';
import type { FrontlineSnap } from '../../shared/protocol';
import { FL, FL_BANNERS, FL_NODES, FL_PLOTS, PLAYER_COLORS, PLAYER_HEX, fortressPos } from '../../shared/frontline/data';
import { TEAM_COLORS } from '../../shared/constants';
import { rng } from '../../shared/math';
import { assets } from '../assets';
import { GLOW, type Vfx } from './vfx';

const PX = 10; // ground texture pixels per world unit
const GROUND = { minX: -150, maxX: 150, minZ: -90, maxZ: 40 };

/** Static scenery and map features for the Frontline side-view lane. */
export class FrontDressing {
  private bannerViews: { group: THREE.Group; flag: THREE.Object3D | null; owner: number; ring: THREE.Mesh; progress: THREE.Mesh }[] = [];
  private plotRings: THREE.Mesh[] = [];
  private crystals: THREE.Object3D[] = [];
  private time = 0;

  constructor(private scene: THREE.Scene, private vfx: Vfx, private myTeam: number, private mySlot: number) {
    this.ground();
    this.backdrop();
    this.veins();
    this.plots();
    this.banners();
  }

  setSlot(slot: number) { this.mySlot = slot; }

  private ground() {
    const W = (GROUND.maxX - GROUND.minX) * PX / 2, H = (GROUND.maxZ - GROUND.minZ) * PX / 2;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d')!;
    const R = rng(21);
    const k = PX / 2;
    const px = (x: number) => (x - GROUND.minX) * k, pz = (z: number) => (z - GROUND.minZ) * k;
    // meadow
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#4f7d33'); sky.addColorStop(0.55, '#6a9a3f'); sky.addColorStop(1, '#5d8c37');
    g.fillStyle = sky; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 3500; i++) {
      g.fillStyle = `rgba(${50 + R() * 50},${100 + R() * 60},${30 + R() * 30},${0.06 + R() * 0.12})`;
      g.beginPath(); g.arc(R() * W, R() * H, 3 + R() * 22, 0, Math.PI * 2); g.fill();
    }
    // the lane: packed dirt road with worn edges
    const z0 = pz(FL.laneMinZ - 1), z1 = pz(FL.laneMaxZ + 1);
    const road = g.createLinearGradient(0, z0, 0, z1);
    road.addColorStop(0, 'rgba(150,118,72,0)'); road.addColorStop(0.08, '#a8875a'); road.addColorStop(0.5, '#c2a171'); road.addColorStop(0.92, '#a8875a'); road.addColorStop(1, 'rgba(150,118,72,0)');
    g.fillStyle = road; g.fillRect(px(FL.minX - 4), z0, px(FL.maxX + 4) - px(FL.minX - 4), z1 - z0);
    for (let i = 0; i < 1600; i++) {
      const x = px(FL.minX) + R() * (px(FL.maxX) - px(FL.minX)), y = z0 + R() * (z1 - z0);
      g.fillStyle = `rgba(${90 + R() * 40},${70 + R() * 30},${40 + R() * 20},${0.15 + R() * 0.25})`;
      g.fillRect(x, y, 1 + R() * 4, 1 + R() * 3);
    }
    // wheel ruts
    g.strokeStyle = 'rgba(110,85,50,0.35)'; g.lineWidth = 3;
    for (const z of [-2.5, 3.5]) { g.beginPath(); g.moveTo(px(FL.minX), pz(z)); for (let x = FL.minX; x <= FL.maxX; x += 4) g.lineTo(px(x), pz(z + Math.sin(x * 0.13) * 0.4)); g.stroke(); }
    // keep courtyards (cobblestone)
    for (const team of [0, 1] as const) {
      const f = fortressPos(team);
      const x0 = team === 0 ? FL.minX - 10 : 40, x1 = team === 0 ? -40 : FL.maxX + 10;
      const grad = g.createLinearGradient(px(team === 0 ? -40 : 40), 0, px(team === 0 ? -48 : 48), 0);
      grad.addColorStop(0, 'rgba(160,150,130,0)'); grad.addColorStop(1, 'rgba(160,150,130,0.85)');
      g.fillStyle = grad;
      g.fillRect(px(x0), pz(-26), px(x1) - px(x0), pz(-9) - pz(-26));
      g.strokeStyle = 'rgba(80,72,60,0.25)'; g.lineWidth = 1;
      for (let x = Math.min(x0, x1); x < Math.max(x0, x1); x += 1.6) for (let z = -26; z < -9; z += 1.2) g.strokeRect(px(x + ((z * 5) % 1.6)), pz(z), 1.6 * k, 1.2 * k);
      g.fillStyle = team === 0 ? 'rgba(61,139,253,0.25)' : 'rgba(229,72,77,0.25)';
      g.beginPath(); g.arc(px(f.x), pz(f.z), 9 * k, 0, Math.PI * 2); g.fill();
    }
    // rocky ground around gold veins
    for (const n of FL_NODES) {
      const grad = g.createRadialGradient(px(n.x), pz(n.z), 0, px(n.x), pz(n.z), (n.rich ? 6 : 4.5) * k);
      grad.addColorStop(0, 'rgba(120,105,80,0.9)'); grad.addColorStop(1, 'rgba(120,105,80,0)');
      g.fillStyle = grad; g.beginPath(); g.arc(px(n.x), pz(n.z), (n.rich ? 6 : 4.5) * k, 0, Math.PI * 2); g.fill();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(GROUND.maxX - GROUND.minX, GROUND.maxZ - GROUND.minZ), new THREE.MeshStandardMaterial({ map: tex, roughness: 1 }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set((GROUND.minX + GROUND.maxX) / 2, 0, (GROUND.minZ + GROUND.maxZ) / 2);
    mesh.receiveShadow = true;
    this.scene.add(mesh);
  }

  private place(name: string, x: number, z: number, width: number, rot = 0, y = 0) {
    const o = assets.envModel(name, width);
    o.position.set(x, y, z);
    o.rotation.y = rot;
    this.scene.add(o);
    return o;
  }

  private backdrop() {
    const R = rng(5);
    const trees = ['trees_A_large', 'trees_B_large', 'trees_A_medium', 'trees_B_medium', 'tree_single_A', 'tree_single_B'];
    // forest rows behind the bases (depth gives the HD-2D parallax feel as the camera pans)
    for (let row = 0; row < 4; row++) {
      const z = -32 - row * 9;
      for (let x = GROUND.minX + 4; x < GROUND.maxX - 4; x += 5 + R() * 4) {
        if (row === 0 && Math.abs(x) > 40 && Math.abs(x) < 100) continue; // keep the base backdrop open behind the plots
        this.place(trees[Math.floor(R() * trees.length)], x + R() * 2, z + R() * 4, 5 + R() * 5 + row, R() * 6);
      }
    }
    // distant cliffs
    for (let x = GROUND.minX; x < GROUND.maxX; x += 14 + R() * 10) this.place(['rock_single_A', 'rock_single_C', 'rock_single_B'][Math.floor(R() * 3)], x, -75 - R() * 8, 16 + R() * 14, R() * 6);
    // middle-ground dressing between the lane and the plots (low, never hiding units)
    for (let x = -38; x <= 38; x += 7 + R() * 5) {
      if (FL_BANNERS.some((b) => Math.abs(b.x - x) < 6)) continue;
      this.place(['rock_single_E', 'rock_single_D', 'tree_single_B', 'barrel', 'crate_open'][Math.floor(R() * 5)], x, -14 - R() * 8, 1.5 + R() * 2, R() * 6);
    }
    // foreground: a few low bushes and rocks along the near edge
    for (let x = GROUND.minX + 10; x < GROUND.maxX - 10; x += 9 + R() * 8) {
      if (FL_NODES.some((n) => Math.abs(n.x - x) < 5)) continue;
      this.place(['rock_single_D', 'rock_single_E'][Math.floor(R() * 2)], x, 19 + R() * 6, 0.8 + R() * 1.0, R() * 6);
    }
    // keep surroundings: walls behind each castle, a tent camp and weapon racks
    for (const team of [0, 1] as const) {
      const s = team === 0 ? -1 : 1;
      for (let z = -24; z <= 12; z += 4.5) this.place('wall_straight', s * (FL.maxX - 1), z, 4.6, Math.PI / 2);
      this.place('weaponrack', s * 90, -12, 2, s > 0 ? Math.PI : 0);
      this.place('tent', s * 92, -22, 4, s > 0 ? -Math.PI / 2 : Math.PI / 2);
      this.place('bucket_arrows', s * 88, -10, 1.1);
    }
  }

  private veins() {
    const goldMat = new THREE.MeshStandardMaterial({ color: '#ffcf4d', emissive: '#c48a00', emissiveIntensity: 0.6, metalness: 0.6, roughness: 0.3 });
    const R = rng(9);
    for (const n of FL_NODES) {
      const group = new THREE.Group();
      group.position.set(n.x, 0, n.z);
      const rock = assets.envModel(n.rich ? 'rock_single_C' : 'rock_single_B', n.rich ? 4.2 : 3.2);
      group.add(rock);
      const count = n.rich ? 9 : 5;
      for (let i = 0; i < count; i++) {
        const c = new THREE.Mesh(new THREE.OctahedronGeometry(0.25 + R() * (n.rich ? 0.45 : 0.3)), goldMat);
        const a = R() * Math.PI * 2, r = 0.6 + R() * (n.rich ? 1.6 : 1.1);
        c.position.set(Math.cos(a) * r, 0.4 + R() * (n.rich ? 1.6 : 1.1), Math.sin(a) * r * 0.6 + 0.5);
        c.rotation.set(R(), R(), R());
        c.scale.y = 1.6;
        c.castShadow = true;
        group.add(c);
      }
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, color: '#ffd166', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: n.rich ? 0.7 : 0.45 }));
      glow.scale.setScalar(n.rich ? 6 : 4);
      glow.position.y = 1.2;
      group.add(glow);
      this.scene.add(group);
      this.crystals.push(group);
    }
  }

  private plots() {
    for (const p of FL_PLOTS) {
      const slab = new THREE.Mesh(new THREE.CylinderGeometry(2.9, 3.1, 0.25, 6), new THREE.MeshStandardMaterial({ color: '#9d9483', roughness: 0.9 }));
      slab.position.set(p.x, 0.12, p.z);
      slab.receiveShadow = true;
      this.scene.add(slab);
      const color = PLAYER_HEX[PLAYER_COLORS[p.team][p.slot]];
      const ring = new THREE.Mesh(new THREE.RingGeometry(2.7, 3.05, 6), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2;
      ring.rotation.z = Math.PI / 6;
      ring.position.set(p.x, 0.27, p.z);
      this.scene.add(ring);
      this.plotRings.push(ring);
    }
  }

  private banners() {
    for (const b of FL_BANNERS) {
      const group = new THREE.Group();
      group.position.set(b.x, 0, b.z);
      const ring = new THREE.Mesh(new THREE.RingGeometry(FL.bannerRadius - 0.25, FL.bannerRadius, 64), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.08;
      const progress = new THREE.Mesh(new THREE.RingGeometry(FL.bannerRadius - 0.9, FL.bannerRadius - 0.3, 64, 1, 0, 0.001), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }));
      progress.rotation.x = -Math.PI / 2;
      progress.position.y = 0.09;
      const base = assets.envModel('building_stage_A', 3.6);
      base.scale.y *= 0.45;
      group.add(ring, progress, base);
      this.scene.add(group);
      const v = { group, flag: null as THREE.Object3D | null, owner: -2, ring, progress };
      this.bannerViews.push(v);
      this.setOwner(v, b.startOwner);
    }
  }

  private setOwner(v: FrontDressing['bannerViews'][number], owner: number) {
    if (v.owner === owner) return;
    v.owner = owner;
    if (v.flag) v.group.remove(v.flag);
    const f = assets.envModel(owner === 0 ? 'flag_blue' : owner === 1 ? 'flag_red' : 'flag_green');
    f.scale.multiplyScalar(3.6);
    f.position.y = 0.5;
    if (owner < 0) f.traverse((o) => { const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined; if (m && (o as THREE.Mesh).isMesh) { (o as THREE.Mesh).material = m.clone(); ((o as THREE.Mesh).material as THREE.MeshStandardMaterial).color.set('#dddddd'); } });
    v.group.add(f);
    v.flag = f;
    (v.ring.material as THREE.MeshBasicMaterial).color.set(owner >= 0 ? TEAM_COLORS[owner] : '#ffffff');
  }

  apply(fl: FrontlineSnap) {
    fl.banners.forEach((b, i) => {
      const v = this.bannerViews[i];
      if (!v) return;
      this.setOwner(v, b[1]);
      v.progress.geometry.dispose();
      v.progress.geometry = new THREE.RingGeometry(FL.bannerRadius - 0.9, FL.bannerRadius - 0.3, 64, 1, Math.PI / 2, Math.max(0.001, b[2] * Math.PI * 2));
      (v.progress.material as THREE.MeshBasicMaterial).color.set(b[3] >= 0 ? TEAM_COLORS[b[3]] : '#ffffff');
    });
    // rings show which empty plots are yours to build on
    fl.plots.forEach(([i, owner]) => {
      const p = FL_PLOTS[i], ring = this.plotRings[i];
      if (!ring) return;
      const mine = p.team === this.myTeam && p.slot === this.mySlot;
      ring.visible = !owner;
      (ring.material as THREE.MeshBasicMaterial).opacity = mine ? 0.9 : 0.25;
    });
  }

  update(dt: number) {
    this.time += dt;
    for (const b of this.bannerViews) if (b.flag) b.flag.rotation.y = Math.sin(this.time * 0.8 + b.group.position.x) * 0.15;
    for (const r of this.plotRings) if (r.visible) (r.material as THREE.MeshBasicMaterial).color.offsetHSL(0, 0, 0);
    // sparkles over the veins
    for (const g of this.crystals) if (Math.random() < dt * 3) {
      this.vfx.emit(g.position.x + (Math.random() - 0.5) * 3, 0.8 + Math.random() * 1.5, g.position.z + (Math.random() - 0.5) * 2, new THREE.Color('#ffe08a'), { count: 1, speed: 0.2, up: 0.6, gravity: 0, life: 0.9, size: 0.35 });
    }
  }
}
