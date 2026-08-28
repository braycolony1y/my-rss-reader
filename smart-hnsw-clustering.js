import hnswlib from 'hnswlib-node';
import { createHash } from 'node:crypto';
import {
  classifyE5Match,
  isPairWithinComparisonScope,
  MatchDecision
} from './smart-news.js';

const { HierarchicalNSW } = hnswlib;

const HNSW_CONFIG = Object.freeze({
  searchK: 160,
  maxValidCandidates: 80,
  m: 16,
  efConstruction: 200,
  efSearch: 192,
  space: 'cosine',

  maxReviewEdgesPerArticle: 3,
  maxQwenGroupSize: 12,
  maxQwenGroupsPerRefresh: 200,

  // Safety limits. These prevent another 6,302-article cluster.
  maxImportedClusterSize: 500,
  maxAutoComponentSize: 500,
  unsafeLargestClusterRatio: 0.25,
  unsafeLargestClusterAbsolute: 1500
});

function cleanKey(value) {
  const key =
    value == null
      ? ''
      : String(value).trim();

  if (
    !key ||
    key === 'undefined' ||
    key === 'null' ||
    key === ':'
  ) {
    return '';
  }

  return key;
}

function pairKey(left, right) {
  return left < right
    ? `${left}|${right}`
    : `${right}|${left}`;
}

function stableId(prefix, articles) {
  const keys = articles
    .map(article =>
      cleanKey(article?.articleKey)
    )
    .filter(Boolean)
    .sort();

  const hash = createHash('sha256')
    .update(keys.join('\n'))
    .digest('hex')
    .slice(0, 32);

  return `${prefix}_${hash}`;
}

