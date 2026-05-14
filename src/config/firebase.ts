import { readFileSync } from 'fs';
import { resolve } from 'path';
import admin from 'firebase-admin';

if (!admin.apps.length) {
  const serviceAccount = JSON.parse(
    readFileSync(resolve('secrets/firebase-service-account.json'), 'utf-8')
  );

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

export const messaging = admin.messaging();
export default admin;