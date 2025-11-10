// Page where users can perform advanced plant searches, filtering by...
// - Bloom color
// - Height
// - Moisture
// - Light
// - Life cycle
// - State
// - Name
import { html } from "yeti-js";

import { BaseLayout } from "./_layouts/base.layout.js";

/**
 * @import { YetiPageComponent } from 'yeti-js';
 * @type {YetiPageComponent}
 */
const PlantFinderPage = () => {
  return html`<${BaseLayout} title="Plant Finder - OpenWilds" description="Find the right native plants for you based on your needs.">
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
export default PlantFinderPage;