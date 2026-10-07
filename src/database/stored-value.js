// Large serialized values are UTF-8 bytes in the database owner. Public reads
// and the durable JSON format remain strings; parsed cache identity stays stable.
const THRESHOLD = 256 * 1024;
class StoredJson {
    #bytes;
    constructor(text) { this.#bytes = Buffer.from(text, 'utf8'); this.length = text.length; Object.freeze(this); }
    toJSON() { return this.#bytes.toString('utf8'); }
    equals(other) { return other instanceof StoredJson && this.#bytes.equals(other.#bytes); }
    get byteLength() { return this.#bytes.length; }
}
export const isStoredJson = value => value instanceof StoredJson;
export const isSerializedValue = value => typeof value === 'string' || isStoredJson(value);
export const encodeStoredValue = value => typeof value === 'string' && value.length >= THRESHOLD && value.isWellFormed() ? new StoredJson(value) : value;
export const decodeStoredValue = value => isStoredJson(value) ? value.toJSON() : value;
export const sameStoredValue = (left, right) => isSerializedValue(left) && isSerializedValue(right)
    && (left === right || (isStoredJson(left) && left.equals(right)));
export function encodeStoredSnapshot(snapshot) {
    return Object.fromEntries(Object.entries(snapshot).map(([key,value])=>[key,encodeStoredValue(value)]));
}
export const storedByteLength = value => isStoredJson(value) ? value.byteLength : typeof value === 'string' ? Buffer.byteLength(value) : 0;
export function storedSnapshotState(snapshot) {
    const entries = Object.entries(snapshot || {});
    return {
        entries: entries.length,
        bufferedEntries: entries.filter(([,value])=>isStoredJson(value)).length,
        utf8Bytes: entries.reduce((sum,[,value])=>sum+storedByteLength(value),0),
        unbufferedStringChars: entries.reduce((sum,[,value])=>sum+(typeof value==='string'?value.length:0),0)
    };
}
