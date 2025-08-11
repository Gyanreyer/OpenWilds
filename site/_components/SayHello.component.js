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