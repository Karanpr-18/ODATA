"""
Sandbox Node — Executes generated Python scripts in an air-gapped
Docker container for secure, ephemeral computation.

Uses the self-made custom approach: spawns a python:3.10-alpine container,
pipes code and data through stdin, captures stdout/stderr, and forcefully
destroys the container immediately after execution.
"""

import asyncio
import json
import logging
import tempfile
import uuid
from typing import Any

from app.config import get_settings
from app.graph.state import AgentState

logger = logging.getLogger(__name__)


async def run_sandbox(state: AgentState) -> dict[str, Any]:
    """Execute a Python calculation script in an isolated Docker container.

    Lifecycle:
    1. Generate a unique container name
    2. Prepare the script + data payload
    3. Spawn docker run with --network none (air-gapped)
    4. Pipe script via stdin, capture stdout/stderr
    5. ALWAYS force-destroy container in finally block
    """
    settings = get_settings()
    generated_query = state.get("generated_query", "")
    calculation_script = state.get("calculation_script", "")
    data_buffer = state.get("data_buffer", [])

    # Extract Python code from calculation_script, falling back to generated_query
    code = calculation_script or generated_query
    if not code:
        return {"calculation_result": "", "error": "No script to execute"}

    if "```python" in code:
        code = code.split("```python")[1].split("```")[0].strip()
    elif "```" in code:
        code = code.split("```")[1].split("```")[0].strip()

    # Static Python Script Schema Guardrails & AST Linting
    from app.services.linter import validate_python_script
    matched_entity = state.get("matched_entity", {})
    lint_err = validate_python_script(code, matched_entity)
    if lint_err:
        logger.warning("Python static AST linter rejected script. Error: %s", lint_err)
        error_msg = f"Static AST Lint Error: {lint_err}"
        updates = {
            "calculation_result": "",
            "error": error_msg,
        }
        if state.get("retry_count", 0) == 0:
            updates["first_failed_query"] = generated_query
            updates["first_error"] = error_msg
        return updates

    container_name = f"sap-sandbox-{uuid.uuid4().hex[:12]}"
    container_id: str | None = None

    logger.info("Sandbox execution starting: container=%s", container_name)

    try:
        # Prepare the input payload (code reads from stdin as JSON)
        input_payload = json.dumps(data_buffer)

        # Build the wrapper script that reads data from stdin
        wrapper_script = f"""
import sys, json, io

# Create a compatibility list subclass that mimics OData dict structures
class HybridList(list):
    def __getitem__(self, key):
        if isinstance(key, str):
            if key in ('value', 'data', 'results', 'd'):
                return self
            raise KeyError(f"String key '{{key}}' not found in OData list payload")
        return super().__getitem__(key)
    
    def get(self, key, default=None):
        if key in ('value', 'data', 'results', 'd'):
            return self
        return default

# Backup original json decoders
_orig_load = json.load
_orig_loads = json.loads

def custom_load(*args, **kwargs):
    res = _orig_load(*args, **kwargs)
    if isinstance(res, list):
        return HybridList(res)
    return res

def custom_loads(*args, **kwargs):
    res = _orig_loads(*args, **kwargs)
    if isinstance(res, list):
        return HybridList(res)
    return res

json.load = custom_load
json.loads = custom_loads

# Read and cache stdin content to allow duplicate reads
stdin_content = sys.stdin.read()
sys.stdin = io.StringIO(stdin_content)

# Parse data for the wrapper
data = json.loads(stdin_content)
if isinstance(data, dict) and "data" in data:
    data = data["data"]

# Inject robust pandas read_json compatibility patch to intercept common OData path loading mistakes
try:
    import pandas as pd
    _orig_read_json = pd.read_json
    def custom_read_json(path_or_buf, *args, **kwargs):
        if isinstance(path_or_buf, str) and (path_or_buf.startswith('/') or '?' in path_or_buf or '$' in path_or_buf or '/' in path_or_buf):
            # Intercepted OData request path or relative URL: return loaded list as DataFrame
            return pd.DataFrame(data)
        return _orig_read_json(path_or_buf, *args, **kwargs)
    pd.read_json = custom_read_json

    # Patch groupby to default to dropna=False to avoid dropping rows with null keys
    _orig_df_groupby = pd.DataFrame.groupby
    def custom_df_groupby(self, *args, **kwargs):
        if 'dropna' not in kwargs:
            kwargs['dropna'] = False
        return _orig_df_groupby(self, *args, **kwargs)
    pd.DataFrame.groupby = custom_df_groupby

    _orig_series_groupby = pd.Series.groupby
    def custom_series_groupby(self, *args, **kwargs):
        if 'dropna' not in kwargs:
            kwargs['dropna'] = False
        return _orig_series_groupby(self, *args, **kwargs)
    pd.Series.groupby = custom_series_groupby
except:
    pass

# ── User-generated calculation script ──
{code}
"""

        if settings.use_docker:
            # Spawn the Docker container
            proc = await asyncio.create_subprocess_exec(
                "docker", "run",
                "--rm",                                    # Auto-remove on exit
                "--name", container_name,                  # Named for force-cleanup
                "--network", "none",                       # Air-gapped: no network
                "--memory", "256m",                        # Memory limit
                "--cpus", "0.5",                           # CPU limit
                "-i",                                      # Interactive (stdin open)
                settings.sandbox_docker_image,             # python:3.10-alpine
                "python", "-c", wrapper_script,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            container_id = container_name
        else:
            import sys
            logger.warning("Docker is disabled. Running script in host subprocess (SANDBOX IS NOT ISOLATED!).")
            proc = await asyncio.create_subprocess_exec(
                sys.executable, "-c", wrapper_script,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )

        # Send data through stdin and wait for completion
        try:
            stdout, stderr = await asyncio.wait_for(
                proc.communicate(input=input_payload.encode()),
                timeout=settings.sandbox_timeout_seconds,
            )
        except asyncio.TimeoutError:
            logger.warning("Sandbox timed out after %ds", settings.sandbox_timeout_seconds)
            proc.kill()
            error_msg = f"Sandbox timed out after {settings.sandbox_timeout_seconds}s"
            updates = {
                "calculation_result": "",
                "error": error_msg,
            }
            if state.get("retry_count", 0) == 0:
                updates["first_failed_query"] = generated_query
                updates["first_error"] = error_msg
            return updates

        stdout_text = stdout.decode().strip()
        stderr_text = stderr.decode().strip()

        if proc.returncode != 0:
            logger.warning("Sandbox script failed (exit %d): %s", proc.returncode, stderr_text)
            error_msg = f"Script execution failed: {stderr_text}"
            updates = {
                "calculation_result": "",
                "error": error_msg,
            }
            if state.get("retry_count", 0) == 0:
                updates["first_failed_query"] = generated_query
                updates["first_error"] = error_msg
            return updates

        logger.info("Sandbox execution completed successfully (%d bytes output)", len(stdout_text))

        return {
            "calculation_result": stdout_text,
            "error": "",
        }

    except FileNotFoundError:
        logger.error("Docker not found — is Docker installed and in PATH?")
        return {
            "calculation_result": "",
            "error": "Docker is not installed or not in PATH. Cannot run sandbox.",
        }
    except Exception as e:
        logger.error("Sandbox execution error: %s", e)
        error_msg = f"Sandbox error: {e}"
        updates = {
            "calculation_result": "",
            "error": error_msg,
        }
        if state.get("retry_count", 0) == 0:
            updates["first_failed_query"] = generated_query
            updates["first_error"] = error_msg
        return updates
    finally:
        # ── FORCEFUL DESTRUCTION SEQUENCE ──
        # Guarantee container teardown regardless of outcome
        if container_id:
            try:
                kill_proc = await asyncio.create_subprocess_exec(
                    "docker", "rm", "-f", container_id,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                )
                await kill_proc.communicate()
                logger.info("Sandbox container forcefully destroyed: %s", container_id)
            except Exception as cleanup_error:
                logger.warning(
                    "Container cleanup warning (may already be removed): %s",
                    cleanup_error,
                )
