import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { getAuth as auth } from 'firebase-admin/auth';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const defaultCredPath = path.join(__dirname, '..', '..', 'secreto', 'SSModernityConfig.json');
const serviceAccountPath = process.env.SERVICE_ACCOUNT_PATH || defaultCredPath;

let serviceAccount;
const serviceAccountEnv = process.env.SERVICE_ACCOUNT;

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
    } else {
        const raw = fs.readFileSync(serviceAccountPath, 'utf8');
        serviceAccount = JSON.parse(raw);
        console.log('Service account loaded from file:', serviceAccountPath);
    }
} catch (err) {
    console.error('Error leyendo el JSON de credenciales en', serviceAccountPath, err.message);
    throw err;
}

const config = initializeApp({
    credential: cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DATABASE_URL,
});

const firebaseApp = config;
const db = getDatabase(firebaseApp);
const adminAuth = auth(firebaseApp);

export { firebaseApp, db, adminAuth };