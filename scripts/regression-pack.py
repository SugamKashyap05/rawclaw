#!/usr/bin/env python3
"""
RawClaw regression pack runner.

Runs the main evaluation suites in sequence:
- combined chat continuity
- web research progression
- JARVIS upgrade

The runner preserves each suite's live console output and writes a combined
summary JSON report for quick review.

Usage:
    python scripts/regression-pack.py gemma4:31b-cloud
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Dict, List, Optional, Any


DEFAULT_MODEL = "ollama/llama3.2:3b"
API_BASE = "http://localhost:3000/api"
AUTH_SECRET = "Kuki7816"
ANSI_ESCAPE_RE = re.compile(r"\x1b\[[0-9;]*m")


class Colors:
    HEADER = '\033[95m'
    BLUE = '\033[94m'
    CYAN = '\033[96m'
    GREEN = '\033[92m'
    YELLOW = '\033[93m'
    RED = '\033[91m'
    ENDC = '\033[0m'
    BOLD = '\033[1m'


def log_header(text: str):
    print(f"\n{Colors.HEADER}{'=' * 80}{Colors.ENDC}")
    print(f"{Colors.BOLD}{text.center(80)}{Colors.ENDC}")
    print(f"{Colors.HEADER}{'=' * 80}{Colors.ENDC}\n")


def log_info(msg: str):
    print(f"{Colors.YELLOW}[i]{Colors.ENDC} {msg}")


def log_success(msg: str):
    print(f"{Colors.GREEN}[+]{Colors.ENDC} {msg}")


def log_error(msg: str):
    print(f"{Colors.RED}[!]{Colors.ENDC} {msg}")


def _parse_saved_artifacts(output: str) -> List[str]:
    matches = re.findall(r"saved to ([^\r\n]+)", output, flags=re.IGNORECASE)
    cleaned = []
    for match in matches:
        normalized = ANSI_ESCAPE_RE.sub("", match).strip()
        if normalized:
            cleaned.append(normalized)
    return list(dict.fromkeys(cleaned))


def _parse_pass_rate(output: str) -> Optional[float]:
    match = re.search(r"Pass Rate:\s+([0-9.]+)%", output)
    if not match:
        return None
    try:
        return float(match.group(1))
    except ValueError:
        return None


def _parse_counts(output: str) -> Dict[str, Optional[int]]:
    patterns = {
        "total": r"Total (?:Combined|Web Research|JARVIS) Cases:\s+(\d+)",
        "passed": r"Passed:\s+(\d+)",
    }
    parsed: Dict[str, Optional[int]] = {"total": None, "passed": None}
    for key, pattern in patterns.items():
        match = re.search(pattern, output)
        if match:
            try:
                parsed[key] = int(match.group(1))
            except ValueError:
                parsed[key] = None
    return parsed


class HarnessControllerClient:
    def __init__(self, api_base: str, auth_secret: str) -> None:
        self.api_base = api_base.rstrip("/")
        self.auth_secret = auth_secret
        self.token: Optional[str] = None

    def _request(self, path: str, method: str = "GET", payload: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
        url = f"{self.api_base}{path}"
        headers = {"Content-Type": "application/json"}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        data = json.dumps(payload).encode("utf-8") if payload is not None else None
        request = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=10) as response:
                body = response.read().decode("utf-8")
                return json.loads(body) if body else {}
        except Exception:
            return None

    def connect(self) -> bool:
        response = self._request("/auth/token", method="POST", payload={"secret": self.auth_secret})
        token = (response or {}).get("access_token")
        if not token:
            return False
        self.token = token
        return True

    def start_run(self, payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        return self._request("/process-controller/runs", method="POST", payload=payload)

    def heartbeat_run(self, run_id: str, metadata: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
        return self._request(f"/process-controller/runs/{run_id}/heartbeat", method="PATCH", payload={"metadata": metadata or {}})

    def complete_run(self, run_id: str, payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        return self._request(f"/process-controller/runs/{run_id}/complete", method="PATCH", payload=payload)

    def start_process(self, run_id: str, payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        return self._request(f"/process-controller/runs/{run_id}/processes", method="POST", payload=payload)

    def update_process(self, process_id: str, payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        return self._request(f"/process-controller/processes/{process_id}", method="PATCH", payload=payload)


def run_suite(
    name: str,
    command: List[str],
    cwd: Path,
    controller: Optional[HarnessControllerClient] = None,
    controller_run_id: Optional[str] = None,
) -> Dict[str, object]:
    print(f"{Colors.CYAN}>>> Running {name}{Colors.ENDC}")
    print(f"{Colors.BLUE}$ {' '.join(command)}{Colors.ENDC}")
    start = time.time()
    output_lines: List[str] = []

    process = subprocess.Popen(
        command,
        cwd=str(cwd),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        bufsize=1,
    )
    controller_process_id: Optional[str] = None
    if controller and controller_run_id:
        started = controller.start_process(
            controller_run_id,
            {
                "name": name,
                "suiteKey": re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-"),
                "command": command,
                "pid": process.pid,
                "metadata": {"cwd": str(cwd)},
            },
        )
        controller_process_id = (started or {}).get("id")

    assert process.stdout is not None
    for line in process.stdout:
        print(line, end="")
        output_lines.append(line)

    return_code = process.wait()
    duration = time.time() - start
    output = "".join(output_lines)
    counts = _parse_counts(output)

    result = {
        "name": name,
        "command": command,
        "return_code": return_code,
        "passed": return_code == 0,
        "duration_seconds": round(duration, 2),
        "pass_rate": _parse_pass_rate(output),
        "counts": counts,
        "artifacts": _parse_saved_artifacts(output),
    }

    if controller and controller_run_id:
        controller.heartbeat_run(controller_run_id, {"lastSuite": name})
    if controller and controller_process_id:
        controller.update_process(
            controller_process_id,
            {
                "status": "passed" if return_code == 0 else "failed",
                "durationSeconds": round(duration, 2),
                "outputLog": output[-12000:],
                "summary": {
                    "passRate": result["pass_rate"],
                    "counts": counts,
                    "returnCode": return_code,
                },
                "artifacts": result["artifacts"],
                "metadata": {"cwd": str(cwd)},
            },
        )

    if return_code == 0:
        log_success(f"{name} passed in {duration:.2f}s")
    else:
        log_error(f"{name} failed in {duration:.2f}s")

    print()
    return result


def main() -> int:
    import argparse

    parser = argparse.ArgumentParser(description="Run the main RawClaw regression suites as one pack")
    parser.add_argument("model_id", nargs="?", default=DEFAULT_MODEL, help="Model ID to use for all suites")
    parser.add_argument("--model", type=str, help="Alias for model_id")
    parser.add_argument("--combined-prompt-pack", default="rawclaw-default", help="Prompt pack for combined chat suite")
    parser.add_argument("--web-prompt-pack", default="rawclaw-default", help="Prompt pack for web research suite")
    parser.add_argument("--jarvis-prompt-pack", default="rawclaw-jarvis", help="Prompt pack for JARVIS suite")
    args, unknown = parser.parse_known_args()

    model_to_use = args.model or args.model_id
    if unknown:
        for token in unknown:
            if not token.startswith("-"):
                model_to_use = token
                break

    workspace = Path(__file__).resolve().parent.parent
    python_exe = sys.executable
    controller = HarnessControllerClient(API_BASE, AUTH_SECRET)
    controller_connected = controller.connect()

    suites = [
        {
            "name": "Combined Chat Session Test",
            "command": [
                python_exe,
                "scripts/combined-chat-session-test.py",
                model_to_use,
                "--prompt-pack",
                args.combined_prompt_pack,
            ],
        },
        {
            "name": "Web Research Progression Test",
            "command": [
                python_exe,
                "scripts/web-research-progression-test.py",
                model_to_use,
                "--prompt-pack",
                args.web_prompt_pack,
            ],
        },
        {
            "name": "JARVIS Upgrade Test",
            "command": [
                python_exe,
                "scripts/jarvis-upgrade-test.py",
                model_to_use,
                "--prompt-pack",
                args.jarvis_prompt_pack,
            ],
        },
    ]

    log_header("RawClaw Regression Pack")
    log_info(f"Workspace: {workspace}")
    log_info(f"Model:     {model_to_use}")
    log_info(f"Python:    {python_exe}")
    log_info(f"Harness API: {'connected' if controller_connected else 'offline'}")

    controller_run_id: Optional[str] = None
    if controller_connected:
        created = controller.start_run(
            {
                "name": f"Regression Pack {time.strftime('%Y-%m-%d %H:%M:%S')}",
                "kind": "regression-pack",
                "modelId": model_to_use,
                "workspace": str(workspace),
                "metadata": {
                    "suites": [suite["name"] for suite in suites],
                    "promptPacks": {
                        "combined": args.combined_prompt_pack,
                        "web": args.web_prompt_pack,
                        "jarvis": args.jarvis_prompt_pack,
                    },
                },
            }
        )
        controller_run_id = (created or {}).get("id")

    results = [run_suite(suite["name"], suite["command"], workspace, controller if controller_connected else None, controller_run_id) for suite in suites]

    passed_count = sum(1 for result in results if result["passed"])
    total = len(results)
    overall_pass_rate = (passed_count / total) * 100 if total else 0.0

    log_header("Regression Summary")
    print(f"{Colors.BOLD}Suites Run:{Colors.ENDC}     {total}")
    print(f"{Colors.BOLD}Suites Passed:{Colors.ENDC}  {passed_count}")
    print(f"{Colors.BOLD}Pass Rate:{Colors.ENDC}      {overall_pass_rate:.1f}%")

    for result in results:
        status = "PASS" if result["passed"] else "FAIL"
        counts = result.get("counts") or {}
        counts_text = ""
        if counts.get("total") is not None and counts.get("passed") is not None:
            counts_text = f" ({counts['passed']}/{counts['total']})"
        print(
            f"- {result['name']}: {status}{counts_text}, "
            f"{result['duration_seconds']}s"
            + (f", suite pass rate {result['pass_rate']:.1f}%" if result.get("pass_rate") is not None else "")
        )
        for artifact in result.get("artifacts", []):
            print(f"  artifact: {artifact}")

    report = {
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
        "model": model_to_use,
        "workspace": str(workspace),
        "results": results,
        "summary": {
            "suites_run": total,
            "suites_passed": passed_count,
            "pass_rate": round(overall_pass_rate, 1),
        },
    }

    report_path = workspace / f"regression-pack-results-{time.strftime('%Y%m%d-%H%M%S')}.json"
    report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    log_info(f"Combined report saved to {report_path.name}")

    if controller_connected and controller_run_id:
        controller.complete_run(
            controller_run_id,
            {
                "status": "passed" if passed_count == total else "failed",
                "summary": report["summary"],
                "artifacts": [artifact for result in results for artifact in result.get("artifacts", [])],
                "metadata": {"reportPath": report_path.name},
            },
        )

    return 0 if passed_count == total else 1


if __name__ == "__main__":
    sys.exit(main())
