// src/routes/tasks.ts
import { Router, Request, Response, NextFunction } from 'express';
import { getSupabaseClient } from '../config/supabase';
import { validate, taskCreateSchema, taskUpdateSchema, taskBulkCreateSchema } from '../utils/validation';
import { awardTaskCompletionPoints } from '../services/pointsService';
import { Task, TaskCreateRequest, TaskUpdateRequest, TaskBulkCreateRequest, TaskListResponse } from '../types';

const router = Router();

/**
 * POST /api/tasks
 * Create a new task
 */
router.post('/tasks', validate(taskCreateSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const taskData = req.body as TaskCreateRequest;
    const supabase = getSupabaseClient();

    // Validate user exists
    const { data: userData, error: userError } = await supabase
      .from('user_profiles')
      .select('user_id')
      .eq('user_id', taskData.user_id)
      .single();

    if (userError && userError.code !== 'PGRST116') {
      throw userError;
    }

    if (!userData) {
      console.warn(`User not found: ${taskData.user_id}`);
      return res.status(404).json({ error: 'Not Found', detail: 'User not found' });
    }

    const taskRecord = {
      user_id: taskData.user_id,
      task_name: taskData.task_name,
      description: taskData.description || null,
      due_date: taskData.due_date || null,
      priority: taskData.priority || 'medium',
      status: 'pending',
      tags: taskData.tags || [],
      is_recurring: taskData.is_recurring || false,
      reminder_times: taskData.reminder_times || [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from('tasks')
      .insert(taskRecord)
      .select()
      .single();

    if (error) {
      console.error('Failed to create task:', error);
      return res.status(500).json({ error: 'Internal Server Error', detail: 'Failed to create task' });
    }

    console.log(`Task created: ${data.id} for user: ${taskData.user_id}`);
    return res.status(201).json(data);
  } catch (error) {
    console.error('Error in create task:', error);
    next(error);
  }
});

/**
 * POST /api/tasks/bulk
 * Create multiple tasks at once
 */
router.post('/tasks/bulk', validate(taskBulkCreateSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const bulkData = req.body as TaskBulkCreateRequest;
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

    const taskRecords = bulkData.tasks.map(task => ({
      user_id: bulkData.user_id,
      task_name: task.task_name,
      description: task.description || null,
      due_date: task.due_date || null,
      priority: task.priority || 'medium',
      status: 'pending',
      tags: task.tags || [],
      is_recurring: task.is_recurring || false,
      reminder_times: task.reminder_times || [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }));

    const { data, error } = await supabase
      .from('tasks')
      .insert(taskRecords)
      .select();

    if (error) {
      console.error('Failed to create tasks:', error);
      return res.status(500).json({ error: 'Internal Server Error', detail: 'Failed to create tasks' });
    }

    console.log(`Created ${data.length} tasks for user: ${bulkData.user_id}`);
    return res.status(201).json(data);
  } catch (error) {
    console.error('Error in bulk create tasks:', error);
    next(error);
  }
});

/**
 * GET /api/tasks
 * Get user's tasks with optional filters
 */
router.get('/tasks', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { user_id, status, priority, start_date, end_date, tags, limit = '100', offset = '0' } = req.query;

    if (!user_id || typeof user_id !== 'string') {
      return res.status(400).json({ error: 'Bad Request', detail: 'user_id is required' });
    }

    const supabase = getSupabaseClient();
    let query = supabase
      .from('tasks')
      .select('*', { count: 'exact' })
      .eq('user_id', user_id);

    // Apply filters
    if (status && typeof status === 'string') {
      query = query.eq('status', status);
    }
    if (priority && typeof priority === 'string') {
      query = query.eq('priority', priority);
    }
    if (start_date && typeof start_date === 'string') {
      query = query.gte('due_date', start_date);
    }
    if (end_date && typeof end_date === 'string') {
      query = query.lte('due_date', end_date);
    }
    if (tags && typeof tags === 'string') {
      const tagList = tags.split(',').map(t => t.trim());
      query = query.contains('tags', tagList);
    }

    const limitNum = parseInt(limit as string, 10);
    const offsetNum = parseInt(offset as string, 10);

    query = query
      .order('due_date', { ascending: true, nullsFirst: false })
      .range(offsetNum, offsetNum + limitNum - 1);

    const { data, error, count } = await query;

    if (error) {
      console.error('Error retrieving tasks:', error);
      throw error;
    }

    console.log(`Retrieved ${data?.length || 0} tasks for user: ${user_id}`);

    const response: TaskListResponse = {
      tasks: data || [],
      total: count || 0,
      limit: limitNum,
      offset: offsetNum,
    };

    return res.json(response);
  } catch (error) {
    console.error('Error in get tasks:', error);
    next(error);
  }
});

