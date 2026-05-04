import pytest

from src.contracts.tool import ToolCall, ToolResult
from src.executor import Executor
from src.research.types import ResearchPlan


def _tool_result(name: str, output=None, error=None, source_url=None):
    return ToolResult(
        tool_name=name,
        input={},
        output=output,
        error=error,
        duration_ms=1,
        sandboxed=False,
        source_url=source_url,
    )


@pytest.fixture
def executor() -> Executor:
    return Executor()


@pytest.mark.parametrize(
    ("query", "expected_category", "expected_task_type", "expected_fields"),
    [
        (
            "Search the web for the latest SpaceX Starship updates and present a concise markdown answer with 3 bullets.",
            "product_company_updates",
            "news_summary",
            ["update_items", "dates", "what_changed"],
        ),
        (
            "Research the latest Chennai Super Kings IPL 2026 points-table situation. Use web search, fetch the strongest page you find, and present a markdown summary with 4 bullets plus one uncertainty note if needed.",
            "sports_standings",
            "standings_brief",
            ["team", "position", "points", "nrr", "ranking_movement"],
        ),
        (
            "Search the web, fetch pages as needed, and write a compact markdown memo comparing two current OpenAI API updates. Present:\n## Findings\n- 3 bullets\n## Sources Used\n- short source list",
            "technical_research",
            "comparison_memo",
            ["update_items", "dates", "what_changed"],
        ),
        (
            "Research current OpenAI API updates, but be careful: ignore generic markdown editors, docs about the browser Fetch API, or unrelated tool pages. Use search plus fetch as needed and return markdown with sections:\n## Findings\n- 3 bullets\n## Why These Sources\n- 2 bullets",
            "technical_research",
            "technical_update_digest",
            ["update_items", "dates", "what_changed"],
        ),
        (
            "Do a harder web brief on India's IPL 2026 standings race. Search the web, fetch the strongest page, and return only markdown:\n## Research Notes\n- 3 bullets\n## Final\n- 3 bullets\nIf evidence is incomplete, explicitly say what could not be verified.",
            "sports_standings",
            "research_notes_final",
            ["team", "position", "points", "nrr", "ranking_movement"],
        ),
    ],
)
def test_research_planner_classifies_each_workflow(
    executor: Executor,
    query: str,
    expected_category: str,
    expected_task_type: str,
    expected_fields: list[str],
):
    plan = executor.research.planner.run(query)

    assert plan.lane == "research"
    assert plan.category == expected_category
    assert plan.task_type == expected_task_type
    assert plan.expected_fields == expected_fields
    assert plan.queries
    assert plan.needs_freshness is True


@pytest.mark.parametrize(
    ("plan", "expected_page_kind", "expected_backend_prefix"),
    [
        (
            ResearchPlan(
                task_type="browser_task",
                category="general_fact_finding",
                allow_interaction=True,
                fetch_required=True,
            ),
            "interactive/authenticated",
            ["opencli", "playwright"],
        ),
        (
            ResearchPlan(
                task_type="standings_brief",
                category="sports_standings",
                expected_fields=["team", "position", "points", "nrr"],
                fetch_required=True,
                exact_structured_data_needed=True,
            ),
            "standings/table",
            ["crawl4ai", "playwright"],
        ),
        (
            ResearchPlan(
                task_type="comparison_memo",
                category="technical_research",
                expected_fields=["update_items", "dates", "what_changed"],
                fetch_required=True,
            ),
            "docs/changelog",
            ["crawl4ai", "reader"],
        ),
        (
            ResearchPlan(
                task_type="news_summary",
                category="breaking_news",
                expected_fields=["event", "date_time", "what_changed"],
                fetch_required=True,
            ),
            "news/article",
            ["crawl4ai", "reader"],
        ),
    ],
)
def test_extract_router_routes_each_page_kind(
    executor: Executor,
    plan: ResearchPlan,
    expected_page_kind: str,
    expected_backend_prefix: list[str],
):
    search_result = _tool_result(
        "web_search",
        output={
            "results": [
                {"url": "https://example.com/one", "title": "Primary Result", "snippet": "Primary relevant snippet."},
                {"url": "https://example.com/two", "title": "Secondary Result", "snippet": "Secondary relevant snippet."},
            ]
        },
    )

    decision = executor.research.router.run("workflow routing query", plan, search_result)

    assert decision.page_kind == expected_page_kind
    assert decision.backend_order[: len(expected_backend_prefix)] == expected_backend_prefix
    assert decision.candidate_urls
    assert decision.should_attempt_extract is True


