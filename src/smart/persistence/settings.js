export function createSmartSettings({ db }) {

  async function getSettings() {
    return (
      await db.get(
        'smartSettings',
        {
          type: 'json'
        }
      )
    ) || {
      excludedCategories: [],
      excludedFeedCategories: []
    };
  }

  async function updateSettings(
    settings
  ) {
    const current =
      await getSettings();

    const updated = {
      ...current,
      ...settings
    };

    await db.put(
      'smartSettings',
      JSON.stringify(updated)
    );

    return updated;
  }

  return { getSettings, updateSettings };
}
