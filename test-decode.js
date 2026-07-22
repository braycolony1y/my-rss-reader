import pkg from 'google-news-url-decoder';
const { GoogleDecoder } = pkg;
const decoder = new GoogleDecoder();
const url = "https://news.google.com/rss/articles/CBMipwFBVV95cUxQZjdrQm1ldk9kakRkSzdXcnhCOEIwUm1HX0JFVWVWRHBlaE5WdGl6ckZOTVMyMDlidFRUY0hwU3RqYjRfVFBzVlp4NnlrUTljTktvNzZ3djVvbUxtTjRmMjNnTHJBUlJtSEdmVF8yeERPUEFMM3JRZk0ya0lSUkQ5bWlsVWIzbDlROVIyYy1SeWwxUjJ3MTB1OVFOelhVUW9zU0ZvcmZ1aw?oc=5";
decoder.decode(url).then(res => console.log(res)).catch(console.error);
