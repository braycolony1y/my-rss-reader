import { getArticleId, stableId, createGroupId } from '../articles/identity.js';
import { SMART_NEWS_CLUSTER_CONFIG } from '../config.js';
import { safeDate } from '../dates/publication-time.js';
import { createAutoComponentPartition } from './auto-merge.js';
import { getEventEvidence } from './event-evidence.js';
import { isPairWithinComparisonScope, cosineSimilarity, classifyE5Match, MatchDecision, isAiRecoveryReviewCandidate, pairKey } from './similarity.js';
import { monitorEventLoopDelay } from 'node:perf_hooks';

export async function deterministicGroups(
  articles,
  onProgress = null
) {
  const perfMonitor =
    monitorEventLoopDelay({
      resolution: 10
    });

  perfMonitor.enable();

  const startTime = Date.now();

  let lastYield = Date.now();

  const yieldIfNeeded =
    async force => {
      if (
        force ||
        Date.now() - lastYield > 15
      ) {
        await new Promise(
          resolve =>
            setImmediate(resolve)
        );

        lastYield = Date.now();
      }
    };

  const validArticles =
    articles.filter(
      article =>
        article.publicationTimeReliable !==
        false
    );

  const isolatedArticles =
    articles.filter(
      article =>
        article.publicationTimeReliable ===
        false
    );

  const nodes =
    validArticles.map(
      (article, index) => ({
        index,
        id: getArticleId(article),
        article
      })
    );

  const nodeCount =
    nodes.length;

  /*
   * topKCandidates now limits only uncertain REVIEW
   * relationships. AUTO_MERGE relationships are never
   * limited, so a large event may contain any number
   * of related articles.
   */
  const reviewLimit =
    Math.max(
      1,
      Number(
        SMART_NEWS_CLUSTER_CONFIG
          .topKCandidates
      ) || 20
    );

  /*
   * Union-find stores automatic connectivity using
   * O(number of articles) memory instead of retaining
   * millions of pair objects.
   */
  const parent =
    new Int32Array(nodeCount);

  const rank =
    new Uint8Array(nodeCount);

  for (
    let index = 0;
    index < nodeCount;
    index++
  ) {
    parent[index] = index;
  }

  const findRoot =
    index => {
      let root = index;

      while (
        parent[root] !== root
      ) {
        root = parent[root];
      }

      while (
        parent[index] !== index
      ) {
        const next =
          parent[index];

        parent[index] = root;
        index = next;
      }

      return root;
    };

  const unionNodes =
    (left, right) => {
      let leftRoot =
        findRoot(left);

      let rightRoot =
        findRoot(right);

      if (
        leftRoot === rightRoot
      ) {
        return false;
      }

      if (
        rank[leftRoot] <
        rank[rightRoot]
      ) {
        [
          leftRoot,
          rightRoot
        ] = [
            rightRoot,
            leftRoot
          ];
      }

      parent[rightRoot] =
        leftRoot;

      if (
        rank[leftRoot] ===
        rank[rightRoot]
      ) {
        rank[leftRoot]++;
      }

      return true;
    };

  const reviewCandidatesByNode =
    nodes.map(() => []);

  const compareReviewCandidates =
    (left, right) =>
      (
        right.reviewScore ??
        right.similarity
      ) -
      (
        left.reviewScore ??
        left.similarity
      ) ||
      nodes[left.target]
        .id
        .localeCompare(
          nodes[right.target].id
        );

  /*
   * Retain only the strongest uncertain links for each
   * article. This never removes AUTO_MERGE links.
   */
  const addReviewCandidate =
    (
      sourceIndex,
      targetIndex,
      similarity,
      reviewScore = similarity
    ) => {
      const list =
        reviewCandidatesByNode[
        sourceIndex
        ];

      const candidate = {
        target: targetIndex,
        similarity,
        reviewScore
      };

      if (
        list.length <
        reviewLimit
      ) {
        list.push(candidate);

        if (
          list.length ===
          reviewLimit
        ) {
          list.sort(
            compareReviewCandidates
          );
        }

        return;
      }

      const worst =
        list[
        list.length - 1
        ];

      if (
        compareReviewCandidates(
          candidate,
          worst
        ) < 0
      ) {
        list[
          list.length - 1
        ] = candidate;

        list.sort(
          compareReviewCandidates
        );
      }
    };

  const now = Date.now();

  let scopedPairCount = 0;
  let autoMergePairCount = 0;
  let reviewPairCount = 0;
  let rejectedPairCount = 0;

  /*
   * Compare pairs without storing every comparison.
   *
   * AUTO_MERGE:
   *   Apply immediately through union-find.
   *
   * REVIEW:
   *   Retain only top-K uncertain candidates.
   *
   * REJECT:
   *   Discard immediately.
   */
  for (
    let left = 0;
    left < nodeCount;
    left++
  ) {
    for (
      let right = left + 1;
      right < nodeCount;
      right++
    ) {
      if (
        !isPairWithinComparisonScope(
          nodes[left].article,
          nodes[right].article,
          now
        )
      ) {
        continue;
      }

      scopedPairCount++;

      const similarity =
        nodes[left].article._vec &&
          nodes[right].article._vec
          ? cosineSimilarity(
            nodes[left].article._vec,
            nodes[right].article._vec
          )
          : 0;

      const classification =
        classifyE5Match(
          nodes[left].article,
          nodes[right].article,
          similarity
        );

      if (
        classification.decision ===
        MatchDecision.AUTO_MERGE
      ) {
        unionNodes(left, right);

        autoMergePairCount++;
      } else if (
        classification.decision ===
        MatchDecision.REVIEW
      ) {
        addReviewCandidate(
          left,
          right,
          similarity
        );

        addReviewCandidate(
          right,
          left,
          similarity
        );

        reviewPairCount++;
      } else if (
        isAiRecoveryReviewCandidate(
          nodes[left].article,
          nodes[right].article,
          similarity
        )
      ) {
        /*
         * Conservative deterministic matching rejected this pair, but it is
         * still plausible enough to deserve exact-event AI verification.
         * Do not union it here.
         */
        const recoveryEvidence =
          getEventEvidence(
            nodes[left].article,
            nodes[right].article
          );

        /*
         * Concrete event anchors help a recovery candidate survive the
         * bounded top-K queue. The original cosine similarity remains stored
         * separately and AI still makes the exact-event decision.
         */
        const recoveryReviewScore =
          similarity +
          Math.min(
            0.15,
            recoveryEvidence.score *
              0.03
          );

        addReviewCandidate(
          left,
          right,
          similarity,
          recoveryReviewScore
        );

        addReviewCandidate(
          right,
          left,
          similarity,
          recoveryReviewScore
        );

        reviewPairCount++;
      } else {
        rejectedPairCount++;
      }
    }

    await yieldIfNeeded();

    if (
      onProgress &&
      (
        left % 25 === 0 ||
        left === nodeCount - 1
      )
    ) {
      onProgress({
        phase: 'matching',
        current: left + 1,
        total: nodeCount
      });
    }
  }

  /*
   * Deduplicate retained uncertain relationships.
   * Maximum size is approximately articles × topK.
   */
  const selectedReviewPairs =
    new Map();

  for (
    let index = 0;
    index <
    reviewCandidatesByNode.length;
    index++
  ) {
    const candidates =
      reviewCandidatesByNode[
      index
      ];

    if (
      candidates.length <
      reviewLimit
    ) {
      candidates.sort(
        compareReviewCandidates
      );
    }

    for (
      const candidate
      of candidates
    ) {
      const key =
        pairKey(
          index,
          candidate.target
        );

      const existing =
        selectedReviewPairs.get(
          key
        );

      if (
        existing === undefined ||
        candidate.similarity >
        existing
      ) {
        selectedReviewPairs.set(
          key,
          candidate.similarity
        );
      }
    }

    await yieldIfNeeded();
  }

  /*
   * Convert union-find roots into initial automatic
   * components.
   */
  const componentsByRoot =
    new Map();

  for (
    let index = 0;
    index < nodeCount;
    index++
  ) {
    const root =
      findRoot(index);

    const component =
      componentsByRoot.get(root);

    if (component) {
      component.push(index);
    } else {
      componentsByRoot.set(
        root,
        [index]
      );
    }
  }

  const initialAutoComponents =
    [
      ...componentsByRoot.values()
    ];

  const { splitComponent, getComponents } = createAutoComponentPartition(nodes, yieldIfNeeded);

  for (
    const component
    of initialAutoComponents
  ) {
    await splitComponent(
      component
    );
  }

  const finalAutoComponents = getComponents();

  const nodeToAutoCluster =
    new Map();

  finalAutoComponents.forEach(
    (
      component,
      clusterIndex
    ) => {
      for (
        const nodeIndex
        of component
      ) {
        nodeToAutoCluster.set(
          nodeIndex,
          clusterIndex
        );
      }
    }
  );

  /*
   * Build the uncertain cluster graph using only the
   * bounded REVIEW candidates.
   */
  const reviewAdjacency =
    finalAutoComponents.map(
      () => new Set()
    );

  for (
    const key
    of selectedReviewPairs.keys()
  ) {
    const [
      leftString,
      rightString
    ] = key.split('|');

    const left =
      Number(leftString);

    const right =
      Number(rightString);

    const leftCluster =
      nodeToAutoCluster.get(
        left
      );

    const rightCluster =
      nodeToAutoCluster.get(
        right
      );

    if (
      leftCluster === undefined ||
      rightCluster === undefined ||
      leftCluster === rightCluster
    ) {
      continue;
    }

    reviewAdjacency[
      leftCluster
    ].add(rightCluster);

    reviewAdjacency[
      rightCluster
    ].add(leftCluster);
  }

  const reviewVisited =
    new Set();

  const ambiguousAutoClusterIndexes =
    new Set();

  const ambiguousGroups = [];

  for (
    let clusterIndex = 0;
    clusterIndex <
    finalAutoComponents.length;
    clusterIndex++
  ) {
    if (
      reviewVisited.has(
        clusterIndex
      ) ||
      !reviewAdjacency[
        clusterIndex
      ].size
    ) {
      continue;
    }

    const componentClusters = [];
    const queue = [clusterIndex];

    let queueIndex = 0;

    reviewVisited.add(
      clusterIndex
    );

    while (
      queueIndex < queue.length
    ) {
      const current =
        queue[queueIndex++];

      componentClusters.push(
        current
      );

      ambiguousAutoClusterIndexes
        .add(current);

      for (
        const neighbor
        of reviewAdjacency[
        current
        ]
      ) {
        if (
          !reviewVisited.has(
            neighbor
          )
        ) {
          reviewVisited.add(
            neighbor
          );

          queue.push(neighbor);
        }
      }
    }

    const groupArticles =
      componentClusters.flatMap(
        current =>
          finalAutoComponents[
            current
          ].map(
            nodeIndex =>
              nodes[nodeIndex]
                .article
          )
      );

    ambiguousGroups.push({
      id:
        `review_${stableId(
          groupArticles
            .map(getArticleId)
            .sort()
            .join('|')
        )}`,

      articles:
        groupArticles,

      // Preserve the already-safe deterministic HNSW components. If the
      // review neighborhood is too large for AI, these components are the
      // conservative publication fallback; they must not be flattened into
      // singletons or arbitrarily chunked for separate AI decisions.
      deterministicComponents:
        componentClusters.map(
          current =>
            finalAutoComponents[current]
              .map(nodeIndex =>
                getArticleId(
                  nodes[nodeIndex].article
                )
              )
              .sort()
        )
    });

    await yieldIfNeeded();
  }

  const autoMergedClusters = [];

  finalAutoComponents.forEach(
    (
      component,
      clusterIndex
    ) => {
      if (
        ambiguousAutoClusterIndexes
          .has(clusterIndex)
      ) {
        return;
      }

      const clusterArticles =
        component.map(
          nodeIndex =>
            nodes[nodeIndex]
              .article
        );

      autoMergedClusters.push({
        id:
          createGroupId(
            clusterArticles
          ),

        articles:
          clusterArticles,

        earliestDate:
          Math.min(
            ...clusterArticles.map(
              article =>
                safeDate(
                  article.pubDate
                )
            )
          ),

        latestDate:
          Math.max(
            ...clusterArticles.map(
              article =>
                safeDate(
                  article.pubDate
                )
            )
          )
      });
    }
  );

  for (
    const article
    of isolatedArticles
  ) {
    autoMergedClusters.push({
      id:
        createGroupId([article]),

      articles: [article],

      earliestDate:
        safeDate(
          article.pubDate
        ),

      latestDate:
        safeDate(
          article.pubDate
        )
    });
  }

  perfMonitor.disable();

  const durationMs =
    Date.now() - startTime;

  const maxDelay =
    Math.round(
      perfMonitor.max / 1e6
    );

  console.log(
    `[SMART MATCHING] nodes=${nodeCount} ` +
    `scopedPairs=${scopedPairCount} ` +
    `autoMergePairs=${autoMergePairCount} ` +
    `reviewPairs=${reviewPairCount} ` +
    `retainedReviewPairs=${selectedReviewPairs.size} ` +
    `rejectedPairs=${rejectedPairCount} ` +
    `autoComponents=${finalAutoComponents.length} ` +
    `ambiguousGroups=${ambiguousGroups.length}`
  );

  console.log(
    `[SMART PERFORMANCE] stage=matching durationMs=${durationMs} maxEventLoopDelayMs=${maxDelay}`
  );

  return {
    autoMergedClusters,
    ambiguousGroups
  };
}
