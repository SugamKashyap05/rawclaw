import asyncio
import concurrent.futures
import hashlib
import logging
import os
import socket
import ssl
import time
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urljoin, urlparse
from urllib.robotparser import RobotFileParser

import httpx
from charset_normalizer import from_bytes

from src.contracts.tool import ToolResult
from src.tools.base_tool import BaseTool
from src.tools.registry import TOOL_REGISTRY

logger = logging.getLogger("rawclaw.tools.web_fetch")

BLOCKED_PREFIXES = [
    "127.", "0.", "10.", "192.168.", "172.16.", "172.17.", "172.18.",
    "172.19.", "172.20.", "172.21.", "172.22.", "172.23.", "172.24.",
    "172.25.", "172.26.", "172.27.", "172.28.", "172.29.", "172.30.",
    "172.31.", "169.254.", "::1", "fc00:", "fd",
]

DNS_RESOLVE_TIMEOUT = 5.0
DEFAULT_TIMEOUT = 15.0
DEFAULT_CONNECT_TIMEOUT = 5.0
DEFAULT_MAX_BYTES = 512 * 1024
CACHE_TTL_SECONDS = 5 * 60
BROWSER_SETTLE_TIMEOUT_MS = 2000
BROWSER_FALLBACK_TOOL_CANDIDATES = ("browser_fetch", "browser_open", "browser_navigate")

BROWSERISH_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
    "Accept-Encoding": "gzip, deflate, br",
    "DNT": "1",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
}

JS_FALLBACK_SIGNALS = [
    "interactive scripts did not run",
    "javascript is disabled",
    "requires javascript to be enabled",
    "please enable javascript",
    "this page requires javascript",
    "javascript must be enabled",
    "noscript fallback",
    "scripting must be enabled",
]

SPA_SIGNALS = [
    '<div id="root"></div>',
    '<div id="app"></div>',
    '<div id="__next"></div>',
    '<noscript>you need to enable javascript</noscript>',
    '<noscript>you need javascript enabled</noscript>',
]


def _ipv4_transport() -> httpx.AsyncHTTPTransport:
    return httpx.AsyncHTTPTransport(retries=0, local_address="0.0.0.0")


def _detect_js_fallback_reason(text: str) -> Optional[str]:
    window = str(text or "")[:2000].lower()
    for signal in JS_FALLBACK_SIGNALS:
        if signal.lower() in window:
            return signal
    return None


def _detect_spa_empty_shell_reason(raw_html: str, extracted_text: str) -> Optional[str]:
    raw_window = str(raw_html or "")[:2000].lower()
    visible_text = str(extracted_text or "").strip()
    word_count = len(visible_text.split())
    if word_count > 0 and len(visible_text) >= 100:
        return None
    for signal in SPA_SIGNALS:
        if signal.lower() in raw_window:
            return f"spa_empty_shell: {signal}"
    if word_count == 0:
        return "empty_body_after_200"
    return None


class BrowserFallbackUnavailableError(RuntimeError):
    pass


@dataclass
class _ResolvedUrlInfo:
    is_safe: bool
    reason: str
    hostname: str
    resolved_ip: str
    is_public: bool


@dataclass
class _CachedFetchEntry:
    result: ToolResult
    stored_at: float


async def _resolve_url_info(url: str) -> _ResolvedUrlInfo:
    try:
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https"):
            return _ResolvedUrlInfo(False, f"Scheme '{parsed.scheme}' is not allowed", "", "", False)
        hostname = parsed.hostname or ""
        if not hostname:
            return _ResolvedUrlInfo(False, "URL has no hostname", "", "", False)

        try:
            loop = asyncio.get_running_loop()
            addrinfo = await asyncio.wait_for(
                loop.getaddrinfo(hostname, None, family=socket.AF_INET),
                timeout=DNS_RESOLVE_TIMEOUT,
            )
        except asyncio.TimeoutError:
            return _ResolvedUrlInfo(False, f"DNS resolution timed out for hostname: {hostname}", hostname, "", False)
        except socket.gaierror:
            return _ResolvedUrlInfo(False, f"Could not resolve hostname: {hostname}", hostname, "", False)

        if not addrinfo:
            return _ResolvedUrlInfo(False, f"Could not resolve hostname: {hostname}", hostname, "", False)

        resolved_ip = addrinfo[0][4][0]
        for prefix in BLOCKED_PREFIXES:
            if resolved_ip.startswith(prefix):
                return _ResolvedUrlInfo(False, f"Blocked: {resolved_ip} is a private/loopback address", hostname, resolved_ip, False)
        return _ResolvedUrlInfo(True, "", hostname, resolved_ip, True)
    except Exception as exc:
        parsed = urlparse(url)
        return _ResolvedUrlInfo(False, f"URL validation error: {exc}", parsed.hostname or "", "", False)


async def _is_safe_url(url: str) -> Tuple[bool, str]:
    info = await _resolve_url_info(url)
    return info.is_safe, info.reason


