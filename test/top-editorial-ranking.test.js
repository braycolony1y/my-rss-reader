import test from 'node:test';
import assert from 'node:assert/strict';

import {
  allowedDestinations,
  feedRelevance,
  createTopStoriesIndex
} from '../src/articles/top-stories.js';

import {
  parseSmartEditorialResponse,
  smartEditorialEligibleDestinations
} from '../src/ai/smart-editorial.js';

const source = {
  title: 'Vietnam News',
  url: 'https://example.test/vn.xml',
  category: 'news_vietnam',
  region: 'vietnam',
  enabled: true
};

const makeArticle = ({
  title,
  link,
  relevance,
  impact,
  novelty = .8,
  confidence = .85,
  exclude = false
}) => ({
  title,
  link,
  content: title,
  pubDate:
    '2026-09-16T00:00:00.000Z',
  publicationTimeReliable: true,
  feedUrl: source.url,
  feedTitle: source.title,
  smartCategory: 'news_vietnam',
  feedCategory: 'News',
  language: 'en',
  sourceWeight: 1.2,
  editorialAssessment: {
    policyVersion:
      'ai-editorial-v1',
    revision: link,
    eligibleDestinations:
      ['news_vietnam'],
    destination:
      exclude
        ? 'none'
        : 'news_vietnam',
    relevance:
      exclude
        ? 0
        : relevance,
    impact,
    novelty,
    confidence,
    exclude,
    reason: 'test'
  }
});

test(
  'language no longer determines Vietnam versus World eligibility',
  () => {
    const article = {
      title:
        'Vietnam government announces transport policy',
      feedUrl:
        source.url,
      language:
        'en'
    };

    assert.deepEqual(
      allowedDestinations(
        article,
        [source]
      ),
      ['news_vietnam']
    );
  }
);

test(
  'generic Tech source permits AI to choose Vietnam or World',
  () => {
    const techSource = {
      url:
        'https://example.test/tech.xml',
      category:
        'tech',
      enabled:
        true
    };

    const cluster = {
      feedUrl:
        techSource.url
    };

    assert.deepEqual(
      smartEditorialEligibleDestinations(
        cluster,
        [techSource]
      ),
      [
        'tech_vietnam',
        'tech_world'
      ]
    );
  }
);

test(
  'semantic relevance comes from AI assessment',
  () => {
    const article =
      makeArticle({
        title:
          'Bộ Y tế yêu cầu điều tra vụ 95 người nghi ngộ độc thực phẩm ở Huế',
        link:
          'https://example.test/poisoning',
        relevance:
          .97,
        impact:
          .88
      });

    assert.equal(
      feedRelevance(
        article,
        'news_vietnam'
      ),
      .97
    );

    assert.equal(
      feedRelevance(
        article,
        'news_world'
      ),
      0
    );
  }
);

test(
  'editorial parser rejects destination outside configured eligibility',
  () => {
    const item = {
      id: 'x',
      eligibleDestinations:
        ['news_vietnam']
    };

    assert.throws(
      () =>
        parseSmartEditorialResponse(
          JSON.stringify({
            assessments: [
              {
                id: 'x',
                destination:
                  'news_world',
                relevance: .9,
                impact: .8,
                novelty: .8,
                confidence: .9,
                exclude: false,
                reason: 'wrong'
              }
            ]
          }),
          [item]
        ),
      /Invalid Smart editorial/
    );
  }
);

test(
  'important Vietnam event can be Top while excluded fluff has zero score',
  async () => {
    const state = {};

    const db = {
      get:
        async key =>
          state[key],

      put:
        async (
          key,
          value
        ) => {
          state[key] =
            typeof value ===
              'string'
              ? JSON.parse(
                  value
                )
              : value;
        }
    };

    const stories = [
      makeArticle({
        title:
          'Bộ Y tế điều tra vụ 95 người nghi ngộ độc thực phẩm',
        link:
          'https://example.test/1',
        relevance:
          .98,
        impact:
          .9,
        novelty:
          .9
      }),

      makeArticle({
        title:
          'Chính sách mới ảnh hưởng hàng triệu người',
        link:
          'https://example.test/2',
        relevance:
          .94,
        impact:
          .82,
        novelty:
          .8
      }),

      makeArticle({
        title:
          'Người nổi tiếng khoe ảnh du lịch',
        link:
          'https://example.test/3',
        relevance:
          0,
        impact:
          .05,
        novelty:
          .1,
        exclude:
          true
      })
    ];

    const index =
      createTopStoriesIndex({
        db
      });

    const ranked =
      await index.rank(
        stories,
        [source],
        Date.parse(
          '2026-09-16T01:00:00.000Z'
        )
      );

    const vn =
      ranked
        .filter(
          article =>
            article.topStory
              ?.feed ===
            'news_vietnam'
        )
        .sort(
          (a, b) =>
            a.topStory.rank -
            b.topStory.rank
        );

    assert.equal(
      vn[0].link,
      'https://example.test/1'
    );

    assert.equal(
      vn[0].topStory.isTop,
      true
    );

    const fluff =
      vn.find(
        article =>
          article.link ===
          'https://example.test/3'
      );

    assert.ok(fluff);

    assert.equal(
      fluff.ranking.score,
      0
    );

    assert.equal(
      fluff.topStory.isTop,
      false
    );
  }
);
