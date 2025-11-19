# app/api/routers/events.py
from fastapi import APIRouter, Depends, HTTPException, Query
from app.schemas.event import (
    EventCreate,
    EventUpdate,
    EventResponse,
    EventListResponse,
    EventBulkCreate
)
from app.db.session import get_supabase_client
from supabase import Client
from datetime import datetime, timezone
from typing import List, Optional
import logging

router = APIRouter()
logger = logging.getLogger(__name__)


@router.post("/events", summary="Create a new event", response_model=EventResponse)
async def create_event(
    event_data: EventCreate,
    db: Client = Depends(get_supabase_client)
):
    """
    Create a new event for a user.
    
    - **user_id**: The user's unique identifier
    - **event_name**: Name/title of the event
    - **description**: Optional event description
    - **event_date**: Date of the event (ISO format)
    - **event_time**: Optional time in HH:MM format
    - **color**: Event color (bg-blue-500, bg-red-500, etc.)
    - **location**: Optional location
    - **is_all_day**: Whether the event is all day
    - **tags**: Optional list of tags
    - **attendees**: Optional list of attendee emails/names
    - **is_recurring**: Whether the event repeats
    - **reminder_times**: Optional list of reminder timestamps
    """
    try:
        # Validate user exists
        user_check = db.table("user_profiles").select(
            "user_id").eq("user_id", event_data.user_id).execute()
        if not user_check.data:
            logger.warning(f"User not found: {event_data.user_id}")
            raise HTTPException(status_code=404, detail="User not found")

        # Prepare event record
        event_record = {
            "user_id": event_data.user_id,
            "event_name": event_data.event_name,
            "description": event_data.description,
            "event_date": event_data.event_date.isoformat(),
            "event_time": event_data.event_time,
            "color": event_data.color,
            "location": event_data.location,
            "is_all_day": event_data.is_all_day,
            "tags": event_data.tags or [],
            "attendees": event_data.attendees or [],
            "is_recurring": event_data.is_recurring,
            "reminder_times": [rt.isoformat() for rt in event_data.reminder_times] if event_data.reminder_times else [],
            "created_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat()
        }

        # Insert event
        result = db.table("events").insert(event_record).execute()

        if not result.data:
            logger.error("Failed to create event")
            raise HTTPException(
                status_code=500, detail="Failed to create event")

        created_event = result.data[0]
        logger.info(
            f"Event created: {created_event['id']} for user: {event_data.user_id}")

        return EventResponse(**created_event)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating event: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Internal server error: {str(e)}")


@router.post("/events/bulk", summary="Create multiple events", response_model=List[EventResponse])
async def create_events_bulk(
    bulk_data: EventBulkCreate,
    db: Client = Depends(get_supabase_client)
):
    """
    Create multiple events at once for a user.
    Maximum 50 events per request.
    """
    try:
        # Validate user exists
        user_check = db.table("user_profiles").select(
            "user_id").eq("user_id", bulk_data.user_id).execute()
        if not user_check.data:
            logger.warning(f"User not found: {bulk_data.user_id}")
            raise HTTPException(status_code=404, detail="User not found")

        # Prepare event records
        event_records = []
        for event in bulk_data.events:
            event_record = {
                "user_id": bulk_data.user_id,
                "event_name": event.event_name,
                "description": event.description,
                "event_date": event.event_date.isoformat(),
                "event_time": event.event_time,
                "color": event.color,
                "location": event.location,
                "is_all_day": event.is_all_day,
                "tags": event.tags or [],
                "attendees": event.attendees or [],
                "is_recurring": event.is_recurring,
                "reminder_times": [rt.isoformat() for rt in event.reminder_times] if event.reminder_times else [],
                "created_at": datetime.now(timezone.utc).isoformat(),
                "updated_at": datetime.now(timezone.utc).isoformat()
            }
            event_records.append(event_record)

        # Bulk insert
        result = db.table("events").insert(event_records).execute()

        if not result.data:
            logger.error("Failed to create events")
            raise HTTPException(
                status_code=500, detail="Failed to create events")

        logger.info(
            f"Created {len(result.data)} events for user: {bulk_data.user_id}")

        return [EventResponse(**event) for event in result.data]

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating events in bulk: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Internal server error: {str(e)}")


@router.get("/events", summary="Get user's events", response_model=EventListResponse)
async def get_events(
    user_id: str,
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
    tags: Optional[str] = Query(
        None, description="Comma-separated list of tags"),
    is_all_day: Optional[bool] = None,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Client = Depends(get_supabase_client)
):
    """
    Get all events for a user with optional filters.
    
    - **user_id**: The user's unique identifier
    - **start_date**: Filter events after this date
    - **end_date**: Filter events before this date
    - **tags**: Filter by tags (comma-separated)
    - **is_all_day**: Filter by all-day events
    - **limit**: Maximum number of events to return (default: 100, max: 500)
    - **offset**: Number of events to skip for pagination
    """
    try:
        # Build query
        query = db.table("events").select(
            "*", count="exact").eq("user_id", user_id)

        # Apply filters
        if start_date:
            query = query.gte("event_date", start_date.isoformat())
        if end_date:
            query = query.lte("event_date", end_date.isoformat())
        if tags:
            tag_list = [tag.strip() for tag in tags.split(",")]
            query = query.contains("tags", tag_list)
        if is_all_day is not None:
            query = query.eq("is_all_day", is_all_day)

        # Apply pagination and ordering
        query = query.order("event_date", desc=False).range(
            offset, offset + limit - 1)

        result = query.execute()

        total_count = result.count if hasattr(
            result, 'count') else len(result.data)

        logger.info(f"Retrieved {len(result.data)} events for user: {user_id}")

        return EventListResponse(
            events=[EventResponse(**event) for event in result.data],
            total=total_count,
            limit=limit,
            offset=offset
        )

    except Exception as e:
        logger.error(f"Error retrieving events: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Internal server error: {str(e)}")


