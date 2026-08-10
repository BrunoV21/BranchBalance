import { createHash } from 'node:crypto';
import { createReadStream, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const modelRoot = join(repositoryRoot, 'modules', 'paddle-ocr', 'android', 'src', 'main', 'assets', 'paddle_ocr');
const manifest = JSON.parse(readFileSync(join(modelRoot, 'model-bundle.json'), 'utf8'));
const profileManifest = JSON.parse(readFileSync(join(modelRoot, 'profile-manifest.json'), 'utf8'));
const artifacts = [...Object.values(manifest.models), manifest.dictionary];

for (const artifact of artifacts) {
  const hash = createHash('sha256');
  await new Promise((resolve, reject) => createReadStream(join(modelRoot, artifact.file)).on('data', (chunk) => hash.update(chunk)).on('end', resolve).on('error', reject));
  const actual = hash.digest('hex');
  if (actual !== artifact.sha256) throw new Error(`${artifact.file} does not match the approved OCR model manifest.`);
}

const dictionaryEntries = readFileSync(join(modelRoot, manifest.dictionary.file), 'utf8').trimEnd().split('\n').length;
if (dictionaryEntries !== manifest.dictionary.entries) throw new Error(`OCR dictionary contains ${dictionaryEntries} entries; expected ${manifest.dictionary.entries}.`);

if (profileManifest.modelBundleVersion !== manifest.bundleVersion) throw new Error('OCR profile manifest targets a different model bundle.');
const hashFile = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const profileContracts = { generic_v1: 'generic.json', fuel_v1: 'fuel.json' };
for (const [profile, file] of Object.entries(profileContracts)) {
  const packaged = profileManifest.profiles?.[profile];
  if (!packaged?.version || packaged.contractSha256 !== hashFile(join(repositoryRoot, 'config', 'ocr', 'profiles', file))) throw new Error(`${profile} does not match its repository OCR profile contract.`);
}
if (profileManifest.pipelineContractSha256 !== hashFile(join(repositoryRoot, 'config', 'ocr', 'pipeline.json'))) throw new Error('Packaged OCR profiles do not match the pipeline quality contract.');

console.log(`Verified ${artifacts.length} local OCR artifacts and ${Object.keys(profileContracts).length} profiles for ${manifest.bundleVersion}.`);
