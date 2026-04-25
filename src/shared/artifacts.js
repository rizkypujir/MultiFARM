'use strict';
const fs = require('fs');
const path = require('path');

// Project-root anchored: <project>/artifacts/contracts/<Name>.sol/<Name>.json
// Generated oleh `npm run compile` (Hardhat).
function artifactPath(contractName) {
  return path.join(
    process.cwd(),
    'artifacts',
    'contracts',
    `${contractName}.sol`,
    `${contractName}.json`
  );
}

function loadArtifact(contractName) {
  const fp = artifactPath(contractName);
  if (!fs.existsSync(fp)) {
    throw new Error(
      `Artifact ${contractName} belum ada. Jalankan: npm run compile`
    );
  }
  const json = JSON.parse(fs.readFileSync(fp, 'utf8'));
  return { abi: json.abi, bytecode: json.bytecode };
}

function hasArtifact(contractName) {
  return fs.existsSync(artifactPath(contractName));
}

module.exports = { loadArtifact, hasArtifact };
