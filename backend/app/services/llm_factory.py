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
    - ollama (using langchain_community or langchain_ollama)
    """
    settings = get_settings()
    provider = settings.llm_provider.lower()
    
    # Fallback to default configured model name if none is provided
    model = model_name or settings.groq_default_model

    logger.info("LLM Factory: Initializing model '%s' from provider '%s'", model, provider)

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
