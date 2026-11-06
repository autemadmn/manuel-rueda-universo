import { KeyboardControls, Stats, useKeyboardControls, useProgress } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as React from "react";
import * as THREE from "three";
import { useIsTouchDevice } from "~/src/use-is-touch-device";
import { clamp, lerp } from "~/src/utils";
import {
  CHUNK_OFFSETS,
  CHUNK_SIZE,
  INITIAL_CAMERA_Z,
  KEYBOARD_SPEED,
  MAX_VELOCITY,
  VELOCITY_DECAY,
  VELOCITY_LERP,
} from "./constants";
import styles from "./style.module.css";
import {BatchedGallery} from "./batched-gallery";
import {QuietStars} from "./stars";
import type { ChunkData, InfiniteCanvasProps, MediaItem } from "./types";
import { getChunkUpdateThrottleMs, shouldThrottleUpdate } from "./utils";
import type { JourneyRuntime } from '../journey/runtime';
import { MosaicJourney } from '../journey/scene';

const InteractionContext = React.createContext<{
  onSelect?: (media: MediaItem) => void; paused: boolean; resetToken: number; motionReduced: boolean;
  journey?: JourneyRuntime;
}>({ paused: false, resetToken: 0, motionReduced: false });



const KEYBOARD_MAP = [
  { name: "forward", keys: ["w", "W", "ArrowUp"] },
  { name: "backward", keys: ["s", "S", "ArrowDown"] },
  { name: "left", keys: ["a", "A", "ArrowLeft"] },
  { name: "right", keys: ["d", "D", "ArrowRight"] },
  { name: "up", keys: ["e", "E"] },
  { name: "down", keys: ["q", "Q"] },
];

type KeyboardKeys = {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
};

const getTouchDistance = (touches: Touch[]) => {
  if (touches.length < 2) {
    return 0;
  }

  const [t1, t2] = touches;
  const dx = t1.clientX - t2.clientX;
  const dy = t1.clientY - t2.clientY;
  return Math.sqrt(dx * dx + dy * dy);
};

function CameraLens({ fov }: { fov:number }) {
  const {camera,invalidate} = useThree();
  React.useLayoutEffect(() => {
    if(camera instanceof THREE.PerspectiveCamera){camera.fov=fov;camera.updateProjectionMatrix();invalidate();}
  },[camera,fov,invalidate]);
  return null;
}

type CameraGridState = {
  cx: number;
  cy: number;
  cz: number;
  camZ: number;
};

type ControllerState = {
  velocity: { x: number; y: number; z: number };
  targetVel: { x: number; y: number; z: number };
  basePos: { x: number; y: number; z: number };
  drift: { x: number; y: number };
  mouse: { x: number; y: number };
  lastMouse: { x: number; y: number };
  scrollAccum: number;
  isDragging: boolean;
  lastTouches: Touch[];
  lastTouchDist: number;
  lastChunkKey: string;
  lastChunkUpdate: number;
  pendingChunk: { cx: number; cy: number; cz: number } | null;
};

const createInitialState = (camZ: number): ControllerState => ({
  velocity: { x: 0, y: 0, z: 0 },
  targetVel: { x: 0, y: 0, z: 0 },
  basePos: { x: 0, y: 0, z: camZ },
  drift: { x: 0, y: 0 },
  mouse: { x: 0, y: 0 },
  lastMouse: { x: 0, y: 0 },
  scrollAccum: 0,
  isDragging: false,
  lastTouches: [],
  lastTouchDist: 0,
  lastChunkKey: "",
  lastChunkUpdate: 0,
  pendingChunk: null,
});