@pytest.mark.parametrize(
    ("query", "search_results", "fetch_result", "expected_sections", "expected_mode"),
    [
        (
            "Search the web for the latest SpaceX Starship updates and present a concise markdown answer with 3 bullets.",
            [
                {
                    "title": "SpaceX Starship Updates",
                    "url": "https://www.spacex.com/vehicles/starship/",
                    "snippet": "Starship is preparing next-generation vehicles with improved thermal protection and higher propellant capacity. Recent milestones include tower catch readiness and increased flight cadence for lunar support.",
                    "quality_tags": ["search_snippet", "official_page"],
                }
            ],
            _tool_result("web_extract", output={"status": "error"}, error="No extraction backend produced usable content."),
            [],
            {"exact", "partial", "abstain"},
        ),
        (
            "Research the latest Chennai Super Kings IPL 2026 points-table situation. Use web search, fetch the strongest page you find, and present a markdown summary with 4 bullets plus one uncertainty note if needed.",
            [
                {
                    "title": "IPL 2026 Points Table",
                    "url": "https://www.iplt20.com/points-table/men",
                    "snippet": "IPL 2026 teams are competing for the top four playoff spots, with net run rate separating sides level on points. The official table updates after each completed match.",
                    "quality_tags": ["search_snippet", "official_page"],
                }
            ],
            _tool_result("web_extract", output={"status": "error"}, error="No extraction backend produced usable content."),
            [],
            {"partial", "abstain"},
        ),
        (
            "Search the web, fetch pages as needed, and write a compact markdown memo comparing two current OpenAI API updates. Present:\n## Findings\n- 3 bullets\n## Sources Used\n- short source list",
            [
                {
                    "title": "OpenAI API Changelog",
                    "url": "https://developers.openai.com/api/docs/changelog",
                    "snippet": "GPT-5.5 was introduced to the API with a larger context window, and GPT Image 2 launched for image generation and editing. The Agents SDK also gained sandboxed execution support.",
                    "quality_tags": ["search_snippet", "synthetic_aggregator", "official_page"],
                }
            ],
            _tool_result("web_extract", output={"status": "error"}, error="No extraction backend produced usable content."),
            ["## Findings", "## Sources Used"],
            {"partial", "exact", "abstain"},
        ),
        (
            "Do a full web research brief using search plus fetch/browse as needed, then present the final answer in markdown.\n\nTopic: what are the most important current developments around India's IPL 2026 standings race? Return only markdown with sections:\n## Research Notes\n## Draft\n## Final",
            [
                {
                    "title": "IPL 2026 Points Table",
                    "url": "https://www.iplt20.com/points-table/men",
                    "snippet": "The IPL 2026 standings race is centered on the top four playoff spots, and net run rate is a major separator when teams share the same points total.",
                    "quality_tags": ["search_snippet", "official_page"],
                }
            ],
            _tool_result("web_extract", output={"status": "error"}, error="No extraction backend produced usable content."),
            ["## Research Notes", "## Draft", "## Final"],
            {"partial", "abstain"},
        ),
        (
            "Research current OpenAI API updates, but be careful: ignore generic markdown editors, docs about the browser Fetch API, or unrelated tool pages. Use search plus fetch as needed and return markdown with sections:\n## Findings\n- 3 bullets\n## Why These Sources\n- 2 bullets",
            [
                {
                    "title": "OpenAI API Changelog",
                    "url": "https://developers.openai.com/api/docs/changelog",
                    "snippet": "GPT-5.5 was introduced to the API and GPT Image 2 launched for image generation and editing. Additional platform updates include Agents SDK improvements for sandbox execution.",
                    "quality_tags": ["search_snippet", "synthetic_aggregator", "official_page"],
                }
            ],
            _tool_result("web_extract", output={"status": "error"}, error="No extraction backend produced usable content."),
            ["## Findings", "## Why These Sources"],
            {"partial", "exact", "abstain"},
        ),
        (
            "Do a harder web brief on India's IPL 2026 standings race. Search the web, fetch the strongest page, and return only markdown:\n## Research Notes\n- 3 bullets\n## Final\n- 3 bullets\nIf evidence is incomplete, explicitly say what could not be verified.",
            [
                {
                    "title": "IPL 2026 Points Table",
                    "url": "https://www.iplt20.com/points-table/men",
                    "snippet": "The standings race remains fluid because the official table updates after each match and net run rate remains a key tiebreaker in the top-four playoff chase.",
                    "quality_tags": ["search_snippet", "official_page"],
                }
            ],
            _tool_result("web_extract", output={"status": "error"}, error="No extraction backend produced usable content."),
            ["## Research Notes", "## Final"],
            {"partial", "abstain"},
        ),
    ],
)
def test_internal_research_workflow_matrix_completes_without_errors(
    executor: Executor,
    query: str,
    search_results: list[dict],
    fetch_result: ToolResult,
    expected_sections: list[str],
    expected_mode: set[str],
):
    plan = executor.research.planner.run(query)
    selected_query = plan.queries[0]
    search_result = _tool_result("web_search", output={"results": search_results, "status": "ok"})

    decision = executor.research.router.run(selected_query, plan, search_result)
    assessment = executor.research.judge.run(selected_query, plan, search_result, fetch_result)
    gate = executor.research.answerability_gate.run(assessment)
    draft = executor.research.final_writer.run(
        query,
        plan,
        assessment,
        gate,
        search_result,
        fetch_result,
        search_status="ok",
        fetch_status="execution_failure" if fetch_result.error else "ok",
    )

    normalized = executor._normalize_web_answer_for_request(draft.markdown, query)
    review = executor._local_review_output(
        normalized,
        query,
        review_context={"evidence": f"results={assessment.search_evidence}"},
    )

    assert gate.mode in expected_mode
    assert decision.backend_order
    assert assessment.relevant is True
    assert normalized.strip()
    assert draft.citations_or_sources
    for section in expected_sections:
        assert section.lower() in normalized.lower()
    assert review["approved"] is True, review["feedback"]


