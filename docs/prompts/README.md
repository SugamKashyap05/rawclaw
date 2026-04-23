# RawClaw Prompt Pack

This folder contains reusable prompt assets for RawClaw, inspired by the structure used in the Awesome Copilot collection:

- a core system prompt
- a tool-grounding prompt
- a review/correction prompt
- task prompts for common workflows

## Recommended Stack

Use these prompts as a layered system instead of one oversized prompt:

1. `rawclaw-core-system.prompt.md`
2. `rawclaw-tool-grounding.prompt.md`
3. `rawclaw-review-correction.prompt.md`
4. one task prompt, depending on the request:
   - `rawclaw-web-research.prompt.md`
   - `rawclaw-planning.prompt.md`
   - `rawclaw-code-review.prompt.md`

## Usage Notes

- The core system prompt is suitable for agent profiles in the RawClaw UI.
- The tool-grounding prompt is meant to be injected after successful tool calls.
- The review/correction prompt is meant for the reviewer or rewrite pass.
- The task prompts are reusable templates for specialized workflows.

## Design Principles

- Prefer tool-backed evidence over prior model knowledge.
- Keep outputs structured and reviewable.
- Replace rejected drafts instead of appending corrected text to them.
- Be explicit about uncertainty when tools fail or results are partial.
