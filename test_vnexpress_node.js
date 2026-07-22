import VnexpressSource from './src/sources/VnexpressSource.js';
import fs from 'fs';

const html = `
<article class="fck_detail">
<p>Some content</p>
</article>
<div class="box-category wrap-player-popcast animated animatedFadeInUp fadeInUp">
                        <div class="thumb-art">
                                <a href="https://vnexpress.net/hiem-hoa-tu-cuoc-dau-my-iran-gianh-quyen-kiem-soat-hormuz-5098638.html" class="thumb thumb-1x1" title="Hiểm họa từ cuộc đấu Mỹ - Iran giành quyền kiểm soát Hormuz" data-itm-source="#vn_source=Detail-TheGioi_QuanSu-5098778&amp;vn_campaign=Box-InternalLink&amp;vn_medium=Link-&amp;vn_term=Desktop&amp;vn_thumb=0" data-itm-added="1">
                                    <img src="https://i1-vnexpress.vnecdn.net/2026/07/17/Artcover1x1-1784277559-1714-1784277639.jpg?w=180&amp;h=180&amp;q=100&amp;dpr=2&amp;fit=crop&amp;s=Om18uyjcw6QKKiPP_GOXyQ" alt="Hiểm họa từ cuộc đấu Mỹ - Iran giành quyền kiểm soát Hormuz">
                                </a>
                            </div>
                        <div class="player-popcast-v2">
                            <div class="header-title">
                                <div class="inner-header-title">
                                    <span class="label"><a href="/vne-go/podcast/gai-so-d" title="Gài số D">Gài số D</a></span>
                                    <div class="item_mq marquee_js" id="mq_0-0" style="overflow: hidden;"><div style="white-space: nowrap; position: relative; transform: translateX(0px);">
                                        <span class="text"><a href="https://vnexpress.net/hiem-hoa-tu-cuoc-dau-my-iran-gianh-quyen-kiem-soat-hormuz-5098638.html" data-itm-source="#vn_source=Detail-TheGioi_QuanSu-5098778&amp;vn_campaign=Box-InternalLink&amp;vn_medium=Link-HiemHoaTuCuocDauMyIranGianhQuyenKiemSoatHormuz&amp;vn_term=Desktop&amp;vn_thumb=0" data-itm-added="1">Hiểm họa từ cuộc đấu Mỹ - Iran giành quyền kiểm soát Hormuz</a></span>
                                    </div></div>
                                </div>
                            </div>
                            <div class="podcast_height mb15">
                                <div class="width_common afp-player-parent-top" style="position: relative;">
                                    
                <div id="podcast_0-0" class="audioContainter afp-container" style="display: block;">
                    <audio id="0-0" src="https://audio.vnecdn.net/vnexpress/video/audio/2026/07/17/hiem-hoa-tu-cuoc-dau-my-iran-gianh-quyen-kiem-soat-hormuz-1784277640.mp3" type="audio/mpeg" preload="auto" adsconfig="{&quot;adlist&quot;:[]}" playlist="[{&quot;author&quot;:&quot;&quot;,&quot;duration&quot;:558,&quot;src&quot;:&quot;https://audio.vnecdn.net/vnexpress/video/audio/2026/07/17/hiem-hoa-tu-cuoc-dau-my-iran-gianh-quyen-kiem-soat-hormuz-1784277640.mp3&quot;,&quot;type&quot;:&quot;audio/mpeg&quot;,&quot;thumbnail&quot;:&quot;https://i1-vnexpress.vnecdn.net/2026/07/17/Artcover1x1-1784277559-1714-1784277639.jpg?w=180&amp;h=180&amp;q=100&amp;dpr=2&amp;fit=crop&amp;s=Om18uyjcw6QKKiPP_GOXyQ&quot;}]" data-tracking="{&quot;event&quot;:&quot;podcastPlayerEvent&quot;,&quot;player_action&quot;:&quot;&quot;,&quot;title&quot;:&quot;Hiểm họa từ cuộc đấu Mỹ - Iran giành quyền kiểm soát Hormuz&quot;,&quot;Video_category&quot;:1006840,&quot;Video_Sub_category_ID&quot;:0,&quot;Video_Sub_category_name&quot;:&quot;Gài số D&quot;,&quot;VideoID&quot;:5098638,&quot;videoUrl&quot;:&quot;https://audio.vnecdn.net/vnexpress/video/audio/2026/07/17/hiem-hoa-tu-cuoc-dau-my-iran-gianh-quyen-kiem-soat-hormuz-1784277640.mp3&quot;,&quot;VideoType&quot;:&quot;Full&quot;,&quot;videoLicense&quot;:&quot;License&quot;,&quot;videoDuration&quot;:558}" style="opacity: 1; display: block;" jm_neat="1173240833">can not support type!!!</audio>
                <div class="afp-controlbar-container hover" id="0-0_controlBar" style="display: block;">
            <span id="0-0_controlbar" class="afp-controlbar">
                <div class="afp-group-top">
                    <span class="afp-group-center" id="0-0_group-center" style="width:100%;">
                        <div class="duration-bar">
...
`;

const source = new VnexpressSource();
const result = {};
const output = source.parseArticleHtmlContent(html, "https://vnexpress.net/abc", result, {});

console.log(output);
