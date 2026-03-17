import * as THREE from "three";

// --- Scene setup ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x3a3a3a);

const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
);
camera.position.set(4, 3, 5);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
document.body.appendChild(renderer.domElement);

// --- Lighting ---
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
directionalLight.position.set(5, 10, 7);
scene.add(directionalLight);

// --- Grid helper ---
const grid = new THREE.GridHelper(20, 20, 0x555555, 0x444444);
scene.add(grid);

// --- Block state ---
const blockSize = new THREE.Vector3(1, 1, 1); // meters
const blockCenter = new THREE.Vector3(0, 0.5, 0);
const MIN_SIZE = 0.1;

let blockMesh, blockWireframe;
let vertexData = [];

function buildBlock() {
  if (blockMesh) scene.remove(blockMesh);

  const geo = new THREE.BoxGeometry(blockSize.x, blockSize.y, blockSize.z);
  const mat = new THREE.MeshStandardMaterial({ color: 0x4a90d9 });
  blockMesh = new THREE.Mesh(geo, mat);
  blockMesh.position.copy(blockCenter);
  scene.add(blockMesh);

  const edgesGeo = new THREE.EdgesGeometry(geo);
  const lineMat = new THREE.LineBasicMaterial({ color: 0x222222 });
  blockWireframe = new THREE.LineSegments(edgesGeo, lineMat);
  blockMesh.add(blockWireframe);

  rebuildVertexData(geo);
}

const proximityThreshold = 40;

function rebuildVertexData(geo) {
  vertexData = [];
  const posAttr = geo.getAttribute("position");
  const uniqueVerts = new Map();
  for (let i = 0; i < posAttr.count; i++) {
    const x = posAttr.getX(i);
    const y = posAttr.getY(i);
    const z = posAttr.getZ(i);
    const key = `${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`;
    if (!uniqueVerts.has(key)) {
      uniqueVerts.set(key, new THREE.Vector3(x, y, z));
    }
  }
  for (const pos of uniqueVerts.values()) {
    vertexData.push({
      localPos: pos.clone(),
      cornerSign: new THREE.Vector3(
        Math.sign(pos.x) || 1,
        Math.sign(pos.y) || 1,
        Math.sign(pos.z) || 1
      ),
      currentGrow: 0,
      targetGrow: 0,
    });
  }
}

buildBlock();

// --- Axis arrow indicator ---
const axisColors = [0xff3333, 0x33ff55, 0x3399ff]; // X=red, Y=green, Z=blue
const axisNames = ["X", "Y", "Z"];
const arrowRefDist = 7;
const arrowBaseLength = 0.5;
const arrowBaseHeadLength = 0.18;
const arrowBaseHeadWidth = 0.1;

let axisArrow = null;

function showAxisArrow(worldPos, cornerSign, growFactor) {
  if (axisArrow) {
    scene.remove(axisArrow);
    axisArrow.dispose();
    axisArrow = null;
  }

  if (growFactor <= 0.01) return;

  const camDist = camera.position.distanceTo(worldPos);
  const distScale = camDist / arrowRefDist;
  const length = arrowBaseLength * distScale * growFactor;
  const headLength = Math.min(arrowBaseHeadLength * distScale * growFactor, length * 0.6);
  const headWidth = arrowBaseHeadWidth * distScale * growFactor;

  const dir = new THREE.Vector3(0, 0, 0);
  dir.setComponent(selectedAxis, cornerSign.getComponent(selectedAxis));
  dir.normalize();

  axisArrow = new THREE.ArrowHelper(
    dir,
    worldPos,
    length,
    axisColors[selectedAxis],
    headLength,
    headWidth
  );
  axisArrow.renderOrder = 2;
  axisArrow.line.material.depthTest = false;
  axisArrow.cone.material.depthTest = false;
  scene.add(axisArrow);

  if (growFactor > 0.6) {
    const endPos = worldPos.clone().addScaledVector(dir, length + 0.05 * distScale);
    const endScreen = endPos.clone().project(camera);
    const sx = (endScreen.x * 0.5 + 0.5) * window.innerWidth;
    const sy = (-endScreen.y * 0.5 + 0.5) * window.innerHeight;
    axisLabel.style.left = sx + 4 + "px";
    axisLabel.style.top = sy - 10 + "px";
    axisLabel.style.background = "#" + axisColors[selectedAxis].toString(16).padStart(6, "0");
    axisLabel.textContent = axisNames[selectedAxis];
    axisLabel.style.display = "block";
  } else {
    axisLabel.style.display = "none";
  }
}

