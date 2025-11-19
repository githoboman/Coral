# app/schemas/task.py
from pydantic import BaseModel, Field, field_validator
from datetime import datetime
from typing import Optional, List, Literal


class TaskBase(BaseModel):
    """Base task schema with common fields"""
    task_name: str = Field(..., min_length=1, max_length=500,
                           description="Name/title of the task")
    description: Optional[str] = Field(
        None, max_length=2000, description="Detailed description of the task")
    due_date: Optional[datetime] = Field(
        None, description="When the task is due (ISO format)")
    priority: Literal["low", "medium", "high"] = Field(
        default="medium", description="Task priority level")
    tags: Optional[List[str]] = Field(
        default=[], description="Tags for categorizing the task")
    is_recurring: bool = Field(
        default=False, description="Whether the task repeats")
    reminder_times: Optional[List[datetime]] = Field(
        default=[], description="Reminder timestamps")

    @field_validator("tags")
    @classmethod
    def validate_tags(cls, v):
        if v and len(v) > 20:
            raise ValueError("Maximum 20 tags allowed")
        return v

    @field_validator("reminder_times")
    @classmethod
    def validate_reminders(cls, v):
        if v and len(v) > 10:
            raise ValueError("Maximum 10 reminder times allowed")
        return v


class TaskCreate(TaskBase):
    """Schema for creating a new task"""
    user_id: str = Field(..., min_length=1,
                         description="User ID who owns the task")


class TaskUpdate(BaseModel):
    """Schema for updating an existing task (all fields optional)"""
    task_name: Optional[str] = Field(None, min_length=1, max_length=500)
    description: Optional[str] = Field(None, max_length=2000)
    due_date: Optional[datetime] = None
    priority: Optional[Literal["low", "medium", "high"]] = None
    status: Optional[Literal["pending", "completed",
                             "cancelled", "in_progress"]] = None
    tags: Optional[List[str]] = None
    is_recurring: Optional[bool] = None
    reminder_times: Optional[List[datetime]] = None

    @field_validator("tags")
    @classmethod
    def validate_tags(cls, v):
        if v and len(v) > 20:
            raise ValueError("Maximum 20 tags allowed")
        return v

    @field_validator("reminder_times")
    @classmethod
    def validate_reminders(cls, v):
        if v and len(v) > 10:
            raise ValueError("Maximum 10 reminder times allowed")
        return v


class TaskResponse(BaseModel):
    """Schema for task response"""
    id: int
    user_id: str
    task_name: str
    description: Optional[str] = None
    due_date: Optional[datetime] = None
    priority: str
    status: str
    created_at: datetime
    updated_at: datetime
    tags: List[str] = []
    is_recurring: bool = False
    reminder_times: List[datetime] = []
    estimated_duration_minutes: Optional[int] = None
    actual_duration_minutes: Optional[int] = None
    completion_date: Optional[datetime] = None
    parent_task_id: Optional[int] = None
    subtask_order: int = 0

    class Config:
        from_attributes = True


class TaskListResponse(BaseModel):
    """Schema for paginated task list response"""
    tasks: List[TaskResponse]
    total: int
    limit: int
    offset: int


class TaskBulkCreate(BaseModel):
    """Schema for creating multiple tasks at once"""
    user_id: str = Field(..., min_length=1,
                         description="User ID who owns the tasks")
    tasks: List[TaskBase] = Field(..., min_items=1, max_items=50,
                                  description="List of tasks to create (max 50)")

    @field_validator("tasks")
    @classmethod
    def validate_tasks(cls, v):
        if len(v) > 50:
            raise ValueError("Maximum 50 tasks can be created at once")
        return v
