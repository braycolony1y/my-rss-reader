// Explicit operations only; this script never restarts or deploys a service.
import {checkRepair,applyRepair,rollbackRepair,verifyRepair} from './reader-modal-bundle.mjs';
const [action='--check',directory]=process.argv.slice(2);
const actions={'--check':checkRepair,'--apply':applyRepair,'--rollback':rollbackRepair,'--verify':verifyRepair};
if(!directory||!actions[action])throw Error('Usage: node reader-modal-repair.mjs --check|--apply|--verify ROOT, or --rollback BACKUP');
const result=await actions[action](directory);
console.log(JSON.stringify(action==='--check'?{compatible:true,root:result.root,files:result.entries.map(e=>({path:e.path,state:e.state}))}:result,null,2));
