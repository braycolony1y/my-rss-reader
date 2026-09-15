import { createHash } from 'node:crypto';

export const SMART_EDITORIAL_POLICY_VERSION =
  'ai-editorial-v1';

export const SMART_EDITORIAL_DESTINATIONS = [
  'news_vietnam',
  'news_world',
  'finance_vietnam',
  'finance_world',
  'tech_vietnam',
  'tech_world'
];

const DESTINATION_SET =
  new Set(
    SMART_EDITORIAL_DESTINATIONS
  );

export const SMART_EDITORIAL_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    assessments: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: {
            type: 'string'
          },
          destination: {
            type: 'string',
            enum: [
              ...SMART_EDITORIAL_DESTINATIONS,
              'none'
            ]
          },
          relevance: {
            type: 'number',
            minimum: 0,
            maximum: 1
          },
          impact: {
            type: 'number',
            minimum: 0,
            maximum: 1
          },
          novelty: {
            type: 'number',
            minimum: 0,
            maximum: 1
          },
          confidence: {
            type: 'number',
            minimum: 0,
            maximum: 1
          },
          exclude: {
            type: 'boolean'
          },
          reason: {
            type: 'string'
          }
        },
        required: [
          'id',
          'destination',
          'relevance',
          'impact',
          'novelty',
          'confidence',
          'exclude',
          'reason'
        ],
        additionalProperties: false
      }
    }
  },
  required: [
    'assessments'
  ],
  additionalProperties: false
};

const membersOf =
  cluster => [
    cluster,
    ...(
      Array.isArray(
        cluster?.relatedArticles
      )
        ? cluster.relatedArticles
        : []
    )
  ].filter(Boolean);

function sourceDestinations(
  source
) {
  const category =
    String(
      source?.category || ''
    ).toLowerCase();

  if (
    DESTINATION_SET.has(
      category
    )
  ) {
    return [category];
  }

  if (
    category ===
    'finance_global'
  ) {
    return [
      'finance_world'
    ];
  }

  if (
    category ===
      'tech_foreign' ||
    category ===
      'tech_global'
  ) {
    return [
      'tech_world'
    ];
  }

  /*
   * Generic Tech feeds are intentionally eligible for both.
   * AI decides geography semantically instead of using article language.
   */
  if (
    category ===
    'tech'
  ) {
    const region =
      String(
        source?.region || ''
      ).toLowerCase();

    if (
      region ===
      'vietnam'
    ) {
      return [
        'tech_vietnam'
      ];
    }

    if (
      region &&
      region !==
      'vietnam'
    ) {
      return [
        'tech_world'
      ];
    }

    return [
      'tech_vietnam',
      'tech_world'
    ];
  }

  const normalized =
    category
      .replace(
        '_global',
        '_world'
      )
      .replace(
        '_foreign',
        '_world'
      );

  return DESTINATION_SET.has(
    normalized
  )
    ? [normalized]
    : [];
}

export function smartEditorialEligibleDestinations(
  cluster,
  sources
) {
  const urls =
    new Set(
      membersOf(cluster)
        .map(
          article =>
            article?.feedUrl
        )
        .filter(Boolean)
    );

  const result =
    new Set();

  for (
    const source
    of sources || []
  ) {
    if (
      source?.enabled ===
      false
    ) {
      continue;
    }

    if (
      !urls.has(
        source?.url
      ) &&
      !urls.has(
        source?.fallbackUrl
      )
    ) {
      continue;
    }

    for (
      const destination
      of sourceDestinations(
        source
      )
    ) {
      result.add(
        destination
      );
    }
  }

  return [
    ...result
  ].sort();
}

export function smartEditorialCacheKey(
  cluster,
  eligibleDestinations
) {
  const members =
    membersOf(cluster)
      .map(
        article => ({
          link:
            article?.link || '',
          title:
            article?.title || '',
          content:
            String(
              article?.content ||
              article?.description ||
              ''
            ).slice(
              0,
              1200
            ),
          publishedAt:
            article?.pubDate || '',
          feedUrl:
            article?.feedUrl || ''
        })
      )
      .sort(
        (a, b) =>
          String(a.link)
            .localeCompare(
              String(b.link)
            )
      );

  return createHash(
    'sha256'
  )
    .update(
      JSON.stringify({
        policy:
          SMART_EDITORIAL_POLICY_VERSION,
        eligibleDestinations,
        members
      })
    )
    .digest('hex')
    .slice(
      0,
      32
    );
}

export function smartEditorialLatestStamp(
  cluster
) {
  return Math.max(
    0,
    ...membersOf(
      cluster
    ).map(
      article =>
        Date.parse(
          article?.pubDate ||
          ''
        ) || 0
    )
  );
}

