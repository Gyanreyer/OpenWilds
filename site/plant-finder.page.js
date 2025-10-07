// Page where users can perform advanced plant searches, filtering by...
// - Bloom color
// - Height
// - Moisture
// - Light
// - Life cycle
// - State
// - Name
import { bundle } from "#site-lib/bundle.js";
import { css } from "#site-lib/css.js";
import { html } from "#site-lib/html.js";

import Base from "./_layouts/base.layout.js";

export default function PlantFinderPage() {
  return html`<${Base} title="Plant Finder - OpenWilds" description="Find the right native plants for you based on your needs.">
    <header>
      <div>
        <h1>Plant Finder</h1>
        <p>Find the right native plants for you based on your needs.</p>
      </div>
    </header>
    <main>
      <p>This page is under construction.</p>
    </main>
  <//>`;
}