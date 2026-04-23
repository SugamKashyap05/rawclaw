import asyncio
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

# DNS resolution timeout in seconds
DNS_RESOLVE_TIMEOUT = 5.0

async def _is_safe_url(url: str) -> Tuple[bool, str]:
    """
    Validates a URL against common SSRF targets and schemes.
    This check runs before any HTTP connection is attempted.
    Uses async DNS resolution to avoid blocking the event loop.
    """
    try:
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https"):
            return False, f"Scheme '{parsed.scheme}' is not allowed"
        hostname = parsed.hostname
        if not hostname:
            return False, "URL has no hostname"
        
        # CRITICAL FIX: Use async DNS resolution instead of blocking socket.gethostbyname()
        # The old synchronous call blocked the entire event loop for up to 30s per URL,
        # which caused the chat stream to freeze and the UI to hang.
        try:
            loop = asyncio.get_event_loop()
            addrinfo = await asyncio.wait_for(
                loop.getaddrinfo(hostname, None, family=socket.AF_INET),
                timeout=DNS_RESOLVE_TIMEOUT,
            )
            if not addrinfo:
                return False, f"Could not resolve hostname: {hostname}"
            # addrinfo entries: (family, type, proto, canonname, sockaddr)
            resolved_ip = addrinfo[0][4][0]
        except asyncio.TimeoutError:
            return False, f"DNS resolution timed out for hostname: {hostname}"

        for prefix in BLOCKED_PREFIXES:
            if resolved_ip.startswith(prefix):
                return False, f"Blocked: {resolved_ip} is a private/loopback address"
        return True, ""
    except socket.gaierror:
        parsed = urlparse(url)
        return False, f"Could not resolve hostname: {parsed.hostname}"
    except Exception as e:
        return False, f"URL validation error: {str(e)}"

