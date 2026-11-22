import {getPersonalStore} from '../smart/feedback/store.js';
import {filterPersonalView} from '../smart/feedback/pipeline.js';
import {personalEnabled, setPersonalState} from '../smart/feedback/terminal.js';

// Navigation owns immutable ranked arrays. Reuse only against the exact
// personal-state generation, including Undo; never retain old decision graphs.
export function createPersonalViewCache({store=getPersonalStore,filter=filterPersonalView}={}) {
    const databases=new WeakMap();
    return async (db,articles,section,stage)=>{
        if(!personalEnabled())return articles;
        const personal=await store(db),state=personal.state;
        setPersonalState(state);
        let inputs=databases.get(db);
        if(!inputs){inputs=new WeakMap();databases.set(db,inputs);}
        let entries=inputs.get(articles);
        if(!entries){entries=new Map();inputs.set(articles,entries);}
        const key=JSON.stringify([section,stage]),previous=entries.get(key);
        if(previous?.state.deref()===state)return previous.result;
        const result=await filter(db,articles,section,stage);
        if(personal.state===state){
            entries.set(key,{state:new WeakRef(state),result});
            if(entries.size>16)entries.delete(entries.keys().next().value);
        }
        return result;
    };
}
