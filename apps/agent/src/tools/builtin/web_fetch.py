import logging
import socket
import time
from typing import Any, Dict, Optional, Tuple
from urllib.parse import urlparse

import httpx

from src.tools.base_tool import BaseTool
from src.contracts.tool import ToolResult

logger = logging.getLogger("rawclaw.tools.web_fetch")

BLOCKED_PREFIXES = [
    "127.", "0.", "10.", "192.168.", "172.16.", "172.17.", "172.18.",
    "172.19.", "172.20.", "172.21.", "172.22.", "172.23.", "172.24.",
    "172.25.", "172.26.", "172.27.", "172.28.", "172.29.", "172.30.",
    "172.31.", "169.254.", "::1", "fc00:", "fd"
]

def _is_safe_url(url: str) -> Tuple[bool, str]:
    """
    Validates a URL against common SSRF targets and schemes.
    This check runs before any HTTP connection is attempted.
    """
    try:
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https"):
            return False, f"Scheme '{parsed.scheme}' is not allowed"
        hostname = parsed.hostname
        if not hostname:
            return False, "URL has no hostname"
        
        resolved_ip = socket.gethostbyname(hostname)
        for prefix in BLOCKED_PREFIXES:
            if resolved_ip.startswith(prefix):
                return False, f"Blocked: {resolved_ip} is a private/loopback address"
        return True, ""
    except socket.gaierror:
        parsed = urlparse(url)
        return False, f"Could not resolve hostname: {parsed.hostname}"
    except Exception as e:
        return False, f"URL validation error: {str(e)}"

def _strip_html_to_text(html: str) -> str:
    """Simple regex based text extraction for HTML."""
    import re
    import html as html_module
    
    # Remove script and style elements
    text = re.sub(r'<(script|style)[^>]*>.*?</\1>', '', html, flags=re.DOTALL | re.IGNORECASE)
    # Remove all other tags
    text = re.sub(r'<[^>]+>', ' ', text)
    # Decode HTML entities
    text = html_module.unescape(text)
    # Collapse whitespace
    text = re.sub(r'\s+', ' ', text).strip()
    return text

class WebFetchTool(BaseTool):
    """
    Fetches the content of a public URL and returns readable text.
    Implements strict SSRF protection to prevent access to internal services.
    """
    name = "web_fetch"
    description = "Fetches the content of a public URL and returns readable text"
    parameters = {
        "type": "object",
        "properties": {
            "url": { "type": "string", "description": "The URL to fetch" },
            "extract_text": { "type": "boolean", "default": True }
        },
        "required": ["url"]
    }
    capability_tags = ["fetch", "read", "network"]
    requires_confirmation = False
    requires_sandbox = False

    async def execute(self, input: Dict[str, Any]) -> ToolResult:
        start_time = time.monotonic()
        url = input.get("url", "")
        extract_text = input.get("extract_text", True)
        
        # 1. SSRF PROTECTION CHECK
        is_safe, reason = _is_safe_url(url)
        if not is_safe:
            return ToolResult(
                success=False,
                error=reason,
                tool_name=self.name,
                duration_ms=0,
                sandboxed=False
            )

        # 2. FETCH IMPLEMENTATION
        try:
            async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
                # We limit the read to 100KB (102400 bytes)
                async with client.stream("GET", url) as response:
                    response.raise_for_status()
                    
                    chunks = []
                    bytes_read = 0
                    max_bytes = 102400
                    
                    async for chunk in response.aiter_bytes():
                        chunks.append(chunk)
                        bytes_read += len(chunk)
                        if bytes_read >= max_bytes:
                            break
                    
                    full_body = b"".join(chunks).decode("utf-8", errors="replace")
                    
                    content_type = response.headers.get("Content-Type", "")
                    title = ""
                    if "text/html" in content_type:
                        import re
                        match = re.search(r'<title[^>]*>(.*?)</title>', full_body, re.IGNORECASE | re.DOTALL)
                        if match:
                            title = match.group(1).strip()
                        
                        if extract_text:
                            content = _strip_html_to_text(full_body)
                        else:
                            content = full_body
                    else:
                        content = full_body
                        
                    duration_ms = int((time.monotonic() - start_time) * 1000)
                    return ToolResult(
                        success=True,
                        tool_name=self.name,
                        output={
                            "url": str(response.url),
                            "title": title,
                            "content": content,
                            "word_count": len(content.split()),
                            "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
                        },
                        duration_ms=duration_ms,
                        sandboxed=False
                    )
                    
        except httpx.HTTPError as e:
            return ToolResult(
                success=False,
                error=f"HTTP error: {str(e)}",
                tool_name=self.name,
                duration_ms=int((time.monotonic() - start_time) * 1000),
                sandboxed=False
            )
        except Exception as e:
            return ToolResult(
                success=False,
                error=f"Fetch failed: {str(e)}",
                tool_name=self.name,
                duration_ms=int((time.monotonic() - start_time) * 1000),
                sandboxed=False
            )

    async def health(self) -> str:
        """Attempt a HEAD request to https://example.com to verify network access."""
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.head("https://example.com")
                return "ok" if resp.is_success else "degraded"
        except Exception:
            return "degraded"
