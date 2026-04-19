# GitHub repositories in the workspace

Git repositories cloned for the user live under `github/` in the workspace root.

## Rules

1. **Clone destination**: always clone into `github/<dir-name>/`, never into `/tmp/` or other locations outside the workspace.
2. **Existing repo — same remote**: if `github/<dir-name>/` already exists and its `origin` remote matches the requested URL, run `git pull` to update instead of cloning again.
3. **Existing repo — different remote**: if a directory with the desired name already exists but points at a different remote, **ask the user** to choose a directory name before proceeding. Never overwrite or re-initialize an existing repo silently.
4. **Directory naming**: use the repository name by default (e.g. `github/mulmoclaude/` for `git@github.com:receptron/mulmoclaude.git`). If the user specifies a different name, use that.

## Examples

```bash
# First clone
git clone git@github.com:receptron/mulmoclaude.git github/mulmoclaude

# Already exists, same remote → update
cd github/mulmoclaude && git pull

# Name conflict, different remote → ask user
# "github/mulmoclaude already exists with a different remote. What name would you like?"
```
