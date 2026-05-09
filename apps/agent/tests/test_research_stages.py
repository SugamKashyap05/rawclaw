from pathlib import Path
from uuid import uuid4

from src.contracts.tool import ToolResult
from src.executor import Executor
from src.research import (
    ConfidenceRiskModelStage,
    AnswerabilityGateStage,
    AdaptiveFetchLayer,
    AdaptiveResearchStore,
    EvidenceJudgeStage,
    ExtractRouterStage,
    FinalWriterStage,
    MultiAttemptExtractCoordinator,
    PreEvidenceFilterStage,
    ResearchPlannerStage,
)
from src.research.types import AnswerabilityDecision, EvidenceAssessment, ResearchPlan


def _tool_result(output=None, error=None):
    return ToolResult(
        tool_name="test-tool",
        input={},
        output=output,
        error=error,
        duration_ms=1,
        sandboxed=False,
    )


def test_research_planner_classifies_standings_and_expected_fields():
    planner = ResearchPlannerStage(
        build_research_plan=lambda _query: {
            "task_type": "standings_brief",
            "category": "sports_standings",
            "expected_fields": ["team", "position", "points", "nrr", "ranking_movement"],
            "recency_matters": True,
            "comparison_needed": False,
            "fetch_required": True,
            "source_preferences": ["official league table pages", "reputable sports coverage"],
            "focus": ["claims", "rankings"],
            "domain_bias": ["iplt20.com"],
            "exact_structured_data_needed": True,
        },
        build_search_query=lambda _query, apply_domain_bias: "CSK IPL 2026 points table" + (" site:iplt20.com" if apply_domain_bias else ""),
        query_allows_interactive_extraction=lambda _query: False,
    )

    plan = planner.run("Research the latest Chennai Super Kings IPL 2026 points-table situation.")

    assert plan.category == "sports_standings"
    assert plan.needs_freshness is True
    assert plan.expected_fields == ["team", "position", "points", "nrr", "ranking_movement"]
    assert plan.queries
    assert any("site:iplt20.com" in query for query in plan.queries)
    assert "https://www.iplt20.com/matches/points-table" in plan.target_urls


def test_extract_router_chooses_table_backends_for_standings():
    router = ExtractRouterStage(
        rank_search_results=lambda _query, _results: [
            {"url": "https://www.iplt20.com/points-table/men", "score": 12, "item": {}},
            {"url": "https://www.espncricinfo.com/series/ipl-2026-standings", "score": 8, "item": {}},
        ],
        search_result_has_viable_results=lambda _result, _query: True,
    )
    plan = ResearchPlan(
        task_type="standings_brief",
        category="sports_standings",
        queries=["CSK IPL 2026 points table"],
        expected_fields=["team", "position", "points", "nrr", "ranking_movement"],
        fetch_required=True,
        exact_structured_data_needed=True,
    )

    decision = router.run("CSK IPL 2026 points table", plan, _tool_result({"results": [{}, {}]}))

    assert decision.page_kind == "standings/table"
    assert decision.backend_order[:3] == ["crawl4ai", "playwright", "opencli"]
    assert decision.candidate_urls[0] == "https://www.iplt20.com/points-table/men"
    assert decision.should_attempt_extract is True


def test_pre_evidence_filter_prefers_official_results_for_structured_tasks():
    filter_stage = PreEvidenceFilterStage(
        rank_search_results=lambda _query, _results: [
            {
                "url": "https://random.example.com/post",
                "score": 4,
                "item": {
                    "title": "Fan blog recap",
                    "url": "https://random.example.com/post",
                    "snippet": "CSK remain in the race.",
                    "quality_tags": ["search_snippet"],
                },
            },
            {
                "url": "https://www.iplt20.com/matches/points-table",
                "score": 14,
                "item": {
                    "title": "IPL 2026 Points Table",
                    "url": "https://www.iplt20.com/matches/points-table",
                    "snippet": "Official points table.",
                    "quality_tags": ["official_page"],
                },
            },
        ]
    )
    plan = ResearchPlan(
        task_type="standings_brief",
        category="sports_standings",
        fetch_required=True,
        exact_structured_data_needed=True,
        domain_bias=["iplt20.com"],
    )
    search_result = _tool_result(
        {
            "results": [
                {"title": "Fan blog recap", "url": "https://random.example.com/post", "snippet": "CSK remain in the race.", "quality_tags": ["search_snippet"]},
                {"title": "IPL 2026 Points Table", "url": "https://www.iplt20.com/matches/points-table", "snippet": "Official points table.", "quality_tags": ["official_page"]},
            ]
        }
    )

    filtered_result, decision = filter_stage.run("csk standing in ipl point tabel", plan, search_result)

    assert decision.filtered_result_count == 1
    assert decision.preferred_domains == ["iplt20.com"]
    assert filtered_result.output["results"][0]["url"] == "https://www.iplt20.com/matches/points-table"


