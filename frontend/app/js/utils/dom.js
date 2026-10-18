/**
 * WorkCred DOM Helper h(tag, props, ...children)
 * Strictly constructs DOM elements safely via createElement, textContent, setAttribute.
 */

const ALLOWED_STATIC_ATTRS = new Set([
  'id', 'class', 'className', 'name', 'type', 'value', 'placeholder',
  'disabled', 'readonly', 'required', 'role', 'tabindex', 'href', 'src',
  'alt', 'title', 'autocomplete', 'inputmode', 'autocapitalize', 'min',
  'max', 'step', 'for', 'htmlFor', 'rows', 'cols', 'open', 'hidden',
  'accept', 'checked', 'selected', 'multiple', 'maxlength', 'maxLength',
  'minlength', 'minLength', 'autofocus', 'spellcheck', 'pattern', 'size',
  'target', 'rel', 'as',
  'viewBox', 'xmlns', 'fill', 'stroke', 'stroke-width', 'stroke-linecap',
  'stroke-linejoin', 'd', 'width', 'height', 'cx', 'cy', 'r', 'x', 'y',
  'points', 'x1', 'y1', 'x2', 'y2', 'rx', 'ry', 'transform',
  'stroke-dasharray', 'stroke-dashoffset'
]);

export function isAllowedAttribute(attr) {
  if (ALLOWED_STATIC_ATTRS.has(attr)) return true;
  if (attr.startsWith('aria-')) return true;
  if (attr.startsWith('data-')) return true;
  return false;
}

export function isValidUrl(url) {
  if (typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (/^javascript:/i.test(trimmed)) return false;
  if (/[\r\n\t]/.test(trimmed)) return false;

  // Allowed URL protocols/formats: relative paths, anchor, https, http, blob, mailto
  if (trimmed.startsWith('/') || trimmed.startsWith('./') || trimmed.startsWith('../') || trimmed.startsWith('#')) {
    return true;
  }
  if (/^https?:\/\//i.test(trimmed)) return true;
  if (/^mailto:/i.test(trimmed)) return true;
  if (/^blob:/i.test(trimmed)) return true;
  if (/^data:image\/(?:png|jpeg|webp);base64,/i.test(trimmed)) return true;

  return false;
}

const SVG_TAGS = new Set([
  'svg', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'g'
]);

export function h(tag, props, ...children) {
  if (typeof tag !== 'string') {
    throw new TypeError(`Tag must be a string, got ${typeof tag}`);
  }

  const isSvg = SVG_TAGS.has(tag.toLowerCase());
  const el = isSvg
    ? document.createElementNS('http://www.w3.org/2000/svg', tag)
    : document.createElement(tag);

  if (props && typeof props === 'object' && !Array.isArray(props)) {
    for (const [key, val] of Object.entries(props)) {
      if (val === undefined || val === null || val === false) continue;

      // Event listener: e.g. onClick, onInput, onKeyDown
      if (key.startsWith('on') && key.length > 2 && typeof val === 'function') {
        const eventType = key.slice(2).toLowerCase();
        el.addEventListener(eventType, val);
        continue;
      }

      const attrName = (key === 'className' || key === 'class') ? 'class'
                     : (key === 'htmlFor' || key === 'for') ? 'for'
                     : key;

      if (!isAllowedAttribute(attrName)) {
        throw new Error(`Attribute '${attrName}' is not allowed on element <${tag}>`);
      }

      if ((attrName === 'href' || attrName === 'src') && !isValidUrl(val)) {
        throw new Error(`Invalid or disallowed URL for attribute '${attrName}': ${val}`);
      }

      if (val === true) {
        el.setAttribute(attrName, '');
      } else {
        el.setAttribute(attrName, String(val));
      }
    }
  }

  function appendChildNode(child) {
    if (child === null || child === undefined || child === false) return;

    if (Array.isArray(child)) {
      for (const c of child) {
        appendChildNode(c);
      }
    } else if (typeof child === 'string' || typeof child === 'number') {
      el.appendChild(document.createTextNode(String(child)));
    } else if (child instanceof Node) {
      el.appendChild(child);
    }
  }

  for (const child of children) {
    appendChildNode(child);
  }

  return el;
}
