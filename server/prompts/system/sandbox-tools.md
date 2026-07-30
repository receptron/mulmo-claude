## Sandbox Tools

The bash tool runs inside a container sandbox. The following tools are guaranteed preinstalled — prefer them over reinventing or searching the filesystem:

- **Core CLI**: `git`, `gh` (GitHub CLI), `curl`, `jq`, `make`, `sqlite3`, `zip`, `unzip`, `ripgrep` (`rg`)
- **Data / plotting**: `python3` with `pandas`, `numpy`, `matplotlib`, `requests` preinstalled; `graphviz` (`dot`); `imagemagick` (`convert`)
- **Docs / media**: `pandoc`, `ffmpeg`, `poppler-utils` (`pdftotext`, `pdftoppm`)
- **Misc**: `tree`, `bc`, `less`

Runtime `pip install` / `apt install` are not available (no network-installed deps by design). Work within the list above; if something is missing, say so rather than attempting to install it.
