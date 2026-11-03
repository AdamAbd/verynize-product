"use strict";
(() => {
  // Keep local paint-server references and ordinary CSS; discard unsafe CSS wholesale.
  function unsafeCss(text) {
    const value = text
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\s/g, "")
      .toLowerCase();
    return (
      /javascript:|@import|\\|https?:|data:|image-set|\/\//.test(value) ||
      /url\(/.test(value.replace(/url\(["']?#[\w-]+["']?\)/g, ""))
    );
  }
  function sanitize(markup) {
    const parsed = new DOMParser().parseFromString(markup, "image/svg+xml");
    const root = parsed.documentElement;
    if (root.localName !== "svg" || parsed.querySelector("parsererror") || parsed.doctype)
      return null;
    for (const el of [root, ...root.querySelectorAll("*")]) {
      if (
        [
          "script",
          "foreignobject",
          "animate",
          "set",
          "animatetransform",
          "animatemotion",
          "animatecolor",
        ].includes(el.localName.toLowerCase())
      ) {
        el.remove();
        continue;
      }
      if (el.localName.toLowerCase() === "style" && unsafeCss(el.textContent)) {
        el.remove();
        continue;
      }
      for (const attr of Array.from(el.attributes)) {
        const value = attr.value.replace(/\s/g, "").toLowerCase();
        if (
          /^on/i.test(attr.name) ||
          /(^|:)base$/i.test(attr.name) ||
          (attr.name === "style" && unsafeCss(attr.value)) ||
          /javascript:|@import|\\/.test(value) ||
          /url\(/.test(value.replace(/url\(["']?#[\w-]+["']?\)/g, "")) ||
          (/href$/i.test(attr.name) && !/^#[\w-]+$/.test(value))
        )
          el.removeAttribute(attr.name);
      }
    }
    root.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    return root;
  }
  window.sanitizeSvg = sanitize;
})();
