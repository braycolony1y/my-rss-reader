export function attachSmartReviewProgress(reviewGroups, options, metrics, notify) {
for (let reviewIndex = 0; reviewIndex < reviewGroups.length; reviewIndex++) {
        const group = reviewGroups[reviewIndex];
        group.forceRebuild = options.forceRebuild === true;
        group.metrics = metrics;
        group.reviewIndex = reviewIndex;
        group.onStage = (stage, details = {}) => {
          const current = reviewIndex + 1;
          const remaining = Math.max(
            0,
            reviewGroups.length - current
          );
          const providerIndex = Number(
            details.providerAttempt
          ) || null;
          const providerTotal = Number(
            details.providerTotal
          ) || null;
          const providerLabel =
            details.model ||
            details.providerId ||
            'provider';
          const providerProgress =
            providerIndex && providerTotal
              ? ` · provider ${providerIndex}/${providerTotal}`
              : '';
          const action = stage === 'smart-ai-repair'
            ? `repairing ${providerLabel} response`
            : stage === 'smart-ai-fallback'
              ? `${providerLabel}${providerProgress}`
              : `${providerLabel}${providerProgress}`;

          notify(
            stage,
            `Smart Verify · Group ${current}/${reviewGroups.length} · ${remaining} remaining · ${action}`,
            {
              current,
              total: reviewGroups.length,
              remaining,
              providerIndex,
              providerTotal,
              reviewGroupId: group.id,
              reviewArticleCount: group.articles.length,
              ...details
            }
          );
        };
      }
}