def test_confidence_risk_model_marks_empty_body_as_refused():
    stage = ConfidenceRiskModelStage()
    plan = ResearchPlan(task_type="page_read", category="technical_research")
    assessment = EvidenceAssessment(relevant=True, usable=False, abstain=True)
    answerability = AnswerabilityDecision(mode="abstain")
    fetch_result = _tool_result(
        {
            "kind": "content",
            "title": "OpenAI API Changelog",
            "content": "[Page returned empty body. JavaScript rendering required.]",
            "wordCount": 0,
            "tier": "failed",
            "confidence": 0.05,
            "jsRenderSuspected": True,
            "jsFallbackDetected": True,
            "jsFallbackReason": 'spa_empty_shell: <div id="__next"></div>',
        }
    )

    decision = stage.run("openai changelog", plan, assessment, answerability, fetch_result)

    assert decision.mode == "refused_answer"
    assert decision.failure_state == "empty_body_js_required"


def test_multi_attempt_extract_coordinator_uses_domain_preference():
    db_dir = Path("apps/agent/tests/artifacts/tmp")
    db_dir.mkdir(parents=True, exist_ok=True)
    db_path = db_dir / f"adaptive-{uuid4().hex}.db"
    store = AdaptiveResearchStore(str(db_path))
    store.record_extract_success(
        url="https://www.python.org/downloads/release/python-3144/",
        page_kind="news/article",
        backend_order=["crawl4ai", "reader", "playwright", "web_fetch"],
        successful_backend="reader",
    )
    layer = AdaptiveFetchLayer(store)
    coordinator = MultiAttemptExtractCoordinator(layer)
    plan = ResearchPlan(task_type="news_summary", category="breaking_news", fetch_required=True)
    decision = ExtractRouterStage(
        rank_search_results=lambda _query, _results: [],
        search_result_has_viable_results=lambda _result, _query: True,
    ).run(
        "python 3.14.4 release notes",
        plan,
        _tool_result(
            {
                "results": [
                    {
                        "title": "Python 3.14.4",
                        "url": "https://www.python.org/downloads/release/python-3144/",
                        "snippet": "Official Python release page.",
                        "quality_tags": ["official_page"],
                    }
                ]
            }
        ),
    )

    attempt_plan = coordinator.run(plan, decision)

    assert attempt_plan
    assert attempt_plan[0].backend_order[0] == "reader"


def test_evidence_judge_marks_official_but_noisy_extract_as_relevant_but_unusable():
    judge = EvidenceJudgeStage(
        extract_search_evidence=lambda _result, query="", max_items=4: [
            {"title": "IPL Points Table", "url": "https://www.iplt20.com/points-table/men", "snippet": "Live points table", "duplicate_source_count": 2}
        ],
        dedupe_evidence=lambda evidence, limit=4: evidence[:limit],
        build_research_evidence_records=lambda _query, _evidence, _fetch: [{"claim": "Live standings update", "rankings": [], "quality_tags": []}],
        cluster_research_records=lambda _records: [{"best_claim": "Live standings update", "rankings": [], "dates": [], "changes": [], "uncertainties": []}],
        evaluate_answerability=lambda _query, _evidence, _fetch, _records, _clusters: {
            "relevant": True,
            "usable": False,
            "sufficient": False,
            "partial": False,
            "abstain": True,
            "fetch_quality": "relevant_but_unusable_fetch",
            "reasons": [
                "Search evidence appears to come from repeated synthetic snippets rather than independent sources.",
                "The official page was relevant, but the extracted content was too noisy or boilerplate-heavy to verify exact details.",
            ],
        },
        cluster_summary_clause=lambda cluster: cluster.get("best_claim", ""),
    )
    plan = ResearchPlan(task_type="standings_brief", category="sports_standings")
    fetch_result = _tool_result(
        {
            "missingFields": ["position", "points", "nrr"],
            "structuredData": {},
        }
    )

    assessment = judge.run("CSK IPL 2026 points table", plan, _tool_result({"results": [{}]}), fetch_result)

    assert assessment.relevant is True
    assert assessment.abstain is True
    assert assessment.duplicate_collapsed is True
    assert assessment.quality == "relevant_but_unusable"
    assert assessment.missing_fields == ["position", "points", "nrr"]


def test_answerability_gate_distinguishes_exact_partial_and_abstain():
    gate = AnswerabilityGateStage()

    exact = gate.run(EvidenceAssessment(sufficient=True, reasons=["verified"]))
    partial = gate.run(EvidenceAssessment(relevant=True, usable=True, partial=True, reasons=["partial evidence"]))
    abstain = gate.run(EvidenceAssessment(relevant=True, usable=False, abstain=True, reasons=["not enough evidence"]))

    assert exact.mode == "exact"
    assert exact.can_answer_exactly is True
    assert partial.mode == "partial"
    assert partial.can_answer_partially is True
    assert abstain.mode == "abstain"
    assert abstain.can_answer_partially is False


