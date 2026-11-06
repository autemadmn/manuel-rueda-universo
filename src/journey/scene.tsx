import {assetUrl} from '../asset-url';
import { useFrame, useThree } from '@react-three/fiber';
import { gsap } from 'gsap';
import * as React from 'react';
import * as THREE from 'three';
import type { JourneyParameters, JourneyRuntime } from './runtime';
import type { MediaItem } from '../infinite-canvas/types';
import { getGalleryAtlas } from '../infinite-canvas/gallery-atlas';
import { isGalleryPlaneVisible } from '../infinite-canvas/utils';

type Tile = { id:number;workId:string;workIndex:number;row:number;column:number;start:number[];target:number[];targetSize:number[];cropRect:number[];fullRect:number[];color:number[];delay:number;keeper:boolean;targetPlaneId?:string };
type MosaicMap = {columns:number;rows:number;cellSize:number;portraitZ:number;portraitWidth:number;portraitHeight:number;atlasUrl:string;tiles:Tile[]};
type Assets = {map:MosaicMap;atlas:THREE.Texture};

const vertexShader = `
  attribute vec3 startPosition;
  attribute vec3 targetPosition;
  attribute vec2 targetSize;
  attribute vec4 cropRect;
  attribute vec4 fullRect;
  attribute vec3 cellColor;
  attribute float departure;
  attribute float flying;
  uniform float uSpread;
  uniform float uReveal;
  uniform float uDissolve;
  uniform float uCellSize;
  uniform float uPortraitX;
  varying vec2 vAtlasUv;
  varying vec3 vCellColor;
  varying float vDepth;
  varying float vCellAlpha;
  void main() {
    float travel = smoothstep(departure, 1.0, uSpread) * flying;
    vCellAlpha = mix(1. - smoothstep(departure, .82 + departure, uDissolve), 1., flying);
    vec3 start = startPosition + vec3(uPortraitX, 0., 0.);
    vec3 center = mix(start, targetPosition, travel);
    float enlargement=smoothstep(0.,.45,uSpread)*flying;
    vec2 dimensions = mix(vec2(uCellSize), targetSize, enlargement);
    vec4 region = mix(cropRect, fullRect, uReveal);
    vAtlasUv = region.xy + uv * region.zw;
    vCellColor = cellColor;
    vec4 mvPosition = modelViewMatrix * vec4(center + vec3(position.xy * dimensions, 0.), 1.);
    vDepth = -mvPosition.z;
    gl_Position = projectionMatrix * mvPosition;
    if(vCellAlpha<.001)gl_Position=vec4(2.,2.,2.,1.);
  }
`;
const fragmentShader = `
  uniform sampler2D uAtlas;
  uniform float uColorMix;
  uniform float uOpacity;
  uniform float uGalleryMix;
  uniform float uSpread;
  varying vec2 vAtlasUv;
  varying vec3 vCellColor;
  varying float vDepth;
  varying float vCellAlpha;
  void main() {
    vec3 linearArt = texture2D(uAtlas, vAtlasUv).rgb;
    // The gallery shares this sRGB GPU texture. Re-encode its hardware-decoded
    // sample for the portrait's display-space cell-color treatment.
    vec3 art = mix(12.92*linearArt,1.055*pow(linearArt,vec3(1./2.4))-.055,step(vec3(.0031308),linearArt));
    vec3 color = mix(art, vCellColor, uColorMix);
    float depthFade = 1. - smoothstep(120., 320., vDepth);
    float originalFade = pow(clamp((260. - abs(vDepth)) / 120., 0., 1.), 2.);
    float alpha = uOpacity * vCellAlpha * mix(1., originalFade, uGalleryMix);
    if(alpha<.001)discard;
    color = mix(vec3(0.0941176, 0.0901961, 0.0784314), color, depthFade);
    gl_FragColor = vec4(color, alpha);
  }
`;

function copyParameters(target:JourneyParameters,free=false) {
  Object.assign(target,{spread:free?1:0,dissolve:free?1:0,reveal:free?1:0,colorMix:free?0:.82,galleryMix:free?1:0,opacity:free?0:1});
}

