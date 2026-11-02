#!/usr/bin/env bash
# Installs the UI UX Pro Max skill (and the ui-ux-audit skill that goes with it) for Claude Code.
#
#   scripts/install-ui-ux-pro-max.sh                 # into ./.claude/skills of the current folder (this project)
#   scripts/install-ui-ux-pro-max.sh --global        # into ~/.claude/skills (every project on this machine)
#   scripts/install-ui-ux-pro-max.sh /path/to/app    # into /path/to/app/.claude/skills
#
# Restart Claude Code afterwards, then type /ui-ux-pro-max or /ui-ux-audit.
# The skill's search scripts need Python 3 (no packages).
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/.claude/skills"
SKILLS=(ui-ux-pro-max ui-ux-audit)

case "${1:-}" in
  --global|-g) DEST="$HOME/.claude/skills" ;;
  -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
  "")          DEST="$PWD/.claude/skills" ;;
  *)           DEST="$1/.claude/skills" ;;
esac

for s in "${SKILLS[@]}"; do
  [ -f "$SRC/$s/SKILL.md" ] || { echo "Missing $SRC/$s/SKILL.md - run this from a checkout of the ATS-system repo." >&2; exit 1; }
done

mkdir -p "$DEST"
for s in "${SKILLS[@]}"; do
  rm -rf "$DEST/$s"
  cp -R "$SRC/$s" "$DEST/$s"
  echo "installed $s -> $DEST/$s"
done

command -v python3 >/dev/null 2>&1 || echo "note: python3 not found; the skill's design search needs it."
echo "Done. Restart Claude Code, then use /ui-ux-pro-max or /ui-ux-audit."
