"""
Unified LLM Factory

Dynamically instantiates LangChain Chat Model wrappers based on the 
configured provider (Groq, OpenAI, Anthropic, Gemini, Ollama). Uses 
dynamic imports to avoid forcing unnecessary package dependencies on startup.
"""

import logging
from typing import Any

from app.config import get_settings

logger = logging.getLogger(__name__)

def get_llm(model_name: str | None = None, temperature: float = 0.0, max_tokens: int = 1024) -> Any:
    """Create and return a LangChain Chat Model dynamically.

    Supported Providers:
    - groq (using langchain_groq)
    - openai (using langchain_openai)
    - anthropic (using langchain_anthropic)
    - gemini (using langchain_google_genai)
    - mistral (using langchain_mistralai)
    - ollama (using langchain_community or langchain_ollama)
    """
    settings = get_settings()
    
    # Fallback to default configured model name if none is provided
    model = model_name or settings.groq_default_model

    # Resolve provider dynamically based on model name prefix if possible
    model_lower = model.lower()
    if model_lower.startswith("gpt-") or "openai" in model_lower:
        provider = "openai"
    elif model_lower.startswith("claude-") or "anthropic" in model_lower:
        provider = "anthropic"
    elif "gemini" in model_lower:
        provider = "gemini"
    elif "mistral" in model_lower or model_lower.startswith("open-mistral") or model_lower.startswith("open-mixtral"):
        provider = "mistral"
    elif "llama" in model_lower or "qwen" in model_lower or "scout" in model_lower or "gsk_" in settings.groq_api_key:
        provider = "groq"
    else:
        provider = settings.llm_provider.lower()

    logger.info("LLM Factory: Initializing model '%s' from resolved provider '%s'", model, provider)

    if provider == "groq":
        try:
            from langchain_groq import ChatGroq
            return ChatGroq(
                model=model,
                api_key=settings.groq_api_key,
                temperature=temperature,
                max_tokens=max_tokens,
            )
        except ImportError:
            raise ImportError(
                "langchain_groq is not installed. Please install it with: "
                "pip install langchain-groq"
            )

    elif provider == "openai":
        try:
            from langchain_openai import ChatOpenAI
            return ChatOpenAI(
                model=model,
                api_key=settings.openai_api_key,
                temperature=temperature,
                max_tokens=max_tokens,
            )
        except ImportError:
            raise ImportError(
                "langchain_openai is not installed. Please install it with: "
                "pip install langchain-openai"
            )

    elif provider == "anthropic":
        try:
            from langchain_anthropic import ChatAnthropic
            return ChatAnthropic(
                model=model,
                api_key=settings.anthropic_api_key,
                temperature=temperature,
                max_tokens=max_tokens,
            )
        except ImportError:
            raise ImportError(
                "langchain_anthropic is not installed. Please install it with: "
                "pip install langchain-anthropic"
            )

    elif provider in ("gemini", "google"):
        try:
            from langchain_google_genai import ChatGoogleGenerativeAI
            return ChatGoogleGenerativeAI(
                model=model,
                api_key=settings.gemini_api_key,
                temperature=temperature,
                max_tokens=max_tokens,
            )
        except ImportError:
            raise ImportError(
                "langchain_google_genai is not installed. Please install it with: "
                "pip install langchain-google-genai"
            )

    elif provider == "mistral":
        try:
            from langchain_mistralai import ChatMistralAI
            return ChatMistralAI(
                model=model,
                api_key=settings.mistral_api_key,
                temperature=temperature,
                max_tokens=max_tokens,
            )
        except ImportError:
            raise ImportError(
                "langchain_mistralai is not installed. Please install it with: "
                "pip install langchain-mistralai"
            )

    elif provider == "ollama":
        try:
            # Try newer langchain_ollama package first, fallback to community
            try:
                from langchain_ollama import ChatOllama
            except ImportError:
                from langchain_community.chat_models import ChatOllama
                
            return ChatOllama(
                model=model,
                base_url=settings.ollama_base_url,
                temperature=temperature,
            )
        except ImportError:
            raise ImportError(
                "langchain_community or langchain_ollama is not installed. "
                "Please install it to use local Ollama chat models."
            )

    else:
        logger.warning("Unknown LLM provider '%s'. Falling back to local Ollama Chat Model.", provider)
        try:
            from langchain_community.chat_models import ChatOllama
            return ChatOllama(
                model=model,
                base_url=settings.ollama_base_url,
                temperature=temperature,
            )
        except ImportError:
            raise ImportError(
                f"Unknown provider '{provider}', and langchain_community.ChatOllama is not available."
            )


def extract_token_usage(response) -> dict:
    """Safely extract input, output, and total token counts from LLM responses."""
    res = {"input": 0, "output": 0, "total": 0}
    if not response:
        return res
        
    # Standard Langchain usage_metadata
    if hasattr(response, "usage_metadata") and response.usage_metadata:
        um = response.usage_metadata
        res["input"] = um.get("input_tokens", 0) or 0
        res["output"] = um.get("output_tokens", 0) or 0
        res["total"] = um.get("total_tokens", 0) or 0
        return res

    # Fallback to response_metadata
    rm = getattr(response, "response_metadata", {}) or {}
    
    # Check token_usage or usage dict
    tu = rm.get("token_usage") or rm.get("usage")
    if tu and isinstance(tu, dict):
        res["input"] = tu.get("prompt_tokens", 0) or tu.get("input_tokens", 0) or 0
        res["output"] = tu.get("completion_tokens", 0) or tu.get("output_tokens", 0) or 0
        res["total"] = tu.get("total_tokens", 0) or 0
        return res

    # Groq specific fallback
    groq_meta = rm.get("x_groq")
    if groq_meta and isinstance(groq_meta, dict):
        usage = groq_meta.get("usage")
        if usage and isinstance(usage, dict):
            res["input"] = usage.get("prompt_tokens", 0) or 0
            res["output"] = usage.get("completion_tokens", 0) or 0
            res["total"] = usage.get("total_tokens", 0) or 0
            return res

    return res
