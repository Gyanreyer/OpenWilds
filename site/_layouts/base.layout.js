import { html } from "../_lib/html.js";

export default function ({ children }) {
  return html`<html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />

      <title @html="title"></title>
      <meta name="description" :content="description" />
      <link rel="icon" type="image/png" href="/img/favicon.png" />

      <meta name="generator" :content="eleventy.generator" />

      <meta property="og:type" content="website" />
      <meta property="og:title" :content="title" />
      <meta property="og:description" :content="description" />
    </head>
    <body>
      ${children}
      <style>
        :root {
          font-family: system-ui, sans-serif;
        }

        *, *:before, *:after {
          box-sizing: border-box;
        }
      </style>
    </body>
  </html>`;
}
