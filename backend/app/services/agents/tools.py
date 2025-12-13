import logging
from typing import Optional, List, Type
from langchain_core.tools import BaseTool
from langchain_community.tools.tavily_search import TavilySearchResults
from pydantic import BaseModel, Field
from app.core.config import settings

logger = logging.getLogger(__name__)

# --- Tool Input Schemas ---
class WebSearchInput(BaseModel):
    query: str = Field(description="The query to search the web for.")

# --- Action Tools ---

class WebSearchTool(BaseTool):
    name: str = "web_search"
    description: str = "Search the web for current information, news, or specific data. Use this for ANY question about recent events (post-2023) or real-time data."
    args_schema: Type[BaseModel] = WebSearchInput
    
    def _run(self, query: str) -> str:
        """Execute synchronous search (not used in async agent usually, but good fallback)."""
        try:
            tool = TavilySearchResults(max_results=5)
            # We need to manually inject API key if not in env, 
            # but usually it picks up TAVILY_API_KEY from env.
            # Assuming settings load it to env or we pass it.
            if hasattr(settings, "TAVILY_API_KEY"):
                import os
                os.environ["TAVILY_API_KEY"] = settings.TAVILY_API_KEY
                
            return tool.invoke(query)
        except Exception as e:
            logger.error(f"Search tool error: {e}")
            return f"Error performing web search: {str(e)}"

    async def _arun(self, query: str) -> str:
        """Execute async search."""
        try:
            # Check availability
            if not getattr(settings, "TAVILY_API_KEY", None):
                return "Web search is disabled (no API key configured)."

            tool = TavilySearchResults(
                max_results=5,
                include_answer=True,
                include_raw_content=False 
            )
            # Tavily tool output is usually a list of dicts.
            results = await tool.ainvoke({"query": query})
            
            # Format results nicely for the LLM
            if isinstance(results, list):
                formatted = "\n".join([
                    f"- **{r.get('url', 'Source')}**: {r.get('content', '')[:300]}..." 
                    for r in results
                ])
                return f"Search Results:\n{formatted}"
            return str(results)
            
        except Exception as e:
            logger.error(f"Async search tool error: {e}")
            return f"Error performing web search: {str(e)}"

def get_agent_tools() -> List[BaseTool]:
    """Return a list of tools available to the agent."""
    return [
        WebSearchTool()
    ]
