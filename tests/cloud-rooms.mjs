import { Miniflare } from 'miniflare';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const persistence=await fs.mkdtemp(path.join(os.tmpdir(),'better-cloud-'));
const source=await fs.readFile(new URL('../cloud/worker.js',import.meta.url),'utf8');
const options={resourcePersistencePath:persistence,workers:[{config:{name:'better-design',compatibilityDate:'2026-10-28',manifest:{mainModule:'worker.js',modules:{'worker.js':{type:'esm',contents:source}}},env:{ROOM_CREATION:{type:'rate-limit',namespace:'1001',simple:{limit:10,period:60}},ROOMS:{type:'durable-object',worker:'better-design',exportName:'DesignRoom'}},exports:{DesignRoom:{type:'durable-object',storage:'sqlite'}}}}]};
let mf=new Miniflare(options);
const request=(route,method='GET',data,token)=>mf.dispatchFetch('http://local'+route,{method,headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},...(data?{body:JSON.stringify(data)}:{})});
try{
 let response=await request('/api/rooms','POST',{document:{nodes:[{id:'a',text:'First'}]}});assert.equal(response.status,201);const room=await response.json(),url='/api/rooms/'+room.id;
 assert.equal((await request(url)).status,401);assert.equal((await request(url,'GET',null,'a'.repeat(64))).status,401);
 response=await request(url,'PUT',{document:{nodes:[{id:'b'}]},baseRevision:0},room.token);assert.equal(response.status,200);assert.equal((await response.json()).revision,1);
 assert.equal((await request(url,'PUT',{document:{nodes:[]},baseRevision:0},room.token)).status,409);
 const upgrade=await mf.dispatchFetch('http://local'+url+'/socket?token='+room.token,{headers:{Upgrade:'websocket'}});assert.equal(upgrade.status,101);const socket=upgrade.webSocket;const messages=[];socket.addEventListener('message',event=>messages.push(JSON.parse(event.data)));socket.accept();
 const next=(type,predicate=()=>true)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Missing '+type)),4000);const listener=e=>{const value=JSON.parse(e.data);if(value.type===type&&predicate(value)){clearTimeout(timer);socket.removeEventListener('message',listener);resolve(value)}};socket.addEventListener('message',listener)});
 const presence=next('presence',v=>v.peers.some(p=>p.name==='Alice'));socket.send(JSON.stringify({type:'presence',name:'Alice',cursor:{x:10,y:20}}));assert.equal((await presence).peers.some(p=>p.name==='Alice'),true);
 const changed=next('snapshot',v=>v.revision===2);socket.send(JSON.stringify({type:'update',baseRevision:1,document:{nodes:[{id:'c'}]}}));assert.equal((await changed).revision,2);
 const publication=await (await request(url+'/publish','POST',null,room.token)).json();const publicURL='/api/public/'+publication.publicId;
 assert.equal((await request(publicURL)).status,200);await request(url,'PUT',{document:{nodes:[{id:'d'}]},baseRevision:2},room.token);assert.equal((await (await request(publicURL)).json()).revision,2);
 socket.close();await mf.dispose();mf=new Miniflare(options);
 assert.equal((await (await request(url,'GET',null,room.token)).json()).revision,3);assert.equal((await request(publicURL)).status,200);
 assert.equal((await request(url+'/publish','DELETE',null,room.token)).status,200);assert.equal((await request(publicURL)).status,404);
 const other=await (await request('/api/rooms','POST',{document:{nodes:[]}})).json();assert.equal((await request('/api/rooms/'+other.id,'GET',null,room.token)).status,401);
 let limited=false;for(let i=0;i<12;i++){const response=await request('/api/rooms','POST',{document:{nodes:[]}});if(response.status===429){limited=true;break}}assert.equal(limited,true);
 console.log('PASS cloud authentication, isolated rooms, conflict detection, WebSocket presence/update, frozen publication, restart persistence, unpublish, creation rate limit');
}finally{await mf.dispose();await fs.rm(persistence,{recursive:true,force:true})}
