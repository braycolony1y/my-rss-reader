import { SMART_SOURCES as DEFAULT_SMART_SOURCES } from '../../../smart-sources.js';
import { canonicalSmartCategory } from '../../utils/smart-destinations.js';
import { hostFromUrl, canonicalSourceUrl, sourceFetchPolicyIdentity } from './identity.js';
import { normalizeSmartSource, SMART_SOURCE_FETCH_METHODS } from './normalize.js';

export function createSmartSourceSettings({ db, getSettings }) {

  async function getSourceSettings() {
    const stored =
      await db.get(
        'smartSources',
        {
          type: 'json'
        }
      );

    const input =
      Array.isArray(stored) &&
        stored.length
        ? stored
        : DEFAULT_SMART_SOURCES;

    const seenUrls =
      new Set();

    const identities =
      new Set();

    const sources = [];

    const identityFor =
      source =>
        [
          source.category,
          source.region,
          source.domain ||
          hostFromUrl(
            source.url
          )
        ]
          .join('|')
          .toLowerCase();

    for (
      const rawSource
      of input
    ) {
      const source =
        normalizeSmartSource(
          rawSource
        );

      const url =
        source &&
        canonicalSourceUrl(
          source.url
        );

      if (
        !source ||
        !url ||
        seenUrls.has(url)
      ) {
        continue;
      }

      seenUrls.add(url);
      identities.add(
        identityFor(source)
      );
      sources.push(source);
    }

    let defaultsAdded = 0;

    if (
      Array.isArray(stored) &&
      stored.length
    ) {
      for (
        const rawDefault
        of DEFAULT_SMART_SOURCES
      ) {
        const source =
          normalizeSmartSource(
            rawDefault
          );

        const url =
          source &&
          canonicalSourceUrl(
            source.url
          );

        const identity =
          source &&
          identityFor(source);

        if (
          !source ||
          !url ||
          seenUrls.has(url) ||
          identities.has(
            identity
          )
        ) {
          continue;
        }

        seenUrls.add(url);
        identities.add(
          identity
        );
        sources.push(source);
        defaultsAdded++;
      }
    }

    // Older data may contain the same publisher in several Smart sections
    // with different fetch policies. A strict (non-empty) policy is the only
    // unambiguous legacy user choice, so use it for every Smart copy.
    const strictPolicyByPublisher = new Map();
    for (const source of sources) {
      const publisherIdentity = sourceFetchPolicyIdentity(source);
      if (
        publisherIdentity &&
        source.fetchMethods.length &&
        !strictPolicyByPublisher.has(publisherIdentity)
      ) {
        strictPolicyByPublisher.set(publisherIdentity, [...source.fetchMethods]);
      }
    }

    let policiesSynchronized = false;
    for (const source of sources) {
      const sharedMethods = strictPolicyByPublisher.get(sourceFetchPolicyIdentity(source));
      if (
        sharedMethods &&
        JSON.stringify(source.fetchMethods) !== JSON.stringify(sharedMethods)
      ) {
        source.fetchMethods = [...sharedMethods];
        policiesSynchronized = true;
      }
    }

    if (defaultsAdded || policiesSynchronized) {
      await db.put(
        'smartSources',
        JSON.stringify(sources)
      );
    }

    if (!sources.length) {
      return DEFAULT_SMART_SOURCES
        .map(
          normalizeSmartSource
        )
        .filter(Boolean);
    }

    const scores =
      await db.get(
        'smartSourceScores',
        {
          type: 'json'
        }
      );

    if (
      scores &&
      typeof scores === 'object'
    ) {
      for (const source of sources) {
        if (
          source.domain &&
          Number.isFinite(
            Number(
              scores[
              source
                .domain
              ]
            )
          )
        ) {
          source.weight =
            Number(
              scores[
              source
                .domain
              ]
            );
        }
      }
    }

    return sources;
  }

  async function getSources() {
    const settings =
      await getSettings();

    const excludedCategories =
      Array.isArray(
        settings.excludedCategories
      )
        ? settings
          .excludedCategories
        : [];

    return (
      await getSourceSettings()
    ).filter(
      source =>
        source.enabled !== false &&
        !excludedCategories.includes(
          source.category
        )
    );
  }

  async function addSource(input) {
    input = { ...input, category: canonicalSmartCategory(input?.category) };
    const source =
      normalizeSmartSource({
        ...(input || {}),
        enabled: true
      });

    if (!source) {
      throw new Error(
        'Enter a valid RSS/Atom URL.'
      );
    }

    const sources =
      await getSourceSettings();

    const publisherIdentity = sourceFetchPolicyIdentity(source);
    const sharedPolicySource = publisherIdentity
      ? sources.find(current =>
        sourceFetchPolicyIdentity(current) === publisherIdentity &&
        Array.isArray(current.fetchMethods) &&
        current.fetchMethods.length
      )
      : null;
    if (sharedPolicySource) {
      source.fetchMethods = [...sharedPolicySource.fetchMethods];
    }

    const key =
      canonicalSourceUrl(
        source.url
      );

    const existingIndex =
      sources.findIndex(
        current =>
          canonicalSourceUrl(
            current.url
          ) === key
      );

    const updated = [...sources];

    if (
      existingIndex >= 0
    ) {
      updated[
        existingIndex
      ] = {
        ...updated[
        existingIndex
        ],
        ...source,
        enabled: true
      };
    } else {
      updated.push(source);
    }

    await db.put(
      'smartSources',
      JSON.stringify(updated)
    );

    return updated;
  }

  async function setSourceEnabled(
    url,
    enabled
  ) {
    const key =
      canonicalSourceUrl(url);

    if (!key) {
      throw new Error(
        'Invalid Smart source URL.'
      );
    }

    const sources =
      await getSourceSettings();

    const index =
      sources.findIndex(
        source =>
          canonicalSourceUrl(
            source.url
          ) === key
      );

    if (index < 0) {
      throw new Error(
        'Smart source not found.'
      );
    }

    const updated =
      sources.map(
        (source, sourceIndex) =>
          sourceIndex === index
            ? {
              ...source,
              enabled:
                Boolean(
                  enabled
                )
            }
            : source
      );

    if (
      !updated.some(
        source =>
          source.enabled !==
          false
      )
    ) {
      throw new Error(
        'Smart must keep at least one enabled source.'
      );
    }

    await db.put(
      'smartSources',
      JSON.stringify(updated)
    );

    return updated;
  }

  async function removeSource(url) {
    return setSourceEnabled(
      url,
      false
    );
  }

  async function updateSourceFetchMethodsByIdentity(sources, identity, fetchMethods = []) {
    const publisherIdentity = sourceFetchPolicyIdentity(identity);
    if (!publisherIdentity) throw new Error('Invalid source identity.');
    const normalizedMethods = Array.isArray(fetchMethods)
      ? [...new Set(fetchMethods.filter(method => SMART_SOURCE_FETCH_METHODS.has(method)))]
      : [];
    const updated = sources.map(source =>
      sourceFetchPolicyIdentity(source) === publisherIdentity
        ? { ...source, fetchMethods: [...normalizedMethods] }
        : source
    );
    await db.put('smartSources', JSON.stringify(updated));
    return updated;
  }

  async function setSourceFetchMethodsByIdentity(identity, fetchMethods = []) {
    const sources = await getSourceSettings();
    return updateSourceFetchMethodsByIdentity(sources, identity, fetchMethods);
  }

  async function setSourceFetchMethods(url, fetchMethods = []) {
    const key = canonicalSourceUrl(url);
    if (!key) throw new Error('Invalid Smart source URL.');
    const sources = await getSourceSettings();
    const source = sources.find(current => canonicalSourceUrl(current.url) === key);
    if (!source) throw new Error('Smart source not found.');
    return updateSourceFetchMethodsByIdentity(sources, source, fetchMethods);
  }

  async function resetSources() {
    const existingSources = await getSourceSettings();
    const strictPolicyByPublisher = new Map();
    for (const source of existingSources) {
      const identity = sourceFetchPolicyIdentity(source);
      if (identity && source.fetchMethods.length && !strictPolicyByPublisher.has(identity)) {
        strictPolicyByPublisher.set(identity, [...source.fetchMethods]);
      }
    }

    const sources =
      DEFAULT_SMART_SOURCES
        .map(source =>
          normalizeSmartSource({
            ...source,
            enabled: true
          })
        )
        .filter(Boolean)
        .map(source => ({
          ...source,
          fetchMethods: [
            ...(strictPolicyByPublisher.get(sourceFetchPolicyIdentity(source)) || source.fetchMethods)
          ]
        }));

    await db.put(
      'smartSources',
      JSON.stringify(sources)
    );

    return sources;
  }

  return { getSourceSettings, getSources, addSource, setSourceEnabled, removeSource, updateSourceFetchMethodsByIdentity, setSourceFetchMethodsByIdentity, setSourceFetchMethods, resetSources };
}
