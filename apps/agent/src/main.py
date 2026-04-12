"""
RawClaw Agent — FastAPI application entry point.

Phase 3 wiring:
  - SandboxConfig loaded and logged at startup
  - Built-in tools registered automatically on import
  - MCP gateway connected if configured
  - Tool health endpoints exposed
  - Executor handles confirmation gates and provenance
"""
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

# Tool subsystem imports (auto-registers built-in tools)
from src.tools.registry import TOOL_REGISTRY
from src.tools.mcp_gateway import MCPGateway
from src.tools.mcp_tool_wrapper import wrap_mcp_tools
from src.tools.skill_loader import SkillLoader
from src.executor import EXECUTOR

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(name)s %(levelname)s %(message)s",
)
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

    # 2. Import built-in tools (already auto-registered via __init__.py)
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

    # 4. Initialize MCP gateway if configured
    global mcp_gateway
    docker_mcp_url = os.getenv("DOCKER_MCP_URL")
    if docker_mcp_url:
        logger.info(f"MCP Gateway configured: {docker_mcp_url}")
        mcp_gateway = MCPGateway()
        mcp_gateway.load_config()
        await mcp_gateway.connect_all()

        # Wrap and register MCP tools
        mcp_wrappers = wrap_mcp_tools(mcp_gateway)
        for w in mcp_wrappers:
            try:
                TOOL_REGISTRY.register(w)
            except ValueError as e:
                logger.warning(f"MCP tool registration skipped: {e}")
    else:
        logger.info("No MCP Gateway URL configured, skipping MCP connection")

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
async def execute_chat(request: ChatRequest):
    """
    Executes a chat turn with support for planning, tool calling, and streaming.
    """
    async def event_generator():
        async for chunk in EXECUTOR.execute(request):
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


def start():
    """Entry point for running the agent."""
    port = int(os.environ.get("AGENT_PORT", "8000"))
    uvicorn.run("src.main:app", host="0.0.0.0", port=port, reload=True)


if __name__ == "__main__":
    start()