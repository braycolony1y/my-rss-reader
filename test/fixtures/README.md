# Test fixtures

Store stable inputs used by automated tests in this directory. Put generated outputs in `test/fixtures/generated/`; that directory is ignored and should be emptied after debugging.

- `ground-live.html`: direct public HTTP response from https://ground.news/ saved
  on 2026-09-06. Used for Ground News Flight/RSC parsing regression tests. This
  is a live-captured replacement; no separate user-uploaded `ground.html` was available.
- `ground-story.html`: direct Ground News article response saved on 2026-09-06;
  regression fixture for the 49-article coverage panel (Left 7, Center 8, Right 11).
- `ground-story-perspectives.html`: refreshed article response on 2026-09-06,
  including all three Ground summaries, bias comparison, and publisher icons.
- `tienphong-1874068.html`: direct publisher response captured on 2026-09-06
  for the Lưu Văn article; tests prevent substituting a related Greenland card.
- `vnexpress-missing-5117107.html`: VnExpress's live 404 response captured on
  2026-09-06, including the misleading generic site title and recommendations.
