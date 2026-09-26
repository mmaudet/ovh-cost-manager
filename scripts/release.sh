#!/usr/bin/env bash
# Release helper.
#
#   npm run release -- 2.3.0 --dry-run   print the release notes of 2.3.0, change nothing
#   npm run release -- 2.3.0             open the "Release 2.3.0" pull request
#   npm run release -- --tag             once it is merged: tag main, which publishes
#                                        the Docker image and the GitHub release
#
# The notes come from GitHub, which groups the pull requests merged since the
# previous tag by their labels (.github/release.yml). They are inserted in
# CHANGELOG.md, where the release pull request lets you review and complete them
# (upgrade notes, highlights). The Docker publish workflow then uses that
# CHANGELOG.md section as the body of the GitHub release.
set -euo pipefail

repo=$(git remote get-url origin | sed -E 's#^(git@github\.com:|https://github\.com/)##; s#\.git$##')

fail() {
  echo "error: $*" >&2
  exit 1
}

usage() {
  sed -n '2,7p' "$0" | sed 's/^# \{0,1\}//'
}

require_clean_main() {
  [ "$(git branch --show-current)" = main ] || fail "run this from the main branch"
  [ -z "$(git status --porcelain)" ] || fail "the working tree has uncommitted changes"
  [ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || fail "main is not up to date with origin/main"
}

# The CHANGELOG.md section of version $1, from the pull requests merged since $2
changelog_section() {
  local version=$1 previous=$2
  echo "## ${version} - $(date +%F)"
  echo
  echo "<!-- Upgrade notes and highlights of this release, if any. -->"
  echo
  gh api "repos/${repo}/releases/generate-notes" \
    -f tag_name="v${version}" -f target_commitish=main -f previous_tag_name="${previous}" \
    --jq .body |
    sed -e '/^<!-- Release notes generated/d' \
        -e "/^## What's Changed/d" \
        -e 's/^## New Contributors/### New contributors/' |
    sed -e '/./,$!d' |
    cat -s
}

# Insert the section in file $1 above the latest version of CHANGELOG.md
insert_in_changelog() {
  local section=$1 updated
  updated=$(mktemp)
  awk -v section="$section" '
    !inserted && /^## [0-9]/ {
      while ((getline line < section) > 0) print line
      print ""
      inserted = 1
    }
    { print }
  ' CHANGELOG.md > "$updated"
  mv "$updated" CHANGELOG.md
}

prepare() {
  local version=$1 dry_run=$2 previous section branch
  [[ $version =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "expected a version such as 2.3.0, got '${version}'"

  git fetch --quiet origin main --tags
  if git rev-parse -q --verify "refs/tags/v${version}" > /dev/null; then
    fail "tag v${version} already exists"
  fi
  previous=$(git describe --tags --abbrev=0 --match 'v*' origin/main)

  section=$(mktemp)
  changelog_section "$version" "$previous" > "$section"
  if [ "$dry_run" = true ]; then
    cat "$section"
    return
  fi

  require_clean_main
  branch="release/v${version}"
  git switch -c "$branch"
  npm version "$version" --no-git-tag-version > /dev/null
  insert_in_changelog "$section"
  git add package.json package-lock.json CHANGELOG.md
  git commit -m "chore: release ${version}"
  git push -u origin "$branch"
  gh pr create -R "$repo" --base main --head "$branch" --label skip-changelog \
    --title "Release ${version}" \
    --body "Release notes of ${version}: the pull requests merged since ${previous}, grouped by their labels.

Before merging, review the new section of CHANGELOG.md: add upgrade notes or highlights in place of the placeholder comment, and move any pull request filed under the wrong heading.

Once merged, \`npm run release -- --tag\` tags main, which publishes the Docker image and the GitHub release."
}

tag() {
  local version
  git fetch --quiet origin main --tags
  require_clean_main
  version=$(node -p "require('./package.json').version")
  if git rev-parse -q --verify "refs/tags/v${version}" > /dev/null; then
    fail "tag v${version} already exists: prepare a new release first"
  fi
  grep -q "^## ${version} " CHANGELOG.md || fail "CHANGELOG.md has no section for ${version}"

  git tag -a "v${version}" -m "Release ${version}"
  git push origin "v${version}"
  echo "Pushed v${version}: the Docker publish workflow now builds the image and creates the GitHub release."
}

case "${1:-}" in
  --tag) tag ;;
  "" | -h | --help) usage ;;
  *) prepare "$1" "$([ "${2:-}" = --dry-run ] && echo true || echo false)" ;;
esac
