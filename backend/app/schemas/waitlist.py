from pydantic import BaseModel, EmailStr

class WaitlistEmail(BaseModel):
    email: EmailStr