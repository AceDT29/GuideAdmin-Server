import express from 'express';
import { getGuides, createOrUpdateGuide } from '../modules/guides/guides.controller.js';
import authMiddleware from '../middleware/authMiddleware.js';

const router = express.Router();

// GET /api/guides
router.get('/', authMiddleware, getGuides);

// POST /api/guides
router.post('/', authMiddleware, createOrUpdateGuide);

export default router;