function hideAxisArrow() {
  if (axisArrow) {
    scene.remove(axisArrow);
    axisArrow.dispose();
    axisArrow = null;
  }
  axisLabel.style.display = "none";
}

// Axis label overlay
const axisLabel = document.createElement("div");
axisLabel.style.cssText =
  "position:fixed;padding:1px 5px;border-radius:3px;font:bold 10px monospace;" +
  "color:#fff;pointer-events:none;display:none;z-index:10;";
document.body.appendChild(axisLabel);

let selectedAxis = 1; // 0=X, 1=Y, 2=Z — start with Y

// --- Face arrow indicator (separate from vertex arrow) ---
let faceArrow = null;
const faceLabel = document.createElement("div");
faceLabel.style.cssText =
  "position:fixed;padding:1px 5px;border-radius:3px;font:bold 10px monospace;" +
  "color:#fff;pointer-events:none;display:none;z-index:10;";
document.body.appendChild(faceLabel);

const faceRaycaster = new THREE.Raycaster();
const faceNDC = new THREE.Vector2();
let faceHover = { axis: -1, sign: 0, center: new THREE.Vector3(), normal: new THREE.Vector3(), currentGrow: 0, targetGrow: 0 };
const faceProximityThreshold = 80;

function showFaceArrow(worldPos, normal, axisIdx, growFactor) {
  if (faceArrow) { scene.remove(faceArrow); faceArrow.dispose(); faceArrow = null; }
  if (growFactor <= 0.01) return;

  const camDist = camera.position.distanceTo(worldPos);
  const distScale = camDist / arrowRefDist;
  const length = arrowBaseLength * distScale * growFactor;
  const headLength = Math.min(arrowBaseHeadLength * distScale * growFactor, length * 0.6);
  const headWidth = arrowBaseHeadWidth * distScale * growFactor;

  faceArrow = new THREE.ArrowHelper(normal, worldPos, length, axisColors[axisIdx], headLength, headWidth);
  faceArrow.renderOrder = 2;
  faceArrow.line.material.depthTest = false;
  faceArrow.cone.material.depthTest = false;
  scene.add(faceArrow);

  if (growFactor > 0.6) {
    const endPos = worldPos.clone().addScaledVector(normal, length + 0.05 * distScale);
    const endScreen = endPos.clone().project(camera);
    const sx = (endScreen.x * 0.5 + 0.5) * window.innerWidth;
    const sy = (-endScreen.y * 0.5 + 0.5) * window.innerHeight;
    faceLabel.style.left = sx + 4 + "px";
    faceLabel.style.top = sy - 10 + "px";
    faceLabel.style.background = "#" + axisColors[axisIdx].toString(16).padStart(6, "0");
    faceLabel.textContent = axisNames[axisIdx];
    faceLabel.style.display = "block";
  } else {
    faceLabel.style.display = "none";
  }
}

function hideFaceArrow() {
  if (faceArrow) { scene.remove(faceArrow); faceArrow.dispose(); faceArrow = null; }
  faceLabel.style.display = "none";
}

// --- Dimension input overlay ---
const dimInput = document.createElement("input");
dimInput.type = "text";
dimInput.style.cssText =
  "position:fixed;width:70px;padding:4px 8px;border:2px solid #ffdd44;border-radius:6px;" +
  "font:bold 14px monospace;color:#fff;background:#222;text-align:center;" +
  "outline:none;display:none;z-index:20;";
document.body.appendChild(dimInput);

let dimInputActive = false;
let dimInputCornerSign = null;

function showDimInput(screenX, screenY, currentValue, cornerSign) {
  dimInput.value = currentValue.toFixed(2);
  dimInput.style.left = screenX - 35 + "px";
  dimInput.style.top = screenY + 16 + "px";
  dimInput.style.borderColor =
    "#" + axisColors[selectedAxis].toString(16).padStart(6, "0");
  dimInput.style.display = "block";
  dimInput.select();
  dimInput.focus();
  dimInputActive = true;
  dimInputCornerSign = cornerSign.clone();
}

function commitDimInput() {
  if (!dimInputActive) return;
  const val = parseFloat(dimInput.value);
  if (!isNaN(val) && val >= MIN_SIZE) {
    const oldSize = blockSize.getComponent(selectedAxis);
    const sizeChange = val - oldSize;
    blockSize.setComponent(selectedAxis, val);
    const sign = dimInputCornerSign.getComponent(selectedAxis);
    blockCenter.setComponent(
      selectedAxis,
      blockCenter.getComponent(selectedAxis) + sizeChange * sign * 0.5
    );
    buildBlock();
  }
  dismissDimInput();
}

