import { registerUser, returnUser } from './auth.controller.js';
import authMiddleware from "../../middleware/authMiddleware.js";
import express from "express";

const router = express.Router();

router.post('/register', registerUser);
router.get('/return-user', authMiddleware, returnUser);

export default router;