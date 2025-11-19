# app/schemas/event.py
from pydantic import BaseModel, Field, field_validator
from datetime import datetime
from typing import Optional, List, Literal


class EventBase(BaseModel):
    """Base event schema with common fields"""
    event_name: str = Field(..., min_length=1, max_length=500,
                            description="Name/title of the event")
    description: Optional[str] = Field(
        None, max_length=2000, description="Detailed description of the event")
    event_date: datetime = Field(...,
                                 description="Date of the event (ISO format)")
    event_time: Optional[str] = Field(
        None, pattern=r'^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$', description="Time in HH:MM format")
    color: Literal[
        "bg-blue-500",
        "bg-red-500",
        "bg-green-500",
        "bg-purple-500",
        "bg-yellow-500",
        "bg-pink-500",
        "bg-indigo-500",
        "bg-orange-500"
    ] = Field(default="bg-blue-500", description="Event color for UI display")
    location: Optional[str] = Field(
        None, max_length=500, description="Event location")
    is_all_day: bool = Field(
        default=False, description="Whether the event is all day")
    tags: Optional[List[str]] = Field(
        default=[], description="Tags for categorizing the event")
    attendees: Optional[List[str]] = Field(
        default=[], description="List of attendee emails/names")
    is_recurring: bool = Field(
        default=False, description="Whether the event repeats")
    reminder_times: Optional[List[datetime]] = Field(
        default=[], description="Reminder timestamps")

    @field_validator("tags")
    @classmethod
    def validate_tags(cls, v):
        if v and len(v) > 20:
            raise ValueError("Maximum 20 tags allowed")
        return v

    @field_validator("attendees")
    @classmethod
    def validate_attendees(cls, v):
        if v and len(v) > 50:
            raise ValueError("Maximum 50 attendees allowed")
        return v

    @field_validator("reminder_times")
    @classmethod
    def validate_reminders(cls, v):
        if v and len(v) > 10:
            raise ValueError("Maximum 10 reminder times allowed")
        return v


class EventCreate(EventBase):
    """Schema for creating a new event"""
    user_id: str = Field(..., min_length=1,
                         description="User ID who owns the event")


class EventUpdate(BaseModel):
    """Schema for updating an existing event (all fields optional)"""
    event_name: Optional[str] = Field(None, min_length=1, max_length=500)
    description: Optional[str] = Field(None, max_length=2000)
    event_date: Optional[datetime] = None
    event_time: Optional[str] = Field(
        None, pattern=r'^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$')
    color: Optional[Literal[
        "bg-blue-500",
        "bg-red-500",
        "bg-green-500",
        "bg-purple-500",
        "bg-yellow-500",
        "bg-pink-500",
        "bg-indigo-500",
        "bg-orange-500"
    ]] = None
    location: Optional[str] = Field(None, max_length=500)
    is_all_day: Optional[bool] = None
    tags: Optional[List[str]] = None
    attendees: Optional[List[str]] = None
    is_recurring: Optional[bool] = None
    reminder_times: Optional[List[datetime]] = None

    @field_validator("tags")
    @classmethod
    def validate_tags(cls, v):
        if v and len(v) > 20:
            raise ValueError("Maximum 20 tags allowed")
        return v

    @field_validator("attendees")
    @classmethod
    def validate_attendees(cls, v):
        if v and len(v) > 50:
            raise ValueError("Maximum 50 attendees allowed")
        return v

    @field_validator("reminder_times")
    @classmethod
    def validate_reminders(cls, v):
        if v and len(v) > 10:
            raise ValueError("Maximum 10 reminder times allowed")
        return v


class EventResponse(BaseModel):
    """Schema for event response"""
    id: int
    user_id: str
    event_name: str
    description: Optional[str] = None
    event_date: datetime
    event_time: Optional[str] = None
    color: str = "bg-blue-500"
    location: Optional[str] = None
    is_all_day: bool = False
    tags: List[str] = []
    attendees: List[str] = []
    is_recurring: bool = False
    reminder_times: List[datetime] = []
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class EventListResponse(BaseModel):
    """Schema for paginated event list response"""
    events: List[EventResponse]
    total: int
    limit: int
    offset: int


class EventBulkCreate(BaseModel):
    """Schema for creating multiple events at once"""
    user_id: str = Field(..., min_length=1,
                         description="User ID who owns the events")
    events: List[EventBase] = Field(..., min_items=1, max_items=50,
                                    description="List of events to create (max 50)")

    @field_validator("events")
    @classmethod
    def validate_events(cls, v):
        if len(v) > 50:
            raise ValueError("Maximum 50 events can be created at once")
        return v
