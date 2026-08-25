import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";

/**
 * "Signal in the Static" — the product's thesis told visually. Most points
 * drift as dim, disorganized gray noise (the flood of undifferentiated
 * payment.failed events); a subset — the signal — resolves into an organized
 * gold waveform as the page scrolls. The separation IS the argument, so noise
 * particles never convert; only the signal share does.
 */

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

function Points({ reducedMotion, isSmall }: { reducedMotion: boolean; isSmall: boolean }) {
  const count = isSmall ? 850 : 3000;
  const { chaos, order, seeds, signal } = useMemo(() => buildAttributes(count), [count]);
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const easedProgress = useRef(reducedMotion ? 1 : 0);
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uProgress: { value: reducedMotion ? 1 : 0 },
      uPixelRatio: { value: pixelRatio },
      uSize: { value: isSmall ? 2.6 : 3.1 },
      uNoiseColor: { value: new THREE.Color("#4a4e58") },
      uSignalColor: { value: new THREE.Color("#d4a44c") },
    }),
    [isSmall, pixelRatio, reducedMotion],
  );

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
        gl={{ antialias: false, alpha: true }}
        frameloop={visible ? "always" : "never"}
        onCreated={({ gl }) => gl.setClearColor(0x000000, 0)}
      >
        <Points reducedMotion={reducedMotion} isSmall={isSmall} />
      </Canvas>
      {/* Keeps text legible no matter where particles happen to drift. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 120% 80% at 50% 50%, rgba(10,11,14,0.35) 0%, rgba(10,11,14,0.82) 60%, rgba(10,11,14,0.95) 100%)",
        }}
      />
    </div>
  );
}
