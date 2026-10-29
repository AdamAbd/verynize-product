/* Independently authored shader presets. Never evaluates user-supplied source. */
(function installBetterShaders(global) {
  'use strict';
  function createShaderLibrary() {
    const vertex = 'attribute vec2 a_position;void main(){gl_Position=vec4(a_position,0.0,1.0);}';
    const fragment = `precision mediump float;
uniform vec2 u_resolution;uniform float u_time;uniform float u_intensity;uniform vec3 u_color;uniform int u_preset;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y);}
void main(){vec2 uv=gl_FragCoord.xy/u_resolution;float t=u_time;float field;
if(u_preset==0){field=.5+.5*sin(uv.x*7.+sin(uv.y*5.+t)*1.7+t*.7);field=mix(field,noise(uv*4.+vec2(t*.14,0.)),.35);}
else if(u_preset==1){float wave=sin(uv.x*12.+t*1.4)+sin(uv.y*9.-t*.8);field=.5+.25*wave;}
else if(u_preset==2){field=noise(uv*5.+vec2(t*.18,t*.1))*.65+noise(uv*13.-t*.11)*.35;}
else if(u_preset==3){field=pow(.5+.5*sin(uv.x*18.+sin(uv.y*6.+t)*5.),3.);}
else if(u_preset==4){field=.5+.25*sin(uv.x*6.+t+sin(uv.y*5.))+.25*cos(uv.y*7.-t*.7);}
else{vec2 p=uv-.5;field=.5+.5*sin(atan(p.y,p.x)*4.+length(p)*18.-t);}
vec3 secondary=clamp(vec3(u_color.b*.8+.2,u_color.r*.6+.25,u_color.g*.8+.15),0.,1.);
vec3 base=mix(u_color,secondary,clamp(field*u_intensity,0.,1.));float glow=.65+.45*field*u_intensity;
gl_FragColor=vec4(clamp(base*glow+vec3(.06)*(1.-uv.y),0.,1.),1.);}`;
    const active = new WeakMap();
    function mount(element, params = {}) {
      active.get(element)?.();
      const canvas = document.createElement('canvas');
      canvas.className = 'shader-surface';
      canvas.setAttribute('aria-label', 'Animated WebGL ' + (params.preset || element.dataset.shaderPreset || 'aurora') + ' shader');
      canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border-radius:inherit;pointer-events:none;';
      element.append(canvas);
      let gl,program,buffer,frame=0,closed=false,observer;
      const shaders=[];
      function fallback(message) {
        element.dataset.shaderStatus='unavailable';
        canvas.remove();
        const label=document.createElement('span');label.className='shader-fallback';label.textContent=message;
        label.style.cssText='position:absolute;inset:8px;font:11px system-ui;color:inherit;pointer-events:none;';element.append(label);
        return ()=>label.remove();
      }
      try { gl=canvas.getContext('webgl',{alpha:false,antialias:false,preserveDrawingBuffer:true,powerPreference:'low-power'}); } catch {}
      if(!gl){const close=fallback('WebGL unavailable · solid color fallback');active.set(element,close);return close;}
      try {
        const compile=(type,source)=>{const shader=gl.createShader(type);gl.shaderSource(shader,source);gl.compileShader(shader);shaders.push(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw Error('Shader compilation unavailable');return shader;};
        program=gl.createProgram();gl.attachShader(program,compile(gl.VERTEX_SHADER,vertex));gl.attachShader(program,compile(gl.FRAGMENT_SHADER,fragment));gl.linkProgram(program);
        if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error('Shader linking unavailable');
        gl.useProgram(program);buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
        const position=gl.getAttribLocation(program,'a_position');gl.enableVertexAttribArray(position);gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
        const resolution=gl.getUniformLocation(program,'u_resolution'),time=gl.getUniformLocation(program,'u_time'),intensity=gl.getUniformLocation(program,'u_intensity'),colorUniform=gl.getUniformLocation(program,'u_color'),presetUniform=gl.getUniformLocation(program,'u_preset');
        const clamp=(value,min,max,fallback)=>Number.isFinite(Number(value))?Math.min(max,Math.max(min,Number(value))):fallback;
        const speed=clamp(params.speed??element.dataset.shaderSpeed,0,5,1),strength=clamp(params.intensity??element.dataset.shaderIntensity,0,2,1);
        const color=/^#[0-9a-f]{6}$/i.test(params.color||element.dataset.shaderColor||'')?(params.color||element.dataset.shaderColor):'#a58bdd';
        const preset=params.preset||element.dataset.shaderPreset||'aurora';
        gl.uniform1i(presetUniform,Math.max(0,['aurora','waves','noise','ribbon','mesh','swirl'].indexOf(preset)));gl.uniform1f(intensity,strength);gl.uniform3f(colorUniform,parseInt(color.slice(1,3),16)/255,parseInt(color.slice(3,5),16)/255,parseInt(color.slice(5,7),16)/255);
        const reduced=globalThis.appPreferences?.get?.().reduceMotion===true||(typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches);
        const start=performance.now();
        function draw(now){if(closed)return;const width=Math.max(1,Math.min(1600,Math.round(element.clientWidth*Math.min(devicePixelRatio||1,2)))),height=Math.max(1,Math.min(1200,Math.round(element.clientHeight*Math.min(devicePixelRatio||1,2))));if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height}gl.viewport(0,0,width,height);gl.uniform2f(resolution,width,height);gl.uniform1f(time,reduced?0:(now-start)*.001*speed);gl.drawArrays(gl.TRIANGLES,0,6);element.dataset.shaderStatus='ready';if(!reduced&&speed>0)frame=requestAnimationFrame(draw)}
        draw(start);
        if(typeof ResizeObserver==='function'){observer=new ResizeObserver(()=>{if(reduced||speed===0)draw(performance.now())});observer.observe(element)}
        let clearLost;const lost=event=>{event.preventDefault();cancelAnimationFrame(frame);clearLost=fallback('WebGL context lost · solid color fallback');};canvas.addEventListener('webglcontextlost',lost);
        const close=()=>{if(closed)return;closed=true;cancelAnimationFrame(frame);clearLost?.();observer?.disconnect();canvas.removeEventListener('webglcontextlost',lost);gl.deleteBuffer(buffer);gl.deleteProgram(program);shaders.forEach(s=>gl.deleteShader(s));gl.getExtension('WEBGL_lose_context')?.loseContext();canvas.remove();active.delete(element)};
        active.set(element,close);return close;
      } catch {
        if(buffer)gl.deleteBuffer(buffer);if(program)gl.deleteProgram(program);shaders.forEach(s=>gl.deleteShader(s));gl.getExtension('WEBGL_lose_context')?.loseContext();const close=fallback('WebGL shader unavailable · solid color fallback');active.set(element,close);return close;
      }
    }
    function startAll(root=document){return Array.from(root.querySelectorAll('[data-shader-preset]'),element=>mount(element))}
    return {mount,startAll};
  }
  global.BetterShaders={...createShaderLibrary(),runtimeSource:()=>`(${createShaderLibrary.toString()})().startAll();`};
})(globalThis);
