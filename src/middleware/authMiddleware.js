import jwt from 'jsonwebtoken';
import { supabaseAdmin } from '../lib/supabaseConfig.js';

export default async function authMiddleware(req, res, next) {
    try {
        if (!process.env.JWT_SECRET) return res.status(500).json({ ok: false, message: 'MISSING_JWT_SECRET_IN_ENVS' });
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ ok: false, message: 'MISSING_TOKEN_IN_HEADERS' });
        }

        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Obtener el registro completo del usuario desde Supabase
        const { data: { user }, error } = await supabaseAdmin.auth.admin.getUserById(decoded.uid);
        if (error || !user) return res.status(404).json({ ok: false, message: 'USER_NOT_FOUND' });

        req.user = user;
        req.tokenPayload = decoded;
        return next();
    } catch (err) {
        console.error('Auth middleware error:', err);
        if (err instanceof jwt.TokenExpiredError) {
            return res.status(401).json({ ok: false, message: 'TOKEN_EXPIRED' });
        }
        if (err instanceof jwt.JsonWebTokenError) {
            return res.status(401).json({ ok: false, message: 'INVALID_TOKEN' });
        }
        return res.status(500).json({ ok: false, message: 'INTERNAL_SERVER_ERROR' });
    }
}
