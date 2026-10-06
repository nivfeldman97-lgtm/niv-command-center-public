# PWA and mobile

The manifest names the application **Niv Command Center** and uses local NC monogram icons (192, 512 and Apple touch 180 pixels). The original SVG and regeneration script are included. No remote fonts or artwork are required.

## Install

Serve the production build at the root of an HTTPS domain. In a supported desktop/Android browser, use the install action. On iPhone/iPad, open Safari and choose **Share > Add to Home Screen**. Sign in inside the installed application; browser and standalone sessions can be separate.

The interface supports desktop, phone and tablet widths. Wide calendar/Gantt content scrolls inside its panel. Verify touch interactions on your own target devices. Allow Microsoft authentication popups where required, especially Safari/iOS/iPadOS.

## Cache policy

This is an installable, **network-required** application. The service worker precaches only local icons, the neutral gradient and the generated manifest. It does not cache HTML, JavaScript, authentication, Graph calls, Supabase calls or dashboard records. There is no offline application-shell fallback. Supabase's browser login session is separate from service-worker caches.

The callback page does not register a service worker. `vercel.json` sets no-store/no-cache headers for the service worker and callback and no-cache for the manifest. Preserve equivalent headers on other hosts. Service-worker updates activate automatically and remove outdated precaches.

## Verify and regenerate icons

Follow [TESTING.md](TESTING.md) and run `npm run test:pwa`. It builds with synthetic configuration, checks manifest/icon dimensions, login semantics, callback behavior and cache boundaries, then verifies that only decorative assets remain available offline.

After installing the local Playwright Chromium binary, run `node scripts/generate-icons.mjs` to regenerate PNG icons from `public/icons/icon.svg`. The script creates a separate headless browser, never your normal browser profile.

Automated viewport tests are not a substitute for final installation and popup checks on physical iPhone/iPad hardware.
