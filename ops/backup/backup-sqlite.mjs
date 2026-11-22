// Database backups are private local artifacts. The public source-code backup
// deliberately excludes database_state/, which contains all SQLite artifacts.
process.argv.splice(2,0,'backup');
await import('../maintenance/sqlite-storage.mjs');
