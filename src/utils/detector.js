// Rotation-invariant Euclidean distance hand gesture heuristics

// Calculate the Euclidean distance between two 3D landmarks
export function getDistance(pt1, pt2) {
  const dx = pt1.x - pt2.x;
  const dy = pt1.y - pt2.y;
  const dz = pt1.z - pt2.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Checks if a hand landmark set represents a middle finger gesture.
 * Uses a rotation-invariant Euclidean distance heuristic.
 */
export function isMiddleFingerExtended(landmarks) {
  if (!landmarks || landmarks.length < 21) return false;

  // Establish scale: distance between Wrist (0) and Middle finger MCP (9)
  const D_scale = getDistance(landmarks[0], landmarks[9]);
  if (D_scale < 0.01) return false; // Guard against division by zero

  // Calculate finger extensions (tip to base-knuckle MCP distance)
  const d_index = getDistance(landmarks[8], landmarks[5]);
  const d_middle = getDistance(landmarks[12], landmarks[9]);
  const d_ring = getDistance(landmarks[16], landmarks[13]);
  const d_pinky = getDistance(landmarks[20], landmarks[17]);

  // Normalize distances against our scale factor
  const N_index = d_index / D_scale;
  const N_middle = d_middle / D_scale;
  const N_ring = d_ring / D_scale;
  const N_pinky = d_pinky / D_scale;

  // Gesture Signature thresholds
  const isIndexFolded = N_index < 0.65;
  const isMiddleExtended = N_middle > 1.15;
  const isRingFolded = N_ring < 0.65;
  const isPinkyFolded = N_pinky < 0.65;

  return isMiddleExtended && isIndexFolded && isRingFolded && isPinkyFolded;
}

/**
 * Calculates the bounding box and centroid of the hand for censoring.
 * Returns an object with { x, y, radius, minX, minY, maxX, maxY } in pixel space.
 */
export function getHandBoundingBox(landmarks, width, height) {
  if (!landmarks || landmarks.length === 0) return null;

  let minX = 1.0;
  let maxX = 0.0;
  let minY = 1.0;
  let maxY = 0.0;

  let sumX = 0;
  let sumY = 0;

  // Find min/max values and centroid
  landmarks.forEach((pt) => {
    if (pt.x < minX) minX = pt.x;
    if (pt.x > maxX) maxX = pt.x;
    if (pt.y < minY) minY = pt.y;
    if (pt.y > maxY) maxY = pt.y;

    sumX += pt.x;
    sumY += pt.y;
  });

  // Calculate pixel bounds
  const pxMinX = minX * width;
  const pxMaxX = maxX * width;
  const pxMinY = minY * height;
  const pxMaxY = maxY * height;

  // Centroid (average)
  const centerX = (sumX / landmarks.length) * width;
  const centerY = (sumY / landmarks.length) * height;

  // Middle finger center focal point (Landmarks 9, 10, 11, 12 represent the middle finger)
  const mFingerX = (landmarks[9].x + landmarks[10].x + landmarks[11].x + landmarks[12].x) / 4 * width;
  const mFingerY = (landmarks[9].y + landmarks[10].y + landmarks[11].y + landmarks[12].y) / 4 * height;

  // Establish a dynamic radius based on the hand size
  // Using the distance from wrist (0) to middle finger tip (12)
  const wrist = landmarks[0];
  const middleTip = landmarks[12];
  const handScale = Math.sqrt(
    Math.pow((wrist.x - middleTip.x) * width, 2) +
    Math.pow((wrist.y - middleTip.y) * height, 2)
  );

  // Radius is proportional to hand scale, with padding (e.g. 0.7x hand length)
  const radius = Math.max(handScale * 0.5, 30); // At least 30px

  return {
    x: mFingerX, // Anchor the blur on the middle finger center
    y: mFingerY,
    handCenterX: centerX,
    handCenterY: centerY,
    radius,
    minX: pxMinX,
    minY: pxMinY,
    maxX: pxMaxX,
    maxY: pxMaxY
  };
}
