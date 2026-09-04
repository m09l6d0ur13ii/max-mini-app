import express, { Request, Response } from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { config } from '../config';
import { store } from '../store';
import { bridge } from '../bridge/manager';

export function createWebAppServer() {
  const app = express();

  app.use(cors());
  app.use(express.json());

  // Serve static Mini-App files
  const devPublicDir = path.resolve(__dirname, 'public');
  const fallbackPublicDir = path.resolve(process.cwd(), 'src', 'webapp', 'public');
  const publicDir = fs.existsSync(devPublicDir) ? devPublicDir : fallbackPublicDir;
  app.use(express.static(publicDir));

  // Status & stats endpoint
  app.get('/api/status', (req: Request, res: Response) => {
    const stats = store.getStats();
    res.json({
      status: 'online',
      config: {
        telegramChatConfigured: !!config.telegram.chatId,
        maxChatConfigured: !!config.max.chatId,
        syncReactions: config.server.syncReactions,
      },
      stats,
      uptime: Math.floor((Date.now() - stats.startedAt) / 1000),
    });
  });

  // Recent synced messages endpoint
  app.get('/api/messages', (req: Request, res: Response) => {
    const limit = parseInt((req.query.limit as string) || '50', 10);
    const messages = store.getRecentMessages(limit);
    res.json({
      messages,
    });
  });

  // React to a message from the Mini-App
  app.post('/api/react', async (req: Request, res: Response) => {
    try {
      const { messageId, emoji, user } = req.body;
      if (!messageId || !emoji) {
        res.status(400).json({ error: 'messageId and emoji are required' });
        return;
      }

      const userName = user || 'MAX Mini-App User';
      const updated = await bridge.syncWebAppReaction(messageId, emoji, userName);

      if (!updated) {
        res.status(404).json({ error: 'Message not found' });
        return;
      }

      res.json({ success: true, message: updated });
    } catch (err: any) {
      console.error('[API] /api/react error:', err);
      res.status(500).json({ error: err.message || 'Internal error' });
    }
  });

  // Send a message from Mini-App to both platforms
  app.post('/api/send', async (req: Request, res: Response) => {
    try {
      const { text, senderName } = req.body;
      if (!text || !text.trim()) {
        res.status(400).json({ error: 'text is required' });
        return;
      }

      const author = senderName || 'MAX Mini-App';

      // Forward to Telegram and MAX via bridge manager
      await bridge.forwardTelegramToMax({
        chatId: config.telegram.chatId,
        messageId: Date.now(),
        senderName: author,
        text: `[WebApp] ${text}`,
      });

      res.json({ success: true });
    } catch (err: any) {
      console.error('[API] /api/send error:', err);
      res.status(500).json({ error: err.message || 'Internal error' });
    }
  });

  return app;
}