function SceneController({ media, onTextureProgress }: { media: MediaItem[]; onTextureProgress?: (progress: number) => void }) {
  const { camera, gl, scene, invalidate } = useThree();
  const interaction = React.useContext(InteractionContext);
  const interactionRef = React.useRef(interaction);
  interactionRef.current = interaction;
  React.useEffect(() => {
    if (interaction.resetToken) {
      Object.assign(state.current, createInitialState(INITIAL_CAMERA_Z));
      camera.position.set(0, 0, INITIAL_CAMERA_Z);
      invalidate();
    }
  }, [interaction.resetToken, camera, invalidate]);
  React.useEffect(() => {
    if (interaction.paused) {
      const s = state.current;
      s.velocity = { x: 0, y: 0, z: 0 };
      s.targetVel = { x: 0, y: 0, z: 0 };
      s.scrollAccum = 0;
      s.isDragging = false;
    }
  }, [interaction.paused]);
  const isTouchDevice = useIsTouchDevice();
  const [, getKeys] = useKeyboardControls<keyof KeyboardKeys>();

  const state = React.useRef<ControllerState>(createInitialState(INITIAL_CAMERA_Z));
  const cameraGridRef = React.useRef<CameraGridState>({ cx: 0, cy: 0, cz: 0, camZ: camera.position.z });

  const [chunks, setChunks] = React.useState<ChunkData[]>([]);
  const handoff = React.useRef(0);

  // Keep Lunardi's infinite chunk grid, excluding entire chunks outside the view.
  // One full chunk of padding preserves discovery while moving within a grid cell.
  const visibleOffsets = (cx: number, cy: number, cz: number, home = false) => {
    const viewCamera = home ? camera.clone() : camera;
    if(home)viewCamera.position.set(0,0,INITIAL_CAMERA_Z);
    viewCamera.updateMatrixWorld();
    const frustum = new THREE.Frustum().setFromProjectionMatrix(
      new THREE.Matrix4().multiplyMatrices(viewCamera.projectionMatrix, viewCamera.matrixWorldInverse)
    );
    return CHUNK_OFFSETS.filter(o => {
      const x = (cx + o.dx) * CHUNK_SIZE;
      const y = (cy + o.dy) * CHUNK_SIZE;
      const z = (cz + o.dz) * CHUNK_SIZE;
      return frustum.intersectsBox(new THREE.Box3(
        new THREE.Vector3(x, y, z),
        new THREE.Vector3(x + CHUNK_SIZE, y + CHUNK_SIZE, z + CHUNK_SIZE)
      ).expandByScalar(CHUNK_SIZE + 25));
    });
  };

  const { progress } = useProgress();
  const maxProgress = React.useRef(0);

  React.useEffect(() => {
    const rounded = Math.round(progress);

    if (rounded > maxProgress.current) {
      maxProgress.current = rounded;
      onTextureProgress?.(rounded);
    }
  }, [progress, onTextureProgress]);

  React.useEffect(() => {
    const canvas = gl.domElement;
    const s = state.current;
    canvas.style.cursor = "grab";

    const setCursor = (cursor: string) => {
      canvas.style.cursor = cursor;
    };

    let start = { x: 0, y: 0 };
    let moved = false;
    const controlsBlocked = () => interactionRef.current.paused || Boolean(interactionRef.current.journey && interactionRef.current.journey.phase !== 'free');
    const raycaster = new THREE.Raycaster();
    const choose = (x: number, y: number) => {
      if (moved || controlsBlocked()) return;
      const rect = canvas.getBoundingClientRect();
      raycaster.setFromCamera(new THREE.Vector2((x - rect.left) / rect.width * 2 - 1, -(y - rect.top) / rect.height * 2 + 1), camera);
      const hit = raycaster.intersectObjects(scene.children, true).find(h => {
        const mesh = h.object as THREE.Mesh;
        return mesh.visible && (mesh.userData.media || mesh.userData.instanceMedia?.[h.instanceId!]) && (h.instanceId === undefined ? (mesh.material as THREE.MeshBasicMaterial).opacity : mesh.userData.instanceOpacity.getX(h.instanceId)) > .2;
      });
      if (hit) interactionRef.current.onSelect?.(hit.object.userData.instanceMedia?.[hit.instanceId!] || hit.object.userData.media);
    };
    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0 || controlsBlocked()) return;
      start = { x: e.clientX, y: e.clientY }; moved = false;
      // Just start dragging - keep drift frozen at current value
      s.isDragging = true;
      s.lastMouse = { x: e.clientX, y: e.clientY };
      setCursor("grabbing");
    };

    const onMouseUp = (e: MouseEvent) => {
      if (s.isDragging && e.target === canvas) choose(e.clientX, e.clientY);
      s.isDragging = false;
      setCursor("grab");
    };

    const onMouseLeave = () => {
      s.mouse = { x: 0, y: 0 };
      s.isDragging = false;
      setCursor("grab");
      invalidate();
    };

    const onMouseMove = (e: MouseEvent) => {
      if (controlsBlocked() || (!s.isDragging && e.target !== canvas)) return;
      if (s.isDragging && Math.hypot(e.clientX-start.x,e.clientY-start.y)>8) moved = true;
      s.mouse = {
        x: (e.clientX / window.innerWidth) * 2 - 1,
        y: -(e.clientY / window.innerHeight) * 2 + 1,
      };

      if (s.isDragging) {
        s.targetVel.x -= (e.clientX - s.lastMouse.x) * 0.025;
        s.targetVel.y += (e.clientY - s.lastMouse.y) * 0.025;
        s.lastMouse = { x: e.clientX, y: e.clientY };
      }
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (controlsBlocked()) return;
      s.scrollAccum += e.deltaY * 0.006;
    };

    const onTouchStart = (e: TouchEvent) => {
      e.preventDefault();
      if (controlsBlocked()) return;
      if (e.touches.length === 1) { start = {x:e.touches[0].clientX,y:e.touches[0].clientY}; moved = false; }
      else moved = true;
      s.lastTouches = Array.from(e.touches) as Touch[];
      s.lastTouchDist = getTouchDistance(s.lastTouches);
      setCursor("grabbing");
    };

    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      if (controlsBlocked()) return;
      if (e.touches.length > 1 || Math.hypot(e.touches[0].clientX-start.x,e.touches[0].clientY-start.y)>8) moved = true;
      const touches = Array.from(e.touches) as Touch[];

      if (touches.length === 1 && s.lastTouches.length >= 1) {
        const [touch] = touches;
        const [last] = s.lastTouches;

        if (touch && last) {
          s.targetVel.x -= (touch.clientX - last.clientX) * 0.02;
          s.targetVel.y += (touch.clientY - last.clientY) * 0.02;
        }
      } else if (touches.length === 2 && s.lastTouchDist > 0) {
        const dist = getTouchDistance(touches);
        s.scrollAccum += (s.lastTouchDist - dist) * 0.006;
        s.lastTouchDist = dist;
      }

      s.lastTouches = touches;
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length === 0 && s.lastTouches.length === 1 && e.changedTouches[0]) choose(e.changedTouches[0].clientX,e.changedTouches[0].clientY);
      s.lastTouches = Array.from(e.touches) as Touch[];
      s.lastTouchDist = getTouchDistance(s.lastTouches);
      setCursor("grab");
    };

    const wake = () => { if(!controlsBlocked())invalidate(); };
    const wakeEvents = ['pointerdown','pointermove','pointerup','wheel','touchstart','touchmove','touchend'];
    wakeEvents.forEach(type=>canvas.addEventListener(type,wake,{passive:true}));
    window.addEventListener('keydown',wake);window.addEventListener('keyup',wake);
    canvas.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("mousemove", onMouseMove);
    canvas.addEventListener("mouseleave", onMouseLeave);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("touchstart", onTouchStart, { passive: false });
    canvas.addEventListener("touchmove", onTouchMove, { passive: false });
    canvas.addEventListener("touchend", onTouchEnd, { passive: false });

    return () => {
      wakeEvents.forEach(type=>canvas.removeEventListener(type,wake));
      window.removeEventListener('keydown',wake);window.removeEventListener('keyup',wake);
      canvas.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("mousemove", onMouseMove);
      canvas.removeEventListener("mouseleave", onMouseLeave);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("touchstart", onTouchStart);
      canvas.removeEventListener("touchmove", onTouchMove);
      canvas.removeEventListener("touchend", onTouchEnd);
    };
  }, [gl, camera, scene, invalidate]);

  useFrame((_, delta) => {
    if (interactionRef.current.paused) return;
    const s = state.current;
    const frameScale = Math.min(delta * 60, 2);
    const now = performance.now();

    const journey = interactionRef.current.journey;
    if (journey && handoff.current !== journey.handoff) {
      handoff.current = journey.handoff;
      Object.assign(s, createInitialState(camera.position.z));
      s.basePos = { x: camera.position.x, y: camera.position.y, z: camera.position.z };
      gl.domElement.dataset.controllerHandoffPosition = camera.position.toArray().join(',');
    }
    let isZooming = false;
    if (journey && journey.phase !== 'free') {
      // GSAP owns this same PerspectiveCamera during the introduction. Continue
      // preparing the original chunk grid, without applying any free controls.
      s.basePos = { x: camera.position.x, y: camera.position.y, z: camera.position.z };
      s.velocity = { x: 0, y: 0, z: 0 };
      s.targetVel = { x: 0, y: 0, z: 0 };
      s.drift = { x: 0, y: 0 };
      s.mouse = { x: 0, y: 0 };
      s.scrollAccum = 0;
    } else {
    const { forward, backward, left, right, up, down } = getKeys();
    if (forward) s.targetVel.z -= KEYBOARD_SPEED;
    if (backward) s.targetVel.z += KEYBOARD_SPEED;
    if (left) s.targetVel.x -= KEYBOARD_SPEED;
    if (right) s.targetVel.x += KEYBOARD_SPEED;
    if (down) s.targetVel.y -= KEYBOARD_SPEED;
    if (up) s.targetVel.y += KEYBOARD_SPEED;

    isZooming = Math.abs(s.velocity.z) > 0.05;
    const zoomFactor = clamp(s.basePos.z / 50, 0.3, 2.0);
    const driftAmount = interactionRef.current.motionReduced ? 0 : 8.0 * zoomFactor;
    const driftLerp = isZooming ? 0.2 : 0.12;

    if (s.isDragging) {
      // Freeze drift during drag - keep it at current value
    } else if (isTouchDevice) {
      s.drift.x = lerp(s.drift.x, 0, driftLerp);
      s.drift.y = lerp(s.drift.y, 0, driftLerp);
    } else {
      s.drift.x = lerp(s.drift.x, s.mouse.x * driftAmount, driftLerp);
      s.drift.y = lerp(s.drift.y, s.mouse.y * driftAmount, driftLerp);
    }

    s.targetVel.z += s.scrollAccum;
    s.scrollAccum *= 0.8;

    s.targetVel.x = clamp(s.targetVel.x, -MAX_VELOCITY, MAX_VELOCITY);
    s.targetVel.y = clamp(s.targetVel.y, -MAX_VELOCITY, MAX_VELOCITY);
    s.targetVel.z = clamp(s.targetVel.z, -MAX_VELOCITY, MAX_VELOCITY);

    s.velocity.x = lerp(s.velocity.x, s.targetVel.x, VELOCITY_LERP);
    s.velocity.y = lerp(s.velocity.y, s.targetVel.y, VELOCITY_LERP);
    s.velocity.z = lerp(s.velocity.z, s.targetVel.z, VELOCITY_LERP);

    s.basePos.x += s.velocity.x * frameScale;
    s.basePos.y += s.velocity.y * frameScale;
    s.basePos.z += s.velocity.z * frameScale;

    camera.position.set(s.basePos.x + s.drift.x, s.basePos.y + s.drift.y, s.basePos.z);

    s.targetVel.x *= interactionRef.current.motionReduced ? .45 : VELOCITY_DECAY;
    s.targetVel.y *= interactionRef.current.motionReduced ? .45 : VELOCITY_DECAY;
    s.targetVel.z *= interactionRef.current.motionReduced ? .45 : VELOCITY_DECAY;
    if(Math.max(Math.abs(s.velocity.x),Math.abs(s.velocity.y),Math.abs(s.velocity.z))>.0002 ||
      Math.abs(s.drift.x-(isTouchDevice?0:s.mouse.x*driftAmount))>.001 || Math.abs(s.drift.y-(isTouchDevice?0:s.mouse.y*driftAmount))>.001 ||
      forward||backward||left||right||up||down) invalidate();

    }

    if(journey && journey.phase !== 'free') {
      // Prepare the arrival view once; rebuilding invisible chunks along the
      // cinematic path would compete with the mosaic on smaller devices.
      cameraGridRef.current={cx:0,cy:0,cz:0,camZ:INITIAL_CAMERA_Z};
      return;
    }
    const cx = Math.floor(s.basePos.x / CHUNK_SIZE);
    const cy = Math.floor(s.basePos.y / CHUNK_SIZE);
    const cz = Math.floor(s.basePos.z / CHUNK_SIZE);

    cameraGridRef.current = { cx, cy, cz, camZ: s.basePos.z };

    const key = `${cx},${cy},${cz}`;
    if (key !== s.lastChunkKey) {
      s.pendingChunk = { cx, cy, cz };
      s.lastChunkKey = key;
    }

    const throttleMs = getChunkUpdateThrottleMs(isZooming, Math.abs(s.velocity.z));

    if (s.pendingChunk && shouldThrottleUpdate(s.lastChunkUpdate, throttleMs, now)) {
      const { cx: ucx, cy: ucy, cz: ucz } = s.pendingChunk;
      s.pendingChunk = null;
      s.lastChunkUpdate = now;

      setChunks(
        visibleOffsets(ucx, ucy, ucz).map((o) => ({
          key: `${ucx + o.dx},${ucy + o.dy},${ucz + o.dz}`,
          cx: ucx + o.dx,
          cy: ucy + o.dy,
          cz: ucz + o.dz,
        }))
      );
    }
  }, -2);

  React.useEffect(() => {
    const s = state.current;
    s.basePos = { x: camera.position.x, y: camera.position.y, z: camera.position.z };

    setChunks(
      visibleOffsets(0, 0, 0, Boolean(interactionRef.current.journey && interactionRef.current.journey.phase !== 'free')).map((o) => ({
        key: `${o.dx},${o.dy},${o.dz}`,
        cx: o.dx,
        cy: o.dy,
        cz: o.dz,
      }))
    );
  }, [camera]);

  return <BatchedGallery chunks={chunks} media={media} cameraGridRef={cameraGridRef} journey={interaction.journey}/>;

}

