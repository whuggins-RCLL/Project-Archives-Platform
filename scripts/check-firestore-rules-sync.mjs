#!/usr/bin/env node
/**
 * Guards against the recurring "save button fails with permission denied" bug:
 * every field the web client writes to a project doc must be listed in
 * firestore.rules' isValidProject allowedFields (hasOnlyAllowedFields rejects
 * the whole write otherwise), and every collection the client touches must
 * have a `match` block in firestore.rules (unmatched collections are denied
 * by default).
 *
 * Fails CI when the client and the rules drift apart, so the mismatch is
 * caught on the PR instead of in production.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const rulesPath = path.join(repoRoot, 'firestore.rules');
const apiPath = path.join(repoRoot, 'src', 'lib', 'api.ts');
const srcRoot = path.join(repoRoot, 'src');

const errors = [];

const rulesSource = fs.readFileSync(rulesPath, 'utf8');
const apiSource = fs.readFileSync(apiPath, 'utf8');

function extractQuotedList(source, startIndex, label) {
  const open = source.indexOf('[', startIndex);
  const close = source.indexOf(']', open);
  if (open === -1 || close === -1) {
    errors.push(`Could not parse ${label}.`);
    return [];
  }
  return [...source.slice(open, close).matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

// --- 1. Project fields: client writes ⊆ rules allowedFields -----------------
const validProjectIdx = rulesSource.indexOf('function isValidProject');
const allowedFieldsIdx = rulesSource.indexOf('let allowedFields', validProjectIdx);
if (validProjectIdx === -1 || allowedFieldsIdx === -1) {
  errors.push('Could not find isValidProject/allowedFields in firestore.rules.');
}
const rulesAllowedFields = extractQuotedList(rulesSource, allowedFieldsIdx, 'allowedFields in firestore.rules');

const mutableFieldsIdx = apiSource.indexOf('const PROJECT_MUTABLE_FIELDS');
if (mutableFieldsIdx === -1) {
  errors.push('Could not find PROJECT_MUTABLE_FIELDS in src/lib/api.ts.');
}
const clientMutableFields = extractQuotedList(apiSource, mutableFieldsIdx, 'PROJECT_MUTABLE_FIELDS in src/lib/api.ts');

// createProject/updateProject also stamp these outside PROJECT_MUTABLE_FIELDS.
const clientWrittenFields = [...new Set([...clientMutableFields, 'code', 'createdAt', 'updatedAt'])];

const missingFromRules = clientWrittenFields.filter((field) => !rulesAllowedFields.includes(field));
if (missingFromRules.length > 0) {
  errors.push(
    `Project fields written by the client but missing from firestore.rules allowedFields: ${missingFromRules.join(', ')}.\n` +
    '  Firestore rejects the ENTIRE project write when any unlisted field is present.\n' +
    '  Add the field(s) to `allowedFields` in isValidProject (firestore.rules) with appropriate validation.'
  );
}

// --- 2. Collection coverage: every client-touched collection has a match ----
function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (/\.(ts|tsx)$/.test(entry.name)) files.push(full);
  }
  return files;
}

const clientCollections = new Set();
for (const file of walk(srcRoot)) {
  const source = fs.readFileSync(file, 'utf8');
  for (const match of source.matchAll(/(?:collection|doc)\(\s*db\s*,\s*['"]([\w-]+)['"]/g)) {
    clientCollections.add(match[1]);
  }
}

const rulesCollections = new Set(
  [...rulesSource.matchAll(/match\s+\/([\w-]+)\/\{/g)].map((m) => m[1])
);

const uncoveredCollections = [...clientCollections].filter((name) => !rulesCollections.has(name));
if (uncoveredCollections.length > 0) {
  errors.push(
    `Collections the client reads/writes with no match block in firestore.rules: ${uncoveredCollections.join(', ')}.\n` +
    '  Unmatched collections are denied by default, so these calls always fail with permission denied.'
  );
}

if (errors.length > 0) {
  console.error('firestore.rules / client drift detected:\n');
  for (const error of errors) console.error(`- ${error}\n`);
  console.error('Reminder: rules changes only take effect after the "Deploy Firestore Rules & Indexes" workflow succeeds on main.');
  process.exit(1);
}

console.log(
  `firestore rules sync check passed: ${clientWrittenFields.length} project fields allowed, ` +
  `${clientCollections.size} client collections covered (${[...clientCollections].sort().join(', ')}).`
);
