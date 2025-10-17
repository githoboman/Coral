from pydantic import BaseModel, EmailStr

class UserUpdate(BaseModel):
    user_id: str
    wallet_address: str
    email: EmailStr | None = None
    username: str | None = None
    first_name: str | None = None
    last_name: str | None = None

class UserCheck(BaseModel):
    user_id: str