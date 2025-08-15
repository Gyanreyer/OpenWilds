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
 *  };
 *  jsBundles:{
 *    [bundleName: string]: Set<string>;
 *  };
 * }} RenderResult
 */

/**
 * @param {unknown} tagNameOrComponent 
 * @returns {tagNameOrComponent is ((...any) => RenderResult) & { css?: Record<string, string>; js?: Record<string, string> }}
 */
const isNestedComponent = (tagNameOrComponent) => typeof tagNameOrComponent === 'function';

/**
 * @param {unknown} child 
 * @returns {child is RenderResult}
 */
const isRenderResultChild = (child) => typeof child === 'object' && child !== null && 'html' in child;

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

  /**
   * @type {{
   *  [bundleName: string]: Set<string>;
   * }}
   */
  const jsBundles = {};

  // Sortof component support!
  if (isNestedComponent(tagNameOrComponent)) {
    const componentCSS = tagNameOrComponent.css;
    if (componentCSS) {
      for (const bundleName in componentCSS) {
        cssBundles[bundleName] ??= new Set();
        cssBundles[bundleName].add(componentCSS[bundleName]);
      }
    }

    const componentJS = tagNameOrComponent.js;
    if (componentJS) {
      for (const bundleName in componentJS) {
        jsBundles[bundleName] ??= new Set();
        jsBundles[bundleName].add(componentJS[bundleName]);
      }
    }

    const {
      html: componentHTML,
      cssBundles: componentCSSBundles = {},
      jsBundles: componentJSBundles = {},
    } = tagNameOrComponent({
      ...attrs,
      children,
    });

    for (const bucketName in componentCSSBundles) {
      cssBundles[bucketName] ??= new Set();
      for (const chunk of componentCSSBundles[bucketName]) {
        cssBundles[bucketName].add(chunk);
      }
    }

    for (const bucketName in componentJSBundles) {
      jsBundles[bucketName] ??= new Set();
      for (const chunk of componentJSBundles[bucketName]) {
        jsBundles[bucketName].add(chunk);
      }
    }

    return {
      html: componentHTML,
      cssBundles,
      jsBundles,
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
          if (children.jsBundles) {
            for (const bucketName in children.jsBundles) {
              jsBundles[bucketName] ??= new Set();
              for (const chunk of children.jsBundles[bucketName]) {
                jsBundles[bucketName].add(chunk);
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
    jsBundles,
  };
}

export const html = htm.bind(h);
