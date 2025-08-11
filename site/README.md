# OpenWilds Site

This is a static site built with 11ty which will take all database entries and generate HTML pages for them.

This site is built using a semi-experimental homegrown template setup, so I will enumerate usage details below:

- All pages are rendered from `.page.js` files. 11ty will use file-based routing, so
  a file at `/site/hello.page.js` will produce a page at `openwilds.org/hello`,
  and `/site/my/path.page.js` will produce a page at `openwilds.org/my/path`
- HTML templating uses [`htm`](https://github.com/developit/htm) tagged template strings, with a custom plugin to support CSS bundling.

## Example component

```js
import { getScopedComponentID } from "../_lib/scid.js";
import { html } from "../_lib/html.js";

const scid = getScopedComponentID();

export function SayHello({ name }) {
  return html`<div data-scid=${scid}>
    <h2>Hello, ${name}!</h2>
    <p>Welcome to OpenWilds.</p>
  </div>
  <style data-bundle="SayHello">
    [data-scid="${scid}"] {
      h2 {
        color: red;
      }
      p {
        font-style: italic;
      }
    }
  </style>`;
}
```

## Nested Components

HTM allows you to render nested components using the following syntax:

```js
import { html } from "./_lib/html.js";

import Base from "./_layouts/base.js";
import { SayHello } from "./_components/SayHello.component.js";

export default function IndexPage({ ...data }) {
  return html`<${Base}>
    <main>
      <h1>OpenWilds</h1>
      <${SayHello} name="Ryan" />
    </main>
  <//>`;
}
```

Component tags should either self-close or use a `<//>` closing tag.
Any attributes set on a component tag will be passed as props to that component.

## Styling

Any style tags encountered in HTML templates will be extracted and bundled into CSS files.
There are a couple things you can do to influence how this behaves:

### Opting out of bundling

You can set `data-inline` on a `<style>` tag to leave it un-processed in the HTML.

### Bundle names

By default, all styles will be rolled into the `default` bundle. However, this default bundle may end up including component styles which
are not shared between every page, so you can also specify bundle names to get finer-grained CSS bundling.

If you set `data-bundle="<BUNDLE NAME>"` on a `<style>` tag, its contents will be bundled into a CSS file with that name.

These bundles are included by appending a `<link rel="stylesheet">` tag to the page's `<head>` for each bundle file.
A bundle will only be included on a page if the page contains at least one component with styles from that bundle.

For example, the `SayHello` component from the example above has a style tag like this:

```html
<style data-bundle="SayHello">
  [data-scid="${scid}"] {
    h2 {
      color: red;
    }
    p {
      font-style: italic;
    }
  }
</style>
```

This will produce a bundle at `/css/SayHello.css`. Any pages which render this `SayHello` component will
automatically add the `SayHello` bundle to the `<head>`.

Let's review the expected output from the following `index.page.js` file...

```js
import { html } from "./_lib/html.js";

import Base from "./_layouts/base.js";
import { SayHello } from "./_components/SayHello.component.js";

export default function IndexPage({ ...data }) {
  return html`<html>
    <head></head>
    <body>
      <main>
        <h1>OpenWilds</h1>
        <${SayHello} name="Ryan" />
      </main>
      <!-- Default bucket styles -->
      <style>
        h1 {
          color: blue;
        }
      </style>
    </body>
  </html>
`;
}
```

**/css/default.css**

```css
h1 {
  color: blue;
}
```

**/css/SayHello.css**

```css
[data-scid="0"] h2 {
  color: red;
}
[data-scid="0"] p {
  font-style: italic;
}
```

**/index.html**

```html
<html>
  <head>
    <link rel="stylesheet" href="/css/default.css">
    <link rel="stylesheet" href="/css/SayHello.css">
  </head>
  <body>
    <main>
      <h1>OpenWilds</h1>
      <div data-scid="0">
        <h2>Hello, Ryan!</h2>
        <p>Welcome to OpenWilds.</p>
      </div>
    </main>
  </body>
</html>
```

### Scoped styles

We have access to a `getScopedComponentID` util which can be used as a rudimentary way to scope styles within a component.
The util can be used to generate a unique ID for the component which can be used in HTML attributes and referenced to scope CSS selectors.
The easiest way to accomplish this is to use CSS nesting syntax to wrap all scoped styles inside a selector for the component ID attribute.
The example `SayHello` component shown earlier includes a good example of recommended usage of this util.
