# Reviewer notes — version 0.14.2

This is a Firefox desktop, Manifest V2 extension. No remote code or analytics.

Permissions:
- storage: local feature switches, card locks and Full Art preferences/images.
- unlimitedStorage: multiple local card images, including previously saved originals. New imports are limited (8 MiB input, 32 MP decoded, longest side 1200 px, WebP quality 0.85, capped encoded output). No image upload is performed by the extension.
- webRequest/webRequestBlocking and WikiMasters host access: observe the native collection response with filterResponseData, forwarding every original byte unchanged, and cancel recognized selling/discarding requests involving locked cards. No extra collection, price or wishlist fetches are initiated.
- The Supabase host is used only to observe the result of the site's native user_card_tags requests for batch labels. The extension does not read tokens or create a separate authenticated client.

Storage failure: unrelated writes pass through. Recognized destructive card operations are held while lock state is unknown, with a visible warning; a successfully loaded OFF preference disables protection. Existing local settings keep their keys and the ID is now wikitools@wikimasters-local.invalid for the new WikiTools distribution; no automatic cross-extension data migration is implemented.

UI: all Full Art controls use createElement and text nodes. Per-card titles are never interpreted as HTML. One shared child/text DOM observer supports the menu, Full Art and router setup; lock/label observers remain for native state changes. A single 1-second check compares route/router identities without traversing the DOM, and skips hidden documents. This covers SPA navigation and showcase/profile cards.

Verification: 52 Node tests; isolated Chromium fixture covering menu, direct selection, halo, real image decode/compression and global ON/OFF. This is not a real-site Firefox acceptance test.

Known validation warnings: minimum Firefox 115 predates data_collection_permissions (desktop 140 / Android 142). The minimum-version declarations remain unchanged. The new title, description and ID are set for WikiTools; the supplied 128 px PNG icon is included.

No iPhone/userscript files are packaged or modified.