function dismissDimInput() {
  dimInput.style.display = "none";
  dimInputActive = false;
  dimInputCornerSign = null;
}

dimInput.addEventListener("keydown", (e) => {
  e.stopPropagation();
  if (e.key === "Enter") commitDimInput();
  if (e.key === "Escape") dismissDimInput();
});
dimInput.addEventListener("blur", () => commitDimInput());

// --- Resize interaction state ---
let activeVertexIdx = -1;
let isDragging = false;
let dragStartMouse = new THREE.Vector2();
let dragStartSize = new THREE.Vector3();
let dragStartCenter = new THREE.Vector3();
let dragCornerSign = new THREE.Vector3();

// --- Mouse tracking ---
const mouseScreen = new THREE.Vector2();
const tempWorldPos = new THREE.Vector3();
const tempVec = new THREE.Vector3();

function updateVertexHover(e) {
  mouseScreen.x = e.clientX;
  mouseScreen.y = e.clientY;
}

function isVertexVisible(worldPos) {
  const toCamera = tempVec.copy(camera.position).sub(blockMesh.position);
  const cs = worldPos.clone().sub(blockMesh.position);
  const sx = Math.sign(cs.x) || 1;
  const sy = Math.sign(cs.y) || 1;
  const sz = Math.sign(cs.z) || 1;
  return (
    sx * toCamera.x > 0 ||
    sy * toCamera.y > 0 ||
    sz * toCamera.z > 0
  );
}

function getClosestVertex() {
  let closestIdx = -1;
  let closestDist = Infinity;

  for (let i = 0; i < vertexData.length; i++) {
    const vd = vertexData[i];
    tempWorldPos.copy(vd.localPos);
    blockMesh.localToWorld(tempWorldPos);
    if (!isVertexVisible(tempWorldPos)) continue;
    tempWorldPos.project(camera);

    const screenX = (tempWorldPos.x * 0.5 + 0.5) * window.innerWidth;
    const screenY = (-tempWorldPos.y * 0.5 + 0.5) * window.innerHeight;
    const dx = mouseScreen.x - screenX;
    const dy = mouseScreen.y - screenY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < closestDist) {
      closestDist = dist;
      closestIdx = i;
    }
  }

  if (closestIdx >= 0 && closestDist < proximityThreshold) {
    return closestIdx;
  }
  return -1;
}

function getVertexWorldPos(cornerSign) {
  return new THREE.Vector3(
    blockCenter.x + cornerSign.x * blockSize.x * 0.5,
    blockCenter.y + cornerSign.y * blockSize.y * 0.5,
    blockCenter.z + cornerSign.z * blockSize.z * 0.5
  );
}