/**
 * GET /api/tasks/:task_id
 * Get a specific task by ID
 */
router.get('/tasks/:task_id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { task_id } = req.params;
    const { user_id } = req.query;

    if (!user_id || typeof user_id !== 'string') {
      return res.status(400).json({ error: 'Bad Request', detail: 'user_id is required' });
    }

    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('tasks')
      .select('*')
      .eq('id', task_id)
      .eq('user_id', user_id)
      .single();

    if (error && error.code !== 'PGRST116') {
      throw error;
    }

    if (!data) {
      console.warn(`Task not found: ${task_id} for user: ${user_id}`);
      return res.status(404).json({ error: 'Not Found', detail: 'Task not found' });
    }

    console.log(`Retrieved task: ${task_id} for user: ${user_id}`);
    return res.json(data);
  } catch (error) {
    console.error('Error in get task:', error);
    next(error);
  }
});

/**
 * PATCH /api/tasks/:task_id
 * Update a task
 */
router.patch('/tasks/:task_id', validate(taskUpdateSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { task_id } = req.params;
    const { user_id } = req.query;
    const updateData = req.body as TaskUpdateRequest;

    if (!user_id || typeof user_id !== 'string') {
      return res.status(400).json({ error: 'Bad Request', detail: 'user_id is required' });
    }

    const supabase = getSupabaseClient();

    // Check if task exists
    const { data: existingTask, error: fetchError } = await supabase
      .from('tasks')
      .select('*')
      .eq('id', task_id)
      .eq('user_id', user_id)
      .single();

    if (fetchError && fetchError.code !== 'PGRST116') {
      throw fetchError;
    }

    if (!existingTask) {
      console.warn(`Task not found: ${task_id} for user: ${user_id}`);
      return res.status(404).json({ error: 'Not Found', detail: 'Task not found' });
    }

    const updates: any = {
      updated_at: new Date().toISOString(),
    };

    // Only include fields that are provided
    if (updateData.task_name !== undefined) updates.task_name = updateData.task_name;
    if (updateData.description !== undefined) updates.description = updateData.description;
    if (updateData.due_date !== undefined) updates.due_date = updateData.due_date;
    if (updateData.priority !== undefined) updates.priority = updateData.priority;
    if (updateData.status !== undefined) {
      updates.status = updateData.status;
      if (updateData.status === 'completed') {
        updates.completion_date = new Date().toISOString();
      }
    }
    if (updateData.tags !== undefined) updates.tags = updateData.tags;
    if (updateData.is_recurring !== undefined) updates.is_recurring = updateData.is_recurring;
    if (updateData.reminder_times !== undefined) updates.reminder_times = updateData.reminder_times;

    const { data, error } = await supabase
      .from('tasks')
      .update(updates)
      .eq('id', task_id)
      .eq('user_id', user_id)
      .select()
      .single();

    if (error) {
      console.error(`Failed to update task: ${task_id}`, error);
      return res.status(500).json({ error: 'Internal Server Error', detail: 'Failed to update task' });
    }

    console.log(`Updated task: ${task_id} for user: ${user_id}`);
    return res.json(data);
  } catch (error) {
    console.error('Error in update task:', error);
    next(error);
  }
});

/**
 * DELETE /api/tasks/:task_id
 * Delete a task
 */
router.delete('/tasks/:task_id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { task_id } = req.params;
    const { user_id } = req.query;

    if (!user_id || typeof user_id !== 'string') {
      return res.status(400).json({ error: 'Bad Request', detail: 'user_id is required' });
    }

    const supabase = getSupabaseClient();

    // Check if task exists and get name
    const { data: existingTask, error: fetchError } = await supabase
      .from('tasks')
      .select('task_name')
      .eq('id', task_id)
      .eq('user_id', user_id)
      .single();

    if (fetchError && fetchError.code !== 'PGRST116') {
      throw fetchError;
    }

    if (!existingTask) {
      console.warn(`Task not found: ${task_id} for user: ${user_id}`);
      return res.status(404).json({ error: 'Not Found', detail: 'Task not found' });
    }

    const { error } = await supabase
      .from('tasks')
      .delete()
      .eq('id', task_id)
      .eq('user_id', user_id);

    if (error) {
      console.error(`Failed to delete task: ${task_id}`, error);
      throw error;
    }

    console.log(`Deleted task: ${task_id} (${existingTask.task_name}) for user: ${user_id}`);
    return res.json({
      message: 'Task deleted successfully',
      task_id: parseInt(task_id, 10),
      task_name: existingTask.task_name,
    });
  } catch (error) {
    console.error('Error in delete task:', error);
    next(error);
  }
});

/**
 * POST /api/tasks/:task_id/complete
 * Mark a task as completed and award points
 */