@router.get("/events/{event_id}", summary="Get event by ID", response_model=EventResponse)
async def get_event(
    event_id: int,
    user_id: str,
    db: Client = Depends(get_supabase_client)
):
    """
    Get a specific event by ID.
    """
    try:
        result = db.table("events").select(
            "*").eq("id", event_id).eq("user_id", user_id).execute()

        if not result.data:
            logger.warning(f"Event not found: {event_id} for user: {user_id}")
            raise HTTPException(status_code=404, detail="Event not found")

        logger.info(f"Retrieved event: {event_id} for user: {user_id}")

        return EventResponse(**result.data[0])

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error retrieving event: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Internal server error: {str(e)}")


@router.patch("/events/{event_id}", summary="Update event", response_model=EventResponse)
async def update_event(
    event_id: int,
    user_id: str,
    event_data: EventUpdate,
    db: Client = Depends(get_supabase_client)
):
    """
    Update an event's details.
    All fields are optional - only provided fields will be updated.
    """
    try:
        # Verify event exists and belongs to user
        existing_event = db.table("events").select(
            "*").eq("id", event_id).eq("user_id", user_id).execute()

        if not existing_event.data:
            logger.warning(f"Event not found: {event_id} for user: {user_id}")
            raise HTTPException(status_code=404, detail="Event not found")

        # Prepare update data (only include fields that were provided)
        update_data = {
            "updated_at": datetime.now(timezone.utc).isoformat()
        }

        if event_data.event_name is not None:
            update_data["event_name"] = event_data.event_name
        if event_data.description is not None:
            update_data["description"] = event_data.description
        if event_data.event_date is not None:
            update_data["event_date"] = event_data.event_date.isoformat()
        if event_data.event_time is not None:
            update_data["event_time"] = event_data.event_time
        if event_data.color is not None:
            update_data["color"] = event_data.color
        if event_data.location is not None:
            update_data["location"] = event_data.location
        if event_data.is_all_day is not None:
            update_data["is_all_day"] = event_data.is_all_day
        if event_data.tags is not None:
            update_data["tags"] = event_data.tags
        if event_data.attendees is not None:
            update_data["attendees"] = event_data.attendees
        if event_data.is_recurring is not None:
            update_data["is_recurring"] = event_data.is_recurring
        if event_data.reminder_times is not None:
            update_data["reminder_times"] = [rt.isoformat()
                                             for rt in event_data.reminder_times]

        # Update event
        result = db.table("events").update(update_data).eq(
            "id", event_id).eq("user_id", user_id).execute()

        if not result.data:
            logger.error(f"Failed to update event: {event_id}")
            raise HTTPException(
                status_code=500, detail="Failed to update event")

        logger.info(f"Updated event: {event_id} for user: {user_id}")

        return EventResponse(**result.data[0])

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating event: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Internal server error: {str(e)}")


@router.delete("/events/{event_id}", summary="Delete event")
async def delete_event(
    event_id: int,
    user_id: str,
    db: Client = Depends(get_supabase_client)
):
    """
    Delete an event.
    """
    try:
        # Verify event exists and belongs to user
        existing_event = db.table("events").select("event_name").eq(
            "id", event_id).eq("user_id", user_id).execute()

        if not existing_event.data:
            logger.warning(f"Event not found: {event_id} for user: {user_id}")
            raise HTTPException(status_code=404, detail="Event not found")

        event_name = existing_event.data[0]["event_name"]

        # Delete event
        result = db.table("events").delete().eq(
            "id", event_id).eq("user_id", user_id).execute()

        logger.info(
            f"Deleted event: {event_id} ({event_name}) for user: {user_id}")

        return {
            "message": "Event deleted successfully",
            "event_id": event_id,
            "event_name": event_name
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting event: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Internal server error: {str(e)}")


@router.get("/events/stats/{user_id}", summary="Get event statistics")
async def get_event_stats(
    user_id: str,
    db: Client = Depends(get_supabase_client)
):
    """
    Get event statistics for a user.
    
    Returns:
    - total_events: Total number of events
    - upcoming_events: Events in the future
    - past_events: Events in the past
    - all_day_events: Number of all-day events
    - recurring_events: Number of recurring events
    """
    try:
        # Get all events
        all_events = db.table("events").select(
            "event_date, is_all_day, is_recurring").eq("user_id", user_id).execute()

        if not all_events.data:
            return {
                "total_events": 0,
                "upcoming_events": 0,
                "past_events": 0,
                "all_day_events": 0,
                "recurring_events": 0
            }

        events = all_events.data
        now = datetime.now(timezone.utc)

        stats = {
            "total_events": len(events),
            "upcoming_events": len([
                e for e in events
                if datetime.fromisoformat(e["event_date"].replace("Z", "+00:00")) >= now
            ]),
            "past_events": len([
                e for e in events
                if datetime.fromisoformat(e["event_date"].replace("Z", "+00:00")) < now
            ]),
            "all_day_events": len([e for e in events if e["is_all_day"]]),
            "recurring_events": len([e for e in events if e["is_recurring"]])
        }

        logger.info(f"Retrieved event stats for user: {user_id}")

        return stats

    except Exception as e:
        logger.error(f"Error retrieving event stats: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Internal server error: {str(e)}")
