# Rebuild Overview

## Purpose

This document defines how RawClaw will be rebuilt from scratch after loss of the prior codebase.

The goal is not just to recreate the old system, but to rebuild it with:
- stronger safety
- clearer architecture
- better documentation
- more reliable local development
- more durable data and recovery practices

## Objectives

RawClaw should become a local-first AI operations platform that can:
- run chat with tool usage
- connect to MCP tools and Docker MCP Gateway
- run agent tasks with provenance and artifacts
- maintain memory across short-term and long-term contexts
- support specialist agents and delegation
- operate cleanly in desktop and web environments

## Design principles

### Safety
- Remote git on day one
- Automated backup/export strategy
- Temp and cache data must never pollute source folders

### Clarity
- A small number of well-defined services
- Shared contracts between frontend, API, and agent
- Documentation as a required artifact, not an afterthought

### Reliability
- No user-facing feature should depend on silent failures
- Tool and model failures should degrade gracefully
- Freshness-sensitive output must be verified or clearly limited

### Traceability
- Task runs should preserve steps, outputs, sources, and runtime context
- Operators should be able to inspect what happened after the fact

## Rebuild sequence

1. Foundation and safety
2. Monorepo scaffold
3. Chat MVP
4. Tool and MCP integration
5. Task engine
6. Memory and RAG
7. Multi-agent orchestration
8. Reliability and product polish

## Success criteria

The rebuild is successful when:
- root dev/build commands work cleanly
- chat can use tools reliably
- tasks produce one strong final deliverable plus provenance
- memory is unified and inspectable
- Docker MCP is straightforward to connect and use
- the repo and local data are protected against another catastrophic loss

