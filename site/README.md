# OpenWilds Site

This is a static site built with 11ty which will take all database entries and generate HTML pages for them.

This site is built using a semi-experimental homegrown template setup, so I will enumerate usage details below:

- All pages are rendered from `.page.js` files. 11ty will use file-based routing, so
  a file at `/site/hello.page.js` will produce a page at `openwilds.org/hello`,
  and `/site/my/path.page.js` will produce a page at `openwilds.org/my/path`
- HTML templating uses [`htm`](https://github.com/developit/htm) tagged template strings, with a custom plugin to support CSS bundling.
- Files in the `/public` directory will be directly copied to the output, ie `/public/js/my-script.js` -> `openwilds.org/js/my-script.js`

## Example component

```js
import { html } from "../_lib/html.js";

export function SayHello({ name }) {
  return html`<div data-scid=${scid}>
    <h2>Hello, ${name}!</h2>
    <p>Welcome to OpenWilds.</p>
  </div>`;
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

Styles can be attached to components using the `css` tagged template literal function.
When a component is rendered, we will gather the attached styles, bundle them into CSS files, and automatically add appropriate `<link rel="stylesheet">` tags
to the page to load them.

```js
import { css } from '#site-lib/css.js';

export function SayHello(){
  return html`<h1>Hello in red!</h1>`;
}

SayHello.css = css`
  h1 {
    color: red;
  }
`;
```

### Bundling

By default, all styles will be rolled into the `default` bundle. However, this default bundle may end up including component styles which
are not shared between every page, so you can also specify finer-grained bundles in your CSS.

To designate where CSS should be bundled, simply import the `bundle` function and
call it with your desired bundle name, embedded in the tagged CSS string; from there, any content which follows that bundle marker will be placed in the specified bundle.

For example, if we want the `SayHello` component's styles to be bundled in the "plant" bundle instead of "default", we can do this:

```js
import { bundle } from "#site-lib/bundle.js";

SayHello.css = css`
  ${bundle("plant")}
  h1 {
    color: red;
  }
`;
```

You can even mix and match bundles if you want for some reason:

```js
SayHello.css = css`
  /** This will go to the default bundle */
  h1 {
    color: red;
  }

  ${bundle("plant")}
  h1 {
    /** Override the default style with green in the plant bundle */
    color: green !important;
  }
`;
```

NOTE: the underlying implementation isn't aware of how to maintain valid CSS syntax,
so if you place the bundle marker anywhere other than the root level of the CSS,
it will very likely break things or produce unexpected behavior.
For instance, `/* ${bundle("plant")} */` will break because `"/*"` will get placed at the end of the previous bundle and `"*/"` will get placed at the start of the new plant bundle.

### Importing

You may import external CSS file contents into a bundle using `bundle.import`. File paths will be resolved relative to the component file.

```js
import { bundle } from '#site-lib/bundle.js';

SayHello.css = css`
  ${bundle.import("./SayHello.css")}
`;
```

By default, the imported file contents will be placed in the most recently defined bundle, but you may also specify a different
bundle name with a second optional `bundleName` param. Note that specifying a bundle name on an import will ONLY apply to that import,
and any following CSS content will be placed into the previously specified bundle name.

```js
SayHello.css = css`
  ${bundle.import("./SayHello.css", "say-hello")}

  /** This will be placed in the "default" bundle, not "say-hello" */
  body { }
`;
```

### Scoped styles

We have access to a `getScopedComponentID` util which can be used as a rudimentary way to scope styles within a component.
The util can be used to generate a unique ID for the component which can be used in HTML attributes and referenced to scope CSS selectors.
The easiest way to accomplish this is to use CSS nesting syntax to wrap all scoped styles inside a selector for the component ID attribute.
Here is a simple example:

```js
import { html } from '#site-lib/html.js';
import { css } from '#site-lib/css.js';
import { getScopedComponentID } from '#site-lib/scid.js';

const scid = getScopedComponentID();

export function MyScopedFunction(){
  return html`
    <div data-scid=${scid}>
      <p>Hello!</p>
    </div>
  `;
}

MyScopedFunction.css = css`
  [data-scid="${scid}"] {
    p {
      color: yellow;
    }
  }
`;
```

## Scripts

Simple client-side JavaScript can be bundled with components in a very similar way to CSS; you can attach scripts to a component
by setting `Component.js` and using the `js` tagged template literal function.
All bundles used on a page will be rolled up and automatically added to the `<head>` as `<script type="module" async>` tags.

```js
import { js } from "#site-lib/js.js";
import { bundle } from "#site-lib/bundle.js";

SayHello.js = js`
  ${bundle("plant")}
  console.log("Hello from the plant bundle!");
`;
```

The bundled scripts for each component will be wrapped in block scopes to avoid naming collisions, which means you cannot use top-level import declarations (ie, `import X from "/js/hello.js";`). However, you may use dynamic imports, such as `const X = await import("/js/hello.js");`.

```js
/** /public/js/hello.js */
console.log("Hello there!");

/** /_components/SayHello.component.js */
SayHello.js = js`
  const logHello = import("/js/hello.js");
`;
```
