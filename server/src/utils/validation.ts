// src/utils/validation.ts
import { z } from 'zod';

// ============ User Validation Schemas ============
export const userUpdateSchema = z.object({
  user_id: z.string().min(1, 'User ID is required'),
  wallet_address: z.string().min(1, 'Wallet address is required'),
  email: z.string().email().optional(),
  username: z.string().optional(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
});

export const userOnboardSchema = z.object({
  user_id: z.string().min(1, 'User ID is required'),
  email: z.string().email('Valid email is required'),
  username: z.string().optional(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
});

// ============ Task Validation Schemas ============
export const taskCreateSchema = z.object({
  user_id: z.string().min(1, 'User ID is required'),
  task_name: z.string().min(1, 'Task name is required').max(500),
  description: z.string().max(2000).optional(),
  due_date: z.string().datetime().optional(),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
  tags: z.array(z.string()).max(20, 'Maximum 20 tags allowed').default([]),
  is_recurring: z.boolean().default(false),
  reminder_times: z.array(z.string().datetime()).max(10, 'Maximum 10 reminders allowed').default([]),
});

export const taskUpdateSchema = z.object({
  task_name: z.string().min(1).max(500).optional(),
  description: z.string().max(2000).optional(),
  due_date: z.string().datetime().optional().nullable(),
  priority: z.enum(['low', 'medium', 'high']).optional(),
  status: z.enum(['pending', 'completed', 'cancelled', 'in_progress']).optional(),
  tags: z.array(z.string()).max(20).optional(),
  is_recurring: z.boolean().optional(),
  reminder_times: z.array(z.string().datetime()).max(10).optional(),
});

export const taskBulkCreateSchema = z.object({
  user_id: z.string().min(1, 'User ID is required'),
  tasks: z.array(taskCreateSchema.omit({ user_id: true }))
    .min(1, 'At least one task is required')
    .max(50, 'Maximum 50 tasks can be created at once'),
});

// ============ Event Validation Schemas ============
export const eventCreateSchema = z.object({
  user_id: z.string().min(1, 'User ID is required'),
  event_name: z.string().min(1, 'Event name is required').max(500),
  description: z.string().max(2000).optional(),
  event_date: z.string().datetime('Valid date is required'),
  event_time: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, 'Time must be in HH:MM format').optional(),
  color: z.string().default('bg-blue-500'),
  location: z.string().optional(),
  is_all_day: z.boolean().default(false),
  tags: z.array(z.string()).max(20).default([]),
  attendees: z.array(z.string()).default([]),
  is_recurring: z.boolean().default(false),
  reminder_times: z.array(z.string().datetime()).max(10).default([]),
});

export const eventUpdateSchema = z.object({
  event_name: z.string().min(1).max(500).optional(),
  description: z.string().max(2000).optional(),
  event_date: z.string().datetime().optional(),
  event_time: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).optional(),
  color: z.string().optional(),
  location: z.string().optional(),
  is_all_day: z.boolean().optional(),
  tags: z.array(z.string()).max(20).optional(),
  attendees: z.array(z.string()).optional(),
  is_recurring: z.boolean().optional(),
  reminder_times: z.array(z.string().datetime()).max(10).optional(),
});

export const eventBulkCreateSchema = z.object({
  user_id: z.string().min(1, 'User ID is required'),
  events: z.array(eventCreateSchema.omit({ user_id: true }))
    .min(1, 'At least one event is required')
    .max(50, 'Maximum 50 events can be created at once'),
});

// ============ Waitlist Validation Schema ============
export const waitlistEmailSchema = z.object({
  email: z.string().email('Valid email is required'),
});

// ============ Account Validation Schemas ============
export const addPointsSchema = z.object({
  amount: z.number().int().positive('Amount must be positive'),
});

// ============ Validation Middleware Helper ============
export const validate = (schema: z.ZodSchema) => {
  return (req: any, res: any, next: any) => {
    try {
      schema.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: 'Validation Error',
          details: error.issues.map((issue: z.ZodIssue) => ({
            field: issue.path.join('.'),
            message: issue.message,
          })),
        });
      }
      next(error);
    }
  };
};
