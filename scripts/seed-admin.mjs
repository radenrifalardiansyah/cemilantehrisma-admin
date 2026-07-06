#!/usr/bin/env node
// One-time bootstrap: creates the first admin user directly in Firestore.
// Usage: node scripts/seed-admin.mjs <username> <password> [email] [role]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import bcrypt from 'bcryptjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadEnvLocal() {
  const envPath = path.join(__dirname, '..', '.env.local');
  const content = readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) process.env[match[1]] ??= match[2];
  }
}

async function main() {
  loadEnvLocal();
  const [, , username, password, email, role = 'admin'] = process.argv;
  if (!username || !password) {
    console.error('Usage: node scripts/seed-admin.mjs <username> <password> [email] [role]');
    process.exit(1);
  }

  const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT ?? '{}');
  initializeApp({ credential: cert(sa) });
  const db = getFirestore();

  const id = username.toLowerCase();
  const ref = db.collection('users').doc(id);
  if ((await ref.get()).exists) {
    console.error(`User "${id}" sudah ada.`);
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await ref.set({
    username: id,
    email: email ? email.trim().toLowerCase() : null,
    passwordHash,
    role,
    createdAt: new Date(),
  });
  console.log(`User admin "${id}" berhasil dibuat dengan role "${role}".`);
  process.exit(0);
}

main();
