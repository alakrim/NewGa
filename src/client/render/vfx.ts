import * as THREE from 'three';

// Lightweight effects: a pooled additive particle system plus short-lived ground decals.

const MAX_PARTICLES = 4000;

function glowTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.6)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
export const GLOW = glowTexture();

function ringTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 40, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,0.0)');
  grad.addColorStop(0.75, 'rgba(255,255,255,0.35)');
  grad.addColorStop(0.92, 'rgba(255,255,255,1)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}
export const RING = ringTexture();

interface Decal { mesh: THREE.Mesh; t: number; life: number; grow: number; baseScale: number; fill?: THREE.Mesh; delay?: number }

export class Vfx {
  private geom = new THREE.BufferGeometry();
  private pos = new Float32Array(MAX_PARTICLES * 3);
  private col = new Float32Array(MAX_PARTICLES * 3);
  private size = new Float32Array(MAX_PARTICLES);
  private vel = new Float32Array(MAX_PARTICLES * 3);
  private life = new Float32Array(MAX_PARTICLES);
  private maxLife = new Float32Array(MAX_PARTICLES);
  private baseSize = new Float32Array(MAX_PARTICLES);
  private gravity = new Float32Array(MAX_PARTICLES);
  private cursor = 0;
  private decals: Decal[] = [];
  private lines: { line: THREE.Line; t: number }[] = [];
  readonly points: THREE.Points;

  constructor(private scene: THREE.Scene) {
    this.geom.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geom.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.geom.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: GLOW }, scale: { value: window.innerHeight / 2 } },
      vertexShader: `attribute float size; attribute vec3 color; varying vec3 vColor; uniform float scale;
        void main(){ vColor=color; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_PointSize=size*scale/-mv.z; gl_Position=projectionMatrix*mv; }`,
      fragmentShader: `uniform sampler2D map; varying vec3 vColor;
        void main(){ vec4 t=texture2D(map, gl_PointCoord); if(t.a<0.02) discard; gl_FragColor=vec4(vColor*t.a, t.a); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(this.geom, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
    scene.add(this.points);
  }

  emit(x: number, y: number, z: number, color: THREE.Color, opts: { count?: number; speed?: number; up?: number; life?: number; size?: number; spread?: number; gravity?: number } = {}) {
    const n = opts.count ?? 12;
    for (let i = 0; i < n; i++) {
      const k = this.cursor;
      this.cursor = (this.cursor + 1) % MAX_PARTICLES;
      const a = Math.random() * Math.PI * 2;
      const sp = (opts.speed ?? 3) * (0.4 + Math.random() * 0.6);
      const spread = opts.spread ?? 0.3;
      this.pos[k * 3] = x + (Math.random() - 0.5) * spread;
      this.pos[k * 3 + 1] = y + Math.random() * spread;
      this.pos[k * 3 + 2] = z + (Math.random() - 0.5) * spread;
      this.vel[k * 3] = Math.cos(a) * sp;
      this.vel[k * 3 + 1] = (opts.up ?? 2) * (0.5 + Math.random());
      this.vel[k * 3 + 2] = Math.sin(a) * sp;
      const l = (opts.life ?? 0.7) * (0.6 + Math.random() * 0.6);
      this.life[k] = l; this.maxLife[k] = l;
      this.baseSize[k] = (opts.size ?? 0.6) * (0.6 + Math.random() * 0.8);
      this.gravity[k] = opts.gravity ?? 4;
      const v = 0.8 + Math.random() * 0.4;
      this.col[k * 3] = color.r * v; this.col[k * 3 + 1] = color.g * v; this.col[k * 3 + 2] = color.b * v;
    }
  }

  /** Ground effect for an ability: shape outline + fill flash + particles. */
  burst(style: string, color: string, x: number, z: number, r: number, shape: 'circle' | 'cone' | 'rect' = 'circle', dx = 0, dz = 1, angle = 60, w = 2, delay = 0) {
    const c = new THREE.Color(color);
    let geo: THREE.BufferGeometry;
    const rot = Math.atan2(dx, dz);
    if (shape === 'cone') geo = new THREE.CircleGeometry(r, 32, -THREE.MathUtils.degToRad(angle) / 2, THREE.MathUtils.degToRad(angle));
    else if (shape === 'rect') { geo = new THREE.PlaneGeometry(w, r); geo.translate(0, r / 2, 0); }
    else geo = new THREE.CircleGeometry(r, 48);
    const telegraph = delay > 0;
    const mat = new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: telegraph ? 0.18 : 0.45, depthWrite: false, blending: THREE.AdditiveBlending, map: shape === 'circle' ? RING : null, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    // circle geometry starts at +x; rotate so 0 rad points along aim
    const g = new THREE.Group();
    g.position.set(x, 0.08, z);
    g.rotation.y = rot;
    mesh.rotation.z = shape === 'cone' ? -Math.PI / 2 : 0;
    if (shape === 'rect') mesh.rotation.z = Math.PI;
    g.add(mesh);
    this.scene.add(g);
    const decal: Decal = { mesh: mesh, t: 0, life: telegraph ? delay : 0.55, grow: telegraph ? 0 : 0.15, baseScale: 1, delay };
    (decal as unknown as { group: THREE.Group }).group = g;
    if (telegraph) {
      const fill = new THREE.Mesh(geo.clone(), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide }));
      fill.rotation.copy(mesh.rotation);
      fill.scale.setScalar(0.01);
      g.add(fill);
      decal.fill = fill;
    }
    this.decals.push(decal);
    if (telegraph) return;
    const area = shape === 'circle' ? r * r : r * (shape === 'cone' ? r * 0.5 : w);
    const count = Math.min(80, 10 + Math.floor(area * 2));
    const pal: Record<string, { up: number; speed: number; gravity: number; size: number; life: number }> = {
      fire: { up: 4, speed: 2, gravity: -1, size: 0.9, life: 0.8 }, frost: { up: 1, speed: 3, gravity: 2, size: 0.6, life: 1 },
      lightning: { up: 6, speed: 5, gravity: 6, size: 0.4, life: 0.4 }, holy: { up: 5, speed: 1, gravity: -2, size: 0.7, life: 1.1 },
      shadow: { up: 2, speed: 1.5, gravity: -1, size: 1, life: 1 }, poison: { up: 1.5, speed: 1.5, gravity: -0.5, size: 0.9, life: 1.2 },
      earth: { up: 6, speed: 4, gravity: 12, size: 0.7, life: 0.7 }, blood: { up: 3, speed: 4, gravity: 10, size: 0.5, life: 0.6 },
      wind: { up: 1, speed: 7, gravity: 0, size: 0.5, life: 0.5 }, smoke: { up: 1, speed: 1.5, gravity: -0.5, size: 1.4, life: 1 },
    };
    const p = pal[style] ?? { up: 3, speed: 3, gravity: 4, size: 0.6, life: 0.7 };
    for (let i = 0; i < count; i++) {
      // sample a point inside the shape
      let px: number, pz: number;
      if (shape === 'circle') { const a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * r; px = Math.cos(a) * rr; pz = Math.sin(a) * rr; }
      else if (shape === 'cone') { const a = rot + (Math.random() - 0.5) * THREE.MathUtils.degToRad(angle), rr = Math.sqrt(Math.random()) * r; px = Math.sin(a) * rr; pz = Math.cos(a) * rr; }
      else { const along = Math.random() * r, across = (Math.random() - 0.5) * w; px = Math.sin(rot) * along + Math.cos(rot) * across; pz = Math.cos(rot) * along - Math.sin(rot) * across; }
      this.emit(x + px, 0.3, z + pz, c, { count: 1, ...p });
    }
  }

  chain(pts: number[], color: string) {
    const c = new THREE.Color(color);
    const v: THREE.Vector3[] = [];
    for (let i = 0; i + 1 < pts.length; i += 2) v.push(new THREE.Vector3(pts[i], 1.4, pts[i + 1]));
    const jag: THREE.Vector3[] = [];
    for (let i = 0; i < v.length - 1; i++) {
      for (let s = 0; s < 6; s++) {
        const p = v[i].clone().lerp(v[i + 1], s / 6);
        if (s) p.add(new THREE.Vector3((Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.6));
        jag.push(p);
      }
      this.emit(v[i + 1].x, 1.4, v[i + 1].z, c, { count: 8, speed: 3, life: 0.4 });
    }
    jag.push(v[v.length - 1]);
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(jag), new THREE.LineBasicMaterial({ color: c, transparent: true, blending: THREE.AdditiveBlending }));
    this.scene.add(line);
    this.lines.push({ line, t: 0.35 });
  }

  update(dt: number) {
    for (let k = 0; k < MAX_PARTICLES; k++) {
      if (this.life[k] <= 0) { this.size[k] = 0; continue; }
      this.life[k] -= dt;
      this.vel[k * 3 + 1] -= this.gravity[k] * dt;
      this.pos[k * 3] += this.vel[k * 3] * dt;
      this.pos[k * 3 + 1] = Math.max(0.05, this.pos[k * 3 + 1] + this.vel[k * 3 + 1] * dt);
      this.pos[k * 3 + 2] += this.vel[k * 3 + 2] * dt;
      const f = this.life[k] / this.maxLife[k];
      this.size[k] = this.baseSize[k] * (f < 0.3 ? f / 0.3 : 1);
    }
    (this.geom.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geom.attributes.size as THREE.BufferAttribute).needsUpdate = true;
    (this.geom.attributes.color as THREE.BufferAttribute).needsUpdate = true;

    for (const d of this.decals) {
      d.t += dt;
      const f = d.t / d.life;
      const mat = d.mesh.material as THREE.MeshBasicMaterial;
      if (d.fill) {
        d.fill.scale.setScalar(Math.min(1, f));
        mat.opacity = 0.25 + 0.15 * Math.sin(d.t * 12);
      } else {
        d.mesh.scale.setScalar(1 + d.grow * f);
        mat.opacity = 0.5 * (1 - f);
      }
    }
    this.decals = this.decals.filter((d) => {
      if (d.t < d.life) return true;
      const g = (d as unknown as { group: THREE.Group }).group;
      this.scene.remove(g);
      d.mesh.geometry.dispose();
      (d.mesh.material as THREE.Material).dispose();
      if (d.fill) { d.fill.geometry.dispose(); (d.fill.material as THREE.Material).dispose(); }
      return false;
    });
    for (const l of this.lines) {
      l.t -= dt;
      (l.line.material as THREE.LineBasicMaterial).opacity = Math.max(0, l.t / 0.35);
    }
    this.lines = this.lines.filter((l) => {
      if (l.t > 0) return true;
      this.scene.remove(l.line);
      l.line.geometry.dispose();
      return false;
    });
  }
}
