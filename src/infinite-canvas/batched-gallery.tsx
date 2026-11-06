import * as React from 'react';
import * as THREE from 'three';
import {useFrame,useThree} from '@react-three/fiber';
import type {ChunkData,MediaItem} from './types';
import type {JourneyRuntime} from '../journey/runtime';
import {generateChunkPlanesCached,getArtworkDisplayScale,isGalleryPlaneVisible,OPENING_ARTWORKS} from './utils';
import {getGalleryAtlas} from './gallery-atlas';
import {CHUNK_FADE_MARGIN,RENDER_DISTANCE,DEPTH_FADE_END,DEPTH_FADE_START} from './constants';

type Grid={cx:number;cy:number;cz:number;camZ:number};
type Item={id:string;position:THREE.Vector3;height:number;cx:number;cy:number;cz:number;mediaIndex:number};
const CAPACITY=2048;

export function BatchedGallery({chunks,media,cameraGridRef,journey}:{chunks:ChunkData[];media:MediaItem[];cameraGridRef:React.RefObject<Grid>;journey?:JourneyRuntime}){
  'use no memo';
  const {invalidate,gl}=useThree();
  const mesh=React.useRef<THREE.InstancedMesh>(null);
  const [atlas,setAtlas]=React.useState<Awaited<ReturnType<typeof getGalleryAtlas>>|null>(null);
  const items=React.useMemo(()=>{
    const result:Item[]=[];
    for(const chunk of chunks)for(const [index,plane] of generateChunkPlanesCached(chunk.cx,chunk.cy,chunk.cz).entries()){
      if(!isGalleryPlaneVisible(index))continue;
      const mediaIndex=plane.mediaIndex%media.length;
      result.push({id:plane.id,position:plane.position,height:plane.scale.y*getArtworkDisplayScale(media[mediaIndex]),cx:chunk.cx,cy:chunk.cy,cz:chunk.cz,mediaIndex});
    }
    OPENING_ARTWORKS.forEach((a,i)=>result.push({id:`curated-${i}`,position:new THREE.Vector3(...a.p),height:a.size,cx:0,cy:0,cz:0,mediaIndex:a.i%media.length}));
    return result.sort((a,b)=>a.position.z-b.position.z).slice(0,CAPACITY);
  },[chunks,media]);
  const resources=React.useMemo(()=>{
    const geometry=new THREE.PlaneGeometry(1,1);
    const alpha=new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY),1).setUsage(THREE.DynamicDrawUsage);
    const rect=new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY*4),4).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('instanceOpacity',alpha);geometry.setAttribute('atlasRect',rect);
    const material=new THREE.MeshBasicMaterial({transparent:true,side:THREE.DoubleSide,depthWrite:false});
    material.forceSinglePass=true;
    material.customProgramCacheKey=()=> 'rueda-shared-atlas-v1';
    material.onBeforeCompile=shader=>{
      shader.vertexShader='attribute float instanceOpacity; attribute vec4 atlasRect; varying float vInstanceOpacity;\n'+shader.vertexShader;
      shader.vertexShader=shader.vertexShader.replace('#include <uv_vertex>','#include <uv_vertex>\n#ifdef USE_MAP\nvMapUv=atlasRect.xy+vMapUv*atlasRect.zw;\n#endif');
      shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvInstanceOpacity=instanceOpacity;');
      shader.vertexShader=shader.vertexShader.replace('#include <project_vertex>','#include <project_vertex>\nif(instanceOpacity<0.002)gl_Position=vec4(2.0,2.0,2.0,1.0);');
      shader.fragmentShader='varying float vInstanceOpacity;\n'+shader.fragmentShader;
      shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>','#include <color_fragment>\ndiffuseColor.a*=vInstanceOpacity;');
    };
    return{geometry,alpha,rect,material,opacity:new Float32Array(CAPACITY),ids:[] as string[],instanceMedia:[] as MediaItem[]};
  },[]);
  React.useEffect(()=>{
    let active=true;
    getGalleryAtlas(gl.capabilities.maxTextureSize).then(value=>{if(!active)return;resources.material.map=value.texture;resources.material.needsUpdate=true;gl.domElement.dataset.atlasSize=String((value.texture.image as HTMLImageElement).width);setAtlas(value);invalidate();}).catch(error=>{if(active&&journey){journey.error=String(error);journey.notify('error');}});
    return()=>{active=false;};
  },[resources,invalidate,journey,gl]);
  React.useEffect(()=>()=>{resources.geometry.dispose();resources.material.dispose();},[resources]);
  React.useLayoutEffect(()=>{
    const target=mesh.current;if(!target||!atlas)return;
    const matrix=new THREE.Matrix4();const r=resources;
    const previous=new Map(r.ids.map((id,n)=>[id,r.opacity[n]]));
    target.count=items.length;r.instanceMedia.length=0;
    items.forEach((item,n)=>{
      const work=media[item.mediaIndex];
      matrix.makeScale(item.height*work.width/work.height,item.height,1);matrix.setPosition(item.position);target.setMatrixAt(n,matrix);
      r.opacity[n]=previous.get(item.id)??0;r.alpha.setX(n,r.opacity[n]*(journey?.parameters.galleryMix??1));
      const rect=atlas.rects.get(work.id||'')||[0,0,1,1];r.rect.setXYZW(n,rect[0],rect[1],rect[2],rect[3]);r.instanceMedia.push(work);
    });
    target.instanceMatrix.setUsage(THREE.DynamicDrawUsage);target.instanceMatrix.needsUpdate=true;target.computeBoundingSphere();
    r.ids=items.map(item=>item.id);r.alpha.needsUpdate=true;r.rect.needsUpdate=true;invalidate();
  },[items,media,resources,atlas,invalidate,journey]);
  const diagnosticFrame=React.useRef(0);
  useFrame(()=>{
    const targetMesh=mesh.current;if(!targetMesh)return;
    const grid=cameraGridRef.current;const mix=journey?.parameters.galleryMix??1;const r=resources;let changing=false;
    targetMesh.visible=Boolean(atlas)&&mix>.001;
    if(atlas){
      for(let n=0;n<items.length;n++){
        const item=items[n];
        const dist=Math.max(Math.abs(item.cx-grid.cx),Math.abs(item.cy-grid.cy),Math.abs(item.cz-grid.cz));
        const depth=Math.abs(item.position.z-grid.camZ);
        const gridFade=dist<=RENDER_DISTANCE?1:Math.max(0,1-(dist-RENDER_DISTANCE)/CHUNK_FADE_MARGIN);
        const depthFade=depth<=DEPTH_FADE_START?1:Math.max(0,1-(depth-DEPTH_FADE_START)/(DEPTH_FADE_END-DEPTH_FADE_START));
        const target=Math.min(gridFade,depthFade*depthFade);const previous=r.opacity[n];
        const next=Math.abs(previous-target)<.002?target:previous+(target-previous)*.2;
        r.opacity[n]=next;r.alpha.setX(n,next*mix);if(Math.abs(next-target)>.002)changing=true;
      }
      r.alpha.needsUpdate=true;
    }
    if(changing)invalidate();
    if(++diagnosticFrame.current%8===0){gl.domElement.dataset.drawCalls=String(gl.info.render.calls);gl.domElement.dataset.renderFrame=String(gl.info.render.frame);gl.domElement.dataset.galleryInstances=String(items.length);}
  },-1);
  return <instancedMesh ref={mesh} args={[resources.geometry,resources.material,CAPACITY]} frustumCulled={false} userData={{instanceMedia:resources.instanceMedia,instanceOpacity:resources.alpha}}/>;
}
