import nextEnv from '@next/env';
import { initializeApp } from 'firebase/app';
import {
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDocs,
  getFirestore,
  query,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import reviewerSeeds from '../src/data/reviewer-seeds.json' with { type: 'json' };

const { loadEnvConfig } = nextEnv;

loadEnvConfig(process.cwd());

const WEEK_IDS = ['week-1', 'week-2', 'week-3', 'week-4', 'week-5'];
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

function normalizeName(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeId(value) {
  return String(value || '').trim();
}

function buildCanonicalReviewerMap() {
  const byName = new Map();
  const byId = new Map();

  for (const reviewer of reviewerSeeds) {
    const canonical = {
      id: normalizeId(reviewer.id),
      name: String(reviewer.name || '').trim(),
      email: String(reviewer.email || '').trim(),
    };

    byId.set(canonical.id, canonical);
    byName.set(normalizeName(canonical.name), canonical);
  }

  return { byName, byId };
}

function getReviewerPayload(reviewer) {
  return {
    name: reviewer.name,
    ...(reviewer.email ? { email: reviewer.email } : {}),
  };
}

async function fetchReviewers(db) {
  const reviewersSnapshot = await getDocs(collection(db, 'reviewers'));

  return reviewersSnapshot.docs.map((reviewerDoc) => ({
    id: reviewerDoc.id,
    name: typeof reviewerDoc.data().name === 'string' ? reviewerDoc.data().name.trim() : reviewerDoc.id,
    email: typeof reviewerDoc.data().email === 'string' ? reviewerDoc.data().email.trim() : '',
  }));
}

function getDuplicateAliases(reviewers, canonicalByName, canonicalById) {
  const aliases = new Map();

  for (const reviewer of reviewers) {
    const canonical = canonicalByName.get(normalizeName(reviewer.name));

    if (!canonical || canonical.id === reviewer.id) {
      continue;
    }

    if (canonicalById.has(reviewer.id)) {
      continue;
    }

    aliases.set(reviewer.id, {
      from: reviewer,
      to: canonical,
    });
  }

  return aliases;
}

function canonicalizeReviewerAssignment(reviewer, aliases) {
  const aliasById = aliases.get(normalizeId(reviewer.id));
  const aliasByName = Array.from(aliases.values()).find(
    (alias) => normalizeName(alias.from.name) === normalizeName(reviewer.name)
  );
  const alias = aliasById || aliasByName;

  if (!alias) {
    return { reviewer, changed: false };
  }

  return {
    reviewer: {
      ...reviewer,
      id: alias.to.id,
      name: alias.to.name,
    },
    changed: reviewer.id !== alias.to.id || reviewer.name !== alias.to.name,
  };
}

function dedupeReviewerAssignments(reviewers) {
  const reviewerMap = new Map();

  for (const reviewer of reviewers) {
    const key = [
      normalizeId(reviewer.id).toLowerCase(),
      String(reviewer.form_type || reviewer.document_type || '').trim().toLowerCase(),
    ].join('|');

    if (!reviewerMap.has(key)) {
      reviewerMap.set(key, reviewer);
      continue;
    }

    const existing = reviewerMap.get(key);
    reviewerMap.set(key, {
      ...existing,
      ...reviewer,
      completed_at: reviewer.completed_at || existing.completed_at || null,
      due_date: reviewer.due_date || existing.due_date || '',
      status: reviewer.status === 'Completed' || existing.status === 'Completed'
        ? 'Completed'
        : reviewer.status || existing.status || 'In Progress',
    });
  }

  return Array.from(reviewerMap.values());
}

async function updateProtocolAssignments(db, aliases) {
  let scanned = 0;
  let updated = 0;

  for (const weekId of WEEK_IDS) {
    const protocolsSnapshot = await getDocs(query(collectionGroup(db, weekId)));

    for (const protocolDoc of protocolsSnapshot.docs) {
      scanned += 1;
      const protocolData = protocolDoc.data();
      const reviewers = Array.isArray(protocolData.reviewers) ? protocolData.reviewers : [];
      let changed = false;
      const canonicalReviewers = reviewers.map((reviewer) => {
        const result = canonicalizeReviewerAssignment(reviewer, aliases);
        changed = changed || result.changed;
        return result.reviewer;
      });

      if (!changed) {
        continue;
      }

      await updateDoc(protocolDoc.ref, {
        reviewers: dedupeReviewerAssignments(canonicalReviewers),
        updated_at: new Date().toISOString(),
      });
      updated += 1;
    }
  }

  return { scanned, updated };
}

async function cleanupDuplicateReviewers() {
  ensureRequiredEnvVars();

  const app = initializeApp(buildFirebaseConfig());
  const db = getFirestore(app);
  const { byName: canonicalByName, byId: canonicalById } = buildCanonicalReviewerMap();
  const reviewers = await fetchReviewers(db);
  const aliases = getDuplicateAliases(reviewers, canonicalByName, canonicalById);

  if (aliases.size === 0) {
    console.log('No duplicate reviewer documents found.');
    return;
  }

  console.log('Duplicate reviewer documents to merge:');
  for (const alias of aliases.values()) {
    console.log(`- ${alias.from.id} (${alias.from.name}) -> ${alias.to.id} (${alias.to.name})`);
    await setDoc(doc(db, 'reviewers', alias.to.id), getReviewerPayload(alias.to), { merge: true });
  }

  const protocolSummary = await updateProtocolAssignments(db, aliases);

  for (const alias of aliases.values()) {
    await deleteDoc(doc(db, 'reviewers', alias.from.id));
    console.log(`Deleted stale reviewer document: ${alias.from.id}`);
  }

  const finalReviewers = await fetchReviewers(db);
  const remainingDuplicates = getDuplicateAliases(finalReviewers, canonicalByName, canonicalById);

  console.log('');
  console.log('Duplicate reviewer cleanup summary');
  console.log(`Merged reviewer docs: ${aliases.size}`);
  console.log(`Protocol docs scanned: ${protocolSummary.scanned}`);
  console.log(`Protocol docs updated: ${protocolSummary.updated}`);
  console.log(`Remaining duplicate reviewer docs: ${remainingDuplicates.size}`);
}

cleanupDuplicateReviewers()
  .catch((error) => {
    console.error('Duplicate reviewer cleanup failed.');
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => {
    setTimeout(() => process.exit(process.exitCode || 0), 200);
  });
