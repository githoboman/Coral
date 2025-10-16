import os
import json
import re
from datetime import datetime, timedelta
from typing import Dict, List, Optional, TypedDict, Annotated
import asyncio
from dotenv import load_dotenv
from zoneinfo import ZoneInfo
import logging
import sys

# LangChain imports
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.messages import HumanMessage, AIMessage
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import JsonOutputParser
from pydantic import BaseModel, Field

# LangGraph imports
from langgraph.graph import StateGraph, END
from langgraph.checkpoint.memory import MemorySaver

# Supabase import
from supabase import create_client, Client
import smtplib
from email.mime.text import MIMEText

# Windows-compatible logging setup
os.makedirs('logs', exist_ok=True)
logging.basicConfig(
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    level=logging.INFO,
    handlers=[
        logging.FileHandler('logs/copilot.log', encoding='utf-8'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)
