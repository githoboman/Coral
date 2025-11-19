# app/api/routers/tasks.py
from fastapi import APIRouter, Depends, HTTPException, Query
from app.schemas.task import (
    TaskCreate,
    TaskUpdate,
    TaskResponse,
    TaskListResponse,
    TaskBulkCreate
)
from app.db.session import get_supabase_client
from supabase import Client
from datetime import datetime, timezone
from typing import List, Optional
import logging

router = APIRouter()
logger = logging.getLogger(__name__)


@router.post("/tasks", summary="Create a new task", response_model=TaskResponse)
async def create_task(
    task_data: TaskCreate,
    db: Client = Depends(get_supabase_client)
):
    """
    Create a new task for a user.
    
    - **user_id**: The user's unique identifier
    - **task_name**: Name/title of the task
    - **description**: Optional task description
    - **due_date**: Optional due date (ISO format)
    - **priority**: Task priority (low, medium, high)
    - **tags**: Optional list of tags
    - **is_recurring**: Whether the task repeats
    - **reminder_times**: Optional list of reminder timestamps
    """
    try:
        # Validate user exists
        user_check = db.table("user_profiles").select(
            "user_id").eq("user_id", task_data.user_id).execute()
        if not user_check.data:
            logger.warning(f"User not found: {task_data.user_id}")
            raise HTTPException(status_code=404, detail="User not found")

        # Prepare task record
        task_record = {
            "user_id": task_data.user_id,
            "task_name": task_data.task_name,
            "description": task_data.description,
            "due_date": task_data.due_date.isoformat() if task_data.due_date else None,
            "priority": task_data.priority,
            "status": "pending",
            "tags": task_data.tags or [],
            "is_recurring": task_data.is_recurring,
            "reminder_times": [rt.isoformat() for rt in task_data.reminder_times] if task_data.reminder_times else [],
            "created_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat()
        }

        # Insert task
        result = db.table("tasks").insert(task_record).execute()

        if not result.data:
            logger.error("Failed to create task")
            raise HTTPException(
                status_code=500, detail="Failed to create task")

        created_task = result.data[0]
        logger.info(
            f"Task created: {created_task['id']} for user: {task_data.user_id}")

        return TaskResponse(**created_task)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating task: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Internal server error: {str(e)}")


@router.post("/tasks/bulk", summary="Create multiple tasks", response_model=List[TaskResponse])
async def create_tasks_bulk(
    bulk_data: TaskBulkCreate,
    db: Client = Depends(get_supabase_client)
):
    """
    Create multiple tasks at once for a user.
    """
    try:
        # Validate user exists
        user_check = db.table("user_profiles").select(
            "user_id").eq("user_id", bulk_data.user_id).execute()
        if not user_check.data:
            logger.warning(f"User not found: {bulk_data.user_id}")
            raise HTTPException(status_code=404, detail="User not found")

        # Prepare task records
        task_records = []
        for task in bulk_data.tasks:
            task_record = {
                "user_id": bulk_data.user_id,
                "task_name": task.task_name,
                "description": task.description,
                "due_date": task.due_date.isoformat() if task.due_date else None,
                "priority": task.priority,
                "status": "pending",
                "tags": task.tags or [],
                "is_recurring": task.is_recurring,
                "reminder_times": [rt.isoformat() for rt in task.reminder_times] if task.reminder_times else [],
                "created_at": datetime.now(timezone.utc).isoformat(),
                "updated_at": datetime.now(timezone.utc).isoformat()
            }
            task_records.append(task_record)

        # Bulk insert
        result = db.table("tasks").insert(task_records).execute()

        if not result.data:
            logger.error("Failed to create tasks")
            raise HTTPException(
                status_code=500, detail="Failed to create tasks")

        logger.info(
            f"Created {len(result.data)} tasks for user: {bulk_data.user_id}")

        return [TaskResponse(**task) for task in result.data]

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating tasks in bulk: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Internal server error: {str(e)}")


