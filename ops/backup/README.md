# Daily GitHub backup

The installed job runs `/home/ubuntu/script/backup-my-rss-reader.sh` every day at 05:00 Vietnam time (22:00 UTC on this host).

The script builds a sanitized snapshot in `/home/ubuntu/script/github-backup-my-rss-reader`, commits it, and pushes it to `braycolony1y/my-rss-reader` on `main`.

Included:

- application source and static assets;
- maintained regression tests and documentation;
- the exact installed backup script and cron definition;
- the complete `rss-reader.service` unit and all drop-in overrides;
- the backup job's operational log.

Excluded because the GitHub repository is public:

- `.env`, `gemini.env`, Gemini and Qwen key files;
- RSS databases, embedding state, caches, and database backups;
- dependencies and temporary/debug files.

The local log is `/home/ubuntu/script/logs/my-rss-reader-backup.log`.
