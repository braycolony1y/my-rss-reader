#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

readonly LIVE_DIR="${RSS_READER_DIR:-/home/ubuntu/my-rss-reader}"
readonly SCRIPT_HOME="/home/ubuntu/script"
readonly STAGING_DIR="${SCRIPT_HOME}/github-backup-my-rss-reader"
readonly LOG_DIR="${SCRIPT_HOME}/logs"
readonly LOG_FILE="${LOG_DIR}/my-rss-reader-backup.log"
readonly LOCK_FILE="${SCRIPT_HOME}/my-rss-reader-backup.lock"
readonly REMOTE_URL="git@github.com:braycolony1y/my-rss-reader.git"
readonly BRANCH="main"

mkdir -p "${SCRIPT_HOME}" "${LOG_DIR}"
touch "${LOG_FILE}"
chmod 0600 "${LOG_FILE}"

exec 9>"${LOCK_FILE}"
if ! flock -n 9; then
    printf '[%s] SKIP: another backup is already running\n' "$(TZ=Asia/Ho_Chi_Minh date '+%Y-%m-%d %H:%M:%S %Z')" >> "${LOG_FILE}"
    exit 0
fi

if [[ $(stat -c '%s' "${LOG_FILE}") -gt 5242880 ]]; then
    mv -f "${LOG_FILE}" "${LOG_FILE}.1"
    touch "${LOG_FILE}"
    chmod 0600 "${LOG_FILE}"
fi

exec > >(tee -a "${LOG_FILE}") 2>&1

log() {
    printf '[%s] %s\n' "$(TZ=Asia/Ho_Chi_Minh date '+%Y-%m-%d %H:%M:%S %Z')" "$*"
}

on_exit() {
    local status=$?
    if [[ ${status} -eq 0 ]]; then
        log 'SUCCESS: website backup completed'
    else
        log "ERROR: website backup failed with status ${status}"
    fi
}
trap on_exit EXIT

if [[ "$(realpath -m "${LIVE_DIR}")" != "/home/ubuntu/my-rss-reader" ]]; then
    log "Refusing unexpected live directory: ${LIVE_DIR}"
    exit 2
fi
if [[ ! -f "${LIVE_DIR}/server.js" || ! -f "${LIVE_DIR}/index.html" ]]; then
    log 'Live website entry points are missing'
    exit 2
fi

log 'Starting sanitized GitHub backup'

if [[ ! -d "${STAGING_DIR}/.git" ]]; then
    if [[ -e "${STAGING_DIR}" ]]; then
        log "Refusing non-repository staging path: ${STAGING_DIR}"
        exit 2
    fi
    git clone --quiet --branch "${BRANCH}" "${REMOTE_URL}" "${STAGING_DIR}"
else
    configured_remote=$(git -C "${STAGING_DIR}" remote get-url origin)
    if [[ "${configured_remote}" != "${REMOTE_URL}" ]]; then
        log "Refusing staging repository with unexpected remote: ${configured_remote}"
        exit 2
    fi
    git -C "${STAGING_DIR}" fetch --quiet origin "${BRANCH}"
    git -C "${STAGING_DIR}" checkout --quiet "${BRANCH}"
    git -C "${STAGING_DIR}" pull --quiet --ff-only origin "${BRANCH}"
fi

# The staging clone is script-owned. Rebuild its tracked snapshot from an
# explicit allowlist so secrets, databases, caches, and scratch files can never
# enter the public repository.
git -C "${STAGING_DIR}" rm -r -q --ignore-unmatch -- .

root_files=(
    .gitignore
    README.md
    article-media.js
    feed-parsers.js
    feed-worker.js
    index.html
    package-lock.json
    package.json
    script.js
    server.js
    smart-cluster-worker.js
    smart-embedding-worker.js
    smart-hnsw-clustering.js
    smart-news.js
    smart-sources.js
    summary-engine.js
    tailwind.config.js
)

for relative_path in "${root_files[@]}"; do
    if [[ -f "${LIVE_DIR}/${relative_path}" ]]; then
        install -D -m 0644 "${LIVE_DIR}/${relative_path}" "${STAGING_DIR}/${relative_path}"
    fi
done

for directory in .agents docs ops public src test tools; do
    if [[ -d "${LIVE_DIR}/${directory}" ]]; then
        mkdir -p "${STAGING_DIR}/${directory}"
        rsync -a --delete "${LIVE_DIR}/${directory}/" "${STAGING_DIR}/${directory}/"
    fi
done

# Preserve the exact script cron executed, even if the installed copy was
# updated before its canonical repository copy.
install -D -m 0755 "$0" "${STAGING_DIR}/ops/backup/backup-my-rss-reader.sh"

mkdir -p "${STAGING_DIR}/ops/systemd" "${STAGING_DIR}/ops/backup/logs"
systemctl cat rss-reader.service --no-pager > "${STAGING_DIR}/ops/systemd/rss-reader.service.snapshot"
systemctl show rss-reader.service \
    --property=FragmentPath,DropInPaths,LoadState,ActiveState,SubState,User,Group,WorkingDirectory,ExecStart \
    --no-pager > "${STAGING_DIR}/ops/systemd/rss-reader.service.status"

log 'Source and systemd snapshots prepared'
install -m 0644 "${LOG_FILE}" "${STAGING_DIR}/ops/backup/logs/my-rss-reader-backup.log"

for forbidden_path in \
    .env gemini.env gemini-keys.txt qwen-keys.txt database.json smart-data.json \
    feeds_backup.json smart-embeddings-worker.json node_modules article_cache db_backups old_db; do
    if [[ -e "${STAGING_DIR}/${forbidden_path}" ]]; then
        log "Safety check failed; forbidden public-backup path exists: ${forbidden_path}"
        exit 3
    fi
done

git -C "${STAGING_DIR}" add -A
git -C "${STAGING_DIR}" add -f ops/backup/logs/my-rss-reader-backup.log

if git -C "${STAGING_DIR}" diff --cached --quiet; then
    log 'No source or configuration changes to commit'
else
    backup_stamp=$(TZ=Asia/Ho_Chi_Minh date '+%Y-%m-%d %H:%M:%S %Z')
    git -C "${STAGING_DIR}" -c user.name='RSS Backup Bot' -c user.email='rss-backup@localhost' \
        commit --quiet -m "backup: ${backup_stamp}"
    log "Created backup commit: $(git -C "${STAGING_DIR}" rev-parse --short HEAD)"
fi

git -C "${STAGING_DIR}" push --quiet origin "${BRANCH}"
log 'Pushed sanitized snapshot to GitHub main'