def test_update_answerability_uses_official_search_evidence_for_partial_when_extract_fails():
    executor = Executor.__new__(Executor)
    query = "Search the web, fetch pages as needed, and write a compact markdown memo comparing two current OpenAI API updates."
    evidence = [
        {
            "title": "OpenAI API Changelog",
            "url": "https://developers.openai.com/api/docs/changelog",
            "snippet": "GPT-5.5 was introduced to the API and GPT Image 2 launched for image generation.",
            "quality_tags": ["search_snippet", "synthetic_aggregator", "official_page"],
            "duplicate_source_count": 1,
        }
    ]
    records = [
        {
            "claim": "GPT-5.5 was introduced to the API.",
            "quality_tags": ["search_snippet", "synthetic_aggregator", "official_page"],
            "fetch_quality": "",
            "changes": ["introduced"],
            "dates": ["April 26, 2026"],
            "numbers": ["1M token context window"],
            "rankings": [],
            "entities": ["OpenAI", "GPT-5.5"],
            "source_url": "https://developers.openai.com/api/docs/changelog",
        },
        {
            "claim": "GPT Image 2 launched for image generation and editing.",
            "quality_tags": ["search_snippet", "synthetic_aggregator", "official_page"],
            "fetch_quality": "",
            "changes": ["launched"],
            "dates": ["April 26, 2026"],
            "numbers": [],
            "rankings": [],
            "entities": ["OpenAI", "GPT Image 2"],
            "source_url": "https://developers.openai.com/api/docs/changelog",
        },
    ]
    clusters = [
        {
            "best_claim": "GPT-5.5 was introduced to the API.",
            "claims": ["GPT-5.5 was introduced to the API."],
            "changes": {"introduced"},
            "dates": {"April 26, 2026"},
        },
        {
            "best_claim": "GPT Image 2 launched for image generation and editing.",
            "claims": ["GPT Image 2 launched for image generation and editing."],
            "changes": {"launched"},
            "dates": {"April 26, 2026"},
        },
    ]
    fetch_result = _tool_result(output={"status": "error"}, error="No extraction backend produced usable content.")

    answerability = Executor._evaluate_answerability(executor, query, evidence, fetch_result, records, clusters)

    assert answerability["partial"] is True
    assert answerability["abstain"] is False
    assert any("Official-domain search evidence exposed multiple concrete updates" in reason for reason in answerability["reasons"])


def test_breaking_news_answerability_allows_partial_from_search_only_evidence():
    executor = Executor.__new__(Executor)
    query = "search web for news about gta 6 launch"
    evidence = [
        {
            "title": "GTA 6 launch update",
            "url": "https://example.com/gta6-launch",
            "snippet": "April 2026 reports say Rockstar shifted the GTA 6 launch window and outlined what changed in the release timeline.",
            "quality_tags": ["search_snippet"],
            "duplicate_source_count": 1,
        }
    ]
    records = [
        {
            "claim": "April 2026 reports say Rockstar shifted the GTA 6 launch window and outlined what changed in the release timeline.",
            "quality_tags": ["search_snippet"],
            "fetch_quality": "",
            "changes": ["shifted"],
            "dates": ["April 2026"],
            "numbers": [],
            "rankings": [],
            "entities": ["Rockstar", "GTA 6"],
            "source_url": "https://example.com/gta6-launch",
            "source_type": "search",
        }
    ]
    clusters = [
        {
            "best_claim": "Rockstar shifted the GTA 6 launch window in April 2026.",
            "claims": ["Rockstar shifted the GTA 6 launch window in April 2026."],
            "changes": {"shifted"},
            "dates": {"April 2026"},
            "rankings": set(),
            "numbers": set(),
            "uncertainties": set(),
        }
    ]

    answerability = Executor._evaluate_answerability(executor, query, evidence, None, records, clusters)

    assert answerability["partial"] is True
    assert answerability["abstain"] is False
    assert any("Search evidence exposed concrete recent-news signals" in reason for reason in answerability["reasons"])


def test_standings_answerability_abstains_when_only_search_race_language_exists():
    executor = Executor.__new__(Executor)
    query = "Research the latest Chennai Super Kings IPL 2026 points-table situation."
    evidence = [
        {
            "title": "IPL race intensifies",
            "url": "https://www.espncricinfo.com/series/ipl-2026-standings",
            "snippet": "Chennai Super Kings remain in the playoff race and the top-four battle is tightening.",
            "quality_tags": ["search_snippet"],
            "duplicate_source_count": 1,
        }
    ]
    records = [
        {
            "claim": "Chennai Super Kings remain in the playoff race and the top-four battle is tightening.",
            "quality_tags": ["search_snippet"],
            "fetch_quality": "",
            "changes": ["tightening"],
            "dates": [],
            "numbers": [],
            "rankings": ["top four", "playoff race"],
            "entities": ["CSK", "Chennai Super Kings"],
            "source_url": "https://www.espncricinfo.com/series/ipl-2026-standings",
            "source_type": "search",
        }
    ]
    clusters = [
        {
            "best_claim": "Chennai Super Kings remain in the playoff race and the top-four battle is tightening.",
            "claims": ["Chennai Super Kings remain in the playoff race and the top-four battle is tightening."],
            "changes": {"tightening"},
            "dates": set(),
            "rankings": {"top four", "playoff race"},
        }
    ]
    fetch_result = _tool_result(output={"status": "error"}, error="No extraction backend produced usable content.")

    answerability = Executor._evaluate_answerability(executor, query, evidence, fetch_result, records, clusters)

    assert answerability["partial"] is False
    assert answerability["abstain"] is True
    assert any("did not expose a verifiable live table" in reason for reason in answerability["reasons"])


