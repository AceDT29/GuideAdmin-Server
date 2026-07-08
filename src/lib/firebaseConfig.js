import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { getAuth as auth } from 'firebase-admin/auth';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const defaultCredPath = path.join(__dirname, '..', '..', 'secreto', 'guide-admin-config.json');
const serviceAccountPath = process.env.SERVICE_ACCOUNT_PATH || defaultCredPath;

let serviceAccount = null;
const serviceAccountEnv = process.env.SERVICE_ACCOUNT;

let firebaseApp = null;
let db = null;
let adminAuth = null;
let firebaseInitialized = false;

try {
    if (serviceAccountEnv) {
        try {
            // intentamos parsear como JSON directo
            serviceAccount = JSON.parse(serviceAccountEnv);
            console.log('Service account loaded from SERVICE_ACCOUNT env (JSON).');
        } catch (e) {
            // si falla, intentamos base64 -> JSON
            const decoded = Buffer.from(serviceAccountEnv, 'base64').toString('utf8');
            serviceAccount = JSON.parse(decoded);
            console.log('Service account loaded from SERVICE_ACCOUNT env (base64).');
        }
    } else if (fs.existsSync(serviceAccountPath)) {
        const raw = fs.readFileSync(serviceAccountPath, 'utf8');
        serviceAccount = JSON.parse(raw);
        console.log('Service account loaded from file:', serviceAccountPath);
    } else {
        throw new Error(`Credentials file not found at: ${serviceAccountPath}`);
    }

    if (serviceAccount) {
        firebaseApp = initializeApp({
            credential: cert(serviceAccount),
            databaseURL: process.env.FIREBASE_DATABASE_URL,
        });
        db = getDatabase(firebaseApp);
        adminAuth = auth(firebaseApp);
        firebaseInitialized = true;
        console.log('Firebase Admin initialized successfully.');
    }
} catch (err) {
    console.warn('⚠️ WARNING: Firebase Admin could not be initialized. Falling back to local in-memory storage. Detail:', err.message);
}

export { firebaseApp, db, adminAuth, firebaseInitialized };