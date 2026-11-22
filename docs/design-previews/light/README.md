# Light workspace previews

Two interactive concepts based on the supplied pastel workspace reference:

- [Top navigation](http://localhost:3132/?layout=top)
- [Sidebar](http://localhost:3132/?layout=sidebar)

Both use the same Emeter example dashboard. The comparison control switches layouts. Service navigation, search, example JSON validation, policy toggles, receipt inspection, and the sample session form are interactive. No wallet, backend, paid service, or onchain evaluation is connected.

The source is in `apps/web/public/design-preview/`. `index.html` uses a self-contained stylesheet/script, a local copy of the project's Geist font, and authored SVG icons. The supplied image was used as a visual reference and is not embedded.

The user selected the sidebar on 22 November 2026. These original example previews remain the comparison reference; the actual application uses real gateway and wallet records.

Desktop (1440px) and phone (390px) captures: `top-desktop.png`, `sidebar-desktop.png`, `top-mobile.png`, and `sidebar-mobile.png`. `checks.json` records rendering, navigation, sample form/receipt flows, search, JSON validation, policy behavior, layout switching, document overflow, and the absence of runtime errors or external requests.

To restart the static preview server:

```sh
rtk proxy python3 -m http.server 3132 --bind 0.0.0.0 --directory apps/web/public/design-preview
```
