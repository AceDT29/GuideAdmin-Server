import { registerUser, returnUser, loginUser } from './auth.controller.js';
import authMiddleware from "../../middleware/authMiddleware.js";
import express from "express";

const router = express.Router();

router.post('/register', registerUser);
router.post('/login', loginUser);
router.get('/return-user', authMiddleware, returnUser);

export default router;