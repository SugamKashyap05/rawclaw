from src.tools.builtin.smart_web_search import SmartWebSearchTool


def test_extract_results_supports_mcp_structured_content_shape():
    tool = SmartWebSearchTool()
    output = {
        "structuredContent": {
            "results": [
                {
                    "headline": "GTA 6 launch news roundup",
                    "href": "https://example.com/gta6-launch",
                    "summary": "Rockstar shared new launch-window details for GTA 6.",
                }
            ]
        }
    }

    extracted = tool._extract_results(output)
    normalized = tool._normalize_results(extracted, source="web-search")

    assert len(extracted) == 1
    assert normalized
    assert normalized[0]["title"] == "GTA 6 launch news roundup"
    assert normalized[0]["url"] == "https://example.com/gta6-launch"
    assert "launch-window details" in normalized[0]["snippet"]


def test_extract_results_supports_mcp_result_wrapper_shape():
    tool = SmartWebSearchTool()
    output = {
        "result": {
            "organic": [
                {
                    "title": "Rockstar update on GTA 6",
                    "link": "https://example.com/rockstar-gta6",
                    "description": "A fresh Rockstar statement discussed GTA 6 timing.",
                }
            ]
        }
    }

    extracted = tool._extract_results(output)
    normalized = tool._normalize_results(extracted, source="web-search")

    assert len(extracted) == 1
    assert normalized[0]["url"] == "https://example.com/rockstar-gta6"
    assert normalized[0]["title"] == "Rockstar update on GTA 6"


def test_fallback_queries_expand_gta6_news_queries():
    tool = SmartWebSearchTool()

    variants = tool._fallback_queries("search web for news about gta 6 launch")

    assert any("GTA 6 launch latest news Rockstar" == item for item in variants)
    assert any("Rockstar GTA 6 release date launch update" == item for item in variants)
    assert any("GTA VI launch news" == item for item in variants)