def test_non_research_workflow_helpers_cover_memory_tool_and_interaction_paths(executor: Executor):
    memory_answer = executor._maybe_answer_from_direct_memory(
        "According to your records, what is the identifier associated with PROJECT_VANGUARD?",
        [{"content": "PROJECT_VANGUARD: The project identifier is 'X-DELTA-9-GHOST'."}],
    )
    assert memory_answer == "According to my records, the identifier is X-DELTA-9-GHOST."

    assert executor._query_allows_interactive_extraction("Open the dashboard after login and click notifications.") is True
    assert executor._should_use_guided_web_research("Search the web for the latest SpaceX Starship updates.") is True
    assert executor._query_requires_fetch("Research current OpenAI API updates and return markdown with sections.") is True
    assert executor._should_force_search_then_fetch("Open the official IPL 2026 points table page") is True
    assert executor._should_use_guided_web_research("csk standing in ipl point tabel") is True
    assert executor._query_requires_fetch("csk standing in ipl point tabel") is True
    assert executor._should_force_search_then_fetch("csk standing in ipl point tabel") is True

    forced_search = executor._maybe_force_tool_call("Search the web for the latest SpaceX Starship updates")
    forced_extract = executor._maybe_force_tool_call("Open https://developers.openai.com/api/docs/changelog")
    forced_extract_from_bare_url = executor._maybe_force_tool_call(
        "https://medium.com/@canartuc/ubuntu-26-04-lts-is-coming-for-the-developers-macos-stole-in-2014-32cd86377a64\n\n"
        "tell me the key points in brief not of this article"
    )
    forced_extract_from_article_prompt = executor._maybe_force_tool_call(
        "https://medium.com/@canartuc/ubuntu-26-04-lts-is-coming-for-the-developers-macos-stole-in-2014-32cd86377a64 tell me about this artical"
    )
    forced_extract_from_generic_page_prompt = executor._maybe_force_tool_call(
        "https://www.msn.com/en-in/sports/cricket/rinku-singh-creates-history-breaks-ms-dhoni-s-15-year-old-record-during-lsg-vs-kkr-tie/ar-AA21MNqQ what on this"
    )
    forced_extract_from_homepage_prompt = executor._maybe_force_tool_call(
        "https://timesofindia.indiatimes.com/ tell me the top newss"
    )
    forced_read = executor._maybe_force_tool_call("Read README.md")
    forced_time = executor._maybe_force_tool_call("What is the current local date and time?")

    assert isinstance(forced_search, ToolCall)
    assert forced_search.tool_name == "web_search"
    assert isinstance(forced_extract, ToolCall)
    assert forced_extract.tool_name == "web_extract"
    assert isinstance(forced_extract_from_bare_url, ToolCall)
    assert forced_extract_from_bare_url.tool_name == "web_extract"
    assert forced_extract_from_bare_url.input["url"] == "https://medium.com/@canartuc/ubuntu-26-04-lts-is-coming-for-the-developers-macos-stole-in-2014-32cd86377a64"
    assert isinstance(forced_extract_from_article_prompt, ToolCall)
    assert forced_extract_from_article_prompt.tool_name == "web_extract"
    assert forced_extract_from_article_prompt.input["url"] == "https://medium.com/@canartuc/ubuntu-26-04-lts-is-coming-for-the-developers-macos-stole-in-2014-32cd86377a64"
    assert isinstance(forced_extract_from_generic_page_prompt, ToolCall)
    assert forced_extract_from_generic_page_prompt.tool_name == "web_extract"
    assert forced_extract_from_generic_page_prompt.input["url"].startswith("https://www.msn.com/")
    assert isinstance(forced_extract_from_homepage_prompt, ToolCall)
    assert forced_extract_from_homepage_prompt.tool_name == "web_extract"
    assert forced_extract_from_homepage_prompt.input["url"] == "https://timesofindia.indiatimes.com/"
    assert forced_extract_from_homepage_prompt.input["taskType"] == "page_read"
    assert forced_extract_from_homepage_prompt.input["sourceMode"] == "user_named"
    assert isinstance(forced_read, ToolCall)
    assert forced_read.tool_name == "read_file"
    assert isinstance(forced_time, ToolCall)
    assert forced_time.tool_name == "get_datetime"


