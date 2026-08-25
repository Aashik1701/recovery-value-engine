import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import * as THREE from "three";
import { useTheme } from "../theme";

/**
 * "Signal in the Static" — the product's thesis told visually. Most points
 * drift as dim, disorganized noise (the flood of undifferentiated
 * payment.failed events); a subset — the signal — resolves into an organized
 * blue waveform (Razorpay's brand blue) as the page scrolls. The separation
 * IS the argument, so noise particles never convert; only the signal share
 * does. Colors swap between the light and dark palettes below the theme
 * toggle, same as the rest of the page.
 */

const PALETTE = {
  light: { bg: "#f8fafc", noise: "#cbd5e1", signal: "#305eff", veilEdge: "241,245,249" },
  dark: { bg: "#0a0b0e", noise: "#4a4e58", signal: "#4d7fff", veilEdge: "10,11,14" },
} as const;

const VERT = /* glsl */ `
  uniform float uTime;
  uniform float uProgress;
  uniform float uPixelRatio;
  uniform float uSize;

  attribute vec3 aChaos;
  attribute vec3 aOrder;
  attribute float aSeed;
  attribute float aSignal;

  varying float vSignal;
  varying float vAlpha;

  void main() {
    float staggered = clamp((uProgress - aSeed * 0.3) / 0.7, 0.0, 1.0);
    float organize = staggered * aSignal;

    vec3 drift = vec3(
      sin(uTime * 0.24 + aSeed * 6.283) * 0.55,
      cos(uTime * 0.19 + aSeed * 4.1) * 0.45,
      0.0
    );
    vec3 chaosPos = aChaos + drift;

    vec3 orderPos = aOrder;
    orderPos.y += sin(uTime * 0.5 + aOrder.x * 0.36) * 0.16;

    vec3 p = mix(chaosPos, orderPos, organize);

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * mix(1.0, 1.75, organize) * uPixelRatio * (12.0 / -mv.z);

    vSignal = organize;
    vAlpha = mix(0.38, 1.0, organize);
  }
`;

const FRAG = /* glsl */ `
  uniform vec3 uNoiseColor;
  uniform vec3 uSignalColor;

  varying float vSignal;
  varying float vAlpha;

  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    float soft = smoothstep(0.5, 0.04, d);
    vec3 col = mix(uNoiseColor, uSignalColor, vSignal);
    gl_FragColor = vec4(col, soft * vAlpha);
  }
`;

