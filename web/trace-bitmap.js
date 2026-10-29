(()=>{
 async function traceBitmap(source,detail=96){
  if(!/^data:image\/(png|jpeg|webp|gif);/i.test(source))throw Error('Select a PNG, JPEG, WebP or GIF layer');
  const image=new Image();await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(Error('Unable to decode bitmap'));image.src=source;});
  const scale=Math.min(1,Math.max(16,Math.min(128,detail))/Math.max(image.width,image.height));
  const width=Math.max(1,Math.round(image.width*scale)),height=Math.max(1,Math.round(image.height*scale));
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(image,0,0,width,height);
  const pixels=context.getImageData(0,0,width,height).data,paths=new Map();
  function color(x,y){const i=(y*width+x)*4;if(pixels[i+3]<64)return null;return '#'+[0,1,2].map(offset=>Math.min(255,Math.round(pixels[i+offset]/32)*32).toString(16).padStart(2,'0')).join('');}
  for(let y=0;y<height;y++){let x=0;while(x<width){const fill=color(x,y),start=x;while(x<width&&color(x,y)===fill)x++;if(fill)paths.set(fill,(paths.get(fill)||'')+`M${start} ${y}h${x-start}v1H${start}z`);}}
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${image.width}" height="${image.height}" shape-rendering="crispEdges">${[...paths].map(([fill,d])=>`<path fill="${fill}" d="${d}"/>`).join('')}</svg>`;
 }
 window.traceBitmap=traceBitmap;
 const button=document.createElement('button');button.id='trace-bitmap';button.textContent='Trace selected bitmap';button.style.width='100%';button.style.marginTop='8px';document.getElementById('figma-import').after(button);
 button.onclick=async()=>{try{const id=document.querySelector('#canvas .layer.selected')?.dataset.id,doc=window.design.getDocument(),node=doc.pages.find(p=>p.id===doc.activePage).nodes.find(n=>n.id===id);if(!node||node.type!=='image')throw Error('Select a bitmap image layer first');const svg=await traceBitmap(node.src);node.src='data:image/svg+xml;base64,'+btoa(svg);node.name+=' · traced';window.design.setDocument(doc);}catch(e){alert(e.message)}};
})();
