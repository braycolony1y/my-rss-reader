import {readFile} from 'node:fs/promises';
const heap=JSON.parse(await readFile(process.argv[2],'utf8'));
const {nodes,edges,strings}=heap, nf=heap.snapshot.meta.node_fields,ef=heap.snapshot.meta.edge_fields;
const nw=nf.length,ew=ef.length,edgeTypes=heap.snapshot.meta.edge_types[0];
let edgeOffset=0;const owners=[];
for(let offset=0;offset<nodes.length;offset+=nw) {
    const count=nodes[offset+nf.indexOf('edge_count')], properties={};
    for(let j=0;j<count;j++) {
        const e=edgeOffset+j*ew;
        if(edgeTypes[edges[e]]==='property')properties[strings[edges[e+1]]]=edges[e+2];
    }
    if('personalOn' in properties&&'systemOn' in properties&&'state' in properties) {
        const target=properties.state;
        owners.push({ownerId:nodes[offset+nf.indexOf('id')],stateId:nodes[target+nf.indexOf('id')],stateType:strings[nodes[target+nf.indexOf('name')]],stateEdge:'property (strong)'});
    }
    edgeOffset+=count*ew;
}
console.log(JSON.stringify({snapshot:process.argv[2],publicationCacheEntries:owners},null,2));
