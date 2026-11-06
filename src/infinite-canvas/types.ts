import type * as THREE from "three";
import type { JourneyPhase, JourneyRuntime } from '../journey/runtime';

export type MediaItem = {
  id?: string;
  url: string;
  width: number;
  height: number;
};

export type InfiniteCanvasProps = {
  journey?: JourneyRuntime;
  journeyPhase?: JourneyPhase;
  onSelect?: (media: MediaItem) => void;
  paused?: boolean;
  resetToken?: number;
  motionReduced?: boolean;
  media: MediaItem[];
  onTextureProgress?: (progress: number) => void;
  showFps?: boolean;
  showControls?: boolean;
  cameraFov?: number;
  cameraNear?: number;
  cameraFar?: number;
  fogNear?: number;
  fogFar?: number;
  backgroundColor?: string;
  fogColor?: string;
};

export type ChunkData = {
  key: string;
  cx: number;
  cy: number;
  cz: number;
};

export type PlaneData = {
  id: string;
  position: THREE.Vector3;
  scale: THREE.Vector3;
  mediaIndex: number;
};
