"""
FetchUrlTool — Fetches content from a URL with SSRF protection.

Security:
  - Resolves hostname BEFORE connecting to block private/loopback IPs
  - Blocks: 127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16,
            169.254.0.0/16, 0.0.0.0/8, ::1, fc00::/7, fe80::/10
  - No sandbox needed (outbound HTTP only)
  - No confirmation needed
Tags: fetch, read, network
"""
import ipaddress
import logging
import socket
import time
from typing import Any, Dict
from urllib.parse import urlparse

import httpx

from src.tools.base_tool import BaseTool
from src.contracts.tool import ToolResult

logger = logging.getLogger("rawclaw.tools.fetch")

# Maximum response size (100KB for text extraction)
MAX_RESPONSE_SIZE = 102_400
# Request timeout (seconds)
FETCH_TIMEOUT = 15

# Blocked IP networks (SSRF protection)
BLOCKED_NETWORKS = [
    ipaddress.ip_network("127.0.0.0/8"),      # Loopback
    ipaddress.ip_network("10.0.0.0/8"),        # Private Class A
    ipaddress.ip_network("172.16.0.0/12"),     # Private Class B
    ipaddress.ip_network("192.168.0.0/16"),    # Private Class C
    ipaddress.ip_network("169.254.0.0/16"),    # Link-local
    ipaddress.ip_network("0.0.0.0/8"),         # Current network
    ipaddress.ip_network("::1/128"),           # IPv6 loopback
    ipaddress.ip_network("fc00::/7"),          # IPv6 unique local
    ipaddress.ip_network("fe80::/10"),         # IPv6 link-local
]


def _is_blocked_ip(ip_str: str) -> bool:
    """Check if an IP address falls within any blocked network."""
    try:
        addr = ipaddress.ip_address(ip_str)
        return any(addr in network for network in BLOCKED_NETWORKS)
    except ValueError:
        return True  # If we can't parse it, block it


def _resolve_and_check(hostname: str) -> str:
    """
    Resolve hostname to IP and check against SSRF blocklist.
    This happens BEFORE any HTTP request is made.

    Returns the resolved IP or raises ValueError.
    """
    try:
        resolved_ips = socket.getaddrinfo(hostname, None)
        for family, _, _, _, sockaddr in resolved_ips:
            ip = sockaddr[0]
            if _is_blocked_ip(ip):
                raise ValueError(
                    f"Blocked: private/loopback addresses not allowed. "
                    f"Hostname {hostname} resolves to {ip}"
                )
        return resolved_ips[0][4][0]
    except socket.gaierror:
        raise ValueError(f"DNS resolution failed for hostname: {hostname}")


def _strip_html_to_text(html: str) -> str:
    """Strip HTML to readable text. Simple implementation without external deps."""
    import re
    # Remove script and style elements
    text = re.sub(r'<(script|style)[^>]*>.*?</\1>', '', html, flags=re.DOTALL | re.IGNORECASE)
    # Remove HTML tags
    text = re.sub(r'<[^>]+>', ' ', text)
    # Decode HTML entities
    import html as html_module
    text = html_module.unescape(text)
    # Collapse whitespace
    text = re.sub(r'\s+', ' ', text).strip()
    return text


class FetchUrlTool(BaseTool):
    name = "web_fetch"
    description = "Fetches the content of a URL and extracts readable text. Blocks requests to private/internal networks for security."
    parameters = {
        "type": "object",
        "properties": {
            "url": {
                "type": "string",
                "description": "The URL to fetch. Must be http:// or https://.",
            },
            "extract_text": {
                "type": "boolean",
                "description": "Whether to extract readable text from HTML. Default: true.",
                "default": True,
            },
        },
        "required": ["url"],
    }
    capability_tags = ["fetch", "read", "network"]
    requires_sandbox = False
    requires_confirmation = False

    async def execute(self, input: Dict[str, Any]) -> ToolResult:
        start = time.time()
        url = input.get("url", "")
        extract_text = input.get("extract_text", True)

        # --- Validate URL scheme ---
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https"):
            return ToolResult(
                tool_name=self.name,
                input=input,
                error=f"Invalid URL scheme: {parsed.scheme}. Only http:// and https:// are allowed.",
                duration_ms=round((time.time() - start) * 1000, 2),
                sandboxed=False,
            )

        if not parsed.hostname:
            return ToolResult(
                tool_name=self.name,
                input=input,
                error="Invalid URL: no hostname found.",
                duration_ms=round((time.time() - start) * 1000, 2),
                sandboxed=False,
            )

        # --- SSRF check: resolve hostname and block private IPs ---
        try:
            _resolve_and_check(parsed.hostname)
        except ValueError as e:
            return ToolResult(
                tool_name=self.name,
                input=input,
                error=str(e),
                duration_ms=round((time.time() - start) * 1000, 2),
                sandboxed=False,
            )

        # --- Fetch ---
        try:
            async with httpx.AsyncClient(
                timeout=FETCH_TIMEOUT,
                follow_redirects=True,
                max_redirects=5,
            ) as client:
                resp = await client.get(url)
                resp.raise_for_status()

                content_type = resp.headers.get("content-type", "")
                raw_body = resp.text[:MAX_RESPONSE_SIZE]

                # Extract title from HTML if possible
                title = ""
                if "text/html" in content_type:
                    import re
                    title_match = re.search(r'<title[^>]*>([^<]+)</title>', raw_body, re.IGNORECASE)
                    if title_match:
                        title = title_match.group(1).strip()

                # Extract text if requested and HTML
                if extract_text and "text/html" in content_type:
                    content = _strip_html_to_text(raw_body)
                else:
                    content = raw_body

                word_count = len(content.split())

                return ToolResult(
                    tool_name=self.name,
                    input=input,
                    output={
                        "url": str(resp.url),
                        "title": title,
                        "content": content[:MAX_RESPONSE_SIZE],
                        "word_count": word_count,
                        "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                        "content_type": content_type,
                    },
                    duration_ms=round((time.time() - start) * 1000, 2),
                    sandboxed=False,
                    source_url=str(resp.url),
                    provenance_hint={"content_type": content_type, "word_count": word_count},
                )

        except httpx.HTTPStatusError as e:
            return ToolResult(
                tool_name=self.name,
                input=input,
                error=f"HTTP {e.response.status_code}: {e.response.reason_phrase}",
                duration_ms=round((time.time() - start) * 1000, 2),
                sandboxed=False,
            )
        except httpx.TimeoutException:
            return ToolResult(
                tool_name=self.name,
                input=input,
                error=f"Request timed out after {FETCH_TIMEOUT}s",
                duration_ms=round((time.time() - start) * 1000, 2),
                sandboxed=False,
            )
        except Exception as e:
            return ToolResult(
                tool_name=self.name,
                input=input,
                error=f"Fetch failed: {str(e)}",
                duration_ms=round((time.time() - start) * 1000, 2),
                sandboxed=False,
            )