// Web Worker for off-thread MediaPipe HandLandmarker inference

let handLandmarker = null;
let isInitializing = false;

// Geometry helpers duplicated inside worker context to remain completely self-contained and performant
function getDistance(pt1, pt2) {
  const dx = pt1.x - pt2.x;
  const dy = pt1.y - pt2.y;
  const dz = pt1.z - pt2.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

let thresholds = {
  nIndex: 0.65,
  nMiddle: 1.15,
  nRing: 0.65,
  nPinky: 0.65
};

function isMiddleFingerExtended(landmarks) {
  if (!landmarks || landmarks.length < 21) return false;
  const D_scale = getDistance(landmarks[0], landmarks[9]);
  if (D_scale < 0.01) return false;
  const d_index = getDistance(landmarks[8], landmarks[5]);
  const d_middle = getDistance(landmarks[12], landmarks[9]);
  const d_ring = getDistance(landmarks[16], landmarks[13]);
  const d_pinky = getDistance(landmarks[20], landmarks[17]);
  const N_index = d_index / D_scale;
  const N_middle = d_middle / D_scale;
  const N_ring = d_ring / D_scale;
  const N_pinky = d_pinky / D_scale;
  return N_middle > thresholds.nMiddle && N_index < thresholds.nIndex && N_ring < thresholds.nRing && N_pinky < thresholds.nPinky;
}

// Handle messages from the main thread
self.onmessage = async (event) => {
  const { type, data } = event.data;

  if (type === "update-thresholds") {
    thresholds = { ...thresholds, ...data };
    return;
  }

  if (type === "init") {
    if (handLandmarker) {
      self.postMessage({ type: "initialized", success: true });
      return;
    }
    if (isInitializing) return;

    isInitializing = true;
    try {
      // Import the ESM module dynamically from CDN inside worker context
      const module = await import("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.8/vision_bundle.mjs");
      const { HandLandmarker, FilesetResolver } = module;

      const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.8/wasm"
      );

      handLandmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
          delegate: "GPU"
        },
        runningMode: "VIDEO",
        numHands: 2
      });

      isInitializing = false;
      self.postMessage({ type: "initialized", success: true });
    } catch (err) {
      console.error("Worker failed to load MediaPipe:", err);
      isInitializing = false;
      self.postMessage({ type: "initialized", success: false, error: err.message });
    }
  }

  else if (type === "detect") {
    if (!handLandmarker) {
      self.postMessage({ type: "error", error: "HandLandmarker not initialized" });
      return;
    }

    const { imageBitmap, timestamp } = data;

    try {
      const startTime = performance.now();
      
      // Perform landmarker inference using the transferred ImageBitmap
      const result = handLandmarker.detectForVideo(imageBitmap, timestamp);
      const inferenceTime = performance.now() - startTime;

      // Close the ImageBitmap immediately after processing to prevent GPU memory leaks
      imageBitmap.close();

      // Check gesture for each detected hand
      const hands = [];
      if (result.landmarks && result.landmarks.length > 0) {
        for (let i = 0; i < result.landmarks.length; i++) {
          const landmarks = result.landmarks[i];
          const isOffensive = isMiddleFingerExtended(landmarks);
          hands.push({
            landmarks,
            isOffensive
          });
        }
      }

      self.postMessage({
        type: "result",
        data: {
          hands,
          timestamp,
          inferenceTime
        }
      });
    } catch (err) {
      // Ensure the image bitmap is closed even on failure to avoid leaks
      if (imageBitmap) {
        try { imageBitmap.close(); } catch (_) {}
      }
      self.postMessage({ type: "error", error: err.message });
    }
  }
};