@router.get("/tasks", summary="Get user's tasks", response_model=TaskListResponse)
async def get_tasks(
    user_id: str,
    status: Optional[str] = Query(
        None, regex="^(pending|completed|cancelled|in_progress)$"),
    priority: Optional[str] = Query(None, regex="^(low|medium|high)$"),
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
    tags: Optional[str] = Query(
        None, description="Comma-separated list of tags"),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Client = Depends(get_supabase_client)
):
    """
    Get all tasks for a user with optional filters.
    
    - **user_id**: The user's unique identifier
    - **status**: Filter by status (pending, completed, cancelled, in_progress)
    - **priority**: Filter by priority (low, medium, high)
    - **start_date**: Filter tasks due after this date
    - **end_date**: Filter tasks due before this date
    - **tags**: Filter by tags (comma-separated)
    - **limit**: Maximum number of tasks to return (default: 100, max: 500)
    - **offset**: Number of tasks to skip for pagination
    """
    try:
        # Build query
        query = db.table("tasks").select(
            "*", count="exact").eq("user_id", user_id)

        # Apply filters
        if status:
            query = query.eq("status", status)
        if priority:
            query = query.eq("priority", priority)
        if start_date:
            query = query.gte("due_date", start_date.isoformat())
        if end_date:
            query = query.lte("due_date", end_date.isoformat())
        if tags:
            tag_list = [tag.strip() for tag in tags.split(",")]
            query = query.contains("tags", tag_list)

        # Apply pagination and ordering
        query = query.order("due_date", desc=False, nullsfirst=False).range(
            offset, offset + limit - 1)

        result = query.execute()

        total_count = result.count if hasattr(
            result, 'count') else len(result.data)

        logger.info(f"Retrieved {len(result.data)} tasks for user: {user_id}")

        return TaskListResponse(
            tasks=[TaskResponse(**task) for task in result.data],
            total=total_count,
            limit=limit,
            offset=offset
        )

    except Exception as e:
        logger.error(f"Error retrieving tasks: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Internal server error: {str(e)}")


@router.get("/tasks/{task_id}", summary="Get task by ID", response_model=TaskResponse)
async def get_task(
    task_id: int,
    user_id: str,
    db: Client = Depends(get_supabase_client)
):
    """
    Get a specific task by ID.
    """
    try:
        result = db.table("tasks").select(
            "*").eq("id", task_id).eq("user_id", user_id).execute()

        if not result.data:
            logger.warning(f"Task not found: {task_id} for user: {user_id}")
            raise HTTPException(status_code=404, detail="Task not found")

        logger.info(f"Retrieved task: {task_id} for user: {user_id}")

        return TaskResponse(**result.data[0])

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error retrieving task: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Internal server error: {str(e)}")


@router.patch("/tasks/{task_id}", summary="Update task", response_model=TaskResponse)
async def update_task(
    task_id: int,
    user_id: str,
    task_data: TaskUpdate,
    db: Client = Depends(get_supabase_client)
):
    """
    Update a task's details.
    """
    try:
        # Verify task exists and belongs to user
        existing_task = db.table("tasks").select(
            "*").eq("id", task_id).eq("user_id", user_id).execute()

        if not existing_task.data:
            logger.warning(f"Task not found: {task_id} for user: {user_id}")
            raise HTTPException(status_code=404, detail="Task not found")

        # Prepare update data (only include fields that were provided)
        update_data = {
            "updated_at": datetime.now(timezone.utc).isoformat()
        }

        if task_data.task_name is not None:
            update_data["task_name"] = task_data.task_name
        if task_data.description is not None:
            update_data["description"] = task_data.description
        if task_data.due_date is not None:
            update_data["due_date"] = task_data.due_date.isoformat(
            ) if task_data.due_date else None
        if task_data.priority is not None:
            update_data["priority"] = task_data.priority
        if task_data.status is not None:
            update_data["status"] = task_data.status
            # If marking as completed, set completion date
            if task_data.status == "completed":
                update_data["completion_date"] = datetime.now(
                    timezone.utc).isoformat()
        if task_data.tags is not None:
            update_data["tags"] = task_data.tags
        if task_data.is_recurring is not None:
            update_data["is_recurring"] = task_data.is_recurring
        if task_data.reminder_times is not None:
            update_data["reminder_times"] = [rt.isoformat()
                                             for rt in task_data.reminder_times]

        # Update task
        result = db.table("tasks").update(update_data).eq(
            "id", task_id).eq("user_id", user_id).execute()

        if not result.data:
            logger.error(f"Failed to update task: {task_id}")
            raise HTTPException(
                status_code=500, detail="Failed to update task")

        logger.info(f"Updated task: {task_id} for user: {user_id}")

        return TaskResponse(**result.data[0])

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating task: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Internal server error: {str(e)}")


