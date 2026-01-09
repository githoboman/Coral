// Export all types from a single entry point
export interface UserSession {
  registration_complete?: boolean;
  profile_id?: string;
  has_encryption_keys?: boolean;
  points?: number;
  last_task_points_time?: string;
  tasks_completed?: number;
  points_earned_today?: number;
  [key: string]: any;
}

export interface UserData {
  session: UserSession;
  timezone: string;
  daily_task_count: number;
  [key: string]: any;
}

export interface TaskData {
  raw_input: string;
  name: string;
  due_date?: Date;
  parsed_date: boolean;
  timezone: string;
  task_id?: string;
  user_id?: string;
  created_at?: string;
  status?: string;
  [key: string]: any;
}

export interface ProcessResult {
  success: boolean;
  task_data?: TaskData;
  error?: string;
  guidance?: string;
  can_create: boolean;
  task_count: number;
  remaining: number;
  error_type?: string;
  missing_step?: string;
  task_id?: string;
  reminder_info?: ReminderInfo;
  daily_stats?: DailyStats;
}

export interface ReminderInfo {
  type: 'IMMEDIATE' | 'SCHEDULED';
  reason?: string;
  due_date?: Date;
  delay_seconds?: number;
}

export interface DateParseResult {
  original_text: string;
  status: 'success' | 'error';
  due_date?: Date;
  task_name: string;
  error?: string;
}

export interface TaskStatistics {
  pending_count: number;
  completed_count: number;
  daily_created: number;
  daily_remaining: number;
  can_earn_points: boolean;
  points_earned_today: number;
  total_points: number;
  timezone: string;
  next_points_available?: string;
}

export interface FormattedTask {
  name: string;
  has_date: boolean;
  due_date_local?: Date;
  due_date_utc?: Date;
  time_until?: string;
  is_past_due: boolean;
}

export interface ReviewData {
  task_name: string;
  original_input: string;
  has_date: boolean;
  is_past_due: boolean;
  display_data: {
    due_date?: string;
    time_indicator?: string;
  };
}

export interface TimezoneInfo {
  timezone: string;
  current_time: Date;
  formatted: string;
  offset: number;
}

export interface DailyStats {
  created_today: number;
  remaining_today: number;
}

export interface CompletionResult {
  success: boolean;
  points_awarded: number;
  can_earn_more: boolean;
  next_points_available?: string;
}