export function InfiniteCanvasScene({
  journey, journeyPhase,
  onSelect, paused = false, resetToken = 0, motionReduced = false,
  media,
  onTextureProgress,
  showFps = false,
  showControls = false,
  cameraFov = 60,
  cameraNear = 1,
  cameraFar = 500,
  fogNear = 120,
  fogFar = 320,
  backgroundColor = "#ffffff",
  fogColor = "#ffffff",
}: InfiniteCanvasProps) {
  const isTouchDevice = useIsTouchDevice();
  const lowPower = navigator.hardwareConcurrency <= 4 || ((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8) <= 4;
  const dpr = Math.min(window.devicePixelRatio || 1, lowPower || isTouchDevice || cameraFov > 70 ? 1 : 1.25);
  const cameraOptions = React.useMemo(() => ({ position: [0, 0, INITIAL_CAMERA_Z] as [number, number, number], fov: cameraFov, near: cameraNear, far: cameraFar }), [cameraFov, cameraNear, cameraFar]);
  const rendererOptions = React.useMemo(() => ({ antialias: false, powerPreference: "default" as const }), []);
  const interactionValue = React.useMemo(() => ({ onSelect, paused, resetToken, motionReduced, journey }), [onSelect, paused, resetToken, motionReduced, journey, journeyPhase]);

  if (!media.length) {
    return null;
  }

  return (
    <InteractionContext.Provider value={interactionValue}>
    <KeyboardControls map={KEYBOARD_MAP}>
      <div className={styles.container}>
        <Canvas
          frameloop={paused ? 'never' : journeyPhase === 'playing' ? 'always' : 'demand'}
          aria-label="Galería tridimensional de la obra de Manuel Rueda"
          camera={cameraOptions}
          dpr={dpr}
          flat
          gl={rendererOptions}
          className={styles.canvas}
        >
          <color attach="background" args={[backgroundColor]} />
          <fog attach="fog" args={[fogColor, fogNear, fogFar]} />
          <CameraLens fov={cameraFov}/>
          <QuietStars journey={journey} narrow={cameraFov>70}/>
          <SceneController media={media} onTextureProgress={onTextureProgress} />
          {journey && <MosaicJourney runtime={journey} phase={journeyPhase || journey.phase} media={media} narrow={cameraFov > 70} reduced={motionReduced} paused={paused} />}
          {showFps && <Stats className={styles.stats} />}
        </Canvas>

        {showControls && (
          <div className={styles.controlsPanel}>
            {isTouchDevice ? (
              <>
                <b>Drag</b> Pan · <b>Pinch</b> Zoom
              </>
            ) : (
              <>
                <b>WASD</b> Move · <b>QE</b> Up/Down · <b>Scroll/Space</b> Zoom
              </>
            )}
          </div>
        )}
      </div>
    </KeyboardControls>
    </InteractionContext.Provider>
  );
}