def test_standings_partial_writer_avoids_strongly_grounded_language_without_clean_extract():
    executor = Executor.__new__(Executor)
    query = "Research the latest Chennai Super Kings IPL 2026 points-table situation."
    evidence = [
        {
            "title": "IPL race intensifies",
            "url": "https://www.espncricinfo.com/series/ipl-2026-standings",
            "snippet": "Chennai Super Kings remain in the playoff race and the top-four battle is tightening.",
        }
    ]
    fetch_result = _tool_result(
        output={
            "quality": "extract_garbage",
            "missingFields": ["position", "points", "nrr"],
            "structuredData": {},
        }
    )
    assessment = {
        "relevant": True,
        "usable": True,
        "sufficient": False,
        "partial": True,
        "abstain": False,
        "fetch_quality": "relevant_but_unusable_fetch",
        "reasons": ["The extracted evidence did not expose a verifiable live table."],
        "records": [
            {
                "claim": "Chennai Super Kings remain in the playoff race and the top-four battle is tightening.",
                "source_type": "search",
                "fetch_quality": "",
                "rankings": ["top four", "playoff race"],
                "changes": ["tightening"],
                "numbers": [],
                "dates": [],
                "uncertainties": [],
                "quality_tags": ["search_snippet"],
            }
        ],
        "clusters": [
            {
                "best_claim": "Chennai Super Kings remain in the playoff race and the top-four battle is tightening.",
                "claims": ["Chennai Super Kings remain in the playoff race and the top-four battle is tightening."],
                "rankings": {"top four", "playoff race"},
                "changes": {"tightening"},
                "numbers": set(),
                "dates": set(),
                "uncertainties": set(),
            }
        ],
    }
    answerability = {"mode": "partial", "limitations": ["The extracted evidence did not expose a verifiable live table."]}

    bullets = Executor._synthesize_evidence_bullets(
        executor,
        query,
        evidence,
        fetch_result,
        4,
        "final",
        assessment_override=assessment,
        answerability_override=answerability,
    )
    rendered = "\n".join(bullets)

    assert "The strongest standings evidence highlights" not in rendered
    assert "The extracted sources describe the race" not in rendered
    assert "The evidence is relevant" not in rendered
    assert "The available evidence did not expose a clean full table with exact live positions." in rendered


def test_standings_answerability_allows_partial_when_extract_is_partial_and_structured():
    executor = Executor.__new__(Executor)
    query = "Research the latest Chennai Super Kings IPL 2026 points-table situation."
    evidence = [
        {
            "title": "IPL Points Table",
            "url": "https://www.iplt20.com/matches/points-table",
            "snippet": "Official IPL points table page.",
            "quality_tags": ["official_page"],
            "duplicate_source_count": 1,
        }
    ]
    records = [
        {
            "claim": "team: Chennai Super Kings; position: 6; points: 6; nrr: -0.121",
            "quality_tags": ["official_page"],
            "fetch_quality": "fetch_extract_clean",
            "changes": [],
            "dates": [],
            "numbers": ["6", "6", "-0.121"],
            "rankings": ["position", "standings"],
            "entities": ["CSK", "Chennai Super Kings"],
            "source_url": "https://scores.iplt20.com/ipl/feeds/stats/284-groupstandings.js",
            "source_type": "extract",
        }
    ]
    clusters = [
        {
            "best_claim": "Chennai Super Kings are 6th with 6 points and NRR -0.121.",
            "claims": ["Chennai Super Kings are 6th with 6 points and NRR -0.121."],
            "changes": set(),
            "dates": set(),
            "rankings": {"position", "standings"},
            "numbers": {"6", "-0.121"},
        }
    ]
    fetch_result = _tool_result(
        output={
            "quality": "extract_partial",
            "structuredData": {
                "team": "Chennai Super Kings",
                "position": "6",
                "points": "6",
                "nrr": "-0.121",
            },
            "missingFields": ["ranking_movement"],
        }
    )

    answerability = Executor._evaluate_answerability(executor, query, evidence, fetch_result, records, clusters)

    assert answerability["partial"] is True or answerability["sufficient"] is True
    assert answerability["abstain"] is False


def test_final_writer_returns_markdown_confidence_and_sources():
    writer = FinalWriterStage(
        render_grounded_web_answer=lambda *args, **kwargs: "- Verified update A\n- Verified update B\n- Limitation noted",
        build_source_lines=lambda evidence, limit=3: [f"- {item['title']}: {item['url']}" for item in evidence[:limit]],
        fetch_source_line=lambda _fetch: "- OpenAI API Changelog: https://developers.openai.com/api/docs/changelog",
        is_provider_outage_status=lambda _status: False,
    )
    plan = ResearchPlan(task_type="comparison_memo", category="technical_research")
    assessment = EvidenceAssessment(
        sufficient=True,
        search_evidence=[{"title": "OpenAI API Changelog", "url": "https://developers.openai.com/api/docs/changelog"}],
    )

    draft = writer.run(
        "Compare two OpenAI API updates",
        plan,
        assessment,
        AnswerabilityGateStage().run(EvidenceAssessment(sufficient=True)),
        _tool_result({"results": []}),
        _tool_result({"title": "OpenAI API Changelog"}),
        search_status="ok",
        fetch_status="ok",
    )

    assert draft.markdown.startswith("- Verified update A")
    assert draft.confidence == "grounded"
    assert draft.citations_or_sources


