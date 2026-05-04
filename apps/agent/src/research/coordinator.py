from src.research.answerability import AnswerabilityGateStage
from src.research.confidence import ConfidenceRiskModelStage
from src.research.extract_coordinator import MultiAttemptExtractCoordinator
from src.research.judge import EvidenceJudgeStage
from src.research.planner import ResearchPlannerStage
from src.research.pre_evidence import PreEvidenceFilterStage
from src.research.router import ExtractRouterStage
from src.research.writer import FinalWriterStage


class InternalResearchCoordinator:
    def __init__(
        self,
        planner: ResearchPlannerStage,
        pre_evidence_filter: PreEvidenceFilterStage,
        router: ExtractRouterStage,
        multi_attempt_extract: MultiAttemptExtractCoordinator,
        judge: EvidenceJudgeStage,
        answerability_gate: AnswerabilityGateStage,
        confidence_risk_model: ConfidenceRiskModelStage,
        final_writer: FinalWriterStage,
    ) -> None:
        self.planner = planner
        self.pre_evidence_filter = pre_evidence_filter
        self.router = router
        self.multi_attempt_extract = multi_attempt_extract
        self.judge = judge
        self.answerability_gate = answerability_gate
        self.confidence_risk_model = confidence_risk_model
        self.final_writer = final_writer
