// src/routes/events.ts
import { Router, Request, Response, NextFunction } from 'express';
import { getSupabaseClient } from '../config/supabase';
import { validate, eventCreateSchema, eventUpdateSchema, eventBulkCreateSchema } from '../utils/validation';
import { Event, EventCreateRequest, EventUpdateRequest, EventBulkCreateRequest, EventListResponse } from '../types';

const router = Router();

/**
 * POST /api/events
 * Create a new event
 */
router.post('/events', validate(eventCreateSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const eventData = req.body as EventCreateRequest;
    const supabase = getSupabaseClient();

    // Validate user exists
    const { data: userData, error: userError } = await supabase
      .from('user_profiles')
      .select('user_id')
      .eq('user_id', eventData.user_id)
      .single();

    if (userError && userError.code !== 'PGRST116') {
      throw userError;
    }

    if (!userData) {
      console.warn(`User not found: ${eventData.user_id}`);
      return res.status(404).json({ error: 'Not Found', detail: 'User not found' });
    }

    const eventRecord = {
      user_id: eventData.user_id,
      event_name: eventData.event_name,
      description: eventData.description || null,
      event_date: eventData.event_date,
      event_time: eventData.event_time || null,
      color: eventData.color || 'bg-blue-500',
      location: eventData.location || null,
      is_all_day: eventData.is_all_day || false,
      tags: eventData.tags || [],
      attendees: eventData.attendees || [],
      is_recurring: eventData.is_recurring || false,
      reminder_times: eventData.reminder_times || [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from('events')
      .insert(eventRecord)
      .select()
      .single();

    if (error) {
      console.error('Failed to create event:', error);
      return res.status(500).json({ error: 'Internal Server Error', detail: 'Failed to create event' });
    }

    console.log(`Event created: ${data.id} for user: ${eventData.user_id}`);
    return res.status(201).json(data);
  } catch (error) {
    console.error('Error in create event:', error);
    next(error);
  }
});

/**
 * POST /api/events/bulk
 * Create multiple events at once (max 50)
 */
router.post('/events/bulk', validate(eventBulkCreateSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const bulkData = req.body as EventBulkCreateRequest;
    const supabase = getSupabaseClient();

    // Validate user exists
    const { data: userData, error: userError } = await supabase
      .from('user_profiles')
      .select('user_id')
      .eq('user_id', bulkData.user_id)
      .single();

    if (userError && userError.code !== 'PGRST116') {
      throw userError;
    }

    if (!userData) {
      console.warn(`User not found: ${bulkData.user_id}`);
      return res.status(404).json({ error: 'Not Found', detail: 'User not found' });
    }

    const eventRecords = bulkData.events.map(event => ({
      user_id: bulkData.user_id,
      event_name: event.event_name,
      description: event.description || null,
      event_date: event.event_date,
      event_time: event.event_time || null,
      color: event.color || 'bg-blue-500',
      location: event.location || null,
      is_all_day: event.is_all_day || false,
      tags: event.tags || [],
      attendees: event.attendees || [],
      is_recurring: event.is_recurring || false,
      reminder_times: event.reminder_times || [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }));

    const { data, error } = await supabase
      .from('events')
      .insert(eventRecords)
      .select();

    if (error) {
      console.error('Failed to create events:', error);
      return res.status(500).json({ error: 'Internal Server Error', detail: 'Failed to create events' });
    }

    console.log(`Created ${data.length} events for user: ${bulkData.user_id}`);
    return res.status(201).json(data);
  } catch (error) {
    console.error('Error in bulk create events:', error);
    next(error);
  }
});

/**
 * GET /api/events
 * Get user's events with optional filters
 */
router.get('/events', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { user_id, start_date, end_date, tags, is_all_day, limit = '100', offset = '0' } = req.query;

    if (!user_id || typeof user_id !== 'string') {
      return res.status(400).json({ error: 'Bad Request', detail: 'user_id is required' });
    }

    const supabase = getSupabaseClient();
    let query = supabase
      .from('events')
      .select('*', { count: 'exact' })
      .eq('user_id', user_id);

    // Apply filters
    if (start_date && typeof start_date === 'string') {
      query = query.gte('event_date', start_date);
    }
    if (end_date && typeof end_date === 'string') {
      query = query.lte('event_date', end_date);
    }
    if (tags && typeof tags === 'string') {
      const tagList = tags.split(',').map(t => t.trim());
      query = query.contains('tags', tagList);
    }
    if (is_all_day !== undefined) {
      query = query.eq('is_all_day', is_all_day === 'true');
    }

    const limitNum = parseInt(limit as string, 10);
    const offsetNum = parseInt(offset as string, 10);

    query = query
      .order('event_date', { ascending: true })
      .range(offsetNum, offsetNum + limitNum - 1);

    const { data, error, count } = await query;

    if (error) {
      console.error('Error retrieving events:', error);
      throw error;
    }

    console.log(`Retrieved ${data?.length || 0} events for user: ${user_id}`);

    const response: EventListResponse = {
      events: data || [],
      total: count || 0,
      limit: limitNum,
      offset: offsetNum,
    };

    return res.json(response);
  } catch (error) {
    console.error('Error in get events:', error);
    next(error);
  }
});

/**
 * GET /api/events/:event_id
 * Get a specific event by ID
 */
