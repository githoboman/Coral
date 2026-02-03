export interface UserProfile {
  user_id: string;
  wallet_address: string | null;
  email?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
  is_premium: boolean;
  points: number;
  referral_points?: number;
  daily_post_count: number;
  preferences: Record<string, any>;
  timezone: string;
  created_at: string;
  last_active: string;
}

export interface UserUpdateRequest {
  user_id: string;
  wallet_address: string | null;
  email?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
}

export interface UserOnboardRequest {
  user_id: string;
  email: string;
  username?: string;
  first_name?: string;
  last_name?: string;
  notifications_enabled?: boolean;
  analytics_enabled?: boolean;
  personalization_enabled?: boolean;
}

export type TaskPriority = "low" | "medium" | "high";
export type TaskStatus = "pending" | "completed" | "cancelled" | "in_progress";

export interface Task {
  id: number;
  user_id: string;
  task_name: string;
  description?: string;
  due_date?: string;
  priority: TaskPriority;
  status: TaskStatus;
  tags: string[];
  is_recurring: boolean;
  reminder_times: string[];
  estimated_duration_minutes?: number;
  actual_duration_minutes?: number;
  completion_date?: string;
  parent_task_id?: number;
  subtask_order: number;
  created_at: string;
  updated_at: string;
}

export interface TaskCreateRequest {
  user_id: string;
  task_name: string;
  description?: string;
  due_date?: string;
  priority?: TaskPriority;
  tags?: string[];
  is_recurring?: boolean;
  reminder_times?: string[];
}

export interface TaskUpdateRequest {
  task_name?: string;
  description?: string;
  due_date?: string;
  priority?: TaskPriority;
  status?: TaskStatus;
  tags?: string[];
  is_recurring?: boolean;
  reminder_times?: string[];
}

export interface TaskBulkCreateRequest {
  user_id: string;
  tasks: Omit<TaskCreateRequest, "user_id">[];
}

export interface TaskListResponse {
  tasks: Task[];
  total: number;
  limit: number;
  offset: number;
}

export interface Event {
  id: number;
  user_id: string;
  event_name: string;
  description?: string;
  event_date: string;
  event_time?: string;
  color: string;
  location?: string;
  is_all_day: boolean;
  tags: string[];
  attendees: string[];
  is_recurring: boolean;
  reminder_times: string[];
  created_at: string;
  updated_at: string;
}

export interface EventCreateRequest {
  user_id: string;
  event_name: string;
  description?: string;
  event_date: string;
  event_time?: string;
  color?: string;
  location?: string;
  is_all_day?: boolean;
  tags?: string[];
  attendees?: string[];
  is_recurring?: boolean;
  reminder_times?: string[];
}

export interface EventUpdateRequest {
  event_name?: string;
  description?: string;
  event_date?: string;
  event_time?: string;
  color?: string;
  location?: string;
  is_all_day?: boolean;
  tags?: string[];
  attendees?: string[];
  is_recurring?: boolean;
  reminder_times?: string[];
}

export interface EventBulkCreateRequest {
  user_id: string;
  events: Omit<EventCreateRequest, "user_id">[];
}

export interface EventListResponse {
  events: Event[];
  total: number;
  limit: number;
  offset: number;
}

export interface WaitlistEmail {
  email: string;
  created_at?: string;
}

export interface AccountDetails {
  user_id: string;
  wallet_address: string;
  email?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
  points: number;
  referral_points: number;
  rank?: number;
  is_premium: boolean;
  created_at: string;
}

export interface LeaderboardEntry {
  rank: number;
  user_id: string;
  wallet_address: string;
  username?: string;
  email?: string;
  points: number;
  referral_points: number;
}
