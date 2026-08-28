#!/usr/bin/env bash
set -Eeuo pipefail

readonly LIVE_DIR="/home/ubuntu/my-rss-reader"
readonly MODE="${1:---dry-run}"
readonly QUARANTINE_DIR="${2:-/home/ubuntu/script/cleanup-archives/rss-reader-cleanup-$(date -u '+%Y%m%dT%H%M%SZ')}"

if [[ "$(realpath -m "${LIVE_DIR}")" != "/home/ubuntu/my-rss-reader" ]]; then
    printf 'Refusing unexpected live directory\n' >&2
    exit 2
fi
if [[ "${MODE}" != '--dry-run' && "${MODE}" != '--execute' ]]; then
    printf 'Usage: %s [--dry-run|--execute] [quarantine-directory]\n' "$0" >&2
    exit 2
fi
if [[ "$(realpath -m "${QUARANTINE_DIR}")" != /home/ubuntu/script/cleanup-archives/* ]]; then
    printf 'Refusing quarantine path outside /home/ubuntu/script/cleanup-archives\n' >&2
    exit 2
fi

is_kept_root_file() {
    case "$1" in
        .env|.gitignore|README.md|article-media.js|database.json|database.json.backup|database.writer.lock|feed-parsers.js|feed-worker.js|feeds_backup.json|feeds_backup.json.backup|gemini.env|gemini-keys.txt|index.html|package-lock.json|package.json|qwen-keys.txt|script.js|server.js|smart-cluster-worker.js|smart-data.json|smart-data.json.backup|smart-embedding-worker.js|smart-embeddings-worker.json|smart-hnsw-clustering.js|smart-news.js|smart-sources.js|summary-engine.js|tailwind.config.js)
            return 0
            ;;
        *)
            return 1
            ;;
    esac
}

move_candidate() {
    local source_path="$1"
    local relative_path="${source_path#${LIVE_DIR}/}"
    printf '%s\n' "${relative_path}"
    if [[ "${MODE}" == '--execute' ]]; then
        mkdir -p "${QUARANTINE_DIR}/$(dirname "${relative_path}")"
        mv -- "${source_path}" "${QUARANTINE_DIR}/${relative_path}"
    fi
}

printf '%s cleanup candidates:\n' "${MODE}"
while IFS= read -r -d '' root_file; do
    base_name=$(basename "${root_file}")
    if ! is_kept_root_file "${base_name}"; then
        move_candidate "${root_file}"
    fi
done < <(find "${LIVE_DIR}" -mindepth 1 -maxdepth 1 -type f -print0)

for disposable_dir in \
    .codex-staging-deleted-voz-only \
    .codex-staging-fetch-policy-ui \
    .codex-staging-reader-safety \
    .codex-staging-voz-fix \
    backups \
    my-rss-reader \
    old_db; do
    if [[ -e "${LIVE_DIR}/${disposable_dir}" ]]; then
        move_candidate "${LIVE_DIR}/${disposable_dir}"
    fi
done

for duplicate_file in \
    'public/script.js' \
    'src/sources/VozSource fix reactionbar.js'; do
    if [[ -e "${LIVE_DIR}/${duplicate_file}" ]]; then
        move_candidate "${LIVE_DIR}/${duplicate_file}"
    fi
done

if [[ "${MODE}" == '--execute' ]]; then
    printf 'Moved cleanup candidates to %s\n' "${QUARANTINE_DIR}"
fi
