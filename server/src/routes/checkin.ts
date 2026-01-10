import { Router } from 'express';
import { getCheckInStatus, processCheckIn } from '../services/checkinService';

const router = Router();

// Get check-in status
router.get('/checkin/status/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    const status = await getCheckInStatus(userId);
    res.json(status);
  } catch (error) {
    console.error('[CHECKIN ROUTE] Error getting status:', error);
    res.status(500).json({ error: 'Failed to get check-in status' });
  }
});

// Process check-in
router.post('/checkin', async (req, res) => {
  try {
    const { user_id } = req.body;

    if (!user_id) {
      return res.status(400).json({ error: 'user_id is required' });
    }

    const result = await processCheckIn(user_id);
    res.json(result);
  } catch (error) {
    console.error('[CHECKIN ROUTE] Error processing check-in:', error);
    res.status(500).json({ error: 'Failed to process check-in' });
  }
});

export default router;
