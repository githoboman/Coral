# app/schema/user.py
from pydantic import BaseModel, EmailStr
from typing import Optional

class UserUpdate(BaseModel):
    user_id: str
    wallet_address: str
    email: EmailStr | None = None
    username: str | None = None
    first_name: str | None = None
    last_name: str | None = None

class UserOnboard(BaseModel):
    user_id: str
    email: EmailStr
    username: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None