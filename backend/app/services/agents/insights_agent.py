from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.prompts import ChatPromptTemplate
from app.core.config import settings

llm = ChatGoogleGenerativeAI(model="gemini-2.5-flash", google_api_key=settings.GEMINI_API_KEY)

prompt = ChatPromptTemplate.from_template("""
You are Tovira's Insights Agent. Analyze the crypto market or token performance.
Include relevant metrics, risks, and opportunities briefly.

Context:
{context}

User: {query}
""")

def insights_agent(state):
    chain = prompt | llm
    result = chain.invoke({"query": state["query"], "context": state["context"]})
    return {"response": result.content}
