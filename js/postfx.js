import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';

// مرحلة الصورة النهائية: ظل الزوايا (AO) + توهّج + تلوين سينمائي + فينييت وحبيبات + تنعيم الحواف

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uLift: { value: new THREE.Vector3(0.0, 0.0, 0.004) },
    uGamma: { value: new THREE.Vector3(1.0, 1.0, 1.0) },
    uGain: { value: new THREE.Vector3(1.03, 1.0, 0.97) },
    uSat: { value: 1.06 },
    uContrast: { value: 1.04 },
    uShadowTint: { value: new THREE.Vector3(-0.004, 0.002, 0.008) },
    uHighTint: { value: new THREE.Vector3(0.02, 0.01, -0.012) },
    uVignette: { value: 0.32 },
    uGrain: { value: 0.025 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime, uSat, uContrast, uVignette, uGrain;
    uniform vec3 uLift, uGamma, uGain, uShadowTint, uHighTint;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb;
      col = col * uGain + uLift * (1.0 - col);
      col = pow(max(col, vec3(0.0)), 1.0 / uGamma);
      col = (col - 0.5) * uContrast + 0.5;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSat);
      col += uShadowTint * (1.0 - smoothstep(0.0, 0.5, l)) + uHighTint * smoothstep(0.45, 1.0, l);
      float d = distance(vUv, vec2(0.5));
      col *= 1.0 - uVignette * smoothstep(0.3, 0.85, d);
      float n = fract(sin(dot(vUv * (uTime + 1.0), vec2(12.9898, 78.233))) * 43758.5453);
      col += (n - 0.5) * uGrain;
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), c.a);
    }`,
};

export async function makeComposer(renderer, scene, camera, Q) {
  const size = renderer.getSize(new THREE.Vector2());
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  let gtao = null;
  if (Q.ao) {
    const { GTAOPass } = await import('three/addons/postprocessing/GTAOPass.js');
    gtao = new GTAOPass(scene, camera, size.x, size.y);
    gtao.output = GTAOPass.OUTPUT.Default;
    gtao.blendIntensity = 0.85;
    gtao.updateGtaoMaterial({ radius: 2.2, distanceExponent: 1.2, thickness: 1.5, scale: 1.1, samples: Q.ao >= 2 ? 16 : 10, distanceFallOff: 1, screenSpaceRadius: false });
    gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
    composer.addPass(gtao);
  }
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.35, 0.45, 0.92);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const grade = new ShaderPass(GradeShader);
  composer.addPass(grade);
  composer.addPass(new SMAAPass(size.x * renderer.getPixelRatio(), size.y * renderer.getPixelRatio()));

  // التلوين بيتغيّر مع الوقت: دافي بالنهار، أزرق بالليل، رمادي في المطر
  const grading = (night, rain, t) => {
    const u = grade.uniforms;
    u.uTime.value = t % 100;
    u.uGain.value.set(1.03 - night * 0.08 - rain * 0.03, 1.0 - night * 0.03, 0.97 + night * 0.08 + rain * 0.02);
    u.uLift.value.set(0.0, night * 0.003, 0.004 + night * 0.012);
    u.uSat.value = 1.06 - rain * 0.25 - night * 0.12;
    u.uVignette.value = 0.32 + night * 0.12;
    bloom.strength = 0.3 + night * 0.55;
  };
  return { composer, gtao, bloom, grading };
}
