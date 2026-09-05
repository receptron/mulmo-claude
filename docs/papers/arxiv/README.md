# arXiv paper series

LaTeX sources for the arXiv submissions derived from the essays in
[`docs/papers/`](../). Strategy: the four essays are reframed as **systems /
experience papers** anchored on the real MulmoClaude system and a longitudinal
single-user case study, and **consolidated into two papers**. This avoids the
arXiv CS policy (Oct 2025) that rejects *position papers / review articles*
unless already peer-reviewed with a DOI — systems papers introducing a built
artifact with a technical contribution are unaffected.

## Papers

| Dir | Title | Source essays | Primary / cross-list |
|---|---|---|---|
| `dsls-as-harnesses/` | DSLs as Harnesses: Declarative Applications-as-Data as a Reliability Substrate for LLM Agents | `dsl-as-harness.md` + `collections-architecture.md` | cs.AI / cs.SE, cs.PL, cs.HC |
| `workspace-is-the-agent/` | The Workspace Is the Self-Improving Agent | `workspace-is-the-agent.md` + `software-for-one.md` | cs.AI / cs.SE, cs.HC, cs.CY |
| `drawing-the-line/` | The Harness Is the Language: When Everyone Writes Software and No One Reads It | new (shared apps; deck `mag2/Sep2026/08.json`) | cs.AI / cs.SE, cs.PL, cs.HC |

**Primary category is cs.AI for both.** Endorsement is category-specific, and the
endorser (Yohei Nakajima) is qualified in cs.AI — so cs.AI primary is friction-free;
cs.SE/cs.PL/cs.HC are cross-lists, which need no separate endorsement.

`drawing-the-line/` is the third paper. It does NOT cite the pilot (unpublished, private); it shares the pilot's verified `refs.bib` and cites Yohei Nakajima's "The Log is the Agent" (arXiv:2605.21997) directly.

`dsls-as-harnesses/` is the **pilot**, drafted end-to-end as the template for the
second paper. It should be posted first so the second can cite its arXiv id.

## Build

```bash
brew install tectonic        # one-time; self-contained LaTeX, no TeX Live
./dsls-as-harnesses/build.sh # -> dsls-as-harnesses/main.pdf
```

Source layout per paper: `main.tex` + `refs.bib` + `build.sh`. Submit the **TeX
source** to arXiv (not a pre-built PDF) so arXiv compiles it.

## Before submitting — checklist

**Author / account**
- [x] Endorsement: Yohei Nakajima (qualified in **cs.AI**) will endorse → submit
  with **cs.AI as primary** category for both papers.
- [x] Author = **Satoshi Nakajima**, affiliation = **The Singularity Society**
  (confirmed). Keep identical across both papers.
- [ ] ORCID (optional for arXiv) — add to `\author{}` if you want one linked.

**Content**
- [x] All references in `refs.bib` verified (arXiv ids via the arXiv API, DOIs via
  Crossref, 2026-06); `VERIFY` flags cleared.
- [ ] Add the 3 custom-view screenshots for Figure 1 (see
  `dsls-as-harnesses/figures/README.md`); builds with placeholders until then.
- [x] Open-source repository URL added (footnote + Availability):
  `https://github.com/receptron/mulmoclaude`.
- [ ] Re-run the case-study numbers (`docs/papers/arxiv/dsls-as-harnesses` quotes
  26 collections / ~700 records / 6 views / 3 feeds — refresh before submission).
- [ ] Read once for any remaining first-person essay register; systems-paper
  voice survives moderation better.

**Mechanics**
- [x] License: **CC BY 4.0** (noted on page 1 of the paper). Also select CC BY 4.0
  in the arXiv submission form at upload.
- [ ] Pick primary + cross-list categories (table above).
- [ ] Compile clean with `tectonic` locally, then upload `main.tex` + `refs.bib`
  to arXiv; check arXiv's own AutoTeX build log.
- [ ] Stagger: post paper 1, get its id, insert it into paper 2's `refs.bib`,
  then post paper 2.
