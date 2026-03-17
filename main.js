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
scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(5, 10, 7);
scene.add(dirLight);

// --- Grid ---
scene.add(new THREE.GridHelper(20, 20, 0x555555, 0x444444));

// --- Block state ---
const blockSize = new THREE.Vector3(1, 1, 1);
const blockCenter = new THREE.Vector3(0, 0.5, 0);
const MIN_SIZE = 0.1;

let blockMesh;
let vertexData = [];

function buildBlock() {
  if (blockMesh) scene.remove(blockMesh);

  const geo = new THREE.BoxGeometry(blockSize.x, blockSize.y, blockSize.z);
  blockMesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x4a90d9 }));
  blockMesh.position.copy(blockCenter);
  scene.add(blockMesh);

  blockMesh.add(new THREE.LineSegments(
    new THREE.EdgesGeometry(geo),
    new THREE.LineBasicMaterial({ color: 0x222222 })
  ));

  rebuildVertexData(geo);
}

function rebuildVertexData(geo) {
  vertexData = [];
  const posAttr = geo.getAttribute("position");
  const seen = new Map();
  for (let i = 0; i < posAttr.count; i++) {
    const x = posAttr.getX(i), y = posAttr.getY(i), z = posAttr.getZ(i);
    const key = `${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`;
    if (!seen.has(key)) {
      seen.set(key, new THREE.Vector3(x, y, z));
    }
  }
  for (const pos of seen.values()) {
    vertexData.push({
      localPos: pos.clone(),
      cornerSign: new THREE.Vector3(
        Math.sign(pos.x) || 1, Math.sign(pos.y) || 1, Math.sign(pos.z) || 1
      ),
      currentGrow: 0,
      targetGrow: 0,
    });
  }
}

buildBlock();

// --- Shared constants ---
const axisColors = [0xff3333, 0x33ff55, 0x3399ff];
const axisNames = ["X", "Y", "Z"];
const arrowRefDist = 7;
const arrowBaseLength = 0.5;
const arrowBaseHeadLength = 0.18;
const arrowBaseHeadWidth = 0.1;
const proximityThreshold = 40;
const faceProximityThreshold = 80;

// --- Reusable arrow pool (no more alloc/dispose every frame) ---
// Each arrow is a group with a CylinderGeometry shaft + ConeGeometry head, reused.
function makeReusableArrow() {
  const shaftGeo = new THREE.CylinderGeometry(0.015, 0.015, 1, 8);
  shaftGeo.translate(0, 0.5, 0);
  const shaftMat = new THREE.MeshBasicMaterial({ depthTest: false });
  const shaft = new THREE.Mesh(shaftGeo, shaftMat);

  const headGeo = new THREE.ConeGeometry(0.05, 0.15, 8);
  headGeo.translate(0, 0.075, 0);
  const headMat = new THREE.MeshBasicMaterial({ depthTest: false });
  const head = new THREE.Mesh(headGeo, headMat);

  const group = new THREE.Group();
  group.add(shaft);
  group.add(head);
  group.renderOrder = 2;
  group.visible = false;
  scene.add(group);

  return { group, shaft, head, shaftMat, headMat };
}

const vertexArrow = makeReusableArrow();
const faceArrow = makeReusableArrow();

function updateArrow(arrow, worldPos, dir, axisIdx, growFactor) {
  if (growFactor <= 0.01) {
    arrow.group.visible = false;
    return;
  }

  const camDist = camera.position.distanceTo(worldPos);
  const distScale = camDist / arrowRefDist;
  const length = arrowBaseLength * distScale * growFactor;
  const headLen = Math.min(arrowBaseHeadLength * distScale * growFactor, length * 0.6);
  const headW = arrowBaseHeadWidth * distScale * growFactor;
  const shaftLen = length - headLen;

  const color = axisColors[axisIdx];
  arrow.shaftMat.color.set(color);
  arrow.headMat.color.set(color);

  // Scale shaft: height = shaftLen, width = proportional
  const shaftWidth = 0.015 * distScale * Math.max(growFactor, 0.3);
  arrow.shaft.scale.set(shaftWidth / 0.015, shaftLen, shaftWidth / 0.015);

  // Position head at end of shaft
  arrow.head.position.set(0, shaftLen, 0);
  arrow.head.scale.set(headW / 0.05, headLen / 0.15, headW / 0.05);

  // Orient group to point along dir
  arrow.group.position.copy(worldPos);
  const up = new THREE.Vector3(0, 1, 0);
  if (Math.abs(dir.y) > 0.999) {
    up.set(1, 0, 0);
  }
  const quat = new THREE.Quaternion();
  const mat4 = new THREE.Matrix4();
  mat4.lookAt(new THREE.Vector3(), dir, up);
  // lookAt gives -Z forward, but our arrow points +Y, so rotate -90 around X
  const rotFix = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
  quat.setFromRotationMatrix(mat4).multiply(rotFix);
  arrow.group.quaternion.copy(quat);

  arrow.group.visible = true;
}