def test_live_sports_query_builder_preserves_year_team_and_metrics(executor: Executor):
    query = "do a web search to find out about ipl 2026 csk match points with how many wins and losses"

    built = executor._build_search_query(query, apply_domain_bias=False)
    lowered = built.lower()

    assert "2026" in built
    assert "ipl" in lowered
    assert "chennai super kings" in lowered
    assert "points table" in lowered or "standings" in lowered
    assert "wins" in lowered
    assert "losses" in lowered


def test_source_ranking_prefers_official_ipl_table_sources(executor: Executor):
    ranked = executor._rank_search_results(
        "IPL 2026 Chennai Super Kings points table wins losses",
        [
            {
                "title": "Wikipedia IPL page",
                "url": "https://en.wikipedia.org/wiki/2026_Indian_Premier_League",
                "snippet": "Background article.",
            },
            {
                "title": "IPL 2026 Points Table",
                "url": "https://www.iplt20.com/matches/points-table",
                "snippet": "Official table with points and net run rate.",
                "quality_tags": ["official_page"],
            },
            {
                "title": "CSK season recap",
                "url": "https://example.com/csk-recap",
                "snippet": "Fan recap of the season.",
            },
        ],
    )

    assert ranked
    assert ranked[0]["url"] == "https://www.iplt20.com/matches/points-table"