def test_extraction_evidence_gate_classifies_clean_partial_thin_and_failed():
    executor = Executor.__new__(Executor)

    clean = Executor._extract_evidence_gate(
        executor,
        "https://example.com/article tell me about this article",
        _tool_result(
            output={
                "content": " ".join(["clean article body"] * 140),
                "structuredData": {"event": "Headline", "what_changed": "Key change", "date_time": "2026-04-20"},
                "taskType": "page_read",
                "sourceMode": "user_named",
                "pageType": "article",
                "tier": "clean",
                "confidence": 0.92,
                "pageKind": "news/article",
                "missingFields": [],
            }
        ),
    )
    partial = Executor._extract_evidence_gate(
        executor,
        "https://example.com/article tell me about this article",
        _tool_result(
            output={
                "content": " ".join(["partial article body"] * 40),
                "structuredData": {"event": "Headline", "what_changed": "Key change"},
                "taskType": "page_read",
                "sourceMode": "user_named",
                "pageType": "article",
                "tier": "partial",
                "confidence": 0.71,
                "pageKind": "news/article",
                "missingFields": ["date_time"],
            }
        ),
    )
    thin = Executor._extract_evidence_gate(
        executor,
        "https://example.com/article tell me about this article",
        _tool_result(
            output={
                "content": "Headline\nShort summary only.",
                "structuredData": {"event": "Headline", "what_changed": "Short summary only."},
                "taskType": "page_read",
                "sourceMode": "user_named",
                "pageType": "article",
                "tier": "thin",
                "confidence": 0.41,
                "pageKind": "news/article",
                "missingFields": ["date_time"],
            }
        ),
    )
    failed = Executor._extract_evidence_gate(
        executor,
        "https://example.com/article tell me about this article",
        _tool_result(output={"tier": "failed", "confidence": 0.05}, error="No extraction backend produced usable content."),
    )

    assert clean["mode"] == "PROCEED_FULL"
    assert partial["mode"] == "PROCEED_FULL"
    assert thin["mode"] == "PROCEED_CAUTIOUS"
    assert failed["mode"] == "ABSTAIN"
    assert clean["taskType"] == "page_read"
    assert clean["pageType"] == "article"


def test_factual_extract_gate_prefers_user_named_structured_data():
    executor = Executor.__new__(Executor)

    gate = Executor._extract_evidence_gate(
        executor,
        "https://www.iplt20.com/matches/points-table tell me Chennai Super Kings standing",
        _tool_result(
            output={
                "content": "Chennai Super Kings are 6th with 6 points and NRR -0.121.",
                "structuredData": {
                    "team": "Chennai Super Kings",
                    "position": "6",
                    "points": "6",
                    "nrr": "-0.121",
                },
                "taskType": "factual_extract",
                "sourceMode": "user_named",
                "pageType": "data_table",
                "tier": "partial",
                "confidence": 0.64,
                "pageKind": "standings/table",
                "missingFields": ["ranking_movement"],
            }
        ),
    )

    assert gate["mode"] == "PROCEED_FULL"
    assert gate["sourceMode"] == "user_named"
    assert gate["taskType"] == "factual_extract"


def test_direct_page_cautious_answer_stays_within_recovered_fragments():
    executor = Executor.__new__(Executor)
    result = _tool_result(
        output={
            "title": "Ubuntu 26.04 LTS is coming for the developers macOS stole in 2014",
            "content": "Ubuntu 26.04 LTS focuses on developer defaults, modern toolchains, and a more polished desktop experience.",
            "structuredData": {
                "event": "Ubuntu 26.04 LTS is coming for the developers macOS stole in 2014",
                "what_changed": "Ubuntu 26.04 LTS focuses on developer defaults, modern toolchains, and a more polished desktop experience.",
            },
            "taskType": "page_read",
            "sourceMode": "user_named",
            "pageType": "article",
            "quality": "extract_clean",
            "tier": "thin",
            "confidence": 0.44,
            "backendUsed": "web_fetch_raw_html_article",
            "missingFields": ["date_time"],
            "pageKind": "news/article",
        }
    )

    answer = Executor._synthesize_tool_answer(
        executor,
        "https://medium.com/example/dev-article tell me about this article",
        "web_extract",
        result,
    )

    assert "Based on the recovered article fragments" in answer
    assert "Ubuntu 26.04 LTS focuses on developer defaults" in answer
    assert "recovered page fragments directly support" in answer


