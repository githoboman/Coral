import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/lib/supabase';

interface Task {
  id: number;
  user_id: string;
  task_name: string;
  description?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  priority: 'low' | 'medium' | 'high';
  due_date?: string;
  completion_date?: string;
  tags?: string[];
  is_recurring?: boolean;
  recurrence_pattern?: string;
  created_at: string;
  updated_at: string;
}

interface TaskCreateRequest {
  user_id: string;
  task_name: string;
  description?: string;
  status?: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  priority?: 'low' | 'medium' | 'high';
  due_date?: string;
  tags?: string[];
  is_recurring?: boolean;
  recurrence_pattern?: string;
}

/**
 * GET /api/tasks - List user's tasks
 */
export async function GET(request: NextRequest) {
  const supabase = getSupabaseClient();

  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('user_id');
    const status = searchParams.get('status');
    const priority = searchParams.get('priority');
    const limit = parseInt(searchParams.get('limit') || '100', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    if (!userId || !userId.trim()) {
      return NextResponse.json(
        { error: 'Bad Request', detail: 'User ID is required' },
        { status: 400 }
      );
    }

    let query = supabase
      .from('tasks')
      .select('*', { count: 'exact' })
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (status) query = query.eq('status', status);
    if (priority) query = query.eq('priority', priority);
    query = query.range(offset, offset + limit - 1);

    const { data, error, count } = await query;

    if (error) throw error;

    return NextResponse.json({
      tasks: data || [],
      total: count || 0,
      limit,
      offset,
    });
  } catch (error) {
    console.error('[API] Error fetching tasks:', error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/tasks - Create a new task
 */
export async function POST(request: NextRequest) {
  const supabase = getSupabaseClient();

  try {
    const body = (await request.json()) as TaskCreateRequest;
    const { user_id, task_name, description, status, priority, due_date, tags, is_recurring, recurrence_pattern } = body;

    if (!user_id || !user_id.trim()) {
      return NextResponse.json(
        { error: 'Bad Request', detail: 'User ID is required' },
        { status: 400 }
      );
    }

    if (!task_name || !task_name.trim()) {
      return NextResponse.json(
        { error: 'Bad Request', detail: 'Task name is required' },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from('tasks')
      .insert({
        user_id,
        task_name,
        description,
        status: status || 'pending',
        priority: priority || 'medium',
        due_date,
        tags,
        is_recurring,
        recurrence_pattern,
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    console.error('[API] Error creating task:', error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/tasks - Update a task
 */
export async function PATCH(request: NextRequest) {
  const supabase = getSupabaseClient();

  try {
    const { searchParams } = new URL(request.url);
    const taskId = searchParams.get('task_id');
    const userId = searchParams.get('user_id');

    if (!taskId || !userId) {
      return NextResponse.json(
        { error: 'Bad Request', detail: 'Task ID and User ID are required' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (body.task_name !== undefined) updates.task_name = body.task_name;
    if (body.description !== undefined) updates.description = body.description;
    if (body.priority !== undefined) updates.priority = body.priority;
    if (body.due_date !== undefined) updates.due_date = body.due_date;
    if (body.tags !== undefined) updates.tags = body.tags;
    if (body.is_recurring !== undefined) updates.is_recurring = body.is_recurring;
    if (body.recurrence_pattern !== undefined) updates.recurrence_pattern = body.recurrence_pattern;

    if (body.status !== undefined) {
      updates.status = body.status;
      if (body.status === 'completed') {
        updates.completion_date = new Date().toISOString();
      }
    }

    const { data, error } = await supabase
      .from('tasks')
      .update(updates)
      .eq('id', taskId)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) throw error;
    if (!data) {
      return NextResponse.json(
        { error: 'Not Found', detail: 'Task not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('[API] Error updating task:', error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/tasks - Delete a task
 */
export async function DELETE(request: NextRequest) {
  const supabase = getSupabaseClient();

  try {
    const { searchParams } = new URL(request.url);
    const taskId = searchParams.get('task_id');
    const userId = searchParams.get('user_id');

    if (!taskId || !userId) {
      return NextResponse.json(
        { error: 'Bad Request', detail: 'Task ID and User ID are required' },
        { status: 400 }
      );
    }

    // Verify task exists
    const { data: existing, error: fetchError } = await supabase
      .from('tasks')
      .select('id, task_name')
      .eq('id', taskId)
      .eq('user_id', userId)
      .single();

    if (fetchError || !existing) {
      return NextResponse.json(
        { error: 'Not Found', detail: 'Task not found' },
        { status: 404 }
      );
    }

    const { error } = await supabase
      .from('tasks')
      .delete()
      .eq('id', taskId)
      .eq('user_id', userId);

    if (error) throw error;

    return NextResponse.json({
      message: 'Task deleted successfully',
      task_id: parseInt(taskId, 10),
      task_name: existing.task_name,
    });
  } catch (error) {
    console.error('[API] Error deleting task:', error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