export function applySmartEditorialAssessment(
  cluster,
  assessment
) {
  cluster.editorialAssessment =
    assessment;

  for (
    const article
    of cluster?.relatedArticles ||
      []
  ) {
    article.editorialAssessment =
      assessment;
  }
}

export function buildSmartEditorialPrompt(
  items
) {
  const events =
    items.map(
      item => ({
        id:
          item.id,

        eligibleDestinations:
          item.eligibleDestinations,

        representative: {
          title:
            item.cluster?.title ||
            '',

          description:
            String(
              item.cluster?.content ||
              item.cluster?.description ||
              ''
            ).slice(
              0,
              1000
            ),

          source:
            item.cluster?.feedTitle ||
            '',

          publishedAt:
            item.cluster?.pubDate ||
            ''
        },

        coverage:
          membersOf(
            item.cluster
          )
            .slice(
              0,
              8
            )
            .map(
              article => ({
                title:
                  article?.title ||
                  '',
                source:
                  article?.feedTitle ||
                  '',
                publishedAt:
                  article?.pubDate ||
                  ''
              })
            )
      })
    );

  return [
    'You are the semantic editorial classifier for a multilingual Top Stories system.',
    '',
    'Assess each exact-event cluster independently.',
    '',
    'Do NOT use simple keyword matching.',
    'Writing language is NOT geographic scope.',
    'A Vietnamese-language article about Ukraine, the US, China, Russia, Japan, etc. is not Vietnam news merely because it is written in Vietnamese.',
    'An English-language article can be Vietnam news when the event is primarily about Vietnam.',
    '',
    'eligibleDestinations are HARD source-configuration constraints.',
    'destination MUST be one of the event eligibleDestinations or "none".',
    'Use "none" when the event does not genuinely belong in any allowed destination.',
    '',
    'Destination definitions:',
    '- news_vietnam: consequential general news primarily about Vietnam or directly and materially affecting Vietnam.',
    '- news_world: consequential general news primarily outside Vietnam.',
    '- finance_vietnam: Vietnam markets, banking, macroeconomics, business regulation or materially important companies.',
    '- finance_world: materially important global markets, finance, macroeconomics, business regulation or companies.',
    '- tech_vietnam: material technology developments primarily about Vietnam.',
    '- tech_world: material global technology developments.',
    '',
    'Return 0..1 scores:',
    '- relevance: semantic fit with selected destination.',
    '- impact: real-world consequence, scale, severity, policy/economic/social importance, and people/institutions materially affected.',
    '- novelty: how materially new this development is versus repetition, background, recap or commentary.',
    '- confidence: confidence supported by the supplied evidence.',
    '',
    'Set exclude=true for trivial celebrity/lifestyle chatter, advertorials, promotional stories, generic advice, routine product fluff, or geographic/category mismatch.',
    '',
    'Do not exclude merely because there is only one source.',
    'Do not require sensational wording for high impact.',
    'A serious public-health incident, government action, infrastructure disruption, natural disaster, major court decision, major policy/economic change or security incident can have high impact. These are examples, not keywords.',
    '',
    'reason must be concise, at most about 120 characters.',
    'Return exactly one assessment for every id.',
    'Do not invent ids.',
    'Return JSON only.',
    '',
    JSON.stringify({
      events
    })
  ].join('\n');
}

function jsonRoots(
  input
) {
  const text =
    String(
      input || ''
    );

  const roots = [];

  let start = -1;
  let depth = 0;
  let string = false;
  let escaped = false;

  for (
    let i = 0;
    i < text.length;
    i++
  ) {
    const char =
      text[i];

    if (string) {
      if (escaped) {
        escaped = false;
      } else if (
        char === '\\'
      ) {
        escaped = true;
      } else if (
        char === '"'
      ) {
        string = false;
      }

      continue;
    }

    if (
      char === '"'
    ) {
      string = true;
      continue;
    }

    if (
      char === '{'
    ) {
      if (
        depth === 0
      ) {
        start = i;
      }

      depth++;
      continue;
    }

    if (
      char === '}' &&
      depth > 0
    ) {
      depth--;

      if (
        depth === 0 &&
        start >= 0
      ) {
        roots.push(
          text.slice(
            start,
            i + 1
          )
        );

        start = -1;
      }
    }
  }

  return roots;
}