def test_direct_homepage_page_read_lists_visible_items():
    executor = Executor.__new__(Executor)
    result = _tool_result(
        output={
            "title": "The Times of India",
            "content": "Top Story One\nTop Story Two\nMarkets edge higher after policy update.\nSports roundup from the IPL.",
            "structuredData": {
                "page_items": [
                    "Top Story One",
                    "Top Story Two",
                    "Markets edge higher after policy update.",
                    "Sports roundup from the IPL.",
                ]
            },
            "taskType": "page_read",
            "sourceMode": "user_named",
            "pageType": "homepage",
            "quality": "extract_clean",
            "tier": "clean",
            "confidence": 0.9,
            "pageKind": "general",
            "missingFields": [],
        }
    )

    answer = Executor._synthesize_tool_answer(
        executor,
        "https://timesofindia.indiatimes.com/ what on the page",
        "web_extract",
        result,
    )

    assert "Here are the main visible items" in answer
    assert "- Top Story One" in answer
    assert "- Top Story Two" in answer


def test_update_answerability_records_breakdown_corroboration_and_freshness():
    executor = Executor.__new__(Executor)
    query = "Search the web, fetch pages as needed, and write a compact markdown memo comparing two current OpenAI API updates."
    evidence = [
        {
            "title": "OpenAI API Changelog",
            "url": "https://developers.openai.com/api/docs/changelog",
            "snippet": "GPT-5.5 was introduced to the API on April 26, 2026. GPT Image 2 launched the same day.",
            "quality_tags": ["search_snippet", "official_page"],
            "duplicate_source_count": 1,
        },
        {
            "title": "OpenAI Platform Notes",
            "url": "https://platform.openai.com/docs/changelog",
            "snippet": "Latest platform notes describe GPT-5.5 and GPT Image 2 as current updates.",
            "quality_tags": ["search_snippet", "official_page"],
            "duplicate_source_count": 1,
        },
    ]
    records = Executor._build_research_evidence_records(executor, query, evidence, None)
    clusters = Executor._cluster_research_records(executor, records)

    answerability = Executor._evaluate_answerability(executor, query, evidence, None, records, clusters)

    assert answerability["evidence_breakdown"]["search_snippet"] >= 2
    assert answerability["corroboration_mode"] in {"multi_source_partial", "multi_source_corroborated"}
    assert answerability["freshness_summary"] in {"fresh_signals_present", "freshness_mixed"}


def test_guided_web_research_detects_plain_results_queries_and_forces_grounded_skill():
    executor = Executor()
    query = "hello ji search for who won begal election 2026"

    assert executor._should_use_guided_web_research(query) is True
    assert executor._query_requires_fetch(query) is True

    tool_call = executor._maybe_force_skill_tool_call(
        query,
        [
            {
                "function": {
                    "name": "skill_grounded-web-summary",
                }
            }
        ],
    )

    assert tool_call is not None
    assert tool_call.tool_name == "skill_grounded-web-summary"


def test_election_result_query_is_cleaned_without_forcing_official_bias():
    executor = Executor()
    query = "hello ji search for who won Bengal election 2026 and who will be the next cm"

    plan = executor.research.planner.run(query)
    search_query = executor._build_search_query(query, apply_domain_bias=True)
    direct_route = executor._find_direct_route(query)

    assert plan.category == "election_results"
    assert plan.fetch_required is True
    assert plan.official_source_requested is False
    assert "https://results.eci.gov.in/" not in plan.target_urls
    assert "hello ji" not in search_query.lower()
    assert "west bengal election 2026" in search_query.lower()
    assert "official eci" not in search_query.lower()
    assert "site:results.eci.gov.in" not in search_query.lower()
    assert direct_route is None


def test_election_result_query_keeps_official_bias_when_user_asks_for_eci():
    executor = Executor()
    query = "search for who won the west bengal election in 2026 from the official ECI results page"

    plan = executor.research.planner.run(query)
    search_query = executor._build_search_query(query, apply_domain_bias=True)

    assert plan.category == "election_results"
    assert plan.official_source_requested is True
    assert "https://results.eci.gov.in/" in plan.target_urls
    assert "site:results.eci.gov.in" in search_query.lower()


def test_guardian_fallback_prefers_structured_research_failure_when_evidence_exists():
    executor = Executor()
    answer = executor._build_guardian_fallback_answer(
        "search for who won west bengal election 2026",
        {"evidence": "- web_search: 4 result(s) available"},
        "Guardian rejected the draft because it was not grounded enough.",
        {
            "plan": {"category": "breaking_news"},
            "search_status": "ok",
            "fetch_status": "not_attempted",
            "search_evidence": [
                {
                    "title": "Election Commission of India",
                    "url": "https://results.eci.gov.in/",
                    "snippet": "Official counting and result dashboard.",
                }
            ],
            "assessment_reasons": ["the gathered evidence remained contradictory and too thin to verify the winner confidently"],
        },
    )

    assert "- I searched for:" in answer
    assert "- Strongest source signals:" in answer
    assert "Election Commission of India" in answer
    assert "- Best next check:" in answer


