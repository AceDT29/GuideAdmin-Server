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
            try {
                const { data, error } = await supabaseAdmin.auth.admin.getUserById(decoded.uid);
                if (!error && data?.user) {
                    user = data.user;
                }
            } catch (supaErr) {
                // Si la consulta en Supabase falla (red, id custom, etc), continuamos con la info del token
            }
        }

        // Si no se encuentra en Supabase (o sin Supabase), estructurar desde el token
        if (!user) {
            user = { id: decoded.uid, uid: decoded.uid, email: decoded.email, user_metadata: {} };
        } else {
            user.uid = user.id;
        }

        const effectiveOfficeId = decoded.officeId || user.user_metadata?.office_id || user.id;
        user.office_id = effectiveOfficeId;
        user.officeId = effectiveOfficeId;

        req.user = user;
        req.tokenPayload = decoded;
        return next();
    } catch (err) {
        if (err instanceof jwt.TokenExpiredError) {
            return res.status(401).json({ ok: false, message: 'TOKEN_EXPIRED' });
        }
        if (err instanceof jwt.JsonWebTokenError) {
            return res.status(401).json({ ok: false, message: 'INVALID_TOKEN' });
        }
        console.error('Auth middleware error:', err);
        return res.status(500).json({ ok: false, message: 'INTERNAL_SERVER_ERROR' });
    }
}