function hideArrow(arrow) {
  arrow.group.visible = false;
}

// --- Labels ---
function makeLabel() {
  const el = document.createElement("div");
  el.style.cssText =
    "position:fixed;padding:1px 5px;border-radius:3px;font:bold 10px monospace;" +
    "color:#fff;pointer-events:none;display:none;z-index:10;";
  document.body.appendChild(el);
  return el;
}
const vertexLabel = makeLabel();
const faceLabel = makeLabel();

function updateLabel(label, worldPos, dir, axisIdx, growFactor) {
  if (growFactor > 0.6) {
    const camDist = camera.position.distanceTo(worldPos);
    const distScale = camDist / arrowRefDist;
    const length = arrowBaseLength * distScale * growFactor;
    const endPos = worldPos.clone().addScaledVector(dir, length + 0.05 * distScale);
    const s = endPos.project(camera);
    label.style.left = ((s.x * 0.5 + 0.5) * window.innerWidth + 4) + "px";
    label.style.top = ((-s.y * 0.5 + 0.5) * window.innerHeight - 10) + "px";
    label.style.background = "#" + axisColors[axisIdx].toString(16).padStart(6, "0");
    label.textContent = axisNames[axisIdx];
    label.style.display = "block";
  } else {
    label.style.display = "none";
  }
}

let selectedAxis = 1;

// --- Dimension input ---
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
  dimInput.style.borderColor = "#" + axisColors[selectedAxis].toString(16).padStart(6, "0");
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
    blockCenter.setComponent(selectedAxis,
      blockCenter.getComponent(selectedAxis) + sizeChange * sign * 0.5);
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

// --- Interaction state ---
let activeVertexIdx = -1;
let isDragging = false;
let dragStartMouse = new THREE.Vector2();
let dragStartSize = new THREE.Vector3();
let dragStartCenter = new THREE.Vector3();
let dragCornerSign = new THREE.Vector3();

// Face hover state (updated only on mousemove, not every frame)
let faceHoverAxis = -1;
let faceHoverSign = 0;
let faceHoverCenter = new THREE.Vector3();
let faceHoverNormal = new THREE.Vector3();
let faceHoverScreenDist = Infinity;
let mouseOnBlock = false;
let faceGrow = 0;
let faceGrowTarget = 0;

// --- Mouse tracking ---
const mouseScreen = new THREE.Vector2();
const tempWorldPos = new THREE.Vector3();
const tempVec = new THREE.Vector3();
const raycaster = new THREE.Raycaster();
const mouseNDC = new THREE.Vector2();

function isVertexVisible(worldPos) {
  const toCamera = tempVec.copy(camera.position).sub(blockMesh.position);
  const cs = worldPos.clone().sub(blockMesh.position);
  const sx = Math.sign(cs.x) || 1;
  const sy = Math.sign(cs.y) || 1;
  const sz = Math.sign(cs.z) || 1;
  return sx * toCamera.x > 0 || sy * toCamera.y > 0 || sz * toCamera.z > 0;
}

function getClosestVertex() {
  let closestIdx = -1, closestDist = Infinity;
  for (let i = 0; i < vertexData.length; i++) {
    const vd = vertexData[i];
    tempWorldPos.copy(vd.localPos);
    blockMesh.localToWorld(tempWorldPos);
    if (!isVertexVisible(tempWorldPos)) continue;
    tempWorldPos.project(camera);
    const sx = (tempWorldPos.x * 0.5 + 0.5) * window.innerWidth;
    const sy = (-tempWorldPos.y * 0.5 + 0.5) * window.innerHeight;
    const dist = Math.hypot(mouseScreen.x - sx, mouseScreen.y - sy);
    if (dist < closestDist) { closestDist = dist; closestIdx = i; }
  }
  return closestIdx >= 0 && closestDist < proximityThreshold ? closestIdx : -1;
}

function getVertexWorldPos(cornerSign) {
  return new THREE.Vector3(
    blockCenter.x + cornerSign.x * blockSize.x * 0.5,
    blockCenter.y + cornerSign.y * blockSize.y * 0.5,
    blockCenter.z + cornerSign.z * blockSize.z * 0.5
  );
}

