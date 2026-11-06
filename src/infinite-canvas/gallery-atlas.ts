import {assetUrl} from '../asset-url';
import * as THREE from 'three';

type AtlasLayout={workUsage:{workId:string;fullRect:number[]}[]};
let pending:Promise<{texture:THREE.Texture;rects:Map<string,number[]>}>|undefined;

// One shared GPU texture, independent of catalogue size. Detailed reproductions
// are loaded separately by the HTML viewer only when a visitor opens a work.
export function getGalleryAtlas(maxTextureSize=2048){
  return pending??=(async()=>{
    const memory=(navigator as Navigator & {deviceMemory?:number}).deviceMemory??8;
    const detailed=maxTextureSize>=4096&&innerWidth>650&&!matchMedia('(pointer: coarse)').matches&&navigator.hardwareConcurrency>4&&memory>4;
    const [response,texture]=await Promise.all([
      fetch(assetUrl('/assets/mosaic/gallery-atlas.json')),
      new THREE.TextureLoader().loadAsync(assetUrl(detailed?'/assets/mosaic/atlas-desktop.webp':'/assets/mosaic/atlas.webp')),
    ]);
    if(!response.ok)throw new Error('No se ha podido cargar la colección.');
    const layout:AtlasLayout=await response.json();
    texture.colorSpace=THREE.SRGBColorSpace;
    texture.minFilter=THREE.LinearMipmapLinearFilter;
    texture.magFilter=THREE.LinearFilter;
    texture.anisotropy=4;
    return{texture,rects:new Map(layout.workUsage.map(w=>[w.workId,w.fullRect]))};
  })().catch(error=>{pending=undefined;throw error;});
}
