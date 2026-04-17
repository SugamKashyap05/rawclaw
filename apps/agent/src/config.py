import os
from typing import Optional
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    # Agent Config
    AGENT_PORT: int = 8001
    CHROMA_HOST: str = "localhost"
    CHROMA_PORT: int = 8010
    
    # Provider URLs
    OLLAMA_BASE_URL: str = "http://localhost:11434"
    
    # API Keys
    ANTHROPIC_API_KEY: Optional[str] = None
    OPENAI_API_KEY: Optional[str] = None
    
    # Models
    DEFAULT_LOW_MODEL: str = "ollama/llama3"
    DEFAULT_MEDIUM_MODEL: str = "anthropic/claude-3-haiku-20240307"
    DEFAULT_HIGH_MODEL: str = "anthropic/claude-3-sonnet-20240229"

    # ChromaDB Vector Memory
    CHROMA_PERSIST_DIR: str = "./data/chroma"
    CHROMA_COLLECTION: str = "rawclaw_memory"

    # LangGraph Config
    USE_LANGGRAPH: bool = False
    SQLITE_CHECKPOINTER_PATH: str = "./data/checkpoints.db"
    ENABLE_WIKIPEDIA_RAG: bool = True
    AGENT_RELOAD: bool = False

    class Config:
        env_file = [".env", "../../.env"]
        extra = "ignore"

try:
    from typing import Optional
    settings = Settings()
except Exception:
    # Fallback if pydantic-settings not installed
    class Settings:
        AGENT_PORT = int(os.environ.get("AGENT_PORT", "8000"))
        OLLAMA_BASE_URL = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434")
        ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY")
        OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY")
        DEFAULT_LOW_MODEL = "ollama/llama3"
        DEFAULT_MEDIUM_MODEL = "anthropic/claude-3-haiku-20240307"
        DEFAULT_HIGH_MODEL = "anthropic/claude-3-sonnet-20240229"
        CHROMA_PERSIST_DIR = os.environ.get("CHROMA_PERSIST_DIR", "./data/chroma")
        CHROMA_COLLECTION = os.environ.get("CHROMA_COLLECTION", "rawclaw_memory")
        USE_LANGGRAPH = os.environ.get("USE_LANGGRAPH", "false").lower() == "true"
        SQLITE_CHECKPOINTER_PATH = os.environ.get("SQLITE_CHECKPOINTER_PATH", "./data/checkpoints.db")
        ENABLE_WIKIPEDIA_RAG = os.environ.get("ENABLE_WIKIPEDIA_RAG", "true").lower() == "true"
        AGENT_RELOAD = os.environ.get("AGENT_RELOAD", "false").lower() == "true"
    settings = Settings()
