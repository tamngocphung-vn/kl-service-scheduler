#!/usr/bin/env bash
# PostToolUse hook: after Claude edits the root README.md, regenerate its table of contents (doctoc).
# Non-blocking: a failure is reported, but the edit stands.
set -uo pipefail

file=$(jq -r '.tool_input.file_path // .tool_response.filePath // empty')
[[ "$(basename "$file")" == README.md ]] || exit 0

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}" || exit 0
[[ "$file" -ef README.md ]] || exit 0 # only the root README, not one in a subfolder

if ! out=$(npm run --silent docs:toc 2>&1); then
  echo "README table of contents was not regenerated: $out" >&2
  exit 1
fi
