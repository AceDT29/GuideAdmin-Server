import { supabaseAdmin } from "../../lib/supabaseConfig.js";
import jwt from 'jsonwebtoken';

const galleta_secret = process.env.JWT_SECRET || process.env.SECRET_KEY;

async function registerUser(req, res) {
    const { email, password, displayName } = req.body;

    if (!email || !password || !displayName) {
        return res.status(400).json({ ok: false, message: 'MISSING_EMAIL_OR_PASSWORD' });
    }

    try {
        const { data, error } = await supabaseAdmin.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
            user_metadata: {
                display_name: displayName,
            },
        });
        if (error) {
            if (error.message.includes('already been registered')) {
                return res.status(409).json({ ok: false, message: 'USER_ALREADY_EXISTS' });
            }
            console.error('Error while creating the user:', error);
            return res.status(500).json({ ok: false, error: error.message });
        }

        const token = jwt.sign(
            {
                uid: data.user.id,
                email: data.user.email,
                displayName: data.user.user_metadata?.display_name || null,
                officeId: data.user.user_metadata?.office_id || data.user.id,
            },
            galleta_secret,
            { expiresIn: '7d' }
        );
        return res.status(201).json({ 
            ok: true, 
            message: 'User registered successfully', 
            token,
            uid:      data.user.id,
            officeId: data.user.user_metadata?.office_id || data.user.id,
        });
    } catch (err) {
        console.error('Unexpected error during user creation:', err);
        return res.status(500).json({ ok: false, error: err.message });
    }
}

async function returnUser(req, res) {
    try {
        if (!req.user) return res.status(404).json({ ok: false, message: 'USER_NOT_FOUND' });
        return res.status(200).json({
            ok: true,
            user: {
                uid: req.user.id,
                email: req.user.email,
                officeId: req.user.office_id || req.user.user_metadata?.office_id || req.user.id
            }
        });
    } catch (err) {
        console.error('Error returning user:', err);
        return res.status(500).json({ ok: false, message: 'INTERNAL_SERVER_ERROR' });
    }
}

async function loginUser(req, res) {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ ok: false, message: 'MISSING_EMAIL_OR_PASSWORD' });
    }

    try {
        const { data, error } = await supabaseAdmin.auth.signInWithPassword({
            email,
            password,
        });

        if (error) {
            console.error('Error while signing in:', error);
            return res.status(500).json({ ok: false, error: error.message });
        }

        const token = jwt.sign(
            {
                uid: data.user.id,
                email: data.user.email,
                displayName: data.user.user_metadata?.display_name || null,
                officeId: data.user.user_metadata?.office_id || data.user.id,
            },
            galleta_secret,
            { expiresIn: '7d' }
        );
        return res.status(200).json({ 
            ok: true, 
            message: 'User logged in successfully', 
            token,
            uid:      data.user.id,
            officeId: data.user.user_metadata?.office_id || data.user.id,
        });
    } catch (err) {
        console.error('Unexpected error during user login:', err);
        return res.status(500).json({ ok: false, error: err.message });
    }
}

export { registerUser, returnUser, loginUser };