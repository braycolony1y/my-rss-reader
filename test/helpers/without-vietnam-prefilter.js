// Historical golden contracts describe the pre-feature engine. Exercise the
// documented kill switch against that exact baseline, rather than rewriting it.
export async function withoutVietnamPrefilter(run) {
  const personalOriginal = process.env.SMART_PERSONAL_FILTER_ENABLED;
  process.env.SMART_PERSONAL_FILTER_ENABLED = 'false';
  const original = process.env.SMART_TOP_VN_PREFILTER_ENABLED;
  process.env.SMART_TOP_VN_PREFILTER_ENABLED = 'false';
  try { return await run(); }
  finally {
    if (personalOriginal === undefined) delete process.env.SMART_PERSONAL_FILTER_ENABLED;
    else process.env.SMART_PERSONAL_FILTER_ENABLED = personalOriginal;
    if (original === undefined) delete process.env.SMART_TOP_VN_PREFILTER_ENABLED;
    else process.env.SMART_TOP_VN_PREFILTER_ENABLED = original;
  }
}
