import { html } from "#site-lib/html.js";
import Base from "#site-layouts/base.layout.js";

export default function NotFoundPage() {
  return html`<${Base} title="404 - Page Not Found" description="The page you are looking for does not exist.">
    <header>
      <div>
        <h1>404 - Page Not Found</h1>
        <p>The page you are looking for does not exist.</p>
      </div>
    </header>
    <main>
      <p>Sorry, we couldn't find the page you were looking for.</p>
    </main>
  <//>`;
}