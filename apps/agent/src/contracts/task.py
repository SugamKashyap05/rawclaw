from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any

class AgentTaskDefinition(BaseModel):
    id: str
    name: str
    description: str
    toolIds: List[str]
    agentId: Optional[str] = None

class TaskExecutionRequest(BaseModel):
    run_id: str
    definition: AgentTaskDefinition
    context: Optional[Dict[str, Any]] = None

class TaskResult(BaseModel):
    run_id: str
    status: str
    output_path: Optional[str] = None
    error_message: Optional[str] = None
    provenance: Optional[Dict[str, Any]] = None
