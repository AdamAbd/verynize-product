#!/usr/bin/env node
import { DesignStore } from './design-store.mjs';
import { exportHTML } from './export-html.mjs';
const usage=`Better Design command interface
Usage: design-cli.mjs --root DIRECTORY COMMAND [ARGS]
  list                              List document names
  read NAME                         Read document and revision
  create NAME TITLE                 Create an empty document
  apply NAME REVISION               Read operations JSON array from stdin and atomically apply
  export NAME [PAGE_ID]              Export standalone HTML to stdout

Documents are NAME.better-design.json inside the existing root directory.
Errors use stderr and exit code 1. No commands execute code or contact a network.`;
async function stdin(){let bytes=0,text='';for await(const chunk of process.stdin){bytes+=chunk.length;if(bytes>20*1024*1024)throw Error('Input exceeds 20 MiB');text+=chunk;}return JSON.parse(text);}
try {
 const args=process.argv.slice(2);
 if(args.includes('--help')){console.log(usage);process.exit(0);}
 const index=args.indexOf('--root');if(index<0||!args[index+1])throw Error(usage);
 const root=args.splice(index,2)[1], [command,name,...rest]=args;
 const store=await DesignStore.open(root);let output;
 switch(command){
  case 'list':if(name)throw Error('list takes no arguments');output=await store.list();break;
  case 'read':output=await store.read(name);break;
  case 'create':output=await store.create(name,rest.join(' '));break;
  case 'apply':if(rest.length!==1)throw Error('apply requires the revision returned by read');output=await store.update(name,rest[0],await stdin());break;
  case 'export':{const {document}=await store.read(name);process.stdout.write(exportHTML(document,rest[0])+'\n');process.exit(0);}
  default:throw Error(usage);
 }
 process.stdout.write(JSON.stringify(output,null,2)+'\n');
}catch(error){console.error(error.message);process.exitCode=1;}
