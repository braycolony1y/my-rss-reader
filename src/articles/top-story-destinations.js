import { filterDestinations } from '../smart/prefilter/state.js';
const canonicalDestination = value => String(value || '').replace(/_world$/, '_global').replace(/_foreign$/, '_global');
const destinationsForSource = (category, region) => {
    const normalizedCategory =
        canonicalDestination(category);

    const normalizedRegion =
        region === 'vietnam'
            ? 'vietnam'
            : (
                region
                    ? 'global'
                    : ''
            );

    if (normalizedCategory === 'tech') {
        if (
            normalizedRegion ===
            'vietnam'
        ) {
            return [
                'tech_vietnam'
            ];
        }

        if (
            normalizedRegion ===
            'global'
        ) {
            return [
                'tech_global'
            ];
        }

        return [
            'tech_vietnam',
            'tech_global'
        ];
    }

    if (
        [
            'news',
            'finance'
        ].includes(
            normalizedCategory
        )
    ) {
        if (normalizedRegion) {
            return [
                `${normalizedCategory}_${normalizedRegion}`
            ];
        }

        return [
            `${normalizedCategory}_vietnam`,
            `${normalizedCategory}_global`
        ];
    }

    return normalizedCategory
        ? [normalizedCategory]
        : [];
};
export function rawAllowedDestinations(article, sources) {
    // Source/feed configuration is the hard eligibility boundary.
    // Language is metadata, not geography.
    const configured = sources.filter(
        source =>
            source.enabled !== false &&
            (
                source.url === article.feedUrl ||
                source.fallbackUrl === article.feedUrl
            )
    );
    return [
        ...new Set(
            configured.flatMap(
                source =>
                    destinationsForSource(
                        source.category,
                        source.region
                    )
            )
        )
    ].filter(Boolean);
}

export function allowedDestinations(article, sources) {
    return filterDestinations(article, rawAllowedDestinations(article, sources));
}