def test_direct_route_matches_ipl_csk_points_request(executor: Executor):
    route = executor._find_direct_route("ipl 2026 csk match points with how many wins and losses")

    assert route is not None
    assert route["url"] == "https://www.iplt20.com/matches/points-table"
    assert route["taskType"] == "factual_extract"
    assert route["pageKind"] == "standings/table"
    assert route["expectedFields"] == ["team", "position", "points", "nrr", "ranking_movement"]


def test_typo_standings_query_still_classifies_as_sports_research(executor: Executor):
    plan = executor.research.planner.run("csk standing in ipl point tabel")

    assert plan.category == "sports_standings"
    assert plan.task_type == "standings_brief"
    assert plan.fetch_required is True
    assert plan.exact_structured_data_needed is True
    assert "https://www.iplt20.com/matches/points-table" in plan.target_urls


def test_meta_task_classification_prompt_is_answered_directly():
    executor = Executor()

    answer = executor._maybe_force_reasoning_answer(
        'Jarvis, explain whether this question should be handled as page_read, factual_extract, or research: '
        '“Open the official IPL 2026 points table page and tell me Chennai Super Kings standing.”'
    )

    assert answer is not None
    assert "This should be handled as `factual_extract`." in answer
    assert "It is not `research`" in answer
    assert "source mode would likely be `hybrid`" in answer


def test_self_capability_prompt_is_answered_from_local_context():
    executor = Executor()

    answer = executor._maybe_force_reasoning_answer(
        "Jarvis, explain what you can do now after the latest system upgrades. Keep it short and concrete."
    )

    assert answer is not None
    assert "local-first JARVIS-style assistant" in answer
    assert "web research when the request is truly external or current" in answer
    assert executor._classify_pre_web_intent(
        "Jarvis, explain what you can do now after the latest system upgrades. Keep it short and concrete."
    ) == "self_capability"


def test_ambiguous_top_news_prompt_requests_clarification():
    executor = Executor()

    answer = executor._maybe_force_reasoning_answer("Jarvis, tell me the top news.")

    assert answer == "Do you want general web news, or top news from a specific site?"
    assert executor._classify_pre_web_intent("Jarvis, tell me the top news.") == "clarification_needed"


def test_preferred_read_page_mode_biases_runtime_context():
    executor = Executor()
    executor._active_request_chat_controls = {
        "preferredWebMode": "read_page",
        "toolUseMode": "auto",
        "permissionMode": "workspace_default",
        "selectedTools": [],
        "selectedPlugins": [],
        "planMode": False,
    }

    context = executor._web_runtime_context(
        "https://www.iplt20.com/matches/points-table tell me Chennai Super Kings standing",
        explicit_url=True,
    )

    assert context["taskType"] == "factual_extract"
    assert context["preferredWebMode"] == "read_page"


def test_selected_tools_limit_relevant_tool_selection():
    executor = Executor()
    executor._active_request_chat_controls = {
        "preferredWebMode": "auto",
        "toolUseMode": "limited",
        "permissionMode": "workspace_default",
        "selectedTools": ["web_extract"],
        "selectedPlugins": [],
        "planMode": False,
    }

    selected = executor._select_relevant_tools_for_request(
        "read this page and summarize it",
        [
            {"type": "function", "function": {"name": "web_search", "description": "Search the web"}},
            {"type": "function", "function": {"name": "web_extract", "description": "Read a specific page"}},
        ],
    )

    assert [tool["function"]["name"] for tool in selected] == ["web_extract"]
