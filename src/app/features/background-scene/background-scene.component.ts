import {
  AfterViewInit,
  Component,
  ElementRef,
  NgZone,
  OnDestroy,
  ViewChild
} from '@angular/core';

import * as THREE from 'three';

/**
 * Ambient 3D backdrop for the whole page.
 *
 * A fixed, transparent canvas sits behind the page shell and renders:
 *  - a slow field of glowing depth-sorted particles (single draw call),
 *  - a few large soft light orbs drifting on their own orbits.
 *
 * The camera answers to the pointer (subtle) and the page scroll (parallax),
 * so the backdrop reads as a deep volume rather than a flat texture.
 */
@Component({
  selector: 'app-background-scene',
  standalone: true,
  templateUrl: './background-scene.component.html',
  styleUrl: './background-scene.component.scss'
})
export class BackgroundSceneComponent implements AfterViewInit, OnDestroy {

  @ViewChild('canvasContainer', { static: true })
  canvasContainer!: ElementRef<HTMLDivElement>;

  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private renderer!: THREE.WebGLRenderer;
  private particleMaterial?: THREE.ShaderMaterial;

  private glowTexture?: THREE.CanvasTexture;

  private animationId = 0;
  private lastFrameTime = 0;
  private resizeObserver?: ResizeObserver;
  private reducedMotionQuery?: MediaQueryList;
  private disabled = false;
  private reducedMotion = false;

  private pointerX = 0;
  private pointerY = 0;
  private currentPointerX = 0;
  private currentPointerY = 0;
  private scrollUnits = 0;
  private currentScroll = 0;

  /** Positions/orbits of the soft glow orbs, kept next to the mesh list. */
  private orbParams: Array<{ x: number; y: number; z: number; scale: number; phase: number }> = [];

  private onPointerMove = (event: PointerEvent): void => {
    this.pointerX = (event.clientX / window.innerWidth) * 2 - 1;
    this.pointerY = (event.clientY / window.innerHeight) * 2 - 1;
  };

  private onPointerLeave = (): void => {
    this.pointerX = 0;
    this.pointerY = 0;
  };

  private onScroll = (): void => {
    this.scrollUnits = window.scrollY / Math.max(1, window.innerHeight);
  };

  private onReducedMotionChange = (event: MediaQueryListEvent): void => {
    this.reducedMotion = event.matches;
  };

  private onVisibilityChange = (): void => {
    if (document.hidden) {
      this.stopLoop();
    } else {
      this.startLoop();
    }
  };

  constructor(private ngZone: NgZone) {}

  ngAfterViewInit(): void {
    try {
      this.initScene();
    } catch {
      // WebGL is unavailable (e.g. jsdom test environment): disable the
      // scene gracefully instead of throwing.
      this.disabled = true;
      return;
    }
    this.createParticleField();
    this.createGlowOrbs();
    this.setupResize();

    if (typeof window.matchMedia === 'function') {
      this.reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
      this.reducedMotion = this.reducedMotionQuery.matches;
      this.reducedMotionQuery.addEventListener('change', this.onReducedMotionChange);
    }

    window.addEventListener('pointermove', this.onPointerMove, { passive: true });
    window.addEventListener('pointerleave', this.onPointerLeave, { passive: true });
    window.addEventListener('blur', this.onPointerLeave);
    window.addEventListener('scroll', this.onScroll, { passive: true });
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    this.onScroll();

    this.ngZone.runOutsideAngular(() => this.startLoop());
  }

  // ---------------------------------------------------------------- scene

  private initScene(): void {
    const container = this.canvasContainer.nativeElement;
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);

    this.scene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(55, width / height, 0.1, 60);
    this.camera.position.set(0, 0, 9);

    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      alpha: true,
      powerPreference: 'low-power'
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.setSize(width, height);
    this.renderer.setClearColor(0x000000, 0);

