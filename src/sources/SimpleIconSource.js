const icons = {
    'tuoitre.vn': 'https://statictuoitre.mediacdn.vn/web_images/favicon.ico',
    'kenh14.vn': 'https://kenh14cdn.com/web_images/kenh14-favicon.ico',
    'soha.vn': 'https://sohanews.sohacdn.com/icons/soha-32.png',
    'genk.vn': 'https://genk.mediacdn.vn/web_images/genk32.png',
    'vjst.vn': 'https://ictv.1cdn.vn/assets/static/images/logo.png',
    'vtv.vn': 'https://static.mediacdn.vn/vtv.vn/images/favicon.ico',
    'doanhnhansaigon.vn': 'https://dnsg.1cdn.vn/assets/images/favicon.ico',
    'tapchinganhang.gov.vn': 'https://tapchinganhang.gov.vn/modules/frontend/themes/tcnh/images/favicon/favicon.ico?v=2.620251216214508',
    'vccinews.': 'https://vccinews.com/images/logo.png', // Using includes('vccinews.')
    'haiquanonline.com.vn': 'https://www.google.com/s2/favicons?domain=customs.gov.vn&sz=64',
    'pcworld.com': 'https://icons.duckduckgo.com/ip3/pcworld.com.ico'
};

export default class SimpleIconSource {
    match(hostname) {
        return Object.keys(icons).some(k => hostname.includes(k));
    }

    publisherIcon(hostname) {
        const key = Object.keys(icons).find(k => hostname.includes(k));
        return key ? icons[key] : null;
    }
}
