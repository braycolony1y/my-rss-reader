function googleNewsRss(domain, category, region = '', days = 4) {
    const isVietnameseDomain = domain.endsWith('.vn') || domain.endsWith('.com.vn') || domain.includes('vietnam');
    const isVietnamese = category === 'news_vietnam' || category === 'finance_vietnam' || region === 'vietnam' || (category === 'tech' && isVietnameseDomain);
    let query = 'site:' + domain + ' when:' + Math.max(1, Number(days) || 4) + 'd';
    if (category === 'finance_vietnam') query += ' (kinh tế OR tài chính OR chứng khoán OR doanh nghiệp)';
    if (category === 'finance_global') query += ' (finance OR markets OR economy OR business)';
    if (category === 'tech') query += isVietnamese
        ? ' (công nghệ OR AI OR phần mềm OR thiết bị)'
        : ' (technology OR AI OR software OR hardware)';
    const locale = isVietnamese ? '&hl=vi&gl=VN&ceid=VN:vi' : '&hl=en-US&gl=US&ceid=US:en';
    return 'https://news.google.com/rss/search?q=' + encodeURIComponent(query) + locale;
}

const SOURCES_PER_TAB = 25;
const DISCOVERY_SOURCES = [];

function makeSources(category, specs, limit = SOURCES_PER_TAB) {
    const makeSource = (spec, index) => {
        const [title, domain, directUrl, weight = 1] = spec;
        const region = spec[4] || (category === 'tech'
            ? (index < 25 ? 'vietnam' : 'foreign')
            : (category.endsWith('_vietnam') ? 'vietnam' : (category.endsWith('_world') || category.endsWith('_global') ? 'foreign' : '')));
        const googleUrl = googleNewsRss(domain, category, region);
        return {
            title,
            domain,
            category,
            region,
            url: directUrl || googleUrl,
            fallbackUrl: directUrl ? googleUrl : '',
            weight
        };
    };
    const selected = specs.slice(0, limit).map(makeSource);
    DISCOVERY_SOURCES.push(...specs.slice(limit).map((spec, offset) => ({
        ...makeSource(spec, limit + offset),
        weight: Math.min(Number(spec[3] || 1), 0.99),
        discovered: true
    })));
    return selected;
}

