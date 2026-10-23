import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {repairBundle,checkRepair,applyRepair,rollbackRepair,verifyRepair} from '../ops/maintenance/reader-modal-bundle.mjs';

async function originalTree() {
    const root=await fs.mkdtemp(path.join(os.tmpdir(),'reader-modal-integration-'));
    for(const entry of repairBundle.files) if(entry.before!==null) {
        const file=path.join(root,entry.path);
        await fs.mkdir(path.dirname(file),{recursive:true});
        await fs.writeFile(file,entry.before);
    }
    await fs.writeFile(path.join(root,'database.json'),'application data sentinel');
    return root;
}

test('repair preflights all hashes, backs up files, applies idempotently and rolls back without touching data',async()=>{
    const root=await originalTree();
    try {
        assert.ok((await checkRepair(root)).entries.every(entry=>entry.state==='pending'));
        const result=await applyRepair(root);
        assert.equal(result.files,repairBundle.files.length);
        assert.ok((await checkRepair(root)).entries.every(entry=>entry.state==='applied'));
        assert.equal((await applyRepair(root)).alreadyApplied,true);
        await rollbackRepair(result.backup);
        assert.ok((await checkRepair(root)).entries.every(entry=>entry.state==='pending'));
        assert.equal(await fs.readFile(path.join(root,'database.json'),'utf8'),'application data sentinel');
    } finally { await fs.rm(root,{recursive:true,force:true}); }
});

test('unknown production edits refuse the entire repair before any writes',async()=>{
    const root=await originalTree();
    try {
        const entry=repairBundle.files.find(entry=>entry.before!==null);
        await fs.writeFile(path.join(root,entry.path),'unknown local repair');
        await assert.rejects(applyRepair(root),/Unrecognized local edits/);
        for(const other of repairBundle.files.filter(other=>other.before===null)) {
            await assert.rejects(fs.stat(path.join(root,other.path)),{code:'ENOENT'});
        }
    } finally { await fs.rm(root,{recursive:true,force:true}); }
});

test('rollback refuses later edits and corrupted backups without partial restoration',async()=>{
    const root=await originalTree();
    try {
        const result=await applyRepair(root);
        const entry=repairBundle.files.find(entry=>entry.before!==null);
        await fs.writeFile(path.join(root,entry.path),'later repair');
        await assert.rejects(rollbackRepair(result.backup),/Later edits/);
        await fs.writeFile(path.join(root,entry.path),entry.after);
        await fs.writeFile(path.join(result.backup,entry.path),'corrupt backup');
        await assert.rejects(rollbackRepair(result.backup),/Backup integrity/);
        assert.ok((await checkRepair(root)).entries.every(entry=>entry.state==='applied'));
    } finally { await fs.rm(root,{recursive:true,force:true}); }
});

test('repair refuses symlink targets',async()=>{
    const root=await originalTree();
    try {
        const entry=repairBundle.files.find(entry=>entry.before!==null);
        const file=path.join(root,entry.path);
        await fs.unlink(file);
        await fs.symlink(path.join(root,'database.json'),file);
        await assert.rejects(checkRepair(root),/Refusing symlink/);
        assert.equal(await fs.readFile(path.join(root,'database.json'),'utf8'),'application data sentinel');
    } finally { await fs.rm(root,{recursive:true,force:true}); }
});

test('verification refuses subprocess errors and missing test results even with a zero status',async()=>{
    const root=await originalTree();
    try {
        await applyRepair(root);
        const blocked={status:0,error:new Error('spawn denied'),stdout:'',stderr:''};
        await assert.rejects(verifyRepair(root,{run:()=>blocked}),/Syntax check failed.*spawn denied/);
        const syntax={status:0,stdout:'',stderr:''};
        await assert.rejects(verifyRepair(root,{run:(_command,args)=>args.includes('--test')?blocked:syntax}),/Regression verification failed.*spawn denied/);
        await assert.rejects(verifyRepair(root,{run:()=>syntax}),/Regression verification failed/);
    } finally { await fs.rm(root,{recursive:true,force:true}); }
});
