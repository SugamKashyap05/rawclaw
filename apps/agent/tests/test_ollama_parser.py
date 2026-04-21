import pytest
from src.models.providers.ollama import _extract_textual_tool_calls

def test_extract_minimax_format():
    content = '<minimax:tool_call>{"name": "web_search", "arguments": {"query": "test"}}</minimax:tool_call> Some text'
    cleaned, tools = _extract_textual_tool_calls(content)
    assert tools == [{"name": "web_search", "arguments": {"query": "test"}}]
    assert cleaned.strip() == "Some text"

def test_extract_tool_code_ruby_style():
    content = "<tool_code> { tool => 'web_search', args => { query => 'IPL 2024' } } </tool_code> Here is the info"
    cleaned, tools = _extract_textual_tool_calls(content)
    assert tools[0]["name"] == "web_search"
    assert tools[0]["arguments"]["query"] == "IPL 2024"
    assert "Here is the info" in cleaned

def test_extract_tool_code_json_style_current_failure():
    # This currently FAILS as the regex expects =>
    content = '<tool_code> { "tool": "web_search", "args": { "query": "IPL 2025" } } </tool_code>'
    cleaned, tools = _extract_textual_tool_calls(content)
    # The current regexes might miss this if they strictly look for =>
    assert len(tools) > 0
    assert tools[0]["name"] == "web_search"

def test_preserves_edit_suggestion_tags():
    content = "I will edit the file. <edit_suggestion>New content here</edit_suggestion> Done."
    cleaned, tools = _extract_textual_tool_calls(content)
    assert tools == []
    # VERY IMPORTANT: <edit_suggestion> should NOT be stripped by tool cleaners
    assert "<edit_suggestion>" in cleaned
    assert "</edit_suggestion>" in cleaned

def test_malformed_xml_handling():
    content = "<tool_code> { tool => 'search' } No closing tag"
    cleaned, tools = _extract_textual_tool_calls(content)
    assert tools == []
    assert content in cleaned
