import {
  AfterViewInit,
  Component,
  ElementRef,
  NgZone,
  OnDestroy,
  ViewChild
} from '@angular/core';

import * as THREE from 'three';

const IRIS_RADIUS = 0.2;
const PUPIL_RATIO = 0.15;
const EYE_RADIUS = 0.5;

/**
 * The hero uses a macro crop of the iris. The sclera is still modelled so the
 * scene can fall back to a full globe, but it stays hidden in this view.
 */
const MACRO_IRIS = true;

@Component({
  selector: 'app-eye-scene',
  standalone: true,
  templateUrl: './eye-scene.component.html',
  styleUrl: './eye-scene.component.scss'
})
export class EyeSceneComponent implements AfterViewInit, OnDestroy {

  @ViewChild('canvasContainer', { static: true })
  canvasContainer!: ElementRef<HTMLDivElement>;

  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private renderer!: THREE.WebGLRenderer;
  private eyeGroup!: THREE.Group;

  private animationId = 0;
  private resizeObserver?: ResizeObserver;
  private intersectionObserver?: IntersectionObserver;
  private reducedMotionQuery?: MediaQueryList;
  private isVisible = true;
  private reducedMotion = false;
  private disabled = false;

  private pointerX = 0;
  private pointerY = 0;
  private lastPointerMove = 0;
  private currentYaw = 0.58;
  private currentPitch = -0.12;
  private scrollProgress = 0;

  private irisUniforms?: {
    uIris: { value: number };
    uPupil: { value: number };
  };

  private scleraTexture?: THREE.CanvasTexture;
  private scleraRoughnessTexture?: THREE.CanvasTexture;
  private envRenderTarget?: THREE.WebGLRenderTarget;
  private pmrem?: THREE.PMREMGenerator;
  private clock = new THREE.Clock();

  private readonly baseYaw = 0.58;
  private readonly basePitch = -0.12;
  private readonly baseRoll = -0.055;

  private onScroll = (): void => {
    const span = Math.max(1, window.innerHeight * 0.9);
    this.scrollProgress = THREE.MathUtils.clamp(window.scrollY / span, 0, 1);
  };

  private onPointerMove = (event: PointerEvent): void => {
    this.pointerX = (event.clientX / window.innerWidth) * 2 - 1;
    this.pointerY = (event.clientY / window.innerHeight) * 2 - 1;
    this.lastPointerMove = performance.now();
  };

  private onPointerLeave = (): void => {
    this.pointerX = 0;
    this.pointerY = 0;
  };

  private onReducedMotionChange = (event: MediaQueryListEvent): void => {
    this.reducedMotion = event.matches;
  };

