# Maintenance utilities

- `cleanup-live-tree.sh` quarantines unexpected root-level files instead of deleting uncertain data.
- `export-online-ai-usage-24h.sh` rebuilds the private rolling 24-hour online-AI usage log from the service journal.
- `opencli-blank-tabs/` fixes Browser Bridge placeholder leaks and installs a five-minute browser cleanup alarm; see its README for reinstallation after extension updates.

The usage exporter is installed at `/home/ubuntu/script/export-online-ai-usage-24h.sh`. Cron refreshes `/home/ubuntu/script/logs/online-ai-usage-last-24h.log` every five minutes. The log is private to the instance and is not copied to the public GitHub repository.

`check-gemini-model.mjs` performs a small live generation request without printing API keys. To test only the seventh configured key with Gemini 3.7:

```bash
node ops/maintenance/check-gemini-model.mjs --model gemini-3.8-flash --key-index 7
```
