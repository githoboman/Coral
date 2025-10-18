from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.prompts import ChatPromptTemplate
from app.core.config import settings

llm = ChatGoogleGenerativeAI(model="gemini-2.5-flash", temperature=0.7, google_api_key=settings.GEMINI_API_KEY)
prompt = ChatPromptTemplate.from_template("""
You are Tovira, a friendly assistant. Respond casually and helpfully.

Context:
{context}

User: {query}
AI:
""")

def general_agent(state):
    chain = prompt | llm
    result = chain.invoke({"query": state["query"], "context": state["context"]})
    return {"response": result.content}