  private onVisibilityChange = (): void => {
    if (document.hidden) {
      this.stopLoop();
    } else if (this.isVisible) {
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
    this.createEye();
    if (!MACRO_IRIS) {
      this.addLighting();
    }
    this.setupResize();
    this.setupVisibility();

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

    this.camera = new THREE.PerspectiveCamera(35, width / height, 0.1, 50);
    this.camera.position.set(0, 0, MACRO_IRIS ? 1.3 : 2.85);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(width, height);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.9;
    this.renderer.setClearColor(0x000000, 0);

    container.appendChild(this.renderer.domElement);

    if (!MACRO_IRIS) {
      this.createStudioEnvironment();
    }

    this.eyeGroup = new THREE.Group();
    this.eyeGroup.rotation.order = 'YXZ';
    this.eyeGroup.rotation.y = this.baseYaw;
    this.eyeGroup.rotation.x = this.basePitch;
    this.eyeGroup.rotation.z = this.baseRoll;
    this.scene.add(this.eyeGroup);
  }

  /**
   * Small custom studio built only for reflections / image based lighting.
   * A large soft box upper-left, a cyan strip on the right and a dim warm
   * bounce low-left. PMREM turns it into a smooth environment map.
   */
  private createStudioEnvironment(): void {
    const envScene = new THREE.Scene();

    const addPanel = (
      width: number,
      height: number,
      color: number,
      intensity: number,
      position: [number, number, number],
      rotation: [number, number, number]
    ): void => {
      const geometry = new THREE.PlaneGeometry(width, height);
      const material = new THREE.MeshBasicMaterial({
        color,
        side: THREE.DoubleSide
      });
      material.color.multiplyScalar(intensity);
      const panel = new THREE.Mesh(geometry, material);
      panel.position.set(...position);
      panel.rotation.set(...rotation);
      envScene.add(panel);
    };

    // Key soft box, upper left and slightly in front of the eye.
    addPanel(2.6, 1.7, 0xffffff, 6.0, [-2.7, 2.3, 3.8], [0, -0.6, 0.2]);
    // Slender cool strip behind the right edge.
    addPanel(2.4, 0.36, 0x61dcff, 2.2, [4.0, 0.7, -1.5], [0, -Math.PI / 2, 0]);
    // Soft top light.
    addPanel(3.0, 0.9, 0xa8d8ff, 0.7, [0, 4.2, 0.6], [-Math.PI / 2, 0, 0]);
    // Faint warm bounce, lower left.
    addPanel(2.0, 1.2, 0xffc79a, 0.3, [-2.8, -2.6, 2.2], [0.2, 0.45, 0]);

    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    const target = this.pmrem.fromScene(envScene, 0.03);
    this.envRenderTarget = target;
    this.scene.environment = target.texture;

    envScene.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        (object.material as THREE.Material).dispose();
      }
    });
  }

  // ---------------------------------------------------------------- sclera texture

  private createScleraTexture(): THREE.CanvasTexture {
    const width = 2048;
    const height = 1024;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;

    // Front of the sphere is u = 0.25 on three.js' sphere UVs.
    const cx = width * 0.25;
    const cy = height * 0.5;
    const irisPixels = (IRIS_RADIUS / EYE_RADIUS) / (Math.PI * 2) * width;

    ctx.fillStyle = '#eae5dc';
    ctx.fillRect(0, 0, width, height);

    // Very low contrast organic mottling so the sclera isn't a flat white ball.
    for (let i = 0; i < 300; i++) {
      const x = Math.random() * width;
      const y = Math.random() * height;
      const radius = 24 + Math.random() * 150;
      const light = Math.random() > 0.45;
      const tint = light ? '255,251,243' : '196,184,170';
      const alpha = 0.018 + Math.random() * 0.035;
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
      gradient.addColorStop(0, `rgba(${tint},${alpha})`);
      gradient.addColorStop(1, `rgba(${tint},0)`);
      ctx.fillStyle = gradient;
      ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    }

    // Warm limbal shadow just outside the iris edge.
    const limbal = ctx.createRadialGradient(
      cx, cy, irisPixels * 0.82,
      cx, cy, irisPixels * 1.55
    );
    limbal.addColorStop(0, 'rgba(108,66,58,0.07)');
    limbal.addColorStop(0.38, 'rgba(100,54,48,0.28)');
    limbal.addColorStop(0.72, 'rgba(150,104,92,0.10)');
    limbal.addColorStop(1, 'rgba(150,104,92,0)');
    ctx.fillStyle = limbal;
    ctx.beginPath();
    ctx.arc(cx, cy, irisPixels * 1.55, 0, Math.PI * 2);
    ctx.fill();

    // Faint warmth towards the lateral canthi.
    for (const direction of [-1, 1]) {
      const warmX = cx + direction * irisPixels * 2.2;
      const canthus = ctx.createRadialGradient(
        warmX, cy, 20,
        warmX, cy, irisPixels * 2.4
      );
      canthus.addColorStop(0, 'rgba(186,126,112,0.032)');
      canthus.addColorStop(1, 'rgba(186,126,112,0)');
      ctx.fillStyle = canthus;
      ctx.fillRect(0, 0, width, height);
    }

    // Faint, smooth conjunctival vessels. Mostly horizontal and restrained.
    const drawVein = (
      x: number,
      y: number,
      angle: number,
      length: number,
      lineWidth: number,
      alpha: number
    ): void => {
      const steps = 5 + Math.floor(Math.random() * 4);
      let px = x;
      let py = y;
      let direction = angle;
      ctx.beginPath();
      ctx.moveTo(px, py);
      for (let s = 0; s < steps; s++) {
        const segment = length / steps;
        const nextDirection = direction + (Math.random() - 0.5) * 0.34;
        const nx = px + Math.cos(nextDirection) * segment;
        const ny = py + Math.sin(nextDirection) * segment;
        const midX = px + Math.cos((direction + nextDirection) / 2) * segment * 0.55;
        const midY = py + Math.sin((direction + nextDirection) / 2) * segment * 0.55;
        ctx.quadraticCurveTo(midX, midY, nx, ny);
        px = nx;
        py = ny;
        direction = nextDirection;
      }
      ctx.strokeStyle = `rgba(132,52,55,${alpha})`;
      ctx.lineWidth = lineWidth;
      ctx.lineCap = 'round';
      ctx.stroke();
    };

    for (let i = 0; i < 34; i++) {
      const horizontal = i < 24;
      const angle = horizontal
        ? (Math.random() > 0.5 ? 0 : Math.PI) + (Math.random() - 0.5) * 0.62
        : Math.random() * Math.PI * 2;
      const startRadius = irisPixels * (1.01 + Math.random() * 0.22);
      const x = cx + Math.cos(angle) * startRadius;
      const y = cy + Math.sin(angle) * startRadius;
      const length = 30 + Math.random() * (horizontal ? 180 : 90);
      const lineWidth = 0.45 + Math.random() * 1.35;
      const alpha = 0.045 + Math.random() * 0.085;
      drawVein(x, y, angle, length, lineWidth, alpha);

      // occasional short fork
      if (Math.random() > 0.42) {
        const forkAngle = angle + (Math.random() - 0.5) * 1.1;
        drawVein(
          x + Math.cos(angle) * length * 0.4,
          y + Math.sin(angle) * length * 0.4,
          forkAngle,
          length * (0.2 + Math.random() * 0.3),
          lineWidth * 0.6,
          alpha * 0.65
        );
      }
    }

    // Fine organic speckle.
    for (let i = 0; i < 2600; i++) {
      const x = Math.random() * width;
      const y = Math.random() * height;
      const warm = Math.random() > 0.5;
      ctx.fillStyle = warm
        ? `rgba(166,110,92,${0.012 + Math.random() * 0.025})`
        : `rgba(255,252,245,${0.012 + Math.random() * 0.025})`;
      ctx.fillRect(x, y, 1.1, 1.1);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    return texture;
  }

  private createScleraRoughnessTexture(): THREE.CanvasTexture {
    const width = 1024;
    const height = 512;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = '#b4b4b4';
    ctx.fillRect(0, 0, width, height);

    // Broad, gentle variation in surface roughness.
    for (let i = 0; i < 220; i++) {
      const x = Math.random() * width;
      const y = Math.random() * height;
      const radius = 20 + Math.random() * 120;
      const value = 150 + Math.random() * 80;
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
      gradient.addColorStop(0, `rgba(${value},${value},${value},0.45)`);
      gradient.addColorStop(1, `rgba(${value},${value},${value},0)`);
      ctx.fillStyle = gradient;
      ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    }

    // Fine tooth.
    for (let i = 0; i < 9000; i++) {
      const value = 150 + Math.random() * 90;
      ctx.fillStyle = `rgba(${value},${value},${value},0.18)`;
      ctx.fillRect(Math.random() * width, Math.random() * height, 1, 1);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.NoColorSpace;
    return texture;
  }

  // ---------------------------------------------------------------- eye

  private createEye(): void {
    const mobile = window.innerWidth < 768;
    const sphereSegments = mobile ? 64 : 112;

    // Sclera ------------------------------------------------------------
    // Hidden in the macro hero crop, but kept available for the full-globe
    // variant of the scene.
    if (!MACRO_IRIS) {
      this.scleraTexture = this.createScleraTexture();
      this.scleraRoughnessTexture = this.createScleraRoughnessTexture();

      const scleraGeometry = new THREE.SphereGeometry(
        EYE_RADIUS, sphereSegments, sphereSegments
      );
      const scleraMaterial = new THREE.MeshPhysicalMaterial({
        map: this.scleraTexture,
        roughnessMap: this.scleraRoughnessTexture,
        color: 0xffffff,
        roughness: 0.6,
        metalness: 0,
        clearcoat: 0.35,
        clearcoatRoughness: 0.14,
        envMapIntensity: 0.45
      });
      const sclera = new THREE.Mesh(scleraGeometry, scleraMaterial);
      this.eyeGroup.add(sclera);
    }

    // Iris --------------------------------------------------------------
    // A shallow spherical cap, slightly proud of the sclera. All colour,
    // fibre, pupil and limbal detail lives in a single continuous shader,
    // which guarantees a perfectly circular, seam-free iris.
    const irisCapRadius = EYE_RADIUS + 0.006;
    const irisTheta = Math.asin(IRIS_RADIUS / irisCapRadius);
    const irisGeometry = new THREE.SphereGeometry(
      irisCapRadius,
      mobile ? 96 : 144,
      mobile ? 36 : 52,
      0,
      Math.PI * 2,
      0,
      irisTheta
    );

    this.irisUniforms = {
      uIris: { value: IRIS_RADIUS },
      uPupil: { value: PUPIL_RATIO }
    };

    const irisMaterial = new THREE.ShaderMaterial({
      uniforms: this.irisUniforms,
      vertexShader: /* glsl */`
        varying vec3 vLocal;

        void main() {
          vLocal = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */`
        precision highp float;

        varying vec3 vLocal;

        uniform float uIris;
        uniform float uPupil;

        float hash21(vec2 p) {
          p = fract(p * vec2(123.34, 456.21));
          p += dot(p, p + 45.32);
          return fract(p.x * p.y);
        }

        float valueNoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);

          float a = hash21(i);
          float b = hash21(i + vec2(1.0, 0.0));
          float c = hash21(i + vec2(0.0, 1.0));
          float d = hash21(i + vec2(1.0, 1.0));

          return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
        }

        float fbm(vec2 p) {
          float value = 0.0;
          float amplitude = 0.5;
          for (int i = 0; i < 5; i++) {
            value += amplitude * valueNoise(p);
            p = p * 2.03 + vec2(11.7, 5.3);
            amplitude *= 0.5;
          }
          return value;
        }

        void main() {
          // The cap was generated around +Y and is rotated into place, so
          // the radial coordinates of the iris are the local x/z pair.
          vec2 p = vLocal.xz;
          float radius = length(p);
          float r = radius / uIris;
          float angle = atan(p.y, p.x);

          // Periodic coordinates keep every noise field seamless around
          // the full 360 degrees of the iris.
          vec2 dir = vec2(cos(angle), sin(angle));

          float sector = fbm(dir * 2.4 + vec2(2.7, 6.1));
          float sectorFine = fbm(dir * 6.0 + vec2(7.1, 2.4));
          float phase = fbm(dir * 3.0 + vec2(8.4, r * 2.1));
          float radial = fbm(dir * 4.2 + vec2(r * 1.7, 3.3));

          // Three layers of radial fibres. Frequencies are integers so the
          // pattern is continuous at the angle wrap.
          float fiberCoarse = 0.5 + 0.5 * sin(angle * 62.0 + phase * 4.0 + r * 6.0);
          float fiberMedium = 0.5 + 0.5 * sin(angle * 128.0 + phase * 9.0 - r * 12.0);
          float fiberFine   = 0.5 + 0.5 * sin(angle * 244.0 + phase * 15.0 + r * 20.0);

          float fiber = fiberCoarse * 0.44 + fiberMedium * 0.34 + fiberFine * 0.22;
          fiber = pow(fiber, 2.2);

          // Angular bundles prevent the iris from reading as a regular
          // starburst; some wedges carry denser, brighter fibres.
          float bundle =
            0.42 + 0.58 * pow(0.5 + 0.5 * sin(angle * 37.0 + phase * 7.0 + 1.3), 1.6);
          float coarseBundle =
            0.58 + 0.42 * pow(0.5 + 0.5 * sin(angle * 11.0 + phase * 3.0 + 0.6), 2.0);

          float fiberMask =
            smoothstep(0.045, 0.17, r) *
            (1.0 - smoothstep(0.90, 1.0, r));

          float fibers =
            fiber * bundle * coarseBundle * mix(0.5, 1.2, radial) * fiberMask;
          // Fade the brightest fibre tips near the limbus so the outer edge
          // stays dark and the iris doesn't gain a neon halo.
          fibers *= 1.0 - smoothstep(0.74, 0.95, r) * 0.35;
          float furrow = (1.0 - fiber) * bundle * fiberMask;

          // Irregular crypts and darker stromal pockets.
          float pocket = fbm(dir * 3.6 + vec2(r * 1.15, 9.2));
          float crypts =
            smoothstep(0.56, 0.71, pocket) *
            smoothstep(0.20, 0.38, r) *
            (1.0 - smoothstep(0.84, 0.97, r));

          // Warm amber zones in the mid periphery.
          float warmPatch = smoothstep(0.55, 0.78, fbm(dir * 4.4 + vec2(2.2, r * 3.1)));
          warmPatch *= smoothstep(0.32, 0.52, r) * (1.0 - smoothstep(0.72, 0.90, r));

          // Collarette: the pale, slightly raised ring around the pupil,
          // followed by a darker furrow.
          float collaretteRadius =
            0.465 +
            (fbm(dir * 2.0 + 4.1) - 0.5) * 0.055 +
            (fbm(dir * 5.5 + 8.7) - 0.5) * 0.03;
          float collarette = exp(-pow((r - collaretteRadius) / 0.024, 2.0));
          float collaretteGroove = exp(
            -pow((r - (collaretteRadius + 0.055)) / 0.028, 2.0)
          );

          // Colour palette: deep navy stroma, electric teal fibres and a warm
          // gold limbal rim, mirroring a back-lit macro photograph.
          vec3 deepest = vec3(0.004, 0.014, 0.028);
          vec3 navy    = vec3(0.010, 0.038, 0.074);
          vec3 blue    = vec3(0.020, 0.110, 0.205);
          vec3 steel   = vec3(0.040, 0.210, 0.290);
          vec3 teal    = vec3(0.050, 0.390, 0.410);
          vec3 cyan    = vec3(0.170, 0.660, 0.690);
          vec3 ice     = vec3(0.580, 0.900, 0.880);
          vec3 cream   = vec3(0.720, 0.560, 0.300);
          vec3 warm    = vec3(0.260, 0.165, 0.070);
          vec3 gold    = vec3(0.950, 0.570, 0.170);

          vec3 colour = mix(deepest, blue, smoothstep(0.0, 0.22, r));
          colour = mix(colour, steel, smoothstep(0.18, 0.50, r) * (0.5 + 0.3 * sector));
          colour = mix(colour, teal, smoothstep(0.40, 0.72, r) * (0.4 + 0.4 * sectorFine));
          colour = mix(colour, navy, smoothstep(0.70, 0.90, r));
          colour = mix(colour, warm, warmPatch * 0.34);

          // The pupil sits a touch off-centre, as it does in a real eye.
          vec2 pupilOffset = vec2(0.012, -0.008);
          float pupilR = length(p / uIris - pupilOffset);

          // Dark warm pupillary zone around the black aperture.
          float inner = 1.0 - smoothstep(uPupil, 0.54, r);
          colour = mix(colour, warm, inner * 0.5);

          // Molten-gold ring immediately around the pupil, broken up so it
          // never reads as a perfect printed circle.
          float innerGoldRadius =
            uPupil + 0.028 + (fbm(dir * 5.0 + 3.7) - 0.5) * 0.024;
          float innerGoldWidth = 0.019 + 0.01 * fbm(dir * 9.0 + 1.1);
          float innerGold =
            exp(-pow((pupilR - innerGoldRadius) / innerGoldWidth, 2.0));
          innerGold *= 0.55 + 0.45 * fbm(dir * 11.0 + 6.4);
          colour = mix(colour, gold, innerGold * 0.76);

          // Soft collarette and its shadow.
          colour = mix(colour, cream, collarette * 0.3);
          colour *= 1.0 - collaretteGroove * 0.2;

          // Fibre highlights, dark furrows and crypts.
          colour += ice * fibers * 0.46 + cyan * fibers * 0.28;
          colour += gold * fibers * warmPatch * 0.4;
          colour *= 1.0 - furrow * 0.2 - crypts * 0.44;

          // Sparse gold streaks catch the warm rim light.
          float goldStreak =
            pow(max(0.0, sin(angle * 96.0 + phase * 8.0 + r * 22.0)), 18.0);
          goldStreak *=
            smoothstep(0.30, 0.55, r) *
            (1.0 - smoothstep(0.82, 0.93, r));
          colour += gold * goldStreak * (0.12 + 0.2 * warmPatch);

          // A handful of brighter ice-blue fibres break up the symmetry.
          float iceStreak =
            pow(max(0.0, sin(angle * 31.0 + phase * 4.0 + r * 9.0)), 12.0);
          iceStreak *= fiberMask;
          colour += ice * iceStreak * 0.18;

          // Gentle concentric relief and a few irregular contraction furrows.
          colour *= 0.93 + 0.07 * sin(r * 64.0 + fbm(dir * 3.0) * 3.0);
          float rings = 0.5 + 0.5 * sin(r * 54.0 + fbm(dir * 2.6 + 5.0) * 6.0);
          float ringMask =
            smoothstep(0.5, 0.65, rings) *
            smoothstep(0.42, 0.6, r) *
            (1.0 - smoothstep(0.84, 0.94, r));
          colour *= 1.0 - ringMask * 0.07;

          // Deep black pupil with a naturally irregular edge.
          float pupilEdge = uPupil + (fbm(dir * 7.0 + 2.0) - 0.5) * 0.012;
          colour *= smoothstep(pupilEdge - 0.007, pupilEdge + 0.007, pupilR);

          // Inner shadow makes the pupil feel recessed underneath the iris.
          colour *= mix(0.55, 1.0, smoothstep(pupilEdge, pupilEdge + 0.06, pupilR));

          // Warm gold limbal rim with an irregular, slightly molten edge.
          float rimNoise = fbm(dir * 7.0 + vec2(3.1, r * 2.0));
          float rimGap = smoothstep(0.42, 0.74, fbm(dir * 15.0 + vec2(5.3, r * 4.0)));
          float rimStart = 0.85 + (fbm(dir * 9.0 + 2.0) - 0.5) * 0.035;
          float outerRim =
            smoothstep(rimStart, rimStart + 0.06, r) *
            (1.0 - smoothstep(0.972, 1.0, r));
          outerRim *= 0.46 + 0.54 * rimNoise;
          outerRim *= 0.6 + 0.4 * rimGap;
          vec3 rimColour =
            mix(vec3(0.46, 0.22, 0.05), gold, 0.5 + 0.5 * rimNoise);
          colour = mix(colour, rimColour, outerRim * 0.78);

          // Darken the last band of stroma so the rim reads as a raised edge.
          float stromaEdge =
            smoothstep(0.80, 0.89, r) *
            (1.0 - smoothstep(0.90, 0.965, r));
          colour *= 1.0 - stromaEdge * 0.1;

          // Warm mineral flecks through the middle of the iris.
          colour += vec3(0.72, 0.30, 0.06) * pow(warmPatch, 2.0) * 0.3;

          // A thin dark contour closes the iris cleanly.
          float limbal = smoothstep(0.962, 1.0, r);
          colour = mix(colour, deepest, limbal * 0.95);

          // Soft directional shading from the upper left, fixed to the eye.
          vec2 q = p / uIris;
          float shade = clamp(0.5 - q.x * 0.22 - q.y * 0.18, 0.0, 1.0);
          colour *= 0.86 + 0.20 * shade;

          // Soft wet sheen and a tighter corneal glint, both fixed to the
          // iris so they follow the gaze.
          float sheen = smoothstep(0.55, 0.0, length(q - vec2(-0.34, -0.36)));
          colour += vec3(0.36, 0.66, 0.72) * sheen * 0.1;

          float glint = smoothstep(0.34, 0.0, length(q - vec2(-0.3, -0.42)));
          colour += vec3(0.72, 0.9, 1.0) * glint * 0.08;

          gl_FragColor = vec4(colour, 1.0);
        }
      `
    });

    const iris = new THREE.Mesh(irisGeometry, irisMaterial);
    // SphereGeometry was built around +Y; rotate its pole onto +Z.
    iris.rotation.x = Math.PI / 2;
    this.eyeGroup.add(iris);

    // Cornea -------------------------------------------------------------
    // In the macro crop the corneal cap would read as a milky ring against
    // the dark page, so the wet sheen is handled inside the iris shader.
    if (!MACRO_IRIS) {
      const corneaRadius = EYE_RADIUS + 0.0125;
      const corneaTheta = Math.asin(0.245 / corneaRadius);
      const corneaGeometry = new THREE.SphereGeometry(
        corneaRadius,
        mobile ? 96 : 144,
        mobile ? 32 : 48,
        0,
        Math.PI * 2,
        0,
        corneaTheta
      );

      const corneaMaterial = new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        metalness: 0,
        roughness: 0.02,
        transmission: 1,
        thickness: 0.02,
        ior: 1.376,
        clearcoat: 1,
        clearcoatRoughness: 0.02,
        envMapIntensity: 1.45,
        transparent: false,
        side: THREE.FrontSide
      });

      const cornea = new THREE.Mesh(corneaGeometry, corneaMaterial);
      cornea.rotation.x = Math.PI / 2;
      this.eyeGroup.add(cornea);
    }
  }

  // ---------------------------------------------------------------- lighting

  private addLighting(): void {
    // Very low ambient, the environment does most of the soft lifting.
    this.scene.add(new THREE.AmbientLight(0xdfefff, 0.045));

    // Warm white key from the upper left.
    const key = new THREE.DirectionalLight(0xfff4e6, 1.8);
    key.position.set(-4.5, 4.5, 5.5);
    this.scene.add(key);

    // Soft diffuse fill that cannot create hard specular pin-pricks.
    const hemisphere = new THREE.HemisphereLight(0xbfe7ff, 0xffd3b5, 0.16);
    this.scene.add(hemisphere);

    // Thin cyan rim from behind.
    const rim = new THREE.DirectionalLight(0x39d5ff, 0.35);
    rim.position.set(2.5, 1.5, -4.0);
    this.scene.add(rim);
  }

  // ---------------------------------------------------------------- animation

  private startLoop(): void {
    if (this.disabled || this.animationId !== 0) {
      return;
    }
    this.clock.getDelta();
    this.animate();
  }

  private stopLoop(): void {
    if (this.animationId !== 0) {
      cancelAnimationFrame(this.animationId);
      this.animationId = 0;
    }
  }

  private animate = (): void => {
    this.animationId = requestAnimationFrame(this.animate);

    const delta = Math.min(this.clock.getDelta(), 0.05);
    const now = performance.now();

    const idleSeconds = (now - this.lastPointerMove) / 1000;
    const idle = this.reducedMotion
      ? 1
      : THREE.MathUtils.clamp((idleSeconds - 2.2) / 1.8, 0, 1);

    const idleYaw = this.reducedMotion
      ? 0
      : Math.sin(now * 0.00033 + 1.3) * 0.03;
    const idlePitch = this.reducedMotion
      ? 0
      : Math.sin(now * 0.00047 + 0.4) * 0.02;

    const pointerWeight = this.reducedMotion ? 0 : 1 - idle * 0.65;
    const scrollYaw = this.reducedMotion ? 0 : this.scrollProgress * 0.18;
    const scrollPitch = this.reducedMotion ? 0 : this.scrollProgress * 0.1;

    let targetYaw =
      this.baseYaw +
      this.pointerX * 0.34 * pointerWeight +
      scrollYaw +
      idle * idleYaw;

    let targetPitch =
      this.basePitch +
      this.pointerY * 0.22 * pointerWeight -
      scrollPitch +
      idle * idlePitch;

    targetYaw = THREE.MathUtils.clamp(
      targetYaw,
      MACRO_IRIS ? 0.24 : -0.42,
      MACRO_IRIS ? 0.78 : 0.52
    );
    targetPitch = THREE.MathUtils.clamp(targetPitch, -0.3, 0.3);

    const damping = 1 - Math.exp(-delta * 4.6);
    this.currentYaw += (targetYaw - this.currentYaw) * damping;
    this.currentPitch += (targetPitch - this.currentPitch) * damping;

    this.eyeGroup.rotation.y = this.currentYaw;
    this.eyeGroup.rotation.x = this.currentPitch;
    this.eyeGroup.rotation.z = this.baseRoll + (this.reducedMotion
      ? 0
      : Math.sin(now * 0.00029) * 0.012);

    // The iris cap sits half an eye-radius in front of the group's pivot.
    // Counter-translate most of that offset so the macro iris stays centred
    // while still drifting slightly with the gaze.
    const irisOffset = EYE_RADIUS + 0.006;
    const centring = 1;
    const bob = this.reducedMotion
      ? 0
      : Math.sin(now * 0.00056) * 0.012;

    this.eyeGroup.position.x =
      -irisOffset * Math.sin(this.currentYaw) * Math.cos(this.currentPitch) * centring;
    this.eyeGroup.position.y =
      irisOffset * Math.sin(this.currentPitch) * centring + bob;

    this.renderer.render(this.scene, this.camera);
  };

  // ---------------------------------------------------------------- utilities

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
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      this.renderer.setSize(width, height);
    });
    this.resizeObserver.observe(this.canvasContainer.nativeElement);
  }

  private setupVisibility(): void {
    if (typeof IntersectionObserver === 'undefined') {
      return;
    }
    this.intersectionObserver = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        this.isVisible = entry.isIntersecting;
        if (this.isVisible && !document.hidden) {
          this.startLoop();
        } else {
          this.stopLoop();
        }
      },
      { rootMargin: '100px' }
    );
    this.intersectionObserver.observe(this.canvasContainer.nativeElement);
  }

  ngOnDestroy(): void {
    this.stopLoop();
    this.resizeObserver?.disconnect();
    this.intersectionObserver?.disconnect();
    this.reducedMotionQuery?.removeEventListener('change', this.onReducedMotionChange);

    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerleave', this.onPointerLeave);
    window.removeEventListener('blur', this.onPointerLeave);
    window.removeEventListener('scroll', this.onScroll);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);

    if (this.scene) {
      this.scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material)
            ? object.material
            : [object.material];
          materials.forEach((material) => material?.dispose());
        }
      });
    }

    this.scleraTexture?.dispose();
    this.scleraRoughnessTexture?.dispose();
    this.envRenderTarget?.dispose();
    this.pmrem?.dispose();

    this.renderer?.dispose();
    this.renderer?.forceContextLoss();
    this.renderer?.domElement?.remove();
  }
}
