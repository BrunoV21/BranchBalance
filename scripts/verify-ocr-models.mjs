import { createHash } from 'node:crypto';
import { createReadStream, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const modelRoot = join(repositoryRoot, 'modules', 'paddle-ocr', 'android', 'src', 'main', 'assets', 'paddle_ocr');
const manifest = JSON.parse(readFileSync(join(modelRoot, 'model-bundle.json'), 'utf8'));
const artifacts = [...Object.values(manifest.models), manifest.dictionary];

for (const artifact of artifacts) {
  const hash = createHash('sha256');
  await new Promise((resolve, reject) => createReadStream(join(modelRoot, artifact.file)).on('data', (chunk) => hash.update(chunk)).on('end', resolve).on('error', reject));
  const actual = hash.digest('hex');
  if (actual !== artifact.sha256) throw new Error(`${artifact.file} does not match the approved OCR model manifest.`);
}

const dictionaryEntries = readFileSync(join(modelRoot, manifest.dictionary.file), 'utf8').trimEnd().split('\n').length;
if (dictionaryEntries !== manifest.dictionary.entries) throw new Error(`OCR dictionary contains ${dictionaryEntries} entries; expected ${manifest.dictionary.entries}.`);

console.log(`Verified ${artifacts.length} local OCR artifacts for ${manifest.bundleVersion}.`);