function cosineSimilarity(vectorA, vectorB) {
  if (
    !vectorA ||
    !vectorB ||
    vectorA.length !== vectorB.length
  ) {
    return 0;
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (
    let index = 0;
    index < vectorA.length;
    index++
  ) {
    const left = vectorA[index];
    const right = vectorB[index];

    dotProduct += left * right;
    normA += left * left;
    normB += right * right;
  }

  if (!normA || !normB) {
    return 0;
  }

  return (
    dotProduct /
    Math.sqrt(normA * normB)
  );
}

function addBestEdge(edgeMap, edge) {
  const key = pairKey(
    edge.sourceKey,
    edge.targetKey
  );

  const previous = edgeMap.get(key);

  if (
    !previous ||
    (edge.priority || 0) >
    (previous.priority || 0) ||
    (
      (edge.priority || 0) ===
      (previous.priority || 0) &&
      edge.similarity >
      previous.similarity
    )
  ) {
    edgeMap.set(key, edge);
  }
}

function createReviewEdge(
  articleA,
  articleB,
  similarity,
  reason,
  conflicts,
  priority = 0
) {
  return {
    sourceKey: articleA.articleKey,
    targetKey: articleB.articleKey,
    articleA,
    articleB,
    similarity,
    reason,
    priority,
    conflicts:
      conflicts || {
        hasSoftConflict: false,
        hasHardConflict: false,
        reasons: [reason]
      }
  };
}

/**
 * Converts the old stored clusters into safe article membership
 * descriptors.
 *
 * Important:
 * - Cluster IDs are metadata only.
 * - Cluster IDs are never inserted into Union-Find as article nodes.
 * - Suspicious previous state causes a clean rebuild.
 */
function extractExistingState(
  existingClusters,
  activeArticlesByKey,
  activeArticleCount
) {
  const descriptorsById = new Map();
  const articleOwner = new Map();

  const maxImportedSize = Math.min(
    HNSW_CONFIG.maxImportedClusterSize,
    Math.max(
      50,
      Math.floor(
        activeArticleCount * 0.15
      )
    )
  );

  let unsafeReason = '';

  for (
    let clusterIndex = 0;
    clusterIndex <
    existingClusters.length;
    clusterIndex++
  ) {
    const cluster =
      existingClusters[clusterIndex];

    const candidateMembers = [
      cluster,
      ...(
        Array.isArray(cluster?.articles)
          ? cluster.articles
          : []
      ),
      ...(
        Array.isArray(
          cluster?.relatedArticles
        )
          ? cluster.relatedArticles
          : []
      )
    ];

    const memberKeys = [
      ...new Set(
        candidateMembers
          .map(member =>
            cleanKey(
              member?.articleKey
            )
          )
          .filter(
            key =>
              key &&
              activeArticlesByKey.has(key)
          )
      )
    ];

    if (!memberKeys.length) {
      continue;
    }

    const explicitClusterId =
      cleanKey(
        cluster?.clusterId ??
        cluster?.id
      );

    const clusterId =
      explicitClusterId ||
      `legacy_${createHash('sha256')
        .update(
          memberKeys
            .slice()
            .sort()
            .join('\n')
        )
        .digest('hex')
        .slice(0, 24)
      }`;

    const descriptor =
      descriptorsById.get(
        clusterId
      ) || {
        id: clusterId,
        memberKeys: [],
        representativeKey:
          memberKeys[0],
        original: cluster
      };

    descriptor.memberKeys.push(
      ...memberKeys
    );

    descriptor.memberKeys = [
      ...new Set(
        descriptor.memberKeys
      )
    ];

    descriptorsById.set(
      clusterId,
      descriptor
    );

    for (const key of memberKeys) {
      const previousOwner =
        articleOwner.get(key);

      if (
        previousOwner &&
        previousOwner !== clusterId
      ) {
        unsafeReason =
          `article ${key} belongs to ` +
          `both ${previousOwner} and ` +
          `${clusterId}`;

        break;
      }

      articleOwner.set(
        key,
        clusterId
      );
    }

    if (unsafeReason) {
      break;
    }
  }

  for (
    const descriptor
    of descriptorsById.values()
  ) {
    if (
      descriptor.memberKeys.length >
      maxImportedSize
    ) {
      unsafeReason =
        `existing cluster ` +
        `${descriptor.id} has ` +
        `${descriptor.memberKeys.length} ` +
        `active members`;

      break;
    }
  }

  if (unsafeReason) {
    console.error(
      '[HNSW SAFETY] Previous ' +
      'cluster state rejected: ' +
      unsafeReason
    );

    return {
      cleanRebuild: true,
      descriptors: [],
      previousClustersById:
        new Map(),
      articleOwner: new Map()
    };
  }

  const descriptors = [
    ...descriptorsById.values()
  ];

  return {
    cleanRebuild:
      descriptors.length === 0,

    descriptors,

    previousClustersById:
      new Map(
        descriptors.map(
          descriptor => [
            descriptor.id,
            descriptor.original
          ]
        )
      ),

    articleOwner
  };
}

class UnionFind {
  constructor(articleKeys) {
    this.parent = new Map();
    this.size = new Map();
    this.representative =
      new Map();
    this.existingClusterIds =
      new Map();

    for (
      const articleKey
      of articleKeys
    ) {
      this.parent.set(
        articleKey,
        articleKey
      );

      this.size.set(
        articleKey,
        1
      );

      this.representative.set(
        articleKey,
        articleKey
      );

      this.existingClusterIds.set(
        articleKey,
        new Set()
      );
    }
  }

  find(articleKey) {
    if (
      !this.parent.has(articleKey)
    ) {
      throw new Error(
        `Unknown article key: ` +
        articleKey
      );
    }

    let root = articleKey;

    while (
      root !==
      this.parent.get(root)
    ) {
      root =
        this.parent.get(root);
    }

    let current = articleKey;

    while (current !== root) {
      const next =
        this.parent.get(current);

      this.parent.set(
        current,
        root
      );

      current = next;
    }

    return root;
  }

  componentSize(articleKey) {
    return (
      this.size.get(
        this.find(articleKey)
      ) || 1
    );
  }

  representativeKey(articleKey) {
    return this.representative.get(
      this.find(articleKey)
    );
  }

  existingIds(articleKey) {
    return (
      this.existingClusterIds.get(
        this.find(articleKey)
      ) ||
      new Set()
    );
  }

  union(
    articleA,
    articleB,
    preferredRepresentative = null
  ) {
    let rootA = this.find(articleA);
    let rootB = this.find(articleB);

    if (rootA === rootB) {
      return rootA;
    }

    let sizeA =
      this.size.get(rootA);

    let sizeB =
      this.size.get(rootB);

    if (sizeA < sizeB) {
      [
        rootA,
        rootB
      ] = [
          rootB,
          rootA
        ];

      [
        sizeA,
        sizeB
      ] = [
          sizeB,
          sizeA
        ];
    }

    const idsA =
      this.existingClusterIds.get(
        rootA
      );

    const idsB =
      this.existingClusterIds.get(
        rootB
      );

    const representativeA =
      this.representative.get(
        rootA
      );

    const representativeB =
      this.representative.get(
        rootB
      );

    this.parent.set(
      rootB,
      rootA
    );

    this.size.set(
      rootA,
      sizeA + sizeB
    );

    this.size.delete(rootB);

    this.existingClusterIds.set(
      rootA,
      new Set([
        ...idsA,
        ...idsB
      ])
    );

    this.existingClusterIds.delete(
      rootB
    );

    let nextRepresentative =
      preferredRepresentative;

    if (!nextRepresentative) {
      if (
        idsA.size > 0 &&
        idsB.size === 0
      ) {
        nextRepresentative =
          representativeA;
      } else if (
        idsB.size > 0 &&
        idsA.size === 0
      ) {
        nextRepresentative =
          representativeB;
      } else {
        nextRepresentative =
          representativeA;
      }
    }

    this.representative.set(
      rootA,
      nextRepresentative
    );

    this.representative.delete(
      rootB
    );

    return rootA;
  }
}

function logRootStats(
  phase,
  articleKeys,
  unionFind
) {
  const componentSizes =
    new Map();

  for (
    const articleKey
    of articleKeys
  ) {
    const root =
      unionFind.find(articleKey);

    componentSizes.set(
      root,
      (
        componentSizes.get(root) ||
        0
      ) + 1
    );
  }

  const largest = [
    ...componentSizes.values()
  ]
    .sort(
      (left, right) =>
        right - left
    )
    .slice(0, 10);

  console.log(
    '[HNSW PHASE STATS]',
    JSON.stringify({
      phase,
      roots:
        componentSizes.size,
      largest
    })
  );
}

/**
 * Creates deterministic, size-limited Qwen review groups.
 *
 * Edges are processed strongest-first. An edge is accepted only
 * when both endpoint articles remain below their per-article limit.
 * Components are never allowed to grow beyond 12 articles.
 */
function buildReviewGroups(
  reviewEdges,
  activeArticlesByKey
) {
  const sortedEdges =
    reviewEdges
      .slice()
      .sort(
        (left, right) =>
          (
            right.priority || 0
          ) -
          (
            left.priority || 0
          ) ||
          right.similarity -
          left.similarity ||
          pairKey(
            left.sourceKey,
            left.targetKey
          ).localeCompare(
            pairKey(
              right.sourceKey,
              right.targetKey
            )
          )
      );

  const degreeByArticle =
    new Map();

  const cappedEdges = [];

  for (
    const edge
    of sortedEdges
  ) {
    const sourceDegree =
      degreeByArticle.get(
        edge.sourceKey
      ) || 0;

    const targetDegree =
      degreeByArticle.get(
        edge.targetKey
      ) || 0;

    if (
      sourceDegree >=
      HNSW_CONFIG
        .maxReviewEdgesPerArticle ||
      targetDegree >=
      HNSW_CONFIG
        .maxReviewEdgesPerArticle
    ) {
      continue;
    }

    cappedEdges.push(edge);

    degreeByArticle.set(
      edge.sourceKey,
      sourceDegree + 1
    );

    degreeByArticle.set(
      edge.targetKey,
      targetDegree + 1
    );
  }

  const reviewNodes = [
    ...new Set(
      cappedEdges.flatMap(
        edge => [
          edge.sourceKey,
          edge.targetKey
        ]
      )
    )
  ];

  const parent =
    new Map(
      reviewNodes.map(
        node => [node, node]
      )
    );

  const size =
    new Map(
      reviewNodes.map(
        node => [node, 1]
      )
    );

  function find(node) {
    let root = node;

    while (
      root !== parent.get(root)
    ) {
      root = parent.get(root);
    }

    let current = node;

    while (current !== root) {
      const next =
        parent.get(current);

      parent.set(
        current,
        root
      );

      current = next;
    }

    return root;
  }

  function union(left, right) {
    let rootA = find(left);
    let rootB = find(right);

    if (rootA === rootB) {
      return;
    }

    if (
      size.get(rootA) <
      size.get(rootB)
    ) {
      [
        rootA,
        rootB
      ] = [
          rootB,
          rootA
        ];
    }

    parent.set(
      rootB,
      rootA
    );

    size.set(
      rootA,
      size.get(rootA) +
      size.get(rootB)
    );

    size.delete(rootB);
  }

  for (
    const edge
    of cappedEdges
  ) {
    const rootA =
      find(edge.sourceKey);

    const rootB =
      find(edge.targetKey);

    if (rootA === rootB) {
      continue;
    }

    const combinedSize =
      size.get(rootA) +
      size.get(rootB);

    if (
      combinedSize <=
      HNSW_CONFIG
        .maxQwenGroupSize
    ) {
      union(
        rootA,
        rootB
      );
    }
  }

  const groupsByRoot =
    new Map();

  for (
    const node
    of reviewNodes
  ) {
    const root = find(node);

    if (
      !groupsByRoot.has(root)
    ) {
      groupsByRoot.set(
        root,
        {
          nodes: [],
          edges: [],
          priority: 0,
          maxSimilarity: 0
        }
      );
    }

    groupsByRoot
      .get(root)
      .nodes
      .push(node);
  }

  for (
    const edge
    of cappedEdges
  ) {
    const sourceRoot =
      find(edge.sourceKey);

    const targetRoot =
      find(edge.targetKey);

    if (
      sourceRoot !== targetRoot
    ) {
      continue;
    }

    const group =
      groupsByRoot.get(
        sourceRoot
      );

    group.edges.push(edge);

    group.priority = Math.max(
      group.priority,
      edge.priority || 0
    );

    group.maxSimilarity =
      Math.max(
        group.maxSimilarity,
        edge.similarity
      );
  }

  const components = [
    ...groupsByRoot.values()
  ]
    .filter(
      group =>
        group.nodes.length > 1 &&
        group.edges.length > 0
    )
    .sort(
      (left, right) =>
        right.priority -
        left.priority ||
        right.maxSimilarity -
        left.maxSimilarity ||
        right.nodes.length -
        left.nodes.length
    );

  const selected =
    components.slice(
      0,
      HNSW_CONFIG
        .maxQwenGroupsPerRefresh
    );

  const groups =
    selected.map(component => {
      const articles =
        component.nodes
          .map(articleKey =>
            activeArticlesByKey.get(
              articleKey
            )
          )
          .filter(Boolean);

      return {
        id: stableId(
          'review',
          articles
        ),

        articles,

        verified: false,

        verification: {
          method:
            'review_pending',

          reason:
            component.priority >= 2
              ? (
                'Proposed merge ' +
                'between established ' +
                'clusters requires review'
              )
              : (
                'Uncertain semantic ' +
                'event match requires review'
              )
        }
      };
    });

  return {
    cappedCount:
      cappedEdges.length,

    componentCount:
      components.length,

    groups
  };
}

export async function runIncrementalHnswClustering(
  articles,
  existingClusters = [],
  onProgress
) {
  const activeArticles =
    Array.isArray(articles)
      ? articles
      : [];

  const previousClusters =
    Array.isArray(existingClusters)
      ? existingClusters
      : [];

  if (!activeArticles.length) {
    return {
      autoMergedClusters: [],
      ambiguousGroups: []
    };
  }

  const activeArticlesByKey =
    new Map();

  for (
    const article
    of activeArticles
  ) {
    const articleKey =
      cleanKey(article?.articleKey);

    if (!articleKey) {
      throw new Error(
        'Missing articleKey for ' +
        `article: ${article?.title ||
        '(untitled)'
        }`
      );
    }

    if (
      activeArticlesByKey.has(
        articleKey
      )
    ) {
      throw new Error(
        'Duplicate articleKey: ' +
        articleKey
      );
    }

    activeArticlesByKey.set(
      articleKey,
      article
    );
  }

  const activeArticleKeys = [
    ...activeArticlesByKey.keys()
  ];

  const previousState =
    extractExistingState(
      previousClusters,
      activeArticlesByKey,
      activeArticles.length
    );

  console.log(
    '[HNSW DEBUG] Existing state',
    JSON.stringify({
      received:
        previousClusters.length,

      usable:
        previousState
          .descriptors
          .length,

      cleanRebuild:
        previousState
          .cleanRebuild
    })
  );

  const vectorArticles =
    activeArticles.filter(
      article =>
        article?._vec?.length
    );

  if (!vectorArticles.length) {
    throw new Error(
      'No valid embedding vectors ' +
      'for HNSW.'
    );
  }

  const dimension =
    vectorArticles[0]
      ._vec.length;

  onProgress?.({
    stage: 'hnsw-build',
    message:
      'Building local HNSW index...'
  });

  const hnsw =
    new HierarchicalNSW(
      HNSW_CONFIG.space,
      dimension
    );

  hnsw.initIndex(
    Math.max(
      100,
      vectorArticles.length + 100
    ),
    HNSW_CONFIG.m,
    HNSW_CONFIG.efConstruction,
    200,
    true
  );

  if (
    typeof hnsw.setEf ===
    'function'
  ) {
    hnsw.setEf(
      HNSW_CONFIG.efSearch
    );
  }

  const indexToArticle =
    new Map();

  let nextHnswId = 0;

  for (
    const article
    of vectorArticles
  ) {
    if (
      article._vec.length !==
      dimension
    ) {
      console.warn(
        '[HNSW] Skipping vector ' +
        'with wrong dimension',
        {
          articleKey:
            article.articleKey,

          expected: dimension,

          actual:
            article._vec.length
        }
      );

      continue;
    }

    article._hnswId =
      nextHnswId;

    indexToArticle.set(
      nextHnswId,
      article
    );

    // hnswlib-node requires a normal Array.
    hnsw.addPoint(
      Array.from(article._vec),
      nextHnswId
    );

    nextHnswId++;
  }

  const unionFind =
    new UnionFind(
      activeArticleKeys
    );

  logRootStats(
    'before-existing-clusters',
    activeArticleKeys,
    unionFind
  );

  /*
   * Preserve safe existing clusters by unioning their article
   * members directly.
   *
   * The cluster ID is metadata on the root. It is not a fake
   * Union-Find node.
   */
  for (
    const descriptor
    of previousState.descriptors
  ) {
    const [
      firstArticleKey,
      ...remainingKeys
    ] = descriptor.memberKeys;

    for (
      const articleKey
      of remainingKeys
    ) {
      unionFind.union(
        firstArticleKey,
        articleKey,
        descriptor
          .representativeKey
      );
    }

    const root =
      unionFind.find(
        firstArticleKey
      );

    unionFind
      .existingClusterIds
      .get(root)
      .add(descriptor.id);

    unionFind
      .representative
      .set(
        root,
        descriptor
          .representativeKey
      );
  }

  logRootStats(
    'after-existing-clusters',
    activeArticleKeys,
    unionFind
  );

  /*
   * During a clean rebuild every indexed article must be queried.
   *
   * During a normal incremental refresh, query only:
   * - NEW
   * - MODIFIED
   * - DIRTY
   * - articles missing from previous state
   */
  const queryArticles =
    previousState.cleanRebuild
      ? [
        ...indexToArticle
          .values()
      ]
      : [
        ...indexToArticle
          .values()
      ].filter(article => {
        const status =
          String(
            article?._status ||
            ''
          ).toUpperCase();

        return (
          status === 'NEW' ||
          status === 'MODIFIED' ||
          status === 'DIRTY' ||
          !previousState
            .articleOwner
            .has(
              article.articleKey
            )
        );
      });

  onProgress?.({
    stage: 'hnsw-search',
    message:
      'Querying HNSW candidates...'
  });

  console.log(
    `[HNSW DEBUG] Querying ` +
    `${queryArticles.length}/` +
    `${indexToArticle.size} ` +
    `articles.`
  );

  const autoEdges =
    new Map();

  const reviewEdges =
    new Map();

  const decisionStats = {
    queries:
      queryArticles.length,

    candidates: 0,
    outOfScope: 0,
    auto: 0,
    review: 0,
    reject: 0,
    searchErrors: 0
  };

  const comparisonNow = Date.now();

  for (
    let queryIndex = 0;
    queryIndex <
    queryArticles.length;
    queryIndex++
  ) {
    const article =
      queryArticles[queryIndex];

    let neighborIds = [];

    try {
      const searchCount =
        Math.min(
          HNSW_CONFIG.searchK,
          indexToArticle.size
        );

      if (searchCount > 1) {
        const searchResult =
          hnsw.searchKnn(
            Array.from(
              article._vec
            ),
            searchCount
          );

        // Supports Array and typed-array responses.
        neighborIds =
          searchResult?.neighbors
            ? Array.from(
              searchResult.neighbors
            )
            : [];
      }
    } catch (error) {
      decisionStats.searchErrors++;

      console.warn(
        '[HNSW] Search error',
        {
          articleKey:
            article.articleKey,

          message:
            error?.message ||
            String(error)
        }
      );
    }

    let retainedCandidates = 0;

    for (
      const neighborId
      of neighborIds
    ) {
      if (
        retainedCandidates >=
        HNSW_CONFIG
          .maxValidCandidates
      ) {
        break;
      }

      if (
        neighborId ===
        article._hnswId
      ) {
        continue;
      }

      const neighbor =
        indexToArticle.get(
          neighborId
        );

      if (
        !neighbor ||
        neighbor.articleKey ===
        article.articleKey
      ) {
        continue;
      }

      /*
       * HNSW searches globally, but final candidates must still pass
       * the existing publication-time and active-story scope rules.
       */
      if (
        !isPairWithinComparisonScope(
          article,
          neighbor,
          comparisonNow
        )
      ) {
        decisionStats.outOfScope++;
        continue;
      }

      /*
       * Count all scope-valid candidates, including candidates that
       * are later rejected. Otherwise the loop keeps searching until
       * it finds 80 accepted matches, which biases it toward merging.
       */
      retainedCandidates++;
      decisionStats.candidates++;

      /*
       * HNSW only creates the candidate shortlist.
       * The authoritative similarity is recalculated exactly here.
       */
      const similarity =
        cosineSimilarity(
          article._vec,
          neighbor._vec
        );

      const classification =
        classifyE5Match(
          article,
          neighbor,
          similarity
        );

      if (
        classification?.decision ===
        MatchDecision.AUTO_MERGE
      ) {
        addBestEdge(
          autoEdges,
          {
            sourceKey:
              article.articleKey,

            targetKey:
              neighbor.articleKey,

            articleA: article,
            articleB: neighbor,
            similarity,
            priority: 0,

            conflicts:
              classification
                .conflicts
          }
        );

        decisionStats.auto++;
      } else if (
        classification?.decision ===
        MatchDecision.REVIEW
      ) {
        addBestEdge(
          reviewEdges,
          createReviewEdge(
            article,
            neighbor,
            similarity,
            'e5_review',
            classification
              .conflicts,
            0
          )
        );

        decisionStats.review++;
      } else {
        decisionStats.reject++;
      }
    }

    if (
      (
        queryIndex + 1
      ) % 50 === 0
    ) {
      await new Promise(
        resolve =>
          setImmediate(resolve)
      );
    }
  }

  console.log(
    '[HNSW DECISION STATS]',
    JSON.stringify({
      ...decisionStats,

      uniqueAutoEdges:
        autoEdges.size,

      uniqueReviewEdges:
        reviewEdges.size
    })
  );

  /*
   * Process strongest automatic edges first.
   *
   * A pair-level AUTO_MERGE decision is not sufficient when either
   * endpoint already belongs to a larger component.
   *
   * Larger components must also have representatives that pass
   * AUTO_MERGE.
   */
  const sortedAutoEdges = [
    ...autoEdges.values()
  ].sort(
    (left, right) =>
      right.similarity -
      left.similarity ||
      pairKey(
        left.sourceKey,
        left.targetKey
      ).localeCompare(
        pairKey(
          right.sourceKey,
          right.targetKey
        )
      )
  );

  for (
    const edge
    of sortedAutoEdges
  ) {
    const rootA =
      unionFind.find(
        edge.sourceKey
      );

    const rootB =
      unionFind.find(
        edge.targetKey
      );

    if (rootA === rootB) {
      continue;
    }

    const existingIdsA =
      unionFind.existingIds(
        rootA
      );

    const existingIdsB =
      unionFind.existingIds(
        rootB
      );

    /*
     * Never automatically merge two different established clusters
     * from one article edge.
     */
    const bothEstablished =
      existingIdsA.size > 0 &&
      existingIdsB.size > 0;

    const sameEstablishedCluster =
      bothEstablished &&
      [
        ...existingIdsA
      ].some(id =>
        existingIdsB.has(id)
      );

    if (
      bothEstablished &&
      !sameEstablishedCluster
    ) {
      addBestEdge(
        reviewEdges,
        createReviewEdge(
          edge.articleA,
          edge.articleB,
          edge.similarity,
          'established_cluster_merge_requires_review',
          edge.conflicts,
          2
        )
      );

      continue;
    }

    const combinedSize =
      unionFind.componentSize(
        rootA
      ) +
      unionFind.componentSize(
        rootB
      );

    if (
      combinedSize >
      HNSW_CONFIG
        .maxAutoComponentSize
    ) {
      addBestEdge(
        reviewEdges,
        createReviewEdge(
          edge.articleA,
          edge.articleB,
          edge.similarity,
          'auto_component_size_limit',
          edge.conflicts,
          1
        )
      );

      continue;
    }

    /*
     * Anti-chaining check:
     *
     * If A matches B and B matches C, this does not automatically
     * prove that A and C describe the same event.
     *
     * Once either side is a multi-article component, compare the two
     * component representatives before allowing the union.
     */
    if (
      unionFind.componentSize(
        rootA
      ) > 1 ||
      unionFind.componentSize(
        rootB
      ) > 1
    ) {
      const representativeA =
        activeArticlesByKey.get(
          unionFind
            .representativeKey(
              rootA
            )
        );

      const representativeB =
        activeArticlesByKey.get(
          unionFind
            .representativeKey(
              rootB
            )
        );

      const representativeSimilarity =
        cosineSimilarity(
          representativeA?._vec,
          representativeB?._vec
        );

      const representativeResult =
        representativeA &&
          representativeB
          ? classifyE5Match(
            representativeA,
            representativeB,
            representativeSimilarity
          )
          : null;

      if (
        representativeResult
          ?.decision !==
        MatchDecision.AUTO_MERGE
      ) {
        addBestEdge(
          reviewEdges,
          createReviewEdge(
            edge.articleA,
            edge.articleB,
            edge.similarity,
            'component_representatives_do_not_auto_merge',
            representativeResult
              ?.conflicts ||
            edge.conflicts,
            1
          )
        );

        continue;
      }
    }

    let preferredRepresentative =
      null;

    if (
      existingIdsA.size > 0 &&
      existingIdsB.size === 0
    ) {
      preferredRepresentative =
        unionFind
          .representativeKey(
            rootA
          );
    } else if (
      existingIdsB.size > 0 &&
      existingIdsA.size === 0
    ) {
      preferredRepresentative =
        unionFind
          .representativeKey(
            rootB
          );
    }

    unionFind.union(
      rootA,
      rootB,
      preferredRepresentative
    );
  }

  logRootStats(
    'after-hnsw-auto-edges',
    activeArticleKeys,
    unionFind
  );

  const membersByRoot =
    new Map();

  for (
    const article
    of activeArticles
  ) {
    const root =
      unionFind.find(
        article.articleKey
      );

    if (
      !membersByRoot.has(root)
    ) {
      membersByRoot.set(
        root,
        []
      );
    }

    membersByRoot
      .get(root)
      .push(article);
  }

  const autoMergedClusters = [];

  for (
    const [
      root,
      members
    ] of membersByRoot
  ) {
    const existingIds = [
      ...unionFind.existingIds(
        root
      )
    ];

    if (
      existingIds.length > 1
    ) {
      throw new Error(
        `Root ${root} contains ` +
        `multiple existing cluster ` +
        `IDs: ${existingIds.join(', ')}`
      );
    }

    const clusterId =
      existingIds[0] ||
      stableId(
        'cluster',
        members
      );

    const oldCluster =
      previousState
        .previousClustersById
        .get(clusterId);

    autoMergedClusters.push({
      id: clusterId,
      clusterId,
      articles: members,

      verified:
        oldCluster?.verified ??
        (
          members.length === 1
        ),

      verification:
        oldCluster?.verification || {
          method:
            members.length > 1
              ? 'e5_auto_merge'
              : 'kept_separate',

          reason:
            members.length > 1
              ? (
                'Exact cosine, event ' +
                'rules, and component ' +
                'representative consistency passed'
              )
              : (
                'Single article cluster'
              )
        }
    });
  }

  /*
   * Review pairs already inside the same automatic component are
   * resolved and must not be sent to Qwen.
   */
  const unresolvedReviewEdges = [
    ...reviewEdges.values()
  ].filter(
    edge =>
      unionFind.find(
        edge.sourceKey
      ) !==
      unionFind.find(
        edge.targetKey
      )
  );

  const reviewResult =
    buildReviewGroups(
      unresolvedReviewEdges,
      activeArticlesByKey
    );

  const ambiguousGroups =
    reviewResult.groups;

  const clusterSizes =
    autoMergedClusters
      .map(
        cluster =>
          cluster.articles.length
      )
      .sort(
        (left, right) =>
          right - left
      );

  const largestCluster =
    clusterSizes[0] || 0;

  const largestClusterRatio =
    largestCluster /
    activeArticles.length;

  console.log(
    '[HNSW CLUSTER STATS]',
    JSON.stringify({
      activeArticles:
        activeArticles.length,

      clusters:
        autoMergedClusters.length,

      singletons:
        clusterSizes.filter(
          size => size === 1
        ).length,

      multiArticleClusters:
        clusterSizes.filter(
          size => size > 1
        ).length,

      largestClusters:
        clusterSizes.slice(0, 20),

      unresolvedReviewPairsBeforeCap:
        unresolvedReviewEdges.length,

      reviewPairsAfterCap:
        reviewResult.cappedCount,

      reviewComponents:
        reviewResult.componentCount,

      ambiguousGroups:
        ambiguousGroups.length,

      deferredReviewGroups:
        Math.max(
          0,
          reviewResult
            .componentCount -
          ambiguousGroups.length
        ),

      cleanRebuild:
        previousState.cleanRebuild
    })
  );

  /*
   * Absolute corruption barrier. A bad result throws before the
   * caller can save it.
   */
  if (
    activeArticles.length >= 1000 &&
    (
      largestClusterRatio >
      HNSW_CONFIG
        .unsafeLargestClusterRatio ||
      largestCluster >
      HNSW_CONFIG
        .unsafeLargestClusterAbsolute
    )
  ) {
    throw new Error(
      `Unsafe HNSW result: largest ` +
      `cluster contains ` +
      `${largestCluster}/` +
      `${activeArticles.length} ` +
      `articles ` +
      `(${(
        largestClusterRatio * 100
      ).toFixed(1)}%). ` +
      `Previous saved clusters must ` +
      `be retained.`
    );
  }

  /*
   * Validate that every active article appears exactly once.
   */
  const seenArticleKeys =
    new Set();

  for (
    const cluster
    of autoMergedClusters
  ) {
    for (
      const article
      of cluster.articles
    ) {
      if (
        seenArticleKeys.has(
          article.articleKey
        )
      ) {
        throw new Error(
          'Article appears in ' +
          'multiple final clusters: ' +
          article.articleKey
        );
      }

      seenArticleKeys.add(
        article.articleKey
      );
    }
  }

  if (
    seenArticleKeys.size !==
    activeArticles.length
  ) {
    throw new Error(
      `Final cluster validation ` +
      `failed: clustered ` +
      `${seenArticleKeys.size}/` +
      `${activeArticles.length} ` +
      `active articles.`
    );
  }

  console.log(
    '[HNSW DEBUG] Finished ' +
    'runIncrementalHnswClustering. ' +
    `autoMergedClusters=` +
    `${autoMergedClusters.length}, ` +
    `ambiguousGroups=` +
    `${ambiguousGroups.length}`
  );

  return {
    autoMergedClusters,
    ambiguousGroups
  };
}