// Called ONLY on mousemove — does the raycast for face detection
function updateHover(e) {
  mouseScreen.x = e.clientX;
  mouseScreen.y = e.clientY;
  mouseNDC.x = (e.clientX / window.innerWidth) * 2 - 1;
  mouseNDC.y = -(e.clientY / window.innerHeight) * 2 + 1;

  // Face raycast (cheap — single box)
  raycaster.setFromCamera(mouseNDC, camera);
  const hits = raycaster.intersectObject(blockMesh);
  if (hits.length > 0) {
    mouseOnBlock = true;
    const normal = hits[0].face.normal.clone().transformDirection(blockMesh.matrixWorld).normalize();
    const abs = [Math.abs(normal.x), Math.abs(normal.y), Math.abs(normal.z)];
    let axis = 0;
    if (abs[1] > abs[0] && abs[1] > abs[2]) axis = 1;
    else if (abs[2] > abs[0] && abs[2] > abs[1]) axis = 2;
    const sign = normal.getComponent(axis) > 0 ? 1 : -1;

    faceHoverAxis = axis;
    faceHoverSign = sign;
    faceHoverNormal.set(0, 0, 0).setComponent(axis, sign);
    faceHoverCenter.copy(blockCenter);
    faceHoverCenter.setComponent(axis, blockCenter.getComponent(axis) + sign * blockSize.getComponent(axis) * 0.5);

    // Screen distance to face center
    const fc = faceHoverCenter.clone().project(camera);
    const sx = (fc.x * 0.5 + 0.5) * window.innerWidth;
    const sy = (-fc.y * 0.5 + 0.5) * window.innerHeight;
    faceHoverScreenDist = Math.hypot(mouseScreen.x - sx, mouseScreen.y - sy);
  } else {
    mouseOnBlock = false;
    faceHoverScreenDist = Infinity;
  }
}

// Called every frame — only does lerping, no raycasting or allocation
function animateFrame() {
  if (!isDragging) {
    activeVertexIdx = getClosestVertex();
  }

  let anyCursorClose = false;

  // Vertex grow targets
  for (let i = 0; i < vertexData.length; i++) {
    const vd = vertexData[i];
    if (i === activeVertexIdx) {
      tempWorldPos.copy(vd.localPos);
      blockMesh.localToWorld(tempWorldPos);
      tempWorldPos.project(camera);
      const sx = (tempWorldPos.x * 0.5 + 0.5) * window.innerWidth;
      const sy = (-tempWorldPos.y * 0.5 + 0.5) * window.innerHeight;
      const dist = Math.hypot(mouseScreen.x - sx, mouseScreen.y - sy);
      const prox = 1 - dist / proximityThreshold;
      vd.targetGrow = prox * prox;
      if (prox > 0.3) anyCursorClose = true;
    } else {
      vd.targetGrow = 0;
    }
    vd.currentGrow += (vd.targetGrow - vd.currentGrow) * 0.15;
    if (vd.currentGrow < 0.005) vd.currentGrow = 0;
  }

  const vertexActive = activeVertexIdx >= 0 && vertexData[activeVertexIdx].currentGrow > 0.01;

  // Vertex arrow
  if (isDragging) {
    const wp = getVertexWorldPos(dragCornerSign);
    const dir = new THREE.Vector3(0, 0, 0);
    dir.setComponent(selectedAxis, dragCornerSign.getComponent(selectedAxis));
    dir.normalize();
    updateArrow(vertexArrow, wp, dir, selectedAxis, 1);
    updateLabel(vertexLabel, wp, dir, selectedAxis, 1);
  } else if (vertexActive) {
    const vd = vertexData[activeVertexIdx];
    tempWorldPos.copy(vd.localPos);
    blockMesh.localToWorld(tempWorldPos);
    const dir = new THREE.Vector3(0, 0, 0);
    dir.setComponent(selectedAxis, vd.cornerSign.getComponent(selectedAxis));
    dir.normalize();
    updateArrow(vertexArrow, tempWorldPos, dir, selectedAxis, vd.currentGrow);
    updateLabel(vertexLabel, tempWorldPos, dir, selectedAxis, vd.currentGrow);
    anyCursorClose = true;
  } else {
    hideArrow(vertexArrow);
    vertexLabel.style.display = "none";
  }

  // Face grow target (only when no vertex is active)
  if (!vertexActive && !isDragging && mouseOnBlock) {
    const prox = Math.max(0, 1 - faceHoverScreenDist / faceProximityThreshold);
    faceGrowTarget = prox * prox;
  } else {
    faceGrowTarget = 0;
  }
  faceGrow += (faceGrowTarget - faceGrow) * 0.15;
  if (faceGrow < 0.005) faceGrow = 0;

  // Face arrow
  if (faceGrow > 0.01) {
    updateArrow(faceArrow, faceHoverCenter, faceHoverNormal, faceHoverAxis, faceGrow);
    updateLabel(faceLabel, faceHoverCenter, faceHoverNormal, faceHoverAxis, faceGrow);
    if (faceGrow > 0.3) anyCursorClose = true;
  } else {
    hideArrow(faceArrow);
    faceLabel.style.display = "none";
  }

  renderer.domElement.style.cursor =
    isDragging ? "ew-resize" : anyCursorClose ? "pointer" : "default";
}