const VIETNAM_NEWS = makeSources('news_vietnam', [
    ['VnExpress', 'vnexpress.net', 'https://vnexpress.net/rss/tin-moi-nhat.rss', 1.5],
    ['Tuoi Tre', 'tuoitre.vn', 'https://tuoitre.vn/home.rss', 1.5],
    ['Thanh Nien', 'thanhnien.vn', 'https://thanhnien.vn/rss/home.rss', 1.3],
    ['Dan Tri', 'dantri.com.vn', 'https://dantri.com.vn/rss/home.rss', 1.3],
    ['VietnamNet', 'vietnamnet.vn', 'https://vietnamnet.vn/rss/thoi-su.rss', 1.3],
    ['Lao Dong', 'laodong.vn', 'https://laodong.vn/rss/home.rss', 1],
    ['Nguoi Lao Dong', 'nld.com.vn', 'https://nld.com.vn/rss/home.rss', 1],
    ['Tien Phong', 'tienphong.vn', 'https://tienphong.vn/rss/home.rss', 1],
    ['VietnamPlus', 'vietnamplus.vn', 'https://www.vietnamplus.vn/rss/home.rss', 1.3],
    ['Phap Luat TP.HCM', 'plo.vn', 'https://plo.vn/rss/home.rss', 1],
    ['Nhan Dan', 'nhandan.vn', 'https://nhandan.vn/rss/home.rss', 1.3],
    ['VOV', 'vov.vn', '', 1],
    ['VTC News', 'vtcnews.vn', '', 1],
    ['Bao Chinh Phu', 'baochinhphu.vn', '', 1.3],
    ['Znews', 'znews.vn', 'https://znews.vn/rss/tin-moi-nhat.rss', 1],
    ['Soha', 'soha.vn', 'https://soha.vn/rss/home.rss', 1],
    ['Kenh14', 'kenh14.vn', 'https://kenh14.vn/rss/home.rss', 0.7],
    ['24H', '24h.com.vn', 'https://www.24h.com.vn/upload/rss/tintuctrongngay.rss', 0.7],
    ['Cong An Nhan Dan', 'cand.com.vn', 'https://cand.com.vn/rss/home.rss', 1],
    ['Quan Doi Nhan Dan', 'qdnd.vn', 'https://www.qdnd.vn/rss/home.rss', 1],
    ['Dai Doan Ket', 'daidoanket.vn', '', 1],
    ['Bao Tin Tuc', 'baotintuc.vn', 'https://baotintuc.vn/rss/home.rss', 1],
    ['Sai Gon Giai Phong', 'sggp.org.vn', 'https://www.sggp.org.vn/rss/home.rss', 1],
    ['Ha Noi Moi', 'hanoimoi.vn', '', 1],
    ['Kinh Te Do Thi', 'kinhtedothi.vn', '', 1],
    ['Doi Song Phap Luat', 'doisongphapluat.com.vn', '', 1],
    ['Gia Dinh Viet Nam', 'giadinhonline.vn', '', 1],
    ['Van Hoa', 'baovanhoa.vn', '', 1],
    ['Cong Thuong', 'congthuong.vn', '', 1],
    ['Nong Nghiep Moi Truong', 'nongnghiepmoitruong.vn', '', 1],
    ['Dan Viet', 'danviet.vn', '', 1],
    ['Cong Luan', 'congluan.vn', '', 1],
    ['Thoi Dai', 'thoidai.com.vn', '', 1],
    ['Bao Quoc Te', 'baoquocte.vn', '', 1],
    ['VTV News', 'vtv.vn', 'https://vtv.vn/rss/home.rss', 1.3],
    ['Ha Noi Online', 'hanoionline.vn', '', 1],
    ['VOH', 'voh.com.vn', '', 1],
    ['Phu Nu Viet Nam', 'phunuvietnam.vn', '', 1],
    ['Phu Nu Online', 'phunuonline.com.vn', '', 1],
    ['Suc Khoe Doi Song', 'suckhoedoisong.vn', 'https://suckhoedoisong.vn/rss/home.rss', 1],
    ['Bao Nghe An', 'baonghean.vn', '', 1],
    ['Bao Da Nang', 'baodanang.vn', '', 1],
    ['Bao Hai Phong', 'baohaiphong.vn', '', 1],
    ['Bao Can Tho', 'baocantho.com.vn', '', 1],
    ['Bao Lam Dong', 'baolamdong.vn', '', 1],
    ['Bao Dong Nai', 'baodongnai.com.vn', '', 1],
    ['Bao Thanh Hoa', 'baothanhhoa.vn', '', 1],
    ['Bao Hue Ngay Nay', 'huengaynay.vn', '', 1],
    ['Bao Quang Ninh', 'baoquangninh.vn', '', 1],
    ['Bao Khanh Hoa', 'baokhanhhoa.vn', '', 1]
]);

