from src.contracts.tool import ToolResult
from src.executor import Executor
from src.research import (
    AnswerabilityGateStage,
    EvidenceJudgeStage,
    ExtractRouterStage,
    FinalWriterStage,
    ResearchPlannerStage,
)
from src.research.types import EvidenceAssessment, ResearchPlan


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
