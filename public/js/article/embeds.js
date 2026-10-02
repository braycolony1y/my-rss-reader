// Owns article / embeds on the shared Alpine component.
// Methods retain their original bodies and receive the Alpine proxy as this.
const ReaderArticleEmbeds = {
    create() {
        return {

                loadTwitterWidgets() {
                    if (window.twttr?.widgets?.createTweet) return Promise.resolve(window.twttr);
                    if (window.__rssTwitterWidgetsPromise) return window.__rssTwitterWidgetsPromise;

                    window.__rssTwitterWidgetsPromise = new Promise((resolve, reject) => {
                        let script = document.getElementById('twitter-widgets-script');
                        let settled = false;
                        const finish = () => {
                            if (settled) return;
                            if (window.twttr?.widgets?.createTweet) {
                                settled = true;
                                resolve(window.twttr);
                            }
                        };
                        const fail = () => {
                            if (settled) return;
                            settled = true;
                            window.__rssTwitterWidgetsPromise = null;
                            reject(new Error('X embed renderer unavailable'));
                        };

                        if (!script) {
                            script = document.createElement('script');
                            script.id = 'twitter-widgets-script';
                            script.src = 'https://platform.twitter.com/widgets.js';
                            script.async = true;
                            script.charset = 'utf-8';
                            document.head.appendChild(script);
                        }
                        script.addEventListener('load', finish, { once: true });
                        script.addEventListener('error', fail, { once: true });

                        let attempts = 0;
                        const waitForApi = () => {
                            finish();
                            if (settled) return;
                            attempts += 1;
                            if (attempts >= 80) return fail();
                            setTimeout(waitForApi, 100);
                        };
                        waitForApi();
                    });

                    return window.__rssTwitterWidgetsPromise;
                },

                hydrateTwitterEmbeds(root = document) {
                    this.updateSourceTimes();
                    const scope = root?.querySelectorAll ? root : document;
                    const embeds = Array.from(scope.querySelectorAll('.voz-twitter-embed[data-tweet-id]'))
                        .filter(embed => !embed.dataset.twitterState);
                    if (!embeds.length) return;

                    const theme = this.theme === 'glass-light' ? 'light' : 'dark';
                    embeds.forEach(embed => {
                        embed.dataset.twitterState = 'loading';
                        const staging = document.createElement('div');
                        staging.className = 'voz-twitter-embed__staging';
                        embed.appendChild(staging);

                        this.loadTwitterWidgets()
                            .then(twttr => twttr.widgets.createTweet(embed.dataset.tweetId, staging, {
                                dnt: true,
                                theme
                            }))
                            .then(tweetFrame => {
                                if (!tweetFrame || !embed.isConnected) throw new Error('X post unavailable');
                                tweetFrame.setAttribute('scrolling', 'no');
                                embed.querySelector('.voz-twitter-embed__fallback')?.remove();
                                staging.classList.add('is-ready');
                                embed.dataset.twitterState = 'ready';
                            })
                            .catch(() => {
                                staging.remove();
                                embed.dataset.twitterState = 'fallback';
                            });
                    });
                },
        };
    }
};
