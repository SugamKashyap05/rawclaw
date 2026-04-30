from src.research.types import AnswerabilityDecision, EvidenceAssessment


class AnswerabilityGateStage:
    def run(self, assessment: EvidenceAssessment) -> AnswerabilityDecision:
        if assessment.sufficient:
            return AnswerabilityDecision(
                mode="exact",
                limitations=assessment.reasons[:3],
                can_answer_exactly=True,
                can_answer_partially=True,
            )

        if assessment.partial or (assessment.relevant and assessment.usable and not assessment.abstain):
            return AnswerabilityDecision(
                mode="partial",
                limitations=assessment.reasons[:4],
                can_answer_exactly=False,
                can_answer_partially=True,
            )

        return AnswerabilityDecision(
            mode="abstain",
            limitations=assessment.reasons[:4],
            can_answer_exactly=False,
            can_answer_partially=False,
        )
