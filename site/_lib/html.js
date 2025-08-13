import htm from "htm";

const voidTagNames = {
  'area': true,
  'base': true,
  'br': true,
  'col': true,
  'command': true,
  'embed': true,
  'hr': true,
  'img': true,
  'input': true,
  'keygen': true,
  'link': true,
  'meta': true,
  'param': true,
  'source': true,
  'track': true,
  'wbr': true,
}

const escapeCharactersRegex = /[&<>"']/g;

// escape an attribute
const escapedCharacterMap = {
  '&': 'amp',
  '<': 'lt',
  '>': 'gt',
  '"': 'quot',
  "'": 'apos'
};
const escape = (str) => String(str).replace(escapeCharactersRegex, (s) => `&${escapedCharacterMap[s]};`);


const setInnerHTMLAttr = 'dangerouslySetInnerHTML';
const DOMAttributeNames = {
  className: 'class',
  htmlFor: 'for'
};

/**
 * Hyperscript reviver that constructs a sanitized HTML string.
 * This is forked from the vhtml library's implementation.
 * https://github.com/developit/vhtml
 *
 * @returns {{
 *  html: string;
 *  css: {
 *    [bucketName: string]: string[]
 *  },
 * }}
 */
function h(tagNameOrComponent, attrs, ...children) {
  let serializedHTMLStr = "";

  attrs = attrs || {};

  /**
   * @type {{
   *  [bucketName: string]: string[]
   * }}
   */
  const cssBuckets = {};

  // Sortof component support!
  if (typeof tagNameOrComponent === 'function') {
    return tagNameOrComponent({
      ...attrs,
      children,
    });
  }

  if (tagNameOrComponent === "style" && (!("data-inline" in attrs) || attrs["data-inline"] === "false")) {
    const bucketName = attrs['data-bundle'] || 'default';

    return {
      html: "",
      css: {
        [bucketName]: [children.map((child) => String(child)).join("").trim()],
      },
    };
  }

  if (tagNameOrComponent) {
    serializedHTMLStr += '<' + tagNameOrComponent;
    if (attrs) {
      for (let attrName in attrs) {
        if (attrs[attrName] !== false && attrs[attrName] != null && attrName !== setInnerHTMLAttr) {
          serializedHTMLStr += ` ${DOMAttributeNames[attrName] ? DOMAttributeNames[attrName] : escape(attrName)}="${escape(attrs[attrName])}"`;
        }
      }
    }
    serializedHTMLStr += '>';
  }

  if (!voidTagNames[tagNameOrComponent]) {
    if (attrs[setInnerHTMLAttr]) {
      serializedHTMLStr += attrs[setInnerHTMLAttr].__html;
    } else {
      const addChildrenToSerializedStr = (children) => {
        if (Array.isArray(children)) {
          for (const child of children) {
            addChildrenToSerializedStr(child);
          }
        } else if (typeof children === "string") {
          serializedHTMLStr += escape(children);
        } else if (typeof children === "object" && children !== null && "html" in children) {
          serializedHTMLStr += children.html;
          if (children.css) {
            for (const bucketName in children.css) {
              cssBuckets[bucketName] ??= [];
              cssBuckets[bucketName].push(...children.css[bucketName]);
            }
          }
        }
      };

      addChildrenToSerializedStr(children);
    }

    serializedHTMLStr += tagNameOrComponent ? `</${tagNameOrComponent}>` : '';
  }

  return {
    html: serializedHTMLStr,
    css: cssBuckets,
  };
}

export const html = htm.bind(h);
