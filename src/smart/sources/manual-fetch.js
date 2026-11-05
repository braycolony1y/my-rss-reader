import {fetchSmartSource} from './fetch.js';
import {sourceCooldown} from '../../articles/source-cooldown.js';
import {createManualPublisherRefresh} from '../../articles/manual-publisher-refresh.js';
import {withPublisherFetchKind} from '../../articles/publisher-fetch-context.js';

export function fetchSmartSourceForRefresh(source, parser, headers, scopes) {
    return withPublisherFetchKind('rss', async () => {
    const recovery = await createManualPublisherRefresh(source, scopes, sourceCooldown);
    const fetch = () => fetchSmartSource(source, parser, headers);
    const result = await (recovery ? recovery.run(fetch) : fetch());
    if (result.ok) await recovery?.accept();
    return result;
    });
}
