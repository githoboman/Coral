const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

export interface Task {
  id?: number;
  user_id: string;
  task_name: string;
  description?: string;
  due_date?: string; // Must be in ISO format
  priority: 'low' | 'medium' | 'high';
  status?: 'pending' | 'completed' | 'cancelled' | 'in_progress';
  tags?: string[];
  is_recurring?: boolean;
  reminder_times?: string[]; // Also in ISO format array
  created_at?: string;
  updated_at?: string;
  completion_date?: string;
  estimated_duration_minutes?: number;
  actual_duration_minutes?: number;
  parent_task_id?: number;
  subtask_order?: number;
}

export interface TaskListResponse {
  tasks: Task[];
  total: number;
  limit: number;
  offset: number;
}

export interface TaskStats {
  total_tasks: number;
  pending_tasks: number;
  completed_tasks: number;
  cancelled_tasks: number;
  in_progress_tasks: number;
  overdue_tasks: number;
  high_priority_tasks: number;
  medium_priority_tasks: number;
  low_priority_tasks: number;
}

class TaskApiClient {
  private baseUrl: string;

  constructor() {
    this.baseUrl = `${apiBaseUrl}/api`;
  }

  async createTask(task: Task): Promise<Task> {
    const response = await fetch(`${this.baseUrl}/tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(task),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Failed to create task');
    }

    return response.json();
  }

  async createTasksBulk(userId: string, tasks: Omit<Task, 'user_id'>[]): Promise<Task[]> {
    const response = await fetch(`${this.baseUrl}/tasks/bulk`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        user_id: userId,
        tasks: tasks,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Failed to create tasks');
    }

    return response.json();
  }

  async getTasks(
    userId: string,
    filters?: {
      status?: 'pending' | 'completed' | 'cancelled' | 'in_progress';
      priority?: 'low' | 'medium' | 'high';
      start_date?: string;
      end_date?: string;
      tags?: string;
      limit?: number;
      offset?: number;
    }
  ): Promise<TaskListResponse> {
    const params = new URLSearchParams({ user_id: userId });

    if (filters) {
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          params.append(key, value.toString());
        }
      });
    }

    const response = await fetch(`${this.baseUrl}/tasks?${params.toString()}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Failed to fetch tasks');
    }

    return response.json();
  }

  async getTask(taskId: number, userId: string): Promise<Task> {
    const response = await fetch(`${this.baseUrl}/tasks/${taskId}?user_id=${userId}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Failed to fetch task');
    }

    return response.json();
  }

  async updateTask(taskId: number, userId: string, updates: Partial<Task>): Promise<Task> {
    const response = await fetch(`${this.baseUrl}/tasks/${taskId}?user_id=${userId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(updates),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Failed to update task');
    }

    return response.json();
  }

  async deleteTask(taskId: number, userId: string): Promise<{ message: string; task_id: number; task_name: string }> {
    const response = await fetch(`${this.baseUrl}/tasks/${taskId}?user_id=${userId}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Failed to delete task');
    }

    return response.json();
  }

  async completeTask(taskId: number, userId: string): Promise<Task> {
    const response = await fetch(`${this.baseUrl}/tasks/${taskId}/complete?user_id=${userId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Failed to complete task');
    }

    return response.json();
  }

  async getTaskStats(userId: string): Promise<TaskStats> {
    const response = await fetch(`${this.baseUrl}/tasks/stats/${userId}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Failed to fetch task stats');
    }

    return response.json();
  }
}

export interface Event {
  id?: number;
  user_id: string;
  event_name: string;
  description?: string;
  event_date: string;
  event_time?: string; // HH:MM format
  color?: 'bg-blue-500' | 'bg-red-500' | 'bg-green-500' | 'bg-purple-500' | 'bg-yellow-500' | 'bg-pink-500' | 'bg-indigo-500' | 'bg-orange-500';
  location?: string;
  is_all_day?: boolean;
  tags?: string[];
  attendees?: string[];
  is_recurring?: boolean;
  reminder_times?: string[]; 
  created_at?: string;
  updated_at?: string;
}

export interface EventListResponse {
  events: Event[];
  total: number;
  limit: number;
  offset: number;
}

export interface EventStats {
  total_events: number;
  upcoming_events: number;
  past_events: number;
  all_day_events: number;
  recurring_events: number;
}

class EventApiClient {
  private baseUrl: string;

  constructor() {
    this.baseUrl = `${apiBaseUrl}/api`;
  }

  async createEvent(event: Event): Promise<Event> {
    const response = await fetch(`${this.baseUrl}/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(event),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Failed to create event');
    }

    return response.json();
  }

  async createEventsBulk(userId: string, events: Omit<Event, 'user_id'>[]): Promise<Event[]> {
    const response = await fetch(`${this.baseUrl}/events/bulk`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        user_id: userId,
        events: events,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Failed to create events');
    }

    return response.json();
  }
  
  async getEvents(
    userId: string,
    filters?: {
      start_date?: string;
      end_date?: string;
      tags?: string;
      is_all_day?: boolean;
      limit?: number;
      offset?: number;
    }
  ): Promise<EventListResponse> {
    const params = new URLSearchParams({ user_id: userId });

    if (filters) {
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          params.append(key, value.toString());
        }
      });
    }

    const response = await fetch(`${this.baseUrl}/events?${params.toString()}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Failed to fetch events');
    }

    return response.json();
  }

  async getEvent(eventId: number, userId: string): Promise<Event> {
    const response = await fetch(`${this.baseUrl}/events/${eventId}?user_id=${userId}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Failed to fetch event');
    }

    return response.json();
  }

  async updateEvent(eventId: number, userId: string, updates: Partial<Event>): Promise<Event> {
    const response = await fetch(`${this.baseUrl}/events/${eventId}?user_id=${userId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(updates),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Failed to update event');
    }

    return response.json();
  }

  async deleteEvent(eventId: number, userId: string): Promise<{ message: string; event_id: number; event_name: string }> {
    const response = await fetch(`${this.baseUrl}/events/${eventId}?user_id=${userId}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Failed to delete event');
    }

    return response.json();
  }

  async getEventStats(userId: string): Promise<EventStats> {
    const response = await fetch(`${this.baseUrl}/events/stats/${userId}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Failed to fetch event stats');
    }

    return response.json();
  }
}

export const taskApi = new TaskApiClient();
export const eventApi = new EventApiClient();