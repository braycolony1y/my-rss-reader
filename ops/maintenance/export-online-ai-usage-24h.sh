#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

readonly SCRIPT_HOME="/home/ubuntu/script"
readonly LOG_DIR="${SCRIPT_HOME}/logs"
readonly OUTPUT_FILE="${LOG_DIR}/online-ai-usage-last-24h.log"
readonly LOCK_FILE="${SCRIPT_HOME}/online-ai-usage-export.lock"

mkdir -p "${LOG_DIR}"

exec 9>"${LOCK_FILE}"
if ! flock -n 9; then
    exit 0
fi

temporary_file=$(mktemp "${LOG_DIR}/.online-ai-usage-last-24h.XXXXXX")
cleanup() {
    rm -f -- "${temporary_file}"
}
trap cleanup EXIT

export TZ=Asia/Ho_Chi_Minh

{
    printf 'RSS Reader online AI usage — rolling 24-hour window\n'
    printf 'Generated: %s\n' "$(date '+%Y-%m-%d %H:%M:%S %Z')"
    printf 'Source: rss-reader.service journal\n\n'

    journalctl \
        --unit=rss-reader.service \
        --since='24 hours ago' \
        --no-pager \
        --output=short-iso \
        --grep='\[ONLINE AI\]|\[SMART VERIFY\].*(gemini|qwen)|\[SUMMARY\].*(Gemini|Qwen|Model)' \
        || true
} > "${temporary_file}"

chmod 0600 "${temporary_file}"
mv -f -- "${temporary_file}" "${OUTPUT_FILE}"
trap - EXIT
