(() => {
 let switching=Promise.resolve();
 window.documentLifecycle={
  prepareSwitch(options={}){
   const perform=async()=>{
    // Room listeners must be disconnected before any replacement document renders.
    window.dispatchEvent(new CustomEvent('document-will-change',{detail:options}));
    if(!options.preserveNative&&window.desktop?.designDetach)await window.desktop.designDetach();
   };
   switching=switching.then(perform,perform);return switching;
  }
 };
})();
