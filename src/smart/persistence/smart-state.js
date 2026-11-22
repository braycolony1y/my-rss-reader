async function putManySafe(
  db,
  values,
  options = {}
) {
  if (
    typeof db.putMany ===
    'function'
  ) {
    return db.putMany(
      values,
      options
    );
  }

  if ('smartClusters' in values) throw new Error('Atomic clustering persistence is unavailable; previous state retained.');
  for (
    const [key, value]
    of Object.entries(values)
  ) {
    await db.put(key, value);
  }
}

export { putManySafe };
