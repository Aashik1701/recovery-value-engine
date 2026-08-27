import { useEffect, useMemo, useRef } from "react";
import { useTheme, type Theme } from "../theme";

/**
 * A quiet Canvas 2D "pixel arc" that sits behind the landing-page footer,
 * adapted from ThreeUI's data-pixel-arc renderer and recoloured to the
 * page's blue accent (--lp-accent). It only animates while its host is
 * actually on screen (IntersectionObserver) and the tab is visible, and
 * it renders a single static frame when the visitor prefers reduced
 * motion. No dependencies, no WebGL -- the page already spends its GPU
 * budget on <ParticleField />.
 *
 * `orientation="down"` (default) is the footer look: the dense band hugs
 * the lower third and curves down toward both edges. `orientation="up"`
 * mirrors it for the hero -- the band hangs from the top, its arms
 * sweeping up off the corners, fading downward toward the copy.
 */

type RGB = { r: number; g: number; b: number };

type ArcOrientation = "down" | "up";

type ArcOptions = {
  mode: Theme;
  accent: RGB;
  reducedMotion: boolean;
  orientation: ArcOrientation;
};

const ACCENT_FALLBACK: Record<Theme, string> = {
  light: "#305eff",
  dark: "#4d7fff",
};

function parseHex(input: string): RGB | null {
  const hex = input.trim().replace(/^#/, "");
  if (hex.length === 3) {
    const r = parseInt(hex[0] + hex[0], 16);
    const g = parseInt(hex[1] + hex[1], 16);
    const b = parseInt(hex[2] + hex[2], 16);
    return Number.isNaN(r + g + b) ? null : { r, g, b };
  }
  if (hex.length === 6) {
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return Number.isNaN(r + g + b) ? null : { r, g, b };
  }
  return null;
}

/**
 * Reads --lp-accent off an element inside `.landing-page` (that's where the
 * landing tokens are scoped -- they are not on :root) so the arc tracks the
 * same blue the rest of the page uses; falls back to the known values per
 * theme when the token can't be resolved.
 */
function readAccent(theme: Theme, from: Element | null): RGB {
  const el = from ?? document.documentElement;
  const raw = getComputedStyle(el).getPropertyValue("--lp-accent");
  const parsed = raw && parseHex(raw);
  if (parsed) return parsed;
  return parseHex(ACCENT_FALLBACK[theme]) ?? { r: 77, g: 127, b: 255 };
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function createFooterArcRenderer(canvas: HTMLCanvasElement, getOptions: () => ArcOptions) {
  const context = canvas.getContext("2d");
  if (!context) return null;

  let width = 1;
  let height = 1;
  let time = 0;

  const resize = (nextWidth: number, nextHeight: number) => {
    width = Math.max(1, nextWidth);
    height = Math.max(1, nextHeight);
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * pixelRatio);
    canvas.height = Math.round(height * pixelRatio);
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  };

  const render = () => {
    const { mode, accent, reducedMotion, orientation } = getOptions();
    const isLight = mode === "light";
    const archUp = orientation === "up";

    // The device-pixel transform set in resize() persists on the context, so
    // width/height below are CSS pixels.
    context.clearRect(0, 0, width, height);
    context.globalCompositeOperation = isLight ? "source-over" : "lighter";

    // The hero band spans a much taller box than the footer, so step the grid
    // up a notch there to keep the per-frame cell count in the same range.
    const pixelSize = width < 720 ? 6 : archUp ? 8 : 7;
    const cols = Math.ceil(width / pixelSize);
    const rows = Math.ceil(height / pixelSize);
    // Shallow arc anchored to the lower third of the footer: the dense band of
    // blocks sits below the copy and curves down toward both edges, thinning to
    // a soft glow as it reaches up behind the text. The hero mirror anchors the
    // band near the top and sweeps its arms up off the corners instead.
    const arcCenterY = height * (archUp ? 0.16 : 0.82);
    const arcDrop = height * 0.55;
    const thickness = height * (archUp ? 0.28 : 0.44);

    for (let x = 0; x < cols; x += 1) {
      for (let y = 0; y < rows; y += 1) {
        const px = x * pixelSize;
        const py = y * pixelSize;
        const nx = (px / width) * 2 - 1;
        const curveY = arcCenterY + (archUp ? -1 : 1) * Math.pow(Math.abs(nx), 1.8) * arcDrop;

        let intensity = Math.max(0, 1 - Math.abs(py - curveY) / thickness);
        if (intensity <= 0.01) continue;

        const wave1 = Math.sin(nx * 4 - time * 1.5) * 0.1;
        // Height-relative so it stays a controlled fraction of a cycle across
        // the band rather than repeating and creating a hard secondary lobe.
        const wave2 = Math.cos((py / height) * 2.4 + time) * 0.09;
        intensity = clamp01(intensity + wave1 + wave2);
        // Taper the arc off toward the left/right edges of the footer.
        intensity *= Math.max(0, 1 - Math.pow(Math.abs(nx), 2.5));
        if (intensity <= 0.02) continue;

        const core = Math.pow(intensity, 3);

        let r: number;
        let g: number;
        let b: number;
        if (isLight) {
          // Blue ink on the near-white footer: keep the accent hue, lift the
          // core toward white, and carry the fade in the alpha channel.
          r = accent.r;
          g = accent.g;
          b = accent.b;
          if (intensity > 0.72) {
            const k = (intensity - 0.72) * 4.5;
            r += (255 - r) * 0.55 * k;
            g += (255 - g) * 0.55 * k;
            b += (255 - b) * 0.55 * k;
          }
          context.globalAlpha = clamp01(0.1 + Math.pow(intensity, 0.8) * 0.85) * 0.92;
        } else {
          // Additive blue glow: dim blue at the edges, bright near-white core.
          r = accent.r * (0.3 * intensity + 0.8 * core);
          g = accent.g * (0.4 * intensity + 0.8 * core);
          b = accent.b * (0.6 * intensity + 0.6 * core);
          // A restrained lift toward white at the very core -- kept mild so the
          // footer copy stays legible where it sits over the glow.
          if (intensity > 0.8) {
            const k = (intensity - 0.8) * 4;
            r = Math.min(255, r + 90 * k);
            g = Math.min(255, g + 90 * k);
            b = Math.min(255, b + 90 * k);
          }
          context.globalAlpha = clamp01(0.24 + Math.pow(intensity, 0.7) * 0.66);
        }

        context.fillStyle = `rgb(${r | 0}, ${g | 0}, ${b | 0})`;
        context.fillRect(px, py, pixelSize - 1, pixelSize - 1);
      }
    }

    context.globalAlpha = 1;
    context.globalCompositeOperation = "source-over";
    if (!reducedMotion) time += 0.02;
  };

  return { resize, render };
}

export function FooterArcCanvas({ orientation = "down" }: { orientation?: ArcOrientation } = {}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<ReturnType<typeof createFooterArcRenderer>>(null);
  const [theme] = useTheme();
  const reducedMotion = useMemo(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );
  const optionsRef = useRef<ArcOptions>({
    mode: theme,
    accent: parseHex(ACCENT_FALLBACK[theme]) ?? { r: 77, g: 127, b: 255 },
    reducedMotion,
    orientation,
  });

  // Keep the render options in sync with the active theme, and repaint once
  // for the cases where the rAF loop isn't running (reduced motion, or the
  // footer sitting idle off-screen but about to scroll into view).
  useEffect(() => {
    optionsRef.current = {
      mode: theme,
      accent: readAccent(theme, hostRef.current),
      reducedMotion,
      orientation,
    };
    rendererRef.current?.render();
  }, [theme, reducedMotion, orientation]);

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return undefined;

    const renderer = createFooterArcRenderer(canvas, () => optionsRef.current);
    if (!renderer) return undefined;
    rendererRef.current = renderer;

    let frame = 0;
    let visible = false;

    const resize = () => {
      const bounds = host.getBoundingClientRect();
      renderer.resize(bounds.width, bounds.height);
      renderer.render();
    };
    const tick = () => {
      renderer.render();
      frame = visible && !document.hidden && !reducedMotion ? requestAnimationFrame(tick) : 0;
    };
    const start = () => {
      if (!frame && visible && !document.hidden && !reducedMotion) {
        frame = requestAnimationFrame(tick);
      }
    };
    const stop = () => {
      if (frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
    };

    const resizeObserver = new ResizeObserver(resize);
    const intersection = new IntersectionObserver(
      ([entry]) => {
        visible = entry?.isIntersecting ?? false;
        if (visible) start();
        else stop();
      },
      { threshold: 0 },
    );
    const onVisibility = () => {
      if (document.hidden) stop();
      else start();
    };

    resizeObserver.observe(host);
    intersection.observe(host);
    document.addEventListener("visibilitychange", onVisibility);
    resize();

    return () => {
      stop();
      resizeObserver.disconnect();
      intersection.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      rendererRef.current = null;
    };
  }, [reducedMotion]);

  return (
    <div
      ref={hostRef}
      className={orientation === "up" ? "lp-hero__arc" : "lp-footer__arc"}
      aria-hidden="true"
    >
      <canvas ref={canvasRef} />
    </div>
  );
}
