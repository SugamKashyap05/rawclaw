from src.tools.builtin.web_fetch import _extract_meaningful_content

# Test with the placeholder content scenario
test_html = '''
<html>
<body>
<div>TBD Qualifier 1 TBD TBD TBD</div>
<div>to follow all the LIVE action from TATA WPL 2026</div>
<div>to follow all the LIVE action from TATA WPL 2026</div>
<div>to follow all the LIVE action from TATA WPL 2026</div>
<div>to follow all the LIVE action from TATA WPL 2026</div>
<div>to follow all the LIVE action from TATA WPL 2026</div>
<div>to follow all the LIVE action from TATA WPL 2026</div>
<div>to follow all the LIVE action from TATA WPL 2026</div>
<div>to follow all the LIVE action from TATA WPL 2026</div>
<div>--></div>
<div></div>
<div>TBD Eliminator TBD TBD TBD</div>
<div>As per current points table</div>
<div>Points Table Points Table Points Table</div>
</body>
</html>
'''

result = _extract_meaningful_content(test_html)
print("EXTRACTION RESULT:")
print(result)