(() => {
 const dialog=document.createElement('dialog');dialog.id='text-prompt';dialog.innerHTML='<form method="dialog"><label id="text-prompt-label" for="text-prompt-input"></label><input id="text-prompt-input" autocomplete="off"><div><button value="cancel">Cancel</button><button value="ok" id="text-prompt-ok">Continue</button></div></form>';
 document.body.append(dialog);
 window.askText=(title,value='')=>new Promise(resolve=>{
  if(dialog.open){resolve(null);return;}
  document.getElementById('text-prompt-label').textContent=title;
  const input=document.getElementById('text-prompt-input');input.value=value;dialog.returnValue='cancel';
  dialog.addEventListener('close',()=>resolve(dialog.returnValue==='ok'?input.value:null),{once:true});
  dialog.showModal();input.focus();input.select();
 });
})();