router.get('/events/:event_id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { event_id } = req.params;
    const { user_id } = req.query;

    if (!user_id || typeof user_id !== 'string') {
      return res.status(400).json({ error: 'Bad Request', detail: 'user_id is required' });
    }

    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('events')
      .select('*')
      .eq('id', event_id)
      .eq('user_id', user_id)
      .single();

    if (error && error.code !== 'PGRST116') {
      throw error;
    }

    if (!data) {
      console.warn(`Event not found: ${event_id} for user: ${user_id}`);
      return res.status(404).json({ error: 'Not Found', detail: 'Event not found' });
    }

    console.log(`Retrieved event: ${event_id} for user: ${user_id}`);
    return res.json(data);
  } catch (error) {
    console.error('Error in get event:', error);
    next(error);
  }
});

/**
 * PATCH /api/events/:event_id
 * Update an event
 */
router.patch('/events/:event_id', validate(eventUpdateSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { event_id } = req.params;
    const { user_id } = req.query;
    const updateData = req.body as EventUpdateRequest;

    if (!user_id || typeof user_id !== 'string') {
      return res.status(400).json({ error: 'Bad Request', detail: 'user_id is required' });
    }

    const supabase = getSupabaseClient();

    // Check if event exists
    const { data: existingEvent, error: fetchError } = await supabase
      .from('events')
      .select('*')
      .eq('id', event_id)
      .eq('user_id', user_id)
      .single();

    if (fetchError && fetchError.code !== 'PGRST116') {
      throw fetchError;
    }

    if (!existingEvent) {
      console.warn(`Event not found: ${event_id} for user: ${user_id}`);
      return res.status(404).json({ error: 'Not Found', detail: 'Event not found' });
    }

    const updates: any = {
      updated_at: new Date().toISOString(),
    };

    // Only include fields that are provided
    if (updateData.event_name !== undefined) updates.event_name = updateData.event_name;
    if (updateData.description !== undefined) updates.description = updateData.description;
    if (updateData.event_date !== undefined) updates.event_date = updateData.event_date;
    if (updateData.event_time !== undefined) updates.event_time = updateData.event_time;
    if (updateData.color !== undefined) updates.color = updateData.color;
    if (updateData.location !== undefined) updates.location = updateData.location;
    if (updateData.is_all_day !== undefined) updates.is_all_day = updateData.is_all_day;
    if (updateData.tags !== undefined) updates.tags = updateData.tags;
    if (updateData.attendees !== undefined) updates.attendees = updateData.attendees;
    if (updateData.is_recurring !== undefined) updates.is_recurring = updateData.is_recurring;
    if (updateData.reminder_times !== undefined) updates.reminder_times = updateData.reminder_times;

    const { data, error } = await supabase
      .from('events')
      .update(updates)
      .eq('id', event_id)
      .eq('user_id', user_id)
      .select()
      .single();

    if (error) {
      console.error(`Failed to update event: ${event_id}`, error);
      return res.status(500).json({ error: 'Internal Server Error', detail: 'Failed to update event' });
    }

    console.log(`Updated event: ${event_id} for user: ${user_id}`);
    return res.json(data);
  } catch (error) {
    console.error('Error in update event:', error);
    next(error);
  }
});

/**
 * DELETE /api/events/:event_id
 * Delete an event
 */
router.delete('/events/:event_id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { event_id } = req.params;
    const { user_id } = req.query;

    if (!user_id || typeof user_id !== 'string') {
      return res.status(400).json({ error: 'Bad Request', detail: 'user_id is required' });
    }

    const supabase = getSupabaseClient();

    // Check if event exists and get name
    const { data: existingEvent, error: fetchError } = await supabase
      .from('events')
      .select('event_name')
      .eq('id', event_id)
      .eq('user_id', user_id)
      .single();

    if (fetchError && fetchError.code !== 'PGRST116') {
      throw fetchError;
    }

    if (!existingEvent) {
      console.warn(`Event not found: ${event_id} for user: ${user_id}`);
      return res.status(404).json({ error: 'Not Found', detail: 'Event not found' });
    }

    const { error } = await supabase
      .from('events')
      .delete()
      .eq('id', event_id)
      .eq('user_id', user_id);

    if (error) {
      console.error(`Failed to delete event: ${event_id}`, error);
      throw error;
    }

    console.log(`Deleted event: ${event_id} (${existingEvent.event_name}) for user: ${user_id}`);
    return res.json({
      message: 'Event deleted successfully',
      event_id: parseInt(event_id, 10),
      event_name: existingEvent.event_name,
    });
  } catch (error) {
    console.error('Error in delete event:', error);
    next(error);
  }
});

/**
 * GET /api/events/stats/:user_id
 * Get event statistics for a user
 */
router.get('/events/stats/:user_id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { user_id } = req.params;
    const supabase = getSupabaseClient();

    const { data, error } = await supabase
      .from('events')
      .select('event_date, is_all_day, is_recurring')
      .eq('user_id', user_id);

    if (error) {
      throw error;
    }

    if (!data || data.length === 0) {
      return res.json({
        total_events: 0,
        upcoming_events: 0,
        past_events: 0,
        all_day_events: 0,
        recurring_events: 0,
      });
    }

    const now = new Date();
    const stats = {
      total_events: data.length,
      upcoming_events: data.filter(e => new Date(e.event_date) >= now).length,
      past_events: data.filter(e => new Date(e.event_date) < now).length,
      all_day_events: data.filter(e => e.is_all_day).length,
      recurring_events: data.filter(e => e.is_recurring).length,
    };

    console.log(`Retrieved event stats for user: ${user_id}`);
    return res.json(stats);
  } catch (error) {
    console.error('Error in get event stats:', error);
    next(error);
  }
});

export default router;
