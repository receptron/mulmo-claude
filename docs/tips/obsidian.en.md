# MulmoClaude + Obsidian Integration Guide

MulmoClaude's workspace is entirely plain Markdown files. [Obsidian](https://obsidian.md/) is a knowledge management tool that works directly with local Markdown files, so they integrate **with zero code changes and no plugins required**.

---

## Pattern A: Browse MulmoClaude's files in Obsidian

Explore documents, wiki pages, memory, and TODOs created by Claude using Obsidian's graph view and search.

### Setup

1. Open Obsidian
2. Choose "Open folder as vault"
3. Select `~/mulmoclaude/`

That's it. Obsidian creates a `.obsidian/` directory, which has no effect on MulmoClaude.

### What you'll see

```
~/mulmoclaude/
  data/wiki/pages/*.md        ← Wiki pages (Claude's accumulated knowledge base)
  data/wiki/index.md          ← Wiki index
  conversations/memory.md     ← Claude's long-term memory
  conversations/summaries/    ← Daily summaries
  artifacts/documents/*.md    ← Documents created by Claude
```

### How to use it

- **Graph view**: `[[wiki link]]` syntax in wiki pages is natively recognized by Obsidian, visualizing how knowledge connects
- **Full-text search**: Find anything across past conversation results and documents using Obsidian's fast search
- **Tags & folders**: Adding tags or stars in Obsidian won't affect Claude's behavior
- **Mobile sync**: Sync `~/mulmoclaude/` via Obsidian Sync or iCloud/Dropbox to browse Claude's output from your phone

### Notes

- Editing files in Obsidian means Claude will read the modified content. Unless intentional, we recommend using Obsidian as read-only for MulmoClaude files
- Add `.obsidian/` to your `.gitignore` to keep the repo clean

---

## Pattern B: Let Claude reference your existing Obsidian Vault

If you already manage notes and documents in Obsidian and want Claude to read them.

### Option 1: Non-Docker mode (simplest)

Start MulmoClaude with `DISABLE_SANDBOX=1` and Claude has full filesystem access. Just tell it the vault path in chat:

```
Read the notes in ~/ObsidianVault/projects/ and summarize them
```

Claude uses its built-in file tools (`read`, `glob`, `grep`) to read files directly from the vault.

### Option 2: Docker mode — add reference directories via workspace settings

Open Settings (gear icon) → Workspace Dirs tab and add your Obsidian Vault path. In the Docker sandbox, it's mounted read-only, so Claude physically cannot modify your files.

### Option 3: Import via wiki ingest

Import Obsidian notes into MulmoClaude's wiki:

```
Ingest the notes from ~/ObsidianVault/research/ into the wiki
```

Claude reads the notes, organizes the knowledge, and saves them as wiki pages. The original Obsidian files remain unchanged.

### Which option to choose?

| Option | Docker compatible | Write protection | Setup |
|--------|------------------|-----------------|-------|
| Non-Docker + path instruction | No | No (prompt only) | None |
| Workspace settings | Yes | Yes (read-only mount) | Settings UI |
| Wiki ingest | Yes | Yes (copy) | None |

---

## Using both directions

Combine Pattern A + B:

1. Manage your everyday notes in Obsidian
2. Have Claude reference your Obsidian notes for questions, analysis, and summaries
3. Browse Claude's output (wiki, documents) in Obsidian's graph view and search

The `[[wiki link]]` syntax is shared, so Claude's wiki pages and your Obsidian notes connect seamlessly.

---

## FAQ

**Q: Will Obsidian's `.obsidian/` folder cause problems?**

A: No. MulmoClaude ignores this directory. Add it to `.gitignore` to keep git history clean.

**Q: Is the `[[wiki link]]` format compatible?**

A: Yes. Both MulmoClaude's wiki and Obsidian use `[[page name]]` syntax. Obsidian's graph view displays the link structure as-is.

**Q: Can Claude accidentally overwrite my Obsidian notes?**

A: With Docker mode + workspace settings, files are mounted read-only — physically impossible to overwrite. In non-Docker mode, protection is prompt-based only, so Docker mode is recommended if you have important files.
