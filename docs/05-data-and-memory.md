# Data And Memory

## Memory layers

RawClaw should maintain several distinct memory types:

### Short-term memory
- recent messages and session state
- optimized for continuity during active work
- Redis-backed control-plane working memory for strategist briefs, search terms, scout evidence, analyst verdicts, guardian verdicts, and queued handoff context

### Long-term semantic memory
- facts, summaries, and reusable knowledge
- indexed for vector retrieval
- Chroma remains the semantic retrieval layer and should not be replaced by queue or graph state

### Runtime knowledge graph
- explicit lineage over sessions, runs, workers, URLs, documents, entities, and memory items
- optimized for operator inspection, source-to-answer traceability, and contradiction/support analysis
- written post-run so graph ingestion never blocks final response delivery

### Workspace memory
- human-readable documents such as:
  - `SOUL.md`
  - `USER.md`
  - `MEMORY.md`
  - `TOOLS.md`

### User-managed memory
- entries created or curated from the UI
- collections, tags, and scope controls

## Memory requirements

- the Memory page and the live agent retrieval path must use the same underlying system
- memories must carry metadata:
  - source
  - type
  - scope
  - creation time
  - last used time
- runs should be able to show which memories were retrieved and which influenced the answer
- session boundaries must support sender-, channel-, thread-, and agent-aware scopes when those surfaces exist

## RAG implementation goals

- semantic retrieval for goals and tasks
- explainable memory usage
- optional scope filters by agent, task, or project
- persistence across sessions
- compaction and pruning strategies so long-lived sessions stay usable

## Data stores

- SQLite for platform state
- Redis for active session and queue state
- ChromaDB for semantic retrieval

The current Phase 3 split is:

- SQLite / Prisma for platform records, graph tables, and reflection/simulation storage
- Redis for active runs, queue state, worker heartbeats, role traces, and short-term swarm memory
- Chroma for long-term semantic memory
