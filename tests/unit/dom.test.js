import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { h, isAllowedAttribute, isValidUrl } from '../../frontend/app/js/utils/dom.js';

describe('DOM helper h() and security attribute validation', () => {
  // Minimal DOM mock for Node environment
  before(() => {
    if (typeof global.document === 'undefined') {
      global.document = {
        createElement: (tag) => {
          const attributes = {};
          const children = [];
          return {
            tagName: tag.toUpperCase(),
            setAttribute: (k, v) => { attributes[k] = String(v); },
            getAttribute: (k) => attributes[k],
            hasAttribute: (k) => k in attributes,
            addEventListener: () => {},
            appendChild: (c) => { children.push(c); },
            children,
            textContent: ''
          };
        },
        createElementNS: (ns, tag) => {
          const el = global.document.createElement(tag);
          el.namespaceURI = ns;
          return el;
        },
        createTextNode: (text) => ({
          nodeType: 3,
          textContent: String(text)
        })
      };
    }
  });

  test('URL validator rejects javascript: URIs', () => {
    assert.equal(isValidUrl('javascript:alert(1)'), false);
    assert.equal(isValidUrl('JavaScript:alert(document.cookie)'), false);
    assert.equal(isValidUrl('  javascript:void(0)'), false);
  });

  test('URL validator rejects dangerous CRLF control chars in URIs', () => {
    assert.equal(isValidUrl('https://example.com\r\ninjected'), false);
    assert.equal(isValidUrl('/app/path\nnewline'), false);
  });

  test('URL validator accepts safe relative and secure absolute URIs', () => {
    assert.equal(isValidUrl('/app/login'), true);
    assert.equal(isValidUrl('./avatar.jpg'), true);
    assert.equal(isValidUrl('../css/tokens.css'), true);
    assert.equal(isValidUrl('#main-content'), true);
    assert.equal(isValidUrl('https://res.cloudinary.com/demo/image.jpg'), true);
    assert.equal(isValidUrl('mailto:support@example.com'), true);
    assert.equal(isValidUrl('blob:http://localhost:3000/uuid-1234'), true);
  });

  test('isAllowedAttribute allowlists safe HTML, SVG, and data/aria attributes', () => {
    assert.equal(isAllowedAttribute('id'), true);
    assert.equal(isAllowedAttribute('class'), true);
    assert.equal(isAllowedAttribute('aria-label'), true);
    assert.equal(isAllowedAttribute('aria-describedby'), true);
    assert.equal(isAllowedAttribute('data-test-id'), true);
    assert.equal(isAllowedAttribute('stroke-width'), true);

    // Reject dangerous script attributes
    assert.equal(isAllowedAttribute('onclick'), false);
    assert.equal(isAllowedAttribute('onload'), false);
    assert.equal(isAllowedAttribute('onerror'), false);
    assert.equal(isAllowedAttribute('dangerouslySetInnerHTML'), false);
    assert.equal(isAllowedAttribute('style'), false);
  });

  test('h() throws on unknown or disallowed attributes', () => {
    assert.throws(() => {
      h('div', { onclick: 'alert(1)' });
    }, /not allowed/);

    assert.throws(() => {
      h('span', { evilAttr: 'malicious' });
    }, /not allowed/);
  });

  test('h() throws when href contains javascript: URL', () => {
    assert.throws(() => {
      h('a', { href: 'javascript:alert(1)' });
    }, /Invalid or disallowed URL/);
  });

  test('h() creates text nodes without evaluating HTML strings', () => {
    const rawString = '<img src=x onerror=alert(1)>';
    const el = h('p', null, rawString);
    assert.equal(el.children.length, 1);
    assert.equal(el.children[0].nodeType, 3);
    assert.equal(el.children[0].textContent, rawString);
  });
});
