import re

html = """<div class="box-category wrap-player-popcast animated animatedFadeInUp fadeInUp">
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
                            <div id="0-0_fpTimeline" class="afp-timeline" style="display: block;">
                                <div id="0-0_fpBuffer" class="afp-buffer" style="width: 24.6634%;"></div>
                                <div id="0-0_playCurrent" class="afp-current"><span class="afp-node"></span></div>
                                <div id="fpTooltipTime" style="position: absolute;bottom: 10px;left: 0;display: none;">00:00</div>
                            </div>
                            <div class="time-count-number">
                                <span id="0-0_fpPosition" class="afp-duration afp-position" style="display: block;">00:00</span><span id="0-0_fpSlash" class="afp-slash">/</span><span id="0-0_fpDuration" class="afp-duration" style="display: block;">09:18</span>
                            </div>
                        </div>
                        <div class="control-audio-bar">
                            <span id="0-0_groupRight" class="afp-group-right">
                                <span id="0-0_fpVolumeContainer" class="afp-volume-container" style="display: block;">
                                    <span class="afp-sound" id="0-0_muteBtn" style="float: left;"><button class="afp-button afp-sound-level-2" id="fpVolDownBtn" tabindex="-1">&nbsp;</button></span>
                                    <span id="0-0_fpVolumeSlide" class="afp-volume-slide">
                                        <div id="0-0_fpVolumebar" class="afp-volume-bar">
                                            <div id="0-0_volumeCurrent" class="afp-volume-current" style="width: 75%;"><span class="afp-volume-node"></span></div>
                                        </div>
                                    </span>
                                    <span class="afp-sound afp-sound-max" style="float: left;"><button class="afp-button afp-sound-level-max" id="fpVolUpBtn" tabindex="-1">&nbsp;</button></span>
                                </span>
                            </span>
							
                            <div class="three-button-control">
                                <span class="afp-button-2" id="0-0_back10sBtn"><button class="afp-back10sbtn" tabindex="-1">&nbsp;</button></span>
                                <span class="afp-play" id="0-0_playPauseBtn"><button class="afp-button afp-playbtn" tabindex="-1">&nbsp;</button></span>
                                <span class="afp-button-2" id="0-0_next10sBtn"><button class="afp-next10sbtn" tabindex="-1">&nbsp;</button></span>
                            </div>
                            <span id="0-0_fpPlaybackRateContainer" class="afp-playback-rate-container">
                                <span class="txt-rate">Tốc độ phát&nbsp;</span>
                                <span id="0-0_fpPlaybackRate" class="afp-playback-rate" data-rate="1.00">1x</span>
                            </span>
                        </div>
						<span class="author-in-player"></span>
                    </span>
                </div>
            </span>
        </div></div>
            
                                <div class="afp-acontainer" id="0-0_aContainer" style="position: absolute; top: 0px; left: 0px; width: 1px; height: 1px; display: none; opacity: 0;"></div><div class="afp-intro" id="0-0_aIntroContainer" style="position:absolute;top:0;left:0;width:1px;height:1px;display:block;opacity:0;"><audio id="0-0_aIntroTag" src="https://s1.vnecdn.net/vnexpress/restruct/j/v9220/podcast/voice/11.mp3" type="audio/mpeg"></audio></div></div>
                            </div>
                    </div>
                </div>"""

popcastBlocks = re.finditer(r'<div\b[^>]*class=["\'][^"\']*wrap-player-popcast[^"\']*["\'][^>]*>([\s\S]*?)<\/audio>', html, re.IGNORECASE)
for blockMatch in popcastBlocks:
    blockInner = blockMatch.group(1)
    audioMatch = re.search(r'<audio\b[^>]*src=["\']([^"\']+)["\']', blockInner, re.IGNORECASE)
    titleMatch = re.search(r'<span\b[^>]*class=["\']text["\'][^>]*>\s*<a\b[^>]*>([\s\S]*?)<\/a>', blockInner, re.IGNORECASE)
    imgMatch = re.search(r'<img\b[^>]*src=["\']([^"\']+)["\']', blockInner, re.IGNORECASE)
    print("Audio Match:", bool(audioMatch))
    print("Title Match:", bool(titleMatch))
    print("Img Match:", bool(imgMatch))
