# FingerCensor

FingerCensor is a browser-based demo that uses on-device computer vision to detect a raised middle finger in real time and apply a visual censor overlay. The app is built with React, Vite, and MediaPipe HandLandmarker, and it runs entirely in the browser after camera access is granted.

## What this project does

This app captures video from your camera, analyzes hand landmarks in the background, and detects a middle-finger gesture using a lightweight heuristic based on hand pose geometry. When a gesture is detected, the app overlays a blur, emoji, or blackout effect over the hand area to visually censor it.

It is designed as a playful, experimental demo rather than a production moderation tool.

## Key features

- Real-time camera access and live video processing
- Hand landmark detection using MediaPipe
- Middle-finger gesture detection with a custom heuristic
- Multiple censor styles: light blur, medium blur, heavy blur, emoji, and blackout
- Adjustable hysteresis to reduce flicker
- Mirror mode and front/back camera switching
- Performance profiles for high, balanced, and battery-saving modes
- Optional landmark overlay for debugging and visualization

## How it works

1. The app requests camera permission from the browser.
2. The video stream is rendered into a canvas.
3. A Web Worker loads the hand landmark model and performs inference off the main thread.
4. Detected hand landmarks are evaluated with gesture heuristics.
5. If the gesture is recognized, the app draws a censor overlay on the corresponding region of the frame.

## Technology stack

- React 19
- Vite
- MediaPipe Tasks Vision
- Web Workers for non-blocking inference
- Canvas API for real-time overlay rendering

## Getting started

### Prerequisites

Make sure you have Node.js and npm installed on your machine.

### Install dependencies

```bash
npm install
```

### Run locally

```bash
npm run dev
```

Then open the local URL shown in the terminal, usually:

```text
http://localhost:5173
```

### Build for production

```bash
npm run build
```

### Preview the production build

```bash
npm run preview
```

## Usage

1. Open the app in a browser.
2. Allow camera access when prompted.
3. Position your hand in front of the camera.
4. Use the settings panel to adjust censor style, performance, and camera options.
5. Press S to quickly open or close the settings panel.

## Project structure

```text
src/
  App.jsx                # Main app UI and camera/render loop
  utils/
    detector.js          # Gesture and bounding-box helpers
  workers/
    detectionWorker.js   # MediaPipe inference worker
```

## Browser requirements

- A modern browser with camera support is required.
- Camera access must be allowed for the app to function.
- Local development works well over localhost; deployed environments should use HTTPS for camera access.

## Notes

- This project uses a browser-side AI pipeline and does not require a backend server.
- The gesture detection is heuristic-based and may vary depending on lighting, hand angle, and camera quality.
- The app is intended as an interactive demo and should be used responsibly.

## Next steps

Possible improvements include:

- More robust gesture detection models
- Better hand tracking accuracy
- Additional censor themes and animation options
- Optional export/share capabilities

If you plan to publish this project publicly, consider adding a license file and reviewing the privacy implications of camera-based features.
