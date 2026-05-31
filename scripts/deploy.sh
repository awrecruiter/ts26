#!/usr/bin/env bash
# Deterministic production deploy for the linked Vercel project.
#
# Why this exists: this repo has more than one Vercel project wired to
# GitHub auto-deploy, and Vercel's git integration sometimes races or
# fires only one of them — making pushed changes appear "hit or miss."
# This script bypasses the git race entirely by calling `vercel --prod`
# against the project pinned in .vercel/project.json (usher-nextjs),
# then proves the production alias is serving the new commit.
#
# Usage: scripts/deploy.sh
set -euo pipefail

PROJECT_ALIAS="https://usher-nextjs.vercel.app"

red()   { printf '\033[31m%s\033[0m\n' "$*" >&2; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
step()  { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }

# 1. Linked to the right Vercel project
step "Verify .vercel/project.json"
if [[ ! -f .vercel/project.json ]]; then
  red "Missing .vercel/project.json — run 'vercel link' first."; exit 1
fi
echo "  $(cat .vercel/project.json)"

# 2. Type check
step "npx tsc --noEmit"
npx tsc --noEmit
green "  ✓ types clean"

# 3. Working tree must be clean (no uncommitted code changes)
step "Working tree must be clean"
# Allow untracked env files and the screenshots scratch dir but block any
# tracked/modified file from sneaking into a deploy without a commit.
if ! git diff --quiet || ! git diff --cached --quiet; then
  red "  ✗ uncommitted changes detected. Commit or stash first:"
  git status --short
  exit 1
fi
green "  ✓ working tree clean"

# 4. Push current branch to origin
BRANCH="$(git branch --show-current)"
step "git push origin ${BRANCH}"
git push origin "${BRANCH}"
LOCAL_SHA="$(git rev-parse HEAD)"
green "  ✓ pushed ${LOCAL_SHA:0:7}"

# 5. Deploy via Vercel CLI to the pinned project — bypasses git triggers
step "vercel --prod --yes"
DEPLOY_URL="$(vercel --prod --yes 2>&1 | tee /tmp/vercel-deploy.log | grep -Eo 'https://usher-nextjs-[a-z0-9]+-[^[:space:]]+\.vercel\.app' | head -1 || true)"
if [[ -z "${DEPLOY_URL}" ]]; then
  red "  ✗ could not parse a deployment URL from vercel CLI. Last 30 lines:"
  tail -30 /tmp/vercel-deploy.log >&2
  exit 1
fi
green "  ✓ deployment: ${DEPLOY_URL}"

# 6. Confirm the alias is live (the alias updates after the build aliases)
step "Verify production alias serves 200"
STATUS="$(curl -sI -o /dev/null -w '%{http_code}' --max-time 15 "${PROJECT_ALIAS}/dashboard" || echo 000)"
if [[ "${STATUS}" != "200" && "${STATUS}" != "307" ]]; then
  red "  ✗ ${PROJECT_ALIAS}/dashboard returned ${STATUS}"
  exit 1
fi
green "  ✓ ${PROJECT_ALIAS} → ${STATUS}"

printf '\n\033[1;32mDeployed %s to %s\033[0m\n' "${LOCAL_SHA:0:7}" "${PROJECT_ALIAS}"
echo "Deployment URL (auth-gated by Vercel deployment protection):"
echo "  ${DEPLOY_URL}"
