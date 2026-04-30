# Codex Web Task Structure and Workflow

This document explains how the RawClaw/Codex-style stack handles web-related work in three different ways depending on the job:

1. broad web search for current information
2. direct page reading / structured extraction from a URL
3. interactive browser use for localhost or live UI testing

The goal is to show both:

- the runtime workflow
- the main files that participate in each workflow

## 1. Top-Level Request Flow

All chat requests start in the web app, go through the API orchestrator, and then reach the Python agent runtime.

### Main entry files

- `apps/web/src/pages/Chat.tsx`
  - chat UI
  - renders messages, tool calls, and tool results
- `apps/api/src/chat.controller.ts`
  - HTTP entrypoint for chat requests
- `apps/api/src/chat-orchestrator.service.ts`
  - prepares messages, tools, skills, routing context, and direct-response shortcuts
- `apps/agent/src/main.py`
  - Python service entrypoint
- `apps/agent/src/executor.py`
  - main decision engine for reasoning, tools, routing, research, fetch, and final answer shaping

### Shared runtime idea

The system now tries to classify the user intent before it fires web tools:

- `self_capability`
- `clarification_needed`
- `page_read`
- `factual_extract`
- `research`
- `ambiguous`

That early gate lives in:

- `apps/agent/src/executor.py`

## 2. Mode A: Web Search

Use this when the user wants broad, current, external information such as:

- latest news
- recent product updates
- current developments
- multi-source research

### Typical prompt shape

- `Search the web for news about GTA 6 launch.`
- `Search the web and tell me the most important recent OpenAI API updates.`

### Workflow

1. Chat request arrives in `Chat.tsx`
2. API orchestrator selects relevant tools in `chat-orchestrator.service.ts`
3. Python executor decides this is `research`
4. Executor either forces `web_search` directly or uses the guided research lane
5. `web_search` runs and returns search results
6. The executor may:
   - answer from search snippets
   - or continue into fetch/extract if the request needs stronger grounding
7. Final answer is normalized and streamed back to the chat UI

### Main files

- `apps/api/src/chat-orchestrator.service.ts`
  - skill inference
  - tool selection
  - tool guidance injected into prompt
- `apps/agent/src/executor.py`
  - `_should_use_guided_web_research`
  - `_build_search_query`
  - `_extract_search_evidence`
  - `_evaluate_answerability`
  - `_render_grounded_web_answer`
- `apps/agent/src/tools/builtin/smart_web_search.py`
  - main `web_search` tool
  - provider fallback
  - result parsing / normalization
- `apps/agent/src/tools/builtin/search_web.py`
  - direct DuckDuckGo-style fallback search
- `apps/agent/src/research/planner.py`
- `apps/agent/src/research/router.py`
- `apps/agent/src/research/judge.py`
- `apps/agent/src/research/writer.py`
- `apps/web/src/components/chat/WebSearchResult.tsx`
  - renders search tool results in chat

### Output style

This path is best for:

- “what are the latest…”
- “search the web for…”
- “research current…”

It is not ideal for:

- one exact fact from one exact page
- “what is on this page?”

## 3. Mode B: Direct Page Read / Factual Extract

Use this when the user gives a page or clearly points to one source and wants:

- what is on this page
- a summary of this article
- an exact value from the source page
- structured data from an official page

### Typical prompt shape

- `Read https://example.com and summarize this page.`
- `Read https://www.iplt20.com/matches/points-table and tell me Chennai Super Kings standing.`
- `Open the official IPL 2026 points table page and tell me Chennai Super Kings standing.`

### Workflow

1. API passes the request into the agent runtime
2. Executor classifies it as:
   - `page_read`
   - or `factual_extract`
3. Executor prefers `web_extract` over search
4. `web_extract` runs extraction backends
5. Extracted output is classified with metadata like:
   - `taskType`
   - `pageType`
   - `sourceMode`
   - `tier`
   - `confidence`
   - `structuredData`
6. Executor applies the evidence gate:
   - `PROCEED_FULL`
   - `PROCEED_CAUTIOUS`
   - `ABSTAIN`
7. Final answer is shaped differently depending on:
   - page read
   - factual extraction
   - sparse / blocked page

### Main files

- `apps/agent/src/executor.py`
  - `_maybe_force_tool_call`
  - `_build_direct_url_extract_input`
  - `_classify_web_task`
  - `_classify_pre_web_intent`
  - `_extract_evidence_gate`
  - `_render_page_read_answer`
  - `_render_factual_extract_answer`
