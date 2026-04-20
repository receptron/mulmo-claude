---
description: Create a GitHub release for the MulmoClaude app (not npm packages)
---

## MulmoClaude App Release

This skill creates a GitHub release for the MulmoClaude **app** (not individual npm packages).

**IMPORTANT**: App releases use `v` prefix tags (`v0.2.0`). Package releases use bare tags (`@mulmobridge/cli@0.1.0`). Never mix them.

### Pre-release Checks

1. **Confirm branch**: Must be on `main` with a clean working tree
   ```bash
   git status
   git branch
   ```
2. **Get current version and last release**:
   ```bash
   jq -r .version package.json
   gh release list --repo receptron/mulmoclaude --limit 5
   ```
3. **Ask the user**: What version? (patch / minor / major) and confirm

### Steps

1. **Get today's date** (MUST run `date`, never guess):
   ```bash
   date +%Y-%m-%d
   ```

2. **Count changes since last app release**:
   ```bash
   # Find the last vX.Y.Z tag (not package tags)
   LAST_TAG=$(git tag -l 'v*' --sort=-v:refname | head -1)
   git log --oneline "$LAST_TAG"..HEAD --no-merges | wc -l
   git log --oneline "$LAST_TAG"..HEAD --no-merges | head -30
   ```

3. **Update `docs/CHANGELOG.md`**:
   - Add a new `## [X.Y.Z] - YYYY-MM-DD` section at the top (below the header)
   - Follow [Keep a Changelog](https://keepachangelog.com/) format
   - Sections: `Highlights`, `Added`, `Changed`, `Fixed`, `Security`, `Breaking Changes` (only if applicable)
   - Write concise bullet points — focus on user-visible changes
   - If a previous release entry is misattributed (e.g., a package release using an app version), annotate it with "(package release)"

4. **Update `package.json` version**:
   ```bash
   # Edit package.json version field to the new version
   ```

5. **Commit version bump** (add files individually):
   ```bash
   git add docs/CHANGELOG.md package.json
   git commit -m "chore: bump version to X.Y.Z + update CHANGELOG"
   ```

6. **Create git tag** (WITH `v` prefix for app releases):
   ```bash
   git tag vX.Y.Z
   git push origin main --tags
   ```

7. **Create GitHub release**:
   ```bash
   gh release create vX.Y.Z --repo receptron/mulmoclaude \
     --title "vX.Y.Z — Short Description" \
     --notes "$(cat <<'EOF'
   ## Highlights

   ### Feature 1
   Description...

   ### Feature 2
   Description...

   ## Breaking Changes

   - (if any)

   ## Full Changelog

   See [CHANGELOG.md](https://github.com/receptron/mulmoclaude/blob/main/docs/CHANGELOG.md#xyz---yyyy-mm-dd) for the complete list.
   EOF
   )"
   ```

### Tag Convention

| Type | Format | Example |
|------|--------|---------|
| App release | `vX.Y.Z` | `v0.2.0` |
| npm package | `@scope/name@X.Y.Z` | `@mulmobridge/cli@0.1.1` |

**NEVER** use an app-style `vX.Y.Z` tag for a package-only release. If a previous release used the wrong convention, edit its title to add "(package release)" and correct the next release.

### Important Rules

- MUST run `date` to get today's date — never guess
- MUST update CHANGELOG before tagging
- MUST use `v` prefix for app tags
- MUST add files individually (never `git add -A`)
- MUST confirm version number with the user before proceeding
- Notes body MUST use single-quoted heredoc (`<<'EOF'`) — no backslash escaping of backticks
