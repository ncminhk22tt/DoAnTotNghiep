#!/usr/bin/env node

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function usage() {
  console.log([
    'Usage:',
    '  node scripts/hash-password.cjs "your-password"',
    '  node scripts/hash-password.cjs --file hash-input.txt',
    '',
    'Output format:',
    '  scrypt$<salt>$<derivedKey>',
  ].join('\n'));
}

function readPasswordFromArgs(argv) {
  const fileFlagIndex = argv.indexOf('--file');
  if (fileFlagIndex !== -1) {
    const filePath = argv[fileFlagIndex + 1];
    if (!filePath) {
      throw new Error('Missing file path after --file');
    }
    const resolvedPath = path.resolve(process.cwd(), filePath);
    return fs.readFileSync(resolvedPath, 'utf8').trim();
  }

  const directValue = argv[2];
  if (!directValue || directValue === '--help' || directValue === '-h') {
    usage();
    process.exit(0);
  }

  return directValue;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto
    .scryptSync(password, salt, 64)
    .toString('hex');

  return `scrypt$${salt}$${derivedKey}`;
}

try {
  const password = readPasswordFromArgs(process.argv);
  if (!password) {
    throw new Error('Password is empty');
  }

  console.log(hashPassword(password));
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exit(1);
}
