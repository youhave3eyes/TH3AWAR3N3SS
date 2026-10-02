import { useState, useEffect, useRef, useCallback, useMemo } from "react";

/* ═══════════════════════════════════════════════════════════════
   TH3 AWAR3N3SS
   A next-generation digital consciousness ecosystem
   ═══════════════════════════════════════════════════════════════ */

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

// ─── Matrix Rain 3D — Head-tracked parallax via front camera ───
function MatrixRain() {
  const canvasRef = useRef(null);
  const animRef = useRef(null);
  const headPos = useRef({ x: 0, y: 0, active: false }); // -1..1 normalized
  const smoothHead = useRef({ x: 0, y: 0 });
  const videoRef = useRef(null);
  const trackingRef = useRef(null);
  const [camStatus, setCamStatus] = useState("idle"); // idle, requesting, active, denied

  // ─── Head tracking setup ───
  useEffect(() => {
    let stopped = false;
    let video = null;
    let detector = null;
    let stream = null;
    let fallbackInterval = null;

    const startTracking = async () => {
      try {
        setCamStatus("requesting");
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 320 }, height: { ideal: 240 } }
        });
        if (stopped) { stream.getTracks().forEach(t => t.stop()); return; }

        video = document.createElement("video");
        video.srcObject = stream;
        video.setAttribute("playsinline", "true");
        video.muted = true;
        await video.play();
        videoRef.current = video;
        setCamStatus("active");

        // Try native FaceDetector API (Chrome/Edge on Android, some desktop)
        if (typeof window.FaceDetector !== "undefined") {
          detector = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 1 });
          const detectLoop = async () => {
            if (stopped || !video || video.readyState < 2) {
              trackingRef.current = setTimeout(detectLoop, 100);
              return;
            }
            try {
              const faces = await detector.detect(video);
              if (faces.length > 0) {
                const box = faces[0].boundingBox;
                const centerX = box.x + box.width / 2;
                const centerY = box.y + box.height / 2;
                // Normalize to -1..1 (mirror x since front cam is mirrored)
                headPos.current = {
                  x: -((centerX / video.videoWidth) * 2 - 1),
                  y: (centerY / video.videoHeight) * 2 - 1,
                  active: true,
                };
              }
            } catch (e) {}
            trackingRef.current = setTimeout(detectLoop, 60);
          };
          detectLoop();
        } else {
          // Fallback: lightweight motion-based tracking using canvas pixel diff
          const trackCanvas = document.createElement("canvas");
          trackCanvas.width = 80;
          trackCanvas.height = 60;
          const tctx = trackCanvas.getContext("2d", { willReadFrequently: true });
          let prevFrame = null;

          fallbackInterval = setInterval(() => {
            if (stopped || !video || video.readyState < 2) return;
            tctx.drawImage(video, 0, 0, 80, 60);
            const frame = tctx.getImageData(0, 0, 80, 60);
            const data = frame.data;

            if (prevFrame) {
              // Find center of motion (weighted average of pixel diffs)
              let totalWeight = 0, wx = 0, wy = 0;
              // Also find brightest region as face proxy (skin tends to be brightest)
              let brightWeight = 0, bx = 0, by = 0;

              for (let py = 0; py < 60; py++) {
                for (let px = 0; px < 80; px++) {
                  const idx = (py * 80 + px) * 4;
                  // Brightness-based face detection (skin luminance)
                  const r = data[idx], g = data[idx+1], b = data[idx+2];
                  const lum = r * 0.299 + g * 0.587 + b * 0.114;
                  // Skin-tone heuristic: high luminance, red > green > blue
                  if (lum > 80 && r > 60 && r > b && g > b * 0.8) {
                    const skinWeight = lum / 255;
                    brightWeight += skinWeight;
                    bx += px * skinWeight;
                    by += py * skinWeight;
                  }

                  // Motion detection
                  const dr = Math.abs(data[idx] - prevFrame[idx]);
                  const dg = Math.abs(data[idx+1] - prevFrame[idx+1]);
                  const db = Math.abs(data[idx+2] - prevFrame[idx+2]);
                  const diff = dr + dg + db;
                  if (diff > 30) {
                    totalWeight += diff;
                    wx += px * diff;
                    wy += py * diff;
                  }
                }
              }

              // Prefer skin-tone detection, fallback to motion
              if (brightWeight > 50) {
                const cx = bx / brightWeight;
                const cy = by / brightWeight;
                headPos.current = {
                  x: -((cx / 80) * 2 - 1),
                  y: (cy / 60) * 2 - 1,
                  active: true,
                };
              } else if (totalWeight > 500) {
                const cx = wx / totalWeight;
                const cy = wy / totalWeight;
                headPos.current = {
                  x: -((cx / 80) * 2 - 1),
                  y: (cy / 60) * 2 - 1,
                  active: true,
                };
              }
            }
            prevFrame = new Uint8ClampedArray(data);
          }, 70);
        }
      } catch (e) {
        setCamStatus("denied");
        // Fallback to gyroscope on mobile
        const handleOrientation = (e) => {
          const gamma = e.gamma || 0;
          const beta = e.beta || 0;
          headPos.current = {
            x: clamp(gamma / 35, -1, 1),
            y: clamp((beta - 50) / 35, -1, 1),
            active: true,
          };
        };

        if (typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function") {
          const reqPerm = async () => {
            try {
              const result = await DeviceOrientationEvent.requestPermission();
              if (result === "granted") window.addEventListener("deviceorientation", handleOrientation);
            } catch (e2) {}
            document.removeEventListener("touchstart", reqPerm);
          };
          document.addEventListener("touchstart", reqPerm, { once: true });
        } else {
          window.addEventListener("deviceorientation", handleOrientation);
        }

        // Desktop mouse fallback
        const handleMouse = (e) => {
          headPos.current = {
            x: (e.clientX / window.innerWidth) * 2 - 1,
            y: (e.clientY / window.innerHeight) * 2 - 1,
            active: true,
          };
        };
        window.addEventListener("mousemove", handleMouse);
        return () => {
          window.removeEventListener("mousemove", handleMouse);
          window.removeEventListener("deviceorientation", handleOrientation);
        };
      }

      return () => {
        stopped = true;
        if (stream) stream.getTracks().forEach(t => t.stop());
        if (trackingRef.current) clearTimeout(trackingRef.current);
        if (fallbackInterval) clearInterval(fallbackInterval);
      };
    };

    const cleanup = startTracking();
    return () => { stopped = true; if (cleanup && typeof cleanup.then === 'function') cleanup.then(fn => fn && fn()); };
  }, []);

  // ─── 3D Matrix Rain rendering ───
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let w, h, columns;
    const chars = "アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン0123456789ABCDEFTH3AΣΩΔΘΨξζφ∞◈⬡◎⊛✧⊕";
    const fontSize = 14;

    // Create 3 depth layers for parallax
    const layers = [];
    const LAYER_COUNT = 4;

    const init = () => {
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = w;
      canvas.height = h;
      columns = Math.floor(w / fontSize);

      layers.length = 0;
      for (let L = 0; L < LAYER_COUNT; L++) {
        // depth: 0 = far background, 3 = close foreground
        const depth = L / (LAYER_COUNT - 1); // 0..1
        const scale = 0.5 + depth * 0.7; // 0.5..1.2 size multiplier
        const speed = 0.3 + depth * 0.7; // far=slow, near=fast
        const parallaxStrength = 15 + depth * 55; // far=subtle, near=dramatic (px shift)
        const alpha = 0.12 + depth * 0.45; // far=dim, near=bright
        const colCount = Math.floor(columns * (0.4 + depth * 0.6));
        const drops = Array.from({ length: colCount }, () => Math.random() * -100);
        // Give each column a slight random x offset for organic feel
        const xOffsets = Array.from({ length: colCount }, () => (Math.random() - 0.5) * fontSize * 0.6);

        layers.push({ depth, scale, speed, parallaxStrength, alpha, colCount, drops, xOffsets });
      }
    };
    init();
    window.addEventListener("resize", init);

    const draw = () => {
      // Smooth head tracking with lerp
      const target = headPos.current;
      smoothHead.current.x += (target.x - smoothHead.current.x) * 0.08;
      smoothHead.current.y += (target.y - smoothHead.current.y) * 0.08;

      const hx = smoothHead.current.x;
      const hy = smoothHead.current.y;

      // Slight fade for trails (lighter = smoother, less choppy)
      ctx.fillStyle = "rgba(5, 5, 8, 0.05)";
      ctx.fillRect(0, 0, w, h);

      // Draw each layer back to front
      for (let L = 0; L < LAYER_COUNT; L++) {
        const layer = layers[L];
        const offsetX = hx * layer.parallaxStrength;
        const offsetY = hy * layer.parallaxStrength * 0.5;
        const fs = Math.round(fontSize * layer.scale);

        ctx.font = `${fs}px 'JetBrains Mono', monospace`;

        for (let i = 0; i < layer.colCount; i++) {
          const char = chars[Math.floor(Math.random() * chars.length)];
          const baseX = (i / layer.colCount) * w + layer.xOffsets[i];
          const x = baseX + offsetX;
          const y = layer.drops[i] * fs + offsetY;

          // Perspective: chars closer to edges skew more
          const distFromCenter = Math.abs((baseX / w) - 0.5) * 2; // 0..1
          const perspectiveSkew = distFromCenter * hx * 3; // subtle italic effect

          // Brightness varies by layer and random — bumped up for more vibrancy
          const brightness = Math.random();
          const layerAlpha = layer.alpha;

          if (brightness > 0.96 && L >= 2) {
            ctx.fillStyle = `rgba(255, 255, 255, ${Math.min(1, layerAlpha + 0.5)})`;
            ctx.shadowColor = "#00ff8c";
            ctx.shadowBlur = 16 * layer.scale;
          } else if (brightness > 0.75) {
            ctx.fillStyle = `rgba(80, 255, 170, ${Math.min(1, layerAlpha + 0.35)})`;
            ctx.shadowColor = "#00ff8c";
            ctx.shadowBlur = 8 * layer.scale;
          } else {
            ctx.fillStyle = `rgba(0, 255, 140, ${layerAlpha * (0.65 + Math.random() * 0.5)})`;
            ctx.shadowBlur = 0;
          }

          // Apply subtle perspective transform via skewing x position
          const finalX = x + perspectiveSkew;

          // Only draw if somewhat on screen
          if (finalX > -fs * 2 && finalX < w + fs * 2 && y > -fs && y < h + fs * 2) {
            ctx.fillText(char, finalX, y);
          }
          ctx.shadowBlur = 0;

          // Reset drop
          if (y > h + fs * 4 && Math.random() > 0.975) {
            layer.drops[i] = -Math.random() * 20;
          }
          layer.drops[i] += layer.speed * (0.85 + Math.random() * 0.3);
        }
      }

      // Vignette overlay — slight darkening at edges for depth feel (desktop only)
      if (w >= 768) {
        const vignette = ctx.createRadialGradient(w/2, h/2, w*0.25, w/2, h/2, w*0.75);
        vignette.addColorStop(0, "rgba(5,5,8,0)");
        vignette.addColorStop(1, "rgba(5,5,8,0.35)");
        ctx.fillStyle = vignette;
        ctx.fillRect(0, 0, w, h);
      }

      animRef.current = requestAnimationFrame(draw);
    };
    animRef.current = requestAnimationFrame(draw);
    return () => { window.removeEventListener("resize", init); cancelAnimationFrame(animRef.current); };
  }, []);

  return (
    <>
      <canvas ref={canvasRef} style={{ position: "fixed", inset: 0, zIndex: 0, opacity: 0.9 }} />
      {/* Camera status indicator */}
      <div style={{
        position: "fixed", bottom: 20, left: 20, zIndex: 5,
        display: "flex", alignItems: "center", gap: 8,
        fontSize: 10, letterSpacing: 2, fontFamily: "'JetBrains Mono', monospace",
        color: camStatus === "active" ? "rgba(0,255,140,0.5)"
             : camStatus === "requesting" ? "rgba(234,179,8,0.5)"
             : "rgba(255,255,255,0.2)",
        animation: camStatus === "requesting" ? "breathe 1.5s ease-in-out infinite" : "none",
      }}>
        <div style={{
          width: 6, height: 6, borderRadius: "50%",
          background: camStatus === "active" ? "#00ff8c"
                    : camStatus === "requesting" ? "#eab308"
                    : "rgba(255,255,255,0.3)",
          boxShadow: camStatus === "active" ? "0 0 8px #00ff8c" : "none",
        }} />
        {camStatus === "active" ? "HEAD TRACKING ACTIVE"
         : camStatus === "requesting" ? "REQUESTING CAMERA..."
         : camStatus === "denied" ? "MOTION FALLBACK"
         : "3D MATRIX"}
      </div>
    </>
  );
}

// ─── Particle Canvas ───
function ParticleField({ mousePos, entered }) {
  const canvasRef = useRef(null);
  const particles = useRef([]);
  const animRef = useRef(null);
  const dims = useRef({ w: 0, h: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const resize = () => {
      dims.current = { w: window.innerWidth, h: window.innerHeight };
      canvas.width = dims.current.w * window.devicePixelRatio;
      canvas.height = dims.current.h * window.devicePixelRatio;
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    };
    resize();
    window.addEventListener("resize", resize);
    const count = Math.min(180, Math.floor((dims.current.w * dims.current.h) / 7000));
    particles.current = Array.from({ length: count }, () => ({
      x: Math.random() * dims.current.w, y: Math.random() * dims.current.h,
      vx: (Math.random() - 0.5) * 1.2, vy: (Math.random() - 0.5) * 1.2,
      r: Math.random() * 2.5 + 0.5,
      hue: Math.random() > 0.6 ? 140 + Math.random() * 30 : 270 + Math.random() * 40,
      alpha: Math.random() * 0.5 + 0.2, pulse: Math.random() * Math.PI * 2,
      drift: Math.random() * Math.PI * 2, // unique drift phase
      driftSpeed: 0.2 + Math.random() * 0.6, // how fast it wanders
      driftRadius: 20 + Math.random() * 60, // how far it wanders
    }));
    const draw = (time) => {
      const { w, h } = dims.current;
      ctx.clearRect(0, 0, w, h);
      const mx = mousePos.current?.x ?? -9999;
      const my = mousePos.current?.y ?? -9999;
      const t = time * 0.001;
      particles.current.forEach((p) => {
        // Independent floating/drifting motion
        p.vx += Math.sin(t * p.driftSpeed + p.drift) * 0.02;
        p.vy += Math.cos(t * p.driftSpeed * 0.7 + p.drift + 1.5) * 0.02;

        // Gentle cursor influence (much softer than before)
        if (mx > -999) {
          const dx = mx - p.x, dy = my - p.y;
          const dist = Math.sqrt(dx * dx + dy * dy) + 1;
          if (dist < 200) {
            const force = clamp(30 / dist, 0, 0.3);
            p.vx += (dx / dist) * force * 0.008;
            p.vy += (dy / dist) * force * 0.008;
          }
        }

        // Damping — keeps them drifting but not flying off screen
        p.vx *= 0.985; p.vy *= 0.985;

        // Speed limit
        const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
        if (speed > 1.5) { p.vx *= 1.5 / speed; p.vy *= 1.5 / speed; }

        p.x += p.vx; p.y += p.vy;

        // Wrap around edges
        if (p.x < -20) p.x = w + 20; if (p.x > w + 20) p.x = -20;
        if (p.y < -20) p.y = h + 20; if (p.y > h + 20) p.y = -20;

        const pa = p.alpha + Math.sin(t * 1.5 + p.pulse) * 0.15;
        const glow = Math.max(0.1, p.r + Math.sin(t * 2 + p.pulse) * 0.8);
        ctx.beginPath(); ctx.arc(p.x, p.y, glow, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${p.hue}, 80%, 65%, ${pa})`;
        ctx.shadowColor = `hsla(${p.hue}, 90%, 60%, 0.6)`; ctx.shadowBlur = 12;
        ctx.fill(); ctx.shadowBlur = 0;
      });
      const pts = particles.current;
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          const dx = pts[i].x - pts[j].x, dy = pts[i].y - pts[j].y, d = dx * dx + dy * dy;
          if (d < 12000) {
            ctx.beginPath(); ctx.moveTo(pts[i].x, pts[i].y); ctx.lineTo(pts[j].x, pts[j].y);
            ctx.strokeStyle = `rgba(0, 255, 140, ${(1 - d / 12000) * 0.15})`; ctx.lineWidth = 0.5; ctx.stroke();
          }
        }
      }
      animRef.current = requestAnimationFrame(draw);
    };
    animRef.current = requestAnimationFrame(draw);
    return () => { window.removeEventListener("resize", resize); cancelAnimationFrame(animRef.current); };
  }, []);

  return <canvas ref={canvasRef} style={{ position: "fixed", inset: 0, width: "100%", height: "100%", zIndex: 0, opacity: entered ? 0.35 : 0.7, transition: "opacity 1.5s ease", pointerEvents: "none" }} />;
}

// ─── Animated Matrix 3 Character ───
function Matrix3({ delay = 0 }) {
  const [displayChar, setDisplayChar] = useState("3");
  const chars = "0123456789アウエカΣΩΔΘ∞◈⬡✧⚛";
  const intervalRef = useRef(null);
  const glitchIntervalRef = useRef(null);
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    let count = 0;
    const startDelay = setTimeout(() => {
      intervalRef.current = setInterval(() => {
        count++;
        if (count > 12 + Math.random() * 8) {
          setDisplayChar("3");
          setSettled(true);
          clearInterval(intervalRef.current);
          // After settling, glitch frequently
          glitchIntervalRef.current = setInterval(() => {
            if (Math.random() > 0.25) {
              // Multi-frame glitch sequence — flicker through several chars
              const glitchCount = 1 + Math.floor(Math.random() * 4);
              let i = 0;
              const flicker = () => {
                if (i >= glitchCount) {
                  setDisplayChar("3");
                  return;
                }
                const glitchChar = chars[Math.floor(Math.random() * chars.length)];
                setDisplayChar(glitchChar);
                i++;
                setTimeout(flicker, 40 + Math.random() * 60);
              };
              flicker();
            }
          }, 400 + Math.random() * 800);
          return;
        }
        setDisplayChar(chars[Math.floor(Math.random() * chars.length)]);
      }, 60 + Math.random() * 40);
    }, delay);
    return () => {
      clearTimeout(startDelay);
      clearInterval(intervalRef.current);
      clearInterval(glitchIntervalRef.current);
    };
  }, []);

  return (
    <span style={{
      display: "inline-block",
      color: "#00ff8c",
      textShadow: settled
        ? "0 0 20px rgba(0,255,140,0.8), 0 0 40px rgba(0,255,140,0.4), 0 0 60px rgba(0,255,140,0.2)"
        : "0 0 10px rgba(0,255,140,0.5)",
      transition: "text-shadow 0.3s ease",
      position: "relative",
      minWidth: "0.6em",
      textAlign: "center",
    }}>
      {displayChar}
      {/* Trailing column of fading numbers below the 3 */}
      <span style={{
        position: "absolute",
        left: "50%",
        top: "100%",
        transform: "translateX(-50%)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        pointerEvents: "none",
      }}>
        {[0,1,2,3,4].map(i => (
          <MatrixTrailChar key={i} index={i} settled={settled} />
        ))}
      </span>
    </span>
  );
}

function MatrixTrailChar({ index, settled }) {
  const [char, setChar] = useState("");
  const chars = "0123456789ΣΩΔ∞◈3";

  useEffect(() => {
    const interval = setInterval(() => {
      setChar(chars[Math.floor(Math.random() * chars.length)]);
    }, 100 + index * 50 + Math.random() * 80);
    return () => clearInterval(interval);
  }, []);

  const opacity = settled ? (0.35 - index * 0.07) : (0.2 - index * 0.04);
  const size = Math.max(8, 14 - index * 2);

  return (
    <span style={{
      fontSize: size,
      color: "#00ff8c",
      opacity: Math.max(0, opacity),
      fontFamily: "'JetBrains Mono', monospace",
      lineHeight: 1.4,
      textShadow: `0 0 ${6 - index}px rgba(0,255,140,${0.3 - index * 0.06})`,
    }}>{char}</span>
  );
}

// ─── Landing Page Title ───
function LandingTitle() {
  // TH3 AWAR3N3SS — each of the three 3s gets the matrix glitch treatment
  const titleStyle = {
    fontSize: "clamp(28px, 5vw, 56px)",
    fontWeight: 600,
    fontFamily: "'Orbitron', sans-serif",
    lineHeight: 1.2,
    marginBottom: 40,
    letterSpacing: 4,
    color: "#ffffff",
    textShadow: "0 0 40px rgba(0,255,140,0.4), 0 0 80px rgba(0,255,140,0.2)",
    animation: "breathe 4s ease-in-out infinite",
    position: "relative",
    display: "inline-block",
    paddingBottom: 30,
  };

  return (
    <h1 style={titleStyle}>
      {"TH"}
      <Matrix3 delay={200} />
      {" AWAR"}
      <Matrix3 delay={500} />
      {"N"}
      <Matrix3 delay={800} />
      {"SS"}
    </h1>
  );
}

// ─── Energy Orb ───
function EnergyOrb({ score, mood }) {
  const hueMap = { dark: 155, light: 155 };
  const hue = hueMap[mood] || 155;
  return (
    <>
      <style>{`@keyframes orbPulse { 0%, 100% { transform: scale(1); filter: brightness(1); } 50% { transform: scale(1.08); filter: brightness(1.3); } }`}</style>
      <div style={{ width: 180, height: 180, borderRadius: "50%", background: `radial-gradient(circle at 40% 35%, hsla(${hue}, 90%, 75%, 0.9), hsla(${hue}, 70%, 30%, 0.6) 60%, transparent 80%)`, boxShadow: `0 0 60px hsla(${hue}, 80%, 50%, 0.5), 0 0 120px hsla(${hue}, 60%, 40%, 0.3), inset 0 0 40px hsla(${hue}, 90%, 70%, 0.3)`, animation: "orbPulse 4s ease-in-out infinite", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column" }}>
        <span style={{ fontSize: 36, fontWeight: 700, color: "var(--text)", textShadow: `0 0 20px hsla(${hue}, 80%, 60%, 0.8)`, fontFamily: "'Orbitron', sans-serif" }}>{score}</span>
        <span style={{ fontSize: 10, letterSpacing: 3, textTransform: "uppercase", color: "var(--text-muted)", marginTop: 4 }}>vibration</span>
      </div>
    </>
  );
}

// ─── Chakra Meter ───
function ChakraMeter({ levels }) {
  const chakras = [
    { name: "Crown", color: "#a855f7", emoji: "👑" }, { name: "Third Eye", color: "#6366f1", emoji: "👁" },
    { name: "Throat", color: "#06b6d4", emoji: "💎" }, { name: "Heart", color: "#22c55e", emoji: "💚" },
    { name: "Solar Plexus", color: "#eab308", emoji: "☀️" }, { name: "Sacral", color: "#f97316", emoji: "🔥" },
    { name: "Root", color: "#ef4444", emoji: "🌍" },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {chakras.map((c, i) => (
        <div key={c.name} style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ width: 24, textAlign: "center", fontSize: 14 }}>{c.emoji}</span>
          <span style={{ width: 80, fontSize: 11, color: "var(--text-muted)", letterSpacing: 1, textTransform: "uppercase", fontFamily: "'JetBrains Mono', monospace" }}>{c.name}</span>
          <div style={{ flex: 1, height: 6, background: "var(--card-bg)", borderRadius: 3, overflow: "hidden" }}>
            <div style={{ width: `${levels[i]}%`, height: "100%", borderRadius: 3, background: `linear-gradient(90deg, ${c.color}88, ${c.color})`, boxShadow: `0 0 10px ${c.color}66`, transition: "width 1s ease" }} />
          </div>
          <span style={{ fontSize: 11, color: c.color, fontFamily: "'Orbitron', sans-serif", width: 30, textAlign: "right" }}>{levels[i]}%</span>
        </div>
      ))}
    </div>
  );
}

// ─── Glass Card ───
function GlassCard({ children, style = {}, onClick, hover = true }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} onClick={onClick}
      style={{
        background: hovered && hover ? "var(--card-bg)" : "var(--card-bg)",
        backdropFilter: "blur(24px) saturate(1.2)",
        WebkitBackdropFilter: "blur(24px) saturate(1.2)",
        border: hovered && hover
          ? "1px solid var(--card-border)"
          : "1px solid var(--card-border)",
        borderRadius: 20,
        padding: 28,
        transition: "all 0.4s cubic-bezier(0.22, 1, 0.36, 1)",
        transform: hovered && hover ? "translateY(-3px) scale(1.005)" : "none",
        boxShadow: hovered && hover
          ? "0 16px 48px rgba(0,0,0,0.12), 0 0 1px var(--card-border)"
          : "0 4px 24px rgba(0,0,0,0.08), inset 0 1px 0 var(--card-border)",
        cursor: onClick ? "pointer" : "default",
        ...style,
      }}>
      {children}
    </div>
  );
}

// ─── Breathing Guide ───
function BreathingGuide() {
  const [phase, setPhase] = useState("inhale");
  const [count, setCount] = useState(4);
  const [active, setActive] = useState(false);
  const timerRef = useRef(null);
  useEffect(() => {
    if (!active) return;
    let step = 0, idx = 0;
    const phases = [{ p: "inhale", d: 4 }, { p: "hold", d: 7 }, { p: "exhale", d: 8 }];
    const tick = () => {
      const current = phases[idx];
      setPhase(current.p); setCount(current.d - step); step++;
      if (step > current.d) { step = 0; idx = (idx + 1) % phases.length; }
      timerRef.current = setTimeout(tick, 1000);
    };
    tick();
    return () => clearTimeout(timerRef.current);
  }, [active]);
  const ringSize = phase === "inhale" ? 200 : phase === "hold" ? 200 : 120;
  const ringColor = phase === "inhale" ? "#00ff8c" : phase === "hold" ? "#a78bfa" : "#06b6d4";
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 24 }}>
      <div style={{ width: ringSize, height: ringSize, borderRadius: "50%", border: `2px solid ${ringColor}`, boxShadow: `0 0 40px ${ringColor}44, inset 0 0 30px ${ringColor}22`, transition: "all 2s cubic-bezier(0.22, 1, 0.36, 1)", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column" }}>
        {active ? (<><span style={{ fontSize: 14, textTransform: "uppercase", letterSpacing: 4, color: ringColor, fontFamily: "'Orbitron', sans-serif" }}>{phase}</span><span style={{ fontSize: 36, color: "var(--text)", fontWeight: 200, marginTop: 4 }}>{count}</span></>) : (<span style={{ fontSize: 12, color: "var(--text-faint)", letterSpacing: 2 }}>READY</span>)}
      </div>
      <button onClick={() => setActive(!active)} style={{ background: active ? "rgba(255,60,60,0.15)" : "rgba(0,255,140,0.1)", border: `1px solid ${active ? "rgba(255,60,60,0.3)" : "rgba(0,255,140,0.3)"}`, color: active ? "#ff6b6b" : "#00ff8c", padding: "10px 28px", borderRadius: 8, cursor: "pointer", fontSize: 12, letterSpacing: 3, textTransform: "uppercase", fontFamily: "'Orbitron', sans-serif", transition: "all 0.3s ease" }}>
        {active ? "STOP" : "BEGIN BREATHWORK"}
      </button>
    </div>
  );
}

// ─── AI Guide Chat ───
function AIGuide() {
  const [msgs, setMsgs] = useState([{ from: "ai", text: "Welcome, seeker. I am your guide within the signal. What aspect of your journey would you like to explore today?" }]);
  const [input, setInput] = useState("");
  const responses = [
    "Your awareness of this question is itself a form of growth. Consider sitting with it during your next meditation.",
    "The body carries wisdom the mind overlooks. What is your body telling you right now?",
    "Growth is not linear. Some days the signal is stronger than others. Honor the rhythm.",
    "Try this: before your next meal, take three conscious breaths. Notice how it changes the experience.",
    "The path to higher vibration begins with radical honesty with yourself. What truth are you avoiding?",
    "Consider a digital sunset tonight — no screens after 8pm. Notice what arises in the silence.",
    "Your frequency rises when you align action with intention. What is one small alignment you can make today?",
    "Tesla understood that 3, 6, and 9 are the keys to the universe. Observe these patterns in your daily life.",
    "The ether is not empty — it is the medium through which all energy flows. Tune into it.",
  ];
  const send = () => {
    if (!input.trim()) return;
    const newMsgs = [...msgs, { from: "user", text: input }];
    setInput("");
    setTimeout(() => { setMsgs([...newMsgs, { from: "ai", text: responses[Math.floor(Math.random() * responses.length)] }]); }, 800 + Math.random() * 600);
    setMsgs(newMsgs);
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", height: 380 }}>
      <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 12, paddingRight: 8, marginBottom: 16 }}>
        {msgs.map((m, i) => (
          <div key={i} style={{ alignSelf: m.from === "user" ? "flex-end" : "flex-start", maxWidth: "80%", padding: "12px 16px", borderRadius: 12, background: m.from === "user" ? "rgba(0,255,140,0.1)" : "rgba(255,255,255,0.05)", border: `1px solid ${m.from === "user" ? "rgba(0,255,140,0.2)" : "rgba(255,255,255,0.08)"}`, color: m.from === "user" ? "#a0ffc8" : "rgba(255,255,255,0.75)", fontSize: 14, lineHeight: 1.6 }}>
            {m.from === "ai" && <span style={{ fontSize: 10, color: "#a78bfa", letterSpacing: 2, display: "block", marginBottom: 6 }}>◈ TH3 AWAR3N3SS GUIDE</span>}
            {m.text}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} placeholder="Ask the guide..." style={{ flex: 1, background: "var(--card-bg)", border: "1px solid var(--input-border)", borderRadius: 8, padding: "12px 16px", color: "var(--text)", fontSize: 14, outline: "none", fontFamily: "'JetBrains Mono', monospace" }} />
        <button onClick={send} style={{ background: "rgba(0,255,140,0.12)", border: "1px solid rgba(0,255,140,0.3)", borderRadius: 8, padding: "0 20px", color: "#00ff8c", cursor: "pointer", fontSize: 12, letterSpacing: 2, fontFamily: "'Orbitron', sans-serif" }}>SEND</button>
      </div>
    </div>
  );
}

// ─── Community Nodes ───
function CommunityField() {
  const nodes = useMemo(() => Array.from({ length: 24 }, (_, i) => ({ x: 15 + Math.random() * 70, y: 10 + Math.random() * 80, size: 6 + Math.random() * 10, hue: [140, 270, 190, 320][Math.floor(Math.random() * 4)], name: ["Aria","Zeph","Luna","Kael","Nyx","Sol","Indra","Sage","Echo","Flux","Vera","Orion","Mira","Zenith","Aura","Blaze","Cipher","Drift","Ember","Fable","Glyph","Halo","Ion","Jade"][i], level: Math.floor(Math.random() * 30 + 10), pulse: Math.random() * 4 + 2 })), []);
  const edges = useMemo(() => { const e = []; nodes.forEach((n, i) => { for (let c = 0; c < Math.floor(Math.random() * 2) + 1; c++) { e.push([i, (i + Math.floor(Math.random() * 5) + 1) % nodes.length]); } }); return e; }, []);
  return (
    <div style={{ position: "relative", width: "100%", height: 400 }}>
      <svg width="100%" height="100%" viewBox="0 0 100 100" style={{ position: "absolute", inset: 0 }}>
        {edges.map(([a, b], i) => <line key={i} x1={nodes[a].x} y1={nodes[a].y} x2={nodes[b].x} y2={nodes[b].y} stroke="rgba(0,255,140,0.08)" strokeWidth="0.2" />)}
      </svg>
      {nodes.map((n, i) => <div key={i} title={`${n.name} — Level ${n.level}`} style={{ position: "absolute", left: `${n.x}%`, top: `${n.y}%`, width: n.size, height: n.size, borderRadius: "50%", background: `hsla(${n.hue}, 70%, 55%, 0.7)`, boxShadow: `0 0 ${n.size}px hsla(${n.hue}, 80%, 50%, 0.4)`, animation: `orbPulse ${n.pulse}s ease-in-out infinite`, cursor: "pointer", transform: "translate(-50%, -50%)" }} />)}
    </div>
  );
}

// ─── World Map ───
function WorldMap() {
  const [dots, setDots] = useState([]);
  useEffect(() => {
    const interval = setInterval(() => { setDots(d => [...d.filter(dd => dd.opacity > 0).slice(-30), { x: 10 + Math.random() * 80, y: 15 + Math.random() * 65, id: Date.now(), opacity: 1 }]); }, 600);
    return () => clearInterval(interval);
  }, []);
  return (
    <div style={{ position: "relative", width: "100%", height: 260, background: "var(--card-bg)", borderRadius: 12, overflow: "hidden", border: "1px solid var(--card-border)" }}>
      {dots.map(d => <div key={d.id} style={{ position: "absolute", left: `${d.x}%`, top: `${d.y}%`, width: 6, height: 6, borderRadius: "50%", background: "#00ff8c", boxShadow: "0 0 12px #00ff8c88", animation: "orbPulse 2s ease-out forwards", transform: "translate(-50%, -50%)" }} />)}
      <div style={{ position: "absolute", bottom: 16, left: 20, fontSize: 11, color: "var(--text-faint)", letterSpacing: 2, fontFamily: "'JetBrains Mono', monospace" }}>LIVE — 1,247 CONNECTED SOULS</div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// KNOWLEDGE PORTAL — MASSIVE EXPANSION
// ═══════════════════════════════════════════════════════════════

const KNOWLEDGE_CATEGORIES = [
  {
    id: "ebooks",
    icon: "📚",
    title: "eBook Vault",
    color: "#a78bfa",
    desc: "Forbidden knowledge, suppressed science, and consciousness-expanding literature.",
    items: [
      { title: "The Kybalion — Three Initiates", desc: "The 7 Hermetic principles that govern all reality. The foundation of metaphysical understanding.", tags: ["HERMETIC", "CLASSIC"], status: "free", pages: 223 },
      { title: "The Secret Teachings of All Ages — Manly P. Hall", desc: "An encyclopedic outline of Masonic, Hermetic, Qabbalistic and Rosicrucian symbolical philosophy.", tags: ["ESOTERIC", "ENCYCLOPEDIA"], status: "free", pages: 768 },
      { title: "The Science of Getting Rich — Wallace D. Wattles", desc: "The original manifestation blueprint. Vibrational alignment with abundance through exact science.", tags: ["MANIFESTATION", "CLASSIC"], status: "free", pages: 89 },
      { title: "As A Man Thinketh — James Allen", desc: "Your thoughts shape your reality. The foundational text on mind-body-reality connection.", tags: ["MINDSET", "CLASSIC"], status: "free", pages: 68 },
      { title: "The Emerald Tablets of Thoth", desc: "Ancient wisdom attributed to Thoth the Atlantean. Consciousness, alchemy, and dimensional travel.", tags: ["ANCIENT", "ESOTERIC"], status: "free", pages: 54 },
      { title: "The Law of One — Ra Material", desc: "Channeled material exploring the nature of reality, densities of consciousness, and unity.", tags: ["CHANNELED", "METAPHYSICS"], status: "free", pages: 1800 },
      { title: "Autobiography of a Yogi — Paramahansa Yogananda", desc: "The spiritual classic that awakened millions. Steve Jobs had one copy — read it yearly.", tags: ["YOGA", "AUTOBIOGRAPHY"], status: "free", pages: 498 },
      { title: "The Tao Te Ching — Lao Tzu", desc: "81 verses on the nature of existence, flow, and the way. Eternal simplicity.", tags: ["TAOISM", "CLASSIC"], status: "free", pages: 96 },
      { title: "Children of the Matrix — David Icke", desc: "How an interdimensional race has controlled the world for thousands of years — and still does. Icke connects bloodlines, ancient history, and modern power structures into a unified theory of control. Essential reading for understanding the reptilian hypothesis and the hidden architecture of human society.", tags: ["ICKE", "MATRIX", "CONTROL"], status: "free", pages: 501 },
      { title: "Alice in Wonderland and the World Trade Center Disaster — David Icke", desc: "Icke's deep analysis of 9/11 and the agenda behind it. Examines the evidence that the official story is a fabrication, and connects the event to a larger pattern of manufactured crises designed to centralize global power. Written in the immediate aftermath with remarkable foresight.", tags: ["ICKE", "9/11", "FALSE FLAG"], status: "free", pages: 485 },
      { title: "The Secret Doctrine — Helena Blavatsky", desc: "The foundational text of Theosophy. Synthesis of science, religion, and philosophy exploring cosmic evolution, root races, and the hidden history of humanity. Dense but world-changing.", tags: ["THEOSOPHY", "OCCULT"], status: "free", pages: 1475 },
      { title: "The Nag Hammadi Library — Gnostic Texts", desc: "The complete collection of ancient Gnostic scriptures discovered in Egypt in 1945. Includes the Gospel of Thomas, the Gospel of Philip, and texts describing the Archons — rulers who feed on human energy.", tags: ["GNOSTIC", "ARCHONS", "ANCIENT"], status: "free", pages: 549 },
      { title: "The Corpus Hermeticum — Hermes Trismegistus", desc: "The original Hermetic texts. 'As above, so below' originates here. The foundation of Western esotericism, alchemy, and the understanding that consciousness creates reality.", tags: ["HERMETIC", "ALCHEMY"], status: "free", pages: 128 },
      { title: "The Book of Enoch", desc: "Removed from the Biblical canon but preserved in Ethiopian tradition. Details the Watchers — beings who descended to Earth and taught humanity forbidden knowledge. Angels, Nephilim, and cosmic secrets.", tags: ["BIBLICAL", "WATCHERS", "NEPHILIM"], status: "free", pages: 108 },
      { title: "Isis Unveiled — Helena Blavatsky", desc: "A master key to the mysteries of ancient and modern science and theology. Blavatsky dismantles both religious dogma and scientific materialism, revealing the hidden thread connecting all traditions.", tags: ["THEOSOPHY", "MYSTERY"], status: "free", pages: 1328 },
      { title: "The Bhagavad Gita", desc: "The 700-verse Hindu scripture where Krishna reveals the nature of reality, consciousness, and duty to the warrior Arjuna. The most concise guide to understanding the self, karma, and liberation ever written.", tags: ["HINDU", "CONSCIOUSNESS"], status: "free", pages: 282 },
      { title: "The Tibetan Book of the Dead — Bardo Thodol", desc: "The ancient Tibetan guide to navigating consciousness after death. Describes the bardos — intermediate states between lives — and how awareness determines your next incarnation.", tags: ["TIBETAN", "DEATH", "REBIRTH"], status: "free", pages: 220 },
      { title: "Behold a Pale Horse — William Cooper", desc: "Former Naval Intelligence officer reveals secret government projects, UFO cover-ups, the JFK assassination, and the blueprint for a New World Order. Cooper was killed in 2001.", tags: ["COOPER", "NWO", "INTELLIGENCE"], status: "free", pages: 500 },
      { title: "The Protocols of the Learned Elders of Zion — (Controversial)", desc: "One of the most debated documents in history. Regardless of its disputed origins, it reads as a blueprint for controlling populations through media, finance, and division. Read critically.", tags: ["CONTROVERSIAL", "CONTROL"], status: "free", pages: 78 },
      { title: "Morals and Dogma — Albert Pike", desc: "The definitive text of Scottish Rite Freemasonry by its Grand Commander. Reveals the philosophical and esoteric teachings behind each degree. What Masons are actually taught behind closed doors.", tags: ["MASONIC", "ESOTERIC"], status: "free", pages: 861 },
      { title: "The Yoga Sutras of Patanjali", desc: "196 sutras outlining the eight limbs of yoga and the science of consciousness. Written 2,000+ years ago, it remains the most precise manual for mastering the mind ever composed.", tags: ["YOGA", "CONSCIOUSNESS"], status: "free", pages: 96 },
      { title: "Think and Grow Rich — Napoleon Hill", desc: "Distilled from 20 years of studying the wealthiest people alive. The 13 principles of success and manifestation that created more millionaires than any other book.", tags: ["MANIFESTATION", "WEALTH"], status: "free", pages: 233 },
    ]
  },
  {
    id: "369",
    icon: "🔢",
    title: "The 369 Code",
    color: "#eab308",
    desc: "Tesla's key to the universe. Vortex mathematics, manifestation codes, and the divine frequency pattern.",
    items: [
      { title: "Tesla's 369 — The Key to the Universe", desc: "Why Tesla was obsessed with 3, 6, and 9. Vortex math reveals the fingerprint of creation in every natural pattern.", tags: ["TESLA", "MATH"], locked: false },
      { title: "369 Manifestation Method", desc: "Write your intention 3x morning, 6x afternoon, 9x evening. The neurological and energetic science behind why it works.", tags: ["MANIFESTATION", "PRACTICE"], locked: false },
      { title: "Vortex Mathematics — Marko Rodin", desc: "The Rodin Coil and toroidal energy. How 3-6-9 maps the geometry of electromagnetic fields and zero-point energy.", tags: ["VORTEX", "GEOMETRY"], locked: false },
      { title: "Digital Root Patterns in Nature", desc: "From sunflower spirals to DNA — how digital root reduction always reveals 3, 6, 9 as the governing framework.", tags: ["NATURE", "PATTERNS"], locked: false },
      { title: "Frequency 369Hz — The Creation Tone", desc: "Solfeggio frequencies and their relationship to the 369 pattern. Sound as architecture of matter.", tags: ["SOUND", "FREQUENCY"], locked: false },
      { title: "Sacred Geometry & The 369 Blueprint", desc: "How the Flower of Life, Metatron's Cube, and all Platonic solids encode 3, 6, 9 at their mathematical core.", tags: ["GEOMETRY", "SACRED"], locked: false },
    ]
  },
  {
    id: "ether",
    icon: "🌊",
    title: "Ether & Scalar Energy",
    color: "#06b6d4",
    desc: "The suppressed science of the luminiferous ether, scalar waves, and the fabric of reality they tried to erase.",
    items: [
      { title: "What Is the Ether?", desc: "Before Einstein, every physicist knew space wasn't empty. The ether is the medium through which light, gravity, and consciousness propagate.", tags: ["ETHER", "FOUNDATION"], locked: false },
      { title: "Scalar Waves — Beyond Hertzian", desc: "Tesla's longitudinal waves that pass through any material, carry energy without loss, and may be the mechanism of thought transference.", tags: ["SCALAR", "TESLA"], locked: false },
      { title: "The Michelson-Morley Cover-Up", desc: "Why the 1887 experiment didn't actually disprove the ether — and the political reasons it was declared so.", tags: ["HISTORY", "SUPPRESSED"], locked: false },
      { title: "Zero-Point Energy Field", desc: "Quantum vacuum fluctuations prove space is teeming with energy. The modern rediscovery of what ancients called ether.", tags: ["QUANTUM", "ENERGY"], locked: false },
      { title: "Scalar Healing Technologies", desc: "How scalar fields interact with the body's biofield. Cellular voltage, DNA antenna theory, and frequency restoration.", tags: ["HEALING", "BIOFIELD"], locked: false },
      { title: "Tom Bearden's MEG & Free Energy", desc: "Motionless electromagnetic generators and over-unity devices. The engineering principles behind tapping the vacuum.", tags: ["FREE ENERGY", "ENGINEERING"], locked: false },
      { title: "Torsion Fields — Russian Research", desc: "Decades of Russian scientific research into torsion fields — spin waves in the physical vacuum that carry information.", tags: ["TORSION", "RESEARCH"], locked: false },
    ]
  },
  {
    id: "copper",
    icon: "⚡",
    title: "Copper & Energy Tech",
    color: "#f97316",
    desc: "Copper wire technology, orgone energy, electromagnetic healing, and building your own energy devices.",
    items: [
      { title: "Copper — The Sacred Conductor", desc: "Why every ancient civilization revered copper. Its unique electromagnetic properties, antimicrobial power, and spiritual significance.", tags: ["COPPER", "FOUNDATION"], locked: false },
      { title: "Building a Copper Tensor Ring", desc: "Step-by-step guide to creating tensor rings using sacred cubit measurements. Water structuring, pain relief, and field generation.", tags: ["DIY", "TENSOR"], locked: false },
      { title: "The Orgone Accumulator", desc: "Wilhelm Reich's discovery of orgone energy. How layered organic and metallic materials concentrate life force energy.", tags: ["ORGONE", "REICH"], locked: false },
      { title: "Copper Coils & Vortex Energy", desc: "Rodin coils, bifilar pancake coils, and caduceus windings. How copper wire geometry creates scalar fields.", tags: ["COILS", "VORTEX"], locked: false },
      { title: "Earthing & Copper Grounding", desc: "Connecting to Earth's electromagnetic field through copper grounding rods. Reducing inflammation, improving sleep, resetting circadian rhythm.", tags: ["EARTHING", "HEALTH"], locked: false },
      { title: "Copper Water Vessels — Ancient Practice", desc: "Storing water in copper vessels for 8+ hours. Oligodynamic effect, alkalinity, and what Ayurveda has known for 5,000 years.", tags: ["WATER", "AYURVEDA"], locked: false },
      { title: "Building a Lakhovsky MWO", desc: "The Multi-Wave Oscillator. How copper antenna arrays broadcast a spectrum of frequencies that restore cellular vitality.", tags: ["MWO", "ADVANCED"], locked: true },
    ]
  },
  {
    id: "awakening",
    icon: "👁",
    title: "Awakening & Hidden Truths",
    color: "#ef4444",
    desc: "The reality behind the systems. Government programs, suppressed history, and the architecture of control.",
    items: [
      { title: "Operation Mockingbird & Media Control", desc: "CIA's systematic infiltration of mainstream media. Understanding the lens through which your reality is constructed.", tags: ["CIA", "MEDIA"], locked: false },
      { title: "The Federal Reserve — Private Control", desc: "How a private banking cartel gained control of the money supply in 1913. The debt system that enslaves nations.", tags: ["BANKING", "MONETARY"], locked: false },
      { title: "MKUltra & Mind Control Programs", desc: "Declassified CIA documents proving decades of mind control experimentation. Understanding psychic driving and trauma-based programming.", tags: ["MKULTRA", "DECLASSIFIED"], locked: false },
      { title: "Water Fluoridation — The Full Picture", desc: "Industrial waste product added to drinking water. Pineal gland calcification, IQ studies, and the countries that banned it.", tags: ["FLUORIDE", "HEALTH"], locked: false },
      { title: "The Pineal Gland — Your Third Eye", desc: "DMT production, melatonin regulation, and why every ancient tradition knew this gland was the seat of consciousness.", tags: ["PINEAL", "CONSCIOUSNESS"], locked: false },
      { title: "Suppressed Medical Technologies", desc: "Royal Rife's frequency machine, Hulda Clark's zapper, and the pattern of inventors whose work threatened pharmaceutical revenue.", tags: ["MEDICAL", "SUPPRESSED"], locked: false },
      { title: "Tartaria & The Mud Flood Theory", desc: "Architectural anomalies, buried buildings, and the possibility of a recent reset. Old world technology and free energy infrastructure.", tags: ["HISTORY", "ALTERNATIVE"], locked: false },
      { title: "The Declassified Files — Gateway Process", desc: "The CIA's own research into out-of-body experiences, remote viewing, and the holographic nature of reality.", tags: ["CIA", "GATEWAY"], locked: false },
    ]
  },
  {
    id: "frequency",
    icon: "〰️",
    title: "Frequency & Sound Healing",
    color: "#22c55e",
    desc: "Solfeggio frequencies, cymatics, binaural beats, and using sound as medicine.",
    items: [
      { title: "The Solfeggio Scale — Original Frequencies", desc: "174Hz, 285Hz, 396Hz, 417Hz, 528Hz, 639Hz, 741Hz, 852Hz, 963Hz. What each frequency does and why they were hidden.", tags: ["SOLFEGGIO", "HEALING"], locked: false },
      { title: "528Hz — The Love Frequency", desc: "DNA repair frequency. How Dr. Leonard Horowitz rediscovered the miracle tone used by ancient priests.", tags: ["528HZ", "DNA"], locked: false },
      { title: "432Hz vs 440Hz — The Tuning Conspiracy", desc: "Why music was retuned from 432Hz (natural harmonic) to 440Hz in 1939. The Rockefeller connection.", tags: ["432HZ", "MUSIC"], locked: false },
      { title: "Cymatics — Sound Made Visible", desc: "How frequencies create geometric patterns in matter. The visual proof that vibration creates structure.", tags: ["CYMATICS", "VISUAL"], locked: false },
      { title: "Binaural Beats & Brainwave Entrainment", desc: "Delta, theta, alpha, beta, gamma. Tuning your brain state with precisely calibrated audio frequencies.", tags: ["BINAURAL", "BRAIN"], locked: false },
      { title: "Dr. Emoto's Water Experiments", desc: "How words, music, and intention physically alter water crystal structure. You are 70% water.", tags: ["WATER", "CONSCIOUSNESS"], locked: false },
    ]
  },
  {
    id: "body",
    icon: "🧬",
    title: "Body Optimization",
    color: "#a855f7",
    desc: "Detox protocols, fasting science, sun gazing, grounding, and treating the body as the temple it is.",
    items: [
      { title: "The Master Cleanse & Detox Protocols", desc: "Liver flushes, parasite cleanses, heavy metal detox. A systematic approach to removing what shouldn't be there.", tags: ["DETOX", "CLEANSE"], locked: false },
      { title: "Dry Fasting — The Ultimate Reset", desc: "Beyond water fasting. How dry fasting accelerates autophagy, stem cell regeneration, and deep cellular repair.", tags: ["FASTING", "ADVANCED"], locked: false },
      { title: "Sun Gazing — The HRM Protocol", desc: "Safe sun gazing methodology. Activating the pineal gland, reducing hunger, and charging the body with photonic energy.", tags: ["SUN", "PINEAL"], locked: false },
      { title: "Structured Water — The Fourth Phase", desc: "Gerald Pollack's EZ water research. How water in your cells differs from bulk water and why it matters.", tags: ["WATER", "SCIENCE"], locked: false },
      { title: "Earthing & Grounding Science", desc: "Free electrons from the Earth reduce inflammation markers. Peer-reviewed studies on grounding and chronic disease.", tags: ["GROUNDING", "SCIENCE"], locked: false },
      { title: "The Alkaline Body — pH Balance", desc: "Cancer cannot thrive in an alkaline environment. Mapping food pH and creating an internal ecosystem hostile to disease.", tags: ["ALKALINE", "NUTRITION"], locked: false },
      { title: "Breathwork & The Wim Hof Method", desc: "Cold exposure + breathing = voluntarily influencing the autonomic nervous system. The science is now proven.", tags: ["BREATHWORK", "COLD"], locked: false },
      { title: "Circadian Biology & Light Hygiene", desc: "Blue light toxicity, red light therapy, and aligning your biology with the sun. You are a light-driven organism.", tags: ["LIGHT", "CIRCADIAN"], locked: false },
    ]
  },
  {
    id: "consciousness",
    icon: "🔮",
    title: "Consciousness & Reality",
    color: "#ec4899",
    desc: "Simulation theory, quantum consciousness, manifestation physics, and the nature of what you call real.",
    items: [
      { title: "The Holographic Universe", desc: "David Bohm and Karl Pribram's model. The brain as a frequency decoder and reality as an interference pattern.", tags: ["HOLOGRAPHIC", "PHYSICS"], locked: false },
      { title: "Quantum Observer Effect", desc: "Particles don't exist in a definite state until observed. What this truly implies about consciousness and reality creation.", tags: ["QUANTUM", "OBSERVER"], locked: false },
      { title: "The CIA Gateway Tapes — Full Analysis", desc: "Hemi-Sync technology, Focus levels, and the CIA's conclusion that consciousness can transcend space-time.", tags: ["CIA", "GATEWAY"], locked: false },
      { title: "Remote Viewing — Documented Cases", desc: "The Stargate Program, Ingo Swann, Pat Price, and Joe McMoneagle. Decades of military-validated psychic intelligence.", tags: ["PSI", "MILITARY"], locked: false },
      { title: "The Law of Attraction — The Physics", desc: "Beyond 'The Secret.' Quantum field theory, retrocausality, and the actual mechanism by which intention shapes probability.", tags: ["LOA", "QUANTUM"], locked: false },
      { title: "Near-Death Experiences — The Data", desc: "Verified perception during clinical death. The AWARE study and what 50 years of NDE research conclusively shows.", tags: ["NDE", "RESEARCH"], locked: false },
      { title: "Nikola Tesla — The Untold Story", desc: "Free energy, wireless power transmission, earthquake machines, and why his lab was raided. The man who knew too much.", tags: ["TESLA", "BIOGRAPHY"], locked: false },
    ]
  },
];

// ─── Knowledge Portal Component ───
function KnowledgePortal() {
  const [activeCat, setActiveCat] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [bookmarks, setBookmarks] = useState(new Set());
  const [viewMode, setViewMode] = useState("grid");
  const [expandedItem, setExpandedItem] = useState(null);

  const toggleBookmark = (id) => {
    setBookmarks(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const filteredCategories = searchTerm
    ? KNOWLEDGE_CATEGORIES.map(cat => ({
        ...cat,
        items: cat.items.filter(item =>
          item.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
          item.desc.toLowerCase().includes(searchTerm.toLowerCase()) ||
          item.tags.some(t => t.toLowerCase().includes(searchTerm.toLowerCase()))
        )
      })).filter(cat => cat.items.length > 0)
    : KNOWLEDGE_CATEGORIES;

  const totalItems = KNOWLEDGE_CATEGORIES.reduce((a, c) => a + c.items.length, 0);

  // Category detail view
  if (activeCat) {
    const cat = KNOWLEDGE_CATEGORIES.find(c => c.id === activeCat);
    return (
      <div style={{ animation: "fadeInUp 0.4s ease" }}>
        {/* Back nav */}
        <button onClick={() => { setActiveCat(null); setExpandedItem(null); }} style={{
          background: "var(--card-bg)", border: "1px solid var(--card-border)",
          color: "var(--text-muted)", padding: "8px 18px", borderRadius: 8, cursor: "pointer",
          fontSize: 11, letterSpacing: 2, fontFamily: "'Orbitron', sans-serif", marginBottom: 24,
          display: "flex", alignItems: "center", gap: 8,
        }}>
          ← BACK TO PORTAL
        </button>

        {/* Category header */}
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 8 }}>
          <span style={{ fontSize: 40 }}>{cat.icon}</span>
          <div>
            <h2 style={{ fontSize: 24, fontWeight: 600, color: "var(--text)", fontFamily: "'Orbitron', sans-serif", margin: 0, letterSpacing: 1 }}>{cat.title}</h2>
            <p style={{ fontSize: 13, color: "var(--text-faint)", marginTop: 4, lineHeight: 1.6 }}>{cat.desc}</p>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 28, marginTop: 16 }}>
          <div style={{ fontSize: 11, color: cat.color, fontFamily: "'JetBrains Mono', monospace", letterSpacing: 1 }}>
            {cat.items.length} ENTRIES
          </div>
          <div style={{ flex: 1, height: 1, background: "var(--card-bg)" }} />
        </div>

        {/* Items */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {cat.items.map((item, idx) => {
            const itemId = `${cat.id}-${idx}`;
            const isExpanded = expandedItem === itemId;
            return (
              <GlassCard key={idx} onClick={() => setExpandedItem(isExpanded ? null : itemId)} style={{
                borderLeft: `3px solid ${item.locked ? "rgba(255,255,255,0.1)" : cat.color}`,
                opacity: item.locked ? 0.5 : 1,
                padding: isExpanded ? 28 : 22,
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                      <h3 style={{ fontSize: 15, fontWeight: 500, color: "var(--text)", margin: 0, fontFamily: "'Sora', sans-serif" }}>
                        {item.locked ? "🔒 " : ""}{item.title}
                      </h3>
                    </div>
                    <p style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.7, margin: 0 }}>{item.desc}</p>

                    {isExpanded && !item.locked && (
                      <div style={{ marginTop: 20, animation: "fadeInUp 0.3s ease" }}>
                        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
                          <button style={{ padding: "8px 20px", borderRadius: 6, background: `${cat.color}18`, border: `1px solid ${cat.color}40`, color: cat.color, cursor: "pointer", fontSize: 11, letterSpacing: 2, fontFamily: "'Orbitron', sans-serif" }}>
                            {item.status === "find" ? "FIND THIS BOOK" : item.pages ? "READ NOW" : "EXPLORE"}
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); toggleBookmark(itemId); }} style={{
                            padding: "8px 20px", borderRadius: 6,
                            background: bookmarks.has(itemId) ? "rgba(234,179,8,0.15)" : "rgba(255,255,255,0.03)",
                            border: `1px solid ${bookmarks.has(itemId) ? "rgba(234,179,8,0.3)" : "rgba(255,255,255,0.08)"}`,
                            color: bookmarks.has(itemId) ? "#eab308" : "rgba(255,255,255,0.4)",
                            cursor: "pointer", fontSize: 11, letterSpacing: 2, fontFamily: "'Orbitron', sans-serif",
                          }}>
                            {bookmarks.has(itemId) ? "★ SAVED" : "☆ SAVE"}
                          </button>
                        </div>
                        {item.pages && (
                          <div style={{ fontSize: 11, color: "var(--text-faint)", fontFamily: "'JetBrains Mono', monospace" }}>
                            {item.pages} pages • {item.status === "free" ? "FREE ACCESS" : item.status === "find" ? "SEARCH ONLINE • SUPPORT THE AUTHOR" : "PREMIUM"}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 12 }}>
                  {item.tags.map(t => (
                    <span key={t} style={{ fontSize: 9, padding: "2px 8px", borderRadius: 20, background: `${cat.color}12`, color: cat.color, border: `1px solid ${cat.color}25`, letterSpacing: 1 }}>{t}</span>
                  ))}
                </div>
              </GlassCard>
            );
          })}
        </div>

        {/* Unlock message for locked items */}
        {cat.items.some(i => i.locked) && (
          <div style={{ textAlign: "center", marginTop: 28, padding: 20, borderRadius: 12, border: "1px solid var(--card-border)", background: "var(--card-bg)" }}>
            <span style={{ fontSize: 11, color: "var(--text-faint)", letterSpacing: 2, fontFamily: "'Orbitron', sans-serif" }}>
              🔒 LOCKED LESSONS UNLOCK AS YOU FINISH MORE OF YOUR PATH
            </span>
          </div>
        )}
      </div>
    );
  }

  // ─── Main Portal View ───
  return (
    <div style={{ animation: "fadeInUp 0.5s ease" }}>
      {/* Portal Header */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
          <div style={{ width: 3, height: 28, background: "linear-gradient(to bottom, #00ff8c, #a78bfa)", borderRadius: 2 }} />
          <h2 style={{ fontSize: 22, fontWeight: 300, color: "var(--text)", fontFamily: "'Sora', sans-serif", margin: 0 }}>
            Knowledge Portal
          </h2>
        </div>
        <p style={{ fontSize: 13, color: "var(--text-faint)", lineHeight: 1.8, marginTop: 8 }}>
          {totalItems} entries across {KNOWLEDGE_CATEGORIES.length} domains. Suppressed science, ancient wisdom, hidden technology, and the truth they don't teach in schools.
        </p>
      </div>

      {/* Search Bar */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ position: "relative" }}>
          <input
            value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
            placeholder="Search all knowledge... (try: Tesla, copper, 528Hz, pineal)"
            style={{
              width: "100%", background: "var(--card-bg)", border: "1px solid var(--card-border)",
              borderRadius: 10, padding: "14px 20px 14px 44px", color: "var(--text)", fontSize: 14, outline: "none",
              fontFamily: "'JetBrains Mono', monospace", letterSpacing: 0.5,
            }}
          />
          <span style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", fontSize: 16, opacity: 0.3 }}>⌕</span>
        </div>
      </div>

      {/* Quick Access Tags */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 28 }}>
        {["TESLA", "369", "SCALAR", "COPPER", "PINEAL", "FLUORIDE", "FREQUENCIES", "FASTING", "ETHER", "FREE ENERGY"].map(tag => (
          <button key={tag} onClick={() => setSearchTerm(tag.toLowerCase())} style={{
            padding: "5px 14px", borderRadius: 20, background: "rgba(0,255,140,0.05)",
            border: "1px solid rgba(0,255,140,0.12)", color: "rgba(0,255,140,0.6)",
            cursor: "pointer", fontSize: 10, letterSpacing: 2, fontFamily: "'Orbitron', sans-serif",
            transition: "all 0.2s ease",
          }}>
            {tag}
          </button>
        ))}
      </div>

      {/* Stats Bar */}
      <div style={{ display: "flex", gap: 16, marginBottom: 32, flexWrap: "wrap" }}>
        {[
          { label: "Total Entries", value: totalItems, color: "#00ff8c" },
          { label: "eBooks", value: KNOWLEDGE_CATEGORIES[0].items.length, color: "#a78bfa" },
          { label: "Free Access", value: KNOWLEDGE_CATEGORIES.reduce((a, c) => a + c.items.filter(i => !i.locked).length, 0), color: "#06b6d4" },
          { label: "Bookmarked", value: bookmarks.size, color: "#eab308" },
        ].map(s => (
          <div key={s.label} style={{ flex: "1 1 130px", padding: "18px 20px", borderRadius: 12, textAlign: "center", background: `linear-gradient(135deg, ${s.color}08, ${s.color}03)`, border: `1px solid ${s.color}15`, boxShadow: `0 4px 20px ${s.color}08, inset 0 1px 0 rgba(255,255,255,0.03)` }}>
            <div style={{ fontSize: 24, fontWeight: 700, color: s.color, fontFamily: "'Orbitron', sans-serif", textShadow: `0 0 20px ${s.color}30` }}>{s.value}</div>
            <div style={{ fontSize: 9, color: "var(--text-faint)", letterSpacing: 2, textTransform: "uppercase", marginTop: 6, fontFamily: "'Sora', sans-serif", fontWeight: 500 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Search results or full grid */}
      {searchTerm && (
        <div style={{ marginBottom: 16, fontSize: 12, color: "var(--text-faint)", fontFamily: "'JetBrains Mono', monospace" }}>
          {filteredCategories.reduce((a, c) => a + c.items.length, 0)} results for "{searchTerm}"
          <button onClick={() => setSearchTerm("")} style={{ marginLeft: 12, background: "none", border: "none", color: "#00ff8c", cursor: "pointer", fontSize: 11, fontFamily: "'Orbitron', sans-serif" }}>CLEAR</button>
        </div>
      )}

      {/* Category Grid */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
        {filteredCategories.map(cat => (
          <GlassCard key={cat.id} onClick={() => { setActiveCat(cat.id); setSearchTerm(""); }} style={{
            flex: "1 1 320px", minWidth: 280, cursor: "pointer",
            borderTop: `2px solid ${cat.color}40`,
          }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 12 }}>
              <span style={{ fontSize: 32 }}>{cat.icon}</span>
              <span style={{ fontSize: 10, color: cat.color, fontFamily: "'JetBrains Mono', monospace", letterSpacing: 1, background: `${cat.color}12`, padding: "3px 10px", borderRadius: 6 }}>
                {cat.items.length} ENTRIES
              </span>
            </div>
            <h3 style={{ fontSize: 17, fontWeight: 600, color: "var(--text)", fontFamily: "'Orbitron', sans-serif", margin: "0 0 8px", letterSpacing: 1 }}>{cat.title}</h3>
            <p style={{ fontSize: 12, color: "var(--text-faint)", lineHeight: 1.7, margin: "0 0 16px" }}>{cat.desc}</p>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {cat.items.slice(0, 3).map(item => (
                <span key={item.title} style={{ fontSize: 9, padding: "2px 8px", borderRadius: 12, background: "var(--card-bg)", color: "var(--text-faint)", border: "1px solid var(--card-border)" }}>
                  {item.title.split(" — ")[0].split(" – ")[0].substring(0, 24)}
                </span>
              ))}
              {cat.items.length > 3 && <span style={{ fontSize: 9, padding: "2px 8px", color: cat.color }}>+{cat.items.length - 3} more</span>}
            </div>
            <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 10, color: cat.color, letterSpacing: 3, fontFamily: "'Orbitron', sans-serif", fontWeight: 600, textShadow: `0 0 10px ${cat.color}30` }}>ENTER →</span>
              <div style={{ flex: 1, height: 1, background: `${cat.color}20` }} />
            </div>
          </GlassCard>
        ))}
      </div>

      {/* Featured knowledge banner */}
      <div style={{
        marginTop: 32, padding: 28, borderRadius: 16,
        background: "linear-gradient(135deg, rgba(0,255,140,0.06), rgba(167,139,250,0.06))",
        border: "1px solid rgba(0,255,140,0.1)", position: "relative", overflow: "hidden",
      }}>
        <div style={{ position: "absolute", top: -20, right: -20, fontSize: 120, opacity: 0.03 }}>⚡</div>
        <div style={{ fontSize: 10, letterSpacing: 4, color: "#00ff8c", fontFamily: "'Orbitron', sans-serif", marginBottom: 12 }}>⟡ FEATURED PATHWAY</div>
        <h3 style={{ fontSize: 20, color: "var(--text)", fontWeight: 400, marginBottom: 8, fontFamily: "'Sora', sans-serif" }}>
          The Tesla-369-Scalar Connection
        </h3>
        <p style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.8, maxWidth: 600, marginBottom: 20 }}>
          A curated learning path connecting Nikola Tesla's obsession with 3, 6, 9 → vortex mathematics → 
          scalar wave technology → copper coil engineering → ether physics. Seven modules, one unified understanding.
        </p>
        <div style={{ display: "flex", gap: 8 }}>
          {["369 CODE", "SCALAR", "COPPER", "ETHER", "TESLA", "VORTEX", "FREE ENERGY"].map((s, i) => (
            <span key={s} style={{ fontSize: 9, padding: "3px 10px", borderRadius: 4, background: `hsla(${140 + i * 20}, 70%, 50%, 0.1)`, border: `1px solid hsla(${140 + i * 20}, 70%, 50%, 0.2)`, color: `hsla(${140 + i * 20}, 70%, 60%, 1)`, letterSpacing: 1 }}>{s}</span>
          ))}
        </div>
      </div>

      {/* Disclaimer */}
      <div style={{ marginTop: 32, padding: 20, borderRadius: 10, background: "var(--card-bg)", border: "1px solid var(--card-border)", textAlign: "center" }}>
        <p style={{ fontSize: 11, color: "var(--text-dim)", lineHeight: 1.8, fontFamily: "'JetBrains Mono', monospace", margin: 0 }}>
          "The day science begins to study non-physical phenomena, it will make more progress in one decade than in all the previous centuries of its existence." — Nikola Tesla
        </p>
      </div>
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════
// WAKE UP — THE SIGNAL FEED
// ═══════════════════════════════════════════════════════════════

const WAKEUP_TOPICS = [
  {
    id: "epstein",
    icon: "🕸️",
    title: "The Epstein Network",
    urgency: "CRITICAL",
    urgencyColor: "#ef4444",
    color: "#ef4444",
    summary: "Jeffrey Epstein's trafficking operation and the powerful people connected to it. Exposed connections, sealed documents, and the questions that remain unanswered.",
    articles: [
      { title: "The Client List — Who Visited the Island", desc: "Flight logs, deposition testimony, and court documents revealing the network of wealthy and powerful individuals tied to Epstein's operation. Names, dates, and documented connections.", time: "ONGOING", heat: 98, tags: ["DOCUMENTS", "NETWORK"] },
      { title: "Ghislaine Maxwell — The Recruiter", desc: "How Maxwell built the pipeline. Her conviction, the trial evidence, and the connections to British intelligence and high society that remain unexplored.", time: "UPDATED", heat: 91, tags: ["TRIAL", "CONVICTION"] },
      { title: "The Death That Doesn't Add Up", desc: "Two cameras malfunctioned. Guards fell asleep. The hyoid bone fracture. A forensic examination of why the official narrative has more holes than answers.", time: "UNSOLVED", heat: 95, tags: ["FORENSICS", "COVER-UP"] },
      { title: "Intelligence Agency Connections", desc: "Alleged ties to Mossad, CIA, and MI6. Acosta's 'he belongs to intelligence' statement. The blackmail operation theory and its implications.", time: "DEVELOPING", heat: 88, tags: ["CIA", "MOSSAD", "BLACKMAIL"] },
      { title: "The Unsealed Documents — 2024 Release", desc: "What the released court documents revealed — and what's still sealed. Over 170 names and the ongoing legal battles for full transparency.", time: "2024", heat: 93, tags: ["COURT DOCS", "NAMES"] },
      { title: "Follow the Money — Financial Trails", desc: "Billions in assets with unclear origins. Les Wexner connection. How was Epstein funded and by whom? The financial architecture of a trafficking network.", time: "DEEP DIVE", heat: 85, tags: ["FINANCE", "WEXNER"] },
    ]
  },
  {
    id: "pizzagate",
    icon: "🍕",
    title: "Pizzagate & Coded Language",
    urgency: "CONTROVERSIAL",
    urgencyColor: "#f97316",
    color: "#f97316",
    summary: "The theory connecting coded language in leaked emails to alleged elite trafficking networks. Examining the claims, the evidence, the debunking, and the questions.",
    articles: [
      { title: "The Podesta Emails — Original Source Material", desc: "The WikiLeaks emails that started it all. Unusual language, food-related code words, and the connections people drew. Read the source material yourself.", time: "2016", heat: 82, tags: ["WIKILEAKS", "EMAILS"] },
      { title: "FBI Declassified Symbols — The Pattern Match", desc: "FBI documents on pedophile symbols and logos. The visual similarities people identified in businesses and organizations connected to the emails.", time: "FBI DOCS", heat: 78, tags: ["FBI", "SYMBOLS"] },
      { title: "The Mainstream Shutdown — How It Was Buried", desc: "How the narrative was controlled — immediate 'debunked' labels, platform censorship, and the media strategy that made questioning the story itself taboo.", time: "ANALYSIS", heat: 80, tags: ["MEDIA", "CENSORSHIP"] },
      { title: "Global Trafficking Networks — The Bigger Picture", desc: "Beyond any single theory — documented trafficking rings involving powerful people worldwide. NXIVM, the Catholic Church, UK grooming gangs, Hollywood.", time: "ONGOING", heat: 90, tags: ["GLOBAL", "DOCUMENTED"] },
      { title: "What's Proven vs. What's Alleged", desc: "An honest breakdown separating documented facts from speculation. Where the evidence is strong, where it's circumstantial, and where it requires faith.", time: "ANALYSIS", heat: 75, tags: ["FACT-CHECK", "NUANCE"] },
    ]
  },
  {
    id: "reptilian",
    icon: "🦎",
    title: "The Reptilian Theory",
    urgency: "ESOTERIC",
    urgencyColor: "#a78bfa",
    color: "#a78bfa",
    summary: "David Icke's theory of interdimensional reptilian beings influencing human affairs. Ancient accounts, modern claims, and the metaphorical interpretations.",
    articles: [
      { title: "David Icke's Core Thesis", desc: "The theory that shape-shifting reptilian entities from the lower fourth dimension have infiltrated positions of power. The original framework explained.", time: "THEORY", heat: 70, tags: ["ICKE", "FOUNDATION"] },
      { title: "Ancient Serpent Gods — Every Culture Has Them", desc: "The Annunaki, Nagas, Quetzalcoatl, the Serpent in Eden, Chinese dragon emperors. Why virtually every ancient civilization describes reptilian beings.", time: "ANCIENT", heat: 78, tags: ["MYTHOLOGY", "GLOBAL"] },
      { title: "The Bloodline Theory", desc: "Alleged ruling bloodlines tracing back to antiquity. Royal families, banking dynasties, and the claim of non-human DNA influencing the power structure.", time: "THEORY", heat: 72, tags: ["BLOODLINES", "ROYALTY"] },
      { title: "Metaphorical Interpretation — The Reptilian Brain", desc: "A psychological reading: the 'reptilian' as metaphor for cold-blooded psychopathy in power. The R-complex brain, predatory behavior, and lack of empathy in ruling classes.", time: "ANALYSIS", heat: 68, tags: ["PSYCHOLOGY", "METAPHOR"] },
      { title: "Eyewitness Accounts & Testimonies", desc: "Compiled testimonies from people claiming direct encounters. Arizona Wilder, Cathy O'Brien, and others. Evaluate the claims for yourself.", time: "TESTIMONIES", heat: 65, tags: ["WITNESSES", "CLAIMS"] },
      { title: "The Archon Connection — Gnostic Texts", desc: "The Nag Hammadi texts describe 'Archons' — inorganic rulers who feed on human energy. Parallels between ancient Gnostic cosmology and modern reptilian theory.", time: "GNOSTIC", heat: 74, tags: ["ARCHONS", "GNOSTIC"] },
    ]
  },
  {
    id: "fluoride",
    icon: "💧",
    title: "Fluoride & Water Supply",
    urgency: "HEALTH ALERT",
    urgencyColor: "#06b6d4",
    color: "#06b6d4",
    summary: "The mass medication of public water supplies with fluoride compounds. Scientific studies, pineal gland effects, IQ research, and global policy differences.",
    articles: [
      { title: "Fluoride Is Not What You Think", desc: "Hydrofluorosilicic acid — an industrial byproduct of phosphate fertilizer production. This is what's added to your water. Not the naturally occurring calcium fluoride.", time: "FOUNDATION", heat: 88, tags: ["CHEMISTRY", "INDUSTRIAL"] },
      { title: "The Pineal Gland Calcification Studies", desc: "Peer-reviewed research showing fluoride accumulates in the pineal gland more than any other tissue. What this means for melatonin production, sleep, and consciousness.", time: "RESEARCH", heat: 92, tags: ["PINEAL", "STUDIES"] },
      { title: "IQ Studies — The Harvard Meta-Analysis", desc: "27 studies reviewed by Harvard researchers found a strong association between fluoride exposure and reduced IQ in children. Published in Environmental Health Perspectives.", time: "HARVARD", heat: 90, tags: ["IQ", "CHILDREN"] },
      { title: "Countries That Banned Fluoridation", desc: "98% of Europe has rejected water fluoridation. Japan, China, and most developed nations don't fluoridate. Why America, UK, Australia, and a few others are the exception.", time: "GLOBAL", heat: 85, tags: ["BANNED", "EUROPE"] },
      { title: "The TSCA Lawsuit — 2024 Federal Ruling", desc: "A federal judge ruled the EPA must regulate fluoride in drinking water due to unreasonable risk of reduced IQ in children. A historic legal precedent.", time: "2024", heat: 95, tags: ["LAWSUIT", "EPA"] },
      { title: "How to Remove Fluoride From Your Water", desc: "Reverse osmosis, bone char, activated alumina, and distillation. What works, what doesn't, and why standard Brita filters don't remove fluoride.", time: "SOLUTIONS", heat: 87, tags: ["FILTER", "DIY"] },
      { title: "Edward Bernays & The PR Campaign", desc: "The 'father of propaganda' was hired to sell fluoridation to America. The marketing strategy that made industrial waste a dental treatment.", time: "HISTORY", heat: 83, tags: ["BERNAYS", "PR"] },
    ]
  },
  {
    id: "chemtrails",
    icon: "✈️",
    title: "Chemical Trails & Geoengineering",
    urgency: "ACTIVE",
    urgencyColor: "#eab308",
    color: "#eab308",
    summary: "Persistent contrails, cloud seeding programs, stratospheric aerosol injection, and the documented history of atmospheric manipulation.",
    articles: [
      { title: "Contrails vs. Chemical Trails — The Debate", desc: "Normal contrails dissipate in seconds to minutes. Persistent trails that spread into haze last hours. The atmospheric science and what both sides claim.", time: "FOUNDATION", heat: 80, tags: ["SCIENCE", "DEBATE"] },
      { title: "Operation Popeye — Military Weather Warfare", desc: "Declassified US military operation that seeded clouds over Vietnam to extend monsoon season. Proven military weather manipulation from the 1960s-70s.", time: "DECLASSIFIED", heat: 88, tags: ["MILITARY", "PROVEN"] },
      { title: "Cloud Seeding — It's Not A Theory, It's A Business", desc: "Companies like Weather Modification Inc. openly sell cloud seeding services. Dubai, China, and the US actively seed clouds. This is public, documented, and ongoing.", time: "CURRENT", heat: 92, tags: ["DOCUMENTED", "BUSINESS"] },
      { title: "Stratospheric Aerosol Injection — Harvard's SCoPEx", desc: "Harvard's Solar Geoengineering Research Program openly studies spraying particles into the stratosphere to block sunlight. Published papers and funding sources.", time: "ACADEMIC", heat: 86, tags: ["HARVARD", "SOLAR"] },
      { title: "Barium, Strontium & Aluminum — Soil Testing", desc: "Independent lab tests showing elevated levels of metallic particles in rainwater and soil in areas beneath persistent trail activity. The data and its interpretations.", time: "LAB TESTS", heat: 78, tags: ["TESTING", "METALS"] },
      { title: "The Geoengineering Patent Archive", desc: "Hundreds of patents filed for atmospheric modification technologies. US Patent archives documenting methods for aerosol dispersal, weather control, and solar radiation management.", time: "PATENTS", heat: 84, tags: ["PATENTS", "ARCHIVE"] },
      { title: "UN & WEF Statements on Climate Intervention", desc: "Official statements from international bodies acknowledging and planning for solar radiation management. When 'conspiracy theory' becomes 'climate policy.'", time: "OFFICIAL", heat: 90, tags: ["UN", "WEF", "POLICY"] },
    ]
  },
  {
    id: "gmo",
    icon: "🧬",
    title: "GMOs & Food Supply Control",
    urgency: "HEALTH",
    urgencyColor: "#22c55e",
    color: "#22c55e",
    summary: "Genetically modified organisms, the corporations controlling the food supply, seed patents, glyphosate toxicity, and the fight for food sovereignty.",
    articles: [
      { title: "Monsanto/Bayer — The Company That Owns Your Food", desc: "From Agent Orange to Roundup to GMO seeds. How one corporation gained control over a massive portion of the global food supply through patents and lawsuits.", time: "CORPORATE", heat: 90, tags: ["MONSANTO", "BAYER"] },
      { title: "Glyphosate — The Weedkiller In Your Cereal", desc: "Found in 80%+ of urine samples tested. Classified as 'probably carcinogenic' by WHO. Jury awards billions in cancer lawsuits. It's in bread, oats, beer, and wine.", time: "HEALTH", heat: 93, tags: ["GLYPHOSATE", "ROUNDUP"] },
      { title: "Seed Patents — You Can't Own Nature (But They Do)", desc: "Corporations patenting seeds and suing farmers for saving them. The destruction of seed biodiversity and ancient farming practices by intellectual property law.", time: "LEGAL", heat: 85, tags: ["PATENTS", "FARMERS"] },
      { title: "The Séralini Study — What Happened", desc: "The study showing tumors in rats fed GMO corn was published, retracted under industry pressure, then republished. The anatomy of scientific suppression.", time: "SCIENCE", heat: 82, tags: ["STUDY", "SUPPRESSED"] },
      { title: "Bill Gates — Largest Farmland Owner in America", desc: "Why is a tech billionaire buying hundreds of thousands of acres of farmland? The connection to synthetic food, GMO investment, and food supply centralization.", time: "DEVELOPING", heat: 88, tags: ["GATES", "FARMLAND"] },
      { title: "The Organic Movement & Food Sovereignty", desc: "Heirloom seeds, regenerative agriculture, food forests, and the growing movement to reclaim control over what we eat. Solutions and resources.", time: "SOLUTIONS", heat: 80, tags: ["ORGANIC", "SOLUTIONS"] },
      { title: "Codex Alimentarius — Global Food Control", desc: "The international food standards body that critics say is designed to limit access to natural supplements and health foods while protecting corporate food interests.", time: "POLICY", heat: 76, tags: ["CODEX", "GLOBAL"] },
    ]
  },
  {
    id: "pharma",
    icon: "💊",
    title: "Big Pharma & Medical System",
    urgency: "ONGOING",
    urgencyColor: "#ec4899",
    color: "#ec4899",
    summary: "The pharmaceutical-industrial complex, suppressed cures, regulatory capture, and the business model built on treatment rather than healing.",
    articles: [
      { title: "Regulatory Capture — Who Controls the FDA?", desc: "The revolving door between pharmaceutical companies and the agencies meant to regulate them. Former industry executives writing the rules for their own products.", time: "SYSTEMIC", heat: 88, tags: ["FDA", "REVOLVING DOOR"] },
      { title: "The Opioid Crisis — Manufactured Addiction", desc: "How Purdue Pharma knowingly marketed OxyContin as non-addictive. Hundreds of thousands dead. The Sackler family's billions. A documented corporate crime.", time: "DOCUMENTED", heat: 95, tags: ["OPIOIDS", "SACKLER"] },
      { title: "Royal Rife & The Frequency Machine", desc: "In the 1930s, Royal Rife's frequency device was documented destroying pathogens. The AMA shut him down, his lab was destroyed, and his technology was buried.", time: "SUPPRESSED", heat: 80, tags: ["RIFE", "FREQUENCY"] },
      { title: "Natural Medicine Under Attack", desc: "The systematic campaign against herbalism, homeopathy, naturopathy, and traditional medicine. Regulation designed to protect pharmaceutical monopolies.", time: "ONGOING", heat: 82, tags: ["NATURAL", "REGULATION"] },
      { title: "The Cancer Industry — Follow the Money", desc: "Cancer treatment is a $200B+ industry. Why the focus remains on treatment rather than prevention. The suppressed environmental and dietary causes.", time: "FINANCIAL", heat: 86, tags: ["CANCER", "INDUSTRY"] },
      { title: "Vaccine Injury Compensation Program", desc: "The US government has paid over $4.7 billion in vaccine injury claims through the VICP. What this program reveals about acknowledged risks.", time: "GOVERNMENT", heat: 84, tags: ["VICP", "COMPENSATION"] },
    ]
  },
  {
    id: "surveillance",
    icon: "📡",
    title: "Surveillance & Digital Control",
    urgency: "NOW",
    urgencyColor: "#f43f5e",
    color: "#f43f5e",
    summary: "The surveillance state exposed. Mass data collection, social credit systems, CBDC digital currencies, and the architecture of digital control.",
    articles: [
      { title: "Edward Snowden — What He Actually Revealed", desc: "The NSA is recording everything. PRISM, XKeyscore, and the global surveillance apparatus. Every call, text, email, and search — collected and stored.", time: "PROVEN", heat: 95, tags: ["SNOWDEN", "NSA"] },
      { title: "Social Credit Systems — Not Just China", desc: "China's system is the model, but ESG scores, digital IDs, and behavioral tracking are implementing similar control frameworks worldwide under different names.", time: "GLOBAL", heat: 90, tags: ["SOCIAL CREDIT", "ESG"] },
      { title: "CBDCs — Programmable Money", desc: "Central Bank Digital Currencies that can be programmed to expire, restricted by location, or turned off. The end of financial privacy and the tool for total economic control.", time: "DEVELOPING", heat: 92, tags: ["CBDC", "CURRENCY"] },
      { title: "5G, EMF & Biological Effects", desc: "Independent studies on electromagnetic radiation effects on cells, sleep, and the blood-brain barrier. What the telecom industry doesn't want studied.", time: "RESEARCH", heat: 78, tags: ["5G", "EMF"] },
      { title: "Smart Devices — The Listening Grid", desc: "Your phone, TV, Alexa, and Ring doorbell form a surveillance network in your home. Documented cases of data sharing with law enforcement without warrants.", time: "DOCUMENTED", heat: 85, tags: ["IOT", "PRIVACY"] },
    ]
  },
  {
    id: "history",
    icon: "📜",
    title: "Hidden History & Suppressed Knowledge",
    urgency: "DEEP STATE",
    urgencyColor: "#8b5cf6",
    color: "#8b5cf6",
    summary: "The history they didn't teach you. Ancient advanced civilizations, suppressed archaeological finds, and the rewriting of human origins.",
    articles: [
      { title: "Operation Paperclip — Nazis in NASA", desc: "Over 1,600 Nazi scientists brought to America after WWII. Werner von Braun, Kurt Debus, and others went from building V-2 rockets for Hitler to running NASA.", time: "DECLASSIFIED", heat: 88, tags: ["NASA", "PAPERCLIP"] },
      { title: "The Smithsonian Giant Cover-Up", desc: "Newspaper reports from the 1800s-1900s documenting giant skeletal remains found across America. Specimens sent to the Smithsonian — and never seen again.", time: "HISTORICAL", heat: 75, tags: ["GIANTS", "SMITHSONIAN"] },
      { title: "COINTELPRO — FBI vs. The People", desc: "The FBI's documented program to infiltrate, discredit, and destroy civil rights movements, Black Panther Party, anti-war groups, and anyone challenging power.", time: "DECLASSIFIED", heat: 90, tags: ["FBI", "COINTELPRO"] },
      { title: "Operation Northwoods — False Flag Blueprint", desc: "The Joint Chiefs of Staff proposed staging terrorist attacks on American citizens to justify invading Cuba. JFK rejected it. The document is declassified.", time: "DECLASSIFIED", heat: 92, tags: ["FALSE FLAG", "MILITARY"] },
      { title: "The Library of Alexandria — What Was Lost", desc: "The greatest repository of ancient knowledge, deliberately destroyed. What it contained, who destroyed it, and the theory that key texts were removed first.", time: "ANCIENT", heat: 70, tags: ["LIBRARY", "ANCIENT"] },
      { title: "Göbekli Tepe — Rewriting Human History", desc: "A 12,000-year-old megalithic site that predates agriculture, pottery, and supposedly civilization itself. It was deliberately buried. Why?", time: "ARCHAEOLOGY", heat: 82, tags: ["GOBEKLI TEPE", "ANCIENT"] },
      { title: "The Younger Dryas Impact — Civilization Reset", desc: "Evidence of a cataclysmic comet impact 12,800 years ago that ended an advanced pre-ice-age civilization. Graham Hancock, Randall Carlson, and the geological proof.", time: "SCIENCE", heat: 80, tags: ["CATACLYSM", "RESET"] },
    ]
  },
  {
    id: "energy",
    icon: "⚡",
    title: "Suppressed Energy & Free Power",
    urgency: "SUPPRESSED",
    urgencyColor: "#00ff8c",
    color: "#00ff8c",
    summary: "Technologies that could free humanity from energy dependence. Why they're suppressed, who suppresses them, and how they work.",
    articles: [
      { title: "Tesla's Wardenclyffe — Free Energy for the World", desc: "Tesla's tower could transmit wireless electricity globally. JP Morgan pulled funding when he realized he couldn't meter it. You can't charge for free energy.", time: "HISTORY", heat: 92, tags: ["TESLA", "WARDENCLYFFE"] },
      { title: "Stanley Meyer — The Water-Powered Car", desc: "Meyer's dune buggy ran on water using electrolysis. He was offered $1 billion to shelve it, refused, and died suddenly at a restaurant in 1998. The patent exists.", time: "INVENTOR", heat: 88, tags: ["WATER CAR", "MEYER"] },
      { title: "The Suppression Pattern — Inventors Who Died", desc: "A documented pattern of free energy inventors who were bought out, threatened, raided, or died under suspicious circumstances. The common thread.", time: "PATTERN", heat: 85, tags: ["PATTERN", "DEATHS"] },
      { title: "Zero-Point Energy — It's Real Physics", desc: "Quantum mechanics proves the vacuum of space contains enormous energy. The Casimir effect demonstrates it. Extracting it is engineering, not fantasy.", time: "PHYSICS", heat: 82, tags: ["ZERO POINT", "QUANTUM"] },
      { title: "The Petrodollar System — Why Oil Must Stay", desc: "The entire global financial system is built on oil being traded in US dollars. Free energy doesn't just threaten oil companies — it threatens the dollar itself.", time: "ECONOMICS", heat: 90, tags: ["PETRODOLLAR", "OIL"] },
    ]
  },
];

// ═══════════════════════════════════════════════════════════════
// DEEP DIVES — Long-form, sourced, network-linked article system
// ═══════════════════════════════════════════════════════════════
//
// To add a deep dive to any topic, drop an entry in DEEP_DIVES keyed by topic id.
// Schema:
//   {
//     hero: { tagline, color, accent? }
//     intro: long opening paragraph(s)
//     sections: [ { id, h, kind: "text"|"list"|"quote"|"stat"|"timeline", body|items|... } ]
//     videos: [ { url: youtube/rumble URL, title, source, note? } ]   // can be null/empty
//     sources: [ { author?, title, publisher?, year?, url?, kind: "study"|"book"|"document"|"article"|"film" } ]
//     related: [ { topicId, articleIdx?, label } ]
//   }

const DEEP_DIVES = {
  fluoride: {
    hero: {
      tagline: "The mass medication of the water supply with a known neurotoxin",
      color: "#06b6d4",
      accent: "💧",
    },
    intro: "Fluoride is one of the only chemicals added to public water for the explicit purpose of treating people — not for water safety. It is not a nutrient. The body has no biological requirement for it. And yet, in roughly 73% of the U.S. population's drinking water, fluoride has been added since the 1940s under the name of 'cavity prevention.' What most people are not told is that the fluoride compound used — fluorosilicic acid — is an industrial waste byproduct from the phosphate fertilizer industry. The story of how this waste came to be sold to municipal water utilities, marketed to dentists, and federally endorsed despite mounting peer-reviewed evidence of harm is one of the cleanest examples of regulatory capture in modern history.",
    sections: [
      {
        id: "what-it-is", h: "What 'Fluoride' Actually Is", kind: "text",
        body: "When people picture fluoride, they tend to picture the calcium fluoride that occurs naturally in some groundwater. That's not what's added to municipal water. The compound used in 90%+ of fluoridated U.S. systems is hexafluorosilicic acid (H2SiF6) — captured from the smokestack scrubbers of phosphate fertilizer plants in Florida and elsewhere. Before it became a 'water additive,' the same chemical was classified as hazardous waste, with disposal costs in the thousands per ton. Fluoridation effectively converted a costly disposal problem into a revenue stream. The compound contains lead, arsenic, and other heavy-metal contaminants that the EPA's own NSF/ANSI 60 standard permits at low concentrations. None of this is hidden — it's simply not advertised."
      },
      {
        id: "neurotoxicity", h: "The Neurotoxicity Evidence", kind: "text",
        body: "In 2012, a Harvard School of Public Health meta-analysis pooled 27 studies — most from China, where high-fluoride and low-fluoride villages exist side by side — and concluded that children in high-fluoride areas had IQ scores roughly 7 points lower than children in low-fluoride areas. In 2017, a NIH-funded U.S. and Canadian cohort study (the ELEMENT and MIREC studies) found similar associations: maternal fluoride exposure during pregnancy correlated with reduced IQ in male children. In 2024, the U.S. National Toxicology Program — after a years-long internal review and lawsuit-driven release — formally classified fluoride as a 'presumed neurodevelopmental hazard.' A federal court in California (Food & Water Watch v. EPA, 2024) ordered the EPA to take regulatory action based on the body of evidence. The science is no longer fringe."
      },
      {
        id: "pineal", h: "The Pineal Gland Accumulation", kind: "text",
        body: "Dr. Jennifer Luke's 1997 doctoral research at the University of Surrey was the first study to measure fluoride concentrations directly in human pineal glands taken from autopsies. The pineal — a small endocrine gland that produces melatonin and is associated in many traditions with consciousness and intuition — was found to concentrate fluoride at levels averaging 9,000 ppm (parts per million) in the calcified portion, with peaks exceeding 21,000 ppm. For comparison, water is fluoridated at 0.7 ppm. The gland accumulates fluoride more aggressively than bone. Luke's follow-up animal research found that fluoride exposure suppressed melatonin production and accelerated pubertal onset in test subjects."
      },
      {
        id: "endocrine", h: "Beyond the Brain — The Endocrine and Skeletal Effects", kind: "text",
        body: "Fluoride is also a documented thyroid suppressor. Before its rebranding as a cavity-fighter, it was prescribed in mid-20th-century Europe as a treatment for hyperthyroidism — given to patients precisely because it lowered thyroid function. The doses prescribed were comparable to what an average American on fluoridated water consumes today through accumulated exposure (water + toothpaste + processed food made with fluoridated water + tea, which naturally absorbs fluoride from soil). On the skeletal side, chronic exposure leads to dental fluorosis (visible on roughly 65% of American adolescents per CDC data) and, at higher levels, skeletal fluorosis — a condition still endemic in parts of India and China where natural water fluoride is high."
      },
      {
        id: "global", h: "Where Fluoridation Has Already Been Banned", kind: "list",
        items: [
          { label: "Sweden", text: "Banned 1971 — official reason cited was lack of consent in mass-medicating a population." },
          { label: "Netherlands", text: "Banned 1976 — Supreme Court ruled it constituted unauthorized medication." },
          { label: "Germany", text: "Banned 1971 — Health Ministry citing 'individual dosing' impossibility." },
          { label: "Austria", text: "Never adopted." },
          { label: "Denmark", text: "Never adopted." },
          { label: "France", text: "Never fluoridated municipal water." },
          { label: "Belgium", text: "Banned 2002." },
          { label: "Israel", text: "Banned 2014 by Health Minister Yael German citing the precautionary principle." },
          { label: "China", text: "Banned 2002." },
          { label: "Japan", text: "Halted in early 1970s." },
        ],
      },
      {
        id: "removal", h: "How To Remove It From Your Body and Water", kind: "list",
        items: [
          { label: "Filter your water", text: "Standard carbon (Brita, Pur) does NOT remove fluoride. You need either reverse osmosis, a Berkey with PF-2 fluoride filters, or distillation. Spring water in glass bottles is naturally fluoride-free." },
          { label: "Switch to fluoride-free toothpaste", text: "Brands like Earthpaste, Dr. Bronner's, Hello, and Tom's of Maine make options without fluoride. Hydroxyapatite toothpaste actually rebuilds enamel and is the standard in Japan." },
          { label: "Boron + iodine + tamarind", text: "Boron supplementation (3-10 mg/day) is one of the most studied compounds for displacing fluoride from bones and the pineal. Iodine (kelp, Lugol's solution) competes with fluoride at receptor sites. Tamarind has been used in Indian medicine for centuries to chelate fluoride." },
          { label: "Sweat regularly", text: "Sauna, exercise, and sun exposure all mobilize fluoride out of tissues. Fluoride is excreted through both urine and sweat." },
          { label: "Avoid black tea, soda, and processed food made with fluoridated water", text: "Tea plants accumulate fluoride aggressively. Most processed foods and sodas are made in cities with fluoridated water and concentrate the dose." },
        ],
      },
      {
        id: "questions", h: "Questions Worth Asking", kind: "quote",
        body: "If fluoridation works topically (on the surface of teeth) — which the CDC now openly acknowledges — why are we still adding it to drinking water? If it's a medication, why is it dispensed without consent, prescription, or dose control? Why do countries that banned it have equal or better dental health than the U.S.? And if the science is settled, why did the National Toxicology Program need to be sued under FOIA to release its own findings?"
      }
    ],
    videos: [
      { url: "https://www.youtube.com/embed/3Or2vvLKKJM", title: "The Great Culling: Our Water (Documentary)", source: "Independent Documentary", note: "Covers fluoride, vaccines, and pharmaceutical contamination of water systems." },
      { url: "https://www.youtube.com/embed/D5fmiViFMC8", title: "Dr. Paul Connett — Fluoride: The Hard to Swallow Truth", source: "Fluoride Action Network", note: "Founder of FAN presents the scientific case against fluoridation." },
    ],
    sources: [
      { author: "Choi, Sun, Zhang, Grandjean", title: "Developmental Fluoride Neurotoxicity: A Systematic Review and Meta-Analysis", publisher: "Environmental Health Perspectives (Harvard SPH)", year: "2012", url: "https://ehp.niehs.nih.gov/doi/10.1289/ehp.1104912", kind: "study" },
      { author: "Bashash et al.", title: "Prenatal Fluoride Exposure and Cognitive Outcomes in Children at 4 and 6-12 Years of Age in Mexico (ELEMENT cohort)", publisher: "Environmental Health Perspectives", year: "2017", url: "https://ehp.niehs.nih.gov/doi/10.1289/EHP655", kind: "study" },
      { author: "Green et al.", title: "Association Between Maternal Fluoride Exposure During Pregnancy and IQ Scores in Offspring in Canada (MIREC cohort)", publisher: "JAMA Pediatrics", year: "2019", url: "https://jamanetwork.com/journals/jamapediatrics/fullarticle/2748634", kind: "study" },
      { author: "U.S. National Toxicology Program (NTP)", title: "Monograph on the State of the Science Concerning Fluoride Exposure and Neurodevelopmental and Cognitive Health Effects", publisher: "U.S. Department of Health & Human Services", year: "2024", url: "https://ntp.niehs.nih.gov/publications/monographs/mgraph08", kind: "document" },
      { author: "Luke, J.", title: "The Effect of Fluoride on the Physiology of the Pineal Gland (Doctoral Thesis)", publisher: "University of Surrey", year: "1997", kind: "study" },
      { author: "U.S. District Court, Northern California", title: "Food & Water Watch et al. v. U.S. EPA (TSCA Section 21 Petition Ruling)", publisher: "Federal Court Order", year: "2024", kind: "document" },
      { author: "Connett, P., Beck, J., Micklem, S.", title: "The Case Against Fluoride: How Hazardous Waste Ended Up in Our Drinking Water", publisher: "Chelsea Green Publishing", year: "2010", kind: "book" },
      { author: "Bryson, Christopher", title: "The Fluoride Deception", publisher: "Seven Stories Press", year: "2004", kind: "book" },
    ],
    related: [
      { topicId: "mkultra", label: "MKUltra — Mass Population Behavior Modification" },
      { topicId: "pharma", label: "Big Pharma — Regulatory Capture Patterns" },
      { topicId: "gmo", label: "GMOs & Industrial Food — Same Playbook" },
    ],
  },
};

function DeepView({ topicId, topic, articleIdx, onBack, onNavigate }) {
  const data = DEEP_DIVES[topicId];
  const color = data?.hero?.color || topic?.color || "#00ff8c";
  const [activeSection, setActiveSection] = useState(null);

  if (!data) {
    return (
      <div style={{ animation: "fadeInUp 0.4s ease", padding: "40px 0", textAlign: "center" }}>
        <button onClick={onBack} style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)", color: "var(--text-muted)", padding: "8px 18px", borderRadius: 8, cursor: "pointer", fontSize: 11, letterSpacing: 2, fontFamily: "'Orbitron', sans-serif", marginBottom: 24 }}>← BACK</button>
        <div style={{ fontSize: 36, marginBottom: 16, opacity: 0.4 }}>◌</div>
        <p style={{ fontSize: 13, color: "var(--text-faint)" }}>This deep dive is still being written. Check back soon.</p>
      </div>
    );
  }

  const sectionKindClass = (s) => s.kind || "text";

  return (
    <div style={{ animation: "fadeInUp 0.4s ease" }}>
      {/* Top bar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 28, gap: 12, flexWrap: "wrap" }}>
        <button onClick={onBack} style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)", color: "var(--text-muted)", padding: "8px 18px", borderRadius: 8, cursor: "pointer", fontSize: 11, letterSpacing: 2, fontFamily: "'Orbitron', sans-serif", display: "flex", alignItems: "center", gap: 8 }}>← BACK</button>
        <div style={{ display: "flex", gap: 8 }}>
          <span style={{ fontSize: 9, padding: "5px 12px", borderRadius: 6, background: `${color}10`, border: `1px solid ${color}30`, color, letterSpacing: 2, fontFamily: "'Orbitron', sans-serif" }}>DEEP DIVE</span>
          <span style={{ fontSize: 9, padding: "5px 12px", borderRadius: 6, background: "var(--card-bg)", border: "1px solid var(--card-border)", color: "var(--text-faint)", letterSpacing: 2, fontFamily: "'Orbitron', sans-serif" }}>{data.sections.length} SECTIONS · {data.sources.length} SOURCES</span>
        </div>
      </div>

      {/* Hero */}
      <div style={{
        position: "relative", borderRadius: 20, overflow: "hidden",
        padding: "48px 32px", marginBottom: 36,
        background: `linear-gradient(135deg, ${color}18, ${color}06 60%, transparent), radial-gradient(circle at 80% 20%, ${color}25, transparent 60%)`,
        border: `1px solid ${color}25`,
      }}>
        <div style={{ position: "absolute", top: 24, right: 28, fontSize: 64, opacity: 0.15 }}>{data.hero.accent || topic.icon}</div>
        <div style={{ position: "relative", maxWidth: 720 }}>
          <div style={{ fontSize: 10, letterSpacing: 4, color, fontFamily: "'Orbitron', sans-serif", marginBottom: 14 }}>{topic.urgency || "RESEARCH"}</div>
          <h1 style={{ fontSize: "clamp(28px, 4vw, 42px)", fontWeight: 300, color: "var(--text)", fontFamily: "'Sora', sans-serif", letterSpacing: 0.5, lineHeight: 1.2, marginBottom: 14 }}>{topic.title}</h1>
          <p style={{ fontSize: 15, color: "var(--text-muted)", lineHeight: 1.7, fontFamily: "'Sora', sans-serif", margin: 0 }}>{data.hero.tagline}</p>
        </div>
      </div>

      {/* Two-column layout: TOC + content */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 32 }}>
        {/* Intro */}
        <div style={{ padding: "28px 32px", borderRadius: 16, background: "var(--card-bg)", border: "1px solid var(--card-border)", borderLeft: `3px solid ${color}` }}>
          <div style={{ fontSize: 10, letterSpacing: 3, color: `${color}cc`, fontFamily: "'Orbitron', sans-serif", marginBottom: 14 }}>OVERVIEW</div>
          <p style={{ fontSize: 15, color: "var(--text)", lineHeight: 1.85, fontFamily: "'Sora', sans-serif", margin: 0 }}>{data.intro}</p>
        </div>

        {/* Sections */}
        {data.sections.map((s, i) => (
          <div key={s.id} id={s.id} style={{ padding: "28px 32px", borderRadius: 16, background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 14, marginBottom: 18 }}>
              <span style={{ fontSize: 11, color, fontFamily: "'JetBrains Mono', monospace", letterSpacing: 1 }}>0{i + 1}</span>
              <h2 style={{ fontSize: 20, fontWeight: 500, color: "var(--text)", fontFamily: "'Sora', sans-serif", letterSpacing: 0.3, margin: 0 }}>{s.h}</h2>
            </div>
            {sectionKindClass(s) === "text" && (
              <p style={{ fontSize: 14, color: "var(--text-muted)", lineHeight: 1.95, fontFamily: "'Sora', sans-serif", margin: 0 }}>{s.body}</p>
            )}
            {sectionKindClass(s) === "list" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {s.items.map((it, j) => (
                  <div key={j} style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
                    <div style={{ width: 6, height: 6, borderRadius: "50%", background: color, marginTop: 8, flexShrink: 0, boxShadow: `0 0 8px ${color}` }} />
                    <div>
                      <span style={{ fontSize: 13, color: "var(--text)", fontWeight: 600, fontFamily: "'Sora', sans-serif" }}>{it.label}</span>
                      <span style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.85 }}> — {it.text}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {sectionKindClass(s) === "quote" && (
              <div style={{ padding: "20px 24px", borderRadius: 10, background: `${color}06`, borderLeft: `3px solid ${color}` }}>
                <p style={{ fontSize: 15, color: "var(--text)", lineHeight: 1.95, fontStyle: "italic", fontFamily: "'Sora', sans-serif", margin: 0 }}>"{s.body}"</p>
              </div>
            )}
          </div>
        ))}

        {/* Videos */}
        {data.videos && data.videos.length > 0 && (
          <div style={{ padding: "28px 32px", borderRadius: 16, background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
            <div style={{ fontSize: 10, letterSpacing: 3, color: `${color}cc`, fontFamily: "'Orbitron', sans-serif", marginBottom: 18 }}>▶ FURTHER VIEWING</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
              {data.videos.map((v, i) => (
                <div key={i} style={{ borderRadius: 12, overflow: "hidden", background: "rgba(0,0,0,0.3)", border: "1px solid var(--card-border)" }}>
                  <div style={{ position: "relative", paddingBottom: "56.25%", height: 0, overflow: "hidden", background: "#000" }}>
                    <iframe
                      src={v.url}
                      title={v.title}
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                      style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", border: 0 }}
                    />
                  </div>
                  <div style={{ padding: "12px 14px" }}>
                    <div style={{ fontSize: 13, color: "var(--text)", fontWeight: 500, fontFamily: "'Sora', sans-serif", marginBottom: 4 }}>{v.title}</div>
                    <div style={{ fontSize: 10, color: `${color}aa`, letterSpacing: 1, fontFamily: "'JetBrains Mono', monospace" }}>{v.source}</div>
                    {v.note && <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 6, lineHeight: 1.5 }}>{v.note}</div>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Sources */}
        {data.sources && data.sources.length > 0 && (
          <div style={{ padding: "28px 32px", borderRadius: 16, background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
            <div style={{ fontSize: 10, letterSpacing: 3, color: `${color}cc`, fontFamily: "'Orbitron', sans-serif", marginBottom: 18 }}>📚 SOURCES & CITATIONS</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {data.sources.map((src, i) => (
                <div key={i} style={{ display: "flex", gap: 14, padding: "12px 14px", borderRadius: 8, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
                  <div style={{ fontSize: 10, color: `${color}aa`, fontFamily: "'JetBrains Mono', monospace", flexShrink: 0, paddingTop: 2 }}>[{String(i+1).padStart(2, "0")}]</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: "var(--text)", fontFamily: "'Sora', sans-serif", lineHeight: 1.6 }}>
                      {src.author && <span style={{ fontWeight: 500 }}>{src.author}. </span>}
                      <span style={{ fontStyle: src.kind === "book" || src.kind === "film" ? "italic" : "normal" }}>{src.title}</span>
                      {src.publisher && <span style={{ color: "var(--text-faint)" }}>. {src.publisher}</span>}
                      {src.year && <span style={{ color: "var(--text-faint)" }}> ({src.year})</span>}
                      <span style={{ fontSize: 9, marginLeft: 8, padding: "2px 8px", borderRadius: 4, background: `${color}12`, color, letterSpacing: 1, fontFamily: "'Orbitron', sans-serif", textTransform: "uppercase" }}>{src.kind}</span>
                    </div>
                    {src.url && (
                      <a href={src.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: `${color}cc`, fontFamily: "'JetBrains Mono', monospace", textDecoration: "none", display: "inline-block", marginTop: 4, wordBreak: "break-all" }}>↗ {src.url}</a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Related topics network */}
        {data.related && data.related.length > 0 && (
          <div style={{ padding: "28px 32px", borderRadius: 16, background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
            <div style={{ fontSize: 10, letterSpacing: 3, color: `${color}cc`, fontFamily: "'Orbitron', sans-serif", marginBottom: 6 }}>⊕ RELATED IN THE NETWORK</div>
            <p style={{ fontSize: 12, color: "var(--text-faint)", marginBottom: 18 }}>These topics share the same patterns of suppression, regulatory capture, or biological mechanism.</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {data.related.map((r, i) => (
                <button key={i} onClick={() => onNavigate && onNavigate(r.topicId, r.articleIdx)} style={{
                  textAlign: "left", display: "flex", alignItems: "center", gap: 12,
                  padding: "12px 16px", borderRadius: 10,
                  background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)",
                  color: "var(--text)", cursor: "pointer", fontFamily: "'Sora', sans-serif", fontSize: 13,
                  transition: "all 0.2s ease",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = `${color}08`; e.currentTarget.style.borderColor = `${color}30`; e.currentTarget.style.transform = "translateX(4px)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.02)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.05)"; e.currentTarget.style.transform = "translateX(0)"; }}>
                  <span style={{ color, fontSize: 14 }}>→</span>
                  <span style={{ flex: 1 }}>{r.label}</span>
                  <span style={{ fontSize: 9, color: `${color}99`, letterSpacing: 2, fontFamily: "'Orbitron', sans-serif" }}>OPEN</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Bottom disclaimer */}
        <div style={{ padding: 18, borderRadius: 10, background: "var(--card-bg)", border: "1px solid var(--card-border)", textAlign: "center" }}>
          <p style={{ fontSize: 11, color: "var(--text-dim)", lineHeight: 1.8, fontFamily: "'JetBrains Mono', monospace", margin: 0 }}>
            Information presented for research and discussion. Verify sources independently. Trust your own discernment.
          </p>
        </div>
      </div>
    </div>
  );
}


function WakeUpSection() {
  const [activeTopicId, setActiveTopicId] = useState(null);
  const [filter, setFilter] = useState("ALL");
  const [searchTerm, setSearchTerm] = useState("");
  const [savedArticles, setSavedArticles] = useState(new Set());
  const [expandedArticle, setExpandedArticle] = useState(null);
  const [deepDiveTopic, setDeepDiveTopic] = useState(null); // { topicId, articleIdx }

  const toggleSave = (id) => {
    setSavedArticles(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const urgencyFilters = ["ALL", "CRITICAL", "HEALTH", "SUPPRESSED", "DECLASSIFIED", "DEVELOPING"];

  const filteredTopics = WAKEUP_TOPICS.filter(t => {
    if (filter !== "ALL" && !t.urgency.includes(filter) && !t.articles.some(a => a.tags.some(tag => tag.includes(filter)))) return false;
    if (searchTerm) {
      const s = searchTerm.toLowerCase();
      return t.title.toLowerCase().includes(s) || t.summary.toLowerCase().includes(s) ||
        t.articles.some(a => a.title.toLowerCase().includes(s) || a.desc.toLowerCase().includes(s) || a.tags.some(tag => tag.toLowerCase().includes(s)));
    }
    return true;
  });

  const totalArticles = WAKEUP_TOPICS.reduce((a, t) => a + t.articles.length, 0);

  // ─── Deep Dive View (long-form article system) ───
  if (deepDiveTopic) {
    const topic = WAKEUP_TOPICS.find(t => t.id === deepDiveTopic.topicId);
    return (
      <DeepView
        topicId={deepDiveTopic.topicId}
        topic={topic}
        articleIdx={deepDiveTopic.articleIdx}
        onBack={() => setDeepDiveTopic(null)}
        onNavigate={(newTopicId, newArticleIdx) => {
          setDeepDiveTopic({ topicId: newTopicId, articleIdx: newArticleIdx });
          if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
        }}
      />
    );
  }

  // ─── Article Detail View ───
  if (activeTopicId) {
    const topic = WAKEUP_TOPICS.find(t => t.id === activeTopicId);
    return (
      <div style={{ animation: "fadeInUp 0.4s ease" }}>
        <button onClick={() => { setActiveTopicId(null); setExpandedArticle(null); }} style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)", color: "var(--text-muted)", padding: "8px 18px", borderRadius: 8, cursor: "pointer", fontSize: 11, letterSpacing: 2, fontFamily: "'Orbitron', sans-serif", marginBottom: 24, display: "flex", alignItems: "center", gap: 8 }}>
          ← BACK TO FEED
        </button>

        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 8 }}>
          <span style={{ fontSize: 40 }}>{topic.icon}</span>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4, flexWrap: "wrap" }}>
              <h2 style={{ fontSize: 24, fontWeight: 600, color: "var(--text)", fontFamily: "'Orbitron', sans-serif", margin: 0, letterSpacing: 1 }}>{topic.title}</h2>
              <span style={{ fontSize: 9, padding: "4px 12px", borderRadius: 6, background: `${topic.urgencyColor}12`, border: `1px solid ${topic.urgencyColor}30`, color: topic.urgencyColor, letterSpacing: 2, fontFamily: "'Orbitron', sans-serif", fontWeight: 600, boxShadow: `0 0 8px ${topic.urgencyColor}15` }}>{topic.urgency}</span>
              {DEEP_DIVES[topic.id] && (
                <button onClick={() => setDeepDiveTopic({ topicId: topic.id })} style={{ fontSize: 10, padding: "6px 14px", borderRadius: 6, background: `${topic.color}18`, border: `1px solid ${topic.color}50`, color: topic.color, letterSpacing: 2, fontFamily: "'Orbitron', sans-serif", fontWeight: 600, cursor: "pointer", boxShadow: `0 0 10px ${topic.color}25` }}>◈ READ DEEP DIVE</button>
              )}
            </div>
            <p style={{ fontSize: 13, color: "var(--text-faint)", marginTop: 4, lineHeight: 1.6 }}>{topic.summary}</p>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 28, marginTop: 20 }}>
          <div style={{ fontSize: 11, color: topic.color, fontFamily: "'JetBrains Mono', monospace", letterSpacing: 1 }}>{topic.articles.length} SIGNALS</div>
          <div style={{ flex: 1, height: 1, background: `${topic.color}20` }} />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {topic.articles.map((article, idx) => {
            const artId = `${topic.id}-${idx}`;
            const isExpanded = expandedArticle === artId;
            return (
              <GlassCard key={idx} onClick={() => setExpandedArticle(isExpanded ? null : artId)} style={{ borderLeft: `3px solid ${topic.color}`, cursor: "pointer" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                  <h3 style={{ fontSize: 15, fontWeight: 500, color: "var(--text)", margin: 0, fontFamily: "'Sora', sans-serif", flex: 1 }}>{article.title}</h3>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginLeft: 16, flexShrink: 0 }}>
                    <span style={{ fontSize: 10, color: "var(--text-faint)", fontFamily: "'JetBrains Mono', monospace" }}>{article.time}</span>
                  </div>
                </div>
                <p style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.7, margin: "0 0 12px" }}>{article.desc}</p>

                {/* Heat meter */}
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                  <span style={{ fontSize: 9, color: "var(--text-faint)", letterSpacing: 1, fontFamily: "'Orbitron', sans-serif" }}>SIGNAL</span>
                  <div style={{ flex: 1, height: 3, background: "var(--card-bg)", borderRadius: 2, maxWidth: 200, overflow: "hidden" }}>
                    <div style={{ width: `${article.heat}%`, height: "100%", borderRadius: 2, background: `linear-gradient(90deg, ${topic.color}66, ${topic.color})`, boxShadow: `0 0 8px ${topic.color}44`, transition: "width 1s ease" }} />
                  </div>
                  <span style={{ fontSize: 10, color: topic.color, fontFamily: "'Orbitron', sans-serif" }}>{article.heat}%</span>
                </div>

                {isExpanded && (
                  <div style={{ marginTop: 16, animation: "fadeInUp 0.3s ease", display: "flex", gap: 10 }}>
                    <button onClick={(e) => { e.stopPropagation(); toggleSave(artId); }} style={{
                      padding: "8px 18px", borderRadius: 6,
                      background: savedArticles.has(artId) ? `${topic.color}18` : "rgba(255,255,255,0.03)",
                      border: `1px solid ${savedArticles.has(artId) ? `${topic.color}40` : "rgba(255,255,255,0.08)"}`,
                      color: savedArticles.has(artId) ? topic.color : "rgba(255,255,255,0.4)",
                      cursor: "pointer", fontSize: 10, letterSpacing: 2, fontFamily: "'Orbitron', sans-serif",
                    }}>{savedArticles.has(artId) ? "★ SAVED" : "☆ SAVE"}</button>
                    <button onClick={(e) => { e.stopPropagation(); setDeepDiveTopic({ topicId: topic.id, articleIdx: idx }); }} style={{ padding: "8px 18px", borderRadius: 6, background: `${topic.color}12`, border: `1px solid ${topic.color}30`, color: topic.color, cursor: "pointer", fontSize: 10, letterSpacing: 2, fontFamily: "'Orbitron', sans-serif" }}>{DEEP_DIVES[topic.id] ? "DEEP DIVE →" : "COMING SOON"}</button>
                    <button style={{ padding: "8px 18px", borderRadius: 6, background: "var(--card-bg)", border: "1px solid var(--card-border)", color: "var(--text-faint)", cursor: "pointer", fontSize: 10, letterSpacing: 2, fontFamily: "'Orbitron', sans-serif" }}>SHARE</button>
                  </div>
                )}

                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
                  {article.tags.map(t => (
                    <span key={t} style={{ fontSize: 9, padding: "2px 8px", borderRadius: 20, background: `${topic.color}10`, color: `${topic.color}cc`, border: `1px solid ${topic.color}20`, letterSpacing: 1 }}>{t}</span>
                  ))}
                </div>
              </GlassCard>
            );
          })}
        </div>

        {/* Bottom disclaimer */}
        <div style={{ marginTop: 28, padding: 18, borderRadius: 10, background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
          <p style={{ fontSize: 11, color: "var(--text-dim)", lineHeight: 1.8, fontFamily: "'JetBrains Mono', monospace", margin: 0, textAlign: "center" }}>
            TH3 AWAR3N3SS presents information for research and discussion. Think critically. Verify independently. Trust your discernment.
          </p>
        </div>
      </div>
    );
  }

  // ─── Main Feed View ───
  return (
    <div style={{ animation: "fadeInUp 0.5s ease" }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
          <div style={{ width: 3, height: 28, background: "linear-gradient(to bottom, #ef4444, #eab308)", borderRadius: 2 }} />
          <h2 style={{ fontSize: 22, fontWeight: 300, color: "var(--text)", fontFamily: "'Sora', sans-serif", margin: 0 }}>Wake Up</h2>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#ef4444", boxShadow: "0 0 10px #ef444488", animation: "orbPulse 2s ease-in-out infinite" }} />
          <span style={{ fontSize: 10, color: "#ef4444", fontFamily: "'Orbitron', sans-serif", letterSpacing: 2 }}>LIVE SIGNAL</span>
        </div>
        <p style={{ fontSize: 13, color: "var(--text-faint)", lineHeight: 1.8, marginTop: 8 }}>
          The truth doesn't need permission. {totalArticles} signals across {WAKEUP_TOPICS.length} critical topics. Research everything. Question everything. Trust your own discernment.
        </p>
      </div>

      {/* Alert banner */}
      <div style={{
        padding: "14px 20px", borderRadius: 10, marginBottom: 24,
        background: "linear-gradient(90deg, rgba(239,68,68,0.08), rgba(234,179,8,0.08))",
        border: "1px solid rgba(239,68,68,0.15)", display: "flex", alignItems: "center", gap: 14,
      }}>
        <span style={{ fontSize: 18 }}>⚠️</span>
        <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0, lineHeight: 1.6, flex: 1 }}>
          This section contains documented facts, emerging theories, and contested claims. Evidence levels vary. We present the information — you decide what resonates.
        </p>
      </div>

      {/* Search */}
      <div style={{ marginBottom: 20 }}>
        <input value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="Search signals... (Epstein, fluoride, GMO, Tesla...)"
          style={{ width: "100%", background: "var(--card-bg)", border: "1px solid var(--card-border)", borderRadius: 10, padding: "14px 20px 14px 44px", color: "var(--text)", fontSize: 14, outline: "none", fontFamily: "'JetBrains Mono', monospace" }} />
      </div>

      {/* Filter pills */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 28 }}>
        {urgencyFilters.map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{
            padding: "5px 14px", borderRadius: 20, fontSize: 10, letterSpacing: 2, cursor: "pointer",
            fontFamily: "'Orbitron', sans-serif", transition: "all 0.2s ease",
            background: filter === f ? "rgba(239,68,68,0.12)" : "rgba(255,255,255,0.03)",
            border: `1px solid ${filter === f ? "rgba(239,68,68,0.3)" : "rgba(255,255,255,0.06)"}`,
            color: filter === f ? "#ef4444" : "rgba(255,255,255,0.3)",
          }}>{f}</button>
        ))}
      </div>

      {/* Stats */}
      <div style={{ display: "flex", gap: 14, marginBottom: 32, flexWrap: "wrap" }}>
        {[
          { label: "Active Signals", value: totalArticles, color: "#ef4444" },
          { label: "Topics", value: WAKEUP_TOPICS.length, color: "#eab308" },
          { label: "Declassified", value: WAKEUP_TOPICS.reduce((a, t) => a + t.articles.filter(ar => ar.tags.some(tag => tag.includes("DECLASSIFIED") || tag.includes("PROVEN") || tag.includes("DOCUMENTED"))).length, 0), color: "#00ff8c" },
          { label: "Saved", value: savedArticles.size, color: "#a78bfa" },
        ].map(s => (
          <div key={s.label} style={{
            flex: "1 1 130px", padding: "18px 20px", borderRadius: 12, textAlign: "center",
            background: `linear-gradient(135deg, ${s.color}08, ${s.color}03)`,
            border: `1px solid ${s.color}15`,
            boxShadow: `0 4px 20px ${s.color}08, inset 0 1px 0 rgba(255,255,255,0.03)`,
          }}>
            <div style={{ fontSize: 24, fontWeight: 700, color: s.color, fontFamily: "'Orbitron', sans-serif", textShadow: `0 0 20px ${s.color}30` }}>{s.value}</div>
            <div style={{ fontSize: 9, color: "var(--text-faint)", letterSpacing: 2, textTransform: "uppercase", marginTop: 6, fontFamily: "'Sora', sans-serif", fontWeight: 500 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Topic Cards */}
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {filteredTopics.map(topic => (
          <GlassCard key={topic.id} onClick={() => setActiveTopicId(topic.id)} style={{
            cursor: "pointer", borderLeft: `3px solid ${topic.color}`,
            display: "flex", gap: 20, flexWrap: "wrap", alignItems: "flex-start",
          }}>
            <div style={{ flex: "0 0 auto" }}>
              <span style={{ fontSize: 36 }}>{topic.icon}</span>
            </div>
            <div style={{ flex: 1, minWidth: 240 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6, flexWrap: "wrap" }}>
                <h3 style={{ fontSize: 17, fontWeight: 600, color: "var(--text)", fontFamily: "'Orbitron', sans-serif", margin: 0, letterSpacing: 1 }}>{topic.title}</h3>
                <span style={{ fontSize: 9, padding: "2px 10px", borderRadius: 4, background: `${topic.urgencyColor}15`, border: `1px solid ${topic.urgencyColor}30`, color: topic.urgencyColor, letterSpacing: 2, fontFamily: "'Orbitron', sans-serif", animation: topic.urgency === "CRITICAL" || topic.urgency === "NOW" ? "orbPulse 2s ease-in-out infinite" : "none" }}>
                  {topic.urgency}
                </span>
              </div>
              <p style={{ fontSize: 12, color: "var(--text-faint)", lineHeight: 1.7, margin: "0 0 14px" }}>{topic.summary}</p>

              {/* Mini article preview */}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
                {topic.articles.slice(0, 3).map((a, i) => (
                  <span key={i} style={{ fontSize: 9, padding: "3px 10px", borderRadius: 12, background: "var(--card-bg)", color: "var(--text-faint)", border: "1px solid var(--card-border)" }}>
                    {a.title.substring(0, 30)}{a.title.length > 30 ? "..." : ""}
                  </span>
                ))}
                {topic.articles.length > 3 && <span style={{ fontSize: 9, padding: "3px 8px", color: topic.color }}>+{topic.articles.length - 3} more</span>}
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 10, color: topic.color, letterSpacing: 2, fontFamily: "'Orbitron', sans-serif" }}>{topic.articles.length} SIGNALS</span>
                <div style={{ flex: 1, height: 1, background: `${topic.color}15`, maxWidth: 200 }} />
                <span style={{ fontSize: 10, color: topic.color, letterSpacing: 3, fontFamily: "'Orbitron', sans-serif", fontWeight: 600, textShadow: `0 0 10px ${topic.color}30` }}>ENTER →</span>
              </div>
            </div>
          </GlassCard>
        ))}
      </div>

      {/* Bottom banner */}
      <div style={{
        marginTop: 32, padding: 28, borderRadius: 16,
        background: "linear-gradient(135deg, rgba(239,68,68,0.06), rgba(234,179,8,0.06), rgba(167,139,250,0.06))",
        border: "1px solid rgba(239,68,68,0.1)", position: "relative", overflow: "hidden", textAlign: "center",
      }}>
        <div style={{ position: "absolute", top: -30, right: -30, fontSize: 140, opacity: 0.03 }}>👁</div>
        <div style={{ fontSize: 10, letterSpacing: 4, color: "#ef4444", fontFamily: "'Orbitron', sans-serif", marginBottom: 12 }}>◉ THE SIGNAL</div>
        <h3 style={{ fontSize: 20, color: "var(--text)", fontWeight: 300, marginBottom: 8, fontFamily: "'Sora', sans-serif" }}>
          "In a time of universal deceit, telling the truth is a revolutionary act."
        </h3>
        <p style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "'JetBrains Mono', monospace" }}>— Often attributed to George Orwell</p>
      </div>

      {/* Disclaimer */}
      <div style={{ marginTop: 24, padding: 18, borderRadius: 10, background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
        <p style={{ fontSize: 11, color: "var(--text-dim)", lineHeight: 1.8, fontFamily: "'JetBrains Mono', monospace", margin: 0, textAlign: "center" }}>
          TH3 AWAR3N3SS encourages independent research and critical thinking. Evidence levels vary across topics. 
          Some content is based on declassified documents, some on emerging research, and some on theories under active debate. 
          Always verify. Always think for yourself.
        </p>
      </div>
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════
// WORMHOLE TRANSITION — Matrix tunnel with speed streaks
// ═══════════════════════════════════════════════════════════════
function WormholeTransition() {
  const canvasRef = useRef(null);
  const animRef = useRef(null);
  const startTime = useRef(Date.now());

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let w = window.innerWidth, h = window.innerHeight;
    canvas.width = w; canvas.height = h;
    const resize = () => { w = window.innerWidth; h = window.innerHeight; canvas.width = w; canvas.height = h; };
    window.addEventListener("resize", resize);

    const _cx = () => w / 2, _cy = () => h / 2;
    const fontSize = 14;
    const chars = "アイウエオカキクケコサシスセソタチツテト0123456789ABCDEFTH3AΣΩΔΘΨξ∞◈⬡◎⊛✧";

    // Matrix rain columns — start as normal falling rain
    const cols = Math.floor(w / fontSize);
    const rainDrops = Array.from({ length: cols }, (_, i) => ({
      x: i * fontSize,
      y: Math.random() * h,
      speed: 2 + Math.random() * 4,
      chars: Array.from({ length: Math.floor(h / fontSize) + 5 }, () => chars[Math.floor(Math.random() * chars.length)]),
      brightness: 0.65 + Math.random() * 0.35,
    }));

    // Tunnel character particles — these form the portal tube
    const tunnelChars = Array.from({ length: 600 }, (_, i) => ({
      angle: Math.random() * Math.PI * 2,
      z: Math.random() * 2000,
      radius: 80 + Math.random() * 250,
      char: chars[Math.floor(Math.random() * chars.length)],
      speed: 1 + Math.random() * 3,
      rotSpeed: 0.002 + Math.random() * 0.008,
      size: 10 + Math.random() * 8,
      brightness: Math.random(),
    }));

    const draw = () => {
      const elapsed = (Date.now() - startTime.current) / 1000;
      const totalDuration = 5.5;
      const progress = Math.min(elapsed / totalDuration, 1);
      const cx = _cx(), cy = _cy();

      // Trail fade
      const trailAlpha = progress < 0.15 ? 0.04 : progress < 0.5 ? 0.06 : 0.08 + progress * 0.04;
      ctx.fillStyle = `rgba(5, 5, 8, ${trailAlpha})`;
      ctx.fillRect(0, 0, w, h);

      const flySpeed = 2 + progress * progress * 40;
      const spiralStrength = Math.min(progress / 0.3, 1); // 0→1 over first 30%
      const tunnelStrength = progress > 0.15 ? Math.min((progress - 0.15) / 0.2, 1) : 0; // fade in tunnel

      // ── PHASE 1: Matrix rain spirals into center ──
      if (progress < 0.5) {
        const rainFade = progress > 0.35 ? 1 - (progress - 0.35) / 0.15 : 1;

        rainDrops.forEach(drop => {
          drop.y += drop.speed * (1 + spiralStrength * 3);
          if (drop.y > h + fontSize * 5) drop.y = -fontSize * 5;

          const colLen = Math.min(drop.chars.length, 15);
          for (let j = 0; j < colLen; j++) {
            let x = drop.x;
            let y = drop.y - j * fontSize;
            if (y < -fontSize || y > h + fontSize) continue;

            // Spiral toward center
            const dx = x - cx;
            const dy = y - cy;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const angle = Math.atan2(dy, dx) + spiralStrength * 2.5 * (1 - dist / (w * 0.7));
            const newDist = dist * (1 - spiralStrength * 0.65);
            x = cx + Math.cos(angle) * newDist;
            y = cy + Math.sin(angle) * newDist;

            // Randomize char occasionally
            if (Math.random() > 0.95) drop.chars[j] = chars[Math.floor(Math.random() * chars.length)];

            const alpha = (j === 0 ? 1 : Math.max(0.25, (1 - j / colLen)) * 0.85) * drop.brightness * rainFade;
            const isHead = j === 0;

            if (isHead) {
              ctx.fillStyle = `rgba(220, 255, 235, ${alpha})`;
              ctx.shadowColor = "#00ff8c";
              ctx.shadowBlur = 14;
            } else {
              ctx.fillStyle = `rgba(60, 255, 170, ${alpha})`;
              ctx.shadowColor = "#00ff8c";
              ctx.shadowBlur = 4;
            }
            ctx.font = `${fontSize}px 'JetBrains Mono', monospace`;
            ctx.fillText(drop.chars[j], x, y);
            ctx.shadowBlur = 0;
          }
        });
      }

      // ── PHASE 2: Character tunnel — being sucked through a portal ──
      if (progress > 0.15) {
        const alpha = tunnelStrength;

        tunnelChars.forEach(tc => {
          // Move toward camera
          tc.z -= flySpeed * tc.speed;
          if (tc.z < -50) {
            tc.z = 2000;
            tc.angle = Math.random() * Math.PI * 2;
            tc.char = chars[Math.floor(Math.random() * chars.length)];
            tc.brightness = Math.random();
          }

          // Rotate around the tunnel axis
          tc.angle += tc.rotSpeed * (1 + progress * 3);

          // Project 3D to 2D — perspective
          const perspective = 400 / (tc.z + 1);
          const screenX = cx + Math.cos(tc.angle) * tc.radius * perspective;
          const screenY = cy + Math.sin(tc.angle) * tc.radius * perspective;
          const screenSize = tc.size * perspective;

          // Only draw if on screen and not too tiny
          if (screenX > -50 && screenX < w + 50 && screenY > -50 && screenY < h + 50 && screenSize > 2 && screenSize < 80) {
            const depth = 1 - tc.z / 2000;
            const charAlpha = Math.min(1, (0.35 + depth * 0.65) * alpha * (0.55 + tc.brightness * 0.65));

            // Closer chars are brighter, whiter — floor raised so the swirl reads at every depth
            if (depth > 0.85) {
              ctx.fillStyle = `rgba(230, 255, 240, ${charAlpha})`;
              ctx.shadowColor = "#00ff8c";
              ctx.shadowBlur = 12 + depth * 12;
            } else if (depth > 0.5) {
              ctx.fillStyle = `rgba(70, 255, 175, ${charAlpha})`;
              ctx.shadowColor = "#00ff8c";
              ctx.shadowBlur = 8;
            } else {
              ctx.fillStyle = `rgba(0, 255, 140, ${charAlpha * 0.85})`;
              ctx.shadowColor = "#00ff8c";
              ctx.shadowBlur = 3;
            }

            ctx.font = `${Math.max(4, screenSize)}px 'JetBrains Mono', monospace`;
            ctx.fillText(tc.char, screenX, screenY);
            ctx.shadowBlur = 0;
          }
        });

        // Dark tunnel rim — creates the tube illusion
        const rimGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * 0.5);
        rimGrad.addColorStop(0, "transparent");
        rimGrad.addColorStop(0.3, "transparent");
        rimGrad.addColorStop(0.6, `rgba(0, 20, 10, ${0.3 * alpha})`);
        rimGrad.addColorStop(0.8, `rgba(0, 10, 5, ${0.6 * alpha})`);
        rimGrad.addColorStop(1, `rgba(5, 5, 8, ${0.9 * alpha})`);
        ctx.fillStyle = rimGrad;
        ctx.fillRect(0, 0, w, h);

        // Center glow — the light at the end of the tunnel (grows with progress)
        if (progress > 0.4) {
          const glowProgress = (progress - 0.4) / 0.6;
          const glowR = 20 + glowProgress * 60;
          const glowGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowR);
          glowGrad.addColorStop(0, `rgba(200, 255, 220, ${glowProgress * 0.3})`);
          glowGrad.addColorStop(0.5, `rgba(0, 255, 140, ${glowProgress * 0.1})`);
          glowGrad.addColorStop(1, "transparent");
          ctx.fillStyle = glowGrad;
          ctx.fillRect(0, 0, w, h);
        }
      }

      // ── PHASE 3: White light engulfs ──
      if (progress > 0.75) {
        const whiteP = (progress - 0.75) / 0.25;
        const eased = whiteP * whiteP * whiteP;

        const pulseR = 30 + eased * Math.max(w, h) * 1.2;
        const lightGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, pulseR);
        lightGrad.addColorStop(0, `rgba(255, 255, 255, ${eased})`);
        lightGrad.addColorStop(0.15, `rgba(220, 255, 240, ${eased * 0.9})`);
        lightGrad.addColorStop(0.35, `rgba(180, 240, 255, ${eased * 0.5})`);
        lightGrad.addColorStop(0.6, `rgba(100, 255, 180, ${eased * 0.2})`);
        lightGrad.addColorStop(1, "transparent");
        ctx.fillStyle = lightGrad;
        ctx.fillRect(0, 0, w, h);

        if (progress > 0.9) {
          const finalAlpha = (progress - 0.9) / 0.1;
          ctx.fillStyle = `rgba(255, 255, 255, ${finalAlpha})`;
          ctx.fillRect(0, 0, w, h);
        }
      }

      animRef.current = requestAnimationFrame(draw);
    };
    animRef.current = requestAnimationFrame(draw);
    return () => { window.removeEventListener("resize", resize); cancelAnimationFrame(animRef.current); };
  }, []);

  return <canvas ref={canvasRef} style={{ position: "fixed", inset: 0, zIndex: 10, width: "100%", height: "100%" }} />;
}

// ─── Subtle Matrix Rain Overlay for Homepage ───
// ─── Matrix Wave — Full-screen character rain trigger ───
function MatrixWave({ active, mood = "dark" }) {
  const canvasRef = useRef(null);
  const animRef = useRef(null);
  const moodRef = useRef(mood);

  useEffect(() => { moodRef.current = mood; }, [mood]);

  useEffect(() => {
    if (!active) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let w = window.innerWidth, h = window.innerHeight;
    canvas.width = w; canvas.height = h;

    const resize = () => { w = window.innerWidth; h = window.innerHeight; canvas.width = w; canvas.height = h; };
    window.addEventListener("resize", resize);

    const chars = "アイウエオカキクケコサシスセソタチツテト0123456789TH3AΣΩΔΘΨ∞◈⬡✧";
    const fontSize = 16;
    const cols = Math.floor(w / fontSize);
    const drops = Array.from({ length: cols }, (_, i) => ({
      x: i * fontSize,
      y: -fontSize * 5 - (i * 0.8) - Math.random() * 100,
      speed: 8 + Math.random() * 6,
      length: 15 + Math.floor(Math.random() * 20),
      chars: Array.from({ length: 35 }, () => chars[Math.floor(Math.random() * chars.length)]),
      started: false,
    }));

    const startTime = Date.now();

    const draw = () => {
      const elapsed = (Date.now() - startTime) / 1000;
      const isLight = moodRef.current === "light";

      // Theme-aware color palettes
      // Light mode: deep emerald/forest green that pops on white
      // Dark mode: bright neon green that glows on black
      const headColor = isLight ? "13, 60, 35" : "220, 255, 235";
      const bodyColor = isLight ? "13, 100, 60" : "0, 255, 140";
      const tailColor = isLight ? "13, 150, 104" : "0, 255, 140";
      const glowColor = isLight ? "#0d9668" : "#00ff8c";

      ctx.clearRect(0, 0, w, h);

      drops.forEach((drop, i) => {
        const waveDelay = (i / cols) * 0.8;
        if (elapsed < waveDelay) return;

        drop.y += drop.speed;

        for (let j = 0; j < drop.length; j++) {
          const y = drop.y - j * fontSize;
          if (y < -fontSize || y > h + fontSize) continue;

          if (Math.random() > 0.94) drop.chars[j] = chars[Math.floor(Math.random() * chars.length)];

          const isHead = j === 0;
          const fadeOut = elapsed > 4.5 ? Math.max(0, 1 - (elapsed - 4.5) / 1.5) : 1;
          const tailFade = Math.pow(1 - j / drop.length, 1.6);
          const alpha = (isHead ? 1 : tailFade * 0.85) * fadeOut;

          if (isHead) {
            ctx.fillStyle = `rgba(${headColor}, ${alpha})`;
            ctx.shadowColor = glowColor;
            ctx.shadowBlur = isLight ? 8 : 14;
          } else if (j < 4) {
            ctx.fillStyle = `rgba(${bodyColor}, ${alpha * 0.95})`;
            ctx.shadowColor = glowColor;
            ctx.shadowBlur = isLight ? 3 : 6;
          } else {
            ctx.fillStyle = `rgba(${tailColor}, ${alpha * (isLight ? 0.75 : 0.6)})`;
            ctx.shadowBlur = 0;
          }

          ctx.font = `${fontSize}px 'JetBrains Mono', monospace`;
          ctx.fillText(drop.chars[j], drop.x, y);
          ctx.shadowBlur = 0;
        }

        if (drop.y - drop.length * fontSize > h && elapsed < 4) {
          drop.y = -fontSize * 5 - Math.random() * 200;
          drop.chars = Array.from({ length: 35 }, () => chars[Math.floor(Math.random() * chars.length)]);
        }
      });

      if (elapsed < 6) {
        animRef.current = requestAnimationFrame(draw);
      } else {
        ctx.clearRect(0, 0, w, h);
      }
    };
    animRef.current = requestAnimationFrame(draw);

    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(animRef.current);
    };
  }, [active]);

  if (!active) return null;
  return (
    <canvas ref={canvasRef} style={{
      position: "fixed", inset: 0, zIndex: 9999,
      pointerEvents: "none",
      width: "100vw", height: "100vh",
      background: "transparent",
    }} />
  );
}


function MatrixOverlay({ mood = "balanced" }) {
  const canvasRef = useRef(null);
  const animRef = useRef(null);
  const moodRef = useRef(mood);

  useEffect(() => { moodRef.current = mood; }, [mood]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let w, h, columns, drops;
    const chars = "01アウエカキサシスセタチツテトTH3AΩΔΘ∞◈⬡◎⊛✧";
    const fontSize = 13;

    const moodColors = {
      dark: { r: 0, g: 255, b: 140 },
      light: { r: 8, g: 110, b: 70 }, // deeper forest green for white background contrast
    };

    const init = () => {
      w = window.innerWidth; h = window.innerHeight;
      canvas.width = w; canvas.height = h;
      columns = Math.floor(w / (fontSize * 2.5));
      drops = Array.from({ length: columns }, () => Math.random() * -50);
    };
    init();
    window.addEventListener("resize", init);

    const draw = () => {
      const isLight = moodRef.current === "light";
      const c = moodColors[isLight ? "light" : "dark"];

      // Trail fade tinted to match current background — white-ish on light, dark on dark
      ctx.fillStyle = isLight ? "rgba(245, 245, 240, 0.08)" : "rgba(5, 5, 8, 0.06)";
      ctx.fillRect(0, 0, w, h);

      for (let i = 0; i < drops.length; i++) {
        const char = chars[Math.floor(Math.random() * chars.length)];
        const x = i * fontSize * 2.5;
        const y = drops[i] * fontSize;

        const brightness = Math.random();
        // Light mode uses much higher alphas because dark green on white needs more punch
        if (brightness > 0.95) {
          ctx.fillStyle = `rgba(${c.r}, ${c.g}, ${c.b}, ${isLight ? 1.0 : 0.6})`;
          ctx.shadowColor = `rgb(${c.r}, ${c.g}, ${c.b})`;
          ctx.shadowBlur = isLight ? 4 : 12;
        } else if (brightness > 0.8) {
          ctx.fillStyle = `rgba(${c.r}, ${c.g}, ${c.b}, ${isLight ? 0.85 : 0.3})`;
          ctx.shadowColor = `rgb(${c.r}, ${c.g}, ${c.b})`;
          ctx.shadowBlur = isLight ? 2 : 5;
        } else if (brightness > 0.5) {
          ctx.fillStyle = `rgba(${c.r}, ${c.g}, ${c.b}, ${isLight ? 0.55 : 0.12})`;
          ctx.shadowBlur = 0;
        } else {
          ctx.fillStyle = `rgba(${c.r}, ${c.g}, ${c.b}, ${isLight ? 0.3 + Math.random() * 0.2 : 0.04 + Math.random() * 0.06})`;
          ctx.shadowBlur = 0;
        }
        ctx.font = `${fontSize}px 'JetBrains Mono', monospace`;
        ctx.fillText(char, x, y);
        ctx.shadowBlur = 0;

        if (y > h && Math.random() > 0.982) drops[i] = 0;
        drops[i] += 0.35 + Math.random() * 0.25;
      }
      animRef.current = requestAnimationFrame(draw);
    };
    animRef.current = requestAnimationFrame(draw);
    return () => { window.removeEventListener("resize", init); cancelAnimationFrame(animRef.current); };
  }, []);

  return <canvas ref={canvasRef} style={{ position: "fixed", inset: 0, zIndex: 0, opacity: mood === "light" ? 0.85 : 0.65, pointerEvents: "none", transition: "opacity 0.5s ease" }} />;
}


// ═══════════════════════════════════════════════════════════════
// ENERGY 101 — The Foundation of Everything
// ═══════════════════════════════════════════════════════════════

function Energy101Section({ setActiveTab }) {
  const [activeChapter, setActiveChapter] = useState(null);

  const chapters = [
    {
      id: "atoms", num: "01", title: "You Are Not Solid", icon: "⚛️", color: "#06b6d4",
      subtitle: "What you're actually made of",
      content: [
        { type: "big", text: "Pick up anything near you. Your phone. A cup. Your own hand. It feels solid, right?" },
        { type: "p", text: "But zoom in far enough — past the skin cells, past the molecules, past the atoms — and you'll find something shocking: it's almost entirely empty space. Every atom in your body is 99.9999% nothing. The tiny bit of matter that IS there isn't sitting still. It's vibrating. Oscillating. Spinning. Pulsing with energy billions of times per second." },
        { type: "p", text: "This isn't a metaphor. This isn't spiritual language. This is what your high school physics teacher should have made a bigger deal about. You — right now, reading this — are a cloud of vibrating energy holding a shape. The chair you're sitting on is a cloud of vibrating energy holding a different shape. The air between you and the screen is vibrating too." },
        { type: "highlight", text: "Everything in the universe — from a grain of sand to a star — is vibration. Different frequencies, different patterns, but all vibration. Including you." },
        { type: "p", text: "Quantum physics proved this over 100 years ago. Max Planck, the father of quantum theory, said it plainly: 'There is no matter as such. All matter originates and exists only by virtue of a force which brings the particle of an atom to vibration.' In other words — vibration came first. Matter is what vibration looks like when it slows down enough for you to touch it." },
      ]
    },
    {
      id: "fields", num: "02", title: "Everything Has a Field", icon: "🧲", color: "#a78bfa",
      subtitle: "The invisible force around all things",
      content: [
        { type: "big", text: "Anything that vibrates produces an electromagnetic field. No exceptions." },
        { type: "p", text: "Hold two magnets near each other. You can feel the push or pull — an invisible force moving through empty space. That's an electromagnetic field. Now here's the thing: your body is full of electrical activity. Your heart generates electrical impulses 100,000 times a day. Your brain fires billions of electrical signals every second. Every muscle contraction, every nerve impulse, every cellular process — all electrical." },
        { type: "p", text: "All of that electrical activity produces electromagnetic fields that extend OUTSIDE your body. Your heart's field is the strongest — scientists at the HeartMath Institute have measured it extending 3 to 5 feet from your body in every direction using sensitive magnetometers. Your brain has a field too, just weaker. Every organ does. Combined, they create what researchers call your BIOFIELD — an egg-shaped electromagnetic field that surrounds your entire body." },
        { type: "highlight", text: "You are a walking electromagnetic broadcast tower. You are constantly emitting a signal — whether you know it or not." },
        { type: "p", text: "And here's where it gets interesting: your field doesn't stop at some invisible wall. It interacts with every other field it touches. The person sitting next to you on the bus? Your fields are overlapping. Your pet lying on your lap? Your fields are merging. You're exchanging electromagnetic information all the time — without saying a word." },
      ]
    },
    {
      id: "input", num: "03", title: "Input Becomes Output", icon: "🔄", color: "#22c55e",
      subtitle: "What you consume is what you emit",
      content: [
        { type: "big", text: "Your body is a converter. Whatever goes in, gets transformed, and comes back out as your electromagnetic signal." },
        { type: "p", text: "Think of your body like a speaker system. The music that comes out depends entirely on the signal you feed in. Feed it a clean, high-quality audio file? Beautiful, clear sound. Feed it a corrupted, distorted file? Static, noise, chaos." },
        { type: "p", text: "Your body works the same way. Every cell is a tiny electrochemical engine that runs on what you give it:" },
        { type: "list", items: [
          { label: "Food", text: "becomes the raw material your cells use to generate energy (ATP). Living, nutrient-dense food = strong, coherent cellular signals. Dead, processed food = weak, chaotic signals." },
          { label: "Water", text: "is the medium through which every electrical signal in your body travels. Clean, structured water = efficient signal transmission. Contaminated water with fluoride and chlorine = impaired conductivity." },
          { label: "Air", text: "feeds the oxygen combustion that powers every cell. Deep, intentional breathing = fully oxygenated cells firing at peak capacity. Shallow stress breathing = cells running on empty." },
          { label: "Thoughts", text: "create measurable electrical patterns in your brain that ripple through your entire nervous system. Focused, positive thought patterns = coherent neural firing. Anxious, scattered thoughts = chaotic neural static." },
          { label: "Emotions", text: "physically reshape your heart's electromagnetic field in real time. Love and gratitude = smooth, expanded, powerful field. Fear and anger = jagged, contracted, weak field." },
        ]},
        { type: "highlight", text: "You are not just what you eat. You are what you eat, drink, breathe, think, and feel — because all of it becomes the electromagnetic signal you broadcast into the world." },
      ]
    },
    {
      id: "resonance", num: "04", title: "Resonance — The Key to Everything", icon: "〰️", color: "#eab308",
      subtitle: "How vibrations sync up and influence each other",
      content: [
        { type: "big", text: "In 1665, Dutch physicist Christiaan Huygens noticed something strange: pendulum clocks hanging on the same wall would synchronize their swings — every time." },
        { type: "p", text: "He had discovered resonance — the tendency of vibrating things to sync up with each other. Strike a tuning fork and hold it near another tuning fork of the same frequency. The second one starts vibrating too, without being touched. The vibration transfers through the air." },
        { type: "p", text: "Your body does this constantly. When you're near someone who is calm, centered, and radiating a coherent electromagnetic field, your nervous system begins to entrain (sync) with theirs. Your heart rhythm smooths out. Your breathing slows. You start to feel what they feel. This is why certain people make you feel peaceful just by being near them." },
        { type: "p", text: "The reverse is also true. Someone radiating stress, anxiety, or anger has a chaotic electromagnetic field. Spend enough time near them and your field starts to mirror theirs. Your heart rate increases. Your muscles tense. You absorb their state — not through words, but through field-to-field electromagnetic resonance." },
        { type: "highlight", text: "This is why 'raise your vibration' isn't just a saying. It's physics. When you elevate the coherence of your own field, you literally pull everyone around you upward through resonance." },
        { type: "p", text: "This also explains why group meditation is more powerful than solo meditation. Why live concerts feel transcendent. Why being in nature calms you down (trees have coherent biofields too). And why a single person in a state of deep love or gratitude can measurably shift the energy of an entire room." },
      ]
    },
    {
      id: "earth", num: "05", title: "You're Plugged Into Earth", icon: "🌍", color: "#f97316",
      subtitle: "The planet has a heartbeat — and you're tuned to it",
      content: [
        { type: "big", text: "The Earth has its own electromagnetic field, generated by molten iron churning in its core. And it pulses." },
        { type: "p", text: "The base frequency of Earth's electromagnetic field is 7.83 Hz — called the Schumann Resonance. It was discovered in 1952 and has been measured continuously ever since. Here's the remarkable part: your brain's alpha waves — the ones you produce when you're calm, aware, and present — operate at almost the exact same frequency." },
        { type: "p", text: "This isn't coincidence. Life on this planet evolved INSIDE Earth's electromagnetic field for billions of years. Your nervous system is literally tuned to the planet's frequency, like a radio tuned to a station. When you walk barefoot on grass, soil, or sand, free electrons from the Earth flow into your body through your feet. These electrons are nature's antioxidants — they neutralize inflammation on contact." },
        { type: "highlight", text: "The Earth is your charger. When you disconnect from it — rubber-soled shoes, concrete buildings, no time in nature — your electrical system loses its reference signal. You become ungrounded in the most literal, physical sense." },
        { type: "p", text: "Studies published in the Journal of Environmental and Public Health show that grounding (earthing) reduces cortisol, improves sleep, normalizes circadian rhythms, and reduces inflammation markers. NASA discovered this the hard way — astronauts in space, cut off from the Schumann Resonance, developed health problems until engineers installed Schumann Resonance generators in spacecraft." },
        { type: "p", text: "The Global Coherence Initiative has even found correlations between mass human emotional events and measurable disturbances in Earth's magnetic field. We don't just live ON the Earth — we are electrically, magnetically, and vibrationally connected TO it." },
      ]
    },
    {
      id: "control", num: "06", title: "Why They Don't Teach This", icon: "🔒", color: "#ef4444",
      subtitle: "An empowered human is harder to control",
      content: [
        { type: "big", text: "If every person understood they were an electromagnetic being whose field influences everyone around them — the entire control structure would collapse." },
        { type: "p", text: "Think about it. The food industry sells you processed products that weaken your cellular energy. The water supply is treated with fluoride — a compound shown to calcify the pineal gland, the very organ ancient traditions considered the seat of consciousness. The pharmaceutical industry profits from treating symptoms, not from teaching you that your body is a self-healing electrical system. The media keeps you in a constant state of fear — which contracts your biofield and makes you easier to influence." },
        { type: "p", text: "None of this is conspiracy theory. It's incentive structure. There is no profit in a population that knows how to heal itself, generate its own energy, grow its own food, and maintain a coherent biofield through free practices like breathwork, meditation, grounding, and gratitude." },
        { type: "highlight", text: "The most revolutionary act in the modern world is to take complete responsibility for your own energy — what you consume, what you think, what you feel, and what you emit." },
        { type: "p", text: "That's what this platform exists for. Not to tell you what to believe, but to give you the tools, the science, and the community to explore these truths for yourself. Every section on TH3 AWAR3N3SS connects back to this foundation: you are energy, your energy is influenced by what you allow in, and the energy you cultivate is the reality you create — not just for yourself, but for every field your field touches." },
      ]
    },
    {
      id: "now", num: "07", title: "What You Can Do Right Now", icon: "⚡", color: "#00ff8c",
      subtitle: "Simple practices that change your frequency today",
      content: [
        { type: "big", text: "You don't need to buy anything, go anywhere, or believe anything. You just need to start." },
        { type: "list", items: [
          { label: "Breathe", text: "Right now — breathe in for 5 seconds, hold for 5, out for 5. Do this for 2 minutes. You just shifted your nervous system from sympathetic (stress) to parasympathetic (heal). Your biofield expanded. That's real." },
          { label: "Ground", text: "Take off your shoes and stand on earth — grass, dirt, sand — for 20 minutes. Free electrons will flow into your body and begin neutralizing inflammation. You will feel the difference." },
          { label: "Hydrate", text: "Drink clean water. If you can, filter out the fluoride and chlorine. If you can't do that today, at least drink more water. Your electrical signals depend on it." },
          { label: "Feel gratitude", text: "Not as a platitude — as a practice. Think of one thing you're genuinely grateful for and FEEL it in your chest for 60 seconds. HeartMath research shows this creates immediate coherence in your heart's electromagnetic field." },
          { label: "Eat something alive", text: "A piece of fruit. A handful of greens. Something that was recently growing. Living food carries biophotons — light energy stored by the sun. You are literally eating light." },
          { label: "Step outside", text: "Sunlight hitting your skin triggers vitamin D production, regulates your circadian rhythm, and charges your body with photonic energy. 15 minutes. No sunscreen needed for that." },
          { label: "Be still", text: "Sit in silence for 5 minutes. No phone. No music. Just you, breathing, existing. In the silence, your mind stops consuming and starts receiving. This is where intuition lives." },
        ]},
        { type: "highlight", text: "Every one of these practices is free, available right now, and backed by peer-reviewed science. The system charges you for things that lower your vibration and hides the things that raise it for free." },
      ]
    },
  ];

  // Chapter detail view
  if (activeChapter) {
    const ch = chapters.find(c => c.id === activeChapter);
    return (
      <div style={{ animation: "fadeInUp 0.4s ease" }}>
        <button onClick={() => setActiveChapter(null)} style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)", color: "var(--text-muted)", padding: "8px 18px", borderRadius: 8, cursor: "pointer", fontSize: 11, letterSpacing: 2, fontFamily: "'Orbitron', sans-serif", marginBottom: 24 }}>← BACK TO ENERGY 101</button>

        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 8 }}>
          <div style={{ width: 50, height: 50, borderRadius: 12, background: `${ch.color}15`, border: `1px solid ${ch.color}35`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24 }}>{ch.icon}</div>
          <div>
            <span style={{ fontSize: 10, color: ch.color, fontFamily: "'Orbitron', sans-serif", letterSpacing: 3 }}>CHAPTER {ch.num}</span>
            <h2 style={{ fontSize: 24, fontWeight: 600, color: "var(--text)", fontFamily: "'Orbitron', sans-serif", margin: 0, letterSpacing: 1 }}>{ch.title}</h2>
          </div>
        </div>
        <p style={{ fontSize: 13, color: "var(--text-faint)", marginBottom: 28 }}>{ch.subtitle}</p>

        <GlassCard hover={false} style={{ maxWidth: 720, padding: "32px 28px" }}>
          {ch.content.map((block, i) => {
            if (block.type === "big") return <h3 key={i} style={{ fontSize: 20, fontWeight: 400, color: "var(--text)", fontFamily: "'Sora', sans-serif", lineHeight: 1.6, marginBottom: 20 }}>{block.text}</h3>;
            if (block.type === "highlight") return (
              <div key={i} style={{ margin: "24px 0", padding: "20px 24px", borderRadius: 12, background: `${ch.color}08`, borderLeft: `3px solid ${ch.color}`, }}>
                <p style={{ fontSize: 15, color: ch.color, lineHeight: 1.9, margin: 0, fontWeight: 500 }}>{block.text}</p>
              </div>
            );
            if (block.type === "list") return (
              <div key={i} style={{ margin: "16px 0" }}>
                {block.items.map((item, j) => (
                  <div key={j} style={{ display: "flex", gap: 14, marginBottom: 16 }}>
                    <div style={{ width: 6, height: 6, borderRadius: "50%", background: ch.color, marginTop: 8, flexShrink: 0 }} />
                    <div>
                      <span style={{ fontSize: 14, color: "var(--text)", fontWeight: 600 }}>{item.label}</span>
                      <span style={{ fontSize: 14, color: "var(--text-muted)" }}> — {item.text}</span>
                    </div>
                  </div>
                ))}
              </div>
            );
            return <p key={i} style={{ fontSize: 14, color: "var(--text-muted)", lineHeight: 2.1, marginBottom: 16 }}>{block.text}</p>;
          })}
        </GlassCard>

        {/* Navigation */}
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 24 }}>
          {(() => {
            const idx = chapters.findIndex(c => c.id === activeChapter);
            const prev = idx > 0 ? chapters[idx - 1] : null;
            const next = idx < chapters.length - 1 ? chapters[idx + 1] : null;
            return (
              <>
                {prev ? <button onClick={() => setActiveChapter(prev.id)} style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)", color: "var(--text-faint)", padding: "8px 18px", borderRadius: 8, cursor: "pointer", fontSize: 11, letterSpacing: 2, fontFamily: "'Orbitron', sans-serif" }}>← {prev.title}</button> : <div />}
                {next ? <button onClick={() => setActiveChapter(next.id)} style={{ background: `${next.color}10`, border: `1px solid ${next.color}30`, color: next.color, padding: "8px 18px", borderRadius: 8, cursor: "pointer", fontSize: 11, letterSpacing: 2, fontFamily: "'Orbitron', sans-serif" }}>{next.title} →</button> : (
                  <button onClick={() => setActiveTab("biofield")} style={{ background: "rgba(167,139,250,0.1)", border: "1px solid rgba(167,139,250,0.3)", color: "#a78bfa", padding: "8px 18px", borderRadius: 8, cursor: "pointer", fontSize: 11, letterSpacing: 2, fontFamily: "'Orbitron', sans-serif" }}>NEXT: BIO FIELD →</button>
                )}
              </>
            );
          })()}
        </div>
      </div>
    );
  }

  // Main chapter list
  return (
    <div style={{ animation: "fadeInUp 0.5s ease" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
        <div style={{ width: 3, height: 28, background: "linear-gradient(to bottom, #06b6d4, #eab308, #ef4444)", borderRadius: 2 }} />
        <h2 style={{ fontSize: 22, fontWeight: 300, color: "var(--text)", fontFamily: "'Sora', sans-serif", margin: 0 }}>ENERGY 101</h2>
      </div>
      <p style={{ fontSize: 14, color: "var(--text-faint)", lineHeight: 1.8, marginTop: 8, marginBottom: 12 }}>
        The foundation of everything on this platform. Start here.
      </p>
      <p style={{ fontSize: 13, color: "var(--text-faint)", lineHeight: 1.8, marginBottom: 32 }}>
        Seven chapters that explain — in simple, clear language — why you are energy, how your body's electromagnetic field works, why what you consume matters at the atomic level, and how your personal vibration shapes the reality around you. No jargon. No gatekeeping. Just truth.
      </p>

      {/* Chapter list */}
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {chapters.map((ch, idx) => (
          <GlassCard key={ch.id} onClick={() => setActiveChapter(ch.id)} style={{
            cursor: "pointer", display: "flex", alignItems: "center", gap: 20,
            borderLeft: `3px solid ${ch.color}`, padding: "22px 24px",
          }}>
            <div style={{
              width: 50, height: 50, borderRadius: 12,
              background: `${ch.color}12`, border: `1px solid ${ch.color}30`,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 22, flexShrink: 0,
            }}>{ch.icon}</div>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                <span style={{ fontSize: 10, color: ch.color, fontFamily: "'Orbitron', sans-serif", letterSpacing: 2 }}>CHAPTER {ch.num}</span>
              </div>
              <h3 style={{ fontSize: 16, fontWeight: 600, color: "var(--text)", margin: 0, fontFamily: "'Sora', sans-serif" }}>{ch.title}</h3>
              <p style={{ fontSize: 12, color: "var(--text-faint)", margin: "4px 0 0" }}>{ch.subtitle}</p>
            </div>
            <span style={{ fontSize: 11, color: ch.color, letterSpacing: 2, fontFamily: "'Orbitron', sans-serif", flexShrink: 0 }}>READ →</span>
          </GlassCard>
        ))}
      </div>

      {/* Where to go next */}
      <div style={{ marginTop: 32, padding: 28, borderRadius: 16, background: "linear-gradient(135deg, rgba(6,182,212,0.06), rgba(167,139,250,0.06), rgba(234,179,8,0.06))", border: "1px solid rgba(6,182,212,0.1)", textAlign: "center" }}>
        <span style={{ fontSize: 10, letterSpacing: 4, color: "#06b6d4", fontFamily: "'Orbitron', sans-serif", display: "block", marginBottom: 12 }}>⟡ AFTER ENERGY 101</span>
        <h3 style={{ fontSize: 18, color: "var(--text)", fontWeight: 400, marginBottom: 8, fontFamily: "'Sora', sans-serif" }}>Ready to go deeper?</h3>
        <p style={{ fontSize: 13, color: "var(--text-faint)", lineHeight: 1.8, maxWidth: 500, margin: "0 auto 20px" }}>
          Now that you understand the foundation, explore how your biofield responds to emotions, learn how to heal your organs with herbs, or dive into the suppressed science they don't want you to know.
        </p>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
          <button onClick={() => setActiveTab("biofield")} style={{ padding: "10px 22px", borderRadius: 8, background: "rgba(167,139,250,0.1)", border: "1px solid rgba(167,139,250,0.3)", color: "#a78bfa", cursor: "pointer", fontSize: 11, letterSpacing: 2, fontFamily: "'Orbitron', sans-serif" }}>◐ BIO FIELD</button>
          <button onClick={() => setActiveTab("healing")} style={{ padding: "10px 22px", borderRadius: 8, background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.3)", color: "#22c55e", cursor: "pointer", fontSize: 11, letterSpacing: 2, fontFamily: "'Orbitron', sans-serif" }}>❋ HEALING</button>
          <button onClick={() => setActiveTab("wakeup")} style={{ padding: "10px 22px", borderRadius: 8, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#ef4444", cursor: "pointer", fontSize: 11, letterSpacing: 2, fontFamily: "'Orbitron', sans-serif" }}>◉ WAKE UP</button>
          <button onClick={() => setActiveTab("knowledge")} style={{ padding: "10px 22px", borderRadius: 8, background: "rgba(6,182,212,0.1)", border: "1px solid rgba(6,182,212,0.3)", color: "#06b6d4", cursor: "pointer", fontSize: 11, letterSpacing: 2, fontFamily: "'Orbitron', sans-serif" }}>⬡ KNOWLEDGE</button>
        </div>
      </div>
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════
// HEALTH SIMPLIFIED — The Basics of Food, Energy & Dis-Ease
// ═══════════════════════════════════════════════════════════════

function HealthSimplifiedSection({ setActiveTab }) {
  const SCENES = [
    { id: "energy",    title: "YOU ARE ENERGY",              narration: "Every cell in your body pulses with energy. You are not solid — you are a living field of vibration, constantly radiating and receiving signals." },
    { id: "organs",    title: "EVERY ORGAN HAS A FREQUENCY", narration: "Your heart, your liver, your brain — each organ pulses at its own precise frequency. When energy flows cleanly, they work in harmony. When it doesn't, things go wrong." },
    { id: "pyramid",   title: "THE REAL FOOD PYRAMID",       narration: "Everything you were taught is upside down. Fruits and vegetables belong at the base — unlimited. Then nuts and sprouts. Starches and processed foods? Tiny top — or gone." },
    { id: "liquid",    title: "EVERYTHING BECOMES LIQUID",   narration: "Your body turns all food into liquid before it can use it. Fruit is already liquid. Processed food is sludge. Clean fuel equals clean energy. Dirty fuel blocks the flow." },
    { id: "janitors",  title: "PARASITES ARE YOUR JANITORS", narration: "Your body is so smart it creates its own cleanup crew. Under toxic overload, white blood cells transform into organisms to contain and clean out the mess. Parasites aren\'t invaders — they\'re your body healing itself." },
    { id: "loop",      title: "THE TRAP",                    narration: "Wrong food creates toxic load. Toxic load keeps the janitors around. Janitors disrupt organ energy. Disrupted organs create symptoms. Symptoms get named as diseases. The loop never ends — until you break it." },
    { id: "free",      title: "THE WAY OUT",                 narration: "Flip the pyramid. Eat fruits, vegetables, nuts, and sprouts. Remove the toxic load. The body no longer needs its janitors — and they dissolve back. Energy flows. Organs sing. You heal." },
  ];

  const [sceneIdx, setSceneIdx] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [showCaption, setShowCaption] = useState(true);
  const [isMobile, setIsMobile] = useState(typeof window !== "undefined" && window.innerWidth < 768);
  const autoTimerRef = useRef(null);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Mobile-tuned sizes: everything fits in a viewport without scrolling
  const stageHeight = isMobile ? 340 : 500;
  const captionPad = isMobile ? "50px 18px 18px" : "80px 40px 40px";
  const captionTitleSize = isMobile ? 18 : 28;
  const captionTextSize = isMobile ? 11 : 15;
  const captionLabelSize = isMobile ? 9 : 10;

  const SCENE_DURATION = 22000; // 22 seconds per scene, ~2.5 min full auto
  const scene = SCENES[sceneIdx];

  // Auto-advance
  useEffect(() => {
    if (!isPlaying || !hasStarted) return;
    autoTimerRef.current = setTimeout(() => {
      if (sceneIdx < SCENES.length - 1) setSceneIdx(i => i + 1);
      else setIsPlaying(false);
    }, SCENE_DURATION);
    return () => clearTimeout(autoTimerRef.current);
  }, [isPlaying, sceneIdx, hasStarted]);

  const next = () => { if (sceneIdx < SCENES.length - 1) setSceneIdx(i => i + 1); };
  const prev = () => { if (sceneIdx > 0) setSceneIdx(i => i - 1); };
  const restart = () => { setSceneIdx(0); setIsPlaying(true); };

  // Intro screen
  if (!hasStarted) {
    return (
      <div style={{ animation: "fadeInUp 0.5s ease" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
          <div style={{ width: 3, height: 28, background: "linear-gradient(to bottom, #06b6d4, #00ff8c, #ef4444)", borderRadius: 2 }} />
          <h2 style={{ fontSize: 22, fontWeight: 300, color: "var(--text)", fontFamily: "'Sora', sans-serif", margin: 0 }}>HEALTH SIMPLIFIED</h2>
        </div>
        <p style={{ fontSize: 14, color: "var(--text-faint)", lineHeight: 1.8, marginTop: 8, marginBottom: 28 }}>
          A 3-minute cinematic experience. Watch. Feel it. Then go deeper on the other pages.
        </p>

        <div style={{
          position: "relative", borderRadius: 20, overflow: "hidden",
          background: "linear-gradient(135deg, rgba(0,255,140,0.08), rgba(6,182,212,0.08), rgba(239,68,68,0.06))",
          border: "1px solid rgba(0,255,140,0.15)",
          padding: isMobile ? "30px 20px" : "60px 40px", minHeight: isMobile ? 320 : 420,
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          textAlign: "center"
        }}>
          <IntroOrb scale={isMobile ? 0.7 : 1} />
          <span style={{ fontSize: isMobile ? 9 : 10, letterSpacing: isMobile ? 3 : 5, color: "#00ff8c", fontFamily: "'Orbitron', sans-serif", display: "block", marginBottom: isMobile ? 10 : 18, marginTop: isMobile ? 18 : 32 }}>◈ BEGIN THE EXPERIENCE ◈</span>
          <h1 style={{ fontSize: isMobile ? 24 : 38, fontWeight: 200, color: "var(--text)", fontFamily: "'Sora', sans-serif", margin: isMobile ? "0 0 8px" : "0 0 12px", letterSpacing: isMobile ? 1 : 2 }}>
            The Truth About Health
          </h1>
          <p style={{ fontSize: isMobile ? 12 : 14, color: "var(--text-muted)", maxWidth: 480, lineHeight: 1.7, margin: isMobile ? "0 auto 20px" : "0 auto 32px" }}>
            Seven scenes. Three minutes. Everything you need to understand why your body gets sick — and exactly how to heal it.
          </p>

          <div style={{ display: "flex", gap: isMobile ? 8 : 12, flexWrap: "wrap", justifyContent: "center" }}>
            <button onClick={() => { setHasStarted(true); setIsPlaying(true); }} style={{
              padding: isMobile ? "11px 22px" : "14px 36px", borderRadius: 10,
              background: "linear-gradient(135deg, #00ff8c, #06b6d4)",
              border: "none", color: "#000", cursor: "pointer",
              fontSize: isMobile ? 10 : 12, letterSpacing: isMobile ? 2 : 3, fontFamily: "'Orbitron', sans-serif",
              fontWeight: 700, boxShadow: "0 0 30px rgba(0,255,140,0.4)"
            }}>▶ PLAY EXPERIENCE</button>
            <button onClick={() => { setHasStarted(true); setIsPlaying(false); }} style={{
              padding: isMobile ? "11px 18px" : "14px 28px", borderRadius: 10,
              background: "var(--card-bg)", border: "1px solid var(--card-border)",
              color: "var(--text-muted)", cursor: "pointer",
              fontSize: isMobile ? 9 : 11, letterSpacing: isMobile ? 1 : 2, fontFamily: "'Orbitron', sans-serif"
            }}>▷ MANUAL MODE</button>
          </div>

          <p style={{ fontSize: isMobile ? 9 : 10, color: "var(--text-faint)", letterSpacing: isMobile ? 1 : 2, marginTop: isMobile ? 16 : 28, fontFamily: "'JetBrains Mono', monospace" }}>
            7 SCENES • ~3 MIN • CLICK TO ADVANCE OR AUTO-PLAY
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ animation: "fadeInUp 0.4s ease", position: "relative" }}>
      {/* Header bar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 6 : 10 }}>
          <span style={{ fontSize: isMobile ? 9 : 10, letterSpacing: isMobile ? 2 : 3, color: "#00ff8c", fontFamily: "'Orbitron', sans-serif" }}>◈ {isMobile ? "HEALTH" : "HEALTH SIMPLIFIED"}</span>
          <span style={{ fontSize: isMobile ? 9 : 10, color: "var(--text-faint)", fontFamily: "'JetBrains Mono', monospace" }}>{String(sceneIdx+1).padStart(2,"0")}/{String(SCENES.length).padStart(2,"0")}</span>
        </div>
        <button onClick={() => { setHasStarted(false); setSceneIdx(0); setIsPlaying(false); }} style={{
          background: "transparent", border: "1px solid var(--card-border)", color: "var(--text-faint)",
          padding: isMobile ? "3px 9px" : "4px 12px", borderRadius: 6, cursor: "pointer",
          fontSize: isMobile ? 9 : 10, letterSpacing: isMobile ? 1 : 2, fontFamily: "'Orbitron', sans-serif"
        }}>✕ EXIT</button>
      </div>

      {/* Progress segments */}
      <div style={{ display: "flex", gap: 4, marginBottom: isMobile ? 12 : 20 }}>
        {SCENES.map((_, i) => (
          <div key={i} onClick={() => setSceneIdx(i)} style={{
            flex: 1, height: 3, borderRadius: 2, cursor: "pointer",
            background: i < sceneIdx ? "#00ff8c" : i === sceneIdx ? "linear-gradient(to right, #00ff8c, rgba(0,255,140,0.2))" : "rgba(255,255,255,0.08)",
            transition: "all 0.4s ease",
            position: "relative", overflow: "hidden"
          }}>
            {i === sceneIdx && isPlaying && (
              <div style={{
                position: "absolute", inset: 0,
                background: "#00ff8c",
                animation: `sceneProgress ${SCENE_DURATION}ms linear`,
                transformOrigin: "left"
              }} />
            )}
          </div>
        ))}
      </div>

      {/* Main stage */}
      <div style={{
        position: "relative", borderRadius: 20, overflow: "hidden",
        background: "radial-gradient(ellipse at center, rgba(0,0,0,0.5), rgba(0,0,0,0.85))",
        border: "1px solid rgba(0,255,140,0.15)",
        minHeight: stageHeight, padding: 0
      }}>
        {/* Scene canvas */}
        <div key={scene.id} style={{ animation: "fadeInScale 0.8s ease" }}>
          {scene.id === "energy"   && <SceneEnergy   stageHeight={stageHeight} />}
          {scene.id === "organs"   && <SceneOrgans   stageHeight={stageHeight} isMobile={isMobile} />}
          {scene.id === "pyramid"  && <ScenePyramid  stageHeight={stageHeight} isMobile={isMobile} />}
          {scene.id === "liquid"   && <SceneLiquid   stageHeight={stageHeight} isMobile={isMobile} />}
          {scene.id === "janitors" && <SceneJanitors stageHeight={stageHeight} isMobile={isMobile} />}
          {scene.id === "loop"     && <SceneLoop     stageHeight={stageHeight} isMobile={isMobile} />}
          {scene.id === "free"     && <SceneFree     stageHeight={stageHeight} isMobile={isMobile} setActiveTab={setActiveTab} />}
        </div>

        {/* Caption overlay */}
        {showCaption && (
          <div style={{
            position: "absolute", bottom: 0, left: 0, right: 0,
            background: "linear-gradient(to top, rgba(0,0,0,0.95), rgba(0,0,0,0.6), transparent)",
            padding: captionPad,
            animation: "fadeInUp 0.8s ease"
          }}>
            <span style={{ fontSize: captionLabelSize, letterSpacing: 4, color: "#00ff8c", fontFamily: "'Orbitron', sans-serif", display: "block", marginBottom: isMobile ? 6 : 10 }}>
              {String(sceneIdx+1).padStart(2,"0")} / {String(SCENES.length).padStart(2,"0")}
            </span>
            <h2 style={{ fontSize: captionTitleSize, fontWeight: 300, color: "#fff", fontFamily: "'Sora', sans-serif", margin: isMobile ? "0 0 8px" : "0 0 14px", letterSpacing: 1 }}>
              {scene.title}
            </h2>
            <p style={{ fontSize: captionTextSize, color: "rgba(255,255,255,0.78)", lineHeight: isMobile ? 1.5 : 1.8, maxWidth: 640, margin: 0 }}>
              {scene.narration}
            </p>
          </div>
        )}
      </div>

      {/* Controls */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: isMobile ? 10 : 18, gap: isMobile ? 6 : 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: isMobile ? 5 : 8 }}>
          <button onClick={prev} disabled={sceneIdx === 0} style={{
            padding: isMobile ? "8px 12px" : "10px 18px", borderRadius: 8,
            background: "var(--card-bg)", border: "1px solid var(--card-border)",
            color: sceneIdx === 0 ? "var(--text-faint)" : "var(--text-muted)",
            cursor: sceneIdx === 0 ? "not-allowed" : "pointer", opacity: sceneIdx === 0 ? 0.4 : 1,
            fontSize: isMobile ? 9 : 11, letterSpacing: isMobile ? 1 : 2, fontFamily: "'Orbitron', sans-serif"
          }}>← PREV</button>
          <button onClick={() => setIsPlaying(p => !p)} style={{
            padding: isMobile ? "8px 14px" : "10px 22px", borderRadius: 8,
            background: isPlaying ? "rgba(0,255,140,0.15)" : "var(--card-bg)",
            border: `1px solid ${isPlaying ? "rgba(0,255,140,0.4)" : "var(--card-border)"}`,
            color: isPlaying ? "#00ff8c" : "var(--text-muted)",
            cursor: "pointer", fontSize: isMobile ? 9 : 11, letterSpacing: isMobile ? 1 : 2, fontFamily: "'Orbitron', sans-serif"
          }}>{isPlaying ? (isMobile ? "❚❚" : "❚❚ PAUSE") : (isMobile ? "▶ PLAY" : "▶ AUTO-PLAY")}</button>
          <button onClick={next} disabled={sceneIdx === SCENES.length - 1} style={{
            padding: isMobile ? "8px 12px" : "10px 18px", borderRadius: 8,
            background: sceneIdx === SCENES.length - 1 ? "var(--card-bg)" : "rgba(0,255,140,0.08)",
            border: `1px solid ${sceneIdx === SCENES.length - 1 ? "var(--card-border)" : "rgba(0,255,140,0.25)"}`,
            color: sceneIdx === SCENES.length - 1 ? "var(--text-faint)" : "#00ff8c",
            cursor: sceneIdx === SCENES.length - 1 ? "not-allowed" : "pointer",
            opacity: sceneIdx === SCENES.length - 1 ? 0.4 : 1,
            fontSize: isMobile ? 9 : 11, letterSpacing: isMobile ? 1 : 2, fontFamily: "'Orbitron', sans-serif"
          }}>NEXT →</button>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button onClick={() => setShowCaption(s => !s)} style={{
            padding: isMobile ? "8px 10px" : "10px 14px", borderRadius: 8,
            background: "var(--card-bg)", border: "1px solid var(--card-border)",
            color: "var(--text-faint)", cursor: "pointer",
            fontSize: isMobile ? 9 : 10, letterSpacing: isMobile ? 1 : 2, fontFamily: "'Orbitron', sans-serif"
          }}>{showCaption ? (isMobile ? "◐" : "◐ HIDE TEXT") : (isMobile ? "◑" : "◑ SHOW TEXT")}</button>
          <button onClick={restart} style={{
            padding: isMobile ? "8px 10px" : "10px 14px", borderRadius: 8,
            background: "var(--card-bg)", border: "1px solid var(--card-border)",
            color: "var(--text-faint)", cursor: "pointer",
            fontSize: isMobile ? 9 : 10, letterSpacing: isMobile ? 1 : 2, fontFamily: "'Orbitron', sans-serif"
          }}>↻{isMobile ? "" : " RESTART"}</button>
        </div>
      </div>

      <style>{`
        @keyframes fadeInScale { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: scale(1); } }
        @keyframes sceneProgress { from { transform: scaleX(0); } to { transform: scaleX(1); } }
        @keyframes breathe { 0%, 100% { transform: scale(1); opacity: 0.85; } 50% { transform: scale(1.08); opacity: 1; } }
        @keyframes orbit { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes floatUp { 0% { transform: translateY(20px); opacity: 0; } 100% { transform: translateY(0); opacity: 1; } }
        @keyframes flipPyramid { 0% { transform: rotate(180deg); } 60% { transform: rotate(-10deg); } 100% { transform: rotate(0deg); } }
        @keyframes pulseRing { 0% { transform: scale(0.8); opacity: 0.8; } 100% { transform: scale(2.2); opacity: 0; } }
      `}</style>
    </div>
  );
}

// ─── Intro orb for start screen ───
function IntroOrb({ scale = 1 }) {
  const size = 140 * scale;
  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <div style={{
        position: "absolute", inset: 0, borderRadius: "50%",
        background: "radial-gradient(circle at 50% 50%, rgba(0,255,140,0.8), rgba(0,255,140,0.3) 40%, transparent 70%)",
        animation: "breathe 3s ease-in-out infinite",
        filter: "blur(2px)"
      }} />
      <div style={{
        position: "absolute", inset: 20, borderRadius: "50%",
        border: "1px solid rgba(0,255,140,0.4)",
        animation: "orbit 12s linear infinite"
      }} />
      <div style={{
        position: "absolute", inset: 40, borderRadius: "50%",
        background: "radial-gradient(circle, #00ff8c, rgba(0,255,140,0.3))",
        animation: "breathe 2s ease-in-out infinite",
        boxShadow: "0 0 40px rgba(0,255,140,0.6)"
      }} />
    </div>
  );
}

// ─── SCENE 1: You Are Energy ───
function SceneEnergy({ stageHeight = 500 }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    const cvs = canvasRef.current; if (!cvs) return;
    const ctx = cvs.getContext("2d");
    let w = cvs.width = cvs.offsetWidth, h = cvs.height = cvs.offsetHeight;
    let raf, t = 0;
    const particles = Array.from({ length: 80 }, () => ({
      a: Math.random() * Math.PI * 2,
      r: 80 + Math.random() * 120,
      s: 0.3 + Math.random() * 0.8,
      size: 1 + Math.random() * 2,
    }));
    const loop = () => {
      t += 0.016;
      ctx.fillStyle = "rgba(0,0,0,0.15)";
      ctx.fillRect(0, 0, w, h);
      const cx = w/2, cy = h/2;
      // Core orb
      const pulse = 1 + Math.sin(t * 1.5) * 0.08;
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, 90 * pulse);
      grad.addColorStop(0, "rgba(0,255,140,0.9)");
      grad.addColorStop(0.4, "rgba(0,255,140,0.3)");
      grad.addColorStop(1, "rgba(0,255,140,0)");
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(cx, cy, 90 * pulse, 0, Math.PI * 2); ctx.fill();
      // Rings
      for (let i = 0; i < 3; i++) {
        const rr = 60 + i*50 + Math.sin(t*1.2 + i) * 10;
        ctx.strokeStyle = `rgba(0,255,140,${0.15 - i*0.04})`;
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI * 2); ctx.stroke();
      }
      // Orbiting particles
      particles.forEach(p => {
        p.a += p.s * 0.004;
        const x = cx + Math.cos(p.a) * p.r;
        const y = cy + Math.sin(p.a) * p.r * 0.7;
        ctx.fillStyle = `rgba(0,255,140,${0.6 + Math.sin(t*2 + p.a) * 0.3})`;
        ctx.beginPath(); ctx.arc(x, y, p.size, 0, Math.PI * 2); ctx.fill();
      });
      raf = requestAnimationFrame(loop);
    };
    loop();
    const onR = () => { w = cvs.width = cvs.offsetWidth; h = cvs.height = cvs.offsetHeight; };
    window.addEventListener("resize", onR);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", onR); };
  }, []);
  return <canvas ref={canvasRef} style={{ width: "100%", height: stageHeight, display: "block" }} />;
}

// ─── SCENE 2: Every Organ Has a Frequency ───
function SceneOrgans({ stageHeight = 500, isMobile = false }) {
  const scale = isMobile ? 0.65 : 1;
  const ORGANS = [
    { name: "BRAIN",   color: "#a78bfa", freq: "72 Hz",  x: "50%",  y: "12%",  size: 46 * scale },
    { name: "HEART",   color: "#ef4444", freq: "60 Hz",  x: "46%",  y: "32%",  size: 42 * scale },
    { name: "LUNGS",   color: "#06b6d4", freq: "58 Hz",  x: "58%",  y: "32%",  size: 38 * scale },
    { name: "LIVER",   color: "#eab308", freq: "55 Hz",  x: "40%",  y: "46%",  size: 40 * scale },
    { name: "STOMACH", color: "#f97316", freq: "50 Hz",  x: "56%",  y: "48%",  size: 36 * scale },
    { name: "KIDNEYS", color: "#22c55e", freq: "48 Hz",  x: "50%",  y: "56%",  size: 32 * scale },
    { name: "GUT",     color: "#00ff8c", freq: "45 Hz",  x: "50%",  y: "66%",  size: 42 * scale },
  ];
  return (
    <div style={{ position: "relative", height: stageHeight, display: "flex", alignItems: "center", justifyContent: "center" }}>
      {/* Silhouette */}
      <svg viewBox="0 0 200 400" style={{ height: "90%", opacity: 0.25 }}>
        <path d="M100 30 Q75 30 75 55 Q75 75 88 85 L88 100 Q60 110 55 160 L55 220 Q55 240 65 260 L70 360 Q70 380 85 380 L95 380 L95 280 L105 280 L105 380 L115 380 Q130 380 130 360 L135 260 Q145 240 145 220 L145 160 Q140 110 112 100 L112 85 Q125 75 125 55 Q125 30 100 30 Z" fill="rgba(255,255,255,0.1)" stroke="rgba(0,255,140,0.3)" strokeWidth="0.5" />
      </svg>
      {/* Organ pulses */}
      {ORGANS.map((o, i) => (
        <div key={o.name} style={{
          position: "absolute", left: o.x, top: o.y, transform: "translate(-50%, -50%)",
          animation: `floatUp 0.8s ease ${i * 0.25}s both`
        }}>
          <div style={{ position: "relative", width: o.size, height: o.size }}>
            {/* Pulse ring */}
            <div style={{
              position: "absolute", inset: 0, borderRadius: "50%",
              background: `radial-gradient(circle, ${o.color}80, transparent 70%)`,
              animation: `pulseRing ${1.5 + i * 0.2}s ease-out infinite`
            }} />
            {/* Core */}
            <div style={{
              position: "absolute", inset: o.size * 0.2, borderRadius: "50%",
              background: `radial-gradient(circle, ${o.color}, ${o.color}aa)`,
              boxShadow: `0 0 20px ${o.color}80`,
              animation: `breathe ${1 + i * 0.15}s ease-in-out infinite`
            }} />
          </div>
          <div style={{
            position: "absolute", top: "110%", left: "50%", transform: "translateX(-50%)",
            whiteSpace: "nowrap", textAlign: "center"
          }}>
            <div style={{ fontSize: isMobile ? 7 : 9, letterSpacing: isMobile ? 1 : 2, color: o.color, fontFamily: "'Orbitron', sans-serif", fontWeight: 600 }}>{o.name}</div>
            <div style={{ fontSize: isMobile ? 7 : 8, color: "rgba(255,255,255,0.4)", fontFamily: "'JetBrains Mono', monospace" }}>{o.freq}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── SCENE 3: The Real Food Pyramid ───
function ScenePyramid({ stageHeight = 500, isMobile = false }) {
  const [flipped, setFlipped] = useState(false);
  useEffect(() => { const t = setTimeout(() => setFlipped(true), 1200); return () => clearTimeout(t); }, []);
  const TIERS = [
    { label: "FRUITS & VEGETABLES",   sub: "UNLIMITED", color: "#00ff8c", items: "🍎 🥬 🍊 🥕 🍓 🥦 🍇 🍉" },
    { label: "NUTS & SPROUTS",         sub: "DAILY",     color: "#eab308", items: "🌰 🥜 🌱" },
    { label: "STARCHES",               sub: "SOMETIMES", color: "#f97316", items: "🥔 🌾" },
    { label: "PROCESSED & ANIMAL",     sub: "MINIMAL",   color: "#ef4444", items: "🍔 🧀" },
  ];
  return (
    <div style={{ position: "relative", height: stageHeight, display: "flex", alignItems: "center", justifyContent: "center", padding: isMobile ? 12 : 20 }}>
      <div style={{
        display: "flex", flexDirection: "column", gap: 8, width: "100%", maxWidth: 520,
        transform: flipped ? "rotate(0deg)" : "rotate(180deg)",
        transition: "transform 1.6s cubic-bezier(0.65, 0, 0.35, 1)"
      }}>
        {TIERS.map((tier, i) => {
          const width = 100 - i * 20;
          return (
            <div key={tier.label} style={{
              alignSelf: "center", width: `${width}%`,
              padding: isMobile ? "8px 10px" : "14px 20px", borderRadius: 8,
              background: `linear-gradient(90deg, ${tier.color}22, ${tier.color}08)`,
              border: `1px solid ${tier.color}50`,
              textAlign: "center",
              transform: flipped ? "scale(1)" : "scale(1)",
            }}>
              <div style={{ transform: flipped ? "rotate(0deg)" : "rotate(180deg)", transition: "transform 0.01s" }}>
                <div style={{ fontSize: isMobile ? 8 : 10, letterSpacing: isMobile ? 1.5 : 3, color: tier.color, fontFamily: "'Orbitron', sans-serif", fontWeight: 700, marginBottom: 2 }}>{tier.label}</div>
                <div style={{ fontSize: isMobile ? 7 : 9, letterSpacing: isMobile ? 1 : 2, color: "rgba(255,255,255,0.5)", fontFamily: "'JetBrains Mono', monospace", marginBottom: isMobile ? 3 : 6 }}>{tier.sub}</div>
                <div style={{ fontSize: isMobile ? 11 : 16 }}>{tier.items}</div>
              </div>
            </div>
          );
        })}
      </div>
      {!flipped && (
        <div style={{ position: "absolute", top: isMobile ? 8 : 20, left: 0, right: 0, textAlign: "center", padding: "0 8px" }}>
          <span style={{ fontSize: isMobile ? 8 : 10, letterSpacing: isMobile ? 2 : 4, color: "#ef4444", fontFamily: "'Orbitron', sans-serif" }}>⚠ GOVERNMENT PYRAMID ⚠</span>
        </div>
      )}
      {flipped && (
        <div style={{ position: "absolute", top: isMobile ? 8 : 20, left: 0, right: 0, textAlign: "center", animation: "fadeInUp 0.8s ease 1s both", padding: "0 8px" }}>
          <span style={{ fontSize: isMobile ? 8 : 10, letterSpacing: isMobile ? 2 : 4, color: "#00ff8c", fontFamily: "'Orbitron', sans-serif" }}>◈ TRUE PYRAMID — REVERSED ◈</span>
        </div>
      )}
    </div>
  );
}

// ─── SCENE 4: Everything Becomes Liquid ───
function SceneLiquid({ stageHeight = 500, isMobile = false }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    const cvs = canvasRef.current; if (!cvs) return;
    const ctx = cvs.getContext("2d");
    let w = cvs.width = cvs.offsetWidth, h = cvs.height = cvs.offsetHeight;
    let raf, t = 0;
    const drops = Array.from({ length: 40 }, () => ({
      x: Math.random() * w,
      y: Math.random() * h - h,
      vy: 0.5 + Math.random() * 1.5,
      clean: Math.random() > 0.5,
      size: 2 + Math.random() * 4,
    }));
    const loop = () => {
      t += 0.016;
      ctx.fillStyle = "rgba(0,0,0,0.2)";
      ctx.fillRect(0, 0, w, h);
      drops.forEach(d => {
        d.y += d.vy * (d.clean ? 1.5 : 0.4);
        if (d.y > h) { d.y = -20; d.x = Math.random() * w; }
        const color = d.clean ? "0,255,140" : "234,179,8";
        const grad = ctx.createRadialGradient(d.x, d.y, 0, d.x, d.y, d.size * 3);
        grad.addColorStop(0, `rgba(${color},0.9)`);
        grad.addColorStop(1, `rgba(${color},0)`);
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.arc(d.x, d.y, d.size * 3, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = `rgba(${color},1)`;
        ctx.beginPath(); ctx.arc(d.x, d.y, d.size, 0, Math.PI * 2); ctx.fill();
      });
      raf = requestAnimationFrame(loop);
    };
    loop();
    const onR = () => { w = cvs.width = cvs.offsetWidth; h = cvs.height = cvs.offsetHeight; };
    window.addEventListener("resize", onR);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", onR); };
  }, []);
  return (
    <div style={{ position: "relative", height: stageHeight }}>
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
      <div style={{ position: "absolute", top: isMobile ? 14 : 30, left: 0, right: 0, display: "flex", justifyContent: "space-around", padding: isMobile ? "0 16px" : "0 40px" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: isMobile ? 24 : 36, marginBottom: isMobile ? 3 : 6 }}>🍎</div>
          <div style={{ fontSize: isMobile ? 8 : 10, letterSpacing: isMobile ? 1 : 2, color: "#00ff8c", fontFamily: "'Orbitron', sans-serif" }}>CLEAN</div>
          <div style={{ fontSize: isMobile ? 7 : 9, color: "rgba(255,255,255,0.5)", fontFamily: "'JetBrains Mono', monospace", marginTop: isMobile ? 2 : 4 }}>20 MIN → CELLS</div>
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: isMobile ? 24 : 36, marginBottom: isMobile ? 3 : 6 }}>🍔</div>
          <div style={{ fontSize: isMobile ? 8 : 10, letterSpacing: isMobile ? 1 : 2, color: "#eab308", fontFamily: "'Orbitron', sans-serif" }}>SLUDGE</div>
          <div style={{ fontSize: isMobile ? 7 : 9, color: "rgba(255,255,255,0.5)", fontFamily: "'JetBrains Mono', monospace", marginTop: isMobile ? 2 : 4 }}>6 HRS → TOXINS</div>
        </div>
      </div>
    </div>
  );
}

// ─── SCENE 5: Parasites Are Your Janitors ───
function SceneJanitors({ stageHeight = 500, isMobile = false }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    const cvs = canvasRef.current; if (!cvs) return;
    const ctx = cvs.getContext("2d");
    let w = cvs.width = cvs.offsetWidth, h = cvs.height = cvs.offsetHeight;
    let raf, t = 0;
    const cells = Array.from({ length: 14 }, () => ({
      x: Math.random() * w, y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.4,
      vy: (Math.random() - 0.5) * 0.4,
      morph: 0, // 0 = white blood cell, 1 = parasite
    }));
    const toxins = Array.from({ length: 30 }, () => ({
      x: Math.random() * w, y: Math.random() * h,
      life: Math.random(),
    }));
    const loop = () => {
      t += 0.016;
      ctx.fillStyle = "rgba(0,0,0,0.12)";
      ctx.fillRect(0, 0, w, h);
      // Toxins (dark particles)
      toxins.forEach(tx => {
        tx.life -= 0.002;
        if (tx.life <= 0) { tx.life = 1; tx.x = Math.random() * w; tx.y = Math.random() * h; }
        ctx.fillStyle = `rgba(80,40,20,${tx.life * 0.6})`;
        ctx.beginPath(); ctx.arc(tx.x, tx.y, 3, 0, Math.PI * 2); ctx.fill();
      });
      // Cells - morph over time
      const phase = Math.min(1, t / 6); // morph after 6s
      cells.forEach((c, i) => {
        c.x += c.vx; c.y += c.vy;
        if (c.x < 0 || c.x > w) c.vx *= -1;
        if (c.y < 0 || c.y > h) c.vy *= -1;
        c.morph = phase * (0.5 + Math.sin(t + i) * 0.5);
        // White blood cell (sphere) morphing into parasite (elongated)
        const r1 = 10 + c.morph * 4;
        const r2 = 10 - c.morph * 6;
        const col = c.morph < 0.3 ? "255,255,255" : c.morph < 0.7 ? "200,220,200" : "0,255,140";
        ctx.save();
        ctx.translate(c.x, c.y);
        ctx.rotate(t * 0.3 + i);
        const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, r1);
        grad.addColorStop(0, `rgba(${col},0.9)`);
        grad.addColorStop(1, `rgba(${col},0.1)`);
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.ellipse(0, 0, r1, r2, 0, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      });
      raf = requestAnimationFrame(loop);
    };
    loop();
    const onR = () => { w = cvs.width = cvs.offsetWidth; h = cvs.height = cvs.offsetHeight; };
    window.addEventListener("resize", onR);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", onR); };
  }, []);
  return (
    <div style={{ position: "relative", height: stageHeight }}>
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
      <div style={{ position: "absolute", top: isMobile ? 16 : 40, left: isMobile ? 16 : 40, right: isMobile ? 16 : 40, display: "flex", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: isMobile ? 8 : 10, letterSpacing: isMobile ? 2 : 3, color: "#fff", fontFamily: "'Orbitron', sans-serif", marginBottom: isMobile ? 2 : 4 }}>BEFORE</div>
          <div style={{ fontSize: isMobile ? 7 : 9, color: "rgba(255,255,255,0.5)", fontFamily: "'JetBrains Mono', monospace" }}>WHITE BLOOD CELLS</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: isMobile ? 8 : 10, letterSpacing: isMobile ? 2 : 3, color: "#00ff8c", fontFamily: "'Orbitron', sans-serif", marginBottom: isMobile ? 2 : 4 }}>AFTER</div>
          <div style={{ fontSize: isMobile ? 7 : 9, color: "rgba(255,255,255,0.5)", fontFamily: "'JetBrains Mono', monospace" }}>CLEANUP CREW</div>
        </div>
      </div>
    </div>
  );
}

// ─── SCENE 6: The Trap (Loop) ───
function SceneLoop({ stageHeight = 500, isMobile = false }) {
  const STEPS = [
    { label: "WRONG FOOD",     icon: "🍔", color: "#ef4444" },
    { label: "TOXIC LOAD",     icon: "☠",  color: "#f97316" },
    { label: "JANITORS STAY",  icon: "🦠", color: "#eab308" },
    { label: "BLOCKED ENERGY", icon: "⚡", color: "#a78bfa" },
    { label: "SYMPTOMS",       icon: "⚠",  color: "#06b6d4" },
    { label: "'DISEASE'",    icon: "✚",  color: "#ef4444" },
  ];
  return (
    <div style={{ position: "relative", height: stageHeight, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ position: "relative", width: isMobile ? 260 : 380, height: isMobile ? 260 : 380 }}>
        {/* Rotating ring */}
        <div style={{
          position: "absolute", inset: 0, borderRadius: "50%",
          border: "2px dashed rgba(239,68,68,0.3)",
          animation: "orbit 20s linear infinite"
        }} />
        {/* Steps around circle */}
        {STEPS.map((step, i) => {
          const angle = (i / STEPS.length) * Math.PI * 2 - Math.PI / 2;
          const radius = isMobile ? 105 : 170;
          const x = Math.cos(angle) * radius;
          const y = Math.sin(angle) * radius;
          const bubbleSize = isMobile ? 48 : 70;
          return (
            <div key={step.label} style={{
              position: "absolute", left: "50%", top: "50%",
              transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`,
              animation: `floatUp 0.6s ease ${i * 0.15}s both`
            }}>
              <div style={{
                width: bubbleSize, height: bubbleSize, borderRadius: "50%",
                background: `radial-gradient(circle, ${step.color}30, ${step.color}10)`,
                border: `2px solid ${step.color}`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: isMobile ? 18 : 26,
                boxShadow: `0 0 20px ${step.color}40`
              }}>{step.icon}</div>
              <div style={{
                fontSize: isMobile ? 7 : 9, letterSpacing: isMobile ? 1 : 2, color: step.color,
                fontFamily: "'Orbitron', sans-serif", fontWeight: 700,
                textAlign: "center", marginTop: isMobile ? 4 : 8, whiteSpace: "nowrap"
              }}>{step.label}</div>
            </div>
          );
        })}
        {/* Center */}
        <div style={{
          position: "absolute", inset: "40%", borderRadius: "50%",
          background: "radial-gradient(circle, rgba(239,68,68,0.3), transparent)",
          display: "flex", alignItems: "center", justifyContent: "center",
          animation: "breathe 2s ease-in-out infinite"
        }}>
          <span style={{ fontSize: isMobile ? 8 : 10, letterSpacing: isMobile ? 2 : 3, color: "#ef4444", fontFamily: "'Orbitron', sans-serif", fontWeight: 700, textAlign: "center" }}>THE<br/>LOOP</span>
        </div>
      </div>
    </div>
  );
}

// ─── SCENE 7: The Way Out ───
function SceneFree({ stageHeight = 500, isMobile = false, setActiveTab }) {
  return (
    <div style={{ position: "relative", height: stageHeight, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: isMobile ? 16 : 30 }}>
      {/* Radiating orb */}
      <div style={{ position: "relative", width: isMobile ? 110 : 180, height: isMobile ? 110 : 180, marginBottom: isMobile ? 14 : 30 }}>
        <div style={{
          position: "absolute", inset: 0, borderRadius: "50%",
          background: "radial-gradient(circle, rgba(0,255,140,0.6), rgba(0,255,140,0.1) 60%, transparent)",
          animation: "breathe 2.5s ease-in-out infinite",
          filter: "blur(4px)"
        }} />
        <div style={{
          position: "absolute", inset: isMobile ? 18 : 30, borderRadius: "50%",
          background: "radial-gradient(circle, #00ff8c, rgba(0,255,140,0.4))",
          boxShadow: "0 0 60px rgba(0,255,140,0.8)"
        }} />
        {[0, 1, 2].map(i => (
          <div key={i} style={{
            position: "absolute", inset: 0, borderRadius: "50%",
            border: "1px solid rgba(0,255,140,0.4)",
            animation: `pulseRing 2.5s ease-out ${i * 0.8}s infinite`
          }} />
        ))}
      </div>
      <div style={{ textAlign: "center", marginBottom: isMobile ? 12 : 20 }}>
        <div style={{ fontSize: isMobile ? 8 : 10, letterSpacing: isMobile ? 3 : 5, color: "#00ff8c", fontFamily: "'Orbitron', sans-serif", marginBottom: isMobile ? 6 : 10 }}>◈ LOOP BROKEN ◈</div>
        <div style={{ fontSize: isMobile ? 8 : 11, color: "rgba(255,255,255,0.6)", fontFamily: "'JetBrains Mono', monospace", letterSpacing: isMobile ? 0.5 : 1, padding: "0 8px" }}>
          FRUITS → VEGETABLES → NUTS → SPROUTS → FREEDOM
        </div>
      </div>
      <div style={{ display: "flex", gap: isMobile ? 6 : 10, flexWrap: "wrap", justifyContent: "center", marginTop: isMobile ? 4 : 10 }}>
        <button onClick={() => setActiveTab && setActiveTab("healing")} style={{
          padding: isMobile ? "7px 12px" : "10px 20px", borderRadius: 8,
          background: "rgba(34,197,94,0.12)", border: "1px solid rgba(34,197,94,0.35)",
          color: "#22c55e", cursor: "pointer",
          fontSize: isMobile ? 8 : 10, letterSpacing: isMobile ? 1 : 2, fontFamily: "'Orbitron', sans-serif"
        }}>❋ HEALING →</button>
        <button onClick={() => setActiveTab && setActiveTab("disease")} style={{
          padding: isMobile ? "7px 12px" : "10px 20px", borderRadius: 8,
          background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.35)",
          color: "#ef4444", cursor: "pointer",
          fontSize: isMobile ? 8 : 10, letterSpacing: isMobile ? 1 : 2, fontFamily: "'Orbitron', sans-serif"
        }}>✚ HEAL DISEASE →</button>
        <button onClick={() => setActiveTab && setActiveTab("hacks")} style={{
          padding: isMobile ? "7px 12px" : "10px 20px", borderRadius: 8,
          background: "rgba(167,139,250,0.12)", border: "1px solid rgba(167,139,250,0.35)",
          color: "#a78bfa", cursor: "pointer",
          fontSize: isMobile ? 8 : 10, letterSpacing: isMobile ? 1 : 2, fontFamily: "'Orbitron', sans-serif"
        }}>⚙ REALITY HACKS →</button>
      </div>
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════
// E-MOTIONS — Energy in Motion
// ═══════════════════════════════════════════════════════════════

function EmotionEnvironment({ emotion }) {
  const canvasRef = useRef(null);
  const animRef = useRef(null);
  const emotionRef = useRef(emotion);

  useEffect(() => { emotionRef.current = emotion; }, [emotion]);

  const emotionData = {
    love:      { h: 340, particles: 120, speed: 0.4, size: 3, gravity: -0.2, spread: 1, trail: 0.03, bg: [20, 5, 15] },
    gratitude: { h: 50,  particles: 100, speed: 0.3, size: 2.5, gravity: -0.15, spread: 0.9, trail: 0.025, bg: [15, 12, 5] },
    joy:       { h: 45,  particles: 140, speed: 0.8, size: 2, gravity: -0.3, spread: 1.3, trail: 0.04, bg: [18, 15, 5] },
    peace:     { h: 200, particles: 60,  speed: 0.15, size: 3.5, gravity: 0, spread: 0.7, trail: 0.015, bg: [5, 12, 18] },
    courage:   { h: 25,  particles: 90,  speed: 0.6, size: 2.5, gravity: -0.1, spread: 1.1, trail: 0.035, bg: [18, 8, 5] },
    neutral:   { h: 180, particles: 50,  speed: 0.2, size: 2, gravity: 0, spread: 0.5, trail: 0.02, bg: [8, 8, 10] },
    sadness:   { h: 220, particles: 40,  speed: 0.1, size: 1.5, gravity: 0.3, spread: 0.3, trail: 0.01, bg: [5, 5, 12] },
    fear:      { h: 0,   particles: 70,  speed: 1.5, size: 1, gravity: 0.5, spread: 0.4, trail: 0.06, bg: [10, 5, 5] },
    anger:     { h: 0,   particles: 100, speed: 2.0, size: 1.5, gravity: 0, spread: 0.6, trail: 0.07, bg: [15, 3, 3] },
    shame:     { h: 270, particles: 25,  speed: 0.05, size: 1, gravity: 0.6, spread: 0.2, trail: 0.008, bg: [6, 4, 8] },
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let w = 700, h = 400;
    canvas.width = w * 2; canvas.height = h * 2;
    ctx.scale(2, 2);

    let pts = [];
    const initParticles = (count) => Array.from({ length: count }, () => ({
      x: Math.random() * w, y: Math.random() * h,
      vx: (Math.random() - 0.5) * 2, vy: (Math.random() - 0.5) * 2,
      life: Math.random(), phase: Math.random() * Math.PI * 2,
    }));
    pts = initParticles(120);

    const draw = (time) => {
      const t = time * 0.001;
      const e = emotionData[emotionRef.current] || emotionData.neutral;

      // Background — environment changes color
      ctx.fillStyle = `rgba(${e.bg[0]}, ${e.bg[1]}, ${e.bg[2]}, ${0.08 + e.trail})`;
      ctx.fillRect(0, 0, w, h);

      // Ensure right particle count
      while (pts.length < e.particles) pts.push({ x: Math.random() * w, y: h + 10, vx: (Math.random() - 0.5) * 2, vy: -Math.random() * 2, life: 1, phase: Math.random() * Math.PI * 2 });
      if (pts.length > e.particles + 20) pts.splice(e.particles);

      // Environment elements based on emotion
      const cx = w / 2, cy = h / 2;

      // Central energy source
      const pulseR = 30 + Math.sin(t * (0.5 + e.speed)) * 15 * e.spread;
      const sourceGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, pulseR * 3);
      sourceGrad.addColorStop(0, `hsla(${e.h}, 80%, 60%, 0.15)`);
      sourceGrad.addColorStop(0.5, `hsla(${e.h}, 70%, 50%, 0.05)`);
      sourceGrad.addColorStop(1, "transparent");
      ctx.fillStyle = sourceGrad;
      ctx.fillRect(0, 0, w, h);

      // Energy rings emanating outward
      for (let ring = 0; ring < 5; ring++) {
        const ringT = (t * e.speed * 0.5 + ring * 0.4) % 3;
        const ringR = ringT * 100 * e.spread;
        const ringAlpha = Math.max(0, (1 - ringT / 3) * 0.15);
        if (ringAlpha > 0.01) {
          ctx.beginPath();
          ctx.arc(cx, cy, ringR, 0, Math.PI * 2);
          ctx.strokeStyle = `hsla(${e.h}, 70%, 55%, ${ringAlpha})`;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      }

      // Particles — energy flowing
      pts.forEach(p => {
        // Movement physics change with emotion
        const dx = cx - p.x, dy = cy - p.y;
        const dist = Math.sqrt(dx * dx + dy * dy) + 1;

        // High-vibe emotions: particles rise, expand, glow
        // Low-vibe emotions: particles fall, contract, dim
        p.vx += Math.sin(t + p.phase) * e.speed * 0.1;
        p.vy += e.gravity * 0.1 + Math.cos(t * 0.7 + p.phase) * e.speed * 0.05;

        // Spread from center
        if (dist < 150) {
          const force = (150 - dist) / 150 * e.spread * 0.3;
          p.vx += (p.x - cx) / dist * force;
          p.vy += (p.y - cy) / dist * force;
        }

        p.vx *= 0.98; p.vy *= 0.98;
        const spd = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
        if (spd > e.speed * 3) { p.vx *= (e.speed * 3) / spd; p.vy *= (e.speed * 3) / spd; }

        p.x += p.vx; p.y += p.vy;
        p.life -= 0.002;

        // Wrap / respawn
        if (p.x < -20 || p.x > w + 20 || p.y < -20 || p.y > h + 20 || p.life <= 0) {
          p.x = cx + (Math.random() - 0.5) * 100;
          p.y = cy + (Math.random() - 0.5) * 100;
          p.vx = (Math.random() - 0.5) * e.speed * 2;
          p.vy = (Math.random() - 0.5) * e.speed * 2;
          p.life = 1;
        }

        const alpha = p.life * 0.7;
        const hue = (e.h + Math.sin(p.phase + t) * 20) % 360;
        const sz = e.size * (0.5 + p.life * 0.5);

        ctx.beginPath();
        ctx.arc(p.x, p.y, sz, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${hue}, 75%, 60%, ${alpha})`;
        ctx.shadowColor = `hsla(${hue}, 80%, 55%, ${alpha * 0.6})`;
        ctx.shadowBlur = 8 + e.size * 2;
        ctx.fill();
        ctx.shadowBlur = 0;
      });

      // Connection lines for high-vibe states
      if (["love", "gratitude", "joy", "peace", "courage"].includes(emotionRef.current)) {
        for (let i = 0; i < pts.length; i++) {
          for (let j = i + 1; j < Math.min(pts.length, i + 8); j++) {
            const dx = pts[i].x - pts[j].x, dy = pts[i].y - pts[j].y;
            const d = dx * dx + dy * dy;
            if (d < 6000) {
              ctx.beginPath();
              ctx.moveTo(pts[i].x, pts[i].y);
              ctx.lineTo(pts[j].x, pts[j].y);
              ctx.strokeStyle = `hsla(${e.h}, 60%, 55%, ${(1 - d / 6000) * 0.08})`;
              ctx.lineWidth = 0.5;
              ctx.stroke();
            }
          }
        }
      }

      // Label overlay
      const labelData = {
        love: "LOVE — 528Hz — Expansion — Creation",
        gratitude: "GRATITUDE — Coherence — Attraction — Abundance",
        joy: "JOY — High Frequency — Magnetic — Radiant",
        peace: "PEACE — Theta State — Infinite — Still",
        courage: "COURAGE — Action — Breakthrough — Fire",
        neutral: "NEUTRAL — Baseline — Potential — Waiting",
        sadness: "SADNESS — Contraction — Inward — Processing",
        fear: "FEAR — Chaos — Fragmentation — Survival",
        anger: "ANGER — Explosive — Destructive — Consuming",
        shame: "SHAME — Collapse — Smallest Field — Disconnection",
      };

      ctx.fillStyle = `hsla(${e.h}, 60%, 55%, 0.4)`;
      ctx.font = "10px 'Orbitron', sans-serif";
      ctx.textAlign = "center";
      ctx.letterSpacing = "3px";
      ctx.fillText(labelData[emotionRef.current] || "", cx, h - 15);

      animRef.current = requestAnimationFrame(draw);
    };
    animRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animRef.current);
  }, []);

  return <canvas ref={canvasRef} style={{ width: "100%", height: "auto", aspectRatio: "7/4", borderRadius: 12 }} />;
}

const EMOTION_SCALE = [
  { id: "love", name: "Love", freq: "528Hz+", hz: 528, color: "#ec4899", icon: "💗", level: 10, desc: "The highest sustained vibration. At 528Hz, you become a creator — your field magnetically attracts reality to match your inner state. Miracles live here." },
  { id: "gratitude", name: "Gratitude", freq: "480Hz+", hz: 480, color: "#eab308", icon: "🙏", level: 9, desc: "The shortcut to creation. Gratitude tells the universe you already have what you asked for. Your heart field becomes coherent and your biofield expands to its maximum." },
  { id: "joy", name: "Joy", freq: "440Hz+", hz: 440, color: "#f97316", icon: "✨", level: 8, desc: "Pure high-frequency energy. Joy is magnetic — people, opportunities, and synchronicities are drawn to you like iron filings to a magnet. Reality bends around joy." },
  { id: "peace", name: "Peace", freq: "396Hz+", hz: 396, color: "#06b6d4", icon: "🕊️", level: 7, desc: "The still point. In deep peace, you access theta brainwaves and the quantum field. Manifestation requires no effort here — you simply allow." },
  { id: "courage", name: "Courage", freq: "350Hz+", hz: 350, color: "#f59e0b", icon: "🔥", level: 6, desc: "The threshold where you stop being a victim and become a creator. Courage is the energy of action — the motion that transforms inner vision into outer reality." },
  { id: "neutral", name: "Neutral", freq: "250Hz", hz: 250, color: "#78716c", icon: "😐", level: 5, desc: "Neither creating nor destroying. Potential energy — like a ball at the top of a hill. From here, your next emotion determines everything." },
  { id: "sadness", name: "Sadness", freq: "150Hz", hz: 150, color: "#6366f1", icon: "💧", level: 4, desc: "Energy pulling inward. Sadness contracts your field close to your body. You become less visible electromagnetically. But sadness also purifies — it's the rain that clears the sky." },
  { id: "fear", name: "Fear", freq: "100Hz", hz: 100, color: "#94a3b8", icon: "😰", level: 3, desc: "Survival frequency. Your field fragments. Your body floods with cortisol. You radiate chaos that other people's nervous systems pick up instantly. Fear is contagious." },
  { id: "anger", name: "Anger", freq: "75Hz", hz: 75, color: "#ef4444", icon: "🔥", level: 2, desc: "Destructive energy in motion. Anger is powerful but corrosive — it burns everything, including the vessel. Sustained anger deteriorates cells, organs, and relationships." },
  { id: "shame", name: "Shame", freq: "20Hz", hz: 20, color: "#581c87", icon: "🕳️", level: 1, desc: "The lowest vibration. Your field almost disappears. You become electromagnetically invisible. Shame is the opposite of creation — it's energetic death while still alive." },
];

function EmotionsSection() {
  const [selectedEmotion, setSelectedEmotion] = useState("neutral");
  const [activeLesson, setActiveLesson] = useState(null);

  const currentEmotion = EMOTION_SCALE.find(e => e.id === selectedEmotion);
  const isHigh = currentEmotion?.level >= 6;

  const lessons = [
    {
      id: "what", title: "E-Motion = Energy in Motion", icon: "〰️", color: "#00ff8c",
      content: [
        { type: "big", text: "The word 'emotion' literally means energy in motion." },
        { type: "p", text: "Break it apart: E-MOTION. Energy. In. Motion. Every emotion you feel is not just a thought or a chemical reaction — it's a specific frequency of energy moving through your body and radiating outward through your electromagnetic field." },
        { type: "p", text: "When you feel love, energy moves in smooth, coherent, expansive waves. When you feel fear, energy moves in jagged, chaotic, contracted bursts. The MOTION of the energy is determined by the EMOTION you're experiencing. They are the same thing." },
        { type: "highlight", text: "You are not a body having emotions. You are energy choosing which direction to move." },
        { type: "p", text: "This is why you can feel someone's anger before they speak. This is why a baby can feel its mother's anxiety. This is why walking into a funeral feels different from walking into a celebration. The energy is MOVING differently in each space — and your body is an antenna that detects it instantly." },
        { type: "p", text: "Every moment, you are choosing the direction of your energy. Most people let external events choose for them — something happens, and they react. But the masters throughout history all taught the same thing: choose the emotion FIRST, and the events rearrange to match it." },
      ]
    },
    {
      id: "manifest", title: "Emotion → Manifestation", icon: "🎯", color: "#eab308",
      content: [
        { type: "big", text: "You don't attract what you want. You attract what you ARE." },
        { type: "p", text: "Manifestation isn't about thinking hard enough about something. It's about matching the FREQUENCY of what you want. And frequency is determined by emotion." },
        { type: "p", text: "Think about it: you can visualize a million dollars all day long, but if you FEEL broke, desperate, and anxious while you do it — what frequency are you broadcasting? Scarcity. Lack. Fear. And the universe, being a mirror of electromagnetic fields, reflects that frequency right back to you." },
        { type: "p", text: "Now flip it. You don't have to pretend you have a million dollars. But you CAN choose to feel gratitude for what you DO have. You CAN choose to feel the joy of being alive. You CAN choose love over fear. And when you sustain those emotions — those FREQUENCIES — reality literally has no choice but to reorganize around you." },
        { type: "highlight", text: "The emotion you sustain is the signal you broadcast. The signal you broadcast is the reality you receive. Change the emotion, change the broadcast, change the reality." },
        { type: "p", text: "This isn't magic — it's physics. The reticular activating system in your brain filters reality to match your dominant emotional state. Your biofield attracts or repels based on coherence. And at the quantum level, the observer effect means your energetic state literally influences which probabilities collapse into your experienced reality." },
      ]
    },
    {
      id: "sync", title: "Synchronicity — The Signal", icon: "🔗", color: "#a78bfa",
      content: [
        { type: "big", text: "Synchronicities are not coincidences. They're confirmation that your frequency is aligned." },
        { type: "p", text: "You think of someone and they call. You need an answer and a book falls open to the right page. You take a 'wrong' turn and it leads to exactly what you needed. These aren't random — they're resonance events." },
        { type: "p", text: "When your emotional frequency is coherent and high, you become a tuning fork. You start resonating with people, places, and events that match your frequency. They literally find you because your electromagnetic signal is pulling them in — like how a radio tuned to 101.5 FM only picks up 101.5 FM." },
        { type: "p", text: "Jung called it synchronicity. Quantum physics calls it non-local correlation. Ancient traditions called it 'being in the flow.' It's all the same phenomenon: when your internal energy is moving coherently, external reality reorganizes to match." },
        { type: "highlight", text: "The more synchronicities you experience, the more evidence you have that your vibration is aligned. They are the universe's way of saying: you're on the right frequency. Keep going." },
        { type: "p", text: "And here's the key most people miss: synchronicities increase in proportion to your emotional coherence, not your mental effort. You can't THINK your way into synchronicity. You have to FEEL your way there. The heart leads. The mind follows. Reality conforms." },
      ]
    },
    {
      id: "route", title: "Choosing Your Route of Energy", icon: "🛤️", color: "#22c55e",
      content: [
        { type: "big", text: "Every moment is a crossroads. Your emotion chooses the path. The path determines the destination." },
        { type: "p", text: "Imagine your life as a river system. At every moment, the river forks. One fork leads toward creation, expansion, and alignment. The other leads toward destruction, contraction, and chaos. Your emotion — the direction of your energy in that moment — determines which fork you take." },
        { type: "p", text: "This isn't about toxic positivity. Sadness, grief, even anger have their place — they're processing frequencies. The danger isn't feeling them. The danger is LIVING in them. When you set up permanent residence in a low-frequency emotion, you're choosing that fork over and over until it becomes a canyon too deep to easily climb out of." },
        { type: "p", text: "The route of energy you take most often becomes your dominant frequency. Your dominant frequency becomes your identity. Your identity becomes your reality. This is how people 'become' angry people, anxious people, joyful people. It was never their personality — it was their most practiced emotional route." },
        { type: "highlight", text: "You are not your emotions. You are the one who chooses which emotion to sustain. That choice — made moment to moment — is the most powerful creative act in the universe." },
        { type: "p", text: "The beautiful truth: you can change your route at any moment. It doesn't matter how long you've been traveling the fear path or the shame path. One genuine shift to gratitude, one real moment of love, one conscious breath taken in peace — and the river forks again. You choose again. You always get to choose again." },
      ]
    },
    {
      id: "creation", title: "You Are the Creator", icon: "⚡", color: "#f97316",
      content: [
        { type: "big", text: "Creation doesn't happen TO you. Creation happens THROUGH you. Your emotion is the brush. Reality is the canvas." },
        { type: "p", text: "Every culture on Earth has a creation story. In most of them, the universe begins with a sound, a word, a vibration. In the beginning was the Word — and the Word was frequency. Creation IS vibration. And you are a vibrating being capable of creation at every moment." },
        { type: "p", text: "When you feel deep love and hold an intention — you're painting reality with the highest frequency brush. When you feel gratitude for something that hasn't arrived yet — you're creating a blueprint that reality rushes to fill. When you feel the joy of the thing before the thing exists — you're living in the frequency where it already does." },
        { type: "p", text: "This is not wish fulfillment. This is quantum physics meeting ancient wisdom. The observer collapses the wave function. Your conscious attention, powered by emotional energy, collapses infinite possibilities into one experienced reality. You are doing this right now, whether you know it or not." },
        { type: "highlight", text: "The only question that matters: are you creating by default (unconscious emotional reactions) or by design (conscious emotional choices)? One makes you a victim of circumstance. The other makes you the architect of reality." },
        { type: "p", text: "This is why every section of this platform exists. The herbs heal your vessel so it can conduct more energy. The knowledge removes the lies that keep you in low frequencies. The practices train you to choose your emotional state. The biofield section shows you the science. And this section — E-MOTIONS — is where it all connects: your energy, in motion, creating everything." },
      ]
    },
  ];

  if (activeLesson) {
    const lesson = lessons.find(l => l.id === activeLesson);
    return (
      <div style={{ animation: "fadeInUp 0.4s ease" }}>
        <button onClick={() => setActiveLesson(null)} style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)", color: "var(--text-muted)", padding: "8px 18px", borderRadius: 8, cursor: "pointer", fontSize: 11, letterSpacing: 2, fontFamily: "'Orbitron', sans-serif", marginBottom: 24 }}>← BACK TO E-MOTIONS</button>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 24 }}>
          <span style={{ fontSize: 40 }}>{lesson.icon}</span>
          <h2 style={{ fontSize: 22, fontWeight: 600, color: "var(--text)", fontFamily: "'Orbitron', sans-serif", margin: 0, letterSpacing: 1 }}>{lesson.title}</h2>
        </div>
        <GlassCard hover={false} style={{ maxWidth: 700 }}>
          {lesson.content.map((block, i) => {
            if (block.type === "big") return <h3 key={i} style={{ fontSize: 20, fontWeight: 400, color: "var(--text)", fontFamily: "'Sora', sans-serif", lineHeight: 1.6, marginBottom: 20 }}>{block.text}</h3>;
            if (block.type === "highlight") return (
              <div key={i} style={{ margin: "24px 0", padding: "20px 24px", borderRadius: 12, background: `${lesson.color}08`, borderLeft: `3px solid ${lesson.color}` }}>
                <p style={{ fontSize: 15, color: lesson.color, lineHeight: 1.9, margin: 0, fontWeight: 500 }}>{block.text}</p>
              </div>
            );
            return <p key={i} style={{ fontSize: 14, color: "var(--text-muted)", lineHeight: 2.1, marginBottom: 16 }}>{block.text}</p>;
          })}
        </GlassCard>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 24 }}>
          {(() => {
            const idx = lessons.findIndex(l => l.id === activeLesson);
            const prev = idx > 0 ? lessons[idx - 1] : null;
            const next = idx < lessons.length - 1 ? lessons[idx + 1] : null;
            return (<>
              {prev ? <button onClick={() => setActiveLesson(prev.id)} style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)", color: "var(--text-faint)", padding: "8px 18px", borderRadius: 8, cursor: "pointer", fontSize: 11, letterSpacing: 2, fontFamily: "'Orbitron', sans-serif" }}>← {prev.title}</button> : <div />}
              {next ? <button onClick={() => setActiveLesson(next.id)} style={{ background: `${next.color}10`, border: `1px solid ${next.color}30`, color: next.color, padding: "8px 18px", borderRadius: 8, cursor: "pointer", fontSize: 11, letterSpacing: 2, fontFamily: "'Orbitron', sans-serif" }}>{next.title} →</button> : <div />}
            </>);
          })()}
        </div>
      </div>
    );
  }

  return (
    <div style={{ animation: "fadeInUp 0.5s ease" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
        <div style={{ width: 3, height: 28, background: "linear-gradient(to bottom, #ec4899, #eab308, #06b6d4)", borderRadius: 2 }} />
        <h2 style={{ fontSize: 22, fontWeight: 300, color: "var(--text)", fontFamily: "'Sora', sans-serif", margin: 0 }}>E-MOTIONS</h2>
      </div>
      <p style={{ fontSize: 14, color: "var(--text-faint)", lineHeight: 1.8, marginTop: 8, marginBottom: 6 }}>
        Energy in Motion. Every emotion is a frequency — a specific pattern of energy moving through you and radiating outward. The emotion you choose determines the reality you create.
      </p>
      <p style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.7, marginBottom: 28 }}>
        Select an emotion below and watch how it transforms the energy environment in real time. Then read the lessons to understand why this matters for manifestation, synchronicity, and creation.
      </p>

      {/* Environment Visualizer */}
      <GlassCard hover={false} style={{ marginBottom: 24, padding: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <span style={{ fontSize: 10, letterSpacing: 3, color: currentEmotion?.color, fontFamily: "'Orbitron', sans-serif", transition: "color 0.5s ease" }}>ENERGY ENVIRONMENT — {currentEmotion?.name.toUpperCase()}</span>
          <span style={{ fontSize: 11, color: currentEmotion?.color, fontFamily: "'JetBrains Mono', monospace", transition: "color 0.5s ease" }}>{currentEmotion?.freq}</span>
        </div>
        <EmotionEnvironment emotion={selectedEmotion} />
      </GlassCard>

      {/* Emotion Selector */}
      <GlassCard hover={false} style={{ marginBottom: 24 }}>
        <span style={{ fontSize: 10, letterSpacing: 3, color: "var(--text-faint)", fontFamily: "'Orbitron', sans-serif", display: "block", marginBottom: 16 }}>SELECT AN EMOTION — WATCH THE ENVIRONMENT CHANGE</span>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {EMOTION_SCALE.map(e => (
            <div key={e.id} onClick={() => setSelectedEmotion(e.id)} style={{
              display: "flex", alignItems: "center", gap: 14, padding: "12px 16px",
              borderRadius: 10, cursor: "pointer", transition: "all 0.3s ease",
              background: selectedEmotion === e.id ? `${e.color}12` : "transparent",
              border: `1px solid ${selectedEmotion === e.id ? `${e.color}30` : "transparent"}`,
            }}>
              <span style={{ fontSize: 20 }}>{e.icon}</span>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: selectedEmotion === e.id ? "#fff" : "rgba(255,255,255,0.5)", transition: "color 0.3s" }}>{e.name}</span>
                  <span style={{ fontSize: 10, color: e.color, fontFamily: "'JetBrains Mono', monospace" }}>{e.freq}</span>
                </div>
                {selectedEmotion === e.id && (
                  <p style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6, margin: "6px 0 0", animation: "fadeInUp 0.3s ease" }}>{e.desc}</p>
                )}
              </div>
              {/* Frequency bar */}
              <div style={{ width: 80, height: 4, background: "var(--card-bg)", borderRadius: 2, overflow: "hidden" }}>
                <div style={{ width: `${e.level * 10}%`, height: "100%", background: e.color, borderRadius: 2, boxShadow: `0 0 6px ${e.color}44`, transition: "width 0.5s ease" }} />
              </div>
              <span style={{ fontSize: 10, color: e.color, fontFamily: "'Orbitron', sans-serif", width: 20, textAlign: "right" }}>{e.level}</span>
            </div>
          ))}
        </div>
      </GlassCard>

      {/* What's happening panel */}
      <GlassCard hover={false} style={{ marginBottom: 28, borderLeft: `3px solid ${currentEmotion?.color}`, transition: "all 0.5s ease" }}>
        <span style={{ fontSize: 10, letterSpacing: 3, color: currentEmotion?.color, fontFamily: "'Orbitron', sans-serif", display: "block", marginBottom: 10, transition: "color 0.5s ease" }}>⟡ WHAT'S HAPPENING TO YOUR ENERGY</span>
        <p style={{ fontSize: 14, color: "var(--text-muted)", lineHeight: 1.9, margin: 0 }}>
          {isHigh
            ? `At the frequency of ${currentEmotion?.name.toLowerCase()}, your energy is moving outward — expanding, connecting, creating. Particles in the visualizer above flow upward and form coherent connections. This is what's happening to your biofield right now when you genuinely feel ${currentEmotion?.name.toLowerCase()}. Your electromagnetic signal becomes magnetic. Reality reorganizes around you.`
            : selectedEmotion === "neutral"
            ? "At neutral, your energy is potential — neither creating nor destroying. Like a ball balanced at the top of a hill, the next emotion you choose determines everything. This is the launchpad. What will you choose to feel?"
            : `At the frequency of ${currentEmotion?.name.toLowerCase()}, your energy is contracting inward. Particles fall, disconnect, and scatter. Your biofield shrinks close to your body. This is what happens energetically when you sustain ${currentEmotion?.name.toLowerCase()} — your creative power diminishes, your signal weakens, and reality reflects that contraction back to you. The way out: one conscious choice to shift upward.`
          }
        </p>
      </GlassCard>

      {/* Deep Dive Lessons */}
      <span style={{ fontSize: 10, letterSpacing: 3, color: "var(--text-faint)", fontFamily: "'Orbitron', sans-serif", display: "block", marginBottom: 14 }}>UNDERSTAND THE POWER</span>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
        {lessons.map(lesson => (
          <GlassCard key={lesson.id} onClick={() => setActiveLesson(lesson.id)} style={{
            flex: "1 1 260px", minWidth: 240, cursor: "pointer", borderTop: `2px solid ${lesson.color}40`,
          }}>
            <span style={{ fontSize: 28, display: "block", marginBottom: 10 }}>{lesson.icon}</span>
            <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", fontFamily: "'Orbitron', sans-serif", margin: "0 0 6px", letterSpacing: 1 }}>{lesson.title}</h3>
            <p style={{ fontSize: 11, color: "var(--text-faint)", lineHeight: 1.6, margin: "0 0 12px" }}>{lesson.content.find(c => c.type === "p")?.text.substring(0, 100)}...</p>
            <span style={{ fontSize: 10, color: lesson.color, letterSpacing: 2, fontFamily: "'Orbitron', sans-serif" }}>READ →</span>
          </GlassCard>
        ))}
      </div>

      {/* Bottom quote */}
      <div style={{ marginTop: 32, padding: 24, borderRadius: 14, background: "linear-gradient(135deg, rgba(236,72,153,0.05), rgba(234,179,8,0.05), rgba(6,182,212,0.05))", border: "1px solid rgba(236,72,153,0.08)", textAlign: "center" }}>
        <p style={{ fontSize: 15, color: "var(--text-muted)", lineHeight: 1.9, fontStyle: "italic", margin: "0 0 8px" }}>
          "Everything is energy and that's all there is to it. Match the frequency of the reality you want and you cannot help but get that reality. It can be no other way."
        </p>
        <span style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "'JetBrains Mono', monospace" }}>— Often attributed to Albert Einstein</span>
      </div>
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════
// BIO FIELD — The Energetic Body & Human Biofield
// ═══════════════════════════════════════════════════════════════

function BiofieldVisualizer({ emotion, intensity }) {
  const canvasRef = useRef(null);
  const animRef = useRef(null);

  const emotionColors = {
    love: { h: 330, s: 80, l: 60, spread: 1.4, pulse: 0.8, label: "Love & Compassion" },
    joy: { h: 50, s: 90, l: 60, spread: 1.3, pulse: 1.2, label: "Joy & Excitement" },
    peace: { h: 200, s: 70, l: 55, spread: 1.2, pulse: 0.4, label: "Peace & Calm" },
    fear: { h: 0, s: 10, l: 30, spread: 0.5, pulse: 2.5, label: "Fear & Anxiety" },
    anger: { h: 0, s: 90, l: 45, spread: 0.7, pulse: 3.0, label: "Anger & Frustration" },
    sadness: { h: 220, s: 30, l: 35, spread: 0.6, pulse: 0.3, label: "Sadness & Grief" },
    gratitude: { h: 140, s: 80, l: 55, spread: 1.5, pulse: 0.6, label: "Gratitude" },
    neutral: { h: 180, s: 20, l: 45, spread: 0.9, pulse: 0.8, label: "Neutral / Baseline" },
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let w = 400, h = 500;
    canvas.width = w * 2; canvas.height = h * 2;
    ctx.scale(2, 2);
    const cx = w / 2, cy = h * 0.45;

    const draw = (time) => {
      const t = time * 0.001;
      const e = emotionColors[emotion] || emotionColors.neutral;
      const int = intensity / 100;

      ctx.clearRect(0, 0, w, h);

      // Biofield aura layers (outermost first)
      const layers = 8;
      for (let i = layers; i >= 0; i--) {
        const layerRatio = i / layers;
        const baseRadius = 60 + i * 22 * e.spread;
        const wobble = Math.sin(t * e.pulse + i * 0.8) * (6 + i * 3) * int;
        const radius = baseRadius + wobble;

        // Draw aura ellipse
        const hue = (e.h + i * 8) % 360;
        const alpha = (0.06 + (1 - layerRatio) * 0.08) * int;

        ctx.beginPath();
        ctx.ellipse(cx, cy, radius * 0.7, radius, 0, 0, Math.PI * 2);

        const grad = ctx.createRadialGradient(cx, cy, radius * 0.3, cx, cy, radius);
        grad.addColorStop(0, `hsla(${hue}, ${e.s}%, ${e.l}%, ${alpha * 1.5})`);
        grad.addColorStop(0.5, `hsla(${hue}, ${e.s - 10}%, ${e.l}%, ${alpha})`);
        grad.addColorStop(1, `hsla(${hue}, ${e.s}%, ${e.l}%, 0)`);
        ctx.fillStyle = grad;
        ctx.fill();

        // Pulsing edge glow
        if (i > 2 && i < 7) {
          ctx.strokeStyle = `hsla(${hue}, ${e.s}%, ${e.l + 15}%, ${alpha * 0.8})`;
          ctx.lineWidth = 0.5;
          ctx.stroke();
        }
      }

      // Energy particles flowing around the body
      const particleCount = Math.floor(20 + int * 40);
      for (let p = 0; p < particleCount; p++) {
        const angle = (p / particleCount) * Math.PI * 2 + t * (e.pulse * 0.3);
        const orbitA = 80 + Math.sin(t * 0.5 + p * 0.7) * 30;
        const orbitB = 110 + Math.cos(t * 0.3 + p * 0.5) * 40;
        const px = cx + Math.cos(angle) * orbitA * 0.7;
        const py = cy + Math.sin(angle) * orbitB;
        const size = 1 + Math.sin(t * 2 + p) * 0.8;
        const hue = (e.h + p * 5) % 360;

        ctx.beginPath();
        ctx.arc(px, py, size * int, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${hue}, ${e.s}%, ${e.l + 20}%, ${0.3 + int * 0.5})`;
        ctx.shadowColor = `hsla(${hue}, ${e.s}%, ${e.l}%, 0.5)`;
        ctx.shadowBlur = 6;
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      // Body silhouette (simple)
      // Head
      ctx.beginPath();
      ctx.arc(cx, cy - 62, 18, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,0.06)";
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.12)";
      ctx.lineWidth = 1;
      ctx.stroke();

      // Torso
      ctx.beginPath();
      ctx.ellipse(cx, cy - 15, 22, 40, 0, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();

      // Legs
      ctx.beginPath();
      ctx.ellipse(cx - 12, cy + 50, 10, 35, -0.1, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(cx + 12, cy + 50, 10, 35, 0.1, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();

      // Chakra points (7 glowing dots along spine)
      const chakraColors = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#06b6d4", "#6366f1", "#a855f7"];
      const chakraY = [cy + 20, cy + 5, cy - 10, cy - 25, cy - 35, cy - 50, cy - 62];
      chakraColors.forEach((color, i) => {
        const glow = 3 + Math.sin(t * 1.5 + i * 0.9) * 2 * int;
        ctx.beginPath();
        ctx.arc(cx, chakraY[i], glow, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = 10 + int * 10;
        ctx.fill();
        ctx.shadowBlur = 0;
      });

      // Heart coherence wave (if love/gratitude/peace)
      if (["love", "gratitude", "peace", "joy"].includes(emotion)) {
        ctx.beginPath();
        ctx.strokeStyle = `hsla(${e.h}, ${e.s}%, ${e.l + 20}%, ${0.15 * int})`;
        ctx.lineWidth = 1.5;
        for (let x = 0; x < w; x++) {
          const wave = Math.sin(x * 0.03 + t * 1.5) * 15 * int * Math.sin(x * 0.008);
          ctx[x === 0 ? "moveTo" : "lineTo"](x, h - 40 + wave);
        }
        ctx.stroke();
      }

      // Contracted field indicator (fear/anger/sadness)
      if (["fear", "anger", "sadness"].includes(emotion)) {
        // Jagged static around body
        for (let j = 0; j < 15 * int; j++) {
          const jx = cx + (Math.random() - 0.5) * 120;
          const jy = cy + (Math.random() - 0.5) * 160;
          ctx.beginPath();
          ctx.moveTo(jx, jy);
          ctx.lineTo(jx + (Math.random() - 0.5) * 12, jy + (Math.random() - 0.5) * 12);
          ctx.strokeStyle = `hsla(${e.h}, ${e.s}%, ${e.l}%, ${0.2 + Math.random() * 0.3})`;
          ctx.lineWidth = 0.5;
          ctx.stroke();
        }
      }

      // Label
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.font = "11px 'Orbitron', sans-serif";
      ctx.textAlign = "center";
      ctx.letterSpacing = "3px";
      ctx.fillText(e.label.toUpperCase(), cx, h - 10);

      animRef.current = requestAnimationFrame(draw);
    };
    animRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animRef.current);
  }, [emotion, intensity]);

  return <canvas ref={canvasRef} style={{ width: "100%", maxWidth: 400, height: "auto", aspectRatio: "4/5" }} />;
}

// Earth field interaction visualizer
function EarthFieldVisualizer({ emotion, peopleCount }) {
  const canvasRef = useRef(null);
  const animRef = useRef(null);

  const positive = ["love", "joy", "peace", "gratitude"].includes(emotion);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const w = 600, h = 240;
    canvas.width = w * 2; canvas.height = h * 2;
    ctx.scale(2, 2);

    const people = Array.from({ length: peopleCount }, (_, i) => ({
      x: 60 + (i / peopleCount) * (w - 120),
      y: h * 0.5,
      phase: Math.random() * Math.PI * 2,
    }));

    const draw = (time) => {
      const t = time * 0.001;
      ctx.clearRect(0, 0, w, h);

      // Earth's field (bottom wave)
      ctx.beginPath();
      const earthHue = positive ? 140 : 0;
      const earthAlpha = positive ? 0.15 : 0.06;
      for (let x = 0; x < w; x++) {
        const baseWave = Math.sin(x * 0.01 + t * 0.3) * 8;
        const harmony = positive ? Math.sin(x * 0.02 + t * 0.7) * 5 * peopleCount * 0.15 : Math.random() * 3;
        ctx[x === 0 ? "moveTo" : "lineTo"](x, h - 20 + baseWave + harmony);
      }
      ctx.strokeStyle = `hsla(${earthHue}, 60%, 50%, ${earthAlpha + peopleCount * 0.02})`;
      ctx.lineWidth = 2;
      ctx.stroke();

      // Label
      ctx.fillStyle = "rgba(255,255,255,0.2)";
      ctx.font = "9px 'JetBrains Mono', monospace";
      ctx.textAlign = "left";
      ctx.fillText("EARTH'S SCHUMANN RESONANCE (7.83 Hz)", 10, h - 5);

      // Draw each person and their field
      people.forEach((p, i) => {
        // Person dot
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = positive ? "#00ff8c" : "#ef4444";
        ctx.shadowColor = positive ? "#00ff8c" : "#ef4444";
        ctx.shadowBlur = 8;
        ctx.fill();
        ctx.shadowBlur = 0;

        // Individual biofield ring
        const fieldRadius = positive ? 20 + Math.sin(t + p.phase) * 8 : 10 + Math.sin(t * 3 + p.phase) * 3;
        ctx.beginPath();
        ctx.arc(p.x, p.y, fieldRadius, 0, Math.PI * 2);
        ctx.strokeStyle = positive ? `rgba(0, 255, 140, ${0.12})` : `rgba(239, 68, 68, ${0.08})`;
        ctx.lineWidth = 1;
        ctx.stroke();

        // Connection lines between nearby people (coherent fields overlap)
        if (positive && i < people.length - 1) {
          const next = people[i + 1];
          const dist = Math.abs(next.x - p.x);
          if (dist < 100) {
            const connAlpha = (1 - dist / 100) * 0.12;
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            const cpY = p.y - 20 - Math.sin(t + i) * 10;
            ctx.quadraticCurveTo((p.x + next.x) / 2, cpY, next.x, next.y);
            ctx.strokeStyle = `rgba(0, 255, 140, ${connAlpha})`;
            ctx.lineWidth = 1;
            ctx.stroke();
          }
        }

        // Waves going down to earth
        ctx.beginPath();
        ctx.moveTo(p.x, p.y + fieldRadius);
        ctx.lineTo(p.x + Math.sin(t + p.phase) * 5, h - 25);
        ctx.strokeStyle = positive ? "rgba(0,255,140,0.06)" : "rgba(255,100,100,0.03)";
        ctx.lineWidth = 0.5;
        ctx.stroke();
      });

      // Collective field overlay (if positive and enough people)
      if (positive && peopleCount >= 3) {
        const collectiveGrad = ctx.createRadialGradient(w / 2, h * 0.5, 0, w / 2, h * 0.5, w * 0.4);
        collectiveGrad.addColorStop(0, `rgba(0, 255, 140, ${0.03 * peopleCount})`);
        collectiveGrad.addColorStop(1, "transparent");
        ctx.fillStyle = collectiveGrad;
        ctx.fillRect(0, 0, w, h);
      }

      animRef.current = requestAnimationFrame(draw);
    };
    animRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animRef.current);
  }, [emotion, peopleCount, positive]);

  return <canvas ref={canvasRef} style={{ width: "100%", height: "auto", aspectRatio: "5/2" }} />;
}

function BiofieldSection() {
  const [activeEmotion, setActiveEmotion] = useState("neutral");
  const [intensity, setIntensity] = useState(60);
  const [peopleCount, setPeopleCount] = useState(1);
  const [activeLesson, setActiveLesson] = useState(null);

  const emotions = [
    { id: "love", emoji: "💗", color: "#ec4899" },
    { id: "joy", emoji: "✨", color: "#eab308" },
    { id: "peace", emoji: "🕊️", color: "#06b6d4" },
    { id: "gratitude", emoji: "🙏", color: "#22c55e" },
    { id: "neutral", emoji: "😐", color: "#78716c" },
    { id: "sadness", emoji: "💧", color: "#6366f1" },
    { id: "fear", emoji: "😰", color: "#94a3b8" },
    { id: "anger", emoji: "🔥", color: "#ef4444" },
  ];

  const isPositive = ["love", "joy", "peace", "gratitude"].includes(activeEmotion);

  const lessons = [
    {
      id: "what", title: "What Is Your Biofield?", icon: "🌐", color: "#06b6d4",
      content: [
        { type: "head", text: "You Are More Than a Body" },
        { type: "text", text: "Imagine you're holding a magnet. You can't see the magnetic field around it, but it's there — you can feel it pull on metal objects nearby. Your body works the same way." },
        { type: "text", text: "Your heart generates an electromagnetic field that extends 3 to 5 feet outside your body in every direction. Scientists can measure it with sensitive equipment called a magnetometer. This field is called your BIOFIELD — it's a real, measurable energy field that surrounds you like an invisible egg of light." },
        { type: "head", text: "How It Works" },
        { type: "text", text: "Every cell in your body is like a tiny battery running on about 0.07 volts. You have roughly 37 trillion cells. That's a LOT of tiny batteries all firing at once, creating electrical signals that ripple outward." },
        { type: "text", text: "Your heart is the strongest generator — it produces an electrical signal 60 times stronger than your brain. That's why heart-centered emotions (love, gratitude) create the biggest and most coherent fields around you." },
        { type: "fact", text: "The HeartMath Institute has measured the heart's electromagnetic field extending up to 15 feet from the body using SQUID-based magnetometers." },
      ]
    },
    {
      id: "emotions", title: "How Emotions Shape Your Field", icon: "🎭", color: "#a78bfa",
      content: [
        { type: "head", text: "Your Feelings Are Frequencies" },
        { type: "text", text: "Think about a time you walked into a room and could just FEEL the tension — even though nobody said anything. That's because you were sensing other people's biofields. Your body is constantly reading the electromagnetic information in the space around you." },
        { type: "text", text: "When you feel love, gratitude, or joy, your heart rhythm becomes smooth and ordered — scientists call this 'coherent.' Your biofield expands outward like smooth ripples on a pond. It becomes bigger and brighter." },
        { type: "text", text: "When you feel fear, anger, or stress, your heart rhythm becomes jagged and chaotic — 'incoherent.' Your biofield contracts, shrinks close to your body, and becomes noisy, like static on a TV." },
        { type: "head", text: "Try It Right Now" },
        { type: "text", text: "Use the visualizer above — switch between Love and Fear and watch what happens to the field. That's what's actually happening to YOUR energy field right now, based on how you feel." },
        { type: "fact", text: "Research shows that a person in a coherent heart state can measurably influence the brainwaves of another person sitting nearby — without touching or speaking." },
      ]
    },
    {
      id: "others", title: "How Your Field Affects Others", icon: "🤝", color: "#22c55e",
      content: [
        { type: "head", text: "You Are a Walking Broadcast Tower" },
        { type: "text", text: "Your biofield doesn't stop at your skin. It radiates outward and overlaps with every person near you. When your field overlaps with someone else's, information is exchanged — not through words, but through electromagnetic waves." },
        { type: "text", text: "This is why you feel different around different people. That friend who always makes you feel calm? Their coherent biofield is literally entraining (syncing) your heart rhythm to match theirs. That person who stresses you out? Their chaotic field is doing the same thing in reverse." },
        { type: "head", text: "The Ripple Effect" },
        { type: "text", text: "Use the slider below the Earth visualization to add more people. Watch how coherent fields connect and amplify each other, while incoherent fields stay isolated. When a group of people feel love or gratitude together, their combined field becomes much stronger than any individual's." },
        { type: "text", text: "This is why meditation groups, concerts, prayer circles, and sports stadiums all feel so powerful — hundreds or thousands of biofields syncing up creates something bigger than the sum of its parts." },
        { type: "fact", text: "The Global Coherence Initiative has found correlations between mass human emotions and disturbances in Earth's magnetic field — measured by magnetometers placed around the planet." },
      ]
    },
    {
      id: "earth", title: "Your Field & The Earth", icon: "🌍", color: "#eab308",
      content: [
        { type: "head", text: "You're Plugged Into the Planet" },
        { type: "text", text: "The Earth itself has a biofield — a massive electromagnetic field generated by its molten iron core. It pulses at a baseline frequency of 7.83 Hz, called the Schumann Resonance. Here's the wild part: your brain's alpha waves (the ones you produce when you're calm and aware) pulse at almost the exact same frequency." },
        { type: "text", text: "This isn't a coincidence. Life on Earth evolved INSIDE this field for billions of years. Your nervous system is literally tuned to the planet's frequency like a radio tuned to a station." },
        { type: "head", text: "Grounding Is Real Science" },
        { type: "text", text: "When you walk barefoot on grass, soil, or sand, free electrons from the Earth flow into your body through your feet. These electrons are antioxidants — they neutralize inflammation. Studies published in the Journal of Environmental and Public Health show that grounding reduces cortisol, improves sleep, and normalizes your body's electrical state." },
        { type: "text", text: "Think of it this way: your phone needs to be charged. You are an electrical being who also needs to be 'charged' — and the Earth is your charger." },
        { type: "fact", text: "Astronauts in space, cut off from Earth's Schumann Resonance, experienced health problems until NASA installed Schumann Resonance generators in spacecraft." },
      ]
    },
    {
      id: "waves", title: "Frequencies & Vibration 101", icon: "〰️", color: "#ec4899",
      content: [
        { type: "head", text: "Everything Vibrates — Literally" },
        { type: "text", text: "Pick up any solid object near you — a pen, your phone, a book. It looks solid, right? But zoom in to the atomic level and it's 99.9999% empty space. The tiny bit of matter that IS there is vibrating at incredibly high frequencies. Everything you see, touch, and hear is vibration." },
        { type: "text", text: "Sound is vibration you can hear (20Hz to 20,000Hz). Light is vibration you can see (430 trillion Hz to 750 trillion Hz). Your thoughts and emotions create vibrations you can FEEL — even if most people haven't been taught to notice them." },
        { type: "head", text: "Resonance: The Key to Everything" },
        { type: "text", text: "When you strike a tuning fork and hold it near another tuning fork of the same pitch, the second one starts vibrating too — without being touched. This is called resonance. Your biofield works the same way." },
        { type: "text", text: "When you're around someone vibrating at a frequency of love or joy, your field starts to resonate with theirs — you literally start feeling what they feel. This is why 'raise your vibration' isn't just a saying. It's physics." },
        { type: "fact", text: "In 1665, Dutch physicist Christiaan Huygens discovered that pendulum clocks hanging on the same wall would synchronize their swings. This is the same principle at work in human biofield entrainment." },
      ]
    },
    {
      id: "protect", title: "How to Strengthen Your Field", icon: "🛡️", color: "#f97316",
      content: [
        { type: "head", text: "Your Field Is Like a Muscle" },
        { type: "text", text: "The more you practice positive emotional states, the stronger and more resilient your biofield becomes. Here's how:" },
        { type: "head", text: "1. Heart Coherence Breathing" },
        { type: "text", text: "Breathe in for 5 seconds, out for 5 seconds, while focusing on your heart area and feeling gratitude. Do this for 3 minutes. This single practice, backed by over 300 peer-reviewed studies, creates measurable coherence in your biofield within 60 seconds." },
        { type: "head", text: "2. Grounding" },
        { type: "text", text: "Stand barefoot on earth for 20 minutes daily. This recharges your electrical system and synchronizes your field with the Earth's Schumann Resonance." },
        { type: "head", text: "3. Protect Your Field" },
        { type: "text", text: "Limit time around people who drain you. Avoid excessive screen time (screens emit EMF that disrupts your field). Spend time in nature — trees and plants have their own coherent biofields." },
        { type: "head", text: "4. Amplify With Others" },
        { type: "text", text: "Meditate with others. Practice gratitude in groups. Sing together. Any time multiple people enter coherent states simultaneously, the collective field becomes exponentially stronger." },
        { type: "fact", text: "A study by the HeartMath Institute found that trained individuals could intentionally alter the conformation (shape) of DNA in a test tube using focused heart coherence from several feet away." },
      ]
    },
  ];

  if (activeLesson) {
    const lesson = lessons.find(l => l.id === activeLesson);
    return (
      <div style={{ animation: "fadeInUp 0.4s ease" }}>
        <button onClick={() => setActiveLesson(null)} style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)", color: "var(--text-muted)", padding: "8px 18px", borderRadius: 8, cursor: "pointer", fontSize: 11, letterSpacing: 2, fontFamily: "'Orbitron', sans-serif", marginBottom: 24 }}>← BACK TO BIO FIELD</button>

        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 24 }}>
          <span style={{ fontSize: 40 }}>{lesson.icon}</span>
          <h2 style={{ fontSize: 22, fontWeight: 600, color: "var(--text)", fontFamily: "'Orbitron', sans-serif", margin: 0, letterSpacing: 1 }}>{lesson.title}</h2>
        </div>

        <GlassCard hover={false} style={{ maxWidth: 700 }}>
          {lesson.content.map((block, i) => {
            if (block.type === "head") return <h3 key={i} style={{ fontSize: 16, fontWeight: 600, color: lesson.color, margin: i === 0 ? "0 0 12px" : "28px 0 12px", fontFamily: "'Orbitron', sans-serif", letterSpacing: 1 }}>{block.text}</h3>;
            if (block.type === "fact") return (
              <div key={i} style={{ margin: "20px 0", padding: "16px 20px", borderRadius: 10, background: `${lesson.color}08`, borderLeft: `3px solid ${lesson.color}`, }}>
                <span style={{ fontSize: 10, letterSpacing: 2, color: lesson.color, fontFamily: "'Orbitron', sans-serif", display: "block", marginBottom: 6 }}>⟡ RESEARCH</span>
                <p style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.8, margin: 0 }}>{block.text}</p>
              </div>
            );
            return <p key={i} style={{ fontSize: 14, color: "var(--text-muted)", lineHeight: 2, margin: "0 0 14px" }}>{block.text}</p>;
          })}
        </GlassCard>
      </div>
    );
  }

  return (
    <div style={{ animation: "fadeInUp 0.5s ease" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
        <div style={{ width: 3, height: 28, background: "linear-gradient(to bottom, #a78bfa, #06b6d4)", borderRadius: 2 }} />
        <h2 style={{ fontSize: 22, fontWeight: 300, color: "var(--text)", fontFamily: "'Sora', sans-serif", margin: 0 }}>BIO FIELD</h2>
      </div>
      <p style={{ fontSize: 13, color: "var(--text-faint)", lineHeight: 1.8, marginTop: 8, marginBottom: 28 }}>
        Your body is surrounded by a measurable electromagnetic field that changes shape, size, and frequency based on your emotions. 
        This isn't spiritual theory — it's physics. Explore how your feelings literally reshape the energy around you.
      </p>

      {/* Interactive Visualizer Section */}
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 32 }}>
        {/* Biofield Visualizer */}
        <GlassCard hover={false} style={{ flex: "0 1 420px", display: "flex", flexDirection: "column", alignItems: "center", padding: "20px" }}>
          <span style={{ fontSize: 10, letterSpacing: 3, color: "var(--text-faint)", fontFamily: "'Orbitron', sans-serif", marginBottom: 12 }}>YOUR BIOFIELD — LIVE</span>
          <BiofieldVisualizer emotion={activeEmotion} intensity={intensity} />
        </GlassCard>

        {/* Controls */}
        <div style={{ flex: 1, minWidth: 280, display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Emotion Selector */}
          <GlassCard hover={false}>
            <span style={{ fontSize: 10, letterSpacing: 3, color: "#00ff8c", fontFamily: "'Orbitron', sans-serif", display: "block", marginBottom: 14 }}>SELECT AN EMOTION</span>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {emotions.map(e => (
                <button key={e.id} onClick={() => setActiveEmotion(e.id)} style={{
                  padding: "10px 16px", borderRadius: 10, cursor: "pointer", transition: "all 0.3s ease",
                  background: activeEmotion === e.id ? `${e.color}20` : "rgba(255,255,255,0.03)",
                  border: `1px solid ${activeEmotion === e.id ? `${e.color}50` : "rgba(255,255,255,0.06)"}`,
                  color: activeEmotion === e.id ? e.color : "rgba(255,255,255,0.4)",
                  display: "flex", alignItems: "center", gap: 6, fontSize: 12,
                  boxShadow: activeEmotion === e.id ? `0 0 15px ${e.color}20` : "none",
                }}>
                  <span style={{ fontSize: 16 }}>{e.emoji}</span>
                  <span style={{ textTransform: "capitalize", fontFamily: "'Sora', sans-serif" }}>{e.id}</span>
                </button>
              ))}
            </div>
          </GlassCard>

          {/* Intensity Slider */}
          <GlassCard hover={false}>
            <span style={{ fontSize: 10, letterSpacing: 3, color: "var(--text-faint)", fontFamily: "'Orbitron', sans-serif", display: "block", marginBottom: 10 }}>INTENSITY: <span style={{ color: isPositive ? "#00ff8c" : "#ef4444" }}>{intensity}%</span></span>
            <input type="range" min="10" max="100" value={intensity} onChange={e => setIntensity(Number(e.target.value))}
              style={{ width: "100%", accentColor: isPositive ? "#00ff8c" : "#ef4444", cursor: "pointer" }} />
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--text-dim)", marginTop: 4 }}>
              <span>Faint</span><span>Overwhelming</span>
            </div>
          </GlassCard>

          {/* What's happening box */}
          <GlassCard hover={false} style={{ borderLeft: `3px solid ${isPositive ? "#00ff8c" : "#ef4444"}` }}>
            <span style={{ fontSize: 10, letterSpacing: 3, color: isPositive ? "#00ff8c" : "#ef4444", fontFamily: "'Orbitron', sans-serif", display: "block", marginBottom: 8 }}>⟡ WHAT'S HAPPENING</span>
            {isPositive ? (
              <p style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.8, margin: 0 }}>
                Your heart rhythm is <strong style={{ color: "#00ff8c" }}>coherent</strong> — smooth, ordered, harmonious. 
                Your biofield is <strong style={{ color: "#00ff8c" }}>expanding</strong> outward, growing brighter. 
                The electromagnetic waves you're emitting are like clean radio signals that other people's nervous systems can pick up and sync with. 
                You are literally raising the vibration of every room you walk into.
              </p>
            ) : activeEmotion === "neutral" ? (
              <p style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.8, margin: 0 }}>
                Your field is at baseline — neither expanding nor contracting. This is your resting state. 
                Try selecting different emotions above to see how dramatically your biofield changes in real time.
              </p>
            ) : (
              <p style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.8, margin: 0 }}>
                Your heart rhythm is <strong style={{ color: "#ef4444" }}>incoherent</strong> — jagged, chaotic, fragmented. 
                Your biofield is <strong style={{ color: "#ef4444" }}>contracting</strong> close to your body, becoming smaller and dimmer. 
                The electromagnetic noise you're emitting creates stress responses in people around you — even if you don't say a word. 
                Your body is burning extra energy maintaining this state.
              </p>
            )}
          </GlassCard>
        </div>
      </div>

      {/* Earth Field Interaction */}
      <GlassCard hover={false} style={{ marginBottom: 24 }}>
        <span style={{ fontSize: 10, letterSpacing: 3, color: "#eab308", fontFamily: "'Orbitron', sans-serif", display: "block", marginBottom: 4 }}>HOW YOUR FIELD AFFECTS PEOPLE & THE EARTH</span>
        <p style={{ fontSize: 12, color: "var(--text-faint)", marginBottom: 16 }}>
          Slide to add more people. Watch how {isPositive ? "coherent fields connect and amplify" : "incoherent fields stay isolated"}.
        </p>
        <EarthFieldVisualizer emotion={activeEmotion} peopleCount={peopleCount} />
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 12 }}>
          <span style={{ fontSize: 11, color: "var(--text-faint)", fontFamily: "'JetBrains Mono', monospace" }}>PEOPLE:</span>
          <input type="range" min="1" max="8" value={peopleCount} onChange={e => setPeopleCount(Number(e.target.value))}
            style={{ flex: 1, accentColor: isPositive ? "#00ff8c" : "#ef4444", cursor: "pointer", maxWidth: 300 }} />
          <span style={{ fontSize: 14, fontWeight: 600, color: isPositive ? "#00ff8c" : "#ef4444", fontFamily: "'Orbitron', sans-serif" }}>{peopleCount}</span>
        </div>
        {peopleCount >= 3 && isPositive && (
          <div style={{ marginTop: 12, padding: "10px 16px", borderRadius: 8, background: "rgba(0,255,140,0.06)", border: "1px solid rgba(0,255,140,0.12)" }}>
            <p style={{ fontSize: 12, color: "#00ff8c", margin: 0 }}>⟡ Collective coherence detected — the group field is amplifying. Earth's field is responding.</p>
          </div>
        )}
      </GlassCard>

      {/* Lessons Grid */}
      <div style={{ marginBottom: 8 }}>
        <span style={{ fontSize: 10, letterSpacing: 3, color: "var(--text-faint)", fontFamily: "'Orbitron', sans-serif" }}>DEEP DIVE LESSONS</span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginTop: 12 }}>
        {lessons.map(lesson => (
          <GlassCard key={lesson.id} onClick={() => setActiveLesson(lesson.id)} style={{
            flex: "1 1 260px", minWidth: 240, cursor: "pointer", borderTop: `2px solid ${lesson.color}40`,
          }}>
            <span style={{ fontSize: 28, display: "block", marginBottom: 10 }}>{lesson.icon}</span>
            <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", fontFamily: "'Orbitron', sans-serif", margin: "0 0 6px", letterSpacing: 1 }}>{lesson.title}</h3>
            <p style={{ fontSize: 11, color: "var(--text-faint)", lineHeight: 1.6, margin: "0 0 12px" }}>
              {lesson.content.find(c => c.type === "text")?.text.substring(0, 90)}...
            </p>
            <span style={{ fontSize: 10, color: lesson.color, letterSpacing: 2, fontFamily: "'Orbitron', sans-serif" }}>READ →</span>
          </GlassCard>
        ))}
      </div>

      {/* Bottom disclaimer */}
      <div style={{ marginTop: 28, padding: 16, borderRadius: 10, background: "var(--card-bg)", border: "1px solid var(--card-border)", textAlign: "center" }}>
        <p style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "'JetBrains Mono', monospace", margin: 0 }}>
          Based on research from the HeartMath Institute, Dr. Valerie Hunt (UCLA), Dr. Harold Burr (Yale), and the Global Coherence Initiative. Your biofield is real. Your emotions shape it. You shape the world around you.
        </p>
      </div>
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════
// BIO FIELD — Interactive Biofield Education
// ═══════════════════════════════════════════════════════════════


// ═══════════════════════════════════════════════════════════════
// REALITY HACKS — Off-Grid Tech, Sovereignty & Life Cheat Codes
// ═══════════════════════════════════════════════════════════════

const HACK_CATEGORIES = [
  // ─── ENERGY & POWER ───
  {
    id: "earth-battery", icon: "🔋", title: "Earth Batteries & Free Power", color: "#eab308", group: "ENERGY & POWER",
    desc: "The Earth is a giant battery. These devices tap into the electrical potential between soil and atmosphere to generate usable power — no grid required.",
    items: [
      { title: "Basic Earth Battery — Copper & Zinc", desc: "Bury a copper pipe and a zinc pipe 3 feet apart in moist soil. Connect with wire. You now have a battery generating 0.5-1.1 volts from the Earth's electrochemical energy. Stack multiple cells in series for usable voltage. Pioneers ran telegraph lines on Earth batteries in the 1800s.", difficulty: "Beginner", cost: "$10-20" },
      { title: "The Laskey Earth Battery", desc: "An advanced design using multiple copper and galvanized steel rods in a specific pattern. Can generate enough power to charge phones, run LED lights, and power small devices. Documented by experimenters generating 5-12V continuously from soil alone.", difficulty: "Intermediate", cost: "$30-60" },
      { title: "Atmospheric Energy Harvesting", desc: "Nathan Stubblefield's 1898 patent for extracting electricity from the ground. Tesla's experiments with ground currents. The atmosphere is charged to approximately 200-400V per meter of altitude. This voltage differential is free, everywhere, and continuously replenished.", difficulty: "Advanced", cost: "$50-200" },
      { title: "Crystal Radio — Zero Power", desc: "Build a radio that runs on the energy of the radio waves themselves. No battery, no power source — just a coil, a diode, an earphone, and an antenna. Proves the air is full of harvestable electromagnetic energy.", difficulty: "Beginner", cost: "$10" },
      { title: "Bedini Motor — Overunity Claims", desc: "John Bedini's pulsed motor design that charges batteries while running. Pulsed DC creates a back-EMF spike captured into a charging battery. Multiple independent replicators report output exceeding input.", difficulty: "Advanced", cost: "$50-150" },
    ]
  },
  {
    id: "water-tech", icon: "💧", title: "HHO & Water Engines", color: "#06b6d4", group: "ENERGY & POWER",
    desc: "Water is hydrogen and oxygen — the most abundant fuel in the universe. Split it, restructure it, or run engines on it.",
    items: [
      { title: "HHO Generator for Your Car", desc: "Electrolysis splits water into hydrogen and oxygen gas (HHO/Brown's Gas). This gas supplements your car's fuel system, reducing consumption by 15-40%. Basic cell uses stainless steel plates in water/electrolyte connected to car battery.", difficulty: "Intermediate", cost: "$50-200" },
      { title: "Stanley Meyer's Water Fuel Cell", desc: "Meyer ran a dune buggy on water alone using resonant electrolysis. His patents are public. He was offered $1 billion to shelve it, refused, and died suddenly in 1998. Multiple replicators working to reproduce results.", difficulty: "Advanced", cost: "$100-500" },
      { title: "Joe Cell — Orgone Water Fuel", desc: "Australian invention using concentric stainless steel cylinders in water, charged to create orgone energy. Claims of vehicles running on the cell's energy field without fuel connection. Highly controversial but with documented builds.", difficulty: "Advanced", cost: "$100-300" },
      { title: "Water Vortexing — Structured Water DIY", desc: "Viktor Schauberger observed water in nature moves in vortices. Running water through a vortex device restructures it. DIY: two bottles connected at the mouth, swirl vigorously. Structured water hydrates cells more efficiently.", difficulty: "Beginner", cost: "$0-30" },
      { title: "Copper Water Purification", desc: "Store water in pure copper vessels for 8+ hours. Oligodynamic effect kills 99.7% of bacteria. Ayurveda has recommended this for 5,000 years. Modern studies confirm antimicrobial action plus trace mineral supplementation.", difficulty: "Beginner", cost: "$20-40" },
    ]
  },
  // ─── COPPER & SCALAR TECH ───
  {
    id: "pyramids", icon: "🔺", title: "Copper Pyramids", color: "#f97316", group: "COPPER & SCALAR",
    desc: "The pyramid shape concentrates and amplifies energy. Build copper pyramids for meditation, plant growth, water charging, and environmental energizing.",
    items: [
      { title: "Meditation Pyramid Build Guide", desc: "Build to Giza proportions (base-to-height ratio 1.5708) using 1/2 inch copper tubing. The focused energy zone is at 1/3 height. Sit inside for deeper meditation. Align one face to magnetic north. Many report visual phenomena and accelerated healing.", difficulty: "Intermediate", cost: "$60-200" },
      { title: "Russian Pyramid Research", desc: "44-meter tall fiberglass pyramids in Russia documented: immune improvements in people nearby, reduced seismic activity, increased oil well output, and changes in water conductivity. Patrick Flanagan's research: razor blades stay sharp, food dehydrates instead of rotting.", difficulty: "Research", cost: "Free" },
      { title: "Mini Plant Growth Pyramid", desc: "Small copper pyramid over a potted plant. Plants grow 2-3x faster vs. control plants. The focused energy at 1/3 height stimulates growth. Add a quartz crystal at the apex for amplification.", difficulty: "Beginner", cost: "$15-40" },
      { title: "Nubian Pyramid — Steeper Angles", desc: "The Nubian shape (~72° angle) creates more intense energy concentration. Smaller build, stronger effect per square foot. Used for meditation, crystal charging, and water structuring.", difficulty: "Intermediate", cost: "$40-100" },
      { title: "Tensor Ring + Pyramid Combo", desc: "Place a copper tensor ring at the 1/3 height inside a copper pyramid. The combined toroidal + focused fields create what some call a 'scalar vortex' — a standing wave amplified by both geometries.", difficulty: "Intermediate", cost: "$40-80" },
    ]
  },
  {
    id: "tensor", icon: "⊙", title: "Tensor Rings", color: "#a78bfa", group: "COPPER & SCALAR",
    desc: "Copper wire twisted to sacred measurements creates a toroidal energy field with applications far wider than most realize.",
    items: [
      { title: "What Is a Tensor Ring", desc: "A closed loop of twisted copper wire cut to a sacred cubit length. Generates a toroidal (donut-shaped) field perpendicular to the ring. Measurable effects on water structure, plant growth, pain, and EMF.", difficulty: "Foundation", cost: "Free" },
      { title: "Sacred vs. Lost vs. Royal Cubit", desc: "Sacred Cubit (20.6\"): King's Chamber measurement, best for physical healing. Lost Cubit (23.49\"): etheric resonance. Royal Cubit (28.1\"): Queen's Chamber. Each creates different frequencies.", difficulty: "Foundation", cost: "Free" },
      { title: "DIY Build — Step by Step", desc: "12-gauge solid copper wire. Cut to cubit length. Fold in half. Twist evenly (use a drill). Join ends by twisting/soldering. Test: hold over your palm and feel the subtle energy field.", difficulty: "Beginner", cost: "$5-10" },
      { title: "Water Structuring with Tensor Rings", desc: "Glass of water inside a tensor ring for 20-60 minutes. Measurable changes: lower surface tension, altered pH, different crystal formations. Most people can taste the difference blindfolded.", difficulty: "Beginner", cost: "$5-10" },
      { title: "Pain Relief Applications", desc: "Place directly over area of pain/inflammation. Many report immediate reduction in acute pain. Theory: tensor field restores coherent energy flow, reducing electromagnetic chaos that accompanies injury.", difficulty: "Beginner", cost: "$5-10" },
      { title: "Home EMF Neutralization", desc: "Hang on WiFi router, smart meter, or electrical panel. Place rings in four corners of your room. Many report better sleep, reduced headaches, calmer pets.", difficulty: "Beginner", cost: "$20-40" },
    ]
  },
  // ─── GARDEN & FOOD ───
  {
    id: "electroculture", icon: "🌱", title: "Electroculture & Garden", color: "#22c55e", group: "FOOD SOVEREIGNTY",
    desc: "Use copper, magnetism, and electromagnetic principles to supercharge plant growth without chemicals.",
    items: [
      { title: "Copper Coil Garden Beds", desc: "Wrap 12-gauge solid copper wire around raised beds in a spiral. Creates a weak electromagnetic field that interacts with Earth's field and plant biofields. Documented: faster germination, stronger roots, larger yields. Rodin coil pattern most effective.", difficulty: "Beginner", cost: "$15-40" },
      { title: "Electroculture Antennas", desc: "Copper spiral on a wooden dowel placed in garden beds. Directs atmospheric energy into soil. Farmers in the 1700s-1800s used this before chemical fertilizers made it unprofitable to teach.", difficulty: "Beginner", cost: "$5-10" },
      { title: "Tensor Ring Plant Experiments", desc: "Sacred cubit tensor ring around plant base or hung above. Documented: accelerated growth, increased brix content, pest resistance.", difficulty: "Beginner", cost: "$10-25" },
      { title: "Magnetoculture", desc: "Neodymium magnets in a grid pattern under garden beds. Research from Russia and India: 15-30% yield increases. North pole facing up for growth stimulation.", difficulty: "Intermediate", cost: "$20-50" },
      { title: "Paramagnetic Rock Dust", desc: "Basalt rock dust amplifies Earth's magnetic field locally. Philip Callahan proved the connection between soil paramagnetism and crop vitality.", difficulty: "Beginner", cost: "$15-30" },
    ]
  },
  // ─── LAND & FREEDOM ───
  {
    id: "land", icon: "🏡", title: "Owner Financing & Land", color: "#22c55e", group: "SOVEREIGNTY",
    desc: "You don't need a bank to own land. Creative acquisition strategies that bypass the banking system.",
    items: [
      { title: "Owner Financing 101", desc: "The seller IS the bank. Monthly payments direct to landowner. No credit check. No bank approval. No 30-year interest trap. Search 'owner financing' on LandWatch, Zillow, Craigslist.", difficulty: "Beginner", cost: "Varies" },
      { title: "Contract for Deed", desc: "Seller keeps the deed until paid in full, but you have possession immediately. Lower barrier than traditional purchase. Get it notarized and recorded at county clerk.", difficulty: "Beginner", cost: "Varies" },
      { title: "Tax Lien & Tax Deed Sales", desc: "When owners don't pay taxes, the county auctions the lien or property. Properties sell for $500-5,000 worth 10-50x that. Research your county's tax sale schedule.", difficulty: "Intermediate", cost: "$200+" },
      { title: "Raw Land Strategy", desc: "Raw land (no structures/utilities) is cheapest. Many parcels in the American West/South sell for $1,000-10,000 for 5+ acres with owner financing. Add yurt/tiny home, build solar and well over time.", difficulty: "Beginner", cost: "$1,000-10,000" },
      { title: "Off-Grid Land Checklist", desc: "Water access, solar exposure, road access (legal easement), zoning, soil quality, slope/drainage, county building codes. The freer the county, the freer you are.", difficulty: "Research", cost: "Free" },
      { title: "Adverse Possession", desc: "In many states, openly occupying unused land for 7-20 years qualifies you for legal ownership. Real law — not a loophole. Requirements: continuous, open, exclusive use + paying taxes.", difficulty: "Advanced", cost: "Minimal" },
    ]
  },
  {
    id: "sovereign", icon: "🏛️", title: "Sovereign Citizen & Strawman", color: "#ef4444", group: "SOVEREIGNTY",
    desc: "Understanding your legal status, the corporate government structure, and the difference between a citizen and a sovereign individual.",
    items: [
      { title: "The Strawman Account", desc: "Birth certificate created your name in ALL CAPS (e.g., JOHN DOE) — a legal fiction, a corporate entity separate from you. This 'strawman' is bonded and traded. Understanding the distinction between you (living being) and the legal fiction is the foundation.", difficulty: "Foundation", cost: "Free" },
      { title: "UCC-1 Filing", desc: "A UCC-1 financing statement establishes you as the secured party creditor over your strawman entity. Filed at the state level. Asserts you are the creditor, not the debtor.", difficulty: "Advanced", cost: "$50-200" },
      { title: "Citizen vs. National", desc: "'US Citizen' = subject of the federal corporation (United States Inc., incorporated 1871). 'State National' = living man/woman under the original Constitution. Changes your legal standing, tax obligations, and relationship to government.", difficulty: "Intermediate", cost: "Free" },
      { title: "The Federal Reserve & Your Debt", desc: "In 1933, US went bankrupt and off gold standard. Citizens became collateral. Your birth certificate is a bond pledging your future labor. Social Security is the tracking mechanism.", difficulty: "Foundation", cost: "Free" },
      { title: "Common Law vs. Admiralty Law", desc: "Common Law (land): sovereign unless you harm another. Maritime/Admiralty Law (commerce): corporate entity subject to statutes and codes. Most courtrooms operate in admiralty. Gold-fringed flag is the indicator.", difficulty: "Intermediate", cost: "Free" },
      { title: "Practical Steps", desc: "Revoke voter registration. Get passport. File UCC-1. Create affidavit of sovereignty. Establish private trust. Complex legal area — study thoroughly, connect with experienced practitioners.", difficulty: "Advanced", cost: "Varies" },
    ]
  },
  // ─── MIND & MANIFESTATION ───
  {
    id: "mind", icon: "🧠", title: "Mind Hacks & Reprogramming", color: "#ec4899", group: "MIND & MANIFESTATION",
    desc: "Your subconscious runs 95% of your life. These techniques reprogram it.",
    items: [
      { title: "SATS — State Akin to Sleep", desc: "Neville Goddard's technique: as you're falling asleep (hypnagogic state), replay a short scene that implies your wish fulfilled. Feel it as real. Your subconscious cannot distinguish this from reality and begins reorganizing your world to match. Do it nightly.", difficulty: "Beginner", cost: "Free" },
      { title: "Subliminal Reprogramming", desc: "Play subliminal audio (affirmations below conscious hearing threshold) while sleeping. Your conscious mind can't filter or reject what it can't hear, but your subconscious absorbs it. 21-90 days of consistent use for measurable change.", difficulty: "Beginner", cost: "Free" },
      { title: "Mirror Work — Louise Hay Method", desc: "Look into your own eyes in a mirror and repeat affirmations for 5 minutes daily. This triggers the deepest resistance your ego has — and breaks through it. 'I love and approve of myself' is the foundational statement.", difficulty: "Beginner", cost: "Free" },
      { title: "Theta Brainwave Programming", desc: "Use binaural beats (4-8Hz) to drop into theta state while awake. In theta, the subconscious is directly accessible. Combine with visualization and affirmations for rapid reprogramming.", difficulty: "Intermediate", cost: "Free" },
      { title: "Ho'oponopono — Hawaiian Clearing", desc: "Four phrases repeated internally toward any problem, person, or situation: 'I'm sorry. Please forgive me. Thank you. I love you.' Clears the subconscious data (memories) that create your experienced reality.", difficulty: "Beginner", cost: "Free" },
      { title: "Reality Transurfing — Vadim Zeland", desc: "Russian quantum physicist's framework: reality exists as a space of variations. Your emotional energy selects which variation you experience. Reduce importance (emotional charge) around desires to allow them to manifest without resistance.", difficulty: "Intermediate", cost: "Free" },
    ]
  },
  {
    id: "money", icon: "💰", title: "Financial Freedom Hacks", color: "#eab308", group: "SOVEREIGNTY",
    desc: "The money system is designed to keep you working. These strategies help you exit the debt matrix.",
    items: [
      { title: "Fractional Reserve Banking — How Money Is Created", desc: "Banks create money from nothing when they issue loans. For every $1 deposited, they can lend $9-10 that didn't exist before. You work for money that was typed into existence. Understanding this changes everything about how you view debt.", difficulty: "Foundation", cost: "Free" },
      { title: "Debt Elimination Strategies", desc: "Avalanche method: pay highest interest first. Snowball method: pay smallest balance first. But the real hack: stop acquiring debt. Live below your means. Every dollar of debt is a chain. Cut them.", difficulty: "Beginner", cost: "Free" },
      { title: "Barter & Trade Networks", desc: "Join or create local barter networks. Trade skills, products, and labor without using currency. No taxes on barter in many jurisdictions (verify locally). Time banks, skill shares, and mutual aid networks are growing.", difficulty: "Beginner", cost: "Free" },
      { title: "Precious Metals — Real Money", desc: "Gold and silver are the only constitutional money. FRNs (Federal Reserve Notes) are debt instruments, not money. Stack physical silver and gold as a hedge against currency devaluation. $25/month in silver adds up.", difficulty: "Beginner", cost: "$25+/month" },
      { title: "Multiple Income Streams", desc: "One job = one point of failure. Build 3-7 income streams: freelance skills, digital products, rental income, dividends, content creation, affiliate income, physical products. Financial freedom isn't about earning more — it's about earning from more sources.", difficulty: "Intermediate", cost: "Varies" },
    ]
  },
];

function RealityHacksSection() {
  const [activeCat, setActiveCat] = useState(null);
  const [expandedItem, setExpandedItem] = useState(null);
  const [savedHacks, setSavedHacks] = useState(new Set());
  const [searchTerm, setSearchTerm] = useState("");

  const toggleSave = (id) => { setSavedHacks(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; }); };
  const totalItems = HACK_CATEGORIES.reduce((a, c) => a + c.items.length, 0);

  const searchResults = searchTerm ? HACK_CATEGORIES.flatMap(cat =>
    cat.items.filter(item => item.title.toLowerCase().includes(searchTerm.toLowerCase()) || item.desc.toLowerCase().includes(searchTerm.toLowerCase()))
      .map(item => ({ ...item, cat }))
  ) : [];

  if (activeCat) {
    const cat = HACK_CATEGORIES.find(c => c.id === activeCat);
    return (
      <div style={{ animation: "fadeInUp 0.4s ease" }}>
        <button onClick={() => { setActiveCat(null); setExpandedItem(null); }} style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)", color: "var(--text-muted)", padding: "8px 18px", borderRadius: 8, cursor: "pointer", fontSize: 11, letterSpacing: 2, fontFamily: "'Orbitron', sans-serif", marginBottom: 24 }}>← BACK TO REALITY HACKS</button>

        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 20 }}>
          <span style={{ fontSize: 40 }}>{cat.icon}</span>
          <div>
            <h2 style={{ fontSize: 22, fontWeight: 600, color: "var(--text)", fontFamily: "'Orbitron', sans-serif", margin: 0, letterSpacing: 1 }}>{cat.title}</h2>
            <p style={{ fontSize: 12, color: "var(--text-faint)", marginTop: 4 }}>{cat.items.length} hacks</p>
          </div>
        </div>
        <p style={{ fontSize: 13, color: "var(--text-faint)", lineHeight: 1.8, marginBottom: 28, maxWidth: 650 }}>{cat.desc}</p>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {cat.items.map((item, idx) => {
            const itemId = `${cat.id}-${idx}`;
            const isExpanded = expandedItem === itemId;
            return (
              <GlassCard key={idx} onClick={() => setExpandedItem(isExpanded ? null : itemId)} style={{ borderLeft: `3px solid ${cat.color}`, cursor: "pointer" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                  <h3 style={{ fontSize: 15, fontWeight: 600, color: "var(--text)", margin: 0, fontFamily: "'Sora', sans-serif" }}>{item.title}</h3>
                  <div style={{ display: "flex", gap: 8, flexShrink: 0, marginLeft: 12 }}>
                    {item.difficulty && <span style={{ fontSize: 9, padding: "3px 10px", borderRadius: 6, background: item.difficulty === "Beginner" ? "rgba(34,197,94,0.1)" : item.difficulty === "Intermediate" ? "rgba(234,179,8,0.1)" : item.difficulty === "Advanced" ? "rgba(239,68,68,0.1)" : "rgba(6,182,212,0.1)", color: item.difficulty === "Beginner" ? "#22c55e" : item.difficulty === "Intermediate" ? "#eab308" : item.difficulty === "Advanced" ? "#ef4444" : "#06b6d4", letterSpacing: 1, fontFamily: "'Orbitron', sans-serif" }}>{item.difficulty.toUpperCase()}</span>}
                  </div>
                </div>
                <p style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.8, margin: 0 }}>{isExpanded ? item.desc : item.desc.substring(0, 150) + "..."}</p>
                {isExpanded && (
                  <div style={{ marginTop: 16, display: "flex", gap: 10, alignItems: "center", animation: "fadeInUp 0.3s ease" }}>
                    {item.cost && <span style={{ fontSize: 11, color: cat.color, fontFamily: "'JetBrains Mono', monospace" }}>COST: {item.cost}</span>}
                    <div style={{ flex: 1 }} />
                    <button onClick={(e) => { e.stopPropagation(); toggleSave(itemId); }} style={{ padding: "6px 14px", borderRadius: 6, background: savedHacks.has(itemId) ? `${cat.color}15` : "rgba(255,255,255,0.03)", border: `1px solid ${savedHacks.has(itemId) ? `${cat.color}35` : "rgba(255,255,255,0.06)"}`, color: savedHacks.has(itemId) ? cat.color : "rgba(255,255,255,0.3)", cursor: "pointer", fontSize: 10, letterSpacing: 1, fontFamily: "'Orbitron', sans-serif" }}>{savedHacks.has(itemId) ? "★ SAVED" : "☆ SAVE"}</button>
                  </div>
                )}
              </GlassCard>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div style={{ animation: "fadeInUp 0.5s ease" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
        <div style={{ width: 3, height: 28, background: "linear-gradient(to bottom, #eab308, #22c55e, #ef4444)", borderRadius: 2 }} />
        <h2 style={{ fontSize: 22, fontWeight: 300, color: "var(--text)", fontFamily: "'Sora', sans-serif", margin: 0 }}>REALITY HACKS</h2>
      </div>
      <p style={{ fontSize: 14, color: "var(--text-faint)", lineHeight: 1.8, marginTop: 8, marginBottom: 8 }}>
        {totalItems} practical hacks across {HACK_CATEGORIES.length} categories. Off-grid technology, free energy, food sovereignty, land ownership, and legal standing. The cheat codes for reality.
      </p>
      <p style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.7, marginBottom: 28 }}>
        These are practical, buildable, actionable. Most cost under $100. Some cost nothing. All of them reduce your dependence on systems designed to keep you dependent.
      </p>

      <input value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="Search hacks... (copper coil, earth battery, tensor ring, owner financing...)"
        style={{ width: "100%", background: "var(--card-bg)", border: "1px solid var(--card-border)", borderRadius: 10, padding: "14px 20px", color: "var(--text)", fontSize: 13, outline: "none", fontFamily: "'JetBrains Mono', monospace", marginBottom: 20 }} />

      {searchTerm && searchResults.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <span style={{ fontSize: 10, color: "var(--text-faint)", letterSpacing: 2 }}>{searchResults.length} RESULTS</span>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
            {searchResults.slice(0, 6).map((item, i) => (
              <GlassCard key={i} onClick={() => setActiveCat(item.cat.id)} style={{ padding: 16, cursor: "pointer", borderLeft: `3px solid ${item.cat.color}` }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>{item.title}</span>
                  <span style={{ fontSize: 10, color: item.cat.color }}>{item.cat.icon} {item.cat.title}</span>
                </div>
                <p style={{ fontSize: 12, color: "var(--text-faint)", margin: "6px 0 0", lineHeight: 1.5 }}>{item.desc.substring(0, 120)}...</p>
              </GlassCard>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 14, marginBottom: 32, flexWrap: "wrap" }}>
        {[
          { label: "Total Hacks", value: totalItems, color: "#00ff8c" },
          { label: "Categories", value: HACK_CATEGORIES.length, color: "#eab308" },
          { label: "DIY Builds", value: HACK_CATEGORIES.reduce((a, c) => a + c.items.filter(i => i.difficulty === "Beginner" || i.difficulty === "Intermediate").length, 0), color: "#06b6d4" },
          { label: "Saved", value: savedHacks.size, color: "#a78bfa" },
        ].map(s => (
          <div key={s.label} style={{ flex: "1 1 130px", padding: "18px 20px", borderRadius: 12, textAlign: "center", background: `linear-gradient(135deg, ${s.color}08, ${s.color}03)`, border: `1px solid ${s.color}15`, boxShadow: `0 4px 20px ${s.color}08, inset 0 1px 0 rgba(255,255,255,0.03)` }}>
            <div style={{ fontSize: 24, fontWeight: 700, color: s.color, fontFamily: "'Orbitron', sans-serif", textShadow: `0 0 20px ${s.color}30` }}>{s.value}</div>
            <div style={{ fontSize: 9, color: "var(--text-faint)", letterSpacing: 2, textTransform: "uppercase", marginTop: 6, fontFamily: "'Sora', sans-serif", fontWeight: 500 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Category Grid — Grouped */}
      {[...new Set(HACK_CATEGORIES.map(c => c.group))].map(group => (
        <div key={group} style={{ marginBottom: 28 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
            <div style={{ flex: 1, height: 1, background: "var(--card-bg)" }} />
            <span style={{ fontSize: 10, letterSpacing: 4, color: "var(--text-dim)", fontFamily: "'Orbitron', sans-serif" }}>{group}</span>
            <div style={{ flex: 1, height: 1, background: "var(--card-bg)" }} />
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
            {HACK_CATEGORIES.filter(c => c.group === group).map(cat => (
              <GlassCard key={cat.id} onClick={() => setActiveCat(cat.id)} style={{ flex: "1 1 280px", minWidth: 260, cursor: "pointer", borderTop: `2px solid ${cat.color}40` }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 12 }}>
                  <span style={{ fontSize: 30 }}>{cat.icon}</span>
                  <span style={{ fontSize: 10, color: cat.color, fontFamily: "'JetBrains Mono', monospace", letterSpacing: 1, background: `${cat.color}12`, padding: "3px 10px", borderRadius: 6 }}>{cat.items.length} HACKS</span>
                </div>
                <h3 style={{ fontSize: 15, fontWeight: 600, color: "var(--text)", fontFamily: "'Orbitron', sans-serif", margin: "0 0 6px", letterSpacing: 1 }}>{cat.title}</h3>
                <p style={{ fontSize: 11, color: "var(--text-faint)", lineHeight: 1.7, margin: "0 0 12px" }}>{cat.desc.substring(0, 100)}...</p>
                <span style={{ fontSize: 10, color: cat.color, letterSpacing: 3, fontFamily: "'Orbitron', sans-serif", fontWeight: 600, textShadow: `0 0 10px ${cat.color}30` }}>ENTER →</span>
              </GlassCard>
            ))}
          </div>
        </div>
      ))}

      <div style={{ marginTop: 32, padding: 24, borderRadius: 14, background: "linear-gradient(135deg, rgba(234,179,8,0.05), rgba(34,197,94,0.05))", border: "1px solid rgba(234,179,8,0.08)", textAlign: "center" }}>
        <p style={{ fontSize: 13, color: "var(--text-faint)", lineHeight: 1.8, margin: "0 0 4px" }}>
          "The best way to predict the future is to create it."
        </p>
        <span style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "'JetBrains Mono', monospace" }}>— Abraham Lincoln</span>
      </div>

      <div style={{ marginTop: 16, padding: 16, borderRadius: 10, background: "var(--card-bg)", border: "1px solid var(--card-border)", textAlign: "center" }}>
        <p style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "'JetBrains Mono', monospace", margin: 0 }}>
          Information is for educational and research purposes. Verify legality in your jurisdiction. Exercise discernment with all sovereignty-related filings.
        </p>
      </div>
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════
// VIBE SHOP — Marketplace
// ═══════════════════════════════════════════════════════════════

const SHOP_CATEGORIES = [
  { id: "emf", name: "EMF Protection", icon: "🛡️", color: "#06b6d4" },
  { id: "crystals", name: "Crystals & Stones", icon: "💎", color: "#a78bfa" },
  { id: "orgonite", name: "Orgonite & Pyramids", icon: "🔺", color: "#eab308" },
  { id: "copper", name: "Copper Tools", icon: "⚡", color: "#f97316" },
  { id: "sacred", name: "Sacred Geometry", icon: "✡", color: "#ec4899" },
  { id: "herbs", name: "Herbs & Tinctures", icon: "🌿", color: "#22c55e" },
  { id: "water", name: "Water Tech", icon: "💧", color: "#38bdf8" },
  { id: "sound", name: "Sound & Frequency", icon: "🔔", color: "#f472b6" },
  { id: "clothing", name: "Conscious Clothing", icon: "👕", color: "#a3e635" },
  { id: "member", name: "Member Marketplace", icon: "⊛", color: "#00ff8c" },
];

const SHOP_PRODUCTS = [
  // EMF Protection
  { id: 1, cat: "emf", name: "BluShield Tesla Gold Series", price: 499, origPrice: 599, rating: 4.9, reviews: 342, seller: "BluShield Official", verified: true, badge: "BESTSELLER", image: "🛡️", desc: "Portable scalar wave EMF protection. Generates a coherent field that helps your body resist non-native electromagnetic frequencies. Uses Tesla-inspired multi-wave technology.", tags: ["SCALAR", "PORTABLE", "TESLA"] },
  { id: 2, cat: "emf", name: "BluShield Plug-In Home Unit", price: 699, rating: 4.8, reviews: 218, seller: "BluShield Official", verified: true, image: "🏠", desc: "Whole-home EMF protection covering up to 90m radius. Plugs directly into any outlet. Creates a coherent scalar field throughout your living space.", tags: ["HOME", "SCALAR", "PLUG-IN"] },
  { id: 3, cat: "emf", name: "Shungite Phone Plate (Set of 4)", price: 24, rating: 4.6, reviews: 891, seller: "Earth Shields Co", verified: true, image: "📱", desc: "Genuine Karelian shungite phone plates. Shungite contains fullerenes — the only known natural source of C60. Adheres to any phone case.", tags: ["SHUNGITE", "PHONE", "C60"] },
  { id: 4, cat: "emf", name: "Faraday Cage Phone Pouch", price: 35, rating: 4.7, reviews: 456, seller: "SignalBlock", verified: true, image: "📴", desc: "Military-grade EMF blocking pouch. Blocks 99.9% of RF signals including 5G, WiFi, Bluetooth. Stops all tracking when phone is inside.", tags: ["FARADAY", "PRIVACY", "5G"] },

  // Crystals
  { id: 5, cat: "crystals", name: "Amethyst Cathedral Geode (Large)", price: 189, rating: 4.9, reviews: 167, seller: "Crystal Haven", verified: true, badge: "FEATURED", image: "💜", desc: "Hand-selected Brazilian amethyst cathedral. 8-12 inches tall. Crown chakra activation, intuition enhancement, and EMF absorption. Each piece is unique.", tags: ["AMETHYST", "GEODE", "CROWN CHAKRA"] },
  { id: 6, cat: "crystals", name: "Black Tourmaline Raw Chunks (1 lb)", price: 28, rating: 4.8, reviews: 723, seller: "Crystal Haven", verified: true, image: "🖤", desc: "Raw black tourmaline — the ultimate grounding and protection stone. Place near electronics, at doorways, or carry in your pocket. Absorbs negative energy.", tags: ["TOURMALINE", "PROTECTION", "GROUNDING"] },
  { id: 7, cat: "crystals", name: "Moldavite Pendant (Authentic Czech)", price: 145, origPrice: 189, rating: 4.7, reviews: 89, seller: "StarSeed Gems", verified: true, badge: "RARE", image: "💚", desc: "Genuine Czech moldavite — formed 15 million years ago from a meteorite impact. Known as the stone of transformation. Certificate of authenticity included.", tags: ["MOLDAVITE", "TRANSFORMATION", "METEORITE"] },
  { id: 8, cat: "crystals", name: "Rose Quartz Heart (Polished)", price: 22, rating: 4.9, reviews: 1245, seller: "Crystal Haven", verified: true, image: "💗", desc: "Hand-polished rose quartz heart. The stone of unconditional love. Opens and heals the heart chakra. Perfect for meditation or gifting.", tags: ["ROSE QUARTZ", "HEART", "LOVE"] },
  { id: 9, cat: "crystals", name: "7 Chakra Crystal Set (Boxed)", price: 39, rating: 4.8, reviews: 567, seller: "Chakra Works", verified: true, image: "🌈", desc: "Complete set: Red Jasper, Carnelian, Citrine, Green Aventurine, Lapis Lazuli, Amethyst, Clear Quartz. Includes velvet pouch and chakra guide.", tags: ["CHAKRA SET", "COMPLETE", "GIFT"] },
  { id: 10, cat: "crystals", name: "Selenite Charging Plate", price: 32, rating: 4.7, reviews: 334, seller: "Crystal Haven", verified: true, image: "🤍", desc: "Large selenite slab for cleansing and charging other crystals. Also clears energy in any room. Self-cleansing — never needs recharging itself.", tags: ["SELENITE", "CHARGING", "CLEANSING"] },

  // Orgonite
  { id: 11, cat: "orgonite", name: "Large Orgonite Pyramid — 7 Chakra", price: 89, rating: 4.8, reviews: 203, seller: "Orgone Energy Works", verified: true, badge: "HANDMADE", image: "🔺", desc: "6-inch orgonite pyramid with copper coils, 7 chakra crystals, iron shavings, and gold leaf. Converts stagnant orgone (DOR) to positive orgone (POR). Handcrafted.", tags: ["ORGONITE", "PYRAMID", "HANDMADE"] },
  { id: 12, cat: "orgonite", name: "Orgonite Tower Buster (Set of 6)", price: 45, rating: 4.7, reviews: 412, seller: "Orgone Energy Works", verified: true, image: "⬡", desc: "Place near cell towers, smart meters, and WiFi routers. Aluminum shavings + quartz + resin. The original Wilhelm Reich-inspired design.", tags: ["TOWER BUSTER", "EMF", "SET"] },
  { id: 13, cat: "orgonite", name: "HHG Holy Hand Grenade Orgonite", price: 55, rating: 4.6, reviews: 178, seller: "Gifters Guild", verified: true, image: "🌀", desc: "5 double-terminated quartz crystals in copper-coil orgonite cone. Designed for outdoor gifting near cell towers. Powerful DOR-to-POR converter.", tags: ["HHG", "GIFTING", "QUARTZ"] },

  // Copper
  { id: 14, cat: "copper", name: "Pure Copper Water Bottle (900ml)", price: 38, rating: 4.9, reviews: 892, seller: "Ayur Copper Co", verified: true, badge: "BESTSELLER", image: "🫗", desc: "100% pure copper. Store water overnight for oligodynamic purification. Ayurvedic tradition for 5,000 years. Kills bacteria, balances pH, provides copper ions.", tags: ["COPPER", "WATER", "AYURVEDIC"] },
  { id: 15, cat: "copper", name: "Copper Moscow Mule Mugs (Set of 4)", price: 45, rating: 4.8, reviews: 634, seller: "Ayur Copper Co", verified: true, image: "🍶", desc: "Handcrafted 16oz pure copper mugs. Food-grade lacquer-free interior for maximum copper ion transfer. Beautiful hammered finish.", tags: ["MUGS", "COPPER", "HANDCRAFTED"] },
  { id: 16, cat: "copper", name: "Copper Bracelet — Magnetic Therapy", price: 24, origPrice: 35, rating: 4.7, reviews: 1456, seller: "Healing Metals", verified: true, image: "⭕", desc: "Pure copper bracelet with embedded magnets. Delivers trace copper through skin. Used for joint pain, inflammation, and biofield support. Adjustable fit.", tags: ["BRACELET", "MAGNETIC", "JOINT PAIN"] },
  { id: 17, cat: "copper", name: "Copper Tensor Ring — Sacred Cubit", price: 42, rating: 4.8, reviews: 234, seller: "Sacred Metals Lab", verified: true, badge: "HANDMADE", image: "⊙", desc: "Hand-twisted copper tensor ring using the Sacred Cubit measurement (20.6 inches). Creates a toroidal energy field. Place around water, plants, or on body.", tags: ["TENSOR RING", "SACRED CUBIT", "TOROIDAL"] },
  { id: 18, cat: "copper", name: "Copper Grounding Rod (4ft)", price: 29, rating: 4.6, reviews: 156, seller: "Earth Connect", verified: true, image: "📍", desc: "Solid copper grounding rod with 15ft wire and alligator clip. Connect to your grounding sheet or pad. Pure copper for maximum electron transfer from Earth.", tags: ["GROUNDING", "EARTHING", "ROD"] },

  // Sacred Geometry
  { id: 19, cat: "sacred", name: "Flower of Life Wall Art (Wood)", price: 65, rating: 4.9, reviews: 289, seller: "Sacred Forms Studio", verified: true, badge: "ARTISAN", image: "❀", desc: "Laser-cut walnut Flower of Life. 18 inches diameter. The fundamental pattern of creation found in temples worldwide. Raises the vibration of any room.", tags: ["FLOWER OF LIFE", "WOOD", "WALL ART"] },
  { id: 20, cat: "sacred", name: "Metatron's Cube Crystal Grid", price: 48, rating: 4.8, reviews: 167, seller: "Sacred Forms Studio", verified: true, image: "✡", desc: "Etched selenite crystal grid board with Metatron's Cube pattern. 10 inches. Amplifies crystal layouts for manifestation, healing, and meditation.", tags: ["METATRON", "CRYSTAL GRID", "SELENITE"] },
  { id: 21, cat: "sacred", name: "Sri Yantra Copper Meditation Disc", price: 55, rating: 4.9, reviews: 123, seller: "Sacred Metals Lab", verified: true, image: "🔯", desc: "Hand-etched Sri Yantra on pure copper disc. 6 inches. The most powerful sacred geometry symbol — represents the creation of the universe. Meditation focal point.", tags: ["SRI YANTRA", "COPPER", "MEDITATION"] },

  // Herbs & Tinctures
  { id: 22, cat: "herbs", name: "Blue Lotus Flower (Whole, 1oz)", price: 28, rating: 4.7, reviews: 345, seller: "Ancient Remedies", verified: true, image: "🪷", desc: "Nymphaea caerulea — the sacred flower of Egypt. Used for lucid dreaming, deep relaxation, and opening the third eye. Brew as tea or smoke.", tags: ["BLUE LOTUS", "DREAMING", "EGYPTIAN"] },
  { id: 23, cat: "herbs", name: "Chaga Mushroom Tincture (Double Extract)", price: 35, rating: 4.9, reviews: 567, seller: "Forest Fungi Co", verified: true, badge: "ORGANIC", image: "🍄", desc: "Wild-harvested Siberian chaga. Dual water/alcohol extraction for full spectrum of betulinic acid and polysaccharides. The most antioxidant-dense substance on Earth.", tags: ["CHAGA", "MUSHROOM", "ANTIOXIDANT"] },
  { id: 24, cat: "herbs", name: "Sea Moss Gel (Wildcrafted, 16oz)", price: 32, rating: 4.8, reviews: 1890, seller: "Ocean Minerals", verified: true, badge: "BESTSELLER", image: "🌊", desc: "92 of 102 minerals your body needs in one food. Wildcrafted from the Caribbean. Thyroid support, gut healing, skin glow. Dr. Sebi's #1 recommendation.", tags: ["SEA MOSS", "92 MINERALS", "DR SEBI"] },
  { id: 25, cat: "herbs", name: "Shilajit Resin (Pure Himalayan, 30g)", price: 45, rating: 4.8, reviews: 678, seller: "Mountain Source", verified: true, image: "🏔️", desc: "Purified Himalayan shilajit resin. 85+ minerals in ionic form, fulvic acid for cellular absorption. Ancient Ayurvedic 'destroyer of weakness.' Testosterone & energy.", tags: ["SHILAJIT", "MINERALS", "FULVIC ACID"] },

  // Water Tech
  { id: 26, cat: "water", name: "Berkey Water Filter System", price: 349, rating: 4.9, reviews: 2345, seller: "Pure Water Direct", verified: true, badge: "ESSENTIAL", image: "🚰", desc: "Gravity-fed filtration removes fluoride, chlorine, heavy metals, pharmaceuticals, bacteria, and viruses. No electricity needed. Lasts 6,000 gallons per filter set.", tags: ["BERKEY", "FLUORIDE", "GRAVITY"] },
  { id: 27, cat: "water", name: "Structured Water Device — Portable", price: 89, rating: 4.6, reviews: 234, seller: "Vortex Water Tech", verified: true, image: "🌀", desc: "Vortex-based water structuring unit. Attaches to any bottle. Creates hexagonal (EZ) water through vortex motion. Based on Viktor Schauberger's research.", tags: ["STRUCTURED", "VORTEX", "EZ WATER"] },
  { id: 28, cat: "water", name: "Hydrogen Water Bottle (SPE/PEM)", price: 65, rating: 4.7, reviews: 456, seller: "H2 Life", verified: true, image: "⚗️", desc: "Generates molecular hydrogen (H2) in your water via electrolysis. H2 is the smallest antioxidant — penetrates every cell including the brain. 1000+ published studies.", tags: ["HYDROGEN", "H2", "ANTIOXIDANT"] },

  // Sound & Frequency
  { id: 29, cat: "sound", name: "432Hz Tuning Fork Set (7 Chakra)", price: 79, rating: 4.9, reviews: 189, seller: "Sound Temple", verified: true, badge: "HANDCRAFTED", image: "🎵", desc: "7 medical-grade aluminum tuning forks calibrated to 432Hz chakra frequencies. Includes mallet and velvet roll case. For sound healing, meditation, and biofield tuning.", tags: ["432HZ", "TUNING FORK", "CHAKRA"] },
  { id: 30, cat: "sound", name: "Tibetan Singing Bowl (Hand-Hammered)", price: 65, rating: 4.9, reviews: 567, seller: "Nepal Imports", verified: true, image: "🔔", desc: "Authentic hand-hammered Tibetan singing bowl from Nepal. 5-inch. Produces rich overtones for meditation, space clearing, and chakra balancing. Includes cushion and mallet.", tags: ["SINGING BOWL", "TIBETAN", "HANDMADE"] },
  { id: 31, cat: "sound", name: "528Hz Solfeggio Tuning Fork", price: 28, rating: 4.8, reviews: 890, seller: "Sound Temple", verified: true, image: "〰️", desc: "The 'Love Frequency' — 528Hz. Used for DNA repair, heart opening, and transformation. Medical-grade weighted tuning fork with silicone foot for body application.", tags: ["528HZ", "SOLFEGGIO", "DNA REPAIR"] },

  // Conscious Clothing
  { id: 32, cat: "clothing", name: "Organic Hemp Hoodie — 'FREQUENCY'", price: 75, rating: 4.8, reviews: 234, seller: "Conscious Threads", verified: true, image: "🧥", desc: "100% organic hemp/cotton blend. Naturally antimicrobial, UV-resistant, and gets softer with each wash. 'FREQUENCY' design in sacred geometry print.", tags: ["HEMP", "ORGANIC", "FREQUENCY"] },
  { id: 33, cat: "clothing", name: "Shungite Necklace — EMF Shield", price: 42, rating: 4.7, reviews: 345, seller: "Earth Shields Co", verified: true, image: "📿", desc: "Genuine Karelian shungite pendant on adjustable cord. Worn over the heart chakra for EMF protection and biofield coherence. Contains natural fullerenes.", tags: ["SHUNGITE", "NECKLACE", "EMF"] },

  // Member Marketplace
  { id: 34, cat: "member", name: "Handmade Orgonite Pendant — @Sage", price: 35, rating: 5.0, reviews: 23, seller: "Sage", memberSeller: true, image: "🌿", desc: "Made by TH3 AWAR3N3SS member @sage.flow. Each pendant contains copper shavings, clear quartz point, and resin. Infused with Reiki energy during curing. One of a kind.", tags: ["MEMBER MADE", "ORGONITE", "REIKI"] },
  { id: 35, cat: "member", name: "Crystal-Infused Candles — @Luna", price: 28, rating: 4.9, reviews: 45, seller: "Luna", memberSeller: true, image: "🕯️", desc: "Soy wax candles with embedded crystals and essential oils. Each candle is intention-set during a full moon ceremony. Scents: Lavender Dream, Cedar Grounding, Rose Heart.", tags: ["MEMBER MADE", "CANDLES", "CRYSTALS"] },
  { id: 36, cat: "member", name: "Sacred Geometry Prints — @Orion", price: 22, rating: 5.0, reviews: 67, seller: "Orion", memberSeller: true, image: "🎨", desc: "Digital art prints on archival paper. Metatron's Cube, Flower of Life, Sri Yantra, and custom designs. Created during deep meditation states. 11x14 inches.", tags: ["MEMBER MADE", "ART", "PRINTS"] },
  { id: 37, cat: "member", name: "Herbal Smoke Blend — @Zenith", price: 18, rating: 4.8, reviews: 89, seller: "Zenith", memberSeller: true, image: "🌬️", desc: "Hand-blended mullein, lavender, damiana, and blue lotus. Organic, no tobacco, no additives. For relaxation and ceremonial use. Crafted by @zenith_33.", tags: ["MEMBER MADE", "HERBAL", "SMOKE BLEND"] },
  { id: 38, cat: "member", name: "Copper Wire Tree of Life — @Kael", price: 95, rating: 5.0, reviews: 12, seller: "Kael", memberSeller: true, badge: "ARTISAN", image: "🌳", desc: "Hand-twisted pure copper Tree of Life sculpture with genuine crystal leaves (amethyst, citrine, rose quartz). 12 inches tall. Each one takes 8+ hours to create.", tags: ["MEMBER MADE", "COPPER", "SCULPTURE"] },
];

function VibeShop() {
  const [activeCat, setActiveCat] = useState("all");
  const [cart, setCart] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [sortBy, setSortBy] = useState("featured");
  const [showCart, setShowCart] = useState(false);
  const [showVendorForm, setShowVendorForm] = useState(false);
  const [vendorForm, setVendorForm] = useState({ name: "", email: "", shop: "", desc: "", products: "", website: "" });
  const [vendorSubmitted, setVendorSubmitted] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState(null);

  const addToCart = (product) => {
    setCart(prev => {
      const existing = prev.find(p => p.id === product.id);
      if (existing) return prev.map(p => p.id === product.id ? { ...p, qty: p.qty + 1 } : p);
      return [...prev, { ...product, qty: 1 }];
    });
  };

  const removeFromCart = (id) => setCart(prev => prev.filter(p => p.id !== id));
  const cartTotal = cart.reduce((a, p) => a + p.price * p.qty, 0);
  const cartCount = cart.reduce((a, p) => a + p.qty, 0);

  const filtered = SHOP_PRODUCTS
    .filter(p => activeCat === "all" || p.cat === activeCat)
    .filter(p => !searchTerm || p.name.toLowerCase().includes(searchTerm.toLowerCase()) || p.desc.toLowerCase().includes(searchTerm.toLowerCase()) || p.tags.some(t => t.toLowerCase().includes(searchTerm.toLowerCase())))
    .sort((a, b) => {
      if (sortBy === "price-low") return a.price - b.price;
      if (sortBy === "price-high") return b.price - a.price;
      if (sortBy === "rating") return b.rating - a.rating;
      if (sortBy === "reviews") return b.reviews - a.reviews;
      return (b.badge ? 1 : 0) - (a.badge ? 1 : 0);
    });

  // Vendor Application Form
  if (showVendorForm) {
    return (
      <div style={{ animation: "fadeInUp 0.4s ease" }}>
        <button onClick={() => setShowVendorForm(false)} style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)", color: "var(--text-muted)", padding: "8px 18px", borderRadius: 8, cursor: "pointer", fontSize: 11, letterSpacing: 2, fontFamily: "'Orbitron', sans-serif", marginBottom: 24 }}>← BACK TO SHOP</button>

        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 24 }}>
          <span style={{ fontSize: 40 }}>🏪</span>
          <div>
            <h2 style={{ fontSize: 22, fontWeight: 600, color: "var(--text)", fontFamily: "'Orbitron', sans-serif", margin: 0 }}>Become a VIBE Vendor</h2>
            <p style={{ fontSize: 12, color: "var(--text-faint)", marginTop: 4 }}>Sell your high-vibe products to the TH3 AWAR3N3SS community</p>
          </div>
        </div>

        {vendorSubmitted ? (
          <GlassCard hover={false} style={{ textAlign: "center", padding: 40 }}>
            <span style={{ fontSize: 48, display: "block", marginBottom: 16 }}>✅</span>
            <h3 style={{ fontSize: 18, color: "#00ff8c", fontFamily: "'Orbitron', sans-serif", marginBottom: 8 }}>APPLICATION SUBMITTED</h3>
            <p style={{ fontSize: 14, color: "var(--text-muted)", lineHeight: 1.8 }}>We'll review your application and get back to you within 48 hours. Welcome to the collective.</p>
          </GlassCard>
        ) : (
          <GlassCard hover={false} style={{ maxWidth: 600 }}>
            <p style={{ fontSize: 13, color: "var(--text-faint)", lineHeight: 1.8, marginBottom: 24 }}>
              We're looking for vendors who align with the TH3 AWAR3N3SS mission — products that genuinely help people raise their vibration, heal, and awaken. No mass-produced junk. Quality, intention, and integrity matter.
            </p>
            {[
              { key: "name", label: "Your Name / Brand Name", placeholder: "e.g. Sacred Metals Lab" },
              { key: "email", label: "Contact Email", placeholder: "you@example.com" },
              { key: "shop", label: "Shop / Business Name", placeholder: "Your business name" },
              { key: "website", label: "Website or Social Media", placeholder: "instagram.com/yourbrand" },
              { key: "products", label: "What Do You Sell?", placeholder: "Orgonite pyramids, copper tools, crystals, etc.", multi: true },
              { key: "desc", label: "Tell Us About Your Products & Mission", placeholder: "What makes your products special? What's your story?", multi: true },
            ].map(field => (
              <div key={field.key} style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 10, letterSpacing: 2, color: "var(--text-faint)", fontFamily: "'Orbitron', sans-serif", display: "block", marginBottom: 6 }}>{field.label}</label>
                {field.multi ? (
                  <textarea value={vendorForm[field.key]} onChange={e => setVendorForm(prev => ({ ...prev, [field.key]: e.target.value }))} placeholder={field.placeholder} rows={3}
                    style={{ width: "100%", background: "var(--card-bg)", border: "1px solid var(--card-border)", borderRadius: 8, padding: "12px 16px", color: "var(--text)", fontSize: 14, outline: "none", fontFamily: "'Sora', sans-serif", resize: "vertical" }} />
                ) : (
                  <input value={vendorForm[field.key]} onChange={e => setVendorForm(prev => ({ ...prev, [field.key]: e.target.value }))} placeholder={field.placeholder}
                    style={{ width: "100%", background: "var(--card-bg)", border: "1px solid var(--card-border)", borderRadius: 8, padding: "12px 16px", color: "var(--text)", fontSize: 14, outline: "none", fontFamily: "'Sora', sans-serif" }} />
                )}
              </div>
            ))}
            <button onClick={() => setVendorSubmitted(true)} style={{ padding: "12px 32px", borderRadius: 8, background: "rgba(0,255,140,0.12)", border: "1px solid rgba(0,255,140,0.4)", color: "#00ff8c", cursor: "pointer", fontSize: 12, letterSpacing: 3, fontFamily: "'Orbitron', sans-serif", marginTop: 8 }}>SUBMIT APPLICATION</button>
          </GlassCard>
        )}
      </div>
    );
  }

  // Product Detail
  if (selectedProduct) {
    const p = selectedProduct;
    const catInfo = SHOP_CATEGORIES.find(c => c.id === p.cat);
    return (
      <div style={{ animation: "fadeInUp 0.4s ease" }}>
        <button onClick={() => setSelectedProduct(null)} style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)", color: "var(--text-muted)", padding: "8px 18px", borderRadius: 8, cursor: "pointer", fontSize: 11, letterSpacing: 2, fontFamily: "'Orbitron', sans-serif", marginBottom: 24 }}>← BACK TO SHOP</button>

        <div style={{ display: "flex", gap: 28, flexWrap: "wrap" }}>
          <GlassCard hover={false} style={{ flex: "0 1 340px", display: "flex", alignItems: "center", justifyContent: "center", minHeight: 300 }}>
            <span style={{ fontSize: 100 }}>{p.image}</span>
          </GlassCard>
          <div style={{ flex: 1, minWidth: 280 }}>
            {p.badge && <span style={{ fontSize: 9, padding: "3px 10px", borderRadius: 4, background: "rgba(0,255,140,0.1)", border: "1px solid rgba(0,255,140,0.25)", color: "#00ff8c", letterSpacing: 2, fontFamily: "'Orbitron', sans-serif", marginBottom: 10, display: "inline-block" }}>{p.badge}</span>}
            <h2 style={{ fontSize: 22, fontWeight: 600, color: "var(--text)", margin: "8px 0", fontFamily: "'Sora', sans-serif" }}>{p.name}</h2>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <span style={{ fontSize: 10, color: catInfo?.color, fontFamily: "'Orbitron', sans-serif" }}>{catInfo?.icon} {catInfo?.name}</span>
              <span style={{ fontSize: 11, color: "var(--text-faint)" }}>•</span>
              <span style={{ fontSize: 11, color: "#eab308" }}>{"★".repeat(Math.floor(p.rating))} {p.rating}</span>
              <span style={{ fontSize: 11, color: "var(--text-faint)" }}>({p.reviews} reviews)</span>
            </div>
            <p style={{ fontSize: 14, color: "var(--text-muted)", lineHeight: 1.9, marginBottom: 20 }}>{p.desc}</p>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 20 }}>
              <span style={{ fontSize: 28, fontWeight: 700, color: "#00ff8c", fontFamily: "'Orbitron', sans-serif" }}>${p.price}</span>
              {p.origPrice && <span style={{ fontSize: 16, color: "var(--text-dim)", textDecoration: "line-through" }}>${p.origPrice}</span>}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
              <span style={{ fontSize: 11, color: "var(--text-faint)" }}>Sold by:</span>
              <span style={{ fontSize: 12, color: p.memberSeller ? "#00ff8c" : "#fff", fontWeight: 500 }}>{p.memberSeller ? `@${p.seller.toLowerCase()}` : p.seller}</span>
              {p.verified && <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 4, background: "rgba(0,255,140,0.1)", color: "#00ff8c" }}>✓ VERIFIED</span>}
              {p.memberSeller && <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 4, background: "rgba(167,139,250,0.1)", color: "#a78bfa" }}>TH3 AWAR3N3SS MEMBER</span>}
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 20 }}>
              {p.tags.map(t => <span key={t} style={{ fontSize: 9, padding: "3px 10px", borderRadius: 20, background: `${catInfo?.color}10`, color: `${catInfo?.color}cc`, border: `1px solid ${catInfo?.color}20`, letterSpacing: 1 }}>{t}</span>)}
            </div>
            <button onClick={() => { addToCart(p); setSelectedProduct(null); }} style={{ padding: "14px 40px", borderRadius: 8, background: "rgba(0,255,140,0.12)", border: "1px solid rgba(0,255,140,0.4)", color: "#00ff8c", cursor: "pointer", fontSize: 13, letterSpacing: 3, fontFamily: "'Orbitron', sans-serif", transition: "all 0.3s" }}>ADD TO CART</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ animation: "fadeInUp 0.5s ease" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24, flexWrap: "wrap", gap: 16 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
            <div style={{ width: 3, height: 28, background: "linear-gradient(to bottom, #eab308, #00ff8c)", borderRadius: 2 }} />
            <h2 style={{ fontSize: 22, fontWeight: 300, color: "var(--text)", fontFamily: "'Sora', sans-serif", margin: 0 }}>VIBE SHOP</h2>
          </div>
          <p style={{ fontSize: 13, color: "var(--text-faint)", lineHeight: 1.8, marginTop: 8 }}>
            {SHOP_PRODUCTS.length} products from verified vendors and TH3 AWAR3N3SS members. Everything you need to raise your frequency.
          </p>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={() => setShowCart(!showCart)} style={{ padding: "8px 18px", borderRadius: 8, background: cartCount > 0 ? "rgba(0,255,140,0.1)" : "rgba(255,255,255,0.03)", border: `1px solid ${cartCount > 0 ? "rgba(0,255,140,0.3)" : "rgba(255,255,255,0.06)"}`, color: cartCount > 0 ? "#00ff8c" : "rgba(255,255,255,0.3)", cursor: "pointer", fontSize: 12, fontFamily: "'Orbitron', sans-serif", letterSpacing: 1 }}>
            🛒 {cartCount > 0 ? `${cartCount} — $${cartTotal}` : "CART"}
          </button>
          <button onClick={() => setShowVendorForm(true)} style={{ padding: "8px 18px", borderRadius: 8, background: "rgba(167,139,250,0.1)", border: "1px solid rgba(167,139,250,0.3)", color: "#a78bfa", cursor: "pointer", fontSize: 11, fontFamily: "'Orbitron', sans-serif", letterSpacing: 1 }}>BECOME A VENDOR</button>
        </div>
      </div>

      {/* Cart Drawer */}
      {showCart && cart.length > 0 && (
        <GlassCard hover={false} style={{ marginBottom: 20, borderLeft: "3px solid #00ff8c" }}>
          <span style={{ fontSize: 10, letterSpacing: 3, color: "#00ff8c", fontFamily: "'Orbitron', sans-serif", display: "block", marginBottom: 14 }}>YOUR CART</span>
          {cart.map(item => (
            <div key={item.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid var(--card-border)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 20 }}>{item.image}</span>
                <div>
                  <div style={{ fontSize: 13, color: "var(--text)" }}>{item.name}</div>
                  <div style={{ fontSize: 11, color: "var(--text-faint)" }}>Qty: {item.qty} × ${item.price}</div>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ fontSize: 14, color: "#00ff8c", fontWeight: 600 }}>${item.price * item.qty}</span>
                <button onClick={() => removeFromCart(item.id)} style={{ background: "none", border: "none", color: "rgba(255,60,60,0.5)", cursor: "pointer", fontSize: 14 }}>✕</button>
              </div>
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 16 }}>
            <span style={{ fontSize: 14, color: "var(--text)", fontWeight: 600 }}>Total: <span style={{ color: "#00ff8c", fontFamily: "'Orbitron', sans-serif" }}>${cartTotal}</span></span>
            <button style={{ padding: "10px 28px", borderRadius: 8, background: "rgba(0,255,140,0.15)", border: "1px solid rgba(0,255,140,0.4)", color: "#00ff8c", cursor: "pointer", fontSize: 12, letterSpacing: 3, fontFamily: "'Orbitron', sans-serif" }}>CHECKOUT</button>
          </div>
        </GlassCard>
      )}

      {/* Search & Sort */}
      <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
        <input value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="Search products... (shungite, copper, 432Hz...)"
          style={{ flex: 1, minWidth: 200, background: "var(--card-bg)", border: "1px solid var(--card-border)", borderRadius: 10, padding: "12px 18px", color: "var(--text)", fontSize: 13, outline: "none", fontFamily: "'JetBrains Mono', monospace" }} />
        <select value={sortBy} onChange={e => setSortBy(e.target.value)}
          style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)", borderRadius: 8, padding: "8px 16px", color: "var(--text-muted)", fontSize: 12, outline: "none", cursor: "pointer", fontFamily: "'Sora', sans-serif" }}>
          <option value="featured">Featured</option>
          <option value="price-low">Price: Low → High</option>
          <option value="price-high">Price: High → Low</option>
          <option value="rating">Top Rated</option>
          <option value="reviews">Most Reviewed</option>
        </select>
      </div>

      {/* Category Filter */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 24 }}>
        <button onClick={() => setActiveCat("all")} style={{ padding: "6px 16px", borderRadius: 20, fontSize: 11, cursor: "pointer", fontFamily: "'Sora', sans-serif", background: activeCat === "all" ? "rgba(0,255,140,0.12)" : "rgba(255,255,255,0.03)", border: `1px solid ${activeCat === "all" ? "rgba(0,255,140,0.3)" : "rgba(255,255,255,0.06)"}`, color: activeCat === "all" ? "#00ff8c" : "rgba(255,255,255,0.35)" }}>All</button>
        {SHOP_CATEGORIES.map(cat => (
          <button key={cat.id} onClick={() => setActiveCat(cat.id)} style={{
            padding: "6px 16px", borderRadius: 20, fontSize: 11, cursor: "pointer",
            fontFamily: "'Sora', sans-serif", display: "flex", alignItems: "center", gap: 4,
            background: activeCat === cat.id ? `${cat.color}15` : "rgba(255,255,255,0.03)",
            border: `1px solid ${activeCat === cat.id ? `${cat.color}40` : "rgba(255,255,255,0.06)"}`,
            color: activeCat === cat.id ? cat.color : "rgba(255,255,255,0.35)",
          }}>{cat.icon} {cat.name}</button>
        ))}
      </div>

      {/* Member Marketplace Banner */}
      {(activeCat === "all" || activeCat === "member") && (
        <div style={{ padding: "18px 24px", borderRadius: 12, background: "linear-gradient(135deg, rgba(0,255,140,0.06), rgba(167,139,250,0.06))", border: "1px solid rgba(0,255,140,0.1)", marginBottom: 20, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <div>
            <span style={{ fontSize: 10, letterSpacing: 3, color: "#00ff8c", fontFamily: "'Orbitron', sans-serif" }}>⊛ TH3 AWAR3N3SS MEMBER MARKETPLACE</span>
            <p style={{ fontSize: 12, color: "var(--text-faint)", marginTop: 4 }}>Handmade products from our community. Every purchase supports a fellow seeker.</p>
          </div>
          <button onClick={() => setShowVendorForm(true)} style={{ padding: "8px 20px", borderRadius: 8, background: "rgba(0,255,140,0.08)", border: "1px solid rgba(0,255,140,0.25)", color: "#00ff8c", cursor: "pointer", fontSize: 10, letterSpacing: 2, fontFamily: "'Orbitron', sans-serif" }}>SELL YOUR PRODUCTS →</button>
        </div>
      )}

      {/* Results count */}
      <div style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 16, fontFamily: "'JetBrains Mono', monospace" }}>
        {filtered.length} products {searchTerm && `matching "${searchTerm}"`}
      </div>

      {/* Product Grid */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
        {filtered.map(product => {
          const catInfo = SHOP_CATEGORIES.find(c => c.id === product.cat);
          return (
            <GlassCard key={product.id} onClick={() => setSelectedProduct(product)} style={{ flex: "1 1 260px", maxWidth: 320, cursor: "pointer", padding: 0, overflow: "hidden" }}>
              {/* Image area */}
              <div style={{ padding: "28px 20px", textAlign: "center", background: `${catInfo?.color}05`, borderBottom: "1px solid var(--card-border)", position: "relative" }}>
                {product.badge && <span style={{ position: "absolute", top: 10, left: 10, fontSize: 8, padding: "2px 8px", borderRadius: 4, background: "rgba(0,255,140,0.12)", border: "1px solid rgba(0,255,140,0.25)", color: "#00ff8c", letterSpacing: 2, fontFamily: "'Orbitron', sans-serif" }}>{product.badge}</span>}
                {product.memberSeller && <span style={{ position: "absolute", top: 10, right: 10, fontSize: 8, padding: "2px 8px", borderRadius: 4, background: "rgba(167,139,250,0.12)", color: "#a78bfa", letterSpacing: 1 }}>MEMBER</span>}
                <span style={{ fontSize: 48 }}>{product.image}</span>
              </div>
              {/* Info */}
              <div style={{ padding: "16px 20px" }}>
                <h3 style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", margin: "0 0 6px", lineHeight: 1.4 }}>{product.name}</h3>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                  <span style={{ fontSize: 11, color: "#eab308" }}>★ {product.rating}</span>
                  <span style={{ fontSize: 10, color: "var(--text-dim)" }}>({product.reviews})</span>
                  <span style={{ fontSize: 10, color: catInfo?.color, marginLeft: "auto" }}>{catInfo?.icon}</span>
                </div>
                <p style={{ fontSize: 11, color: "var(--text-faint)", lineHeight: 1.6, margin: "0 0 12px", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{product.desc}</p>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <span style={{ fontSize: 18, fontWeight: 700, color: "#00ff8c", fontFamily: "'Orbitron', sans-serif" }}>${product.price}</span>
                    {product.origPrice && <span style={{ fontSize: 12, color: "var(--text-dim)", textDecoration: "line-through", marginLeft: 6 }}>${product.origPrice}</span>}
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); addToCart(product); }} style={{ padding: "6px 14px", borderRadius: 6, background: "rgba(0,255,140,0.08)", border: "1px solid rgba(0,255,140,0.25)", color: "#00ff8c", cursor: "pointer", fontSize: 10, fontFamily: "'Orbitron', sans-serif" }}>+ CART</button>
                </div>
              </div>
            </GlassCard>
          );
        })}
      </div>

      {/* Vendor CTA */}
      <div style={{ marginTop: 32, padding: 28, borderRadius: 16, background: "linear-gradient(135deg, rgba(167,139,250,0.06), rgba(234,179,8,0.06))", border: "1px solid rgba(167,139,250,0.1)", textAlign: "center" }}>
        <span style={{ fontSize: 10, letterSpacing: 4, color: "#a78bfa", fontFamily: "'Orbitron', sans-serif", display: "block", marginBottom: 12 }}>🏪 FOR VENDORS & CREATORS</span>
        <h3 style={{ fontSize: 20, color: "var(--text)", fontWeight: 400, marginBottom: 8, fontFamily: "'Sora', sans-serif" }}>Sell Your High-Vibe Products on TH3 AWAR3N3SS</h3>
        <p style={{ fontSize: 13, color: "var(--text-faint)", lineHeight: 1.8, maxWidth: 500, margin: "0 auto 20px" }}>
          Are you a maker, healer, or artisan creating products that raise vibration? Apply to become a verified vendor and reach thousands of conscious consumers.
        </p>
        <button onClick={() => setShowVendorForm(true)} style={{ padding: "12px 36px", borderRadius: 8, background: "rgba(167,139,250,0.12)", border: "1px solid rgba(167,139,250,0.4)", color: "#a78bfa", cursor: "pointer", fontSize: 12, letterSpacing: 3, fontFamily: "'Orbitron', sans-serif" }}>APPLY NOW</button>
      </div>
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════
// HEALING SECTION — Organ-Herb Matching System
// ═══════════════════════════════════════════════════════════════

const BODY_ORGANS = [
  {
    id: "brain", name: "Brain & Nervous System", emoji: "🧠", y: 8, color: "#a78bfa",
    symptoms: ["Brain fog", "Poor memory", "Anxiety", "Insomnia", "Headaches", "Poor focus", "Nerve pain"],
    herbs: [
      { name: "Lion's Mane Mushroom", type: "Capsule/Powder", brand: "Host Defense (Sprouts)", desc: "Stimulates nerve growth factor (NGF). Rebuilds myelin sheath. The #1 mushroom for neurogenesis and cognitive clarity.", dosage: "1000mg 2x daily", rating: 98 },
      { name: "Ginkgo Biloba", type: "Tincture", brand: "Herb Pharm (Sprouts)", desc: "Increases cerebral blood flow. Used for 5,000 years in Chinese medicine for memory, focus, and mental sharpness.", dosage: "30-40 drops 2-3x daily", rating: 92 },
      { name: "Bacopa Monnieri", type: "Capsule", brand: "Himalaya (Sprouts)", desc: "Ayurvedic nootropic that enhances memory consolidation, reduces anxiety, and protects neurons from oxidative stress.", dosage: "300mg daily", rating: 90 },
      { name: "Gotu Kola", type: "Tincture", brand: "Herb Pharm (Sprouts)", desc: "The 'herb of longevity.' Strengthens brain cells, improves circulation, and repairs connective tissue in the nervous system.", dosage: "30 drops 2x daily", rating: 88 },
      { name: "Ashwagandha", type: "Tincture/Capsule", brand: "Herb Pharm / Garden of Life (Sprouts)", desc: "Adaptogen that lowers cortisol, calms the nervous system, improves sleep quality, and rebuilds adrenal function.", dosage: "600mg or 40 drops daily", rating: 95 },
      { name: "Rosemary", type: "Essential Oil/Tea", brand: "Sprouts Brand", desc: "Carnosic acid protects neurons. Inhaling rosemary improves memory recall by up to 75% in studies.", dosage: "Tea 2x daily or diffuse", rating: 82 },
    ],
    combos: [
      { name: "Cognitive Restoration Stack", herbs: ["Lion's Mane", "Ginkgo Biloba", "Bacopa"], desc: "The ultimate brain rebuild. Neurogenesis + blood flow + memory encoding.", duration: "90 days minimum" },
      { name: "Anxiety & Calm Protocol", herbs: ["Ashwagandha", "Gotu Kola", "Valerian Root"], desc: "Calms the nervous system without sedation. Resets the stress response over time.", duration: "60 days" },
    ]
  },
  {
    id: "eyes", name: "Eyes & Vision", emoji: "👁️", y: 10, color: "#06b6d4",
    symptoms: ["Blurry vision", "Eye strain", "Floaters", "Night vision", "Dry eyes", "Macular degeneration"],
    herbs: [
      { name: "Bilberry", type: "Capsule", brand: "Nature's Way (Sprouts)", desc: "Anthocyanins strengthen retinal capillaries. Used by WWII pilots for night vision. Protects against macular degeneration.", dosage: "160mg 2x daily", rating: 90 },
      { name: "Eyebright", type: "Tincture", brand: "Herb Pharm (Sprouts)", desc: "Traditional European herb for all eye conditions. Reduces inflammation, soothes irritation, and supports clear vision.", dosage: "30 drops 3x daily", rating: 85 },
      { name: "Lutein & Zeaxanthin", type: "Capsule", brand: "Garden of Life (Sprouts)", desc: "The macular pigments that filter blue light and protect photoreceptors. Found naturally in dark leafy greens.", dosage: "20mg daily", rating: 92 },
    ],
    combos: [
      { name: "Vision Restoration", herbs: ["Bilberry", "Eyebright", "Lutein"], desc: "Full-spectrum eye support. Retinal strength + inflammation relief + blue light protection.", duration: "120 days" },
    ]
  },
  {
    id: "thyroid", name: "Thyroid & Endocrine", emoji: "🦋", y: 18, color: "#ec4899",
    symptoms: ["Fatigue", "Weight gain", "Hair loss", "Cold sensitivity", "Brain fog", "Hormone imbalance"],
    herbs: [
      { name: "Ashwagandha", type: "Capsule", brand: "Garden of Life (Sprouts)", desc: "Clinically shown to normalize TSH, T3, and T4 levels. The premier adaptogen for thyroid support.", dosage: "600mg daily", rating: 95 },
      { name: "Bladderwrack", type: "Capsule", brand: "Nature's Way (Sprouts)", desc: "Natural iodine source from sea kelp. Essential mineral for thyroid hormone production.", dosage: "500mg daily", rating: 84 },
      { name: "Selenium", type: "Supplement", brand: "Garden of Life (Sprouts)", desc: "Essential for converting T4 to active T3. Brazil nuts are the richest food source — 2 per day.", dosage: "200mcg daily", rating: 88 },
      { name: "Guggul", type: "Capsule", brand: "Himalaya (Sprouts)", desc: "Ayurvedic resin that stimulates thyroid function and supports healthy cholesterol metabolism.", dosage: "500mg 2x daily", rating: 80 },
    ],
    combos: [
      { name: "Thyroid Revival Protocol", herbs: ["Ashwagandha", "Bladderwrack", "Selenium"], desc: "Restore thyroid hormone production naturally. Adaptogen + iodine + conversion support.", duration: "90 days" },
    ]
  },
  {
    id: "lungs", name: "Lungs & Respiratory", emoji: "🫁", y: 28, color: "#22c55e",
    symptoms: ["Shortness of breath", "Congestion", "Chronic cough", "Allergies", "Asthma", "Mucus buildup"],
    herbs: [
      { name: "Mullein Leaf", type: "Tincture/Tea", brand: "Herb Pharm (Sprouts)", desc: "The #1 lung herb. Clears mucus, soothes bronchial inflammation, and strengthens lung tissue. Smoker's best friend.", dosage: "30-40 drops 3x daily", rating: 96 },
      { name: "Oregano Oil", type: "Softgel", brand: "North American Herb & Spice (Sprouts)", desc: "Carvacrol and thymol are powerful antimicrobials. Destroys pathogens in the respiratory tract.", dosage: "1 softgel 2x daily", rating: 90 },
      { name: "Elderberry", type: "Syrup/Gummy", brand: "Sambucol / Garden of Life (Sprouts)", desc: "Antiviral powerhouse. Reduces cold/flu duration by 4 days in studies. Immune system activator.", dosage: "1 tbsp daily or as directed", rating: 93 },
      { name: "NAC (N-Acetyl Cysteine)", type: "Capsule", brand: "NOW Foods (Sprouts)", desc: "Precursor to glutathione. Thins and clears mucus from lungs. The supplement hospitals use for respiratory emergencies.", dosage: "600mg 2x daily", rating: 94 },
      { name: "Lobelia", type: "Tincture", brand: "Herb Pharm (Sprouts)", desc: "Antispasmodic that relaxes bronchial muscles. Used historically for asthma and breathing difficulties.", dosage: "10-20 drops as needed", rating: 82 },
    ],
    combos: [
      { name: "Deep Lung Cleanse", herbs: ["Mullein", "NAC", "Oregano Oil"], desc: "Clear years of buildup. Mucus dissolution + antimicrobial + tissue repair.", duration: "60 days" },
      { name: "Respiratory Immune Shield", herbs: ["Elderberry", "Oregano Oil", "Mullein"], desc: "Seasonal protection protocol. Antiviral + antimicrobial + lung strength.", duration: "Ongoing seasonal" },
    ]
  },
  {
    id: "heart", name: "Heart & Cardiovascular", emoji: "❤️", y: 30, color: "#ef4444",
    symptoms: ["High blood pressure", "Poor circulation", "Chest tightness", "Cold hands/feet", "Irregular heartbeat"],
    herbs: [
      { name: "Hawthorn Berry", type: "Tincture/Capsule", brand: "Herb Pharm (Sprouts)", desc: "Europe's #1 heart herb for 800+ years. Strengthens heart muscle, improves coronary blood flow, and regulates blood pressure.", dosage: "40 drops 3x daily", rating: 96 },
      { name: "CoQ10", type: "Softgel", brand: "Garden of Life (Sprouts)", desc: "The heart's primary fuel. Cellular energy production in cardiac muscle. Essential if on statin medications.", dosage: "200mg daily", rating: 94 },
      { name: "Garlic", type: "Capsule", brand: "Kyolic (Sprouts)", desc: "Reduces blood pressure, lowers LDL cholesterol, and prevents arterial plaque. The most studied heart herb in history.", dosage: "600mg 2x daily", rating: 92 },
      { name: "Cayenne", type: "Capsule/Tincture", brand: "Nature's Way (Sprouts)", desc: "Opens blood vessels, improves circulation instantly, and strengthens the heart. Dr. Christopher's #1 emergency herb.", dosage: "40,000 HU capsule daily", rating: 88 },
      { name: "Omega-3 (Fish Oil)", type: "Softgel", brand: "Nordic Naturals (Sprouts)", desc: "Reduces triglycerides, inflammation markers, and arterial stiffness. EPA/DHA are essential for cardiovascular health.", dosage: "2000mg daily", rating: 91 },
    ],
    combos: [
      { name: "Heart Fortress Protocol", herbs: ["Hawthorn", "CoQ10", "Garlic"], desc: "Strengthen the heart muscle, fuel cells, and clear arteries. The complete cardiac support stack.", duration: "Ongoing" },
    ]
  },
  {
    id: "liver", name: "Liver & Gallbladder", emoji: "🫘", y: 36, color: "#eab308",
    symptoms: ["Fatigue", "Skin issues", "Digestive problems", "Anger/irritability", "Chemical sensitivity", "Jaundice"],
    herbs: [
      { name: "Milk Thistle", type: "Capsule/Tincture", brand: "Herb Pharm Liver Health (Sprouts)", desc: "Silymarin regenerates liver cells. Clinically proven to reverse liver damage. The undisputed king of liver herbs.", dosage: "420mg silymarin daily", rating: 98 },
      { name: "Dandelion Root", type: "Tincture/Tea", brand: "Herb Pharm / Traditional Medicinals (Sprouts)", desc: "Stimulates bile production, cleanses the liver, and acts as a gentle diuretic. The liver's daily tonic.", dosage: "30 drops 3x daily or tea", rating: 90 },
      { name: "Turmeric / Curcumin", type: "Capsule", brand: "Garden of Life (Sprouts)", desc: "Potent anti-inflammatory that protects liver cells, stimulates bile flow, and supports phase II detoxification.", dosage: "500mg curcumin with piperine", rating: 93 },
      { name: "Burdock Root", type: "Tincture", brand: "Herb Pharm (Sprouts)", desc: "Blood purifier and liver decongestant. Pulls heavy metals and toxins through the lymphatic system.", dosage: "30 drops 2x daily", rating: 86 },
      { name: "Artichoke Leaf", type: "Capsule", brand: "Nature's Way (Sprouts)", desc: "Increases bile production by 127% in studies. Protects liver cells and supports fat digestion and cholesterol metabolism.", dosage: "600mg daily", rating: 84 },
    ],
    combos: [
      { name: "Liver Regeneration Protocol", herbs: ["Milk Thistle", "Dandelion Root", "Turmeric"], desc: "Cell regeneration + bile flow + anti-inflammatory. The gold standard liver cleanse.", duration: "90 days" },
      { name: "Deep Detox Stack", herbs: ["Milk Thistle", "Burdock Root", "NAC", "Artichoke"], desc: "Full phase I and II detox support. Heavy metal clearance + liver cell protection.", duration: "30 days" },
    ]
  },
  {
    id: "stomach", name: "Stomach & Digestive", emoji: "🫃", y: 42, color: "#f97316",
    symptoms: ["Bloating", "Acid reflux", "IBS", "Leaky gut", "Constipation", "Food sensitivities", "SIBO"],
    herbs: [
      { name: "Slippery Elm", type: "Powder/Capsule", brand: "Nature's Way (Sprouts)", desc: "Creates a protective mucilage coating over the gut lining. Heals leaky gut, soothes acid reflux, and calms IBS.", dosage: "400mg 3x daily or powder in water", rating: 92 },
      { name: "Ginger Root", type: "Tincture/Tea", brand: "Herb Pharm / Traditional Medicinals (Sprouts)", desc: "Anti-nausea, prokinetic (moves food through), anti-inflammatory. The universal digestive remedy across all cultures.", dosage: "30 drops or tea before meals", rating: 94 },
      { name: "Probiotics", type: "Capsule", brand: "Garden of Life RAW Probiotics (Sprouts)", desc: "50+ billion CFU with 30+ strains. Rebuilds the gut microbiome, strengthens the immune system, and improves nutrient absorption.", dosage: "1 capsule daily on empty stomach", rating: 96 },
      { name: "L-Glutamine", type: "Powder", brand: "NOW Foods (Sprouts)", desc: "Primary fuel for intestinal cells. Repairs gut lining, seals tight junctions, and reverses intestinal permeability.", dosage: "5g 2x daily", rating: 90 },
      { name: "Digestive Bitters", type: "Tincture", brand: "Urban Moonshine (Sprouts)", desc: "Stimulates the entire digestive cascade — saliva, HCl, bile, enzymes. The forgotten art of bitter medicine.", dosage: "1-2 dropperfuls before meals", rating: 88 },
      { name: "Marshmallow Root", type: "Tincture/Tea", brand: "Herb Pharm (Sprouts)", desc: "Demulcent herb that soothes the entire GI tract. Reduces inflammation from mouth to colon.", dosage: "30 drops 3x daily", rating: 86 },
    ],
    combos: [
      { name: "Gut Rebuild Protocol", herbs: ["L-Glutamine", "Probiotics", "Slippery Elm"], desc: "Seal the gut lining + repopulate microbiome + protective coating. The leaky gut reversal stack.", duration: "90 days" },
      { name: "Digestive Fire Boost", herbs: ["Ginger", "Digestive Bitters", "Probiotics"], desc: "Ignite weak digestion. Stimulate HCl + bile + enzyme production naturally.", duration: "30 days" },
    ]
  },
  {
    id: "kidneys", name: "Kidneys & Urinary", emoji: "🫘", y: 48, color: "#8b5cf6",
    symptoms: ["Water retention", "UTIs", "Kidney stones", "Back pain (lower)", "Dark urine", "Edema"],
    herbs: [
      { name: "Nettle Leaf", type: "Tincture/Tea", brand: "Herb Pharm / Traditional Medicinals (Sprouts)", desc: "Gentle diuretic that doesn't deplete minerals. Flushes kidneys, reduces inflammation, and supports adrenal function.", dosage: "30 drops 3x daily or tea", rating: 92 },
      { name: "Cranberry", type: "Capsule", brand: "Nature's Way (Sprouts)", desc: "Prevents bacteria from adhering to urinary tract walls. The proven UTI prevention herb.", dosage: "500mg 2x daily", rating: 88 },
      { name: "Chanca Piedra", type: "Capsule/Tea", brand: "Available at Sprouts", desc: "Literally translates to 'stone breaker.' Dissolves calcium oxalate kidney stones. Used in Amazonian medicine for centuries.", dosage: "500mg 3x daily", rating: 94 },
      { name: "Corn Silk", type: "Tea", brand: "Traditional Medicinals (Sprouts)", desc: "Soothes inflamed urinary passages, reduces edema, and supports kidney filtration. A gentle, effective remedy.", dosage: "Tea 2-3x daily", rating: 80 },
      { name: "Parsley", type: "Tea/Fresh", brand: "Sprouts Produce", desc: "Natural diuretic that helps kidneys flush uric acid and toxins. Rich in vitamins A, C, and K.", dosage: "Fresh juice or tea daily", rating: 78 },
    ],
    combos: [
      { name: "Kidney Flush Protocol", herbs: ["Chanca Piedra", "Nettle Leaf", "Corn Silk"], desc: "Dissolve stones + flush kidneys + soothe passages. The complete kidney reset.", duration: "30 days" },
    ]
  },
  {
    id: "joints", name: "Joints & Muscles", emoji: "🦴", y: 58, color: "#78716c",
    symptoms: ["Joint pain", "Arthritis", "Stiffness", "Muscle cramps", "Inflammation", "Fibromyalgia"],
    herbs: [
      { name: "Turmeric / Curcumin", type: "Capsule", brand: "Garden of Life (Sprouts)", desc: "As effective as ibuprofen for joint pain in clinical trials — without the gut damage. Nature's #1 anti-inflammatory.", dosage: "1000mg curcumin with piperine", rating: 96 },
      { name: "Boswellia", type: "Capsule", brand: "Nature's Way (Sprouts)", desc: "Frankincense extract. Inhibits 5-LOX enzyme that drives joint inflammation. Works synergistically with curcumin.", dosage: "500mg 3x daily", rating: 90 },
      { name: "Devil's Claw", type: "Capsule", brand: "Nature's Way (Sprouts)", desc: "African herb clinically proven to reduce osteoarthritis pain. Anti-inflammatory without NSAID side effects.", dosage: "750mg 2x daily", rating: 84 },
      { name: "Magnesium", type: "Powder/Capsule", brand: "Natural Vitality CALM (Sprouts)", desc: "Relaxes muscles, prevents cramps, and reduces inflammation. 80% of people are deficient.", dosage: "400mg glycinate daily", rating: 94 },
      { name: "Arnica", type: "Topical Cream", brand: "Boiron (Sprouts)", desc: "Apply directly to pain. Reduces bruising, muscle soreness, and joint swelling. The athlete's recovery herb.", dosage: "Apply 2-3x daily to affected area", rating: 86 },
    ],
    combos: [
      { name: "Joint Repair Protocol", herbs: ["Turmeric", "Boswellia", "Magnesium"], desc: "Triple anti-inflammatory + mineral support. Rebuild cartilage and reduce chronic pain.", duration: "90 days" },
    ]
  },
  {
    id: "skin", name: "Skin & Detox Pathways", emoji: "✋", y: 65, color: "#f472b6",
    symptoms: ["Acne", "Eczema", "Psoriasis", "Dull skin", "Rashes", "Premature aging", "Hives"],
    herbs: [
      { name: "Burdock Root", type: "Tincture", brand: "Herb Pharm (Sprouts)", desc: "The master blood purifier. Clears skin from the inside by detoxifying the liver and lymphatic system.", dosage: "30 drops 2x daily", rating: 90 },
      { name: "Oregon Grape Root", type: "Tincture", brand: "Herb Pharm (Sprouts)", desc: "Contains berberine — antimicrobial and anti-inflammatory. Traditionally used for psoriasis and eczema.", dosage: "30 drops 2x daily", rating: 84 },
      { name: "Red Clover", type: "Tea/Tincture", brand: "Traditional Medicinals (Sprouts)", desc: "Blood cleanser and lymph mover. Isoflavones support hormonal balance which reflects in skin clarity.", dosage: "Tea 2x daily", rating: 82 },
      { name: "Collagen", type: "Powder", brand: "Garden of Life / Vital Proteins (Sprouts)", desc: "Rebuilds skin structure from within. Improves elasticity, hydration, and reduces wrinkles in 8 weeks of studies.", dosage: "10-20g daily in liquid", rating: 88 },
      { name: "Zinc", type: "Capsule", brand: "Garden of Life (Sprouts)", desc: "Essential for skin cell renewal, wound healing, and controlling sebum. One of the most effective acne supplements.", dosage: "30mg daily with food", rating: 86 },
    ],
    combos: [
      { name: "Clear Skin Protocol", herbs: ["Burdock Root", "Zinc", "Probiotics"], desc: "Purify blood + repair skin + fix gut-skin axis. Acne elimination from the inside out.", duration: "90 days" },
    ]
  },
  {
    id: "immune", name: "Immune & Lymphatic", emoji: "🛡️", y: 40, color: "#14b8a6",
    symptoms: ["Frequent illness", "Slow recovery", "Swollen lymph nodes", "Autoimmune issues", "Chronic fatigue"],
    herbs: [
      { name: "Elderberry", type: "Syrup", brand: "Sambucol (Sprouts)", desc: "Blocks viral replication. Reduces cold/flu severity and duration. The immune system's first responder.", dosage: "1 tbsp daily / 2 tbsp when sick", rating: 94 },
      { name: "Echinacea", type: "Tincture", brand: "Herb Pharm (Sprouts)", desc: "Activates white blood cells and macrophages. Best used at the first sign of illness for 7-10 days.", dosage: "40 drops every 2 hours when sick", rating: 88 },
      { name: "Astragalus", type: "Tincture/Capsule", brand: "Herb Pharm (Sprouts)", desc: "Deep immune builder used in Chinese medicine for 4,000 years. Increases T-cell production and telomere length.", dosage: "30 drops 2x daily", rating: 92 },
      { name: "Reishi Mushroom", type: "Capsule/Powder", brand: "Host Defense (Sprouts)", desc: "The 'mushroom of immortality.' Modulates immune response — calms overactive immunity, strengthens weak immunity.", dosage: "1000mg 2x daily", rating: 96 },
      { name: "Vitamin D3 + K2", type: "Drops", brand: "Garden of Life (Sprouts)", desc: "Activates 200+ antimicrobial peptides. Most people are severely deficient. The sunshine vitamin you're not getting.", dosage: "5000 IU D3 + 100mcg K2 daily", rating: 95 },
      { name: "Cleavers", type: "Tincture", brand: "Herb Pharm (Sprouts)", desc: "The lymphatic system's broom. Moves stagnant lymph, reduces swollen glands, and clears the body's drainage system.", dosage: "30 drops 3x daily", rating: 82 },
    ],
    combos: [
      { name: "Immune Fortress Protocol", herbs: ["Reishi", "Astragalus", "Vitamin D3"], desc: "Long-term immune building. Deep T-cell support + immune modulation + antimicrobial activation.", duration: "Ongoing" },
      { name: "Acute Illness Protocol", herbs: ["Elderberry", "Echinacea", "Oregano Oil", "Vitamin D3"], desc: "Hit it hard at first sign. Antiviral + immune activation + antimicrobial + immune peptides.", duration: "7-10 days" },
    ]
  },
];

function HealingSection() {
  const [selectedOrgan, setSelectedOrgan] = useState(null);
  const [selectedSymptoms, setSelectedSymptoms] = useState([]);
  const [showCombos, setShowCombos] = useState(false);
  const [savedHerbs, setSavedHerbs] = useState(new Set());
  const [searchTerm, setSearchTerm] = useState("");
  const [expandedProtocol, setExpandedProtocol] = useState(null);

  const toggleSymptom = (s) => setSelectedSymptoms(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);
  const toggleSave = (id) => setSavedHerbs(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  // Find matching organs based on selected symptoms
  const matchedOrgans = selectedSymptoms.length > 0
    ? BODY_ORGANS.filter(o => o.symptoms.some(s => selectedSymptoms.includes(s)))
    : [];

  const allSymptoms = [...new Set(BODY_ORGANS.flatMap(o => o.symptoms))];
  const totalHerbs = BODY_ORGANS.reduce((a, o) => a + o.herbs.length, 0);

  // Search results
  const searchResults = searchTerm ? BODY_ORGANS.flatMap(o =>
    o.herbs.filter(h => h.name.toLowerCase().includes(searchTerm.toLowerCase()) || h.desc.toLowerCase().includes(searchTerm.toLowerCase()))
      .map(h => ({ ...h, organ: o }))
  ) : [];

  // Detail view for selected organ
  if (selectedOrgan) {
    const organ = BODY_ORGANS.find(o => o.id === selectedOrgan);
    return (
      <div style={{ animation: "fadeInUp 0.4s ease" }}>
        <button onClick={() => { setSelectedOrgan(null); setShowCombos(false); }} style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)", color: "var(--text-muted)", padding: "8px 18px", borderRadius: 8, cursor: "pointer", fontSize: 11, letterSpacing: 2, fontFamily: "'Orbitron', sans-serif", marginBottom: 24 }}>← BACK TO BODY MAP</button>

        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 24 }}>
          <span style={{ fontSize: 48 }}>{organ.emoji}</span>
          <div>
            <h2 style={{ fontSize: 24, fontWeight: 600, color: "var(--text)", fontFamily: "'Orbitron', sans-serif", margin: 0, letterSpacing: 1 }}>{organ.name}</h2>
            <p style={{ fontSize: 12, color: "var(--text-faint)", marginTop: 4 }}>{organ.herbs.length} herbs & supplements • {organ.combos.length} protocols</p>
          </div>
        </div>

        {/* Symptoms this organ addresses */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 24 }}>
          {organ.symptoms.map(s => (
            <span key={s} style={{ fontSize: 10, padding: "4px 12px", borderRadius: 20, background: `${organ.color}12`, border: `1px solid ${organ.color}25`, color: organ.color, letterSpacing: 1 }}>{s}</span>
          ))}
        </div>

        {/* Toggle: Herbs vs Combos */}
        <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
          <button onClick={() => setShowCombos(false)} style={{ padding: "8px 20px", borderRadius: 8, background: !showCombos ? `${organ.color}15` : "rgba(255,255,255,0.03)", border: `1px solid ${!showCombos ? `${organ.color}40` : "rgba(255,255,255,0.06)"}`, color: !showCombos ? organ.color : "rgba(255,255,255,0.3)", cursor: "pointer", fontSize: 11, letterSpacing: 2, fontFamily: "'Orbitron', sans-serif" }}>INDIVIDUAL HERBS</button>
          <button onClick={() => setShowCombos(true)} style={{ padding: "8px 20px", borderRadius: 8, background: showCombos ? `${organ.color}15` : "rgba(255,255,255,0.03)", border: `1px solid ${showCombos ? `${organ.color}40` : "rgba(255,255,255,0.06)"}`, color: showCombos ? organ.color : "rgba(255,255,255,0.3)", cursor: "pointer", fontSize: 11, letterSpacing: 2, fontFamily: "'Orbitron', sans-serif" }}>PROTOCOLS & COMBOS</button>
        </div>

        {!showCombos ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {organ.herbs.map((herb, idx) => {
              const herbId = `${organ.id}-${idx}`;
              return (
                <GlassCard key={idx} hover={false} style={{ borderLeft: `3px solid ${organ.color}` }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                    <div>
                      <h3 style={{ fontSize: 16, fontWeight: 600, color: "var(--text)", margin: 0 }}>{herb.name}</h3>
                      <div style={{ display: "flex", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, background: "var(--card-bg)", color: "var(--text-faint)" }}>{herb.type}</span>
                        <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, background: "rgba(0,255,140,0.08)", color: "#00ff8c" }}>{herb.brand}</span>
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <div style={{ width: 36, height: 36, borderRadius: "50%", background: `${organ.color}15`, border: `2px solid ${organ.color}40`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: organ.color, fontFamily: "'Orbitron', sans-serif" }}>{herb.rating}</div>
                    </div>
                  </div>
                  <p style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.7, margin: "8px 0 12px" }}>{herb.desc}</p>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ fontSize: 11, color: "var(--text-faint)", fontFamily: "'JetBrains Mono', monospace" }}>DOSAGE: <span style={{ color: organ.color }}>{herb.dosage}</span></div>
                    <button onClick={() => toggleSave(herbId)} style={{ background: savedHerbs.has(herbId) ? `${organ.color}15` : "rgba(255,255,255,0.03)", border: `1px solid ${savedHerbs.has(herbId) ? `${organ.color}35` : "rgba(255,255,255,0.06)"}`, color: savedHerbs.has(herbId) ? organ.color : "rgba(255,255,255,0.3)", borderRadius: 6, padding: "4px 14px", cursor: "pointer", fontSize: 10, letterSpacing: 1, fontFamily: "'Orbitron', sans-serif" }}>{savedHerbs.has(herbId) ? "★ SAVED" : "☆ SAVE"}</button>
                  </div>
                </GlassCard>
              );
            })}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {organ.combos.map((combo, idx) => {
              const isExpanded = expandedProtocol === `${organ.id}-${idx}`;
              return (
              <GlassCard key={idx} hover={false} style={{ borderTop: `2px solid ${organ.color}40` }}>
                <div style={{ fontSize: 10, letterSpacing: 3, color: organ.color, fontFamily: "'Orbitron', sans-serif", marginBottom: 10 }}>⟡ PROTOCOL</div>
                <h3 style={{ fontSize: 18, fontWeight: 600, color: "var(--text)", margin: "0 0 8px" }}>{combo.name}</h3>
                <p style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.7, marginBottom: 16 }}>{combo.desc}</p>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
                  {combo.herbs.map(h => (
                    <span key={h} style={{ fontSize: 11, padding: "4px 14px", borderRadius: 20, background: `${organ.color}10`, border: `1px solid ${organ.color}25`, color: organ.color }}>{h}</span>
                  ))}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 11, color: "var(--text-faint)", fontFamily: "'JetBrains Mono', monospace" }}>DURATION: <span style={{ color: organ.color }}>{combo.duration}</span></span>
                  <button onClick={() => setExpandedProtocol(isExpanded ? null : `${organ.id}-${idx}`)} style={{ background: isExpanded ? `${organ.color}20` : `${organ.color}12`, border: `1px solid ${organ.color}30`, color: organ.color, borderRadius: 6, padding: "6px 18px", cursor: "pointer", fontSize: 10, letterSpacing: 2, fontFamily: "'Orbitron', sans-serif" }}>{isExpanded ? "HIDE DETAILS" : "START PROTOCOL"}</button>
                </div>
                {isExpanded && (
                  <div style={{ marginTop: 20, padding: "20px 0 0", borderTop: `1px solid ${organ.color}15`, animation: "fadeInUp 0.3s ease" }}>
                    <span style={{ fontSize: 10, letterSpacing: 3, color: "var(--text-faint)", fontFamily: "'Orbitron', sans-serif", display: "block", marginBottom: 14 }}>DAILY SCHEDULE</span>
                    {[
                      { time: "Morning (empty stomach)", instruction: `Take ${combo.herbs[0]} first thing with warm water. Wait 20 minutes before eating.` },
                      { time: "With breakfast", instruction: combo.herbs.length > 1 ? `Take ${combo.herbs[1]} with your first meal for better absorption.` : "Continue with a nutrient-dense breakfast to support absorption." },
                      { time: combo.herbs.length > 2 ? "Afternoon" : "Evening", instruction: combo.herbs.length > 2 ? `Take ${combo.herbs[2]} between meals for maximum bioavailability.` : `Take your second dose of ${combo.herbs[0]} if recommended.` },
                      { time: "Before bed", instruction: "Drink warm water with lemon. Rest is when your body does its deepest healing and repair work." },
                    ].map((step, si) => (
                      <div key={si} style={{ display: "flex", gap: 14, marginBottom: 14 }}>
                        <div style={{ width: 6, height: 6, borderRadius: "50%", background: organ.color, marginTop: 7, flexShrink: 0 }} />
                        <div>
                          <span style={{ fontSize: 12, color: organ.color, fontWeight: 600 }}>{step.time}</span>
                          <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "2px 0 0", lineHeight: 1.6 }}>{step.instruction}</p>
                        </div>
                      </div>
                    ))}
                    <div style={{ marginTop: 14, padding: "12px 16px", borderRadius: 8, background: `${organ.color}06`, border: `1px solid ${organ.color}12` }}>
                      <p style={{ fontSize: 11, color: "var(--text-faint)", margin: 0, lineHeight: 1.6 }}>
                        <strong style={{ color: organ.color }}>Tips:</strong> Take consistently for the full {combo.duration} duration. Keep a journal to track changes. Drink at least 8 glasses of clean water daily. Healing is not linear — some days will feel like setbacks. Trust the process.
                      </p>
                    </div>
                  </div>
                )}
              </GlassCard>
              );
            })}
          </div>
        )}

        <div style={{ marginTop: 24, padding: 16, borderRadius: 10, background: "var(--card-bg)", border: "1px solid var(--card-border)", textAlign: "center" }}>
          <p style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "'JetBrains Mono', monospace", margin: 0 }}>*These statements have not been evaluated by the FDA. This information is for educational purposes. Consult a healthcare practitioner before starting any supplement regimen.</p>
        </div>
      </div>
    );
  }

  // ─── Main HEALING View with Body Map ───
  return (
    <div style={{ animation: "fadeInUp 0.5s ease" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
        <div style={{ width: 3, height: 28, background: "linear-gradient(to bottom, #22c55e, #06b6d4)", borderRadius: 2 }} />
        <h2 style={{ fontSize: 22, fontWeight: 300, color: "var(--text)", fontFamily: "'Sora', sans-serif", margin: 0 }}>HEALING</h2>
      </div>
      <p style={{ fontSize: 13, color: "var(--text-faint)", lineHeight: 1.8, marginTop: 8, marginBottom: 24 }}>
        {totalHerbs} herbs & supplements mapped to {BODY_ORGANS.length} organ systems. Select your symptoms or tap a body area to find your medicine. Available at Sprouts Farmers Market.
      </p>

      {/* Search */}
      <input value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="Search herbs... (turmeric, ashwagandha, milk thistle...)"
        style={{ width: "100%", background: "var(--card-bg)", border: "1px solid var(--card-border)", borderRadius: 10, padding: "14px 20px", color: "var(--text)", fontSize: 14, outline: "none", fontFamily: "'JetBrains Mono', monospace", marginBottom: 20 }} />

      {searchTerm && searchResults.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <span style={{ fontSize: 10, color: "var(--text-faint)", letterSpacing: 2 }}>{searchResults.length} RESULTS</span>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
            {searchResults.slice(0, 6).map((h, i) => (
              <GlassCard key={i} onClick={() => setSelectedOrgan(h.organ.id)} style={{ padding: 16, cursor: "pointer", borderLeft: `3px solid ${h.organ.color}` }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <div>
                    <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>{h.name}</span>
                    <span style={{ fontSize: 11, color: h.organ.color, marginLeft: 10 }}>{h.organ.emoji} {h.organ.name}</span>
                  </div>
                  <span style={{ fontSize: 10, color: "#00ff8c" }}>{h.brand}</span>
                </div>
                <p style={{ fontSize: 12, color: "var(--text-faint)", margin: "6px 0 0", lineHeight: 1.5 }}>{h.desc.substring(0, 100)}...</p>
              </GlassCard>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
        {/* ─── Interactive Body Map ─── */}
        <GlassCard hover={false} style={{ flex: "0 0 280px", padding: "24px 20px", textAlign: "center" }}>
          <span style={{ fontSize: 10, letterSpacing: 3, color: "var(--text-faint)", fontFamily: "'Orbitron', sans-serif", display: "block", marginBottom: 16 }}>TAP AN ORGAN SYSTEM</span>
          <div style={{ position: "relative", height: 520, margin: "0 auto", maxWidth: 200 }}>
            {/* Body outline */}
            <div style={{ position: "absolute", left: "50%", top: "5%", width: 60, height: 60, borderRadius: "50%", border: "1px solid var(--card-border)", transform: "translateX(-50%)" }} />
            <div style={{ position: "absolute", left: "50%", top: "16%", width: 80, height: 120, borderRadius: "40px 40px 30px 30px", border: "1px solid var(--card-border)", transform: "translateX(-50%)" }} />
            <div style={{ position: "absolute", left: "50%", top: "42%", width: 70, height: 90, borderRadius: "10px 10px 30px 30px", border: "1px solid var(--card-border)", transform: "translateX(-50%)" }} />
            <div style={{ position: "absolute", left: "25%", top: "62%", width: 30, height: 120, borderRadius: 15, border: "1px solid var(--card-border)" }} />
            <div style={{ position: "absolute", right: "25%", top: "62%", width: 30, height: 120, borderRadius: 15, border: "1px solid var(--card-border)" }} />

            {/* Organ hotspots */}
            {BODY_ORGANS.map(organ => (
              <button key={organ.id} onClick={() => setSelectedOrgan(organ.id)} title={organ.name}
                style={{
                  position: "absolute", left: "50%", top: `${organ.y}%`,
                  transform: "translate(-50%, -50%)",
                  width: 36, height: 36, borderRadius: "50%",
                  background: `${organ.color}20`, border: `2px solid ${organ.color}50`,
                  cursor: "pointer", fontSize: 16, display: "flex",
                  alignItems: "center", justifyContent: "center",
                  boxShadow: `0 0 15px ${organ.color}30`,
                  transition: "all 0.3s ease",
                  animation: "orbPulse 3s ease-in-out infinite",
                  animationDelay: `${Math.random() * 2}s`,
                  zIndex: 5,
                }}
                onMouseEnter={e => { e.currentTarget.style.transform = "translate(-50%, -50%) scale(1.3)"; e.currentTarget.style.boxShadow = `0 0 25px ${organ.color}60`; }}
                onMouseLeave={e => { e.currentTarget.style.transform = "translate(-50%, -50%) scale(1)"; e.currentTarget.style.boxShadow = `0 0 15px ${organ.color}30`; }}
              >{organ.emoji}</button>
            ))}
          </div>
        </GlassCard>

        {/* ─── Symptom Matcher ─── */}
        <div style={{ flex: 1, minWidth: 300 }}>
          <GlassCard hover={false} style={{ marginBottom: 16 }}>
            <span style={{ fontSize: 10, letterSpacing: 3, color: "#00ff8c", fontFamily: "'Orbitron', sans-serif", display: "block", marginBottom: 14 }}>⟡ SYMPTOM MATCHER — SELECT YOUR SYMPTOMS</span>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {allSymptoms.map(s => {
                const isSelected = selectedSymptoms.includes(s);
                const matchOrgan = BODY_ORGANS.find(o => o.symptoms.includes(s));
                return (
                  <button key={s} onClick={() => toggleSymptom(s)} style={{
                    padding: "5px 12px", borderRadius: 20, fontSize: 11, cursor: "pointer",
                    transition: "all 0.2s ease",
                    background: isSelected ? `${matchOrgan.color}15` : "rgba(255,255,255,0.03)",
                    border: `1px solid ${isSelected ? `${matchOrgan.color}40` : "rgba(255,255,255,0.06)"}`,
                    color: isSelected ? matchOrgan.color : "rgba(255,255,255,0.35)",
                  }}>{s}</button>
                );
              })}
            </div>
            {selectedSymptoms.length > 0 && (
              <button onClick={() => setSelectedSymptoms([])} style={{ marginTop: 12, background: "none", border: "none", color: "var(--text-dim)", cursor: "pointer", fontSize: 11 }}>Clear all</button>
            )}
          </GlassCard>

          {/* Matched Results */}
          {matchedOrgans.length > 0 && (
            <div>
              <span style={{ fontSize: 10, letterSpacing: 3, color: "#00ff8c", fontFamily: "'Orbitron', sans-serif", display: "block", marginBottom: 12 }}>MATCHED ORGAN SYSTEMS</span>
              {matchedOrgans.map(organ => (
                <GlassCard key={organ.id} onClick={() => setSelectedOrgan(organ.id)} style={{ marginBottom: 12, cursor: "pointer", borderLeft: `3px solid ${organ.color}` }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span style={{ fontSize: 28 }}>{organ.emoji}</span>
                    <div style={{ flex: 1 }}>
                      <h3 style={{ fontSize: 15, fontWeight: 600, color: "var(--text)", margin: 0 }}>{organ.name}</h3>
                      <p style={{ fontSize: 11, color: "var(--text-faint)", margin: "4px 0 0" }}>{organ.herbs.length} herbs • {organ.combos.length} protocols</p>
                    </div>
                    <span style={{ fontSize: 11, color: organ.color, letterSpacing: 2, fontFamily: "'Orbitron', sans-serif" }}>VIEW →</span>
                  </div>
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 10 }}>
                    {organ.herbs.slice(0, 3).map(h => (
                      <span key={h.name} style={{ fontSize: 9, padding: "2px 8px", borderRadius: 12, background: `${organ.color}10`, color: `${organ.color}aa`, border: `1px solid ${organ.color}20` }}>{h.name}</span>
                    ))}
                    {organ.herbs.length > 3 && <span style={{ fontSize: 9, color: organ.color }}>+{organ.herbs.length - 3}</span>}
                  </div>
                </GlassCard>
              ))}
            </div>
          )}

          {/* Browse All Systems */}
          {matchedOrgans.length === 0 && !searchTerm && (
            <div>
              <span style={{ fontSize: 10, letterSpacing: 3, color: "var(--text-faint)", fontFamily: "'Orbitron', sans-serif", display: "block", marginBottom: 12 }}>ALL ORGAN SYSTEMS</span>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {BODY_ORGANS.map(organ => (
                  <GlassCard key={organ.id} onClick={() => setSelectedOrgan(organ.id)} style={{ padding: 18, cursor: "pointer", borderLeft: `3px solid ${organ.color}` }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <span style={{ fontSize: 24 }}>{organ.emoji}</span>
                      <div style={{ flex: 1 }}>
                        <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>{organ.name}</span>
                        <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 2 }}>{organ.herbs.length} herbs • {organ.combos.length} protocols</div>
                      </div>
                      <span style={{ fontSize: 10, color: organ.color, fontFamily: "'Orbitron', sans-serif" }}>→</span>
                    </div>
                  </GlassCard>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: "flex", gap: 16, marginTop: 28, flexWrap: "wrap" }}>
        {[
          { label: "Total Herbs", value: totalHerbs, color: "#22c55e" },
          { label: "Organ Systems", value: BODY_ORGANS.length, color: "#06b6d4" },
          { label: "Protocols", value: BODY_ORGANS.reduce((a, o) => a + o.combos.length, 0), color: "#a78bfa" },
          { label: "Saved", value: savedHerbs.size, color: "#eab308" },
        ].map(s => (
          <div key={s.label} style={{ flex: "1 1 130px", padding: "18px 20px", borderRadius: 12, textAlign: "center", background: `linear-gradient(135deg, ${s.color}08, ${s.color}03)`, border: `1px solid ${s.color}15`, boxShadow: `0 4px 20px ${s.color}08, inset 0 1px 0 rgba(255,255,255,0.03)` }}>
            <div style={{ fontSize: 24, fontWeight: 700, color: s.color, fontFamily: "'Orbitron', sans-serif", textShadow: `0 0 20px ${s.color}30` }}>{s.value}</div>
            <div style={{ fontSize: 9, color: "var(--text-faint)", letterSpacing: 2, textTransform: "uppercase", marginTop: 6, fontFamily: "'Sora', sans-serif", fontWeight: 500 }}>{s.label}</div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 24, padding: 16, borderRadius: 10, background: "var(--card-bg)", border: "1px solid var(--card-border)", textAlign: "center" }}>
        <p style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "'JetBrains Mono', monospace", margin: 0 }}>*Products referenced from Sprouts Farmers Market, Herb Pharm, Garden of Life, Host Defense, and other brands. Statements not evaluated by the FDA. For educational purposes only.</p>
      </div>
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════
// MEDITATION ZONE — Full Practice System
// ═══════════════════════════════════════════════════════════════

const ZEN_PRACTICES = [
  {
    id: "478", name: "4-7-8 Breathwork", type: "Breathwork", dur: "8 min", color: "#00ff8c", icon: "🌬️",
    desc: "The Navy SEAL breathing technique. Activates the parasympathetic nervous system in under 60 seconds. Inhale 4 counts, hold 7, exhale 8.",
    steps: [
      "Find a comfortable seated position. Spine straight, shoulders relaxed, eyes closed.",
      "Exhale completely through your mouth with a whoosh sound, emptying your lungs.",
      "Close your mouth. Inhale quietly through your nose for 4 counts.",
      "Hold your breath for 7 counts. This is where the magic happens — your blood is oxygenating deeply.",
      "Exhale completely through your mouth for 8 counts with a whoosh sound.",
      "This is one cycle. Repeat for 4 cycles minimum, up to 8 cycles.",
      "Notice: by cycle 3, your heart rate has slowed. Your biofield is expanding. You've shifted from sympathetic to parasympathetic dominance.",
    ],
    science: "Developed by Dr. Andrew Weil based on pranayama. The extended exhale stimulates the vagus nerve, which directly controls the parasympathetic nervous system. Studies show it reduces cortisol by up to 23% in a single session.",
    hasTimer: true,
  },
  {
    id: "morning", name: "Morning Calibration", type: "Meditation", dur: "12 min", color: "#06b6d4", icon: "🌅",
    desc: "Set your electromagnetic field for the day. A combination of gratitude, visualization, and intention-setting that creates heart coherence before the world gets to you.",
    steps: [
      "Sit upright before touching your phone. The first 10 minutes after waking, your brain is in theta — the most programmable state.",
      "Place both hands over your heart. Feel its rhythm. This is your body's strongest electromagnetic generator.",
      "Breathe deeply for 2 minutes. In through the nose, out through the mouth. Slow. Deliberate.",
      "Think of 3 things you're genuinely grateful for. Don't just list them — FEEL the gratitude in your chest. HeartMath research shows this creates immediate field coherence.",
      "Visualize your day going exactly as you want it. See specific moments. Feel the emotions. Your brain cannot distinguish between a vividly imagined experience and a real one.",
      "Set one clear intention for the day. Not a task — an energy. 'I will move through this day with calm power.'",
      "Open your eyes. You've just programmed your reticular activating system and set your biofield to broadcast a coherent signal. The day responds to this.",
    ],
    science: "The first 10 minutes after waking, brainwave patterns transition from theta (4-8Hz) to alpha (8-12Hz). This window is when the subconscious is most receptive to programming. Heart-focused gratitude creates measurable coherence in the heart's electromagnetic field within 60 seconds (HeartMath Institute).",
  },
  {
    id: "nervous", name: "Nervous System Reset", type: "Breathwork", dur: "8 min", color: "#00ff8c", icon: "⚡",
    desc: "Emergency reset for when you're stuck in fight-or-flight. This protocol directly stimulates the vagus nerve and forces your body back to safety.",
    steps: [
      "You're going to do physiological sighs — the fastest known way to calm the nervous system.",
      "Double inhale through the nose: a full breath in, then a quick second sip of air on top (this re-inflates collapsed alveoli in the lungs).",
      "Slow, extended exhale through the mouth — as long and slow as you can.",
      "Repeat 5 times. You'll feel a shift by the 3rd one.",
      "Now: cold water on the wrists and neck for 30 seconds if available. The dive reflex activates the vagus nerve instantly.",
      "Hum or sing for 2 minutes. The vibration of humming stimulates the vagus nerve where it passes through the vocal cords.",
      "Finish with 2 minutes of box breathing: in 4, hold 4, out 4, hold 4. You are now back in parasympathetic dominance.",
    ],
    science: "The physiological sigh was identified by Stanford neuroscientist Dr. Andrew Huberman as the fastest real-time method to reduce autonomic arousal. The double inhale maximally inflates the lungs, and the long exhale offloads CO2, directly signaling safety to the brainstem.",
  },
  {
    id: "chakra", name: "Chakra Alignment Flow", type: "Yoga", dur: "20 min", color: "#a78bfa", icon: "🧘",
    desc: "A sequence of 7 poses, one for each chakra, moving from root to crown. Opens energy centers and restores flow through the central channel.",
    steps: [
      "ROOT — Malasana (Deep Squat): Feet wide, squat deep, hands at heart center. Feel the earth beneath you. 2 minutes. Breathe into the base of your spine.",
      "SACRAL — Bound Angle (Baddha Konasana): Seated, soles of feet together, knees wide. Gentle forward fold. 2 minutes. Breathe into the lower belly.",
      "SOLAR PLEXUS — Boat Pose (Navasana): Balance on sit bones, legs extended, arms parallel. Hold 60 seconds. Feel the fire in your core. Rest. Repeat.",
      "HEART — Camel Pose (Ustrasana): Kneel, hands on lower back, open the chest to the sky. Heart wide open. 90 seconds. Breathe into the space behind your sternum.",
      "THROAT — Shoulderstand (Sarvangasana): Lie back, lift legs and hips overhead, hands supporting lower back. Chin to chest compresses the throat chakra. 2 minutes.",
      "THIRD EYE — Child's Pose (Balasana): Kneel, fold forward, forehead on the ground. Apply gentle pressure to the third eye point. 2 minutes. Let thoughts dissolve.",
      "CROWN — Headstand or Savasana: Either invert fully (headstand) or lie flat in corpse pose with palms up. 3-5 minutes. This is integration. Don't skip it.",
    ],
    science: "Yoga poses create specific patterns of compression and release in the endocrine glands associated with each chakra position. Forward folds stimulate the adrenals. Backbends open the thymus. Inversions flood the brain with blood and stimulate the pineal and pituitary glands.",
  },
  {
    id: "presence", name: "Deep Presence", type: "Meditation", dur: "15 min", color: "#06b6d4", icon: "🔵",
    desc: "Pure awareness meditation. No mantras, no visualization, no goals. Just the practice of being the witness — the consciousness behind the thoughts.",
    steps: [
      "Sit. Spine straight. Hands on knees, palms up or down — your choice.",
      "Close your eyes. Take 3 deep breaths to arrive.",
      "Now stop controlling the breath. Let it breathe itself.",
      "Notice thoughts arising. Don't push them away. Don't follow them. Just notice: 'There's a thought.' Let it pass like a cloud.",
      "Rest your attention on the space BETWEEN thoughts. That gap — however brief — is pure consciousness. That's what you actually are.",
      "When you get pulled into a thought story (and you will), the moment you notice you were thinking IS the moment of awakening. That noticing is the practice.",
      "Continue for 15 minutes. Some sits will feel profound. Some will feel like wrestling cats. Both are the practice. Consistency matters more than quality.",
      "Before opening your eyes, notice: who was watching the thoughts? That awareness — silent, unchanging, always present — that's your true nature.",
    ],
    science: "Vipassana-style awareness meditation has been shown to increase cortical thickness in the prefrontal cortex, reduce amygdala reactivity, and increase gray matter density in regions associated with self-awareness. Long-term meditators show measurably different brainwave patterns including sustained gamma waves (40Hz+), the fastest brainwave state, associated with heightened perception and consciousness.",
  },
  {
    id: "activation", name: "Energy Activation", type: "Breathwork", dur: "10 min", color: "#00ff8c", icon: "🔥",
    desc: "Wim Hof-inspired power breathing. Floods the body with oxygen, alkalizes the blood, and creates a controlled stress response that strengthens the immune system.",
    steps: [
      "WARNING: Do this seated or lying down. Never in water or while driving. You may feel tingling, lightheadedness — this is normal.",
      "Round 1: Take 30 deep, fast breaths — in through the nose, out through the mouth. Fill the belly, then the chest. Let the exhale fall out passively.",
      "After breath 30: exhale and HOLD. Empty lungs. See how long you can hold. Don't force it. When you need to breathe, take one deep recovery breath and hold for 15 seconds.",
      "Round 2: Repeat 30 breaths. Your hold time will be longer this time. The body is alkalizing.",
      "Round 3: Same thing. By now your hold time may be 90+ seconds. Tingling in hands and face is normal — that's vasoconstriction from alkalinity.",
      "After the final round, breathe normally for 2 minutes. Notice: you feel electric. Alert. Alive. Your cells just got flushed with oxygen.",
      "Optional: cold shower for 30 seconds. The combination of breathwork + cold = full sympathetic reset followed by parasympathetic rebound.",
    ],
    science: "Wim Hof method has been studied at Radboud University. Practitioners voluntarily influenced their autonomic nervous system and immune response — something previously considered impossible. The breathing creates intermittent hypoxia, which triggers EPO production, increases brown fat activation, and strengthens mitochondrial function.",
  },
  {
    id: "stillness", name: "Sacred Stillness", type: "Deep Work", dur: "30 min", color: "#eab308", icon: "✨",
    desc: "30 minutes of complete non-doing. No meditation technique. No breathwork. No phone. No music. Just you, existing. The most radical practice in a world addicted to stimulation.",
    steps: [
      "Set a timer for 30 minutes. Put your phone in another room.",
      "Sit or lie down. Don't try to meditate. Don't try to breathe a certain way. Don't try to think or not think.",
      "Just be. Like a cat in a sunbeam. No agenda. No goal. No practice.",
      "The first 5-10 minutes will be uncomfortable. Your mind will scream for input. This is withdrawal from stimulation addiction. Feel it.",
      "Around minute 10-15, something shifts. The noise starts to quiet. The urgency dissolves. You start to hear the silence behind the silence.",
      "In the final 10 minutes, you may experience: deep peace, creative insights surfacing, emotional release, a sense of spaciousness, or simply rest at a level you haven't experienced in years.",
      "When the timer sounds, sit for one more minute before re-engaging with the world. Notice how differently you perceive everything.",
      "This is not wasted time. This is the most productive 30 minutes you can spend. Creativity, insight, and healing all require space. This practice creates that space.",
    ],
    science: "The Default Mode Network (DMN) — the brain network associated with creativity, self-reflection, and insight — activates during periods of non-directed thought. Constant stimulation suppresses the DMN. Boredom and stillness are prerequisites for creative breakthroughs. Einstein, Newton, and Tesla all attributed their greatest insights to periods of intentional non-doing.",
  },
];

// ═══════════════════════════════════════════════════════════════
// HEAL DISEASE — Diseases, Herbs, and the Parasite Connection
// ═══════════════════════════════════════════════════════════════

const DISEASES = [
  {
    id: "diabetes", name: "Diabetes (Type 2)", icon: "🩸", color: "#ef4444",
    desc: "Blood sugar dysregulation driven by insulin resistance, inflammation, and often underlying infections. The body stops responding to insulin, glucose rises, and cellular starvation in the midst of plenty begins.",
    herbs: [
      { name: "Bitter Melon", info: "Contains charantin and polypeptide-p — both act like insulin. Used in Ayurveda for centuries." },
      { name: "Cinnamon (Ceylon)", info: "Improves insulin sensitivity and lowers fasting glucose. Use Ceylon, not Cassia (which is toxic in large doses)." },
      { name: "Berberine", info: "As effective as Metformin in studies. Lowers blood sugar, improves gut bacteria, reduces inflammation." },
      { name: "Fenugreek", info: "Soluble fiber slows carb absorption. Seeds soaked overnight and taken in the morning." },
      { name: "Gymnema Sylvestre", info: "The 'sugar destroyer' — blocks sweet taste receptors and helps regenerate pancreatic beta cells." },
      { name: "Turmeric", info: "Curcumin reduces insulin resistance and systemic inflammation." },
    ],
    lifestyle: "Intermittent fasting, eliminating refined carbs and seed oils, daily walking, strength training, and deep sleep. Many Type 2 cases are reversible within 6-12 months.",
  },
  {
    id: "cancer", name: "Cancer", icon: "⚠️", color: "#dc2626",
    desc: "Uncontrolled cell growth, often triggered by a combination of inflammation, toxic overload, mitochondrial dysfunction, and suppressed immune function. Otto Warburg won the Nobel Prize for showing cancer is fundamentally a metabolic disease — cancer cells ferment glucose instead of using oxygen.",
    herbs: [
      { name: "Soursop (Graviola)", info: "Acetogenins shown in studies to target cancer cells while sparing healthy ones. Used traditionally in the Amazon." },
      { name: "Turmeric (Curcumin)", info: "Over 3,000 studies. Induces apoptosis in cancer cells, reduces angiogenesis, and lowers inflammation markers." },
      { name: "Black Seed (Nigella Sativa)", info: "Thymoquinone shows anti-tumor properties in multiple cancer types. Called 'the remedy for everything but death' in Islamic tradition." },
      { name: "Chaga Mushroom", info: "Highest antioxidant food on Earth (ORAC score). Used in Siberian folk medicine for centuries against tumors." },
      { name: "Essiac Tea", info: "Ojibwe formula: burdock, sheep sorrel, slippery elm, rhubarb. Rene Caisse used it successfully with cancer patients for 50 years." },
      { name: "Cannabis (CBD/THC)", info: "Cannabinoids induce apoptosis in various cancer lines. Rick Simpson Oil protocols documented with case reports." },
      { name: "Apricot Kernels (B17/Amygdalin)", info: "Controversial but historically used. Contains amygdalin which is said to target cancer cells selectively." },
    ],
    lifestyle: "Eliminate sugar completely (cancer cells consume 18-20x more glucose than healthy cells). Ketogenic or carnivore diet. Sunlight. Grounding. Eliminate toxins. Detox heavy metals. Address emotional trauma.",
  },
  {
    id: "heart", name: "Heart Disease", icon: "💔", color: "#ef4444",
    desc: "Often mislabeled as a cholesterol problem. The real drivers: chronic inflammation, oxidative stress, insulin resistance, nutrient deficiencies (magnesium, potassium, CoQ10), and endothelial damage from sugar and seed oils.",
    herbs: [
      { name: "Hawthorn Berry", info: "The cardiac herb. Strengthens heart muscle, improves circulation, normalizes blood pressure and rhythm." },
      { name: "Garlic", info: "Lowers blood pressure, reduces arterial plaque, improves circulation. Raw is most potent." },
      { name: "Cayenne Pepper", info: "Dr. John Christopher famously used it to reverse heart attacks. Improves circulation instantly." },
      { name: "Arjuna", info: "Ayurvedic heart tonic. Strengthens cardiac muscle and improves ejection fraction." },
      { name: "CoQ10", info: "Statins deplete this critical mitochondrial nutrient. Supplementing restores cellular energy to the heart." },
      { name: "Magnesium", info: "Deficient in 80%+ of Americans. Prevents arrhythmias, relaxes blood vessels, lowers blood pressure." },
    ],
    lifestyle: "Eliminate seed oils and refined sugar. Increase omega-3s from wild fish. Walk daily. Manage stress. Cold exposure. Saunas (reduce cardiac events by 50% per Finnish studies).",
  },
  {
    id: "autoimmune", name: "Autoimmune Conditions", icon: "🛡️", color: "#f97316",
    desc: "The immune system attacks the body itself. Often triggered by leaky gut, chronic infections (including parasites), environmental toxins, and food sensitivities. Includes Hashimoto's, lupus, rheumatoid arthritis, MS, psoriasis.",
    herbs: [
      { name: "Turmeric", info: "Powerful anti-inflammatory. Reduces autoimmune flare-ups across multiple conditions." },
      { name: "Boswellia", info: "Frankincense extract. Blocks inflammatory pathways without side effects of pharma drugs." },
      { name: "Reishi Mushroom", info: "Immune modulator — it balances the immune system rather than stimulating it. Ideal for autoimmune." },
      { name: "Ashwagandha", info: "Adaptogen that reduces cortisol and helps regulate immune response." },
      { name: "Licorice Root (DGL)", info: "Heals the gut lining, which is often the root of autoimmune disease." },
      { name: "Slippery Elm", info: "Soothes and heals the intestinal mucosa. Reduces leaky gut." },
    ],
    lifestyle: "Elimination diet (remove gluten, dairy, sugar, processed foods). Heal the gut first. Reduce stress. Address hidden infections including parasites. Sunlight and vitamin D.",
  },
  {
    id: "digestive", name: "Digestive Issues (IBS, SIBO, Leaky Gut)", icon: "🌿", color: "#22c55e",
    desc: "The gut is the foundation of health. 70% of the immune system lives here. Modern diets, antibiotics, stress, and parasites destroy the gut lining and microbiome, leading to cascading health problems.",
    herbs: [
      { name: "Slippery Elm", info: "Coats and heals the entire GI tract. Taken as a tea or powder mixed with water." },
      { name: "Marshmallow Root", info: "Mucilaginous herb that soothes inflammation throughout the digestive tract." },
      { name: "L-Glutamine", info: "Amino acid that rebuilds the intestinal lining. The primary fuel for gut cells." },
      { name: "Ginger", info: "Stimulates digestion, reduces nausea, kills parasites, speeds stomach emptying." },
      { name: "Peppermint Oil", info: "Enteric-coated capsules shown to relieve IBS symptoms as effectively as pharmaceuticals." },
      { name: "Aloe Vera (inner leaf)", info: "Soothes inflammation and heals ulcers throughout the digestive tract." },
      { name: "Probiotic Foods", info: "Raw sauerkraut, kefir, kimchi, yogurt. Restore the microbiome naturally." },
    ],
    lifestyle: "Remove gluten, dairy, and processed foods. Eat bone broth daily. Chew thoroughly. Don't drink water with meals (dilutes stomach acid). Manage stress — the gut-brain axis is real.",
  },
  {
    id: "mental", name: "Anxiety & Depression", icon: "🧠", color: "#a78bfa",
    desc: "Often treated as chemical imbalances, but research increasingly shows root causes include gut dysbiosis, inflammation, trauma, nutrient deficiencies, blood sugar swings, and chronic infections. The gut produces 90% of your serotonin.",
    herbs: [
      { name: "Ashwagandha", info: "Reduces cortisol, calms the nervous system, improves sleep. The premier adaptogen." },
      { name: "Rhodiola Rosea", info: "Fights fatigue and depression. Used by Russian cosmonauts and Olympic athletes." },
      { name: "St. John's Wort", info: "As effective as SSRIs for mild to moderate depression in multiple studies. Cannot be combined with pharmaceuticals." },
      { name: "Saffron", info: "Studies show it matches Prozac for depression without side effects. Expensive but potent." },
      { name: "Lion's Mane Mushroom", info: "Stimulates nerve growth factor (NGF). Regenerates brain tissue and reduces anxiety." },
      { name: "Lemon Balm", info: "Gentle calming herb. Reduces anxiety and improves sleep without drowsiness." },
      { name: "Chamomile", info: "Mild anxiolytic effects. German studies show it works as well as pharmaceuticals for generalized anxiety." },
    ],
    lifestyle: "Sunlight daily. Movement (as effective as antidepressants). Eliminate seed oils and sugar. Heal the gut. Cold exposure. Meditation. Address trauma. Parasites can cause dramatic mood changes.",
  },
  {
    id: "chronic-fatigue", name: "Chronic Fatigue & Fibromyalgia", icon: "😴", color: "#06b6d4",
    desc: "Mitochondrial dysfunction at the cellular level. The body's energy factories aren't producing ATP efficiently. Root causes often include chronic infections (Epstein-Barr, Lyme, parasites), heavy metals, mold, and nutrient deficiencies.",
    herbs: [
      { name: "Cordyceps Mushroom", info: "Directly boosts ATP production in mitochondria. Used by Chinese Olympic athletes." },
      { name: "Rhodiola", info: "Fights physical and mental fatigue. Improves oxygen utilization." },
      { name: "Ashwagandha", info: "Balances HPA axis dysfunction common in chronic fatigue." },
      { name: "Ginseng (Panax)", info: "Classic energy tonic. Restores adrenal function and cellular energy." },
      { name: "Magnesium (Glycinate)", info: "Critical for ATP production. Deficiency mimics chronic fatigue." },
      { name: "B-Complex Vitamins", info: "Essential cofactors for energy production. B12 and methylfolate especially important." },
      { name: "CoQ10 (Ubiquinol)", info: "Direct mitochondrial fuel. Dramatically improves energy in fatigue patients." },
    ],
    lifestyle: "Morning sunlight. Gentle movement. Cold showers. Address hidden infections. Test for parasites and mold. Heal the gut. Prioritize sleep (8-9 hours).",
  },
  {
    id: "thyroid", name: "Thyroid Disorders", icon: "🦋", color: "#eab308",
    desc: "Hashimoto's (hypo) and Graves' (hyper) are autoimmune conditions. The thyroid is extremely sensitive to toxins, especially fluoride, bromine, and heavy metals. Iodine deficiency plus gut dysbiosis is a common combination.",
    herbs: [
      { name: "Ashwagandha", info: "Balances thyroid function in both directions. Works for hypo and hyper cases." },
      { name: "Bladderwrack", info: "Natural iodine source. Used for hypothyroidism historically." },
      { name: "Selenium (Brazil Nuts)", info: "Essential for thyroid hormone conversion. 2-3 Brazil nuts daily provides adequate amounts." },
      { name: "Guggul", info: "Ayurvedic herb that supports thyroid function and metabolism." },
      { name: "Lemon Balm", info: "Specifically for Graves' disease. Calms overactive thyroid." },
      { name: "Motherwort", info: "Reduces heart palpitations associated with hyperthyroidism." },
    ],
    lifestyle: "Eliminate fluoride (filter water). Reduce gluten (molecular mimicry). Heal the gut. Test for parasites. Manage stress. Sunlight for vitamin D.",
  },
  {
    id: "arthritis", name: "Arthritis & Joint Pain", icon: "🦴", color: "#f97316",
    desc: "Inflammation in the joints. Often driven by diet (sugar, seed oils, nightshades in some), gut issues, and sometimes undiagnosed infections. Rheumatoid is autoimmune; osteoarthritis is degenerative but preventable.",
    herbs: [
      { name: "Turmeric + Black Pepper", info: "The black pepper (piperine) increases curcumin absorption 2000%. Potent anti-inflammatory." },
      { name: "Boswellia", info: "Blocks inflammatory enzymes. As effective as NSAIDs without stomach damage." },
      { name: "Ginger", info: "Strong anti-inflammatory. Shown to reduce arthritis pain in clinical studies." },
      { name: "Devil's Claw", info: "African herb specifically for joint pain and inflammation." },
      { name: "Cat's Claw", info: "Amazonian herb with potent anti-inflammatory and immune-modulating effects." },
      { name: "MSM (Methylsulfonylmethane)", info: "Organic sulfur that supports joint and cartilage health." },
      { name: "Collagen", info: "Rebuilds cartilage. Bone broth is the traditional source." },
    ],
    lifestyle: "Eliminate sugar and seed oils. Try eliminating nightshades for 30 days. Bone broth daily. Cold plunges and saunas. Movement is medicine — don't stop moving.",
  },
  {
    id: "skin", name: "Skin Conditions (Eczema, Psoriasis, Acne)", icon: "🌸", color: "#ec4899",
    desc: "Skin issues are almost always gut issues manifesting externally. The skin is a detox organ — when the liver and gut can't handle toxins, they come out through the skin. Often connected to hidden parasites.",
    herbs: [
      { name: "Burdock Root", info: "The premier blood purifier. Used for generations for skin conditions." },
      { name: "Milk Thistle", info: "Supports liver detoxification, which clears the skin." },
      { name: "Dandelion Root", info: "Liver and kidney support. Clears skin from within." },
      { name: "Neem", info: "Antibacterial, antifungal, anti-parasitic. Taken internally and applied topically." },
      { name: "Oregano Oil", info: "Antimicrobial both internally and externally. Effective against skin parasites." },
      { name: "Aloe Vera", info: "Soothes and heals skin topically. Also heals the gut internally." },
    ],
    lifestyle: "Eliminate dairy, gluten, and sugar for 30 days. Heal the gut. Check for parasites (often the hidden cause). Sunlight. Clean water. Reduce laundry detergent chemicals.",
  },
];

const PARASITE_TREATMENTS = [
  { name: "Wormwood (Artemisia)", info: "The active compound (artemisinin) is effective against many parasites including malaria. The Nobel Prize in Medicine was awarded for its discovery in 2015." },
  { name: "Black Walnut Hull", info: "Contains juglone, highly effective against intestinal parasites. Used in the classic Hulda Clark parasite protocol." },
  { name: "Cloves", info: "Kill parasite eggs that other herbs miss. Critical to combine with wormwood and black walnut to break the reproductive cycle." },
  { name: "Garlic (Raw)", info: "Broad-spectrum antiparasitic. Allicin, the active compound, forms when garlic is crushed and exposed to air for 10 minutes." },
  { name: "Papaya Seeds", info: "Black papaya seeds are remarkably effective against intestinal worms. Eat a tablespoon daily for a week." },
  { name: "Pumpkin Seeds", info: "Cucurbitacin paralyzes parasites so the body can eliminate them. Eat 1/4 cup raw seeds daily." },
  { name: "Diatomaceous Earth (Food Grade)", info: "Microscopic sharp edges physically shred parasite exoskeletons while being harmless to human cells." },
  { name: "Oregano Oil", info: "Powerful antimicrobial. Kills parasites, bacteria, fungi, and viruses. Use carrier oil — it's hot." },
  { name: "Neem", info: "Ayurvedic antiparasitic used for thousands of years. Effective against many intestinal parasites." },
  { name: "Ivermectin", info: "FDA-approved antiparasitic drug. Used for river blindness and many other parasitic infections worldwide." },
  { name: "Fenbendazole", info: "Veterinary antiparasitic that has gained attention for off-label human use. Research it thoroughly." },
  { name: "Castor Oil Packs", info: "Applied to the abdomen, help move toxins and dead parasites out of the liver and intestines." },
];

function HealDiseaseSection() {
  const [activeDisease, setActiveDisease] = useState(null);
  const [showParasites, setShowParasites] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  const filtered = searchTerm
    ? DISEASES.filter(d =>
        d.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        d.desc.toLowerCase().includes(searchTerm.toLowerCase()) ||
        d.herbs.some(h => h.name.toLowerCase().includes(searchTerm.toLowerCase()))
      )
    : DISEASES;

  if (activeDisease) {
    const d = DISEASES.find(x => x.id === activeDisease);
    return (
      <div style={{ animation: "fadeInUp 0.4s ease" }}>
        <button onClick={() => setActiveDisease(null)} style={{ background: "var(--card-bg)", border: "1px solid var(--border)", color: "var(--text-muted)", padding: "8px 18px", borderRadius: 8, cursor: "pointer", fontSize: 11, letterSpacing: 2, fontFamily: "'Orbitron', sans-serif", marginBottom: 24 }}>← BACK TO HEAL DISEASE</button>

        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 16 }}>
          <span style={{ fontSize: 40 }}>{d.icon}</span>
          <h2 style={{ fontSize: 24, fontWeight: 600, color: "var(--text)", fontFamily: "'Orbitron', sans-serif", margin: 0, letterSpacing: 1 }}>{d.name}</h2>
        </div>

        <GlassCard hover={false} style={{ marginBottom: 20, borderLeft: `3px solid ${d.color}` }}>
          <span style={{ fontSize: 10, letterSpacing: 3, color: d.color, fontFamily: "'Orbitron', sans-serif", display: "block", marginBottom: 12 }}>⟡ UNDERSTANDING THIS CONDITION</span>
          <p style={{ fontSize: 14, color: "var(--text-muted)", lineHeight: 1.9, margin: 0 }}>{d.desc}</p>
        </GlassCard>

        <span style={{ fontSize: 10, letterSpacing: 3, color: "var(--text-faint)", fontFamily: "'Orbitron', sans-serif", display: "block", marginBottom: 14 }}>HEALING HERBS & SUPPLEMENTS</span>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 24 }}>
          {d.herbs.map((herb, i) => (
            <GlassCard key={i} hover={false} style={{ padding: 18, borderLeft: `2px solid ${d.color}30` }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: `${d.color}15`, border: `1px solid ${d.color}30`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 14 }}>🌿</div>
                <div style={{ flex: 1 }}>
                  <h4 style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", margin: "0 0 4px", fontFamily: "'Sora', sans-serif" }}>{herb.name}</h4>
                  <p style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.7, margin: 0 }}>{herb.info}</p>
                </div>
              </div>
            </GlassCard>
          ))}
        </div>

        <GlassCard hover={false} style={{ borderLeft: "3px solid #22c55e", marginBottom: 20 }}>
          <span style={{ fontSize: 10, letterSpacing: 3, color: "#22c55e", fontFamily: "'Orbitron', sans-serif", display: "block", marginBottom: 10 }}>⟡ LIFESTYLE PROTOCOL</span>
          <p style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.9, margin: 0 }}>{d.lifestyle}</p>
        </GlassCard>

        <GlassCard hover={false} style={{ borderLeft: "3px solid #eab308" }}>
          <span style={{ fontSize: 10, letterSpacing: 3, color: "#eab308", fontFamily: "'Orbitron', sans-serif", display: "block", marginBottom: 10 }}>⟡ THE PARASITE CONNECTION</span>
          <p style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.9, margin: "0 0 12px" }}>
            Almost every chronic disease has an associated parasitic component. Parasites create inflammation, steal nutrients, release toxins, and suppress immune function. Addressing hidden parasite burden is often the missing piece in healing {d.name.toLowerCase()}.
          </p>
          <button onClick={() => { setActiveDisease(null); setShowParasites(true); window.scrollTo(0, 0); }} style={{ padding: "8px 18px", borderRadius: 6, background: "rgba(234,179,8,0.1)", border: "1px solid rgba(234,179,8,0.3)", color: "#eab308", cursor: "pointer", fontSize: 10, letterSpacing: 2, fontFamily: "'Orbitron', sans-serif" }}>READ PARASITE PROTOCOL →</button>
        </GlassCard>
      </div>
    );
  }

  if (showParasites) {
    return (
      <div style={{ animation: "fadeInUp 0.4s ease" }}>
        <button onClick={() => setShowParasites(false)} style={{ background: "var(--card-bg)", border: "1px solid var(--border)", color: "var(--text-muted)", padding: "8px 18px", borderRadius: 8, cursor: "pointer", fontSize: 11, letterSpacing: 2, fontFamily: "'Orbitron', sans-serif", marginBottom: 24 }}>← BACK TO HEAL DISEASE</button>

        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 16 }}>
          <span style={{ fontSize: 40 }}>🪱</span>
          <h2 style={{ fontSize: 24, fontWeight: 600, color: "var(--text)", fontFamily: "'Orbitron', sans-serif", margin: 0, letterSpacing: 1 }}>THE PARASITE CONNECTION</h2>
        </div>

        <GlassCard hover={false} style={{ marginBottom: 20, borderLeft: "3px solid #eab308", padding: "28px 26px" }}>
          <span style={{ fontSize: 10, letterSpacing: 3, color: "#eab308", fontFamily: "'Orbitron', sans-serif", display: "block", marginBottom: 16 }}>⟡ THE HIDDEN EPIDEMIC</span>

          <h3 style={{ fontSize: 20, fontWeight: 400, color: "var(--text)", fontFamily: "'Sora', sans-serif", lineHeight: 1.5, marginBottom: 16 }}>
            Almost every disease creates an environment where parasites thrive — and parasites, in turn, perpetuate disease.
          </h3>

          <p style={{ fontSize: 14, color: "var(--text-muted)", lineHeight: 2, marginBottom: 16 }}>
            The CDC estimates that parasitic infections affect billions of people worldwide. In modern Western medicine, they are largely ignored — assumed to be a "third world problem." This assumption is wrong. Parasites are everywhere — in water, food, pets, soil, and even the air. Most people carry multiple species without knowing it.
          </p>

          <p style={{ fontSize: 14, color: "var(--text-muted)", lineHeight: 2, marginBottom: 16 }}>
            Here's what they don't tell you: <span style={{ color: "#eab308", fontWeight: 500 }}>every chronic disease creates conditions that parasites love.</span> Cancer, diabetes, autoimmune disease, chronic fatigue, digestive disorders, skin conditions, mental health issues — all of them create an internal environment of inflammation, toxicity, and immune suppression that lets parasites multiply unchecked.
          </p>

          <p style={{ fontSize: 14, color: "var(--text-muted)", lineHeight: 2, marginBottom: 16 }}>
            And the relationship goes both ways: <span style={{ color: "#eab308", fontWeight: 500 }}>parasites perpetuate and worsen these diseases.</span> They consume your nutrients, release toxic waste into your bloodstream, suppress your immune system, trigger chronic inflammation, and alter your brain chemistry. Some researchers believe parasites may be a root cause or major contributor to many "mystery" illnesses that modern medicine can't explain.
          </p>

          <p style={{ fontSize: 14, color: "var(--text-muted)", lineHeight: 2, margin: 0 }}>
            Dr. Hulda Clark spent her career documenting the connection between parasites and chronic disease, including cancer. Her protocols — using wormwood, black walnut, and cloves — have been used by millions. Ancient traditions across every culture had parasite cleansing rituals. It's only in the modern West that we've forgotten this fundamental practice.
          </p>
        </GlassCard>

        {/* Signs of parasites */}
        <GlassCard hover={false} style={{ marginBottom: 20 }}>
          <span style={{ fontSize: 10, letterSpacing: 3, color: "#ef4444", fontFamily: "'Orbitron', sans-serif", display: "block", marginBottom: 16 }}>⟡ COMMON SIGNS YOU MAY HAVE PARASITES</span>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
            {[
              "Unexplained fatigue that doesn't improve with rest",
              "Digestive issues: bloating, gas, diarrhea, constipation",
              "Sugar cravings (parasites feed on sugar)",
              "Grinding teeth at night (classic sign)",
              "Itching around the anus, especially at night",
              "Skin issues: rashes, eczema, acne, hives",
              "Mood swings, anxiety, depression, brain fog",
              "Unexplained weight gain or loss",
              "Joint and muscle pain with no clear cause",
              "Iron deficiency anemia",
              "Food sensitivities that keep growing",
              "Visible worms or eggs in stool (not common but diagnostic)",
              "Waking at 2-4 AM (liver parasite activity window)",
              "Dark circles under the eyes",
            ].map((sign, i) => (
              <div key={i} style={{ display: "flex", gap: 10, padding: "8px 0" }}>
                <span style={{ color: "#ef4444", flexShrink: 0 }}>•</span>
                <span style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6 }}>{sign}</span>
              </div>
            ))}
          </div>
        </GlassCard>

        {/* Treatment herbs */}
        <span style={{ fontSize: 10, letterSpacing: 3, color: "var(--text-faint)", fontFamily: "'Orbitron', sans-serif", display: "block", marginBottom: 14 }}>ANTIPARASITIC HERBS & TREATMENTS</span>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 24 }}>
          {PARASITE_TREATMENTS.map((p, i) => (
            <GlassCard key={i} hover={false} style={{ padding: 18, borderLeft: "2px solid rgba(234,179,8,0.3)" }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: "rgba(234,179,8,0.12)", border: "1px solid rgba(234,179,8,0.25)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 14 }}>🌿</div>
                <div style={{ flex: 1 }}>
                  <h4 style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", margin: "0 0 4px", fontFamily: "'Sora', sans-serif" }}>{p.name}</h4>
                  <p style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.7, margin: 0 }}>{p.info}</p>
                </div>
              </div>
            </GlassCard>
          ))}
        </div>

        {/* Protocol guide */}
        <GlassCard hover={false} style={{ borderLeft: "3px solid #22c55e" }}>
          <span style={{ fontSize: 10, letterSpacing: 3, color: "#22c55e", fontFamily: "'Orbitron', sans-serif", display: "block", marginBottom: 12 }}>⟡ PARASITE CLEANSE PROTOCOL GUIDE</span>
          <p style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.9, marginBottom: 14 }}>
            A typical cleanse runs 30-90 days and cycles with the moon (parasites reproduce during full moon). The classic protocol combines three herbs that work together:
          </p>
          <div style={{ paddingLeft: 14, marginBottom: 14 }}>
            <p style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.9, margin: "0 0 8px" }}>
              <span style={{ color: "#eab308", fontWeight: 600 }}>Wormwood</span> — kills adult worms
            </p>
            <p style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.9, margin: "0 0 8px" }}>
              <span style={{ color: "#eab308", fontWeight: 600 }}>Black Walnut Hull</span> — kills larvae and targets blood parasites
            </p>
            <p style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.9, margin: 0 }}>
              <span style={{ color: "#eab308", fontWeight: 600 }}>Cloves</span> — destroys eggs (critical — without this, the cycle restarts)
            </p>
          </div>
          <p style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.9, marginBottom: 14 }}>
            All three must be used together. Killing adults and larvae without destroying eggs means reinfection. Cleanses should also include binders (activated charcoal, bentonite clay, or chlorella) to absorb the toxins released when parasites die. Support liver and kidney detox throughout.
          </p>
          <p style={{ fontSize: 12, color: "var(--text-faint)", lineHeight: 1.8, fontStyle: "italic", margin: 0 }}>
            Note: "Die-off" symptoms (headaches, fatigue, flu-like feelings) are normal as parasites die and release toxins. Go slow. Support detox. Consult a knowledgeable practitioner if you have a chronic condition.
          </p>
        </GlassCard>

        <div style={{ marginTop: 20, padding: 16, borderRadius: 10, background: "var(--card-bg-soft)", border: "1px solid var(--border)", textAlign: "center" }}>
          <p style={{ fontSize: 11, color: "var(--text-faint)", fontFamily: "'JetBrains Mono', monospace", margin: 0 }}>
            This information is for educational purposes and has not been evaluated by the FDA. Consult a qualified healthcare practitioner before starting any protocol, especially if you have existing health conditions or take medications.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ animation: "fadeInUp 0.5s ease" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
        <div style={{ width: 3, height: 28, background: "linear-gradient(to bottom, #ef4444, #eab308, #22c55e)", borderRadius: 2 }} />
        <h2 style={{ fontSize: 22, fontWeight: 300, color: "var(--text)", fontFamily: "'Sora', sans-serif", margin: 0 }}>HEAL DISEASE</h2>
      </div>
      <p style={{ fontSize: 14, color: "var(--text-faint)", lineHeight: 1.8, marginTop: 8, marginBottom: 8 }}>
        {DISEASES.length} common diseases and the herbs, supplements, and lifestyle changes that address their root causes. Plus a dedicated section on the parasite connection — the hidden epidemic behind most chronic illness.
      </p>
      <p style={{ fontSize: 12, color: "var(--text-faint)", lineHeight: 1.7, marginBottom: 24 }}>
        Modern medicine treats symptoms. Traditional herbal medicine addresses root causes. Both have their place. The information here is for research and empowerment — always consult a practitioner you trust.
      </p>

      {/* Parasite section highlight */}
      <GlassCard onClick={() => setShowParasites(true)} style={{ marginBottom: 24, borderLeft: "3px solid #eab308", cursor: "pointer" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ width: 56, height: 56, borderRadius: 12, background: "rgba(234,179,8,0.12)", border: "1px solid rgba(234,179,8,0.3)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, flexShrink: 0 }}>🪱</div>
          <div style={{ flex: 1 }}>
            <span style={{ fontSize: 10, color: "#eab308", letterSpacing: 3, fontFamily: "'Orbitron', sans-serif" }}>⟡ START HERE</span>
            <h3 style={{ fontSize: 17, fontWeight: 600, color: "var(--text)", margin: "4px 0", fontFamily: "'Sora', sans-serif" }}>The Parasite Connection</h3>
            <p style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6, margin: 0 }}>Why nearly every chronic disease has a parasitic component — and how to address it.</p>
          </div>
          <span style={{ fontSize: 10, color: "#eab308", letterSpacing: 3, fontFamily: "'Orbitron', sans-serif", fontWeight: 600 }}>READ →</span>
        </div>
      </GlassCard>

      <input value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="Search diseases or herbs... (diabetes, turmeric, depression...)"
        style={{ width: "100%", background: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: 10, padding: "14px 20px", color: "var(--text)", fontSize: 13, outline: "none", fontFamily: "'JetBrains Mono', monospace", marginBottom: 24 }} />

      <span style={{ fontSize: 10, letterSpacing: 3, color: "var(--text-faint)", fontFamily: "'Orbitron', sans-serif", display: "block", marginBottom: 14 }}>COMMON DISEASES</span>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {filtered.map(d => (
          <GlassCard key={d.id} onClick={() => setActiveDisease(d.id)} style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 16, borderLeft: `3px solid ${d.color}`, padding: "20px 22px" }}>
            <div style={{ width: 48, height: 48, borderRadius: 12, background: `${d.color}12`, border: `1px solid ${d.color}25`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, flexShrink: 0 }}>{d.icon}</div>
            <div style={{ flex: 1 }}>
              <h3 style={{ fontSize: 15, fontWeight: 600, color: "var(--text)", margin: 0, fontFamily: "'Sora', sans-serif" }}>{d.name}</h3>
              <p style={{ fontSize: 12, color: "var(--text-faint)", margin: "4px 0 0", lineHeight: 1.5 }}>{d.desc.substring(0, 120)}...</p>
              <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                {d.herbs.slice(0, 3).map(h => (
                  <span key={h.name} style={{ fontSize: 9, padding: "2px 8px", borderRadius: 10, background: `${d.color}10`, color: d.color, border: `1px solid ${d.color}20` }}>{h.name}</span>
                ))}
                {d.herbs.length > 3 && <span style={{ fontSize: 9, color: "var(--text-faint)" }}>+{d.herbs.length - 3} more</span>}
              </div>
            </div>
            <span style={{ fontSize: 10, color: d.color, letterSpacing: 2, fontFamily: "'Orbitron', sans-serif", fontWeight: 600, flexShrink: 0 }}>VIEW →</span>
          </GlassCard>
        ))}
      </div>

      <div style={{ marginTop: 24, padding: 16, borderRadius: 10, background: "var(--card-bg-soft)", border: "1px solid var(--border)", textAlign: "center" }}>
        <p style={{ fontSize: 11, color: "var(--text-faint)", fontFamily: "'JetBrains Mono', monospace", margin: 0 }}>
          Educational information only. Not medical advice. Consult a qualified practitioner before using herbs, especially if pregnant, nursing, or taking medications.
        </p>
      </div>
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════
// MEDITATION ZONE — Full Practice System
// ═══════════════════════════════════════════════════════════════

function ZenZoneSection() {
  const [activePractice, setActivePractice] = useState(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [practiceStarted, setPracticeStarted] = useState(false);

  if (activePractice) {
    const p = ZEN_PRACTICES.find(pr => pr.id === activePractice);
    return (
      <div style={{ animation: "fadeInUp 0.4s ease" }}>
        <button onClick={() => { setActivePractice(null); setCurrentStep(0); setPracticeStarted(false); }} style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)", color: "var(--text-muted)", padding: "8px 18px", borderRadius: 8, cursor: "pointer", fontSize: 11, letterSpacing: 2, fontFamily: "'Orbitron', sans-serif", marginBottom: 24 }}>← BACK TO MEDITATION ZONE</button>

        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 8 }}>
          <span style={{ fontSize: 40 }}>{p.icon}</span>
          <div>
            <span style={{ fontSize: 10, color: p.color, fontFamily: "'Orbitron', sans-serif", letterSpacing: 3 }}>{p.type.toUpperCase()} • {p.dur}</span>
            <h2 style={{ fontSize: 24, fontWeight: 600, color: "var(--text)", fontFamily: "'Orbitron', sans-serif", margin: 0, letterSpacing: 1 }}>{p.name}</h2>
          </div>
        </div>
        <p style={{ fontSize: 14, color: "var(--text-muted)", lineHeight: 1.8, marginBottom: 28, maxWidth: 650 }}>{p.desc}</p>

        {/* Breathwork timer if applicable */}
        {p.hasTimer && (
          <GlassCard hover={false} style={{ marginBottom: 24, display: "flex", justifyContent: "center" }}>
            <BreathingGuide />
          </GlassCard>
        )}

        {/* Step-by-step guide */}
        <GlassCard hover={false} style={{ marginBottom: 24, maxWidth: 700 }}>
          <span style={{ fontSize: 10, letterSpacing: 3, color: p.color, fontFamily: "'Orbitron', sans-serif", display: "block", marginBottom: 20 }}>⟡ GUIDED STEPS</span>
          {p.steps.map((step, i) => (
            <div key={i} onClick={() => setCurrentStep(i)} style={{
              display: "flex", gap: 16, padding: "16px 0",
              borderBottom: i < p.steps.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none",
              cursor: "pointer", opacity: currentStep === i ? 1 : 0.5,
              transition: "all 0.3s ease",
            }}>
              <div style={{
                width: 28, height: 28, borderRadius: "50%", flexShrink: 0,
                background: currentStep === i ? `${p.color}20` : "rgba(255,255,255,0.03)",
                border: `1px solid ${currentStep === i ? `${p.color}50` : "rgba(255,255,255,0.06)"}`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 11, color: currentStep === i ? p.color : "rgba(255,255,255,0.3)",
                fontFamily: "'Orbitron', sans-serif", fontWeight: 600,
                transition: "all 0.3s ease",
              }}>{i + 1}</div>
              <p style={{ fontSize: 14, color: currentStep === i ? "rgba(255,255,255,0.8)" : "rgba(255,255,255,0.4)", lineHeight: 1.8, margin: 0, transition: "color 0.3s ease" }}>{step}</p>
            </div>
          ))}
          <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
            <button onClick={() => setCurrentStep(Math.max(0, currentStep - 1))} disabled={currentStep === 0} style={{ padding: "8px 18px", borderRadius: 6, background: "var(--card-bg)", border: "1px solid var(--card-border)", color: currentStep === 0 ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.4)", cursor: currentStep === 0 ? "default" : "pointer", fontSize: 11, letterSpacing: 2, fontFamily: "'Orbitron', sans-serif" }}>← PREV</button>
            <button onClick={() => setCurrentStep(Math.min(p.steps.length - 1, currentStep + 1))} disabled={currentStep === p.steps.length - 1} style={{ padding: "8px 18px", borderRadius: 6, background: currentStep < p.steps.length - 1 ? `${p.color}12` : "rgba(255,255,255,0.03)", border: `1px solid ${currentStep < p.steps.length - 1 ? `${p.color}30` : "rgba(255,255,255,0.06)"}`, color: currentStep < p.steps.length - 1 ? p.color : "rgba(255,255,255,0.15)", cursor: currentStep === p.steps.length - 1 ? "default" : "pointer", fontSize: 11, letterSpacing: 2, fontFamily: "'Orbitron', sans-serif" }}>NEXT →</button>
          </div>
        </GlassCard>

        {/* Science section */}
        <GlassCard hover={false} style={{ borderLeft: `3px solid ${p.color}`, maxWidth: 700 }}>
          <span style={{ fontSize: 10, letterSpacing: 3, color: p.color, fontFamily: "'Orbitron', sans-serif", display: "block", marginBottom: 10 }}>⟡ THE SCIENCE</span>
          <p style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.9, margin: 0 }}>{p.science}</p>
        </GlassCard>
      </div>
    );
  }

  return (
    <div style={{ animation: "fadeInUp 0.5s ease" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
        <div style={{ width: 3, height: 28, background: "linear-gradient(to bottom, #00ff8c, #a78bfa)", borderRadius: 2 }} />
        <h2 style={{ fontSize: 22, fontWeight: 300, color: "var(--text)", fontFamily: "'Sora', sans-serif", margin: 0 }}>MEDITATION ZONE</h2>
      </div>
      <p style={{ fontSize: 14, color: "var(--text-faint)", lineHeight: 1.8, marginTop: 8, marginBottom: 28 }}>
        {ZEN_PRACTICES.length} guided practices with step-by-step instructions, interactive timers, and the science behind each one. No fluff — just the techniques that work.
      </p>

      {/* Live Breathwork Tool */}
      <div style={{ display: "flex", gap: 20, flexWrap: "wrap", marginBottom: 28 }}>
        <GlassCard hover={false} style={{ flex: "1 1 340px", display: "flex", flexDirection: "column", alignItems: "center" }}>
          <span style={{ fontSize: 10, letterSpacing: 3, color: "#00ff8c", textTransform: "uppercase", fontFamily: "'Orbitron', sans-serif", display: "block", marginBottom: 20 }}>QUICK BREATHWORK TOOL</span>
          <BreathingGuide />
        </GlassCard>

        {/* Daily recommendation */}
        <GlassCard hover={false} style={{ flex: "1 1 280px", borderLeft: "3px solid #a78bfa" }}>
          <span style={{ fontSize: 10, letterSpacing: 3, color: "#a78bfa", fontFamily: "'Orbitron', sans-serif", display: "block", marginBottom: 14 }}>⟡ RECOMMENDED TODAY</span>
          <h3 style={{ fontSize: 16, color: "var(--text)", fontWeight: 500, marginBottom: 8 }}>Morning Calibration + Deep Presence</h3>
          <p style={{ fontSize: 12, color: "var(--text-faint)", lineHeight: 1.7, marginBottom: 16 }}>Start with 12 minutes of heart-centered intention setting, then move into 15 minutes of pure awareness meditation. Total: 27 minutes to completely recalibrate your field.</p>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setActivePractice("morning")} style={{ padding: "6px 16px", borderRadius: 6, background: "rgba(6,182,212,0.1)", border: "1px solid rgba(6,182,212,0.3)", color: "#06b6d4", cursor: "pointer", fontSize: 10, letterSpacing: 1, fontFamily: "'Orbitron', sans-serif" }}>CALIBRATE</button>
            <button onClick={() => setActivePractice("presence")} style={{ padding: "6px 16px", borderRadius: 6, background: "rgba(167,139,250,0.1)", border: "1px solid rgba(167,139,250,0.3)", color: "#a78bfa", cursor: "pointer", fontSize: 10, letterSpacing: 1, fontFamily: "'Orbitron', sans-serif" }}>PRESENCE</button>
          </div>
        </GlassCard>
      </div>

      {/* Full Practice Library */}
      <span style={{ fontSize: 10, letterSpacing: 3, color: "var(--text-faint)", fontFamily: "'Orbitron', sans-serif", display: "block", marginBottom: 14 }}>ALL PRACTICES</span>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {ZEN_PRACTICES.map(p => (
          <GlassCard key={p.id} onClick={() => { setActivePractice(p.id); setCurrentStep(0); }} style={{
            cursor: "pointer", display: "flex", alignItems: "center", gap: 16,
            borderLeft: `3px solid ${p.color}`, padding: "20px 24px",
          }}>
            <div style={{ width: 48, height: 48, borderRadius: 12, background: `${p.color}12`, border: `1px solid ${p.color}25`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, flexShrink: 0 }}>{p.icon}</div>
            <div style={{ flex: 1 }}>
              <h3 style={{ fontSize: 15, fontWeight: 600, color: "var(--text)", margin: 0, fontFamily: "'Sora', sans-serif" }}>{p.name}</h3>
              <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 3 }}>{p.type} • {p.dur} • {p.steps.length} steps</div>
              <p style={{ fontSize: 12, color: "var(--text-faint)", marginTop: 6, lineHeight: 1.5 }}>{p.desc.substring(0, 120)}...</p>
            </div>
            <span style={{ fontSize: 10, color: p.color, letterSpacing: 2, fontFamily: "'Orbitron', sans-serif", fontWeight: 600, flexShrink: 0 }}>BEGIN →</span>
          </GlassCard>
        ))}
      </div>
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════
// COMMUNITY FEED — Social Media Style
// ═══════════════════════════════════════════════════════════════

const COMMUNITY_USERS = [
  { id: 1, name: "Zenith", handle: "@zenith_33", avatar: "🧘", level: 42, vibe: 94, color: "#00ff8c", bio: "Breathwork facilitator. 369 practitioner. Day 847 of meditation.", followers: 2847, following: 312, online: true },
  { id: 2, name: "Luna", handle: "@luna.signal", avatar: "🌙", level: 38, vibe: 88, color: "#a78bfa", bio: "Plant medicine guide. Sacred geometry artist. Frequency healer.", followers: 5231, following: 189, online: true },
  { id: 3, name: "Kael", handle: "@kael.ether", avatar: "⚡", level: 51, vibe: 97, color: "#eab308", bio: "Scalar energy researcher. Tesla devotee. Building free energy devices.", followers: 12400, following: 76, online: false },
  { id: 4, name: "Aria", handle: "@aria.awakened", avatar: "🔮", level: 33, vibe: 82, color: "#ec4899", bio: "Dream architect. Astral traveler. Pineal gland activation coach.", followers: 3912, following: 445, online: true },
  { id: 5, name: "Sol", handle: "@sol.source", avatar: "☀️", level: 45, vibe: 91, color: "#f97316", bio: "Sun gazer. Raw fruitarian. 3 years no pharma. Living proof.", followers: 8700, following: 122, online: true },
  { id: 6, name: "Cipher", handle: "@cipher.truth", avatar: "👁", level: 55, vibe: 96, color: "#ef4444", bio: "Declassified document researcher. The truth is in the files.", followers: 21000, following: 44, online: false },
  { id: 7, name: "Sage", handle: "@sage.flow", avatar: "🌿", level: 29, vibe: 79, color: "#22c55e", bio: "Herbalist. Copper coil builder. Grounding every morning at sunrise.", followers: 1540, following: 678, online: true },
  { id: 8, name: "Orion", handle: "@orion.beyond", avatar: "✨", level: 47, vibe: 93, color: "#06b6d4", bio: "Remote viewer. Gateway tapes graduate. Consciousness is the only reality.", followers: 6800, following: 201, online: false },
];

const COMMUNITY_POSTS = [
  {
    id: 1, userId: 1, time: "12 min ago",
    text: "Day 847 of unbroken meditation. Today's sit was different — I felt the field collapse into a single point. No body, no room, no time. Just awareness aware of itself. This is what they mean by 'the witness.' If you're on day 1, keep going. The compound effect is real.",
    likes: 347, comments: 42, shares: 18, liked: false,
    tags: ["meditation", "consciousness", "consistency"],
    commentsList: [
      { user: COMMUNITY_USERS[1], text: "I felt this at day 300. It comes in waves after that. Beautiful share. 🙏", time: "8m" },
      { user: COMMUNITY_USERS[3], text: "This gives me chills. Day 47 here and some days I want to quit. Not anymore.", time: "5m" },
      { user: COMMUNITY_USERS[6], text: "The witness state. Once you find it, you realize it was always there.", time: "2m" },
    ]
  },
  {
    id: 2, userId: 3, time: "38 min ago",
    text: "Just finished building my second Rodin coil. The toroidal field this thing produces is insane — my structured water device next to it is showing completely different crystal formations. Tesla wasn't wrong about 3, 6, 9. I'm seeing it with my own eyes now.\n\nDropping a full tutorial this weekend for anyone who wants to build one. Copper wire, sacred measurements, and patience is all you need.",
    likes: 892, comments: 127, shares: 234, liked: true,
    tags: ["tesla", "369", "copper", "scalar", "DIY"],
    hasImage: true, imageDesc: "⚡ RODIN COIL BUILD — V2",
    commentsList: [
      { user: COMMUNITY_USERS[4], text: "WAITING for this tutorial. What gauge copper did you use?", time: "32m" },
      { user: COMMUNITY_USERS[0], text: "I built one last month and my plants are growing 2x faster near it. Not even exaggerating.", time: "28m" },
      { user: COMMUNITY_USERS[7], text: "The vortex math is embedded in everything. This is applied 369.", time: "15m" },
    ]
  },
  {
    id: 3, userId: 2, time: "1 hr ago",
    text: "Reminder: you don't need anyone's permission to heal yourself.\n\nThe body is the pharmacy.\nBreath is the medicine.\nNature is the doctor.\nSilence is the therapist.\nSunlight is the supplement.\n\nEverything you need is free. That's why they don't teach it.",
    likes: 2341, comments: 89, shares: 567, liked: false,
    tags: ["healing", "nature", "awakening"],
    commentsList: [
      { user: COMMUNITY_USERS[5], text: "\"Everything you need is free. That's why they don't teach it.\" — Frame this.", time: "52m" },
      { user: COMMUNITY_USERS[6], text: "Saved. Sharing. This is the whole message in 6 lines.", time: "44m" },
    ]
  },
  {
    id: 4, userId: 6, time: "2 hrs ago",
    text: "New declassified documents just dropped from the CIA FOIA reading room. 47 pages on \"Anomalous Mental Phenomena\" — they were studying remote viewing, precognition, and psychokinesis through the 80s and concluded it was REAL and OPERATIONAL.\n\nThey used it. They know consciousness is non-local. They classified it.\n\nLink in my profile. Read the source material yourself. Don't take anyone's word for it — not even mine.",
    likes: 4102, comments: 312, shares: 1893, liked: false,
    tags: ["CIA", "declassified", "remote viewing", "psi"],
    commentsList: [
      { user: COMMUNITY_USERS[7], text: "I've read every Gateway tape analysis. The CIA knows consciousness transcends spacetime. They KNOW.", time: "1h" },
      { user: COMMUNITY_USERS[0], text: "The fact that this is declassified and people still call it conspiracy theory is wild.", time: "55m" },
      { user: COMMUNITY_USERS[3], text: "Downloading now. Everyone needs to read primary sources, not summaries.", time: "48m" },
    ]
  },
  {
    id: 5, userId: 5, time: "3 hrs ago",
    text: "3 years pharmaceutical-free. Blood work came back yesterday — every marker improved. Doctor literally said \"whatever you're doing, keep doing it.\"\n\nWhat I'm doing:\n— Sun gazing (HRM protocol)\n— Grounding 30 min daily\n— Structured water only\n— Plant-based whole foods\n— Zero processed anything\n— Daily breathwork\n— No fluoride, no aluminum, no seed oils\n\nYour body WANTS to heal. Stop poisoning it and it will.",
    likes: 1876, comments: 201, shares: 445, liked: false,
    tags: ["health", "sungazing", "detox", "grounding"],
    commentsList: [
      { user: COMMUNITY_USERS[1], text: "The seed oils alone make such a difference. Once you cut them, you feel the inflammation drop within weeks.", time: "2h" },
      { user: COMMUNITY_USERS[6], text: "This is the protocol. Simple, free, effective. Pharma can't patent sunlight.", time: "2h" },
    ]
  },
  {
    id: 6, userId: 4, time: "4 hrs ago",
    text: "Had my first fully lucid astral projection last night. Not a dream — I was THERE. Saw my room from the ceiling. Moved through the wall. The vibrational state before separation is exactly how the Gateway tapes describe it.\n\nI've been practicing for 8 months. It's real. Consciousness is not confined to the body.\n\nHappy to share my exact protocol if anyone is working on this.",
    likes: 1245, comments: 178, shares: 89, liked: false,
    tags: ["astral", "consciousness", "gateway", "OBE"],
    commentsList: [
      { user: COMMUNITY_USERS[7], text: "The vibrational state is unmistakable. Once you feel it, you know it's not a dream. Welcome to the other side. 🌌", time: "3h" },
      { user: COMMUNITY_USERS[0], text: "Please share the protocol! I keep getting to the vibration stage but can't separate.", time: "3h" },
    ]
  },
  {
    id: 7, userId: 7, time: "5 hrs ago",
    text: "Made copper-infused water this morning with my tensor ring and copper vessel. 8 hours in copper overnight, then 20 minutes inside the tensor ring field.\n\nTasted completely different — softer, almost sweet. Dr. Emoto showed water responds to intention. Imagine what it does with sacred geometry and copper ions.\n\nStart with a simple copper cup. It's ancient technology hiding in plain sight.",
    likes: 634, comments: 67, shares: 112, liked: false,
    tags: ["copper", "water", "tensor", "ayurveda"],
    commentsList: [
      { user: COMMUNITY_USERS[2], text: "What cubit measurement did you use for the tensor ring? Lost cubit or sacred?", time: "4h" },
      { user: COMMUNITY_USERS[4], text: "I've been drinking from copper for 2 years. Digestion completely transformed.", time: "4h" },
    ]
  },
];

function CommunityFeed({ isMobile = false }) {
  const [posts, setPosts] = useState(COMMUNITY_POSTS);
  const [newPost, setNewPost] = useState("");
  const [activeFilter, setActiveFilter] = useState("all");
  const [expandedComments, setExpandedComments] = useState(new Set());
  const [commentInputs, setCommentInputs] = useState({});
  const [selectedProfile, setSelectedProfile] = useState(null);
  const [showStories, setShowStories] = useState(true);

  const toggleLike = (postId) => {
    setPosts(prev => prev.map(p => p.id === postId ? { ...p, liked: !p.liked, likes: p.liked ? p.likes - 1 : p.likes + 1 } : p));
  };

  const toggleComments = (postId) => {
    setExpandedComments(prev => { const n = new Set(prev); n.has(postId) ? n.delete(postId) : n.add(postId); return n; });
  };

  const submitComment = (postId) => {
    const text = commentInputs[postId];
    if (!text?.trim()) return;
    setPosts(prev => prev.map(p => p.id === postId ? {
      ...p, comments: p.comments + 1,
      commentsList: [...p.commentsList, { user: { name: "You", handle: "@you", avatar: "◈", color: "#00ff8c" }, text, time: "now" }]
    } : p));
    setCommentInputs(prev => ({ ...prev, [postId]: "" }));
  };

  const submitPost = () => {
    if (!newPost.trim()) return;
    const post = {
      id: Date.now(), userId: 0, time: "just now",
      text: newPost, likes: 0, comments: 0, shares: 0, liked: false,
      tags: [], commentsList: [],
      customUser: { name: "You", handle: "@you", avatar: "◈", color: "#00ff8c", level: 33, vibe: 85 },
    };
    setPosts(prev => [post, ...prev]);
    setNewPost("");
  };

  const filters = ["all", "trending", "new", "following", "awakening", "science", "practice"];

  // Profile modal
  if (selectedProfile) {
    const u = selectedProfile;
    return (
      <div style={{ animation: "fadeInUp 0.4s ease" }}>
        <button onClick={() => setSelectedProfile(null)} style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)", color: "var(--text-muted)", padding: "8px 18px", borderRadius: 8, cursor: "pointer", fontSize: 11, letterSpacing: 2, fontFamily: "'Orbitron', sans-serif", marginBottom: 24 }}>← BACK TO FEED</button>

        {/* Profile header */}
        <GlassCard hover={false} style={{ marginBottom: 20 }}>
          <div style={{ display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ width: 80, height: 80, borderRadius: "50%", background: `linear-gradient(135deg, ${u.color}44, ${u.color}22)`, border: `2px solid ${u.color}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 36, boxShadow: `0 0 20px ${u.color}33` }}>{u.avatar}</div>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                <span style={{ fontSize: 20, fontWeight: 600, color: "var(--text)", fontFamily: "'Sora', sans-serif" }}>{u.name}</span>
                {u.online && <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#00ff8c", boxShadow: "0 0 8px #00ff8c88" }} />}
                <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, background: `${u.color}18`, border: `1px solid ${u.color}30`, color: u.color, fontFamily: "'Orbitron', sans-serif", letterSpacing: 1 }}>LVL {u.level}</span>
              </div>
              <span style={{ fontSize: 13, color: "var(--text-faint)", fontFamily: "'JetBrains Mono', monospace" }}>{u.handle}</span>
              <p style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.7, marginTop: 8 }}>{u.bio}</p>
              <div style={{ display: "flex", gap: 24, marginTop: 12 }}>
                <span style={{ fontSize: 13, color: "var(--text)" }}><strong>{u.followers.toLocaleString()}</strong> <span style={{ color: "var(--text-faint)", fontSize: 11 }}>followers</span></span>
                <span style={{ fontSize: 13, color: "var(--text)" }}><strong>{u.following}</strong> <span style={{ color: "var(--text-faint)", fontSize: 11 }}>following</span></span>
              </div>
            </div>
            <button style={{ padding: "10px 24px", borderRadius: 8, background: `${u.color}15`, border: `1px solid ${u.color}40`, color: u.color, cursor: "pointer", fontSize: 11, letterSpacing: 2, fontFamily: "'Orbitron', sans-serif" }}>FOLLOW</button>
          </div>
        </GlassCard>

        {/* User's posts */}
        <span style={{ fontSize: 10, letterSpacing: 3, color: "var(--text-faint)", fontFamily: "'Orbitron', sans-serif", display: "block", marginBottom: 16 }}>{u.name.toUpperCase()}'S SIGNALS</span>
        {posts.filter(p => COMMUNITY_USERS[p.userId - 1]?.id === u.id).map(post => {
          const postUser = u;
          return renderPost(post, postUser);
        })}
        {posts.filter(p => COMMUNITY_USERS[p.userId - 1]?.id === u.id).length === 0 && (
          <GlassCard hover={false}><p style={{ color: "var(--text-faint)", fontSize: 13, textAlign: "center" }}>No signals from this user yet.</p></GlassCard>
        )}
      </div>
    );
  }

  // Render a single post
  function renderPost(post, postUser) {
    const isExpanded = expandedComments.has(post.id);
    const pad = isMobile ? "14px 16px 0" : "18px 22px 0";
    const padX = isMobile ? 16 : 22;
    return (
      <GlassCard key={post.id} hover={false} style={{ marginBottom: 16, padding: 0, overflow: "hidden" }}>
        {/* Post header */}
        <div style={{ padding: pad }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
            <div onClick={() => postUser.id && setSelectedProfile(postUser)} style={{
              width: 42, height: 42, borderRadius: "50%",
              background: `linear-gradient(135deg, ${postUser.color}44, ${postUser.color}22)`,
              border: `2px solid ${postUser.color}55`,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 19, cursor: postUser.id ? "pointer" : "default",
              boxShadow: `0 0 12px ${postUser.color}22`,
              flexShrink: 0,
            }}>{postUser.avatar}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <span onClick={() => postUser.id && setSelectedProfile(postUser)} style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", cursor: postUser.id ? "pointer" : "default" }}>{postUser.name}</span>
                {!isMobile && <span style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "'JetBrains Mono', monospace" }}>{postUser.handle}</span>}
                {postUser.level && <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 4, background: `${postUser.color}15`, color: postUser.color, fontFamily: "'Orbitron', sans-serif" }}>L{postUser.level}</span>}
              </div>
              <span style={{ fontSize: 11, color: "var(--text-dim)" }}>{post.time}</span>
            </div>
            <button style={{ background: "none", border: "none", color: "var(--text-dim)", cursor: "pointer", fontSize: 16, flexShrink: 0 }}>⋯</button>
          </div>

          {/* Post text */}
          <p style={{ fontSize: 14, color: "var(--text-muted)", lineHeight: 1.8, margin: "0 0 14px", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{post.text}</p>

          {/* Image placeholder */}
          {post.hasImage && (
            <div style={{ margin: `0 -${padX}px`, padding: "40px 22px", background: "linear-gradient(135deg, rgba(0,255,140,0.06), rgba(167,139,250,0.06), rgba(234,179,8,0.04))", borderTop: "1px solid rgba(255,255,255,0.05)", borderBottom: "1px solid rgba(255,255,255,0.05)", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 8 }}>
              <span style={{ fontSize: 48 }}>⚡</span>
              <span style={{ fontSize: 12, color: "var(--text-faint)", letterSpacing: 2, fontFamily: "'Orbitron', sans-serif", textAlign: "center" }}>{post.imageDesc}</span>
            </div>
          )}

          {/* Tags */}
          {post.tags.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
              {post.tags.map(t => (
                <span key={t} style={{ fontSize: 11, color: "#00ff8c", cursor: "pointer" }}>#{t}</span>
              ))}
            </div>
          )}
        </div>

        {/* Engagement stats */}
        <div style={{ padding: `8px ${padX}px`, borderTop: "1px solid var(--card-border)", display: "flex", gap: isMobile ? 12 : 16, fontSize: isMobile ? 10 : 11, color: "var(--text-dim)", flexWrap: "wrap" }}>
          <span>{post.likes.toLocaleString()} {isMobile ? "✦" : "resonances"}</span>
          <span>{post.comments} {isMobile ? "◇" : "replies"}</span>
          <span>{post.shares} {isMobile ? "◈" : "amplifies"}</span>
        </div>

        {/* Action buttons */}
        <div style={{ padding: `4px ${padX}px 4px`, borderTop: "1px solid var(--card-border)", display: "flex" }}>
          {[
            { label: post.liked ? "✦ Resonated" : "✦ Resonate", mobileLabel: "✦", action: () => toggleLike(post.id), active: post.liked, color: "#00ff8c" },
            { label: "◇ Reply", mobileLabel: "◇", action: () => toggleComments(post.id), active: isExpanded, color: "#06b6d4" },
            { label: "◈ Amplify", mobileLabel: "◈", action: () => {}, active: false, color: "#a78bfa" },
            { label: "⊕ Save", mobileLabel: "⊕", action: () => {}, active: false, color: "#eab308" },
          ].map(btn => (
            <button key={btn.label} onClick={btn.action} style={{
              flex: 1, padding: isMobile ? "12px 0" : "10px 0", background: "none", border: "none",
              color: btn.active ? btn.color : "rgba(255,255,255,0.35)",
              cursor: "pointer", fontSize: isMobile ? 14 : 12, fontFamily: "'Sora', sans-serif",
              transition: "all 0.2s ease",
              borderBottom: btn.active ? `2px solid ${btn.color}` : "2px solid transparent",
            }}>{isMobile ? btn.mobileLabel : btn.label}</button>
          ))}
        </div>

        {/* Comments section */}
        {isExpanded && (
          <div style={{ padding: `14px ${padX}px 18px`, borderTop: "1px solid var(--card-border)", background: "rgba(0,0,0,0.15)" }}>
            {post.commentsList.map((c, ci) => (
              <div key={ci} style={{ display: "flex", gap: 10, marginBottom: 14 }}>
                <div style={{ width: 30, height: 30, borderRadius: "50%", background: `${c.user.color}22`, border: `1px solid ${c.user.color}44`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0 }}>{c.user.avatar}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ background: "var(--card-bg)", borderRadius: 10, padding: "10px 14px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{c.user.name}</span>
                      <span style={{ fontSize: 10, color: "var(--text-dim)" }}>{c.time}</span>
                    </div>
                    <p style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6, margin: 0, wordBreak: "break-word" }}>{c.text}</p>
                  </div>
                  <div style={{ display: "flex", gap: 14, marginTop: 4, paddingLeft: 14 }}>
                    <button style={{ background: "none", border: "none", color: "var(--text-dim)", cursor: "pointer", fontSize: 11 }}>Resonate</button>
                    <button style={{ background: "none", border: "none", color: "var(--text-dim)", cursor: "pointer", fontSize: 11 }}>Reply</button>
                  </div>
                </div>
              </div>
            ))}

            {/* Comment input */}
            <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
              <div style={{ width: 30, height: 30, borderRadius: "50%", background: "rgba(0,255,140,0.1)", border: "1px solid rgba(0,255,140,0.3)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0, color: "#00ff8c" }}>◈</div>
              <div style={{ flex: 1, display: "flex", gap: 8, minWidth: 0 }}>
                <input
                  value={commentInputs[post.id] || ""}
                  onChange={e => setCommentInputs(prev => ({ ...prev, [post.id]: e.target.value }))}
                  onKeyDown={e => e.key === "Enter" && submitComment(post.id)}
                  placeholder="Write a reply..."
                  style={{ flex: 1, minWidth: 0, background: "var(--card-bg)", border: "1px solid var(--card-border)", borderRadius: 20, padding: "8px 16px", color: "var(--text)", fontSize: 13, outline: "none", fontFamily: "'Sora', sans-serif" }}
                />
                <button onClick={() => submitComment(post.id)} style={{ background: "rgba(0,255,140,0.1)", border: "1px solid rgba(0,255,140,0.3)", borderRadius: 20, padding: "0 16px", color: "#00ff8c", cursor: "pointer", fontSize: 11, fontFamily: "'Orbitron', sans-serif", flexShrink: 0 }}>SEND</button>
              </div>
            </div>
          </div>
        )}
      </GlassCard>
    );
  }

  return (
    <div style={{ animation: "fadeInUp 0.5s ease", display: "flex", gap: 24, flexDirection: isMobile ? "column" : "row" }}>
      {/* ─── Main Feed Column ─── */}
      <div style={{ flex: 1, minWidth: 0, width: "100%" }}>
        {/* Stories / Online Users Bar */}
        <GlassCard hover={false} style={{ marginBottom: 20, padding: "16px 20px" }}>
          <div style={{ display: "flex", gap: 16, overflowX: "auto", paddingBottom: 4 }}>
            {/* Your story */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, cursor: "pointer", flexShrink: 0 }}>
              <div style={{ width: 56, height: 56, borderRadius: "50%", background: "rgba(0,255,140,0.08)", border: "2px dashed rgba(0,255,140,0.3)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>+</div>
              <span style={{ fontSize: 10, color: "var(--text-faint)" }}>Your Signal</span>
            </div>
            {COMMUNITY_USERS.filter(u => u.online).map(u => (
              <div key={u.id} onClick={() => setSelectedProfile(u)} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, cursor: "pointer", flexShrink: 0 }}>
                <div style={{ width: 56, height: 56, borderRadius: "50%", background: `linear-gradient(135deg, ${u.color}33, ${u.color}11)`, border: `2px solid ${u.color}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, boxShadow: `0 0 12px ${u.color}33`, position: "relative" }}>
                  {u.avatar}
                  <div style={{ position: "absolute", bottom: 0, right: 0, width: 12, height: 12, borderRadius: "50%", background: "#00ff8c", border: "2px solid #050508", boxShadow: "0 0 6px #00ff8c88" }} />
                </div>
                <span style={{ fontSize: 10, color: "var(--text-faint)", maxWidth: 56, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.name}</span>
              </div>
            ))}
          </div>
        </GlassCard>

        {/* Post Composer */}
        <GlassCard hover={false} style={{ marginBottom: 20, padding: isMobile ? "14px 16px" : "18px 22px" }}>
          <div style={{ display: "flex", gap: 12, marginBottom: 14 }}>
            <div style={{ width: 42, height: 42, borderRadius: "50%", background: "rgba(0,255,140,0.1)", border: "2px solid rgba(0,255,140,0.3)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, color: "#00ff8c", flexShrink: 0 }}>◈</div>
            <textarea
              value={newPost} onChange={e => setNewPost(e.target.value)}
              placeholder="Drop a signal to the collective..."
              rows={3}
              style={{ flex: 1, minWidth: 0, background: "var(--card-bg)", border: "1px solid var(--card-border)", borderRadius: 12, padding: "12px 16px", color: "var(--text)", fontSize: 14, outline: "none", fontFamily: "'Sora', sans-serif", resize: "vertical", lineHeight: 1.7 }}
            />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {[{ icon: "📷", label: "Image" }, { icon: "🎥", label: "Video" }, { icon: "📊", label: "Poll" }, { icon: "📍", label: "Location" }].map(b => (
                <button key={b.label} title={b.label} style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)", borderRadius: 8, padding: isMobile ? "8px 10px" : "6px 12px", cursor: "pointer", fontSize: 14, color: "var(--text-faint)", display: "flex", alignItems: "center", gap: 6, transition: "all 0.2s" }}>
                  {b.icon} {!isMobile && <span style={{ fontSize: 11 }}>{b.label}</span>}
                </button>
              ))}
            </div>
            <button onClick={submitPost} disabled={!newPost.trim()} style={{
              padding: "8px 24px", borderRadius: 8, background: newPost.trim() ? "rgba(0,255,140,0.15)" : "rgba(255,255,255,0.03)",
              border: `1px solid ${newPost.trim() ? "rgba(0,255,140,0.4)" : "rgba(255,255,255,0.06)"}`,
              color: newPost.trim() ? "#00ff8c" : "rgba(255,255,255,0.2)",
              cursor: newPost.trim() ? "pointer" : "default", fontSize: 12, letterSpacing: 2, fontFamily: "'Orbitron', sans-serif",
            }}>TRANSMIT</button>
          </div>
        </GlassCard>

        {/* Feed Filters */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
          {filters.map(f => (
            <button key={f} onClick={() => setActiveFilter(f)} style={{
              padding: "6px 16px", borderRadius: 20, fontSize: 11, letterSpacing: 1, cursor: "pointer",
              fontFamily: "'Sora', sans-serif", textTransform: "capitalize", transition: "all 0.2s",
              background: activeFilter === f ? "rgba(0,255,140,0.12)" : "rgba(255,255,255,0.03)",
              border: `1px solid ${activeFilter === f ? "rgba(0,255,140,0.3)" : "rgba(255,255,255,0.06)"}`,
              color: activeFilter === f ? "#00ff8c" : "rgba(255,255,255,0.35)",
            }}>{f}</button>
          ))}
        </div>

        {/* Posts Feed */}
        {posts.map(post => {
          const postUser = post.customUser || COMMUNITY_USERS[post.userId - 1];
          return renderPost(post, postUser);
        })}
      </div>

      {/* ─── Right Sidebar ─── */}
      <div style={{ width: isMobile ? "100%" : 280, flexShrink: 0, display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Your Profile Card */}
        <GlassCard hover={false} style={{ textAlign: "center", padding: 22 }}>
          <div style={{ width: 64, height: 64, borderRadius: "50%", background: "rgba(0,255,140,0.1)", border: "2px solid rgba(0,255,140,0.3)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, margin: "0 auto 12px", color: "#00ff8c", boxShadow: "0 0 20px rgba(0,255,140,0.15)" }}>◈</div>
          <div style={{ fontSize: 16, fontWeight: 600, color: "var(--text)", marginBottom: 4 }}>Seeker</div>
          <div style={{ fontSize: 11, color: "var(--text-faint)", fontFamily: "'JetBrains Mono', monospace", marginBottom: 12 }}>@you</div>
          <div style={{ display: "flex", justifyContent: "center", gap: 20 }}>
            <div><div style={{ fontSize: 16, fontWeight: 600, color: "#00ff8c" }}>33</div><div style={{ fontSize: 9, color: "var(--text-faint)" }}>LEVEL</div></div>
            <div><div style={{ fontSize: 16, fontWeight: 600, color: "#a78bfa" }}>85</div><div style={{ fontSize: 9, color: "var(--text-faint)" }}>VIBE</div></div>
            <div><div style={{ fontSize: 16, fontWeight: 600, color: "#06b6d4" }}>142</div><div style={{ fontSize: 9, color: "var(--text-faint)" }}>SIGNALS</div></div>
          </div>
        </GlassCard>

        {/* Suggested Connections */}
        <GlassCard hover={false} style={{ padding: 18 }}>
          <span style={{ fontSize: 10, letterSpacing: 2, color: "var(--text-faint)", fontFamily: "'Orbitron', sans-serif", display: "block", marginBottom: 14 }}>SOULS TO CONNECT</span>
          {COMMUNITY_USERS.filter(u => !u.online).map(u => (
            <div key={u.id} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
              <div onClick={() => setSelectedProfile(u)} style={{ width: 36, height: 36, borderRadius: "50%", background: `${u.color}22`, border: `1px solid ${u.color}44`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, cursor: "pointer" }}>{u.avatar}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, color: "var(--text)", fontWeight: 500, cursor: "pointer" }} onClick={() => setSelectedProfile(u)}>{u.name}</div>
                <div style={{ fontSize: 10, color: "var(--text-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.bio.substring(0, 35)}...</div>
              </div>
              <button style={{ background: `${u.color}12`, border: `1px solid ${u.color}30`, color: u.color, borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontSize: 9, letterSpacing: 1, fontFamily: "'Orbitron', sans-serif" }}>FOLLOW</button>
            </div>
          ))}
        </GlassCard>

        {/* Trending Tags */}
        <GlassCard hover={false} style={{ padding: 18 }}>
          <span style={{ fontSize: 10, letterSpacing: 2, color: "var(--text-faint)", fontFamily: "'Orbitron', sans-serif", display: "block", marginBottom: 14 }}>TRENDING SIGNALS</span>
          {[
            { tag: "#369manifestation", posts: "2.4K signals", color: "#eab308" },
            { tag: "#scalarhealing", posts: "1.8K signals", color: "#06b6d4" },
            { tag: "#decalcifypineal", posts: "3.1K signals", color: "#a78bfa" },
            { tag: "#coppercoils", posts: "987 signals", color: "#f97316" },
            { tag: "#gatewaytapes", posts: "4.2K signals", color: "#00ff8c" },
            { tag: "#sungazing", posts: "1.5K signals", color: "#eab308" },
          ].map(t => (
            <div key={t.tag} style={{ marginBottom: 12, cursor: "pointer" }}>
              <div style={{ fontSize: 13, color: t.color, fontWeight: 500 }}>{t.tag}</div>
              <div style={{ fontSize: 10, color: "var(--text-dim)" }}>{t.posts}</div>
            </div>
          ))}
        </GlassCard>

        {/* Active Now */}
        <GlassCard hover={false} style={{ padding: 18 }}>
          <span style={{ fontSize: 10, letterSpacing: 2, color: "var(--text-faint)", fontFamily: "'Orbitron', sans-serif", display: "block", marginBottom: 14 }}>ACTIVE IN THE FIELD</span>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {COMMUNITY_USERS.filter(u => u.online).map(u => (
              <div key={u.id} onClick={() => setSelectedProfile(u)} style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                <div style={{ position: "relative" }}>
                  <div style={{ width: 28, height: 28, borderRadius: "50%", background: `${u.color}22`, border: `1px solid ${u.color}44`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13 }}>{u.avatar}</div>
                  <div style={{ position: "absolute", bottom: -1, right: -1, width: 8, height: 8, borderRadius: "50%", background: "#00ff8c", border: "1.5px solid #050508" }} />
                </div>
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{u.name}</span>
                <span style={{ fontSize: 9, color: u.color, marginLeft: "auto", fontFamily: "'Orbitron', sans-serif" }}>L{u.level}</span>
              </div>
            ))}
          </div>
        </GlassCard>
      </div>
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════
// POWER OF NUMBERS — Vortex Math, 369, Gematria, Frequencies
// ═══════════════════════════════════════════════════════════════

const NUMBER_REALMS = [
  { num: 1, name: "Unity", color: "#ffffff", freq: "396 Hz", element: "Source", planet: "Sun", chakra: "Crown",
    desc: "The point. The seed. The beginning of all things. 1 is unity, the divine source from which all numbers emerge. It cannot be divided, only multiplied.",
    energy: "Initiation, leadership, independence, manifestation. The number of the original cause.",
    keywords: ["BEGINNING", "SOURCE", "GOD", "ALL"] },
  { num: 2, name: "Duality", color: "#a78bfa", freq: "417 Hz", element: "Polarity", planet: "Moon", chakra: "Sacral",
    desc: "The line. The mirror. Above and below. Yin and yang. 2 represents the first division — the moment unity becomes aware of itself through reflection.",
    energy: "Partnership, balance, intuition, receptivity, the divine feminine.",
    keywords: ["BALANCE", "MIRROR", "PAIR", "FLOW"] },
  { num: 3, name: "Trinity", color: "#eab308", freq: "528 Hz", element: "Creation", planet: "Jupiter", chakra: "Solar Plexus",
    desc: "The triangle. The first stable form. Mind, body, spirit. Past, present, future. 3 is the first number of creation — the alchemy of two becoming three.",
    energy: "Expression, creativity, communication, joy, manifestation. Tesla's first key.",
    keywords: ["CREATE", "EXPRESS", "TRINITY", "MAGIC"] },
  { num: 4, name: "Foundation", color: "#22c55e", freq: "639 Hz", element: "Earth", planet: "Saturn", chakra: "Heart",
    desc: "The square. The four directions. The four elements. 4 is the foundation of physical reality — structure, stability, the material world made manifest.",
    energy: "Order, discipline, hard work, foundation, the architecture of reality.",
    keywords: ["STRUCTURE", "EARTH", "HOME", "BUILD"] },
  { num: 5, name: "Change", color: "#06b6d4", freq: "741 Hz", element: "Air", planet: "Mercury", chakra: "Throat",
    desc: "The pentagon. The five senses. The human form (head + 4 limbs). 5 is the number of motion, freedom, and adventure. The bridge between physical and spiritual.",
    energy: "Freedom, change, adventure, sensuality, the breaking of patterns.",
    keywords: ["FREEDOM", "MOTION", "SENSES", "HUMAN"] },
  { num: 6, name: "Harmony", color: "#ec4899", freq: "852 Hz", element: "Love", planet: "Venus", chakra: "Third Eye",
    desc: "The hexagon. The Star of David. The honeycomb. 6 is the number of harmony, beauty, and unconditional love. The second key in Tesla's 369 trinity.",
    energy: "Love, harmony, family, healing, responsibility, beauty, balance.",
    keywords: ["LOVE", "HARMONY", "BEAUTY", "FAMILY"] },
  { num: 7, name: "Mystery", color: "#8b5cf6", freq: "963 Hz", element: "Spirit", planet: "Neptune", chakra: "Soul Star",
    desc: "The seven heavens. The seven seals. The seven chakras. 7 is the most mystical of numbers — the bridge between matter and spirit. The seeker's number.",
    energy: "Wisdom, spirituality, introspection, mysticism, hidden knowledge.",
    keywords: ["MYSTERY", "WISDOM", "SPIRIT", "SEEK"] },
  { num: 8, name: "Infinity", color: "#f97316", freq: "174 Hz", element: "Power", planet: "Saturn", chakra: "Earth Star",
    desc: "The infinity symbol on its side. The double helix of DNA. The lemniscate. 8 represents infinite cycles, karma, abundance, and the law of cause and effect.",
    energy: "Abundance, karma, infinity, regeneration, cycles, material mastery.",
    keywords: ["INFINITY", "ABUNDANCE", "KARMA", "POWER"] },
  { num: 9, name: "Completion", color: "#ef4444", freq: "285 Hz", element: "Ether", planet: "Mars", chakra: "Stellar Gateway",
    desc: "The ninth and final number. All numbers reduce back to 9. The end and the beginning. Tesla's third and most powerful key — the gate to the void.",
    energy: "Completion, wisdom, universal love, end of cycles, the master number.",
    keywords: ["COMPLETION", "WISDOM", "VOID", "GATE"] },
];

const VORTEX_FACTS = [
  { title: "There Are Only 9 Numbers", desc: "Every number that exists ultimately reduces to 1-9 through digital root reduction. 10 = 1+0 = 1. 25 = 2+5 = 7. 144 = 1+4+4 = 9. The infinite collapses into nine." },
  { title: "The 3, 6, 9 Pattern", desc: "When you double any number on the vortex (1→2→4→8→16=7→32=5→64=10=1), it loops in a perfect pattern: 1-2-4-8-7-5. The numbers 3, 6, and 9 are NEVER touched by this doubling cycle. They exist outside it." },
  { title: "3 and 6 Dance Together", desc: "3 and 6 oscillate as opposites — when you double 3 you get 6, double 6 you get 12 (1+2=3). They are the polarity, the heartbeat of creation, dancing forever." },
  { title: "9 Is The Center", desc: "9 is the number that contains all others. 1+2+3+4+5+6+7+8 = 36 = 9. 9 stands alone — multiply 9 by anything and the digits always reduce back to 9. (9×7=63=9, 9×12=108=9). 9 is the void, the source." },
  { title: "Tesla's Quote", desc: "\"If you only knew the magnificence of the 3, 6 and 9, then you would have a key to the universe.\" — Nikola Tesla. He was obsessed with these numbers his entire life. He calculated everything in multiples of 3, 6, and 9." },
  { title: "The Enneagram Pattern", desc: "Marko Rodin discovered that vortex math creates a perfect torus shape — the same shape as the Earth's magnetic field, the heart's electromagnetic field, atoms, and galaxies. The universe is a 3-6-9 powered torus." },
  { title: "Doubling Circuit Visualized", desc: "Plot 1-2-4-8-7-5 around a circle (numbered 1-9 like a clock). You'll get a perfect figure-8 (infinity symbol). The 3-6-9 form their own separate triangle at the center. This is the blueprint of all creation." },
];

const SOLFEGGIO = [
  { hz: "174 Hz", name: "Foundation", desc: "Pain relief, security, grounding. Reduces stress and gives organs a sense of safety.", color: "#ef4444", num: 3 },
  { hz: "285 Hz", name: "Quantum Cognition", desc: "Tissue regeneration, healing, energy field repair. Influences cellular structures.", color: "#f97316", num: 6 },
  { hz: "396 Hz", name: "Liberation from Fear", desc: "Releases guilt, fear, and trauma. Turns grief into joy. The frequency of UT.", color: "#eab308", num: 9 },
  { hz: "417 Hz", name: "Facilitating Change", desc: "Cleanses traumatic experiences. Removes negative energy from cells and objects.", color: "#22c55e", num: 3 },
  { hz: "528 Hz", name: "Love & DNA Repair", desc: "The 'Miracle Tone.' Repairs DNA. Increases cellular life and clarity. Used in ancient healing.", color: "#06b6d4", num: 6 },
  { hz: "639 Hz", name: "Connection", desc: "Heals relationships. Enhances communication, understanding, tolerance, and love.", color: "#8b5cf6", num: 9 },
  { hz: "741 Hz", name: "Awakening Intuition", desc: "Cleans cells from electromagnetic radiation. Activates self-expression and problem-solving.", color: "#ec4899", num: 3 },
  { hz: "852 Hz", name: "Spiritual Order", desc: "Returns the soul to spiritual order. Awakens intuition. Activates third eye.", color: "#a78bfa", num: 6 },
  { hz: "963 Hz", name: "Pure Awareness", desc: "Connection to the cosmos. Returns the spirit to the original perfect state. Activates pineal.", color: "#ffffff", num: 9 },
];

const GEMATRIA_LETTERS = {
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8, I: 9,
  J: 1, K: 2, L: 3, M: 4, N: 5, O: 6, P: 7, Q: 8, R: 9,
  S: 1, T: 2, U: 3, V: 4, W: 5, X: 6, Y: 7, Z: 8,
};

const POWERFUL_WORDS = [
  { word: "LOVE", value: 9, desc: "L(3)+O(6)+V(4)+E(5) = 18 = 9. Love reduces to 9 — the number of completion and universal consciousness." },
  { word: "GOD", value: 17, reduced: 8, desc: "G(7)+O(6)+D(4) = 17 = 8. God resonates with infinity (8) and abundance — the eternal cycle." },
  { word: "TRUTH", value: 23, reduced: 5, desc: "T(2)+R(9)+U(3)+T(2)+H(8) = 24 = 6. Truth vibrates at 6 — harmony, balance, and divine love." },
  { word: "LIGHT", value: 32, reduced: 5, desc: "L(3)+I(9)+G(7)+H(8)+T(2) = 29 = 11 = 2. Light = duality, the mirror, the polarity through which we see." },
  { word: "TESLA", value: 13, reduced: 4, desc: "T(2)+E(5)+S(1)+L(3)+A(1) = 12 = 3. Tesla's name itself reduces to 3 — the first key to the universe." },
  { word: "JESUS", value: 11, reduced: 2, desc: "J(1)+E(5)+S(1)+U(3)+S(1) = 11. Master number 11 — direct gateway to higher consciousness." },
  { word: "MOTHER", value: 32, reduced: 5, desc: "M(4)+O(6)+T(2)+H(8)+E(5)+R(9) = 34 = 7. Mother = 7, the mystery and the source of life." },
  { word: "FATHER", value: 25, reduced: 7, desc: "F(6)+A(1)+T(2)+H(8)+E(5)+R(9) = 31 = 4. Father = 4, the foundation, the structure, the builder." },
];

function PowerOfNumbersSection() {
  const [view, setView] = useState("realms");
  const [selectedNum, setSelectedNum] = useState(null);
  const [gematriaInput, setGematriaInput] = useState("");
  const [vortexNumber, setVortexNumber] = useState(2);
  const [doubleSequence, setDoubleSequence] = useState([]);
  const [audioFreq, setAudioFreq] = useState(null);

  // Calculate gematria
  const calcGematria = (word) => {
    const clean = word.toUpperCase().replace(/[^A-Z]/g, "");
    const sum = clean.split("").reduce((a, c) => a + (GEMATRIA_LETTERS[c] || 0), 0);
    let reduced = sum;
    while (reduced > 9) {
      reduced = String(reduced).split("").reduce((a, d) => a + parseInt(d), 0);
    }
    return { sum, reduced, letters: clean.split("").map(c => ({ letter: c, value: GEMATRIA_LETTERS[c] || 0 })) };
  };

  const gematriaResult = gematriaInput ? calcGematria(gematriaInput) : null;

  // Vortex doubling demonstration
  useEffect(() => {
    const seq = [vortexNumber];
    let n = vortexNumber;
    for (let i = 0; i < 11; i++) {
      n = n * 2;
      while (n > 9) n = String(n).split("").reduce((a, d) => a + parseInt(d), 0);
      seq.push(n);
    }
    setDoubleSequence(seq);
  }, [vortexNumber]);

  // Play frequency
  const playFreq = (hz) => {
    if (audioFreq) {
      audioFreq.osc.stop();
      setAudioFreq(null);
      return;
    }
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = parseFloat(hz);
      osc.type = "sine";
      gain.gain.value = 0.1;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      setAudioFreq({ osc, ctx });
      setTimeout(() => { try { osc.stop(); } catch {} setAudioFreq(null); }, 8000);
    } catch (e) { console.error(e); }
  };

  // Number detail view
  if (selectedNum !== null) {
    const realm = NUMBER_REALMS[selectedNum - 1];
    return (
      <div style={{ animation: "fadeInUp 0.4s ease" }}>
        <button onClick={() => setSelectedNum(null)} style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.5)", padding: "8px 18px", borderRadius: 8, cursor: "pointer", fontSize: 11, letterSpacing: 2, fontFamily: "'Orbitron', sans-serif", marginBottom: 24 }}>← BACK TO NUMBERS</button>

        <div style={{ display: "flex", alignItems: "center", gap: 24, marginBottom: 28, flexWrap: "wrap" }}>
          <div style={{
            width: 120, height: 120, borderRadius: "50%",
            background: `radial-gradient(circle at 35% 30%, ${realm.color}66, ${realm.color}11 70%, transparent)`,
            border: `3px solid ${realm.color}`,
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: `0 0 60px ${realm.color}55, inset 0 0 40px ${realm.color}33`,
            fontSize: 64, fontWeight: 700, color: realm.color,
            fontFamily: "'Orbitron', sans-serif",
            textShadow: `0 0 30px ${realm.color}`,
          }}>{realm.num}</div>
          <div style={{ flex: 1, minWidth: 250 }}>
            <h2 style={{ fontSize: 32, fontWeight: 600, color: "#fff", fontFamily: "'Orbitron', sans-serif", margin: 0, letterSpacing: 2, textShadow: `0 0 20px ${realm.color}55` }}>{realm.name}</h2>
            <p style={{ fontSize: 13, color: realm.color, marginTop: 6, letterSpacing: 3, fontFamily: "'JetBrains Mono', monospace" }}>{realm.freq} • {realm.element} • {realm.planet}</p>
            <p style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginTop: 4, letterSpacing: 2 }}>CHAKRA: {realm.chakra}</p>
          </div>
        </div>

        <GlassCard hover={false} style={{ marginBottom: 16, borderLeft: `3px solid ${realm.color}` }}>
          <div style={{ fontSize: 10, letterSpacing: 3, color: realm.color, fontFamily: "'Orbitron', sans-serif", marginBottom: 10 }}>⟡ ESSENCE</div>
          <p style={{ fontSize: 15, color: "rgba(255,255,255,0.75)", lineHeight: 1.8, margin: 0 }}>{realm.desc}</p>
        </GlassCard>

        <GlassCard hover={false} style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 10, letterSpacing: 3, color: realm.color, fontFamily: "'Orbitron', sans-serif", marginBottom: 10 }}>⟡ ENERGY</div>
          <p style={{ fontSize: 14, color: "rgba(255,255,255,0.6)", lineHeight: 1.8, margin: 0 }}>{realm.energy}</p>
        </GlassCard>

        <GlassCard hover={false}>
          <div style={{ fontSize: 10, letterSpacing: 3, color: realm.color, fontFamily: "'Orbitron', sans-serif", marginBottom: 14 }}>⟡ KEYWORDS</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {realm.keywords.map(k => (
              <span key={k} style={{ fontSize: 11, padding: "6px 14px", borderRadius: 6, background: `${realm.color}12`, border: `1px solid ${realm.color}30`, color: realm.color, letterSpacing: 2, fontFamily: "'Orbitron', sans-serif" }}>{k}</span>
            ))}
          </div>
        </GlassCard>

        {realm.num === 3 || realm.num === 6 || realm.num === 9 ? (
          <div style={{ marginTop: 20, padding: 24, borderRadius: 12, background: `linear-gradient(135deg, ${realm.color}10, ${realm.color}05)`, border: `1px solid ${realm.color}30` }}>
            <div style={{ fontSize: 10, letterSpacing: 4, color: realm.color, fontFamily: "'Orbitron', sans-serif", marginBottom: 12 }}>★ TESLA KEY NUMBER</div>
            <p style={{ fontSize: 14, color: "rgba(255,255,255,0.7)", lineHeight: 1.8, margin: 0 }}>
              {realm.num === 3 && "The first divine key. Three is the trinity — mind, body, spirit. The first stable form. Tesla calculated all his major experiments using multiples of 3."}
              {realm.num === 6 && "The second divine key. Six is the harmony — the perfect hexagon, the structure of carbon (the building block of life), the honeycomb of bees. The bridge between matter and spirit."}
              {realm.num === 9 && "The third and most powerful key. Nine is the void, the source, the all-containing number. Multiply 9 by anything — the digits always return to 9. It is unbreakable. It is the gate."}
            </p>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div style={{ animation: "fadeInUp 0.5s ease" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
        <div style={{ width: 3, height: 28, background: "linear-gradient(to bottom, #eab308, #ec4899, #ef4444)", borderRadius: 2 }} />
        <h2 style={{ fontSize: 22, fontWeight: 300, color: "#fff", fontFamily: "'Sora', sans-serif", margin: 0 }}>POWER OF NUMBERS</h2>
      </div>
      <p style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", lineHeight: 1.8, marginTop: 8, marginBottom: 24 }}>
        There are only 9 numbers. Everything else is repetition. Tesla called 3, 6, 9 the keys to the universe. Here's why.
      </p>

      {/* View Tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 24, flexWrap: "wrap" }}>
        {[
          { id: "realms", label: "THE 9 REALMS", icon: "⓷" },
          { id: "vortex", label: "VORTEX MATH", icon: "◌" },
          { id: "frequencies", label: "FREQUENCIES", icon: "〰" },
          { id: "gematria", label: "GEMATRIA", icon: "✦" },
          { id: "spells", label: "WORD CASTING", icon: "❋" },
        ].map(t => (
          <button key={t.id} onClick={() => setView(t.id)} style={{
            padding: "10px 18px", borderRadius: 8,
            background: view === t.id ? "rgba(234,179,8,0.15)" : "rgba(255,255,255,0.03)",
            border: `1px solid ${view === t.id ? "rgba(234,179,8,0.4)" : "rgba(255,255,255,0.06)"}`,
            color: view === t.id ? "#eab308" : "rgba(255,255,255,0.4)",
            cursor: "pointer", fontSize: 11, letterSpacing: 2, fontFamily: "'Orbitron', sans-serif",
            transition: "all 0.3s ease",
          }}>{t.icon} {t.label}</button>
        ))}
      </div>

      {/* ─── REALMS VIEW ─── */}
      {view === "realms" && (
        <div>
          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", lineHeight: 1.7, marginBottom: 20, fontStyle: "italic" }}>
            Tap any number to enter its realm. Each one is a frequency, an element, a chakra, an archetype.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 16 }}>
            {NUMBER_REALMS.map(r => {
              const isKey = r.num === 3 || r.num === 6 || r.num === 9;
              return (
                <GlassCard key={r.num} onClick={() => setSelectedNum(r.num)} style={{
                  cursor: "pointer", textAlign: "center", padding: 24,
                  borderTop: `2px solid ${r.color}${isKey ? "" : "60"}`,
                  background: isKey ? `linear-gradient(180deg, ${r.color}08, transparent)` : undefined,
                  position: "relative",
                }}>
                  {isKey && <div style={{ position: "absolute", top: 8, right: 8, fontSize: 10, color: r.color, fontFamily: "'Orbitron', sans-serif", letterSpacing: 1 }}>★ KEY</div>}
                  <div style={{
                    width: 80, height: 80, borderRadius: "50%",
                    background: `radial-gradient(circle at 35% 30%, ${r.color}66, ${r.color}11 70%, transparent)`,
                    border: `2px solid ${r.color}`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    boxShadow: `0 0 30px ${r.color}44, inset 0 0 20px ${r.color}22`,
                    fontSize: 42, fontWeight: 700, color: r.color,
                    fontFamily: "'Orbitron', sans-serif", margin: "0 auto 14px",
                    textShadow: `0 0 20px ${r.color}`,
                  }}>{r.num}</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "#fff", fontFamily: "'Orbitron', sans-serif", letterSpacing: 1, marginBottom: 4 }}>{r.name}</div>
                  <div style={{ fontSize: 10, color: r.color, fontFamily: "'JetBrains Mono', monospace", letterSpacing: 1 }}>{r.freq}</div>
                  <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", marginTop: 4, letterSpacing: 1 }}>{r.element}</div>
                </GlassCard>
              );
            })}
          </div>
        </div>
      )}

      {/* ─── VORTEX MATH VIEW ─── */}
      {view === "vortex" && (
        <div>
          {/* Tesla quote */}
          <GlassCard hover={false} style={{ marginBottom: 20, padding: 28, background: "linear-gradient(135deg, rgba(234,179,8,0.06), rgba(167,139,250,0.06))", border: "1px solid rgba(234,179,8,0.15)", textAlign: "center" }}>
            <div style={{ fontSize: 10, letterSpacing: 4, color: "#eab308", marginBottom: 14, fontFamily: "'Orbitron', sans-serif" }}>★ NIKOLA TESLA ★</div>
            <p style={{ fontSize: 20, color: "#fff", fontWeight: 300, lineHeight: 1.6, fontStyle: "italic", margin: 0, fontFamily: "'Sora', sans-serif" }}>
              "If you only knew the magnificence of the 3, 6 and 9, then you would have a key to the universe."
            </p>
          </GlassCard>

          {/* Doubling Circuit */}
          <GlassCard hover={false} style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 10, letterSpacing: 3, color: "#eab308", fontFamily: "'Orbitron', sans-serif", marginBottom: 16 }}>⟡ THE DOUBLING CIRCUIT — INTERACTIVE</div>
            <p style={{ fontSize: 13, color: "rgba(255,255,255,0.5)", lineHeight: 1.8, marginBottom: 16 }}>
              Pick any number 1-9. Double it repeatedly. Reduce each result to a single digit. You'll always get the same loop: <span style={{ color: "#eab308", fontFamily: "'Orbitron', sans-serif" }}>1 → 2 → 4 → 8 → 7 → 5</span>. The numbers 3, 6, and 9 are NEVER touched. They exist outside the doubling loop. They are the keys.
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
              {[1,2,3,4,5,6,7,8,9].map(n => (
                <button key={n} onClick={() => setVortexNumber(n)} style={{
                  width: 44, height: 44, borderRadius: 8,
                  background: vortexNumber === n ? "rgba(234,179,8,0.2)" : "rgba(255,255,255,0.04)",
                  border: `1px solid ${vortexNumber === n ? "rgba(234,179,8,0.5)" : "rgba(255,255,255,0.08)"}`,
                  color: vortexNumber === n ? "#eab308" : "rgba(255,255,255,0.5)",
                  cursor: "pointer", fontSize: 18, fontWeight: 700, fontFamily: "'Orbitron', sans-serif",
                }}>{n}</button>
              ))}
            </div>
            <div style={{ padding: 16, borderRadius: 8, background: "rgba(0,0,0,0.3)", border: "1px solid rgba(234,179,8,0.15)", overflowX: "auto" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                {doubleSequence.map((n, i) => {
                  const isKey = n === 3 || n === 6 || n === 9;
                  return (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{
                        width: 36, height: 36, borderRadius: "50%",
                        background: isKey ? "rgba(239,68,68,0.15)" : "rgba(234,179,8,0.1)",
                        border: `1px solid ${isKey ? "rgba(239,68,68,0.4)" : "rgba(234,179,8,0.3)"}`,
                        color: isKey ? "#ef4444" : "#eab308",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 14, fontWeight: 700, fontFamily: "'Orbitron', sans-serif",
                      }}>{n}</div>
                      {i < doubleSequence.length - 1 && <span style={{ color: "rgba(255,255,255,0.2)" }}>→</span>}
                    </div>
                  );
                })}
              </div>
            </div>
            <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", marginTop: 14, fontStyle: "italic" }}>Notice: starting from any number 1-9 (except 3, 6, 9), you fall into the same loop: 1-2-4-8-7-5</p>
          </GlassCard>

          {/* Vortex Facts */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {VORTEX_FACTS.map((f, i) => (
              <GlassCard key={i} hover={false} style={{ borderLeft: "3px solid #eab308" }}>
                <h3 style={{ fontSize: 15, fontWeight: 600, color: "#eab308", fontFamily: "'Orbitron', sans-serif", margin: "0 0 8px", letterSpacing: 1 }}>{f.title}</h3>
                <p style={{ fontSize: 13, color: "rgba(255,255,255,0.6)", lineHeight: 1.8, margin: 0 }}>{f.desc}</p>
              </GlassCard>
            ))}
          </div>

          {/* The 9 Math Demonstration */}
          <GlassCard hover={false} style={{ marginTop: 20, background: "linear-gradient(135deg, rgba(239,68,68,0.06), transparent)" }}>
            <div style={{ fontSize: 10, letterSpacing: 3, color: "#ef4444", fontFamily: "'Orbitron', sans-serif", marginBottom: 14 }}>⟡ THE MAGIC OF 9 — TRY IT YOURSELF</div>
            <p style={{ fontSize: 13, color: "rgba(255,255,255,0.5)", lineHeight: 1.8, marginBottom: 14 }}>Multiply 9 by ANY number. Add the digits. The answer is always 9.</p>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: "rgba(255,255,255,0.7)", lineHeight: 2 }}>
              9 × 1 = <span style={{ color: "#ef4444" }}>9</span><br />
              9 × 7 = 63 → 6+3 = <span style={{ color: "#ef4444" }}>9</span><br />
              9 × 12 = 108 → 1+0+8 = <span style={{ color: "#ef4444" }}>9</span><br />
              9 × 33 = 297 → 2+9+7 = 18 → 1+8 = <span style={{ color: "#ef4444" }}>9</span><br />
              9 × 369 = 3321 → 3+3+2+1 = <span style={{ color: "#ef4444" }}>9</span>
            </div>
            <p style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginTop: 14, fontStyle: "italic" }}>9 is the only number that contains all others. It is the void from which everything emerges and to which everything returns.</p>
          </GlassCard>
        </div>
      )}

      {/* ─── FREQUENCIES VIEW ─── */}
      {view === "frequencies" && (
        <div>
          <p style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", lineHeight: 1.8, marginBottom: 20 }}>
            The 9 Solfeggio frequencies. Tap any one to play it (8 seconds). Headphones recommended.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
            {SOLFEGGIO.map((f, i) => (
              <GlassCard key={i} onClick={() => playFreq(f.hz)} style={{
                cursor: "pointer", borderLeft: `3px solid ${f.color}`,
                background: audioFreq && audioFreq.osc.frequency.value === parseFloat(f.hz) ? `${f.color}10` : undefined,
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                  <div>
                    <div style={{ fontSize: 24, fontWeight: 700, color: f.color, fontFamily: "'Orbitron', sans-serif", letterSpacing: 1, textShadow: `0 0 15px ${f.color}55` }}>{f.hz}</div>
                    <div style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", marginTop: 4, letterSpacing: 1 }}>{f.name}</div>
                  </div>
                  <div style={{
                    width: 32, height: 32, borderRadius: "50%",
                    background: `${f.color}15`, border: `1px solid ${f.color}40`,
                    color: f.color, display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 14, fontWeight: 700, fontFamily: "'Orbitron', sans-serif",
                  }}>{f.num}</div>
                </div>
                <p style={{ fontSize: 12, color: "rgba(255,255,255,0.55)", lineHeight: 1.7, margin: "10px 0" }}>{f.desc}</p>
                <div style={{ fontSize: 10, color: f.color, fontFamily: "'Orbitron', sans-serif", letterSpacing: 2, marginTop: 8 }}>▶ TAP TO PLAY</div>
              </GlassCard>
            ))}
          </div>
          <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", marginTop: 20, fontStyle: "italic", textAlign: "center" }}>Notice — every Solfeggio frequency reduces to 3, 6, or 9. This is not a coincidence.</p>
        </div>
      )}

      {/* ─── GEMATRIA VIEW ─── */}
      {view === "gematria" && (
        <div>
          <GlassCard hover={false} style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 10, letterSpacing: 3, color: "#a78bfa", fontFamily: "'Orbitron', sans-serif", marginBottom: 14 }}>⟡ WHAT IS GEMATRIA?</div>
            <p style={{ fontSize: 14, color: "rgba(255,255,255,0.65)", lineHeight: 1.8, marginBottom: 12 }}>
              Gematria is the ancient practice of assigning numerical values to letters and words. The Greeks, Hebrews, and Arabs all used it to find hidden meanings in sacred texts. Every letter has a number. Every word has a vibration. Every name has a frequency.
            </p>
            <p style={{ fontSize: 14, color: "rgba(255,255,255,0.65)", lineHeight: 1.8, margin: 0 }}>
              In simple Pythagorean gematria: A=1, B=2, C=3... I=9, then it loops. J=1, K=2... R=9, then S=1, T=2... Z=8. Add up the letters of any word, reduce to a single digit, and you find its essence.
            </p>
          </GlassCard>

          {/* Gematria Calculator */}
          <GlassCard hover={false} style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 10, letterSpacing: 3, color: "#a78bfa", fontFamily: "'Orbitron', sans-serif", marginBottom: 14 }}>⟡ GEMATRIA CALCULATOR</div>
            <input
              value={gematriaInput}
              onChange={(e) => setGematriaInput(e.target.value)}
              placeholder="Enter a word or name..."
              style={{ width: "100%", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(167,139,250,0.2)", borderRadius: 10, padding: "14px 18px", color: "#fff", fontSize: 18, outline: "none", fontFamily: "'Orbitron', sans-serif", letterSpacing: 3, textTransform: "uppercase", textAlign: "center", marginBottom: 18 }}
            />
            {gematriaResult && gematriaResult.letters.length > 0 && (
              <div>
                <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap", marginBottom: 18 }}>
                  {gematriaResult.letters.map((l, i) => (
                    <div key={i} style={{ textAlign: "center" }}>
                      <div style={{
                        width: 44, height: 44, borderRadius: 8,
                        background: "rgba(167,139,250,0.1)", border: "1px solid rgba(167,139,250,0.3)",
                        color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 18, fontWeight: 700, fontFamily: "'Orbitron', sans-serif",
                      }}>{l.letter}</div>
                      <div style={{ fontSize: 14, color: "#a78bfa", marginTop: 4, fontFamily: "'Orbitron', sans-serif", fontWeight: 700 }}>{l.value}</div>
                    </div>
                  ))}
                </div>
                <div style={{ textAlign: "center", padding: 20, background: "rgba(167,139,250,0.06)", borderRadius: 10, border: "1px solid rgba(167,139,250,0.2)" }}>
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", letterSpacing: 2, marginBottom: 8 }}>SUM = {gematriaResult.sum} → REDUCED</div>
                  <div style={{ fontSize: 64, fontWeight: 700, color: "#a78bfa", fontFamily: "'Orbitron', sans-serif", textShadow: "0 0 30px rgba(167,139,250,0.5)" }}>{gematriaResult.reduced}</div>
                  <div style={{ fontSize: 12, color: NUMBER_REALMS[gematriaResult.reduced - 1]?.color, marginTop: 8, fontFamily: "'Orbitron', sans-serif", letterSpacing: 2 }}>
                    {NUMBER_REALMS[gematriaResult.reduced - 1]?.name?.toUpperCase()}
                  </div>
                </div>
              </div>
            )}
          </GlassCard>

          {/* Powerful Words */}
          <span style={{ fontSize: 10, letterSpacing: 3, color: "rgba(255,255,255,0.3)", fontFamily: "'Orbitron', sans-serif", display: "block", marginBottom: 14 }}>POWERFUL WORDS DECODED</span>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {POWERFUL_WORDS.map((w, i) => (
              <GlassCard key={i} hover={false} style={{ borderLeft: "3px solid #a78bfa" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 10 }}>
                  <span style={{ fontSize: 22, fontWeight: 700, color: "#fff", fontFamily: "'Orbitron', sans-serif", letterSpacing: 3 }}>{w.word}</span>
                  <span style={{ fontSize: 11, color: "#a78bfa", fontFamily: "'JetBrains Mono', monospace" }}>= {w.value}{w.reduced ? ` → ${w.reduced}` : ""}</span>
                </div>
                <p style={{ fontSize: 12, color: "rgba(255,255,255,0.55)", lineHeight: 1.7, margin: 0 }}>{w.desc}</p>
              </GlassCard>
            ))}
          </div>
        </div>
      )}

      {/* ─── WORD CASTING / SPELLS VIEW ─── */}
      {view === "spells" && (
        <div>
          <GlassCard hover={false} style={{ marginBottom: 20, background: "linear-gradient(135deg, rgba(236,72,153,0.06), rgba(167,139,250,0.06))" }}>
            <div style={{ fontSize: 10, letterSpacing: 3, color: "#ec4899", fontFamily: "'Orbitron', sans-serif", marginBottom: 14 }}>⟡ THE TRUTH ABOUT SPELLING</div>
            <p style={{ fontSize: 14, color: "rgba(255,255,255,0.65)", lineHeight: 1.8, marginBottom: 12 }}>
              Why is it called "spelling"? Because every word you SPELL is a SPELL you cast. Words are sound-shapes. Sound is vibration. Vibration is creation. The dictionary is a "spell book." Your "vocabulary" comes from "vocal" — your voice creates reality.
            </p>
            <p style={{ fontSize: 14, color: "rgba(255,255,255,0.65)", lineHeight: 1.8, margin: 0 }}>
              When a "judge" hands down a "sentence," that sentence becomes your reality. When you "curse" someone, you cast a curse. When you "pronounce" judgment, you create with your voice. The legal system, religion, and language itself were built around the magic of spoken words.
            </p>
          </GlassCard>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {[
              { title: "Spelling = Casting", desc: "When you 'spell' a word, you arrange letters in a specific pattern. Each letter is a sound, each sound a vibration. Combined, they form a sigil — a magical symbol that programs reality.", color: "#ec4899" },
              { title: "Curse / Cursive", desc: "The word 'curse' shares roots with 'cursive' — flowing handwriting. To write something cursively is to bind it. Contracts, oaths, and signatures are spells made permanent in writing.", color: "#a78bfa" },
              { title: "Sentencing", desc: "A judge gives you a 'sentence.' That sentence becomes your reality for years. Your DNA listens. The same word in grammar IS the same word in court — a pattern of words that shapes existence.", color: "#06b6d4" },
              { title: "Mantras = Mind Tools", desc: "The Sanskrit word 'mantra' literally means 'mind tool.' Repetition of sounds rewires neural pathways and entrains the body to specific frequencies. OM = 432 Hz. AUM contains all sounds.", color: "#22c55e" },
              { title: "Affirmations = Self-Spells", desc: "'I am' is the most powerful phrase you can speak. Whatever you put after 'I am' becomes a command to your subconscious. 'I am tired' is a spell. 'I am abundant' is a spell. Choose carefully.", color: "#eab308" },
              { title: "The Word Made Flesh", desc: "'In the beginning was the Word, and the Word was with God, and the Word was God.' (John 1:1). Sound created the universe in nearly every creation myth — Christian, Hindu (OM), Egyptian, Aboriginal.", color: "#ef4444" },
              { title: "Forbidden Words", desc: "Some words are 'banned' because they have power. Why are certain names of God 'unspeakable'? Why do some cultures forbid speaking the names of the dead? Words have weight. Names create reality.", color: "#f97316" },
              { title: "Names as Frequencies", desc: "Your name is the vibration you respond to most. It shapes how others see you and how you see yourself. Many spiritual traditions give 'spiritual names' to mark the rebirth of consciousness.", color: "#8b5cf6" },
              { title: "The Law of Attraction = Word Magic", desc: "'Like attracts like' is the foundation of word magic. Speak abundance, attract abundance. Speak lack, attract lack. Your words plant seeds in the field of consciousness — and the field always responds.", color: "#14b8a6" },
            ].map((s, i) => (
              <GlassCard key={i} hover={false} style={{ borderLeft: `3px solid ${s.color}` }}>
                <h3 style={{ fontSize: 15, fontWeight: 600, color: s.color, fontFamily: "'Orbitron', sans-serif", margin: "0 0 8px", letterSpacing: 1 }}>{s.title}</h3>
                <p style={{ fontSize: 13, color: "rgba(255,255,255,0.6)", lineHeight: 1.8, margin: 0 }}>{s.desc}</p>
              </GlassCard>
            ))}
          </div>

          {/* Power Affirmations */}
          <GlassCard hover={false} style={{ marginTop: 20, background: "linear-gradient(135deg, rgba(0,255,140,0.06), rgba(167,139,250,0.06))", border: "1px solid rgba(0,255,140,0.15)" }}>
            <div style={{ fontSize: 10, letterSpacing: 3, color: "#00ff8c", fontFamily: "'Orbitron', sans-serif", marginBottom: 16, textAlign: "center" }}>⟡ POWER AFFIRMATIONS — SPEAK THESE DAILY ⟡</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {[
                "I AM the source of my reality.",
                "I AM aligned with the frequency of love.",
                "I AM abundance flowing through me.",
                "I AM healed, whole, and complete.",
                "I AM the 3, the 6, and the 9.",
                "I AM the witness aware of itself.",
              ].map((a, i) => (
                <div key={i} style={{ padding: "12px 18px", background: "rgba(0,0,0,0.2)", borderRadius: 8, borderLeft: "2px solid #00ff8c", fontSize: 14, color: "#fff", fontFamily: "'Sora', sans-serif", fontStyle: "italic", letterSpacing: 1 }}>"{a}"</div>
              ))}
            </div>
          </GlassCard>
        </div>
      )}

      {/* Footer note */}
      <div style={{ marginTop: 24, padding: 16, borderRadius: 10, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)", textAlign: "center" }}>
        <p style={{ fontSize: 11, color: "rgba(255,255,255,0.25)", fontFamily: "'JetBrains Mono', monospace", margin: 0, lineHeight: 1.7 }}>
          "The day science begins to study non-physical phenomena, it will make more progress in one decade than in all the previous centuries of its existence." — Nikola Tesla
        </p>
      </div>
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════
// AMBIENT GLOW — Mouse aura on desktop, tilt-reactive perimeter on mobile
// ═══════════════════════════════════════════════════════════════
function PerimeterGlow({ mood, isMobile }) {
  // ─── DESKTOP: Mouse cursor aura with trailing matrix chars ───
  const [mousePos, setMousePos] = useState({ x: -200, y: -200 });
  const [trail, setTrail] = useState([]); // history of past positions w/ matrix chars
  const mouseRef = useRef({ x: -200, y: -200 });
  const rafRef = useRef(null);
  const trailRef = useRef([]);
  const lastTrailUpdate = useRef(0);

  useEffect(() => {
    if (isMobile) return;

    const matrixChars = "0123456789アウエカキサシスセタチツテトΣΩΔΘΨ∞◈⬡✧3";

    const handleMouse = (e) => {
      mouseRef.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener("mousemove", handleMouse);

    // Smooth lerp animation + trail history
    const animate = () => {
      setMousePos(prev => {
        const next = {
          x: prev.x + (mouseRef.current.x - prev.x) * 0.18,
          y: prev.y + (mouseRef.current.y - prev.y) * 0.18,
        };

        // Add to trail history at intervals (limit how often we push to trail)
        const now = Date.now();
        if (now - lastTrailUpdate.current > 35) {
          lastTrailUpdate.current = now;
          const dx = mouseRef.current.x - prev.x;
          const dy = mouseRef.current.y - prev.y;
          const moving = Math.sqrt(dx * dx + dy * dy) > 0.5;

          if (moving) {
            const newPoint = {
              x: next.x,
              y: next.y,
              char: matrixChars[Math.floor(Math.random() * matrixChars.length)],
              id: now,
              spawn: now,
            };
            trailRef.current = [newPoint, ...trailRef.current].slice(0, 18);
            setTrail([...trailRef.current]);
          }
        }

        return next;
      });
      rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);

    // Cleanup old trail points
    const cleanupInterval = setInterval(() => {
      const now = Date.now();
      trailRef.current = trailRef.current.filter(p => now - p.spawn < 1200);
      setTrail([...trailRef.current]);
    }, 100);

    return () => {
      window.removeEventListener("mousemove", handleMouse);
      cancelAnimationFrame(rafRef.current);
      clearInterval(cleanupInterval);
    };
  }, [isMobile]);

  // ─── MOBILE: Gyroscope perimeter glow ───
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const tiltRef = useRef({ x: 0, y: 0 });
  const tiltRafRef = useRef(null);

  useEffect(() => {
    if (!isMobile) return;

    // Smooth tilt animation
    const animate = () => {
      setTilt(prev => ({
        x: prev.x + (tiltRef.current.x - prev.x) * 0.08,
        y: prev.y + (tiltRef.current.y - prev.y) * 0.08,
      }));
      tiltRafRef.current = requestAnimationFrame(animate);
    };
    tiltRafRef.current = requestAnimationFrame(animate);

    let orientationHandler;
    const setupOrientation = () => {
      orientationHandler = (e) => {
        const gamma = e.gamma || 0;
        const beta = e.beta || 0;
        const x = clamp(gamma / 30, -1, 1);
        const y = clamp((beta - 45) / 30, -1, 1);
        tiltRef.current = { x, y };
      };
      window.addEventListener("deviceorientation", orientationHandler);
    };

    if (typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function") {
      const requestPermission = async () => {
        try {
          const result = await DeviceOrientationEvent.requestPermission();
          if (result === "granted") setupOrientation();
        } catch (e) {}
        document.removeEventListener("touchstart", requestPermission);
      };
      document.addEventListener("touchstart", requestPermission, { once: true });
    } else {
      setupOrientation();
    }

    return () => {
      if (orientationHandler) window.removeEventListener("deviceorientation", orientationHandler);
      cancelAnimationFrame(tiltRafRef.current);
    };
  }, [isMobile]);

  const isLight = mood === "light";

  // ─── DESKTOP: Mouse cursor aura render ───
  if (!isMobile) {
    // In light mode use a teal/green hue, in dark mode brighter green
    const auraColor = isLight ? "rgba(13, 150, 104," : "rgba(0, 255, 140,";
    const auraColor2 = isLight ? "rgba(167, 139, 250," : "rgba(167, 139, 250,";
    const trailCharColor = isLight ? "13, 80, 50" : "0, 255, 140";

    return (
      <>
        {/* Trailing matrix characters following the cursor */}
        {trail.map((point, i) => {
          const age = (Date.now() - point.spawn) / 1200; // 0..1
          const fade = Math.max(0, 1 - age);
          const indexFade = 1 - (i / trail.length); // newer = brighter
          const finalAlpha = fade * indexFade * 0.85;
          const size = 14 - i * 0.4;
          const isFresh = i < 2;

          return (
            <div key={point.id} style={{
              position: "fixed",
              left: point.x,
              top: point.y,
              transform: `translate(-50%, -50%)`,
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: Math.max(8, size),
              fontWeight: isFresh ? 600 : 400,
              color: isFresh
                ? `rgba(255, 255, 255, ${finalAlpha})`
                : `rgba(${trailCharColor}, ${finalAlpha})`,
              textShadow: `0 0 ${10 - i * 0.4}px rgba(${trailCharColor}, ${finalAlpha * 0.8}), 0 0 ${20 - i}px rgba(${trailCharColor}, ${finalAlpha * 0.4})`,
              pointerEvents: "none",
              zIndex: 998,
              userSelect: "none",
              transition: "opacity 0.1s linear",
              mixBlendMode: isLight ? "normal" : "screen",
            }}>
              {point.char}
            </div>
          );
        })}


      </>
    );
  }

  // ─── MOBILE: No always-on glow layer (keeps matrix rain clear and bright) ───
  // The tilt-reactive glow was creating a constant white haze over the matrix.
  // On mobile, we return null so nothing overlays the matrix rain.
  if (isMobile) return null;

  // ─── MOBILE (DISABLED): Solid white-with-green-tint perimeter glow ───
  // Direction-based intensity (which edge glows brighter based on tilt)
  const leftGlow = Math.max(0, -tilt.x);
  const rightGlow = Math.max(0, tilt.x);
  const topGlow = Math.max(0, -tilt.y);
  const bottomGlow = Math.max(0, tilt.y);

  // Base ambient white-green glow that's always present
  const ambient = 0.25;

  // Solid white with hint of green — color values
  // Pure white base + faint green tint to match Matrix
  const glowSize = 70;

  // Builds a layered white-green gradient
  const buildGlow = (intensity, direction) => {
    const total = ambient + intensity * 0.65;
    return `linear-gradient(${direction},
      rgba(255, 255, 255, ${(total).toFixed(3)}) 0%,
      rgba(220, 255, 235, ${(total * 0.7).toFixed(3)}) 20%,
      rgba(180, 255, 210, ${(total * 0.4).toFixed(3)}) 50%,
      transparent 100%)`;
  };

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 999,
      pointerEvents: "none",
      mixBlendMode: isLight ? "screen" : "screen",
    }}>
      {/* Left edge */}
      <div style={{
        position: "absolute", left: 0, top: 0, bottom: 0, width: glowSize,
        background: buildGlow(leftGlow, "to right"),
        transition: "background 0.15s linear",
        filter: "blur(3px)",
      }} />
      {/* Right edge */}
      <div style={{
        position: "absolute", right: 0, top: 0, bottom: 0, width: glowSize,
        background: buildGlow(rightGlow, "to left"),
        transition: "background 0.15s linear",
        filter: "blur(3px)",
      }} />
      {/* Top edge */}
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0, height: glowSize,
        background: buildGlow(topGlow, "to bottom"),
        transition: "background 0.15s linear",
        filter: "blur(3px)",
      }} />
      {/* Bottom edge */}
      <div style={{
        position: "absolute", bottom: 0, left: 0, right: 0, height: glowSize,
        background: buildGlow(bottomGlow, "to top"),
        transition: "background 0.15s linear",
        filter: "blur(3px)",
      }} />

      {/* Inner glow ring — always visible, gives the screen a luminous frame */}
      <div style={{
        position: "absolute", inset: 0,
        boxShadow: `inset 0 0 60px rgba(255, 255, 255, 0.15), inset 0 0 100px rgba(180, 255, 210, 0.08)`,
        pointerEvents: "none",
      }} />

      {/* Corner soft glows for diagonal tilts */}
      <div style={{
        position: "absolute", left: 0, top: 0, width: glowSize * 1.8, height: glowSize * 1.8,
        background: `radial-gradient(circle at top left, rgba(255,255,255,${(leftGlow * topGlow * 0.5 + 0.08).toFixed(3)}), rgba(180,255,210,${(leftGlow * topGlow * 0.2 + 0.03).toFixed(3)}) 40%, transparent 70%)`,
        filter: "blur(4px)",
      }} />
      <div style={{
        position: "absolute", right: 0, top: 0, width: glowSize * 1.8, height: glowSize * 1.8,
        background: `radial-gradient(circle at top right, rgba(255,255,255,${(rightGlow * topGlow * 0.5 + 0.08).toFixed(3)}), rgba(180,255,210,${(rightGlow * topGlow * 0.2 + 0.03).toFixed(3)}) 40%, transparent 70%)`,
        filter: "blur(4px)",
      }} />
      <div style={{
        position: "absolute", left: 0, bottom: 0, width: glowSize * 1.8, height: glowSize * 1.8,
        background: `radial-gradient(circle at bottom left, rgba(255,255,255,${(leftGlow * bottomGlow * 0.5 + 0.08).toFixed(3)}), rgba(180,255,210,${(leftGlow * bottomGlow * 0.2 + 0.03).toFixed(3)}) 40%, transparent 70%)`,
        filter: "blur(4px)",
      }} />
      <div style={{
        position: "absolute", right: 0, bottom: 0, width: glowSize * 1.8, height: glowSize * 1.8,
        background: `radial-gradient(circle at bottom right, rgba(255,255,255,${(rightGlow * bottomGlow * 0.5 + 0.08).toFixed(3)}), rgba(180,255,210,${(rightGlow * bottomGlow * 0.2 + 0.03).toFixed(3)}) 40%, transparent 70%)`,
        filter: "blur(4px)",
      }} />
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════
// SEARCH — Universal site-wide search
// ═══════════════════════════════════════════════════════════════

function SearchSectionLegacy({ setActiveTab }) {
  const [query, setQuery] = useState("");
  const inputRef = useRef(null);

  useEffect(() => { if (inputRef.current) inputRef.current.focus(); }, []);

  // Build unified search index at component mount
  const searchIndex = useMemo(() => {
    const idx = [];
    // Tabs themselves
    const TABS = [
      { id: "dashboard", label: "Dashboard", icon: "◈", keywords: "home overview energy path lessons learn start" },
      { id: "energy", label: "Energy 101", icon: "⚛", keywords: "energy frequency vibration electromagnetic scalar biofield quantum" },
      { id: "numbers", label: "Power of Numbers", icon: "⓷", keywords: "tesla 369 numerology sacred geometry vortex math fibonacci" },
      { id: "emotions", label: "E-Motions", icon: "◭", keywords: "emotions feelings trauma heart coherence vibration love fear" },
      { id: "wakeup", label: "Wake Up", icon: "◉", keywords: "truth conspiracy documented epstein fluoride chemtrails mkultra gateway pizzagate reptilian" },
      { id: "biofield", label: "Bio Field", icon: "◐", keywords: "aura chakras meridians electromagnetic dna antenna biofield" },
      { id: "healthsimple", label: "Health Simplified", icon: "❂", keywords: "health fruit vegetables parasites food pyramid dis-ease liquid eat fruit first" },
      { id: "healing", label: "Healing", icon: "❋", keywords: "heal herbs supplements frequency healing breathwork cold exposure" },
      { id: "disease", label: "Heal Disease", icon: "✚", keywords: "disease parasites cure protocol diabetes cancer arthritis lupus" },
      { id: "hacks", label: "Reality Hacks", icon: "⚙", keywords: "grounding earthing cold exposure sun gazing structured water emf circadian" },
      { id: "shop", label: "Vibe Shop", icon: "◇", keywords: "products supplements devices books tools recommendations" },
      { id: "knowledge", label: "Knowledge Portal", icon: "⬡", keywords: "ebooks kybalion hermetic emerald tablets law of one tesla scalar copper tensor rings gateway cia solfeggio fasting holographic" },
      { id: "practice", label: "Meditation Zone", icon: "◎", keywords: "meditation breathwork 478 practices presence stillness chakra" },
      { id: "community", label: "Community", icon: "⊛", keywords: "community posts signal drops users field network" },
      { id: "events", label: "Events", icon: "⊕", keywords: "events meditation collective full moon breathwork convergence" },
    ];
    TABS.forEach(t => idx.push({
      type: "Page", tabId: t.id, title: t.label, snippet: t.keywords.substring(0, 80) + "...", icon: t.icon, color: "#00ff8c"
    }));

    // Wake Up topics + articles
    try {
      WAKEUP_TOPICS.forEach(topic => {
        idx.push({ type: "Topic", tabId: "wakeup", title: topic.title, snippet: topic.summary, icon: topic.icon, color: topic.color });
        if (topic.articles) topic.articles.forEach(a => idx.push({
          type: "Article", tabId: "wakeup", title: a.title, snippet: a.desc, icon: topic.icon, color: topic.color
        }));
      });
    } catch (e) {}

    // Knowledge categories + entries
    try {
      KNOWLEDGE_CATEGORIES.forEach(cat => {
        idx.push({ type: "Knowledge", tabId: "knowledge", title: cat.title, snippet: cat.desc, icon: cat.icon, color: cat.color });
        if (cat.items) cat.items.forEach(item => idx.push({
          type: "Entry", tabId: "knowledge", title: item.title || item.name || "", snippet: item.desc || item.description || "", icon: cat.icon, color: cat.color
        }));
      });
    } catch (e) {}

    // Diseases
    try {
      DISEASES.forEach(d => idx.push({
        type: "Disease", tabId: "disease", title: d.name, snippet: d.desc, icon: d.icon, color: d.color
      }));
    } catch (e) {}

    // Body organs
    try {
      BODY_ORGANS.forEach(o => idx.push({
        type: "Organ", tabId: "disease", title: o.name,
        snippet: `Symptoms: ${(o.symptoms || []).join(", ")}`,
        icon: o.emoji, color: o.color
      }));
    } catch (e) {}

    // Reality hacks
    try {
      HACK_CATEGORIES.forEach(cat => {
        idx.push({ type: "Hack", tabId: "hacks", title: cat.title || cat.name, snippet: cat.desc || cat.description || "", icon: cat.icon, color: cat.color });
        if (cat.items) cat.items.forEach(h => idx.push({
          type: "Technique", tabId: "hacks", title: h.title || h.name, snippet: h.desc || h.description || "", icon: cat.icon, color: cat.color
        }));
      });
    } catch (e) {}

    // Shop products
    try {
      SHOP_PRODUCTS.forEach(p => idx.push({
        type: "Product", tabId: "shop", title: p.name, snippet: p.desc || p.description || "", icon: "◇", color: "#eab308"
      }));
    } catch (e) {}

    // Practices
    try {
      ZEN_PRACTICES.forEach(p => idx.push({
        type: "Practice", tabId: "practice", title: p.name, snippet: p.desc, icon: p.icon, color: p.color
      }));
    } catch (e) {}

    // Emotions
    try {
      EMOTION_SCALE.forEach(e => idx.push({
        type: "Emotion", tabId: "emotions", title: e.name, snippet: e.desc, icon: e.icon, color: e.color
      }));
    } catch (e) {}

    // Community posts
    try {
      COMMUNITY_POSTS.forEach(p => idx.push({
        type: "Post", tabId: "community",
        title: (p.text || "").substring(0, 60) + "...",
        snippet: (p.text || "").substring(0, 140),
        icon: "⊛", color: "#06b6d4"
      }));
    } catch (e) {}

    return idx;
  }, []);

  // Run search
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || q.length < 2) return [];
    return searchIndex
      .map(r => {
        const hayTitle = (r.title || "").toLowerCase();
        const haySnip = (r.snippet || "").toLowerCase();
        let score = 0;
        if (hayTitle === q) score += 100;
        if (hayTitle.startsWith(q)) score += 50;
        if (hayTitle.includes(q)) score += 25;
        if (haySnip.includes(q)) score += 10;
        // Multi-word partial match
        q.split(/\s+/).forEach(word => {
          if (word.length < 2) return;
          if (hayTitle.includes(word)) score += 8;
          if (haySnip.includes(word)) score += 3;
        });
        return { ...r, score };
      })
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 40);
  }, [query, searchIndex]);

  // Group by type
  const grouped = useMemo(() => {
    const g = {};
    results.forEach(r => {
      if (!g[r.type]) g[r.type] = [];
      g[r.type].push(r);
    });
    return g;
  }, [results]);

  const SUGGESTIONS = [
    "parasites", "fluoride", "tesla", "scalar", "fruit", "gateway",
    "epstein", "healing", "528hz", "dry fasting", "liver", "mkultra"
  ];

  return (
    <div style={{ animation: "fadeInUp 0.5s ease" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
        <div style={{ width: 3, height: 28, background: "linear-gradient(to bottom, #00ff8c, #06b6d4)", borderRadius: 2 }} />
        <h2 style={{ fontSize: 22, fontWeight: 300, color: "var(--text)", fontFamily: "'Sora', sans-serif", margin: 0 }}>SEARCH</h2>
      </div>
      <p style={{ fontSize: 13, color: "var(--text-faint)", marginTop: 8, marginBottom: 24, lineHeight: 1.7 }}>
        Search every page, article, topic, disease, herb, product, practice, and post on TH3 AWAR3N3SS.
      </p>

      {/* Search input */}
      <div style={{ position: "relative", marginBottom: 24 }}>
        <span style={{
          position: "absolute", left: 18, top: "50%", transform: "translateY(-50%)",
          fontSize: 20, color: "#00ff8c", pointerEvents: "none"
        }}>⌕</span>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search for anything..."
          style={{
            width: "100%",
            padding: "16px 50px 16px 52px",
            borderRadius: 12,
            background: "var(--card-bg)",
            border: "1px solid rgba(0,255,140,0.25)",
            color: "var(--text)",
            fontSize: 15,
            fontFamily: "'Sora', sans-serif",
            outline: "none",
            boxShadow: "0 0 20px rgba(0,255,140,0.08)"
          }}
        />
        {query && (
          <button onClick={() => setQuery("")} style={{
            position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)",
            background: "transparent", border: "none", color: "var(--text-faint)",
            cursor: "pointer", fontSize: 18, padding: 4
          }}>✕</button>
        )}
      </div>

      {/* Suggestions when no query */}
      {!query && (
        <div>
          <span style={{ fontSize: 10, letterSpacing: 3, color: "var(--text-faint)", fontFamily: "'Orbitron', sans-serif", display: "block", marginBottom: 12 }}>TRY SEARCHING</span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 32 }}>
            {SUGGESTIONS.map(s => (
              <button key={s} onClick={() => setQuery(s)} style={{
                padding: "7px 14px", borderRadius: 20,
                background: "rgba(0,255,140,0.06)", border: "1px solid rgba(0,255,140,0.2)",
                color: "#00ff8c", cursor: "pointer",
                fontSize: 11, letterSpacing: 1, fontFamily: "'JetBrains Mono', monospace"
              }}>{s}</button>
            ))}
          </div>
          <div style={{ padding: 20, borderRadius: 12, background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
            <span style={{ fontSize: 10, letterSpacing: 3, color: "#00ff8c", fontFamily: "'Orbitron', sans-serif", display: "block", marginBottom: 10 }}>◈ SEARCH COVERS</span>
            <p style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.9, margin: 0 }}>
              All 16 pages • Every Wake Up article and topic • Knowledge Portal entries • Diseases and organ protocols • Healing herbs and modalities • Reality Hacks techniques • Shop products • Meditation practices • Emotions • Community posts
            </p>
          </div>
        </div>
      )}

      {/* Results */}
      {query && query.length >= 2 && (
        <div>
          <span style={{ fontSize: 10, letterSpacing: 3, color: "var(--text-faint)", fontFamily: "'Orbitron', sans-serif", display: "block", marginBottom: 14 }}>
            {results.length === 0 ? "NO RESULTS" : `${results.length} RESULT${results.length === 1 ? "" : "S"}`}
          </span>
          {results.length === 0 ? (
            <div style={{ padding: 30, borderRadius: 12, background: "var(--card-bg)", border: "1px solid var(--card-border)", textAlign: "center" }}>
              <p style={{ fontSize: 14, color: "var(--text-muted)" }}>Nothing matched "<span style={{ color: "var(--text)" }}>{query}</span>". Try different keywords or pick from suggestions above.</p>
            </div>
          ) : (
            Object.entries(grouped).map(([type, items]) => (
              <div key={type} style={{ marginBottom: 24 }}>
                <span style={{ fontSize: 10, letterSpacing: 3, color: "#00ff8c", fontFamily: "'Orbitron', sans-serif", display: "block", marginBottom: 10 }}>{type.toUpperCase()} ({items.length})</span>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {items.map((r, i) => (
                    <div key={i} onClick={() => setActiveTab(r.tabId)} style={{
                      padding: "14px 18px", borderRadius: 10,
                      background: "var(--card-bg)", border: "1px solid var(--card-border)",
                      borderLeft: `3px solid ${r.color}`,
                      cursor: "pointer", transition: "all 0.2s ease",
                      display: "flex", gap: 14, alignItems: "flex-start"
                    }}
                    onMouseEnter={e => e.currentTarget.style.transform = "translateX(4px)"}
                    onMouseLeave={e => e.currentTarget.style.transform = "translateX(0)"}>
                      <span style={{ fontSize: 20, flexShrink: 0 }}>{r.icon}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, color: "var(--text)", fontWeight: 500, marginBottom: 3 }}>{r.title}</div>
                        <div style={{ fontSize: 12, color: "var(--text-faint)", lineHeight: 1.6, overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{r.snippet}</div>
                      </div>
                      <span style={{ fontSize: 10, letterSpacing: 2, color: r.color, fontFamily: "'Orbitron', sans-serif", flexShrink: 0, marginTop: 4 }}>GO →</span>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════
// SEARCH — Full-site search across all tabs and content
// ═══════════════════════════════════════════════════════════════
function SearchSection({ setActiveTab, navItems, isMobile }) {
  const [query, setQuery] = useState("");
  const inputRef = useRef(null);

  useEffect(() => {
    if (inputRef.current) inputRef.current.focus();
  }, []);

  // Build search index once
  const index = useMemo(() => {
    const items = [];

    // 1. Tabs themselves
    (navItems || []).forEach(nav => {
      if (nav.id === "search") return; // don't index self
      items.push({
        kind: "page",
        tab: nav.id,
        title: nav.label,
        icon: nav.icon,
        snippet: `Go to the ${nav.label} page`,
        color: "#00ff8c",
      });
    });

    // 2. Wake Up topics and their articles
    try {
      (typeof WAKEUP_TOPICS !== "undefined" ? WAKEUP_TOPICS : []).forEach(topic => {
        items.push({
          kind: "topic",
          tab: "wakeup",
          title: topic.title,
          icon: topic.icon,
          snippet: topic.summary || "",
          color: topic.color || "#a78bfa",
          source: "Wake Up",
        });
        (topic.articles || []).forEach(article => {
          items.push({
            kind: "article",
            tab: "wakeup",
            title: article.title,
            icon: topic.icon,
            snippet: article.desc || "",
            color: topic.color || "#a78bfa",
            source: `Wake Up → ${topic.title}`,
          });
        });
      });
    } catch(e) {}

    // 3. Diseases
    try {
      (typeof DISEASES !== "undefined" ? DISEASES : []).forEach(d => {
        items.push({
          kind: "disease",
          tab: "disease",
          title: d.name || d.title,
          icon: "✚",
          snippet: d.description || d.desc || d.summary || "",
          color: "#ef4444",
          source: "Heal Disease",
        });
      });
    } catch(e) {}

    // 4. Meditation practices
    try {
      (typeof ZEN_PRACTICES !== "undefined" ? ZEN_PRACTICES : []).forEach(p => {
        items.push({
          kind: "practice",
          tab: "practice",
          title: p.name || p.title,
          icon: "◎",
          snippet: p.description || p.desc || "",
          color: "#00ff8c",
          source: "Meditation Zone",
        });
      });
    } catch(e) {}

    // 5. Shop products
    try {
      (typeof SHOP_PRODUCTS !== "undefined" ? SHOP_PRODUCTS : []).forEach(p => {
        items.push({
          kind: "product",
          tab: "shop",
          title: p.name || p.title,
          icon: "◇",
          snippet: p.description || p.desc || "",
          color: "#eab308",
          source: "Vibe Shop",
        });
      });
    } catch(e) {}

    // 6. Body organs (biofield)
    try {
      (typeof BODY_ORGANS !== "undefined" ? BODY_ORGANS : []).forEach(o => {
        items.push({
          kind: "organ",
          tab: "biofield",
          title: o.name || o.title,
          icon: "◐",
          snippet: o.description || o.desc || o.function || "",
          color: "#06b6d4",
          source: "Bio Field",
        });
      });
    } catch(e) {}

    // 7. Hack categories
    try {
      (typeof HACK_CATEGORIES !== "undefined" ? HACK_CATEGORIES : []).forEach(h => {
        items.push({
          kind: "hack",
          tab: "hacks",
          title: h.name || h.title,
          icon: "⚙",
          snippet: h.description || h.desc || "",
          color: "#a78bfa",
          source: "Reality Hacks",
        });
      });
    } catch(e) {}

    // 8. Solfeggio frequencies
    try {
      (typeof SOLFEGGIO !== "undefined" ? SOLFEGGIO : []).forEach(s => {
        items.push({
          kind: "frequency",
          tab: "knowledge",
          title: s.hz ? `${s.hz} Hz` : (s.name || s.title),
          icon: "〰",
          snippet: s.purpose || s.description || s.desc || "",
          color: "#eab308",
          source: "Solfeggio Frequencies",
        });
      });
    } catch(e) {}

    // 9. Knowledge categories
    try {
      (typeof KNOWLEDGE_CATEGORIES !== "undefined" ? KNOWLEDGE_CATEGORIES : []).forEach(k => {
        items.push({
          kind: "knowledge",
          tab: "knowledge",
          title: k.title || k.name,
          icon: k.icon || "⬡",
          snippet: k.description || k.desc || "",
          color: k.color || "#06b6d4",
          source: "Knowledge Portal",
        });
        (k.entries || []).forEach(e => {
          items.push({
            kind: "entry",
            tab: "knowledge",
            title: e.title,
            icon: k.icon || "⬡",
            snippet: e.desc || e.description || "",
            color: k.color || "#06b6d4",
            source: `Knowledge Portal → ${k.title || k.name}`,
          });
        });
      });
    } catch(e) {}

    return items;
  }, [navItems]);

  // Filter + rank
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const qWords = q.split(/\s+/).filter(Boolean);
    return index
      .map(item => {
        const hay = `${item.title || ""} ${item.snippet || ""} ${item.source || ""}`.toLowerCase();
        // Score: full phrase match > all words match > some words match
        let score = 0;
        if (hay.includes(q)) score += 100;
        const titleHay = (item.title || "").toLowerCase();
        if (titleHay.includes(q)) score += 50;
        qWords.forEach(w => {
          if (titleHay.includes(w)) score += 10;
          else if (hay.includes(w)) score += 3;
        });
        return { ...item, _score: score };
      })
      .filter(i => i._score > 0)
      .sort((a, b) => b._score - a._score)
      .slice(0, 30);
  }, [query, index]);

  const placeholderText = "Search anything... diseases, frequencies, protocols, topics";

  return (
    <div style={{ animation: "fadeInUp 0.5s ease" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
        <div style={{ width: 3, height: 28, background: "linear-gradient(to bottom, #00ff8c, #a78bfa)", borderRadius: 2 }} />
        <h2 style={{ fontSize: 22, fontWeight: 300, color: "var(--text)", fontFamily: "'Sora', sans-serif", margin: 0 }}>SEARCH</h2>
      </div>
      <p style={{ fontSize: 14, color: "var(--text-faint)", marginBottom: 24, marginTop: 8, lineHeight: 1.8 }}>
        Search across every page, every article, every topic — find exactly what you need in seconds.
      </p>

      {/* Search input */}
      <div style={{ position: "relative", marginBottom: 28 }}>
        <span style={{
          position: "absolute", left: 18, top: "50%", transform: "translateY(-50%)",
          fontSize: 20, color: "#00ff8c", pointerEvents: "none"
        }}>⌕</span>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholderText}
          style={{
            width: "100%",
            padding: "16px 50px 16px 52px",
            fontSize: isMobile ? 14 : 16,
            fontFamily: "'Sora', sans-serif",
            background: "var(--card-bg)",
            border: "1px solid var(--card-border)",
            borderRadius: 12,
            color: "var(--text)",
            outline: "none",
            boxShadow: query ? "0 0 20px rgba(0,255,140,0.1)" : "none",
            transition: "box-shadow 0.3s ease",
          }}
        />
        {query && (
          <button onClick={() => setQuery("")} style={{
            position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)",
            background: "transparent", border: "none", cursor: "pointer",
            color: "var(--text-faint)", fontSize: 16, padding: 8
          }}>✕</button>
        )}
      </div>

      {/* Results */}
      {!query && (
        <div style={{ padding: "40px 20px", textAlign: "center", color: "var(--text-faint)" }}>
          <div style={{ fontSize: 36, marginBottom: 12, opacity: 0.3 }}>⌕</div>
          <p style={{ fontSize: 13, letterSpacing: 2, fontFamily: "'Orbitron', sans-serif" }}>START TYPING TO SEARCH</p>
          <p style={{ fontSize: 11, marginTop: 10, lineHeight: 1.8, maxWidth: 420, margin: "10px auto 0" }}>
            Try: "parasites", "528 hz", "tesla", "fasting", "meditation", "fluoride", "epstein"
          </p>
        </div>
      )}

      {query && results.length === 0 && (
        <div style={{ padding: "40px 20px", textAlign: "center", color: "var(--text-faint)" }}>
          <div style={{ fontSize: 36, marginBottom: 12, opacity: 0.3 }}>∅</div>
          <p style={{ fontSize: 13, letterSpacing: 2, fontFamily: "'Orbitron', sans-serif" }}>NO RESULTS FOR "{query}"</p>
          <p style={{ fontSize: 11, marginTop: 10 }}>Try different keywords or shorter terms.</p>
        </div>
      )}

      {results.length > 0 && (
        <>
          <div style={{ fontSize: 10, letterSpacing: 3, color: "var(--text-faint)", fontFamily: "'Orbitron', sans-serif", marginBottom: 14 }}>
            {results.length} RESULT{results.length === 1 ? "" : "S"}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {results.map((r, i) => (
              <button key={i} onClick={() => { setActiveTab(r.tab); }} style={{
                textAlign: "left",
                display: "flex", gap: 14, alignItems: "flex-start",
                padding: "14px 16px",
                background: "var(--card-bg)",
                border: "1px solid var(--card-border)",
                borderLeft: `3px solid ${r.color}`,
                borderRadius: 10,
                cursor: "pointer",
                transition: "all 0.2s ease",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = `${r.color}10`; e.currentTarget.style.transform = "translateX(3px)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "var(--card-bg)"; e.currentTarget.style.transform = "translateX(0)"; }}
              >
                <div style={{
                  width: 36, height: 36, borderRadius: 8, flexShrink: 0,
                  background: `${r.color}15`, border: `1px solid ${r.color}30`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 16,
                }}>{r.icon}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 3, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", fontFamily: "'Sora', sans-serif" }}>{r.title}</span>
                    {r.source && <span style={{ fontSize: 9, letterSpacing: 2, color: r.color, fontFamily: "'Orbitron', sans-serif" }}>{r.source}</span>}
                  </div>
                  {r.snippet && (
                    <p style={{ fontSize: 12, color: "var(--text-faint)", margin: 0, lineHeight: 1.6, overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                      {r.snippet}
                    </p>
                  )}
                </div>
                <span style={{ fontSize: 12, color: r.color, flexShrink: 0, alignSelf: "center" }}>→</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════
// SOCIAL LAYOUT — Explore grid + More menu (bottom-tab navigation)
// ═══════════════════════════════════════════════════════════════

const EXPLORE_GROUPS = [
  {
    group: "LEARN THE FOUNDATION",
    blurb: "Start here. Everything else builds on these.",
    items: [
      { id: "energy", icon: "⚛", label: "Energy 101", desc: "What energy actually is", color: "#00ff8c" },
      { id: "healthsimple", icon: "❂", label: "Health Simplified", desc: "3-min cinematic experience", color: "#06b6d4" },
      { id: "numbers", icon: "⓷", label: "Power of Numbers", desc: "369, vortex math, geometry", color: "#eab308" },
      { id: "emotions", icon: "◭", label: "E-Motions", desc: "Energy in motion", color: "#ec4899" },
    ],
  },
  {
    group: "THE BODY",
    blurb: "Your biology, your field, your healing.",
    items: [
      { id: "biofield", icon: "◐", label: "Bio Field", desc: "Aura, chakras, meridians", color: "#a78bfa" },
      { id: "healing", icon: "❋", label: "Healing", desc: "Herbs, protocols, modalities", color: "#22c55e" },
      { id: "disease", icon: "✚", label: "Heal Disease", desc: "Condition-specific paths", color: "#ef4444" },
      { id: "hacks", icon: "⚙", label: "Reality Hacks", desc: "Daily optimization", color: "#f97316" },
      { id: "tones", icon: "〰", label: "Tone Sanctuary", desc: "Frequencies, Rife, binaural", color: "#f2a53e" },
    ],
  },
  {
    group: "GO DEEPER",
    blurb: "Documented, sourced, uncomfortable.",
    items: [
      { id: "wakeup", icon: "◉", label: "Wake Up", desc: "Documented realities", color: "#ef4444" },
      { id: "knowledge", icon: "⬡", label: "Knowledge Portal", desc: "56+ entries, 8 domains", color: "#06b6d4" },
    ],
  },
];

function ExploreGrid({ setActiveTab, isMobile }) {
  const [q, setQ] = useState("");
  const ql = q.trim().toLowerCase();

  const filtered = EXPLORE_GROUPS.map(g => ({
    ...g,
    items: ql
      ? g.items.filter(i => (i.label + " " + i.desc).toLowerCase().includes(ql))
      : g.items,
  })).filter(g => g.items.length > 0);

  return (
    <div style={{ animation: "fadeInUp 0.4s ease" }}>
      {/* Search bar */}
      <div style={{ position: "relative", marginBottom: 28 }}>
        <span style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", fontSize: 18, color: "#00ff8c", pointerEvents: "none" }}>⌕</span>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search sections..."
          style={{
            width: "100%", padding: "14px 16px 14px 46px",
            fontSize: isMobile ? 14 : 15, fontFamily: "'Sora', sans-serif",
            background: "var(--card-bg)", border: "1px solid var(--card-border)",
            borderRadius: 12, color: "var(--text)", outline: "none",
          }}
        />
        <button onClick={() => setActiveTab("search")} style={{
          position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)",
          padding: "6px 12px", borderRadius: 8, cursor: "pointer",
          background: "rgba(0,255,140,0.1)", border: "1px solid rgba(0,255,140,0.3)",
          color: "#00ff8c", fontSize: 9, letterSpacing: 1.5, fontFamily: "'Orbitron', sans-serif",
        }}>FULL SEARCH</button>
      </div>

      {filtered.length === 0 && (
        <div style={{ padding: "50px 20px", textAlign: "center", color: "var(--text-faint)" }}>
          <div style={{ fontSize: 32, opacity: 0.3, marginBottom: 10 }}>∅</div>
          <p style={{ fontSize: 12, letterSpacing: 2, fontFamily: "'Orbitron', sans-serif" }}>NOTHING MATCHES "{q}"</p>
        </div>
      )}

      {filtered.map(group => (
        <div key={group.group} style={{ marginBottom: 34 }}>
          <div style={{ fontSize: 10, letterSpacing: 3, color: "#00ff8c", fontFamily: "'Orbitron', sans-serif", marginBottom: 4 }}>{group.group}</div>
          <p style={{ fontSize: 12, color: "var(--text-faint)", marginBottom: 14 }}>{group.blurb}</p>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
            {group.items.map(item => (
              <button key={item.id} onClick={() => setActiveTab(item.id)} style={{
                textAlign: "left", padding: isMobile ? "16px 14px" : "18px 18px",
                borderRadius: 14, cursor: "pointer",
                background: `linear-gradient(140deg, ${item.color}12, var(--card-bg) 70%)`,
                border: `1px solid ${item.color}25`,
                transition: "all 0.25s cubic-bezier(0.22,1,0.36,1)",
                display: "flex", flexDirection: "column", gap: 8,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-3px)"; e.currentTarget.style.borderColor = `${item.color}60`; e.currentTarget.style.boxShadow = `0 8px 24px ${item.color}20`; }}
              onMouseLeave={(e) => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.borderColor = `${item.color}25`; e.currentTarget.style.boxShadow = "none"; }}>
                <span style={{ fontSize: isMobile ? 22 : 26, color: item.color }}>{item.icon}</span>
                <span style={{ fontSize: isMobile ? 12 : 14, fontWeight: 600, color: "var(--text)", fontFamily: "'Sora', sans-serif", lineHeight: 1.3 }}>{item.label}</span>
                <span style={{ fontSize: isMobile ? 10 : 11, color: "var(--text-faint)", lineHeight: 1.4 }}>{item.desc}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// HOME — simple learning path (Duolingo-style winding path of units,
// Brilliant-style one-idea-per-screen animated lessons with a quick check,
// Khan Kids-style big friendly buttons + mascot). Every lesson ends with
// a "Go Deeper" door into the full section, so the deep material is one
// tap away (progressive disclosure: simple first, deep on request).
// ═══════════════════════════════════════════════════════════════

const KID_FONT = "'Geist', 'Inter', system-ui, sans-serif";

const LEARN_PATH = [
  {
    id: "u-energy", deep: "energy", icon: "⚡", color: "#22c55e", title: "What Is Energy?",
    cards: [
      { kind: "orbit", emoji: "⚛️", text: "Everything is made of tiny pieces called atoms. Even you!" },
      { kind: "wave", emoji: "〰️", text: "Atoms never sit still. They wiggle all the time. That wiggle is called vibration." },
      { kind: "spin", emoji: "☀️", text: "Energy is the power to move and change things. The sun sends energy to Earth as light and heat." },
    ],
    quiz: { q: "What are you made of?", options: ["Atoms", "Nothing", "Only water"], answer: 0, why: "Atoms build everything — rocks, trees, water, and you." },
  },
  {
    id: "u-vibrate", deep: "energy", icon: "🎵", color: "#ec4899", title: "Everything Vibrates",
    cards: [
      { kind: "wave", emoji: "🎵", text: "A vibration is a back-and-forth wiggle. How fast it wiggles is called frequency." },
      { kind: "rings", emoji: "🔊", text: "Sound is vibration moving through air. Fast wiggles sound high. Slow wiggles sound low." },
      { kind: "wave", emoji: "🌈", text: "Light is vibration too! Every color is a different speed of wiggle." },
    ],
    quiz: { q: "Fast wiggles make a sound that is…", options: ["High", "Low", "Silent"], answer: 0, why: "Higher frequency = higher pitch. A bird chirp wiggles faster than a drum." },
  },
  {
    id: "u-field", deep: "biofield", icon: "💫", color: "#a78bfa", title: "Your Body's Field",
    cards: [
      { kind: "rings", emoji: "❤️", text: "Your heart makes electricity every time it beats. Doctors measure it with an ECG." },
      { kind: "rings", emoji: "🧲", text: "Moving electricity makes a magnetic field. Your heart's field spreads out around your body." },
      { kind: "pulse", emoji: "🧘", text: "Many traditions call this your aura or biofield, and teach ways to care for it: breath, calm, and nature." },
    ],
    quiz: { q: "What machine measures your heart's electricity?", options: ["ECG", "Microwave", "Telescope"], answer: 0, why: "An ECG (electrocardiogram) reads the electrical signal your heart makes." },
  },
  {
    id: "u-emotions", deep: "emotions", icon: "😊", color: "#f97316", title: "Emotions Are Energy",
    cards: [
      { kind: "bob", emoji: "😊", text: "E-motion means energy in motion. Feelings move through your body." },
      { kind: "pulse", emoji: "🔥", text: "Anger can feel hot and tight. Joy can feel light and open. Your body changes with each feeling." },
      { kind: "breathe", emoji: "🌬️", text: "Slow, deep breaths calm your body. How you breathe changes how you feel." },
    ],
    quiz: { q: "What can help calm a big feeling?", options: ["Slow deep breaths", "Yelling louder", "Holding your breath forever"], answer: 0, why: "Slow breathing tells your nervous system it's safe to relax." },
  },
  {
    id: "u-still", deep: "practice", icon: "🧘", color: "#8b5cf6", title: "Be Still",
    cards: [
      { kind: "pulse", emoji: "🧘", text: "Meditation means sitting still and noticing your breath." },
      { kind: "breathe", emoji: "🫁", text: "Breathe in for 4… hold for 4… out for 4… hold for 4. That's box breathing. Try it with the circle!" },
      { kind: "bob", emoji: "🕊️", text: "A few calm minutes a day can change how your whole day feels." },
    ],
    quiz: { q: "In box breathing, you count to…", options: ["4", "100", "1"], answer: 0, why: "Four in, four hold, four out, four hold — four equal sides, like a box." },
  },
  {
    id: "u-numbers", deep: "numbers", icon: "🌀", color: "#eab308", title: "Numbers & Patterns",
    cards: [
      { kind: "spin", emoji: "🌻", text: "Nature loves patterns. Sunflower seeds grow in spirals." },
      { kind: "spin", emoji: "🐚", text: "Shells, storms, and galaxies spiral too. Many follow the Fibonacci numbers: 1, 1, 2, 3, 5, 8…" },
      { kind: "grid", emoji: "3️⃣", text: "Nikola Tesla said 3, 6, and 9 were special numbers. Go deeper to explore why." },
    ],
    quiz: { q: "What comes next? 1, 1, 2, 3, 5, …", options: ["8", "6", "7"], answer: 0, why: "Add the last two: 3 + 5 = 8. That's the Fibonacci pattern." },
  },
  {
    id: "u-body", deep: "healthsimple", icon: "💧", color: "#06b6d4", title: "Healthy Body Basics",
    cards: [
      { kind: "bob", emoji: "💧", text: "Your body is mostly water. Clean water keeps everything flowing." },
      { kind: "spin", emoji: "☀️", text: "Sunlight helps your body make vitamin D and sets your sleep clock." },
      { kind: "bob", emoji: "😴", text: "Sleep is when your body cleans up and repairs itself." },
    ],
    quiz: { q: "When does your body do its big repair work?", options: ["While you sleep", "Only while eating", "Never"], answer: 0, why: "Deep sleep is prime time for cleanup and repair." },
  },
  {
    id: "u-healing", deep: "healing", icon: "🌿", color: "#16a34a", title: "Healing with Nature",
    cards: [
      { kind: "bob", emoji: "🌿", text: "People have used plants as medicine for thousands of years." },
      { kind: "pulse", emoji: "🍄", text: "Herbs, mushrooms, and roots each have their own gifts." },
      { kind: "bob", emoji: "📖", text: "Go deeper to explore herbs by body part and what each one is used for." },
    ],
    quiz: { q: "How long have people used plants for healing?", options: ["Thousands of years", "Since last year", "Never"], answer: 0, why: "Plant medicine is one of the oldest traditions on Earth." },
  },
  {
    id: "u-habits", deep: "hacks", icon: "🌅", color: "#fb923c", title: "Daily Energy Habits",
    cards: [
      { kind: "pulse", emoji: "🦶", text: "Walking barefoot on the earth is called grounding." },
      { kind: "spin", emoji: "🌅", text: "Morning light, fresh air, and moving your body wake you up." },
      { kind: "bob", emoji: "📵", text: "Less screen time before bed helps you sleep deeper." },
    ],
    quiz: { q: "Walking barefoot on the earth is called…", options: ["Grounding", "Floating", "Freezing"], answer: 0, why: "Grounding (or earthing) = skin touching the earth." },
  },
  {
    id: "u-wakeup", deep: "wakeup", icon: "🔍", color: "#ef4444", title: "Wake Up: Ask Questions",
    cards: [
      { kind: "eye", emoji: "🔍", text: "Being awake means asking questions and looking for yourself." },
      { kind: "bob", emoji: "📜", text: "Original documents, court records, and history books are strong sources." },
      { kind: "pulse", emoji: "🧠", text: "Compare many sources, then decide what you believe." },
    ],
    quiz: { q: "Which is the strongest source?", options: ["An original document", "A random rumor", "Just a headline"], answer: 0, why: "Go to the source. Headlines and rumors are someone else's summary." },
  },
  {
    id: "u-library", deep: "knowledge", icon: "📚", color: "#0ea5e9", title: "The Big Library",
    cards: [
      { kind: "bob", emoji: "📚", text: "The Knowledge Portal holds all the deep lessons in one place." },
      { kind: "rings", emoji: "🕸️", text: "Topics connect to each other like a web. Follow what sparks your curiosity." },
      { kind: "spin", emoji: "✨", text: "You finished the path! Keep going deeper any time." },
    ],
    quiz: { q: "What should you follow in the library?", options: ["Your curiosity", "Nothing", "Only one topic"], answer: 0, why: "Curiosity is the best teacher." },
  },
];

const KID_KEYFRAMES = `
  @keyframes kidBob { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }
  @keyframes kidSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
  @keyframes kidPulse { 0%,100% { transform: scale(1); opacity: 0.9; } 50% { transform: scale(1.08); opacity: 1; } }
  @keyframes kidRing { 0% { transform: scale(0.5); opacity: 0.9; } 100% { transform: scale(2.1); opacity: 0; } }
  @keyframes kidWave { from { transform: translateX(0); } to { transform: translateX(-160px); } }
  @keyframes kidWaveY { from { transform: translateY(0); } to { transform: translateY(-80px); } }
  @keyframes kidBreathe { 0% { transform: scale(0.72); } 25% { transform: scale(1.12); } 50% { transform: scale(1.12); } 75% { transform: scale(0.72); } 100% { transform: scale(0.72); } }
  @keyframes kidTwinkle { 0%,100% { opacity: 0.15; } 50% { opacity: 1; } }
  @keyframes kidScan { 0%,100% { transform: translateX(-20px); } 50% { transform: translateX(20px); } }
  @keyframes kidScanY { 0% { transform: translateY(-60px); opacity: 0; } 20%,80% { opacity: 0.8; } 100% { transform: translateY(60px); opacity: 0; } }
  @keyframes kidDraw { from { stroke-dashoffset: 260; } to { stroke-dashoffset: 0; } }
  @keyframes kidPop { 0% { transform: scale(0.6); opacity: 0; } 70% { transform: scale(1.04); opacity: 1; } 100% { transform: scale(1); } }
  @keyframes kidGlow { 0%,100% { box-shadow: 0 0 0 0 var(--kid-glow), 0 14px 34px -10px var(--kid-glow); } 50% { box-shadow: 0 0 0 10px transparent, 0 14px 34px -10px var(--kid-glow); } }
  @keyframes kidSlideIn { from { opacity: 0; transform: translateY(14px); filter: blur(4px); } to { opacity: 1; transform: translateY(0); filter: blur(0); } }
  @keyframes kidAurora { 0% { transform: translate(0,0) scale(1); } 50% { transform: translate(6%, -4%) scale(1.15); } 100% { transform: translate(0,0) scale(1); } }
  @keyframes kidWord { from { opacity: 0; transform: translateY(10px); filter: blur(6px); } to { opacity: 1; transform: translateY(0); filter: blur(0); } }
  @keyframes kidSheen { from { transform: translateX(-120%) skewX(-20deg); } to { transform: translateX(220%) skewX(-20deg); } }
  .kid-glass { background: var(--glass-bg); backdrop-filter: blur(22px) saturate(1.6); -webkit-backdrop-filter: blur(22px) saturate(1.6); border: 1px solid var(--glass-border); box-shadow: inset 0 1px 0 var(--glass-hi), 0 10px 30px -18px rgba(0,0,0,0.45); }
  .kid-num { font-variant-numeric: tabular-nums; font-feature-settings: "tnum"; }
  .kid-serif { font-family: 'Instrument Serif', Georgia, serif; font-style: italic; font-weight: 400; letter-spacing: -0.01em; }
  .kid-label { font-size: 11px; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase; color: var(--text-muted); }
  .kid-card-hover { transition: transform 0.35s cubic-bezier(0.22,1,0.36,1), border-color 0.35s ease, box-shadow 0.35s ease; }
  .kid-card-hover:hover { transform: translateY(-3px); }
  @media (prefers-reduced-motion: reduce) { .kid-motion, .kid-motion * { animation: none !important; } }
`;

// Friendly mascot — a glowing spark with blinking eyes
function SparkMascot({ size = 64, color = "#22c55e" }) {
  // Abstract "signal orb": layered gradients + slow-turning conic sheen (no cartoon face)
  return (
    <div className="kid-motion" style={{ width: size, height: size, flexShrink: 0, position: "relative", animation: "kidBob 5s ease-in-out infinite" }}>
      <div style={{ position: "absolute", inset: -size * 0.25, borderRadius: "50%", background: `radial-gradient(circle, ${color}55, transparent 65%)`, filter: "blur(8px)" }} />
      <div style={{
        position: "absolute", inset: 0, borderRadius: "50%", overflow: "hidden",
        background: `radial-gradient(circle at 30% 25%, #ffffff, ${color} 45%, #4c1d95 110%)`,
        boxShadow: `inset -6px -8px 18px rgba(0,0,0,0.35), inset 4px 6px 12px rgba(255,255,255,0.5)`,
      }}>
        <div style={{ position: "absolute", inset: "-30%", background: `conic-gradient(from 0deg, transparent, ${color}aa, transparent 40%, #a78bfaaa, transparent 75%)`, animation: "kidSpin 7s linear infinite", mixBlendMode: "screen" }} />
        <div style={{ position: "absolute", top: "12%", left: "20%", width: "34%", height: "20%", borderRadius: "50%", background: "rgba(255,255,255,0.75)", filter: "blur(3px)" }} />
      </div>
    </div>
  );
}

// One big animated picture per lesson card
function LessonVisual({ kind, color, size = 270 }) {
  const gid = useMemo(() => "lv" + Math.random().toString(36).slice(2, 8), []);
  const cx = 120, cy = 100;
  const S = `url(#${gid}-s)`, O = `url(#${gid}-o)`, G = `url(#${gid}-g)`, M = `url(#${gid}-m)`;
  const origin = { transformOrigin: `${cx}px ${cy}px` };
  const spin = (dur, rev) => ({ ...origin, animation: `kidSpin ${dur}s linear infinite${rev ? " reverse" : ""}` });
  const orb = (r = 16) => (
    <>
      <circle cx={cx} cy={cy} r={r * 2.4} fill={O} opacity="0.35" filter={G} />
      <circle cx={cx} cy={cy} r={r} fill={O} style={{ ...origin, animation: "kidPulse 3s ease-in-out infinite" }} />
    </>
  );
  let body;
  switch (kind) {
    case "orbit":
      body = (<>
        {orb(14)}
        {[0, 60, 120].map((a, i) => {
          const path = `M${cx - 84},${cy} a84,28 0 1,0 168,0 a84,28 0 1,0 -168,0`;
          return (
            <g key={a} transform={`rotate(${a} ${cx} ${cy})`}>
              <path d={path} fill="none" stroke={S} strokeWidth="1.2" opacity="0.55" />
              <circle r="4.5" fill={color} filter={G}><animateMotion dur={`${3 + i}s`} repeatCount="indefinite" path={path} /></circle>
              <circle r="3" fill="#fff"><animateMotion dur={`${3 + i}s`} repeatCount="indefinite" path={path} /></circle>
            </g>
          );
        })}
      </>);
      break;
    case "wave": {
      const wave = (amp) => `M-160 ${cy} Q-140 ${cy - amp} -120 ${cy} ` + Array.from({ length: 14 }, (_, i) => `T${-80 + i * 40} ${cy}`).join(" ");
      body = (
        <g mask={M}>
          {[[34, 2.4, 1, 3.2], [22, 1.6, 0.6, 2.2], [48, 1.2, 0.35, 4.4]].map(([amp, w, op, dur], i) => (
            <path key={i} d={wave(amp)} fill="none" stroke={S} strokeWidth={w} opacity={op} strokeLinecap="round" style={{ animation: `kidWave ${dur}s linear infinite` }} />
          ))}
          <line x1="0" x2="240" y1={cy} y2={cy} stroke={color} strokeOpacity="0.15" />
        </g>
      );
      break;
    }
    case "rings":
      body = (<>
        {[0, 1, 2, 3].map(i => (
          <circle key={i} cx={cx} cy={cy} r="38" fill="none" stroke={S} strokeWidth="1.5" style={{ ...origin, animation: `kidRing 3.2s cubic-bezier(0.22,1,0.36,1) ${i * 0.8}s infinite` }} />
        ))}
        {orb(18)}
      </>);
      break;
    case "breathe":
      body = (<>
        <circle cx={cx} cy={cy} r="86" fill="none" stroke={S} strokeWidth="1" strokeDasharray="2 7" opacity="0.6" style={spin(40)} />
        <circle cx={cx} cy={cy} r="62" fill={O} opacity="0.35" style={{ ...origin, animation: "kidBreathe 16s ease-in-out infinite" }} />
        <circle cx={cx} cy={cy} r="62" fill="none" stroke={S} strokeWidth="1.5" style={{ ...origin, animation: "kidBreathe 16s ease-in-out infinite" }} />
        <circle cx={cx} cy={cy} r="10" fill="#fff" opacity="0.9" />
      </>);
      break;
    case "spin": // flower of life
      body = (<>
        <g style={spin(40)}>
          <circle cx={cx} cy={cy} r="64" fill="none" stroke={S} strokeWidth="1" opacity="0.5" />
          {[0, 60, 120, 180, 240, 300].map(a => {
            const r = (a * Math.PI) / 180;
            return <circle key={a} cx={cx + 32 * Math.cos(r)} cy={cy + 32 * Math.sin(r)} r="32" fill="none" stroke={S} strokeWidth="1.3" opacity="0.85" />;
          })}
          <circle cx={cx} cy={cy} r="32" fill="none" stroke={S} strokeWidth="1.3" />
        </g>
        {orb(8)}
      </>);
      break;
    case "torus": {
      const loop = `M${cx - 64},${cy} a64,20 0 1,0 128,0 a64,20 0 1,0 -128,0`;
      body = (<>
        <line x1={cx} x2={cx} y1="18" y2="182" stroke={color} strokeOpacity="0.25" strokeDasharray="3 5" />
        {Array.from({ length: 18 }, (_, i) => (
          <circle key={i} r="26" fill="none" stroke={S} strokeWidth="1" opacity="0.55">
            <animateMotion dur="14s" begin={`-${(i * 14) / 18}s`} repeatCount="indefinite" path={loop} />
          </circle>
        ))}
        {orb(10)}
      </>);
      break;
    }
    case "globe":
      body = (<>
        <circle cx={cx} cy={cy} r="74" fill={O} opacity="0.12" />
        <circle cx={cx} cy={cy} r="74" fill="none" stroke={S} strokeWidth="1.6" />
        {[-48, -24, 0, 24, 48].map(dy => (
          <ellipse key={dy} cx={cx} cy={cy + dy} rx={Math.sqrt(74 * 74 - dy * dy)} ry="7" fill="none" stroke={S} strokeWidth="0.9" opacity="0.5" />
        ))}
        {[0, 1, 2, 3].map(i => (
          <ellipse key={i} cx={cx} cy={cy} rx="74" ry="74" fill="none" stroke={S} strokeWidth="1" opacity="0.7">
            <animate attributeName="rx" values="74;0;74" dur="8s" begin={`-${i * 2}s`} repeatCount="indefinite" />
          </ellipse>
        ))}
      </>);
      break;
    case "dome":
      body = (<>
        {Array.from({ length: 14 }, (_, i) => (
          <circle key={i} cx={30 + ((i * 53) % 180)} cy={40 + ((i * 37) % 90)} r={i % 3 ? 1.4 : 2.2} fill="#fff" style={{ animation: `kidTwinkle ${2 + (i % 4)}s ease-in-out ${i * 0.3}s infinite` }} />
        ))}
        <path d={`M24 150 A96 118 0 0 1 216 150`} fill="none" stroke={S} strokeWidth="2" strokeDasharray="260" style={{ animation: "kidDraw 2.4s ease forwards" }} />
        <path d={`M44 150 A76 94 0 0 1 196 150`} fill="none" stroke={S} strokeWidth="1" opacity="0.4" />
        <line x1="12" x2="228" y1="150" y2="150" stroke={S} strokeWidth="1.5" />
        <g mask={M}>
          <path d={`M-160 168 Q-140 162 -120 168 ` + Array.from({ length: 14 }, (_, i) => `T${-80 + i * 40} 168`).join(" ")} fill="none" stroke={color} strokeOpacity="0.5" strokeWidth="1.2" style={{ animation: "kidWave 5s linear infinite" }} />
        </g>
      </>);
      break;
    case "grid": {
      const glyphs = "אבגדהוזחטיכל123456789ΑΒΓΔ";
      body = (
        <g>
          {Array.from({ length: 24 }, (_, i) => {
            const col = i % 6, row = Math.floor(i / 6);
            return (
              <g key={i} style={{ animation: `kidTwinkle ${2.6 + (i % 5) * 0.4}s ease-in-out ${(i * 0.37) % 3}s infinite` }}>
                <rect x={27 + col * 32} y={38 + row * 32} width="26" height="26" rx="7" fill="none" stroke={S} strokeWidth="1" />
                <text x={40 + col * 32} y={56 + row * 32} textAnchor="middle" fontSize="13" fontFamily="'Geist', sans-serif" fill={color}>{glyphs[i]}</text>
              </g>
            );
          })}
        </g>
      );
      break;
    }
    case "eye":
      body = (<>
        <g style={{ ...origin }}>
          <path d={`M24 ${cy} Q${cx} 22 216 ${cy} Q${cx} 178 24 ${cy} Z`} fill={O} fillOpacity="0.08" stroke={S} strokeWidth="1.8" />
          <g style={{ animation: "kidScan 5s ease-in-out infinite" }}>
            <circle cx={cx} cy={cy} r="30" fill="none" stroke={S} strokeWidth="1.5" />
            <circle cx={cx} cy={cy} r="20" fill="none" stroke={S} strokeWidth="0.8" strokeDasharray="2 3" style={spin(12)} />
            <circle cx={cx} cy={cy} r="11" fill={O} />
          </g>
        </g>
        <line x1="30" x2="210" y1={cy} y2={cy} stroke={color} strokeWidth="1" style={{ animation: "kidScanY 3s ease-in-out infinite" }} />
      </>);
      break;
    case "helix": {
      const strand = (phase) => `M ${cx + 32 * Math.sin(phase)} -20 ` + Array.from({ length: 24 }, (_, i) => `L ${cx + 32 * Math.sin(phase + (i + 1) * 0.5)} ${-20 + (i + 1) * 10}`).join(" ");
      body = (
        <g mask={M}>
          <g style={{ animation: "kidWaveY 4s linear infinite" }}>
            <path d={strand(0)} fill="none" stroke={S} strokeWidth="2" />
            <path d={strand(Math.PI)} fill="none" stroke={S} strokeWidth="2" opacity="0.6" />
            {Array.from({ length: 24 }, (_, i) => (
              <line key={i} x1={cx + 32 * Math.sin(i * 0.5)} x2={cx + 32 * Math.sin(Math.PI + i * 0.5)} y1={-20 + i * 10} y2={-20 + i * 10} stroke={color} strokeOpacity="0.3" />
            ))}
          </g>
        </g>
      );
      break;
    }
    case "pulse":
      body = (<>
        <g style={spin(24)}>
          {Array.from({ length: 10 }, (_, i) => {
            const a = (i / 10) * Math.PI * 2;
            return <circle key={i} cx={cx + 78 * Math.cos(a)} cy={cy + 78 * Math.sin(a)} r={i % 2 ? 1.6 : 2.6} fill={color} opacity="0.7" />;
          })}
        </g>
        <circle cx={cx} cy={cy} r="56" fill="none" stroke={S} strokeWidth="1" opacity="0.4" />
        {orb(30)}
      </>);
      break;
    default: // "bob" and anything else: stacked glass tablets
      body = (<>
        <g style={{ animation: "kidBob 5s ease-in-out infinite" }}>
          <rect x="70" y="42" width="112" height="132" rx="16" fill={O} opacity="0.15" stroke={S} strokeWidth="1" transform="rotate(8 126 108)" />
          <rect x="58" y="34" width="112" height="132" rx="16" fill="rgba(255,255,255,0.06)" stroke={S} strokeWidth="1.5" />
          {[0, 1, 2, 3, 4].map(i => <rect key={i} x="76" y={60 + i * 18} width={i === 0 ? 50 : 76 - (i % 2) * 20} height="5" rx="2.5" fill={color} opacity={i === 0 ? 0.9 : 0.35} />)}
          <circle cx="152" cy="146" r="8" fill={O} />
        </g>
      </>);
  }
  return (
    <div className="kid-motion" style={{ width: "100%", display: "flex", justifyContent: "center" }}>
      <svg viewBox="0 0 240 200" width={size} height={size * 0.833} style={{ overflow: "hidden", maxWidth: "80vw" }}>
        <defs>
          <linearGradient id={`${gid}-s`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={color} />
            <stop offset="100%" stopColor="#a78bfa" />
          </linearGradient>
          <radialGradient id={`${gid}-o`} cx="35%" cy="30%" r="70%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
            <stop offset="40%" stopColor={color} stopOpacity="0.9" />
            <stop offset="100%" stopColor={color} stopOpacity="0.08" />
          </radialGradient>
          <filter id={`${gid}-g`} x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="5" /></filter>
          <linearGradient id={`${gid}-f`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#fff" stopOpacity="0" />
            <stop offset="20%" stopColor="#fff" stopOpacity="1" />
            <stop offset="80%" stopColor="#fff" stopOpacity="1" />
            <stop offset="100%" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
          <linearGradient id={`${gid}-fy`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#fff" stopOpacity="0" />
            <stop offset="25%" stopColor="#fff" stopOpacity="1" />
            <stop offset="75%" stopColor="#fff" stopOpacity="1" />
            <stop offset="100%" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
          <mask id={`${gid}-m`} maskUnits="userSpaceOnUse" x="0" y="0" width="240" height="200">
            <rect x="0" y="0" width="240" height="200" fill={`url(#${gid}-${kind === "helix" ? "fy" : "f"})`} />
          </mask>
        </defs>
        {body}
      </svg>
    </div>
  );
}

// Big chunky "3D" button (Duolingo-style bottom edge, drawn with a border so light-mode shadow overrides don't flatten it)
function KidButton({ children, onClick, color = "#22c55e", ghost = false, disabled = false, style = {} }) {
  return (
    <button onClick={disabled ? undefined : onClick} disabled={disabled} style={{
      position: "relative", overflow: "hidden",
      width: "100%", padding: "15px 20px", borderRadius: 999, cursor: disabled ? "default" : "pointer",
      fontFamily: KID_FONT, fontSize: 16, fontWeight: 600, letterSpacing: "-0.01em",
      background: ghost ? "var(--glass-bg)" : `linear-gradient(135deg, ${color}, ${color}c8)`,
      backdropFilter: ghost ? "blur(20px) saturate(1.5)" : "none",
      color: ghost ? "var(--text)" : "white",
      border: ghost ? "1px solid var(--glass-border)" : `1px solid ${color}`,
      boxShadow: ghost ? "inset 0 1px 0 var(--glass-hi)" : `inset 0 1px 0 rgba(255,255,255,0.35), 0 10px 26px -10px ${color}`,
      opacity: disabled ? 0.45 : 1,
      transition: "transform 0.2s cubic-bezier(0.22,1,0.36,1), filter 0.2s ease",
      ...style,
    }}
    onMouseDown={e => { if (!disabled) e.currentTarget.style.transform = "scale(0.98)"; }}
    onMouseUp={e => { e.currentTarget.style.transform = "none"; }}
    onMouseEnter={e => { if (!disabled) e.currentTarget.style.filter = "brightness(1.08)"; }}
    onMouseLeave={e => { e.currentTarget.style.transform = "none"; e.currentTarget.style.filter = "none"; }}>
      {!ghost && !disabled && <span aria-hidden style={{ position: "absolute", top: 0, bottom: 0, width: "30%", background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.28), transparent)", animation: "kidSheen 3.6s ease-in-out infinite" }} />}
      <span style={{ position: "relative" }}>{children}</span>
    </button>
  );
}

// Full-screen lesson: a few one-idea cards → quick check → celebrate → Go Deeper
// ═══════════════════════════════════════════════════════════════
// DEEP LESSONS — layered depth for every lesson on every path.
// go = Layer 2 "Go Deeper", even = Layer 3 "Even Deeper",
// plus key terms, a hands-on practice, and sources to read.
// ═══════════════════════════════════════════════════════════════
const DEEP_LESSONS = {
  // ───────── BRAND NEW ─────────
  "u-energy": {
    go: [
      ["Energy comes in many forms", "Scientists sort energy into kinds: motion (kinetic), stored (potential), heat (thermal), light (radiant), chemical (in food and fuel), electrical, and nuclear. Energy is never created or destroyed; it only changes form. That rule is the first law of thermodynamics."],
      ["Your body is an energy converter", "Food holds chemical energy that plants captured from sunlight. Your cells break it down and store it in a molecule called ATP. Every heartbeat, thought, and step spends ATP, and your body makes and recycles roughly its own weight in ATP every day."],
      ["Atoms are mostly empty space", "An atom has a tiny nucleus with electrons around it. If the nucleus were a marble in the middle of a stadium, the electrons would be buzzing around the outer seats. Things feel solid because electric forces push back, not because atoms are packed with stuff."],
    ],
    even: [
      ["E = mc²", "Einstein showed that mass and energy are two faces of the same thing. A tiny amount of mass holds a huge amount of energy. That's what powers the sun: hydrogen fuses into helium, and the missing mass leaves as light."],
      ["Quantum vibration", "In quantum physics, particles also behave like waves. An electron in an atom sits in patterns called orbitals, which are standing-wave shapes, a bit like the notes a guitar string can hold. Even at absolute zero, particles keep a minimum jiggle called zero-point energy."],
      ["Where the traditions meet", "Ancient traditions named a life energy: prana in India, qi in China, pneuma in Greece. Physics measures energy with instruments; these traditions describe it through feeling and practice. This site explores both and tells you which is which."],
    ],
    terms: [["Kinetic energy", "Energy of motion"], ["Potential energy", "Stored energy, like a stretched bow"], ["ATP", "The energy currency your cells spend"], ["Thermodynamics", "The science of how energy moves and changes"], ["Zero-point energy", "The lowest energy a quantum system can have; it's never quite zero"]],
    practice: { title: "Feel energy change form", steps: ["Rub your palms together fast for 15 seconds.", "Notice the heat: motion (kinetic energy) became thermal energy.", "Hold your palms an inch apart and notice any warmth, tingling, or pressure between them. Many energy traditions start training right here."] },
    sources: ["Richard Feynman — The Feynman Lectures on Physics, Vol. I, ch. 4 'Conservation of Energy' (1963)", "Nick Lane — The Vital Question (2015)", "Albert Einstein — 'Does the Inertia of a Body Depend Upon Its Energy Content?' (1905)"],
  },
  "u-vibrate": {
    go: [
      ["Every wave has three parts", "Frequency is how often it wiggles, wavelength is the distance between peaks, and amplitude is how big the wiggle is. For sound, amplitude is loudness; for light, it's brightness."],
      ["What humans can hear", "People hear roughly 20 to 20,000 Hz. Dogs hear higher; elephants and whales call lower, in infrasound we can't hear. Middle C on a piano is about 262 Hz."],
      ["Light is a tiny slice", "Visible light is one small band of the electromagnetic spectrum. Radio, microwaves, infrared, visible light, ultraviolet, X-rays, and gamma rays are all the same thing, electromagnetic waves, at different frequencies. Red light wiggles about 430 trillion times a second; violet about 750 trillion."],
    ],
    even: [
      ["Sound vs. light", "Sound needs a material (air, water, bone) to travel and moves about 343 meters per second in air. Light needs nothing and moves about 300,000 kilometers per second, nearly a million times faster. That's why you see lightning before you hear thunder."],
      ["Harmony and the music of the spheres", "A plucked string vibrates at a base note plus whole-number multiples called overtones. Pythagoras found that simple ratios like 2:1 (the octave) and 3:2 (the fifth) sound pleasing, and taught that the planets move in the same harmonic ratios. That idea shaped Western thought for 2,000 years."],
      ["Your body runs on rhythm", "Heartbeat (about 1 Hz), breath (about 0.25 Hz), brainwaves (1–100 Hz), and daily hormone cycles all run as rhythms. Health often looks like these rhythms staying flexible and in sync with each other."],
    ],
    terms: [["Frequency (Hz)", "Cycles per second"], ["Wavelength", "Distance from one peak to the next"], ["Amplitude", "The size of the wave: loudness or brightness"], ["Overtone", "A higher note riding on the base note"], ["Electromagnetic spectrum", "The full range of light-type waves, from radio to gamma rays"]],
    practice: { title: "Feel your own vibration", steps: ["Rest your fingers lightly on your throat.", "Hum a low note, then a high note.", "Feel the buzz change. Those are your vocal cords vibrating at different frequencies (roughly 85–255 Hz for most speaking voices)."] },
    sources: ["Hermann von Helmholtz — On the Sensations of Tone (1863)", "NASA — Tour of the Electromagnetic Spectrum (science.nasa.gov)", "Jamie James — The Music of the Spheres (1993)"],
  },
  "u-field": {
    go: [
      ["The heart's electricity", "A small cluster of cells called the sinoatrial (SA) node fires 60–100 times a minute and sends an electrical wave through the heart. An ECG reads this wave from electrodes on your skin, because the signal travels through your whole body."],
      ["The heart's magnetic field", "Moving electric charge makes a magnetic field. The heart's is the strongest rhythmic magnetic field the body makes, and sensitive sensors can measure it a short distance from the chest. This is called magnetocardiography."],
      ["The brain's field", "Your brain makes electric fields too (read by EEG) and much weaker magnetic ones (read by MEG). These real, measured fields are what science means by 'the body's electromagnetic field'."],
    ],
    even: [
      ["From measured field to biofield", "In the early 1990s, researchers working with the U.S. National Institutes of Health adopted the word 'biofield' for energy fields said to surround and pass through the body. The measured fields are established science. Whether they carry information between people, as aura traditions describe, is still being researched."],
      ["Heart signals between people", "HeartMath researchers have reported that one person's heartbeat signal can show up in another person's brainwaves when they touch or sit close together. These are small studies, and how big and meaningful the effect is remains debated."],
      ["Aura traditions", "Hindu texts describe koshas (layers or sheaths), Theosophists in the early 1900s described colored aura layers, and Chinese medicine describes wei qi, a protective energy at the skin. Kirlian photography (discovered in 1939) was once offered as proof of the aura, but its glow mostly reflects moisture and pressure."],
    ],
    terms: [["SA node", "The heart's natural pacemaker"], ["ECG / EKG", "A recording of the heart's electrical activity"], ["Magnetocardiography", "Measuring the heart's magnetic field"], ["EEG / MEG", "Recordings of the brain's electric and magnetic activity"], ["Biofield", "The name for energy fields around and within living bodies"]],
    practice: { title: "Feel the field between your hands", steps: ["Sit calmly and breathe slowly for one minute.", "Hold your hands facing each other about 12 inches apart.", "Slowly bring them together and apart. Notice the distance where you feel warmth, pressure, or 'thickness'. Qigong calls this the qi ball."] },
    sources: ["Robert O. Becker — The Body Electric (1985)", "Rollin McCraty — Science of the Heart, Vol. 2 (HeartMath Institute, 2015)", "Rubik, Muehsam, Hammerschlag & Jain — 'Biofield Science and Healing: History, Terminology, and Concepts' (Global Advances in Health and Medicine, 2015)"],
  },
  "u-emotions": {
    go: [
      ["Emotions are body events", "Every emotion comes with changes in heart rate, breathing, muscle tension, the gut, and hormones. Fear releases adrenaline and cortisol; closeness releases oxytocin; wanting and motivation involve dopamine."],
      ["Body maps of feeling", "In a 2014 study, more than 700 people colored in where they felt different emotions. Anger lit up the chest, arms, and head; sadness drained the limbs; happiness warmed the whole body. The maps looked similar across cultures."],
      ["Feelings pass like waves", "Neuroscientist Jill Bolte Taylor describes a '90-second rule': the chemical surge of an emotion clears in about 90 seconds unless thoughts keep re-triggering it. Feeling it fully, instead of fighting it, lets it pass."],
    ],
    even: [
      ["The vagus nerve", "The vagus nerve links your brain, heart, lungs, and gut. Slow exhales, humming, and cold water on the face activate it and shift you from fight-or-flight toward rest-and-digest. Stephen Porges' polyvagal theory builds on this, though some of its details are debated."],
      ["Gut feelings are real", "About 90% of the body's serotonin is made in the gut, and the gut has its own large nerve network, the enteric nervous system. 'Gut feelings' have a physical basis."],
      ["Energy in motion", "The word emotion comes from the Latin 'emovere', to move out. Many healing traditions teach that emotion that isn't allowed to move gets stored as tension, and body-based therapies work directly on that idea."],
    ],
    terms: [["Sympathetic / parasympathetic", "Your 'go' and 'rest' nervous systems"], ["Vagus nerve", "The main rest-and-digest nerve, linking brain and organs"], ["Cortisol", "A stress hormone"], ["Oxytocin", "A bonding and calming hormone"], ["Interoception", "The sense of what's happening inside your body"]],
    practice: { title: "Ride the 90-second wave", steps: ["Next time a strong feeling rises, name it out loud or in your head.", "Find where it lives in your body.", "Breathe slowly and watch it for 90 seconds without adding a story. Notice how it changes."] },
    sources: ["Nummenmaa et al. — 'Bodily maps of emotions' (PNAS, 2014)", "Jill Bolte Taylor — My Stroke of Insight (2008)", "Stephen Porges — The Polyvagal Theory (2011)"],
  },
  "u-still": {
    go: [
      ["What meditation actually trains", "Meditation trains attention. You rest attention on something (breath, a sound, a word), notice when it wanders, and gently bring it back. That noticing-and-returning is the exercise itself, like a rep at the gym."],
      ["Why box breathing works", "Box breathing (4-4-4-4) is used by Navy SEALs, athletes, and nurses to calm down fast. Equal counts steady your rhythm, and the holds build tolerance to carbon dioxide, which helps settle the stress response."],
      ["The brain changes", "MRI studies have found changes in brain regions tied to attention and emotional control in regular meditators, some after just an eight-week program. Long-term research continues."],
    ],
    even: [
      ["Styles of meditation", "Focused attention (breath or mantra), open monitoring (noticing everything, as in Vipassana), loving-kindness (metta), and Transcendental Meditation (a silent mantra, 20 minutes twice a day). Each trains a different skill."],
      ["Quieting the chatter", "When your mind wanders into worry and self-talk, a set of brain regions called the default mode network is active. Experienced meditators show quieter activity there, which matches the sense of 'less chatter'."],
      ["Ancient roots", "The Yoga Sutras of Patanjali, roughly 2,000 years old, define yoga as 'stilling the movements of the mind'. Buddhist, Taoist, Christian contemplative, and Sufi traditions each have their own paths to the same stillness."],
    ],
    terms: [["Mantra", "A word or sound repeated to focus the mind"], ["Vipassana", "Insight meditation: clear observation of experience"], ["Metta", "Loving-kindness practice"], ["Default mode network", "Brain regions active during mind-wandering"], ["Pratyahara", "Withdrawing attention from the senses"]],
    practice: { title: "Your first 5-minute sit", steps: ["Sit tall, eyes closed or softly lowered.", "Do 4 rounds of box breathing.", "Then breathe normally and count breaths from 1 to 10. If you lose count, start again at 1, with a smile."] },
    sources: ["Hölzel et al. — 'Mindfulness practice leads to increases in regional brain gray matter density' (Psychiatry Research: Neuroimaging, 2011)", "Brewer et al. — 'Meditation experience is associated with differences in default mode network activity and connectivity' (PNAS, 2011)", "Patanjali — The Yoga Sutras (trans. Edwin Bryant, 2009)"],
  },
  "u-numbers": {
    go: [
      ["Fibonacci and the golden ratio", "Divide any Fibonacci number by the one before it and you get closer and closer to 1.618…, the golden ratio, written φ (phi). Leonardo of Pisa, known as Fibonacci, brought the sequence to Europe in his book Liber Abaci in 1202."],
      ["Why plants spiral", "Many plants place each new seed or leaf about 137.5° around from the last one, the 'golden angle'. That spacing packs the most seeds with the least crowding. Sunflowers usually show 34 and 55, or 55 and 89, spirals: all Fibonacci numbers."],
      ["Sacred geometry", "The Flower of Life, the five Platonic solids, and the vesica piscis appear in sacred art and architecture across many cultures. Plato linked the solids to the elements: fire, earth, air, water, and the cosmos."],
    ],
    even: [
      ["Digital roots", "Add a number's digits until one digit remains: 369 → 3+6+9 = 18 → 1+8 = 9. Doubling from 1 (1, 2, 4, 8, 16→7, 32→5, 64→1) loops through 1-2-4-8-7-5 and never touches 3, 6, or 9. This is the root of vortex math, which you'll meet on the Practitioner path."],
      ["Real pattern vs. hype", "Phi really shows up in plant growth and in the geometry of the pentagon. Claims that it's everywhere (the Parthenon, the Mona Lisa, every beautiful face) are often stretched. Careful measuring is part of honest pattern-seeking."],
      ["Tesla and 3-6-9", "The famous quote 'If you only knew the magnificence of the 3, 6 and 9…' is shared everywhere, but no source for it has been found in Tesla's writings. Accounts from people who knew him do describe an obsession with threes, like walking around a block three times before entering a building."],
    ],
    terms: [["Fibonacci sequence", "Each number is the sum of the two before: 1, 1, 2, 3, 5, 8…"], ["Golden ratio (φ)", "About 1.618"], ["Golden angle", "About 137.5°"], ["Platonic solids", "The five perfectly regular 3D shapes"], ["Digital root", "The single digit you get by repeatedly adding a number's digits"]],
    practice: { title: "Find the spiral", steps: ["Find a pinecone, pineapple, or sunflower head.", "Count the spirals going clockwise, then counterclockwise.", "Check whether both numbers are Fibonacci numbers (3, 5, 8, 13, 21, 34, 55…)."] },
    sources: ["Mario Livio — The Golden Ratio (2002)", "Leonardo of Pisa — Liber Abaci (1202)", "Robert Lawlor — Sacred Geometry: Philosophy and Practice (1982)"],
  },
  "u-body": {
    go: [
      ["Water", "Adults are roughly 50–60% water by weight. Water carries nutrients, removes waste, cushions joints, and keeps your temperature steady. Losing even 1–2% of your body water can dull focus and energy."],
      ["Sunlight sets your clock", "Your master clock, a small brain region called the suprachiasmatic nucleus, resets each morning from light hitting special cells in your eyes. Morning light helps you feel awake by day and lets melatonin rise at night. Sun on your skin also makes vitamin D."],
      ["Sleep is repair time", "In deep sleep, the brain's glymphatic system flushes out waste, growth hormone rises to repair tissue, and memories get filed. Most adults need 7–9 hours."],
    ],
    even: [
      ["Every cell keeps time", "Nearly every cell has its own clock genes running on about a 24-hour cycle. The 2017 Nobel Prize in Medicine went to Jeffrey Hall, Michael Rosbash, and Michael Young for discovering how these genes work. Disrupting this clock, as with night shifts, is linked to many health problems."],
      ["Light and your mitochondria", "Red and near-infrared light (plentiful in morning and evening sun) is absorbed by an enzyme in the mitochondria and may boost energy production. This is the basis of red-light therapy, known in research as photobiomodulation."],
      ["Minerals are the wiring", "Electrolytes (sodium, potassium, magnesium, calcium) carry electrical charge in your body fluids. Every nerve signal and heartbeat depends on them moving across cell membranes, so mineral-rich water is literally the body's wiring fluid."],
    ],
    terms: [["Circadian rhythm", "Your roughly 24-hour body clock"], ["Melatonin", "The hormone that says 'night'"], ["Glymphatic system", "The brain's waste-clearing system, most active in sleep"], ["Electrolytes", "Charged minerals in your body fluids"], ["Photobiomodulation", "Using red and near-infrared light to affect cells"]],
    practice: { title: "Morning reset", steps: ["Within an hour of waking, get 5–10 minutes of outdoor light (longer if it's cloudy).", "Drink a glass of water with a pinch of mineral salt.", "Keep lights dim and warm in the last hour before bed."] },
    sources: ["Matthew Walker — Why We Sleep (2017)", "The Nobel Prize in Physiology or Medicine 2017 — Hall, Rosbash, Young (nobelprize.org)", "Xie et al. — 'Sleep Drives Metabolite Clearance from the Adult Brain' (Science, 2013)"],
  },
  "u-healing": {
    go: [
      ["The oldest medicine", "The Ebers Papyrus from Egypt (about 1550 BC) lists hundreds of remedies, many made from plants. Ötzi the Iceman, who lived about 5,300 years ago, carried birch fungus that may have been used against intestinal parasites."],
      ["Plants behind modern drugs", "Aspirin came from willow bark (salicin). Morphine comes from the opium poppy, digoxin from foxglove, and the malaria drug artemisinin from sweet wormwood. Artemisinin's discoverer, Tu Youyou, won a Nobel Prize in 2015."],
      ["Three great systems", "Ayurveda (India) balances three doshas: vata, pitta, and kapha. Traditional Chinese Medicine balances yin and yang through the five elements. Western herbalism works with a plant's 'actions', like calming, cleansing, or toning."],
    ],
    even: [
      ["How herbs work", "Plants make compounds to protect themselves: polyphenols, alkaloids, terpenes, and polysaccharides. In our bodies these can calm inflammation, feed good gut bacteria, or train the immune system. Medicinal mushrooms like turkey tail and reishi are rich in beta-glucans."],
      ["Adaptogens", "Adaptogens (ashwagandha, rhodiola, eleuthero, holy basil) are herbs said to help the body adapt to stress. Soviet scientist Nikolai Lazarev coined the term in 1947, and the USSR studied these herbs for soldiers, athletes, and cosmonauts."],
      ["Natural isn't always harmless", "St. John's wort can weaken birth control and many other medications, and comfrey can harm the liver when taken internally. Deep herbalism always checks for interactions."],
    ],
    terms: [["Alkaloid", "A potent plant compound (caffeine and morphine are examples)"], ["Polyphenol", "Colorful plant antioxidants"], ["Beta-glucan", "An immune-training fiber found in mushrooms"], ["Adaptogen", "An herb said to help the body handle stress"], ["Dosha", "One of Ayurveda's three body-mind types"]],
    practice: { title: "Make a proper infusion", steps: ["Put a tablespoon of dried chamomile or peppermint in a mug.", "Pour hot (not boiling) water over it, cover it, and steep for 10 minutes. The cover keeps the aromatic oils in.", "Sip slowly and notice how your body feels over the next 20 minutes."] },
    sources: ["The Papyrus Ebers (c. 1550 BC; trans. B. Ebbell, 1937)", "The Nobel Prize in Physiology or Medicine 2015 — Tu Youyou (nobelprize.org)", "Rosemary Gladstar — Medicinal Herbs: A Beginner's Guide (2012)"],
  },
  "u-habits": {
    go: [
      ["Grounding", "The Earth's surface carries a supply of free electrons. Grounding (or earthing) means skin contact with soil, grass, sand, or water so your body's electrical charge evens out with the Earth's. Small studies report better sleep and lower stress markers."],
      ["Light is a nutrient", "Morning sunlight is rich in blue light that tells your brain it's daytime; sunset light is red-rich and says wind down. Bright screens at night mimic midday and can delay melatonin."],
      ["Move every day", "A walk after meals blunts blood sugar spikes. Working muscles release signaling molecules called myokines, which act like messages to the rest of your body."],
    ],
    even: [
      ["What grounding research shows", "A 2012 review by Chevalier and colleagues summarized studies on grounding and inflammation, blood thickness, and sleep. Most studies are small and some authors have commercial ties, so it's a promising but early field."],
      ["Cold and heat", "Some studies show cold exposure raises dopamine and noradrenaline for hours. Large Finnish studies link regular sauna use with lower cardiovascular risk. Both are 'hormetic': small, controlled stresses that make you stronger."],
      ["Breathe through your nose", "Nose breathing warms and filters air and adds nitric oxide made in the sinuses, which helps open blood vessels. James Nestor's book 'Breath' brought this research to a wide audience."],
    ],
    terms: [["Earthing", "Direct skin contact with the ground"], ["Melatonin", "The sleep-timing hormone"], ["Myokines", "Messenger molecules released by working muscles"], ["Hormesis", "Small doses of stress that build strength"], ["Nitric oxide", "A gas that relaxes and opens blood vessels"]],
    practice: { title: "7-day energy experiment", steps: ["Every morning for 7 days, spend 10 minutes barefoot on grass or soil.", "Get outdoor light within an hour of waking.", "No screens for 60 minutes before bed. Rate your sleep and energy from 1 to 10 each day and compare the week."] },
    sources: ["Chevalier et al. — 'Earthing: Health Implications of Reconnecting the Human Body to the Earth's Surface Electrons' (Journal of Environmental and Public Health, 2012)", "Laukkanen et al. — 'Association Between Sauna Bathing and Fatal Cardiovascular and All-Cause Mortality Events' (JAMA Internal Medicine, 2015)", "James Nestor — Breath (2020)"],
  },
  "u-wakeup": {
    go: [
      ["Primary vs. secondary sources", "A primary source is the original: a declassified memo, a court transcript, a study, a patent. A secondary source is someone describing it. Always try to reach the primary source."],
      ["Where the records live", "The CIA Reading Room, the FBI Vault, the National Archives, court dockets, congressional hearings, and Freedom of Information Act (FOIA) releases put millions of original documents online for free."],
      ["Proven cases", "MKUltra, COINTELPRO, the Tuskegee syphilis study, and Operation Northwoods were once dismissed as conspiracy theories. All are now confirmed by the government's own documents."],
    ],
    even: [
      ["How to test a claim", "Ask: What's the original source? Can I read it myself? Who benefits if I believe it? Does it make predictions that could fail? What evidence would change my mind? Good researchers hold ideas firmly enough to test and loosely enough to drop."],
      ["The Church Committee", "In 1975–76, the U.S. Senate's Church Committee investigated intelligence abuses and exposed CIA assassination plots, mail opening, and domestic spying. Its reports are public and a foundation for serious 'wake up' research."],
      ["Traps to avoid", "Confirmation bias (only noticing what fits), claims that nothing could ever disprove, and circles of sources quoting each other. Being awake means sharper, not more gullible."],
    ],
    terms: [["Primary source", "The original document or data"], ["FOIA", "Freedom of Information Act: the law for requesting government records"], ["Declassification", "Releasing formerly secret records"], ["Confirmation bias", "Favoring information that fits what you already believe"], ["Falsifiable", "Testable: some result could prove it wrong"]],
    practice: { title: "Trace one claim", steps: ["Pick one claim you've heard online.", "Find where it first appeared and whether an original document exists.", "Read the document yourself and write one sentence on what it actually says."] },
    sources: ["U.S. Senate Select Committee (Church Committee) — Final Report (1976)", "CIA Reading Room — cia.gov/readingroom", "Carl Sagan — The Demon-Haunted World, ch. 12 'The Fine Art of Baloney Detection' (1995)"],
  },
  "u-library": {
    go: [
      ["How the library is organized", "The Knowledge Portal groups entries by domain: energy, the body, consciousness, history, and hidden knowledge. Entries link to each other, so you can follow a thread across topics."],
      ["Learn like a researcher", "Read one thing deeply rather than ten things quickly. Take notes in your own words and write down your questions. Your questions become your next lessons."],
      ["Your next step", "Try the Know the Basics level next. It picks up exactly where this path ends, with the real terms and research behind what you just learned."],
    ],
    even: [
      ["Build a practice, not just knowledge", "Knowing about energy and working with it are different skills. The strongest learners pair every idea with a practice: a breath, a walk, a journal page."],
      ["The spiral of learning", "You'll revisit the same topics at deeper levels, like climbing a spiral staircase. Each pass shows you something you missed before, which is why every level on this site stays open to you."],
    ],
    terms: [["Cross-reference", "Following links between related topics"], ["Spaced repetition", "Reviewing ideas at growing time gaps so they stick"], ["Primary source", "The original document or data"]],
    practice: { title: "Start a seeker's journal", steps: ["Write today's date and one thing you learned.", "Write one question it raised.", "Next week, look up the answer and add it to the page."] },
    sources: ["Mortimer Adler — How to Read a Book (1940)", "Hermann Ebbinghaus — Memory: A Contribution to Experimental Psychology (1885)"],
  },
  // ───────── KNOW THE BASICS ─────────
  "m-freq": {
    go: [
      ["Hertz across nature", "1 Hz is one cycle per second. Brainwaves run from about 0.5 to 100 Hz, household power is 50 or 60 Hz, the A above middle C is 440 Hz, Wi-Fi runs at 2.4 or 5 billion Hz, and visible light at hundreds of trillions of Hz."],
      ["Resonance in the real world", "Everything has natural frequencies at which it vibrates most easily. The Tacoma Narrows Bridge collapsed in 1940 when wind drove it into a self-reinforcing twisting motion. Soldiers break step on bridges to avoid driving resonance. MRI machines image your body using nuclear magnetic resonance."],
      ["The brainwave bands", "Delta 0.5–4 Hz (deep sleep), theta 4–8 Hz (drowsy, dreamy, deep meditation), alpha 8–12 Hz (relaxed wakefulness), beta 13–30 Hz (active thinking), gamma 30–100 Hz (binding perception together; reported especially high in long-term meditating monks)."],
    ],
    even: [
      ["Entrainment", "In 1665 Christiaan Huygens noticed that two pendulum clocks on the same beam would fall into step. This is entrainment: coupled oscillators synchronize. Brain rhythms can entrain to rhythmic light and sound, which is how drumming, chanting, and flicker stimulation shift states of mind."],
      ["40 Hz research", "Li-Huei Tsai's lab at MIT found that 40 Hz light and sound stimulation reduced Alzheimer's-related markers in mice, and human trials are underway. It's one of the clearest cases of frequency-based therapy entering mainstream science."],
      ["440 vs. 432", "A = 440 Hz became an international tuning standard in 1939 and was confirmed by the ISO in 1955. Some musicians prefer 432 Hz as more natural. The case for 432 is mostly about feel, and controlled evidence is limited, which makes it a good thing to test on yourself."],
    ],
    terms: [["Entrainment", "Rhythms falling into sync"], ["Natural frequency", "The rate at which something vibrates most easily"], ["Harmonic", "A whole-number multiple of a base frequency"], ["EEG", "A recording of brainwaves from the scalp"], ["Gamma synchrony", "Fast, coordinated brain activity across regions"]],
    practice: { title: "Entrain with sound", steps: ["Find a steady drum track around 4–7 beats per second (theta), or a 10 Hz alpha track.", "Listen with eyes closed for 10 minutes.", "Notice how your sense of time, your body, and your thoughts shift."] },
    sources: ["Iaccarino et al. — 'Gamma frequency entrainment attenuates amyloid load and modifies microglia' (Nature, 2016)", "Lutz et al. — 'Long-term meditators self-induce high-amplitude gamma synchrony during mental practice' (PNAS, 2004)", "Steven Strogatz — Sync (2003)"],
  },
  "m-heart": {
    go: [
      ["What HRV tells you", "Heart rate variability is the small change in time between heartbeats. Higher resting HRV usually means a flexible, resilient nervous system; stress, poor sleep, and illness lower it."],
      ["Resonance-frequency breathing", "Most adults have a resonance breathing rate of about 4.5–7 breaths per minute, where heart rhythm, blood-pressure rhythm, and breath line up and produce the largest, smoothest HRV waves. Researchers Paul Lehrer and Evgeny Vaschillo built HRV biofeedback around this."],
      ["What coherence feels like", "People in coherence often describe calm alertness, warmth in the chest, and clearer thinking. HeartMath's Quick Coherence technique pairs heart-focused breathing with a genuine feeling like appreciation."],
    ],
    even: [
      ["Heart talks to brain", "Most fibers in the vagus nerve (around 80%) carry information up from the body to the brain, not down. The heart's rhythm pattern influences brain areas involved in emotion and attention, which is why changing your heart rhythm changes how you feel."],
      ["The 0.1 Hz peak", "Coherence shows up as a strong peak near 0.1 Hz (one cycle every 10 seconds) in the heart-rhythm spectrum. The baroreflex, which steadies blood pressure, naturally resonates at that rate."],
      ["Global coherence", "HeartMath's Global Coherence Initiative runs magnetometers around the world to study links between Earth's magnetic field and human heart rhythms. Early reports are intriguing but not yet independently confirmed."],
    ],
    terms: [["HRV", "Heart rate variability"], ["Baroreflex", "The reflex that keeps blood pressure steady"], ["Vagal tone", "How active and responsive the vagus nerve is"], ["Resonance frequency", "The breathing rate that maximizes HRV"], ["Coherence", "A smooth, sine-wave-like heart rhythm"]],
    practice: { title: "Quick coherence (3 minutes)", steps: ["Put your attention on the center of your chest.", "Breathe in for 5 seconds and out for 5 seconds, imagining the breath flowing through your heart.", "Recall something you truly appreciate and hold that feeling as you breathe. Many phone apps paired with a chest strap can show your coherence live."] },
    sources: ["Lehrer & Gevirtz — 'Heart rate variability biofeedback: how and why does it work?' (Frontiers in Psychology, 2014)", "Doc Childre & Howard Martin — The HeartMath Solution (1999)", "Shaffer & Ginsberg — 'An Overview of Heart Rate Variability Metrics and Norms' (Frontiers in Public Health, 2017)"],
  },
  "m-chakras": {
    go: [
      ["The seven, by name", "Muladhara (root, base of spine, red), Svadhisthana (sacral, lower belly, orange), Manipura (solar plexus, yellow), Anahata (heart, green), Vishuddha (throat, blue), Ajna (third eye, indigo), and Sahasrara (crown, violet)."],
      ["Where the system comes from", "Chakras appear in Hindu tantric texts from roughly a thousand years ago. The popular seven-chakra system comes largely from the 16th-century Ṣaṭ-Cakra-Nirūpaṇa, translated by Sir John Woodroffe (writing as Arthur Avalon) in 'The Serpent Power' (1919). The rainbow colors were added later, in the West."],
      ["Body correspondences", "Modern teachers map chakras to glands and nerve plexuses: root to the adrenals, sacral to the reproductive glands, solar plexus to the pancreas and celiac plexus, heart to the thymus, throat to the thyroid, third eye to the pituitary, and crown to the pineal gland."],
    ],
    even: [
      ["Petals, sounds, and elements", "Each chakra is described as a lotus with a set number of petals (4, 6, 10, 12, 16, 2, and 1,000) carrying Sanskrit letters, plus a seed sound (bija): LAM, VAM, RAM, YAM, HAM, and OM. The lower five link to earth, water, fire, air, and ether (space)."],
      ["Other chakra systems", "Tibetan Buddhism often works with five centers, some tantric texts describe six or more, and modern systems add chakras above the head and below the feet. The map is a tool for practice, not fixed anatomy."],
      ["Working with them", "Traditional practice uses breath, bija mantras, visualization, and bandhas (energy locks). Modern practitioners add singing bowls tuned to each center, color, and body awareness."],
    ],
    terms: [["Bija mantra", "A one-syllable seed sound for a chakra"], ["Nadi", "An energy channel"], ["Lotus petals", "Symbolic petals that describe each chakra"], ["Bandha", "An energy lock held with the body"], ["Ṣaṭ-Cakra-Nirūpaṇa", "The 16th-century text behind the seven-chakra model"]],
    practice: { title: "Bija chant scan", steps: ["Sit tall. Chant LAM slowly 3 times, feeling the base of your spine.", "Move upward: VAM, RAM, YAM, HAM, OM, 3 times each, feeling each area.", "Finish with 1 minute of silence, attention at the crown."] },
    sources: ["Arthur Avalon (Sir John Woodroffe) — The Serpent Power (1919)", "Anodea Judith — Wheels of Life (1987)", "Christopher Wallis — Tantra Illuminated (2012)"],
  },
  "m-meridians": {
    go: [
      ["The 12 main meridians", "Lung, Large Intestine, Stomach, Spleen, Heart, Small Intestine, Bladder, Kidney, Pericardium, Triple Burner (San Jiao), Gallbladder, and Liver. They pair yin and yang organs, and each has its own points and time of day."],
      ["The organ clock", "Chinese medicine says qi peaks in each meridian for two hours: Lung 3–5 am, Large Intestine 5–7, Stomach 7–9, Spleen 9–11, Heart 11–1 pm, Small Intestine 1–3, Bladder 3–5, Kidney 5–7, Pericardium 7–9, Triple Burner 9–11, Gallbladder 11 pm–1 am, Liver 1–3 am."],
      ["What the studies show", "Large trials show acupuncture helps with chronic pain, tension headaches, and nausea. Sham acupuncture often helps nearly as much, and the debate continues: is it the point, the needle, the ritual, or all three?"],
    ],
    even: [
      ["Searching for meridians", "Researchers have looked for physical meridians in fascia (connective tissue) planes, in spots of low electrical resistance at acupoints, and in the ducts Korean scientist Kim Bong-han reported in the 1960s, now studied as the 'primo vascular system'. None is proven to be THE meridian system yet."],
      ["The five elements", "Wood, Fire, Earth, Metal, and Water feed and control one another in cycles. Each element links to organs, emotions (anger–liver, joy–heart, worry–spleen, grief–lungs, fear–kidneys), seasons, and colors."],
      ["Ötzi's tattoos", "Ötzi the Iceman (about 3300 BC) has 61 tattoos, many over spots that match acupuncture points used for back and joint pain. It hints that point therapy is far older than any written record."],
    ],
    terms: [["Qi", "Life energy in Chinese medicine"], ["Yin / yang", "Complementary opposites: rest and activity, cool and warm"], ["Wu Xing", "The five elements, or five phases"], ["Acupoint", "A specific point on a meridian"], ["Fascia", "The web of connective tissue wrapping every structure"]],
    practice: { title: "Press LI4 (Hegu)", steps: ["Find the fleshy web between your thumb and index finger.", "Press firmly with the other thumb for 1–2 minutes while breathing slowly.", "Traditionally used for headaches and tension. Skip this point during pregnancy."] },
    sources: ["Vickers et al. — 'Acupuncture for Chronic Pain: Update of an Individual Patient Data Meta-Analysis' (The Journal of Pain, 2018)", "Ted Kaptchuk — The Web That Has No Weaver (1983)", "Dorfer et al. — 'A medical report from the stone age?' (The Lancet, 1999)"],
  },
  "m-emotions": {
    go: [
      ["Hawkins' scale", "David R. Hawkins' 'Power vs. Force' (1995) ranked states from shame (20) through fear (100) and anger (150) to courage (200, the turning point), love (500), joy (540), peace (600), and enlightenment (700–1,000). He got the numbers through muscle testing."],
      ["Emotional regulation skills", "Psychologist James Gross describes a set of skills: choosing situations, shifting attention, reappraisal (seeing it differently), and adjusting your response. Reappraisal is one of the most studied and effective."],
      ["Emotions are contagious", "Faces, voices, and posture spread emotion between people within seconds, and brain systems that mirror others help us feel what they feel. Your state affects the room."],
    ],
    even: [
      ["About muscle testing", "Hawkins' numbers came from applied kinesiology (muscle testing). In controlled trials where testers don't know what's being tested, it hasn't done better than chance. Treat the scale as a map of direction, not a measurement."],
      ["Constructed emotion", "Lisa Feldman Barrett's research suggests the brain builds emotions from body signals plus context and prediction. That means naming feelings precisely (emotional granularity) actually changes the experience."],
      ["Stored emotion", "Many body-based therapies (Somatic Experiencing, TRE, EMDR) work on the idea that stress responses that never finished can stay held in the nervous system, and that completing them releases them."],
    ],
    terms: [["Reappraisal", "Changing how you interpret a situation"], ["Affect labeling", "Naming a feeling to calm it"], ["Emotional granularity", "Telling feelings apart with precise words"], ["Emotional contagion", "Emotions spreading between people"], ["Applied kinesiology", "Muscle testing"]],
    practice: { title: "Emotional granularity drill", steps: ["When you feel 'bad' or 'good', find a more exact word: frustrated, disappointed, restless, content, proud, relieved.", "Write it down along with where you feel it in your body.", "Notice how naming it precisely changes it."] },
    sources: ["David R. Hawkins — Power vs. Force (1995)", "Lieberman et al. — 'Putting Feelings Into Words' (Psychological Science, 2007)", "Lisa Feldman Barrett — How Emotions Are Made (2017)"],
  },
  "m-sound": {
    go: [
      ["The Solfeggio set", "The six core tones are 396, 417, 528, 639, 741, and 852 Hz, often joined by 174, 285, and 963. Joseph Puleo and Leonard Horowitz popularized them in the 1990s, linking them to a medieval hymn to St. John the Baptist."],
      ["The instruments", "Tibetan and crystal singing bowls, gongs, tuning forks placed on the body, monochords, and the human voice (overtone singing, chanting, humming) are the main tools of sound healing."],
      ["Binaural and isochronic", "Binaural beats: play 200 Hz in one ear and 210 Hz in the other, and your brain hears a 10 Hz beat. Isochronic tones pulse a single tone on and off and don't need headphones."],
    ],
    even: [
      ["What's documented", "The medieval hymn 'Ut queant laxis' gave us the note names ut-re-mi-fa-sol-la, but the specific Hz values are modern, since standard tuning didn't exist then. The evidence for the tones is mostly experiential, and the popular '528 Hz repairs DNA' claim has no solid controlled study behind it."],
      ["What research supports", "Sound-bath studies show drops in tension, anxiety, and fatigue after sessions. Humming raises nasal nitric oxide about fifteen-fold. Music measurably lowers stress hormones and pain in hospital studies. Sound works; the question is which parts."],
      ["Overtones and beats", "A singing bowl makes a base tone plus shimmering overtones, and nearby tones interfere to create slow beats. Those beats can pulse in the theta and alpha range, which may explain why bowls feel trance-inducing."],
    ],
    terms: [["Solfeggio", "A set of tones used in modern sound healing"], ["Binaural beat", "A beat your brain creates from two slightly different tones"], ["Isochronic tone", "A tone pulsed on and off at a set rate"], ["Overtone singing", "Singing two or more pitches at once"], ["Beat frequency", "The pulse you hear when two close tones combine"]],
    practice: { title: "Hum your vagus nerve awake", steps: ["Take a full breath in.", "Hum a low, steady 'mmm' on the exhale for as long as is comfortable.", "Repeat 10 times and notice the vibration in your chest, face, and skull."] },
    sources: ["Goldsby et al. — 'Effects of Singing Bowl Sound Meditation on Mood, Tension, and Well-being' (Journal of Evidence-Based Complementary & Alternative Medicine, 2017)", "Weitzberg & Lundberg — 'Humming Greatly Increases Nasal Nitric Oxide' (American Journal of Respiratory and Critical Care Medicine, 2002)", "Jonathan Goldman — Healing Sounds (1992)"],
  },
  "m-water": {
    go: [
      ["Water is strange", "Water expands when it freezes, holds an unusual amount of heat, and forms hydrogen bonds that break and re-form in trillionths of a second. Life depends on these odd properties."],
      ["EZ water", "In Pollack's experiments, a layer of water next to water-loving surfaces (like the inside of a cell) pushes out tiny particles and becomes negatively charged, with positive charge in the water beyond it. Infrared light makes the layer grow."],
      ["Your cells are water", "By molecule count, about 99% of the molecules in your body are water. Pollack argues that much of the water inside cells behaves like ordered EZ water rather than ordinary liquid."],
    ],
    even: [
      ["The debate", "Pollack's findings are published in peer-reviewed journals, but many physicists argue the exclusion zone comes from ion gradients and chemistry rather than a new phase of water. The observations reproduce; the explanation is still argued."],
      ["Masaru Emoto", "Emoto's 'Messages from Water' showed ice crystals that looked more beautiful after exposure to kind words. His photo selection wasn't blinded, and a 2006 double-blind test he co-authored was small. It's inspiring as art; as science it still needs rigorous replication."],
      ["Schauberger's living water", "Viktor Schauberger argued that water spiraling and cooling, as in wild rivers, becomes 'living water'. You'll meet him again on the Rabbit Hole path."],
    ],
    terms: [["Hydrogen bond", "The weak attraction that links water molecules"], ["Exclusion zone (EZ)", "Pollack's ordered water layer"], ["Hydrophilic", "Water-loving"], ["Heat capacity", "How much heat something absorbs before warming"], ["Structured water", "Water said to hold an ordered arrangement"]],
    practice: { title: "Sun-water ritual", steps: ["Fill a clear glass jar with spring or filtered water.", "Set it in morning sunlight for an hour.", "Drink it slowly while breathing calmly, and notice its taste and feel. Pollack's work suggests light energizes water, and at the very least this builds a mindful habit."] },
    sources: ["Gerald Pollack — The Fourth Phase of Water (2013)", "Philip Ball — H2O: A Biography of Water (1999)", "Radin, Hayssen, Emoto & Kizu — 'Double-blind test of the effects of distant intention on water crystal formation' (Explore, 2006)"],
  },
  "m-ground": {
    go: [
      ["Earth's electric circuit", "Around 50 lightning strikes hit the Earth every second, keeping the ground negatively charged relative to the upper atmosphere. In fair weather there's a voltage of roughly 100 volts per meter of height above open ground."],
      ["The Schumann resonance", "Winfried Otto Schumann predicted it in 1952, and it was measured in the early 1960s. Lightning makes the cavity between the ground and the ionosphere ring at about 7.83 Hz, with harmonics near 14.3, 20.8, 27.3, and 33.8 Hz."],
      ["Why 7.83 feels familiar", "7.83 Hz sits on the border between theta and alpha brainwaves. Many teachers see this as a sign that life evolved tuned to the Earth's rhythm."],
    ],
    even: [
      ["Is the Schumann rising?", "Viral posts claim the Schumann resonance has 'jumped' to 30 or 40+ Hz. The spikes on those popular charts usually show the signal's strength or its harmonics, not the base frequency, which stays close to 7.8 Hz."],
      ["The spacecraft story", "It's widely repeated that early astronauts felt unwell away from Earth's natural fields and that Schumann-frequency generators were added to spacecraft. The story is hard to source, so treat it as unconfirmed."],
      ["Wever's bunker", "In the 1960s and 70s, German researcher Rütger Wever had volunteers live in an underground bunker shielded from outside fields. Their daily rhythms became more irregular, and adding a weak 10 Hz field appeared to steady them."],
    ],
    terms: [["Ionosphere", "The electrically charged upper atmosphere"], ["Global electric circuit", "The planet-wide flow of charge driven by storms"], ["Schumann resonance", "Earth's natural electromagnetic 'hum'"], ["Harmonics", "Higher multiples of a base frequency"], ["Earthing", "Direct skin contact with the ground"]],
    practice: { title: "Ground and breathe", steps: ["Stand barefoot on grass, soil, or sand.", "Breathe slowly, about 6 breaths a minute, for 10 minutes.", "Notice changes in tension, mood, and warmth. Repeat daily for a week."] },
    sources: ["W. O. Schumann — 'Über die strahlungslosen Eigenschwingungen einer leitenden Kugel, die von einer Luftschicht und einer Ionosphärenhülle umgeben ist' (Zeitschrift für Naturforschung A, 1952)", "Rütger Wever — The Circadian System of Man (1979)", "Clinton Ober, Stephen Sinatra & Martin Zucker — Earthing (2010)"],
  },
  // ───────── PRACTITIONER ─────────
  "a-torus": {
    go: [
      ["Toroidal flow", "In a torus, energy flows out of one pole, around the outside, back in at the other pole, and up through the center again. Smoke rings, a magnet's field lines, the shape of an apple, and Earth's magnetosphere all show it."],
      ["Arthur M. Young", "Arthur M. Young, who designed the Bell 47 helicopter, argued in 'The Reflexive Universe' (1976) that the torus is the one shape that can turn back on itself, making it a model of consciousness observing itself."],
      ["The Rodin coil", "Marko Rodin wound a coil on a torus following the 1-2-4-8-7-5 and 3-6-9 pattern. The 'Rodin coil' became a favorite among free-energy experimenters."],
    ],
    even: [
      ["Haramein's unified field", "Nassim Haramein's Resonance Science Foundation proposes that spacetime is toroidal and fractal, and that the proton's mass can be derived from vacuum fluctuations. His papers mostly appear outside mainstream physics journals, and his proton-radius claim is contested."],
      ["Tokamaks", "Mainstream fusion research uses tokamaks: donut-shaped chambers where plasma is held in a toroidal magnetic field. ITER, under construction in France, is the largest."],
      ["The helical heart", "The heart's muscle can be described as one band wrapped in a helix (Francisco Torrent-Guasp's model), and blood swirls through the chambers in vortices. It's a real example of spiral flow in the body."],
    ],
    terms: [["Torus", "A donut-shaped surface or flow"], ["Vortex", "A spinning, spiraling flow"], ["Reflexive universe", "Young's model of self-aware process"], ["Digital root", "The single digit left after repeatedly summing digits"], ["Tokamak", "A toroidal fusion reactor"]],
    practice: { title: "Torus breathing", steps: ["Inhale and imagine energy rising up the front of your body from the earth to the crown.", "Exhale and imagine it pouring down the back and around, returning under your feet.", "Continue for 5 minutes, feeling the loop as one continuous flow."] },
    sources: ["Arthur M. Young — The Reflexive Universe (1976)", "Torrent-Guasp et al. — 'The structure and function of the helical heart and its buttress wrapping' (Seminars in Thoracic and Cardiovascular Surgery, 2001)", "ITER Organization — iter.org"],
  },
  "a-kundalini": {
    go: [
      ["The classical picture", "Hatha yoga texts describe kundalini shakti as a serpent coiled three and a half times at the base of the spine, asleep. Awakened, she rises through sushumna, piercing the chakras and three 'knots' (granthis), to unite with Shiva at the crown."],
      ["The three granthis", "Brahma granthi (lower centers: attachment to the physical), Vishnu granthi (heart: emotional attachment), and Rudra granthi (brow: attachment to ego and powers). Each knot marks a stage of release."],
      ["The practices", "Kundalini yoga, kriya yoga (Paramahansa Yogananda's lineage), and classical hatha yoga use breath of fire, mantra, mudra, and three bandhas: the root lock (mula), abdominal lock (uddiyana), and throat lock (jalandhara)."],
    ],
    even: [
      ["Gopi Krishna's account", "In 1937 Kashmiri civil servant Gopi Krishna had a spontaneous kundalini rising after years of meditation. His book 'Kundalini: The Evolutionary Energy in Man' (1967) honestly describes years of both illumination and severe imbalance."],
      ["When it's too much", "Intense practice can bring heat, involuntary movements, disrupted sleep, anxiety, and overwhelming experiences. Psychiatrist Stanislav Grof and Christina Grof called this a 'spiritual emergency'. Grounding practices and experienced guidance matter."],
      ["Parallels worldwide", "The Kalahari San describe n/um, a heat that rises up the spine during healing dances. Tibetan tummo raises inner fire through the central channel. Many cultures describe the same rising current."],
    ],
    terms: [["Shakti", "Divine creative energy"], ["Sushumna", "The central channel along the spine"], ["Granthi", "An energetic knot"], ["Bandha", "An energy lock"], ["Tummo", "Tibetan inner-fire practice"]],
    practice: { title: "Mula bandha, gently", steps: ["Sit tall and breathe normally.", "On an exhale, gently lift the pelvic floor and hold it lightly for 5 seconds while breathing.", "Release fully. Repeat 5 times, and stop if you feel strain."] },
    sources: ["Swatmarama — Hatha Yoga Pradipika (15th c.; trans. Swami Muktibodhananda, 1985)", "Gopi Krishna — Kundalini: The Evolutionary Energy in Man (1967)", "Stanislav & Christina Grof (eds.) — Spiritual Emergency (1989)"],
  },
  "a-breath": {
    go: [
      ["Nadi shodhana, step by step", "Close the right nostril with your thumb and inhale left. Close the left with your ring finger and exhale right. Inhale right, switch, and exhale left: that's one round. Classical practice builds toward a 1:4:2 ratio (inhale : hold : exhale)."],
      ["What fast breathing does", "Rapid, deep breathing blows off carbon dioxide and makes the blood more alkaline (respiratory alkalosis). That causes tingling and lightheadedness, and it makes longer breath-holds possible."],
      ["The Wim Hof study", "In a 2014 study (Kox et al., PNAS), people trained in the Wim Hof method released more adrenaline and had fewer flu-like symptoms after being injected with a bacterial toxin. It was one of the first studies to show people can voluntarily influence their immune response."],
    ],
    even: [
      ["The eight kumbhakas", "The Hatha Yoga Pradipika lists eight breath retentions: Surya Bhedana, Ujjayi, Sitkari, Sitali, Bhastrika, Bhramari, Murccha, and Plavini. Kevala kumbhaka, the spontaneous pause when breathing stops on its own, is described as the goal."],
      ["Holotropic breathwork", "Stanislav and Christina Grof developed holotropic breathwork after LSD research was shut down: fast breathing with evocative music for hours to reach non-ordinary states. Participants often report experiences similar to psychedelic sessions."],
      ["Buteyko and breathing less", "The Buteyko method goes the other way, training you to breathe less and tolerate more CO₂. Studies show it can reduce asthma symptoms. Healthy breathing is flexible in both directions."],
    ],
    terms: [["Kumbhaka", "Breath retention"], ["Respiratory alkalosis", "Alkaline blood from over-breathing"], ["Bhastrika", "Bellows breath"], ["Holotropic", "'Moving toward wholeness': Grof's term"], ["CO₂ tolerance", "How comfortably you handle carbon dioxide buildup"]],
    practice: { title: "Nadi shodhana, 5 minutes", steps: ["Sit tall with your right thumb and ring finger ready at your nose.", "Inhale left for 4, exhale right for 4; inhale right for 4, exhale left for 4.", "Continue for 5 minutes. Once it's comfortable, add a 4-count hold after each inhale. Never do intense breathwork in water or while driving."] },
    sources: ["Kox et al. — 'Voluntary activation of the sympathetic nervous system and attenuation of the innate immune response in humans' (PNAS, 2014)", "Stanislav & Christina Grof — Holotropic Breathwork (2010)", "B.K.S. Iyengar — Light on Pranayama (1981)"],
  },
  "a-photon": {
    go: [
      ["How faint is it?", "Biophoton emission is roughly a thousand times too faint for the eye to see: a few to a few hundred photons per square centimeter per second. Measuring it takes a dark room and photomultiplier tubes or ultra-sensitive cameras."],
      ["Gurwitsch's mitogenetic rays", "In 1923 Russian scientist Alexander Gurwitsch reported that dividing onion-root cells could trigger cell division in a nearby root through quartz (which lets ultraviolet through) but not through glass. He called it mitogenetic radiation."],
      ["Popp's coherence idea", "Popp argued that biophotons are coherent, like laser light, that DNA may be a key source, and that together they form a communication network organizing the body."],
    ],
    even: [
      ["Photographing human light", "In 2009 Masaki Kobayashi and colleagues in Japan imaged light given off by the human body using a cooled CCD camera. The face glowed most, and emission rose and fell in a daily rhythm, peaking in the late afternoon."],
      ["What mainstream science says", "Ultra-weak photon emission is real and accepted. Most researchers think it comes mainly from oxidative reactions (free radicals exciting molecules), which makes it a marker of oxidative stress. Whether it carries information is the open question."],
      ["Light in the nerves?", "Some researchers have proposed that myelinated nerves could act like light guides for biophotons. It's a speculative idea being tested in the lab."],
    ],
    terms: [["Biophoton", "Light emitted by living cells"], ["Ultra-weak photon emission", "The research term for biophotons"], ["Photomultiplier", "A detector that can register single photons"], ["Coherence", "Light waves moving in step"], ["Oxidative stress", "Cell damage from free radicals"]],
    practice: { title: "Light-body visualization", steps: ["Close your eyes and picture a soft light in every cell.", "With each inhale, let the light brighten; with each exhale, let it spread outward.", "After 5 minutes, notice any change in body feeling, warmth, or mood."] },
    sources: ["Fritz-Albert Popp — 'Properties of biophotons and their theoretical implications' (Indian Journal of Experimental Biology, 2003)", "Kobayashi, Kikuchi & Okamura — 'Imaging of Ultraweak Spontaneous Photon Emission from Human Body Displaying Diurnal Rhythm' (PLoS ONE, 2009)", "Lynne McTaggart — The Field (2002), ch. 3"],
  },
  "a-cymatics": {
    go: [
      ["Chladni plates", "In 1787 Ernst Chladni bowed metal plates sprinkled with sand. The sand gathered on the nodal lines, the parts that don't move, forming geometric figures. Napoleon was so impressed he funded a prize to explain them."],
      ["Hans Jenny's films", "Jenny, a Swiss physician, used a crystal oscillator to drive plates and membranes at precise frequencies under sand, powders, pastes, and liquids. The patterns he filmed pulsed, rotated, and even seemed to crawl as if alive."],
      ["Faraday waves", "Vibrate a liquid from below and standing waves form at half the driving frequency, making hexagons, squares, and lattice patterns. Michael Faraday described them in 1831."],
    ],
    even: [
      ["Voice made visible", "Jenny's 'tonoscope' let people speak into a membrane covered in sand. He reported that chanting the Sanskrit OM formed a circle with a filled center, which he compared to sacred diagrams (yantras)."],
      ["The CymaScope", "John Stuart Reid's CymaScope photographs sound imprinted on water. Projects have visualized dolphin calls and heart sounds. Critics note the images depend heavily on the setup."],
      ["Acoustic levitation", "Standing sound waves can hold small objects in mid-air at their nodes, a technique labs use today. Some researchers speculate about sound in ancient construction, but there's no hard evidence it ever moved heavy stones."],
    ],
    terms: [["Nodal line", "Where a vibrating surface stays still"], ["Standing wave", "A wave pattern that stays in place"], ["Chladni figure", "A sand pattern on a vibrating plate"], ["Faraday wave", "A standing-wave pattern on vibrated liquid"], ["Tonoscope", "Jenny's device for making the voice visible"]],
    practice: { title: "Make your own cymatics", steps: ["Stretch plastic wrap tight over a bowl.", "Sprinkle salt or fine sand on it.", "Play a tone near it (a speaker works best) and slowly slide the pitch. Watch the salt jump into new patterns at certain notes."] },
    sources: ["Hans Jenny — Cymatics: A Study of Wave Phenomena and Vibration (1967/1974)", "Ernst Chladni — Entdeckungen über die Theorie des Klanges (1787)", "Michael Faraday — 'On a peculiar class of acoustical figures' (Philosophical Transactions, 1831)"],
  },
  "a-electric": {
    go: [
      ["Becker's discovery", "Becker found that when a salamander regrows a limb, the electrical current at the wound shifts polarity in a pattern that frogs, which can't regrow limbs, don't show. Applying small currents to frog stumps triggered partial regrowth."],
      ["The current of injury", "Every wound produces an electric field that guides cells to close it. Emil du Bois-Reymond measured it in the 1840s, and today it's used in electrical wound-healing devices."],
      ["Levin's bioelectric code", "Michael Levin's lab changed voltage patterns in flatworms and produced two-headed worms whose fragments kept regrowing two heads after being cut, without any change to their genes. Voltage patterns act like a map of body shape."],
    ],
    even: [
      ["Becker's warning", "Becker's second book, 'Cross Currents' (1990), warned about man-made electromagnetic fields. In 2011 the WHO's cancer agency (IARC) classified radiofrequency fields as 'possibly carcinogenic to humans' (Group 2B). Research continues, and conclusions are mixed."],
      ["PEMF", "Pulsed electromagnetic field devices were cleared by the FDA in 1979 for fractures that won't heal. Newer devices target pain and inflammation, and TMS (a stronger magnetic method) is FDA-cleared for depression."],
      ["The body as a circuit", "Bone is piezoelectric: squeezing it makes a voltage, which may be how bone knows where to grow stronger. Collagen is piezoelectric too."],
    ],
    terms: [["Current of injury", "The electric field at a wound"], ["Bioelectricity", "Electrical signaling in living tissue"], ["Piezoelectric", "Making voltage when squeezed"], ["PEMF", "Pulsed electromagnetic field therapy"], ["Morphogenesis", "How a body takes its shape"]],
    practice: { title: "Feel your bioelectric body", steps: ["Walk barefoot for 5 minutes, then rub your hands together and feel them tingle.", "Remember that every nerve cell holds a small voltage, about -70 millivolts.", "Reading assignment: chapter 1 of The Body Electric."] },
    sources: ["Robert O. Becker & Gary Selden — The Body Electric (1985)", "Durant et al. — 'Long-Term, Stochastic Editing of Regenerative Anatomy via Targeting Endogenous Bioelectric Gradients' (Biophysical Journal, 2017)", "IARC Monographs Vol. 102 — Non-Ionizing Radiation, Part 2: Radiofrequency Electromagnetic Fields (2013)"],
  },
  "a-shadow": {
    go: [
      ["The shadow", "Jung wrote that everyone carries a shadow, and the less it is lived consciously, the blacker and denser it becomes. What we deny in ourselves we tend to see in, and blame on, other people. This is projection."],
      ["Signs of shadow", "Strong reactions to certain people, patterns that repeat in relationships, and traits we insist we 'don't have' are classic clues. The shadow also holds hidden gifts: the 'golden shadow' of qualities we admire in others but haven't claimed."],
      ["The body keeps the score", "Bessel van der Kolk's 2014 book showed how trauma changes the body and brain, and how body-based therapies (yoga, EMDR, neurofeedback) often reach what talking alone can't."],
    ],
    even: [
      ["Somatic Experiencing", "Peter Levine noticed that wild animals shake after escaping a predator, discharging the stress. His Somatic Experiencing therapy helps people gently complete stuck stress responses. TRE (Tension & Trauma Releasing Exercises) uses deliberate tremoring."],
      ["Internal Family Systems", "Richard Schwartz's IFS sees the mind as made of parts (protectors and wounded 'exiles') around a calm core Self. In IFS, shadow work means befriending parts instead of fighting them."],
      ["Spiritual bypassing", "Psychologist John Welwood coined 'spiritual bypassing' in 1984: using spiritual ideas to avoid unresolved emotional wounds. Many long-time seekers find shadow work is where the real growth was hiding."],
    ],
    terms: [["Projection", "Seeing your own disowned traits in others"], ["Golden shadow", "Disowned positive qualities"], ["Somatic Experiencing", "Levine's body-based trauma therapy"], ["IFS", "Internal Family Systems therapy"], ["Spiritual bypassing", "Using spirituality to avoid emotional work"]],
    practice: { title: "The 3-2-1 shadow process (Ken Wilber)", steps: ["Pick someone who triggers you. Describe them in the third person: 'He is…'", "Talk to them in the second person: 'You are…', and let them answer back.", "Speak as them in the first person: 'I am…'. Notice which part of you that trait belongs to."] },
    sources: ["C. G. Jung — Aion (1951)", "Bessel van der Kolk — The Body Keeps the Score (2014)", "Peter Levine — Waking the Tiger (1997)"],
  },
  "a-hermetic": {
    go: [
      ["Hermes Trismegistus", "'Thrice-Great Hermes' blends the Greek god Hermes with the Egyptian Thoth. The Corpus Hermeticum, written in Greek in the first centuries AD, was translated into Latin by Marsilio Ficino in 1463 for Cosimo de' Medici and helped spark the Renaissance."],
      ["The seven principles", "Mentalism: the All is Mind. Correspondence: as above, so below. Vibration: everything moves. Polarity: opposites are the same thing in different degrees. Rhythm: everything swings. Cause and effect: nothing happens by chance. Gender: masculine and feminine in all things."],
      ["The Emerald Tablet", "A short, cryptic text known from Arabic sources around the 8th century. It holds the original 'that which is below is like that which is above' and became a foundation of alchemy. Isaac Newton made his own translation."],
    ],
    even: [
      ["Who wrote the Kybalion?", "The Kybalion was published anonymously in 1908 by 'Three Initiates'. It's widely attributed to William Walker Atkinson of the New Thought movement. It draws on Hermetic ideas, but it's a modern book, not an ancient one."],
      ["Dating the Hermetica", "In 1614 the scholar Isaac Casaubon showed that the Corpus Hermeticum was written in the early Christian era, not in ancient Egypt before Moses as Renaissance readers believed. Some scholars still see older Egyptian ideas woven through it."],
      ["Hermetic practice", "Hermeticism isn't only philosophy. The Hermetic Order of the Golden Dawn (founded 1888) built a system of ritual, Qabalah, astrology, and tarot on it, and shaped much of modern Western esotericism."],
    ],
    terms: [["Corpus Hermeticum", "The core collection of Hermetic texts"], ["Emerald Tablet", "The foundational alchemical text"], ["Mentalism", "The principle that reality is mental at root"], ["Polarity", "Opposites as two ends of one scale"], ["Alchemy", "The art of transformation, of matter and of self"]],
    practice: { title: "Polarity transmutation", steps: ["Notice a feeling you'd like to change, such as fear.", "Remember that polarity puts fear and courage on one line. Find the smallest step toward courage.", "Breathe into the feeling and move one degree along the line, not all the way. Practice daily."] },
    sources: ["Three Initiates — The Kybalion (1908)", "Brian Copenhaver (trans.) — Hermetica (1992)", "Frances Yates — Giordano Bruno and the Hermetic Tradition (1964)"],
  },
  // ───────── RABBIT HOLE ─────────
  "r-gateway": {
    go: [
      ["What Gateway is", "The Monroe Institute's Gateway Experience uses Hemi-Sync, binaural tones meant to bring the brain's two hemispheres into sync. It guides listeners through 'Focus' levels: Focus 10 (mind awake, body asleep), 12 (expanded awareness), 15 (no time), and 21 (the edge of other energy systems)."],
      ["McDonnell's model", "McDonnell explained Gateway with the frontier science of his day: the brain as a hologram (Karl Pribram), the universe as a hologram (David Bohm), and consciousness as energy that can move beyond time and space when its frequency rises high enough, toward what he called 'the Absolute'."],
      ["Why the Army cared", "The Army's intelligence command (INSCOM) sent personnel to the Monroe Institute in the late 1970s and early 80s to explore ways of sharpening intuition and remote viewing. The report was McDonnell's assessment for his commanders."],
    ],
    even: [
      ["Reading it critically", "The report is a sincere attempt to fit reported experiences into early-80s physics, and some of the science it leans on (like the holographic brain) has since moved on. Its value is as a primary record of what the military took seriously, and why."],
      ["Robert Monroe", "Radio executive Robert Monroe began having out-of-body experiences in 1958 and described them in 'Journeys Out of the Body' (1971). He founded the Monroe Institute in Virginia to research and teach these states."],
      ["Try it responsibly", "The Gateway recordings are sold commercially, and many people report vivid experiences. Some report anxiety or disrupted sleep. Go slowly, keep a journal, and stay grounded in daily life."],
    ],
    terms: [["Hemi-Sync", "Monroe's binaural-tone technology"], ["Focus 10", "'Mind awake, body asleep'"], ["Holographic model", "The idea that each part contains information about the whole"], ["INSCOM", "U.S. Army Intelligence and Security Command"], ["OBE", "Out-of-body experience"]],
    practice: { title: "Read the source", steps: ["Search 'Analysis and Assessment of Gateway Process' in the CIA Reading Room (cia.gov/readingroom).", "Read the first ten pages and note the model McDonnell uses.", "Try one Focus 10 session, then journal how the experience compared with his description."] },
    sources: ["Wayne M. McDonnell — Analysis and Assessment of Gateway Process (U.S. Army, 1983; CIA Reading Room)", "Robert Monroe — Journeys Out of the Body (1971)", "Michael Talbot — The Holographic Universe (1991)"],
  },
  "r-stargate": {
    go: [
      ["Coordinate remote viewing", "Ingo Swann developed a structured method at SRI: the viewer gets only a random coordinate or number and records impressions in stages, from basic shapes to details. It was designed to keep imagination from filling in the blanks."],
      ["Famous cases", "Pat Price's 1974 sketches of a Soviet site at Semipalatinsk included a giant gantry crane that matched later satellite images. Joseph McMoneagle, 'Remote Viewer No. 1', described a huge Soviet submarine under construction months before it was seen."],
      ["How it ended", "In 1995 the CIA had the American Institutes for Research review the program. Statistician Jessica Utts concluded the effect was real; psychologist Ray Hyman agreed the results weren't pure chance but said flaws hadn't been ruled out. The review judged it not useful for intelligence, and the program closed."],
    ],
    even: [
      ["The files", "Stargate session transcripts, budgets, and evaluations are among the declassified records in the CIA's CREST database, now searchable online."],
      ["Remote viewing today", "Former military viewers like McMoneagle, Lyn Buchanan, and Paul H. Smith went on to teach publicly. 'Associative remote viewing' has been tried for predicting markets and sports outcomes, with mixed and debated results."],
      ["Why it's still debated", "Parapsychology's effects are small, and critics point to publication bias and loose protocols. Supporters note that the same statistics would be accepted in other fields. Both sides agree that better replication is the answer."],
    ],
    terms: [["CRV", "Coordinate remote viewing"], ["Target coordinate", "A random number standing in for the target"], ["ARV", "Associative remote viewing"], ["CREST", "The CIA's declassified records search tool"], ["Meta-analysis", "Pooling many studies to find the overall effect"]],
    practice: { title: "Try a simple session", steps: ["Have a friend seal a photo in an envelope and write a random number on it.", "Relax for 5 minutes, then sketch and write your first impressions: shapes, colors, textures, feelings.", "Open it and score honestly. Do 10 sessions and keep records."] },
    sources: ["Jessica Utts — 'An Assessment of the Evidence for Psychic Functioning' (1995)", "Russell Targ & Harold Puthoff — Mind-Reach (1977)", "Annie Jacobsen — Phenomena (2017)"],
  },
  "r-morphic": {
    go: [
      ["The hypothesis", "Sheldrake suggests every species has a morphic field, a kind of collective memory that shapes its form and behavior. Members tune into it by resonating with similar past members, so nature's habits strengthen over time."],
      ["Evidence he cites", "In William McDougall's Harvard experiments (1920s–50s), rats learned a water maze faster over generations, including rats with no trained ancestors, and later labs in Scotland and Australia saw faster learning from the start. Sheldrake reads this as morphic resonance."],
      ["The sense of being stared at", "Sheldrake has run thousands of trials on whether people can tell when they're being stared at from behind, and on dogs that seem to know when their owners are heading home (famously, a terrier named Jaytee)."],
    ],
    even: [
      ["The criticism", "In 1981 Nature's editor John Maddox wrote that Sheldrake's book was 'the best candidate for burning there has been for many years'. Skeptics say his experiments have weak controls, and Richard Wiseman's test of Jaytee found no effect."],
      ["The TED episode", "In 2013 TED removed Sheldrake's TEDx talk 'The Science Delusion' from the TEDx YouTube channel and reposted it on its blog with a warning. The controversy drew far more attention to the talk."],
      ["Why it matters", "If morphic resonance were real, memory wouldn't only be stored in the brain, and learning anywhere would help learning everywhere. It's one of the boldest testable ideas in fringe science."],
    ],
    terms: [["Morphic field", "A proposed field of form and memory"], ["Morphic resonance", "Influence of past forms on present ones"], ["Formative causation", "Sheldrake's broader theory"], ["Habits of nature", "Patterns that strengthen by repetition"], ["Replication", "Repeating a study to check the result"]],
    practice: { title: "Run his staring experiment", steps: ["Pair up. One person sits facing away; the other either stares or looks away, chosen by coin flip, for 20 trials.", "The sitter guesses 'staring' or 'not staring' each time.", "Record the hit rate. 50% is chance. Run more rounds and share your results."] },
    sources: ["Rupert Sheldrake — A New Science of Life (1981)", "Rupert Sheldrake — The Presence of the Past (1988)", "Wiseman, Smith & Milton — 'Can animals detect when their owners are returning home?' (British Journal of Psychology, 1998)"],
  },
  "r-mind": {
    go: [
      ["PEAR's results", "Over 28 years, PEAR ran millions of trials in which volunteers tried to push random event generators higher or lower. They reported a tiny but statistically strong effect, on the order of one extra 'hit' per 10,000."],
      ["The Global Consciousness Project", "Roger Nelson launched the GCP in 1998. Dozens of random number generators around the world send data continuously, and the project reports that major events, like 9/11 and New Year's midnight, coincide with non-random patterns."],
      ["Radin's experiments", "Dean Radin at the Institute of Noetic Sciences has run 'presentiment' studies, in which the body seems to react a few seconds before a random emotional image appears, and double-slit experiments in which meditators try to affect a light pattern."],
    ],
    even: [
      ["Replication", "A multi-lab replication of PEAR's main experiment (with labs in Giessen and Freiburg, Germany), published in 2000, didn't reproduce the main effect. Supporters say the effect varies with operators and conditions; critics say that makes it untestable."],
      ["The ganzfeld battleground", "Meta-analyses of ganzfeld telepathy experiments report hit rates around 32% where 25% is chance. Critics like Richard Wiseman and Ray Hyman dispute the study selection and methods. It's the best-studied battleground in parapsychology."],
      ["Why physicists care", "Some interpretations of quantum mechanics give the observer a special role. Most physicists think measuring devices, not minds, settle quantum outcomes. Radin's double-slit work is an attempt to test that difference directly."],
    ],
    terms: [["REG", "Random event generator"], ["Ganzfeld", "A mild sensory-isolation setup for telepathy tests"], ["Presentiment", "A body response before a random event"], ["Effect size", "How big an effect is, not just whether it exists"], ["File-drawer problem", "Unpublished null results that skew the record"]],
    practice: { title: "Ganzfeld at home", steps: ["The receiver lies down with halved ping-pong balls over the eyes, a soft red light, and white noise in headphones.", "In another room, a sender focuses on one of four randomly chosen images for 20 minutes.", "The receiver describes impressions aloud, then picks from the four images. 25% is chance; track many sessions."] },
    sources: ["Robert Jahn & Brenda Dunne — Margins of Reality (1987)", "Dean Radin — Entangled Minds (2006)", "Storm, Tressoldi & Di Risio — 'Meta-analysis of free-response studies, 1992–2008' (Psychological Bulletin, 2010)"],
  },
  "r-tesla": {
    go: [
      ["Colorado Springs, 1899", "Tesla built a huge magnifying transmitter in Colorado Springs, produced artificial lightning more than 100 feet long, and recorded rhythmic signals he thought might come from another planet. They were probably natural radio or other transmissions."],
      ["The world wireless system", "J. P. Morgan put $150,000 into Wardenclyffe. Tesla planned to use the Earth itself as a conductor to send power and messages worldwide. Morgan stopped funding, the project stalled, and the tower was demolished in 1917."],
      ["His papers", "When Tesla died at the Hotel New Yorker in January 1943, the Office of Alien Property took his belongings. MIT engineer John G. Trump reviewed them and reported nothing of danger. Most of the papers later went to the Nikola Tesla Museum in Belgrade."],
    ],
    even: [
      ["Scalar waves", "In physics, a 'scalar' has size but no direction. Tesla wrote of 'longitudinal' waves traveling through the Earth, and Thomas Bearden later claimed 'scalar electromagnetics' could tap vacuum energy. Mainstream physics accepts neither, and no device has been independently verified."],
      ["Zero-point energy", "Quantum vacuum energy is real: the Casimir effect shows the vacuum can exert force. Whether usable power can be drawn from it is disputed; most physicists say no, because it's the lowest possible energy state."],
      ["The patents", "Tesla held around 300 patents worldwide. U.S. Patent 645,576 ('System of Transmission of Electrical Energy', 1900) and 787,412 ('Art of Transmitting Electrical Energy Through the Natural Mediums', 1905) lay out his wireless power plan."],
    ],
    terms: [["Magnifying transmitter", "Tesla's giant resonant transformer"], ["Longitudinal wave", "A wave that vibrates along its direction of travel"], ["Scalar", "A quantity with size but no direction"], ["Casimir effect", "A measurable force from the quantum vacuum"], ["Zero-point energy", "The vacuum's baseline energy"]],
    practice: { title: "Read Tesla in his own words", steps: ["Read Tesla's essay 'The Problem of Increasing Human Energy' (Century Magazine, 1900).", "Then read U.S. Patent 787,412 on Google Patents.", "Write down one claim you could test and one you couldn't."] },
    sources: ["Nikola Tesla — 'The Problem of Increasing Human Energy' (Century Magazine, 1900)", "Nikola Tesla — Colorado Springs Notes 1899–1900 (published 1978)", "FBI Records: The Vault — Nikola Tesla (vault.fbi.gov)"],
  },
  "r-rife": {
    go: [
      ["The Universal Microscope", "Rife claimed his prism-based microscope reached around 60,000x magnification and let him see living viruses, decades before electron microscopes. No surviving instrument has been shown to reach that resolution."],
      ["Mortal oscillatory rate", "Rife believed each microbe would shatter when exposed to its own resonant frequency, like a glass breaking at a singer's note, delivered through a gas-filled plasma tube. He recorded frequencies for many organisms."],
      ["The 1934 clinic", "According to later accounts, Dr. Milbank Johnson supervised a 1934 trial in La Jolla in which 16 terminally ill cancer patients were treated and reported cured. No original medical records have surfaced to confirm it."],
    ],
    even: [
      ["Where the story comes from", "Much of what's known comes from Barry Lynes' 1987 book 'The Cancer Cure That Worked!', which frames Rife as suppressed by the medical establishment. Historians find the core documents thin, which keeps the story contested."],
      ["Modern frequency devices", "Today's devices (Rife machines, Spooky2, GB-4000) apply audio and radio frequencies through pads or plasma tubes. There are no large controlled trials for cancer, and U.S. regulators have prosecuted sellers who made cure claims. Never swap proven treatment for a device."],
      ["Frequency that is proven", "Tumor Treating Fields (Optune), FDA-approved in 2011 for glioblastoma, use alternating electric fields at 100–300 kHz to disrupt dividing cancer cells. It isn't Rife's method, but it shows frequency can target cells."],
    ],
    terms: [["MOR", "Mortal oscillatory rate: Rife's kill frequency"], ["Plasma tube", "A gas-filled tube used to emit frequencies"], ["Resonance", "Vibrating in response to a matching frequency"], ["Tumor Treating Fields", "An approved cancer therapy using alternating electric fields"], ["Controlled trial", "A study that compares treatment against a control group"]],
    practice: { title: "Research it like a detective", steps: ["Read Lynes' book or a detailed summary.", "List every claim and mark each one: primary document, secondhand account, or unknown.", "Look up Tumor Treating Fields and compare the quality of evidence."] },
    sources: ["Barry Lynes — The Cancer Cure That Worked! (1987)", "Stupp et al. — 'NovoTTF-100A versus physician's choice chemotherapy in recurrent glioblastoma' (European Journal of Cancer, 2012)", "Christopher Bird — 'What Has Become of the Rife Microscope?' (New Age Journal, 1976)"],
  },
  "r-russell": {
    go: [
      ["Walter Russell", "Painter, sculptor, architect, and self-taught scientist, Russell said a 39-day 'illumination' in 1921 gave him his cosmology. With his wife Lao he founded the University of Science and Philosophy at Swannanoa, Virginia."],
      ["Russell's cosmology", "He described the universe as a two-way exchange: light compressing into matter (generation) and expanding back into stillness (radiation), in endless wave cycles. His spiral chart of the elements predicted elements not yet discovered."],
      ["Schauberger's water", "Austrian forester Viktor Schauberger watched trout hold perfectly still in fast streams and saw logs float best in cold, moonlit water. He built log flumes that moved timber on spiraling water and argued that rivers must meander to stay alive."],
    ],
    even: [
      ["Implosion vs. explosion", "Schauberger said modern technology runs on explosion (heat and combustion) while nature runs on implosion (cooling, inward spirals). He designed 'repulsine' and trout-turbine machines. Claims that they flew or produced free energy aren't documented."],
      ["The war years and the end", "Schauberger was reportedly forced to work on projects for the Third Reich late in the war, which fueled legends. In 1958 he was brought to the U.S. for a development deal that soured, and he died in Austria days after returning home."],
      ["Legacy", "Russell's ideas influenced New Thought teachers, and Schauberger's inspired Callum Coats' books, vortex-water devices, and biomimicry engineers. Both are examples of intuition-first science."],
    ],
    terms: [["Implosion", "An inward, cooling, spiraling motion"], ["Vortex", "A spinning, spiraling flow"], ["Meander", "The natural winding of a river"], ["Generation / radiation", "Russell's two halves of the cosmic cycle"], ["Biomimicry", "Design that copies nature"]],
    practice: { title: "Watch water teach", steps: ["Stir water in a clear jar to make a vortex and watch how it pulls inward.", "Visit a river or creek and notice where it meanders and pools.", "Sketch what you see and compare it with Schauberger's drawings."] },
    sources: ["Walter Russell — The Universal One (1926)", "Walter & Lao Russell — Atomic Suicide? (1957)", "Callum Coats — Living Energies (1996)"],
  },
  "r-channel": {
    go: [
      ["The Ra Material", "Carla Rueckert, a librarian, spoke in trance while Don Elkins, a physics professor and airline pilot, asked the questions and Jim McCarty kept the sessions running. 'Ra' called itself a 'social memory complex' and taught the Law of One: all is one Creator experiencing itself."],
      ["The densities", "Ra describes seven densities, with an eighth beginning a new octave: 1st, the elements; 2nd, plants and animals; 3rd, self-aware beings choosing a polarity; 4th, love and understanding; 5th, wisdom; 6th, unity of love and wisdom; 7th, the gateway back to the Creator."],
      ["Seth", "Jane Roberts channeled 'Seth' from 1963 until her death in 1984, with her husband Robert Butts taking notes. The core teaching, 'you create your own reality' through beliefs and focus, shaped much of the later New Age movement."],
    ],
    even: [
      ["Comparing sources", "Ra, Seth, and Bashar all describe consciousness as primary and physical reality as a projection of belief. They differ on details like time, reincarnation, and polarity. Where independent sources agree, many researchers see a signal worth studying."],
      ["Discernment is built in", "Ra itself urged readers to take only what resonates and leave the rest. The Cassiopaean transcripts of Laura Knight-Jadczyk go further and question the source constantly. Serious channeled traditions all stress discernment."],
      ["A very old practice", "Earlier examples include the Oracle of Delphi, Edgar Cayce's roughly 14,000 recorded trance readings (1901–1945), and Helen Schucman's 'A Course in Miracles' (1976). Channeling is one of humanity's oldest spiritual technologies."],
    ],
    terms: [["Social memory complex", "A group consciousness, in Ra's terms"], ["Density", "A level of consciousness in the Law of One"], ["Harvest", "Ra's term for graduation between densities"], ["Service-to-others", "The positive polarity in the Law of One"], ["Discernment", "Testing teachings instead of accepting them whole"]],
    practice: { title: "Side-by-side study", steps: ["Pick one question, such as 'what happens after death?'", "Find what Ra, Seth, and Edgar Cayce say about it.", "Make a three-column table and circle where they agree."] },
    sources: ["L/L Research — The Law of One, Books I–V (free to read at lawofone.info)", "Jane Roberts — Seth Speaks (1972)", "Edgar Cayce Readings — Association for Research and Enlightenment (edgarcayce.org)"],
  },
};

const SECTION_NAMES = { energy: "Energy 101", biofield: "Bio Field", emotions: "E-Motions", practice: "Meditation Zone", numbers: "Power of Numbers", healthsimple: "Health Simplified", healing: "Healing", hacks: "Reality Hacks", wakeup: "Wake Up", knowledge: "Knowledge Portal" };

// Layered reading view: layer 1 = "Go Deeper", layer 2 = "Even Deeper"
function DeepReader({ unit, layer, hideTitle = false }) {
  const d = DEEP_LESSONS[unit.id] || NEW_DEEP_LESSONS[unit.id];
  if (!d) return <p style={{ fontSize: 17, color: "var(--text-muted)" }}>The deep dive for this lesson is coming soon.</p>;
  const sections = layer === 1 ? d.go : d.even;
  const Label = ({ children }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "30px 0 12px" }}>
      <span className="kid-label">{children}</span>
      <span style={{ flex: 1, height: 1, background: "var(--glass-border)" }} />
    </div>
  );
  return (
    <div style={{ padding: "4px 0 24px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14, marginTop: hideTitle ? 26 : 0 }}>
        <span className="kid-label" style={{ color: unit.color }}>{layer === 1 ? "Layer 02 · Go deeper" : "Layer 03 · Even deeper"}</span>
        <div style={{ display: "flex", gap: 4 }}>
          {[1, 2, 3].map(n => <span key={n} style={{ width: 20, height: 3, borderRadius: 2, background: n <= layer + 1 ? unit.color : "var(--glass-border)" }} />)}
        </div>
      </div>
      {!hideTitle && (
        <h2 style={{ fontSize: "clamp(28px, 6vw, 40px)", fontWeight: 600, lineHeight: 1.08, letterSpacing: "-0.03em", fontFamily: KID_FONT }}>
          {unit.title}
        </h2>
      )}

      {sections.map(([h, p], i) => (
        <div key={h} className="kid-glass" style={{
          marginTop: 14, padding: "18px 20px", borderRadius: 20, position: "relative", overflow: "hidden",
          animation: `kidSlideIn 0.55s cubic-bezier(0.22,1,0.36,1) ${i * 0.08}s both`,
        }}>
          <span style={{ position: "absolute", top: 0, left: 20, right: 20, height: 1, background: `linear-gradient(90deg, transparent, ${unit.color}, transparent)` }} />
          <div style={{ display: "flex", gap: 12, alignItems: "baseline", marginBottom: 6 }}>
            <span className="kid-num" style={{ fontSize: 12, color: unit.color, fontWeight: 600 }}>{String(i + 1).padStart(2, "0")}</span>
            <span style={{ fontSize: 18, fontWeight: 600, letterSpacing: "-0.01em" }}>{h}</span>
          </div>
          <p style={{ fontSize: 16.5, lineHeight: 1.65, color: "var(--text)", opacity: 0.88, margin: 0 }}>{p}</p>
        </div>
      ))}

      {layer === 1 && d.practice && (
        <>
          <Label>Try it · {d.practice.title}</Label>
          <div style={{ padding: "8px 20px", borderRadius: 20, background: `linear-gradient(135deg, ${unit.color}1f, transparent 70%)`, border: `1px solid ${unit.color}40` }}>
            {d.practice.steps.map((st, i) => (
              <div key={i} style={{ display: "flex", gap: 14, alignItems: "flex-start", padding: "12px 0", borderBottom: i < d.practice.steps.length - 1 ? "1px solid var(--glass-border)" : "none" }}>
                <span className="kid-num" style={{ flexShrink: 0, width: 26, height: 26, borderRadius: 999, border: `1px solid ${unit.color}`, color: unit.color, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12 }}>{i + 1}</span>
                <span style={{ fontSize: 16, lineHeight: 1.55 }}>{st}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {layer === 2 && (
        <>
          <Label>Key terms</Label>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: 8 }}>
            {d.terms.map(([t, def]) => (
              <div key={t} className="kid-glass" style={{ padding: "12px 14px", borderRadius: 16 }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: unit.color }}>{t}</div>
                <div style={{ fontSize: 14, color: "var(--text-muted)", lineHeight: 1.45, marginTop: 3 }}>{def}</div>
              </div>
            ))}
          </div>
          <Label>Read the sources</Label>
          <div className="kid-glass" style={{ padding: "4px 18px", borderRadius: 20 }}>
            {d.sources.map((src, i) => (
              <div key={i} style={{ display: "flex", gap: 14, padding: "13px 0", borderBottom: i < d.sources.length - 1 ? "1px solid var(--glass-border)" : "none" }}>
                <span className="kid-num" style={{ fontSize: 12, color: unit.color, fontWeight: 600, paddingTop: 2 }}>{String(i + 1).padStart(2, "0")}</span>
                <span style={{ fontSize: 15, lineHeight: 1.5 }}>{src}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Experience engine helpers ───
const getDeep = id => DEEP_LESSONS[id] || NEW_DEEP_LESSONS[id] || null;
const wordCount = t => (t || "").split(/\s+/).filter(Boolean).length;

// Words drift in one by one (kinetic typography)
function KineticText({ text, step = 0.035, style = {}, as = "p" }) {
  const words = (text || "").split(" ");
  const Tag = as;
  return (
    <Tag style={style}>
      {words.map((w, i) => (
        <span key={i} style={{ display: "inline-block", whiteSpace: "pre", animation: `kidWord 0.7s cubic-bezier(0.22,1,0.36,1) ${i * step}s both` }}>
          {w}{i < words.length - 1 ? " " : ""}
        </span>
      ))}
    </Tag>
  );
}

// Timer that drives auto-advance; returns 0..1 progress for the current scene
function useSceneTimer(duration, running, onEnd, key) {
  const [elapsed, setElapsed] = useState(0);
  const elRef = useRef(0);
  const endRef = useRef(onEnd);
  endRef.current = onEnd;
  useEffect(() => { elRef.current = 0; setElapsed(0); }, [key]);
  useEffect(() => {
    if (!running || !duration) return;
    let last = performance.now(), raf, fired = false;
    const tick = now => {
      elRef.current += now - last; last = now;
      setElapsed(elRef.current);
      if (elRef.current >= duration) { if (!fired) { fired = true; endRef.current(); } return; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [running, duration, key]);
  return duration ? Math.min(1, elapsed / duration) : 0;
}

// Full-screen animated lesson: auto-playing scenes → quick check → two deeper layers.
// Every scene can be paused, tapped through, or skipped straight to the Library.
function LessonPlayer({ unit, level = "beginner", onClose, onComplete, onDeeper, onLibrary, playlist = false, onNextLesson }) {
  const L = LEVELS[level] || LEVELS.beginner;
  const d = getDeep(unit.id);
  const sectionName = SECTION_NAMES[unit.deep] || "full section";
  const [stage, setStage] = useState("lesson"); // lesson | deep1 | deep2
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const [readMode, setReadMode] = useState(false);
  const [picked, setPicked] = useState(null);
  const [autoNext, setAutoNext] = useState(playlist);
  const bodyRef = useRef(null);
  const order = useMemo(() => unit.quiz.options.map((_, i) => i).sort(() => Math.random() - 0.5), [unit]);
  const kinds = unit.cards.map(c => c.kind);

  const scenes = useMemo(() => {
    if (stage === "lesson") return [...unit.cards.map(c => ({ type: "card", card: c })), { type: "quiz" }, { type: "done" }];
    if (!d) return [{ type: "end2" }];
    const secs = stage === "deep1" ? d.go : d.even;
    const list = secs.map(([h, p], i) => ({ type: "section", h, p, kind: kinds[(i + 1) % kinds.length] }));
    if (stage === "deep1" && d.practice) list.push({ type: "practice" });
    if (stage === "deep2") list.push({ type: "reference" });
    list.push({ type: stage === "deep1" ? "end1" : "end2" });
    return list;
  }, [stage, unit]);

  const scene = scenes[Math.min(idx, scenes.length - 1)];
  const correct = picked === unit.quiz.answer;
  const duration =
    scene.type === "card" ? Math.min(15000, 3200 + wordCount(scene.card.text) * 330) :
    scene.type === "section" ? Math.min(26000, 4500 + wordCount(scene.p) * 300) :
    scene.type === "practice" ? 7000 + wordCount(d.practice.steps.join(" ")) * 260 :
    scene.type === "done" && autoNext && onNextLesson ? 7000 :
    null;
  const timed = !!duration && !(readMode && stage !== "lesson");

  const go = (n) => { setIdx(Math.max(0, Math.min(scenes.length - 1, n))); if (bodyRef.current) bodyRef.current.scrollTop = 0; };
  const next = () => {
    if (scene.type === "done" && autoNext && onNextLesson) { onNextLesson(); return; }
    go(idx + 1);
  };
  const prev = () => go(idx - 1);
  const enterStage = s => { setStage(s); setIdx(0); setPaused(false); if (bodyRef.current) bodyRef.current.scrollTop = 0; };
  const progress = useSceneTimer(duration, timed && !paused, next, `${stage}-${idx}-${readMode}`);

  // Keyboard: → next, ← back, space pause
  useEffect(() => {
    const onKey = e => {
      if (e.target && /input|textarea/i.test(e.target.tagName)) return;
      if (e.key === "ArrowRight" && (scene.type === "card" || scene.type === "section" || scene.type === "practice")) next();
      else if (e.key === "ArrowLeft") prev();
      else if (e.key === " ") { e.preventDefault(); setPaused(p => !p); }
      else if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const tapThrough = scene.type === "card" || scene.type === "section" || scene.type === "practice";
  const onBodyTap = e => {
    if (!tapThrough || (readMode && stage !== "lesson")) return;
    const r = e.currentTarget.getBoundingClientRect();
    if (e.clientX - r.left < r.width * 0.3) prev(); else next();
  };
  const textSize = level === "beginner" ? "clamp(22px, 5.2vw, 30px)" : "clamp(19px, 4.4vw, 26px)";
  const stageLabel = stage === "lesson" ? `${L.numeral} · ${L.title}` : stage === "deep1" ? "Layer 02 · Go deeper" : "Layer 03 · Even deeper";

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 80, display: "flex", flexDirection: "column", overflow: "hidden",
      background: "var(--kid-sheet)", fontFamily: KID_FONT, color: "var(--text)",
      animation: "kidSlideIn 0.4s cubic-bezier(0.22,1,0.36,1)",
    }}>
      {/* Aurora backdrop */}
      <div aria-hidden className="kid-motion" style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden" }}>
        <div style={{ position: "absolute", width: "70vmax", height: "70vmax", left: "-25vmax", top: "-30vmax", borderRadius: "50%", background: `radial-gradient(circle, ${unit.color}40, transparent 60%)`, filter: "blur(40px)", animation: "kidAurora 18s ease-in-out infinite" }} />
        <div style={{ position: "absolute", width: "60vmax", height: "60vmax", right: "-25vmax", bottom: "-30vmax", borderRadius: "50%", background: "radial-gradient(circle, rgba(139,92,246,0.3), transparent 60%)", filter: "blur(40px)", animation: "kidAurora 22s ease-in-out infinite reverse" }} />
      </div>

      {/* Top bar: close · story segments · pause · skip */}
      <div style={{ position: "relative", maxWidth: 760, width: "100%", margin: "0 auto", padding: "16px 20px 6px" }}>
        <div style={{ display: "flex", gap: 4, marginBottom: 12 }}>
          {scenes.map((s, i) => (
            <div key={i} style={{ flex: 1, height: 3, borderRadius: 3, background: "var(--glass-border)", overflow: "hidden" }}>
              <div style={{ height: "100%", borderRadius: 3, background: `linear-gradient(90deg, ${unit.color}, #a78bfa)`, width: i < idx ? "100%" : i === idx ? (timed ? `${progress * 100}%` : "100%") : "0%" }} />
            </div>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={onClose} aria-label="Close lesson" className="kid-glass" style={{ width: 36, height: 36, borderRadius: 999, fontSize: 15, color: "var(--text)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>✕</button>
          <div style={{ flex: 1 }} />
          {stage !== "lesson" && (
            <button onClick={() => setReadMode(r => !r)} className="kid-glass" title="Switch between watching and reading" style={{ padding: "8px 12px", borderRadius: 999, cursor: "pointer", fontFamily: KID_FONT, fontSize: 12.5, fontWeight: 600, color: "var(--text)", flexShrink: 0 }}>
              {readMode ? "▶ Watch" : "≡ Read"}
            </button>
          )}
          {timed && (
            <button onClick={() => setPaused(p => !p)} aria-label={paused ? "Play" : "Pause"} className="kid-glass" style={{ width: 36, height: 36, borderRadius: 999, cursor: "pointer", fontSize: 13, color: "var(--text)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              {paused ? "▶" : "❚❚"}
            </button>
          )}
          {stage === "lesson" && (
            <button onClick={() => enterStage("deep1")} className="kid-glass" title="Skip ahead to the deep dive" style={{ padding: "8px 12px", borderRadius: 999, cursor: "pointer", fontFamily: KID_FONT, fontSize: 12.5, fontWeight: 600, color: "var(--text)", flexShrink: 0 }}>Deep dive ↓</button>
          )}
          {onLibrary && (
            <button onClick={() => onLibrary(unit)} className="kid-glass" title="Skip to the library" style={{ padding: "8px 12px", borderRadius: 999, cursor: "pointer", fontFamily: KID_FONT, fontSize: 12.5, fontWeight: 600, color: "var(--text)", flexShrink: 0 }}>Library ↗</button>
          )}
        </div>
        <div style={{ marginTop: 12, minWidth: 0 }}>
          <div className="kid-label" style={{ color: unit.color, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{stageLabel}</div>
          <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-0.01em", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{unit.title}</div>
        </div>
      </div>

      {/* Body */}
      <div ref={bodyRef} key={`${stage}-${idx}-${readMode}`} onClick={onBodyTap} style={{
        position: "relative", flex: 1, overflowY: "auto", display: "flex", flexDirection: "column",
        justifyContent: readMode && stage !== "lesson" ? "flex-start" : "safe center",
        padding: "10px 24px", maxWidth: 720, width: "100%", margin: "0 auto",
        cursor: tapThrough && !(readMode && stage !== "lesson") ? "pointer" : "default",
        animation: "kidSlideIn 0.5s cubic-bezier(0.22,1,0.36,1)",
      }}>
        {readMode && stage !== "lesson" ? (
          <DeepReader unit={unit} layer={stage === "deep1" ? 1 : 2} />
        ) : (
          <>
            {scene.type === "card" && (
              <div style={{ maxWidth: 580, margin: "0 auto", width: "100%" }}>
                <LessonVisual kind={scene.card.kind} color={unit.color} />
                <div style={{ textAlign: "center", marginTop: 22 }}>
                  <span className="kid-label" style={{ color: L.color }}>{idx + 1} / {unit.cards.length}</span>
                </div>
                <KineticText text={scene.card.text} style={{ fontSize: textSize, lineHeight: 1.4, textAlign: "center", marginTop: 12, fontWeight: 500, letterSpacing: "-0.02em" }} />
              </div>
            )}

            {scene.type === "section" && (
              <div style={{ maxWidth: 640, margin: "0 auto", width: "100%" }}>
                <LessonVisual kind={scene.kind} color={unit.color} size={190} />
                <div style={{ marginTop: 14 }}>
                  <span className="kid-label" style={{ color: unit.color }}>{String(idx + 1).padStart(2, "0")} — {stage === "deep1" ? "Go deeper" : "Even deeper"}</span>
                </div>
                <KineticText as="h2" text={scene.h} step={0.06} style={{ fontSize: "clamp(26px, 6vw, 38px)", fontWeight: 600, letterSpacing: "-0.03em", lineHeight: 1.1, marginTop: 8 }} />
                <KineticText text={scene.p} step={0.028} style={{ fontSize: "clamp(17px, 3.9vw, 20px)", lineHeight: 1.6, marginTop: 14, opacity: 0.9 }} />
              </div>
            )}

            {scene.type === "practice" && (
              <div style={{ maxWidth: 640, margin: "0 auto", width: "100%" }}>
                <span className="kid-label" style={{ color: unit.color }}>Try it now</span>
                <KineticText as="h2" text={d.practice.title} step={0.06} style={{ fontSize: "clamp(26px, 6vw, 38px)", fontWeight: 600, letterSpacing: "-0.03em", lineHeight: 1.1, marginTop: 8, marginBottom: 18 }} />
                {d.practice.steps.map((st, i) => (
                  <div key={i} className="kid-glass" style={{ display: "flex", gap: 14, alignItems: "flex-start", padding: "16px 18px", borderRadius: 20, marginBottom: 10, animation: `kidSlideIn 0.7s cubic-bezier(0.22,1,0.36,1) ${0.6 + i * 1.6}s both` }}>
                    <span className="kid-num" style={{ flexShrink: 0, width: 30, height: 30, borderRadius: 999, background: unit.color, color: "white", fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13 }}>{i + 1}</span>
                    <span style={{ fontSize: 17, lineHeight: 1.55 }}>{st}</span>
                  </div>
                ))}
              </div>
            )}

            {scene.type === "reference" && (
              <div style={{ maxWidth: 680, margin: "0 auto", width: "100%" }}>
                <span className="kid-label" style={{ color: unit.color }}>Key terms</span>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 8, margin: "12px 0 24px" }}>
                  {d.terms.map(([t, def], i) => (
                    <div key={t} className="kid-glass" style={{ padding: "12px 14px", borderRadius: 16, animation: `kidSlideIn 0.5s ease ${i * 0.08}s both` }}>
                      <div style={{ fontSize: 15, fontWeight: 600, color: unit.color }}>{t}</div>
                      <div style={{ fontSize: 14, color: "var(--text-muted)", lineHeight: 1.45, marginTop: 3 }}>{def}</div>
                    </div>
                  ))}
                </div>
                <span className="kid-label" style={{ color: unit.color }}>Read the sources</span>
                <div className="kid-glass" style={{ padding: "4px 18px", borderRadius: 20, marginTop: 12 }}>
                  {d.sources.map((src, i) => (
                    <div key={i} style={{ display: "flex", gap: 14, padding: "13px 0", borderBottom: i < d.sources.length - 1 ? "1px solid var(--glass-border)" : "none", animation: `kidSlideIn 0.5s ease ${0.4 + i * 0.1}s both` }}>
                      <span className="kid-num" style={{ fontSize: 12, color: unit.color, fontWeight: 600, paddingTop: 2 }}>{String(i + 1).padStart(2, "0")}</span>
                      <span style={{ fontSize: 15, lineHeight: 1.5 }}>{src}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {scene.type === "quiz" && (
              <div style={{ maxWidth: 580, margin: "0 auto", width: "100%" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 22 }}>
                  <SparkMascot size={44} color={unit.color} />
                  <span className="kid-label" style={{ color: unit.color }}>Quick check</span>
                </div>
                <KineticText text={unit.quiz.q} step={0.05} style={{ fontSize: "clamp(24px, 5.4vw, 32px)", fontWeight: 600, lineHeight: 1.2, letterSpacing: "-0.025em", marginBottom: 24 }} />
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {order.map((i, k) => {
                    const opt = unit.quiz.options[i];
                    const isPick = picked === i;
                    const showRight = picked !== null && i === unit.quiz.answer;
                    const showWrong = isPick && !correct;
                    const tint = showRight ? "#22c55e" : showWrong ? "#ef4444" : null;
                    return (
                      <button key={i} onClick={() => picked === null && setPicked(i)} className="kid-glass" style={{
                        display: "flex", alignItems: "center", gap: 14,
                        padding: "15px 16px", borderRadius: 18, textAlign: "left", cursor: picked === null ? "pointer" : "default",
                        fontFamily: KID_FONT, fontSize: 17, fontWeight: 500, color: "var(--text)",
                        background: tint ? `${tint}1f` : undefined, borderColor: tint || undefined,
                        transition: "all 0.25s ease", animation: `kidSlideIn 0.5s ease ${0.4 + k * 0.12}s both`,
                      }}>
                        <span className="kid-num" style={{ width: 28, height: 28, borderRadius: 9, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 600, border: `1px solid ${tint || "var(--glass-border)"}`, color: tint || "var(--text-muted)" }}>
                          {showRight ? "✓" : showWrong ? "✕" : "ABC"[k]}
                        </span>
                        {opt}
                      </button>
                    );
                  })}
                </div>
                {picked !== null && (
                  <div style={{ marginTop: 16, padding: "14px 16px", borderRadius: 16, fontSize: 16, lineHeight: 1.55, background: correct ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.08)", border: `1px solid ${correct ? "#22c55e55" : "#ef444455"}`, animation: "kidSlideIn 0.35s ease" }}>
                    <strong>{correct ? "Correct. " : "Not quite. "}</strong>{unit.quiz.why}
                  </div>
                )}
              </div>
            )}

            {(scene.type === "done" || scene.type === "end1" || scene.type === "end2") && (
              <div style={{ textAlign: "center", maxWidth: 520, margin: "0 auto" }}>
                <svg width="120" height="120" viewBox="0 0 120 120" style={{ animation: "kidPop 0.6s ease" }}>
                  <circle cx="60" cy="60" r="52" fill={`${unit.color}1a`} stroke={unit.color} strokeWidth="2" strokeDasharray="330" style={{ animation: "kidDraw 0.9s ease forwards" }} />
                  <path d="M40 62 L54 76 L82 46" fill="none" stroke={unit.color} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="260" style={{ animation: "kidDraw 1.2s ease 0.3s both" }} />
                </svg>
                <p style={{ fontSize: 34, fontWeight: 600, letterSpacing: "-0.03em", marginTop: 14 }}>
                  {scene.type === "done" ? "Lesson complete" : scene.type === "end1" ? "Layer 02 complete" : "You reached the bottom"}
                </p>
                <p style={{ fontSize: 17, color: "var(--text-muted)", marginTop: 8, lineHeight: 1.5 }}>
                  {scene.type === "done" ? (autoNext && onNextLesson ? "Next lesson starts automatically. Or go deeper into this one first." : `“${unit.title}” has two more layers underneath.`)
                    : scene.type === "end1" ? "One more layer: history, debates, key terms, and sources."
                    : `Keep going in the full ${sectionName} section, or search the Library.`}
                </p>
                {scene.type === "done" && autoNext && onNextLesson && (
                  <div style={{ marginTop: 18, display: "flex", alignItems: "center", justifyContent: "center", gap: 12 }}>
                    <div style={{ width: 120, height: 4, borderRadius: 4, background: "var(--glass-border)", overflow: "hidden" }}>
                      <div style={{ width: `${progress * 100}%`, height: "100%", background: unit.color }} />
                    </div>
                    <button onClick={() => setAutoNext(false)} style={{ background: "none", border: "none", color: "var(--text-muted)", fontFamily: KID_FONT, fontSize: 13, cursor: "pointer", textDecoration: "underline" }}>Stay here</button>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Bottom action */}
      <div style={{ position: "relative", padding: "12px 24px 24px", maxWidth: 580, width: "100%", margin: "0 auto", display: "flex", flexDirection: "column", gap: 10 }}>
        {readMode && stage !== "lesson" ? (
          stage === "deep1" ? (
            <KidButton color={unit.color} onClick={() => enterStage("deep2")}>Even deeper ↓</KidButton>
          ) : (
            <KidButton color={unit.color} onClick={() => onDeeper(unit.deep)}>Open {sectionName} →</KidButton>
          )
        ) : scene.type === "quiz" ? (
          picked === null ? <KidButton color={unit.color} disabled>Choose an answer</KidButton>
          : correct ? <KidButton color="#22c55e" onClick={() => { onComplete(unit.id); setPicked(null); go(idx + 1); }}>Continue</KidButton>
          : <KidButton color="#ef4444" onClick={() => setPicked(null)}>Try again</KidButton>
        ) : scene.type === "done" ? (
          <>
            {autoNext && onNextLesson && <KidButton color={unit.color} onClick={onNextLesson}>Next lesson →</KidButton>}
            <KidButton color={unit.color} ghost={autoNext && !!onNextLesson} onClick={() => enterStage("deep1")}>Go deeper ↓</KidButton>
            {!(autoNext && onNextLesson) && <KidButton ghost onClick={onClose}>Back to my path</KidButton>}
          </>
        ) : scene.type === "end1" ? (
          <>
            <KidButton color={unit.color} onClick={() => enterStage("deep2")}>Even deeper ↓</KidButton>
            <KidButton ghost onClick={onClose}>Back to my path</KidButton>
          </>
        ) : scene.type === "end2" ? (
          <>
            <KidButton color={unit.color} onClick={() => onDeeper(unit.deep)}>Open {sectionName} →</KidButton>
            <div style={{ display: "flex", gap: 10 }}>
              {onLibrary && <KidButton ghost onClick={() => onLibrary(unit)}>Library</KidButton>}
              <KidButton ghost onClick={onNextLesson || onClose}>{onNextLesson ? "Next lesson" : "My path"}</KidButton>
            </div>
          </>
        ) : scene.type === "reference" ? (
          <KidButton color={unit.color} onClick={next}>Finish</KidButton>
        ) : (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <span style={{ fontSize: 12.5, color: "var(--text-muted)" }}>{paused ? "Paused" : "Playing"} · tap to skip ahead</span>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={prev} disabled={idx === 0} aria-label="Previous" className="kid-glass" style={{ width: 44, height: 44, borderRadius: 999, cursor: idx === 0 ? "default" : "pointer", opacity: idx === 0 ? 0.4 : 1, color: "var(--text)", fontSize: 16 }}>←</button>
              <button onClick={next} aria-label="Next" style={{ width: 44, height: 44, borderRadius: 999, cursor: "pointer", color: "white", fontSize: 16, border: "none", background: `linear-gradient(135deg, ${unit.color}, ${unit.color}c8)`, boxShadow: `0 8px 20px -8px ${unit.color}` }}>→</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══ LEVEL 2 — KNOW THE BASICS: the real vocabulary ═══
const MEDIUM_PATH = [
  {
    id: "m-freq", deep: "energy", icon: "🎶", color: "#ec4899", title: "Frequency, Hz & Resonance",
    cards: [
      { kind: "wave", emoji: "〰️", text: "Frequency is measured in hertz (Hz): cycles per second. A 440 Hz tone moves the air back and forth 440 times every second." },
      { kind: "rings", emoji: "🔔", text: "Resonance is when one vibrating thing makes another vibrate at the same frequency. Strike one tuning fork and a matching fork across the room starts to hum." },
      { kind: "pulse", emoji: "🧠", text: "Your brain has rhythms too, read by EEG: delta (deep sleep), theta (dreamy), alpha (relaxed), beta (alert), gamma (peak focus)." },
    ],
    quiz: { q: "Which brainwave band goes with calm, relaxed awareness?", options: ["Alpha", "Delta", "Gamma"], answer: 0, why: "Alpha (about 8–12 Hz) shows up when you close your eyes and relax while staying awake." },
  },
  {
    id: "m-heart", deep: "biofield", icon: "💗", color: "#f43f5e", title: "Heart–Brain Coherence",
    cards: [
      { kind: "rings", emoji: "❤️", text: "Your heart speeds up a little when you breathe in and slows when you breathe out. That variation is called heart rate variability (HRV)." },
      { kind: "breathe", emoji: "🫁", text: "Breathing about 5–6 times a minute turns that rhythm into a smooth, even wave. Researchers call this state coherence." },
      { kind: "pulse", emoji: "💗", text: "The HeartMath Institute has studied coherence for decades and links it to calmer emotions and clearer thinking." },
    ],
    quiz: { q: "Coherent breathing is roughly how many breaths per minute?", options: ["5–6", "20–25", "1"], answer: 0, why: "About 5 seconds in and 5 seconds out gives roughly 6 breaths a minute, the classic resonance pace." },
  },
  {
    id: "m-chakras", deep: "biofield", icon: "🌈", color: "#8b5cf6", title: "The Chakra Map",
    cards: [
      { kind: "spin", emoji: "☸️", text: "Chakra means 'wheel' in Sanskrit. The yogic tradition describes seven main energy centers along the spine." },
      { kind: "bob", emoji: "🌈", text: "Root (grounding), Sacral (creativity), Solar Plexus (will), Heart (love), Throat (expression), Third Eye (insight), Crown (connection)." },
      { kind: "rings", emoji: "🧬", text: "Many teachers point out that chakra locations sit close to major nerve bundles and glands. The heart center, for example, sits near the cardiac plexus." },
    ],
    quiz: { q: "Which chakra governs expression and speaking your truth?", options: ["Throat", "Root", "Sacral"], answer: 0, why: "The throat chakra (Vishuddha) is tied to voice, communication, and honesty." },
  },
  {
    id: "m-meridians", deep: "healing", icon: "☯️", color: "#14b8a6", title: "Meridians & Qi",
    cards: [
      { kind: "bob", emoji: "☯️", text: "Traditional Chinese Medicine maps qi (life energy) flowing through 12 main meridians, each paired with an organ." },
      { kind: "pulse", emoji: "📍", text: "Acupuncture and acupressure work on points along those channels. Acupuncture is one of the most widely studied traditional therapies in the world." },
      { kind: "spin", emoji: "🥋", text: "Qigong and tai chi move qi with slow movement, breath, and intention, sometimes called 'moving meditation'." },
    ],
    quiz: { q: "In Chinese medicine, life energy is called…", options: ["Qi", "Mana", "Ether"], answer: 0, why: "Qi (pronounced 'chee'). Yoga's parallel word is prana." },
  },
  {
    id: "m-emotions", deep: "emotions", icon: "🎭", color: "#f97316", title: "Emotions as Frequencies",
    cards: [
      { kind: "pulse", emoji: "📈", text: "David Hawkins' 'Map of Consciousness' ranks emotional states on a log scale, from shame at the bottom to peace and enlightenment at the top." },
      { kind: "wave", emoji: "🎭", text: "Traditions agree on the direction: fear and shame contract you, while gratitude, love, and peace expand you." },
      { kind: "breathe", emoji: "🏷️", text: "Name it to tame it. Putting a feeling into words ('this is anger') quiets the brain's alarm center. Researchers call this affect labeling." },
    ],
    quiz: { q: "Calming an emotion by naming it is called…", options: ["Affect labeling", "Suppression", "Projection"], answer: 0, why: "Brain-imaging studies show that labeling a feeling lowers amygdala activity." },
  },
  {
    id: "m-sound", deep: "numbers", icon: "🔔", color: "#eab308", title: "Sound Healing & Solfeggio",
    cards: [
      { kind: "wave", emoji: "🎼", text: "Solfeggio tones like 396, 528, and 639 Hz are staples of modern sound healing." },
      { kind: "rings", emoji: "🥣", text: "Singing bowls, gongs, and chanting use long, sustained tones to shift the nervous system into rest mode." },
      { kind: "pulse", emoji: "🎧", text: "Binaural beats play a slightly different tone in each ear. Your brain hears the difference between them as a slow pulse." },
    ],
    quiz: { q: "Binaural beats only work with…", options: ["Headphones", "A microwave", "Total silence"], answer: 0, why: "Each ear has to hear its own tone separately, so you need headphones." },
  },
  {
    id: "m-water", deep: "healthsimple", icon: "💧", color: "#06b6d4", title: "Water & Structure",
    cards: [
      { kind: "bob", emoji: "💧", text: "Water holds heat, carries charge, and is where nearly every chemical reaction in your cells happens." },
      { kind: "rings", emoji: "🔬", text: "Dr. Gerald Pollack's lab describes a 'fourth phase' of water that forms next to surfaces and is charged by light. He calls it EZ (exclusion zone) water." },
      { kind: "spin", emoji: "⛰️", text: "Spring water, sunlight, and minerals are the simple ways people work with water's energy." },
    ],
    quiz: { q: "Pollack's structured water is also called…", options: ["EZ water", "Heavy water", "Dry water"], answer: 0, why: "EZ stands for exclusion zone, a layer that pushes out particles." },
  },
  {
    id: "m-ground", deep: "hacks", icon: "🌍", color: "#22c55e", title: "Grounding & Earth's Field",
    cards: [
      { kind: "pulse", emoji: "⚡", text: "The Earth's surface carries a mild negative charge, kept topped up by lightning around the globe." },
      { kind: "globe", emoji: "🌍", text: "The Schumann resonance, about 7.83 Hz, is the natural hum of the cavity between Earth's surface and the ionosphere." },
      { kind: "bob", emoji: "🦶", text: "Grounding studies suggest that barefoot contact with the earth may affect sleep, stress, and markers of inflammation." },
    ],
    quiz: { q: "The Schumann resonance is about…", options: ["7.83 Hz", "440 Hz", "60 Hz"], answer: 0, why: "7.83 Hz is the fundamental, with higher harmonics near 14, 20, and 26 Hz." },
  },
];

// ═══ LEVEL 3 — PRACTITIONER: frameworks & mechanisms ═══
const ADVANCED_PATH = [
  {
    id: "a-torus", deep: "numbers", icon: "🍩", color: "#eab308", title: "The Torus Field",
    cards: [
      { kind: "torus", emoji: "🌀", text: "A torus is a donut-shaped flow that feeds back into itself. You can see it in magnetic fields, hurricanes, and the heart's field." },
      { kind: "torus", emoji: "🍩", text: "Arthur M. Young, and later Nassim Haramein, proposed the torus as a basic pattern of self-organizing systems." },
      { kind: "pulse", emoji: "🔢", text: "Marko Rodin's vortex math maps the doubling sequence 1-2-4-8-7-5 around a torus, with 3-6-9 as the axis." },
    ],
    quiz: { q: "In vortex math, which numbers form the axis?", options: ["3, 6, 9", "1, 2, 4", "5, 7, 8"], answer: 0, why: "The doubling circuit 1-2-4-8-7-5 never touches 3, 6, or 9. Those stand apart as the axis." },
  },
  {
    id: "a-kundalini", deep: "biofield", icon: "🐍", color: "#a855f7", title: "Kundalini & the Central Channel",
    cards: [
      { kind: "helix", emoji: "🐍", text: "Kundalini is described as coiled energy at the base of the spine that rises through sushumna, the central channel." },
      { kind: "helix", emoji: "⚕️", text: "Ida (lunar) and pingala (solar) spiral around sushumna, a pattern echoed in the caduceus symbol." },
      { kind: "bob", emoji: "🧘", text: "Lineages stress preparation before any forcing: breath (pranayama), bandhas (energy locks), and a grounded, healthy body." },
    ],
    quiz: { q: "The central energy channel is called…", options: ["Sushumna", "Ida", "Pingala"], answer: 0, why: "Sushumna runs up the spine. Ida and pingala wind around it." },
  },
  {
    id: "a-breath", deep: "practice", icon: "🌬️", color: "#0ea5e9", title: "Advanced Breathwork",
    cards: [
      { kind: "breathe", emoji: "👃", text: "Nadi shodhana (alternate-nostril breathing) balances the ida and pingala channels." },
      { kind: "pulse", emoji: "🔥", text: "Kapalabhati and Wim Hof–style breathing raise energy and temporarily shift your blood chemistry." },
      { kind: "bob", emoji: "⏸️", text: "Breath retention (kumbhaka) is where many traditions say the real shift happens. Never do intense breathwork in water or while driving." },
    ],
    quiz: { q: "Alternate-nostril breathing is called…", options: ["Nadi shodhana", "Kapalabhati", "Ujjayi"], answer: 0, why: "Nadi means channel and shodhana means cleansing." },
  },
  {
    id: "a-photon", deep: "biofield", icon: "✨", color: "#f59e0b", title: "Biophotons: Light in Cells",
    cards: [
      { kind: "rings", emoji: "✨", text: "Living cells give off ultra-weak light called biophotons, which can be measured with very sensitive light detectors." },
      { kind: "pulse", emoji: "🔬", text: "Physicist Fritz-Albert Popp proposed that biophotons help coordinate cells, a kind of coherent light communication." },
      { kind: "spin", emoji: "🌟", text: "It echoes the ancient teaching of a 'body of light'." },
    ],
    quiz: { q: "Who pioneered biophoton research?", options: ["Fritz-Albert Popp", "Isaac Newton", "Carl Jung"], answer: 0, why: "Popp's work from the 1970s onward launched the field." },
  },
  {
    id: "a-cymatics", deep: "numbers", icon: "🔊", color: "#ec4899", title: "Cymatics: Sound Made Visible",
    cards: [
      { kind: "wave", emoji: "🔊", text: "Hans Jenny vibrated sand and fluids on metal plates and filmed the patterns that formed. He named this cymatics." },
      { kind: "spin", emoji: "❄️", text: "Higher frequencies make more complex geometry: mandala-like shapes made from pure sound." },
      { kind: "pulse", emoji: "💠", text: "Practitioners read cymatics as a model of how vibration organizes matter." },
    ],
    quiz: { q: "Who coined the word 'cymatics'?", options: ["Hans Jenny", "Nikola Tesla", "Royal Rife"], answer: 0, why: "Jenny published 'Kymatik' in 1967, building on Ernst Chladni's plate experiments." },
  },
  {
    id: "a-electric", deep: "healing", icon: "⚡", color: "#22c55e", title: "The Body Electric",
    cards: [
      { kind: "rings", emoji: "🦴", text: "Dr. Robert O. Becker's 'The Body Electric' (1985) documented electrical currents that guide bone healing and limb regeneration." },
      { kind: "pulse", emoji: "🐸", text: "Michael Levin's lab at Tufts studies the bioelectric signals that tell cells what shape to build." },
      { kind: "bob", emoji: "🧲", text: "PEMF (pulsed electromagnetic field) devices are FDA-cleared for some bone-healing uses." },
    ],
    quiz: { q: "Who wrote 'The Body Electric'?", options: ["Robert O. Becker", "Wilhelm Reich", "Royal Rife"], answer: 0, why: "Becker was an orthopedic surgeon who studied regeneration for decades." },
  },
  {
    id: "a-shadow", deep: "emotions", icon: "🌑", color: "#6366f1", title: "Shadow Work & Stored Emotion",
    cards: [
      { kind: "pulse", emoji: "🌑", text: "Carl Jung called the parts of ourselves we deny 'the shadow'." },
      { kind: "wave", emoji: "🫀", text: "Somatic therapists describe unprocessed emotion held in the body. 'The Body Keeps the Score' brought the idea to a wide audience." },
      { kind: "breathe", emoji: "🌊", text: "Integration means feeling what was stored until it moves. Once an emotion is felt, it can flow." },
    ],
    quiz: { q: "The term 'shadow' comes from…", options: ["Carl Jung", "Sigmund Freud", "Nikola Tesla"], answer: 0, why: "Jung saw shadow integration as central to becoming whole." },
  },
  {
    id: "a-hermetic", deep: "knowledge", icon: "📜", color: "#f59e0b", title: "The 7 Hermetic Principles",
    cards: [
      { kind: "bob", emoji: "📜", text: "The Kybalion (1908) lists seven principles: Mentalism, Correspondence, Vibration, Polarity, Rhythm, Cause & Effect, and Gender." },
      { kind: "rings", emoji: "🔺", text: "'As above, so below' is the principle of Correspondence." },
      { kind: "wave", emoji: "〰️", text: "'Nothing rests; everything moves; everything vibrates' is the principle of Vibration." },
    ],
    quiz: { q: "'As above, so below' is the principle of…", options: ["Correspondence", "Rhythm", "Polarity"], answer: 0, why: "Patterns repeat at every scale, from atom to solar system." },
  },
];

// ═══ LEVEL 4 — RABBIT HOLE: primary sources, fringe science, open debates ═══
const RABBIT_PATH = [
  {
    id: "r-gateway", deep: "wakeup", icon: "📂", color: "#ef4444", title: "The CIA Gateway Report",
    cards: [
      { kind: "bob", emoji: "📂", text: "In 1983 Army Lt. Col. Wayne McDonnell wrote 'Analysis and Assessment of Gateway Process'. The CIA declassified it in 2003 and it went viral in 2021." },
      { kind: "rings", emoji: "🎧", text: "It analyzes the Monroe Institute's Hemi-Sync audio, a holographic model of the universe, and consciousness moving beyond time and space." },
      { kind: "pulse", emoji: "📄", text: "Page 25 was missing for decades until it surfaced in 2021. You can read the full report yourself in the CIA's online reading room." },
    ],
    quiz: { q: "Whose techniques did the Gateway report analyze?", options: ["The Monroe Institute", "HeartMath", "Esalen"], answer: 0, why: "Robert Monroe's Hemi-Sync audio was the core of the Gateway Process." },
  },
  {
    id: "r-stargate", deep: "wakeup", icon: "👁️", color: "#dc2626", title: "Stargate & Remote Viewing",
    cards: [
      { kind: "eye", emoji: "👁️", text: "From the 1970s to 1995, US intelligence funded remote-viewing programs: Grill Flame, Sun Streak, and finally Stargate." },
      { kind: "rings", emoji: "🧪", text: "Physicists Russell Targ and Harold Puthoff ran the early work at SRI with viewers like Ingo Swann and Pat Price." },
      { kind: "bob", emoji: "⚖️", text: "A 1995 review ended the program. Statistician Jessica Utts found significant effects, while psychologist Ray Hyman disputed them. The debate continues." },
    ],
    quiz: { q: "Where did early remote-viewing research happen?", options: ["Stanford Research Institute (SRI)", "NASA", "MIT"], answer: 0, why: "SRI in Menlo Park hosted Targ and Puthoff's lab." },
  },
  {
    id: "r-morphic", deep: "knowledge", icon: "🕸️", color: "#8b5cf6", title: "Morphic Fields",
    cards: [
      { kind: "rings", emoji: "🕸️", text: "Rupert Sheldrake proposes 'morphic resonance': nature has memory, and patterns get easier to repeat the more often they happen." },
      { kind: "pulse", emoji: "💎", text: "If true, it would explain why a new kind of crystal seems to form more easily worldwide once it has been made somewhere." },
      { kind: "bob", emoji: "⚖️", text: "Mainstream biology rejects the idea, and his 2013 TEDx talk was removed from TED's main channel. Weigh the evidence yourself." },
    ],
    quiz: { q: "Who proposed morphic resonance?", options: ["Rupert Sheldrake", "Bruce Lipton", "Dean Radin"], answer: 0, why: "Sheldrake laid it out in 'A New Science of Life' (1981)." },
  },
  {
    id: "r-mind", deep: "knowledge", icon: "🧪", color: "#06b6d4", title: "Consciousness Experiments",
    cards: [
      { kind: "grid", emoji: "🎲", text: "Princeton's PEAR lab (1979–2007) studied whether human intention could nudge random-number generators." },
      { kind: "pulse", emoji: "🌐", text: "The Global Consciousness Project tracks a network of random generators worldwide during mass events such as 9/11." },
      { kind: "bob", emoji: "⚖️", text: "Dean Radin at IONS publishes meta-analyses on presentiment and intention studies. The effects are small and fiercely debated." },
    ],
    quiz: { q: "The PEAR lab was based at…", options: ["Princeton", "Harvard", "Yale"], answer: 0, why: "PEAR stands for Princeton Engineering Anomalies Research." },
  },
  {
    id: "r-tesla", deep: "numbers", icon: "🗼", color: "#eab308", title: "Tesla, Scalar Waves & Free Energy",
    cards: [
      { kind: "rings", emoji: "🗼", text: "Tesla's Wardenclyffe Tower (1901–1917) was meant to transmit power wirelessly through the Earth." },
      { kind: "wave", emoji: "〰️", text: "'Scalar' or longitudinal waves appear in Tesla's writings and later in Thomas Bearden's work. Mainstream physics disputes that they carry energy the way these writers claim." },
      { kind: "pulse", emoji: "🗄️", text: "After Tesla died in 1943, the Office of Alien Property seized his papers. The FBI's files on him are now public." },
    ],
    quiz: { q: "Tesla's wireless power tower was called…", options: ["Wardenclyffe", "Colorado Springs", "Niagara"], answer: 0, why: "It stood in Shoreham, New York, and was demolished in 1917." },
  },
  {
    id: "r-rife", deep: "healing", icon: "📻", color: "#22c55e", title: "Royal Rife & Frequency Medicine",
    cards: [
      { kind: "pulse", emoji: "🔬", text: "In the 1930s, Royal Raymond Rife built a microscope and a 'beam ray' device that he said destroyed microbes using their resonant frequencies." },
      { kind: "rings", emoji: "📻", text: "A 1934 trial in California is reported to have succeeded, but the records are thin and the work was never replicated in mainstream journals." },
      { kind: "bob", emoji: "⚖️", text: "Modern frequency devices (Rife machines, Spooky2) have a large following. Know which parts are documented and which are story." },
    ],
    quiz: { q: "Rife believed each microbe has a…", options: ["Mortal oscillatory rate", "Blood type", "Favorite color"], answer: 0, why: "MOR, the frequency Rife claimed would shatter a given organism." },
  },
  {
    id: "r-russell", deep: "knowledge", icon: "🌀", color: "#14b8a6", title: "Walter Russell & Viktor Schauberger",
    cards: [
      { kind: "spin", emoji: "💡", text: "Walter Russell's 'The Universal One' (1926) describes a universe of light held in two-way rhythmic balance." },
      { kind: "wave", emoji: "🏞️", text: "Viktor Schauberger studied how rivers spiral and cool themselves. His motto was 'comprehend and copy nature', and he designed implosion turbines." },
      { kind: "rings", emoji: "🌀", text: "Their ideas still feed today's vortex-water devices and implosion research." },
    ],
    quiz: { q: "Schauberger's motto was…", options: ["Comprehend and copy nature", "Force it harder", "Nothing moves"], answer: 0, why: "He believed modern technology fought nature's spiral motion instead of working with it." },
  },
  {
    id: "r-channel", deep: "knowledge", icon: "🔭", color: "#a855f7", title: "Channeled Cosmologies",
    cards: [
      { kind: "pulse", emoji: "🔭", text: "The Law of One (the Ra Material, 1981–84) teaches service-to-others vs. service-to-self, densities of consciousness, and the 'harvest'." },
      { kind: "rings", emoji: "📚", text: "The Seth Material (Jane Roberts), the Cassiopaean transcripts, and Bashar each map reality as layers of consciousness." },
      { kind: "bob", emoji: "🧭", text: "Read them side by side. Where independent sources agree is where many long-time seekers look hardest." },
    ],
    quiz: { q: "The Law of One was received by…", options: ["L/L Research (Carla Rueckert's group)", "NASA", "The Vatican"], answer: 0, why: "Don Elkins, Carla Rueckert, and Jim McCarty recorded 106 sessions." },
  },
];

// ═══ NEW TOPIC LESSONS (appended to their level paths) ═══
const NEW_MEDIUM_UNITS = [
  {
    id: "m-deceive", deep: "wakeup", icon: "◈", color: "#e11d48", title: "Deception 101: How Minds Get Steered",
    cards: [
      { kind: "eye", text: "Edward Bernays, Freud's nephew, wrote 'Propaganda' in 1928. He called the conscious manipulation of the public's habits and opinions 'an important element in democratic society'." },
      { kind: "grid", text: "In 1937 the Institute for Propaganda Analysis named seven classic tricks: name-calling, glittering generalities, transfer, testimonial, plain folks, card stacking, and bandwagon." },
      { kind: "rings", text: "Your brain takes shortcuts called cognitive biases. Deception works by hijacking them with fear, repetition, authority, and the need to belong." },
    ],
    quiz: { q: "Who wrote 'Propaganda' (1928)?", options: ["Edward Bernays", "Walter Cronkite", "Carl Sagan"], answer: 0, why: "Bernays is often called the father of public relations." },
  },
];

const NEW_ADVANCED_UNITS = [
  {
    id: "a-gematria", deep: "numbers", icon: "א", color: "#d97706", title: "Gematria & Sacred Number",
    cards: [
      { kind: "grid", text: "In Hebrew, every letter is also a number: aleph = 1, bet = 2, yod = 10, qof = 100. Gematria finds meaning in words that share the same value." },
      { kind: "pulse", text: "The classic example: chai, the word for 'life', adds up to 18. That's why Jewish gifts are often given in multiples of 18." },
      { kind: "spin", text: "Greek had the same system, called isopsephy. Many scholars read the Bible's 666 as the value of 'Nero Caesar' spelled in Hebrew letters." },
    ],
    quiz: { q: "The Hebrew word chai ('life') adds up to…", options: ["18", "7", "33"], answer: 0, why: "Chet (8) + yod (10) = 18." },
  },
  {
    id: "a-religion", deep: "knowledge", icon: "☩", color: "#7c3aed", title: "Religion: Roots & Parallels",
    cards: [
      { kind: "rings", text: "Between about 800 and 200 BC, the Buddha, Confucius, Laozi, the Hebrew prophets, and the Greek philosophers all appeared. Karl Jaspers called it the Axial Age." },
      { kind: "wave", text: "The Epic of Gilgamesh, older than Genesis, tells of a great flood, a man who builds a boat, and birds sent out to find dry land." },
      { kind: "pulse", text: "Beneath the differences, mystics in every tradition describe the same core: union with the divine, found within. Aldous Huxley called this the perennial philosophy." },
    ],
    quiz: { q: "Which text has a flood story older than Genesis?", options: ["The Epic of Gilgamesh", "The Iliad", "The Kybalion"], answer: 0, why: "Tablet XI of Gilgamesh tells the flood story of Utnapishtim." },
  },
];

const NEW_RABBIT_UNITS = [
  {
    id: "r-flat", deep: "wakeup", icon: "◯", color: "#0ea5e9", title: "Flat Earth: The Claims & the Tests",
    cards: [
      { kind: "globe", text: "Modern flat-earth ideas trace back to Samuel Rowbotham's 'Zetetic Astronomy' (1849), built on his water-level observations along England's Bedford Level canal." },
      { kind: "grid", text: "The movement exploded online in the 2010s. Its core rule: don't trust authority, test what you can see for yourself." },
      { kind: "rings", text: "That's a good rule. So this lesson gives you the claims AND the experiments anyone can run, including the ones flat-earth researchers ran themselves." },
    ],
    quiz: { q: "Who wrote 'Zetetic Astronomy' (1849)?", options: ["Samuel Rowbotham", "Isaac Newton", "Eric Dubay"], answer: 0, why: "Rowbotham, writing as 'Parallax', founded the modern flat-earth argument." },
  },
  {
    id: "r-firmament", deep: "wakeup", icon: "⌒", color: "#6366f1", title: "The Firmament",
    cards: [
      { kind: "dome", text: "Genesis 1:6–8 describes God making a 'firmament' (Hebrew: raqia) to divide the waters above from the waters below." },
      { kind: "wave", text: "Raqia comes from a root meaning to beat out or hammer thin, like metal. Many scholars read it as a solid dome, matching other ancient Near Eastern cosmologies." },
      { kind: "rings", text: "Some researchers today link the firmament to 1960s high-altitude nuclear tests and the Van Allen belts. This lesson separates what's documented from what's claimed." },
    ],
    quiz: { q: "The Hebrew word translated 'firmament' is…", options: ["Raqia", "Shamayim", "Elohim"], answer: 0, why: "Raqia. Shamayim means 'heavens'." },
  },
  {
    id: "r-toroid", deep: "numbers", icon: "◎", color: "#14b8a6", title: "Toroidal Fields of Earth & Cosmos",
    cards: [
      { kind: "torus", text: "Earth is wrapped in a magnetic field generated by molten iron swirling in its outer core." },
      { kind: "rings", text: "That field traps charged particles in the Van Allen belts and funnels them toward the poles, lighting up the auroras." },
      { kind: "torus", text: "From the Sun's field to spinning galaxies, ring and doughnut-shaped flows show up at every scale. Some researchers see one universal pattern." },
    ],
    quiz: { q: "What generates Earth's magnetic field?", options: ["Molten iron moving in the outer core", "The Moon", "Radio towers"], answer: 0, why: "The geodynamo: churning liquid iron creates electric currents that sustain the field." },
  },
  {
    id: "r-psyops", deep: "wakeup", icon: "◉", color: "#dc2626", title: "Psyops & Engineered Reality",
    cards: [
      { kind: "eye", text: "Operation Mockingbird is the name tied to the CIA's relationships with journalists, examined by the Senate's Church Committee in 1975–76." },
      { kind: "grid", text: "In 2014, Snowden documents revealed a British GCHQ unit, JTRIG, with a training deck titled 'The Art of Deception: Training for Online Covert Operations'." },
      { kind: "rings", text: "Its toolkit included fake online identities, planted information, and ways to discredit targets. The playbook is real and documented." },
    ],
    quiz: { q: "The GCHQ unit behind 'The Art of Deception' slides was…", options: ["JTRIG", "NASA", "INSCOM"], answer: 0, why: "The Joint Threat Research Intelligence Group." },
  },
];

const NEW_DEEP_LESSONS = {
  "m-deceive": {
    go: [
      ["Bernays in action", "In 1929 Bernays staged the 'Torches of Freedom' march for the American Tobacco Company, hiring women to smoke in New York's Easter Parade to break the taboo on women smoking. He also helped sell bacon and eggs as the 'hearty American breakfast' by gathering doctors' endorsements."],
      ["Manufacturing consent", "Journalist Walter Lippmann wrote in 1922 that the 'manufacture of consent' was an essential art of government. In 1988 Edward Herman and Noam Chomsky borrowed the phrase for their 'propaganda model' of the news: ownership, advertising, sourcing, flak, and a common enemy filter what reaches you."],
      ["The illusory truth effect", "Hearing a claim repeatedly makes it feel truer, even when you know it's false. Researchers first showed this in 1977 (Hasher, Goldstein & Toppino). Repetition is the cheapest persuasion tool there is, for any side."],
    ],
    even: [
      ["The seven techniques in the wild", "Name-calling (a label instead of an argument), glittering generalities ('freedom', 'safety', 'science'), transfer (borrowing the authority of a flag or lab coat), testimonial (celebrity endorsement), plain folks ('I'm just like you'), card stacking (showing one side of the evidence), and bandwagon ('everyone's doing it'). Try spotting all seven in one evening of TV."],
      ["The science of persuasion", "Robert Cialdini's six principles: reciprocity, commitment and consistency, social proof, authority, liking, and scarcity. Sales teams, political campaigns, cults, and social platforms all use them. Knowing them is the best defense."],
      ["Deception cuts both ways", "Any movement, including alternative ones, can use the same tricks: fear, us-versus-them, and one hero who has all the answers. An awake mind applies the same test to every source, including the ones it likes."],
    ],
    terms: [["Propaganda", "Organized persuasion aimed at shaping public opinion"], ["Manufactured consent", "Agreement engineered by controlling information"], ["Illusory truth effect", "Repetition making claims feel true"], ["Card stacking", "Presenting only the evidence that helps your side"], ["Social proof", "Believing something because others seem to"]],
    practice: { title: "Propaganda bingo", steps: ["Watch 20 minutes of any news channel, or scroll any feed.", "Tally each of the seven techniques as you spot it.", "Now do the same with a source you agree with, and compare your tallies."] },
    sources: ["Edward Bernays — Propaganda (1928)", "Edward S. Herman & Noam Chomsky — Manufacturing Consent (1988)", "Robert Cialdini — Influence: The Psychology of Persuasion (1984)"],
  },
  "a-gematria": {
    go: [
      ["How the letters count", "The 22 Hebrew letters run 1–9 (aleph to tet), 10–90 (yod to tsadi), and 100–400 (qof to tav). Five letters have special final forms, which some systems count as 500–900."],
      ["Kabbalah's use", "In Jewish mysticism, gematria is one of several methods for drawing hidden meaning from scripture, alongside notarikon (reading words as acronyms) and temurah (swapping letters). The Sefer Yetzirah and the Zohar treat the letters as the building blocks of creation."],
      ["Isopsephy and 666", "Greek letters had number values too. Revelation 13:18 invites the reader to 'count the number of the beast'. 'Nero Caesar' written in Hebrew letters sums to 666, and some early manuscripts read 616, which matches the Latin spelling of Nero. That's strong support for the Nero reading."],
    ],
    even: [
      ["English gematria", "Modern decoders use English ciphers: Ordinal (A=1 to Z=26), Reduction (values reduced to 1–9), Reverse Ordinal, and the 'Jewish' (Latin) cipher. Online calculators run a phrase through dozens of ciphers at once."],
      ["The coincidence problem", "With many ciphers and many words, some matches are guaranteed by chance. Serious researchers fix the cipher and the target number before looking. The famous test case is the Bible Code: Witztum, Rips & Rosenberg (1994) reported hidden patterns in Genesis, and McKay and colleagues (1999) found similar 'codes' in War and Peace."],
      ["Number in sacred design", "Numbers were built into sacred texts on purpose: the measurements of Solomon's Temple, the 153 fish in John 21, the 12 tribes and 12 apostles, 40 days in the wilderness. Ancient writers used number as a language of meaning."],
    ],
    terms: [["Gematria", "Hebrew letter-number interpretation"], ["Isopsephy", "The Greek equivalent of gematria"], ["Notarikon", "Reading a word as an acronym"], ["Temurah", "Interpreting by swapping letters"], ["Cipher", "A system that assigns numbers to letters"]],
    practice: { title: "Run a clean test", steps: ["Choose one cipher (for example, English Ordinal) and one target number BEFORE you start.", "Calculate 20 random words from a dictionary.", "Count how many hit your target by chance. That's your baseline for judging any 'match' you see online."] },
    sources: ["Sefer Yetzirah: The Book of Creation (trans. Aryeh Kaplan, 1990)", "Gershom Scholem — Major Trends in Jewish Mysticism (1941)", "McKay, Bar-Natan, Bar-Hillel & Kalai — 'Solving the Bible Code Puzzle' (Statistical Science, 1999)"],
  },
  "a-religion": {
    go: [
      ["The Axial Age", "Karl Jaspers (1949) noticed that between about 800 and 200 BC, across China, India, Persia, Israel, and Greece, thinkers turned inward toward ethics, the individual soul, and a transcendent order. Most major religions still carry that imprint."],
      ["Shared stories", "Flood stories appear in Mesopotamia (Gilgamesh, Atrahasis), Genesis, Hindu texts (Manu and the fish), and many Indigenous traditions. Dying-and-rising figures like Osiris and Tammuz appear across the ancient Near East. Scholars debate how much is shared origin, borrowing, or common human experience."],
      ["Lost and found texts", "In 1945, farmers found the Nag Hammadi library in Egypt: over 50 texts, including the Gospel of Thomas and other Gnostic writings. From 1947, the Dead Sea Scrolls surfaced near Qumran, holding the oldest known copies of Hebrew scripture."],
    ],
    even: [
      ["How the Bible was assembled", "A popular claim says the Council of Nicaea (325 AD) chose the books of the Bible. It didn't: Nicaea dealt with the nature of Christ (the Arian controversy) and the date of Easter. The New Testament list settled gradually, and Athanasius' Easter letter of 367 is the first surviving list that matches today's 27 books."],
      ["The Gnostic view", "Many Gnostic texts describe a flawed lesser creator (the demiurge) who traps sparks of divine light in matter, with salvation coming through gnosis, direct inner knowing. Church fathers like Irenaeus wrote against them around 180 AD."],
      ["The mystic cores", "Kabbalah (Judaism), Sufism (Islam), contemplative Christianity (Meister Eckhart, The Cloud of Unknowing), Advaita Vedanta (Hinduism), and Zen (Buddhism) all put direct experience above belief. Comparing their maps is one of the richest studies a seeker can take on."],
    ],
    terms: [["Axial Age", "c. 800–200 BC, when many world religions and philosophies took shape"], ["Gnosticism", "Early movements centered on secret, inner knowledge"], ["Demiurge", "The lesser creator of the material world in Gnostic texts"], ["Canon", "The official list of scriptural books"], ["Perennial philosophy", "The shared mystical core beneath religions"]],
    practice: { title: "Three mystics, one question", steps: ["Choose a question, such as 'Where is God found?'", "Read a short passage on it from Rumi, Meister Eckhart, and the Upanishads.", "Write down what they share and where they differ."] },
    sources: ["Karl Jaspers — The Origin and Goal of History (1949)", "Elaine Pagels — The Gnostic Gospels (1979)", "Aldous Huxley — The Perennial Philosophy (1945)"],
  },
  "r-flat": {
    go: [
      ["The Bedford Level experiment", "In 1838 Rowbotham watched a boat travel a straight six-mile stretch of canal and said it never dropped out of view, so the water must be flat. In 1870 Alfred Russel Wallace repeated it with markers set at equal heights and found the middle one stood higher, showing curvature, and won a £500 wager. Refraction, which bends light over water, explains why results varied."],
      ["The core claims", "Flat-earth models usually put the North Pole at the center with Antarctica as an ice wall around the edge, the Sun and Moon as small, local lights circling overhead, and gravity replaced by density and buoyancy. Space agency imagery is said to be faked."],
      ["Behind the Curve", "In the 2018 documentary, flat-earth researchers ran two tests of their own. A $20,000 ring-laser gyroscope picked up a drift of about 15 degrees per hour, which is Earth's rotation. A light-through-holes test across a distance only showed the light when it was raised, matching curvature. Their own results matched the globe."],
    ],
    even: [
      ["Tests you can run yourself", "Watch ships disappear hull-first with a zoom lens. Compare sunset times with a friend in another time zone on a video call. Notice the North Star sink as you travel south until it vanishes below the equator, while the Southern Cross rises. Watch a lunar eclipse: Earth's shadow on the Moon is always round."],
      ["Eratosthenes, around 240 BC", "Eratosthenes knew the Sun was straight overhead at noon in Syene on the summer solstice, while in Alexandria, roughly 800 km north, it cast a shadow of about 7.2°. That gave Earth a circumference of about 40,000 km, close to the modern figure, using only sticks, shadows, and geometry."],
      ["Why the question matters", "Most flat-earthers don't start from astronomy; they start from distrust, and that distrust often has real roots in documented deception. The honest path keeps the skepticism and aims it at the evidence. The evidence you can gather yourself shows a globe."],
    ],
    terms: [["Zetetic method", "Rowbotham's 'seek and test for yourself' approach"], ["Refraction", "Light bending as it passes through air layers"], ["Ring-laser gyroscope", "An instrument that detects rotation with light"], ["Circumference", "The distance around a circle or sphere"], ["Hull-down", "A ship's hull hidden below the horizon while its mast still shows"]],
    practice: { title: "The Eratosthenes challenge", steps: ["Find a partner at least 500 km north or south of you.", "At local solar noon on the same day, both measure the shadow of a vertical stick of the same height.", "Use the difference in shadow angles and your distance apart to calculate Earth's circumference, then compare it with 40,075 km."] },
    sources: ["Samuel Rowbotham ('Parallax') — Zetetic Astronomy: Earth Not a Globe (1849; expanded 1865)", "Behind the Curve (dir. Daniel J. Clark, 2018)", "Christine Garwood — Flat Earth: The History of an Infamous Idea (2007)"],
  },
  "r-firmament": {
    go: [
      ["Ancient cosmology", "Mesopotamian, Egyptian, and Hebrew texts pictured a flat earth under a solid vault with waters above it; rain came through the 'windows of heaven' (Genesis 7:11). In the Babylonian Enuma Elish, Marduk splits the sea goddess Tiamat in two to form sky and earth."],
      ["From dome to sphere", "Greek thinkers from Pythagoras to Aristotle argued for a spherical Earth, and Ptolemy's model nested the planets in crystalline spheres. Medieval scholars mostly accepted a round Earth; the idea that people in 1492 thought it was flat is largely a 19th-century myth."],
      ["The nuclear tests", "In 1958 (Operation Argus) and 1962 (Operation Fishbowl, including Starfish Prime), the U.S. detonated nuclear weapons in the upper atmosphere and space. Starfish Prime, about 400 km up, created an artificial radiation belt that damaged satellites and knocked out streetlights in Hawaii."],
    ],
    even: [
      ["What the tests were for", "Declassified records show the high-altitude tests studied radiation belts, electromagnetic pulse (EMP), and whether nuclear blasts could disrupt communications and missiles. Firmament researchers argue they were probing a physical barrier; the records describe the charged-particle belts James Van Allen discovered with Explorer 1 in 1958."],
      ["Byrd and the Antarctic Treaty", "Admiral Richard Byrd's quotes about 'land beyond the pole' are widely shared, and the 1959 Antarctic Treaty limits military activity on the continent. Many of the quotes are paraphrased or can't be traced to a source, while the treaty text is public and short. Read both and judge."],
      ["The firmament as symbol", "In many mystical traditions the firmament marks the boundary between the seen and unseen worlds, the veil the soul must pass through. Whatever its physics, it remains a powerful symbol of the limits of perception."],
    ],
    terms: [["Raqia", "The Hebrew word translated 'firmament'"], ["Enuma Elish", "The Babylonian creation epic"], ["Starfish Prime", "The 1962 high-altitude nuclear test"], ["Van Allen belts", "Zones of charged particles held by Earth's magnetic field"], ["EMP", "Electromagnetic pulse"]],
    practice: { title: "Read the primary documents", steps: ["Read Genesis 1:6–8 and 7:11 in two different translations.", "Read the declassified summaries of Operation Fishbowl and Starfish Prime.", "Read the Antarctic Treaty (1959). Write down what each source actually says."] },
    sources: ["Genesis 1–8 (Hebrew Bible)", "James A. Van Allen — Origins of Magnetospheric Physics (1983)", "Jeffrey Burton Russell — Inventing the Flat Earth (1991)"],
  },
  "r-toroid": {
    go: [
      ["The geodynamo", "Earth's liquid outer core, starting about 2,900 km down, churns as it cools and rotates. That moving, conductive iron generates electric currents, the currents generate a magnetic field, and the field shapes the flow in turn: a self-sustaining dynamo."],
      ["The magnetosphere", "The solar wind squashes Earth's field on the day side and stretches it into a long tail on the night side. Inside it, charged particles circle the planet in the Van Allen belts, drifting in ring-shaped paths."],
      ["Pole flips", "Earth's magnetic poles have reversed many times. The last full reversal, the Brunhes–Matuyama, was about 780,000 years ago, and the magnetic north pole has been moving quickly toward Siberia in recent decades."],
    ],
    even: [
      ["Plasma and Birkeland currents", "Kristian Birkeland proposed in the early 1900s that currents flowing along magnetic field lines power the auroras, and satellites confirmed them in the 1960s. 'Electric Universe' proponents extend the idea, arguing plasma currents shape galaxies, a view mainstream astrophysics rejects."],
      ["Toroids at every scale", "Smoke rings, fusion plasmas, the Sun's heliosphere, and the disks and jets around black holes all show ring or doughnut geometry. Whether that reflects one deep principle or the ordinary physics of rotation and flow is where science and philosophy meet."],
      ["The body's toroid", "The heart's field is often drawn as a torus in popular diagrams. The measured field is a dipole-like pattern that fades quickly with distance, so the torus image is a useful model, not a photograph."],
    ],
    terms: [["Geodynamo", "The process that generates Earth's magnetic field"], ["Magnetosphere", "The region controlled by Earth's magnetic field"], ["Van Allen belts", "Rings of trapped charged particles"], ["Birkeland currents", "Electric currents flowing along magnetic field lines"], ["Geomagnetic reversal", "A flip of Earth's magnetic poles"]],
    practice: { title: "See the field", steps: ["Put a bar magnet under a sheet of paper.", "Sprinkle iron filings on top and tap gently.", "Watch the loops form. Now picture that shape spun around the magnet's axis: that's the torus."] },
    sources: ["NASA — Earth's Magnetosphere (science.nasa.gov)", "Kristian Birkeland — The Norwegian Aurora Polaris Expedition 1902–1903 (1908)", "Wallace Thornhill & David Talbott — The Electric Universe (2007)"],
  },
  "r-psyops": {
    go: [
      ["Mockingbird", "The Church Committee found the CIA had relationships with U.S. journalists and influenced foreign press. Carl Bernstein's 1977 Rolling Stone investigation 'The CIA and the Media' put the number of American journalists who had secretly carried out assignments for the CIA at more than 400."],
      ["JTRIG's methods", "The leaked slides describe 'the 4 D's' (deny, disrupt, degrade, deceive), fake victim blog posts, false online identities, and honey traps, drawing on psychology and a magician's techniques of misdirection."],
      ["Modern influence operations", "Governments and companies now run networks of fake accounts. Meta and others publish regular takedown reports naming state-linked operations from many countries, and a 2022 report by Graphika and the Stanford Internet Observatory exposed pro-Western covert campaigns later linked to the U.S. military."],
    ],
    even: [
      ["COINTELPRO", "From 1956 to 1971 the FBI ran COINTELPRO against civil-rights leaders, anti-war groups, and others, using forged letters, planted informants, and smear campaigns. It came to light when activists broke into an FBI field office in Media, Pennsylvania, in 1971 and mailed the files to newspapers."],
      ["Controlled opposition", "Infiltrating and steering opposition movements is a documented tactic: COINTELPRO's informants, and the Soviet 'Operation Trust' of the 1920s, a fake anti-communist network run by Soviet intelligence. That makes it tempting to call everyone a plant, so demand evidence before labeling anyone."],
      ["Protecting yourself", "Slow down before sharing, check who's behind an account, notice when content is built to make you angry, and look for the original source. Influence operations win on speed and emotion."],
    ],
    terms: [["Psyop", "A psychological operation meant to shape beliefs or behavior"], ["False flag", "An action disguised as the work of someone else"], ["Sock puppet", "A fake online identity"], ["Controlled opposition", "A movement secretly steered by the side it opposes"], ["COINTELPRO", "The FBI's covert program against domestic groups"]],
    practice: { title: "Audit your feed", steps: ["Pick 10 posts that made you angry this week.", "For each one, find the original source and who posted it first.", "Count how many came from anonymous or brand-new accounts."] },
    sources: ["Glenn Greenwald — 'How Covert Agents Infiltrate the Internet to Manipulate, Deceive, and Destroy Reputations' (The Intercept, 2014)", "Carl Bernstein — 'The CIA and the Media' (Rolling Stone, 1977)", "Betty Medsger — The Burglary (2014)"],
  },
};

const LEVELS = {
  beginner: { id: "beginner", numeral: "I", emoji: "🌱", title: "Brand New", sub: "Simple, fun lessons. Start from zero.", sample: "Atoms · vibration · your heart's field · breathing", color: "#22c55e", depth: 1, path: LEARN_PATH, pathName: "YOUR ENERGY PATH" },
  medium: { id: "medium", numeral: "II", emoji: "🌿", title: "Know the Basics", sub: "The real vocabulary: Hz, coherence, chakras, meridians, propaganda.", sample: "Resonance · HRV · Solfeggio · Schumann 7.83 Hz · Deception 101", color: "#06b6d4", depth: 2, path: [...MEDIUM_PATH, ...NEW_MEDIUM_UNITS], pathName: "FOUNDATIONS PATH" },
  advanced: { id: "advanced", numeral: "III", emoji: "🔥", title: "Practitioner", sub: "I practice regularly. Give me frameworks and mechanisms.", sample: "Torus · kundalini · biophotons · Hermetic law · gematria · religion", color: "#a855f7", depth: 3, path: [...ADVANCED_PATH, ...NEW_ADVANCED_UNITS], pathName: "PRACTITIONER PATH" },
  rabbit: { id: "rabbit", numeral: "IV", emoji: "🐇", title: "Rabbit Hole", sub: "20+ years in. Primary sources, fringe science, open debates.", sample: "Flat earth · firmament · toroidal fields · psyops · CIA Gateway · Stargate", color: "#ef4444", depth: 4, path: [...RABBIT_PATH, ...NEW_RABBIT_UNITS], pathName: "RABBIT HOLE PATH" },
};
const LEVEL_ORDER = ["beginner", "medium", "advanced", "rabbit"];
const ALL_UNITS = LEVEL_ORDER.flatMap(l => LEVELS[l].path.map(u => ({ ...u, level: l })));

// Remember the chosen level between visits when the browser allows it
function loadPref(key, fallback) {
  try { const v = window.localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
}
function savePref(key, value) {
  try { window.localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage unavailable: keep it in memory only */ }
}

function DepthDots({ depth, color }) {
  return (
    <div style={{ display: "flex", gap: 3, alignItems: "flex-end" }}>
      {[1, 2, 3, 4].map(d => (
        <span key={d} style={{ width: 4, height: 5 + d * 3, borderRadius: 2, background: d <= depth ? color : "var(--glass-border)" }} />
      ))}
    </div>
  );
}

// First screen on Home: "How deep do you want to go?"
function LevelPicker({ onPick, onBuild, onLibrary, current, isMobile, accent }) {
  return (
    <div style={{ animation: "kidSlideIn 0.5s cubic-bezier(0.22,1,0.36,1)", fontFamily: KID_FONT }}>
      <div style={{ display: "flex", alignItems: "center", gap: 18, padding: "6px 0 26px" }}>
        <SparkMascot size={isMobile ? 52 : 64} color={accent} />
        <div>
          <div className="kid-label" style={{ marginBottom: 6 }}>Choose your depth</div>
          <div style={{ fontSize: isMobile ? 30 : 40, fontWeight: 600, color: "var(--text)", lineHeight: 1.05, letterSpacing: "-0.035em" }}>
            How deep do you <span className="kid-serif" style={{ color: accent }}>want to go?</span>
          </div>
        </div>
      </div>
      <p style={{ fontSize: 16, color: "var(--text-muted)", margin: "-8px 0 22px", lineHeight: 1.5 }}>Switch any time. Every level stays open to explore.</p>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {LEVEL_ORDER.map((id, i) => {
          const L = LEVELS[id];
          const isCur = current === id;
          return (
            <button key={id} onClick={() => onPick(id)} className="kid-glass kid-card-hover" style={{
              position: "relative", overflow: "hidden",
              textAlign: "left", cursor: "pointer", fontFamily: KID_FONT, color: "var(--text)",
              display: "flex", alignItems: "center", gap: 18, padding: "18px 20px", borderRadius: 24,
              borderColor: isCur ? L.color : undefined,
              animation: `kidSlideIn 0.5s cubic-bezier(0.22,1,0.36,1) ${i * 0.07}s both`,
            }}>
              <span aria-hidden style={{ position: "absolute", right: -40, top: -40, width: 160, height: 160, borderRadius: "50%", background: `radial-gradient(circle, ${L.color}30, transparent 65%)` }} />
              <span className="kid-serif" style={{ fontSize: isMobile ? 40 : 48, lineHeight: 1, color: L.color, width: isMobile ? 48 : 60, flexShrink: 0, textAlign: "center" }}>{L.numeral}</span>
              <div style={{ flex: 1, minWidth: 0, position: "relative" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 19, fontWeight: 600, letterSpacing: "-0.02em" }}>{L.title}</span>
                  <DepthDots depth={L.depth} color={L.color} />
                  {isCur && <span className="kid-label" style={{ color: L.color }}>Current</span>}
                </div>
                <div style={{ fontSize: 15, color: "var(--text-muted)", marginTop: 4, lineHeight: 1.4 }}>{L.sub}</div>
                <div style={{ fontSize: 12.5, color: L.color, marginTop: 8, fontFamily: "'JetBrains Mono', monospace", lineHeight: 1.5 }}>{L.sample}</div>
              </div>
              <span style={{ fontSize: 20, color: "var(--text-muted)", position: "relative" }}>→</span>
            </button>
          );
        })}
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
        <KidButton ghost onClick={onBuild} style={{ flex: "1 1 200px", width: "auto" }}>＋ Build my own path</KidButton>
        {onLibrary && <KidButton ghost onClick={onLibrary} style={{ flex: "1 1 200px", width: "auto" }}>Skip · browse the library ↗</KidButton>}
      </div>
    </div>
  );
}

// "Build my own path": pick any lessons from any level
function PathBuilder({ selected, onSave, onBack, isMobile, accent }) {
  const [picks, setPicks] = useState(() => new Set(selected));
  const toggle = id => setPicks(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  return (
    <div style={{ animation: "kidSlideIn 0.5s cubic-bezier(0.22,1,0.36,1)", fontFamily: KID_FONT, paddingBottom: 90 }}>
      <button onClick={onBack} style={{ background: "none", border: "none", color: "var(--text-muted)", fontSize: 15, cursor: "pointer", fontFamily: KID_FONT, marginBottom: 12, padding: 0 }}>← Back to levels</button>
      <div className="kid-label" style={{ marginBottom: 6 }}>Custom path</div>
      <div style={{ fontSize: isMobile ? 30 : 40, fontWeight: 600, color: "var(--text)", letterSpacing: "-0.035em", lineHeight: 1.05 }}>Build your <span className="kid-serif" style={{ color: accent }}>own path</span></div>
      <div style={{ fontSize: 16, color: "var(--text-muted)", marginTop: 8, marginBottom: 24 }}>Pick lessons from any level. They line up in the order you choose them.</div>

      {LEVEL_ORDER.map(lid => {
        const L = LEVELS[lid];
        return (
          <div key={lid} style={{ marginBottom: 24 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
              <span className="kid-serif" style={{ fontSize: 28, color: L.color, lineHeight: 1 }}>{L.numeral}</span>
              <span style={{ fontSize: 16, fontWeight: 600 }}>{L.title}</span>
              <DepthDots depth={L.depth} color={L.color} />
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {L.path.map(u => {
                const on = picks.has(u.id);
                return (
                  <button key={u.id} onClick={() => toggle(u.id)} className="kid-glass" style={{
                    display: "flex", alignItems: "center", gap: 9, padding: "10px 14px", borderRadius: 999, cursor: "pointer",
                    fontFamily: KID_FONT, fontSize: 14.5, fontWeight: 500, color: "var(--text)",
                    background: on ? `${u.color}26` : undefined, borderColor: on ? u.color : undefined,
                    transition: "all 0.2s ease",
                  }}>
                    <span style={{ width: 8, height: 8, borderRadius: 999, background: u.color, boxShadow: on ? `0 0 10px ${u.color}` : "none" }} />
                    {u.title}{on && <span style={{ color: u.color, fontWeight: 700 }}>✓</span>}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}

      <div style={{ position: "sticky", bottom: isMobile ? 84 : 16, paddingTop: 8 }}>
        <KidButton color={accent} disabled={picks.size === 0} onClick={() => {
          const order = [...selected.filter(id => picks.has(id)), ...[...picks].filter(id => !selected.includes(id))];
          onSave(order);
        }}>{picks.size === 0 ? "Pick at least one lesson" : `Start my path · ${picks.size} lesson${picks.size === 1 ? "" : "s"}`}</KidButton>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// VIDEO COURSE — "Where Are We?" (Beginner). Talk-along animated
// episodes: each scene is animated SVG art narrated aloud by Luma
// (browser speech), with karaoke captions and say-along moments.
// ═══════════════════════════════════════════════════════════════

const EARTH_COURSE = {
  id: "course-earth", title: "Where Are We?", subtitle: "Earth, the sky & the firmament", color: "#0ea5e9",
  blurb: "A talk-along video series about you, your home planet, the sky above, and the big questions people have always asked about it.",
  episodes: [
    { id: "v-earth-1", title: "You Are Here", scenes: [
      { kind: "you", say: "Hi! I'm Luma. Let's go on a trip to find out exactly where you are!" },
      { kind: "you", say: "This is you. There's only one of you in the whole wide world." },
      { kind: "home", say: "You live in a home. Your home sits on a street, with neighbors all around." },
      { kind: "town", say: "Your street is part of a town or a city, full of roads, stores, parks, and people." },
      { kind: "country", say: "Your town is inside a country. A country is a big piece of land with its own name and its own flag." },
      { kind: "earth", say: "And every country sits on one giant home that we all share. It's called Earth!" },
      { kind: "earth", say: "Say it with me: I live on planet Earth!", sayAlong: true },
    ] },
    { id: "v-earth-2", title: "Our Home, Earth", scenes: [
      { kind: "earth", say: "Earth is our home. It's made of land, water, and air." },
      { kind: "water", say: "Most of Earth is covered in water. The oceans cover about seventy one parts out of every hundred!" },
      { kind: "land", say: "The big pieces of land are called continents. There are seven of them. Can you find the one where you live?" },
      { kind: "core", say: "Deep under your feet, Earth is very hot. There's rock, then melted rock, and at the very center, a ball of iron called the core." },
      { kind: "air", say: "All around Earth is a blanket of air. It gives us oxygen to breathe and keeps us warm." },
      { kind: "air", say: "Take a big breath with me. In… and out. That air is part of our planet too!", sayAlong: true },
    ] },
    { id: "v-earth-3", title: "Day & Night", scenes: [
      { kind: "sun", say: "This is the Sun. It's a giant ball of hot, glowing gas, and it gives us light and warmth." },
      { kind: "daynight", say: "Earth spins around like a spinning top. It takes one whole day to spin around once." },
      { kind: "daynight", say: "When your side of Earth faces the Sun, it's daytime. When it turns away, it's nighttime." },
      { kind: "orbit", say: "Earth also travels all the way around the Sun. One full trip takes one whole year." },
      { kind: "seasons", say: "Earth is tilted a little bit. That tilt is what gives us seasons: summer, fall, winter, and spring." },
    ] },
    { id: "v-earth-4", title: "The Moon", scenes: [
      { kind: "moon", say: "The Moon is Earth's closest neighbor in the sky. It circles around Earth about once a month." },
      { kind: "phases", say: "The Moon doesn't make its own light. It shines because sunlight bounces off of it." },
      { kind: "phases", say: "As the Moon travels, we see different amounts of its bright side. These are called the phases of the Moon." },
      { kind: "tides", say: "The Moon gently pulls on the oceans. That pull makes the tides go in and out at the beach." },
    ] },
    { id: "v-earth-5", title: "The Sky Above", scenes: [
      { kind: "layers", focus: 0, say: "Let's go up! Near the ground is where birds fly, clouds float, and our weather happens." },
      { kind: "layers", focus: 1, say: "Higher up, airplanes fly above the clouds, about ten kilometers high." },
      { kind: "layers", focus: 2, say: "Higher still is the ozone layer. It works like sunscreen for the whole planet." },
      { kind: "layers", focus: 3, say: "About one hundred kilometers up, the air gets very thin. This is where colorful lights called auroras dance." },
      { kind: "layers", focus: 4, say: "Past that is space. Up here, the space station circles all the way around the Earth." },
    ] },
    { id: "v-earth-6", title: "The Firmament", scenes: [
      { kind: "scroll", say: "A long, long time ago, people looked up at the sky and wondered: what is it made of?" },
      { kind: "firmament", say: "In the very first chapter of the Bible, God makes a firmament, to separate the waters above from the waters below." },
      { kind: "firmament", say: "The Hebrew word is raqia. It means something spread out, like hammered metal. Many ancient people pictured the sky as a great dome." },
      { kind: "firmament", say: "They imagined windows in the dome, that opened to let the rain come pouring down." },
      { kind: "shield", say: "Today, scientists describe layers of air, and an invisible magnetic shield around Earth that protects us from the Sun's strongest rays." },
      { kind: "question", say: "Some people today believe the firmament is a real, solid dome. Others see it as a picture of the sky. Keep asking questions, and you can explore both, deeper in the rabbit hole!" },
    ] },
    { id: "v-earth-7", title: "Our Address in Space", scenes: [
      { kind: "solar", say: "Earth is one of eight planets that travel around the Sun. We're the third planet from the Sun." },
      { kind: "solar", say: "The Sun and all of its planets together are called the solar system." },
      { kind: "galaxy", say: "Our Sun is just one star in a giant spinning family of stars, called the Milky Way galaxy." },
      { kind: "address", say: "So here's your whole address: you, your home, your town, your country, planet Earth, the solar system, and the Milky Way." },
      { kind: "you", say: "And you're right in the middle of it all, asking big questions. Say it with me: I am here, and I am wondering!", sayAlong: true },
    ] },
  ],
};
const COURSES = [EARTH_COURSE];

const COURSE_KEYFRAMES = `
  @keyframes cSpin { from { transform: translateX(0); } to { transform: translateX(calc(-1 * var(--w))); } }
  @keyframes cRot { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
  @keyframes cBob { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-8px); } }
  @keyframes cWave { 0%,100% { transform: rotate(-10deg); } 50% { transform: rotate(35deg); } }
  @keyframes cPop { 0% { transform: scale(0); opacity: 0; } 70% { transform: scale(1.12); opacity: 1; } 100% { transform: scale(1); opacity: 1; } }
  @keyframes cFade { from { opacity: 0; } to { opacity: 1; } }
  @keyframes cRise { from { transform: translateY(0); opacity: 0.9; } to { transform: translateY(-120px); opacity: 0; } }
  @keyframes cDrive { from { transform: translateX(-120px); } to { transform: translateX(760px); } }
  @keyframes cRain { from { transform: translateY(0); opacity: 1; } to { transform: translateY(90px); opacity: 0; } }
  @keyframes cTide { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-22px); } }
  @keyframes cTwinkle { 0%,100% { opacity: 0.25; } 50% { opacity: 1; } }
  @keyframes cGlow { 0%,100% { opacity: 0.55; } 50% { opacity: 1; } }
  @keyframes cUnroll { from { transform: scaleX(0.05); } to { transform: scaleX(1); } }
  @keyframes cDraw { from { stroke-dashoffset: 1200; } to { stroke-dashoffset: 0; } }
  @keyframes cFlag { 0%,100% { transform: skewY(0deg); } 50% { transform: skewY(-6deg); } }
  @keyframes cCurtain { 0%,100% { transform: scaleY(1) translateX(0); opacity: 0.7; } 50% { transform: scaleY(1.15) translateX(8px); opacity: 1; } }
  @keyframes cTalk { 0%,100% { transform: scaleY(0.35); } 50% { transform: scaleY(1); } }
  @keyframes cMic { 0%,100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(236,72,153,0.5); } 50% { transform: scale(1.06); box-shadow: 0 0 0 14px rgba(236,72,153,0); } }
  @keyframes cBlink { 0%,92%,100% { transform: scaleY(1); } 95% { transform: scaleY(0.1); } }
  @keyframes cPlane { from { transform: translateX(-140px); } to { transform: translateX(760px); } }
`;

// deterministic pseudo-random for star fields
const cRand = (i, s = 1) => { const x = Math.sin(i * 12.9898 + s * 78.233) * 43758.5453; return x - Math.floor(x); };

function CStars({ n = 60, seed = 1, h = 360 }) {
  return <g>{Array.from({ length: n }, (_, i) => (
    <circle key={i} cx={cRand(i, seed) * 640} cy={cRand(i + 99, seed) * h} r={cRand(i + 7, seed) * 1.6 + 0.4} fill="#fff"
      style={{ animation: `cTwinkle ${2 + cRand(i + 3, seed) * 3}s ease-in-out ${cRand(i + 5, seed) * 3}s infinite` }} />
  ))}</g>;
}

function CPin({ x, y, label = "You are here", color = "#ef4444" }) {
  return (
    <g style={{ animation: "cBob 2s ease-in-out infinite" }}>
      <g style={{ transformOrigin: `${x}px ${y}px`, animation: "cPop 0.6s ease both" }}>
        <path d={`M${x} ${y} C ${x - 14} ${y - 18} ${x - 14} ${y - 36} ${x} ${y - 38} C ${x + 14} ${y - 36} ${x + 14} ${y - 18} ${x} ${y} Z`} fill={color} />
        <circle cx={x} cy={y - 26} r="5" fill="#fff" />
        {label && <>
          <rect x={x - label.length * 3.6 - 10} y={y - 70} width={label.length * 7.2 + 20} height="24" rx="12" fill="#fff" />
          <text x={x} y={y - 53} textAnchor="middle" fontSize="13" fontWeight="700" fill="#1e293b" fontFamily="'Geist', sans-serif">{label}</text>
        </>}
      </g>
    </g>
  );
}

function CGlobe({ cx, cy, r, speed = 24, id = "g" }) {
  const W = r * 4;
  const blobs = [[0.1, 0.35, 0.5, 0.28], [0.6, 0.62, 0.42, 0.3], [1.1, 0.3, 0.35, 0.22], [1.5, 0.7, 0.5, 0.25], [2.2, 0.42, 0.55, 0.3], [2.9, 0.65, 0.3, 0.2], [3.3, 0.28, 0.45, 0.24]];
  return (
    <g>
      <defs>
        <clipPath id={`${id}-clip`}><circle cx={cx} cy={cy} r={r} /></clipPath>
        <radialGradient id={`${id}-sea`} cx="35%" cy="30%" r="75%"><stop offset="0%" stopColor="#7dd3fc" /><stop offset="100%" stopColor="#1d4ed8" /></radialGradient>
        <radialGradient id={`${id}-shade`} cx="30%" cy="28%" r="80%"><stop offset="55%" stopColor="#000" stopOpacity="0" /><stop offset="100%" stopColor="#000" stopOpacity="0.45" /></radialGradient>
      </defs>
      <circle cx={cx} cy={cy} r={r + 10} fill="#7dd3fc" opacity="0.25" />
      <circle cx={cx} cy={cy} r={r} fill={`url(#${id}-sea)`} />
      <g clipPath={`url(#${id}-clip)`}>
        <g style={{ "--w": `${W}px`, animation: `cSpin ${speed}s linear infinite` }}>
          {[0, W].map(off => blobs.map(([bx, by, bw, bh], i) => (
            <ellipse key={`${off}-${i}`} cx={cx - r + off + bx * r} cy={cy - r + by * 2 * r} rx={bw * r} ry={bh * r} fill={i % 3 === 0 ? "#4ade80" : i % 3 === 1 ? "#22c55e" : "#86efac"} />
          )))}
          {[0, W].map(off => [0.4, 1.8, 3.0].map((bx, i) => (
            <ellipse key={`c${off}-${i}`} cx={cx - r + off + bx * r} cy={cy - r * 0.45 + i * r * 0.5} rx={r * 0.32} ry={r * 0.08} fill="#fff" opacity="0.8" />
          )))}
        </g>
      </g>
      <circle cx={cx} cy={cy} r={r} fill={`url(#${id}-shade)`} />
      <ellipse cx={cx - r * 0.35} cy={cy - r * 0.45} rx={r * 0.25} ry={r * 0.12} fill="#fff" opacity="0.35" transform={`rotate(-30 ${cx - r * 0.35} ${cy - r * 0.45})`} />
    </g>
  );
}

function CKid({ x, y, s = 1 }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <ellipse cx="0" cy="92" rx="30" ry="6" fill="#000" opacity="0.12" />
      <rect x="-12" y="52" width="10" height="38" rx="5" fill="#334155" />
      <rect x="2" y="52" width="10" height="38" rx="5" fill="#334155" />
      <rect x="-22" y="4" width="44" height="54" rx="18" fill="#f472b6" />
      <g style={{ transformOrigin: "18px 12px", animation: "cWave 1.2s ease-in-out infinite" }}>
        <rect x="16" y="-26" width="10" height="40" rx="5" fill="#f472b6" />
        <circle cx="21" cy="-28" r="7" fill="#fcd9b6" />
      </g>
      <rect x="-28" y="10" width="10" height="36" rx="5" fill="#f472b6" />
      <circle cx="0" cy="-18" r="22" fill="#fcd9b6" />
      <path d="M-22 -22 Q-20 -44 0 -42 Q22 -44 22 -22 Q10 -34 -22 -22 Z" fill="#7c2d12" />
      <circle cx="-7" cy="-17" r="2.6" fill="#1e293b" /><circle cx="7" cy="-17" r="2.6" fill="#1e293b" />
      <path d="M-7 -8 Q0 -2 7 -8" stroke="#1e293b" strokeWidth="2.2" fill="none" strokeLinecap="round" />
      <circle cx="-13" cy="-10" r="3.5" fill="#fb7185" opacity="0.5" /><circle cx="13" cy="-10" r="3.5" fill="#fb7185" opacity="0.5" />
    </g>
  );
}

function CHouse({ x, y, s = 1, body = "#fde68a", roof = "#f87171" }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <rect x="-50" y="-60" width="100" height="70" rx="6" fill={body} />
      <path d="M-62 -58 L0 -110 L62 -58 Z" fill={roof} strokeLinejoin="round" />
      <rect x="-14" y="-24" width="28" height="34" rx="4" fill="#92400e" />
      <rect x="22" y="-46" width="20" height="18" rx="3" fill="#bae6fd" style={{ animation: "cGlow 3s ease-in-out infinite" }} />
      <rect x="-42" y="-46" width="20" height="18" rx="3" fill="#bae6fd" />
    </g>
  );
}

const SKY_DAY = ["#bae6fd", "#e0f2fe"];
const SKY_SPACE = ["#0b1026", "#1e1b4b"];

function SceneArt({ scene }) {
  const k = scene.kind;
  const bg = (top, bot, id = "bg") => (
    <>
      <defs><linearGradient id={`c-${id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={top} /><stop offset="100%" stopColor={bot} /></linearGradient></defs>
      <rect width="640" height="360" fill={`url(#c-${id})`} />
    </>
  );
  const space = <>{bg(...SKY_SPACE, "space")}<CStars /></>;
  const day = bg(...SKY_DAY, "day");
  const ground = <><ellipse cx="320" cy="420" rx="520" ry="120" fill="#86efac" /><ellipse cx="320" cy="440" rx="560" ry="120" fill="#4ade80" /></>;
  const sunDisk = (x, y, r = 40, face = false) => (
    <g>
      <g style={{ transformOrigin: `${x}px ${y}px`, animation: "cRot 30s linear infinite" }}>
        {Array.from({ length: 12 }, (_, i) => { const a = (i / 12) * Math.PI * 2; return <line key={i} x1={x + Math.cos(a) * (r + 8)} y1={y + Math.sin(a) * (r + 8)} x2={x + Math.cos(a) * (r + 22)} y2={y + Math.sin(a) * (r + 22)} stroke="#fbbf24" strokeWidth="6" strokeLinecap="round" />; })}
      </g>
      <circle cx={x} cy={y} r={r + 12} fill="#fde047" opacity="0.3" style={{ animation: "cGlow 3s ease-in-out infinite" }} />
      <circle cx={x} cy={y} r={r} fill="#facc15" />
      {face && <><circle cx={x - r * 0.3} cy={y - r * 0.1} r={r * 0.08} fill="#92400e" /><circle cx={x + r * 0.3} cy={y - r * 0.1} r={r * 0.08} fill="#92400e" /><path d={`M${x - r * 0.3} ${y + r * 0.25} Q${x} ${y + r * 0.5} ${x + r * 0.3} ${y + r * 0.25}`} stroke="#92400e" strokeWidth="4" fill="none" strokeLinecap="round" /></>}
    </g>
  );
  const label = (x, y, t, delay = 0, color = "#1e293b", bgc = "#ffffffee") => (
    <g style={{ transformOrigin: `${x}px ${y}px`, animation: `cPop 0.5s ease ${delay}s both` }}>
      <rect x={x - t.length * 3.9 - 12} y={y - 15} width={t.length * 7.8 + 24} height="30" rx="15" fill={bgc} />
      <text x={x} y={y + 5} textAnchor="middle" fontSize="14" fontWeight="700" fill={color} fontFamily="'Geist', sans-serif">{t}</text>
    </g>
  );

  switch (k) {
    case "you":
      return <>{day}{ground}
        {[0, 1, 2, 3, 4].map(i => <text key={i} x={140 + i * 90} y={80 + (i % 2) * 30} fontSize="22" style={{ animation: `cBob ${2 + i * 0.3}s ease-in-out infinite` }}>{["✨", "💛", "⭐", "💙", "✨"][i]}</text>)}
        <CKid x={320} y={200} s={1.3} />
        <CPin x={320} y={128} label="This is YOU" />
      </>;
    case "home":
      return <>{day}{ground}
        <CHouse x={320} y={270} s={1.3} />
        <CHouse x={120} y={290} s={0.8} body="#bbf7d0" roof="#60a5fa" />
        <CHouse x={520} y={290} s={0.8} body="#fbcfe8" roof="#a78bfa" />
        <CKid x={420} y={250} s={0.55} />
        {[60, 230, 590].map((x, i) => <g key={i}><rect x={x - 5} y="262" width="10" height="30" fill="#92400e" /><circle cx={x} cy="250" r="22" fill="#22c55e" /></g>)}
        <CPin x={320} y={115} label="Your home" />
      </>;
    case "town":
      return <>{day}
        {sunDisk(560, 70, 28)}
        {[[40, 150, "#fca5a5"], [110, 110, "#93c5fd"], [180, 170, "#fde68a"], [250, 90, "#c4b5fd"], [330, 140, "#86efac"], [400, 100, "#fdba74"], [470, 160, "#f9a8d4"], [540, 120, "#a5f3fc"]].map(([x, h, c], i) => (
          <g key={i} style={{ transformOrigin: `${x + 30}px 280px`, animation: `cPop 0.5s ease ${i * 0.08}s both` }}>
            <rect x={x} y={280 - h} width="60" height={h} rx="6" fill={c} />
            {Array.from({ length: Math.floor(h / 30) }, (_, j) => <g key={j}><rect x={x + 10} y={290 - h + j * 30} width="14" height="14" rx="3" fill="#fff" opacity="0.8" /><rect x={x + 36} y={290 - h + j * 30} width="14" height="14" rx="3" fill="#fff" opacity="0.8" /></g>)}
          </g>
        ))}
        <rect x="0" y="280" width="640" height="80" fill="#64748b" />
        <line x1="0" x2="640" y1="320" y2="320" stroke="#fff" strokeWidth="4" strokeDasharray="24 18" />
        <g style={{ animation: "cDrive 7s linear infinite" }}>
          <rect x="0" y="290" width="70" height="24" rx="10" fill="#ef4444" /><rect x="14" y="276" width="40" height="18" rx="8" fill="#ef4444" />
          <circle cx="16" cy="316" r="8" fill="#1e293b" /><circle cx="54" cy="316" r="8" fill="#1e293b" />
        </g>
        <CPin x={360} y={120} label="Your town" />
      </>;
    case "country":
      return <>{bg("#e0f2fe", "#bae6fd", "sea")}
        {[0, 1, 2].map(i => <path key={i} d={`M0 ${300 + i * 20} Q160 ${290 + i * 20} 320 ${300 + i * 20} T640 ${300 + i * 20}`} stroke="#7dd3fc" strokeWidth="3" fill="none" opacity="0.6" />)}
        <path d="M150 90 Q210 40 300 70 Q380 40 450 90 Q520 120 500 190 Q520 260 430 280 Q330 310 240 280 Q150 270 140 200 Q110 140 150 90 Z" fill="#86efac" stroke="#16a34a" strokeWidth="4" strokeDasharray="1200" style={{ animation: "cDraw 2.5s ease both" }} />
        <path d="M150 90 Q210 40 300 70 Q380 40 450 90 Q520 120 500 190 Q520 260 430 280 Q330 310 240 280 Q150 270 140 200 Q110 140 150 90 Z" fill="none" stroke="#fff" strokeWidth="2" strokeDasharray="6 8" opacity="0.8" />
        <line x1="420" y1="200" x2="420" y2="110" stroke="#475569" strokeWidth="4" />
        <g style={{ transformOrigin: "420px 110px", animation: "cFlag 1.6s ease-in-out infinite" }}>
          <rect x="422" y="110" width="60" height="38" rx="3" fill="#ef4444" /><rect x="422" y="122" width="60" height="12" fill="#fff" />
        </g>
        <circle cx="280" cy="190" r="10" fill="#ef4444" />
        <CPin x={280} y={188} label="Your town" />
      </>;
    case "earth":
      return <>{space}<CGlobe cx={320} cy={185} r={115} id="e1" /><CPin x={300} y={130} label="You are here" /></>;
    case "water":
      return <>{space}<CGlobe cx={250} cy={185} r={110} id="e2" />
        <g transform="translate(470 180)">
          <circle r="70" fill="none" stroke="#1e293b" strokeWidth="22" />
          <circle r="70" fill="none" stroke="#38bdf8" strokeWidth="22" strokeDasharray={`${0.71 * 440} 440`} transform="rotate(-90)" style={{ strokeDashoffset: 0, animation: "cDraw 2s ease both" }} />
          <circle r="70" fill="none" stroke="#4ade80" strokeWidth="22" strokeDasharray={`${0.29 * 440} 440`} strokeDashoffset={-0.71 * 440} transform="rotate(-90)" style={{ animation: "cFade 1s ease 1.6s both" }} />
          <text y="-4" textAnchor="middle" fontSize="30" fontWeight="800" fill="#fff" fontFamily="'Geist', sans-serif">71%</text>
          <text y="20" textAnchor="middle" fontSize="13" fontWeight="600" fill="#bae6fd" fontFamily="'Geist', sans-serif">water</text>
        </g>
      </>;
    case "land": {
      const names = ["Asia", "Africa", "North America", "South America", "Antarctica", "Europe", "Australia"];
      return <>{space}<CGlobe cx={320} cy={185} r={100} id="e3" />
        {names.map((n, i) => { const a = (i / 7) * Math.PI * 2 - Math.PI / 2; return <g key={n}>{label(320 + Math.cos(a) * 210, 185 + Math.sin(a) * 140, n, 0.3 + i * 0.35)}</g>; })}
      </>;
    }
    case "core":
      return <>{space}
        <g transform="translate(320 345)">
          {[[215, "#65a30d", "Crust"], [192, "#ea580c", "Mantle"], [120, "#f59e0b", "Outer core"], [58, "#fef08a", "Inner core"]].map(([r, c, n], i) => (
            <g key={n} style={{ animation: `cFade 0.6s ease ${i * 0.5}s both` }}>
              <path d={`M${-r} 0 A${r} ${r} 0 0 1 ${r} 0 Z`} fill={c} />
            </g>
          ))}
          <circle r="34" fill="#fff" opacity="0.35" style={{ animation: "cGlow 1.5s ease-in-out infinite" }} />
          {[[215, "Crust", "#fff"], [192, "Mantle", "#fff"], [120, "Outer core", "#7c2d12"], [58, "Inner core", "#7c2d12"]].map(([r, n, col], i) => (
            <text key={n} x="0" y={-r + (i === 0 ? 15 : i === 1 ? 44 : 36)} textAnchor="middle" fontSize="14" fontWeight="800" fill={col} fontFamily="'Geist', sans-serif" style={{ animation: `cFade 0.6s ease ${0.3 + i * 0.5}s both` }}>{n}</text>
          ))}
        </g>
        <CKid x={320} y={62} s={0.4} />
      </>;
    case "air":
      return <>{space}
        <circle cx="320" cy="185" r="150" fill="#7dd3fc" opacity="0.18" style={{ animation: "cGlow 3s ease-in-out infinite" }} />
        <circle cx="320" cy="185" r="132" fill="#7dd3fc" opacity="0.2" />
        <CGlobe cx={320} cy={185} r={110} id="e4" />
        {Array.from({ length: 10 }, (_, i) => (
          <g key={i} style={{ animation: `cRise ${3 + (i % 3)}s ease-in ${i * 0.4}s infinite` }}>
            <circle cx={180 + i * 30} cy={300} r="11" fill="#e0f2fe" opacity="0.9" />
            <text x={180 + i * 30} y={304} textAnchor="middle" fontSize="9" fontWeight="700" fill="#0369a1" fontFamily="'Geist', sans-serif">O₂</text>
          </g>
        ))}
      </>;
    case "sun":
      return <>{bg("#fef3c7", "#fde68a", "warm")}{sunDisk(320, 180, 90, true)}</>;
    case "daynight":
      return <>{space}
        {sunDisk(90, 180, 55)}
        {Array.from({ length: 6 }, (_, i) => <line key={i} x1="160" x2="330" y1={110 + i * 28} y2={110 + i * 28} stroke="#fde047" strokeWidth="2" strokeDasharray="8 10" opacity="0.5" style={{ animation: `cFade 1s ease ${i * 0.1}s both` }} />)}
        <CGlobe cx={430} cy={180} r={110} speed={14} id="e5" />
        <path d="M430 70 A110 110 0 0 1 430 290 A55 110 0 0 0 430 70 Z" fill="#0b1026" opacity="0.6" />
        {label(360, 320, "☀ Day", 0.2, "#92400e", "#fef3c7")}
        {label(500, 320, "☾ Night", 0.5, "#e0e7ff", "#1e1b4b")}
      </>;
    case "orbit": {
      const path = "M120 180 A200 110 0 1 0 520 180 A200 110 0 1 0 120 180";
      return <>{space}
        <path d={path} fill="none" stroke="#94a3b8" strokeWidth="2" strokeDasharray="6 8" />
        {sunDisk(320, 180, 45)}
        <g><circle r="20" fill="#3b82f6" /><ellipse cx="-4" cy="-6" rx="10" ry="6" fill="#22c55e" /><animateMotion dur="10s" repeatCount="indefinite" path={path} /></g>
        {label(320, 330, "1 trip around the Sun = 1 year", 0.4)}
      </>;
    }
    case "seasons":
      return <>{space}{sunDisk(320, 180, 42)}
        {[["Summer", 110, 180], ["Fall", 320, 60], ["Winter", 530, 180], ["Spring", 320, 305]].map(([n, x, y], i) => (
          <g key={n} style={{ animation: `cFade 0.6s ease ${i * 0.5}s both` }}>
            <g transform={`rotate(23 ${x} ${y})`}><circle cx={x} cy={y} r="26" fill="#3b82f6" /><ellipse cx={x} cy={y - 8} rx="16" ry="8" fill="#22c55e" /><line x1={x} x2={x} y1={y - 36} y2={y + 36} stroke="#fff" strokeWidth="2" strokeDasharray="3 3" /></g>
            {label(x, y + (y > 250 ? -48 : 52), n, 0.2 + i * 0.5)}
          </g>
        ))}
      </>;
    case "moon": {
      const path = "M180 180 A140 90 0 1 0 460 180 A140 90 0 1 0 180 180";
      return <>{space}<CGlobe cx={320} cy={180} r={70} id="e6" />
        <path d={path} fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeDasharray="4 8" />
        <g><circle r="22" fill="#e2e8f0" /><circle cx="-6" cy="-5" r="4" fill="#cbd5e1" /><circle cx="7" cy="6" r="3" fill="#cbd5e1" /><animateMotion dur="8s" repeatCount="indefinite" path={path} /></g>
        {label(320, 320, "About 1 month for each trip", 0.4)}
      </>;
    }
    case "phases":
      return <>{space}
        {Array.from({ length: 8 }, (_, i) => {
          const x = 70 + i * 71, y = 180, f = i / 8; // fraction of cycle
          const lit = Math.cos(f * Math.PI * 2); // 1 = new, -1 = full
          return (
            <g key={i} style={{ transformOrigin: `${x}px ${y}px`, animation: `cPop 0.5s ease ${i * 0.35}s both` }}>
              <circle cx={x} cy={y} r="28" fill="#1e293b" />
              <clipPath id={`ph${i}`}><circle cx={x} cy={y} r="28" /></clipPath>
              <g clipPath={`url(#ph${i})`}>
                {f === 0 ? null : f === 0.5 ? <circle cx={x} cy={y} r="28" fill="#f1f5f9" /> :
                  <>
                    <rect x={f < 0.5 ? x : x - 28} y={y - 28} width="28" height="56" fill="#f1f5f9" />
                    <ellipse cx={x} cy={y} rx={Math.abs(lit) * 28} ry="28" fill={lit > 0 ? "#1e293b" : "#f1f5f9"} />
                  </>}
              </g>
              <circle cx={x} cy={y} r="28" fill="none" stroke="#475569" />
            </g>
          );
        })}
        {label(320, 290, "New → Full → New again", 3)}
      </>;
    case "tides":
      return <>{bg("#1e3a8a", "#60a5fa", "dusk")}<CStars n={25} seed={3} h={150} />
        <circle cx="500" cy="80" r="34" fill="#f1f5f9" /><circle cx="490" cy="72" r="6" fill="#cbd5e1" />
        {[0, 1, 2].map(i => <line key={i} x1="480" y1={130 + i * 10} x2="400" y2={200 + i * 10} stroke="#e2e8f0" strokeWidth="2" strokeDasharray="5 6" opacity="0.6" style={{ animation: `cGlow 2s ease-in-out ${i * 0.3}s infinite` }} />)}
        <path d="M0 300 Q200 270 640 290 L640 360 L0 360 Z" fill="#fde68a" />
        <g style={{ animation: "cTide 5s ease-in-out infinite" }}>
          <path d="M0 250 Q80 235 160 250 T320 250 T480 250 T640 250 L640 360 L0 360 Z" fill="#0ea5e9" opacity="0.85" />
          <path d="M0 262 Q80 248 160 262 T320 262 T480 262 T640 262" stroke="#fff" strokeWidth="3" fill="none" opacity="0.7" />
        </g>
        {label(160, 60, "The Moon's pull makes tides", 0.3)}
      </>;
    case "layers": {
      const f = scene.focus || 0;
      const ty = -(4 - f) * 300 + 30;
      return <>
        <g style={{ transform: `translateY(${ty}px)`, transition: "transform 1.6s cubic-bezier(0.65,0,0.35,1)" }}>
          <defs><linearGradient id="c-lay" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#020617" /><stop offset="25%" stopColor="#1e1b4b" /><stop offset="45%" stopColor="#312e81" /><stop offset="62%" stopColor="#1d4ed8" /><stop offset="80%" stopColor="#38bdf8" /><stop offset="100%" stopColor="#bae6fd" />
          </linearGradient></defs>
          <rect x="0" y="0" width="640" height="1500" fill="url(#c-lay)" />
          <CStars n={70} seed={5} h={420} />
          {/* space station */}
          <g transform="translate(360 170)"><g style={{ animation: "cBob 4s ease-in-out infinite" }}>
            <rect x="-50" y="-6" width="100" height="12" rx="4" fill="#cbd5e1" /><rect x="-90" y="-26" width="36" height="52" fill="#3b82f6" /><rect x="54" y="-26" width="36" height="52" fill="#3b82f6" /><rect x="-12" y="-14" width="24" height="28" rx="4" fill="#e2e8f0" />
          </g></g>
          {/* aurora */}
          {[0, 1, 2, 3].map(i => <path key={i} d={`M${60 + i * 140} 560 Q${100 + i * 140} 420 ${140 + i * 140} 560`} stroke={i % 2 ? "#a78bfa" : "#4ade80"} strokeWidth="26" fill="none" opacity="0.7" strokeLinecap="round" style={{ transformOrigin: `${100 + i * 140}px 560px`, animation: `cCurtain ${3 + i * 0.5}s ease-in-out infinite` }} />)}
          {/* ozone */}
          <rect x="0" y="760" width="640" height="60" fill="#fb923c" opacity="0.35" style={{ animation: "cGlow 3s ease-in-out infinite" }} />
          <rect x="0" y="775" width="640" height="30" fill="#fdba74" opacity="0.4" />
          {/* plane */}
          <g style={{ animation: "cPlane 9s linear infinite" }}>
            <g transform="translate(0 1060)"><rect x="0" y="-8" width="90" height="16" rx="8" fill="#f8fafc" /><path d="M30 0 L55 -34 L66 -34 L52 0 Z" fill="#e2e8f0" /><path d="M8 -6 L0 -26 L12 -26 L22 -6 Z" fill="#ef4444" /></g>
          </g>
          {[80, 300, 520].map((x, i) => <g key={i} opacity="0.95"><ellipse cx={x} cy={1140 + i * 8} rx="60" ry="20" fill="#fff" /><ellipse cx={x + 30} cy={1128 + i * 8} rx="36" ry="20" fill="#fff" /></g>)}
          {/* weather + birds + ground */}
          {[140, 420].map((x, i) => <g key={i}><ellipse cx={x} cy={1290} rx="70" ry="26" fill="#f8fafc" /><ellipse cx={x + 40} cy={1276} rx="40" ry="24" fill="#f8fafc" /></g>)}
          {[0, 1, 2].map(i => <path key={i} d={`M${250 + i * 40} ${1330 + i * 10} q8 -8 16 0 q8 -8 16 0`} stroke="#1e293b" strokeWidth="2.5" fill="none" style={{ animation: `cBob ${1.5 + i * 0.3}s ease-in-out infinite` }} />)}
          <ellipse cx="320" cy="1560" rx="520" ry="150" fill="#4ade80" />
        </g>
        {[["Space · 400 km", 4], ["Aurora · 100 km", 3], ["Ozone · 25 km", 2], ["Airplanes · 10 km", 1], ["Weather · near the ground", 0]].map(([t, i]) => i === f && (
          <g key={t}>{label(320, 36, t, 0.8, "#1e293b")}</g>
        ))}
        <g transform="translate(608 40)">
          {[4, 3, 2, 1, 0].map((i, j) => <circle key={i} cx="0" cy={j * 22} r={i === f ? 7 : 4} fill={i === f ? "#fff" : "#ffffff66"} style={{ transition: "all 0.6s" }} />)}
        </g>
      </>;
    }
    case "scroll":
      return <>{bg("#1e1b4b", "#7c3aed", "night")}<CStars n={50} seed={7} h={220} />
        <g style={{ transformOrigin: "320px 180px", animation: "cUnroll 1.6s cubic-bezier(0.22,1,0.36,1) both" }}>
          <rect x="120" y="70" width="400" height="220" rx="10" fill="#f3e2b8" />
          <rect x="108" y="62" width="18" height="236" rx="9" fill="#b45309" /><rect x="514" y="62" width="18" height="236" rx="9" fill="#b45309" />
          <path d="M170 230 Q320 110 470 230" stroke="#92400e" strokeWidth="3" fill="none" strokeDasharray="1200" style={{ animation: "cDraw 3s ease 1s both" }} />
          <line x1="160" x2="480" y1="232" y2="232" stroke="#92400e" strokeWidth="3" />
          <circle cx="260" cy="180" r="12" fill="#f59e0b" style={{ animation: "cFade 1s ease 2s both" }} />
          <circle cx="380" cy="175" r="9" fill="#d6d3d1" style={{ animation: "cFade 1s ease 2.4s both" }} />
          {[0, 1, 2, 3, 4].map(i => <text key={i} x={210 + i * 55} y={150 + (i % 2) * 18} fontSize="12" fill="#92400e" style={{ animation: `cFade 0.6s ease ${2.6 + i * 0.2}s both` }}>✦</text>)}
        </g>
        <g transform="translate(560 300)"><circle cx="0" cy="-30" r="12" fill="#1e1b4b" opacity="0.8" /><rect x="-10" y="-18" width="20" height="40" rx="8" fill="#1e1b4b" opacity="0.8" /></g>
      </>;
    case "firmament":
      return <>{bg("#0c4a6e", "#0ea5e9", "fwater")}
        {/* waters above */}
        {[0, 1, 2].map(i => <path key={i} d={`M0 ${30 + i * 16} Q80 ${20 + i * 16} 160 ${30 + i * 16} T320 ${30 + i * 16} T480 ${30 + i * 16} T640 ${30 + i * 16}`} stroke="#bae6fd" strokeWidth="3" fill="none" opacity="0.6" />)}
        {label(320, 22, "Waters above", 0.3, "#0c4a6e")}
        {/* dome */}
        <path d="M60 270 A260 210 0 0 1 580 270 Z" fill="#1e3a8a" />
        <path d="M60 270 A260 210 0 0 1 580 270" stroke="#e0f2fe" strokeWidth="5" fill="none" strokeDasharray="1200" style={{ animation: "cDraw 2.4s ease both" }} />
        <CStars n={30} seed={9} h={200} />
        <g transform="translate(0 40)"><CStars n={20} seed={11} h={160} /></g>
        <circle cx="220" cy="170" r="22" fill="#facc15" />
        <circle cx="430" cy="150" r="16" fill="#e2e8f0" />
        {/* windows + rain */}
        {[[190, 108], [320, 66], [450, 108]].map(([x, y], i) => (
          <g key={i}>
            <rect x={x - 14} y={y - 10} width="28" height="20" rx="4" fill="#7dd3fc" stroke="#e0f2fe" strokeWidth="2" style={{ animation: `cGlow 2s ease-in-out ${i * 0.4}s infinite` }} />
            {[0, 1, 2].map(j => <line key={j} x1={x - 8 + j * 8} x2={x - 8 + j * 8} y1={y + 14} y2={y + 26} stroke="#7dd3fc" strokeWidth="3" strokeLinecap="round" style={{ animation: `cRain 1.2s linear ${j * 0.3 + i * 0.2}s infinite` }} />)}
          </g>
        ))}
        {/* land + waters below */}
        <ellipse cx="320" cy="272" rx="280" ry="22" fill="#16a34a" />
        <ellipse cx="320" cy="266" rx="250" ry="14" fill="#4ade80" />
        {[0, 1].map(i => <path key={i} d={`M0 ${315 + i * 18} Q80 ${305 + i * 18} 160 ${315 + i * 18} T320 ${315 + i * 18} T480 ${315 + i * 18} T640 ${315 + i * 18}`} stroke="#bae6fd" strokeWidth="3" fill="none" opacity="0.6" />)}
        {label(320, 340, "Waters below", 0.6, "#0c4a6e")}
      </>;
    case "shield":
      return <>{space}
        {sunDisk(40, 180, 60)}
        {Array.from({ length: 9 }, (_, i) => {
          const y = 90 + i * 22;
          const p = `M110 ${y} L${300 + Math.abs(i - 4) * 18} ${y} Q${360} ${y < 180 ? y - 70 : y + 70} 640 ${y < 180 ? y - 120 : y + 120}`;
          return <circle key={i} r="3.5" fill="#fde047"><animateMotion dur={`${2.5 + (i % 3) * 0.5}s`} begin={`${i * 0.3}s`} repeatCount="indefinite" path={p} /></circle>;
        })}
        {[70, 100, 130].map((r, i) => (
          <g key={r} style={{ animation: `cGlow 2.5s ease-in-out ${i * 0.4}s infinite` }}>
            <ellipse cx={440 - r * 0.2} cy="180" rx={r * 1.25} ry={r} fill="none" stroke="#a78bfa" strokeWidth="2.5" opacity="0.8" />
          </g>
        ))}
        <CGlobe cx={450} cy={180} r={55} id="e7" />
        {label(450, 330, "Earth's magnetic shield", 0.5)}
      </>;
    case "question":
      return <>{bg("#1e1b4b", "#4c1d95", "q")}<CStars n={40} seed={13} />
        <g transform="translate(150 190)"><g style={{ animation: "cPop 0.6s ease 0.2s both" }}>
          <path d="M-100 40 A100 100 0 0 1 100 40 Z" fill="#1e3a8a" stroke="#e0f2fe" strokeWidth="3" />
          <ellipse cx="0" cy="42" rx="110" ry="12" fill="#4ade80" />
          <text x="0" y="90" textAnchor="middle" fontSize="15" fontWeight="700" fill="#e0e7ff" fontFamily="'Geist', sans-serif">A dome above?</text>
        </g></g>
        <text x="320" y="210" textAnchor="middle" fontSize="110" fontWeight="800" fill="#f9a8d4" fontFamily="'Geist', sans-serif" style={{ animation: "cBob 2s ease-in-out infinite" }}>?</text>
        <g style={{ animation: "cPop 0.6s ease 0.6s both", transformOrigin: "490px 170px" }}>
          <circle cx="490" cy="170" r="92" fill="#7dd3fc" opacity="0.2" />
          <CGlobe cx={490} cy={170} r={70} id="e8" />
          <text x="490" y="290" textAnchor="middle" fontSize="15" fontWeight="700" fill="#e0e7ff" fontFamily="'Geist', sans-serif">Layers of sky?</text>
        </g>
      </>;
    case "solar": {
      const planets = [[60, "#a8a29e", 6, 4], [85, "#fbbf24", 9, 7], [115, "#3b82f6", 10, 10], [145, "#ef4444", 8, 14], [185, "#f59e0b", 18, 22], [225, "#fcd34d", 15, 30], [260, "#67e8f9", 12, 40], [292, "#6366f1", 12, 50]];
      return <>{space}
        <g transform="translate(320 180) scale(1 0.55)">
          {planets.map(([r], i) => <circle key={i} r={r} fill="none" stroke={i === 2 ? "#60a5fa" : "#ffffff22"} strokeWidth={i === 2 ? 2.5 : 1.2} />)}
        </g>
        {sunDisk(320, 180, 26)}
        {planets.map(([r, c, s, dur], i) => (
          <g key={i}>
            <circle r={s * 0.8} fill={c}><animateMotion dur={`${dur}s`} repeatCount="indefinite" path={`M${320 - r} 180 A${r} ${r * 0.55} 0 1 0 ${320 + r} 180 A${r} ${r * 0.55} 0 1 0 ${320 - r} 180`} /></circle>
            {i === 2 && <g><text fontSize="12" fontWeight="800" fill="#fff" fontFamily="'Geist', sans-serif" y="-14" textAnchor="middle">Earth · #3</text><animateMotion dur={`${dur}s`} repeatCount="indefinite" path={`M${320 - r} 180 A${r} ${r * 0.55} 0 1 0 ${320 + r} 180 A${r} ${r * 0.55} 0 1 0 ${320 - r} 180`} /></g>}
          </g>
        ))}
      </>;
    }
    case "galaxy":
      return <>{bg("#020617", "#1e1b4b", "gal")}<CStars n={80} seed={17} />
        <g style={{ transformOrigin: "320px 180px", animation: "cRot 60s linear infinite" }}>
          <g transform="translate(320 180) scale(1 0.6)">
            <circle r="40" fill="#fde68a" opacity="0.8" /><circle r="70" fill="#fde68a" opacity="0.2" />
            {[0, 1].map(arm => Array.from({ length: 70 }, (_, i) => {
              const t = i / 70 * 3.2; const a = t * 2.2 + arm * Math.PI; const rr = 30 + t * 70;
              return <circle key={`${arm}-${i}`} cx={Math.cos(a) * rr + (cRand(i, arm) - 0.5) * 18} cy={Math.sin(a) * rr + (cRand(i + 40, arm) - 0.5) * 18} r={cRand(i + 9, arm) * 2 + 0.8} fill={i % 5 ? "#c4b5fd" : "#f0abfc"} opacity="0.85" />;
            }))}
          </g>
        </g>
        <CPin x={430} y={205} label="Our Sun is here" color="#f472b6" />
      </>;
    case "address": {
      const rows = ["You", "Your home", "Your town", "Your country", "Planet Earth", "The solar system", "The Milky Way"];
      const cols = ["#f472b6", "#fbbf24", "#4ade80", "#38bdf8", "#60a5fa", "#a78bfa", "#e879f9"];
      return <>{space}
        <line x1="320" x2="320" y1="40" y2="318" stroke="#ffffff33" strokeWidth="2" strokeDasharray="4 6" />
        {rows.map((r, i) => {
          const y = 318 - i * 45;
          const w = r.length * 9 + 60;
          return (
            <g key={r} style={{ transformOrigin: `320px ${y}px`, animation: `cPop 0.55s ease ${i * 0.7}s both` }}>
              <rect x={320 - w / 2} y={y - 17} width={w} height="34" rx="17" fill="#0f172a" stroke={cols[i]} strokeWidth="2.5" />
              <circle cx={320 - w / 2 + 18} cy={y} r="6" fill={cols[i]} />
              <text x={328} y={y + 5} textAnchor="middle" fontSize="15" fontWeight="700" fill="#fff" fontFamily="'Geist', sans-serif">{r}</text>
            </g>
          );
        })}
      </>;
    }
    default:
      return <>{space}<CGlobe cx={320} cy={185} r={110} id="e9" /></>;
  }
}

// Luma — the narrator. Mouth moves while speaking.
function Luma({ talking, size = 64 }) {
  return (
    <div style={{ width: size, height: size, position: "relative", animation: "cBob 3s ease-in-out infinite" }}>
      <div style={{ position: "absolute", inset: -10, borderRadius: "50%", background: "radial-gradient(circle, rgba(56,189,248,0.55), transparent 65%)", filter: "blur(4px)" }} />
      <div style={{ position: "absolute", inset: 0, borderRadius: "50%", background: "radial-gradient(circle at 30% 25%, #ffffff, #38bdf8 45%, #6d28d9 115%)", boxShadow: "inset -5px -7px 14px rgba(0,0,0,0.3), inset 3px 5px 10px rgba(255,255,255,0.6)", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: size * 0.06 }}>
        <div style={{ display: "flex", gap: size * 0.16, marginTop: size * 0.05 }}>
          {[0, 1].map(i => <span key={i} style={{ width: size * 0.11, height: size * 0.16, borderRadius: "50%", background: "#0f172a", display: "block", animation: "cBlink 4s infinite" }} />)}
        </div>
        <span style={{ width: size * 0.2, height: size * 0.12, borderRadius: `0 0 ${size}px ${size}px`, background: "#0f172a", display: "block", transformOrigin: "top", animation: talking ? "cTalk 0.28s ease-in-out infinite" : "none", transform: talking ? undefined : "scaleY(0.5)" }} />
      </div>
    </div>
  );
}

// ─── The video player ───
function CoursePlayer({ course, startEp = 0, onClose, watched, onEpisodeDone, onDeeper }) {
  const [ep, setEp] = useState(startEp);
  const [sc, setSc] = useState(0);
  const [started, setStarted] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [voiceOn, setVoiceOn] = useState(typeof window !== "undefined" && "speechSynthesis" in window);
  const [cc, setCc] = useState(true);
  const [rate, setRate] = useState(1);
  const [spoken, setSpoken] = useState(0);   // chars spoken (from speech boundaries)
  const [elapsed, setElapsed] = useState(0); // ms into the current scene
  const [talking, setTalking] = useState(false);
  const [sayAlongNow, setSayAlongNow] = useState(false);
  const [epEnded, setEpEnded] = useState(false);
  const [voices, setVoices] = useState([]);
  const boundarySeen = useRef(false);
  const episode = course.episodes[ep];
  const scene = episode.scenes[sc];
  const words = scene.say.split(" ").length;
  const est = (words / (2.6 * rate)) * 1000 + 900;

  useEffect(() => {
    if (!("speechSynthesis" in window)) return;
    const load = () => setVoices(window.speechSynthesis.getVoices());
    load();
    window.speechSynthesis.addEventListener?.("voiceschanged", load);
    return () => { window.speechSynthesis.removeEventListener?.("voiceschanged", load); window.speechSynthesis.cancel(); };
  }, []);
  const voice = useMemo(() => {
    const en = voices.filter(v => /^en/i.test(v.lang));
    const pref = ["Samantha", "Google US English", "Microsoft Aria", "Microsoft Jenny", "Karen", "Moira", "Tessa"];
    return pref.map(n => en.find(v => v.name.includes(n))).find(Boolean) || en[0] || null;
  }, [voices]);

  const advance = () => {
    setSayAlongNow(false);
    if (sc < episode.scenes.length - 1) setSc(s => s + 1);
    else { setPlaying(false); setEpEnded(true); onEpisodeDone(episode.id); }
  };

  // Drive one scene: speak its line (or time it), then move on
  useEffect(() => {
    if (!playing) return;
    let finished = false, safety, after, tick;
    const start = performance.now();
    setSpoken(0); setElapsed(0); boundarySeen.current = false;
    tick = setInterval(() => setElapsed(performance.now() - start), 80);
    const finish = () => {
      if (finished) return; finished = true;
      setTalking(false); setSpoken(scene.say.length);
      if (scene.sayAlong) setSayAlongNow(true);
      after = setTimeout(advance, scene.sayAlong ? 3200 : 800);
    };
    if (voiceOn && "speechSynthesis" in window) {
      const synth = window.speechSynthesis;
      synth.cancel();
      const u = new SpeechSynthesisUtterance(scene.say);
      if (voice) u.voice = voice;
      u.rate = 0.95 * rate; u.pitch = 1.1;
      u.onstart = () => setTalking(true);
      u.onboundary = e => { boundarySeen.current = true; setSpoken(e.charIndex + (e.charLength || 0)); };
      u.onend = finish; u.onerror = finish;
      synth.speak(u);
      setTalking(true);
      safety = setTimeout(finish, est * 1.8 + 4000);
    } else {
      setTalking(true);
      safety = setTimeout(finish, est);
    }
    return () => { clearTimeout(safety); clearTimeout(after); clearInterval(tick); if ("speechSynthesis" in window) window.speechSynthesis.cancel(); setTalking(false); };
  }, [playing, ep, sc, voiceOn, rate, voice]);

  // Auto-play the next episode after a short countdown
  useEffect(() => {
    if (!epEnded || ep >= course.episodes.length - 1) return;
    const t = setTimeout(() => { setEpEnded(false); setEp(e => e + 1); setSc(0); setPlaying(true); }, 6000);
    return () => clearTimeout(t);
  }, [epEnded, ep]);

  const play = () => { setStarted(true); setEpEnded(false); setPlaying(true); };
  const jump = (e, s = 0) => { setEp(e); setSc(s); setEpEnded(false); setSayAlongNow(false); setStarted(true); setPlaying(true); };
  // caption highlight: real speech boundaries when available, else timed estimate
  const hiChars = voiceOn && boundarySeen.current ? spoken : Math.min(scene.say.length, (elapsed / (est - 600)) * scene.say.length);
  const sceneProgress = Math.min(1, elapsed / est);
  let charPos = 0;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 90, background: "#05060d", color: "#fff", fontFamily: KID_FONT, overflowY: "auto" }}>
      <style>{COURSE_KEYFRAMES}{KID_KEYFRAMES}</style>
      <div style={{ maxWidth: 980, margin: "0 auto", padding: "14px 16px 40px" }}>
        {/* header */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
          <button onClick={onClose} aria-label="Close video" style={{ width: 38, height: 38, borderRadius: 999, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.06)", color: "#fff", cursor: "pointer", fontSize: 15 }}>✕</button>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "#7dd3fc", fontWeight: 600 }}>{course.title} · Episode {ep + 1} of {course.episodes.length}</div>
            <div style={{ fontSize: 18, fontWeight: 600, letterSpacing: "-0.02em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{episode.title}</div>
          </div>
        </div>

        {/* stage */}
        <div style={{ position: "relative", aspectRatio: "16 / 9", borderRadius: 22, overflow: "hidden", background: "#0b1026", boxShadow: "0 30px 80px -30px rgba(56,189,248,0.45)", border: "1px solid rgba(255,255,255,0.08)" }}
          onClick={() => started && setPlaying(p => !p)}>
          <svg key={`${ep}-${scene.kind}`} viewBox="0 0 640 360" width="100%" height="100%" style={{ display: "block" }} preserveAspectRatio="xMidYMid slice">
            <SceneArt scene={scene} />
          </svg>
          <div style={{ position: "absolute", left: 14, bottom: 14 }}><Luma talking={talking && playing} size={56} /></div>
          {sayAlongNow && (
            <div style={{ position: "absolute", right: 16, bottom: 16, display: "flex", alignItems: "center", gap: 10, padding: "10px 16px", borderRadius: 999, background: "#ec4899", fontWeight: 700, fontSize: 15, animation: "cMic 1.2s ease-in-out infinite" }}>🎤 Your turn: say it out loud!</div>
          )}
          {(!started || epEnded) && (
            <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, background: "rgba(5,6,13,0.55)", backdropFilter: "blur(4px)" }}>
              {epEnded ? (
                <>
                  <div style={{ fontSize: 13, letterSpacing: "0.14em", textTransform: "uppercase", color: "#7dd3fc", fontWeight: 600 }}>Episode complete</div>
                  <div style={{ fontSize: "clamp(22px, 4vw, 34px)", fontWeight: 700, letterSpacing: "-0.02em" }}>{ep < course.episodes.length - 1 ? `Up next: ${course.episodes[ep + 1].title}` : "You finished the whole series!"}</div>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
                    {ep < course.episodes.length - 1 && <button onClick={e => { e.stopPropagation(); jump(ep + 1); }} style={{ padding: "12px 22px", borderRadius: 999, border: "none", background: "#fff", color: "#0b1026", fontWeight: 700, fontSize: 15, cursor: "pointer", fontFamily: KID_FONT }}>▶ Play next</button>}
                    <button onClick={e => { e.stopPropagation(); jump(ep); }} style={{ padding: "12px 22px", borderRadius: 999, border: "1px solid rgba(255,255,255,0.3)", background: "transparent", color: "#fff", fontWeight: 600, fontSize: 15, cursor: "pointer", fontFamily: KID_FONT }}>↺ Replay</button>
                    {episode.id === "v-earth-6" && onDeeper && <button onClick={e => { e.stopPropagation(); onDeeper(); }} style={{ padding: "12px 22px", borderRadius: 999, border: "1px solid #a78bfa", background: "rgba(167,139,250,0.2)", color: "#fff", fontWeight: 600, fontSize: 15, cursor: "pointer", fontFamily: KID_FONT }}>Go deeper: The Firmament ↗</button>}
                  </div>
                  {ep < course.episodes.length - 1 && <div style={{ fontSize: 13, color: "#94a3b8" }}>Next episode starts in a few seconds…</div>}
                </>
              ) : (
                <button onClick={e => { e.stopPropagation(); play(); }} aria-label="Play episode" style={{ width: 84, height: 84, borderRadius: "50%", border: "none", background: "#fff", color: "#0b1026", fontSize: 30, cursor: "pointer", boxShadow: "0 0 0 12px rgba(255,255,255,0.15)" }}>▶</button>
              )}
            </div>
          )}
          {started && !playing && !epEnded && (
            <div style={{ position: "absolute", top: 14, right: 14, padding: "6px 12px", borderRadius: 999, background: "rgba(0,0,0,0.55)", fontSize: 13, fontWeight: 600 }}>❚❚ Paused</div>
          )}
        </div>

        {/* captions */}
        {cc && (
          <div style={{ minHeight: 84, padding: "16px 6px 6px", textAlign: "center" }}>
            <p style={{ fontSize: "clamp(18px, 3.2vw, 26px)", lineHeight: 1.4, fontWeight: 600, letterSpacing: "-0.01em", margin: 0 }}>
              {scene.say.split(" ").map((w, i) => {
                const startC = charPos; charPos += w.length + 1;
                const on = !started ? false : startC < hiChars;
                return <span key={`${ep}-${sc}-${i}`} style={{ color: on ? "#fff" : "rgba(255,255,255,0.3)", transition: "color 0.15s" }}>{w} </span>;
              })}
            </p>
          </div>
        )}

        {/* chapters (scene segments) */}
        <div style={{ display: "flex", gap: 4, margin: "10px 0 12px" }}>
          {episode.scenes.map((s, i) => (
            <button key={i} onClick={() => jump(ep, i)} aria-label={`Scene ${i + 1}`} style={{ flex: 1, height: 14, padding: "5px 0", border: "none", background: "transparent", cursor: "pointer" }}>
              <div style={{ height: 4, borderRadius: 4, background: "rgba(255,255,255,0.15)", overflow: "hidden" }}>
                <div style={{ height: "100%", background: "linear-gradient(90deg, #38bdf8, #a78bfa)", width: i < sc || epEnded ? "100%" : i === sc && started ? `${sceneProgress * 100}%` : "0%" }} />
              </div>
            </button>
          ))}
        </div>

        {/* controls */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {[
            ["⏮", "Previous scene", () => jump(ep, Math.max(0, sc - 1))],
            [playing ? "❚❚" : "▶", playing ? "Pause" : "Play", () => (started ? setPlaying(p => !p) : play())],
            ["⏭", "Next scene", () => (sc < episode.scenes.length - 1 ? jump(ep, sc + 1) : advance())],
          ].map(([icon, lbl, fn], i) => (
            <button key={lbl} onClick={fn} aria-label={lbl} style={{ width: i === 1 ? 52 : 42, height: i === 1 ? 52 : 42, borderRadius: 999, cursor: "pointer", border: i === 1 ? "none" : "1px solid rgba(255,255,255,0.15)", background: i === 1 ? "#fff" : "rgba(255,255,255,0.06)", color: i === 1 ? "#0b1026" : "#fff", fontSize: i === 1 ? 18 : 14 }}>{icon}</button>
          ))}
          <span style={{ flex: 1 }} />
          {[
            [voiceOn ? "🔊 Voice" : "🔇 Voice", () => setVoiceOn(v => !v), voiceOn],
            ["CC", () => setCc(c => !c), cc],
            [`${rate}×`, () => setRate(r => (r === 1 ? 1.25 : r === 1.25 ? 0.85 : 1)), rate !== 1],
          ].map(([lbl, fn, on]) => (
            <button key={String(lbl).slice(-5)} onClick={fn} style={{ padding: "9px 14px", borderRadius: 999, cursor: "pointer", fontFamily: KID_FONT, fontSize: 13, fontWeight: 600, border: `1px solid ${on ? "#7dd3fc" : "rgba(255,255,255,0.15)"}`, background: on ? "rgba(125,211,252,0.15)" : "rgba(255,255,255,0.04)", color: "#fff" }}>{lbl}</button>
          ))}
        </div>

        {/* episode list */}
        <div style={{ marginTop: 28, fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "#94a3b8", fontWeight: 600 }}>All episodes</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 10, marginTop: 12 }}>
          {course.episodes.map((e, i) => {
            const on = i === ep;
            const secs = Math.round(e.scenes.reduce((t, s) => t + s.say.split(" ").length / 2.6 + 1.5, 0));
            return (
              <button key={e.id} onClick={() => jump(i)} style={{ textAlign: "left", cursor: "pointer", padding: 0, borderRadius: 18, overflow: "hidden", border: `1px solid ${on ? "#7dd3fc" : "rgba(255,255,255,0.1)"}`, background: "rgba(255,255,255,0.04)", color: "#fff", fontFamily: KID_FONT }}>
                <div style={{ aspectRatio: "16 / 9", position: "relative", pointerEvents: "none" }}>
                  <svg viewBox="0 0 640 360" width="100%" height="100%" style={{ display: "block" }} preserveAspectRatio="xMidYMid slice"><SceneArt scene={e.scenes[Math.min(1, e.scenes.length - 1)]} /></svg>
                  {watched.has(e.id) && <span style={{ position: "absolute", top: 8, right: 8, padding: "3px 9px", borderRadius: 999, background: "#22c55e", fontSize: 11, fontWeight: 700 }}>✓ Watched</span>}
                  <span style={{ position: "absolute", bottom: 8, right: 8, padding: "3px 8px", borderRadius: 8, background: "rgba(0,0,0,0.6)", fontSize: 11, fontWeight: 600 }}>{Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")}</span>
                </div>
                <div style={{ padding: "10px 12px 12px" }}>
                  <div style={{ fontSize: 11, color: "#7dd3fc", fontWeight: 600, letterSpacing: "0.1em" }}>EPISODE {i + 1}</div>
                  <div style={{ fontSize: 15, fontWeight: 600, marginTop: 2 }}>{e.title}</div>
                </div>
              </button>
            );
          })}
        </div>
        <p style={{ fontSize: 12.5, color: "#64748b", marginTop: 18, lineHeight: 1.5 }}>
          Luma's voice uses your device's built-in speech, so it sounds a little different on every phone and computer. Turn on CC to read along.
        </p>
      </div>
    </div>
  );
}

// Featured course card (Beginner home + Library)
function CourseCard({ course, watched, onOpen, isMobile }) {
  const n = course.episodes.filter(e => watched.has(e.id)).length;
  const nextEp = Math.max(0, course.episodes.findIndex(e => !watched.has(e.id)));
  return (
    <button onClick={() => onOpen(n === course.episodes.length ? 0 : nextEp)} className="kid-card-hover" style={{
      width: "100%", textAlign: "left", cursor: "pointer", padding: 0, borderRadius: 26, overflow: "hidden",
      border: "1px solid rgba(125,211,252,0.35)", background: "#0b1026", color: "#fff", fontFamily: KID_FONT, marginBottom: 22,
      display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1.25fr 1fr", boxShadow: "0 24px 60px -30px rgba(56,189,248,0.6)",
    }}>
      <div style={{ position: "relative", aspectRatio: "16 / 9", pointerEvents: "none" }}>
        <style>{COURSE_KEYFRAMES}</style>
        <svg viewBox="0 0 640 360" width="100%" height="100%" style={{ display: "block" }} preserveAspectRatio="xMidYMid slice"><SceneArt scene={{ kind: "earth" }} /></svg>
        <span style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)", width: 64, height: 64, borderRadius: "50%", background: "rgba(255,255,255,0.92)", color: "#0b1026", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, boxShadow: "0 0 0 10px rgba(255,255,255,0.18)" }}>▶</span>
      </div>
      <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
        <div style={{ fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "#7dd3fc", fontWeight: 600 }}>Video course · Talk-along</div>
        <div style={{ fontSize: 26, fontWeight: 600, letterSpacing: "-0.03em", marginTop: 6 }}>{course.title}</div>
        <div style={{ fontSize: 14.5, color: "#cbd5e1", marginTop: 6, lineHeight: 1.45 }}>{course.blurb}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14 }}>
          <div style={{ flex: 1, height: 4, borderRadius: 4, background: "rgba(255,255,255,0.15)", overflow: "hidden" }}>
            <div style={{ width: `${(n / course.episodes.length) * 100}%`, height: "100%", background: "linear-gradient(90deg, #38bdf8, #a78bfa)" }} />
          </div>
          <span className="kid-num" style={{ fontSize: 12.5, color: "#cbd5e1" }}>{n}/{course.episodes.length} episodes</span>
        </div>
        <div style={{ marginTop: 14, fontSize: 14, fontWeight: 600, color: "#fff" }}>{n === 0 ? "▶ Start episode 1" : n === course.episodes.length ? "↺ Watch again" : `▶ Continue: ${course.episodes[nextEp].title}`}</div>
      </div>
    </button>
  );
}

// ─── LIBRARY: every lesson, searchable, readable as an article or playable as an experience ───
function LessonLibrary({ onRead, onWatch, onOpenCourse, setActiveTab, isMobile, accent, done }) {
  const [q, setQ] = useState("");
  const [lvl, setLvl] = useState("all");
  const [sec, setSec] = useState("all");
  const index = useMemo(() => ALL_UNITS.map(u => {
    const d = getDeep(u.id);
    const text = [u.title, ...u.cards.map(c => c.text), ...(d ? [...d.go.flat(), ...d.even.flat(), ...d.terms.flat()] : [])].join(" ").toLowerCase();
    return { u, d, text };
  }), []);
  const ql = q.trim().toLowerCase();
  const results = index.filter(({ u, text }) =>
    (lvl === "all" || u.level === lvl) && (sec === "all" || u.deep === sec) && (!ql || ql.split(/\s+/).every(w => text.includes(w))));
  const sections = [...new Set(ALL_UNITS.map(u => u.deep))];
  const chip = (on, color) => ({
    padding: "8px 14px", borderRadius: 999, cursor: "pointer", fontFamily: KID_FONT, fontSize: 13.5, fontWeight: 500, whiteSpace: "nowrap",
    color: on ? "white" : "var(--text)", background: on ? color : "var(--glass-bg)", border: `1px solid ${on ? color : "var(--glass-border)"}`,
  });

  return (
    <div style={{ animation: "kidSlideIn 0.5s cubic-bezier(0.22,1,0.36,1)", fontFamily: KID_FONT }}>
      <div className="kid-label" style={{ marginBottom: 6 }}>Library</div>
      <div style={{ fontSize: isMobile ? 30 : 40, fontWeight: 600, letterSpacing: "-0.035em", lineHeight: 1.05, color: "var(--text)" }}>
        Everything, <span className="kid-serif" style={{ color: accent }}>on your terms.</span>
      </div>
      <p style={{ fontSize: 15.5, color: "var(--text-muted)", marginTop: 8, marginBottom: 18, lineHeight: 1.5 }}>
        Search every lesson and deep dive. Read it as an article or watch it as an experience.
      </p>

      {onOpenCourse && !q && (
        <>
          <div className="kid-label" style={{ marginBottom: 10 }}>Video courses</div>
          {COURSES.map(cr => <CourseCard key={cr.id} course={cr} watched={done} isMobile={isMobile} onOpen={ep => onOpenCourse(cr, ep)} />)}
        </>
      )}
      <div className="kid-glass" style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 16px", borderRadius: 999, marginBottom: 14 }}>
        <span style={{ fontSize: 18, color: accent }}>⌕</span>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search: firmament, HRV, Tesla, gematria…" style={{
          flex: 1, border: "none", outline: "none", background: "transparent", fontFamily: KID_FONT, fontSize: 16, padding: "12px 0", color: "var(--text)",
        }} />
        {q && <button onClick={() => setQ("")} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 14 }}>✕</button>}
      </div>

      <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 6, marginBottom: 6 }}>
        <button onClick={() => setLvl("all")} style={chip(lvl === "all", accent)}>All levels</button>
        {LEVEL_ORDER.map(id => (
          <button key={id} onClick={() => setLvl(id)} style={chip(lvl === id, LEVELS[id].color)}>
            <span className="kid-serif" style={{ marginRight: 6 }}>{LEVELS[id].numeral}</span>{LEVELS[id].title}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 6, marginBottom: 16 }}>
        <button onClick={() => setSec("all")} style={chip(sec === "all", "#64748b")}>All topics</button>
        {sections.map(s => <button key={s} onClick={() => setSec(s)} style={chip(sec === s, "#64748b")}>{SECTION_NAMES[s] || s}</button>)}
      </div>

      <div className="kid-num" style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 10 }}>{results.length} lesson{results.length === 1 ? "" : "s"}</div>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 10, marginBottom: 30 }}>
        {results.map(({ u, d }, i) => {
          const Lv = LEVELS[u.level];
          return (
            <div key={u.id} className="kid-glass kid-card-hover" style={{ borderRadius: 22, padding: 18, position: "relative", overflow: "hidden", animation: `kidSlideIn 0.45s ease ${Math.min(i, 10) * 0.03}s both` }}>
              <span aria-hidden style={{ position: "absolute", right: -40, top: -40, width: 130, height: 130, borderRadius: "50%", background: `radial-gradient(circle, ${u.color}30, transparent 65%)` }} />
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, position: "relative" }}>
                <span className="kid-serif" style={{ fontSize: 20, color: Lv.color, lineHeight: 1 }}>{Lv.numeral}</span>
                <span className="kid-label">{SECTION_NAMES[u.deep] || u.deep}</span>
                {done.has(u.id) && <span className="kid-label" style={{ color: "#22c55e", marginLeft: "auto" }}>✓ Done</span>}
              </div>
              <div style={{ fontSize: 18, fontWeight: 600, letterSpacing: "-0.02em", lineHeight: 1.25, position: "relative" }}>{u.title}</div>
              <p style={{ fontSize: 14, color: "var(--text-muted)", lineHeight: 1.5, marginTop: 6, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{u.cards[0].text}</p>
              <div style={{ display: "flex", gap: 8, marginTop: 14, alignItems: "center", position: "relative" }}>
                <button onClick={() => onWatch(u)} style={{ padding: "8px 14px", borderRadius: 999, cursor: "pointer", fontFamily: KID_FONT, fontSize: 13, fontWeight: 600, color: "white", border: "none", background: `linear-gradient(135deg, ${u.color}, ${u.color}c8)` }}>▶ Watch</button>
                <button onClick={() => onRead(u)} className="kid-glass" style={{ padding: "8px 14px", borderRadius: 999, cursor: "pointer", fontFamily: KID_FONT, fontSize: 13, fontWeight: 600, color: "var(--text)" }}>≡ Read</button>
                <span className="kid-num" style={{ marginLeft: "auto", fontSize: 12, color: "var(--text-muted)" }}>{d ? `${d.sources.length} sources` : ""}</span>
              </div>
            </div>
          );
        })}
        {results.length === 0 && (
          <div className="kid-glass" style={{ borderRadius: 22, padding: 24, textAlign: "center", color: "var(--text-muted)", gridColumn: "1 / -1" }}>
            Nothing matched “{q}”. Try another word, or search the whole site.
            <div style={{ marginTop: 12 }}><KidButton ghost onClick={() => setActiveTab("search")}>Search the whole site →</KidButton></div>
          </div>
        )}
      </div>

      <div className="kid-label" style={{ marginBottom: 12 }}>Full sections</div>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(3, 1fr)", gap: 8, marginBottom: 30 }}>
        {Object.entries(SECTION_NAMES).map(([id, name]) => (
          <button key={id} onClick={() => setActiveTab(id)} className="kid-glass kid-card-hover" style={{ padding: "14px 16px", borderRadius: 18, cursor: "pointer", textAlign: "left", fontFamily: KID_FONT, fontSize: 15, fontWeight: 600, color: "var(--text)", display: "flex", justifyContent: "space-between" }}>
            {name}<span style={{ color: "var(--text-muted)" }}>→</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// Article view: the whole lesson as one readable page
function ArticleView({ unit, onClose, onWatch, onDeeper }) {
  const Lv = LEVELS[unit.level] || LEVELS.beginner;
  useEffect(() => {
    const onKey = e => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 80, overflowY: "auto", background: "var(--kid-sheet)", fontFamily: KID_FONT, color: "var(--text)", animation: "kidSlideIn 0.4s cubic-bezier(0.22,1,0.36,1)" }}>
      <div style={{ position: "sticky", top: 0, zIndex: 2, backdropFilter: "blur(20px) saturate(1.5)", WebkitBackdropFilter: "blur(20px) saturate(1.5)", background: "color-mix(in srgb, var(--kid-sheet) 75%, transparent)", borderBottom: "1px solid var(--glass-border)" }}>
        <div style={{ maxWidth: 720, margin: "0 auto", padding: "12px 20px", display: "flex", alignItems: "center", gap: 10 }}>
          <button onClick={onClose} aria-label="Close article" className="kid-glass" style={{ width: 36, height: 36, borderRadius: 999, cursor: "pointer", color: "var(--text)", fontSize: 15 }}>✕</button>
          <span className="kid-label" style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>Library · {SECTION_NAMES[unit.deep] || unit.deep}</span>
          <button onClick={() => onWatch(unit)} style={{ padding: "9px 16px", borderRadius: 999, cursor: "pointer", fontFamily: KID_FONT, fontSize: 13, fontWeight: 600, color: "white", border: "none", background: `linear-gradient(135deg, ${unit.color}, ${unit.color}c8)` }}>▶ Watch</button>
        </div>
      </div>
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "28px 24px 60px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
          <span className="kid-serif" style={{ fontSize: 26, color: Lv.color, lineHeight: 1 }}>{Lv.numeral}</span>
          <span className="kid-label" style={{ color: Lv.color }}>{Lv.title}</span>
        </div>
        <h1 style={{ fontSize: "clamp(32px, 7vw, 48px)", fontWeight: 600, letterSpacing: "-0.035em", lineHeight: 1.05, fontFamily: KID_FONT }}>{unit.title}</h1>
        <div style={{ margin: "22px 0 8px", padding: "18px 20px", borderRadius: 20, background: `linear-gradient(135deg, ${unit.color}1c, transparent 75%)`, border: `1px solid ${unit.color}40` }}>
          <span className="kid-label" style={{ color: unit.color }}>The short version</span>
          {unit.cards.map((c, i) => <p key={i} style={{ fontSize: 17, lineHeight: 1.6, marginTop: 10 }}>{c.text}</p>)}
        </div>
        <DeepReader unit={unit} layer={1} hideTitle />
        <DeepReader unit={unit} layer={2} hideTitle />
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
          <KidButton color={unit.color} onClick={() => onDeeper(unit.deep)} style={{ flex: "1 1 220px", width: "auto" }}>Open {SECTION_NAMES[unit.deep] || "full section"} →</KidButton>
          <KidButton ghost onClick={() => onWatch(unit)} style={{ flex: "1 1 220px", width: "auto" }}>▶ Watch as an experience</KidButton>
        </div>
      </div>
    </div>
  );
}

function HomeScreen({ setActiveTab, isMobile, mt, isLight, level, setLevel, done, setDone, customPath, setCustomPath }) {
  const [openUnit, setOpenUnit] = useState(null);
  const [articleUnit, setArticleUnit] = useState(null);
  const [openCourse, setOpenCourse] = useState(null); // { course, ep }
  const [playlist, setPlaylist] = useState(false);
  const [view, setView] = useState(level ? "path" : "pick"); // pick | build | path | library
  const streakDays = 14;
  const L = level === "custom"
    ? { id: "custom", numeral: "✦", title: "My Own Path", color: mt.accent, depth: 0, pathName: "My custom path",
        path: customPath.map(id => ALL_UNITS.find(u => u.id === id)).filter(Boolean) }
    : LEVELS[level] || LEVELS.beginner;
  const path = L.path;
  const currentIdx = path.findIndex(u => !done.has(u.id));
  const doneCount = path.filter(u => done.has(u.id)).length;
  const deepTone = level && level !== "beginner";
  const unitLevel = u => ALL_UNITS.find(x => x.id === u.id)?.level || "beginner";
  const themeVars = {
    fontFamily: KID_FONT,
    "--kid-sheet": isLight ? "#f6f6f2" : "#07070b",
    "--glass-bg": isLight ? "rgba(255,255,255,0.62)" : "rgba(255,255,255,0.045)",
    "--glass-border": isLight ? "rgba(15,15,30,0.09)" : "rgba(255,255,255,0.09)",
    "--glass-hi": isLight ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.08)",
  };

  // Shared overlays: lesson experience + article reader
  const openLibraryAt = u => { setOpenUnit(null); setPlaylist(false); setView("library"); setArticleUnit(u || null); };
  const nextUnitAfter = u => {
    const list = path.length ? path : [];
    const i = list.findIndex(x => x.id === u.id);
    return list.slice(i + 1).find(x => !done.has(x.id)) || list.slice(i + 1)[0] || null;
  };
  const overlays = (
    <>
      {openUnit && (
        <LessonPlayer
          key={openUnit.id}
          unit={openUnit}
          level={unitLevel(openUnit)}
          playlist={playlist}
          onClose={() => { setOpenUnit(null); setPlaylist(false); }}
          onComplete={(id) => setDone(prev => new Set(prev).add(id))}
          onDeeper={(tab) => { setOpenUnit(null); setPlaylist(false); setActiveTab(tab); }}
          onLibrary={openLibraryAt}
          onNextLesson={playlist && nextUnitAfter(openUnit) ? () => setOpenUnit(nextUnitAfter(openUnit)) : undefined}
        />
      )}
      {openCourse && (
        <CoursePlayer
          course={openCourse.course}
          startEp={openCourse.ep}
          watched={done}
          onClose={() => setOpenCourse(null)}
          onEpisodeDone={id => setDone(prev => new Set(prev).add(id))}
          onDeeper={() => { setOpenCourse(null); setPlaylist(false); setOpenUnit(ALL_UNITS.find(u => u.id === "r-firmament")); }}
        />
      )}
      {articleUnit && !openUnit && (
        <ArticleView
          unit={{ ...articleUnit, level: unitLevel(articleUnit) }}
          onClose={() => setArticleUnit(null)}
          onWatch={u => { setPlaylist(false); setOpenUnit(u); }}
          onDeeper={tab => { setArticleUnit(null); setActiveTab(tab); }}
        />
      )}
    </>
  );
  const modeSwitch = (
    <div className="kid-glass" style={{ display: "flex", padding: 4, borderRadius: 999, marginBottom: 18 }}>
      {[["path", "Guided path"], ["library", "Library"]].map(([id, label]) => {
        const on = view === id;
        return (
          <button key={id} onClick={() => setView(id === "path" && !level ? "pick" : id)} style={{
            flex: 1, padding: "10px 14px", borderRadius: 999, border: "none", cursor: "pointer", fontFamily: KID_FONT, fontSize: 14, fontWeight: 600,
            color: on ? (isLight ? "#fff" : "#07070b") : "var(--text-muted)", background: on ? "var(--text)" : "transparent",
            transition: "all 0.3s cubic-bezier(0.22,1,0.36,1)",
          }}>{label}</button>
        );
      })}
    </div>
  );

  if (view === "library") {
    return (
      <div style={themeVars}>
        <style>{KID_KEYFRAMES}</style>
        {modeSwitch}
        <LessonLibrary isMobile={isMobile} accent={mt.accent} done={done} setActiveTab={setActiveTab}
          onRead={u => setArticleUnit(u)} onWatch={u => { setPlaylist(false); setOpenUnit(u); }}
          onOpenCourse={(course, ep) => setOpenCourse({ course, ep })} />
        {overlays}
      </div>
    );
  }
  if (view === "pick" || !level) {
    return (
      <div style={themeVars}>
        <style>{KID_KEYFRAMES}</style>
        <LevelPicker current={level} isMobile={isMobile} accent={mt.accent}
          onPick={id => { setLevel(id); setView("path"); }}
          onBuild={() => setView("build")}
          onLibrary={() => setView("library")} />
      </div>
    );
  }
  if (view === "build") {
    return (
      <div style={themeVars}>
        <style>{KID_KEYFRAMES}</style>
        <PathBuilder selected={customPath} isMobile={isMobile} accent={mt.accent}
          onBack={() => setView("pick")}
          onSave={ids => { setCustomPath(ids); setLevel("custom"); setView("path"); }} />
      </div>
    );
  }

  const tile = { borderRadius: 22, padding: "16px 18px" };

  return (
    <div style={{ animation: "kidSlideIn 0.5s cubic-bezier(0.22,1,0.36,1)", ...themeVars }}>
      <style>{KID_KEYFRAMES}</style>
      {modeSwitch}

      {/* ═══ HELLO ═══ */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "6px 0 20px" }}>
        <SparkMascot size={isMobile ? 52 : 64} color={mt.accent} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="kid-label" style={{ marginBottom: 4 }}>{deepTone ? "Welcome back, Seeker" : "Hi, Seeker"}</div>
          <div style={{ fontSize: isMobile ? 26 : 34, fontWeight: 600, letterSpacing: "-0.035em", lineHeight: 1.1, color: "var(--text)" }}>
            {currentIdx === -1
              ? <>Path complete. <span className="kid-serif" style={{ color: L.color }}>Go deeper.</span></>
              : <>{deepTone ? "Up next: " : "Let's learn: "}<span className="kid-serif" style={{ color: L.color }}>{path[currentIdx].title}</span></>}
          </div>
        </div>
      </div>

      {/* ═══ LEVEL SWITCH ═══ */}
      <button onClick={() => setView("pick")} className="kid-glass" style={{
        display: "flex", alignItems: "center", gap: 12, width: "100%", marginBottom: 12, cursor: "pointer",
        padding: "12px 16px", borderRadius: 999, fontFamily: KID_FONT, color: "var(--text)",
      }}>
        <span className="kid-serif" style={{ fontSize: 24, color: L.color, lineHeight: 1 }}>{L.numeral}</span>
        <span style={{ fontSize: 15, fontWeight: 600, whiteSpace: "nowrap" }}>{L.title}</span>
        {L.depth > 0 && <DepthDots depth={L.depth} color={L.color} />}
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-muted)", whiteSpace: "nowrap" }}>Change level</span>
      </button>

      {/* ═══ BENTO STATS ═══ */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "1.4fr 1fr 1fr 1fr", gap: 10, marginBottom: 30 }}>
        <div style={{ ...tile, background: "linear-gradient(135deg, #f97316, #db2777)", color: "white", position: "relative", overflow: "hidden", boxShadow: "0 16px 34px -18px #f97316" }}>
          <span aria-hidden style={{ position: "absolute", right: -30, bottom: -30, width: 110, height: 110, borderRadius: "50%", border: "1px solid rgba(255,255,255,0.35)" }} />
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", opacity: 0.85 }}>Streak</div>
          <div className="kid-num" style={{ fontSize: 34, fontWeight: 600, letterSpacing: "-0.03em", marginTop: 4 }}>{streakDays}<span style={{ fontSize: 15, opacity: 0.85, marginLeft: 4 }}>days</span></div>
        </div>
        {[
          { label: "Lessons", value: `${doneCount}/${path.length}`, color: L.color, bar: path.length ? doneCount / path.length : 0 },
          { label: "Meditations", value: "47", color: "#06b6d4" },
          { label: "Insights", value: "23", color: "#a78bfa" },
        ].map(c => (
          <div key={c.label} className="kid-glass" style={tile}>
            <div className="kid-label">{c.label}</div>
            <div className="kid-num" style={{ fontSize: 28, fontWeight: 600, letterSpacing: "-0.03em", marginTop: 4, color: "var(--text)" }}>{c.value}</div>
            {c.bar !== undefined && (
              <div style={{ height: 4, borderRadius: 4, background: "var(--glass-border)", marginTop: 8, overflow: "hidden" }}>
                <div style={{ width: `${c.bar * 100}%`, height: "100%", background: c.color, borderRadius: 4, transition: "width 0.6s ease" }} />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* ═══ VIDEO COURSE (Beginner) ═══ */}
      {level === "beginner" && (
        <>
          <div className="kid-label" style={{ marginBottom: 10 }}>Start here · video course</div>
          <CourseCard course={EARTH_COURSE} watched={done} isMobile={isMobile} onOpen={ep => setOpenCourse({ course: EARTH_COURSE, ep })} />
        </>
      )}

      {/* ═══ AUTOPLAY ═══ */}
      <div style={{ display: "flex", gap: 10, marginBottom: 30, flexWrap: "wrap" }}>
        <KidButton color={L.color} style={{ flex: "2 1 240px", width: "auto" }} onClick={() => {
          const start = path[currentIdx === -1 ? 0 : currentIdx];
          if (start) { setPlaylist(true); setOpenUnit(start); }
        }}>▶ {currentIdx === -1 ? "Replay my path" : doneCount ? "Continue my path" : "Play my path"}</KidButton>
        <KidButton ghost style={{ flex: "1 1 160px", width: "auto" }} onClick={() => setView("library")}>Open the library ↗</KidButton>
      </div>

      {/* ═══ THE PATH ═══ */}
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 4 }}>
        <span className="kid-label">{L.pathName}</span>
        <span className="kid-num" style={{ fontSize: 12, color: "var(--text-muted)" }}>{doneCount} of {path.length} complete</span>
      </div>
      <div style={{ position: "relative", padding: "52px 0 34px", display: "flex", flexDirection: "column", alignItems: "center", gap: 48 }}>
        {path.map((u, i) => {
          const isDone = done.has(u.id);
          const isCurrent = i === currentIdx;
          const offset = Math.sin(i * 1.1) * (isMobile ? 64 : 110);
          const size = isCurrent ? 80 : 68;
          const C = 2 * Math.PI * (size / 2 - 3);
          return (
            <div key={u.id} style={{ transform: `translateX(${offset}px)`, display: "flex", flexDirection: "column", alignItems: "center", position: "relative" }}>
              {isCurrent && (
                <div className="kid-glass" style={{
                  position: "absolute", top: -38, padding: "6px 14px", borderRadius: 999, fontSize: 12, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase",
                  color: u.color, whiteSpace: "nowrap", animation: "kidBob 2.4s ease-in-out infinite", zIndex: 3,
                }}>{doneCount === 0 ? "Start here" : "Continue"}</div>
              )}
              <button onClick={() => { setPlaylist(false); setOpenUnit(u); }} aria-label={u.title} className="kid-glass" style={{
                "--kid-glow": `${u.color}66`,
                width: size, height: size, borderRadius: "50%", cursor: "pointer", position: "relative",
                display: "flex", alignItems: "center", justifyContent: "center",
                background: isCurrent ? `radial-gradient(circle at 30% 25%, ${u.color}ee, ${u.color}99)` : undefined,
                borderColor: isCurrent ? u.color : undefined,
                animation: isCurrent ? "kidGlow 2.6s ease-in-out infinite" : "none",
                transition: "transform 0.3s cubic-bezier(0.22,1,0.36,1)",
              }}
              onMouseEnter={e => { e.currentTarget.style.transform = "scale(1.07)"; }}
              onMouseLeave={e => { e.currentTarget.style.transform = "scale(1)"; }}>
                <svg width={size} height={size} style={{ position: "absolute", inset: 0, transform: "rotate(-90deg)" }}>
                  <circle cx={size / 2} cy={size / 2} r={size / 2 - 3} fill="none" stroke={u.color} strokeOpacity={isDone ? 1 : 0.35} strokeWidth="2" strokeDasharray={C} strokeDashoffset={isDone ? 0 : C * 0.75} strokeLinecap="round" />
                </svg>
                <span className="kid-num" style={{ fontSize: isCurrent ? 22 : 18, fontWeight: 600, color: isCurrent ? "white" : isDone ? u.color : "var(--text)", letterSpacing: "-0.02em" }}>
                  {isDone ? "✓" : String(i + 1).padStart(2, "0")}
                </span>
              </button>
              <span style={{ marginTop: 10, fontSize: 14, fontWeight: 600, color: isDone || isCurrent ? "var(--text)" : "var(--text-muted)", textAlign: "center", maxWidth: 150, lineHeight: 1.25, letterSpacing: "-0.01em" }}>
                {u.title}
              </span>
            </div>
          );
        })}
      </div>

      {/* ═══ OTHER LEVELS ═══ */}
      <div className="kid-label" style={{ marginBottom: 12 }}>Explore other levels</div>
      <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 10, marginBottom: 18 }}>
        {[...LEVEL_ORDER.filter(id => id !== level).map(id => LEVELS[id]), ...(level !== "custom" ? [{ id: "build", numeral: "✦", title: "Build my own", sub: "Mix lessons from any level", color: mt.accent, depth: 0 }] : [])].map(o => (
          <button key={o.id} onClick={() => { if (o.id === "build") setView("build"); else { setLevel(o.id); setView("path"); } }} className="kid-glass kid-card-hover" style={{
            flexShrink: 0, width: 180, textAlign: "left", padding: 16, borderRadius: 22, cursor: "pointer", fontFamily: KID_FONT,
            color: "var(--text)", position: "relative", overflow: "hidden",
          }}>
            <span aria-hidden style={{ position: "absolute", right: -30, top: -30, width: 110, height: 110, borderRadius: "50%", background: `radial-gradient(circle, ${o.color}33, transparent 65%)` }} />
            <div className="kid-serif" style={{ fontSize: 34, color: o.color, lineHeight: 1 }}>{o.numeral}</div>
            <div style={{ fontSize: 16, fontWeight: 600, marginTop: 10, letterSpacing: "-0.01em" }}>{o.title}</div>
            {o.depth > 0 && <div style={{ margin: "8px 0" }}><DepthDots depth={o.depth} color={o.color} /></div>}
            <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.35 }}>{o.sub}</div>
          </button>
        ))}
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 34 }}>
        <KidButton ghost onClick={() => setActiveTab("explore")} style={{ flex: "1 1 200px", width: "auto" }}>Browse every topic →</KidButton>
        <KidButton ghost onClick={() => setActiveTab("tones")} style={{ flex: "1 1 200px", width: "auto" }}>〰 Tone Sanctuary →</KidButton>
      </div>

      {/* ═══ COMMUNITY — bento ═══ */}
      <div className="kid-label" style={{ marginBottom: 12 }}>Community</div>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, 1fr)", gap: 10, marginBottom: 10 }}>
        {[
          { label: "Souls online", value: "1,247", color: "#22c55e", live: true },
          { label: "Meditations today", value: "3,891", color: "#06b6d4" },
          { label: "Signals shared", value: "12.4K", color: "#a78bfa" },
          { label: "Collective mood", value: "Rising ↑", color: "#eab308" },
        ].map(s => (
          <div key={s.label} className="kid-glass" style={tile}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {s.live && <span style={{ width: 6, height: 6, borderRadius: 999, background: s.color, boxShadow: `0 0 8px ${s.color}`, animation: "kidTwinkle 1.8s ease-in-out infinite" }} />}
              <span className="kid-label">{s.label}</span>
            </div>
            <div className="kid-num" style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em", color: s.color, marginTop: 6 }}>{s.value}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1.3fr 1fr", gap: 10, marginBottom: 10 }}>
        <div onClick={() => setActiveTab("events")} className="kid-card-hover" style={{ ...tile, cursor: "pointer", position: "relative", overflow: "hidden", background: "linear-gradient(135deg, rgba(139,92,246,0.22), rgba(139,92,246,0.06))", border: "1px solid rgba(139,92,246,0.35)" }}>
          <span aria-hidden style={{ position: "absolute", right: 18, top: 16, width: 44, height: 44, borderRadius: "50%", background: "radial-gradient(circle at 35% 30%, #fff, #c4b5fd 50%, #7c3aed)", boxShadow: "0 0 30px rgba(167,139,250,0.6)" }} />
          <div className="kid-label" style={{ color: "#a78bfa" }}>Next event</div>
          <div style={{ fontSize: 20, fontWeight: 600, color: "var(--text)", marginTop: 8, letterSpacing: "-0.02em" }}>Full Moon Meditation</div>
          <div className="kid-num" style={{ fontSize: 14, color: "var(--text-muted)", marginTop: 4 }}>Mar 29 · 9PM UTC · 342 attending</div>
          <div style={{ fontSize: 14, color: "#a78bfa", marginTop: 12, fontWeight: 600 }}>See all events →</div>
        </div>
        <div className="kid-glass" style={tile}>
          <div className="kid-label">Trending</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
            {[{ tag: "#scalarhealing", color: "#06b6d4" }, { tag: "#369code", color: "#eab308" }, { tag: "#coppercoils", color: "#f97316" }].map(t => (
              <span key={t.tag} style={{ fontSize: 13.5, fontWeight: 500, color: t.color, padding: "6px 12px", borderRadius: 999, background: `${t.color}14`, border: `1px solid ${t.color}35` }}>{t.tag}</span>
            ))}
          </div>
        </div>
      </div>

      <div className="kid-glass" style={{ ...tile, marginBottom: 32 }}>
        <div className="kid-label" style={{ marginBottom: 4 }}>What's new</div>
        {[
          { icon: "🕸️", text: "New declassified CIA documents added to Wake Up section", time: "2h ago" },
          { icon: "🌿", text: "Chaga mushroom protocol added to Healing liver section", time: "5h ago" },
          { icon: "⚡", text: "BluShield Tesla Gold Series now in VIB3 Shop", time: "8h ago" },
          { icon: "◐", text: "New lesson: 'How Your Field Affects Others' in Bio Field", time: "12h ago" },
          { icon: "⊛", text: "Kael shared a Rodin coil tutorial in Community", time: "1d ago" },
        ].map((item, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 0", borderBottom: i < 4 ? "1px solid var(--glass-border)" : "none" }}>
            <span style={{ width: 36, height: 36, borderRadius: 12, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, background: "var(--glass-bg)", border: "1px solid var(--glass-border)" }}>{item.icon}</span>
            <p style={{ fontSize: 15, color: "var(--text)", margin: 0, lineHeight: 1.4, flex: 1 }}>{item.text}</p>
            <span className="kid-num" style={{ fontSize: 12, color: "var(--text-muted)", flexShrink: 0 }}>{item.time}</span>
          </div>
        ))}
      </div>

      {/* ═══ THE FEED ═══ */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#22c55e", boxShadow: "0 0 10px #22c55e", animation: "kidTwinkle 1.6s ease-in-out infinite" }} />
          <span style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.02em", color: "var(--text)" }}>The Feed</span>
          <span className="kid-label">Live</span>
        </div>
        <button onClick={() => setActiveTab("community")} className="kid-glass" style={{
          padding: "8px 16px", borderRadius: 999, cursor: "pointer", fontFamily: KID_FONT, fontSize: 13, fontWeight: 600, color: "var(--text)",
        }}>See all →</button>
      </div>
      <CommunityFeed isMobile={isMobile} />

      {overlays}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// TONE SANCTUARY — the Nonet 9-channel tone lab, rebuilt as a
// Calm × Gaia hybrid: immersive animated scenes with ambient sound
// and a session timer (Calm), rows of frequency journeys and a daily
// frequency (Gaia), and the full Nonet studio, library & calculator.
// ═══════════════════════════════════════════════════════════════

const NONET_MIN_F = 0.01, NONET_MAX_F = 22000;
const NONET_WAVES = [["sine", "Sine"], ["triangle", "Tri"], ["square", "Square"], ["sawtooth", "Saw"]];
const NONET_STEPS = [100, 10, 1, 0.1, 0.01, 0.001];
const NONET_NOTES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
const NONET_PRESETS = [
  { g: "Rife lists", items: [
    { n: "General wellness", d: "The set repeated most often across Rife and CAFL lists as a general program.", f: [20, 727, 787, 880, 1550, 1865, 5000, 10000] },
    { n: "Pain", d: "A widely shared general pain listing.", f: [3000, 95, 10000, 1550, 802, 880, 787, 727, 304] },
    { n: "Inflammation", d: "Common inflammation entries.", f: [1550, 802, 880, 832, 787, 776, 727, 465, 125] },
    { n: "Cold & flu", d: "Frequencies often grouped for colds and seasonal flu.", f: [20, 72, 333, 523, 727, 787, 880, 5000, 7344] },
    { n: "Immune support", d: "General immune listing built on the core Rife set.", f: [20, 72, 95, 125, 727, 787, 880, 1865, 5000] },
    { n: "Detox", d: "Entries grouped under detox and drainage.", f: [20, 146, 428, 522, 727, 787, 880, 1865, 5000] },
    { n: "Rife's reported originals", d: "Organism frequencies attributed to Rife's 1930s lab notes, as reported by later writers.", f: [2128, 2008, 1552, 880, 1109, 712, 802], l: ["Carcinoma", "Sarcoma", "Tuberculosis", "Streptococcus", "Staphylococcus", "Typhoid", "E. coli"] },
  ] },
  { g: "Other frequency sets", items: [
    { n: "Solfeggio scale", d: "The nine Solfeggio tones, one per channel.", f: [174, 285, 396, 417, 528, 639, 741, 852, 963] },
    { n: "Schumann resonances", d: "Earth's cavity resonances. Below about 30 Hz these are too low for phone speakers to reproduce.", f: [7.83, 14.3, 20.8, 27.3, 33.8] },
    { n: "432 Hz triad", d: "A just-intonation major chord on A = 432.", f: [432, 540, 648] },
  ] },
  { g: "Binaural beats (use headphones)", items: [
    { n: "Schumann 7.83 beat", d: "200 Hz in the left ear, 207.83 Hz in the right.", f: [200, 207.83], p: [-1, 1] },
    { n: "Alpha 10 Hz", d: "Relaxed focus. 200 Hz left, 210 Hz right.", f: [200, 210], p: [-1, 1] },
    { n: "Theta 6 Hz", d: "Deep relaxation. 180 Hz left, 186 Hz right.", f: [180, 186], p: [-1, 1] },
    { n: "Delta 2 Hz", d: "Sleep range. 150 Hz left, 152 Hz right.", f: [150, 152], p: [-1, 1] },
    { n: "Gamma 40 Hz", d: "200 Hz left, 240 Hz right.", f: [200, 240], p: [-1, 1] },
  ] },
];

// Single-tone Solfeggio journeys (traditional associations)
const SOLFEGGIO_JOURNEYS = [
  { n: "174 · Foundation", f: [174], d: "Traditionally linked with grounding and a sense of safety." },
  { n: "285 · Restore", f: [285], d: "Traditionally linked with renewal and restoring the body's field." },
  { n: "396 · Release", f: [396], d: "Traditionally linked with letting go of fear and guilt." },
  { n: "417 · Change", f: [417], d: "Traditionally linked with clearing the past and making change." },
  { n: "528 · Transformation", f: [528], d: "The 'love frequency' of modern sound healing, linked with transformation." },
  { n: "639 · Connection", f: [639], d: "Traditionally linked with relationships and harmony." },
  { n: "741 · Expression", f: [741], d: "Traditionally linked with expression and clarity." },
  { n: "852 · Intuition", f: [852], d: "Traditionally linked with intuition and inner sight." },
  { n: "963 · Crown", f: [963], d: "Traditionally linked with oneness and the crown center." },
];

const TONE_SCENES = [
  { id: "lake", name: "Mountain Lake", sound: "Water & breeze" },
  { id: "forest", name: "Night Forest", sound: "Crickets & wind" },
  { id: "ocean", name: "Ocean Dusk", sound: "Rolling waves" },
  { id: "rain", name: "Rain", sound: "Soft rain" },
  { id: "aurora", name: "Aurora", sound: "Arctic wind" },
  { id: "cosmos", name: "Cosmos", sound: "Deep space drone" },
];

const NONET_KEYFRAMES = `
  @keyframes tsDrift { from { transform: translateX(0); } to { transform: translateX(-50%); } }
  @keyframes tsFloat { 0%,100% { transform: translate(0,0); opacity: .3; } 50% { transform: translate(14px,-22px); opacity: 1; } }
  @keyframes tsTwinkle { 0%,100% { opacity: .2; } 50% { opacity: 1; } }
  @keyframes tsRain { from { transform: translateY(-120px); } to { transform: translateY(1200px); } }
  @keyframes tsCurtain { 0%,100% { transform: skewX(-8deg) scaleY(1); opacity: .55; } 50% { transform: skewX(8deg) scaleY(1.12); opacity: .95; } }
  @keyframes tsSpin { from { transform: rotate(0); } to { transform: rotate(360deg); } }
  @keyframes tsShimmer { 0%,100% { opacity: .15; transform: scaleX(.8); } 50% { opacity: .6; transform: scaleX(1.1); } }
  @keyframes tsBreathe { 0% { transform: scale(.78); } 33% { transform: scale(1.08); } 50% { transform: scale(1.08); } 83% { transform: scale(.78); } 100% { transform: scale(.78); } }
  @keyframes tsPulse { 0%,100% { box-shadow: 0 0 0 0 rgba(255,255,255,.35); } 50% { box-shadow: 0 0 0 22px rgba(255,255,255,0); } }
  @keyframes tsWave { from { transform: translateX(0); } to { transform: translateX(-120px); } }
  @keyframes tsMist { 0%,100% { transform: translateX(-4%); opacity: .35; } 50% { transform: translateX(4%); opacity: .6; } }
  .ts-row::-webkit-scrollbar { height: 0; }
  .ts-glass { backdrop-filter: blur(22px) saturate(1.4); -webkit-backdrop-filter: blur(22px) saturate(1.4); }
  .ts-root canvas { opacity: 1 !important; }
  .ts-root input[type=range] { background: transparent !important; }
  .ts-range { width: 100%; accent-color: #f2a53e; height: 26px; margin: 0; }
`;

const nonetClamp = f => Math.min(NONET_MAX_F, Math.max(NONET_MIN_F, Math.round(f * 1000) / 1000));
const nonetFmt = f => (Math.round(f * 1000) / 1000).toFixed(3);
const nonetShort = f => String(Math.round(f * 1000) / 1000);
function nonetNote(f) {
  if (f < 8) return "sub-audio";
  const m = 69 + 12 * Math.log2(f / 440), r = Math.round(m), c = Math.round((m - r) * 100);
  return NONET_NOTES[((r % 12) + 12) % 12] + (Math.floor(r / 12) - 1) + " " + (c >= 0 ? "+" : "−") + Math.abs(c) + "¢";
}
const freqHue = f => Math.round((Math.log2(Math.max(1, f)) * 47) % 360);

// ─── Audio engine (Web Audio): 9 oscillators + generated ambient beds ───
function createNonetEngine() {
  const E = { ctx: null, master: null, comp: null, analyser: null, nodes: [], playing: false, amb: null, ambGain: null };
  E.ensure = () => {
    if (E.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    E.ctx = new AC();
    E.master = E.ctx.createGain(); E.master.gain.value = 0;
    E.comp = E.ctx.createDynamicsCompressor(); E.comp.threshold.value = -10; E.comp.ratio.value = 8;
    E.analyser = E.ctx.createAnalyser(); E.analyser.fftSize = 2048;
    E.master.connect(E.comp); E.comp.connect(E.analyser); E.analyser.connect(E.ctx.destination);
    E.ambGain = E.ctx.createGain(); E.ambGain.gain.value = 0; E.ambGain.connect(E.ctx.destination);
  };
  const chanGain = (c, n) => (c.on ? (c.vol / 100) * 0.6 / Math.sqrt(Math.max(1, n)) : 0);
  E.start = (S) => {
    E.ensure(); E.ctx.resume();
    E.nodes.forEach(n => { try { n.o.stop(); } catch (e) {} });
    const n = S.ch.filter(c => c.on).length;
    E.nodes = S.ch.map(c => {
      const o = E.ctx.createOscillator(), g = E.ctx.createGain(), p = E.ctx.createStereoPanner ? E.ctx.createStereoPanner() : null;
      o.type = c.wave; o.frequency.value = c.f; g.gain.value = chanGain(c, n);
      o.connect(g); if (p) { p.pan.value = c.pan / 100; g.connect(p); p.connect(E.master); } else g.connect(E.master);
      o.start(); return { o, g, p };
    });
    E.master.gain.cancelScheduledValues(E.ctx.currentTime);
    E.master.gain.setTargetAtTime(S.master / 100, E.ctx.currentTime, 0.05);
    E.playing = true;
  };
  E.stop = (fade = 0.03) => {
    if (!E.ctx) return;
    E.playing = false;
    E.master.gain.cancelScheduledValues(E.ctx.currentTime);
    E.master.gain.setTargetAtTime(0, E.ctx.currentTime, fade);
    const old = E.nodes; E.nodes = [];
    setTimeout(() => old.forEach(n => { try { n.o.stop(); } catch (e) {} }), Math.max(250, fade * 5000));
  };
  E.sync = (S) => {
    if (!E.playing || !E.nodes.length) return;
    const t = E.ctx.currentTime, n = S.ch.filter(c => c.on).length;
    S.ch.forEach((c, i) => {
      const nd = E.nodes[i]; if (!nd) return;
      nd.o.frequency.setTargetAtTime(c.f, t, 0.012);
      if (nd.o.type !== c.wave) nd.o.type = c.wave;
      nd.g.gain.setTargetAtTime(chanGain(c, n), t, 0.03);
      if (nd.p) nd.p.pan.setTargetAtTime(c.pan / 100, t, 0.03);
    });
  };
  E.setMaster = (v) => { if (E.playing && E.ctx) E.master.gain.setTargetAtTime(v / 100, E.ctx.currentTime, 0.03); };

  // Ambient beds are synthesized from noise + oscillators (no audio files needed)
  const noiseBuffer = (type) => {
    const len = E.ctx.sampleRate * 3, buf = E.ctx.createBuffer(2, len, E.ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch); let last = 0, b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        if (type === "brown") { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
        else if (type === "pink") { b0 = 0.99765 * b0 + w * 0.099; b1 = 0.963 * b1 + w * 0.2965; b2 = 0.57 * b2 + w * 1.0527; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2; }
        else d[i] = w * 0.5;
      }
    }
    return buf;
  };
  E.startAmbient = (scene, vol) => {
    E.ensure(); E.ctx.resume(); E.stopAmbient(true);
    const ctx = E.ctx, parts = [], out = ctx.createGain(); out.gain.value = 1; out.connect(E.ambGain);
    const src = (type) => { const s = ctx.createBufferSource(); s.buffer = noiseBuffer(type); s.loop = true; s.start(); parts.push(s); return s; };
    const lfo = (rate, depth, target, base) => { const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = rate; g.gain.value = depth; o.connect(g); g.connect(target); if (base !== undefined) target.value = base; o.start(); parts.push(o); return o; };
    const filt = (type, f, q = 0.7) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };
    if (scene === "lake" || scene === "ocean") {
      const s = src("brown"), f = filt("lowpass", scene === "ocean" ? 700 : 450), g = ctx.createGain();
      s.connect(f); f.connect(g); g.connect(out);
      lfo(scene === "ocean" ? 0.09 : 0.18, scene === "ocean" ? 0.45 : 0.2, g.gain, scene === "ocean" ? 0.55 : 0.5);
      const hiss = src("pink"), hf = filt("highpass", 2500), hg = ctx.createGain(); hg.gain.value = scene === "ocean" ? 0.05 : 0.02;
      hiss.connect(hf); hf.connect(hg); hg.connect(out); lfo(scene === "ocean" ? 0.09 : 0.13, 0.03, hg.gain);
    } else if (scene === "rain") {
      const s = src("white"), f = filt("bandpass", 2600, 0.4), g = ctx.createGain(); g.gain.value = 0.35;
      s.connect(f); f.connect(g); g.connect(out);
      const r = src("brown"), rf = filt("lowpass", 300), rg = ctx.createGain(); rg.gain.value = 0.35; r.connect(rf); rf.connect(rg); rg.connect(out);
    } else if (scene === "forest") {
      const w = src("pink"), wf = filt("lowpass", 500), wg = ctx.createGain(); wg.gain.value = 0.25; w.connect(wf); wf.connect(wg); wg.connect(out);
      lfo(0.07, 0.12, wg.gain, 0.25);
      [4400, 4700].forEach((fr, k) => {
        const o = ctx.createOscillator(), g = ctx.createGain(), gate = ctx.createGain(); o.frequency.value = fr; g.gain.value = 0;
        gate.gain.value = 0.012; o.connect(g); g.connect(out);
        const chirp = ctx.createOscillator(); chirp.type = "square"; chirp.frequency.value = 22 + k * 5; chirp.connect(gate); gate.connect(g.gain);
        const burst = ctx.createOscillator(), bg = ctx.createGain(); burst.frequency.value = 0.5 + k * 0.23; bg.gain.value = 0.01; burst.connect(bg); bg.connect(g.gain);
        o.start(); chirp.start(); burst.start(); parts.push(o, chirp, burst);
      });
    } else if (scene === "aurora") {
      const s = src("pink"), f = filt("bandpass", 600, 1.2), g = ctx.createGain(); g.gain.value = 0.4;
      s.connect(f); f.connect(g); g.connect(out); lfo(0.05, 400, f.frequency, 600); lfo(0.11, 0.2, g.gain, 0.4);
    } else if (scene === "cosmos") {
      [55, 82.5, 110.3].forEach((fr, k) => { const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = fr; g.gain.value = 0.06 - k * 0.015; o.connect(g); g.connect(out); o.start(); parts.push(o); lfo(0.03 + k * 0.02, 0.02, g.gain); });
      const s = src("brown"), f = filt("lowpass", 180), g = ctx.createGain(); g.gain.value = 0.3; s.connect(f); f.connect(g); g.connect(out);
    }
    E.amb = { parts, out };
    E.ambGain.gain.cancelScheduledValues(ctx.currentTime);
    E.ambGain.gain.setTargetAtTime(vol / 100 * 0.5, ctx.currentTime, 0.8);
  };
  E.setAmbient = (vol) => { if (E.ctx && E.amb) E.ambGain.gain.setTargetAtTime(vol / 100 * 0.5, E.ctx.currentTime, 0.2); };
  E.stopAmbient = (instant) => {
    if (!E.ctx || !E.amb) return;
    const a = E.amb; E.amb = null;
    if (!instant) E.ambGain.gain.setTargetAtTime(0, E.ctx.currentTime, 1.2);
    setTimeout(() => a.parts.forEach(p => { try { p.stop(); } catch (e) {} }), instant ? 0 : 4000);
  };
  E.fadeAll = (sec) => { if (!E.ctx) return; E.stop(sec / 4); E.stopAmbient(false); };
  E.close = () => { try { E.nodes.forEach(n => n.o.stop()); } catch (e) {} if (E.amb) E.stopAmbient(true); if (E.ctx) { try { E.ctx.close(); } catch (e) {} } E.ctx = null; E.playing = false; };
  return E;
}

// ─── Scene art (full-bleed, animated) ───
function ToneScene({ id }) {
  const stars = (n, h, seed = 1) => Array.from({ length: n }, (_, i) => {
    const r = k => { const x = Math.sin((i + k) * 12.9898 + seed * 78.233) * 43758.5453; return x - Math.floor(x); };
    return <circle key={i} cx={r(1) * 1600} cy={r(2) * h} r={r(3) * 1.6 + 0.4} fill="#fff" style={{ animation: `tsTwinkle ${2 + r(4) * 4}s ease-in-out ${r(5) * 4}s infinite` }} />;
  });
  const wrap = (children, bgA, bgB) => (
    <svg viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
      <defs><linearGradient id={`ts-bg-${id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={bgA} /><stop offset="100%" stopColor={bgB} /></linearGradient></defs>
      <rect width="1600" height="900" fill={`url(#ts-bg-${id})`} />
      {children}
    </svg>
  );
  if (id === "lake") return wrap(<>
    <circle cx="1100" cy="430" r="90" fill="#fde68a" opacity="0.85" />
    <circle cx="1100" cy="430" r="160" fill="#fde68a" opacity="0.15" />
    <path d="M0 520 L220 300 L380 440 L560 250 L780 470 L980 330 L1180 480 L1380 290 L1600 460 L1600 560 L0 560 Z" fill="#475569" opacity="0.85" />
    <path d="M0 540 L160 420 L340 500 L520 380 L720 520 L900 420 L1120 540 L1320 420 L1600 520 L1600 580 L0 580 Z" fill="#334155" />
    <rect x="0" y="560" width="1600" height="340" fill="#1e3a5f" />
    <g opacity="0.35" transform="translate(0 1120) scale(1 -1)"><path d="M0 540 L160 420 L340 500 L520 380 L720 520 L900 420 L1120 540 L1320 420 L1600 520 L1600 580 L0 580 Z" fill="#334155" /></g>
    {Array.from({ length: 14 }, (_, i) => <rect key={i} x={1000 + (i % 3) * 30 - 60} y={600 + i * 18} width={200 - i * 8} height="3" rx="1.5" fill="#fde68a" style={{ transformOrigin: `1100px ${600 + i * 18}px`, animation: `tsShimmer ${2 + (i % 4) * 0.6}s ease-in-out ${i * 0.2}s infinite` }} />)}
    <ellipse cx="800" cy="560" rx="900" ry="40" fill="#fff" style={{ animation: "tsMist 16s ease-in-out infinite" }} />
  </>, "#7c9cc4", "#f4c08e");
  if (id === "forest") return wrap(<>
    {stars(120, 500, 2)}
    <circle cx="1250" cy="170" r="60" fill="#f1f5f9" /><circle cx="1250" cy="170" r="120" fill="#f1f5f9" opacity="0.08" />
    {[0, 1, 2].map(layer => (
      <g key={layer} fill={["#1e293b", "#0f172a", "#020617"][layer]}>
        {Array.from({ length: 18 }, (_, i) => { const x = i * 95 + layer * 40 - 40, h = 260 + ((i * 37 + layer * 53) % 160) + layer * 70, base = 900; return <path key={i} d={`M${x} ${base} L${x + 45} ${base - h} L${x + 90} ${base} Z`} />; })}
      </g>
    ))}
    {Array.from({ length: 26 }, (_, i) => <circle key={i} cx={(i * 131) % 1600} cy={560 + (i * 71) % 300} r="3" fill="#fef08a" style={{ filter: "drop-shadow(0 0 6px #fef08a)", animation: `tsFloat ${4 + (i % 5)}s ease-in-out ${i * 0.4}s infinite` }} />)}
  </>, "#0b1330", "#1e293b");
  if (id === "ocean") return wrap(<>
    <circle cx="800" cy="520" r="120" fill="#fb923c" /><circle cx="800" cy="520" r="220" fill="#fdba74" opacity="0.2" />
    <rect x="0" y="520" width="1600" height="380" fill="#312e81" />
    {Array.from({ length: 6 }, (_, i) => (
      <g key={i} style={{ animation: `tsDrift ${22 + i * 6}s linear infinite` }}>
        <path d={`M0 ${560 + i * 55} ` + Array.from({ length: 28 }, (_, k) => `Q${k * 120 + 60} ${548 + i * 55 - (i % 2 ? 8 : 12)} ${k * 120 + 120} ${560 + i * 55}`).join(" ") + ` L3360 900 L0 900 Z`} fill={["#4c1d95", "#3b0764", "#312e81", "#1e1b4b", "#172554", "#0f172a"][i]} opacity="0.9" />
      </g>
    ))}
    {Array.from({ length: 10 }, (_, i) => <rect key={i} x={760 - i * 6} y={540 + i * 14} width={80 + i * 12} height="3" rx="1.5" fill="#fdba74" style={{ transformOrigin: `800px ${540 + i * 14}px`, animation: `tsShimmer ${2 + (i % 3)}s ease-in-out ${i * 0.3}s infinite` }} />)}
  </>, "#6d28d9", "#fb7185");
  if (id === "rain") return wrap(<>
    <path d="M0 700 Q400 640 800 690 T1600 680 L1600 900 L0 900 Z" fill="#1e293b" />
    {Array.from({ length: 140 }, (_, i) => <line key={i} x1={(i * 83) % 1600} x2={(i * 83) % 1600 - 8} y1="0" y2="40" stroke="#cbd5e1" strokeWidth="1.5" opacity={0.25 + (i % 5) * 0.08} style={{ animation: `tsRain ${0.9 + (i % 7) * 0.12}s linear ${(i % 11) * 0.13}s infinite` }} />)}
    {Array.from({ length: 12 }, (_, i) => <circle key={i} cx={(i * 211) % 1600} cy={120 + (i * 97) % 500} r={6 + (i % 3) * 3} fill="#e2e8f0" opacity="0.12" />)}
  </>, "#334155", "#64748b");
  if (id === "aurora") return wrap(<>
    {stars(90, 600, 5)}
    {[0, 1, 2, 3, 4].map(i => <path key={i} d={`M${100 + i * 300} 620 C ${200 + i * 300} 200, ${300 + i * 300} 350, ${380 + i * 300} 80`} stroke={i % 2 ? "#a78bfa" : "#34d399"} strokeWidth="90" fill="none" opacity="0.5" strokeLinecap="round" style={{ transformOrigin: `${240 + i * 300}px 620px`, animation: `tsCurtain ${7 + i}s ease-in-out ${i * 0.8}s infinite`, filter: "blur(18px)" }} />)}
    <path d="M0 720 Q300 640 600 700 T1200 690 T1600 700 L1600 900 L0 900 Z" fill="#e2e8f0" />
    <path d="M0 780 Q400 720 800 770 T1600 760 L1600 900 L0 900 Z" fill="#cbd5e1" />
  </>, "#020617", "#134e4a");
  // cosmos
  return wrap(<>
    {stars(220, 900, 9)}
    <circle cx="500" cy="350" r="380" fill="#7c3aed" opacity="0.18" style={{ filter: "blur(60px)" }} />
    <circle cx="1150" cy="560" r="320" fill="#0ea5e9" opacity="0.14" style={{ filter: "blur(60px)" }} />
    <g style={{ transformOrigin: "800px 450px", animation: "tsSpin 240s linear infinite" }}>
      {Array.from({ length: 180 }, (_, i) => { const t = i / 180 * 5, a = t * 2.4 + (i % 2) * Math.PI, rr = 40 + t * 110; return <circle key={i} cx={800 + Math.cos(a) * rr * 1.6} cy={450 + Math.sin(a) * rr * 0.7} r={(i % 4) * 0.5 + 0.8} fill={i % 3 ? "#c4b5fd" : "#f0abfc"} opacity="0.8" />; })}
      <circle cx="800" cy="450" r="26" fill="#fde68a" opacity="0.9" style={{ filter: "blur(6px)" }} />
    </g>
  </>, "#020617", "#1e1b4b");
}

// Mini animated waveform art for a set of frequencies (card thumbnails)
function FreqArt({ f, h = 120 }) {
  const hue = freqHue(f[0]), hue2 = freqHue(f[f.length - 1] * 1.7);
  const lo = Math.min(...f);
  const cycles = Math.max(2, Math.min(9, Math.round(Math.log2(lo + 2) * 0.9)));
  const path = amp => "M-240 " + h / 2 + " " + Array.from({ length: cycles * 4 + 12 }, (_, i) => `Q${-240 + i * 30 + 15} ${h / 2 + (i % 2 ? amp : -amp)} ${-240 + (i + 1) * 30} ${h / 2}`).join(" ");
  return (
    <svg viewBox={`0 0 240 ${h}`} width="100%" height="100%" preserveAspectRatio="none" style={{ display: "block" }}>
      <defs><linearGradient id={`fa-${f.join("-")}`} x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor={`hsl(${hue} 70% 32%)`} /><stop offset="100%" stopColor={`hsl(${hue2} 75% 18%)`} /></linearGradient></defs>
      <rect width="240" height={h} fill={`url(#fa-${f.join("-")})`} />
      <circle cx="190" cy="20" r="60" fill={`hsl(${hue} 90% 70%)`} opacity="0.18" />
      {[0.34, 0.2, 0.1].map((a, i) => <path key={i} d={path(h * a)} fill="none" stroke="#fff" strokeOpacity={0.7 - i * 0.2} strokeWidth={2 - i * 0.5} style={{ animation: `tsWave ${3 + i * 1.5}s linear infinite` }} />)}
    </svg>
  );
}

function ToneSanctuary({ isMobile, setActiveTab }) {
  const defaults = [20, 727, 787, 880, 1550, 1865, 5000, 10000, 528];
  const [S, setS] = useState(() => {
    const base = { ch: defaults.map((f, i) => ({ f, on: i < 8, vol: 70, wave: "sine", pan: 0 })), master: 35, sel: 0, step: 1, dwell: 180, user: [] };
    try { const raw = window.localStorage.getItem("nonet-v1"); if (raw) { const o = JSON.parse(raw); if (o && Array.isArray(o.ch) && o.ch.length === 9) return { ...base, ...o }; } } catch (e) {}
    return base;
  });
  const [view, setView] = useState("sanctuary"); // sanctuary | studio | library | calc
  const [playing, setPlaying] = useState(false);
  const [scene, setScene] = useState("lake");
  const [ambOn, setAmbOn] = useState(true);
  const [ambVol, setAmbVol] = useState(40);
  const [session, setSession] = useState({ name: "Your channels", sub: "Nine-channel mix" });
  const [dur, setDur] = useState(20); // minutes, 0 = infinite
  const [endsAt, setEndsAt] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [breath, setBreath] = useState(true);
  const [toast, setToast] = useState("");
  const [search, setSearch] = useState("");
  const [seq, setSeq] = useState(null); // { p, idx, end }
  const [confirmDel, setConfirmDel] = useState(null);
  const [saveName, setSaveName] = useState("");
  const [calcMode, setCalcMode] = useState("spread");
  const [cBase, setCBase] = useState("528");
  const [cParam, setCParam] = useState("0.5");
  const [freqDraft, setFreqDraft] = useState(null);
  const eng = useRef(null);
  if (!eng.current) eng.current = createNonetEngine();
  const E = eng.current;
  const canvasRef = useRef(null);
  const dialRef = useRef(null);
  const rotRef = useRef(0);

  const flash = m => { setToast(m); clearTimeout(flash.t); flash.t = setTimeout(() => setToast(""), 1700); };
  // persist
  useEffect(() => { const t = setTimeout(() => { try { window.localStorage.setItem("nonet-v1", JSON.stringify(S)); } catch (e) {} }, 300); return () => clearTimeout(t); }, [S]);
  // keep audio in sync
  useEffect(() => { E.sync(S); }, [S.ch]);
  useEffect(() => { E.setMaster(S.master); }, [S.master]);
  useEffect(() => { E.setAmbient(ambVol); }, [ambVol]);
  useEffect(() => () => E.close(), []);
  // clock for timers / sequence
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(t); }, []);

  const upd = fn => setS(prev => { const n = { ...prev, ch: prev.ch.map(c => ({ ...c })) }; fn(n); return n; });
  const setF = (i, f) => upd(n => { n.ch[i].f = nonetClamp(f); });

  const startPlay = (st = S) => {
    E.start(st); setPlaying(true);
    if (ambOn && scene) E.startAmbient(scene, ambVol);
    setEndsAt(dur ? Date.now() + dur * 60000 : null);
  };
  const stopPlay = () => { E.stop(); E.stopAmbient(false); setPlaying(false); setEndsAt(null); setSeq(null); };
  // session timer → gentle fade out (Calm-style)
  useEffect(() => {
    if (playing && endsAt && now >= endsAt) { E.fadeAll(8); setPlaying(false); setEndsAt(null); setSeq(null); flash("Session complete"); }
  }, [now]);
  // sequence runner
  useEffect(() => {
    if (!seq || !playing) return;
    if (now >= seq.end) {
      const idx = seq.idx + 1;
      if (idx >= seq.p.f.length) { setSeq(null); stopPlay(); flash("Sequence finished"); return; }
      upd(n => { n.ch[0].f = nonetClamp(seq.p.f[idx]); n.ch[0].on = true; });
      setSeq({ ...seq, idx, end: Date.now() + S.dwell * 1000 });
    }
  }, [now]);

  const loadSet = (p, { play = true, name, sub } = {}) => {
    const next = { ...S, ch: S.ch.map((c, i) => i < p.f.length ? { ...c, f: nonetClamp(p.f[i]), on: true, pan: p.p ? Math.round(p.p[i] * 100) : 0 } : { ...c, on: false }) };
    setS(next); setSeq(null);
    setSession({ name: name || p.n, sub: sub || `${p.f.length} frequenc${p.f.length === 1 ? "y" : "ies"} · ${p.f.map(nonetShort).slice(0, 4).join(" · ")}${p.f.length > 4 ? " …" : ""}` });
    if (play) { if (playing) E.sync(next); else startPlay(next); }
  };
  const startSeq = (p) => {
    const next = { ...S, ch: S.ch.map((c, i) => ({ ...c, on: i === 0, pan: i === 0 ? 0 : c.pan, f: i === 0 ? nonetClamp(p.f[0]) : c.f })) };
    setS(next); setSeq({ p, idx: 0, end: Date.now() + S.dwell * 1000 });
    setSession({ name: `Sequence · ${p.n}`, sub: `${p.f.length} steps · ${Math.round(S.dwell / 60 * 10) / 10} min each` });
    if (playing) E.sync(next); else startPlay(next);
    flash("Sequence started");
  };

  // scope drawing
  useEffect(() => {
    let raf, buf = null;
    const draw = () => {
      const cv = canvasRef.current;
      if (cv) {
        const d = window.devicePixelRatio || 1;
        if (cv.width !== cv.clientWidth * d) { cv.width = cv.clientWidth * d; cv.height = cv.clientHeight * d; }
        const g = cv.getContext("2d"), W = cv.width, H = cv.height;
        g.clearRect(0, 0, W, H);
        g.strokeStyle = "rgba(255,255,255,.08)"; g.lineWidth = 1;
        for (let k = 1; k < 8; k++) { g.beginPath(); g.moveTo(W * k / 8, 0); g.lineTo(W * k / 8, H); g.stroke(); }
        g.strokeStyle = "#f2a53e"; g.lineWidth = 2 * d; g.shadowColor = "#f2a53e"; g.shadowBlur = 8; g.beginPath();
        if (E.playing && E.analyser) {
          if (!buf) buf = new Float32Array(E.analyser.fftSize); E.analyser.getFloatTimeDomainData(buf);
          let s0 = 0; for (let k = 1; k < buf.length / 2; k++) { if (buf[k - 1] < 0 && buf[k] >= 0) { s0 = k; break; } }
          const N = buf.length / 2; let mx = 0.02; for (let k = 0; k < N; k++) mx = Math.max(mx, Math.abs(buf[s0 + k]));
          for (let k = 0; k < N; k++) { const x = k / (N - 1) * W, y = H / 2 - buf[s0 + k] / mx * H * 0.42; k ? g.lineTo(x, y) : g.moveTo(x, y); }
        } else {
          const act = S.ch.filter(c => c.on);
          if (act.length) {
            const lo = Math.min(...act.map(c => c.f)), hi = Math.max(...act.map(c => c.f));
            const win = Math.min(0.5, Math.max(0.002, Math.min(3 / lo, 24 / hi))), N = 600, ys = []; let mx = 0.01;
            const wf = { sine: x => Math.sin(x), square: x => (Math.sin(x) >= 0 ? 1 : -1), triangle: x => 2 / Math.PI * Math.asin(Math.sin(x)), sawtooth: x => { const t = x / (2 * Math.PI); return 2 * (t - Math.floor(t + 0.5)); } };
            for (let k = 0; k < N; k++) { const t = k / (N - 1) * win; let y = 0; act.forEach(c => { y += (c.vol / 100) * wf[c.wave](2 * Math.PI * c.f * t); }); ys.push(y); mx = Math.max(mx, Math.abs(y)); }
            ys.forEach((y, k) => { const x = k / (N - 1) * W, yy = H / 2 - y / mx * H * 0.42; k ? g.lineTo(x, yy) : g.moveTo(x, yy); });
          } else { g.moveTo(0, H / 2); g.lineTo(W, H / 2); }
        }
        g.stroke(); g.shadowBlur = 0;
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [S.ch, view]);

  // ── jog dial ──
  const jog = useRef({ active: false, last: 0, acc: 0 });
  const angOf = (e, el) => { const r = el.getBoundingClientRect(); return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)); };
  const nudge = dir => setF(S.sel, S.ch[S.sel].f + dir * S.step);
  const holdRef = useRef({});
  const holdStart = dir => { nudge(dir); holdRef.current.t = setTimeout(() => { holdRef.current.iv = setInterval(() => setS(prev => { const n = { ...prev, ch: prev.ch.map(c => ({ ...c })) }; n.ch[n.sel].f = nonetClamp(n.ch[n.sel].f + dir * n.step); return n; }), 60); }, 380); };
  const holdEnd = () => { clearTimeout(holdRef.current.t); clearInterval(holdRef.current.iv); };

  const act = S.ch.filter(c => c.on);
  const sel = S.ch[S.sel];
  const remaining = endsAt ? Math.max(0, endsAt - now) : null;
  const mmss = ms => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;
  const dayIdx = Math.floor(Date.now() / 86400000) % SOLFEGGIO_JOURNEYS.length;
  const daily = SOLFEGGIO_JOURNEYS[dayIdx];
  const posToLog = v => Math.pow(10, v / 1000 * Math.log10(NONET_MAX_F));
  const logToPos = f => Math.round(Math.log10(Math.max(1, f)) / Math.log10(NONET_MAX_F) * 1000);

  // ── calculator ──
  const MODES = {
    spread: { label: "Step between channels (Hz)", def: "0.5", hint: "Centers the base on channel 5 and steps up and down from it. Use a tiny step (0.01) to hunt for an exact frequency by ear." },
    harm: { label: "", def: "", hint: "Channel n plays base × n: the natural overtone series." },
    sub: { label: "", def: "", hint: "Channel n plays base ÷ n: the undertone series." },
    oct: { label: "", def: "", hint: "Base sits on channel 5, with octaves (×2, ÷2) either side. Values outside 0.01–22,000 Hz are clamped." },
    geo: { label: "Ratio r", def: "1.5", hint: "Each channel multiplies the previous one by r. Try 1.5 for a stack of fifths or 1.618 for the golden ratio." },
    beat: { label: "Step between channels (Hz)", def: "7.83", hint: "Base on channel 1, then base + step, base + 2·step… Neighbouring channels beat at exactly the step rate." },
  };
  const num = (v, d) => { const x = parseFloat(String(v).replace(",", ".")); return isFinite(x) ? x : d; };
  const calcOut = (() => {
    const b = num(cBase, 528), p = num(cParam, 1), out = [];
    for (let n = 0; n < 9; n++) {
      let f;
      if (calcMode === "spread") f = b + (n - 4) * p; else if (calcMode === "harm") f = b * (n + 1); else if (calcMode === "sub") f = b / (n + 1);
      else if (calcMode === "oct") f = b * Math.pow(2, n - 4); else if (calcMode === "geo") f = b * Math.pow(p, n); else f = b + n * p;
      out.push(nonetClamp(f));
    }
    return out;
  })();
  const gcd = (a, b) => { while (b) { [a, b] = [b, a % b]; } return a; };
  const analysis = (() => {
    const a = S.ch.map((c, i) => ({ i, f: c.f, on: c.on })).filter(x => x.on);
    if (!a.length) return null;
    const fs = a.map(x => x.f), sum = fs.reduce((x, y) => x + y, 0);
    const fund = fs.map(f => Math.round(f * 1000)).reduce(gcd) / 1000;
    const pairs = []; for (let x = 0; x < a.length; x++) for (let y = x + 1; y < a.length; y++) pairs.push({ a: a[x].i + 1, b: a[y].i + 1, d: Math.abs(a[x].f - a[y].f) });
    pairs.sort((p, q) => p.d - q.d);
    return { lo: Math.min(...fs), hi: Math.max(...fs), avg: sum / fs.length, sum, fund, pairs };
  })();

  // ── shared UI bits ──
  const glass = { background: "rgba(10,12,20,0.55)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 22 };
  const pill = on => ({ padding: "8px 14px", borderRadius: 999, cursor: "pointer", fontFamily: KID_FONT, fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", border: `1px solid ${on ? "#f2a53e" : "rgba(255,255,255,0.16)"}`, background: on ? "rgba(242,165,62,0.18)" : "rgba(255,255,255,0.06)", color: on ? "#fcd9a3" : "#e2e8f0" });
  const btn = (primary) => ({ padding: "10px 16px", borderRadius: 12, cursor: "pointer", fontFamily: KID_FONT, fontSize: 14, fontWeight: 600, border: `1px solid ${primary ? "#f2a53e" : "rgba(255,255,255,0.14)"}`, background: primary ? "#f2a53e" : "rgba(255,255,255,0.06)", color: primary ? "#1a1206" : "#e2e8f0" });
  const label = { fontSize: 11, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", color: "rgba(226,232,240,0.6)" };
  const input = { background: "rgba(0,0,0,0.35)", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 12, padding: "11px 13px", color: "#f8fafc", fontFamily: KID_FONT, fontSize: 15, width: "100%", outline: "none" };
  const mono = { fontFamily: "'JetBrains Mono', monospace", fontVariantNumeric: "tabular-nums" };

  const JourneyCard = ({ p, tag, w = 220, onPlay }) => (
    <button onClick={onPlay || (() => { loadSet(p); flash(`${p.n} playing`); })} style={{ flexShrink: 0, width: w, textAlign: "left", cursor: "pointer", padding: 0, borderRadius: 18, overflow: "hidden", border: "1px solid rgba(255,255,255,0.12)", background: "rgba(10,12,20,0.6)", color: "#f8fafc", fontFamily: KID_FONT }}>
      <div style={{ height: 118, position: "relative" }}>
        <FreqArt f={p.f} />
        {tag && <span style={{ position: "absolute", top: 10, left: 10, padding: "3px 9px", borderRadius: 999, background: "rgba(0,0,0,0.45)", fontSize: 10.5, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" }}>{tag}</span>}
        <span style={{ position: "absolute", right: 10, bottom: 10, width: 34, height: 34, borderRadius: "50%", background: "rgba(255,255,255,0.92)", color: "#0f172a", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13 }}>▶</span>
      </div>
      <div style={{ padding: "11px 13px 13px" }}>
        <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-0.01em" }}>{p.n}</div>
        <div style={{ fontSize: 12, color: "rgba(226,232,240,0.65)", marginTop: 3, ...mono }}>{p.f.slice(0, 5).map(nonetShort).join(" · ")}{p.f.length > 5 ? " …" : ""} Hz</div>
      </div>
    </button>
  );
  const Row = ({ title, sub, children }) => (
    <div style={{ marginBottom: 26 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, marginBottom: 10 }}>
        <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.02em", color: "#f8fafc" }}>{title}</div>
        {sub && <div style={{ fontSize: 12.5, color: "rgba(226,232,240,0.6)" }}>{sub}</div>}
      </div>
      <div className="ts-row" style={{ display: "flex", gap: 12, overflowX: "auto", paddingBottom: 4, scrollSnapType: "x mandatory" }}>{children}</div>
    </div>
  );

  const rife = NONET_PRESETS[0], other = NONET_PRESETS[1], binaural = NONET_PRESETS[2];
  const q = search.trim().toLowerCase();
  const libGroups = [...NONET_PRESETS, ...(S.user.length ? [{ g: "Your saved sets", items: S.user.map((u, k) => ({ ...u, user: k })) }] : [])]
    .map(g => ({ ...g, items: g.items.filter(p => !q || (p.n + " " + (p.d || "") + " " + g.g + " " + (p.l || []).join(" ") + " " + p.f.join(" ")).toLowerCase().includes(q)) }))
    .filter(g => g.items.length);

  return (
    <div className="ts-root" style={{ fontFamily: KID_FONT, color: "#f8fafc", position: "relative", paddingBottom: 30 }}>
      <style>{NONET_KEYFRAMES}</style>
      {/* full-bleed scene backdrop */}
      <div aria-hidden style={{ position: "fixed", inset: 0, zIndex: -1, pointerEvents: "none", overflow: "hidden" }}>
        <ToneScene id={scene} />
        <div style={{ position: "absolute", inset: 0, background: view === "sanctuary" ? "linear-gradient(180deg, rgba(5,6,13,0.15), rgba(5,6,13,0.55) 55%, rgba(5,6,13,0.85))" : "rgba(5,6,13,0.78)", transition: "background 0.6s" }} />
      </div>

      {/* tabs */}
      <div className="ts-row ts-glass" style={{ ...glass, display: "flex", padding: 4, borderRadius: 999, marginBottom: 20, overflowX: "auto" }}>
        {[["sanctuary", "Sanctuary"], ["studio", "Studio"], ["library", "Library"], ["calc", "Calculator"]].map(([id, lbl]) => (
          <button key={id} onClick={() => setView(id)} style={{ flex: 1, padding: "10px 14px", borderRadius: 999, border: "none", cursor: "pointer", fontFamily: KID_FONT, fontSize: 14, fontWeight: 600, whiteSpace: "nowrap", color: view === id ? "#0f172a" : "rgba(226,232,240,0.75)", background: view === id ? "#f8fafc" : "transparent", transition: "all 0.3s" }}>{lbl}</button>
        ))}
      </div>

      {/* sequence banner */}
      {seq && (
        <div className="ts-glass" style={{ ...glass, borderColor: "rgba(88,195,181,0.6)", display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", marginBottom: 16 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ ...label, color: "#58c3b5" }}>Sequence · {seq.p.n}</div>
            <div style={{ fontSize: 15, ...mono, marginTop: 2 }}>{seq.idx + 1}/{seq.p.f.length} · {nonetShort(seq.p.f[seq.idx])} Hz{seq.p.l ? ` (${seq.p.l[seq.idx]})` : ""} · {mmss(Math.max(0, seq.end - now))}</div>
            <div style={{ height: 4, borderRadius: 4, background: "rgba(255,255,255,0.12)", marginTop: 8, overflow: "hidden" }}>
              <div style={{ height: "100%", background: "#58c3b5", width: `${((seq.idx + (1 - Math.max(0, seq.end - now) / (S.dwell * 1000))) / seq.p.f.length) * 100}%` }} />
            </div>
          </div>
          <button onClick={() => setSeq({ ...seq, end: 0 })} style={{ ...btn(false), borderColor: "#58c3b5", color: "#58c3b5" }}>Next</button>
          <button onClick={stopPlay} style={btn(false)}>Stop</button>
        </div>
      )}

      {/* ═══ SANCTUARY (Calm-style hero + Gaia-style rows) ═══ */}
      {view === "sanctuary" && (
        <div>
          <div style={{ textAlign: "center", padding: isMobile ? "10px 0 26px" : "20px 0 34px" }}>
            <div style={{ ...label, color: "rgba(248,250,252,0.8)" }}>Tone Sanctuary · {TONE_SCENES.find(s => s.id === scene).name}</div>
            <div className="kid-serif" style={{ fontSize: isMobile ? 40 : 54, lineHeight: 1.05, marginTop: 10, color: "#fefefe", textShadow: "0 2px 30px rgba(0,0,0,0.35)" }}>{session.name}</div>
            <div style={{ fontSize: 14.5, color: "rgba(248,250,252,0.8)", marginTop: 8, ...mono }}>{session.sub}</div>

            {/* breathing play orb */}
            <div style={{ position: "relative", width: 190, height: 190, margin: "30px auto 18px" }}>
              {breath && playing && <div style={{ position: "absolute", inset: -26, borderRadius: "50%", border: "1.5px solid rgba(255,255,255,0.45)", background: "radial-gradient(circle, rgba(255,255,255,0.12), transparent 70%)", animation: "tsBreathe 16s ease-in-out infinite" }} />}
              <button onClick={() => (playing ? stopPlay() : startPlay())} aria-label={playing ? "Stop" : "Play"} style={{
                position: "absolute", inset: 0, borderRadius: "50%", cursor: "pointer", border: "1px solid rgba(255,255,255,0.35)",
                background: "radial-gradient(circle at 35% 30%, rgba(255,255,255,0.35), rgba(255,255,255,0.08) 60%)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
                color: "#fefefe", fontSize: 44, display: "flex", alignItems: "center", justifyContent: "center", animation: playing ? "none" : "tsPulse 2.6s ease-in-out infinite",
              }}>{playing ? "❚❚" : "▶"}</button>
            </div>
            {breath && playing && <div style={{ fontSize: 13, color: "rgba(248,250,252,0.75)" }}>Breathe with the ring · in 4 · hold 4 · out 4 · hold 4</div>}
            <div className="kid-num" style={{ fontSize: 13.5, color: "rgba(248,250,252,0.85)", marginTop: 8 }}>
              {playing ? (remaining !== null ? `${mmss(remaining)} left · fades out gently` : "Playing until you stop") : `${act.length} channel${act.length === 1 ? "" : "s"} ready`}
            </div>

            {/* timer + options */}
            <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap", marginTop: 18 }}>
              {[5, 10, 20, 30, 60, 0].map(m => <button key={m} onClick={() => { setDur(m); if (playing) setEndsAt(m ? Date.now() + m * 60000 : null); }} style={pill(dur === m)}>{m ? `${m} min` : "∞"}</button>)}
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap", marginTop: 10 }}>
              <button onClick={() => setBreath(b => !b)} style={pill(breath)}>◯ Breathing guide</button>
              <button onClick={() => { const on = !ambOn; setAmbOn(on); if (playing) { on ? E.startAmbient(scene, ambVol) : E.stopAmbient(false); } }} style={pill(ambOn)}>♪ Scene sound</button>
            </div>
          </div>

          {/* scenes (Calm) */}
          <div className="ts-glass" style={{ ...glass, padding: 16, marginBottom: 26 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 12 }}>
              <span style={label}>Scenes</span>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flex: "0 1 220px" }}>
                <span style={{ ...label, letterSpacing: "0.08em" }}>Ambience</span>
                <input className="ts-range" type="range" min="0" max="100" value={ambVol} onChange={e => setAmbVol(+e.target.value)} />
              </div>
            </div>
            <div className="ts-row" style={{ display: "flex", gap: 10, overflowX: "auto" }}>
              {TONE_SCENES.map(sc => (
                <button key={sc.id} onClick={() => { setScene(sc.id); if (playing && ambOn) E.startAmbient(sc.id, ambVol); }} style={{ flexShrink: 0, width: 130, padding: 0, borderRadius: 14, overflow: "hidden", cursor: "pointer", border: `2px solid ${scene === sc.id ? "#fff" : "transparent"}`, background: "none", color: "#fefefe", fontFamily: KID_FONT, textAlign: "left" }}>
                  <div style={{ height: 76, position: "relative", overflow: "hidden" }}><ToneScene id={sc.id} /></div>
                  <div style={{ padding: "7px 9px", background: "rgba(0,0,0,0.5)" }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{sc.name}</div>
                    <div style={{ fontSize: 11, color: "rgba(226,232,240,0.65)" }}>{sc.sound}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* daily frequency (Gaia's Daily Divination idea) */}
          <div className="ts-glass" style={{ ...glass, overflow: "hidden", display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1.2fr", marginBottom: 26 }}>
            <div style={{ minHeight: 150, position: "relative" }}><FreqArt f={daily.f} h={160} /></div>
            <div style={{ padding: "18px 20px" }}>
              <div style={{ ...label, color: "#fcd9a3" }}>Today's frequency</div>
              <div className="kid-serif" style={{ fontSize: 32, marginTop: 6, color: "#fefefe" }}>{daily.n}</div>
              <div style={{ fontSize: 14.5, color: "rgba(226,232,240,0.8)", marginTop: 6, lineHeight: 1.5 }}>{daily.d} A new tone is chosen each day.</div>
              <button onClick={() => { loadSet(daily, { name: daily.n, sub: `Today's frequency · ${daily.f[0]} Hz` }); }} style={{ ...btn(true), marginTop: 14 }}>▶ Play today's tone</button>
            </div>
          </div>

          {/* content rows (Gaia) */}
          <Row title="Solfeggio Journeys" sub="Single-tone sessions">
            {SOLFEGGIO_JOURNEYS.map(p => <JourneyCard key={p.n} p={p} tag="Solfeggio" />)}
            <JourneyCard p={other.items[0]} tag="All nine" />
          </Row>
          <Row title="Brainwave States" sub="Binaural · use headphones">
            {binaural.items.map(p => <JourneyCard key={p.n} p={p} tag="Binaural" />)}
          </Row>
          <Row title="Earth & Harmony">
            {other.items.slice(1).map(p => <JourneyCard key={p.n} p={p} tag="Earth" />)}
          </Row>
          <Row title="Rife Programs" sub="Tap to play · sequence in Library">
            {rife.items.map(p => <JourneyCard key={p.n} p={p} tag="Rife" />)}
          </Row>
          {S.user.length > 0 && (
            <Row title="Your Saved Sets">
              {S.user.map((p, k) => <JourneyCard key={k} p={p} tag="Saved" />)}
            </Row>
          )}
          <p style={{ fontSize: 12.5, color: "rgba(226,232,240,0.6)", lineHeight: 1.5 }}>
            Rife lists and Solfeggio meanings come from traditional and hobbyist sources and are not proven medical treatments. Use them alongside care from a clinician, never in place of it. Keep the volume moderate.
          </p>
        </div>
      )}

      {/* ═══ STUDIO (Nonet channels + tuner) ═══ */}
      {view === "studio" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <div>
              <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: "0.14em", ...mono }}>NON<span style={{ color: "#f2a53e" }}>E</span>T</div>
              <div style={label}>9-channel tone lab</div>
            </div>
            <button onClick={() => (playing ? stopPlay() : startPlay())} aria-label={playing ? "Stop" : "Play all active channels"} style={{ width: 60, height: 60, borderRadius: "50%", border: "2px solid #f2a53e", background: playing ? "#f2a53e" : "rgba(242,165,62,0.14)", color: playing ? "#0d1118" : "#f2a53e", fontSize: 22, cursor: "pointer" }}>{playing ? "❚❚" : "▶"}</button>
          </div>

          <div className="ts-glass" style={{ ...glass, overflow: "hidden" }}>
            <canvas ref={canvasRef} style={{ display: "block", width: "100%", height: 120 }} />
            <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "10px 14px", borderTop: "1px solid rgba(255,255,255,0.1)", flexWrap: "wrap" }}>
              <span style={label}>Active <b style={{ color: "#fefefe", ...mono, fontSize: 14, marginLeft: 4 }}>{act.length}</b></span>
              <span style={label}>Low <b style={{ color: "#fefefe", ...mono, fontSize: 14, marginLeft: 4 }}>{act.length ? nonetShort(Math.min(...act.map(c => c.f))) : "–"}</b></span>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 160 }}>
                <span style={label}>Master</span>
                <input className="ts-range" type="range" min="0" max="100" value={S.master} onChange={e => { const v = +e.target.value; setS(p => ({ ...p, master: v })); }} />
              </div>
            </div>
          </div>

          {/* channels */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={label}>Channels</span>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => upd(n => n.ch.forEach(c => { c.on = true; }))} style={btn(false)}>All on</button>
              <button onClick={() => upd(n => n.ch.forEach(c => { c.on = false; }))} style={btn(false)}>All off</button>
            </div>
          </div>
          {S.ch.map((c, i) => (
            <div key={i} style={{ ...glass, borderRadius: 14, display: "grid", gridTemplateColumns: "44px 1fr minmax(70px,120px)", gap: 10, alignItems: "center", padding: "8px 12px 8px 8px", borderColor: c.on ? "rgba(242,165,62,0.5)" : "rgba(255,255,255,0.12)" }}>
              <button onClick={() => upd(n => { n.ch[i].on = !n.ch[i].on; })} aria-label={`Toggle channel ${i + 1}`} aria-pressed={c.on} style={{ width: 44, height: 44, borderRadius: 10, border: `1px solid ${c.on ? "#f2a53e" : "rgba(255,255,255,0.14)"}`, background: "rgba(0,0,0,0.35)", color: c.on ? "#f2a53e" : "rgba(226,232,240,0.4)", fontWeight: 700, cursor: "pointer", position: "relative", ...mono }}>
                {i + 1}<span style={{ position: "absolute", top: 6, right: 6, width: 6, height: 6, borderRadius: 999, background: c.on ? "#f2a53e" : "rgba(255,255,255,0.2)", boxShadow: c.on ? "0 0 8px #f2a53e" : "none" }} />
              </button>
              <button onClick={() => { setS(p => ({ ...p, sel: i })); setView("studio-tune"); }} style={{ border: 0, background: "transparent", textAlign: "left", cursor: "pointer", color: "#fefefe", minWidth: 0, padding: 0 }}>
                <span style={{ fontSize: 21, fontWeight: 500, color: c.on ? "#fff" : "rgba(226,232,240,0.55)", ...mono }}>{nonetFmt(c.f)}</span><span style={{ fontSize: 12, color: "rgba(226,232,240,0.55)", marginLeft: 4 }}>Hz</span>
                <span style={{ display: "block", fontSize: 12, color: "rgba(226,232,240,0.55)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{NONET_WAVES.find(w => w[0] === c.wave)[1]} · {nonetNote(c.f)}{c.pan ? (c.pan < 0 ? ` · L${-c.pan}` : ` · R${c.pan}`) : ""}</span>
              </button>
              <input className="ts-range" type="range" min="0" max="100" value={c.vol} aria-label={`Channel ${i + 1} volume`} onChange={e => { const v = +e.target.value; upd(n => { n.ch[i].vol = v; }); }} />
            </div>
          ))}
          <p style={{ fontSize: 13, color: "rgba(226,232,240,0.6)" }}>Tap a channel number to switch it on or off. Tap the frequency to open the fine tuner.</p>
        </div>
      )}

      {/* ═══ TUNER ═══ */}
      {view === "studio-tune" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <button onClick={() => setView("studio")} style={{ ...btn(false), alignSelf: "flex-start" }}>← Channels</button>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(9,1fr)", gap: 5 }}>
            {S.ch.map((c, i) => (
              <button key={i} onClick={() => setS(p => ({ ...p, sel: i }))} style={{ borderRadius: 8, padding: "8px 0", cursor: "pointer", fontWeight: 600, border: `1px solid ${i === S.sel ? "#f2a53e" : "rgba(255,255,255,0.14)"}`, background: i === S.sel ? "rgba(242,165,62,0.18)" : "rgba(0,0,0,0.35)", color: i === S.sel ? "#f2a53e" : c.on ? "#fff" : "rgba(226,232,240,0.5)", ...mono }}>{i + 1}</button>
            ))}
          </div>
          <div className="ts-glass" style={{ ...glass, padding: 16, display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, justifyContent: "center" }}>
                <input value={freqDraft !== null ? freqDraft : nonetFmt(sel.f)} inputMode="decimal" aria-label="Frequency in hertz"
                  onChange={e => setFreqDraft(e.target.value)}
                  onBlur={() => { if (freqDraft !== null) { const v = parseFloat(String(freqDraft).replace(",", ".")); if (isFinite(v)) setF(S.sel, v); setFreqDraft(null); } }}
                  onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }}
                  style={{ fontSize: "clamp(34px,11vw,54px)", fontWeight: 600, textAlign: "center", background: "transparent", border: 0, borderBottom: "1px dashed rgba(255,255,255,0.2)", color: "#f2a53e", width: "100%", maxWidth: 360, outline: "none", ...mono }} />
                <span style={{ color: "rgba(226,232,240,0.6)", fontSize: 18, ...mono }}>Hz</span>
              </div>
              <div style={{ textAlign: "center", color: "rgba(226,232,240,0.65)", fontSize: 13, marginTop: 4 }}><b style={{ color: "#fefefe", ...mono }}>{nonetNote(sel.f)}</b> · period <b style={{ color: "#fefefe", ...mono }}>{(1000 / sel.f).toPrecision(5)} ms</b></div>
            </div>
            <div>
              <div style={{ ...label, marginBottom: 6 }}>Step size (Hz)</div>
              <div style={{ display: "grid", gridAutoFlow: "column", gridAutoColumns: "1fr", gap: 3, padding: 3, borderRadius: 10, background: "rgba(0,0,0,0.35)", border: "1px solid rgba(255,255,255,0.12)" }}>
                {NONET_STEPS.map(s => <button key={s} onClick={() => setS(p => ({ ...p, step: s }))} style={{ border: 0, borderRadius: 7, padding: "8px 2px", cursor: "pointer", fontSize: 13, fontWeight: 600, background: S.step === s ? "#f2a53e" : "transparent", color: S.step === s ? "#1a1206" : "rgba(226,232,240,0.7)", ...mono }}>{s}</button>)}
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", gap: 12, justifyItems: "center" }}>
              <button aria-label="Decrease by one step" onPointerDown={e => { e.preventDefault(); holdStart(-1); }} onPointerUp={holdEnd} onPointerLeave={holdEnd} onPointerCancel={holdEnd} style={{ width: 64, height: 64, borderRadius: "50%", border: "1px solid rgba(255,255,255,0.14)", background: "rgba(255,255,255,0.06)", color: "#fefefe", fontSize: 28, cursor: "pointer", ...mono }}>−</button>
              <div role="slider" aria-label="Fine tune dial" tabIndex={0}
                onPointerDown={e => { jog.current = { active: true, last: angOf(e, e.currentTarget), acc: 0 }; e.currentTarget.setPointerCapture(e.pointerId); }}
                onPointerMove={e => {
                  const j = jog.current; if (!j.active) return;
                  const a = angOf(e, e.currentTarget); let d = a - j.last; if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI;
                  j.last = a; j.acc += d; rotRef.current += d; if (dialRef.current) dialRef.current.style.transform = `rotate(${rotRef.current}rad)`;
                  const CLICK = Math.PI / 18; let n = 0; while (j.acc >= CLICK) { n++; j.acc -= CLICK; } while (j.acc <= -CLICK) { n--; j.acc += CLICK; }
                  if (n) { setS(p => { const x = { ...p, ch: p.ch.map(c => ({ ...c })) }; x.ch[x.sel].f = nonetClamp(x.ch[x.sel].f + n * x.step); return x; }); try { navigator.vibrate && navigator.vibrate(4); } catch (_) {} }
                }}
                onPointerUp={() => { jog.current.active = false; }} onPointerCancel={() => { jog.current.active = false; }}
                onWheel={e => { const d = e.deltaY < 0 ? 1 : -1; rotRef.current += d * Math.PI / 18; if (dialRef.current) dialRef.current.style.transform = `rotate(${rotRef.current}rad)`; nudge(d); }}
                onKeyDown={e => { if (e.key === "ArrowUp" || e.key === "ArrowRight") { e.preventDefault(); nudge(1); } if (e.key === "ArrowDown" || e.key === "ArrowLeft") { e.preventDefault(); nudge(-1); } }}
                style={{ width: "min(44vw,200px)", aspectRatio: "1", borderRadius: "50%", position: "relative", touchAction: "none", userSelect: "none", cursor: "grab", background: "radial-gradient(circle at 50% 45%,#2a3345,#161c27 70%)", border: "1px solid rgba(255,255,255,0.14)", boxShadow: "inset 0 -6px 18px rgba(0,0,0,.45),0 8px 24px rgba(0,0,0,.35)" }}>
                <div ref={dialRef} style={{ position: "absolute", inset: 0, borderRadius: "50%" }}>
                  {Array.from({ length: 36 }, (_, k) => <div key={k} style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 2, marginLeft: -1, transform: `rotate(${k * 10}deg)` }}><div style={{ width: 2, height: k % 9 === 0 ? 14 : 10, marginTop: 5, background: k % 9 === 0 ? "rgba(226,232,240,0.7)" : "rgba(226,232,240,0.3)" }} /></div>)}
                  <div style={{ position: "absolute", left: "50%", top: 18, width: 12, height: 12, marginLeft: -6, borderRadius: "50%", background: "#f2a53e", boxShadow: "0 0 10px #f2a53e" }} />
                </div>
                <div style={{ position: "absolute", inset: "32%", borderRadius: "50%", background: "#151b26", border: "1px solid rgba(255,255,255,0.14)", display: "grid", placeItems: "center", textAlign: "center", fontSize: 11, color: "rgba(226,232,240,0.6)", lineHeight: 1.2 }}>
                  <div>turn<b style={{ display: "block", color: "#fefefe", fontSize: 14, ...mono }}>{S.step} Hz</b>per click</div>
                </div>
              </div>
              <button aria-label="Increase by one step" onPointerDown={e => { e.preventDefault(); holdStart(1); }} onPointerUp={holdEnd} onPointerLeave={holdEnd} onPointerCancel={holdEnd} style={{ width: 64, height: 64, borderRadius: "50%", border: "1px solid rgba(255,255,255,0.14)", background: "rgba(255,255,255,0.06)", color: "#fefefe", fontSize: 28, cursor: "pointer", ...mono }}>+</button>
            </div>
            <div>
              <div style={{ ...label, marginBottom: 6 }}>Coarse sweep</div>
              <input className="ts-range" type="range" min="0" max="1000" step="1" value={logToPos(sel.f)} onChange={e => setF(S.sel, Math.round(posToLog(+e.target.value) * 100) / 100)} />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "rgba(226,232,240,0.45)", ...mono }}><span>1 Hz</span><span>100</span><span>1k</span><span>22k</span></div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
              <button onClick={() => setF(S.sel, sel.f / 2)} style={btn(false)}>÷2 octave down</button>
              <button onClick={() => setF(S.sel, sel.f * 2)} style={btn(false)}>×2 octave up</button>
              <button onClick={() => setF(S.sel, Math.round(sel.f))} style={btn(false)}>Round to 1 Hz</button>
            </div>
          </div>
          <div className="ts-glass" style={{ ...glass, padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={label}>Channel {S.sel + 1}</span>
              <button onClick={() => upd(n => { n.ch[n.sel].on = !n.ch[n.sel].on; })} style={btn(sel.on)}>{sel.on ? "On" : "Off"}</button>
            </div>
            <div>
              <div style={{ ...label, marginBottom: 6 }}>Waveform</div>
              <div style={{ display: "grid", gridAutoFlow: "column", gridAutoColumns: "1fr", gap: 3, padding: 3, borderRadius: 10, background: "rgba(0,0,0,0.35)", border: "1px solid rgba(255,255,255,0.12)" }}>
                {NONET_WAVES.map(([w, l]) => <button key={w} onClick={() => upd(n => { n.ch[n.sel].wave = w; })} style={{ border: 0, borderRadius: 7, padding: "8px 2px", cursor: "pointer", fontSize: 13, fontWeight: 600, background: sel.wave === w ? "#f2a53e" : "transparent", color: sel.wave === w ? "#1a1206" : "rgba(226,232,240,0.7)", ...mono }}>{l}</button>)}
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12 }}>
              <div><div style={{ ...label, marginBottom: 6 }}>Volume</div><input className="ts-range" type="range" min="0" max="100" value={sel.vol} onChange={e => { const v = +e.target.value; upd(n => { n.ch[n.sel].vol = v; }); }} /></div>
              <div><div style={{ ...label, marginBottom: 6 }}>Pan</div><input className="ts-range" type="range" min="-100" max="100" value={sel.pan} onChange={e => { let v = +e.target.value; if (Math.abs(v) < 6) v = 0; upd(n => { n.ch[n.sel].pan = v; }); }} />
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "rgba(226,232,240,0.45)", ...mono }}><span>L</span><span>C</span><span>R</span></div></div>
            </div>
          </div>
        </div>
      )}

      {/* ═══ LIBRARY (Rife & presets, sequences, saved sets) ═══ */}
      {view === "library" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ borderLeft: "3px solid #58c3b5", background: "rgba(88,195,181,0.14)", borderRadius: "0 12px 12px 0", padding: "10px 12px", fontSize: 13, lineHeight: 1.5 }}>
            Rife frequency lists come from Royal Rife's 1930s work and later hobbyist collections, and the numbers differ between sources. They are not a proven medical treatment, so use them alongside care from a clinician, never in place of it. Keep the volume moderate.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12 }}>
            <label><div style={{ ...label, marginBottom: 6 }}>Search</div><input value={search} onChange={e => setSearch(e.target.value)} placeholder="pain, flu, solfeggio…" style={input} /></label>
            <label><div style={{ ...label, marginBottom: 6 }}>Sequence time per frequency</div>
              <select value={S.dwell} onChange={e => { const v = +e.target.value; setS(p => ({ ...p, dwell: v })); }} style={input}>
                {[[30, "30 seconds"], [60, "1 minute"], [120, "2 minutes"], [180, "3 minutes"], [300, "5 minutes"], [600, "10 minutes"]].map(([v, l]) => <option key={v} value={v} style={{ color: "#000" }}>{l}</option>)}
              </select>
            </label>
          </div>
          <p style={{ fontSize: 13, color: "rgba(226,232,240,0.65)", margin: 0 }}><b>Load & play</b> puts a set onto channels 1–9 and plays them together. <b>Sequence</b> plays one frequency at a time, the way Rife devices run a program.</p>
          {libGroups.map(g => (
            <div key={g.g}>
              <div style={{ ...label, margin: "10px 0 8px" }}>{g.g}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {g.items.map((p, pi) => (
                  <div key={p.n + pi} style={{ ...glass, borderRadius: 16, padding: 14 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                      <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{p.n}</h3>
                      <span style={{ fontSize: 12, color: "rgba(226,232,240,0.6)", ...mono }}>{p.f.length} freq</span>
                    </div>
                    {p.d && <p style={{ margin: "4px 0 10px", fontSize: 13, color: "rgba(226,232,240,0.65)" }}>{p.d}</p>}
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
                      {p.f.map((f, i) => {
                        const cur = seq && seq.p === p && seq.idx === i;
                        return <span key={i} style={{ fontSize: 13, padding: "4px 8px", borderRadius: 6, background: "rgba(0,0,0,0.35)", border: `1px solid ${cur ? "#58c3b5" : "rgba(255,255,255,0.12)"}`, color: cur ? "#58c3b5" : "#f8fafc", ...mono }}>{nonetShort(f)}{p.l && <small style={{ color: "rgba(226,232,240,0.6)", marginLeft: 4, fontFamily: KID_FONT }}>{p.l[i]}</small>}{p.p && <small style={{ color: "rgba(226,232,240,0.6)", marginLeft: 4 }}>{p.p[i] < 0 ? "L" : "R"}</small>}</span>;
                      })}
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button onClick={() => { loadSet(p); flash(`${p.n} playing`); }} style={btn(true)}>Load & play</button>
                      {!p.p && <button onClick={() => startSeq(p)} style={{ ...btn(false), borderColor: "#58c3b5", color: "#58c3b5" }}>Sequence</button>}
                      <button onClick={() => { loadSet(p, { play: false }); flash(`Loaded onto channels 1–${p.f.length}`); }} style={btn(false)}>Load only</button>
                      {p.user !== undefined && (
                        <button onClick={() => { if (confirmDel === p.user) { setS(s => ({ ...s, user: s.user.filter((_, k) => k !== p.user) })); setConfirmDel(null); flash("Deleted"); } else setConfirmDel(p.user); }} style={{ ...btn(false), marginLeft: "auto", color: "#e2694e" }}>{confirmDel === p.user ? "Tap to confirm" : "Delete"}</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {!libGroups.length && <p style={{ fontSize: 13, color: "rgba(226,232,240,0.6)" }}>No sets match that search.</p>}
          <div style={{ ...label, marginTop: 8 }}>Save the current channels</div>
          <div className="ts-glass" style={{ ...glass, borderRadius: 16, padding: 14 }}>
            <div style={{ display: "flex", gap: 8 }}>
              <input value={saveName} onChange={e => setSaveName(e.target.value)} placeholder="Name this set" style={input} />
              <button onClick={() => {
                const a = S.ch.filter(c => c.on); if (!a.length) { flash("Switch on at least one channel"); return; }
                const n = saveName.trim() || `My set ${S.user.length + 1}`, anyPan = a.some(c => c.pan !== 0);
                setS(s => ({ ...s, user: [...s.user, { n, d: "Saved " + new Date().toLocaleDateString(), f: a.map(c => c.f), p: anyPan ? a.map(c => c.pan / 100) : undefined }] }));
                setSaveName(""); flash(`Saved “${n}”`);
              }} style={btn(true)}>Save</button>
            </div>
            <p style={{ fontSize: 13, color: "rgba(226,232,240,0.6)", margin: "8px 0 0" }}>Saves every channel that is switched on. Saved sets stay in this browser.</p>
          </div>
        </div>
      )}

      {/* ═══ CALCULATOR ═══ */}
      {view === "calc" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={label}>Nine-frequency calculator</div>
          <div className="ts-glass" style={{ ...glass, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12 }}>
              <label><div style={{ ...label, marginBottom: 6 }}>Base frequency (Hz)</div><input value={cBase} inputMode="decimal" onChange={e => setCBase(e.target.value)} style={input} /></label>
              <label><div style={{ ...label, marginBottom: 6 }}>Pattern</div>
                <select value={calcMode} onChange={e => { setCalcMode(e.target.value); if (MODES[e.target.value].def) setCParam(MODES[e.target.value].def); }} style={input}>
                  {[["spread", "Fine spread around base"], ["harm", "Harmonic series (f × n)"], ["sub", "Subharmonics (f ÷ n)"], ["oct", "Octaves (centered on base)"], ["geo", "Geometric ratio (f × rⁿ)"], ["beat", "Beat ladder (base + n × step)"]].map(([v, l]) => <option key={v} value={v} style={{ color: "#000" }}>{l}</option>)}
                </select>
              </label>
            </div>
            {MODES[calcMode].def && <label><div style={{ ...label, marginBottom: 6 }}>{MODES[calcMode].label}</div><input value={cParam} inputMode="decimal" onChange={e => setCParam(e.target.value)} style={input} /></label>}
            <p style={{ fontSize: 13, color: "rgba(226,232,240,0.65)", margin: 0 }}>{MODES[calcMode].hint}</p>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14, minWidth: 420 }}>
                <thead><tr>{["Ch", "Frequency (Hz)", "Period (ms)", "Note", "Δ from base"].map((h, i) => <th key={h} style={{ ...label, textAlign: i ? "right" : "left", padding: "6px 8px", borderBottom: "1px solid rgba(255,255,255,0.12)" }}>{h}</th>)}</tr></thead>
                <tbody>{calcOut.map((f, i) => { const d = f - num(cBase, 528); return (
                  <tr key={i}>{[i + 1, nonetFmt(f), (1000 / f).toPrecision(6), nonetNote(f), `${d >= 0 ? "+" : "−"}${nonetFmt(Math.abs(d))}`].map((v, k) => <td key={k} style={{ padding: "7px 8px", borderBottom: "1px solid rgba(255,255,255,0.06)", textAlign: k ? "right" : "left", color: k === 1 && Math.abs(d) < 1e-9 ? "#f2a53e" : "#f8fafc", ...mono }}>{v}</td>)}</tr>
                ); })}</tbody>
              </table>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button onClick={() => { loadSet({ n: "Calculator set", f: calcOut }, { play: false }); flash("Sent to channels 1–9"); }} style={btn(true)}>Send to channels 1–9</button>
              <button onClick={() => { loadSet({ n: "Calculator set", f: calcOut }); flash("Playing all nine"); }} style={btn(false)}>Send & play</button>
            </div>
          </div>
          <div style={label}>What's playing now</div>
          <div className="ts-glass" style={{ ...glass, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
            {!analysis ? <div style={{ fontSize: 14 }}>No channels on</div> : (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 10 }}>
                  {[["Lowest", nonetFmt(analysis.lo)], ["Highest", nonetFmt(analysis.hi)], ["Average", nonetFmt(analysis.avg)], ["Sum", nonetFmt(analysis.sum)], ["Shared fundamental", `${nonetFmt(analysis.fund)} Hz`], ["Full pattern repeats", analysis.fund > 0 ? (1 / analysis.fund < 1 ? `${(1000 / analysis.fund).toPrecision(4)} ms` : `${(1 / analysis.fund).toPrecision(4)} s`) : "–"]].map(([k, v]) => (
                    <div key={k} style={{ background: "rgba(0,0,0,0.35)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, padding: "10px 12px" }}>
                      <span style={{ ...label, display: "block" }}>{k}</span><b style={{ fontSize: 17, fontWeight: 500, ...mono }}>{v}</b>
                    </div>
                  ))}
                </div>
                <div style={label}>Beat frequencies between active channels</div>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14, minWidth: 300 }}>
                    <thead><tr>{["Pair", "Beat (Hz)", "Beat period (s)"].map((h, i) => <th key={h} style={{ ...label, textAlign: i ? "right" : "left", padding: "6px 8px", borderBottom: "1px solid rgba(255,255,255,0.12)" }}>{h}</th>)}</tr></thead>
                    <tbody>{analysis.pairs.length ? analysis.pairs.slice(0, 36).map(p => (
                      <tr key={`${p.a}-${p.b}`}><td style={{ padding: "7px 8px", ...mono }}>Ch {p.a} ↔ Ch {p.b}</td><td style={{ padding: "7px 8px", textAlign: "right", color: p.d > 0 && p.d <= 40 ? "#f2a53e" : "#f8fafc", ...mono }}>{nonetFmt(p.d)}</td><td style={{ padding: "7px 8px", textAlign: "right", ...mono }}>{p.d > 0 ? (1 / p.d).toPrecision(5) : "∞"}</td></tr>
                    )) : <tr><td colSpan="3" style={{ padding: "7px 8px", color: "rgba(226,232,240,0.6)" }}>Switch on two or more channels to see beats.</td></tr>}</tbody>
                  </table>
                </div>
              </>
            )}
            <p style={{ fontSize: 13, color: "rgba(226,232,240,0.6)", margin: 0 }}>A beat is the pulse you hear when two tones sit close together: its rate equals their difference. Use it to fine-tune two channels against each other, down to 0.001 Hz.</p>
          </div>
        </div>
      )}

      {/* mini player bar (visible outside the Sanctuary view) */}
      {playing && view !== "sanctuary" && (
        <div className="ts-glass" style={{ ...glass, position: "sticky", bottom: isMobile ? 84 : 16, marginTop: 18, display: "flex", alignItems: "center", gap: 12, padding: "10px 14px" }}>
          <div style={{ width: 10, height: 10, borderRadius: 999, background: "#f2a53e", boxShadow: "0 0 10px #f2a53e" }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{session.name}</div>
            <div style={{ fontSize: 12, color: "rgba(226,232,240,0.6)", ...mono }}>{remaining !== null ? `${mmss(remaining)} left` : "Playing"}</div>
          </div>
          <button onClick={stopPlay} style={btn(false)}>Stop</button>
        </div>
      )}

      {toast && <div style={{ position: "fixed", left: "50%", bottom: isMobile ? 150 : 40, transform: "translateX(-50%)", background: "#f8fafc", color: "#0f172a", padding: "9px 16px", borderRadius: 20, fontSize: 13, fontWeight: 600, zIndex: 60, whiteSpace: "nowrap" }}>{toast}</div>}
    </div>
  );
}

function MoreMenu({ setActiveTab, isMobile, mood, setMood, triggerMatrixWave, matrixWave }) {
  const rows = [
    { id: "shop", icon: "◇", label: "Vibe Shop", desc: "Products, tools, member marketplace", color: "#eab308" },
    { id: "events", icon: "⊕", label: "Events", desc: "Global meditations & gatherings", color: "#a78bfa" },
    { id: "search", icon: "⌕", label: "Search Everything", desc: "Every page, article, herb, post", color: "#00ff8c" },
    { id: "tones", icon: "〰", label: "Tone Sanctuary", desc: "9-channel tone lab, scenes & Rife programs", color: "#f2a53e" },
  ];

  return (
    <div style={{ animation: "fadeInUp 0.4s ease" }}>
      {/* Profile card */}
      <div style={{
        display: "flex", alignItems: "center", gap: 16, padding: "20px 20px",
        borderRadius: 16, marginBottom: 26,
        background: "linear-gradient(135deg, rgba(0,255,140,0.08), rgba(167,139,250,0.06))",
        border: "1px solid rgba(0,255,140,0.15)",
      }}>
        <div style={{
          width: 54, height: 54, borderRadius: "50%", flexShrink: 0,
          background: "linear-gradient(135deg, #00ff8c40, #a78bfa40)",
          border: "1px solid rgba(0,255,140,0.3)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 22, boxShadow: "0 0 20px rgba(0,255,140,0.2)",
        }}>◈</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16, color: "var(--text)", fontFamily: "'Sora', sans-serif", fontWeight: 500 }}>Seeker</div>
          <div style={{ fontSize: 11, color: "var(--text-faint)", fontFamily: "'JetBrains Mono', monospace", letterSpacing: 1 }}>LEVEL 3 · 14 DAY STREAK</div>
        </div>
      </div>

      {/* Menu rows */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 26 }}>
        {rows.map(r => (
          <button key={r.id} onClick={() => setActiveTab(r.id)} style={{
            textAlign: "left", display: "flex", alignItems: "center", gap: 14,
            padding: "15px 16px", borderRadius: 12, cursor: "pointer",
            background: "var(--card-bg)", border: "1px solid var(--card-border)",
            borderLeft: `3px solid ${r.color}`,
            transition: "all 0.2s ease",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = `${r.color}0a`; e.currentTarget.style.transform = "translateX(3px)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "var(--card-bg)"; e.currentTarget.style.transform = "translateX(0)"; }}>
            <span style={{ fontSize: 20, color: r.color, width: 26, textAlign: "center", flexShrink: 0 }}>{r.icon}</span>
            <span style={{ flex: 1 }}>
              <span style={{ display: "block", fontSize: 14, color: "var(--text)", fontFamily: "'Sora', sans-serif", fontWeight: 500 }}>{r.label}</span>
              <span style={{ display: "block", fontSize: 11, color: "var(--text-faint)", marginTop: 2 }}>{r.desc}</span>
            </span>
            <span style={{ fontSize: 13, color: r.color }}>→</span>
          </button>
        ))}
      </div>

      {/* Settings */}
      <div style={{ fontSize: 10, letterSpacing: 3, color: "var(--text-faint)", fontFamily: "'Orbitron', sans-serif", marginBottom: 12 }}>SETTINGS</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <button onClick={() => setMood(mood === "dark" ? "light" : "dark")} style={{
          textAlign: "left", display: "flex", alignItems: "center", gap: 14,
          padding: "15px 16px", borderRadius: 12, cursor: "pointer",
          background: "var(--card-bg)", border: "1px solid var(--card-border)",
        }}>
          <span style={{ fontSize: 20, width: 26, textAlign: "center", flexShrink: 0 }}>{mood === "dark" ? "🌙" : "☀️"}</span>
          <span style={{ flex: 1, fontSize: 14, color: "var(--text)", fontFamily: "'Sora', sans-serif" }}>
            {mood === "dark" ? "Dark Mode" : "Light Mode"}
          </span>
          <span style={{ fontSize: 10, color: "var(--text-faint)", letterSpacing: 2, fontFamily: "'Orbitron', sans-serif" }}>TAP TO SWITCH</span>
        </button>
        <button onClick={triggerMatrixWave} disabled={matrixWave} style={{
          textAlign: "left", display: "flex", alignItems: "center", gap: 14,
          padding: "15px 16px", borderRadius: 12,
          cursor: matrixWave ? "default" : "pointer", opacity: matrixWave ? 0.6 : 1,
          background: "var(--card-bg)", border: "1px solid var(--card-border)",
        }}>
          <span style={{ fontSize: 20, width: 26, textAlign: "center", flexShrink: 0, color: "#00ff8c" }}>{matrixWave ? "⟡" : "◈"}</span>
          <span style={{ flex: 1, fontSize: 14, color: "var(--text)", fontFamily: "'Sora', sans-serif" }}>Matrix Wave</span>
          <span style={{ fontSize: 10, color: "#00ff8c", letterSpacing: 2, fontFamily: "'Orbitron', sans-serif" }}>{matrixWave ? "RUNNING" : "ACTIVATE"}</span>
        </button>
      </div>

      <div style={{ marginTop: 32, textAlign: "center", paddingBottom: 10 }}>
        <div style={{ fontSize: 10, color: "var(--text-faint)", letterSpacing: 3, fontFamily: "'Orbitron', sans-serif" }}>TH3 AWAR3N3SS</div>
        <div style={{ fontSize: 9, color: "var(--text-faint)", marginTop: 4, fontFamily: "'JetBrains Mono', monospace", opacity: 0.6 }}>v3.3 • THE SIGNAL IS ETERNAL</div>
      </div>
    </div>
  );
}


// ═══════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════
export default function TH3AWAR3N3SS() {
  const [phase, setPhase] = useState("landing"); // landing -> wormhole -> whiteout -> app
  const [activeTab, setActiveTab] = useState("dashboard");
  // Learning level chosen on first visit (beginner | medium | advanced | rabbit | custom)
  const [level, setLevelState] = useState(() => loadPref("th3a_level", null));
  const [customPath, setCustomPathState] = useState(() => loadPref("th3a_custom_path", []));
  const [doneLessons, setDoneLessons] = useState(() => new Set(loadPref("th3a_done", [])));
  const setLevel = v => { setLevelState(v); savePref("th3a_level", v); };
  const setCustomPath = v => { setCustomPathState(v); savePref("th3a_custom_path", v); };
  const setDone = updater => setDoneLessons(prev => { const next = typeof updater === "function" ? updater(prev) : updater; savePref("th3a_done", [...next]); return next; });
  const mousePos = useRef({ x: 0, y: 0 });
  const [mood, setMood] = useState("light");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(typeof window !== "undefined" && window.innerWidth < 768);
  const [matrixWave, setMatrixWave] = useState(false);

  const triggerMatrixWave = () => {
    setMatrixWave(true);
    setTimeout(() => setMatrixWave(false), 6000);
  };

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  // Scroll-to-top on tab change — reset scroll position when navigating to a new page
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    // Also reset any scrollable container (main, html, body) in case the page scrolls inside them
    if (document.scrollingElement) document.scrollingElement.scrollTop = 0;
    const mainEl = document.querySelector("main");
    if (mainEl) mainEl.scrollTop = 0;
  }, [activeTab]);

  const entered = phase === "app";

  // ─── DARK / LIGHT MODE SYSTEM ───
  const moodThemes = {
    dark: {
      accent: "#00ff8c", accentRgb: "0,255,140", accentGlow: "rgba(0,255,140,0.3)",
      bg: "#050508", bgGrad: "none",
      label: "DARK MODE", icon: "🌙", statusText: "FREQUENCY LOCKED • SESSION ACTIVE • ▮",
      vibe: "The classic Matrix experience. Dark, immersive, focused.",
      gridOpacity: 0.02, particleOpacity: 0.35, animSpeed: "5s",
      btnBg: "rgba(0,255,140,0.12)", btnBorder: "rgba(0,255,140,0.3)", btnColor: "#00ff8c",
      sidebarBorder: "rgba(0,255,140,0.08)", sidebarGlow: "rgba(0,255,140,0.03)",
      sidebarBg: "linear-gradient(180deg, rgba(5,5,8,0.95), rgba(5,5,8,0.9))",
      headerGlow: "0 0 10px rgba(0,255,140,0.2)",
      textColor: "#fff", textMuted: "rgba(255,255,255,0.5)", textFaint: "rgba(255,255,255,0.25)",
      cardBg: "linear-gradient(135deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02))",
      cardBgHover: "linear-gradient(135deg, rgba(255,255,255,0.08), rgba(255,255,255,0.04))",
      cardBorder: "rgba(255,255,255,0.06)", cardBorderHover: "rgba(255,255,255,0.12)",
      matrixVisible: true,
    },
    light: {
      accent: "#0d9668", accentRgb: "13,150,104", accentGlow: "rgba(13,150,104,0.2)",
      bg: "#f5f5f0", bgGrad: "radial-gradient(ellipse at 50% 0%, rgba(13,150,104,0.06) 0%, rgba(245,245,240,1) 60%)",
      label: "LIGHT MODE", icon: "☀️", statusText: "CLARITY MODE • SIGNAL BRIGHT • ◈",
      vibe: "Clean, bright, easy on the eyes. Same information, different energy.",
      gridOpacity: 0.008, particleOpacity: 0.12, animSpeed: "7s",
      btnBg: "rgba(13,150,104,0.1)", btnBorder: "rgba(13,150,104,0.25)", btnColor: "#0d9668",
      sidebarBorder: "rgba(13,150,104,0.1)", sidebarGlow: "rgba(13,150,104,0.02)",
      sidebarBg: "linear-gradient(180deg, rgba(250,250,248,0.97), rgba(245,245,240,0.95))",
      headerGlow: "none",
      textColor: "#1a1a1a", textMuted: "rgba(0,0,0,0.55)", textFaint: "rgba(0,0,0,0.3)",
      cardBg: "linear-gradient(135deg, rgba(255,255,255,0.8), rgba(255,255,255,0.5))",
      cardBgHover: "linear-gradient(135deg, rgba(255,255,255,0.95), rgba(255,255,255,0.7))",
      cardBorder: "rgba(0,0,0,0.08)", cardBorderHover: "rgba(0,0,0,0.14)",
      matrixVisible: false,
    },
  };
  const mt = moodThemes[mood];
  const isLight = mood === "light";

  useEffect(() => {
    const handler = (e) => { mousePos.current = { x: e.clientX, y: e.clientY }; };
    window.addEventListener("mousemove", handler);
    return () => window.removeEventListener("mousemove", handler);
  }, []);

  const handleEnter = () => {
    setPhase("suckin"); // brief suck-in before full wormhole
    setTimeout(() => setPhase("wormhole"), 300);
    setTimeout(() => setPhase("whiteout"), 6000);
    setTimeout(() => setPhase("app"), 7300);
  };


  // Bottom tab bar (mobile) / left rail (desktop) — the 5 primary surfaces
  const PRIMARY_TABS = [
    { id: "dashboard", label: "Home",      icon: "⌂" },
    { id: "explore",   label: "Explore",   icon: "⬡" },
    { id: "practice",  label: "Practice",  icon: "◎" },
    { id: "community", label: "Community", icon: "⊛" },
    { id: "more",      label: "More",      icon: "☰" },
  ];

  const navItems = [
    { id: "dashboard", label: "Home", icon: "⌂" },
    { id: "explore", label: "Explore", icon: "⬡" },
    { id: "more", label: "More", icon: "☰" },
    { id: "energy", label: "ENERGY 101", icon: "⚛" },
    { id: "numbers", label: "POWER OF NUMBERS", icon: "⓷" },
    { id: "emotions", label: "E-MOTIONS", icon: "◭" },
    { id: "wakeup", label: "Wake Up", icon: "◉" },
    { id: "biofield", label: "BIO FIELD", icon: "◐" },
    { id: "healthsimple", label: "HEALTH SIMPLIFIED", icon: "❂" },
    { id: "healing", label: "HEALING", icon: "❋" },
    { id: "disease", label: "HEAL DISEASE", icon: "✚" },
    { id: "hacks", label: "REALITY HACKS", icon: "⚙" },
    { id: "shop", label: "VIBE SHOP", icon: "◇" },
    { id: "knowledge", label: "Knowledge Portal", icon: "⬡" },
    { id: "practice", label: "MEDITATION ZONE", icon: "◎" },
    { id: "community", label: "Community", icon: "⊛" },
    { id: "events", label: "Events", icon: "⊕" },
    { id: "search", label: "Search", icon: "⌕" },
    { id: "tones", label: "Tone Sanctuary", icon: "〰" },
  ];

  const globalStyles = `
    @import url('https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&family=Instrument+Serif:ital@0;1&family=Orbitron:wght@400;500;600;700&family=JetBrains+Mono:wght@300;400;500&family=Sora:wght@200;300;400;500;600&display=swap');
    * { margin: 0; padding: 0; box-sizing: border-box; }
    :root {
      --text: ${isLight ? "#1a1a1a" : "#fff"};
      --text-muted: ${isLight ? "rgba(0,0,0,0.55)" : "rgba(255,255,255,0.5)"};
      --text-faint: ${isLight ? "rgba(0,0,0,0.3)" : "rgba(255,255,255,0.25)"};
      --text-dim: ${isLight ? "rgba(0,0,0,0.15)" : "rgba(255,255,255,0.1)"};
      --card-bg: ${isLight ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.04)"};
      --card-border: ${isLight ? "rgba(0,0,0,0.08)" : "rgba(255,255,255,0.06)"};
      --input-bg: ${isLight ? "rgba(0,0,0,0.04)" : "rgba(255,255,255,0.04)"};
      --input-border: ${isLight ? "rgba(0,0,0,0.1)" : "rgba(255,255,255,0.1)"};
      --accent: ${mt.accent};
      transition: all 0.8s ease;
    }
    body { background: ${isLight ? "#f5f5f0" : "#050508"}; color: var(--text); overflow-x: hidden; -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; text-rendering: optimizeLegibility; max-width: 100vw; transition: background 0.8s ease, color 0.8s ease; }
    html { overflow-x: hidden; }
    ::-webkit-scrollbar { width: 5px; }
    ::-webkit-scrollbar-track { background: ${isLight ? "rgba(0,0,0,0.03)" : "rgba(255,255,255,0.02)"}; }
    ::-webkit-scrollbar-thumb { background: ${isLight ? "rgba(13,150,104,0.25)" : "rgba(0,255,140,0.15)"}; border-radius: 3px; }
    ::-webkit-scrollbar-thumb:hover { background: ${isLight ? "rgba(13,150,104,0.4)" : "rgba(0,255,140,0.3)"}; }
    ::selection { background: ${isLight ? "rgba(13,150,104,0.2)" : "rgba(0,255,140,0.25)"}; color: ${isLight ? "#000" : "#fff"}; }
    input, textarea, select, button { font-family: inherit; }
    @keyframes fadeInUp { from { opacity: 0; transform: translateY(24px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes scanLine { 0% { top: 0; } 100% { top: 100%; } }
    @keyframes breathe { 0%, 100% { opacity: 0.6; } 50% { opacity: 1; } }
    @keyframes gridPulse { 0%, 100% { opacity: 0.03; } 50% { opacity: 0.06; } }
    @keyframes orbPulse { 0%, 100% { transform: scale(1); filter: brightness(1); } 50% { transform: scale(1.06); filter: brightness(1.2); } }
    @keyframes subtleFloat { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
    @keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }

    ${isLight ? `
      /* ═══ LIGHT MODE GLOBAL OVERRIDES ═══ */
      /* All white text → dark */
      [style*="color: #fff"], [style*="color:#fff"] { color: #1a1a1a !important; }
      [style*="color: rgba(255,255,255,0.7)"] { color: rgba(0,0,0,0.65) !important; }
      [style*="color: rgba(255,255,255,0.6)"] { color: rgba(0,0,0,0.6) !important; }
      [style*="color: rgba(255,255,255,0.55)"] { color: rgba(0,0,0,0.55) !important; }
      [style*="color: rgba(255,255,255,0.5)"] { color: rgba(0,0,0,0.5) !important; }
      [style*="color: rgba(255,255,255,0.45)"] { color: rgba(0,0,0,0.45) !important; }
      [style*="color: rgba(255,255,255,0.4)"] { color: rgba(0,0,0,0.4) !important; }
      [style*="color: rgba(255,255,255,0.35)"] { color: rgba(0,0,0,0.35) !important; }
      [style*="color: rgba(255,255,255,0.3)"] { color: rgba(0,0,0,0.3) !important; }
      [style*="color: rgba(255,255,255,0.25)"] { color: rgba(0,0,0,0.25) !important; }
      [style*="color: rgba(255,255,255,0.2)"] { color: rgba(0,0,0,0.2) !important; }
      [style*="color: rgba(255,255,255,0.15)"] { color: rgba(0,0,0,0.15) !important; }

      /* Glass cards → light glass */
      [style*="rgba(255,255,255,0.05)"] { background: rgba(255,255,255,0.65) !important; }
      [style*="rgba(255,255,255,0.04)"] { background: rgba(255,255,255,0.6) !important; }
      [style*="rgba(255,255,255,0.03)"] { background: rgba(255,255,255,0.5) !important; }
      [style*="rgba(255,255,255,0.02)"] { background: rgba(255,255,255,0.4) !important; }

      /* Borders → light */
      [style*="border: 1px solid rgba(255,255,255,0.06)"] { border-color: rgba(0,0,0,0.08) !important; }
      [style*="border: 1px solid rgba(255,255,255,0.08)"] { border-color: rgba(0,0,0,0.1) !important; }
      [style*="border: 1px solid rgba(255,255,255,0.1)"] { border-color: rgba(0,0,0,0.1) !important; }
      [style*="border: 1px solid rgba(255,255,255,0.12)"] { border-color: rgba(0,0,0,0.12) !important; }

      /* Inputs → light */
      input, textarea {
        background: rgba(255,255,255,0.8) !important;
        border-color: rgba(0,0,0,0.12) !important;
        color: #1a1a1a !important;
      }
      input::placeholder, textarea::placeholder {
        color: rgba(0,0,0,0.35) !important;
      }

      /* Shadows → soft light shadows */
      [style*="box-shadow"] {
        box-shadow: 0 2px 12px rgba(0,0,0,0.06), 0 1px 3px rgba(0,0,0,0.08) !important;
      }

      /* Green accent → darker green for readability */
      [style*="color: #00ff8c"] { color: #0d9668 !important; }
      [style*="color: rgba(0,255,140"] { color: rgba(13,150,104,0.8) !important; }

      /* Text shadows → remove in light mode */
      [style*="text-shadow"] { text-shadow: none !important; }

      /* Canvas overlays → reduce opacity drastically */
      canvas { opacity: 0.08 !important; }

      /* Specific nav button overrides */
      nav button { color: rgba(0,0,0,0.3) !important; }

      /* GlassCard-style divs → white glass */
      [data-theme="light"] div[style*="backdrop-filter"] {
        background: rgba(255,255,255,0.7) !important;
        border-color: rgba(0,0,0,0.08) !important;
        box-shadow: 0 2px 16px rgba(0,0,0,0.05) !important;
      }

      /* Fix gradient backgrounds in cards */
      [data-theme="light"] div[style*="linear-gradient(135deg, rgba(255,255,255,0.05)"] {
        background: rgba(255,255,255,0.7) !important;
      }
      [data-theme="light"] div[style*="linear-gradient(135deg, rgba(255,255,255,0.08)"] {
        background: rgba(255,255,255,0.85) !important;
      }
    ` : ""}
  `;

  // ─── ENTRY PORTAL ───
  if (phase === "landing" || phase === "suckin") {
    const isSucking = phase === "suckin";
    return (
      <>
        <style>{globalStyles}{`
          @keyframes suckIn {
            0% { transform: scale(1); filter: blur(0px) brightness(1); opacity: 1; }
            100% { transform: scale(0.01); filter: blur(10px) brightness(3); opacity: 0; }
          }
          @keyframes suckRain {
            0% { opacity: 0.9; filter: blur(0px); }
            100% { opacity: 0; filter: blur(8px); }
          }
          body { background: #050508 !important; color: #fff !important; }
          html { background: #050508 !important; }
        `}</style>
        <div style={{ animation: isSucking ? "suckRain 0.3s ease-in forwards" : "none" }}>
          <MatrixRain />
        </div>
        {!isMobile && <ParticleField mousePos={mousePos} entered={false} />}
        <PerimeterGlow mood="dark" isMobile={isMobile} />
        <div style={{
          position: "fixed", inset: 0, zIndex: 2, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontFamily: "'Sora', sans-serif",
          background: "transparent",
          animation: isSucking ? "suckIn 0.3s cubic-bezier(0.4, 0.0, 1, 1) forwards" : "none",
          transformOrigin: "center center",
          pointerEvents: isSucking ? "none" : "auto",
        }}>
          <div style={{ position: "absolute", inset: 0, backgroundImage: "linear-gradient(rgba(0,255,140,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(0,255,140,0.03) 1px, transparent 1px)", backgroundSize: "60px 60px", animation: "gridPulse 6s ease-in-out infinite" }} />
          <div style={{ textAlign: "center", zIndex: 3, animation: phase === "landing" ? "fadeInUp 1.2s ease" : "none" }}>
            <div style={{ fontSize: 14, letterSpacing: 12, color: "rgba(0,255,140,0.5)", fontFamily: "'Orbitron', sans-serif", marginBottom: 24 }}>TH3 AWAR3N3SS</div>
            {/* Animated Title with Matrix 3s */}
            <LandingTitle />
            <div style={{ marginBottom: 48 }} />
            <button onClick={handleEnter} disabled={isSucking} style={{ background: "transparent", border: "1px solid rgba(0,255,140,0.4)", color: "#00ff8c", padding: "16px 48px", borderRadius: 4, fontSize: 14, letterSpacing: 6, cursor: isSucking ? "default" : "pointer", fontFamily: "'Orbitron', sans-serif", transition: "all 0.4s ease", opacity: isSucking ? 0.5 : 1 }}
              onMouseEnter={e => { if (!isSucking) { e.target.style.background = "rgba(0,255,140,0.08)"; e.target.style.boxShadow = "0 0 40px rgba(0,255,140,0.15)"; } }}
              onMouseLeave={e => { e.target.style.background = "transparent"; e.target.style.boxShadow = "none"; }}>
              ENTER TH3 AWAR3N3SS
            </button>
            <div style={{ marginTop: 64, fontSize: 11, color: "rgba(255,255,255,0.2)", letterSpacing: 3, fontFamily: "'JetBrains Mono', monospace" }}>A DIGITAL CONSCIOUSNESS ECOSYSTEM</div>
          </div>
        </div>
      </>
    );
  }

  // ─── WORMHOLE TRANSITION ───
  if (phase === "wormhole") {
    return (
      <>
        <style>{globalStyles}{`
          body { background: #050508 !important; color: #fff !important; }
          html { background: #050508 !important; }
        `}</style>
        <WormholeTransition />
      </>
    );
  }

  // ─── WHITE LIGHT FLASH → FADE INTO APP ───
  if (phase === "whiteout") {
    return (
      <>
        <style>{globalStyles}{`
          @keyframes whiteToApp {
            0% { opacity: 1; }
            100% { opacity: 0; }
          }
          @keyframes appReveal {
            0% { opacity: 0; transform: scale(1.05); filter: brightness(2); }
            100% { opacity: 1; transform: scale(1); filter: brightness(1); }
          }
        `}</style>
        <MatrixOverlay mood={mood} />
        <ParticleField mousePos={mousePos} entered={true} />
        <div style={{
          position: "fixed", inset: 0, zIndex: 100, background: "#fff",
          animation: "whiteToApp 1.5s ease-out forwards",
          pointerEvents: "none",
        }} />
      </>
    );
  }

  // ─── MAIN INTERFACE ───
  return (
    <>
      <style>{globalStyles}{`
        @keyframes appEntrance {
          0% { opacity: 0; transform: translateY(20px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        @keyframes matrixGlow {
          0%, 100% { text-shadow: 0 0 5px rgba(0,255,140,0.3); }
          50% { text-shadow: 0 0 15px rgba(0,255,140,0.6), 0 0 30px rgba(0,255,140,0.2); }
        }
        @keyframes dataStream {
          0% { background-position: 0% 0%; }
          100% { background-position: 0% 100%; }
        }
      `}</style>
      {mt.matrixVisible && <MatrixOverlay mood={mood} />}
      <ParticleField mousePos={mousePos} entered={true} />
      <PerimeterGlow mood={mood} isMobile={isMobile} />
      {/* Mood background color */}
      <div style={{
        position: "fixed", inset: 0, zIndex: 0,
        background: mt.bg,
        backgroundImage: mt.bgGrad,
        transition: "all 1.2s ease",
      }} />
      <div style={{ position: "fixed", inset: 0, zIndex: 1, backgroundImage: `linear-gradient(rgba(${mt.accentRgb},${mt.gridOpacity}) 1px, transparent 1px), linear-gradient(90deg, rgba(${mt.accentRgb},${mt.gridOpacity}) 1px, transparent 1px)`, backgroundSize: "60px 60px", pointerEvents: "none", animation: `gridPulse ${mt.animSpeed} ease-in-out infinite`, transition: "all 1s ease" }} />

      <div data-theme={mood} style={{ position: "relative", zIndex: 2, fontFamily: "'Geist', 'Sora', sans-serif", minHeight: "100vh", display: "flex", maxWidth: "100vw", overflow: "hidden" }}>

        {/* Mobile top bar — Instagram-style: wordmark left, activity + DM icons right */}
        {isMobile && (
          <div style={{
            position: "fixed", top: 0, left: 0, right: 0, zIndex: 30,
            padding: "12px 16px",
            background: isLight ? "rgba(250,250,248,0.92)" : "rgba(8,8,12,0.92)",
            backdropFilter: "blur(24px) saturate(1.2)",
            borderBottom: `1px solid ${mt.sidebarBorder}`,
            display: "flex", alignItems: "center", justifyContent: "space-between",
          }}>
            <span style={{ fontSize: 15, fontFamily: "'Orbitron', sans-serif", color: mt.accent, letterSpacing: 2, fontWeight: 600, textShadow: `0 0 10px ${mt.accentGlow}` }}>TH3 AWAR3N3SS</span>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <button onClick={triggerMatrixWave} disabled={matrixWave} title="Matrix Wave" style={{
                width: 34, height: 34, borderRadius: 10, cursor: matrixWave ? "default" : "pointer",
                background: "transparent", border: "none", color: mt.accent, fontSize: 17,
                display: "flex", alignItems: "center", justifyContent: "center", opacity: matrixWave ? 0.6 : 1,
              }}>{matrixWave ? "⟡" : "◈"}</button>
              <button onClick={() => setActiveTab("community")} title="Activity" style={{
                width: 34, height: 34, borderRadius: 10, cursor: "pointer",
                background: "transparent", border: "none",
                color: activeTab === "community" ? "#ec4899" : mt.textFaint, fontSize: 18,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>♡</button>
              <button onClick={() => setActiveTab("search")} title="Search" style={{
                width: 34, height: 34, borderRadius: 10, cursor: "pointer",
                background: "transparent", border: "none", color: mt.accent, fontSize: 16,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>⌕</button>
            </div>
          </div>
        )}

        {/* Left Rail — desktop only, Instagram-web style icon+label rail */}
        {!isMobile && (
        <nav style={{
          width: 232, position: "fixed", left: 0, top: 0, bottom: 0,
          background: mt.sidebarBg,
          backdropFilter: "blur(24px) saturate(1.2)",
          borderRight: `1px solid ${mt.sidebarBorder}`,
          display: "flex", flexDirection: "column", alignItems: "stretch",
          padding: "28px 12px 18px", gap: 4, zIndex: 15,
          boxShadow: `2px 0 30px ${mt.sidebarGlow}`,
          transition: "all 0.8s ease",
        }}>
          <div style={{ fontSize: 15, fontFamily: "'Orbitron', sans-serif", color: mt.accent, letterSpacing: 3, marginBottom: 30, padding: "0 12px", fontWeight: 600, textShadow: `0 0 10px ${mt.accentGlow}`, animation: `matrixGlow ${mt.animSpeed} ease-in-out infinite`, transition: "color 0.8s ease" }}>TH3 AWAR3N3SS</div>
          {PRIMARY_TABS.map(item => {
            const active = activeTab === item.id;
            const isCreate = item.id === "practice";
            return (
              <button key={item.id} onClick={() => setActiveTab(item.id)} style={{
                width: "100%", padding: "12px 14px", borderRadius: 999,
                border: "none",
                background: active ? mt.btnBg : "transparent",
                color: active ? mt.accent : isLight ? "rgba(0,0,0,0.7)" : "rgba(255,255,255,0.75)",
                cursor: "pointer", fontSize: 15,
                display: "flex", alignItems: "center", justifyContent: "flex-start", gap: 16,
                transition: "all 0.2s cubic-bezier(0.22, 1, 0.36, 1)",
                fontFamily: "'Sora', sans-serif", fontWeight: active ? 700 : 400,
                textAlign: "left", marginBottom: 2,
              }}
              onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = isLight ? "rgba(0,0,0,0.045)" : "rgba(255,255,255,0.05)"; }}
              onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = "transparent"; }}>
                {isCreate ? (
                  <span style={{
                    width: 26, height: 26, borderRadius: 8, flexShrink: 0,
                    background: active ? mt.accent : "transparent",
                    border: `1.5px solid ${active ? mt.accent : (isLight ? "rgba(0,0,0,0.7)" : "rgba(255,255,255,0.75)")}`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 15, color: active ? (isLight ? "#fff" : "#050508") : "inherit",
                  }}>+</span>
                ) : item.id === "more" ? (
                  <span style={{
                    width: 24, height: 24, borderRadius: "50%", flexShrink: 0,
                    background: `linear-gradient(135deg, ${mt.accent}45, #a78bfa45)`,
                    border: `1.5px solid ${active ? mt.accent : mt.sidebarBorder}`,
                  }} />
                ) : (
                  <span style={{ fontSize: 21, flexShrink: 0, width: 24, textAlign: "center" }}>{item.icon}</span>
                )}
                <span>{item.id === "practice" ? "Create" : item.label}</span>
              </button>
            );
          })}
          <div style={{ flex: 1 }} />
          <button onClick={() => setActiveTab("search")} style={{
            width: "100%", padding: "11px 14px", borderRadius: 999,
            border: "none", background: "transparent",
            color: isLight ? "rgba(0,0,0,0.55)" : "rgba(255,255,255,0.55)",
            cursor: "pointer", fontSize: 13, display: "flex", alignItems: "center", gap: 16,
            fontFamily: "'Sora', sans-serif", marginBottom: 12, textAlign: "left",
          }}>
            <span style={{ fontSize: 18, width: 24, textAlign: "center" }}>⌕</span>
            <span>Search</span>
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderTop: `1px solid ${mt.sidebarBorder}`, cursor: "pointer" }} onClick={() => setActiveTab("more")}>
            <div style={{ width: 32, height: 32, borderRadius: "50%", background: `linear-gradient(135deg, ${mt.accent}40, #a78bfa40)`, border: `1px solid ${mt.accent}30`, flexShrink: 0 }} />
            <span style={{ fontSize: 12, color: `rgba(${mt.accentRgb},0.6)`, fontFamily: "'Orbitron', sans-serif", letterSpacing: 1 }}>SEEKER</span>
          </div>
        </nav>
        )}

        {/* Bottom Tab Bar — mobile only, Instagram-app style with a raised center Create button */}
        {isMobile && (
          <nav style={{
            position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 40,
            display: "flex", justifyContent: "space-around", alignItems: "stretch",
            background: isLight ? "rgba(250,250,248,0.95)" : "rgba(8,8,12,0.95)",
            backdropFilter: "blur(28px) saturate(1.3)",
            borderTop: `1px solid ${mt.sidebarBorder}`,
            paddingBottom: "env(safe-area-inset-bottom, 6px)",
            boxShadow: `0 -4px 30px ${mt.sidebarGlow}`,
          }}>
            {PRIMARY_TABS.map(item => {
              const active = activeTab === item.id;
              const isCreate = item.id === "practice";
              const isMore = item.id === "more";
              return (
                <button key={item.id} onClick={() => setActiveTab(item.id)} style={{
                  flex: 1, padding: "10px 2px 8px", border: "none", background: "transparent",
                  cursor: "pointer", display: "flex", flexDirection: "column",
                  alignItems: "center", justifyContent: "center", gap: 3,
                  color: active ? mt.accent : isLight ? "rgba(0,0,0,0.45)" : "rgba(255,255,255,0.45)",
                  transition: "color 0.25s ease",
                  position: "relative",
                }}>
                  {isCreate ? (
                    <span style={{
                      width: 30, height: 30, borderRadius: 9,
                      background: active ? mt.accent : "transparent",
                      border: `1.5px solid ${active ? mt.accent : (isLight ? "rgba(0,0,0,0.5)" : "rgba(255,255,255,0.5)")}`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 17, color: active ? (isLight ? "#fff" : "#050508") : "inherit",
                      boxShadow: active ? `0 0 12px ${mt.accent}60` : "none",
                      transition: "all 0.25s ease",
                    }}>+</span>
                  ) : isMore ? (
                    <span style={{
                      width: 24, height: 24, borderRadius: "50%",
                      background: `linear-gradient(135deg, ${mt.accent}45, #a78bfa45)`,
                      border: `2px solid ${active ? mt.accent : (isLight ? "rgba(0,0,0,0.3)" : "rgba(255,255,255,0.3)")}`,
                      boxShadow: active ? `0 0 8px ${mt.accent}80` : "none",
                    }} />
                  ) : (
                    <span style={{
                      fontSize: 20, lineHeight: 1,
                      filter: active ? `drop-shadow(0 0 6px ${mt.accent}90)` : "none",
                      transform: active ? "scale(1.08)" : "scale(1)",
                      transition: "all 0.25s cubic-bezier(0.22,1,0.36,1)",
                    }}>{item.icon}</span>
                  )}
                  <span style={{
                    fontSize: 9, letterSpacing: 0.6,
                    fontFamily: "'Orbitron', sans-serif",
                    fontWeight: active ? 700 : 400,
                  }}>{item.id === "practice" ? "Create" : item.label}</span>
                </button>
              );
            })}
          </nav>
        )}

        {/* Main Content */}
        <main style={{
          marginLeft: isMobile ? 0 : 232,
          flex: 1, padding: isMobile ? "58px 0 90px" : "0 40px",
          maxWidth: "100%", width: "100%",
          animation: "appEntrance 0.8s ease",
          overflowX: "hidden",
          color: mt.textColor, transition: "color 0.8s ease",
          display: "flex", justifyContent: "center",
        }}>
        {/* IG-style centered feed column — every screen renders inside this app frame */}
        <div style={{ width: "100%", maxWidth: 630, padding: isMobile ? "0 14px" : "28px 0 40px" }}>
          <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: isMobile ? 18 : 32, paddingBottom: 16, paddingTop: isMobile ? 14 : 0, borderBottom: `1px solid rgba(${mt.accentRgb},0.06)`, flexWrap: "wrap", gap: 12, transition: "all 0.8s ease" }}>
            <div>
              <h1 style={{ fontSize: 22, fontWeight: 600, fontFamily: "'Geist', 'Sora', sans-serif", color: mt.textColor, letterSpacing: 1, textShadow: mt.headerGlow, transition: "all 0.8s ease" }}>
                {navItems.find(n => n.id === activeTab)?.icon} {navItems.find(n => n.id === activeTab)?.label}
              </h1>
              <p style={{ fontSize: 10.5, color: `rgba(${mt.accentRgb},0.4)`, marginTop: 4, letterSpacing: 2, fontFamily: "'JetBrains Mono', monospace", transition: "all 0.8s ease" }}>{mt.statusText}</p>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {!isMobile && (
                <button onClick={triggerMatrixWave} disabled={matrixWave} title="Activate Matrix Wave" style={{
                  padding: "6px 14px", borderRadius: 8, fontSize: 10, letterSpacing: 2,
                  cursor: matrixWave ? "default" : "pointer", fontFamily: "'Orbitron', sans-serif",
                  background: matrixWave ? `${mt.accent}30` : `${mt.accent}12`,
                  border: `1px solid ${mt.accent}40`,
                  color: mt.accent,
                  transition: "all 0.3s ease",
                  display: "flex", alignItems: "center", gap: 8,
                  boxShadow: matrixWave ? `0 0 12px ${mt.accent}50` : "none",
                  opacity: matrixWave ? 0.7 : 1,
                }}>
                  <span style={{ fontSize: 14 }}>{matrixWave ? "⟡" : "◈"}</span>
                  {matrixWave ? "RAINING" : "MATRIX"}
                </button>
              )}
              <button onClick={() => setMood(mood === "dark" ? "light" : "dark")} style={{
                padding: "6px 16px", borderRadius: 8, fontSize: 10, letterSpacing: 2,
                cursor: "pointer", fontFamily: "'Orbitron', sans-serif",
                background: isLight ? "rgba(0,0,0,0.06)" : "rgba(255,255,255,0.05)",
                border: `1px solid ${isLight ? "rgba(0,0,0,0.1)" : "rgba(255,255,255,0.08)"}`,
                color: isLight ? "#1a1a1a" : "rgba(255,255,255,0.5)",
                transition: "all 0.5s ease",
                display: "flex", alignItems: "center", gap: 8,
              }}>
                <span style={{ fontSize: 14, transition: "transform 0.5s ease", transform: isLight ? "rotate(0deg)" : "rotate(180deg)" }}>{isLight ? "☀️" : "🌙"}</span>
                {isLight ? "LIGHT" : "DARK"}
              </button>
            </div>
          </header>

          {/* ─── DASHBOARD ─── */}
          {activeTab === "dashboard" && (
            <HomeScreen
              setActiveTab={setActiveTab}
              level={level}
              setLevel={setLevel}
              done={doneLessons}
              setDone={setDone}
              customPath={customPath}
              setCustomPath={setCustomPath}
              isMobile={isMobile}
              mood={mood}
              mt={mt}
              isLight={isLight}
            />
          )}

          {/* ─── ENERGY 101 ─── */}
          {activeTab === "energy" && <Energy101Section setActiveTab={setActiveTab} />}

          {/* ─── POWER OF NUMBERS ─── */}
          {activeTab === "numbers" && <PowerOfNumbersSection />}

          {/* ─── E-MOTIONS ─── */}
          {activeTab === "emotions" && <EmotionsSection />}

          {/* ─── WAKE UP ─── */}
          {activeTab === "wakeup" && <WakeUpSection />}

          {/* ─── BIO FIELD ─── */}
          {activeTab === "biofield" && <BiofieldSection />}

          {/* ─── HEALTH SIMPLIFIED ─── */}
          {activeTab === "healthsimple" && <HealthSimplifiedSection setActiveTab={setActiveTab} />}

          {/* ─── HEALING ─── */}
          {activeTab === "healing" && <HealingSection />}

          {/* ─── HEAL DISEASE ─── */}
          {activeTab === "disease" && <HealDiseaseSection />}

          {/* ─── REALITY HACKS ─── */}
          {activeTab === "hacks" && <RealityHacksSection />}

          {/* ─── VIBE SHOP ─── */}
          {activeTab === "shop" && <VibeShop />}

          {/* ─── KNOWLEDGE PORTAL ─── */}
          {activeTab === "knowledge" && <KnowledgePortal />}

          {/* ─── PRACTICE ─── */}
          {activeTab === "practice" && <ZenZoneSection />}

          {/* ─── COMMUNITY — SOCIAL FEED ─── */}
          {activeTab === "community" && <CommunityFeed isMobile={isMobile} />}

          {/* ─── EVENTS ─── */}
          {activeTab === "events" && (
            <div style={{ animation: "fadeInUp 0.5s ease" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
                <div style={{ width: 3, height: 28, background: "linear-gradient(to bottom, #a78bfa, #00ff8c)", borderRadius: 2 }} />
                <h2 style={{ fontSize: 22, fontWeight: 300, color: "var(--text)", fontFamily: "'Sora', sans-serif", margin: 0 }}>COLLECTIVE EVENTS</h2>
              </div>
              <p style={{ fontSize: 14, color: "var(--text-faint)", marginBottom: 24, marginTop: 8, lineHeight: 1.8 }}>Synchronized collective experiences. When we tune in together, the signal amplifies exponentially. HeartMath research shows group coherence creates measurable effects on Earth's magnetic field.</p>

              {/* Live Map */}
              <GlassCard hover={false} style={{ marginBottom: 24 }}>
                <span style={{ fontSize: 10, letterSpacing: 3, color: "#00ff8c", textTransform: "uppercase", fontFamily: "'Orbitron', sans-serif", display: "block", marginBottom: 16 }}>GLOBAL MEDITATION MAP — LIVE</span>
                <WorldMap />
              </GlassCard>

              {/* Upcoming Events */}
              <span style={{ fontSize: 10, letterSpacing: 3, color: "var(--text-faint)", fontFamily: "'Orbitron', sans-serif", display: "block", marginBottom: 14 }}>UPCOMING EVENTS</span>
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 32 }}>
                {[
                  { title: "Full Moon Collective Meditation", date: "Mar 29 • 9PM UTC", attendees: 342, color: "#a78bfa", desc: "Harness the full moon's amplified electromagnetic energy. 30 minutes of synchronized heart coherence. Guided by the collective field.", host: "TH3 AWAR3N3SS Official" },
                  { title: "Breathwork Convergence", date: "Apr 2 • 6AM UTC", attendees: 189, color: "#06b6d4", desc: "Global Wim Hof-style power breathing. 3 rounds, 200+ people breathing together across time zones. The combined field is extraordinary.", host: "Zenith" },
                  { title: "Silent Frequency Alignment", date: "Apr 7 • 12PM UTC", attendees: 567, color: "#00ff8c", desc: "No guided audio. No music. 20 minutes of pure synchronized silence across the planet. The most powerful practice: collective non-doing.", host: "TH3 AWAR3N3SS Official" },
                  { title: "369 Manifestation Circle", date: "Apr 10 • 8PM UTC", attendees: 234, color: "#eab308", desc: "Write your intention 3x, 6x, 9x while 200+ souls do the same. Tesla's code meets collective consciousness. Amplified intent.", host: "Kael" },
                  { title: "New Moon Intention Setting", date: "Apr 13 • 7PM UTC", attendees: 445, color: "#ec4899", desc: "New moons are for planting seeds. Set intentions as a collective. Guided visualization + heart coherence + written declarations.", host: "Luna" },
                  { title: "Sunday Sound Bath", date: "Every Sunday • 4PM UTC", attendees: 128, color: "#f97316", desc: "Weekly 432Hz sound healing session. Tibetan bowls, tuning forks, and binaural beats. Join from anywhere — just close your eyes and receive.", host: "Sol" },
                ].map(evt => (
                  <GlassCard key={evt.title} style={{ flex: "1 1 300px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                      <div style={{ width: 8, height: 8, borderRadius: "50%", background: evt.color, boxShadow: `0 0 10px ${evt.color}88`, animation: "orbPulse 2s ease-in-out infinite" }} />
                      <span style={{ fontSize: 10, color: evt.color, fontFamily: "'Orbitron', sans-serif", letterSpacing: 2 }}>UPCOMING</span>
                    </div>
                    <h3 style={{ fontSize: 15, fontWeight: 600, color: "var(--text)", marginBottom: 6, fontFamily: "'Sora', sans-serif" }}>{evt.title}</h3>
                    <p style={{ fontSize: 12, color: "var(--text-faint)", marginBottom: 4, fontFamily: "'JetBrains Mono', monospace" }}>{evt.date}</p>
                    <p style={{ fontSize: 12, color: "var(--text-faint)", lineHeight: 1.6, margin: "8px 0 12px" }}>{evt.desc}</p>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div>
                        <span style={{ fontSize: 11, color: evt.color }}>{evt.attendees} souls</span>
                        <span style={{ fontSize: 10, color: "var(--text-dim)", marginLeft: 8 }}>Host: {evt.host}</span>
                      </div>
                      <button style={{ padding: "8px 18px", borderRadius: 6, background: `${evt.color}15`, border: `1px solid ${evt.color}40`, color: evt.color, cursor: "pointer", fontSize: 10, letterSpacing: 2, fontFamily: "'Orbitron', sans-serif" }}>JOIN</button>
                    </div>
                  </GlassCard>
                ))}
              </div>

              {/* Past Events / Recordings */}
              <span style={{ fontSize: 10, letterSpacing: 3, color: "var(--text-faint)", fontFamily: "'Orbitron', sans-serif", display: "block", marginBottom: 14 }}>PAST EVENTS — RECORDINGS</span>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 28 }}>
                {[
                  { title: "Equinox Collective Meditation", date: "Mar 20", attendees: 1203, color: "#a78bfa" },
                  { title: "Solar Flare Frequency Session", date: "Mar 15", attendees: 678, color: "#eab308" },
                  { title: "Heart Coherence Workshop", date: "Mar 8", attendees: 445, color: "#ef4444" },
                  { title: "Grounding & Earthing Live Class", date: "Mar 1", attendees: 312, color: "#22c55e" },
                ].map(evt => (
                  <GlassCard key={evt.title} style={{ padding: 18, display: "flex", alignItems: "center", gap: 14 }}>
                    <div style={{ width: 44, height: 44, borderRadius: 10, background: `${evt.color}10`, border: `1px solid ${evt.color}20`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}>▶</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, color: "var(--text)", fontWeight: 500 }}>{evt.title}</div>
                      <div style={{ fontSize: 11, color: "var(--text-faint)" }}>{evt.date} • {evt.attendees} participants</div>
                    </div>
                    <span style={{ fontSize: 10, color: evt.color, letterSpacing: 2, fontFamily: "'Orbitron', sans-serif" }}>REPLAY →</span>
                  </GlassCard>
                ))}
              </div>

              {/* Host your own */}
              <GlassCard hover={false} style={{ textAlign: "center", borderTop: "2px solid rgba(0,255,140,0.15)" }}>
                <span style={{ fontSize: 36, display: "block", marginBottom: 12 }}>🌐</span>
                <h3 style={{ fontSize: 18, color: "var(--text)", fontWeight: 400, marginBottom: 8, fontFamily: "'Sora', sans-serif" }}>Host Your Own Collective Event</h3>
                <p style={{ fontSize: 13, color: "var(--text-faint)", lineHeight: 1.8, maxWidth: 500, margin: "0 auto 20px" }}>
                  Lead a meditation, breathwork session, sound bath, or workshop for the TH3 AWAR3N3SS community. Your event appears on the global map and all members can join.
                </p>
                <button style={{ padding: "10px 28px", borderRadius: 8, background: "rgba(0,255,140,0.1)", border: "1px solid rgba(0,255,140,0.3)", color: "#00ff8c", cursor: "pointer", fontSize: 11, letterSpacing: 3, fontFamily: "'Orbitron', sans-serif" }}>CREATE EVENT</button>
              </GlassCard>
            </div>
          )}

          {/* ─── SEARCH ─── */}
          {activeTab === "search" && <SearchSection setActiveTab={setActiveTab} navItems={navItems} isMobile={isMobile} />}

          {/* ─── TONE SANCTUARY ─── */}
          {activeTab === "tones" && <ToneSanctuary isMobile={isMobile} setActiveTab={setActiveTab} />}

          {/* ─── EXPLORE ─── */}
          {activeTab === "explore" && <ExploreGrid setActiveTab={setActiveTab} isMobile={isMobile} />}

          {/* ─── MORE ─── */}
          {activeTab === "more" && (
            <MoreMenu
              setActiveTab={setActiveTab}
              isMobile={isMobile}
              mood={mood}
              setMood={setMood}
              triggerMatrixWave={triggerMatrixWave}
              matrixWave={matrixWave}
            />
          )}

          <footer style={{ marginTop: 80, paddingTop: 24, borderTop: `1px solid rgba(${mt.accentRgb},0.06)`, display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: 32, flexWrap: "wrap", gap: 12, transition: "all 0.8s ease" }}>
            <span style={{ fontSize: 10, color: `rgba(${mt.accentRgb},0.25)`, letterSpacing: 3, fontFamily: "'Orbitron', sans-serif" }}>TH3 AWAR3N3SS</span>

            <span style={{ fontSize: 10, color: `rgba(${mt.accentRgb},0.15)`, fontFamily: "'JetBrains Mono', monospace" }}>v3.3 • THE SIGNAL IS ETERNAL • ◈</span>
          </footer>
        </div>
        </main>

        {/* Matrix Wave Overlay — covers whole website */}
        <MatrixWave active={matrixWave} mood={mood} />

        {/* Mobile Social Account Bar */}
        {isMobile && (
          <div style={{
            position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 20,
            background: isLight ? "linear-gradient(180deg, rgba(245,245,240,0.92), rgba(245,245,240,0.98))" : "linear-gradient(180deg, rgba(5,5,8,0.92), rgba(5,5,8,0.98))",
            backdropFilter: "blur(20px) saturate(1.2)",
            borderTop: `1px solid ${mt.sidebarBorder}`,
            display: "flex", alignItems: "center", gap: 12,
            padding: "10px 16px", paddingBottom: "max(14px, env(safe-area-inset-bottom))",
            transition: "all 0.8s ease",
          }}>
            {/* Profile avatar */}
            <button onClick={() => setActiveTab("community")} style={{
              width: 38, height: 38, borderRadius: "50%",
              background: `linear-gradient(135deg, ${mt.accent}40, #a78bfa40)`,
              border: `1px solid ${mt.accent}50`,
              color: mt.accent, fontSize: 14, fontFamily: "'Orbitron', sans-serif", fontWeight: 600,
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer", flexShrink: 0,
              boxShadow: `0 0 10px ${mt.accent}20`,
            }}>◈</button>

            {/* User info */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, color: isLight ? "#1a1a1a" : "#fff", fontWeight: 600, fontFamily: "'Sora', sans-serif", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>Seeker</div>
              <div style={{ fontSize: 10, color: mt.accent, letterSpacing: 1, fontFamily: "'JetBrains Mono', monospace" }}>Level III • Seeker</div>
            </div>

            {/* Quick action icons */}
            <button onClick={() => setActiveTab("community")} title="Notifications" style={{
              width: 36, height: 36, borderRadius: 10,
              background: "transparent", border: `1px solid ${isLight ? "rgba(0,0,0,0.08)" : "rgba(255,255,255,0.08)"}`,
              color: isLight ? "rgba(0,0,0,0.55)" : "rgba(255,255,255,0.55)",
              fontSize: 16, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              position: "relative", flexShrink: 0,
            }}>
              🔔
              <span style={{ position: "absolute", top: 4, right: 4, width: 7, height: 7, borderRadius: "50%", background: "#ef4444", boxShadow: "0 0 6px rgba(239,68,68,0.6)" }} />
            </button>

            <button onClick={() => setActiveTab("community")} title="Messages" style={{
              width: 36, height: 36, borderRadius: 10,
              background: "transparent", border: `1px solid ${isLight ? "rgba(0,0,0,0.08)" : "rgba(255,255,255,0.08)"}`,
              color: isLight ? "rgba(0,0,0,0.55)" : "rgba(255,255,255,0.55)",
              fontSize: 16, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0,
            }}>💬</button>

            <button onClick={triggerMatrixWave} disabled={matrixWave} title="Activate Matrix Wave" style={{
              width: 36, height: 36, borderRadius: 10,
              background: matrixWave ? `${mt.accent}30` : `${mt.accent}12`,
              border: `1px solid ${mt.accent}40`,
              color: mt.accent, fontSize: 14, cursor: matrixWave ? "default" : "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0,
              boxShadow: matrixWave ? `0 0 12px ${mt.accent}50` : "none",
              opacity: matrixWave ? 0.7 : 1,
            }}>{matrixWave ? "⟡" : "◈"}</button>

            <button onClick={() => setMood(mood === "dark" ? "light" : "dark")} title="Toggle theme" style={{
              width: 36, height: 36, borderRadius: 10,
              background: "transparent", border: `1px solid ${isLight ? "rgba(0,0,0,0.08)" : "rgba(255,255,255,0.08)"}`,
              color: isLight ? "rgba(0,0,0,0.55)" : "rgba(255,255,255,0.55)",
              fontSize: 14, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0,
            }}>{isLight ? "☀️" : "🌙"}</button>
          </div>
        )}
      </div>
    </>
  );
}
