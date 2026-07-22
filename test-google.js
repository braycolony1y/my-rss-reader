const url = "https://news.google.com/rss/articles/CBMipwFBVV95cUxQZjdrQm1ldk9kakRkSzdXcnhCOEIwUm1HX0JFVWVWRHBlaE5WdGl6ckZOTVMyMDlidFRUY0hwU3RqYjRfVFBzVlp4NnlrUTljTktvNzZ3djVvbUxtTjRmMjNnTHJBUlJtSEdmVF8yeERPUEFMM3JRZk0ya0lSUkQ5bWlsVWIzbDlROVIyYy1SeWwxUjJ3MTB1OVFOelhVUW9zU0ZvcmZ1aw?oc=5";
fetch(url).then(res => {
  console.log(res.url);
  return res.text();
}).then(text => {
  const match = text.match(/<a[^>]+href="([^"]+)"/i);
  console.log("Found match:", match ? match[1] : "None");
});
