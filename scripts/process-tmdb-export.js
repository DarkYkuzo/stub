// scripts/process-tmdb-export.js
//
// Descarca exportul zilnic TMDB, il filtreaza, si scrie un fisier mic
// comprimat in data/, gata de servit static din repo.

import { createGunzip, gzipSync } from 'node:zlib';
import { writeFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import readline from 'node:readline';
import { Readable } from 'node:stream';

// TMDB foloseste format MM_DD_YYYY, pentru exportul de "azi" (UTC)
function todayPath() {
  const d = new Date();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const yyyy = d.getUTCFullYear();
  return `${mm}_${dd}_${yyyy}`;
}

// Descarca + dezarhiveaza + parseaza JSON-Lines, aplicand un filtru pe fiecare linie.
// Citim linie cu linie (stream), nu incarcam tot fisierul in memorie odata.
async function fetchAndFilter(url, filterFn) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Nu am putut descarca ${url}: ${res.status}`);
  }

  const gunzip = createGunzip();
  const nodeStream = Readable.fromWeb(res.body);

  const rl = readline.createInterface({
    input: nodeStream.pipe(gunzip),
    crlfDelay: Infinity,
  });

  const kept = [];
  for await (const line of rl) {
    if (!line.trim()) continue;
    let item;
    try {
      item = JSON.parse(line);
    } catch {
      continue; // linie corupta, o ignoram
    }
    if (filterFn(item)) {
      kept.push(item);
    }
  }
  return kept;
}

// Pastram doar campurile de care avem nevoie (nu tot obiectul original)
function slim(item) {
  return {
    id: item.id,
    t: item.original_title ?? item.original_name,
    p: item.popularity,
  };
}

// Criteriul de filtrare: excludem adult, pastram doar popularitate minima
function isRelevant(item) {
  return !item.adult && typeof item.popularity === 'number' && item.popularity > 3;
}

async function writeCompressed(path, data) {
  const json = JSON.stringify(data);
  const compressed = gzipSync(Buffer.from(json, 'utf-8'));
  await writeFile(path, compressed);
}

async function main() {
  mkdirSync('data', { recursive: true });

  const date = todayPath();
  const base = 'https://files.tmdb.org/p/exports';

  console.log(`Procesez exportul din ${date}...`);

  const movies = await fetchAndFilter(
    `${base}/movie_ids_${date}.json.gz`,
    isRelevant
  );
  const tv = await fetchAndFilter(
    `${base}/tv_series_ids_${date}.json.gz`,
    isRelevant
  );

  console.log(`Filme pastrate: ${movies.length}`);
  console.log(`Seriale pastrate: ${tv.length}`);

  movies.sort((a, b) => b.popularity - a.popularity);
  tv.sort((a, b) => b.popularity - a.popularity);

  await writeCompressed('data/movies-index.json.gz', movies.map(slim));
  await writeCompressed('data/tv-index.json.gz', tv.map(slim));

  console.log('Gata.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
