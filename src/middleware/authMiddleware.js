import jwt from 'jsonwebtoken';
import { supabaseAdmin } from '../lib/supabaseConfig.js';

export default async function authMiddleware(req, res, next) {
    try {
        const secret = process.env.JWT_SECRET || process.env.SECRET_KEY;
        if (!secret) return res.status(500).json({ ok: false, message: 'MISSING_JWT_SECRET_IN_ENVS' });
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ ok: false, message: 'MISSING_TOKEN_IN_HEADERS' });
        }

        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, secret);

        // Obtener el registro completo del usuario desde Supabase si está disponible
        let user = null;
        if (supabaseAdmin) {
            const { data, error } = await supabaseAdmin.auth.admin.getUserById(decoded.uid);
            if (!error && data?.user) {
                user = data.user;
            }
        }

        // Si no se encuentra en Supabase (o sin Supabase), estructurar desde el token
        if (!user) {
            user = { id: decoded.uid, email: decoded.email, user_metadata: {} };
        }

        user.office_id = decoded.officeId || user.user_metadata?.office_id || user.id;

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