const WORLD_NEWS = makeSources('news_world', [
    ['BBC World', 'bbc.com', 'https://feeds.bbci.co.uk/news/world/rss.xml', 1.5],
    ['The Guardian World', 'theguardian.com', 'https://www.theguardian.com/world/rss', 1.3],
    ['Al Jazeera', 'aljazeera.com', 'https://www.aljazeera.com/xml/rss/all.xml', 1.3],
    ['NPR World', 'npr.org', 'https://feeds.npr.org/1004/rss.xml', 1.3],
    ['Euronews', 'euronews.com', 'https://www.euronews.com/rss?level=theme&name=news', 1],
    ['New York Times World', 'nytimes.com', 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml', 1.5],
    ['DW', 'dw.com', 'https://rss.dw.com/rdf/rss-en-all', 1.3],
    ['CBS World', 'cbsnews.com', 'https://www.cbsnews.com/latest/rss/world', 1.3],
    ['ABC News International', 'abcnews.go.com', 'https://abcnews.go.com/abcnews/internationalheadlines', 1.3],
    ['France 24', 'france24.com', 'https://www.france24.com/en/rss', 1.3],
    ['Associated Press', 'apnews.com', '', 1.5],
    ['Reuters World', 'reuters.com', '', 1.5],
    ['CNN World', 'cnn.com', 'http://rss.cnn.com/rss/edition_world.rss', 1.3],
    ['NBC News World', 'nbcnews.com', '', 1.3],
    ['Fox News World', 'foxnews.com', 'https://moxie.foxnews.com/google-publisher/world.xml', 1],
    ['USA Today World', 'usatoday.com', '', 1],
    ['PBS NewsHour', 'pbs.org', 'https://www.pbs.org/newshour/feeds/rss/world', 1.3],
    ['Voice of America', 'voanews.com', 'https://www.voanews.com/api/zmgqoe$moi', 1.3],
    ['Politico', 'politico.com', 'https://rss.politico.com/politics-news.xml', 1],
    ['The Hill', 'thehill.com', 'https://thehill.com/feed/', 1],
    ['Newsweek', 'newsweek.com', 'https://www.newsweek.com/rss', 1],
    ['Time', 'time.com', 'https://time.com/feed/', 1],
    ['CBC World', 'cbc.ca', 'https://www.cbc.ca/cmlink/rss-world', 1],
    ['CTV World', 'ctvnews.ca', 'https://www.ctvnews.ca/rss/ctvnews-ca-world-public-rss-1.822289', 1],
    ['Global News Canada', 'globalnews.ca', 'https://globalnews.ca/world/feed/', 1],
    ['ABC Australia', 'abc.net.au', 'https://www.abc.net.au/news/feed/52278/rss.xml', 1],
    ['SBS World', 'sbs.com.au', 'https://www.sbs.com.au/news/topic/latest/feed', 1],
    ['Sky News', 'news.sky.com', 'https://feeds.skynews.com/feeds/rss/world.xml', 1],
    ['The Independent', 'independent.co.uk', 'https://www.independent.co.uk/news/world/rss', 1],
    ['The Telegraph World', 'telegraph.co.uk', '', 1],
    ['Japan Times', 'japantimes.co.jp', 'https://www.japantimes.co.jp/feed/topstories/', 1],
    ['NHK World', 'nhk.or.jp', '', 1],
    ['Korea Herald', 'koreaherald.com', '', 1],
    ['South China Morning Post', 'scmp.com', 'https://www.scmp.com/rss/91/feed', 1],
    ['The Straits Times', 'straitstimes.com', 'https://www.straitstimes.com/news/world/rss.xml', 1],
    ['Channel NewsAsia', 'channelnewsasia.com', 'https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml', 1],
    ['Bangkok Post', 'bangkokpost.com', 'https://www.bangkokpost.com/rss/data/topstories.xml', 1],
    ['The Hindu', 'thehindu.com', 'https://www.thehindu.com/news/international/feeder/default.rss', 1],
    ['Times of India World', 'timesofindia.indiatimes.com', 'https://timesofindia.indiatimes.com/rssfeeds/296589292.cms', 1],
    ['Arab News', 'arabnews.com', 'https://www.arabnews.com/rss.xml', 1],
    ['Jerusalem Post', 'jpost.com', 'https://www.jpost.com/rss/rssfeedsheadlines.aspx', 1],
    ['Haaretz', 'haaretz.com', '', 1],
    ['Africanews', 'africanews.com', 'https://www.africanews.com/feed/rss', 1],
    ['Anadolu Agency', 'aa.com.tr', '', 1],
    ['Kyiv Independent', 'kyivindependent.com', 'https://kyivindependent.com/rss/', 1],
    ['Radio Free Europe', 'rferl.org', 'https://www.rferl.org/api/zrqiteuuir', 1],
    ['El Pais English', 'english.elpais.com', 'https://feeds.elpais.com/mrss-s/pages/ep/site/english.elpais.com/portada', 1],
    ['Le Monde English', 'lemonde.fr', 'https://www.lemonde.fr/en/rss/une.xml', 1],
    ['Irish Times World', 'irishtimes.com', 'https://www.irishtimes.com/cmlink/news-world-1.1319192', 1],
    ['New Zealand Herald World', 'nzherald.co.nz', 'https://www.nzherald.co.nz/arc/outboundfeeds/rss/section/world/', 1]
]);

const VIETNAM_FINANCE = makeSources('finance_vietnam', [
    ['CafeF Markets', 'cafef.vn', 'https://cafef.vn/thi-truong-chung-khoan.rss', 1],
    ['VnEconomy Markets', 'vneconomy.vn', 'https://vneconomy.vn/chung-khoan.rss', 1],
    ['VnExpress Business', 'vnexpress.net', 'https://vnexpress.net/rss/kinh-doanh.rss', 1.5],
    ['Tuoi Tre Business', 'tuoitre.vn', 'https://tuoitre.vn/home.rss', 1.5],
    ['Dan Tri Business', 'dantri.com.vn', 'https://dantri.com.vn/rss/kinh-doanh.rss', 1.3],
    ['Thanh Nien Economy', 'thanhnien.vn', 'https://thanhnien.vn/rss/kinh-te.rss', 1.3],
    ['VietnamNet Business', 'vietnamnet.vn', 'https://vietnamnet.vn/rss/kinh-doanh.rss', 1.3],
    ['Tien Phong Economy', 'tienphong.vn', 'https://tienphong.vn/rss/home.rss', 1],
    ['Lao Dong Business', 'laodong.vn', 'https://laodong.vn/rss/kinh-doanh.rss', 1],
    ['Nguoi Lao Dong Economy', 'nld.com.vn', 'https://nld.com.vn/rss/kinh-te.rss', 1],
    ['Bao Dau Tu', 'baodautu.vn', '', 1],
    ['Dau Tu Chung Khoan', 'tinnhanhchungkhoan.vn', '', 1],
    ['Vietstock', 'vietstock.vn', '', 1],
    ['Thoi Bao Tai Chinh Viet Nam', 'thoibaotaichinhvietnam.vn', '', 1],
    ['Dan Viet Economy', 'danviet.vn', '', 1],
    ['VOV Economy', 'vov.vn', '', 1],
    ['Bao Cong Thuong', 'congthuong.vn', '', 1],
    ['Bnews', 'bnews.vn', '', 1],
    ['Mekong ASEAN', 'mekongasean.vn', '', 1],
    ['VietnamBiz', 'vietnambiz.vn', 'https://vietnambiz.vn/tin-moi-nhat.rss', 1],
    ['CafeBiz', 'cafebiz.vn', '', 1],
    ['Doanh Nghiep Tiep Thi', 'doanhnghieptiepthi.vn', '', 1],
    ['VTC News Economy', 'vtcnews.vn', '', 1],
    ['TheLEADER', 'theleader.vn', '', 1],
    ['Nhip Cau Dau Tu', 'nhipcaudautu.vn', '', 1],
    ['Kinh Te Sai Gon', 'thesaigontimes.vn', '', 1],
    ['VietnamPlus Economy', 'vietnamplus.vn', 'https://www.vietnamplus.vn/rss/home.rss', 1.3],
    ['Dien Dan Doanh Nghiep', 'diendandoanhnghiep.vn', '', 1],
    ['VnBusiness', 'vnbusiness.vn', '', 1],
    ['MarketTimes', 'markettimes.vn', '', 1],
    ['Nguoi Quan Sat', 'nguoiquansat.vn', '', 1],
    ['Tai Chinh Doanh Nghiep', 'taichinhdoanhnghiep.net.vn', '', 1],
    ['Nha Dau Tu', 'nhadautu.vn', '', 1],
    ['VietnamFinance', 'vietnamfinance.vn', '', 1],
    ['FILI', 'fili.vn', '', 1],
    ['FireAnt News', 'fireant.vn', '', 1],
    ['SSI Research', 'ssi.com.vn', '', 1],
    ['Hanoi Stock Exchange', 'hnx.vn', '', 1],
    ['VietinBank', 'vietinbank.vn', '', 1],
    ['State Securities Commission', 'ssc.gov.vn', '', 1],
    ['VPBank', 'vpbank.com.vn', '', 1],
    ['Ministry of Finance Vietnam', 'mof.gov.vn', '', 1],
    ['General Statistics Office', 'nso.gov.vn', '', 1],
    ['Vietnam Customs', 'customs.gov.vn', '', 1],
    ['Vietnam Tax Authority', 'gdt.gov.vn', '', 1],
    ['Vietnam Electricity', 'evn.com.vn', '', 1],
    ['MBBank', 'mbbank.com.vn', '', 1],
    ['Agribank', 'agribank.com.vn', '', 1],
    ['Vietcombank', 'vietcombank.com.vn', '', 1],
    ['BIDV', 'bidv.com.vn', '', 1]
]);

const GLOBAL_FINANCE = makeSources('finance_global', [
    ['CNBC Markets', 'cnbc.com', 'https://www.cnbc.com/id/100003114/device/rss/rss.html', 1],
    ['MarketWatch', 'marketwatch.com', 'https://feeds.marketwatch.com/marketwatch/topstories/', 1],
    ['Financial Times', 'ft.com', 'https://www.ft.com/rss/home', 1.5],
    ['WSJ Markets', 'wsj.com', 'https://feeds.a.dj.com/rss/RSSMarketsMain.xml', 1.5],
    ['Bloomberg', 'bloomberg.com', '', 1.5],
    ['Reuters Business', 'reuters.com', '', 1.5],
    ['Forbes', 'forbes.com', '', 1],
    ['Fortune', 'fortune.com', 'https://fortune.com/feed/', 1],
    ['Business Insider', 'businessinsider.com', '', 1],
    ['New York Times Business', 'nytimes.com', 'https://rss.nytimes.com/services/xml/rss/nyt/Business.xml', 1.5],
    ['The Economist', 'economist.com', 'https://www.economist.com/finance-and-economics/rss.xml', 1.3],
    ['Barrons', 'barrons.com', '', 1.3],
    ['Yahoo Finance', 'finance.yahoo.com', '', 1],
    ['Investing.com', 'investing.com', 'https://www.investing.com/rss/news.rss', 1],
    ['Seeking Alpha', 'seekingalpha.com', '', 1],
    ['Morningstar', 'morningstar.com', '', 1],
    ['The Motley Fool', 'fool.com', 'https://www.fool.com/a/feeds/partner/google', 1],
    ['Kiplinger', 'kiplinger.com', 'https://www.kiplinger.com/feed/all', 1],
    ['Zacks', 'zacks.com', '', 1],
    ['Nasdaq', 'nasdaq.com', '', 1],
    ['Benzinga', 'benzinga.com', 'https://www.benzinga.com/feed', 1],
    ['CoinDesk', 'coindesk.com', 'https://www.coindesk.com/arc/outboundfeeds/rss/', 1],
    ['Cointelegraph', 'cointelegraph.com', 'https://cointelegraph.com/rss', 1],
    ['Decrypt', 'decrypt.co', 'https://decrypt.co/feed', 0.7],
    ['Blockworks', 'blockworks.co', 'https://blockworks.co/feed', 0.7],
    ['The Block', 'theblock.co', '', 1],
    ['US Federal Reserve', 'federalreserve.gov', 'https://www.federalreserve.gov/feeds/press_all.xml', 1.5],
    ['European Central Bank', 'ecb.europa.eu', 'https://www.ecb.europa.eu/rss/press.html', 1.5],
    ['International Monetary Fund', 'imf.org', '', 1.5],
    ['World Bank', 'worldbank.org', 'https://www.worldbank.org/en/news/all?format=rss', 1.5],
    ['Bank for International Settlements', 'bis.org', 'https://www.bis.org/doclist/all_pressrels.rss', 1],
    ['OECD', 'oecd.org', '', 1],
    ['Bank of England', 'bankofengland.co.uk', 'https://www.bankofengland.co.uk/rss/news', 1.5],
    ['Bank of Japan', 'boj.or.jp', 'https://www.boj.or.jp/en/rss/whatsnew.xml', 1.5],
    ['US SEC', 'sec.gov', 'https://www.sec.gov/news/pressreleases.rss', 1.5],
    ['US CFTC', 'cftc.gov', 'https://www.cftc.gov/PressRoom/PressReleases/rss', 1],
    ['US Energy Information Administration', 'eia.gov', 'https://www.eia.gov/rss/press_rss.xml', 1],
    ['S&P Global', 'spglobal.com', '', 1.3],
    ['Fitch Ratings', 'fitchratings.com', '', 1.3],
    ['Moodys', 'moodys.com', '', 1.3],
    ['MSCI', 'msci.com', '', 1],
    ['Asian Development Bank', 'adb.org', 'https://www.adb.org/rss/news-releases', 1],
    ['African Development Bank', 'afdb.org', '', 1],
    ['Nikkei Asia', 'asia.nikkei.com', '', 1],
    ['Asia Financial', 'asiafinancial.com', 'https://www.asiafinancial.com/feed', 1],
    ['SCMP Business', 'scmp.com', 'https://www.scmp.com/rss/92/feed', 1],
    ['Economic Times Markets', 'economictimes.indiatimes.com', 'https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms', 1],
    ['Moneycontrol', 'moneycontrol.com', 'https://www.moneycontrol.com/rss/latestnews.xml', 1],
    ['Mint', 'livemint.com', 'https://www.livemint.com/rss/markets', 1],
    ['Business Standard', 'business-standard.com', 'https://www.business-standard.com/rss/markets-106.rss', 1]
]);

const TECHNOLOGY = makeSources('tech', [
    // Vietnamese technology sources (25)
    ['GenK', 'genk.vn', 'https://genk.vn/rss/home.rss', 1],
    ['VnExpress Digital', 'vnexpress.net', 'https://vnexpress.net/rss/so-hoa.rss', 1.5],
    ['VietnamNet Technology', 'vietnamnet.vn', 'https://vietnamnet.vn/rss/cong-nghe.rss', 1.3],
    ['Tinhte', 'tinhte.vn', 'https://tinhte.vn/rss/', 1],
    ['TechZ', 'techz.vn', 'https://www.techz.vn/rss', 0.7],
    ['VnReview', 'vnreview.vn', 'https://vnreview.vn/feed', 1],
    ['The Gioi Di Dong News', 'thegioididong.com', 'https://www.thegioididong.com/tin-tuc/rss', 1],
    ['FPT Shop News', 'fptshop.com.vn', 'https://fptshop.com.vn/tin-tuc/rss', 1],
    ['Sforum', 'cellphones.com.vn', 'https://cellphones.com.vn/sforum/feed', 1],
    ['Hoang Ha Mobile News', 'hoanghamobile.com', 'https://hoanghamobile.com/tin-tuc/feed', 1],
    ['Di Dong Viet Dchannel', 'didongviet.vn', 'https://didongviet.vn/dchannel/feed/', 1],
    ['24H Technology', '24h.com.vn', 'https://www.24h.com.vn/upload/rss/congnghethongtin.rss', 0.7],
    ['Znews Technology', 'znews.vn', 'https://znews.vn/rss/cong-nghe.rss', 1],
    ['Tuoi Tre Digital', 'tuoitre.vn', 'https://tuoitre.vn/rss/nhip-song-so.rss', 1.5],
    ['Thanh Nien Technology', 'thanhnien.vn', 'https://thanhnien.vn/rss/cong-nghe.rss', 1.3],
    ['Dan Tri Technology', 'dantri.com.vn', 'https://dantri.com.vn/rss/cong-nghe.rss', 1.3],
    ['VTC Technology', 'vtcnews.vn', '', 1],
    ['VOV Technology', 'vov.vn', '', 1],
    ['Bao Tin Tuc Technology', 'baotintuc.vn', '', 1],
    ['GameK', 'gamek.vn', '', 1],
    ['Tap Chi Khoa Hoc Cong Nghe', 'vjst.vn', '', 1],
    ['VietnamPlus Technology', 'vietnamplus.vn', 'https://www.vietnamplus.vn/rss/home.rss', 1.3],
    ['CafeF Technology', 'cafef.vn', '', 1],
    ['Soha Technology', 'soha.vn', '', 1],
    ['Quan Tri Mang', 'quantrimang.com', '', 1],

    // Foreign technology sources (25)
    ['The Verge', 'theverge.com', 'https://www.theverge.com/rss/index.xml', 1],
    ['TechCrunch', 'techcrunch.com', 'https://techcrunch.com/feed/', 1],
    ['Ars Technica', 'arstechnica.com', 'https://feeds.arstechnica.com/arstechnica/index', 1.3],
    ['Wired', 'wired.com', 'https://www.wired.com/feed/rss', 1.3],
    ['Engadget', 'engadget.com', 'https://www.engadget.com/rss.xml', 1],
    ['Hacker News', 'news.ycombinator.com', 'https://hnrss.org/frontpage', 1],
    ['MIT Technology Review', 'technologyreview.com', 'https://www.technologyreview.com/feed/', 1.3],
    ['CNET', 'cnet.com', 'https://www.cnet.com/rss/news/', 1],
    ['ZDNET', 'zdnet.com', 'https://www.zdnet.com/news/rss.xml', 1],
    ['Gizmodo', 'gizmodo.com', 'https://gizmodo.com/rss', 1],
    ['Mashable Tech', 'mashable.com', 'https://mashable.com/feeds/rss/tech', 1],
    ['VentureBeat', 'venturebeat.com', 'https://venturebeat.com/feed/', 1],
    ['The Next Web', 'thenextweb.com', 'https://thenextweb.com/feed', 1],
    ['Digital Trends', 'digitaltrends.com', 'https://www.digitaltrends.com/feed/', 1],
    ['Toms Hardware', 'tomshardware.com', 'https://www.tomshardware.com/feeds/all', 1],
    ['PCMag', 'pcmag.com', 'https://www.pcmag.com/feeds/rss/latest', 1],
    ['PCWorld', 'pcworld.com', 'https://www.pcworld.com/feed', 1],
    ['BleepingComputer', 'bleepingcomputer.com', 'https://www.bleepingcomputer.com/feed/', 1],
    ['The Register', 'theregister.com', 'https://www.theregister.com/headlines.atom', 1],
    ['InfoWorld', 'infoworld.com', 'https://www.infoworld.com/index.rss', 1],
    ['IEEE Spectrum', 'spectrum.ieee.org', 'https://spectrum.ieee.org/feeds/feed.rss', 1],
    ['TechRadar', 'techradar.com', 'https://www.techradar.com/feeds.xml', 1],
    ['Krebs on Security', 'krebsonsecurity.com', 'https://krebsonsecurity.com/feed/', 1],
    ['OpenAI News', 'openai.com', 'https://openai.com/news/rss.xml', 1],
    ['Google AI Blog', 'blog.google', 'https://blog.google/technology/ai/rss/', 1],
    // Lower-ranked, curated discovery candidates. They are never enabled
    // automatically and stay below the built-in 50-source Technology set.
    ['VietTimes Technology', 'viettimes.vn', '', 1, 'vietnam'],
    ['ICT Vietnam', 'ictvietnam.vn', '', 1, 'vietnam'],
    ['VnMedia Technology', 'vnmedia.vn', '', 1, 'vietnam'],
    ['GameK Technology', 'gamek.vn', 'https://gamek.vn/rss/home.rss', 1, 'vietnam'],
    ['Bao Dau Tu Technology', 'baodautu.vn', '', 1, 'vietnam'],
    ['VietnamPlus Technology', 'vietnamplus.vn', 'https://www.vietnamplus.vn/rss/home.rss', 1.3, 'vietnam'],
    ['VOV Technology', 'vov.vn', '', 1, 'vietnam'],
    ['Dan Tri Technology', 'dantri.com.vn', 'https://dantri.com.vn/rss/cong-nghe.rss', 1.3, 'vietnam'],
    ['Tuoi Tre Technology', 'tuoitre.vn', 'https://tuoitre.vn/home.rss', 1.5, 'vietnam'],
    ['Thanh Nien Technology', 'thanhnien.vn', 'https://thanhnien.vn/rss/cong-nghe-game.rss', 1.3, 'vietnam'],
    ['9to5Google', '9to5google.com', 'https://9to5google.com/feed/', 1, 'foreign'],
    ['MacRumors', 'macrumors.com', 'https://www.macrumors.com/macrumors.xml', 1, 'foreign'],
    ['Android Authority', 'androidauthority.com', 'https://www.androidauthority.com/feed/', 1, 'foreign'],
    ['Windows Central', 'windowscentral.com', 'https://www.windowscentral.com/rss.xml', 1, 'foreign'],
    ['Phoronix', 'phoronix.com', 'https://www.phoronix.com/rss.php', 1, 'foreign'],
    ['Notebookcheck', 'notebookcheck.net', 'https://www.notebookcheck.net/Notebookcheck.8156.0.html?type=100', 1, 'foreign'],
    ['Slashdot', 'slashdot.org', 'http://rss.slashdot.org/Slashdot/slashdotMain', 1, 'foreign'],
    ['9to5Mac', '9to5mac.com', 'https://9to5mac.com/feed/', 1, 'foreign'],
    ['ServeTheHome', 'servethehome.com', 'https://www.servethehome.com/feed/', 1, 'foreign'],
    ['SiliconANGLE', 'siliconangle.com', 'https://siliconangle.com/feed/', 1, 'foreign']
], 50);

// Sources explicitly requested for the Smart sections. They stay part of the
// built-in set so restoring defaults never loses them; existing stored user
// choices still win when a source has already been enabled or disabled.
const REQUESTED_VIETNAM_NEWS = makeSources('news_vietnam', [
    ['VTV News', 'vtv.vn', 'https://vtv.vn/rss/home.rss', 1.3],
    ['Bao Giao Thong', 'baogiaothong.vn', '', 1],
    ['Bao Xay Dung', 'baoxaydung.com.vn', '', 1],
    ['Dan Viet', 'danviet.vn', '', 1],
    ['Vietnam News', 'vietnamnews.vn', '', 1],
    ['To Quoc', 'toquoc.vn', googleNewsRss('toquoc.vn', '', 'vietnam', 90), 1.04],
    ['Phu Nu TP.HCM', 'phunuonline.com.vn', '', 1]
]);

const REQUESTED_WORLD_NEWS = makeSources('news_world', [
    ['The Washington Post', 'washingtonpost.com', '', 1.5],
    ['The Independent', 'independent.co.uk', 'https://www.independent.co.uk/news/world/rss', 1],
    ['The Telegraph World', 'telegraph.co.uk', '', 1],
    ['Foreign Policy', 'foreignpolicy.com', '', 1],
    ['The Atlantic', 'theatlantic.com', '', 1],
    ['Times of India World', 'timesofindia.indiatimes.com', 'https://timesofindia.indiatimes.com/rssfeeds/296589292.cms', 1],
    ['Sky News World', 'news.sky.com', 'https://feeds.skynews.com/feeds/rss/world.xml', 1],
    ['The Globe and Mail', 'theglobeandmail.com', '', 1],
    ['Sydney Morning Herald', 'smh.com.au', '', 1]
]);

const REQUESTED_VIETNAM_FINANCE = makeSources('finance_vietnam', [
    ['Tap Chi Tai Chinh', 'tapchikinhtetaichinh.vn', googleNewsRss('tapchikinhtetaichinh.vn', '', 'vietnam', 30), 1.06],
    ['The Saigon Times', 'thesaigontimes.vn', '', 1],
    ['Vietnam Finance', 'vietnamfinance.vn', '', 1],
    ['Kinh Te Do Thi', 'kinhtedothi.vn', googleNewsRss('kinhtedothi.vn', '', 'vietnam', 30), 1.03],
    ['Thuong Gia', 'thuonggiaonline.vn', 'https://thuonggiaonline.vn/rss/home.rss', 1],
    ['Nguoi Quan Sat', 'nguoiquansat.vn', '', 1],
    ['Doanh Nhan Sai Gon', 'doanhnhansaigon.vn', googleNewsRss('doanhnhansaigon.vn', 'finance_vietnam', 'vietnam', 30), 1.04],
    // ['Vietnam Business Forum', 'vccinews.com', googleNewsRss('vccinews.com', '', 'vietnam', 90), 1.05], // Disabled: Google News query returns 0 items / invalid RSS
    ['Tap Chi Ngan Hang', 'tapchinganhang.gov.vn', '', 1],
    ['Hai Quan Online', 'haiquanonline.com.vn', googleNewsRss('haiquanonline.com.vn', '', 'vietnam', 365), 1.06],
    ['Nha Dau Tu', 'nhadautu.vn', '', 1],
    ['SSI Insights', 'ssi.com.vn', '', 1],
    ['VNDirect News', 'vndirect.com.vn', '', 1],
    ['Dien Dan Doanh Nghiep', 'diendandoanhnghiep.vn', '', 1],
    ['Kinh Te Moi Truong', 'kinhtemoitruong.vn', '', 1]
]);

const REQUESTED_GLOBAL_FINANCE = makeSources('finance_global', [
    ['Nikkei Asia', 'asia.nikkei.com', '', 1],
    ['Caixin Global', 'caixinglobal.com', '', 1],
    ['SCMP Business', 'scmp.com', 'https://www.scmp.com/rss/92/feed', 1],
    ['The Edge Malaysia', 'theedgemalaysia.com', '', 1],
    ['Channel NewsAsia Business', 'channelnewsasia.com', '', 1],
    ['Investopedia', 'investopedia.com', '', 1],
    ['Harvard Business Review', 'hbr.org', '', 1],
    ['ZeroHedge', 'zerohedge.com', '', 0.7],
    ['TheStreet', 'thestreet.com', '', 0.7]
]);

const REQUESTED_TECH = makeSources('tech', [
    ['Stratechery', 'stratechery.com', 'https://stratechery.com/feed/', 1, 'foreign'],
    ['GeekWire', 'geekwire.com', 'https://www.geekwire.com/feed/', 1, 'foreign'],
    ['GigaOM', 'gigaom.com', googleNewsRss('gigaom.com', 'tech', 'foreign', 30), 1.03, 'foreign'],
    ['Futurism', 'futurism.com', 'https://futurism.com/feed', 1, 'foreign'],
    ['Techmeme', 'techmeme.com', 'https://www.techmeme.com/feed.xml', 1, 'foreign'],
    ['TLDR Newsletter', 'tldr.tech', 'https://tldr.tech/api/rss/tech', 1, 'foreign']
]);

export const SMART_REQUESTED_SOURCE_ADDITIONS = [
    ...REQUESTED_VIETNAM_NEWS,
    ...REQUESTED_WORLD_NEWS,
    ...REQUESTED_VIETNAM_FINANCE,
    ...REQUESTED_GLOBAL_FINANCE,
    ...REQUESTED_TECH
];

export const SMART_SOURCES = [
    ...VIETNAM_NEWS,
    ...WORLD_NEWS,
    ...VIETNAM_FINANCE,
    ...GLOBAL_FINANCE,
    ...TECHNOLOGY,
    ...SMART_REQUESTED_SOURCE_ADDITIONS
];

export const SMART_SOURCE_COUNTS = {
    news_vietnam: VIETNAM_NEWS.length + REQUESTED_VIETNAM_NEWS.length,
    news_world: WORLD_NEWS.length + REQUESTED_WORLD_NEWS.length,
    finance_vietnam: VIETNAM_FINANCE.length + REQUESTED_VIETNAM_FINANCE.length,
    finance_global: GLOBAL_FINANCE.length + REQUESTED_GLOBAL_FINANCE.length,
    tech: TECHNOLOGY.length + REQUESTED_TECH.length
};

export const SMART_SOURCE_DISCOVERY_POOL = DISCOVERY_SOURCES;