export function MosaicJourney({runtime,phase,media,narrow,reduced,paused}:{runtime:JourneyRuntime;phase:string;media:MediaItem[];narrow:boolean;reduced:boolean;paused:boolean}) {
  'use no memo';
  const {camera,gl,scene,invalidate} = useThree();
  const mesh = React.useRef<THREE.InstancedMesh>(null);
  const [assets,setAssets] = React.useState<Assets|null>(null);
  const [prepared,setPrepared] = React.useState(false);
  const shouldLoad = phase !== 'free' || assets !== null;
  const startCameraZ = narrow ? 186 : 195;
  const portraitX = narrow ? 0 : 20;

  React.useEffect(() => {
    if (!shouldLoad || assets) return;
    let cancelled = false;
    const abort = new AbortController();
    (async () => {
      const response = await fetch(assetUrl('/assets/mosaic/mosaic-map.json'),{signal:abort.signal});
      if (!response.ok) throw new Error('No se ha podido cargar el mapa del retrato.');
      const map:MosaicMap = await response.json();
      const {texture:atlas} = await getGalleryAtlas(gl.capabilities.maxTextureSize);
      if (cancelled) return;
      setAssets({map,atlas});
    })().catch(error => {
      if (cancelled) return;
      runtime.error = error instanceof Error ? error.message : 'No se ha podido preparar el retrato.';
      runtime.notify('error');
    });
    return () => { cancelled = true; abort.abort(); };
  },[shouldLoad,assets,gl,media,runtime]);

  const flyingIds=React.useMemo(()=>{
    if(!assets)return new Set<number>();
    const result=new Set<number>();
    const limit=narrow?18:27;
    const score=(tile:Tile)=>{
      const [x,y,z]=tile.target;const depth=Math.max(10,50-z);
      const framing=Math.hypot(x/(depth*(narrow ? .38 : 1.1)),y/(depth*.65));
      const origin=Math.hypot(tile.start[0],tile.start[1]-12)*.015;
      return framing+depth*.002+origin-(tile.targetPlaneId?.startsWith('curated-') ? .3 : 0);
    };
    const candidatesByWork=media.map(work=>{
      const candidates=assets.map.tiles.filter(t=>t.keeper&&t.workId===work.id&&t.target[2]<35&&t.target[2]>-210&&
        (t.targetPlaneId?.startsWith('curated-')||isGalleryPlaneVisible(Number(t.targetPlaneId?.split('-').at(-1)))));
      return candidates.sort((a,b)=>score(a)-score(b));
    });
    // Fixed global cap: catalogue growth never creates a storm of flying tiles.
    for(let round=0;result.size<limit;round++){
      const candidates=candidatesByWork.flatMap(list=>list[round]?[list[round]]:[]).sort((a,b)=>score(a)-score(b));
      if(!candidates.length)break;
      for(const tile of candidates){if(result.size>=limit)break;result.add(tile.id);}
    }
    return result;
  },[assets,media,narrow]);
  const geometry = React.useMemo(() => {
    if (!assets) return null;
    const geometry = new THREE.PlaneGeometry(1,1);
    const fields: [string,number,(tile:Tile)=>number[]][] = [
      ['startPosition',3,t=>t.start],['targetPosition',3,t=>t.target],['targetSize',2,t=>t.targetSize],
      ['cropRect',4,t=>t.cropRect],['fullRect',4,t=>t.fullRect],['cellColor',3,t=>t.color],['departure',1,t=>[t.delay]],['flying',1,t=>[flyingIds.has(t.id)?1:0]],
    ];
    for (const [name,size,value] of fields) geometry.setAttribute(name,new THREE.InstancedBufferAttribute(new Float32Array(assets.map.tiles.flatMap(value)),size));
    return geometry;
  },[assets,flyingIds]);
  const material = React.useMemo(() => assets ? new THREE.ShaderMaterial({
    vertexShader,fragmentShader,transparent:true,depthWrite:false,side:THREE.DoubleSide,forceSinglePass:true,toneMapped:false,
    uniforms:{uAtlas:{value:assets.atlas},uSpread:{value:0},uDissolve:{value:0},uReveal:{value:0},uCellSize:{value:assets.map.cellSize},uPortraitX:{value:portraitX},uColorMix:{value:.82},uOpacity:{value:1},uGalleryMix:{value:0}},
  }) : null,[assets,portraitX]);

  React.useEffect(() => {
    if(!assets || !material)return;
    let cancelled=false;
    setPrepared(false);
    if(runtime.phase==='portrait')runtime.notify('loading');
    invalidate();
    gl.compileAsync(scene,camera).then(()=>{
      requestAnimationFrame(()=>requestAnimationFrame(()=>{if(!cancelled){setPrepared(true);invalidate();}}));
    }).catch(error=>{if(!cancelled){runtime.error=String(error);runtime.notify('error');}});
    return()=>{cancelled=true;};
  },[assets,material,gl,scene,camera,runtime,invalidate]);

  React.useLayoutEffect(() => {
    if (!assets || !material || !prepared || !runtime.overlay) return;
    const ui = runtime.overlay;
    const welcome = ui.querySelector('[data-welcome]');
    const beats = [1,2,3].map(n=>ui.querySelector(`[data-beat="${n}"]`));
    const progress = ui.querySelector('[data-progress]');
    const p = runtime.parameters;
    const finish = () => {
      copyParameters(p,true);
      camera.position.set(0,0,50);
      camera.quaternion.identity();
      camera.updateMatrixWorld();
      gl.domElement.dataset.handoffPosition = camera.position.toArray().join(',');
      gl.domElement.dataset.handoffQuaternion = camera.quaternion.toArray().join(',');
      gl.domElement.dataset.journeyPhase='free';
      gl.domElement.dataset.journeyTime='18.000';
      runtime.handoff++;
      runtime.notify('free');
      invalidate();
    };
    const timeline = gsap.timeline({paused:true,onComplete:finish});
    timeline.fromTo(welcome,{autoAlpha:1},{autoAlpha:0,duration:.8},0);
    const quote=(index:number,start:number,end:number) => {
      timeline.fromTo(beats[index],{autoAlpha:0,y:reduced?0:10},{autoAlpha:1,y:0,duration:.85,ease:'power1.out'},start);
      timeline.to(beats[index],{autoAlpha:0,y:reduced?0:-6,duration:.7,ease:'power1.in'},end);
    };
    quote(0,1,4.8); quote(1,5.65,9.7); quote(2,11,15.4);
    if (reduced) {
      timeline.to(p,{opacity:0,duration:.8,ease:'sine.inOut'},15.2);
      timeline.set(camera.position,{x:0,y:0,z:50},16);
      timeline.set(p,{spread:1,dissolve:1,reveal:1,colorMix:0},16);
      timeline.to(p,{galleryMix:1,duration:2,ease:'sine.inOut'},16);
    } else {
      timeline.fromTo(camera.position,{x:0,y:0,z:startCameraZ},{x:portraitX*.5,y:5,z:160,duration:5,ease:'sine.inOut'},0);
      timeline.to(camera.position,{x:portraitX,y:12,z:128,duration:5,ease:'sine.inOut'},5);
      timeline.to(camera.position,{x:0,y:0,z:50,duration:8,ease:'power2.inOut'},10);
      timeline.to(p,{colorMix:.76,duration:5,ease:'none'},0);
      timeline.to(p,{colorMix:0,duration:6,ease:'sine.inOut'},5);
      timeline.to(p,{reveal:1,duration:6,ease:'sine.inOut'},7);
      timeline.to(p,{spread:1,duration:7.6,ease:'power2.inOut'},9.2);
      timeline.to(p,{dissolve:1,duration:3,ease:'sine.inOut'},8.8);
      timeline.to(p,{galleryMix:1,opacity:0,duration:1.5,ease:'sine.inOut'},16.5);
    }
    timeline.fromTo(progress,{scaleX:0},{scaleX:1,duration:18,ease:'none'},0);
    const reset = () => {
      timeline.pause(0,true);
      copyParameters(p);
      camera.position.set(0,0,startCameraZ);
      camera.quaternion.identity();
      gsap.set(welcome,{autoAlpha:1});
      gsap.set(beats,{autoAlpha:0,y:0});
      gsap.set(progress,{scaleX:0});
      runtime.notify('portrait');
      invalidate();
    };
    runtime.timeline = timeline;
    runtime.ready = true;
    runtime.api = {
      start:() => { if (runtime.phase !== 'portrait') return; runtime.notify('playing'); timeline.restart(); invalidate(); },
      pause:() => { if(runtime.phase !== 'playing') return; timeline.pause(); runtime.notify('paused'); invalidate(); },
      resume:() => { if(runtime.phase !== 'paused') return; runtime.notify('playing'); timeline.play(); invalidate(); },
      reset,
      skip:() => { timeline.pause().totalProgress(1,true); finish(); },
    };
    if (runtime.phase !== 'free') reset();
    return () => { timeline.kill(); if(runtime.timeline===timeline){runtime.timeline=null;runtime.api=null;runtime.ready=false;} };
  },[assets,material,prepared,runtime,camera,gl,invalidate,reduced,startCameraZ,portraitX]);

  React.useEffect(() => {
    if (paused && runtime.phase === 'playing') runtime.api?.pause();
  },[paused,runtime]);
  React.useEffect(() => {gl.domElement.style.cursor=phase==='portrait'?'pointer':phase==='free'?'grab':'default';},[phase,gl]);
  React.useEffect(() => () => {geometry?.dispose();material?.dispose();},[geometry,material]);
  const frame = React.useRef(0);
  useFrame(() => {
    if (material) {
      const p = runtime.parameters;
      material.uniforms.uSpread.value=p.spread;
      material.uniforms.uDissolve.value=p.dissolve;
      material.uniforms.uReveal.value=p.reveal;
      material.uniforms.uColorMix.value=p.colorMix;
      material.uniforms.uOpacity.value=p.opacity;
      material.uniforms.uGalleryMix.value=p.galleryMix;
      material.depthWrite=p.galleryMix<.001&&p.dissolve<.001;
      if(mesh.current)mesh.current.visible=p.opacity>.001;
    }
    if(++frame.current%5===0 || runtime.phase!=='free') {
      gl.domElement.dataset.cameraPosition=camera.position.toArray().map(n=>n.toFixed(4)).join(',');
      gl.domElement.dataset.cameraQuaternion=camera.quaternion.toArray().map(n=>n.toFixed(4)).join(',');
      if(camera instanceof THREE.PerspectiveCamera)gl.domElement.dataset.cameraFov=String(camera.fov);
      gl.domElement.dataset.journeyPhase=runtime.phase;
      gl.domElement.dataset.flyingPieces=String(flyingIds.size);
      gl.domElement.dataset.drawCalls=String(gl.info.render.calls);
      gl.domElement.dataset.journeyTime=(runtime.timeline?.time()||0).toFixed(3);
    }
  });
  if (!assets || !geometry || !material) return null;
  return <instancedMesh ref={mesh} args={[geometry,material,assets.map.tiles.length]} frustumCulled={false} renderOrder={2} raycast={()=>null}/>;
}