function animateVertices() {
  if (!isDragging) {
    activeVertexIdx = getClosestVertex();
  }

  let anyCursorClose = false;

  for (let i = 0; i < vertexData.length; i++) {
    const vd = vertexData[i];
    tempWorldPos.copy(vd.localPos);
    blockMesh.localToWorld(tempWorldPos);

    const visible = isVertexVisible(tempWorldPos);
    tempWorldPos.project(camera);

    const screenX = (tempWorldPos.x * 0.5 + 0.5) * window.innerWidth;
    const screenY = (-tempWorldPos.y * 0.5 + 0.5) * window.innerHeight;
    const dx = mouseScreen.x - screenX;
    const dy = mouseScreen.y - screenY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (visible && dist < proximityThreshold && i === activeVertexIdx) {
      const proximity = 1 - dist / proximityThreshold;
      vd.targetGrow = proximity * proximity;
      if (proximity > 0.3) anyCursorClose = true;
    } else {
      vd.targetGrow = 0;
    }

    const lerp = 0.15;
    vd.currentGrow += (vd.targetGrow - vd.currentGrow) * lerp;
    if (vd.currentGrow < 0.005) vd.currentGrow = 0;
  }

  // --- Vertex arrow ---
  if (isDragging) {
    const vertWorldPos = getVertexWorldPos(dragCornerSign);
    showAxisArrow(vertWorldPos, dragCornerSign, 1);
  } else if (activeVertexIdx >= 0 && vertexData[activeVertexIdx].currentGrow > 0.01) {
    const vd = vertexData[activeVertexIdx];
    tempWorldPos.copy(vd.localPos);
    blockMesh.localToWorld(tempWorldPos);
    showAxisArrow(tempWorldPos, vd.cornerSign, vd.currentGrow);
    if (vd.currentGrow > 0.3) anyCursorClose = true;
  } else {
    hideAxisArrow();
  }

  // --- Face arrow (only when no vertex is active) ---
  const vertexActive = isDragging || (activeVertexIdx >= 0 && vertexData[activeVertexIdx].currentGrow > 0.01);

  if (!vertexActive && !isDragging) {
    faceNDC.x = (mouseScreen.x / window.innerWidth) * 2 - 1;
    faceNDC.y = -(mouseScreen.y / window.innerHeight) * 2 + 1;
    faceRaycaster.setFromCamera(faceNDC, camera);
    const hits = faceRaycaster.intersectObject(blockMesh);

    if (hits.length > 0) {
      const hit = hits[0];
      const normal = hit.face.normal.clone().transformDirection(blockMesh.matrixWorld).normalize();
      const abs = [Math.abs(normal.x), Math.abs(normal.y), Math.abs(normal.z)];
      let axis = 0;
      if (abs[1] > abs[0] && abs[1] > abs[2]) axis = 1;
      else if (abs[2] > abs[0] && abs[2] > abs[1]) axis = 2;
      const sign = normal.getComponent(axis) > 0 ? 1 : -1;

      const fc = blockCenter.clone();
      fc.setComponent(axis, blockCenter.getComponent(axis) + sign * blockSize.getComponent(axis) * 0.5);

      // Screen distance to face center for grow
      const fcScreen = fc.clone().project(camera);
      const sx = (fcScreen.x * 0.5 + 0.5) * window.innerWidth;
      const sy = (-fcScreen.y * 0.5 + 0.5) * window.innerHeight;
      const dist = Math.sqrt((mouseScreen.x - sx) ** 2 + (mouseScreen.y - sy) ** 2);
      const proximity = Math.max(0, 1 - dist / faceProximityThreshold);

      faceHover.axis = axis;
      faceHover.sign = sign;
      faceHover.center.copy(fc);
      faceHover.normal.set(0, 0, 0).setComponent(axis, sign);
      faceHover.targetGrow = proximity * proximity;
    } else {
      faceHover.targetGrow = 0;
    }
  } else {
    faceHover.targetGrow = 0;
  }

  faceHover.currentGrow += (faceHover.targetGrow - faceHover.currentGrow) * 0.15;
  if (faceHover.currentGrow < 0.005) faceHover.currentGrow = 0;

  if (faceHover.currentGrow > 0.01) {
    showFaceArrow(faceHover.center, faceHover.normal, faceHover.axis, faceHover.currentGrow);
    if (faceHover.currentGrow > 0.3) anyCursorClose = true;
  } else {
    hideFaceArrow();
  }

  renderer.domElement.style.cursor =
    isDragging ? "ew-resize" : anyCursorClose ? "pointer" : "default";
}

// --- Camera controls (custom middle-mouse) ---
const spherical = new THREE.Spherical();
const camTarget = new THREE.Vector3(0, 0, 0);

const cOffset = new THREE.Vector3().copy(camera.position).sub(camTarget);
spherical.setFromVector3(cOffset);

let isRotating = false;
let isPanning = false;
let prevMouse = { x: 0, y: 0 };

function onMouseDown(e) {
  if (dimInputActive) return;

  if (e.button === 0 && activeVertexIdx >= 0 && !isDragging) {
    e.preventDefault();
    isDragging = true;
    dragStartMouse.set(e.clientX, e.clientY);
    dragStartSize.copy(blockSize);
    dragStartCenter.copy(blockCenter);
    dragCornerSign.copy(vertexData[activeVertexIdx].cornerSign);
    return;
  }

  if (e.button !== 1) return;
  e.preventDefault();
  prevMouse.x = e.clientX;
  prevMouse.y = e.clientY;
  if (e.ctrlKey) { isPanning = true; } else { isRotating = true; }
}