    container.appendChild(this.renderer.domElement);
  }

  // ---------------------------------------------------------------- particles

  private createParticleField(): void {
    const mobile = window.innerWidth < 768;
    const count = mobile ? 240 : 560;

    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const seeds = new Float32Array(count);

    // Palette: mostly cool cyan/steel dust, a few ice whites and rare warm
    // gold flecks that echo the iris rim light.
    const palette = [
      { colour: new THREE.Color(0x67e8f9), weight: 0.42 },
      { colour: new THREE.Color(0x7dd3fc), weight: 0.22 },
      { colour: new THREE.Color(0x4c6ef5), weight: 0.14 },
      { colour: new THREE.Color(0xeaf7ff), weight: 0.12 },
      { colour: new THREE.Color(0x2dd4bf), weight: 0.08 },
      { colour: new THREE.Color(0xf6b352), weight: 0.02 }
    ];
    const pickColour = (): THREE.Color => {
      let roll = Math.random();
      for (const entry of palette) {
        roll -= entry.weight;
        if (roll <= 0) {
          return entry.colour;
        }
      }
      return palette[0].colour;
    };

    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() * 2 - 1) * 13.5;
      positions[i * 3 + 1] = (Math.random() * 2 - 1) * 17;
      positions[i * 3 + 2] = -16 + Math.random() * 19;

      const colour = pickColour();
      const tint = 0.55 + Math.random() * 0.45;
      colors[i * 3] = colour.r * tint;
      colors[i * 3 + 1] = colour.g * tint;
      colors[i * 3 + 2] = colour.b * tint;

      sizes[i] = 0.9 + Math.pow(Math.random(), 2.2) * 2.4;
      seeds[i] = Math.random();
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uPixelRatio: { value: this.renderer.getPixelRatio() }
      },
      vertexShader: /* glsl */`
        uniform float uTime;
        uniform float uPixelRatio;

        attribute float aSize;
        attribute float aSeed;
        attribute vec3 aColor;

        varying vec3 vColor;
        varying float vAlpha;

        void main() {
          vec3 pos = position;

          // Slow, bounded organic drift. Every particle follows its own
          // orbit so the field never moves as one block.
          float speed = 0.4 + aSeed * 0.9;
          float phase = aSeed * 43.7;
          pos.x += sin(uTime * 0.11 * speed + phase) * 0.75;
          pos.y += cos(uTime * 0.085 * speed + phase * 1.31) * 0.6;
          pos.z += sin(uTime * 0.06 * speed + phase * 0.73) * 0.4;

          vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
          gl_Position = projectionMatrix * mvPosition;

          float distance = -mvPosition.z;
          float pointSize = aSize * uPixelRatio * (16.0 / distance);
          gl_PointSize = clamp(pointSize, 1.2, 26.0);

          // Twinkle plus depth fades: distant dust dims out, anything that
          // drifts too close to the lens fades instead of popping.
          float twinkle = 0.5 + 0.5 * sin(uTime * (0.55 + aSeed * 1.4) + phase * 6.0);
          float fadeFar = smoothstep(-19.0, -11.0, pos.z);
          float fadeNear = 1.0 - smoothstep(2.5, 4.5, pos.z);
          vAlpha = (0.26 + 0.74 * twinkle) * mix(0.22, 1.0, fadeFar) * fadeNear;
          vColor = aColor;
        }
      `,
      fragmentShader: /* glsl */`
        precision mediump float;

        varying vec3 vColor;
        varying float vAlpha;

        void main() {
          vec2 uv = gl_PointCoord - 0.5;
          float d = length(uv);
          float alpha = smoothstep(0.5, 0.04, d);
          alpha *= alpha;
          if (alpha * vAlpha < 0.012) {
            discard;
          }
          gl_FragColor = vec4(vColor, alpha * vAlpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending
    });

    this.particleMaterial = material;

    const particles = new THREE.Points(geometry, material);
    particles.frustumCulled = false;
    this.scene.add(particles);
  }

  // ---------------------------------------------------------------- glow orbs

  private createGlowTexture(): THREE.CanvasTexture {
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;

    const gradient = ctx.createRadialGradient(
      size / 2, size / 2, 0, size / 2, size / 2, size / 2
    );
    gradient.addColorStop(0, 'rgba(255, 255, 255, 0.85)');
    gradient.addColorStop(0.25, 'rgba(255, 255, 255, 0.32)');
    gradient.addColorStop(0.55, 'rgba(255, 255, 255, 0.09)');
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);

    return new THREE.CanvasTexture(canvas);
  }

  private createGlowOrbs(): void {
    this.glowTexture = this.createGlowTexture();

    const specs: Array<{
      colour: number;
      opacity: number;
      x: number;
      y: number;
      z: number;
      scale: number;
      phase: number;
    }> = [
      { colour: 0x2dd4bf, opacity: 0.16, x: -5.2, y: 2.6, z: -5, scale: 7.5, phase: 0 },
      { colour: 0xff8c3a, opacity: 0.12, x: 5.6, y: -2.2, z: -7, scale: 6.5, phase: 2.1 },
      { colour: 0x6366f1, opacity: 0.13, x: 1.4, y: 4.2, z: -9, scale: 8.5, phase: 4.4 }
    ];

    for (const spec of specs) {
      const material = new THREE.SpriteMaterial({
        map: this.glowTexture,
        color: spec.colour,
        transparent: true,
        opacity: spec.opacity,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending
      });
      const orb = new THREE.Sprite(material);
      orb.scale.setScalar(spec.scale);
      orb.position.set(spec.x, spec.y, spec.z);
      this.scene.add(orb);

      this.orbParams.push({
        x: spec.x,
        y: spec.y,
        z: spec.z,
        scale: spec.scale,
        phase: spec.phase
      });
    }
  }

  // ---------------------------------------------------------------- animation

  private startLoop(): void {
    if (this.disabled || this.animationId !== 0) {
      return;
    }
    this.lastFrameTime = performance.now();

    if (this.reducedMotion) {
      // Static backdrop: render a single frame with frozen time.
      this.renderFrame(0);
      return;
    }

    this.animate();
  }

  private stopLoop(): void {
    if (this.animationId !== 0) {
      cancelAnimationFrame(this.animationId);
      this.animationId = 0;
    }
  }

  private renderFrame(seconds: number): void {
    if (this.particleMaterial) {
      this.particleMaterial.uniforms['uTime'].value = seconds;
    }
    this.updateOrbs(seconds, true);
    this.applyCamera(1);
    this.renderer.render(this.scene, this.camera);
  }

  private updateOrbs(seconds: number, staticPose = false): void {
    const orbs = this.scene.children.filter(
      (child): child is THREE.Sprite => child instanceof THREE.Sprite
    );
    orbs.forEach((orb, index) => {
      const params = this.orbParams[index];
      if (!params) {
        return;
      }
      const motion = staticPose ? 0 : 1;
      orb.position.x =
        params.x + Math.sin(seconds * 0.11 + params.phase) * 1.4 * motion;
      orb.position.y =
        params.y + Math.cos(seconds * 0.09 + params.phase * 1.7) * 1.1 * motion;
      const pulse = 1 + Math.sin(seconds * 0.23 + params.phase) * 0.07 * motion;
      orb.scale.setScalar(params.scale * pulse);
    });
  }

  /** Pointer + scroll parallax, written straight to the camera. */
  private applyCamera(damping: number): void {
    this.currentPointerX += (this.pointerX - this.currentPointerX) * damping;
    this.currentPointerY += (this.pointerY - this.currentPointerY) * damping;
    this.currentScroll += (this.scrollUnits - this.currentScroll) * damping;

    this.camera.position.x = this.currentPointerX * 0.42;
    this.camera.position.y = this.currentScroll * 0.6 - this.currentPointerY * 0.26;
  }

  private animate = (): void => {
    this.animationId = requestAnimationFrame(this.animate);

    const now = performance.now();
    const delta = Math.min((now - this.lastFrameTime) / 1000, 0.05);
    this.lastFrameTime = now;

    if (this.particleMaterial) {
      this.particleMaterial.uniforms['uTime'].value += delta;
      this.updateOrbs(this.particleMaterial.uniforms['uTime'].value as number);
    }
    this.applyCamera(1 - Math.exp(-delta * 3.4));

    this.renderer.render(this.scene, this.camera);
  };

  // ---------------------------------------------------------------- lifecycle

  private setupResize(): void {
    this.resizeObserver = new ResizeObserver(() => {
      const container = this.canvasContainer.nativeElement;
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (!width || !height) {
        return;
      }
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
      this.renderer.setSize(width, height);
      if (this.particleMaterial) {
        this.particleMaterial.uniforms['uPixelRatio'].value =
          this.renderer.getPixelRatio();
      }
      if (this.reducedMotion && this.animationId === 0) {
        this.renderFrame(0);
      }
    });
    this.resizeObserver.observe(this.canvasContainer.nativeElement);
  }

  ngOnDestroy(): void {
    this.stopLoop();
    this.resizeObserver?.disconnect();
    this.reducedMotionQuery?.removeEventListener('change', this.onReducedMotionChange);

    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerleave', this.onPointerLeave);
    window.removeEventListener('blur', this.onPointerLeave);
    window.removeEventListener('scroll', this.onScroll);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);

    if (this.scene) {
      this.scene.traverse((object) => {
        if (object instanceof THREE.Points || object instanceof THREE.Sprite) {
          if (object instanceof THREE.Points) {
            object.geometry.dispose();
          }
          (object.material as THREE.Material).dispose();
        }
      });
    }

    this.glowTexture?.dispose();

    this.renderer?.dispose();
    this.renderer?.forceContextLoss();
    this.renderer?.domElement?.remove();
  }
}
