#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const COMPONENTS_DIR = path.join(__dirname, 'components');

// ── Load schema & manifest ────────────────────────────────────────────────────

const schema = JSON.parse(fs.readFileSync(path.join(COMPONENTS_DIR, 'schema.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(COMPONENTS_DIR, 'manifest.json'), 'utf8'));

// ── Minimal JSON-Schema Draft-7 validator (no npm deps) ──────────────────────

function validateAgainstSchema(data, schema, path = '') {
  const errors = [];

  if (schema.type && typeof data !== schema.type) {
    errors.push(`${path || 'root'}: expected type "${schema.type}", got "${typeof data}"`);
    return errors; // further checks would cascade
  }

  if (schema.enum && !schema.enum.includes(data)) {
    errors.push(`${path || 'root'}: value "${data}" is not one of [${schema.enum.map(v => `"${v}"`).join(', ')}]`);
  }

  if (schema.type === 'object') {
    // required fields
    if (schema.required) {
      for (const key of schema.required) {
        if (!(key in data)) {
          errors.push(`${path || 'root'}: missing required field "${key}"`);
        }
      }
    }

    // additionalProperties
    if (schema.additionalProperties === false && schema.properties) {
      for (const key of Object.keys(data)) {
        if (!(key in schema.properties)) {
          errors.push(`${path || 'root'}: unexpected additional field "${key}"`);
        }
      }
    }

    // recurse into known properties
    if (schema.properties) {
      for (const [key, subSchema] of Object.entries(schema.properties)) {
        if (key in data) {
          const childErrors = validateAgainstSchema(data[key], subSchema, `${path}.${key}`);
          errors.push(...childErrors);
        }
      }
    }

    // additionalProperties as a schema (for maintenance / operatingCost dicts)
    if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
      for (const [key, value] of Object.entries(data)) {
        if (schema.properties && key in schema.properties) continue; // already validated
        const childErrors = validateAgainstSchema(value, schema.additionalProperties, `${path}.${key}`);
        errors.push(...childErrors);
      }
    }
  }

  return errors;
}

// ── Validate each component file ─────────────────────────────────────────────

let totalErrors = 0;
let totalPassed = 0;

const manifestIds = new Set(manifest.map(item => item.id));

// Collect all JSON files in components/ (excluding schema and manifest)
const jsonFiles = fs.readdirSync(COMPONENTS_DIR)
  .filter(f => f.endsWith('.json') && f !== 'schema.json' && f !== 'manifest.json');

const fileIds = new Set(jsonFiles.map(f => path.basename(f, '.json')));

// Check for orphan files (files not in manifest)
const orphans = [...fileIds].filter(id => !manifestIds.has(id));
// Check for missing files (manifest entries without a file)
const missing = [...manifestIds].filter(id => !fileIds.has(id));

if (orphans.length > 0) {
  console.error(`❌ Orphan JSON files (not in manifest): ${orphans.join(', ')}`);
  totalErrors += orphans.length;
}

if (missing.length > 0) {
  console.error(`❌ Missing JSON files (in manifest but no file): ${missing.join(', ')}`);
  totalErrors += missing.length;
}

// Validate each manifest entry
for (const entry of manifest) {
  const filePath = path.join(COMPONENTS_DIR, `${entry.id}.json`);

  if (!fs.existsSync(filePath)) {
    console.error(`❌ ${entry.id}: file not found`);
    totalErrors++;
    continue;
  }

  let data;
  try {
    data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    console.error(`❌ ${entry.id}: invalid JSON in ${filePath} - ${e.message}`);
    totalErrors++;
    continue;
  }

  // id in file must match filename
  if (data.id !== entry.id) {
    console.error(`❌ ${entry.id}: id field "${data.id}" does not match filename`);
    totalErrors++;
  }

  // Full schema validation
  const errors = validateAgainstSchema(data, schema);
  if (errors.length > 0) {
    console.error(`❌ ${entry.id}: schema validation failed:`);
    errors.forEach(e => console.error(`   • ${e}`));
    totalErrors += errors.length;
  } else {
    totalPassed++;
  }
}

// ── Summary ───────────────────────────────────────────────────────────────────

console.log('');
console.log('══════════════════════════════════════════════════');
if (totalErrors === 0) {
  console.log(`✅ PASS – all ${totalPassed} component files are valid`);
  console.log(`   Manifest: ${manifest.length} entries | Files: ${jsonFiles.length} JSON files`);
} else {
  console.log(`❌ FAIL – ${totalErrors} error(s) found across ${manifest.length} components`);
  console.log(`   Passed: ${totalPassed} | Failed: ${manifest.length - totalPassed}`);
  process.exit(1);
}
console.log('══════════════════════════════════════════════════');
