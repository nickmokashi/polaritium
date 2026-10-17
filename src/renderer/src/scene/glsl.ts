// Shared shader code. Every visual in Polaritium reads its brightness, motion and colour from
// numbers the simulation produced; these helpers only turn those numbers into light.

export const NOISE = /* glsl */ `
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0);const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy));vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz);vec3 l=1.0-g;vec3 i1=min(g.xyz,l.zxy);vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx;vec3 x2=x0-i2+C.yyy;vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857;vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z);vec4 x_=floor(j*ns.z);vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy;vec4 y=y_*ns.x+ns.yyyy;vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy);vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0;vec4 s1=floor(b1)*2.0+1.0;vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x);vec3 p1=vec3(a0.zw,h.y);vec3 p2=vec3(a1.xy,h.z);vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
float hash11(float p){p=fract(p*0.1031);p*=p+33.33;p*=p+p;return fract(p);}
`

/** Lighting from the brightest emitters in the simulation (up to 6), plus a cool sky fill. */
export const LIGHTS = /* glsl */ `
uniform vec4 uLights[6];
uniform int uLightCount;
vec3 litBy(vec3 pos, vec3 n, vec3 v, float shininess, float spec){
  vec3 acc = vec3(0.035,0.037,0.045) * (0.5 + 0.5*n.y);
  for(int i=0;i<6;i++){
    if(i>=uLightCount) break;
    vec3 L = uLights[i].xyz - pos;
    float d = length(L);
    L /= max(d,1e-3);
    float fall = uLights[i].w / (1.0 + d*d*0.012);
    float dif = max(dot(n,L),0.0);
    vec3 h = normalize(L+v);
    float sp = pow(max(dot(n,h),0.0), shininess) * spec;
    acc += vec3(1.0,0.985,0.96) * (dif*0.9 + sp) * fall;
  }
  return acc;
}
// Mirror glints: polished surfaces show a sharp image of each simulated emitter. Only drawn
// when the Reflections graphics setting is on (High and Ultra).
uniform float uReflect;
vec3 glints(vec3 pos, vec3 n, vec3 v){
  if (uReflect < 0.5) return vec3(0.0);
  vec3 r = reflect(-v, n);
  vec3 acc = vec3(0.0);
  for(int i=0;i<6;i++){
    if(i>=uLightCount) break;
    vec3 L = uLights[i].xyz - pos;
    float d = length(L);
    L /= max(d,1e-3);
    float fall = uLights[i].w / (1.0 + d*d*0.006);
    acc += vec3(1.0,0.99,0.97) * pow(max(dot(r,L),0.0), 700.0) * fall * 3.0;
  }
  return acc;
}
`

export const FOG = /* glsl */ `
uniform vec3 uFogColor;
uniform float uFogDensity;
vec3 applyFog(vec3 c, float dist){
  float f = 1.0 - exp(-uFogDensity*uFogDensity*dist*dist);
  return mix(c, uFogColor, clamp(f,0.0,1.0));
}
`
