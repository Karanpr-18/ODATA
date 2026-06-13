"""
Application configuration — loads all environment variables via Pydantic Settings.
"""

from functools import lru_cache
import os
from pathlib import Path
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Central configuration loaded from environment variables or .env file."""

    # ── LLM Configuration (Multi-Provider Support) ──
    llm_provider: str = "groq"                # "groq" | "openai" | "anthropic" | "gemini" | "ollama"
    groq_api_key: str = ""
    groq_default_model: str = "llama-3.3-70b-versatile"
    openai_api_key: str = ""
    anthropic_api_key: str = ""
    gemini_api_key: str = ""
    mistral_api_key: str = ""

    # ── SurrealDB ──
    surreal_url: str = "ws://localhost:8001/rpc"
    surreal_user: str = "root"
    surreal_pass: str = "root"
    surreal_ns: str = "sap"
    surreal_db: str = "odata"

    # ── Ollama (Local Embeddings) ──
    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = "nomic-embed-text"

    # ── SAP OData Gateway (mocked for now) ──
    sap_odata_base_url: str = "https://sap-gateway.example.com/sap/opu/odata/sap/"
    sap_client: str = "100"

    # ── Code Sandbox ──
    use_docker: bool = True
    sandbox_docker_image: str = "python:3.10-alpine"
    sandbox_timeout_seconds: int = 30

    # ── Available Groq Models ──
    @property
    def available_models(self) -> list[dict[str, str]]:
        return [
            {
                "id": "llama-3.3-70b-versatile",
                "name": "Llama 3.3 70B",
                "description": "Highly capable, recommended for complex queries",
            },
            {
                "id": "llama-3.1-8b-instant",
                "name": "Llama 3.1 8B",
                "description": "Ultra-fast responses",
            },
            {
                "id": "openai/gpt-oss-120b",
                "name": "GPT-OSS 120B",
                "description": "OpenAI open-weight Mixture-of-Experts",
            },
            {
                "id": "qwen/qwen3-32b",
                "name": "Qwen 3 32B",
                "description": "Dual-mode logic thinking model",
            },
            {
                "id": "meta-llama/llama-4-scout-17b-16e-instruct",
                "name": "Llama 4 Scout 17B",
                "description": "Meta multimodal active MoE model",
            },
        ]

    # Resolve project root .env dynamically to eliminate the need for duplicate files
    model_config = {
        "env_file": (
            Path(__file__).resolve().parent.parent.parent / ".env",
            Path(os.getcwd()) / ".env",
        ),
        "env_file_encoding": "utf-8",
        "extra": "ignore"
    }


@lru_cache
def get_settings() -> Settings:
    """Cached singleton settings instance."""
    return Settings()
