const html = `<div>
		<a href="https://tuoitre.vn/tai-xe-o-to-un-canh-sat-giao-thong-de-bo-chay-o-ha-noi-la-ai-100260721121827304.htm"
			class="link link--external"
			target="_blank"
			rel="nofollow ugc noopener"
			data-proxy-href="/proxy.php?link=https%3A%2F%2Ftuoitre.vn%2Ftai-xe-o-to-un-canh-sat-giao-thong-de-bo-chay-o-ha-noi-la-ai-100260721121827304.htm&amp;hash=1024ba1945742e7a7ab31e375c9303f6">
			https://tuoitre.vn/tai-xe-o-to-un-canh-sat-giao-thong-de-bo-chay-o-ha-noi-la-ai-100260721121827304.htm
		</a>
	</div></div>`;
console.log("Match:", html.match(/<a[^>]+href=["'](https?:\/\/[^"']+)["'][^>]*>[\s\S]*?<\/a>/ig));
