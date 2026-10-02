import { SMART_SOURCE_DISCOVERY_POOL } from '../../../smart-sources.js';
import { canonicalSmartCategory } from '../../utils/smart-destinations.js';
import { VALID_SMART_CATEGORIES } from '../config.js';
import { canonicalSourceUrl } from './identity.js';
import { normalizeSmartSource } from './normalize.js';

export function createSmartSourceDiscovery({ db, getSourceSettings }) {

  async function discoverSources(
    input = {}
  ) {
    input = { ...input, category: canonicalSmartCategory(input.category) };
    const category =
      VALID_SMART_CATEGORIES.has(
        input.category
      )
        ? input.category
        : '';

    if (!category) {
      throw new Error(
        'Choose a Smart section before searching.'
      );
    }

    const region =
      category === 'tech'
        ? (
          input.region ===
            'vietnam'
            ? 'vietnam'
            : 'foreign'
        )
        : (
          category.endsWith(
            '_vietnam'
          )
            ? 'vietnam'
            : 'foreign'
        );

    const sources =
      await getSourceSettings();

    const existing =
      new Set(
        sources.map(
          source =>
            canonicalSourceUrl(
              source.url
            )
        )
      );

    const candidates =
      SMART_SOURCE_DISCOVERY_POOL
        .map(source =>
          normalizeSmartSource({
            ...source,
            enabled: false,
            discovered: true
          })
        )
        .filter(
          source =>
            source &&
            source.category ===
            category &&
            source.region ===
            region &&
            !existing.has(
              canonicalSourceUrl(
                source.url
              )
            )
        )
        .sort(
          (left, right) =>
            right.weight -
            left.weight ||
            left.title.localeCompare(
              right.title
            )
        )
        .slice(0, 5);

    if (!candidates.length) {
      return {
        sources,
        candidates: []
      };
    }

    const updated = [
      ...sources,
      ...candidates
    ];

    await db.put(
      'smartSources',
      JSON.stringify(updated)
    );

    return {
      sources: updated,
      candidates
    };
  }

  return { discoverSources };
}
