// src/routes/waitlist.ts
import { Router, Request, Response, NextFunction } from 'express';
import { getSupabaseClient } from '../config/supabase';
import { validate, waitlistEmailSchema } from '../utils/validation';
import { WaitlistEmail } from '../types';

const router = Router();

/**
 * POST /api/waitlist
 * Submit email to waitlist
 */
router.post('/waitlist', validate(waitlistEmailSchema), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { email } = req.body as WaitlistEmail;
    const supabase = getSupabaseClient();

    // Check if email already exists
    const { data: existing, error: checkError } = await supabase
      .from('waitlist_emails')
      .select('email')
      .eq('email', email)
      .single();

    if (checkError && checkError.code !== 'PGRST116') {
      throw checkError;
    }

    if (existing) {
      console.warn(`Duplicate email attempt: ${email}`);
      res.status(409).json({
        error: 'Conflict',
        detail: 'This email is already registered on the waitlist',
      });
      return;
    }

    // Insert new email
    const data = {
      email,
      created_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from('waitlist_emails')
      .insert(data)
      .select()
      .single();

    if (error) {
      console.error('Failed to insert email into Supabase:', error);
      res.status(500).json({
        error: 'Internal Server Error',
        detail: 'Failed to add email to waitlist',
      });
      return;
    }

    console.log(`Email added to waitlist: ${email}`);
    res.status(201).json({
      message: 'Successfully added to waitlist!',
      email,
    });
  } catch (error) {
    console.error('Error in waitlist submission:', error);
    next(error);
  }
});

export default router;