router.post('/tasks/:task_id/complete', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { task_id } = req.params;
    const { user_id } = req.query;

    if (!user_id || typeof user_id !== 'string') {
      return res.status(400).json({ error: 'Bad Request', detail: 'user_id is required' });
    }

    const supabase = getSupabaseClient();

    // Check if task exists
    const { data: existingTask, error: fetchError } = await supabase
      .from('tasks')
      .select('*')
      .eq('id', task_id)
      .eq('user_id', user_id)
      .single();

    if (fetchError && fetchError.code !== 'PGRST116') {
      throw fetchError;
    }

    if (!existingTask) {
      console.warn(`Task not found: ${task_id} for user: ${user_id}`);
      return res.status(404).json({ error: 'Not Found', detail: 'Task not found' });
    }

    // Don't award points if already completed
    if (existingTask.status === 'completed') {
      return res.json({ ...existingTask, points_awarded: 0 });
    }

    const { data, error } = await supabase
      .from('tasks')
      .update({
        status: 'completed',
        completion_date: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', task_id)
      .eq('user_id', user_id)
      .select()
      .single();

    if (error) {
      console.error(`Failed to complete task: ${task_id}`, error);
      return res.status(500).json({ error: 'Internal Server Error', detail: 'Failed to complete task' });
    }

    // Award points based on task priority
    const priority = existingTask.priority as 'low' | 'medium' | 'high';
    const pointsResult = await awardTaskCompletionPoints(user_id, priority);

    console.log(`Completed task: ${task_id} for user: ${user_id} (+${pointsResult.points_awarded} pts)`);
    return res.json({
      ...data,
      points_awarded: pointsResult.points_awarded,
      total_points: pointsResult.total_points
    });
  } catch (error) {
    console.error('Error in complete task:', error);
    next(error);
  }
});

/**
 * GET /api/tasks/stats/:user_id
 * Get task statistics for a user
 */
router.get('/tasks/stats/:user_id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { user_id } = req.params;
    const supabase = getSupabaseClient();

    const { data, error } = await supabase
      .from('tasks')
      .select('status, priority, due_date, completion_date')
      .eq('user_id', user_id);

    if (error) {
      throw error;
    }

    if (!data || data.length === 0) {
      return res.json({
        total_tasks: 0,
        pending_tasks: 0,
        completed_tasks: 0,
        cancelled_tasks: 0,
        in_progress_tasks: 0,
        overdue_tasks: 0,
        high_priority_tasks: 0,
        medium_priority_tasks: 0,
        low_priority_tasks: 0,
      });
    }

    const now = new Date();
    const stats = {
      total_tasks: data.length,
      pending_tasks: data.filter(t => t.status === 'pending').length,
      completed_tasks: data.filter(t => t.status === 'completed').length,
      cancelled_tasks: data.filter(t => t.status === 'cancelled').length,
      in_progress_tasks: data.filter(t => t.status === 'in_progress').length,
      overdue_tasks: data.filter(t =>
        t.status === 'pending' && t.due_date && new Date(t.due_date) < now
      ).length,
      high_priority_tasks: data.filter(t => t.priority === 'high' && t.status !== 'completed').length,
      medium_priority_tasks: data.filter(t => t.priority === 'medium' && t.status !== 'completed').length,
      low_priority_tasks: data.filter(t => t.priority === 'low' && t.status !== 'completed').length,
    };

    console.log(`Retrieved task stats for user: ${user_id}`);
    return res.json(stats);
  } catch (error) {
    console.error('Error in get task stats:', error);
    next(error);
  }
});

/**
 * POST /api/tasks/:task_id/execute
 * Build an unsigned transaction for a task action
 * Returns serialized PTB for frontend to sign with wallet
 */