@router.delete("/tasks/{task_id}", summary="Delete task")
async def delete_task(
    task_id: int,
    user_id: str,
    db: Client = Depends(get_supabase_client)
):
    """
    Delete a task.
    """
    try:
        # Verify task exists and belongs to user
        existing_task = db.table("tasks").select("task_name").eq(
            "id", task_id).eq("user_id", user_id).execute()

        if not existing_task.data:
            logger.warning(f"Task not found: {task_id} for user: {user_id}")
            raise HTTPException(status_code=404, detail="Task not found")

        task_name = existing_task.data[0]["task_name"]

        # Delete task
        result = db.table("tasks").delete().eq(
            "id", task_id).eq("user_id", user_id).execute()

        logger.info(
            f"Deleted task: {task_id} ({task_name}) for user: {user_id}")

        return {
            "message": "Task deleted successfully",
            "task_id": task_id,
            "task_name": task_name
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting task: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Internal server error: {str(e)}")


@router.post("/tasks/{task_id}/complete", summary="Mark task as completed", response_model=TaskResponse)
async def complete_task(
    task_id: int,
    user_id: str,
    db: Client = Depends(get_supabase_client)
):
    """
    Mark a task as completed.
    """
    try:
        # Verify task exists and belongs to user
        existing_task = db.table("tasks").select(
            "*").eq("id", task_id).eq("user_id", user_id).execute()

        if not existing_task.data:
            logger.warning(f"Task not found: {task_id} for user: {user_id}")
            raise HTTPException(status_code=404, detail="Task not found")

        # Update task status
        update_data = {
            "status": "completed",
            "completion_date": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat()
        }

        result = db.table("tasks").update(update_data).eq(
            "id", task_id).eq("user_id", user_id).execute()

        if not result.data:
            logger.error(f"Failed to complete task: {task_id}")
            raise HTTPException(
                status_code=500, detail="Failed to complete task")

        logger.info(f"Completed task: {task_id} for user: {user_id}")

        return TaskResponse(**result.data[0])

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error completing task: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Internal server error: {str(e)}")


@router.get("/tasks/stats/{user_id}", summary="Get task statistics")
async def get_task_stats(
    user_id: str,
    db: Client = Depends(get_supabase_client)
):
    """
    Get task statistics for a user.
    """
    try:
        # Get all tasks
        all_tasks = db.table("tasks").select(
            "status, priority, due_date, completion_date").eq("user_id", user_id).execute()

        if not all_tasks.data:
            return {
                "total_tasks": 0,
                "pending_tasks": 0,
                "completed_tasks": 0,
                "cancelled_tasks": 0,
                "in_progress_tasks": 0,
                "overdue_tasks": 0,
                "high_priority_tasks": 0,
                "medium_priority_tasks": 0,
                "low_priority_tasks": 0
            }

        tasks = all_tasks.data
        now = datetime.now(timezone.utc)

        stats = {
            "total_tasks": len(tasks),
            "pending_tasks": len([t for t in tasks if t["status"] == "pending"]),
            "completed_tasks": len([t for t in tasks if t["status"] == "completed"]),
            "cancelled_tasks": len([t for t in tasks if t["status"] == "cancelled"]),
            "in_progress_tasks": len([t for t in tasks if t["status"] == "in_progress"]),
            "overdue_tasks": len([
                t for t in tasks
                if t["status"] == "pending" and t["due_date"]
                and datetime.fromisoformat(t["due_date"].replace("Z", "+00:00")) < now
            ]),
            "high_priority_tasks": len([t for t in tasks if t["priority"] == "high" and t["status"] != "completed"]),
            "medium_priority_tasks": len([t for t in tasks if t["priority"] == "medium" and t["status"] != "completed"]),
            "low_priority_tasks": len([t for t in tasks if t["priority"] == "low" and t["status"] != "completed"])
        }

        logger.info(f"Retrieved task stats for user: {user_id}")

        return stats

    except Exception as e:
        logger.error(f"Error retrieving task stats: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Internal server error: {str(e)}")
