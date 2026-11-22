import { Page as UpstreamPage } from '../../node_modules/@jackwener/opencli/dist/src/browser/page.js';
import { sendCommandFull } from '../../node_modules/@jackwener/opencli/dist/src/browser/daemon-client.js';
import { buildEvaluateExpression } from '../../node_modules/@jackwener/opencli/dist/src/browser/utils.js';
import { classifyBrowserError } from '../../node_modules/@jackwener/opencli/dist/src/browser/errors.js';

// Keep the bridge's physical target identity after every command, including
// the first evaluation and a rebind after an extension/daemon reconnect.
export function createLeaseBoundPageClass(BasePage, send, expression) {
    return class LeaseBoundPage extends BasePage {
        async evaluate(input, ...args) {
            const code = expression(input, args);
            for (let attempt = 0; ; attempt++) {
                try {
                    const result = await send('exec', { code, ...this._cmdOpts() });
                    if (result.page !== undefined) this._page = result.page;
                    return result.data;
                } catch (error) {
                    if (attempt) throw error;
                    if (/stale page identity|^Page not found:/i.test(error.message || '')) {
                        this.setActivePage(undefined);
                    } else {
                        const advice = classifyBrowserError(error);
                        if (advice.kind !== 'target-navigation') throw error;
                        await new Promise(resolve => setTimeout(resolve, advice.delayMs));
                    }
                }
            }
        }

        async goto(url, options) {
            // Recover the existing session lease before upstream goto() can
            // create a second tab just because this process has no cached ID.
            if (this.getActivePage() === undefined) await this.evaluate(() => location.href);
            return super.goto(url, options);
        }
    };
}

export const Page = createLeaseBoundPageClass(UpstreamPage, sendCommandFull, buildEvaluateExpression);