- `apps/agent/src/tools/builtin/web_extract.py`
  - main page extraction tool
  - metadata enrichment
  - page type classification
  - structured data extraction
- `apps/agent/src/tools/builtin/web_fetch.py`
  - lower-level fetch support
- `apps/web/src/components/chat/BrowserResult.tsx`
- `apps/web/src/components/chat/toolResultUtils.tsx`
  - renders tool outputs in the chat UI

### Important classification concepts

#### `taskType`

- `page_read`
- `factual_extract`
- `research`

#### `pageType`

- `homepage`
- `news_index`
- `article`
- `data_table`
- `blocked`
- `sparse`
- `general`

#### `sourceMode`

- `user_named`
- `hybrid`
- `system_chosen`

This path is best for:

- direct URLs
- official source pages
- tables / changelogs / structured pages

## 4. Mode C: Interactive Browser Use

Use this when the job is not just “read the page”, but “open and interact with it”, especially:

- localhost app testing
- clicking buttons
- reproducing UI issues
- confirming real browser behavior

### Typical prompt shape

- `@browser-use go to localhost:5173 and test the chat flow`
- `Open localhost:5173 and reproduce the issue`

### Workflow

1. The request uses the in-app browser plugin
2. Browser automation is driven through the Browser Use runtime
3. The browser opens the live app or site
4. The agent can:
   - navigate
   - inspect DOM
   - take screenshots
   - click / type / reload
5. This is used to verify real UI behavior before or after code changes

### Main files

- plugin skill:
  - `C:/Users/WELCOME/.codex/plugins/cache/openai-bundled/browser-use/0.1.0-alpha1/skills/browser/SKILL.md`
- browser client runtime:
  - `C:/Users/WELCOME/.codex/plugins/cache/openai-bundled/browser-use/0.1.0-alpha1/scripts/browser-client.mjs`
- local app UI:
  - `apps/web/src/pages/Chat.tsx`
  - `apps/web/src/App.tsx`

### Important distinction

This path is not the same as `web_search` or `web_extract`.

- `web_search` = search engine / provider results
- `web_extract` = fetch and extract content from a page
- browser use = real interactive browser session

## 5. How the System Chooses Which Mode to Use

The rough decision ladder is:

1. if the prompt is internal/self-description:
   - answer locally
2. if the prompt is too vague:
   - ask one clarifying question
3. if the prompt gives a URL or one source page:
   - use `web_extract`
4. if the prompt asks for one exact fact from one page:
   - use `factual_extract`
5. if the prompt asks for current broad external info:
   - use `web_search` and possibly follow with extract/fetch
6. if the task needs clicking/testing:
   - use the in-app browser

### Core decision files

- `apps/api/src/chat-orchestrator.service.ts`
  - selects skills and tools for the request
- `apps/agent/src/executor.py`
  - applies final routing and evidence decisions

## 6. UI Rendering of Web Activity

When tools run, the web UI shows that activity in chat.

### Main files

- `apps/web/src/pages/Chat.tsx`
  - message timeline
  - tool call / tool result rendering
- `apps/web/src/components/chat/WebSearchResult.tsx`
- `apps/web/src/components/chat/BrowserResult.tsx`
- `apps/web/src/components/chat/TerminalResult.tsx`
- `apps/web/src/components/chat/FileResult.tsx`
- `apps/web/src/components/chat/toolResultUtils.tsx`

## 7. Practical Summary

### Use web search when:

- you need current information from the broader web
- the task is multi-source research

### Use page extract when:

- the user gives a URL
- the answer should come from one page
- the page contains structured data

### Use the browser when:

- you must interact with the page
- you are testing localhost UI
- you need a real visual/browser reproduction

## 8. Short File Map

### Request entry

- `apps/web/src/pages/Chat.tsx`
- `apps/api/src/chat.controller.ts`
- `apps/api/src/chat-orchestrator.service.ts`

### Core runtime

- `apps/agent/src/main.py`
- `apps/agent/src/executor.py`

### Search path

- `apps/agent/src/tools/builtin/smart_web_search.py`
- `apps/agent/src/tools/builtin/search_web.py`
- `apps/agent/src/research/*.py`

### Page extraction path

- `apps/agent/src/tools/builtin/web_extract.py`
- `apps/agent/src/tools/builtin/web_fetch.py`

### Browser / interactive path

- Browser Use plugin skill and runtime under:
  - `C:/Users/WELCOME/.codex/plugins/cache/openai-bundled/browser-use/0.1.0-alpha1/`

### UI rendering

- `apps/web/src/pages/Chat.tsx`
- `apps/web/src/components/chat/*.tsx`

