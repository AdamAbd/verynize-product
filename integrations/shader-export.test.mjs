import test from 'node:test';
import assert from 'node:assert/strict';
import {validateDocument} from './design-store.mjs';
import {exportHTML} from './export-html.mjs';
const design=()=>({version:2,name:'Shader',tokens:{brand:'#aa77dd'},pages:[{id:'page',name:'Page',nodes:[{id:'shader',type:'shader',name:'Shader',x:0,y:0,w:300,h:200,color:'#aa77dd',token:'brand',shaderPreset:'waves',shaderSpeed:0.5,shaderIntensity:1.4}]}]});
test('shader preset and uniforms validated before persistence or export',()=>{
 for(const properties of [{shaderPreset:'custom-code'},{shaderSpeed:Infinity},{shaderSpeed:-1},{shaderSpeed:6},{shaderIntensity:3}]){const d=design();Object.assign(d.pages[0].nodes[0],properties);assert.throws(()=>validateDocument(d),/shader/);}
 assert.equal(validateDocument(design()).pages[0].nodes[0].shaderPreset,'waves');
});
test('shader export embeds application runtime once and keeps node content inert',()=>{
 const d=design();d.pages[0].nodes[0].name='</script><script>globalThis.injected=true</script>';
 d.pages[0].nodes.push({...d.pages[0].nodes[0],id:'second',shaderPreset:'noise'});
 const html=exportHTML(d);
 assert.equal((html.match(/<script>/g)||[]).length,1);
 assert.match(html,/data-shader-preset="waves"/);assert.match(html,/data-shader-speed="0.5"/);assert.match(html,/data-shader-intensity="1.4"/);assert.match(html,/data-shader-color="#aa77dd"/);assert.match(html,/BetterShaders.startAll/);
 assert.match(html,/&lt;\/script&gt;/);assert.doesNotMatch(html,/<script>globalThis.injected/);
});
