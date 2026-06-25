import nextEnv from '@next/env';
import { initializeApp } from 'firebase/app';
import { collection, doc, getDocs, getFirestore, setDoc } from 'firebase/firestore';
import reviewerSeeds from '../src/data/reviewer-seeds.json' with { type: 'json' };

const { loadEnvConfig } = nextEnv;

loadEnvConfig(process.cwd());

const requiredEnvVars = [
  'NEXT_PUBLIC_FIREBASE_API_KEY',
  'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN',
  'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
  'NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET',
  'NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
  'NEXT_PUBLIC_FIREBASE_APP_ID',
];

function ensureRequiredEnvVars() {
  const missing = requiredEnvVars.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(`Missing required Firebase environment variables: ${missing.join(', ')}`);
  }
}

function validateReviewerSeeds(seeds) {
  if (!Array.isArray(seeds) || seeds.length === 0) {
    throw new Error('Reviewer seed data must be a non-empty array.');
  }

  const idSet = new Set();
  const nameSet = new Set();

  for (const reviewer of seeds) {
    if (!reviewer || typeof reviewer !== 'object') {
      throw new Error('Every reviewer seed entry must be an object.');
    }

    const id = typeof reviewer.id === 'string' ? reviewer.id.trim() : '';
    const name = typeof reviewer.name === 'string' ? reviewer.name.trim() : '';
    const email = typeof reviewer.email === 'string' ? reviewer.email.trim() : '';

    if (!id || !name) {
      throw new Error(`Reviewer seed entries require non-empty id and name. Received: ${JSON.stringify(reviewer)}`);
    }

    if (idSet.has(id)) {
      throw new Error(`Duplicate reviewer id found in seed data: ${id}`);
    }

    if (nameSet.has(name)) {
      throw new Error(`Duplicate reviewer name found in seed data: ${name}`);
    }

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error(`Invalid reviewer email found for ${id}: ${email}`);
    }

    idSet.add(id);
    nameSet.add(name);
  }
}

function buildReviewerPayload(reviewer) {
  const payload = {
    name: reviewer.name.trim(),
  };

  if (typeof reviewer.email === 'string' && reviewer.email.trim()) {
    payload.email = reviewer.email.trim();
  }

  return payload;
}

function buildFirebaseConfig() {
  return {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
    measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
  };
}

async function seedReviewers() {
  ensureRequiredEnvVars();
  validateReviewerSeeds(reviewerSeeds);

  const app = initializeApp(buildFirebaseConfig());
  const db = getFirestore(app);
  const reviewersRef = collection(db, 'reviewers');
  const reviewersSnapshot = await getDocs(reviewersRef);

  const existingReviewers = new Map(
    reviewersSnapshot.docs.map((reviewerDoc) => [
      reviewerDoc.id,
      {
        name: typeof reviewerDoc.data().name === 'string' ? reviewerDoc.data().name : '',
        email: typeof reviewerDoc.data().email === 'string' ? reviewerDoc.data().email : '',
      },
    ])
  );

  const summary = {
    created: [],
    updated: [],
    skipped: [],
  };

  for (const reviewer of reviewerSeeds) {
    const reviewerRef = doc(db, 'reviewers', reviewer.id);
    const currentReviewer = existingReviewers.get(reviewer.id);
    const reviewerPayload = buildReviewerPayload(reviewer);

    if (currentReviewer === undefined) {
      await setDoc(reviewerRef, reviewerPayload);
      summary.created.push(reviewer);
      console.log(`Created ${reviewer.id} -> ${reviewer.name}`);
      continue;
    }

    const hasChanges = Object.entries(reviewerPayload).some(
      ([key, value]) => currentReviewer[key] !== value
    );

    if (!hasChanges) {
      summary.skipped.push(reviewer);
      console.log(`Skipped ${reviewer.id} (already up to date)`);
      continue;
    }

    await setDoc(reviewerRef, reviewerPayload, { merge: true });
    summary.updated.push({
      id: reviewer.id,
      previousName: currentReviewer.name,
      nextName: reviewer.name,
      email: reviewerPayload.email ?? currentReviewer.email,
    });
    console.log(`Updated ${reviewer.id}: "${currentReviewer.name}" -> "${reviewer.name}"`);
  }

  console.log('');
  console.log('Reviewer seed summary');
  console.log(`Validated seed rows: ${reviewerSeeds.length}`);
  console.log(`Created: ${summary.created.length}`);
  console.log(`Updated: ${summary.updated.length}`);
  console.log(`Skipped: ${summary.skipped.length}`);
}

seedReviewers().catch((error) => {
  console.error('Reviewer seed failed.');
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