function mulberry32(seed: number): () => number {
  let a = seed;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildAttributes(count: number) {
  const SIGNAL_SHARE = 0.36;
  const rand = mulberry32(20260825);

  const chaos = new Float32Array(count * 3);
  const order = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  const signal = new Float32Array(count);

  let signalTotal = 0;
  for (let i = 0; i < count; i++) {
    signal[i] = rand() < SIGNAL_SHARE ? 1 : 0;
    if (signal[i]) signalTotal++;
  }

  let k = 0;
  for (let i = 0; i < count; i++) {
    const i3 = i * 3;
    chaos[i3] = (rand() - 0.5) * 36;
    chaos[i3 + 1] = (rand() - 0.5) * 22;
    chaos[i3 + 2] = (rand() - 0.5) * 12 - 2;
    seeds[i] = rand();

    if (signal[i]) {
      const t = signalTotal > 1 ? k / (signalTotal - 1) : 0.5;
      const x = t * 34 - 17;
      order[i3] = x;
      order[i3 + 1] = Math.sin(x * 0.42) * 2.5 + (rand() - 0.5) * 0.55;
      order[i3 + 2] = (rand() - 0.5) * 1.1;
      k++;
    } else {
      order[i3] = chaos[i3];
      order[i3 + 1] = chaos[i3 + 1];
      order[i3 + 2] = chaos[i3 + 2];
    }
  }

  return { chaos, order, seeds, signal };
}

function scrollProgress(): number {
  const max = document.documentElement.scrollHeight - window.innerHeight;
  if (max <= 0) return 0;
  // Fully organized before the very bottom, so the close section reads
  // against a resolved field rather than one still settling.
  return Math.min(window.scrollY / max / 0.75, 1);
}

/**
 * Subtle depth cues: the camera drifts slightly toward the cursor
 * (parallax) and pushes in a touch as you scroll, both damped
 * exponentially so they feel alive rather than jittery. Restrained on
 * purpose — this is a fintech landing page, not a game; the point is to
 * make the field feel responsive, not to throw the camera around.
 */
function CameraRig({ reducedMotion }: { reducedMotion: boolean }) {
  const { camera } = useThree();
  const base = useRef(new THREE.Vector3(0, 0, 15));

  useFrame((state, delta) => {
    if (reducedMotion) return;

    const scrollPush = scrollProgress() * 1.6; // gentle push-in as you scroll
    const parallaxX = state.pointer.x * 0.9;
    const parallaxY = state.pointer.y * 0.55;

    const goal = base.current.clone();
    goal.x = parallaxX;
    goal.y = parallaxY;
    goal.z = 15 - scrollPush;

    camera.position.lerp(goal, 1 - Math.exp(-3.2 * delta));
    camera.lookAt(0, 0, 0);
  });

  return null;
}

/**
 * The bloom EffectComposer's final blit is opaque regardless of the
 * renderer's alpha clear color — a real gotcha with @react-three/postprocessing,
 * not a transparency setting anyone forgot. Painting the canvas with the
 * theme's actual background color (instead of trying to keep it transparent
 * over the page) sidesteps it entirely: an opaque canvas in the right color
 * looks identical to a transparent one, and doesn't silently blank the page
 * in light mode the way relying on alpha did.
 */
function ClearColor() {
  const { gl } = useThree();
  const [theme] = useTheme();
  useEffect(() => {
    gl.setClearColor(PALETTE[theme].bg, 1);
  }, [gl, theme]);
  return null;
}

function Points({ reducedMotion, isSmall }: { reducedMotion: boolean; isSmall: boolean }) {
  const count = isSmall ? 850 : 3000;
  const { chaos, order, seeds, signal } = useMemo(() => buildAttributes(count), [count]);
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const easedProgress = useRef(reducedMotion ? 1 : 0);
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  const [theme] = useTheme();
  const palette = PALETTE[theme];

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uProgress: { value: reducedMotion ? 1 : 0 },
      uPixelRatio: { value: pixelRatio },
      uSize: { value: isSmall ? 2.6 : 3.1 },
      uNoiseColor: { value: new THREE.Color(palette.noise) },
      uSignalColor: { value: new THREE.Color(palette.signal) },
    }),
    // Only the theme-independent values belong in deps; the colors are kept
    // in sync by the effect below instead of rebuilding the material.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isSmall, pixelRatio, reducedMotion],
  );

  useEffect(() => {
    materialRef.current?.uniforms.uNoiseColor.value.set(palette.noise);
    materialRef.current?.uniforms.uSignalColor.value.set(palette.signal);
  }, [palette]);

  useFrame((state) => {
    if (!materialRef.current) return;
    if (reducedMotion) return; // one static, already-resolved frame
    const target = scrollProgress();
    easedProgress.current += (target - easedProgress.current) * 0.06;
    materialRef.current.uniforms.uProgress.value = easedProgress.current;
    materialRef.current.uniforms.uTime.value = state.clock.getElapsedTime();
  });

  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[chaos, 3]} />
        <bufferAttribute attach="attributes-aChaos" args={[chaos, 3]} />
        <bufferAttribute attach="attributes-aOrder" args={[order, 3]} />
        <bufferAttribute attach="attributes-aSeed" args={[seeds, 1]} />
        <bufferAttribute attach="attributes-aSignal" args={[signal, 1]} />
      </bufferGeometry>
      <shaderMaterial
        ref={materialRef}
        args={[
          {
            uniforms,
            vertexShader: VERT,
            fragmentShader: FRAG,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
          },
        ]}
      />
    </points>
  );
}

export function ParticleField() {
  const reducedMotion = useMemo(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );
  const isSmall = useMemo(() => window.matchMedia("(max-width: 900px)").matches, []);
  const [visible, setVisible] = useState(true);
  const [theme] = useTheme();
  const veil = PALETTE[theme];

  // Don't burn GPU on a hidden tab.
  useEffect(() => {
    const onVis = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  return (
    <div className="fixed inset-0 z-0 pointer-events-none" aria-hidden="true">
      <Canvas
        camera={{ position: [0, 0, 15], fov: 55, near: 0.1, far: 100 }}
        dpr={[1, 2]}
        gl={{ antialias: false }}
        frameloop={visible ? "always" : "never"}
      >
        <ClearColor />
        <Points reducedMotion={reducedMotion} isSmall={isSmall} />
        <CameraRig reducedMotion={reducedMotion} />
        <EffectComposer enableNormalPass={false}>
          <Bloom
            mipmapBlur
            luminanceThreshold={0.15}
            luminanceSmoothing={0.35}
            intensity={isSmall ? 0.5 : 0.85}
            radius={0.55}
          />
        </EffectComposer>
      </Canvas>
      {/* Keeps text legible no matter where particles happen to drift — a
          soft vignette toward the edges; the canvas itself now already
          paints the correct opaque background color, so this only needs to
          darken/lighten the margins, not fight transparency. */}
      <div
        className="absolute inset-0"
        style={{
          background: `radial-gradient(ellipse 120% 80% at 50% 50%, transparent 0%, rgba(${veil.veilEdge},0.55) 65%, rgba(${veil.veilEdge},0.85) 100%)`,
        }}
      />
    </div>
  );
}
