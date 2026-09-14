import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createTopStoriesSnapshots } from '../src/articles/top-stories-snapshot.js';

const rankedCard = (cluster, index, count) => ({
  ...cluster,
  ranking: { score: 1 },
  topStory: {
    feed: 'news_world',
    rank: index + 1,
    isTop: index < count,
    cutoff: { count }
  }
});

function fakeDb(initial = {}) {
  const values = { ...initial };
  return {
    values,
    async get(key) { return values[key]; },
    async put(key, value) {
      values[key] = typeof value === 'string' ? JSON.parse(value) : value;
    }
  };
}

test('Top Stories ranks a version-matched progressive Smart publication while Smart review is running', async () => {
  const progressive = [{
    clusterId: 'progressive-story',
    link: 'https://fixture.test/progressive',
    title: 'Progressive story',
    pubDate: '2026-09-15T00:00:00.000Z',
    smartCategory: 'news_world',
    feedCategory: 'news_world',
    relatedArticles: []
  }];
  const final = [{
    clusterId: 'old-final-story',
    link: 'https://fixture.test/final',
    title: 'Old final story',
    pubDate: '2026-09-14T00:00:00.000Z',
    smartCategory: 'news_world',
    feedCategory: 'news_world',
    relatedArticles: []
  }];
  const db = fakeDb({
    smartStatus: { state: 'refreshing' },
    smartClusterState: { provisional: false },
    smartClusterVersion: 'final-v1',
    smartClusters: final,
    smartRawArticles: [],
    smartSources: [],
    smartProgressiveClusterState: {
      active: true,
      provisional: true,
      version: 'progressive-v4',
      revision: 4
    },
    smartProgressivePublication: {
      version: 'progressive-v4',
      revision: 4,
      clusters: progressive
    },
    topStoriesState: {}
  });
  let seenCandidates;
  const snapshots = createTopStoriesSnapshots({
    db,
    config: {},
    now: () => Date.parse('2026-09-15T00:05:00.000Z'),
    report: () => {},
    compute: async input => {
      seenCandidates = input.candidates.map(candidate => candidate.clusterId);
      return {
        articles: input.candidates.map((cluster, index) =>
          rankedCard(cluster, index, input.candidates.length)
        ),
        timings: {}
      };
    }
  });

  const result = await snapshots.revalidate();
  assert.equal(seenCandidates[0], 'progressive-story');
  assert.equal(result.clusterVersion, 'progressive-v4');
  assert.equal(result.progressive, true);
  assert.equal(result.progressiveRevision, 4);
});

test('a mismatched progressive publication is never ranked', async () => {
  const oldPublication = {
    policy: 1,
    signature: 'old',
    createdAt: 1,
    clusterVersion: 'final-v1',
    articles: [rankedCard({
      clusterId: 'old-final-story',
      link: 'https://fixture.test/final',
      title: 'Old final story'
    }, 0, 1)]
  };
  const db = fakeDb({
    topStoriesPublished: oldPublication,
    smartStatus: { state: 'refreshing' },
    smartClusterState: { provisional: false },
    smartClusterVersion: 'final-v1',
    smartProgressiveClusterState: {
      active: true,
      provisional: true,
      version: 'progressive-v5',
      revision: 5
    },
    smartProgressivePublication: {
      version: 'progressive-v4',
      revision: 4,
      clusters: []
    }
  });
  let calls = 0;
  const snapshots = createTopStoriesSnapshots({
    db,
    config: {},
    report: () => {},
    compute: async () => { calls++; throw new Error('must not rank mixed progressive state'); }
  });

  const result = await snapshots.revalidate();
  assert.equal(calls, 0);
  assert.equal(result.clusterVersion, 'final-v1');
});

test('Smart progress source reports remaining work and provider position without advancing group current', async () => {
  const source = await readFile(new URL('../smart-news.js', import.meta.url), 'utf8');
  assert.match(source, /remaining\s*=\s*Math\.max/);
  assert.match(source, /providerIndex/);
  assert.match(source, /providerTotal/);
  assert.match(source, /Smart Verify · Group/);
  assert.match(source, /smartProgressivePublication/);
  assert.match(source, /smart-publishing/);
});
