import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadImageCatalog } from '../public/image-catalog.js';

// Network-free checks using a fixture with a deliberate cross-institution number collision.
const manifestUrl = new URL('../public/artifact-images.json', import.meta.url);
const legacyUrl = new URL('https://example.invalid/assets/images/images.json');
const legacyBase = new URL('https://example.invalid/');
const current = JSON.parse(await readFile(manifestUrl, 'utf8'));
const legacy = [{ id: '신수14621', credit: '국립중앙박물관', title: '달항아리',
                  webPath: 'assets/images/moon-jar.webp', sourceUrl: 'https://www.museum.go.kr/', license: '출처표시' }];
globalThis.fetch = async url => ({ ok: true, json: async () => String(url) === String(manifestUrl) ? current : legacy });
const resolve = await loadImageCatalog({ manifestUrl, existingManifestUrl: legacyUrl, existingAssetBaseUrl: legacyBase });
for (const entry of Object.values(current.artifacts)) {
  assert.equal(resolve({ headKey: entry.project_id }).project_id, entry.project_id);
  assert.equal(resolve({ institution: '다른박물관', id: entry.collection_number }).missing, true);
}
assert.equal(resolve({ institution: '국립중앙박물관', id: '신수14621' }).imageUrl,
             new URL('assets/images/moon-jar.webp', legacyBase).href);
assert.equal(resolve({ id: '신수14621' }).missing, true);
globalThis.fetch = async url => String(url) === String(manifestUrl)
  ? { ok: false, status: 404 } : { ok: true, json: async () => legacy };
const fallback = await loadImageCatalog({ manifestUrl, existingManifestUrl: legacyUrl, existingAssetBaseUrl: legacyBase });
assert.equal(fallback({ institution: '국립중앙박물관', id: '신수14621' }).missing, undefined);
console.log(`PASS: ${Object.keys(current.artifacts).length} real catalog entries, institution isolation, legacy preservation, fallback.`);