def _extract_meaningful_content(html: str) -> str:
    """
    Extracts meaningful content from HTML while removing boilerplate.
    Focuses on main content areas and removes navigation, footers, ads, etc.
    """
    import re
    import html as html_module
    
    # Remove script, style, header, and other junk elements completely
    patterns_to_remove = [
        r'<(script|style|header|nav|footer|aside|form|iframe)[^>]*>.*?</\1>',
        r'<!--.*?-->',  # Comments
        r'<noscript[^>]*>.*?</noscript>',
        r'<meta[^>]*>',
        r'<link[^>]*>',
        r'<svg[^>]*>.*?</svg>',
        r'<img[^>]*/?>',
    ]
    
    text = html
    for pattern in patterns_to_remove:
        text = re.sub(pattern, '', text, flags=re.DOTALL | re.IGNORECASE)
    
    # Remove common boilerplate container elements
    boilerplate_container_patterns = [
        r'<div[^>]*(class|id)=["\']*(menu|navigation|nav|footer|sidebar|ad|banner|cookie|promo|widget|popup|modal|overlay|lightbox|tooltip|notification)[^>]*>.*?</div>',
        r'<div[^>]*(class|id)=["\']*(social|share|comment|related|sidebar|widget)[^>]*>.*?</div>',
        r'<span[^>]*(class|id)=["\']*(icon|button|badge|label|tag)[^>]*>.*?</span>',
        r'<li[^>]*(class|id)=["\']*(social|share|menu)[^>]*>.*?</li>',
    ]
    
    for pattern in boilerplate_container_patterns:
        text = re.sub(pattern, '', text, flags=re.DOTALL | re.IGNORECASE)
    
    # Extract text content from remaining HTML - MORE AGGRESSIVE CLEANING
    # First remove all HTML tags but preserve line breaks
    text = re.sub(r'<br\s*/?>', '\n', text)
    text = re.sub(r'<[^>]+>', ' ', text)
    
    # Decode HTML entities
    text = html_module.unescape(text)
    
    # Aggressive whitespace and noise cleaning
    # Remove repeated whitespace characters
    text = re.sub(r'[ \t]+', ' ', text)
    text = re.sub(r'\n\s*\n\s*\n+', '\n\n', text)  # Multiple blank lines -> 2 newlines
    
    # Remove common boilerplate phrases - MORE COMPREHENSIVE LIST
    unwanted_patterns = [
        # Navigation/menu text
        r'home\s+about\s+contact\s+services', 
        r'menu\s+.*?\s+menu',
        r'points\s+table\s+points\s+table',
        # Sports banner repetitions
        r'(to follow all the live action from.*?){2,}',
        r'(follow.*?live.*?action.*?){3,}',
        # Repeated symbols/punctuation
        r'[>\-=~]{3,}',
        r'[•\-–—]{2,}',
        # Footer-like patterns  
        r'all rights reserved.*?(?:\d{4})?',
        r'cookie policy.*?privacy',
        r'subscribe.*?newsletter',
        # Layout artifacts
        r'\s*[|]\s*[|]\s*[|]\s*',  # Multiple pipes |
        r'\s*[/]\s*[/]\s*[/]\s*',  # Multiple slashes /
        r'copy\s+all\s+years',
        # Empty content indicators  
        r'no\s+(?:results|matches|data|information).*?found',
        # Loading/placeholder indicators
        r'loading\.\.\.?',
        r'please wait\.\.\.?',
    ]
    
    for pattern in unwanted_patterns:
        text = re.sub(pattern, '', text, flags=re.IGNORECASE | re.MULTILINE)
    
    # Remove common boilerplate phrases individually 
    unwanted_phrases = [
        'cookie policy', 'privacy policy', 'terms of service', 'terms and conditions',
        'all rights reserved', 'copyright', '©', 'follow us', 'share this', 
        'subscribe', 'newsletter', 'sign up', 'log in', 'register',
        'click here', 'read more', 'learn more', 'continue reading',
        'advertisement', 'sponsored', 'promoted', 'recommended',
        'related articles', 'you might also like', 'popular posts',
        'back to top', 'scroll to top', 'page of',
        'comments', 'shares', 'likes', 'views',
        # Sports-specific boilerplate
        'to follow all the live action', 'live action from', 'points table',  
        'loading', 'share video on', 'view all', 'see more', 'filters season',
        'playoffs', 'copy all years', 'role batsman', 'nationality', 'bio',
        'magic moments', 'ipl exclusive', 'related videos', 
        '-->', '>>', '>>>', '<<<', '<<', '->', '<-', '=>', '<=',
        # Symbols and artifacts
        '', '', '', '', '', '', '', '', '', '', 
        # Empty content
        'tbd', 'to be determined', 'qualifier', 'eliminator', 
        'final', 'as per current points table'
    ]
    
    for phrase in unwanted_phrases:
        # More aggressive phrase removal with word boundaries
        text = re.sub(r'\b' + re.escape(phrase) + r'\b', '', text, flags=re.IGNORECASE)
        # Also try removing spaces around it just in case  
        text = re.sub(r'\s*' + re.escape(phrase) + r'\s*', ' ', text, flags=re.IGNORECASE)
    
    # Clean up whitespace thoroughly 
    text = re.sub(r'\s+', ' ', text)  # Collapse multiple spaces
    text = re.sub(r'\n\s+', '\n', text)  # Remove leading spaces on lines
    text = re.sub(r'\s+\n', '\n', text)  # Remove trailing spaces on lines
    text = re.sub(r'\n+', '\n', text)  # Collapse multiple newlines
    text = text.strip()
    
    # Split into lines and remove low-value lines
    lines = [line.strip() for line in text.split('\n') if line.strip()]
    meaningful_lines = []
    
    for line in lines:
        # Skip very short lines (likely just symbols or single words)
        if len(line) < 5:
            continue
            
        # Skip lines with high symbol-to-text ratio (likely layout artifacts)  
        alpha_chars = sum(1 for c in line if c.isalpha())
        total_chars = len(line)
        if total_chars > 0 and (alpha_chars / total_chars) < 0.3:
            continue
            
        # Skip lines with too many numbers in sequence (likely pagination)
        if re.search(r'\d{5,}', line):  # 5+ consecutive digits
            continue
            
        # Skip obvious boilerplate lines
        boilerplate_indicators = [
            'click', 'here', 'more', 'follow', 'share', 'subscribe', 
            'cookie', 'policy', 'privacy', 'terms', 'loading'
        ]
        if any(indicator in line.lower() for indicator in boilerplate_indicators):
            # But allow lines with content words too
            content_words = ['team', 'points', 'standings', 'table', 'rank', 'won', 'lost', 'nrr']
            if not any(word in line.lower() for word in content_words):
                continue
                
        meaningful_lines.append(line)
    
    # SPECIAL HANDLING FOR SPORTS STANDINGS PAGES
    # We no longer explicitly label this as "PLACEHOLDER CONTENT DETECTED" 
    # but we still use the detection to filter noise and guide the model.
    
    # identify if the page is primarily placeholders
    placeholder_terms = ['tbd', 'to be determined', 'qualifier', 'eliminator', 'final']
    has_placeholders = any(term in clean_text.lower() for term in placeholder_terms)
    has_actual_data = bool(re.search(r'\b\d+\s+(?:won|lost|points|pts|nrr|matches)\b', clean_text.lower()))
    
    if has_placeholders and not has_actual_data:
        # Instead of a loud "PLACEHOLDER DETECTED" label, we just return 
        # the cleaned text and let the model reason over the "TBD"s.
        result = ' '.join(meaningful_lines)
    else:
        # Prioritize structured content
        result = ' '.join(meaningful_lines)
    
    # Limit output length to avoid overwhelming the model
    max_length = 3000
    if len(result) > max_length:
        result = result[:max_length] + '... [content truncated]'
    
    return result if result.strip() else "No meaningful content extracted - page may be primarily boilerplate"

def _strip_html_to_text(html: str) -> str:
    """Simple regex based text extraction for HTML. (Fallback)"""
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
    description = "Fetches the full text content and title of a specific public URL. Use this when you have a direct link."
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
        is_safe, reason = await _is_safe_url(url)
        if not is_safe:
            return ToolResult(
                tool_name=self.name,
                input=input,
                error=reason,
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
                            try:
                                original_length = len(full_body)
                                content = _extract_meaningful_content(full_body)
                                extracted_length = len(content)
                                logger.info(f"Content extraction: {original_length} → {extracted_length} chars ({extracted_length/original_length*100:.1f}% kept)")
                                
                                # If extraction removed too much, fall back to basic extraction
                                if len(content.strip()) < 100:
                                    logger.warning("Content extraction removed too much, using fallback")
                                    content = _strip_html_to_text(full_body)
                            except Exception as e:
                                logger.warning(f"Content extraction failed, using fallback: {e}")
                                content = _strip_html_to_text(full_body)
                        else:
                            content = full_body
                    else:
                        content = full_body
                        
                    duration_ms = int((time.monotonic() - start_time) * 1000)
                    return ToolResult(
                        tool_name=self.name,
                        input=input,
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
                tool_name=self.name,
                input=input,
                error=f"HTTP error: {str(e)}",
                duration_ms=int((time.monotonic() - start_time) * 1000),
                sandboxed=False
            )
        except Exception as e:
            return ToolResult(
                tool_name=self.name,
                input=input,
                error=f"Fetch failed: {str(e)}",
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
