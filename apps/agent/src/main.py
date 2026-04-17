"""
RawClaw Agent — FastAPI application entry point.

Phase 3 wiring:
  - SandboxConfig loaded and logged at startup
  - Built-in tools registered automatically on import
  - MCP gateway connected if configured
  - Tool health endpoints exposed
  - Executor handles confirmation gates and provenance
"""
import asyncio
import json
import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

from src.contracts import ChatRequest, ChatResponse, HealthStatus, ToolCall, TaskExecutionRequest
from src.models.router import ModelRouter
from src.config import settings
from src.sandbox.sandbox_config import get_sandbox_config
from src.memory.chroma_memory import ChromaMemory
from src.memory.knowledge_brain import KnowledgeBrain

# Tool subsystem imports (auto-registers built-in tools)
from src.tools.registry import TOOL_REGISTRY
from src.tools.mcp_gateway import MCPGateway
from src.tools.mcp_tool_wrapper import wrap_mcp_tools
from src.tools.skill_loader import SkillLoader
from src.executor import EXECUTOR

async def verify_docker_available():
    """Checks if Docker is available and responsive, with robust path checking."""
    import platform
    import shutil
    import traceback
    
    is_windows = platform.system() == "Windows"
    
    # 1. Path check
    docker_path = shutil.which("docker")
    if not docker_path:
        logger.warning("Docker binary NOT found in environment PATH.")
        return False
    
    logger.info(f"Docker binary found at: {docker_path}")
    
    try:
        # 2. Execution check
        if is_windows:
            process = await asyncio.create_subprocess_shell(
                "docker info",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
        else:
            process = await asyncio.create_subprocess_exec(
                "docker", "info",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            
        stdout, stderr = await process.communicate()
        if process.returncode == 0:
            logger.info("Docker daemon is responding correctly")
            return True
        else:
            err_msg = stderr.decode().strip() or stdout.decode().strip()
            logger.warning(f"Docker info failed (exit {process.returncode}): {err_msg}")
    except Exception as e:
        logger.error(f"Docker check exception: {e}")
        logger.debug(traceback.format_exc())
    return False

async def retry_with_backoff(coro, max_retries=3, initial_delay=1):
    """Generic retry logic with exponential backoff."""
    for i in range(max_retries):
        try:
            return await coro()
        except Exception as e:
            if i == max_retries - 1:
                logger.error(f"Operation failed after {max_retries} attempts. Swallowing exception: {e}")
                return None
            delay = initial_delay * (2 ** i)
            logger.warning(f"Operation failed, retrying in {delay}s... (Error: {e})")
            await asyncio.sleep(delay)

from pythonjsonlogger import jsonlogger

# Configure structured JSON logging
logHandler = logging.StreamHandler()
formatter = jsonlogger.JsonFormatter(
    '%(asctime)s %(name)s %(levelname)s %(message)s %(module)s %(funcName)s'
)
logHandler.setFormatter(formatter)
logging.basicConfig(handlers=[logHandler], level=logging.INFO)
logger = logging.getLogger("rawclaw.main")

# Global instances
model_router = ModelRouter()
mcp_gateway: MCPGateway | None = None
skill_loader: SkillLoader | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown events."""
    # === STARTUP ===
    logger.info("=" * 50)
    logger.info("RawClaw Agent starting up...")
    logger.info("=" * 50)

    # 1. Load and log SandboxConfig
    sandbox_config = get_sandbox_config()
    sandbox_config.log_status()

    # 2. Initialize ChromaDB vector memory
    from src.config import settings as cfg
    chroma_memory = ChromaMemory(
        persist_directory=cfg.CHROMA_PERSIST_DIR,
        collection_name=cfg.CHROMA_COLLECTION,
    )
    app.state.chroma_memory = chroma_memory
    app.state.knowledge_brain = KnowledgeBrain(chroma_memory) if cfg.ENABLE_WIKIPEDIA_RAG else None
    app.state.use_langgraph = cfg.USE_LANGGRAPH
    logger.info("ChromaDB memory initialized")

    # 3. Import built-in tools (already auto-registered via __init__.py)
    from src.tools.builtin import register_builtin_tools
    # Tools are already registered, but we can re-ensure
    logger.info(f"Built-in tools registered: {TOOL_REGISTRY.tool_names}")

    # 3. Load and register skills
    global skill_loader
    skill_loader = SkillLoader()
    skills = skill_loader.discover()
    for skill in skills:
        try:
            TOOL_REGISTRY.register(skill)
        except ValueError as e:
            logger.warning(f"Skill registration skipped: {e}")

    # 4. Initialize MCP gateway & Connection Check
    global mcp_gateway
    docker_mcp_url = os.getenv("DOCKER_MCP_URL")
    docker_mcp_transport = os.getenv("DOCKER_MCP_TRANSPORT", "stdio").lower()
    docker_mcp_profile = os.getenv("DOCKER_MCP_PROFILE")
    mcp_gateway_auth_token = os.getenv("MCP_GATEWAY_AUTH_TOKEN")
    mcp_config_path = os.getenv("MCP_SERVERS_CONFIG", "mcp_servers.json")
    
    # Verify Docker if using sandbox
    await verify_docker_available()

    mcp_gateway = MCPGateway(config_path=mcp_config_path)

    # Load from file first so explicit config wins over defaults
    mcp_gateway.load_config()

    if "docker-toolkit" not in mcp_gateway.server_names:
        from src.tools.mcp_gateway import MCPServer

        if docker_mcp_transport == "sse" and docker_mcp_url:
            logger.info(f"Registering docker-toolkit over SSE: {docker_mcp_url}")
            env = {"MCP_GATEWAY_AUTH_TOKEN": mcp_gateway_auth_token} if mcp_gateway_auth_token else {}
            mcp_gateway.add_server(MCPServer(
                name="docker-toolkit",
                transport="sse",
                url=docker_mcp_url,
                env=env,
            ))
        else:
            args = ["mcp", "gateway", "run"]
            if docker_mcp_profile:
                args.extend(["--profile", docker_mcp_profile])
            logger.info(f"Registering docker-toolkit over stdio: docker {' '.join(args)}")
            mcp_gateway.add_server(MCPServer(
                name="docker-toolkit",
                transport="stdio",
                command="docker",
                args=args,
            ))

    if mcp_gateway.server_names:
        logger.info(f"Connecting to MCP servers: {mcp_gateway.server_names}")
        try:
            # We wait for MCP connection for up to 10s so tools are available for the first request
            # Local MCPs are usually very fast; remote ones might time out but server should still start
            await asyncio.wait_for(mcp_gateway.connect_all(), timeout=10.0)
            logger.info("Successfully connected to all MCP servers")
        except asyncio.TimeoutError:
            logger.warning("MCP connection timed out after 10.0s. Proceeding with partial/empty tool set.")
        except Exception as e:
            logger.error(f"Failed to connect to MCP servers during startup: {e}")

        # Wrap and register MCP tools (AFTER connection attempt)
        mcp_wrappers = wrap_mcp_tools(mcp_gateway)
        for w in mcp_wrappers:
            try:
                TOOL_REGISTRY.register(w)
            except ValueError as e:
                logger.warning(f"MCP tool registration skipped: {e}")
    else:
        logger.info("No MCP servers configured")

    # 5. Log all registered tools
    logger.info(f"Total tools registered: {TOOL_REGISTRY.count}")
    for name in TOOL_REGISTRY.tool_names:
        tool = TOOL_REGISTRY.get_optional(name)
        if tool:
            logger.info(f"  - {name}: tags={tool.capability_tags}, "
                       f"sandbox={tool.requires_sandbox}, confirm={tool.requires_confirmation}")

    # 6. Run initial health check
    health_statuses = await TOOL_REGISTRY.health_check_all()
    for name, status in health_statuses.items():
        logger.info(f"  - {name} health: {status.status}")

    logger.info("=" * 50)
    logger.info("RawClaw Agent ready!")
    logger.info("=" * 50)

    yield

    # === SHUTDOWN ===
    logger.info("RawClaw Agent shutting down...")
    if mcp_gateway:
        await mcp_gateway.disconnect_all()
    logger.info("Shutdown complete.")


app = FastAPI(title="RawClaw Agent", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health", response_model=dict)
async def health_check() -> dict:
    """Basic health check endpoint."""
    healths = await model_router.get_health()
    return {
        "status": "ok",
        "providers": {k: v.model_dump() for k, v in healths.items()},
        "tools_loaded": TOOL_REGISTRY.count,
    }


@app.get("/api/models")
async def list_models():
    """List available models from all providers."""
    models = await model_router.list_models()
    return {"models": [m.model_dump() for m in models]}


@app.get("/api/tools")
async def list_tools():
    """Returns the schemas for all registered tools."""
    tools = TOOL_REGISTRY.list_tools()
    return {
        "tools": [t.model_dump() for t in tools],
        "count": len(tools),
    }


@app.get("/api/tools/info")
async def list_tools_info():
    """Returns all tools with health status."""
    infos = await TOOL_REGISTRY.list_tools_info()
    return {
        "tools": [info.model_dump() for info in infos],
        "count": len(infos),
    }


@app.get("/api/tools/health")
async def tools_health():
    """Returns the health status of all registered tools."""
    health = await TOOL_REGISTRY.health_check_all()
    return {
        "health": {k: v.model_dump() for k, v in health.items()},
    }


@app.get("/api/tools/{tool_name}")
async def get_tool(tool_name: str):
    """Get details for a specific tool."""
    tool = TOOL_REGISTRY.get_optional(tool_name)
    if not tool:
        return JSONResponse(
            status_code=404,
            content={"error": f"Tool '{tool_name}' not found"},
        )
    return {
        "tool": tool.to_tool_schema().model_dump(),
    }


@app.post("/execute")
async def execute_chat(request: Request, chat_request: ChatRequest):
    """
    Executes a chat turn with support for planning, tool calling, and streaming.
    Uses LangGraph if USE_LANGGRAPH=true, otherwise uses LegacyExecutor.
    """
    from src.config import settings as cfg
    chroma_memory = getattr(request.app.state, "chroma_memory", None)
    knowledge_brain = getattr(request.app.state, "knowledge_brain", None)
    use_langgraph = getattr(request.app.state, "use_langgraph", cfg.USE_LANGGRAPH)

    if use_langgraph:
        from src.graph.executor import LANGGRAPH_EXECUTOR
        executor = LANGGRAPH_EXECUTOR
    else:
        executor = EXECUTOR

    session_id = chat_request.session_id or "default"
    model_id = chat_request.model or cfg.DEFAULT_HIGH_MODEL

    async def event_generator():
        if use_langgraph:
            async for chunk in executor.execute(
                [m.model_dump() for m in chat_request.messages],
                session_id=session_id,
                model_id=model_id,
                chroma_memory=chroma_memory,
                knowledge_brain=knowledge_brain,
            ):
                yield chunk
        else:
            async for chunk in executor.execute(chat_request, chroma_memory, knowledge_brain):
                yield chunk

    return StreamingResponse(
        event_generator(),
        media_type="application/x-ndjson",
    )


@app.post("/execute/task")
async def execute_task(request: TaskExecutionRequest):
    """
    Executes a discrete background task.
    """
    result = await EXECUTOR.run_task(request)
    return result.model_dump()


@app.get("/api/mcp/servers")
async def list_mcp_servers():
    """List connected MCP servers and their tools."""
    if not mcp_gateway:
        return {"servers": [], "connected": False}

    servers = []
    for name in mcp_gateway.server_names:
        server = mcp_gateway._servers.get(name)
        if server:
            servers.append({
                "name": name,
                "connected": server.connected,
                "tool_count": len(server.tools),
                "tools": server.tools,
            })

    return {
        "servers": servers,
        "connected": mcp_gateway.connected_count > 0,
    }


@app.get("/api/mcp/health")
async def mcp_health():
    """Health check for MCP connections."""
    if not mcp_gateway:
        return {
            "connected": False,
            "servers": [],
            "message": "MCP Gateway not configured",
        }

    return {
        "connected": mcp_gateway.connected_count > 0,
        "servers": mcp_gateway.server_names,
        "connected_count": mcp_gateway.connected_count,
    }


@app.post("/api/mcp/connect")
async def mcp_connect(request: Request):
    """
    Connect to an MCP server dynamically.
    Body: { name?: str, transport?: "stdio" | "sse", command?: str, args?: string[], url?: str, env?: object }
    """
    from fastapi import HTTPException
    
    body = await request.json()
    name = body.get("name")
    transport = body.get("transport", "sse")
    command = body.get("command")
    args = body.get("args", [])
    url = body.get("url")
    env = body.get("env", {})
    
    if transport == "sse" and not url:
        raise HTTPException(status_code=400, detail="url is required for SSE transport")
    if transport == "stdio" and not command:
        raise HTTPException(status_code=400, detail="command is required for stdio transport")
    
    if not mcp_gateway:
        raise HTTPException(status_code=500, detail="MCP Gateway not initialized")
    
    try:
        from src.tools.mcp_gateway import MCPServer
        server_name = name or f"mcp-{len(mcp_gateway.server_names)}"
        
        server = MCPServer(
            name=server_name,
            transport=transport,
            command=command,
            args=args,
            url=url,
            env=env,
        )
        mcp_gateway.add_server(server)
        
        await server.connect()
        
        from src.tools.mcp_tool_wrapper import wrap_mcp_tools
        wrappers = wrap_mcp_tools(mcp_gateway)
        for w in wrappers:
            try:
                TOOL_REGISTRY.register(w)
            except ValueError as e:
                logger.warning(f"Tool registration skipped: {e}")
        
        tools_count = len(server.tools)
        
        return {
            "success": True,
            "server_name": server_name,
            "tools_loaded": tools_count,
        }
    except Exception as e:
        logger.error(f"Failed to connect to MCP server: {e}")
        raise HTTPException(status_code=502, detail=f"Connection failed: {str(e)}")


@app.delete("/api/mcp/servers/{name}")
async def mcp_disconnect(request: Request, name: str):
    """Disconnect and remove an MCP server."""
    from fastapi import HTTPException
    
    if not mcp_gateway:
        raise HTTPException(status_code=500, detail="MCP Gateway not initialized")
    
    server = mcp_gateway._servers.get(name)
    if not server:
        raise HTTPException(status_code=404, detail=f"Server '{name}' not found")
    
    try:
        await server.disconnect()
        del mcp_gateway._servers[name]
    except Exception as e:
        logger.warning(f"Error disconnecting server: {e}")
    
    return {"success": True, "server_name": name}


@app.get("/api/skills")
async def list_skills():
    """List installed SKILL.md-based tools."""
    skills = []
    for tool_name in TOOL_REGISTRY.tool_names:
        tool = TOOL_REGISTRY.get_optional(tool_name)
        if tool and tool_name.startswith("skill_"):
            skills.append({
                "name": tool_name.replace("skill_", "", 1),
                "description": tool.description,
                "capabilityTags": tool.capability_tags,
                "parameters": tool.parameters,
                "skillPath": getattr(tool, "_skill_path", None),
            })
    return {"skills": skills}


@app.post("/api/skills/{name}/run")
async def run_skill(name: str, request: Request):
    """Execute a skill tool directly and return its output payload."""
    body = await request.json()
    params = body.get("params", {}) if isinstance(body, dict) else {}
    tool_name = name if name.startswith("skill_") else f"skill_{name}"

    if "task" not in params:
        task_parts = [f"{key}: {value}" for key, value in params.items()]
        params["task"] = "\n".join(task_parts) if task_parts else f"Run skill {name}"

    result = await TOOL_REGISTRY.execute_tool(tool_name, params)
    return {
        "success": result.error is None,
        "result": result.output,
        "error": result.error,
    }


@app.get("/api/memory/stats")
async def memory_stats(request: Request):
    """Return Chroma-backed memory stats for the UI."""
    chroma_memory = getattr(request.app.state, "chroma_memory", None)
    if not chroma_memory:
        return {
            "totalEntries": 0,
            "collections": [],
            "embeddingModel": "memory offline",
        }
    return chroma_memory.get_stats()


@app.post("/api/memory/add")
async def memory_add(request: Request):
    """Add a durable knowledge entry to Chroma memory."""
    chroma_memory = getattr(request.app.state, "chroma_memory", None)
    if not chroma_memory:
        return JSONResponse(status_code=503, content={"error": "Memory not available"})

    body = await request.json()
    entry = chroma_memory.add_document(
        content=body.get("content", ""),
        tags=body.get("tags") or [],
        source=body.get("source"),
        collection=body.get("collection") or "default",
        metadata={"memory_type": body.get("memoryType", "knowledge")},
    )
    return entry


@app.post("/api/memory/search")
async def memory_search_post(request: Request):
    """Search semantic memory with metadata filters."""
    chroma_memory = getattr(request.app.state, "chroma_memory", None)
    knowledge_brain = getattr(request.app.state, "knowledge_brain", None)
    if not chroma_memory:
        return {"results": [], "message": "Memory not available"}

    body = await request.json()
    query = body.get("query", "") or ""
    session_id = body.get("session_id")
    results = chroma_memory.search(
        query=query,
        session_id=session_id,
        n_results=body.get("n_results", 8),
        tags=body.get("tags") or [],
        source=body.get("source"),
        collection=body.get("collection"),
    )

    if knowledge_brain and query.strip():
        retrieval = knowledge_brain.retrieve(
            query=query,
            session_id=session_id,
            collection=body.get("collection"),
            tags=body.get("tags") or [],
            source=body.get("source"),
            limit=2,
        )
        results.extend(retrieval["external"])

    return {"results": results}


@app.get("/api/memory/search")
async def memory_search(request: Request, q: str, session_id: str = None, n: int = 5):
    """Backwards-compatible memory search route."""
    chroma_memory = getattr(request.app.state, "chroma_memory", None)
    knowledge_brain = getattr(request.app.state, "knowledge_brain", None)
    if not chroma_memory:
        return {"results": [], "message": "Memory not available"}

    results = chroma_memory.search(query=q, session_id=session_id, n_results=n)
    if knowledge_brain and q.strip():
        results.extend(knowledge_brain.retrieve(query=q, session_id=session_id, limit=2)["external"])
    return {"results": results}


@app.delete("/api/memory/clear")
async def memory_clear(request: Request, collection: str = None):
    """Clear memory entries from a collection or from the whole knowledge store."""
    chroma_memory = getattr(request.app.state, "chroma_memory", None)
    if not chroma_memory:
        return {"cleared": 0}
    return chroma_memory.clear(collection=collection)


def start():
    """Entry point for running the agent."""
    from src.config import settings
    port = int(os.environ.get("AGENT_PORT", settings.AGENT_PORT))
    reload_enabled = os.environ.get("AGENT_RELOAD", str(getattr(settings, "AGENT_RELOAD", False))).lower() == "true"
    if os.name == "nt" and reload_enabled:
        logger.warning("AGENT_RELOAD=true requested on Windows; disabling reload to avoid multiprocessing permission errors.")
        reload_enabled = False
    uvicorn.run("src.main:app", host="0.0.0.0", port=port, reload=reload_enabled)


if __name__ == "__main__":
    start()
