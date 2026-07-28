import { adminAuth } from "../../lib/firebaseConfig.js";
import jwt from 'jsonwebtoken';

const galleta_secret = process.env.JWT_SECRET || process.env.SECRET_KEY;

async function registerUser(req, res) {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ ok: false, message: 'MISSING_EMAIL_OR_PASSWORD' });
    }

    try {
        // Verifica si el usuario ya existe
        await adminAuth.getUserByEmail(email);
        return res.status(409).json({ ok: false, message: 'USER_ALREADY_EXISTS' });
    } catch (err) {
        if (err.code === 'auth/user-not-found') {
            // El correo no existe, se puede proceder a crear el usuario
            try {
                const userID = await adminAuth.createUser({
                    email,
                    password,
                });
                const decodedToken = jwt.sign({ uid: userID.uid, email: userID.email }, galleta_secret, { expiresIn: '7d' });
                return res.send({ ok: true, message: 'User registered successfully in firebase', token: decodedToken });
            } catch (createErr) {
                console.error('Error while creating the user:', createErr);
                return res.status(500).json({ ok: false, error: createErr.message });
            }
        } else {
            console.error('Unexpected error during user creation:', err);
            return res.status(500).json({ ok: false, error: err.message });
        }
    }
}

async function returnUser(req, res) {
    try {
        if (!req.user) return res.status(404).json({ ok: false, message: 'USER_NOT_FOUND' });
        return res.status(200).json({ ok: true, user: { uid: req.user.uid, email: req.user.email } });
    } catch (err) {
        console.error('Error returning user:', err);
        return res.status(500).json({ ok: false, message: 'INTERNAL_SERVER_ERROR' });
    }
}

export { registerUser, returnUser };