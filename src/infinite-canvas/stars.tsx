import * as React from 'react';
import * as THREE from 'three';
import {useFrame,useThree} from '@react-three/fiber';
import type {JourneyRuntime} from '../journey/runtime';

const vertexShader=`
  attribute float starSeed;
  uniform float uPixelRatio;
  varying float vLight;
  void main(){
    // A distant sky with slight translation parallax; wrapping makes navigation
    // unbounded without rebuilding particles or running an animation loop.
    vec3 relative=position;
    relative.xy=mod(relative.xy-cameraPosition.xy*.08+vec2(450.,325.),vec2(900.,650.))-vec2(450.,325.);
    vec4 viewPosition=viewMatrix*vec4(cameraPosition+relative,1.);
    gl_Position=projectionMatrix*viewPosition;
    gl_PointSize=(1.35+starSeed*1.25)*uPixelRatio;
    vLight=.5+starSeed*.35;
  }
`;
const fragmentShader=`
  uniform float uVisibility;
  varying float vLight;
  void main(){
    float radius=length(gl_PointCoord-vec2(.5));
    float alpha=(1.-smoothstep(.20,.5,radius))*vLight*uVisibility;
    if(alpha<.002)discard;
    gl_FragColor=vec4(1.,1.,1.,alpha);
  }
`;

export function QuietStars({journey,narrow}:{journey?:JourneyRuntime;narrow:boolean}){
  'use no memo';
  const {gl}=useThree();
  const points=React.useRef<THREE.Points>(null);
  const geometry=React.useMemo(()=>{
    let seed=2106;
    const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
    const count=narrow?360:600;
    const position=new Float32Array(count*3),light=new Float32Array(count);
    for(let i=0;i<count;i++){
      position[i*3]=(random()-.5)*900;
      position[i*3+1]=(random()-.5)*650;
      position[i*3+2]=-220-random()*240;
      light[i]=random();
    }
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.BufferAttribute(position,3));
    geometry.setAttribute('starSeed',new THREE.BufferAttribute(light,1));
    return geometry;
  },[narrow]);
  const material=React.useMemo(()=>new THREE.ShaderMaterial({
    vertexShader,fragmentShader,transparent:true,depthWrite:false,depthTest:true,toneMapped:false,
    uniforms:{uVisibility:{value:0},uPixelRatio:{value:1}},
  }),[]);
  React.useEffect(()=>()=>geometry.dispose(),[geometry]);
  React.useEffect(()=>()=>material.dispose(),[material]);
  useFrame(()=>{
    const visibility=.65+(journey?.parameters.galleryMix??1)*.35;
    material.uniforms.uVisibility.value=visibility;
    material.uniforms.uPixelRatio.value=gl.getPixelRatio();
    if(points.current)points.current.visible=visibility>.001;
    gl.domElement.dataset.starParticles=String(narrow?360:600);
    gl.domElement.dataset.starVisibility=visibility.toFixed(2);
  },-1);
  return <points ref={points} geometry={geometry} material={material} frustumCulled={false} renderOrder={-10} raycast={()=>{}}/>;
}
