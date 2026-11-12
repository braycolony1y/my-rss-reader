// Consume stream-json's unpacked value tokens and packed object keys. Escaping
// each string fragment also preserves lone surrogates and split surrogate pairs.
export function createTokenWriter(append) {
    const stack=[];
    const before=()=>{const current=stack.at(-1);if(current?.type==='array'){append(current.first?'':',');current.first=false;}};
    return token=>{
        switch(token.name){
            case 'startObject':before();append('{');stack.push({type:'object',first:true});break;
            case 'startArray':before();append('[');stack.push({type:'array',first:true});break;
            case 'endObject':append('}');stack.pop();break;
            case 'endArray':append(']');stack.pop();break;
            case 'keyValue':{const current=stack.at(-1);append((current.first?'':',')+JSON.stringify(token.value)+':');current.first=false;break;}
            case 'startString':before();append('"');break;
            case 'stringChunk':append(JSON.stringify(token.value).slice(1,-1));break;
            case 'endString':append('"');break;
            case 'startNumber':before();break;
            case 'numberChunk':append(token.value);break;
            case 'trueValue':before();append('true');break;
            case 'falseValue':before();append('false');break;
            case 'nullValue':before();append('null');break;
        }
    };
}
