import os
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    # Agent Config
    AGENT_PORT: int = 8000
    
    # Provider URLs
    OLLAMA_BASE_URL: str = "http://localhost:11434"
    
    # API Keys
    ANTHROPIC_API_KEY: Optional[str] = None
    OPENAI_API_KEY: Optional[str] = None
    
    # Models
    DEFAULT_LOW_MODEL: str = "ollama/llama3"
    DEFAULT_MEDIUM_MODEL: str = "anthropic/claude-3-haiku-20240307"
    DEFAULT_HIGH_MODEL: str = "anthropic/claude-3-sonnet-20240229"

    class Config:
        env_file = ".env"

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
    settings = Settings()
