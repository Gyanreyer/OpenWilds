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
 * @typedef {{
 *  html: string;
 *  cssBundles: {
 *    [bundleName: string]: Set<string>;
 *  },
 * }} RenderResult
 */

/**
 * @param {unknown} tagNameOrComponent 
 * @returns {tagNameOrComponent is ((...any) => RenderResult) & { css?: Record<string, string> }}
 */
const isNestedComponent = (tagNameOrComponent) => typeof tagNameOrComponent === 'function';

/**
 * @param {unknown} child 
 * @returns {child is RenderResult}
 */
const isRenderResultChild = (child) => typeof child === 'object' && child !== null && 'html' in child && "css" in child;

/**
 * Hyperscript reviver that constructs a sanitized HTML string.
 * This is forked from the vhtml library's implementation.
 * https://github.com/developit/vhtml
 *
 * @returns {RenderResult}
 */
function h(tagNameOrComponent, attrs, ...children) {
  let serializedHTMLStr = "";

  attrs = attrs || {};

  /**
   * @type {{
   *  [bundleName: string]: Set<string>;
   * }}
   */
  const cssBundles = {};

  // Sortof component support!
  if (isNestedComponent(tagNameOrComponent)) {
    const componentCSS = tagNameOrComponent.css;
    if (componentCSS) {
      for (const bundleName in componentCSS) {
        cssBundles[bundleName] ??= new Set();
        cssBundles[bundleName].add(componentCSS[bundleName]);
      }
    }

    const {
      html: componentHTML,
      cssBundles: componentCSSBuckets = {},
    } = tagNameOrComponent({
      ...attrs,
      children,
    });

    for (const bucketName in componentCSSBuckets) {
      cssBundles[bucketName] ??= new Set();
      for (const chunk of componentCSSBuckets[bucketName]) {
        cssBundles[bucketName].add(chunk);
      }
    }

    return {
      html: componentHTML,
      cssBundles,
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
        } else if (isRenderResultChild(children)) {
          serializedHTMLStr += children.html;
          if (children.cssBundles) {
            for (const bucketName in children.cssBundles) {
              cssBundles[bucketName] ??= new Set();
              for (const chunk of children.cssBundles[bucketName]) {
                cssBundles[bucketName].add(chunk);
              }
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
    cssBundles,
  };
}

export const html = htm.bind(h);
