import { css } from "#site-lib/css.js";
import { html } from "#site-lib/html.js";

export default function BaseLayout({ title = "OpenWilds", description = "OpenWilds Plant Database", children }) {
  return html`
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />

      <title>${title}</title>
      <meta property="og:title" content="${title}" />

      <meta name="description" content="${description}" />
      <meta property="og:description" content="${description}" />

      <link rel="icon" type="image/png" href="/img/favicon.png" />

      <meta name="generator" content="Eleventy v3.1.2" />
      <meta property="og:type" content="website" />
    </head>
    <body>
      ${children}
    </body>
  </html>`;
}

BaseLayout.css = css`
  :root {
    font-family: system-ui, sans-serif;
  }

  *, *:before, *:after {
    box-sizing: border-box;
  }
`;
