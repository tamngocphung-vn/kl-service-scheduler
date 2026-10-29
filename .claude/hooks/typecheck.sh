#!/usr/bin/env bash
# PostToolUse hook: after Claude edits a TypeScript file, type-check the project.
# Exit 2 sends the errors back to Claude so it fixes them before moving on.
set -uo pipefail

file=$(jq -r '.tool_input.file_path // .tool_response.filePath // empty')
[[ "$file" == *.ts ]] || exit 0

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}" || exit 0
if ! out=$(npx --no-install tsc --noEmit 2>&1); then
  {
    echo "Typecheck failed after editing ${file#$PWD/}:"
    echo "$out" | head -30
  } >&2
  exit 2
fi
