import logging
from typing import List, Dict, Any, Optional
from langchain_google_genai import GoogleGenerativeAIEmbeddings
from langchain_community.vectorstores import SupabaseVectorStore
from supabase import Client
from app.core.config import settings

logger = logging.getLogger(__name__)

class VectorStoreService:
    """
    Service to handle vector/memory operations using Supabase and Gemini Embeddings.
    Assumes a 'documents' table exists in Supabase with pgvector.
    
    SQL Setup required in Supabase:
    -- Enable pgvector
    create extension if not exists vector;

    -- Create table
    create table documents (
      id bigserial primary key,
      content text,
      metadata jsonb,
      embedding vector(768) -- Dimension depends on the model (Gemini-embedding-001 is 768)
    );

    -- Create search function
    create or replace function match_documents (
      query_embedding vector(768),
      match_threshold float,
      match_count int,
      filter jsonb DEFAULT '{}'
    ) returns table (
      id bigint,
      content text,
      metadata jsonb,
      similarity float
    )
    language plpgsql
    as $$
    begin
      return query
      select
        id,
        content,
        metadata,
        1 - (documents.embedding <=> query_embedding) as similarity
      from documents
      where 1 - (documents.embedding <=> query_embedding) > match_threshold
      and metadata @> filter
      order by documents.embedding <=> query_embedding
      limit match_count;
    end;
    $$;
    """

    def __init__(self, supabase_client: Client):
        self.supabase = supabase_client
        self.embeddings = GoogleGenerativeAIEmbeddings(
            model="models/text-embedding-004", # Or text-embedding-001
            google_api_key=settings.GEMINI_API_KEY
        )
        self.vector_store = SupabaseVectorStore(
            client=self.supabase,
            embedding=self.embeddings,
            table_name="documents",
            query_name="match_documents"
        )

    async def add_memory(self, text: str, metadata: Dict[str, Any]):
        """Add a memory/interaction to the vector store."""
        try:
            # Metadata usually contains user_id, chat_id, role, timestamp
            await self.vector_store.aadd_texts(texts=[text], metadatas=[metadata])
            logger.info(f"Added memory to vector store for chat {metadata.get('chat_id')}")
        except Exception as e:
            logger.error(f"Failed to add memory: {e}")
            # Non-blocking failure, we don't want to crash the chat if memory fails
            pass

    async def recall_memories(self, query: str, user_id: str, limit: int = 5) -> str:
        """
        Retrieve relevant past memories.
        Returns a formatted string of context.
        """
        try:
            # We filter by user_id to ensure privacy/relevance
            results = await self.vector_store.asimilarity_search(
                query,
                k=limit,
                filter={"user_id": user_id}
            )
            
            if not results:
                return ""
            
            formatted_memories = "\n".join([
                f"[Memory]: {doc.page_content}" for doc in results
            ])
            return f"\nRelevant Context from Memory:\n{formatted_memories}\n"
            
        except Exception as e:
            logger.error(f"Failed to recall memories: {e}")
            return ""
