from src.research.answerability import AnswerabilityGateStage
from src.research.judge import EvidenceJudgeStage
from src.research.planner import ResearchPlannerStage
from src.research.router import ExtractRouterStage
from src.research.writer import FinalWriterStage


class InternalResearchCoordinator:
    def __init__(
        self,
        planner: ResearchPlannerStage,
        router: ExtractRouterStage,
        judge: EvidenceJudgeStage,
        answerability_gate: AnswerabilityGateStage,
        final_writer: FinalWriterStage,
    ) -> None:
        self.planner = planner
        self.router = router
        self.judge = judge
        self.answerability_gate = answerability_gate
        self.final_writer = final_writer