def _extract_meaningful_content(html: str) -> str:
    import html as html_module
    import re

    patterns_to_remove = [
        r"<(script|style|header|nav|footer|aside|form|iframe)[^>]*>.*?</\1>",
        r"<!--.*?-->",
        r"<noscript[^>]*>.*?</noscript>",
        r"<meta[^>]*>",
        r"<link[^>]*>",
        r"<svg[^>]*>.*?</svg>",
        r"<img[^>]*/?>",
    ]

    text = html
    for pattern in patterns_to_remove:
        text = re.sub(pattern, "", text, flags=re.DOTALL | re.IGNORECASE)

    boilerplate_container_patterns = [
        r"<div[^>]*(class|id)=[\"']*(menu|navigation|nav|footer|sidebar|ad|banner|cookie|promo|widget|popup|modal|overlay|lightbox|tooltip|notification)[^>]*>.*?</div>",
        r"<div[^>]*(class|id)=[\"']*(social|share|comment|related|sidebar|widget)[^>]*>.*?</div>",
        r"<span[^>]*(class|id)=[\"']*(icon|button|badge|label|tag)[^>]*>.*?</span>",
        r"<li[^>]*(class|id)=[\"']*(social|share|menu)[^>]*>.*?</li>",
    ]

    for pattern in boilerplate_container_patterns:
        text = re.sub(pattern, "", text, flags=re.DOTALL | re.IGNORECASE)

    text = re.sub(r"<br\s*/?>", "\n", text)
    text = re.sub(r"<[^>]+>", " ", text)
    text = html_module.unescape(text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n\s*\n\s*\n+", "\n\n", text)

    unwanted_patterns = [
        r"home\s+about\s+contact\s+services",
        r"menu\s+.*?\s+menu",
        r"points\s+table\s+points\s+table",
        r"(to follow all the live action from.*?){2,}",
        r"(follow.*?live.*?action.*?){3,}",
        r"[>\-=~]{3,}",
        r"[Ã¢â‚¬Â¢\-Ã¢â‚¬â€œÃ¢â‚¬â€]{2,}",
        r"all rights reserved.*?(?:\d{4})?",
        r"cookie policy.*?privacy",
        r"subscribe.*?newsletter",
        r"\s*[|]\s*[|]\s*[|]\s*",
        r"\s*[/]\s*[/]\s*[/]\s*",
        r"copy\s+all\s+years",
        r"no\s+(?:results|matches|data|information).*?found",
        r"loading\.\.\.?",
        r"please wait\.\.\.?",
    ]

    for pattern in unwanted_patterns:
        text = re.sub(pattern, "", text, flags=re.IGNORECASE | re.MULTILINE)

    unwanted_phrases = [
        "cookie policy", "privacy policy", "terms of service", "terms and conditions",
        "all rights reserved", "copyright", "Ã‚Â©", "follow us", "share this",
        "subscribe", "newsletter", "sign up", "log in", "register",
        "click here", "read more", "learn more", "continue reading",
        "advertisement", "sponsored", "promoted", "recommended",
        "related articles", "you might also like", "popular posts",
        "back to top", "scroll to top", "page of",
        "comments", "shares", "likes", "views",
        "to follow all the live action", "live action from", "points table",
        "loading", "share video on", "view all", "see more", "filters season",
        "playoffs", "copy all years", "role batsman", "nationality", "bio",
        "magic moments", "ipl exclusive", "related videos",
        "-->", ">>", ">>>", "<<<", "<<", "->", "<-", "=>", "<=",
        "Ã¯Ë†Â²", "Ã¯â€šÅ¡", "Ã¯â€šâ„¢", "Ã¯Æ’â€¢", "Ã¯â€¦Â®", "Ã¯â€šÅ¾", "Ã¯â€¦Â§", "Ã¯â€¦Âª", "Ã¯â€ Â´", "Ã¯â€¡Â§",
        "tbd", "to be determined", "qualifier", "eliminator",
        "final", "as per current points table",
    ]

    for phrase in unwanted_phrases:
        text = re.sub(r"\b" + re.escape(phrase) + r"\b", "", text, flags=re.IGNORECASE)
        text = re.sub(r"\s*" + re.escape(phrase) + r"\s*", " ", text, flags=re.IGNORECASE)

    text = re.sub(r"\s+", " ", text)
    text = re.sub(r"\n\s+", "\n", text)
    text = re.sub(r"\s+\n", "\n", text)
    text = re.sub(r"\n+", "\n", text).strip()

    lines = [line.strip() for line in text.split("\n") if line.strip()]
    meaningful_lines = []

    for line in lines:
        if len(line) < 5:
            continue
        alpha_chars = sum(1 for char in line if char.isalpha())
        total_chars = len(line)
        if total_chars > 0 and (alpha_chars / total_chars) < 0.3:
            continue
        if re.search(r"\d{5,}", line):
            continue
        boilerplate_indicators = [
            "click", "here", "more", "follow", "share", "subscribe",
            "cookie", "policy", "privacy", "terms", "loading",
        ]
        if any(indicator in line.lower() for indicator in boilerplate_indicators):
            content_words = ["team", "points", "standings", "table", "rank", "won", "lost", "nrr"]
            if not any(word in line.lower() for word in content_words):
                continue
        meaningful_lines.append(line)

    result = " ".join(meaningful_lines)
    if len(result) > 3000:
        result = result[:3000] + "... [content truncated]"
    return result if result.strip() else "No meaningful content extracted - page may be primarily boilerplate"


def _strip_html_to_text(html: str) -> str:
    import html as html_module
    import re

    text = re.sub(r"<(script|style)[^>]*>.*?</\1>", "", html, flags=re.DOTALL | re.IGNORECASE)
    text = re.sub(r"<[^>]+>", " ", text)
    text = html_module.unescape(text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def _root_exception(exc: BaseException) -> BaseException:
    current = exc
    visited = set()
    while True:
        next_exc = getattr(current, "__cause__", None) or getattr(current, "__context__", None)
        if not next_exc or id(next_exc) in visited:
            return current
        visited.add(id(next_exc))
        current = next_exc


def _exception_chain_messages(exc: BaseException) -> List[str]:
    messages: List[str] = []
    visited = set()

    def _walk(current: Optional[BaseException]) -> None:
        if not current or id(current) in visited:
            return
        visited.add(id(current))
        text = str(current).strip() or repr(current)
        label = f"{type(current).__name__}: {text}"
        if label not in messages:
            messages.append(label)
        if isinstance(current, BaseExceptionGroup):
            for child in current.exceptions:
                _walk(child)
        _walk(getattr(current, "__cause__", None))
        _walk(getattr(current, "__context__", None))

    _walk(exc)
    return messages


def _transport_diagnostics(exc: BaseException) -> Dict[str, Any]:
    root = _root_exception(exc)
    chain_messages = _exception_chain_messages(exc)
    message = " | caused by: ".join(chain_messages)
    root_message = str(root)
    diagnostics: Dict[str, Any] = {
        "fetchFailureKind": "transport_failure",
        "networkError": message or root_message or exc.__class__.__name__,
        "httpStatus": None,
        "redirectedUrl": None,
    }

    if isinstance(exc, httpx.HTTPStatusError):
        diagnostics["fetchFailureKind"] = "http_status_error"
        diagnostics["httpStatus"] = exc.response.status_code
        diagnostics["redirectedUrl"] = str(exc.response.url)
        return diagnostics
    if isinstance(exc, httpx.TooManyRedirects):
        diagnostics["fetchFailureKind"] = "redirect_loop"
        return diagnostics
    if isinstance(exc, httpx.TimeoutException):
        diagnostics["fetchFailureKind"] = "timeout"
        return diagnostics
    if isinstance(exc, httpx.ProxyError):
        diagnostics["fetchFailureKind"] = "proxy_required"
        return diagnostics
    if isinstance(exc, httpx.ConnectError):
        diagnostics["fetchFailureKind"] = "connect_failure"
    if isinstance(root, socket.gaierror):
        diagnostics["fetchFailureKind"] = "dns_failure"
        diagnostics["networkError"] = root_message or message
    elif isinstance(root, ssl.SSLError):
        diagnostics["fetchFailureKind"] = "tls_failure"
        diagnostics["networkError"] = root_message or message
    elif isinstance(root, OSError):
        diagnostics["networkError"] = root_message or message
        if getattr(root, "winerror", None) == 10013:
            diagnostics["fetchFailureKind"] = "socket_permission_denied"
        elif getattr(root, "errno", None) in {101, 111, 113}:
            diagnostics["fetchFailureKind"] = "connect_failure"
    return diagnostics


def _success_output(
    *,
    response_url: str,
    title: str,
    content: str,
    attempts: List[Dict[str, Any]],
    http_status: int,
    content_type: str,
    redirected_url: str,
    transport_strategy: str,
    truncated: bool,
    bytes_read: int,
    max_bytes: int,
    encoding: Optional[str],
    cache_hit: bool,
    cache_age_ms: Optional[int],
    robots_status: str,
    js_render_suspected: bool,
    js_fallback_detected: bool,
    js_fallback_reason: Optional[str],
) -> Dict[str, Any]:
    return {
        "kind": "content",
        "url": response_url,
        "title": title,
        "content": content,
        "word_count": len(content.split()),
        "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "httpStatus": http_status,
        "contentType": content_type,
        "redirectedUrl": redirected_url,
        "fetchFailureKind": None,
        "networkError": None,
        "transportStrategy": transport_strategy,
        "backendAttempts": attempts,
        "truncated": truncated,
        "bytesRead": bytes_read,
        "maxBytes": max_bytes,
        "encoding": encoding,
        "cacheHit": cache_hit,
        "cacheAgeMs": cache_age_ms,
        "robotsStatus": robots_status,
        "jsRenderSuspected": js_render_suspected,
        "jsFallbackDetected": js_fallback_detected,
        "jsFallbackReason": js_fallback_reason,
    }


def _error_result(
    *,
    tool_name: str,
    input: Dict[str, Any],
    start_time: float,
    diagnostics: Dict[str, Any],
    attempts: List[Dict[str, Any]],
    error_prefix: str,
    transport_strategy: str,
    cache_hit: bool = False,
    cache_age_ms: Optional[int] = None,
    robots_status: str = "not_checked",
) -> ToolResult:
    output = {
        "kind": "transport_failure",
        "url": str(input.get("url") or ""),
        "title": "",
        "content": "",
        "word_count": 0,
        "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "backendAttempts": attempts,
        "transportStrategy": transport_strategy,
        "truncated": False,
        "bytesRead": 0,
        "maxBytes": int(input.get("maxBytes") or DEFAULT_MAX_BYTES),
        "encoding": None,
        "cacheHit": cache_hit,
        "cacheAgeMs": cache_age_ms,
        "robotsStatus": robots_status,
        **diagnostics,
    }
    return ToolResult(
        tool_name=tool_name,
        input=input,
        output=output,
        error=f"{error_prefix}: {diagnostics.get('networkError') or diagnostics.get('fetchFailureKind')}",
        duration_ms=int((time.monotonic() - start_time) * 1000),
        sandboxed=False,
        source_url=str(input.get("url") or ""),
        provenance_hint=output,
    )


class WebFetchTool(BaseTool):
    name = "web_fetch"
    description = "Fetches the full text content and title of a specific public URL. Use this when you have a direct link."
    parameters = {
        "type": "object",
        "properties": {
            "url": {"type": "string", "description": "The URL to fetch"},
            "extract_text": {"type": "boolean", "default": True},
            "allowBrowserFallback": {"type": "boolean", "default": True},
            "maxBytes": {"type": "integer", "default": DEFAULT_MAX_BYTES},
        },
        "required": ["url"],
    }
    capability_tags = ["fetch", "read", "network"]
    requires_confirmation = False
    requires_sandbox = False

    def __init__(self) -> None:
        self._cache: Dict[str, _CachedFetchEntry] = {}
        self._inflight: Dict[str, asyncio.Future[ToolResult]] = {}
        self._robots_cache: Dict[str, Tuple[float, str]] = {}
        self._cache_lock = asyncio.Lock()

    def _cache_key(self, url: str, max_bytes: int, allow_browser_fallback: bool) -> str:
        raw = f"{url}|{max_bytes}|{int(bool(allow_browser_fallback))}"
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()

    async def _diagnose_dns(self, hostname: str) -> Dict[str, Any]:
        try:
            ip = await asyncio.to_thread(socket.gethostbyname, hostname)
            return {"ok": True, "ip": ip}
        except socket.gaierror as exc:
            return {"ok": False, "error": str(exc), "errorType": type(exc).__name__}

    async def _diagnose_tcp(self, hostname: str, port: int) -> Dict[str, Any]:
        def _connect() -> None:
            sock = socket.create_connection((hostname, port), timeout=5)
            sock.close()

        try:
            await asyncio.to_thread(_connect)
            return {"ok": True}
        except OSError as exc:
            return {
                "ok": False,
                "error": str(exc),
                "errorType": type(exc).__name__,
                "errno": getattr(exc, "errno", None),
                "winerror": getattr(exc, "winerror", None),
            }

    async def _diagnose_ssl(self, hostname: str, port: int) -> Dict[str, Any]:
        def _handshake() -> None:
            context = ssl.create_default_context()
            with socket.create_connection((hostname, port), timeout=5) as raw_sock:
                with context.wrap_socket(raw_sock, server_hostname=hostname):
                    return None

        try:
            await asyncio.to_thread(_handshake)
            return {"ok": True}
        except ssl.SSLError as exc:
            return {"ok": False, "error": str(exc), "errorType": type(exc).__name__}
        except OSError as exc:
            return {
                "ok": False,
                "error": str(exc),
                "errorType": type(exc).__name__,
                "errno": getattr(exc, "errno", None),
                "winerror": getattr(exc, "winerror", None),
            }

    async def _diagnose_httpx_probe(self, url: str, *, verify: bool) -> Dict[str, Any]:
        try:
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(5.0, connect=5.0, read=5.0, pool=5.0),
                follow_redirects=True,
                trust_env=True,
                verify=verify,
                http2=False,
                transport=_ipv4_transport(),
            ) as client:
                response = await client.get(url, headers=BROWSERISH_HEADERS)
            return {
                "ok": True,
                "status": response.status_code,
                "finalUrl": str(response.url),
            }
        except Exception as exc:
            diagnostics = _transport_diagnostics(exc)
            return {
                "ok": False,
                "errorType": type(exc).__name__,
                "detail": diagnostics.get("networkError") or str(exc),
                "fetchFailureKind": diagnostics.get("fetchFailureKind"),
                "httpStatus": diagnostics.get("httpStatus"),
                "redirectedUrl": diagnostics.get("redirectedUrl"),
            }

    async def diagnose_connectivity(self, url: str) -> Dict[str, Any]:
        parsed = urlparse(url)
        hostname = parsed.hostname or ""
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
        diagnosis: Dict[str, Any] = {
            "url": url,
            "hostname": hostname,
            "port": port,
            "scheme": parsed.scheme,
            "proxyEnv": {
                "HTTP_PROXY": os.getenv("HTTP_PROXY"),
                "HTTPS_PROXY": os.getenv("HTTPS_PROXY"),
                "NO_PROXY": os.getenv("NO_PROXY"),
            },
        }
        if not hostname:
            diagnosis["error"] = "URL has no hostname"
            return diagnosis

        dns = await self._diagnose_dns(hostname)
        diagnosis["dns"] = dns
        if not dns.get("ok"):
            return diagnosis

        tcp = await self._diagnose_tcp(hostname, port)
        diagnosis["tcp"] = tcp
        if not tcp.get("ok"):
            return diagnosis

        if parsed.scheme == "https":
            diagnosis["ssl"] = await self._diagnose_ssl(hostname, port)

        diagnosis["httpx"] = await self._diagnose_httpx_probe(url, verify=True)
        diagnosis["httpxInsecure"] = await self._diagnose_httpx_probe(url, verify=False)

        try:
            from playwright.async_api import async_playwright

            async with async_playwright() as playwright:
                browser = await playwright.chromium.launch(headless=True)
                await browser.close()
            diagnosis["playwright"] = {"ok": True}
        except Exception as exc:
            diagnosis["playwright"] = {"ok": False, "error": str(exc), "errorType": type(exc).__name__}

        return diagnosis

    def _clone_result_with_cache(self, result: ToolResult, *, cache_hit: bool, cache_age_ms: Optional[int]) -> ToolResult:
        clone = result.model_copy(deep=True)
        if isinstance(clone.output, dict):
            clone.output["cacheHit"] = cache_hit
            clone.output["cacheAgeMs"] = cache_age_ms
        if isinstance(clone.provenance_hint, dict):
            clone.provenance_hint["cacheHit"] = cache_hit
            clone.provenance_hint["cacheAgeMs"] = cache_age_ms
        return clone

    def _decode_bytes(self, body: bytes, content_type: str) -> Tuple[str, Optional[str]]:
        charset_match = None
        try:
            charset_match = httpx.Headers({"content-type": content_type}).get("content-type", "")
        except Exception:
            charset_match = content_type or ""

        encoding = None
        if "charset=" in (charset_match or "").lower():
            encoding = charset_match.lower().split("charset=", 1)[1].split(";", 1)[0].strip() or None

        if encoding:
            try:
                return body.decode(encoding, errors="replace"), encoding
            except LookupError:
                encoding = None

        try:
            decoded = body.decode("utf-8")
            return decoded, "utf-8"
        except UnicodeDecodeError:
            best = from_bytes(body).best()
            if best is not None:
                return str(best), best.encoding or "charset-normalizer"
            return body.decode("utf-8", errors="replace"), "utf-8-replace"

    def _extract_title_and_content(self, body_text: str, content_type: str, extract_text: bool) -> Tuple[str, str]:
        title = ""
        if "text/html" in (content_type or "").lower():
            import re

            match = re.search(r"<title[^>]*>(.*?)</title>", body_text, re.IGNORECASE | re.DOTALL)
            if match:
                title = match.group(1).strip()
            if extract_text:
                try:
                    content = _extract_meaningful_content(body_text)
                    if len(content.strip()) < 100:
                        logger.warning("Content extraction removed too much, using fallback")
                        content = _strip_html_to_text(body_text)
                except Exception as exc:
                    logger.warning("Content extraction failed, using fallback: %s", exc)
                    content = _strip_html_to_text(body_text)
            else:
                content = body_text
        else:
            content = body_text
        return title, content

    def _browser_tool_input(self, tool: BaseTool, url: str, max_bytes: int) -> Optional[Dict[str, Any]]:
        schema = tool.parameters or {}
        properties = schema.get("properties") or {}
        lowered = {str(key).lower(): key for key in properties.keys()}
        tool_input: Dict[str, Any] = {}

        for candidate in ["url", "uri", "link", "targeturl", "address"]:
            if candidate in lowered:
                tool_input[lowered[candidate]] = url
                break

        for candidate, value in [
            ("waituntil", "networkidle2"),
            ("wait_until", "networkidle2"),
            ("loadstate", "networkidle2"),
            ("load_state", "networkidle2"),
            ("timeoutms", BROWSER_SETTLE_TIMEOUT_MS),
            ("timeout_ms", BROWSER_SETTLE_TIMEOUT_MS),
            ("settletimems", BROWSER_SETTLE_TIMEOUT_MS),
            ("settle_time_ms", BROWSER_SETTLE_TIMEOUT_MS),
            ("extracttext", True),
            ("extract_text", True),
            ("maxbytes", max_bytes),
            ("max_bytes", max_bytes),
            ("html", True),
            ("content", True),
            ("text", True),
        ]:
            if candidate in lowered:
                tool_input[lowered[candidate]] = value

        return tool_input or None

    def _extract_browser_result(self, result: ToolResult, url: str, max_bytes: int) -> Optional[Dict[str, Any]]:
        if result.error:
            return None
        output = result.output if isinstance(result.output, dict) else {}
        title = str(output.get("title") or output.get("pageTitle") or output.get("name") or "").strip()
        rendered = ""
        for key in ["content", "text", "markdown", "body", "html", "pageContent", "page_content"]:
            value = output.get(key)
            if isinstance(value, str) and value.strip():
                rendered = value
                break
        if not rendered and isinstance(result.output, str):
            rendered = result.output
        if not rendered:
            return None

        rendered_bytes = rendered.encode("utf-8", errors="replace")
        bytes_read = len(rendered_bytes)
        truncated = bytes_read > max_bytes
        if truncated:
            rendered = rendered_bytes[:max_bytes].decode("utf-8", errors="replace")

        content_type = str(output.get("contentType") or "text/html; charset=utf-8")
        if "<" in rendered and "html" in content_type.lower():
            title = title or ""
            content = _extract_meaningful_content(rendered)
            if len(content.strip()) < 100:
                content = _strip_html_to_text(rendered)
        else:
            content = rendered

        return {
            "url": str(output.get("url") or output.get("finalUrl") or url),
            "title": title,
            "content": content,
            "httpStatus": int(output.get("httpStatus") or 200),
            "contentType": content_type,
            "redirectedUrl": str(output.get("redirectedUrl") or output.get("url") or url),
            "truncated": truncated,
            "bytesRead": bytes_read,
            "encoding": str(output.get("encoding") or "utf-8"),
        }

    async def _playwright_fetch(self, url: str, max_bytes: int) -> Dict[str, Any]:
        try:
            from playwright.async_api import async_playwright
        except Exception as exc:
            raise BrowserFallbackUnavailableError(
                f"Playwright is not installed or importable: {exc}"
            ) from exc

        try:
            async with async_playwright() as playwright:
                browser = await playwright.chromium.launch(headless=True)
                page = await browser.new_page()
                try:
                    await page.goto(url, wait_until="networkidle", timeout=10000)
                    await page.wait_for_timeout(BROWSER_SETTLE_TIMEOUT_MS)
                    rendered_html = await page.content()
                    title = await page.title()
                    final_url = page.url or url
                finally:
                    await page.close()
                    await browser.close()
        except Exception as exc:
            message = str(exc)
            if "Executable doesn't exist" in message or "Please run the following command" in message:
                raise BrowserFallbackUnavailableError(message) from exc
            raise RuntimeError(message) from exc

        rendered_bytes = rendered_html.encode("utf-8", errors="replace")
        bytes_read = len(rendered_bytes)
        truncated = bytes_read > max_bytes
        if truncated:
            rendered_html = rendered_bytes[:max_bytes].decode("utf-8", errors="replace")

        content = _extract_meaningful_content(rendered_html)
        if len(content.strip()) < 100:
            content = _strip_html_to_text(rendered_html)
        js_fallback_reason = _detect_js_fallback_reason(rendered_html) or _detect_js_fallback_reason(content)
        if not js_fallback_reason:
            js_fallback_reason = _detect_spa_empty_shell_reason(rendered_html, content)

        return {
            "url": final_url,
            "title": title,
            "content": content,
            "httpStatus": 200,
            "contentType": "text/html; charset=utf-8",
            "redirectedUrl": final_url,
            "truncated": truncated,
            "bytesRead": bytes_read,
            "encoding": "utf-8",
            "jsRenderSuspected": bool(js_fallback_reason),
            "jsFallbackDetected": bool(js_fallback_reason),
            "jsFallbackReason": js_fallback_reason,
        }

    def _run_playwright_sync(self, url: str, max_bytes: int) -> Dict[str, Any]:
        if os.name == "nt":
            loop = asyncio.ProactorEventLoop()
        else:
            loop = asyncio.new_event_loop()
        try:
            asyncio.set_event_loop(loop)
            return loop.run_until_complete(self._playwright_fetch(url, max_bytes))
        finally:
            try:
                loop.run_until_complete(loop.shutdown_asyncgens())
            except Exception:
                pass
            asyncio.set_event_loop(None)
            loop.close()

    async def _browser_public_fallback(self, *, url: str, max_bytes: int) -> Dict[str, Any]:
        loop = asyncio.get_running_loop()
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
            try:
                return await loop.run_in_executor(executor, self._run_playwright_sync, url, max_bytes)
            except BrowserFallbackUnavailableError:
                raise
            except Exception as exc:
                raise RuntimeError(str(exc)) from exc

    async def _check_robots_status(self, url: str, resolved: _ResolvedUrlInfo) -> str:
        if not resolved.is_public or not resolved.hostname:
            return "not_checked"
        cache_key = resolved.hostname.lower()
        now = time.monotonic()
        cached = self._robots_cache.get(cache_key)
        if cached and (now - cached[0]) < CACHE_TTL_SECONDS:
            return cached[1]

        robots_url = urljoin(f"{urlparse(url).scheme}://{resolved.hostname}", "/robots.txt")
        try:
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(5.0, connect=5.0, read=5.0, pool=5.0),
                trust_env=True,
                follow_redirects=True,
                http2=False,
                transport=_ipv4_transport(),
            ) as client:
                response = await client.get(robots_url, headers=BROWSERISH_HEADERS)
                if response.status_code >= 400:
                    status = "unknown"
                else:
                    parser = RobotFileParser()
                    parser.parse(response.text.splitlines())
                    status = "allowed" if parser.can_fetch("*", url) else "disallowed"
        except Exception:
            status = "unknown"

        self._robots_cache[cache_key] = (now, status)
        return status

    async def _execute_http_attempt(
        self,
        *,
        url: str,
        extract_text: bool,
        max_bytes: int,
        attempt_name: str,
        headers: Dict[str, str],
        follow_redirects: bool,
        trust_env: bool,
    ) -> Dict[str, Any]:
        transport = _ipv4_transport()
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(DEFAULT_TIMEOUT, connect=DEFAULT_CONNECT_TIMEOUT, read=DEFAULT_TIMEOUT, pool=5.0),
            follow_redirects=follow_redirects,
            headers=headers,
            trust_env=trust_env,
            max_redirects=10,
            http2=False,
            transport=transport,
        ) as client:
            async with client.stream("GET", url) as response:
                response.raise_for_status()
                chunks: List[bytes] = []
                bytes_read = 0
                async for chunk in response.aiter_bytes():
                    if not chunk:
                        continue
                    remaining = max_bytes - bytes_read
                    if remaining <= 0:
                        break
                    if len(chunk) > remaining:
                        chunks.append(chunk[:remaining])
                        bytes_read += remaining
                        break
                    chunks.append(chunk)
                    bytes_read += len(chunk)

                truncated = bytes_read >= max_bytes
                raw_body = b"".join(chunks)
                content_type = response.headers.get("Content-Type", "")
                decoded_body, encoding = self._decode_bytes(raw_body, content_type)
                title, content = self._extract_title_and_content(decoded_body, content_type, extract_text)
                js_fallback_reason = _detect_js_fallback_reason(decoded_body) or _detect_js_fallback_reason(content)
                if not js_fallback_reason:
                    js_fallback_reason = _detect_spa_empty_shell_reason(decoded_body, content)
                return {
                    "url": str(response.url),
                    "title": title,
                    "content": content,
                    "httpStatus": response.status_code,
                    "contentType": content_type,
                    "redirectedUrl": str(response.url),
                    "transportStrategy": attempt_name,
                    "truncated": truncated,
                    "bytesRead": bytes_read,
                    "maxBytes": max_bytes,
                    "encoding": encoding,
                    "jsRenderSuspected": bool(js_fallback_reason),
                    "jsFallbackDetected": bool(js_fallback_reason),
                    "jsFallbackReason": js_fallback_reason,
                }

    async def _execute_uncached(
        self,
        *,
        input: Dict[str, Any],
        resolved: _ResolvedUrlInfo,
        extract_text: bool,
        allow_browser_fallback: bool,
        max_bytes: int,
    ) -> ToolResult:
        start_time = time.monotonic()
        url = str(input.get("url") or "")
        robots_status = await self._check_robots_status(url, resolved)

        attempts: List[Dict[str, Any]] = []
        last_error: Optional[BaseException] = None
        last_http_error: Optional[BaseException] = None
        attempt_configs = [
            {
                "name": "direct_http",
                "headers": {},
                "follow_redirects": True,
                "trust_env": False,
            },
            {
                "name": "env_proxy_http",
                "headers": {},
                "follow_redirects": True,
                "trust_env": True,
            },
            {
                "name": "browser_headers_http",
                "headers": BROWSERISH_HEADERS,
                "follow_redirects": True,
                "trust_env": True,
            },
        ]

        for attempt in attempt_configs:
            attempt_start = time.monotonic()
            try:
                outcome = await self._execute_http_attempt(
                    url=url,
                    extract_text=extract_text,
                    max_bytes=max_bytes,
                    attempt_name=attempt["name"],
                    headers=attempt["headers"],
                    follow_redirects=attempt["follow_redirects"],
                    trust_env=attempt["trust_env"],
                )
                attempts.append(
                    {
                        "attempt": attempt["name"],
                        "strategy": attempt["name"],
                        "status": "ok",
                        "elapsed_ms": round((time.monotonic() - attempt_start) * 1000, 2),
                        "httpStatus": outcome["httpStatus"],
                        "redirectedUrl": outcome["redirectedUrl"],
                        "contentType": outcome["contentType"],
                        "transportStrategy": attempt["name"],
                    }
                )
                output = _success_output(
                    response_url=outcome["url"],
                    title=outcome["title"],
                    content=outcome["content"],
                    attempts=attempts,
                    http_status=outcome["httpStatus"],
                    content_type=outcome["contentType"],
                    redirected_url=outcome["redirectedUrl"],
                    transport_strategy=attempt["name"],
                    truncated=outcome["truncated"],
                    bytes_read=outcome["bytesRead"],
                    max_bytes=max_bytes,
                    encoding=outcome["encoding"],
                    cache_hit=False,
                    cache_age_ms=None,
                    robots_status=robots_status,
                    js_render_suspected=bool(outcome.get("jsRenderSuspected")),
                    js_fallback_detected=bool(outcome.get("jsFallbackDetected")),
                    js_fallback_reason=outcome.get("jsFallbackReason"),
                )
                return ToolResult(
                    tool_name=self.name,
                    input=input,
                    output=output,
                    duration_ms=int((time.monotonic() - start_time) * 1000),
                    sandboxed=False,
                    source_url=outcome["url"],
                    provenance_hint=output,
                )
            except Exception as exc:
                last_error = exc
                last_http_error = exc
                diagnostics = _transport_diagnostics(exc)
                attempts.append(
                    {
                        "attempt": attempt["name"],
                        "strategy": attempt["name"],
                        "status": "error",
                        "elapsed_ms": round((time.monotonic() - attempt_start) * 1000, 2),
                        "transportStrategy": attempt["name"],
                        **diagnostics,
                    }
                )

        if allow_browser_fallback and resolved.is_public:
            attempt_start = time.monotonic()
            try:
                outcome = await self._browser_public_fallback(url=url, max_bytes=max_bytes)
                attempts.append(
                    {
                        "attempt": "browser_public_fallback",
                        "strategy": "browser_public_fallback",
                        "status": "ok",
                        "elapsed_ms": round((time.monotonic() - attempt_start) * 1000, 2),
                        "httpStatus": outcome["httpStatus"],
                        "redirectedUrl": outcome["redirectedUrl"],
                        "contentType": outcome["contentType"],
                        "transportStrategy": "browser_public_fallback",
                    }
                )
                output = _success_output(
                    response_url=outcome["url"],
                    title=outcome["title"],
                    content=outcome["content"],
                    attempts=attempts,
                    http_status=outcome["httpStatus"],
                    content_type=outcome["contentType"],
                    redirected_url=outcome["redirectedUrl"],
                    transport_strategy="browser_public_fallback",
                    truncated=outcome["truncated"],
                    bytes_read=outcome["bytesRead"],
                    max_bytes=max_bytes,
                    encoding=outcome["encoding"],
                    cache_hit=False,
                    cache_age_ms=None,
                    robots_status=robots_status,
                    js_render_suspected=bool(outcome.get("jsRenderSuspected")),
                    js_fallback_detected=bool(outcome.get("jsFallbackDetected")),
                    js_fallback_reason=outcome.get("jsFallbackReason"),
                )
                return ToolResult(
                    tool_name=self.name,
                    input=input,
                    output=output,
                    duration_ms=int((time.monotonic() - start_time) * 1000),
                    sandboxed=False,
                    source_url=outcome["url"],
                    provenance_hint=output,
                )
            except Exception as exc:
                last_error = exc
                diagnostics = _transport_diagnostics(exc)
                diagnostics["fetchFailureKind"] = (
                    "browser_unavailable"
                    if isinstance(exc, BrowserFallbackUnavailableError)
                    else "browser_fallback_failed"
                )
                attempts.append(
                    {
                        "attempt": "browser_public_fallback",
                        "strategy": "browser_public_fallback",
                        "status": "error",
                        "elapsed_ms": round((time.monotonic() - attempt_start) * 1000, 2),
                        "transportStrategy": "browser_public_fallback",
                        **diagnostics,
                    }
                )

        if last_error is not None:
            prefix = "HTTP error" if isinstance(last_error, httpx.HTTPError) else "Fetch failed"
            browser_failed = any(
                attempt.get("attempt") == "browser_public_fallback" and attempt.get("status") == "error"
                for attempt in attempts
            )
            if browser_failed and not isinstance(last_error, BrowserFallbackUnavailableError):
                diagnostics = {
                    **_transport_diagnostics(last_error),
                    "fetchFailureKind": "browser_fallback_failed",
                }
            elif isinstance(last_error, BrowserFallbackUnavailableError) and last_http_error is not None:
                diagnostics = _transport_diagnostics(last_http_error)
                diagnostics["networkError"] = (
                    f"{diagnostics.get('networkError')} (browser fallback unavailable: {last_error})"
                )
            else:
                diagnostics = _transport_diagnostics(last_error)
            return _error_result(
                tool_name=self.name,
                input=input,
                start_time=start_time,
                diagnostics=diagnostics,
                attempts=attempts,
                error_prefix=prefix,
                transport_strategy=(
                    "browser_public_fallback"
                    if browser_failed and not isinstance(last_error, BrowserFallbackUnavailableError)
                    else attempts[-1].get("transportStrategy", "none") if attempts else "none"
                ),
                robots_status=robots_status,
            )

        return _error_result(
            tool_name=self.name,
            input=input,
            start_time=start_time,
            diagnostics={
                "fetchFailureKind": "execution_failure",
                "networkError": "Unknown fetch failure",
                "httpStatus": None,
                "redirectedUrl": None,
            },
            attempts=attempts,
            error_prefix="Fetch failed",
            transport_strategy="none",
            robots_status=robots_status,
        )

    async def execute(self, input: Dict[str, Any]) -> ToolResult:
        start_time = time.monotonic()
        url = str(input.get("url") or "")
        extract_text = bool(input.get("extract_text", True))
        allow_browser_fallback = bool(input.get("allowBrowserFallback", True))
        max_bytes = max(1024, int(input.get("maxBytes") or DEFAULT_MAX_BYTES))

        resolved = await _resolve_url_info(url)
        if not resolved.is_safe:
            return ToolResult(
                tool_name=self.name,
                input=input,
                output={
                    "kind": "transport_failure",
                    "url": url,
                    "title": "",
                    "content": "",
                    "word_count": 0,
                    "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    "fetchFailureKind": "unsafe_url",
                    "networkError": resolved.reason,
                    "httpStatus": None,
                    "redirectedUrl": None,
                    "transportStrategy": "none",
                    "backendAttempts": [],
                    "truncated": False,
                    "bytesRead": 0,
                    "maxBytes": max_bytes,
                    "encoding": None,
                    "cacheHit": False,
                    "cacheAgeMs": None,
                    "robotsStatus": "not_checked",
                },
                error=resolved.reason,
                duration_ms=int((time.monotonic() - start_time) * 1000),
                sandboxed=False,
                source_url=url,
            )

        cache_key = self._cache_key(url, max_bytes, allow_browser_fallback)
        async with self._cache_lock:
            cached = self._cache.get(cache_key)
            if cached and (time.monotonic() - cached.stored_at) < CACHE_TTL_SECONDS:
                age_ms = int((time.monotonic() - cached.stored_at) * 1000)
                return self._clone_result_with_cache(cached.result, cache_hit=True, cache_age_ms=age_ms)
            if cached:
                self._cache.pop(cache_key, None)

            inflight = self._inflight.get(cache_key)
            if inflight is None:
                inflight = asyncio.get_running_loop().create_future()
                self._inflight[cache_key] = inflight
                leader = True
            else:
                leader = False

        if not leader:
            result = await inflight
            return self._clone_result_with_cache(result, cache_hit=False, cache_age_ms=None)

        try:
            result = await self._execute_uncached(
                input=input,
                resolved=resolved,
                extract_text=extract_text,
                allow_browser_fallback=allow_browser_fallback,
                max_bytes=max_bytes,
            )
            if isinstance(result.output, dict) and result.output.get("kind") == "content":
                async with self._cache_lock:
                    self._cache[cache_key] = _CachedFetchEntry(result=result.model_copy(deep=True), stored_at=time.monotonic())
            inflight.set_result(result)
            return result
        except Exception as exc:
            inflight.set_exception(exc)
            raise
        finally:
            async with self._cache_lock:
                self._inflight.pop(cache_key, None)

    async def health(self) -> str:
        try:
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(5.0, connect=5.0, read=5.0, pool=5.0),
                trust_env=True,
                http2=False,
                transport=_ipv4_transport(),
            ) as client:
                resp = await client.head("https://example.com")
                return "ok" if resp.is_success else "degraded"
        except Exception:
            return "degraded"