export function parseSmartEditorialResponse(
  raw,
  items
) {
  const text =
    String(
      typeof raw ===
        'string'
        ? raw
        : raw?.text ||
          raw?.rawProviderText ||
          ''
    ).trim();

  const roots =
    jsonRoots(text);

  const candidates =
    roots.length
      ? roots
      : [text];

  const expected =
    new Map(
      items.map(
        item => [
          item.id,
          item
        ]
      )
    );

  for (
    const candidate
    of candidates
  ) {
    let value;

    try {
      value =
        JSON.parse(
          candidate
        );
    } catch {
      continue;
    }

    if (
      !value ||
      typeof value !==
        'object' ||
      !Array.isArray(
        value.assessments
      ) ||
      value.assessments
        .length !==
        items.length
    ) {
      continue;
    }

    const rows =
      new Map();

    let valid =
      true;

    for (
      const row
      of value.assessments
    ) {
      const id =
        String(
          row?.id || ''
        );

      const item =
        expected.get(id);

      if (
        !item ||
        rows.has(id)
      ) {
        valid = false;
        break;
      }

      const destination =
        String(
          row?.destination ||
          ''
        );

      if (
        destination !==
          'none' &&
        !item
          .eligibleDestinations
          .includes(
            destination
          )
      ) {
        valid = false;
        break;
      }

      const relevance =
        Number(
          row?.relevance
        );

      const impact =
        Number(
          row?.impact
        );

      const novelty =
        Number(
          row?.novelty
        );

      const confidence =
        Number(
          row?.confidence
        );

      if (
        ![
          relevance,
          impact,
          novelty,
          confidence
        ].every(
          number =>
            Number.isFinite(
              number
            ) &&
            number >= 0 &&
            number <= 1
        ) ||
        typeof row?.exclude !==
          'boolean'
      ) {
        valid = false;
        break;
      }

      rows.set(
        id,
        {
          destination,

          relevance:
            destination ===
              'none'
              ? 0
              : relevance,

          impact,
          novelty,
          confidence,

          exclude:
            destination ===
              'none'
              ? true
              : row.exclude,

          reason:
            String(
              row?.reason ||
              ''
            ).slice(
              0,
              300
            )
        }
      );
    }

    if (
      valid &&
      rows.size ===
        items.length
    ) {
      return rows;
    }
  }

  const error =
    new Error(
      'Invalid Smart editorial assessment JSON'
    );

  error.code =
    'INVALID_JSON';

  error.rawResponse =
    text;

  throw error;
}

export function prepareSmartEditorialPlan({
  clusters,
  sources,
  cache,
  now = Date.now(),
  perDestination = 30
}) {
  const pending = [];

  let cacheHits = 0;

  for (
    const cluster
    of clusters || []
  ) {
    const eligibleDestinations =
      smartEditorialEligibleDestinations(
        cluster,
        sources
      );

    if (
      !eligibleDestinations
        .length
    ) {
      applySmartEditorialAssessment(
        cluster,
        {
          policyVersion:
            SMART_EDITORIAL_POLICY_VERSION,
          revision:
            'no-configured-destination',
          eligibleDestinations:
            [],
          destination:
            'none',
          relevance:
            0,
          impact:
            0,
          novelty:
            0,
          confidence:
            1,
          exclude:
            true,
          reason:
            'No configured Smart destination',
          providerId:
            null,
          model:
            null,
          assessedAt:
            new Date(now)
              .toISOString()
        }
      );

      continue;
    }

    const key =
      smartEditorialCacheKey(
        cluster,
        eligibleDestinations
      );

    const cached =
      cache?.[key];

    if (
      cached
        ?.assessment
        ?.policyVersion ===
      SMART_EDITORIAL_POLICY_VERSION
    ) {
      applySmartEditorialAssessment(
        cluster,
        cached.assessment
      );

      cacheHits++;
      continue;
    }

    delete cluster
      .editorialAssessment;

    for (
      const article
      of cluster
        ?.relatedArticles ||
        []
    ) {
      delete article
        .editorialAssessment;
    }

    if (
      cached?.failedAt &&
      now -
        (
          Date.parse(
            cached.failedAt
          ) || 0
        ) <
        30 * 60 * 1000
    ) {
      continue;
    }

    pending.push({
      cluster,
      id:
        key,
      key,
      eligibleDestinations,
      latest:
        smartEditorialLatestStamp(
          cluster
        )
    });
  }

  const selected = [];
  const selectedKeys =
    new Set();

  for (
    const destination
    of SMART_EDITORIAL_DESTINATIONS
  ) {
    const candidates =
      pending
        .filter(
          item =>
            item
              .eligibleDestinations
              .includes(
                destination
              )
        )
        .sort(
          (a, b) =>
            b.latest -
            a.latest
        )
        .slice(
          0,
          perDestination
        );

    for (
      const item
      of candidates
    ) {
      if (
        selectedKeys.has(
          item.key
        )
      ) {
        continue;
      }

      selectedKeys.add(
        item.key
      );

      selected.push(
        item
      );
    }
  }

  return {
    selected,
    pendingCount:
      Math.max(
        0,
        pending.length -
          selected.length
      ),
    cacheHits
  };
}
