import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

test('pinned publications do not retain superseded personal decision graphs', {timeout:30000}, async () => {
    const env={...process.env}; delete env.NODE_TEST_CONTEXT;
    const {stdout} = await promisify(execFile)(process.execPath,['--expose-gc',new URL('../tools/experiments/performance-audit/publication-retainers.mjs',import.meta.url).pathname],{env,timeout:25000,maxBuffer:1024*1024});
    const cycles=stdout.split('\n').filter(line=>line.startsWith('{"cycle"')).map(line=>JSON.parse(line));
    assert.equal(cycles.length,5);
    assert.ok(cycles.every(row=>row.retainedGenerations===1),JSON.stringify(cycles));
});
