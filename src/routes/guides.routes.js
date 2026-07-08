import express from 'express';
import { getGuides, createOrUpdateGuide } from '../modules/guides/guides.controller.js';

const router = express.Router();

// GET /api/guides
router.get('/', getGuides);

// POST /api/guides
router.post('/', createOrUpdateGuide);

export default router;
