import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { getHandBoundingBox } from "./utils/detector";

// SVG Icons as inline components (no dependency on lucide-react)
const GearIcon = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3"/>
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
  </svg>
);

const EMOJI_OPTIONS = ["🤬", "🖕", "😡", "🚫", "💀", "🤡", "🙈", "⛔", "❌", "😤"];

const getCensorModes = (selectedEmoji) => [
  { id: "light-blur", label: "Light Blur", iconClass: "blur-swatch blur-light" },
  { id: "medium-blur", label: "Medium Blur", iconClass: "blur-swatch blur-medium" },
  { id: "heavy-blur", label: "Heavy Blur", iconClass: "blur-swatch blur-heavy" },
  { id: "emoji", label: "Emoji", icon: selectedEmoji },
  { id: "black", label: "Blackout", icon: "⬛" },
];

function App() {
  // --- State ---
  const [cameraState, setCameraState] = useState("prompt"); // "prompt" | "loading" | "ready" | "error"
  const [cameraError, setCameraError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [fps, setFps] = useState(0);
  const [inferenceMs, setInferenceMs] = useState(0);
  const [isCensored, setIsCensored] = useState(false);
  const [modelLoaded, setModelLoaded] = useState(false);
  const [modelError, setModelError] = useState("");

  // Settings
  const [censorMode, setCensorMode] = useState("medium-blur"); // light-blur, medium-blur, heavy-blur, emoji, black
  const [selectedEmoji, setSelectedEmoji] = useState("🤬");
  const [censorEnabled, setCensorEnabled] = useState(true);
  const [showLandmarks, setShowLandmarks] = useState(false);
  const [hysteresisCount, setHysteresisCount] = useState(8);
  const [mirrorMode, setMirrorMode] = useState(true);
  const [facingMode, setFacingMode] = useState("user"); // "user" | "environment"
  const [performanceMode, setPerformanceMode] = useState(() => 
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ? "balanced" : "high"
  );

  // --- Refs ---
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const animRef = useRef(null);
  const workerRef = useRef(null);
  const workerBusyRef = useRef(false);
  const latestResultRef = useRef(null);
  const latestInferenceRef = useRef(0);
  const hysteresisRef = useRef(0);
  const lastBoxRef = useRef(null);
  const lastDetectTimeRef = useRef(0);
  const blurCanvasRef = useRef(null);
  const lastUiUpdateRef = useRef(0);
  const fpsRef = useRef(0);
  const inferenceMsRef = useRef(0);
  const settingsRef = useRef({ 
    mode: censorMode, 
    emoji: selectedEmoji, 
    enabled: censorEnabled, 
    showLandmarks, 
    hysteresisCount, 
    mirrorMode,
    facingMode,
    performanceMode
  });
  const streamRef = useRef(null);

  // Keep settings ref in sync (avoids stale closures in animation loop)
  useEffect(() => {
    settingsRef.current = { 
      mode: censorMode, 
      emoji: selectedEmoji, 
      enabled: censorEnabled, 
      showLandmarks, 
      hysteresisCount, 
      mirrorMode,
      facingMode,
      performanceMode
    };
  }, [censorMode, selectedEmoji, censorEnabled, showLandmarks, hysteresisCount, mirrorMode, facingMode, performanceMode]);

  // Keyboard shortcut: "S" to toggle settings
  useEffect(() => {
    const handler = (e) => {
      if (e.key === "s" || e.key === "S") {
        if (document.activeElement?.tagName === "INPUT") return;
        setSettingsOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // --- Camera Access ---
  const startCamera = useCallback(async (facing = facingMode) => {
    setCameraState("loading");
    setCameraError("");
    if (streamRef.current) {
      try {
        streamRef.current.getTracks().forEach(t => t.stop());
      } catch (e) {
        console.error("Error stopping tracks:", e);
      }
    }
    try {
      const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
      const widthConstraint = isMobile ? { ideal: 960 } : { ideal: 1280 };
      const heightConstraint = isMobile ? { ideal: 540 } : { ideal: 720 };

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: widthConstraint,
          height: heightConstraint,
          facingMode: facing,
          frameRate: { ideal: 30 }
        },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play();
      }
      setCameraState("ready");
    } catch (err) {
      console.error("Camera error:", err);
      setCameraError(err.name === "NotAllowedError"
        ? "Camera access denied. Please allow camera permission in your browser and try again."
        : `Camera error: ${err.message}`
      );
      setCameraState("error");
    }
  }, [facingMode]);

  const handleCameraSwitch = async (newFacing) => {
    setFacingMode(newFacing);
    setMirrorMode(newFacing === "user");
    await startCamera(newFacing);
  };

  // Cleanup camera on unmount
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        try {
          streamRef.current.getTracks().forEach(t => t.stop());
        } catch (_) {}
      }
    };
  }, []);

  // --- Web Worker for MediaPipe ---
  useEffect(() => {
    if (cameraState !== "ready") return;

    let active = true;
    try {
      const worker = new Worker(
        new URL("./workers/detectionWorker.js", import.meta.url)
      );
      workerRef.current = worker;

      worker.onmessage = (event) => {
        if (!active) return;
        const { type, data, success, error } = event.data;

        if (type === "initialized") {
          if (success) {
            setModelLoaded(true);
            setModelError("");
          } else {
            setModelError(error || "Failed to load AI model");
          }
        } else if (type === "result") {
          latestResultRef.current = data;
          latestInferenceRef.current = data.inferenceTime;
          workerBusyRef.current = false;
        } else if (type === "error") {
          console.error("Worker error:", error);
          workerBusyRef.current = false;
        }
      };

      worker.postMessage({ type: "init" });
    } catch (err) {
      setModelError("Failed to spawn detection worker: " + err.message);
    }

    return () => {
      active = false;
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
    };
  }, [cameraState]);

  // --- Main Render Loop ---
  useEffect(() => {
    if (cameraState !== "ready") return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const ctx = canvas.getContext("2d");
    let frameCount = 0;
    let lastFpsTime = performance.now();
    let running = true;
    let lastCensoredState = false;

    const scheduleNextFrame = () => {
      if (!running) return;
      if (video.requestVideoFrameCallback) {
        video.requestVideoFrameCallback(() => {
          if (running) processFrame();
        });
      } else {
        animRef.current = requestAnimationFrame(processFrame);
      }
    };

    const processFrame = () => {
      if (!running) return;

      if (video.paused || video.ended || video.readyState < 2) {
        scheduleNextFrame();
        return;
      }

      // Sync canvas to video dimensions
      if (video.videoWidth > 0 && (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight)) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
      }

      const w = canvas.width;
      const h = canvas.height;
      if (w === 0 || h === 0) {
        animRef.current = requestAnimationFrame(processFrame);
        return;
      }

      const settings = settingsRef.current;

      // Draw video frame (mirrored if enabled)
      ctx.save();
      if (settings.mirrorMode) {
        ctx.translate(w, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(video, 0, 0, w, h);
      ctx.restore();

      // Send frame to worker for detection (non-blocking, downscaled, and rate-limited)
      const now = performance.now();
      if (workerRef.current && !workerBusyRef.current && modelLoaded) {
        const lastDetect = lastDetectTimeRef.current || 0;
        const elapsed = now - lastDetect;

        let targetInterval = 30;
        if (settings.performanceMode === "balanced") {
          targetInterval = 50;
        } else if (settings.performanceMode === "battery") {
          targetInterval = 85;
        }

        if (elapsed >= targetInterval) {
          workerBusyRef.current = true;
          lastDetectTimeRef.current = now;

          const targetWidth = settings.performanceMode === "battery" ? 220 : settings.performanceMode === "balanced" ? 260 : 320;
          const targetHeight = Math.round((video.videoHeight / video.videoWidth) * targetWidth);

          createImageBitmap(video, {
            resizeWidth: targetWidth,
            resizeHeight: targetHeight,
            resizeQuality: "low"
          })
            .then((bitmap) => {
              if (workerRef.current) {
                workerRef.current.postMessage(
                  { type: "detect", data: { imageBitmap: bitmap, timestamp: performance.now() } },
                  [bitmap]
                );
              } else {
                bitmap.close();
                workerBusyRef.current = false;
              }
            })
            .catch((err) => {
              // Fallback to full resolution if downscaling options are not supported
              createImageBitmap(video)
                .then((bitmap) => {
                  if (workerRef.current) {
                    workerRef.current.postMessage(
                      { type: "detect", data: { imageBitmap: bitmap, timestamp: performance.now() } },
                      [bitmap]
                    );
                  } else {
                    bitmap.close();
                    workerBusyRef.current = false;
                  }
                })
                .catch(() => {
                  workerBusyRef.current = false;
                });
            });
        }
      }

      // Process detection results
      let gestureDetected = false;
      let handBox = null;
      let allLandmarks = [];

      const result = latestResultRef.current;
      if (result?.hands?.length > 0) {
        for (const hand of result.hands) {
          if (settings.showLandmarks) {
            allLandmarks.push(hand.landmarks);
          }
          if (hand.isOffensive) {
            gestureDetected = true;
            handBox = getHandBoundingBox(hand.landmarks, w, h);
            // Mirror the box coordinates if mirrored
            if (settings.mirrorMode && handBox) {
              handBox.x = w - handBox.x;
              handBox.handCenterX = w - handBox.handCenterX;
              const tmpMinX = handBox.minX;
              handBox.minX = w - handBox.maxX;
              handBox.maxX = w - tmpMinX;
            }
            lastBoxRef.current = handBox;
            break;
          }
        }
      }

      // Hysteresis: hold censorship for N frames after detection stops
      let shouldCensor = false;
      if (gestureDetected) {
        hysteresisRef.current = settings.hysteresisCount;
        shouldCensor = true;
      } else if (hysteresisRef.current > 0) {
        hysteresisRef.current -= 1;
        handBox = lastBoxRef.current;
        shouldCensor = true;
      } else {
        lastBoxRef.current = null;
      }

      // Draw censorship overlay
      if (shouldCensor && handBox && settings.enabled && settings.mode !== "off") {
        const { x, y, radius } = handBox;

        if (settings.mode.endsWith("blur")) {
          // Hardware-accelerated bilinear blur simulation:
          // Downscale the clipped region and draw it back scaled up!
          const srcX = Math.max(0, x - radius);
          const srcY = Math.max(0, y - radius);
          const srcW = Math.min(w - srcX, radius * 2);
          const srcH = Math.min(h - srcY, radius * 2);

          if (srcW > 0 && srcH > 0) {
            if (!blurCanvasRef.current) {
              blurCanvasRef.current = document.createElement("canvas");
            }
            const blurCanvas = blurCanvasRef.current;
            const blurCtx = blurCanvas.getContext("2d");

            // Smaller offscreen size = heavier blur
            let tinySize = 16;
            if (settings.mode === "light-blur") tinySize = 32;
            if (settings.mode === "heavy-blur") tinySize = 8;

            blurCanvas.width = tinySize;
            blurCanvas.height = tinySize;

            ctx.save();
            // Clip to hand circle
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.clip();

            // Clear and copy current canvas hand region to tiny canvas
            blurCtx.clearRect(0, 0, tinySize, tinySize);
            blurCtx.drawImage(
              canvas,
              srcX, srcY, srcW, srcH,
              0, 0, tinySize, tinySize
            );

            // Draw it back stretched
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = "medium";
            ctx.drawImage(
              blurCanvas,
              x - radius, y - radius, radius * 2, radius * 2
            );
            ctx.restore();
          }

          // Neon ring around blur
          ctx.save();
          ctx.strokeStyle = "rgba(139, 92, 246, 0.5)";
          ctx.lineWidth = 2;
          ctx.shadowColor = "rgba(139, 92, 246, 0.7)";
          ctx.shadowBlur = 12;
          ctx.beginPath();
          ctx.arc(x, y, radius, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();

        } else if (settings.mode === "emoji") {
          ctx.save();
          const fontSize = Math.max(radius * 2, 36);
          ctx.font = `${fontSize}px Arial, Apple Color Emoji, Segoe UI Emoji`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.shadowColor = "rgba(0, 0, 0, 0.6)";
          ctx.shadowBlur = 10;
          ctx.fillText(settings.emoji || "🤬", x, y);
          ctx.restore();

        } else if (settings.mode === "black") {
          ctx.save();
          ctx.fillStyle = "#000";
          ctx.beginPath();
          ctx.arc(x, y, radius, 0, Math.PI * 2);
          ctx.fill();
          // Border
          ctx.strokeStyle = "rgba(255,255,255,0.15)";
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.restore();
        }
      }

      // Draw landmarks (debug mode)
      if (settings.showLandmarks && allLandmarks.length > 0) {
        for (const landmarks of allLandmarks) {
          for (const pt of landmarks) {
            let px = pt.x * w;
            let py = pt.y * h;
            if (settings.mirrorMode) px = w - px;

            ctx.beginPath();
            ctx.arc(px, py, 3, 0, Math.PI * 2);
            ctx.fillStyle = "rgba(34, 211, 238, 0.8)";
            ctx.fill();
          }
        }
      }

      // Throttled UI updates
      if (lastCensoredState !== shouldCensor) {
        lastCensoredState = shouldCensor;
        setIsCensored(shouldCensor);
      }

      frameCount++;
      const currentFpsTime = performance.now();
      const elapsedUiTime = currentFpsTime - lastUiUpdateRef.current;
      if (currentFpsTime - lastFpsTime >= 1000) {
        const nextFps = Math.round((frameCount * 1000) / (currentFpsTime - lastFpsTime));
        const nextInferenceMs = Math.round(latestInferenceRef.current * 10) / 10;
        const prevFps = fpsRef.current;
        const prevInferenceMs = inferenceMsRef.current;

        fpsRef.current = nextFps;
        inferenceMsRef.current = nextInferenceMs;

        if (elapsedUiTime >= 150 || nextFps !== prevFps || nextInferenceMs !== prevInferenceMs) {
          setFps(nextFps);
          setInferenceMs(nextInferenceMs);
          lastUiUpdateRef.current = currentFpsTime;
        }

        frameCount = 0;
        lastFpsTime = currentFpsTime;
      }

      scheduleNextFrame();
    };

    scheduleNextFrame();

    return () => {
      running = false;
      if (animRef.current) {
        cancelAnimationFrame(animRef.current);
        animRef.current = null;
      }
    };
  }, [cameraState, modelLoaded]);

  // --- Render Helpers ---
  const fpsColor = fps >= 24 ? "good" : fps >= 15 ? "warn" : "bad";
  const msColor = inferenceMs < 50 ? "good" : inferenceMs < 100 ? "warn" : "bad";

  const emojiOptions = EMOJI_OPTIONS;
  const censorModes = useMemo(() => getCensorModes(selectedEmoji), [selectedEmoji]);

  return (
    <div className="app-container" id="app-root">
      {/* Hidden video element for camera stream */}
      <video ref={videoRef} className="hidden-video" playsInline muted />

      {/* Camera permission prompt */}
      {cameraState === "prompt" && (
        <div className="permission-overlay" id="permission-screen">
          <div className="permission-icon">📷</div>
          <h1 className="permission-title">FingerCensor</h1>
          <p className="permission-desc">
            Enable your camera to start real-time middle finger detection and censoring powered by on-device AI.
          </p>
          <button className="permission-btn" id="start-camera-btn" onClick={startCamera}>
            Enable Camera
          </button>
        </div>
      )}

      {/* Camera error */}
      {cameraState === "error" && (
        <div className="permission-overlay" id="error-screen">
          <div className="permission-icon">⚠️</div>
          <h1 className="permission-title">Camera Unavailable</h1>
          <p className="permission-error">{cameraError}</p>
          <button className="permission-btn" onClick={startCamera}>
            Try Again
          </button>
        </div>
      )}

      {/* Loading camera */}
      {cameraState === "loading" && (
        <div className="loading-overlay" id="loading-screen">
          <div className="loading-spinner" />
          <p className="loading-text">Accessing camera…</p>
        </div>
      )}

      {/* Main camera view */}
      {cameraState === "ready" && (
        <>
          {/* Fullscreen canvas */}
          <canvas ref={canvasRef} className="camera-canvas" id="camera-canvas" />

          {/* Model loading overlay */}
          {!modelLoaded && (
            <div className={`loading-overlay ${modelLoaded ? "hidden" : ""}`} id="model-loading">
              <div className="loading-spinner" />
              <p className="loading-text">Loading AI model…</p>
              <p className="loading-subtext">MediaPipe HandLandmarker (GPU)</p>
              {modelError && (
                <>
                  <p className="loading-error">{modelError}</p>
                  <button className="loading-retry-btn" onClick={() => {
                    setModelError("");
                    if (workerRef.current) workerRef.current.postMessage({ type: "init" });
                  }}>
                    Retry
                  </button>
                </>
              )}
            </div>
          )}

          {/* Top HUD Bar */}
          <div className="hud-bar" id="hud-bar">
            <div className="hud-brand">
              <div className="hud-brand-icon">🖐️</div>
              <span>FingerCensor</span>
            </div>

            <div className="hud-stats">
              <div className="hud-stat">
                <span>FPS</span>
                <span className={`hud-stat-value ${fpsColor}`}>{fps}</span>
              </div>
              <div className="hud-stat">
                <span>AI</span>
                <span className={`hud-stat-value ${msColor}`}>{inferenceMs}ms</span>
              </div>
              <div className="hud-stat">
                <span>Shield</span>
                <span className={`hud-stat-value ${censorEnabled ? "good" : ""}`} style={!censorEnabled ? { color: "var(--text-muted)" } : {}}>
                  {censorEnabled ? "ON" : "OFF"}
                </span>
              </div>
            </div>
          </div>

          {/* CENSORED Alert Badge */}
          {isCensored && censorEnabled && (
            <div className="censored-badge" id="censored-badge">
              <div className="censored-badge-dot" />
              CENSORED
            </div>
          )}

          {/* Settings Toggle Button */}
          <button
            className={`settings-toggle-btn ${settingsOpen ? "open" : ""}`}
            id="settings-toggle"
            onClick={() => setSettingsOpen(!settingsOpen)}
          >
            <GearIcon className="settings-icon" />
            <span>Settings</span>
            <span className="settings-kbd">S</span>
          </button>

          {/* Settings Panel Backdrop */}
          <div
            className={`settings-panel-overlay ${settingsOpen ? "visible" : ""}`}
            onClick={() => setSettingsOpen(false)}
          />

          {/* Settings Panel */}
          <div className={`settings-panel ${settingsOpen ? "open" : ""}`} id="settings-panel">
            <div className="settings-drag-handle">
              <div className="settings-drag-bar" />
            </div>

            <div className="settings-content">
              <div className="settings-header">
                <h2 className="settings-title">Settings</h2>
                <button className="settings-close-btn" onClick={() => setSettingsOpen(false)} aria-label="Close settings">
                  ✕
                </button>
              </div>

              {/* Master Toggle */}
              <div className="setting-section" id="section-toggle">
                <div className="toggle-row" onClick={() => setCensorEnabled(!censorEnabled)}>
                  <div className="toggle-info">
                    <span className="toggle-title">Censor Shield</span>
                    <span className="toggle-desc">Enable middle finger detection & censoring</span>
                  </div>
                  <div className={`toggle-switch ${censorEnabled ? "on" : ""}`}>
                    <div className="toggle-knob" />
                  </div>
                </div>
              </div>

              {/* Censor Mode */}
              <div className="setting-section" id="section-mode">
                <span className="setting-label">Censor Style</span>
                <div className="mode-grid">
                  {censorModes.map(m => (
                    <div
                      key={m.id}
                      className={`mode-card ${censorMode === m.id ? "active" : ""}`}
                      onClick={() => setCensorMode(m.id)}
                    >
                      <div className={`mode-icon ${m.iconClass || ""}`}>
                        {m.icon || ""}
                      </div>
                      <span className="mode-name">{m.label}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Emoji Picker (visible when emoji mode) */}
              {censorMode === "emoji" && (
                <div className="setting-section" id="section-emoji">
                  <span className="setting-label">Choose Emoji</span>
                  <div className="emoji-row">
                    {emojiOptions.map(e => (
                      <button
                        key={e}
                        className={`emoji-chip ${selectedEmoji === e ? "active" : ""}`}
                        onClick={() => setSelectedEmoji(e)}
                      >
                        {e}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Hysteresis slider */}
              <div className="setting-section" id="section-hysteresis">
                <div className="slider-row">
                  <div className="slider-header">
                    <span className="setting-label">Hold Frames</span>
                    <span className="slider-value">{hysteresisCount}</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="20"
                    value={hysteresisCount}
                    onChange={(e) => setHysteresisCount(Number(e.target.value))}
                  />
                  <span className="toggle-desc" style={{ fontSize: 10 }}>
                    Frames to hold censorship after gesture stops (smooths flickering)
                  </span>
                </div>
              </div>

              {/* Mirror Mode */}
              <div className="setting-section" id="section-mirror">
                <div className="toggle-row" onClick={() => setMirrorMode(!mirrorMode)}>
                  <div className="toggle-info">
                    <span className="toggle-title">Mirror Mode</span>
                    <span className="toggle-desc">Flip camera horizontally (selfie view)</span>
                  </div>
                  <div className={`toggle-switch ${mirrorMode ? "on" : ""}`}>
                    <div className="toggle-knob" />
                  </div>
                </div>
              </div>

              {/* Camera Source */}
              <div className="setting-section" id="section-camera">
                <span className="setting-label">Camera Source</span>
                <div className="mode-grid dynamic-2-col">
                  <div
                    className={`mode-card ${facingMode === "user" ? "active" : ""}`}
                    onClick={() => handleCameraSwitch("user")}
                  >
                    <div className="mode-icon">🤳</div>
                    <span className="mode-name">Front (Selfie)</span>
                  </div>
                  <div
                    className={`mode-card ${facingMode === "environment" ? "active" : ""}`}
                    onClick={() => handleCameraSwitch("environment")}
                  >
                    <div className="mode-icon">📷</div>
                    <span className="mode-name">Back (Camera)</span>
                  </div>
                </div>
              </div>

              {/* Performance Mode */}
              <div className="setting-section" id="section-performance">
                <span className="setting-label">Performance Profile</span>
                <div className="mode-grid">
                  <div
                    className={`mode-card ${performanceMode === "high" ? "active" : ""}`}
                    onClick={() => setPerformanceMode("high")}
                  >
                    <div className="mode-icon">⚡</div>
                    <span className="mode-name">High (Max)</span>
                  </div>
                  <div
                    className={`mode-card ${performanceMode === "balanced" ? "active" : ""}`}
                    onClick={() => setPerformanceMode("balanced")}
                  >
                    <div className="mode-icon">⚖️</div>
                    <span className="mode-name">Balanced</span>
                  </div>
                  <div
                    className={`mode-card ${performanceMode === "battery" ? "active" : ""}`}
                    onClick={() => setPerformanceMode("battery")}
                  >
                    <div className="mode-icon">🔋</div>
                    <span className="mode-name">Battery Saver</span>
                  </div>
                </div>
              </div>

              {/* Show Landmarks (Debug) */}
              <div className="setting-section" id="section-landmarks">
                <div className="toggle-row" onClick={() => setShowLandmarks(!showLandmarks)}>
                  <div className="toggle-info">
                    <span className="toggle-title">Show Hand Landmarks</span>
                    <span className="toggle-desc">Display AI joint detection points (debug)</span>
                  </div>
                  <div className={`toggle-switch ${showLandmarks ? "on" : ""}`}>
                    <div className="toggle-knob" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default App;
