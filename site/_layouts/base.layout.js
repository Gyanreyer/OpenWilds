import { html, css, js } from 'yeti-js';

/**
 * @import { YetiComponent } from 'yeti-js';
 * @type {YetiComponent<{
 *  title?: string,
 *  description?: string,
 * }>}
 */
export const BaseLayout = ({ title = "OpenWilds", description = "An open-source database of plants native to North America.", children }) => {
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
      <script src="${js.src("*")}" type="module" async></script>
      <link rel="stylesheet" href="${css.src("*")}" />
    </head>
    <body>
      ${children}
    </body>
  </html>`;
}

BaseLayout.css = css`
  ${css.import("./reset.css")}
`;
