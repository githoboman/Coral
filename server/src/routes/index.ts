import { Router, Request, Response } from 'express';
import usersRouter from './users';
import tasksRouter from './tasks';
import eventsRouter from './events';
import waitlistRouter from './waitlist';
import accountRouter from './account';
import chatRouter from './chat';

const router = Router();

// Register all routers
router.use(usersRouter);
router.use(tasksRouter);
router.use(eventsRouter);
router.use(waitlistRouter);
router.use(accountRouter);
router.use(chatRouter);

// GET /api/info - Server information
router.get('/info', (_req: Request, res: Response) => {
  res.json({
    name: 'Tovira Express Server',
    version: '1.0.0',
    description: 'Express TypeScript server for Tovira',
    timestamp: new Date().toISOString(),
    endpoints: {
      users: [
        'GET /api/fetch-user',
        'POST /api/onboard-user',
        'POST /api/update-user',
      ],
      tasks: [
        'POST /api/tasks',
        'POST /api/tasks/bulk',
        'GET /api/tasks',
        'GET /api/tasks/:task_id',
        'PATCH /api/tasks/:task_id',
        'DELETE /api/tasks/:task_id',
        'POST /api/tasks/:task_id/complete',
        'GET /api/tasks/stats/:user_id',
      ],
      events: [
        'POST /api/events',
        'POST /api/events/bulk',
        'GET /api/events',
        'GET /api/events/:event_id',
        'PATCH /api/events/:event_id',
        'DELETE /api/events/:event_id',
        'GET /api/events/stats/:user_id',
      ],
      waitlist: ['POST /api/waitlist'],
      account: [
        'GET /api/account/:user_id',
        'GET /api/leaderboard',
        'POST /api/add-xp/:user_id',
      ],
      chat: [
        'POST /api/chat',
        'POST /api/chat/stream',
        'GET /api/chats/:userId',
        'GET /api/chats/:chatId/messages',
      ],
    },
  });
});

// GET /api/status - Server status
router.get('/status', (_req: Request, res: Response) => {
  res.json({
    status: 'running',
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    environment: process.env.NODE_ENV || 'development',
  });
});

export default router;
