import express from 'express';
import { getGeminiSessions, getGeminiSessionMessages, deleteGeminiSession } from '../gemini-sdk.js';

const router = express.Router();

router.get('/sessions', async (req, res) => {
  try {
    const { projectPath } = req.query;
    const sessions = getGeminiSessions(projectPath);
    res.json({ success: true, sessions });
  } catch (error) {
    console.error('Error fetching Gemini sessions:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/sessions/:sessionId/messages', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { limit, offset } = req.query;

    const result = getGeminiSessionMessages(
      sessionId,
      limit ? parseInt(limit, 10) : null,
      offset ? parseInt(offset, 10) : 0
    );

    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Error fetching Gemini session messages:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete('/sessions/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const deleted = deleteGeminiSession(sessionId);
    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Session not found' });
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting Gemini session:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