def test_guardian_fallback_suppresses_empty_strongest_source_signals_for_js_portal_failures():
    executor = Executor()
    fetch_result = _tool_result(
        output={
            "url": "https://results.eci.gov.in/",
            "jsRenderSuspected": True,
            "fetchFailureKind": "js_render_required",
        }
    )

    answer = executor._build_guardian_fallback_answer(
        "search for who won the west bengal election in 2026",
        {"evidence": "- web_search: 2 result(s) available"},
        "Guardian rejected the draft because it was not grounded enough.",
        {
            "plan": {"category": "election_results"},
            "search_status": "ok",
            "fetch_status": "relevant_but_unusable_fetch",
            "search_evidence": [],
            "fetch_result": fetch_result,
            "assessment_reasons": [],
            "evidence_state": "extraction_failed",
        },
    )

    assert "- Strongest source signals:" not in answer
    assert "could not read its content reliably" in answer
    assert "alternative news sources" in answer


def test_determine_research_evidence_state_covers_all_expected_literals():
    executor = Executor()
    js_fetch_result = _tool_result(
        output={
            "url": "https://results.eci.gov.in/",
            "jsRenderSuspected": True,
            "fetchFailureKind": "js_render_required",
        }
    )
    thin_fetch_result = _tool_result(
        output={
            "url": "https://example.com/report",
            "content": "A page was reached but the content is still thin.",
        }
    )
    clean_fetch_result = _tool_result(
        output={
            "url": "https://www.ndtv.com/india-news/west-bengal-election-results-2026",
            "content": "The article says the seat tally was declared on 29 April 2026 and names the winning alliance.",
        }
    )

    assert executor._determine_research_evidence_state(
        "search for who won the west bengal election in 2026",
        [],
        js_fetch_result,
        "ok",
        "relevant_but_unusable_fetch",
    ) == "extraction_failed"
    assert executor._determine_research_evidence_state(
        "search for who won the west bengal election in 2026",
        [{"title": "NDTV", "url": "https://ndtv.com", "snippet": "Seat tally article"}],
        thin_fetch_result,
        "ok",
        "relevant_but_unusable_fetch",
    ) == "evidence_thin"
    assert executor._determine_research_evidence_state(
        "search for who won the west bengal election in 2026",
        [{"title": "NDTV", "url": "https://ndtv.com", "snippet": "Seat tally article"}],
        clean_fetch_result,
        "ok",
        "ok",
    ) == "evidence_found"
    assert executor._determine_research_evidence_state(
        "search for who won the west bengal election in 2026",
        [],
        None,
        "ok",
        "not_attempted",
    ) == "no_results"


def test_render_grounded_web_answer_uses_extraction_failed_branch_on_abstain_path():
    executor = Executor()
    search_result = _tool_result(output={"results": []})
    fetch_result = _tool_result(
        output={
            "url": "https://results.eci.gov.in/",
            "content": "",
            "jsRenderSuspected": True,
            "fetchFailureKind": "js_render_required",
        }
    )

    answer = executor._render_grounded_web_answer(
        "search for who won the west bengal election in 2026",
        search_result,
        fetch_result=fetch_result,
        search_status="ok",
        fetch_status="relevant_but_unusable_fetch",
        answerability_override={"mode": "abstain"},
        assessment_override={"reasons": ["the page did not expose enough dated numeric evidence for the requested current count"]},
    )

    assert "could not read its content reliably" in answer
    assert "JavaScript" in answer
    assert "Strongest source signals:" not in answer


def test_render_grounded_web_answer_uses_no_results_branch_on_abstain_path():
    executor = Executor()
    search_result = _tool_result(output={"results": []})

    answer = executor._render_grounded_web_answer(
        "search for who won the west bengal election in 2026",
        search_result,
        fetch_result=None,
        search_status="ok",
        fetch_status="not_attempted",
        answerability_override={"mode": "abstain"},
        assessment_override={"reasons": []},
    )

    assert "My search did not return pages with specific enough evidence" in answer
    assert "Strongest source signals:" not in answer


def test_render_grounded_web_answer_returns_clean_prose_for_plain_research_queries():
    executor = Executor()
    search_result = _tool_result(output={"results": []})
    query = "search for who won the west bengal election in 2026 and who will be the next cm of bengal"

    answer = executor._render_grounded_web_answer(
        query,
        search_result,
        fetch_result=None,
        search_status="ok",
        fetch_status="ok",
        assessment_override={
            "relevant": True,
            "usable": True,
            "sufficient": True,
            "partial": False,
            "abstain": False,
            "clusters": [
                {
                    "best_claim": "<b>West Bengal Election Result 2026:</b> BJP won 206 seats in a historic sweep and is set to form the next government in Bengal after the results were declared on May 4, 2026, confirming a decisive mandate for the party across the state.",
                    "claims": [],
                    "rankings": {"winner"},
                    "changes": {"historic sweep"},
                    "numbers": {"206"},
                    "dates": {"May 4, 2026"},
                    "uncertainties": set(),
                }
            ],
        },
        answerability_override={"mode": "exact"},
    )

    assert "<b>" not in answer
    assert "</b>" not in answer
    assert "..." not in answer
    assert not answer.lstrip().startswith("- ")
    assert "West Bengal Election Result 2026:" in answer
    assert "BJP won 206 seats" in answer
    assert "May 4, 2026" in answer


