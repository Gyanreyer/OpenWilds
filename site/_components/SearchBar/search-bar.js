window.customElements.define("search-bar", class extends HTMLElement {
  constructor() {
    super();
    console.log("SEARCH BAR CONSTRUCT");
  }

  connectedCallback() {
    const form = this.querySelector("form");
    if (!form) {
      console.error("<search-bar> requires a <form> child");
      return;
    }

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const formData = new FormData(form);
      const query = formData.get("query").toString().trim();
      console.log("Search query:", query);
      // Load sqlite wasm and perform search
    });
  }
});