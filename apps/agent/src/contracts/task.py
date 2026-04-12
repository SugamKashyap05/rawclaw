from pydantic import BaseModel
from typing import List, Literal

class TaskRequest(BaseModel):
    """Represents a task request context."""
    task_id: str
    definition: str

class TaskResult(BaseModel):
    """Represents a discrete task execution output."""
    task_id: str
    run_id: str
    status: Literal['pending', 'success', 'failed']
    output: str
    provenance: List[str]