router.post('/tasks/:task_id/execute', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { task_id } = req.params;
    const { user_id, wallet_address } = req.body;

    if (!user_id || typeof user_id !== 'string') {
      return res.status(400).json({ error: 'Bad Request', detail: 'user_id is required' });
    }

    if (!wallet_address || typeof wallet_address !== 'string') {
      return res.status(400).json({ error: 'Bad Request', detail: 'wallet_address is required' });
    }

    const supabase = getSupabaseClient();

    // Get the task with action details
    const { data: task, error: fetchError } = await supabase
      .from('tasks')
      .select('*')
      .eq('id', task_id)
      .eq('user_id', user_id)
      .single();

    if (fetchError && fetchError.code !== 'PGRST116') {
      throw fetchError;
    }

    if (!task) {
      return res.status(404).json({ error: 'Not Found', detail: 'Task not found' });
    }

    // Check if task has an executable action
    if (!task.action_type || task.action_type === 'reminder') {
      return res.status(400).json({
        error: 'Bad Request',
        detail: 'This task does not have an executable action'
      });
    }

    // Check if action is already completed
    if (task.action_status === 'completed') {
      return res.status(400).json({
        error: 'Bad Request',
        detail: 'This action has already been executed',
        tx_digest: task.tx_digest
      });
    }

    // Import action executor dynamically to avoid circular deps
    const { actionExecutor } = await import('../services/tasks/actionExecutor.js');

    let result;
    if (task.action_type === 'token_transfer') {
      result = await actionExecutor.buildTransferTransaction(
        task.action_params,
        wallet_address
      );
    } else if (task.action_type === 'dca_purchase') {
      result = await actionExecutor.buildDCATransaction(
        task.action_params,
        wallet_address
      );
    } else {
      return res.status(400).json({
        error: 'Bad Request',
        detail: `Unknown action type: ${task.action_type}`
      });
    }

    if (!result.success) {
      // Update action status to reflect the error
      await supabase
        .from('tasks')
        .update({
          action_status: 'failed',
          updated_at: new Date().toISOString()
        })
        .eq('id', task_id);

      return res.status(400).json({
        error: 'Transaction Build Failed',
        detail: result.error
      });
    }

    // Update action status to awaiting signature
    await supabase
      .from('tasks')
      .update({
        action_status: 'awaiting_signature',
        updated_at: new Date().toISOString()
      })
      .eq('id', task_id);

    console.log(`Built transaction for task ${task_id} (${task.action_type})`);

    return res.json({
      task_id: parseInt(task_id, 10),
      action_type: task.action_type,
      serialized_tx: result.serializedTx,
      message: 'Transaction ready for signing'
    });
  } catch (error) {
    console.error('Error in execute task action:', error);
    next(error);
  }
});

/**
 * POST /api/tasks/:task_id/confirm
 * Confirm that a task action was executed successfully
 */
router.post('/tasks/:task_id/confirm', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { task_id } = req.params;
    const { user_id, tx_digest } = req.body;

    if (!user_id || typeof user_id !== 'string') {
      return res.status(400).json({ error: 'Bad Request', detail: 'user_id is required' });
    }

    if (!tx_digest || typeof tx_digest !== 'string') {
      return res.status(400).json({ error: 'Bad Request', detail: 'tx_digest is required' });
    }

    const supabase = getSupabaseClient();

    // Verify task exists and belongs to user
    const { data: task, error: fetchError } = await supabase
      .from('tasks')
      .select('*')
      .eq('id', task_id)
      .eq('user_id', user_id)
      .single();

    if (fetchError && fetchError.code !== 'PGRST116') {
      throw fetchError;
    }

    if (!task) {
      return res.status(404).json({ error: 'Not Found', detail: 'Task not found' });
    }

    // Optionally verify the transaction on-chain
    const { actionExecutor } = await import('../services/tasks/actionExecutor.js');
    const txStatus = await actionExecutor.getTransactionStatus(tx_digest);

    // Update task with transaction result
    const { data, error } = await supabase
      .from('tasks')
      .update({
        status: txStatus.status === 'success' ? 'completed' : 'pending',
        action_status: txStatus.status === 'success' ? 'completed' : 'failed',
        tx_digest: tx_digest,
        completion_date: txStatus.status === 'success' ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', task_id)
      .eq('user_id', user_id)
      .select()
      .single();

    if (error) {
      console.error(`Failed to confirm task action: ${task_id}`, error);
      return res.status(500).json({ error: 'Internal Server Error', detail: 'Failed to update task' });
    }

    console.log(`Task action confirmed: ${task_id} tx: ${tx_digest} status: ${txStatus.status}`);

    return res.json({
      ...data,
      tx_status: txStatus.status,
      tx_verified: txStatus.success
    });
  } catch (error) {
    console.error('Error in confirm task action:', error);
    next(error);
  }
});

/**
 * GET /api/tasks/actionable
 * Get all tasks with pending actions for a user
 */
router.get('/tasks/actionable', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { user_id } = req.query;

    if (!user_id || typeof user_id !== 'string') {
      return res.status(400).json({ error: 'Bad Request', detail: 'user_id is required' });
    }

    const supabase = getSupabaseClient();
    const now = new Date().toISOString();

    const { data, error } = await supabase
      .from('tasks')
      .select('*')
      .eq('user_id', user_id)
      .neq('action_type', 'reminder')
      .in('action_status', ['pending', 'ready', 'awaiting_signature'])
      .or(`due_date.is.null,due_date.lte.${now}`)
      .order('due_date', { ascending: true });

    if (error) {
      throw error;
    }

    console.log(`Retrieved ${data?.length || 0} actionable tasks for user: ${user_id}`);

    return res.json({
      tasks: data || [],
      total: data?.length || 0
    });
  } catch (error) {
    console.error('Error in get actionable tasks:', error);
    next(error);
  }
});

export default router;