function onMouseMove(e) {
  updateVertexHover(e);

  if (isDragging) {
    const axisDir3D = new THREE.Vector3(0, 0, 0);
    axisDir3D.setComponent(selectedAxis, dragCornerSign.getComponent(selectedAxis));

    const worldOrigin = dragStartCenter.clone();
    const worldEnd = dragStartCenter.clone().add(axisDir3D);

    const tempCam = camera.clone();
    tempCam.updateMatrixWorld();
    const screenOrigin = worldOrigin.clone().project(tempCam);
    const screenEnd = worldEnd.clone().project(tempCam);

    const axisDirScreen = new THREE.Vector2(
      screenEnd.x - screenOrigin.x,
      screenEnd.y - screenOrigin.y
    ).normalize();

    const mouseDelta = new THREE.Vector2(
      ((e.clientX - dragStartMouse.x) / window.innerWidth) * 2,
      (-(e.clientY - dragStartMouse.y) / window.innerHeight) * 2
    );

    const dragAmount = mouseDelta.dot(axisDirScreen) * spherical.radius * 0.8;

    const newSize = dragStartSize.clone();
    const newCenter = dragStartCenter.clone();
    const currentSize = dragStartSize.getComponent(selectedAxis);
    const sizeChange = Math.max(MIN_SIZE, currentSize + dragAmount) - currentSize;
    newSize.setComponent(selectedAxis, currentSize + sizeChange);
    const sign = dragCornerSign.getComponent(selectedAxis);
    newCenter.setComponent(
      selectedAxis,
      dragStartCenter.getComponent(selectedAxis) + sizeChange * sign * 0.5
    );

    blockSize.copy(newSize);
    blockCenter.copy(newCenter);
    buildBlock();
    return;
  }

  if (!isRotating && !isPanning) return;

  const dx = e.clientX - prevMouse.x;
  const dy = e.clientY - prevMouse.y;
  prevMouse.x = e.clientX;
  prevMouse.y = e.clientY;

  if (isRotating) {
    const rotateSpeed = 0.005;
    spherical.theta -= dx * rotateSpeed;
    spherical.phi -= dy * rotateSpeed;
    spherical.phi = Math.max(0.1, Math.min(Math.PI - 0.1, spherical.phi));
  }

  if (isPanning) {
    const panSpeed = 0.002;
    const right = new THREE.Vector3();
    const up = new THREE.Vector3();
    camera.getWorldDirection(new THREE.Vector3());
    right.setFromMatrixColumn(camera.matrixWorld, 0);
    up.setFromMatrixColumn(camera.matrixWorld, 1);
    const panOffset = new THREE.Vector3();
    panOffset.addScaledVector(right, -dx * panSpeed * spherical.radius);
    panOffset.addScaledVector(up, dy * panSpeed * spherical.radius);
    camTarget.add(panOffset);
  }
}

function onMouseUp(e) {
  if (e.button === 0 && isDragging) {
    isDragging = false;
    return;
  }
  if (e.button !== 1) return;
  isRotating = false;
  isPanning = false;
}

function onDblClick(e) {
  if (e.button !== 0 || activeVertexIdx < 0 || dimInputActive) return;
  e.preventDefault();

  const vd = vertexData[activeVertexIdx];
  const currentDim = blockSize.getComponent(selectedAxis);
  tempWorldPos.copy(vd.localPos);
  blockMesh.localToWorld(tempWorldPos);
  tempWorldPos.project(camera);
  const sx = (tempWorldPos.x * 0.5 + 0.5) * window.innerWidth;
  const sy = (-tempWorldPos.y * 0.5 + 0.5) * window.innerHeight;
  showDimInput(sx, sy, currentDim, vd.cornerSign);
}

function onWheel(e) {
  e.preventDefault();
  const zoomSpeed = 1.1;
  if (e.deltaY > 0) { spherical.radius *= zoomSpeed; }
  else { spherical.radius /= zoomSpeed; }
  spherical.radius = Math.max(1, Math.min(50, spherical.radius));
}

function onContextMenu(e) {
  e.preventDefault();
  if (activeVertexIdx >= 0 && !dimInputActive) {
    selectedAxis = (selectedAxis + 1) % 3;
  }
}

renderer.domElement.addEventListener("mousedown", onMouseDown);
renderer.domElement.addEventListener("mousemove", onMouseMove);
renderer.domElement.addEventListener("mouseup", onMouseUp);
renderer.domElement.addEventListener("dblclick", onDblClick);
renderer.domElement.addEventListener("wheel", onWheel, { passive: false });
renderer.domElement.addEventListener("contextmenu", onContextMenu);

// --- Resize handling ---
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- Render loop ---
function animate() {
  requestAnimationFrame(animate);

  const offset = new THREE.Vector3().setFromSpherical(spherical);
  camera.position.copy(camTarget).add(offset);
  camera.lookAt(camTarget);

  animateVertices();
  renderer.render(scene, camera);
}

animate();
