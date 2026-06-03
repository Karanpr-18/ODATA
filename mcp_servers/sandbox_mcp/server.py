"""
Code Sandbox MCP Server — Custom Model Context Protocol server
that executes Python scripts in isolated Docker containers.

Architecture:
1. Receives execute_python tool call via JSON-RPC over stdio
2. Spawns python:3.10-alpine Docker container with --network none
3. Pipes script code and data via stdin
4. Captures stdout/stderr with timeout
5. Forces docker rm -f in finally block — guaranteed cleanup
"""

import asyncio
import json
import logging
import os
import sys
import uuid

logging.basicConfig(level=logging.INFO, stream=sys.stderr)
logger = logging.getLogger(__name__)

DOCKER_IMAGE = os.environ.get("SANDBOX_DOCKER_IMAGE", "python:3.10-alpine")
TIMEOUT_SECONDS = int(os.environ.get("SANDBOX_TIMEOUT_SECONDS", "30"))

TOOLS = [
    {
        "name": "execute_python",
        "description": (
            "Execute a Python script in an isolated, air-gapped Docker container. "
            "The script receives input data via stdin as JSON. "
            "Output should be printed to stdout. "
            "The container is automatically destroyed after execution."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "code": {
                    "type": "string",
                    "description": "Python script code to execute",
                },
                "data_json": {
                    "type": "string",
                    "description": "JSON string of input data passed via stdin",
                    "default": "{}",
                },
            },
            "required": ["code"],
        },
    },
]


async def execute_in_sandbox(code: str, data_json: str = "{}") -> dict:
    """Execute Python code in an isolated Docker container.

    Security guarantees:
    - --network none: No internet access
    - --memory 256m: Memory limited
    - --cpus 0.5: CPU limited
    - --read-only: Filesystem is read-only (except /tmp)
    - --no-new-privileges: Cannot escalate privileges
    - try/finally: Container is ALWAYS force-destroyed
    """
    use_docker = os.environ.get("USE_DOCKER", "true").lower() == "true"
    container_name = f"sandbox-{uuid.uuid4().hex[:12]}"

    # Wrapper script that reads data from stdin and runs user code
    wrapper = f"""
import sys, json

try:
    input_data = json.load(sys.stdin)
except:
    input_data = {{}}

data = input_data.get("data", [])

# ── Begin user script ──
{code}
# ── End user script ──
"""

    try:
        if use_docker:
            logger.info("Starting sandbox: %s (image: %s)", container_name, DOCKER_IMAGE)
            proc = await asyncio.create_subprocess_exec(
                "docker", "run",
                "--rm",
                "--name", container_name,
                "--network", "none",
                "--memory", "256m",
                "--cpus", "0.5",
                "--read-only",
                "--tmpfs", "/tmp:size=64m",
                "--no-new-privileges",
                "-i",
                DOCKER_IMAGE,
                "python", "-c", wrapper,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
        else:
            logger.warning("Docker is disabled. Running script in host subprocess.")
            proc = await asyncio.create_subprocess_exec(
                sys.executable, "-c", wrapper,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )

        try:
            stdout, stderr = await asyncio.wait_for(
                proc.communicate(input=data_json.encode()),
                timeout=TIMEOUT_SECONDS,
            )
        except asyncio.TimeoutError:
            proc.kill()
            return {
                "success": False,
                "output": "",
                "error": f"Execution timed out after {TIMEOUT_SECONDS}s",
            }

        stdout_text = stdout.decode().strip()
        stderr_text = stderr.decode().strip()

        if proc.returncode != 0:
            return {
                "success": False,
                "output": stdout_text,
                "error": stderr_text,
            }

        return {
            "success": True,
            "output": stdout_text,
            "error": stderr_text if stderr_text else "",
        }

    except FileNotFoundError:
        return {
            "success": False,
            "output": "",
            "error": "Docker is not installed or not in PATH",
        }
    except Exception as e:
        return {
            "success": False,
            "output": "",
            "error": str(e),
        }
    finally:
        # ── FORCEFUL DESTRUCTION SEQUENCE ──
        try:
            kill_proc = await asyncio.create_subprocess_exec(
                "docker", "rm", "-f", container_name,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            await kill_proc.communicate()
            logger.info("Container destroyed: %s", container_name)
        except Exception as cleanup_err:
            logger.debug("Cleanup note (container may already be gone): %s", cleanup_err)


# ── MCP JSON-RPC Protocol Handler ──

async def handle_jsonrpc(request: dict) -> dict | None:
    """Handle a JSON-RPC 2.0 request."""
    method = request.get("method", "")
    req_id = request.get("id")
    params = request.get("params", {})

    if method == "initialize":
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {
                "protocolVersion": "2024-11-05",
                "capabilities": {"tools": {"listChanged": False}},
                "serverInfo": {"name": "sandbox-mcp", "version": "0.1.0"},
            },
        }

    elif method == "tools/list":
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {"tools": TOOLS},
        }

    elif method == "tools/call":
        tool_name = params.get("name", "")
        tool_args = params.get("arguments", {})

        if tool_name == "execute_python":
            result = await execute_in_sandbox(
                code=tool_args.get("code", ""),
                data_json=tool_args.get("data_json", "{}"),
            )
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {
                    "content": [{"type": "text", "text": json.dumps(result)}],
                    "isError": not result["success"],
                },
            }
        else:
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "error": {"code": -32601, "message": f"Unknown tool: {tool_name}"},
            }

    elif method == "notifications/initialized":
        return None

    else:
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {"code": -32601, "message": f"Method not found: {method}"},
        }


async def main():
    """Main loop: read JSON-RPC from stdin, write responses to stdout."""
    logger.info("Sandbox MCP Server starting (stdio mode, image: %s)", DOCKER_IMAGE)

    reader = asyncio.StreamReader()
    protocol = asyncio.StreamReaderProtocol(reader)
    await asyncio.get_event_loop().connect_read_pipe(lambda: protocol, sys.stdin)

    writer_transport, writer_protocol = await asyncio.get_event_loop().connect_write_pipe(
        asyncio.streams.FlowControlMixin, sys.stdout
    )
    writer = asyncio.StreamWriter(writer_transport, writer_protocol, reader, asyncio.get_event_loop())

    while True:
        line = await reader.readline()
        if not line:
            break

        line_str = line.decode().strip()
        if not line_str:
            continue

        try:
            request = json.loads(line_str)
            response = await handle_jsonrpc(request)

            if response is not None:
                response_str = json.dumps(response) + "\n"
                writer.write(response_str.encode())
                await writer.drain()

        except json.JSONDecodeError:
            logger.warning("Invalid JSON: %s", line_str[:100])
        except Exception as e:
            logger.error("Error: %s", e)


if __name__ == "__main__":
    asyncio.run(main())
