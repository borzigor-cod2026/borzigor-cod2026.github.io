# Правила проекту

## Після кожної зміни .gs файлів

Після будь-якого редагування файлів у `backend/*.gs` — автоматично виконати:

```powershell
clasp push
```

Це стосується будь-якого edit/write у `.gs` файлах, незалежно від того, чи просив користувач явно.

---

# LLM Wiki — Schema

This project uses an LLM-maintained wiki. You (the LLM) own and maintain the `wiki/` directory entirely. The human curates sources and asks questions. You do the bookkeeping.

## Structure

```
wiki/
  index.md            — master index of all pages (update after every operation)
  log.md              — append-only operations log
  raw/                — immutable source documents (NEVER modify these)
    articles/         — web articles clipped to markdown (Obsidian Web Clipper)
    pdfs/             — PDF documents
    notes/            — handwritten or typed notes
    transcripts/      — video / audio transcripts
    screenshots/      — images and screenshots
    assets/           — downloaded images referenced by sources
  pages/              — LLM-generated wiki pages (you write all of these)
    project/          — sales system: architecture, decisions, open questions
    business/         — business analysis, market, competitors, financials
    personal/         — personal goals, psychology, self-improvement
    entities/         — people, companies, products, services
    concepts/         — ideas, frameworks, methodologies
    sources/          — one summary page per ingested source
```

## Domains

| Domain | Path | Scope |
|--------|------|-------|
| project | `pages/project/` | This codebase, its architecture, decisions, open questions |
| business | `pages/business/` | Business analysis, market research, competitive analysis |
| personal | `pages/personal/` | Personal goals, habits, reading notes, psychology |

## Workflows

### Ingest a source
When told to ingest a source file from `wiki/raw/`:
1. Read the source (text first, then images if referenced)
2. Discuss key takeaways with the user
3. Write a summary page → `wiki/pages/sources/<slug>.md`
4. Update existing entity / concept / domain pages that this source touches (typically 5–15 pages)
5. Create new pages for any entity or concept that appears but has no page yet
6. Update `wiki/index.md`
7. Append to `wiki/log.md`:  `## [YYYY-MM-DD] ingest | Source Title`

### Answer a query
1. Read `wiki/index.md` to locate relevant pages
2. Read those pages
3. Synthesize with citations: `([[page-name]])`
4. If the answer is valuable (comparison, analysis, discovery) — offer to save it as a new wiki page

### Lint the wiki
Periodically, or on request:
- Flag contradictions between pages
- Flag stale claims superseded by newer sources
- List orphan pages (0 inbound links)
- Suggest missing pages for concepts mentioned but never given their own page
- Suggest new sources to fill knowledge gaps

## Page format

Every wiki page has YAML frontmatter:

```yaml
---
tags: [source|entity|concept|project|business|personal]
sources: [filename1.md, filename2.pdf]   # raw sources that informed this page
updated: YYYY-MM-DD
---
```

- Cross-link with `[[page-name]]` (Obsidian wiki links)
- Page filenames: lowercase, hyphenated — e.g. `sales-funnel.md`
- Source filenames: preserve original name when possible
- Keep the frontmatter `sources` list accurate so the wiki is auditable

## Files to always read first

Before answering any wiki question, read:
1. `wiki/index.md` — to know what pages exist
2. `wiki/log.md` (last 20 lines) — to know what was done recently
