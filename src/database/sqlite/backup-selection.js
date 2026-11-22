import fs from 'node:fs/promises';
import path from 'node:path';

export async function hasRecentBackup(root,now=Date.now()){
    const directory=path.join(root,'database_state','sqlite-backups');
    const names=await fs.readdir(directory).catch(()=>[]);
    for(const name of names.filter(name=>/^reader-.*\.sqlite\.manifest\.json$/.test(name)).sort().reverse()){
        try{
            const manifest=JSON.parse(await fs.readFile(path.join(directory,name),'utf8'));
            if(!Number.isFinite(manifest.createdAt)||manifest.createdAt>now||now-manifest.createdAt>=6*60*60*1000||!/^[a-f0-9]{64}$/.test(manifest.sha256))continue;
            await fs.access(path.join(directory,name.replace(/\.manifest\.json$/,'')));return true;
        }catch{ /* A partial or missing backup is never a recovery point. */ }
    }
    return false;
}

// createdAt of the newest published backup (rolling, or the storage-upgrade
// recovery backup), or 0.
export async function latestBackupAt(root){
    let latest=0;
    const manifests=[];
    for(const [directory,pattern] of [[path.join(root,'database_state','sqlite-backups'),/^reader-.*\.sqlite\.manifest\.json$/],
        [path.join(root,'database_state'),/^before-backend-storage-v2\.sqlite(?:-[0-9]+\.sqlite)?\.manifest\.json$/]])
        for(const name of await fs.readdir(directory).catch(()=>[]))if(pattern.test(name))manifests.push(path.join(directory,name));
    for(const filename of manifests){
        try{
            const manifest=JSON.parse(await fs.readFile(filename,'utf8'));
            if(Number.isFinite(manifest.createdAt)&&/^[a-f0-9]{64}$/.test(manifest.sha256))latest=Math.max(latest,manifest.createdAt);
        }catch{ /* partial manifests are not recovery points */ }
    }
    return latest;
}