// --- Camera controls ---
const spherical = new THREE.Spherical();
const camTarget = new THREE.Vector3(0, 0, 0);
spherical.setFromVector3(new THREE.Vector3().copy(camera.position).sub(camTarget));

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
  updateHover(e);

  if (isDragging) {
    const axisDir3D = new THREE.Vector3(0, 0, 0);
    axisDir3D.setComponent(selectedAxis, dragCornerSign.getComponent(selectedAxis));

    const tempCam = camera.clone();
    tempCam.updateMatrixWorld();
    const so = dragStartCenter.clone().project(tempCam);
    const se = dragStartCenter.clone().add(axisDir3D).project(tempCam);
    const axisDirScreen = new THREE.Vector2(se.x - so.x, se.y - so.y).normalize();

    const mouseDelta = new THREE.Vector2(
      ((e.clientX - dragStartMouse.x) / window.innerWidth) * 2,
      (-(e.clientY - dragStartMouse.y) / window.innerHeight) * 2
    );
    const dragAmount = mouseDelta.dot(axisDirScreen) * spherical.radius * 0.8;

    const currentSize = dragStartSize.getComponent(selectedAxis);
    const sizeChange = Math.max(MIN_SIZE, currentSize + dragAmount) - currentSize;

    const newSize = dragStartSize.clone();
    newSize.setComponent(selectedAxis, currentSize + sizeChange);
    const newCenter = dragStartCenter.clone();
    const sign = dragCornerSign.getComponent(selectedAxis);
    newCenter.setComponent(selectedAxis,
      dragStartCenter.getComponent(selectedAxis) + sizeChange * sign * 0.5);

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
    spherical.theta -= dx * 0.005;
    spherical.phi -= dy * 0.005;
    spherical.phi = Math.max(0.1, Math.min(Math.PI - 0.1, spherical.phi));
  }

  if (isPanning) {
    const right = new THREE.Vector3();
    const up = new THREE.Vector3();
    camera.getWorldDirection(new THREE.Vector3());
    right.setFromMatrixColumn(camera.matrixWorld, 0);
    up.setFromMatrixColumn(camera.matrixWorld, 1);
    const panOffset = new THREE.Vector3();
    panOffset.addScaledVector(right, -dx * 0.002 * spherical.radius);
    panOffset.addScaledVector(up, dy * 0.002 * spherical.radius);
    camTarget.add(panOffset);
  }
}

function onMouseUp(e) {
  if (e.button === 0 && isDragging) { isDragging = false; return; }
  if (e.button !== 1) return;
  isRotating = false;
  isPanning = false;
}

function onDblClick(e) {
  if (e.button !== 0 || activeVertexIdx < 0 || dimInputActive) return;
  e.preventDefault();
  const vd = vertexData[activeVertexIdx];
  tempWorldPos.copy(vd.localPos);
  blockMesh.localToWorld(tempWorldPos);
  tempWorldPos.project(camera);
  showDimInput(
    (tempWorldPos.x * 0.5 + 0.5) * window.innerWidth,
    (-tempWorldPos.y * 0.5 + 0.5) * window.innerHeight,
    blockSize.getComponent(selectedAxis),
    vd.cornerSign
  );
}

function onWheel(e) {
  e.preventDefault();
  const z = 1.1;
  spherical.radius *= e.deltaY > 0 ? z : 1 / z;
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

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- Render loop ---
function animate() {
  requestAnimationFrame(animate);
  camera.position.copy(camTarget).add(new THREE.Vector3().setFromSpherical(spherical));
  camera.lookAt(camTarget);
  animateFrame();
  renderer.render(scene, camera);
}

animate();