def test_render_grounded_web_answer_preserves_bullets_when_query_explicitly_requests_them():
    executor = Executor()
    search_result = _tool_result(output={"results": []})
    query = "search for who won the west bengal election in 2026 and who will be the next cm of bengal in 3 bullets"

    answer = executor._render_grounded_web_answer(
        query,
        search_result,
        fetch_result=None,
        search_status="ok",
        fetch_status="ok",
        assessment_override={
            "relevant": True,
            "usable": True,
            "sufficient": True,
            "partial": False,
            "abstain": False,
            "clusters": [
                {
                    "best_claim": "<b>West Bengal Election Result 2026:</b> BJP won 206 seats in a historic sweep and is set to form the next government in Bengal after the results were declared on May 4, 2026.",
                    "claims": [],
                    "rankings": {"winner"},
                    "changes": {"historic sweep"},
                    "numbers": {"206"},
                    "dates": {"May 4, 2026"},
                    "uncertainties": set(),
                }
            ],
        },
        answerability_override={"mode": "exact"},
    )

    assert answer.lstrip().startswith("- ")
    assert "<b>" not in answer
    assert "</b>" not in answer
    assert "..." not in answer


def test_normalize_web_answer_preserves_prose_when_query_does_not_request_structured_format():
    executor = Executor()
    query = "Write a 500 word story titled The Echoes of Willow Creek. It should be complete prose, not an outline, not bullets, not a plan."
    draft = (
        "# The Echoes of Willow Creek\n\n"
        "The town of Willow Creek did not appear on most modern maps, and for those who lived there, that was precisely the point. "
        "It was a place of heavy mist and weeping willows that dipped their silver branches into a current that flowed slower than time itself.\n\n"
        "Elias had returned to Willow Creek after twenty years of fleeing its suffocating stillness. "
        "He came back as a man grayed by the city, carrying a suitcase full of regrets and a heart that had forgotten how to beat in rhythm with the earth."
    )

    normalized = executor._normalize_web_answer_for_request(draft, query)

    assert normalized.startswith("# The Echoes of Willow Creek")
    assert not normalized.lstrip().startswith("- ")
    assert "Elias had returned to Willow Creek" in normalized


def test_local_review_does_not_require_bullets_when_query_says_not_bullets():
    executor = Executor()
    query = "Write a 500 word story titled The Echoes of Willow Creek. It should be complete prose, not an outline, not bullets, not a plan."
    prose = (
        "# The Echoes of Willow Creek\n\n"
        "The town of Willow Creek did not appear on most modern maps, and for those who lived there, that was precisely the point. "
        "Elias returned after twenty years away, carrying regrets that felt heavier than the river stones under the bridge."
    )

    review = executor._local_review_output(prose, latest_user_query=query, review_context={})

    assert review["approved"] is True


def test_failed_extract_fallback_query_does_not_relock_to_eci_site():
    executor = Executor()

    fallback_query = executor._build_search_query_from_failed_url_extract(
        "https://results.eci.gov.in/",
        "search for who won the west bengal election in 2026 and who will be the next cm of bengal",
    )

    assert "site:results.eci.gov.in" not in fallback_query.lower()
    assert "official eci" not in fallback_query.lower()
    assert "news" in fallback_query.lower()


def test_extract_router_diversifies_same_domain_results_for_election_queries():
    executor = Executor()
    query = "search for who won the west bengal election in 2026 and who will be the next cm of bengal"
    plan = executor.research.planner.run(query)
    search_result = _tool_result(
        output={
            "results": [
                {"title": "ECI dashboard", "url": "https://results.eci.gov.in/", "snippet": "Official counting dashboard."},
                {"title": "ECI seat tally", "url": "https://eci.gov.in/results", "snippet": "Election results summary."},
                {"title": "CEO West Bengal", "url": "https://ceowestbengal.nic.in/results", "snippet": "State election office dashboard."},
                {"title": "NDTV report", "url": "https://www.ndtv.com/india-news/west-bengal-election-results-2026", "snippet": "Seat tally and CM race."},
            ]
        }
    )

    filtered_result, _decision = executor.research.pre_evidence_filter.run(query, plan, search_result)
    extraction_decision = executor.research.router.run(query, plan, filtered_result)

    domains = [url.split("/")[2] for url in extraction_decision.candidate_urls]
    assert any("ndtv.com" in domain for domain in domains)
    assert len(set(domains)) == len(domains)


def test_extract_router_requests_broader_search_when_only_js_portal_domains_exist():
    executor = Executor()
    query = "search for who won the west bengal election in 2026"
    plan = executor.research.planner.run(query)
    search_result = _tool_result(
        output={
            "results": [
                {"title": "ECI dashboard", "url": "https://results.eci.gov.in/", "snippet": "Official counting dashboard."},
                {"title": "ECI summary", "url": "https://eci.gov.in/results", "snippet": "Election results summary."},
                {"title": "CEO West Bengal", "url": "https://ceowestbengal.nic.in/results", "snippet": "State election office dashboard."},
            ]
        }
    )

    filtered_result, _decision = executor.research.pre_evidence_filter.run(query, plan, search_result)
    extraction_decision = executor.research.router.run(query, plan, filtered_result)

    assert extraction_decision.needs_query_broadening is True
    assert extraction_decision.should_attempt_extract is False
